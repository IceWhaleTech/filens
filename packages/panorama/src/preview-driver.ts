import {
  createDefaultPreviewRoutes,
  type FormatDefinition,
  type PreviewDriver,
  type PreviewEventMap,
  type PreviewEventName,
  type PreviewLoadContext,
  type PreviewOptions,
  type PreviewItemState,
  type PreviewResourceResolver,
  type PreviewSession,
  type PreviewSource
} from '@filens/core';
import {
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  VideoTexture,
  WebGLRenderer
} from 'three';
import { createCalibratedPanoramaImageRenderer, createCalibratedPanoramaRenderer, type CalibratedPanoramaRenderer, type PanoramaStabilizationMode } from './calibrated-renderer';
import type { PanoramaAssetManifest, PanoramaProcessor } from './wasm-processor';

type PreviewListenerMap = {
  [K in PreviewEventName]: Set<(payload: PreviewEventMap[K]) => void>;
};

const EQUIRECTANGULAR_WARNING = 'Panorama is not close to a 2:1 equirectangular projection; raw dual-fisheye media requires vendor stitching, while stereoscopic media needs a compatible projection mode.';
const VENDOR_RAW_FORMATS = new Set(['insp', 'insv', 'osv']);
const VENDOR_RAW_VIDEO_FORMATS = new Set(['insv', 'osv']);

export const PANORAMA_FORMAT_ROUTES: FormatDefinition[] = [
  {
    extensions: ['pano', 'panorama', '360', 'insp'],
    family: 'panorama',
    driverId: 'panorama',
    targetFormat: 'pano',
    contentTypes: ['image/panorama', 'image/x-panorama', 'image/x-insta360', 'application/vnd.filens.panorama+image']
  },
  {
    extensions: ['360v', 'vr360', 'insv', 'osv'],
    family: 'panorama-video',
    driverId: 'panorama',
    targetFormat: '360v',
    contentTypes: ['video/panorama', 'video/x-panorama', 'video/x-insta360', 'video/x-osmo360', 'application/vnd.filens.panorama+video']
  }
];

export type PanoramaPreviewState = PreviewItemState & {
  family: 'panorama' | 'panorama-video';
  scale: number;
  rotation: number;
  panX: number;
  panY: number;
  naturalWidth?: number;
  naturalHeight?: number;
  duration?: number;
  currentTime?: number;
  paused?: boolean;
  muted?: boolean;
  vendor?: PanoramaAssetManifest['vendor'];
  cameraModel?: string | null;
  calibrationSource?: PanoramaAssetManifest['calibrationSource'];
  projection?: PanoramaAssetManifest['projection']['kind'];
  decodeMode?: 'browser-media' | 'webcodecs' | 'proxy';
  stitchMode?: 'equirectangular' | 'calibrated-blend' | 'dynamic-seam' | 'proxy';
  streamSyncMs?: number;
  proxyPreview?: boolean;
  stabilizationAvailable?: boolean;
  stabilizationMode?: PanoramaStabilizationMode;
};

export class PanoramaPreviewSession implements PreviewSession<PanoramaPreviewState> {
  private readonly listeners: PreviewListenerMap = {
    loading: new Set(),
    rendered: new Set(),
    error: new Set(),
    statechange: new Set(),
    warnings: new Set()
  };
  private readonly root: HTMLDivElement;
  private readonly stage: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly notice: HTMLDivElement;
  private createdUrl: string | null = null;
  private renderer: WebGLRenderer | null = null;
  private scene: Scene | null = null;
  private camera: PerspectiveCamera | null = null;
  private texture: Texture | null = null;
  private video: HTMLVideoElement | null = null;
  private geometry: SphereGeometry | null = null;
  private material: MeshBasicMaterial | null = null;
  private calibratedRenderer: CalibratedPanoramaRenderer | null = null;
  private calibratedPlayButton: HTMLButtonElement | null = null;
  private calibratedTimeline: HTMLInputElement | null = null;
  private calibratedTime: HTMLOutputElement | null = null;
  private lastPlaybackStateEmit = 0;
  private osmoFallbackReason = '';
  private animationFrame = 0;
  private lon = 180;
  private lat = 0;
  private pointerDown = false;
  private pointerStartX = 0;
  private pointerStartY = 0;
  private pointerStartLon = 0;
  private pointerStartLat = 0;
  private resizeObserver: ResizeObserver | null = null;
  private readonly resourceResolver?: PreviewResourceResolver;
  private state: PanoramaPreviewState;

