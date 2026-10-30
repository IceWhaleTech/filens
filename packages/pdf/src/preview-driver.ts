/// <reference types="vite/client" />

import {
  PreviewPasswordError,
  createDefaultPreviewRoutes,
  classifyPreviewFont,
  type FormatDefinition,
  type PagedPreviewState,
  type PreviewDriver,
  type PreviewEventMap,
  type PreviewEventName,
  type PreviewLoadContext,
  type PreviewOptions,
  type PreviewFontDiagnostic,
  type PreviewSession,
  type PreviewSource
} from '@filens/core';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';

type PreviewListenerMap = {
  [K in PreviewEventName]: Set<(payload: PreviewEventMap[K]) => void>;
};

interface PageSlot {
  element: HTMLDivElement;
  width: number;
  height: number;
  page?: PDFPageProxy;
  canvas?: HTMLCanvasElement;
  task?: RenderTask;
}

export const PDF_FORMAT_ROUTES: FormatDefinition[] = [
  {
    extensions: ['pdf'],
    family: 'paged',
    driverId: 'pdf',
    targetFormat: 'pdf',
    contentTypes: ['application/pdf']
  }
];

export class PdfPreviewSession implements PreviewSession<PagedPreviewState> {
  private readonly listeners: PreviewListenerMap = {
    loading: new Set(),
    rendered: new Set(),
    error: new Set(),
    statechange: new Set(),
    warnings: new Set()
  };
  private readonly root: HTMLDivElement;
  private document: PDFDocumentProxy | null = null;
  private loadingTask: PDFDocumentLoadingTask | null = null;
  private pages: PageSlot[] = [];
  private loadGeneration = 0;
  private renderGeneration = 0;
  private rendering: Promise<void> | null = null;
  private renderAgain = false;
  private animationFrame: number | null = null;
  private resizeObserver?: ResizeObserver;
  private removeAbortListener?: () => void;
  private dimensions = '';
  private readonly virtual: boolean;
  private state: PagedPreviewState;
  private readonly inspectedFontPages = new Set<number>();
  private readonly fonts = new Map<string, PreviewFontDiagnostic>();

