import {
  createDefaultPreviewRoutes,
  analyzePreviewFonts,
  collectSlideFontReferences,
  collectSlideFontLoadingReferences,
  applySlideFontMappings,
  analyzeLoadedPreviewFonts,
  bindPreviewFontLoading,
  type PreviewFontRefresh,
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
  type SlideModel,
  type TableItem,
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
  private destroyed = false;
  private fontDocument: IworkViewerState['document'] = null;
  private fontScenes: Array<SlideModel | TableItem> = [];
  private fontAnalysis = analyzePreviewFonts([]);
  private fontUpdate: PreviewFontRefresh | null = null;
  private readonly fontLoading: ReturnType<typeof bindPreviewFontLoading>;

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
      this.viewer.on('loadingchange', (state) => {
        this.updateState(state);
        if (state.loading) this.emit('loading', this.lastState);
        this.emit('statechange', this.lastState);
      }),
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
      this.viewer.on('warnings', () => {
        this.updateState(this.viewer.getState());
        this.emit('warnings', this.lastState.warnings);
      }),
      this.viewer.on('pagechange', (state) => {
        this.updateState(state);
        this.emit('statechange', this.lastState);
      }),
      this.viewer.on('sheetchange', (state) => {
        const warnings = this.lastState.warnings;
        this.updateState(state);
        if (warnings.join('\n') !== this.lastState.warnings.join('\n')) this.emit('warnings', this.lastState.warnings);
        this.emit('statechange', this.lastState);
      }),
      this.viewer.on('scalechange', (state) => {
        this.updateState(state);
        this.emit('statechange', this.lastState);
      })
    ];
    this.fontLoading = bindPreviewFontLoading(this, host.ownerDocument, options);
  }

  async load(source: PreviewSource, context: PreviewLoadContext): Promise<void> {
    this.fontLoading.reset(context.signal, context.route?.targetFormat ?? context.descriptor.extension ?? 'key');
    this.fontUpdate = null;
    await this.viewer.preview(source, { signal: context.signal });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.fontLoading.destroy();
    for (const unsubscribe of this.unsubscribes) {
      unsubscribe();
    }
    this.viewer.destroy();
    this.updateState(this.viewer.getState());
    for (const handlers of Object.values(this.listeners)) handlers.clear();
  }

  getState(): IworkPreviewState {
    return {
      ...this.lastState,
      fonts: this.lastState.fonts?.map((font) => ({ ...font, classification: font.classification ? { ...font.classification } : undefined })),
      warnings: [...this.lastState.warnings]
    };
  }

  private fontSlides() {
    const slides = this.fontScenes.filter((scene): scene is SlideModel => 'items' in scene);
    const tables = this.fontScenes.filter((scene): scene is TableItem => !('items' in scene));
    return [...slides, { items: tables }];
  }

  getFontReferences() { return collectSlideFontLoadingReferences(this.fontSlides()); }

  refreshFonts(update: PreviewFontRefresh): void {
    if (this.destroyed || !this.fontDocument) return;
    const replacements = new Map(update.references.map(ref => [JSON.stringify([ref.fontFamily, ref.traits?.weight, ref.fontStyle]), ref]));
    update = { ...update, references: this.getFontReferences().map(ref => replacements.get(JSON.stringify([ref.fontFamily, ref.traits?.weight, ref.fontStyle])) ?? ref) };
    this.fontUpdate = update;
    applySlideFontMappings(this.fontSlides(), update.references);
    this.fontAnalysis = analyzeLoadedPreviewFonts(update, this.host.ownerDocument);
    this.updateState(this.viewer.getState());
    if (update.loaded.length || update.relayout) this.viewer.refreshFonts?.();
    this.emit('warnings', this.lastState.warnings); this.emit('statechange', this.lastState);
  }

  on<T extends PreviewEventName>(event: T, handler: (payload: PreviewEventMap[T]) => void): () => void {
    if (this.destroyed) return () => {};
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
    const document = state.document;
    const slides: SlideModel[] = !document ? [] : document.kind === 'key'
      ? document.presentation.slides
      : document.kind === 'pages' ? document.pages.map((page) => page.canvas.slide)
        : document.sheets.map((sheet) => sheet.canvas.slide);
    const tables = document?.kind === 'numbers' ? document.sheets.flatMap((sheet) => sheet.tables.map((table) => table.item)) : [];
    // Lazy Numbers sheets can replace scenes inside the same document object.
    const scenes = [...slides, ...tables];
    if (document !== this.fontDocument || scenes.length !== this.fontScenes.length || scenes.some((scene, i) => scene !== this.fontScenes[i])) {
      this.fontDocument = document;
      this.fontScenes = scenes;
      const tableSlides = tables.length ? [{ items: tables }] : [];
      const references = collectSlideFontReferences([...slides, ...tableSlides]);
      if (this.fontUpdate) {
        const previous = new Map(this.fontUpdate.references.map(ref => [ref.fontFamily, ref]));
        this.fontAnalysis = analyzeLoadedPreviewFonts({ ...this.fontUpdate, references: references.map(ref => previous.get(ref.fontFamily) ?? ref) }, this.host.ownerDocument);
        applySlideFontMappings([...slides, ...tableSlides], this.fontUpdate.references);
      } else this.fontAnalysis = analyzePreviewFonts(references, this.host.ownerDocument);
    }
    this.lastState = {
      ...toIworkPreviewState(state),
      fonts: this.fontAnalysis.fonts.map((font) => ({ ...font, classification: font.classification ? { ...font.classification } : undefined })),
      warnings: [...new Set([...state.warnings, ...this.fontAnalysis.warnings])]
    };
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
