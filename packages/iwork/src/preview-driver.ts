import {
  createDefaultPreviewRoutes,
  type FormatDefinition,
  type PagedPreviewState,
  type PreviewDriver,
  type PreviewEventMap,
  type PreviewEventName,
  type PreviewFitMode,
  type PreviewItemState,
  type PreviewLoadContext,
  type PreviewOptions,
  type PreviewSession,
  type PreviewSource,
  type WorkbookPreviewState
} from '@filens/core';
import { createIworkViewer } from './viewer/create-iwork-viewer';
import type { IworkType, IworkViewerInstance, IworkViewerState } from './types';

type IworkPreviewState = PagedPreviewState | WorkbookPreviewState;

type PreviewListenerMap = {
  [K in PreviewEventName]: Set<(payload: PreviewEventMap[K]) => void>;
};

export const IWORK_FORMAT_ROUTES: FormatDefinition[] = [
  {
    extensions: ['key'],
    family: 'paged',
    driverId: 'iwork',
    targetFormat: 'key'
  },
  {
    extensions: ['pages'],
    family: 'paged',
    driverId: 'iwork',
    targetFormat: 'pages'
  },
  {
    extensions: ['numbers'],
    family: 'workbook',
    driverId: 'iwork',
    targetFormat: 'numbers'
  }
];

export class IworkPreviewSession implements PreviewSession<IworkPreviewState> {
  private readonly viewer: IworkViewerInstance;
  private readonly listeners: PreviewListenerMap = {
    loading: new Set(),
    rendered: new Set(),
    error: new Set(),
    statechange: new Set(),
    warnings: new Set()
  };
  private readonly unsubscribes: Array<() => void>;
  private lastState: IworkPreviewState;

  constructor(private readonly host: HTMLElement, options: PreviewOptions = {}) {
    this.viewer = createIworkViewer(host, {
      fit: normalizeFitMode(options.fit),
      initialScale: options.initialScale,
      minScale: options.minScale,
      maxScale: options.maxScale,
      virtual: options.virtual
    });
    this.lastState = toIworkPreviewState(this.viewer.getState());
    this.unsubscribes = [
      this.viewer.on('rendered', (state) => {
        this.updateState(state);
        this.emit('rendered', this.lastState);
        this.emit('statechange', this.lastState);
      }),
      this.viewer.on('error', (error) => {
        this.updateState(this.viewer.getState());
        this.emit('error', error);
        this.emit('statechange', this.lastState);
      }),
      this.viewer.on('warnings', (warnings) => {
        this.emit('warnings', warnings);
      }),
      this.viewer.on('pagechange', (state) => {
        this.updateState(state);
        this.emit('statechange', this.lastState);
      }),
      this.viewer.on('sheetchange', (state) => {
        this.updateState(state);
        this.emit('statechange', this.lastState);
      }),
      this.viewer.on('scalechange', (state) => {
        this.updateState(state);
        this.emit('statechange', this.lastState);
      })
    ];
  }

  async load(source: PreviewSource, context: PreviewLoadContext): Promise<void> {
    const loadTask = this.viewer.preview(source, { signal: context.signal });
    this.updateState({
      ...this.viewer.getState(),
      loading: true,
      error: null
    });
    this.emit('loading', this.lastState);
    this.emit('statechange', this.lastState);
    await loadTask;
  }

  destroy(): void {
    for (const unsubscribe of this.unsubscribes) {
      unsubscribe();
    }
    this.viewer.destroy();
  }

  getState(): IworkPreviewState {
    return this.lastState;
  }

  on<T extends PreviewEventName>(event: T, handler: (payload: PreviewEventMap[T]) => void): () => void {
    this.listeners[event].add(handler as never);
    return () => {
      this.listeners[event].delete(handler as never);
    };
  }

  setScale(scale: number): void {
    this.viewer.setScale(scale);
  }

  fit(mode?: PreviewFitMode): void {
    this.viewer.fit(normalizeFitMode(mode));
  }

