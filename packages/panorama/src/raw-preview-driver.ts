import {
  createImagePreviewDriver,
  type ConverterClient,
  type FormatDefinition,
  type PreviewDriver,
  type PreviewEventMap,
  type PreviewEventName,
  type PreviewItemState,
  type PreviewLoadContext,
  type PreviewOptions,
  type PreviewSession,
  type PreviewSource
} from '@filens/core';
import { PanoramaPreviewSession } from './preview-driver';
import { createImageStitchCalibration } from './static-renderer';
import type { PanoramaProcessor } from './wasm-processor';

export const RAW_IMAGE_FORMAT_ROUTES: FormatDefinition[] = [{
  extensions: ['dng'], family: 'image', driverId: 'raw-image', targetFormat: 'jpg',
  contentTypes: ['image/dng', 'image/x-adobe-dng']
}];

export interface RawImagePreviewDriverOptions {
  processor?: PanoramaProcessor;
  converter: ConverterClient;
}

/** Inspect before conversion so vendor lens metadata survives RAW development. */
export function createRawImagePreviewDriver(options: RawImagePreviewDriverOptions): PreviewDriver {
  return {
    id: 'raw-image', family: 'image', supports: (format) => format.replace(/^\./, '').toLowerCase() === 'dng',
    createSession: (host, previewOptions) => new RawImagePreviewSession(host, previewOptions ?? {}, options)
  };
}

class RawImagePreviewSession implements PreviewSession {
  private child?: PreviewSession;
  private controller?: AbortController;
  private state: PreviewItemState = { family: 'image', loading: false, error: null, warnings: [], capabilities: {} };
  private readonly listeners = new Map<PreviewEventName, Set<(payload: never) => void>>();
  private unsubscribes: Array<() => void> = [];

  constructor(private host: HTMLElement, private options: PreviewOptions, private dependencies: RawImagePreviewDriverOptions) {}

  async load(source: PreviewSource, context: PreviewLoadContext): Promise<void> {
    this.destroy();
    this.controller = new AbortController();
    const controller = this.controller;
    const signal = controller.signal;
    if (context.signal) {
      const abort = () => controller.abort(context.signal!.reason);
      if (context.signal.aborted) abort();
      else {
        context.signal.addEventListener('abort', abort, { once: true });
        this.unsubscribes.push(() => context.signal!.removeEventListener('abort', abort));
      }
    }
    const loadContext = { ...context, signal };
    this.state = { ...this.state, loading: true, error: null, title: context.descriptor.name, warnings: [] };
    this.emit('loading', this.state);
    this.emit('statechange', this.state);
    const processor = this.dependencies.processor;
    try {
      signal.throwIfAborted();
      const manifest = processor ? await processor.open(source, { format: 'dng', signal }) : undefined;
      signal.throwIfAborted();
      if (manifest && createImageStitchCalibration(manifest)) {
        if (!processor?.decodeImage) throw new Error('Calibrated DNG preview requires a panorama processor with WASM image decoding.');
        const preview = await processor.decodeImage(signal);
        signal.throwIfAborted();
        processor.close();
        const child = new PanoramaPreviewSession(this.host, this.options);
        this.attach(child);
        await child.loadCalibratedImage(preview, manifest, loadContext);
      } else {
        processor?.close();
        const preview = await this.dependencies.converter.convert({
          source, sourceFormat: 'dng', targetFormat: 'jpg', name: context.descriptor.name
        }, loadContext);
        signal.throwIfAborted();
        const warnings = [...(manifest?.warnings ?? []), ...(preview.warnings ?? [])];
        this.state.warnings = warnings;
        if (warnings.length) this.emit('warnings', warnings);
        const child = createImagePreviewDriver().createSession(this.host, this.options);
        this.attach(child, warnings);
        await child.load(preview.source, {
          ...loadContext,
          descriptor: { ...context.descriptor, source: preview.source, extension: preview.format, contentType: preview.contentType },
          route: { family: 'image', driverId: 'image', sourceFormat: preview.format, targetFormat: preview.format }
        });
      }
    } catch (error) {
      if (signal.aborted) throw error;
      processor?.close();
      this.unsubscribes.splice(0).forEach((unsubscribe) => unsubscribe());
      this.child?.destroy();
      this.child = undefined;
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.state = { ...this.state, loading: false, error: normalized.message };
      this.emit('error', normalized);
      this.emit('statechange', this.state);
      throw normalized;
    }
  }

  private attach(child: PreviewSession, warnings: string[] = []): void {
    this.child = child;
    for (const event of ['loading', 'rendered', 'error', 'statechange', 'warnings'] as const) {
      this.unsubscribes.push(child.on(event, (payload) => {
        if (event === 'loading' || event === 'rendered' || event === 'statechange') {
          this.state = { ...(payload as PreviewItemState), warnings: [...new Set([...warnings, ...(payload as PreviewItemState).warnings])] };
          this.emit(event, this.state);
        } else this.emit(event, payload as never);
      }));
    }
  }

  getState(): PreviewItemState { return this.state; }
  on<T extends PreviewEventName>(event: T, handler: (payload: PreviewEventMap[T]) => void): () => void {
    const handlers = this.listeners.get(event) ?? new Set();
    this.listeners.set(event, handlers);
    handlers.add(handler as (payload: never) => void);
    return () => handlers.delete(handler as (payload: never) => void);
  }
  private emit<T extends PreviewEventName>(event: T, payload: PreviewEventMap[T]): void {
    this.listeners.get(event)?.forEach((handler) => handler(payload as never));
  }
  setScale(scale: number): void { this.child?.setScale?.(scale); }
  fit(mode?: PreviewOptions['fit']): void { this.child?.fit?.(mode); }
  rotate(degrees?: number): void { this.child?.rotate?.(degrees); }
  pan(x: number, y: number): void { this.child?.pan?.(x, y); }
  async fullscreen(): Promise<void> { await this.child?.fullscreen?.(); }
  destroy(): void {
    this.controller?.abort();
    this.unsubscribes.splice(0).forEach((unsubscribe) => unsubscribe());
    this.child?.destroy();
    this.child = undefined;
    this.dependencies.processor?.close();
  }
}
