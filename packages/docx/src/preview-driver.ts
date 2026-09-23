import { renderAsync } from 'docx-preview';
import {
  createDefaultPreviewRoutes,
  type FlowPreviewState,
  type FormatDefinition,
  type PreviewDriver,
  type PreviewEventMap,
  type PreviewEventName,
  type PreviewLoadContext,
  type PreviewOptions,
  type PreviewSession,
  type PreviewSource
} from '@filens/core';

type PreviewListenerMap = {
  [K in PreviewEventName]: Set<(payload: PreviewEventMap[K]) => void>;
};

export const DOCX_FORMAT_ROUTES: FormatDefinition[] = [
  {
    extensions: ['docx'],
    family: 'flow',
    driverId: 'docx',
    targetFormat: 'docx'
  }
];

export class DocxPreviewSession implements PreviewSession<FlowPreviewState> {
  private readonly listeners: PreviewListenerMap = {
    loading: new Set(),
    rendered: new Set(),
    error: new Set(),
    statechange: new Set(),
    warnings: new Set()
  };
  private readonly root: HTMLDivElement;
  private readonly documentHost: HTMLDivElement;
  private state: FlowPreviewState;

  constructor(private readonly host: HTMLElement, options: PreviewOptions = {}) {
    this.root = document.createElement('div');
    this.root.className = 'docxv-preview';
    this.documentHost = document.createElement('div');
    this.documentHost.className = 'docxv-document';
    this.root.replaceChildren(this.documentHost);
    this.host.replaceChildren(this.root);
    this.state = {
      loading: false,
      error: null,
      family: 'flow',
      warnings: [],
      capabilities: {
        search: true,
        print: true,
        download: true
      },
      scale: options.initialScale ?? 1,
      scrollTop: 0
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

    try {
      const blob = await sourceToBlob(source, context);
      this.documentHost.replaceChildren();
      await renderAsync(blob, this.documentHost, undefined, {
        breakPages: true,
        ignoreLastRenderedPageBreak: false,
        className: 'docx'
      });
      this.state.loading = false;
      this.state.error = null;
      this.emit('rendered', this.state);
      this.emit('statechange', this.state);
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      this.state.loading = false;
      this.state.error = normalizedError.message;
      this.emit('error', normalizedError);
      this.emit('statechange', this.state);
      throw normalizedError;
    }
  }

  destroy(): void {
    this.documentHost.replaceChildren();
    this.root.replaceChildren();
    if (this.root.parentElement === this.host) {
      this.host.replaceChildren();
    }
  }

  getState(): FlowPreviewState {
    return {
      ...this.state,
      scrollTop: this.root.scrollTop
    };
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
}

export function createDocxPreviewDriver(): PreviewDriver<FlowPreviewState> {
  return {
    id: 'docx',
    family: 'flow',
    supports: (format) => normalizeFormat(format) === 'docx',
    createSession: (host, options) => new DocxPreviewSession(host, options)
  };
}

export function createDocxPreviewRoutes(baseRoutes = createDefaultPreviewRoutes()): FormatDefinition[] {
  return [
    ...DOCX_FORMAT_ROUTES,
    ...baseRoutes.filter((route) => !route.extensions.includes('docx'))
  ];
}

async function sourceToBlob(source: PreviewSource, context: PreviewLoadContext): Promise<Blob> {
  if (source instanceof Blob) {
    return source;
  }
  if (typeof source === 'string') {
    const response = await fetch(source, { signal: context.signal });
    if (!response.ok) {
      throw new Error(`Failed to load DOCX source: ${response.status} ${response.statusText}`.trim());
    }
    return response.blob();
  }
  return new Blob([toBlobPart(source)], {
    type: context.descriptor.contentType ?? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  });
}

function normalizeFormat(format: string): string {
  return format.trim().replace(/^\./, '').toLowerCase();
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
