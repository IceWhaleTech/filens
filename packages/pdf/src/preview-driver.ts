/// <reference types="vite/client" />

import {
  createDefaultPreviewRoutes,
  type FormatDefinition,
  type PagedPreviewState,
  type PreviewDriver,
  type PreviewEventMap,
  type PreviewEventName,
  type PreviewLoadContext,
  type PreviewOptions,
  type PreviewSession,
  type PreviewSource
} from '@filens/core';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type PreviewListenerMap = {
  [K in PreviewEventName]: Set<(payload: PreviewEventMap[K]) => void>;
};

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
  private loadGeneration = 0;
  private state: PagedPreviewState;

  constructor(private readonly host: HTMLElement, options: PreviewOptions = {}) {
    this.root = document.createElement('div');
    this.root.className = 'pdfv-preview';
    this.host.replaceChildren(this.root);
    this.state = {
      loading: false,
      error: null,
      family: 'paged',
      warnings: [],
      capabilities: {
        paged: true,
        print: true,
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
    this.state = {
      ...this.state,
      loading: true,
      error: null,
      title: context.descriptor.name
    };
    this.emit('loading', this.state);
    this.emit('statechange', this.state);
    const generation = ++this.loadGeneration;

    try {
      await this.document?.destroy();
      this.document = null;
      const pdf = await getDocument(await toPdfSource(source)).promise;
      if (generation !== this.loadGeneration) {
        await pdf.destroy();
        return;
      }

      this.document = pdf;
      this.state.pageCount = pdf.numPages;
      this.root.setAttribute('role', 'document');
      this.root.setAttribute('aria-label', context.descriptor.name ?? 'PDF preview');
      this.root.replaceChildren();
      // ponytail: render eagerly; virtualize only when large PDFs become a measured problem.
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        if (generation !== this.loadGeneration) return;
        const page = await pdf.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: this.pageScale(baseViewport.width, baseViewport.height) });
        const outputScale = window.devicePixelRatio || 1;
        const canvas = document.createElement('canvas');
        canvas.className = 'pdfv-page';
        canvas.dataset.pageIndex = String(pageNumber - 1);
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `Page ${pageNumber}`);
        canvas.width = Math.ceil(viewport.width * outputScale);
        canvas.height = Math.ceil(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        this.root.append(canvas);
        await page.render({
          canvas,
          viewport: page.getViewport({ scale: viewport.scale * outputScale }),
          background: '#ffffff'
        }).promise;
      }

      this.state.loading = false;
      this.state.error = null;
      this.emit('rendered', this.state);
      this.emit('statechange', this.state);
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      this.state.loading = false;
      this.state.error = normalizedError.message;
      this.emit('error', normalizedError);
      this.emit('statechange', this.state);
      throw normalizedError;
    }
  }

  destroy(): void {
    this.loadGeneration += 1;
    void this.document?.destroy();
    this.document = null;
    this.root.replaceChildren();
    if (this.root.parentElement === this.host) {
      this.host.replaceChildren();
    }
  }

  getState(): PagedPreviewState {
    return this.state;
  }

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

  private pageScale(width: number, height: number): number {
    const widthScale = this.root.clientWidth > 0 ? this.root.clientWidth / width : 1;
    const heightScale = this.root.clientHeight > 0 ? this.root.clientHeight / height : 1;
    if (this.state.fit === 'width') return widthScale * this.state.scale;
    if (this.state.fit === 'height') return heightScale * this.state.scale;
    if (this.state.fit === 'contain') return Math.min(widthScale, heightScale, 1) * this.state.scale;
    return this.state.scale;
  }
}

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
