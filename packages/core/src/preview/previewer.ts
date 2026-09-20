import { DEFAULT_FORMAT_ROUTES, inferExtensionFromName, type FormatDefinition } from './formats';
import { createDefaultNativePreviewDrivers } from './native-drivers';
import { createPptxPreviewDriver } from './pptx-driver';
import { createPreviewRegistry, type PreviewRegistry } from './registry';
import type {
  ConverterClient,
  FormatRoute,
  PreviewDriver,
  PreviewEventMap,
  PreviewEventName,
  PreviewItemState,
  PreviewLoadContext,
  PreviewOptions,
  PreviewerInstance,
  PreviewSession,
  PreviewSource,
  SourceDescriptor
} from './types';

type PreviewerListenerMap = {
  [K in PreviewEventName]: Set<(payload: PreviewEventMap[K]) => void>;
};

export interface CreatePreviewerOptions extends PreviewOptions {
  drivers?: PreviewDriver[];
  routes?: FormatDefinition[];
  registry?: PreviewRegistry;
  converter?: ConverterClient;
}

export class Previewer implements PreviewerInstance {
  private readonly registry: PreviewRegistry;
  private readonly converter?: ConverterClient;
  private readonly previewOptions: PreviewOptions;
  private readonly listeners: PreviewerListenerMap = {
    loading: new Set(),
    rendered: new Set(),
    error: new Set(),
    statechange: new Set(),
    warnings: new Set()
  };

  private activeSession: PreviewSession | null = null;
  private activeUnsubscribes: Array<() => void> = [];
  private activeAbortController: AbortController | null = null;
  private requestToken = 0;
  private state: PreviewItemState = createIdleState();

  constructor(private readonly host: HTMLElement, options: CreatePreviewerOptions = {}) {
    this.registry =
      options.registry ??
      createPreviewRegistry({
        drivers: options.drivers ?? createDefaultPreviewDrivers(),
        routes: options.routes
      });
    this.converter = options.converter;
    this.previewOptions = {
      fit: options.fit,
      initialScale: options.initialScale,
      minScale: options.minScale,
      maxScale: options.maxScale,
      virtual: options.virtual,
      fontResolver: options.fontResolver,
      resourceResolver: options.resourceResolver
    };
  }

  async preview(source: PreviewSource | SourceDescriptor, descriptor: Partial<SourceDescriptor> = {}): Promise<void> {
    const token = ++this.requestToken;
    this.activeAbortController?.abort();
    this.activeAbortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
    this.clearSession();

    const initialDescriptor = normalizeSourceDescriptor(source, descriptor);
    this.setState({
      ...createIdleState(),
      loading: true
    });
    this.emit('loading', this.state);

    try {
      const resolved = await this.resolveLoadTarget(initialDescriptor, token);
      if (token !== this.requestToken || !resolved) {
        return;
      }

      const session = resolved.driver.createSession(this.host, this.previewOptions);
      this.bindSession(session);
      this.activeSession = session;

      await session.load(resolved.descriptor.source, {
        descriptor: resolved.descriptor,
        route: resolved.route,
        signal: this.activeAbortController?.signal
      });

      if (token !== this.requestToken) {
        return;
      }

      this.setState(session.getState());
    } catch (error) {
      if (token !== this.requestToken || isAbortError(error)) {
        return;
      }
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      this.setState({
        ...this.state,
        loading: false,
        error: normalizedError.message
      });
      this.emit('error', normalizedError);
    } finally {
      if (token === this.requestToken) {
        this.activeAbortController = null;
      }
    }
  }

  destroy(): void {
    this.requestToken += 1;
    this.activeAbortController?.abort();
    this.activeAbortController = null;
    this.clearSession();
    this.setState(createIdleState());
  }

  getState(): PreviewItemState {
    return this.activeSession?.getState() ?? this.state;
  }

  on<T extends PreviewEventName>(event: T, handler: (payload: PreviewEventMap[T]) => void): () => void {
    this.listeners[event].add(handler as never);
    return () => {
      this.listeners[event].delete(handler as never);
    };
  }

  setScale(scale: number): void {
    this.activeSession?.setScale?.(scale);
  }

  fit(mode?: PreviewOptions['fit']): void {
    this.activeSession?.fit?.(mode);
  }

  rotate(degrees = 90): void {
    this.activeSession?.rotate?.(degrees);
  }

  pan(deltaX: number, deltaY: number): void {
    this.activeSession?.pan?.(deltaX, deltaY);
  }

  async fullscreen(): Promise<void> {
    await this.activeSession?.fullscreen?.();
  }

  goToPage(index: number): void {
    this.activeSession?.goToPage?.(index);
  }

