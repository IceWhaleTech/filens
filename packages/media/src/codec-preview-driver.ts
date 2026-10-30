import {
  createImagePreviewDriver, createMediaPreviewDriver,
  type ConverterClient, type FormatDefinition, type PreviewDriver, type PreviewEventMap,
  type PreviewEventName, type PreviewItemState, type PreviewLoadContext,
  type PreviewOptions, type PreviewSession, type PreviewSource
} from '@filens/core';
import { createMediaConverterClient } from '@filens/converter-client';

export const HEIF_PREVIEW_ROUTES: FormatDefinition[] = [{
  extensions: ['heic', 'heif'], family: 'image', driverId: 'heif-image',
  contentTypes: ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'], group: 'image'
}];

export function createCodecPreviewDrivers(converter: ConverterClient = createMediaConverterClient()): PreviewDriver[] {
  return [{
    id: 'heif-image', family: 'image', supports: format => ['heic', 'heif'].includes(format.replace(/^\./, '').toLowerCase()),
    createSession: (host, options) => new CodecPreviewSession(host, options ?? {}, converter, true)
  }, {
    ...createMediaPreviewDriver(),
    createSession: (host, options) => new CodecPreviewSession(host, options ?? {}, converter, false)
  }];
}

/** Keep the native controls and image tools while supplying browser-safe media. */
class CodecPreviewSession implements PreviewSession {
  private child?: PreviewSession;
  private controller?: AbortController;
  private removeAbort?: () => void;
  private childListeners: Array<() => void> = [];
  private listeners = new Map<PreviewEventName, Set<(payload: never) => void>>();
  private state: PreviewItemState;

  constructor(private host: HTMLElement, private options: PreviewOptions, private converter: ConverterClient, private image: boolean) {
    this.state = { family: image ? 'image' : 'video', loading: false, error: null, warnings: [], capabilities: {} };
  }

  async load(source: PreviewSource, context: PreviewLoadContext): Promise<void> {
    this.destroy();
    const controller = this.controller = new AbortController();
    const signal = controller.signal;
    const abort = () => controller.abort();
    context.signal?.addEventListener('abort', abort, { once: true });
    this.removeAbort = () => context.signal?.removeEventListener('abort', abort);
    signal.addEventListener('abort', () => {
      if (this.controller !== controller) return;
      this.releaseChild();
      this.state = { ...this.state, loading: false, error: null };
      this.emit('statechange', this.state);
    }, { once: true });
    this.state = { ...this.state, loading: true, error: null, title: context.descriptor.name, warnings: [] };
    this.emit('loading', this.state);
    this.emit('statechange', this.state);
    if (context.signal?.aborted) controller.abort();
    if (signal.aborted) return;
    const loadContext = { ...context, signal };
    if (this.image) await this.convert(source, loadContext, controller);
    else await this.open(source, loadContext, controller,
      (context.route?.sourceFormat ?? context.descriptor.extension)?.toLowerCase() === 'mov'
        ? () => { void this.convert(source, loadContext, controller); } : undefined);
  }

  private async convert(source: PreviewSource, context: PreviewLoadContext, controller: AbortController): Promise<void> {
    if (controller.signal.aborted || this.controller !== controller) return;
    this.releaseChild();
    this.state = { ...this.state, loading: true, error: null };
    this.emit('loading', this.state);
    this.emit('statechange', this.state);
    try {
      const result = await this.converter.convert({ source,
        sourceFormat: context.route?.sourceFormat ?? context.descriptor.extension ?? (this.image ? 'heic' : 'mov'),
        targetFormat: this.image ? 'png' : 'mp4', name: context.descriptor.name }, context);
      if (controller.signal.aborted || this.controller !== controller) return;
      await this.open(result.source, { ...context,
        descriptor: { ...context.descriptor, source: result.source, extension: result.format, contentType: result.contentType },
        route: { family: this.image ? 'image' : 'video', driverId: this.image ? 'image' : 'media', sourceFormat: result.format, targetFormat: result.format }
      }, controller);
    } catch (error) { this.fail(error, controller); }
  }

  private async open(source: PreviewSource, context: PreviewLoadContext, controller: AbortController, fallback?: () => void): Promise<void> {
    if (controller.signal.aborted || this.controller !== controller) return;
    const child = (this.image ? createImagePreviewDriver() : createMediaPreviewDriver()).createSession(this.host, this.options);
    this.child = child;
    const active = () => this.child === child && this.controller === controller && !controller.signal.aborted;
    for (const event of ['loading', 'rendered', 'statechange', 'error', 'warnings'] as const) {
      this.childListeners.push(child.on(event, payload => {
        if (!active()) return;
        if (event === 'error' && fallback) { fallback(); return; }
        if (event === 'loading' || event === 'rendered' || event === 'statechange') {
          this.state = payload as PreviewItemState;
          this.emit(event, this.state);
        } else this.emit(event, payload as never);
      }));
    }
    try { await child.load(source, context); }
    catch (error) { if (active()) this.fail(error, controller); }
  }

  private fail(error: unknown, controller: AbortController): void {
    if (controller.signal.aborted || this.controller !== controller) return;
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.state = { ...this.state, loading: false, error: normalized.message };
    this.emit('error', normalized);
    this.emit('statechange', this.state);
  }
  getState(): PreviewItemState { return this.state; }
  on<T extends PreviewEventName>(event: T, handler: (payload: PreviewEventMap[T]) => void): () => void {
    const handlers = this.listeners.get(event) ?? new Set();
    this.listeners.set(event, handlers);
    handlers.add(handler as (payload: never) => void);
    return () => handlers.delete(handler as (payload: never) => void);
  }
  private emit<T extends PreviewEventName>(event: T, payload: PreviewEventMap[T]): void {
    this.listeners.get(event)?.forEach(handler => handler(payload as never));
  }
  setScale(scale: number): void { this.child?.setScale?.(scale); }
  fit(mode?: PreviewOptions['fit']): void { this.child?.fit?.(mode); }
  rotate(degrees?: number): void { this.child?.rotate?.(degrees); }
  pan(x: number, y: number): void { this.child?.pan?.(x, y); }
  async fullscreen(): Promise<void> { await this.child?.fullscreen?.(); }
  destroy(): void {
    const controller = this.controller;
    this.controller = undefined;
    controller?.abort();
    this.removeAbort?.();
    this.removeAbort = undefined;
    this.releaseChild();
    this.state = { ...this.state, loading: false };
  }
  private releaseChild(): void {
    this.childListeners.splice(0).forEach(unsubscribe => unsubscribe());
    this.child?.destroy();
    this.child = undefined;
  }
}
