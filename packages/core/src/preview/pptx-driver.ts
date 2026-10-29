import { createViewer } from '../viewer';
import type { FitMode, ParsedPresentation, ViewerInstance, ViewerState } from '../types';
import { analyzePreviewFonts, collectSlideFontReferences } from './fonts';
import { analyzeLoadedPreviewFonts, bindPreviewFontLoading } from './font-loading';
import { applySlideFontMappings, collectSlideFontLoadingReferences } from './font-scenes';
import type {
  PagedPreviewState,
  PreviewDriver,
  PreviewEventMap,
  PreviewEventName,
  PreviewLoadContext,
  PreviewFontRefresh,
  PreviewOptions,
  PreviewSession,
  PreviewSource
} from './types';

type PreviewListenerMap = {
  [K in PreviewEventName]: Set<(payload: PreviewEventMap[K]) => void>;
};

export class PptxPreviewSession implements PreviewSession<PagedPreviewState> {
  private readonly viewer: ViewerInstance;
  private fontPresentation: ParsedPresentation | null = null;
  private fontAnalysis = analyzePreviewFonts([]);
  private readonly fontLoading: ReturnType<typeof bindPreviewFontLoading>;
  private readonly listeners: PreviewListenerMap = {
    loading: new Set(),
    rendered: new Set(),
    error: new Set(),
    statechange: new Set(),
    warnings: new Set()
  };
  private readonly unsubscribeViewerEvents: Array<() => void>;

  constructor(private readonly host: HTMLElement, options: PreviewOptions = {}) {
    this.viewer = createViewer(host, toPptxViewerOptions(options));
    this.unsubscribeViewerEvents = [
      this.viewer.on('rendered', (state) => {
        this.emit('rendered', this.toState(state));
        this.emit('statechange', this.toState(state));
      }),
      this.viewer.on('error', (error) => {
        this.emit('error', error);
        this.emit('statechange', this.getState());
      }),
      this.viewer.on('slidechange', (state) => {
        this.emit('statechange', this.toState(state));
      }),
      this.viewer.on('scalechange', (state) => {
        this.emit('statechange', this.toState(state));
      }),
      this.viewer.on('warnings', () => {
        this.emit('warnings', this.getState().warnings);
      })
    ];
    this.fontLoading = bindPreviewFontLoading(this, host.ownerDocument, options);
  }

  async load(source: PreviewSource, _context: PreviewLoadContext): Promise<void> {
    this.fontLoading.reset(_context.signal, _context.route?.targetFormat ?? _context.descriptor.extension ?? 'pptx');
    const loadTask = this.viewer.preview(source);
    this.emit('loading', this.getState());
    this.emit('statechange', this.getState());
    await loadTask;
  }

  destroy(): void {
    this.fontLoading.destroy();
    for (const unsubscribe of this.unsubscribeViewerEvents) {
      unsubscribe();
    }
    this.viewer.destroy();
    this.fontPresentation = null;
    this.fontAnalysis = analyzePreviewFonts([]);
  }

  getState(): PagedPreviewState {
    return this.toState(this.viewer.getState());
  }

  getFontReferences() {
    return collectSlideFontLoadingReferences(this.fontPresentation?.slides ?? []);
  }

  refreshFonts(update: PreviewFontRefresh): void {
    if (!this.fontPresentation) return;
    applySlideFontMappings(this.fontPresentation.slides, update.references);
    this.fontAnalysis = analyzeLoadedPreviewFonts(update, this.host.ownerDocument);
    if (update.loaded.length || update.relayout) this.viewer.refreshFonts?.();
    this.emit('warnings', this.getState().warnings);
    this.emit('statechange', this.getState());
  }

  private toState(state: ViewerState): PagedPreviewState {
    if (state.presentation !== this.fontPresentation) {
      this.fontPresentation = state.presentation;
      this.fontAnalysis = analyzePreviewFonts(
        state.presentation ? collectSlideFontReferences(state.presentation.slides) : [], this.host.ownerDocument
      );
    }
    return {
      ...toPagedPreviewState(state),
      fonts: this.fontAnalysis.fonts.map((font) => ({ ...font, classification: font.classification ? { ...font.classification } : undefined })),
      warnings: [...new Set([...state.warnings, ...this.fontAnalysis.warnings])]
    };
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

  fit(mode?: PreviewOptions['fit']): void {
    this.viewer.fit(normalizeFitMode(mode));
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

  goToPage(index: number): void {
    this.viewer.goToSlide(index);
  }

  next(): void {
    this.viewer.next();
  }

  prev(): void {
    this.viewer.prev();
  }

  private emit<T extends PreviewEventName>(event: T, payload: PreviewEventMap[T]): void {
    for (const handler of this.listeners[event]) {
      handler(payload as never);
    }
  }
}

export function createPptxPreviewDriver(): PreviewDriver<PagedPreviewState> {
  return {
    id: 'pptx',
    family: 'paged',
    supports: (format) => format.trim().replace(/^\./, '').toLowerCase() === 'pptx',
    createSession: (host, options) => new PptxPreviewSession(host, options)
  };
}

export const pptxPreviewDriver = createPptxPreviewDriver;

export function toPagedPreviewState(state: ViewerState): PagedPreviewState {
  return {
    loading: state.loading,
    error: state.error,
    title: state.presentation?.slides[state.currentSlide]?.title,
    family: 'paged',
    warnings: state.warnings,
    capabilities: {
      zoom: true,
      fit: true,
      paged: true,
      thumbnails: true,
      fullscreen: true,
      download: true
    },
    pageIndex: state.currentSlide,
    pageCount: state.slideCount,
    scale: state.scale,
    fit: state.fit
  };
}

function toPptxViewerOptions(options: PreviewOptions): {
  fit?: FitMode;
  initialScale?: number;
  minScale?: number;
  maxScale?: number;
  virtual?: boolean;
} {
  return {
    fit: normalizeFitMode(options.fit),
    initialScale: options.initialScale,
    minScale: options.minScale,
    maxScale: options.maxScale,
    virtual: options.virtual
  };
}

function normalizeFitMode(fit: PreviewOptions['fit']): FitMode | undefined {
  if (fit === 'contain' || fit === 'width' || fit === 'none') {
    return fit;
  }
  if (fit === 'height') {
    return 'contain';
  }
  return undefined;
}