  constructor(private readonly host: HTMLElement, options: PreviewOptions = {}, private readonly processor?: PanoramaProcessor) {
    this.resourceResolver = options.resourceResolver;
    this.root = document.createElement('div');
    this.root.className = 'panoramav-preview';
    this.stage = document.createElement('div');
    this.stage.className = 'panoramav-stage';
    this.hint = document.createElement('div');
    this.hint.className = 'panoramav-hint';
    this.hint.textContent = 'Drag to look around';
    this.notice = document.createElement('div');
    this.notice.className = 'panoramav-notice';
    this.notice.setAttribute('role', 'status');
    this.notice.setAttribute('aria-live', 'polite');
    this.root.replaceChildren(this.stage, this.hint);
    this.host.replaceChildren(this.root);
    this.state = {
      loading: false,
      error: null,
      family: 'panorama',
      warnings: [],
      capabilities: {
        zoom: true,
        pan: true,
        fullscreen: true,
        download: true
      },
      scale: options.initialScale ?? 1,
      rotation: 0,
      panX: 0,
      panY: 0
    };
  }

  async load(source: PreviewSource, context: PreviewLoadContext): Promise<void> {
    this.state = {
      ...this.state,
      loading: true,
      error: null,
      title: context.descriptor.name,
      warnings: [],
      vendor: undefined,
      cameraModel: undefined,
      calibrationSource: undefined,
      projection: undefined,
      decodeMode: undefined,
      stitchMode: undefined,
      streamSyncMs: undefined,
      proxyPreview: false,
      stabilizationAvailable: false,
      stabilizationMode: 'off'
    };
    this.emit('loading', this.state);
    this.emit('statechange', this.state);

    try {
      this.osmoFallbackReason = '';
      this.disposeScene();
      this.root.replaceChildren(this.stage, this.hint);
      const renderer = new WebGLRenderer({
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x111827, 1);
      renderer.domElement.className = 'panoramav-canvas';
      this.stage.replaceChildren(renderer.domElement);

      const scene = new Scene();
      const camera = new PerspectiveCamera(this.scaleToFov(this.state.scale), 1, 1, 1100);
      const isVideo = context.route?.family === 'panorama-video';
      const format = normalizeFormat(context.descriptor.extension ?? context.route?.sourceFormat);
      const contentType = resolvePanoramaContentType(format, context.descriptor.contentType);
      this.state.family = isVideo ? 'panorama-video' : 'panorama';
      this.state.capabilities = {
        ...this.state.capabilities,
        playback: isVideo,
        timeline: isVideo,
        volume: isVideo
      };
      if (VENDOR_RAW_VIDEO_FORMATS.has(format) && this.processor && await this.tryCalibratedVendor(source, format as 'osv' | 'insv', context.descriptor.name, context.signal, scene)) {
        this.finishScene(renderer, scene, camera);
        return;
      }
      if (format === 'insv' && this.osmoFallbackReason) throw new Error(`INSV ${this.osmoFallbackReason}`);
      const resolvedSource = format === 'osv'
        ? await this.resolveOsmoProxy(context.descriptor.name)
        : await resolvePanoramaSource(source, format, context.signal);
      if (format === 'insp' && this.processor) {
        const manifest = await this.processor.open(resolvedSource, { format: 'insp', signal: context.signal });
        if (manifest.projection.kind === 'mei-extended') {
          const texture = await new TextureLoader().loadAsync(this.sourceToUrl(resolvedSource, contentType));
          texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
          const calibrated = await createCalibratedPanoramaImageRenderer(this.processor, manifest, texture);
          scene.add(calibrated.mesh);
          this.texture = texture;
          this.calibratedRenderer = calibrated;
          this.state.vendor = manifest.vendor;
          this.state.cameraModel = manifest.cameraModel;
          this.state.calibrationSource = manifest.calibrationSource;
          this.state.projection = manifest.projection.kind;
          this.state.decodeMode = 'browser-media';
          this.state.stitchMode = 'calibrated-blend';
          this.state.naturalWidth = manifest.width;
          this.state.naturalHeight = manifest.height;
          this.state.warnings = manifest.confidence === 'experimental'
            ? ['Experimental calibrated INSP preview uses the image\'s embedded lens calibration, exposure matching, and a content-aware feathered seam.']
            : manifest.warnings;
          if (this.state.warnings.length) this.emit('warnings', this.state.warnings);
          this.finishScene(renderer, scene, camera);
          return;
        }
        this.processor.close();
        if (manifest.projection.kind === 'unknown') {
          throw new Error(manifest.warnings[0] || 'INSP contains an unsupported raw dual-fisheye image.');
        }
      }
      const texture = isVideo
        ? await this.createVideoTexture(resolvedSource, contentType)
        : await new TextureLoader().loadAsync(this.sourceToUrl(resolvedSource, contentType));
      texture.colorSpace = SRGBColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      texture.minFilter = LinearFilter;
      const geometry = new SphereGeometry(500, 64, 40);
      geometry.scale(-1, 1, 1);
      const material = new MeshBasicMaterial({
        map: texture
      });
      scene.add(new Mesh(geometry, material));

      this.renderer = renderer;
      this.scene = scene;
      this.camera = camera;
      this.texture = texture;
      this.geometry = geometry;
      this.material = material;
      this.state.proxyPreview = this.state.proxyPreview || format === 'osv';
      this.state.decodeMode = this.state.proxyPreview ? 'proxy' : 'browser-media';
      this.state.stitchMode = this.state.proxyPreview ? 'proxy' : 'equirectangular';
      this.state.naturalWidth = this.video?.videoWidth || getTextureWidth(texture);
      this.state.naturalHeight = this.video?.videoHeight || getTextureHeight(texture);
      const projectionWarning = getPanoramaProjectionWarning(this.state.naturalWidth, this.state.naturalHeight);
      if (projectionWarning) {
        if (VENDOR_RAW_VIDEO_FORMATS.has(format)) {
          throw new Error(`${format.toUpperCase()} contains an unstitched or unsupported projection. Export a stitched 2:1 video with the camera vendor app before spherical preview.`);
        }
        this.state.warnings = [projectionWarning];
        this.notice.textContent = projectionWarning;
        this.root.append(this.notice);
        this.emit('warnings', this.state.warnings);
      }
      this.finishScene(renderer, scene, camera);
    } catch (error) {
      const normalizedError = normalizePanoramaLoadError(error, context.descriptor.extension ?? context.route?.sourceFormat);
      this.disposeScene();
      this.state.loading = false;
      this.state.error = normalizedError.message;
      this.emit('error', normalizedError);
      this.emit('statechange', this.state);
      throw normalizedError;
    }
  }

  destroy(): void {
    this.disposeScene();
    this.stage.replaceChildren();
    this.root.replaceChildren();
    if (this.root.parentElement === this.host) {
      this.host.replaceChildren();
    }
  }

  getState(): PanoramaPreviewState {
    return {
      ...this.state,
      warnings: this.state.warnings.slice()
    };
  }

  on<T extends PreviewEventName>(event: T, handler: (payload: PreviewEventMap[T]) => void): () => void {
    this.listeners[event].add(handler as never);
    return () => {
      this.listeners[event].delete(handler as never);
    };
  }

  setScale(scale: number): void {
    this.state.scale = Math.max(0.5, Math.min(scale, 2.4));
    if (this.camera) {
      this.camera.fov = this.scaleToFov(this.state.scale);
      this.camera.updateProjectionMatrix();
    }
    this.emit('statechange', this.state);
  }

  fit(): void {
    this.lon = 180;
    this.lat = 0;
    this.setScale(1);
  }

  setStabilization(mode: PanoramaStabilizationMode): PanoramaStabilizationMode {
    const active = this.calibratedRenderer?.setStabilization(mode) ?? 'off';
    this.state.stabilizationMode = active;
    this.emit('statechange', this.state);
    return active;
  }

  async fullscreen(): Promise<void> {
    if (document.fullscreenElement === this.root) {
      await document.exitFullscreen?.();
      return;
    }
    await this.root.requestFullscreen?.();
  }

  private bindInteractions(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', (event) => {
      this.pointerDown = true;
      this.pointerStartX = event.clientX;
      this.pointerStartY = event.clientY;
      this.pointerStartLon = this.lon;
      this.pointerStartLat = this.lat;
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!this.pointerDown) {
        return;
      }
      this.lon = this.pointerStartLon - (event.clientX - this.pointerStartX) * 0.1;
      this.lat = Math.max(-85, Math.min(85, this.pointerStartLat + (event.clientY - this.pointerStartY) * 0.1));
    });
    canvas.addEventListener('pointerup', (event) => {
      this.pointerDown = false;
      canvas.releasePointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointercancel', () => {
      this.pointerDown = false;
    });
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.setScale(this.state.scale + (event.deltaY > 0 ? -0.08 : 0.08));
    }, { passive: false });
  }

  private observeResize(): void {
    this.resizeObserver?.disconnect();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.stage);
      return;
    }
    window.addEventListener('resize', this.resize);
  }

  private resize = (): void => {
    if (!this.renderer || !this.camera) {
      return;
    }
    const rect = this.stage.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width || this.stage.clientWidth || 1));
    const height = Math.max(1, Math.floor(rect.height || this.stage.clientHeight || 1));
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private startAnimation(): void {
    const animate = () => {
      this.animationFrame = requestAnimationFrame(animate);
      this.renderFrame();
    };
    animate();
  }

  private renderFrame(): void {
    if (!this.renderer || !this.scene || !this.camera) {
      return;
    }
    const phi = degToRad(90 - this.lat);
    const theta = degToRad(this.lon);
    this.camera.lookAt(
      500 * Math.sin(phi) * Math.cos(theta),
      500 * Math.cos(phi),
      500 * Math.sin(phi) * Math.sin(theta)
    );
    this.calibratedRenderer?.update();
    if (this.calibratedRenderer) {
      const decodeError = this.calibratedRenderer.error;
      if (decodeError && this.state.error !== decodeError.message) {
        this.state.error = decodeError.message;
        this.notice.textContent = `Panorama decode failed: ${decodeError.message}`;
        this.root.append(this.notice);
        this.emit('error', decodeError);
      }
      this.state.streamSyncMs = this.calibratedRenderer.streamSyncMs;
      this.state.stitchMode = this.calibratedRenderer.dynamicSeam ? 'dynamic-seam' : 'calibrated-blend';
      this.state.stabilizationMode = this.calibratedRenderer.stabilizationMode;
      this.syncCalibratedPlayback();
    }
    this.renderer.render(this.scene, this.camera);
  }

  private async tryCalibratedVendor(source: PreviewSource, format: 'osv' | 'insv', name: string | undefined, signal: AbortSignal | undefined, scene: Scene): Promise<boolean> {
    try {
      const companion = format === 'insv' ? await this.resolveInstaCompanion(name) : undefined;
      const ordered = orderInstaPair(source, companion, name);
      const sidecar = format === 'insv' ? await this.resolveInstaSidecar(ordered.primaryName) : undefined;
      const manifest = await this.processor!.open(ordered.source, { format, sidecar, companion: ordered.companion, signal });
      if (manifest.projection.kind === 'equirectangular') {
        this.state.vendor = manifest.vendor;
        this.state.cameraModel = manifest.cameraModel;
        this.state.calibrationSource = manifest.calibrationSource;
        this.state.projection = manifest.projection.kind;
        this.state.proxyPreview = Boolean(manifest.proxyPreview);
        this.state.warnings = manifest.warnings;
        if (this.state.warnings.length) this.emit('warnings', this.state.warnings);
        this.processor?.close();
        return false;
      }
      const calibrated = await createCalibratedPanoramaRenderer(this.processor!, manifest);
      scene.add(calibrated.mesh);
      this.calibratedRenderer = calibrated;
      this.state.vendor = manifest.vendor;
      this.state.cameraModel = manifest.cameraModel;
      this.state.calibrationSource = manifest.calibrationSource;
      this.state.projection = manifest.projection.kind;
      this.state.decodeMode = 'webcodecs';
      this.state.stitchMode = 'calibrated-blend';
      this.state.proxyPreview = false;
      this.state.stabilizationAvailable = calibrated.stabilizationAvailable;
      this.state.stabilizationMode = calibrated.stabilizationMode;
      this.state.naturalWidth = 2048;
      this.state.naturalHeight = 1024;
      this.state.duration = calibrated.duration;
      this.state.currentTime = calibrated.currentTime;
      this.state.paused = calibrated.paused;
      this.state.muted = true;
      this.createCalibratedControls(calibrated);
      this.state.warnings = manifest.confidence === 'experimental'
        ? [`Experimental calibrated ${format.toUpperCase()} preview uses source-specific lens calibration. Dynamic seams and symmetric overlap exposure matching activate after paired frames; IMU stabilization ${calibrated.stabilizationAvailable ? 'is available' : 'remains disabled until the IMU-to-camera rotation is confirmed'}.`]
        : manifest.warnings;
      if (this.state.warnings.length) this.emit('warnings', this.state.warnings);
      return true;
    } catch (error) {
      this.processor?.close();
      this.osmoFallbackReason = error instanceof Error ? error.message : String(error);
      this.state.warnings = [format === 'osv' ? `${this.osmoFallbackReason} Falling back to the camera-generated LRF proxy.` : this.osmoFallbackReason];
      return false;
    }
  }

  private async resolveInstaSidecar(name?: string): Promise<PreviewSource | undefined> {
    if (!name || !this.resourceResolver) return undefined;
    const sidecarName = `${name}.pb`;
    const resolved = await this.resourceResolver({
      family: 'panorama-video',
      sourceFormat: 'insv',
      source: sidecarName,
      name: sidecarName.split(/[\\/]/).pop(),
      relation: 'sidecar'
    });
    return previewSourceFromResource(resolved);
  }

  private createCalibratedControls(renderer: CalibratedPanoramaRenderer): void {
    const controls = document.createElement('div');
    controls.className = 'panoramav-calibrated-controls';
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', 'Pause panorama video');
    button.textContent = 'Pause';
    button.addEventListener('click', () => renderer.paused ? renderer.play() : renderer.pause());
    const timeline = document.createElement('input');
    timeline.type = 'range';
    timeline.min = '0';
    timeline.max = String(renderer.duration || 0);
    timeline.step = '0.01';
    timeline.setAttribute('aria-label', 'Panorama video position');
    timeline.addEventListener('change', () => renderer.seek(Number(timeline.value)));
    const time = document.createElement('output');
    controls.append(button, timeline, time);
    this.root.append(controls);
    this.hint.style.bottom = '66px';
    this.calibratedPlayButton = button;
    this.calibratedTimeline = timeline;
    this.calibratedTime = time;
    this.syncCalibratedPlayback(true);
  }

  private syncCalibratedPlayback(force = false): void {
    const renderer = this.calibratedRenderer;
    if (!renderer) return;
    const currentTime = renderer.currentTime;
    this.state.duration = renderer.duration;
    this.state.currentTime = currentTime;
    this.state.paused = renderer.paused;
    if (this.calibratedPlayButton) {
      this.calibratedPlayButton.textContent = renderer.paused ? 'Play' : 'Pause';
      this.calibratedPlayButton.setAttribute('aria-label', `${renderer.paused ? 'Play' : 'Pause'} panorama video`);
    }
    if (this.calibratedTimeline) {
      this.calibratedTimeline.max = String(renderer.duration || 0);
      this.calibratedTimeline.value = String(currentTime);
    }
    if (this.calibratedTime) this.calibratedTime.value = `${formatTime(currentTime)} / ${formatTime(renderer.duration)}`;
    const now = performance.now();
    if (force || now - this.lastPlaybackStateEmit >= 250) {
      this.lastPlaybackStateEmit = now;
      this.emit('statechange', this.state);
    }
  }

  private async resolveInstaCompanion(name?: string): Promise<PreviewSource | undefined> {
    if (!name || !this.resourceResolver) return undefined;
    const companionName = /_00_/i.test(name) ? name.replace(/_00_/i, '_10_') : /_10_/i.test(name) ? name.replace(/_10_/i, '_00_') : '';
    if (!companionName) return undefined;
    const resolved = await this.resourceResolver({
      family: 'panorama-video',
      sourceFormat: 'insv',
      source: companionName,
      name: companionName.split(/[\\/]/).pop(),
      relation: 'companion'
    });
    return previewSourceFromResource(resolved);
  }

  private finishScene(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera): void {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.state.loading = false;
    this.state.error = null;
    this.bindInteractions(renderer.domElement);
    this.observeResize();
    this.resize();
    this.startAnimation();
    this.emit('rendered', this.state);
    this.emit('statechange', this.state);
  }

  private scaleToFov(scale: number): number {
    return Math.max(30, Math.min(100, 75 / Math.max(scale, 0.5)));
  }

  private sourceToUrl(source: PreviewSource, contentType?: string): string {
    this.revokeCreatedUrl();
    if (typeof source === 'string') {
      return source;
    }
    const blob = source instanceof Blob && (!contentType || source.type === contentType)
      ? source
      : new Blob([source instanceof Blob ? source : toBlobPart(source)], contentType ? { type: contentType } : undefined);
    this.createdUrl = URL.createObjectURL(blob);
    return this.createdUrl;
  }

  private async createVideoTexture(source: PreviewSource, contentType?: string): Promise<VideoTexture> {
    const video = document.createElement('video');
    video.className = 'panoramav-video-controls';
    video.controls = true;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.crossOrigin = 'anonymous';
    video.src = this.sourceToUrl(source, contentType);
    await new Promise<void>((resolve, reject) => {
      video.addEventListener('loadeddata', () => resolve(), { once: true });
      video.addEventListener('error', () => reject(new Error('Failed to load 360 video.')), { once: true });
      video.load();
    });
    const syncState = () => {
      this.state.duration = Number.isFinite(video.duration) ? video.duration : undefined;
      this.state.currentTime = video.currentTime;
      this.state.paused = video.paused;
      this.state.muted = video.muted;
      this.emit('statechange', this.state);
    };
    for (const event of ['durationchange', 'timeupdate', 'play', 'pause', 'volumechange'] as const) {
      video.addEventListener(event, syncState);
    }
    this.video = video;
    this.root.append(video);
    syncState();
    return new VideoTexture(video);
  }

  private async resolveOsmoProxy(name?: string): Promise<PreviewSource> {
    const proxyName = String(name ?? '').replace(/\.osv$/i, '.LRF');
    if (!proxyName || proxyName === name || !this.resourceResolver) {
      throw new Error(this.osmoFallbackReason ? `OSV ${this.osmoFallbackReason}` : 'OSV spherical preview requires the matching camera-generated .LRF proxy file. Upload both files together.');
    }
    const resolved = await this.resourceResolver({
      family: 'panorama-video',
      sourceFormat: 'osv',
      source: proxyName,
      name: proxyName.split(/[\\/]/).pop(),
      relation: 'proxy'
    });
    const proxy = previewSourceFromResource(resolved);
    if (!proxy) {
      throw new Error(`OSV spherical preview requires the matching ${proxyName} proxy file. Upload both files together.`);
    }
    this.state.warnings = [
      'Experimental OSV preview uses the camera-generated low-resolution LRF proxy. Any lens seam or alignment error is embedded in that proxy; use a DJI Studio stitched 2:1 export for accurate spherical playback.'
    ];
    this.emit('warnings', this.state.warnings);
    return proxy;
  }

  private disposeScene(): void {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener('resize', this.resize);
    this.texture?.dispose();
    this.video?.pause();
    this.video?.removeAttribute('src');
    this.video?.load();
    this.geometry?.dispose();
    this.material?.dispose();
    this.renderer?.dispose();
    this.calibratedRenderer?.close();
    this.processor?.close();
    this.texture = null;
    this.video = null;
    this.geometry = null;
    this.material = null;
    this.renderer = null;
    this.calibratedRenderer = null;
    this.calibratedPlayButton = null;
    this.calibratedTimeline = null;
    this.calibratedTime = null;
    this.lastPlaybackStateEmit = 0;
    this.hint.style.bottom = '';
    this.osmoFallbackReason = '';
    this.scene = null;
    this.camera = null;
    this.revokeCreatedUrl();
  }

  private revokeCreatedUrl(): void {
    if (this.createdUrl) {
      URL.revokeObjectURL(this.createdUrl);
      this.createdUrl = null;
    }
  }

  private emit<T extends PreviewEventName>(event: T, payload: PreviewEventMap[T]): void {
    for (const handler of this.listeners[event]) {
      handler(payload as never);
    }
  }
}