  goToPage(index: number): void {
    const state = this.viewer.getState();
    if (state.kind === 'numbers') {
      this.viewer.goToSheet(index);
      return;
    }
    this.viewer.goToPage(index);
  }

  next(): void {
    this.viewer.next();
  }

  prev(): void {
    this.viewer.prev();
  }

  async fullscreen(): Promise<void> {
    const fullscreenElement = document.fullscreenElement;
    if (fullscreenElement === this.host && document.exitFullscreen) {
      await document.exitFullscreen();
      return;
    }
    if (!fullscreenElement && this.host.requestFullscreen) {
      await this.host.requestFullscreen();
    }
  }

  private updateState(state: IworkViewerState): void {
    this.lastState = toIworkPreviewState(state);
  }

  private emit<T extends PreviewEventName>(event: T, payload: PreviewEventMap[T]): void {
    for (const handler of this.listeners[event]) {
      handler(payload as never);
    }
  }
}

export function createIworkPreviewDriver(): PreviewDriver<IworkPreviewState> {
  return {
    id: 'iwork',
    family: 'paged',
    supports: (format) => normalizeIworkType(format) != null,
    createSession: (host, options) => new IworkPreviewSession(host, options)
  };
}

export function createIworkPreviewRoutes(baseRoutes = createDefaultPreviewRoutes()): FormatDefinition[] {
  const iworkExtensions = new Set(IWORK_FORMAT_ROUTES.flatMap((route) => route.extensions));
  return [
    ...IWORK_FORMAT_ROUTES,
    ...baseRoutes.filter((route) => !route.extensions.some((extension) => iworkExtensions.has(extension)))
  ];
}

function toIworkPreviewState(state: IworkViewerState): IworkPreviewState {
  if (state.kind === 'numbers') {
    return {
      loading: state.loading,
      error: state.error,
      title: state.document?.kind === 'numbers' ? state.document.sheets[state.currentSheet]?.name : undefined,
      family: 'workbook',
      warnings: state.warnings,
      capabilities: {
        workbook: true,
        sheets: true,
        fullscreen: true,
        download: true
      },
      activeSheetIndex: state.currentSheet,
      sheets:
        state.document?.kind === 'numbers'
          ? state.document.sheets.map((sheet) => ({
              id: sheet.id,
              name: sheet.name
            }))
          : [],
      scale: state.scale
    };
  }

  return {
    loading: state.loading,
    error: state.error,
    title: readIworkTitle(state),
    family: 'paged',
    warnings: state.warnings,
    capabilities: {
      paged: true,
      thumbnails: true,
      zoom: true,
      fit: true,
      fullscreen: true,
      download: true
    },
    pageIndex: state.currentPage,
    pageCount: state.pageCount,
    scale: state.scale,
    fit: normalizePreviewFitMode(state.fit)
  };
}

function readIworkTitle(state: IworkViewerState): string | undefined {
  const document = state.document;
  if (!document) {
    return undefined;
  }
  if (document.kind === 'key') {
    return document.slides[state.currentPage]?.title;
  }
  if (document.kind === 'pages') {
    return document.pages[state.currentPage]?.canvas.title ?? document.title;
  }
  return document.sheets[state.currentSheet]?.name;
}

function normalizeFitMode(fit: PreviewOptions['fit']) {
  if (fit === 'contain' || fit === 'width' || fit === 'none') {
    return fit;
  }
  if (fit === 'height') {
    return 'height';
  }
  return 'contain';
}

function normalizePreviewFitMode(fit: IworkViewerState['fit']): PagedPreviewState['fit'] {
  if (fit === 'contain' || fit === 'width' || fit === 'height' || fit === 'none') {
    return fit;
  }
  return 'contain';
}

function normalizeIworkType(format: string | undefined): IworkType | null {
  const normalized = String(format ?? '')
    .trim()
    .replace(/^\./, '')
    .toLowerCase();
  if (normalized === 'key' || normalized === 'pages' || normalized === 'numbers') {
    return normalized;
  }
  return null;
}
