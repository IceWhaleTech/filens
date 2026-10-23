import {
  DualTrackPlayback,
  hasAccuratePanoramaCalibration,
  resolvePanoramaLensSources,
  type CalibratedPanoramaRenderer,
  type PanoramaLensSource,
  type Vec3
} from './calibrated-renderer';
import {
  PanoramaProcessorError,
  panoramaDecoderConfig,
  type PanoramaAssetManifest,
  type PanoramaLens,
  type PanoramaProcessor
} from './wasm-processor';
import { createPanoramaFrameRenderer } from './realtime/stitch-renderer.js';
import type { StitchCalibration, StitchLens } from './realtime/stitch-types';

/** Photos uses one packed sensor canvas, including when lenses decode separately. */
export function createRealtimeStitchCalibration(manifest: PanoramaAssetManifest): StitchCalibration | undefined {
  if (!hasAccuratePanoramaCalibration(manifest)) return undefined;
  const sources = resolvePanoramaLensSources(manifest);
  if (!sources) return undefined;
  const separate = sources[0].track.id !== sources[1].track.id;
  let width: number;
  let height: number;
  let rects: PanoramaLensSource['rect'][];
  if (separate) {
    const [first, second] = sources;
    if (first.track.width !== second.track.width || first.track.height !== second.track.height
      || sources.some(({ rect }) => rect.x !== 0 || rect.y !== 0 || rect.width !== 1 || rect.height !== 1)) return undefined;
    width = first.track.width * 2;
    height = first.track.height;
    rects = [{ x: 0, y: 0, width: 0.5, height: 1 }, { x: 0.5, y: 0, width: 0.5, height: 1 }];
  } else {
    width = sources[0].track.width;
    height = sources[0].track.height;
    rects = sources.map(({ rect }) => rect);
    // Retain the existing renderer for unusual crops and top/bottom layouts.
    if (rects.some((rect) => rect.y !== 0 || rect.width !== 0.5 || rect.height !== 1)
      || ![0, 0.5].every((x) => rects.some((rect) => rect.x === x))) return undefined;
  }
  if (width !== height * 2) return undefined;
  const lenses = manifest.lenses.slice(0, 2).map((lens, index) => rendererLens(lens, sources[index], rects[index], manifest));
  return {
    imageSize: [width, height],
    textureOrigin: manifest.textureOrigin === 'top-left' ? 'top-left' : 'bottom-left',
    front: lenses[0],
    back: lenses[1],
    pipeline: { seamLongitudesDeg: [90, 270], featherWidthPx: Math.round(height * 16 / 360) }
  };
}

export async function createRealtimePanoramaRenderer(processor: PanoramaProcessor, manifest: PanoramaAssetManifest): Promise<CalibratedPanoramaRenderer> {
  const calibration = createRealtimeStitchCalibration(manifest);
  const sources = resolvePanoramaLensSources(manifest);
  if (!calibration || !sources) throw new PanoramaProcessorError('calibration_missing', 'Real-time stitching requires two calibrated side-by-side lenses.');
  if (typeof VideoDecoder === 'undefined' || typeof EncodedVideoChunk === 'undefined') {
    throw new PanoramaProcessorError('codec_unsupported', 'This browser does not expose WebCodecs video decoding.');
  }
  const tracks = [...new Map(sources.map(({ track }) => [track.id, track])).values()];
  if (tracks.some((track) => track.timescale <= 0 || !track.samples.length)) {
    throw new PanoramaProcessorError('invalid_manifest', 'The calibrated panorama tracks do not contain a playable sample timeline.');
  }
  const configs = tracks.map(panoramaDecoderConfig);
  const supported = await Promise.all(configs.map((config) => VideoDecoder.isConfigSupported(config)));
  if (supported.some((result) => !result.supported)) {
    throw new PanoramaProcessorError('codec_unsupported', 'This browser cannot decode the calibrated panorama tracks.');
  }
  const canvas = document.createElement('canvas');
  canvas.className = 'panoramav-canvas';
  const renderer = createPanoramaFrameRenderer(canvas, {
    projection: 'dual_fisheye',
    dualFisheyeCalibration: calibration,
    dualFisheyeFrontLens: calibration.front.center[0] < 0.5 ? 'left' : 'right',
    dualFisheyeFlipX: false,
    dualFisheyeSeamBlendDeg: 16,
    dualFisheyeVideoProtection: true,
    dualFisheyeVideoRegistration: manifest.projection.kind === 'dji-fisheye-lut',
    equirectFlipX: false,
    minFovDeg: 30,
    maxFovDeg: 100
  });
  let playback: DualTrackPlayback;
  let renderError: Error | undefined;
  try {
    playback = new DualTrackPlayback(processor, tracks, [], configs, (first, second) => {
      renderer.presentFrames(tracks.length === 1 ? [first] : [first, second], first.timestamp / 1_000_000);
    }, async () => undefined, () => renderer.reset());
  } catch (error) {
    renderer.destroy();
    throw error;
  }
  renderer.start();
  playback.start();
  const onRenderError = () => {
    renderError = new Error('The panorama WebGL context was lost. Reload the preview to resume.');
    playback.pause();
  };
  canvas.addEventListener('insta360previewerror', onRenderError);
  let view = '';
  let closed = false;
  return {
    canvas,
    setView(yaw, pitch, roll, fov) {
      const key = `${yaw}:${pitch}:${roll}:${fov}`;
      if (closed || key === view) return;
      view = key;
      renderer.setView(yaw, pitch, roll, fov);
      renderer.requestFrame('view');
    },
    requestRender: () => { if (!closed) renderer.requestFrame('resize'); },
    update: () => playback.update(),
    play: () => playback.play(),
    pause: () => playback.pause(),
    seek: (seconds) => playback.seek(seconds),
    close() {
      if (closed) return;
      closed = true;
      playback.close();
      canvas.removeEventListener('insta360previewerror', onRenderError);
      renderer.destroy();
      canvas.width = canvas.height = 0;
    },
    get streamSyncMs() { return playback.streamSyncMs; },
    get dynamicSeam() { return ['ready', 'cached'].includes(canvas.dataset.insta360VideoSeam ?? ''); },
    get duration() { return playback.duration; },
    get currentTime() { return playback.currentTime; },
    get paused() { return playback.paused; },
    get error() { return renderError ?? playback.error; },
    stabilizationAvailable: false,
    stabilizationMode: 'off',
    setStabilization: () => 'off'
  };
}