export function createPanoramaPreviewDriver(options: { processor?: PanoramaProcessor } = {}): PreviewDriver<PanoramaPreviewState> {
  return {
    id: 'panorama',
    family: 'panorama',
    supports: (format) => ['pano', 'panorama', '360', 'insp', '360v', 'vr360', 'insv', 'osv'].includes(normalizeFormat(format)),
    createSession: (host, previewOptions) => new PanoramaPreviewSession(host, previewOptions, options.processor)
  };
}

export function createPanoramaPreviewRoutes(baseRoutes = createDefaultPreviewRoutes()): FormatDefinition[] {
  const extensions = new Set(PANORAMA_FORMAT_ROUTES.flatMap((route) => route.extensions));
  return [...PANORAMA_FORMAT_ROUTES, ...baseRoutes.filter((route) => !route.extensions.some((extension) => extensions.has(extension)))];
}

export function orderInstaPair(source: PreviewSource, companion: PreviewSource | undefined, name?: string): { source: PreviewSource; companion?: PreviewSource; primaryName?: string } {
  if (companion && name && /_10_/i.test(name)) {
    return { source: companion, companion: source, primaryName: name.replace(/_10_/i, '_00_') };
  }
  return { source, companion, primaryName: name };
}

function toBlobPart(source: Exclude<PreviewSource, string | Blob>): BlobPart {
  if (ArrayBuffer.isView(source)) {
    const bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer as ArrayBuffer;
  }
  return source;
}