  next(): void {
    this.activeSession?.next?.();
  }

  prev(): void {
    this.activeSession?.prev?.();
  }

  setActiveLayers(layerIds: string[]): void {
    this.activeSession?.setActiveLayers?.(layerIds);
  }

  toggleLayer(layerId: string, active?: boolean): void {
    this.activeSession?.toggleLayer?.(layerId, active);
  }

  selectNode(nodeId?: string): void {
    this.activeSession?.selectNode?.(nodeId);
  }

  setNodeVisibility(nodeId: string, visible: boolean): void {
    this.activeSession?.setNodeVisibility?.(nodeId, visible);
  }

  toggleNodeVisibility(nodeId: string, visible?: boolean): void {
    this.activeSession?.toggleNodeVisibility?.(nodeId, visible);
  }

  setExplode(amount: number): void {
    this.activeSession?.setExplode?.(amount);
  }

  setActiveMaterial(materialKey?: string): void {
    this.activeSession?.setActiveMaterial?.(materialKey);
  }

  setMeasurementActive(active: boolean): void {
    this.activeSession?.setMeasurementActive?.(active);
  }

  clearMeasurement(): void {
    this.activeSession?.clearMeasurement?.();
  }

  setMeasurementSnapMode(mode: 'surface' | 'vertex'): void {
    this.activeSession?.setMeasurementSnapMode?.(mode);
  }

  setMeasurementAxisLock(axis: 'free' | 'x' | 'y' | 'z'): void {
    this.activeSession?.setMeasurementAxisLock?.(axis);
  }

  setSectionActive(active: boolean): void {
    this.activeSession?.setSectionActive?.(active);
  }

  setSectionMode(mode: 'single' | 'box'): void {
    this.activeSession?.setSectionMode?.(mode);
  }

  setSectionAxis(axis: 'x' | 'y' | 'z'): void {
    this.activeSession?.setSectionAxis?.(axis);
  }

  setSectionOffset(offset: number): void {
    this.activeSession?.setSectionOffset?.(offset);
  }

  setSectionRange(axis: 'x' | 'y' | 'z', min: number, max: number): void {
    this.activeSession?.setSectionRange?.(axis, min, max);
  }

  clearSection(): void {
    this.activeSession?.clearSection?.();
  }

  setCameraProjection(projection: 'perspective' | 'orthographic'): void {
    this.activeSession?.setCameraProjection?.(projection);
  }

  setCameraViewPreset(preset: 'free' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'isometric'): void {
    this.activeSession?.setCameraViewPreset?.(preset);
  }

  setDisplayMode(mode: 'shaded' | 'solid-edge' | 'wireframe' | 'xray'): void {
    this.activeSession?.setDisplayMode?.(mode);
  }

  setSnapshotBackground(background: 'scene' | 'white' | 'transparent'): void {
    this.activeSession?.setSnapshotBackground?.(background);
  }

  downloadSnapshot(filename?: string, background?: 'scene' | 'white' | 'transparent'): void {
    this.activeSession?.downloadSnapshot?.(filename, background);
  }

  private async resolveLoadTarget(
    descriptor: SourceDescriptor,
    token: number
  ): Promise<{ descriptor: SourceDescriptor; driver: PreviewDriver; route: FormatRoute } | null> {
    const resolved = this.registry.resolve(descriptor);
    if (!resolved) {
      throw new Error(`Unsupported preview format${formatDescriptorLabel(descriptor)}.`);
    }

    if (!resolved.route.conversion?.required) {
      if (!resolved.driver) {
        throw new Error(`No preview driver registered for ${resolved.route.driverId} (${formatRouteLabel(resolved.route)}).`);
      }
      return {
        descriptor,
        driver: resolved.driver,
        route: resolved.route
      };
    }

    if (!this.converter) {
      throw new Error(
        `No converter is configured for ${formatRouteLabel(resolved.route)}${formatConversionReason(resolved.route)}.`
      );
    }

    const context: PreviewLoadContext = {
      descriptor,
      route: resolved.route,
      signal: this.activeAbortController?.signal
    };
    const conversion = await this.converter.convert(
      {
        source: descriptor.source,
        sourceFormat: resolved.route.sourceFormat,
        targetFormat: resolved.route.targetFormat,
        name: descriptor.name
      },
      context
    );
    if (token !== this.requestToken) {
      return null;
    }

    const convertedDescriptor = normalizeSourceDescriptor(conversion.source, {
      name: descriptor.name,
      extension: conversion.format,
      contentType: conversion.contentType
    });
    const convertedResolved = this.registry.resolve(convertedDescriptor);
    if (!convertedResolved?.driver) {
      throw new Error(
        `No preview driver registered for converted ${conversion.format} output (${formatRouteLabel(resolved.route)}; expected driver ${resolved.route.driverId}).`
      );
    }

    if (conversion.warnings?.length) {
      this.emit('warnings', conversion.warnings);
    }

    return {
      descriptor: convertedDescriptor,
      driver: convertedResolved.driver,
      route: convertedResolved.route
    };
  }