function rendererLens(lens: PanoramaLens, source: PanoramaLensSource, rect: PanoramaLensSource['rect'], manifest: PanoramaAssetManifest): StitchLens {
  const width = lens.width ?? source.track.width * source.rect.width;
  const height = lens.height ?? source.track.height * source.rect.height;
  const q = lens.extrinsicQuaternion!;
  const mei = manifest.projection.kind === 'mei-extended';
  // MEI extrinsics map lens to body; DJI quaternions map body to lens.
  const inverse = mei ? q : [q[0], -q[1], -q[2], -q[3]];
  const axis = (value: Vec3): Vec3 => {
    const rotated = rotate(inverse, value);
    // DJI body X-right/Y-forward/Z-up -> renderer X-right/Y-down/Z-forward.
    return mei ? rotated : [rotated[0], -rotated[2], rotated[1]];
  };
  const right = axis([1, 0, 0]);
  const up = axis([0, mei ? 1 : -1, 0]);
  const focal: [number, number] = [(lens.fx! / width) * rect.width, ((lens.fy ?? lens.fx!) / height) * rect.height];
  const radius = Math.min(width, height) * 0.475;
  return {
    center: [rect.x + ((lens.cx! + 0.5) / width) * rect.width, rect.y + ((lens.cy! + 0.5) / height) * rect.height],
    focal,
    principalOffset: [0, 0],
    rotationQuat: q,
    scale: focal,
    validRadius: [radius / width * rect.width, radius / height * rect.height],
    radial: numbers(lens.radial ?? lens.distortion, 4),
    tangential: numbers(lens.tangential, 2),
    thinPrism: numbers(lens.thinPrism, 4),
    sensorTilt: numbers(lens.sensorTilt, 2),
    xi: lens.xi ?? 0,
    radialScale: mei ? 1 : djiRadialScale(lens),
    distortionModel: lens.distortionModel,
    distortionCoeffs: lens.distortionCoeffs,
    translationM: lens.translation,
    axis: axis([0, 0, 1]),
    right,
    up,
    projectionModel: mei ? 'mei_extended' : 'dji_fisheye_lut'
  };
}

function numbers(values: Array<number | null> | undefined, count: number): number[] {
  return Array.from({ length: count }, (_, index) => Number(values?.[index] ?? 0));
}

function rotate(q: number[], [x, y, z]: Vec3): Vec3 {
  const length = Math.hypot(...q);
  const [w, a, b, c] = q.map((value) => value / length);
  const dot = a*x + b*y + c*z;
  const scale = w*w - a*a - b*b - c*c;
  return [2*dot*a + scale*x + 2*w*(b*z-c*y), 2*dot*b + scale*y + 2*w*(c*x-a*z), 2*dot*c + scale*z + 2*w*(a*y-b*x)];
}

function djiRadialScale(lens: PanoramaLens): number {
  const a = lens.radialLut1;
  const b = lens.radialLut2;
  if (!a || !b || a.length < 14 || b.length < 14 || !lens.fx) return 1;
  let radius = 0;
  for (let index = 1; index < 14; index += 1) radius += Math.hypot(a[index] - lens.cx!, b[index] - lens.cy!);
  radius /= 13;
  const t = 85 * Math.PI / 180;
  const [k1, k2, k3, k4] = numbers(lens.radial ?? lens.distortion, 4);
  const polynomial = t + k1*t**3 + k2*t**5 + k3*t**7 + k4*t**9;
  const derivative = 1 + 3*k1*t**2 + 5*k2*t**4 + 7*k3*t**6 + 9*k4*t**8;
  const r90 = lens.fx * (polynomial + derivative * (Math.PI / 2 - t));
  return r90 > 0 ? radius / r90 : 1;
}