function getTextureWidth(texture: Texture): number | undefined {
  const image = texture.image as { width?: number; naturalWidth?: number } | undefined;
  return image?.naturalWidth ?? image?.width;
}

function getTextureHeight(texture: Texture): number | undefined {
  const image = texture.image as { height?: number; naturalHeight?: number } | undefined;
  return image?.naturalHeight ?? image?.height;
}

export function isEquirectangularSize(width?: number, height?: number): boolean {
  if (!width || !height) {
    return false;
  }
  const ratio = width / height;
  return ratio >= 1.8 && ratio <= 2.2;
}

export function getPanoramaProjectionWarning(width?: number, height?: number): string | undefined {
  return width && height && !isEquirectangularSize(width, height) ? EQUIRECTANGULAR_WARNING : undefined;
}

export function normalizePanoramaLoadError(error: unknown, format?: string): Error {
  const normalizedFormat = normalizeFormat(format);
  if (error instanceof Error && error.message.startsWith(normalizedFormat.toUpperCase())) {
    return error;
  }
  if (VENDOR_RAW_FORMATS.has(normalizedFormat)) {
    return new Error(`${normalizedFormat.toUpperCase()} source could not be decoded by this browser. Stitch or export it with the camera vendor app as a 2:1 JPEG, MP4, or WebM file.`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

function previewSourceFromResource(
  resolved: Awaited<ReturnType<PreviewResourceResolver>>
): PreviewSource | undefined {
  if (!resolved) {
    return undefined;
  }
  return typeof resolved === 'object' && 'source' in resolved ? resolved.source : resolved as PreviewSource;
}

export function resolvePanoramaContentType(format?: string, contentType?: string): string | undefined {
  if (contentType && contentType !== 'application/octet-stream') {
    return contentType;
  }
  switch (normalizeFormat(format)) {
    case 'insp': return 'image/jpeg';
    case 'insv':
    case 'osv': return 'video/mp4';
    default: return contentType;
  }
}

export async function resolvePanoramaSource(
  source: PreviewSource,
  format?: string,
  signal?: AbortSignal
): Promise<PreviewSource> {
  if (normalizeFormat(format) !== 'insp' || typeof source !== 'string') {
    return source;
  }
  const response = await fetch(source, { signal });
  if (!response.ok) {
    throw new Error(`INSP source request failed: ${response.status} ${response.statusText}`.trim());
  }
  return response.blob();
}

function degToRad(value: number): number {
  return value * Math.PI / 180;
}

function formatTime(seconds: number): string {
  const value = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(value / 60);
  return `${minutes}:${Math.floor(value % 60).toString().padStart(2, '0')}`;
}

function normalizeFormat(format: string | undefined): string {
  return String(format ?? '').trim().replace(/^\./, '').toLowerCase();
}