  private bindSession(session: PreviewSession): void {
    this.activeUnsubscribes = [
      session.on('loading', (state) => this.setStateAndEmit('loading', state)),
      session.on('rendered', (state) => this.setStateAndEmit('rendered', state)),
      session.on('statechange', (state) => this.setStateAndEmit('statechange', state)),
      session.on('warnings', (warnings) => this.emit('warnings', warnings)),
      session.on('error', (error) => {
        this.setState({
          ...this.getState(),
          loading: false,
          error: error.message
        });
        this.emit('error', error);
      })
    ];
  }

  private setStateAndEmit<T extends Extract<PreviewEventName, 'loading' | 'rendered' | 'statechange'>>(
    event: T,
    state: PreviewItemState
  ): void {
    this.setState(state);
    this.emit(event, state);
  }

  private setState(state: PreviewItemState): void {
    this.state = state;
  }

  private clearSession(): void {
    for (const unsubscribe of this.activeUnsubscribes) {
      unsubscribe();
    }
    this.activeUnsubscribes = [];
    this.activeSession?.destroy();
    this.activeSession = null;
  }

  private emit<T extends PreviewEventName>(event: T, payload: PreviewEventMap[T]): void {
    for (const handler of this.listeners[event]) {
      handler(payload as never);
    }
  }
}

export function createPreviewer(host: HTMLElement, options?: CreatePreviewerOptions): PreviewerInstance {
  return new Previewer(host, options);
}

export function createDefaultPreviewDrivers(): PreviewDriver[] {
  return [createPptxPreviewDriver(), ...createDefaultNativePreviewDrivers()];
}

export function createDefaultPreviewRoutes(extraRoutes: FormatDefinition[] = []): FormatDefinition[] {
  return [...extraRoutes, ...DEFAULT_FORMAT_ROUTES];
}

export function normalizeSourceDescriptor(
  source: PreviewSource | SourceDescriptor,
  descriptor: Partial<SourceDescriptor> = {}
): SourceDescriptor {
  if (isSourceDescriptor(source)) {
    const name = descriptor.name ?? source.name;
    return {
      ...source,
      ...descriptor,
      name,
      extension: descriptor.extension ?? source.extension ?? inferExtensionFromName(name),
      contentType: descriptor.contentType ?? source.contentType,
      size: descriptor.size ?? source.size
    };
  }

  const name = descriptor.name ?? inferSourceName(source);
  return {
    source,
    ...descriptor,
    name,
    extension: descriptor.extension ?? inferExtensionFromName(name),
    contentType: descriptor.contentType,
    size: descriptor.size ?? inferSourceSize(source)
  };
}

function createIdleState(): PreviewItemState {
  return {
    loading: false,
    error: null,
    family: 'unsupported',
    warnings: [],
    capabilities: {}
  };
}

function isSourceDescriptor(source: PreviewSource | SourceDescriptor): source is SourceDescriptor {
  return Boolean(source && typeof source === 'object' && 'source' in source);
}

function inferSourceName(source: PreviewSource): string | undefined {
  if (typeof source === 'string') {
    return source;
  }
  if (typeof File !== 'undefined' && source instanceof File) {
    return source.name;
  }
  return undefined;
}

function inferSourceSize(source: PreviewSource): number | undefined {
  if (source instanceof ArrayBuffer) {
    return source.byteLength;
  }
  if (source instanceof Uint8Array) {
    return source.byteLength;
  }
  if (typeof Blob !== 'undefined' && source instanceof Blob) {
    return source.size;
  }
  return undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function formatDescriptorLabel(descriptor: SourceDescriptor): string {
  const extension = descriptor.extension ? `.${descriptor.extension}` : undefined;
  const contentType = descriptor.contentType;
  const name = descriptor.name;
  const parts = [name, extension, contentType].filter(Boolean);
  return parts.length ? ` for ${parts.join(' / ')}` : '';
}

function formatRouteLabel(route: FormatRoute): string {
  return `${route.sourceFormat} -> ${route.targetFormat}, family ${route.family}, driver ${route.driverId}`;
}

function formatConversionReason(route: FormatRoute): string {
  return route.conversion?.reason ? `: ${route.conversion.reason}` : '';
}