  constructor(private readonly host: HTMLElement, options: PreviewOptions = {}) {
    this.root = document.createElement('div');
    this.root.className = 'pdfv-preview';
    this.host.replaceChildren(this.root);
    this.virtual = options.virtual !== false;
    this.root.addEventListener('scroll', this.scheduleRender, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.document && this.dimensions !== this.rootDimensions()) this.relayout();
      });
      this.resizeObserver.observe(this.root);
    }
    this.state = {
      loading: false,
      error: null,
      family: 'paged',
      warnings: [],
      capabilities: {
        paged: true,
        zoom: true,
        fit: true,
        print: !this.virtual,
        download: true,
        fullscreen: true
      },
      pageIndex: 0,
      pageCount: 0,
      scale: options.initialScale ?? 1,
      fit: options.fit ?? 'contain'
    };
  }

  async load(source: PreviewSource, context: PreviewLoadContext): Promise<void> {
    const signal = context.signal;
    const generation = ++this.loadGeneration;
    this.removeAbortListener?.();
    const previous = this.releaseDocument();
    this.state = {
      ...this.state,
      loading: true,
      error: null,
      title: context.descriptor.name,
      warnings: [],
      pageIndex: 0,
      pageCount: 0
    };
    this.emit('loading', this.state);
    this.emit('statechange', this.state);

    const abort = () => {
      if (generation !== this.loadGeneration) return;
      this.loadGeneration++;
      void this.releaseDocument().catch(() => undefined);
      this.state.loading = false;
      this.state.pageIndex = this.state.pageCount = 0;
    };
    signal?.addEventListener('abort', abort, { once: true });
    this.removeAbortListener = () => signal?.removeEventListener('abort', abort);

    try {
      await previous;
      if (signal?.aborted) throw abortError();
      if (generation !== this.loadGeneration) return;
      const [input, pdfjs, { default: pdfWorkerUrl }] = await Promise.all([
        toPdfSource(source),
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url')
      ]);
      if (signal?.aborted) throw abortError();
      if (generation !== this.loadGeneration) return;
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      const task = pdfjs.getDocument({
        ...(typeof input === 'string' ? { url: input } : { data: input }),
        password: context.descriptor.password
      });
      this.loadingTask = task;
      const pdf = await task.promise;
      if (generation !== this.loadGeneration) return;

      this.document = pdf;
      this.state.pageCount = pdf.numPages;
      this.root.setAttribute('role', 'document');
      this.root.setAttribute('aria-label', context.descriptor.name ?? 'PDF preview');
      this.root.replaceChildren();
      const first = await pdf.getPage(1);
      if (generation !== this.loadGeneration) return;
      const viewport = first.getViewport({ scale: 1 });
      const fragment = document.createDocumentFragment();
      this.pages = Array.from({ length: pdf.numPages }, (_, index) => {
        const element = document.createElement('div');
        element.className = 'pdfv-page-slot';
        element.dataset.pageIndex = String(index);
        fragment.append(element);
        return { element, width: viewport.width, height: viewport.height, page: index === 0 ? first : undefined };
      });
      this.root.append(fragment);
      this.root.scrollTop = 0;
      this.layoutPages();
      await this.renderVisiblePages();
      if (generation !== this.loadGeneration) return;

      this.state.loading = false;
      this.state.error = null;
      this.emit('rendered', this.state);
      this.emit('statechange', this.state);
      if (this.virtual) this.scheduleRender();
    } catch (error) {
      if (signal?.aborted) {
        abort();
        throw abortError();
      }
      if (generation !== this.loadGeneration) return;
      const normalizedError = (error as { name?: string })?.name === 'PasswordException'
        ? new PreviewPasswordError((error as { code?: number }).code === 2 ? 'password_invalid' : 'password_required')
        : error instanceof Error ? error : new Error(String(error));
      this.state.loading = false;
      this.state.error = normalizedError.message;
      this.emit('error', normalizedError);
      this.emit('statechange', this.state);
      throw normalizedError;
    }
  }

  destroy(): void {
    this.loadGeneration += 1;
    this.removeAbortListener?.();
    this.root.removeEventListener('scroll', this.scheduleRender);
    this.resizeObserver?.disconnect();
    void this.releaseDocument().catch(() => undefined);
    if (this.root.parentElement === this.host) {
      this.host.replaceChildren();
    }
  }

  getState(): PagedPreviewState {
    return { ...this.state, fonts: this.state.fonts?.map(font => ({ ...font, classification: font.classification ? { ...font.classification } : undefined })), warnings: this.state.warnings.slice(), capabilities: { ...this.state.capabilities } };
  }

  goToPage(index: number): void {
    if (!Number.isFinite(index) || !this.pages.length) return;
    const next = Math.max(0, Math.min(this.pages.length - 1, Math.trunc(index)));
    this.state.pageIndex = next;
    this.root.scrollTop = this.pages[next].element.offsetTop;
    this.emit('statechange', this.getState());
    this.scheduleRender();
  }

  next(): void { this.goToPage(this.state.pageIndex + 1); }
  prev(): void { this.goToPage(this.state.pageIndex - 1); }

  setScale(scale: number): void {
    if (!Number.isFinite(scale) || scale <= 0 || scale === this.state.scale) return;
    this.state.scale = scale;
    this.relayout();
  }

  fit(mode: PagedPreviewState['fit'] = 'contain'): void {
    this.state.fit = mode;
    this.relayout();
  }

  fullscreen(): Promise<void> | undefined { return this.host.requestFullscreen?.(); }

  on<T extends PreviewEventName>(event: T, handler: (payload: PreviewEventMap[T]) => void): () => void {
    this.listeners[event].add(handler as never);
    return () => {
      this.listeners[event].delete(handler as never);
    };
  }

  private emit<T extends PreviewEventName>(event: T, payload: PreviewEventMap[T]): void {
    for (const handler of this.listeners[event]) {
      handler(payload as never);
    }
  }

  private pageScale(width: number, height: number, containerWidth = this.root.clientWidth, containerHeight = this.root.clientHeight): number {
    const widthScale = containerWidth > 0 ? containerWidth / width : 1;
    const heightScale = containerHeight > 0 ? containerHeight / height : 1;
    if (this.state.fit === 'width') return widthScale * this.state.scale;
    if (this.state.fit === 'height') return heightScale * this.state.scale;
    if (this.state.fit === 'contain') return Math.min(widthScale, heightScale, 1) * this.state.scale;
    return this.state.scale;
  }

  private rootDimensions(): string { return `${this.root.clientWidth}:${this.root.clientHeight}`; }

  private layoutPages(): void {
    // Read the viewport once before writing page sizes to avoid per-page layout flushes.
    const width = this.root.clientWidth, height = this.root.clientHeight;
    this.dimensions = `${width}:${height}`;
    for (const slot of this.pages) this.sizeSlot(slot, width, height);
  }

  private sizeSlot(slot: PageSlot, containerWidth?: number, containerHeight?: number): void {
    const scale = this.pageScale(slot.width, slot.height, containerWidth, containerHeight);
    slot.element.style.width = `${slot.width * scale}px`;
    slot.element.style.height = `${slot.height * scale}px`;
  }

  private relayout(): void {
    const anchor = this.pages[this.state.pageIndex];
    const offset = anchor ? this.root.scrollTop - anchor.element.offsetTop : 0;
    this.renderGeneration++;
    this.renderAgain = true;
    for (const slot of this.pages) this.clearCanvas(slot);
    this.layoutPages();
    if (anchor) this.root.scrollTop = anchor.element.offsetTop + offset;
    this.emit('statechange', this.getState());
    this.scheduleRender();
  }

  private readonly scheduleRender = () => {
    if (this.animationFrame !== null) return;
    this.animationFrame = requestAnimationFrame(() => {
      this.animationFrame = null;
      const generation = this.loadGeneration;
      void this.renderVisiblePages().catch(error => {
        if (generation !== this.loadGeneration) return;
        const normalized = error instanceof Error ? error : new Error(String(error));
        this.state.error = normalized.message;
        this.emit('error', normalized);
        this.emit('statechange', this.getState());
      });
    });
  };

  private visiblePages(): number[] {
    if (!this.virtual) return this.pages.map((_, index) => index);
    const viewport = this.root.getBoundingClientRect();
    if (!this.root.clientHeight) return this.pages.length ? [this.state.pageIndex] : [];
    // Finish the visible preview first; nearby pages can be prepared after loading settles.
    const margin = this.state.loading ? 0 : this.root.clientHeight / 2;
    const indices: number[] = [];
    let active = this.state.pageIndex, largestOverlap = -1;
    for (const [index, slot] of this.pages.entries()) {
      const rect = slot.element.getBoundingClientRect();
      if (rect.bottom > viewport.top - margin && rect.top < viewport.bottom + margin) indices.push(index);
      const overlap = Math.min(rect.bottom, viewport.bottom) - Math.max(rect.top, viewport.top);
      if (overlap > largestOverlap) { active = index; largestOverlap = overlap; }
    }
    if (active !== this.state.pageIndex) {
      this.state.pageIndex = active;
      this.emit('statechange', this.getState());
    }
    return indices;
  }

  private async renderVisiblePages(): Promise<void> {
    this.renderAgain = true;
    if (this.rendering) {
      const needed = new Set(this.visiblePages());
      for (const [index, slot] of this.pages.entries()) if (slot.task && !needed.has(index)) this.clearCanvas(slot);
      return this.rendering;
    }
    const generation = this.loadGeneration;
    const pdf = this.document;
    if (!pdf) return;
    const rendering = (async () => {
      do {
        this.renderAgain = false;
        const epoch = this.renderGeneration;
        const needed = new Set(this.visiblePages());
        for (const [index, slot] of this.pages.entries()) if (!needed.has(index)) this.clearCanvas(slot);
        for (const index of needed) {
          if (generation !== this.loadGeneration || epoch !== this.renderGeneration || this.renderAgain) break;
          await this.renderPage(pdf, index, generation, epoch);
        }
      } while (this.renderAgain && generation === this.loadGeneration);
    })();
    this.rendering = rendering;
    try { await rendering; }
    finally { if (this.rendering === rendering) this.rendering = null; }
  }

  private async renderPage(pdf: PDFDocumentProxy, index: number, generation: number, epoch: number): Promise<void> {
    const slot = this.pages[index];
    if (slot.canvas) return;
    const page = slot.page ?? await pdf.getPage(index + 1);
    if (generation !== this.loadGeneration || epoch !== this.renderGeneration) return;
    slot.page = page;
    const base = page.getViewport({ scale: 1 });
    if (slot.width !== base.width || slot.height !== base.height) {
      const anchor = this.pages[this.state.pageIndex]?.element;
      const anchorTop = anchor?.offsetTop ?? 0;
      slot.width = base.width; slot.height = base.height;
      this.sizeSlot(slot);
      if (anchor) this.root.scrollTop += anchor.offsetTop - anchorTop;
    }
    const scale = this.pageScale(base.width, base.height);
    const viewport = page.getViewport({ scale });
    const outputScale = window.devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    canvas.className = 'pdfv-page';
    canvas.dataset.pageIndex = String(index);
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `Page ${index + 1}`);
    canvas.width = Math.ceil(viewport.width * outputScale);
    canvas.height = Math.ceil(viewport.height * outputScale);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    slot.canvas = canvas;
    slot.element.append(canvas);
    const task = page.render({ canvas, viewport: page.getViewport({ scale: scale * outputScale }), background: '#ffffff' });
    slot.task = task;
    try {
      await task.promise;
      if (slot.canvas === canvas) {
        canvas.dataset.rendered = 'true';
        void this.inspectPageFonts(page, index, generation);
      }
    } catch (error) {
      if (slot.canvas === canvas) this.clearCanvas(slot);
      if (generation === this.loadGeneration && epoch === this.renderGeneration && (error as Error)?.name !== 'RenderingCancelledException') throw error;
    } finally { if (slot.task === task) slot.task = undefined; }
  }

  private clearCanvas(slot: PageSlot): void {
    slot.task?.cancel();
    slot.task = undefined;
    if (slot.canvas) {
      slot.canvas.width = slot.canvas.height = 0;
      slot.canvas.remove();
      slot.canvas = undefined;
    }
  }

  private async inspectPageFonts(page: PDFPageProxy, index: number, generation: number): Promise<void> {
    if (generation !== this.loadGeneration || this.inspectedFontPages.has(index)) return;
    this.inspectedFontPages.add(index);
    try {
      const text = await page.getTextContent?.();
      if (!text || generation !== this.loadGeneration) return;
      let changed = false;
      for (const [fontId, style] of Object.entries(text.styles)) {
        if (this.fonts.has(fontId)) continue;
        // Public PDF.js text styles identify renderer CSS families, not original
        // BaseFont names, embedded provenance, or the actual font used per glyph.
        this.fonts.set(fontId, {
          fontId, fontFamily: style.fontFamily, status: 'unknown', source: 'unknown',
          classification: classifyPreviewFont(style.fontFamily)
        });
        changed = true;
      }
      if (changed) {
        this.state.fonts = [...this.fonts.values()];
        this.emit('statechange', this.getState());
      }
    } catch {
      // Optional diagnostics must not fail a page whose canvas already rendered.
      if (generation !== this.loadGeneration) return;
      const warning = `Font metadata is unavailable for PDF page ${index + 1}.`;
      this.state.warnings = [...new Set([...this.state.warnings, warning])];
      this.emit('warnings', this.state.warnings);
      this.emit('statechange', this.getState());
    }
  }

  private releaseDocument(): Promise<void> {
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.renderGeneration++;
    for (const slot of this.pages) this.clearCanvas(slot);
    this.pages = [];
    this.inspectedFontPages.clear();
    this.fonts.clear();
    this.state.fonts = [];
    this.rendering = null;
    this.renderAgain = false;
    this.root.replaceChildren();
    const task = this.loadingTask, pdf = this.document;
    this.loadingTask = null;
    this.document = null;
    return task ? task.destroy() : pdf?.destroy() ?? Promise.resolve();
  }
}

function abortError(): DOMException { return new DOMException('PDF loading was aborted.', 'AbortError'); }

export function createPdfPreviewDriver(): PreviewDriver<PagedPreviewState> {
  return {
    id: 'pdf',
    family: 'paged',
    supports: (format) => normalizeFormat(format) === 'pdf',
    createSession: (host, options) => new PdfPreviewSession(host, options)
  };
}

export function createPdfPreviewRoutes(baseRoutes = createDefaultPreviewRoutes()): FormatDefinition[] {
  return [
    ...PDF_FORMAT_ROUTES,
    ...baseRoutes.filter((route) => !route.extensions.includes('pdf'))
  ];
}

function normalizeFormat(format: string): string {
  return format.trim().replace(/^\./, '').toLowerCase();
}

async function toPdfSource(source: PreviewSource): Promise<string | Uint8Array> {
  if (typeof source === 'string') return source;
  if (source instanceof Blob) return new Uint8Array(await source.arrayBuffer());
  if (ArrayBuffer.isView(source)) {
    const bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy;
  }
  return new Uint8Array(source.slice(0));
}
