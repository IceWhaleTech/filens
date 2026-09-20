import type {
  FitMode,
  ParsedPresentation,
  ViewerEventMap,
  ViewerEventName,
  ViewerInstance,
  ViewerOptions,
  ViewerState
} from './types';
import { clamp } from './utils/common';
import { loadPptx } from './parser/load-pptx';
import { MediaRegistry, renderSlideToElement } from './render/dom';

type ListenerMap = {
  [K in ViewerEventName]: Set<(payload: ViewerEventMap[K]) => void>;
};

export class PptxViewer implements ViewerInstance {
  private readonly options: Required<ViewerOptions>;
  private readonly root: HTMLDivElement;
  private readonly scrollArea: HTMLDivElement;
  private readonly listeners: ListenerMap = {
    rendered: new Set(),
    error: new Set(),
    slidechange: new Set(),
    scalechange: new Set(),
    warnings: new Set()
  };

  private resizeObserver?: ResizeObserver;
  private shells: HTMLDivElement[] = [];
  private mountedSlides = new Set<number>();
  private mountedStages = new Map<number, HTMLDivElement>();
  private slideRoots = new Map<number, HTMLElement>();
  private requestToken = 0;
  private fallbackScrollRaf = 0;
  private activeAbortController: AbortController | null = null;
  private mediaRegistry: MediaRegistry | null = null;
  private presentation: ParsedPresentation | null = null;
  private lastViewedSlide: number | null = null;
  private navigationSourceSlide: number | null = null;
  private navigationSettleTimer = 0;

  private state: ViewerState = {
    loading: false,
    error: null,
    currentSlide: 0,
    slideCount: 0,
    scale: 1,
    fit: 'contain',
    warnings: [],
    presentation: null,
    mediaRegistry: null
  };

  constructor(private readonly container: HTMLElement, options: ViewerOptions = {}) {
    this.options = {
      width: options.width ?? 0,
      height: options.height ?? 0,
      fit: options.fit ?? 'contain',
      initialScale: options.initialScale ?? 1,
      minScale: options.minScale ?? 0.4,
      maxScale: options.maxScale ?? 4,
      virtual: options.virtual ?? true
    };
    this.state.fit = this.options.fit;
    this.state.scale = clamp(this.options.initialScale, this.options.minScale, this.options.maxScale);

    this.root = document.createElement('div');
    this.root.className = 'pptxv-viewer';
    if (this.options.width) {
      this.root.style.width = `${this.options.width}px`;
    }
    if (this.options.height) {
      this.root.style.height = `${this.options.height}px`;
    }

    this.scrollArea = document.createElement('div');
    this.scrollArea.className = 'pptxv-scroll-area';
    this.root.appendChild(this.scrollArea);
    this.root.addEventListener('click', this.handleLinkClick);

    this.container.innerHTML = '';
    this.container.appendChild(this.root);

    this.bindResizeObserver();
  }

  async preview(source: Parameters<ViewerInstance['preview']>[0]): Promise<void> {
    const token = ++this.requestToken;
    this.activeAbortController?.abort();
    this.activeAbortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
    this.beginLoadingState();
    this.renderLoadingState();

    try {
      const presentation = await loadPptx(source, {
        signal: this.activeAbortController?.signal
      });
      if (token !== this.requestToken) {
        return;
      }

      this.applyPresentation(presentation);
    } catch (error) {
      if (token !== this.requestToken) {
        return;
      }
      if (isAbortError(error)) {
        return;
      }
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      this.state.loading = false;
      this.state.error = normalizedError.message;
      this.renderErrorState(normalizedError.message);
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
    this.resizeObserver?.disconnect();
    this.mediaRegistry?.destroy();
    this.root.removeEventListener('click', this.handleLinkClick);
    this.clearRenderedSlides();
    this.container.innerHTML = '';
    this.presentation = null;
    this.mediaRegistry = null;
    this.state.presentation = null;
    this.state.mediaRegistry = null;
    this.state.loading = false;
    this.state.error = null;
    this.state.slideCount = 0;
    this.state.currentSlide = 0;
    this.state.warnings = [];
    this.lastViewedSlide = null;
    this.navigationSourceSlide = null;
    this.clearNavigationSettleTimer();
  }

  setScale(scale: number): void {
    const nextScale = clamp(scale, this.options.minScale, this.options.maxScale);
    const shouldEmit = this.state.fit !== 'none' || nextScale !== this.state.scale;
    this.state.fit = 'none';
    this.state.scale = nextScale;
    if (!shouldEmit) {
      return;
    }
    this.layoutSlides();
    this.emit('scalechange', this.getState());
  }

  fit(mode?: FitMode): void {
    const nextFit = mode ?? this.state.fit;
    const fitChanged = nextFit !== this.state.fit;
    this.state.fit = nextFit;
    this.applyFitScale();
    if (!fitChanged && !this.presentation) {
      return;
    }
    this.layoutSlides();
    this.emit('scalechange', this.getState());
  }

  goToSlide(index: number): void {
    const normalized = clamp(index, 0, Math.max(this.shells.length - 1, 0));
    const shell = this.shells[normalized];
    if (!shell) {
      return;
    }

    this.beginProgrammaticNavigation();
    shell.scrollIntoView({
      behavior: getPreferredScrollBehavior(),
      block: 'start'
    });
    this.setCurrentSlide(normalized);
  }

  next(): void {
    this.goToSlide(this.state.currentSlide + 1);
  }

  prev(): void {
    this.goToSlide(this.state.currentSlide - 1);
  }

  getState(): ViewerState {
    return {
      ...this.state,
      presentation: this.presentation,
      mediaRegistry: this.mediaRegistry
    };
  }

  on<T extends ViewerEventName>(event: T, handler: (payload: ViewerEventMap[T]) => void): () => void {
    this.listeners[event].add(handler as never);
    return () => {
      this.listeners[event].delete(handler as never);
    };
  }

  private emit<T extends ViewerEventName>(event: T, payload: ViewerEventMap[T]): void {
    for (const handler of this.listeners[event]) {
      handler(payload as never);
    }
  }

  private applyPresentation(presentation: ParsedPresentation): void {
    this.mediaRegistry?.destroy();
    this.presentation = presentation;
    this.lastViewedSlide = null;
    this.mediaRegistry = new MediaRegistry(presentation);
    this.state.loading = false;
    this.state.error = null;
    this.state.presentation = presentation;
    this.state.mediaRegistry = this.mediaRegistry;
    this.state.slideCount = presentation.slides.length;
    this.state.currentSlide = 0;
    this.state.warnings = presentation.warnings;

    if (this.state.fit !== 'none') {
      this.applyFitScale();
    } else {
      this.state.scale = clamp(this.state.scale, this.options.minScale, this.options.maxScale);
    }

    this.scrollArea.scrollTop = 0;
    this.renderSlideShells();
    this.emit('warnings', presentation.warnings);
    this.emit('rendered', this.getState());
  }

  private renderLoadingState(): void {
    this.clearRenderedSlides();
    const loading = document.createElement('div');
    loading.className = 'pptxv-loading';
    loading.textContent = 'Loading presentation...';
    this.scrollArea.appendChild(loading);
  }

  private renderErrorState(message: string): void {
    this.clearRenderedSlides();
    const error = document.createElement('div');
    error.className = 'pptxv-loading pptxv-loading--error';
    error.textContent = `Unable to load presentation: ${message}`;
    this.scrollArea.appendChild(error);
  }

  private renderSlideShells(): void {
    this.clearRenderedSlides();

    if (!this.presentation) {
      return;
    }

    if (this.presentation.slides.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'pptxv-loading pptxv-loading--empty';
      empty.textContent = 'No slides in presentation.';
      this.scrollArea.appendChild(empty);
      return;
    }

    this.presentation.slides.forEach((slide, index) => {
      const shell = document.createElement('div');
      shell.className = 'pptxv-slide-shell';
      shell.dataset.slideIndex = String(index);

      this.scrollArea.appendChild(shell);
      this.shells.push(shell);
    });

    this.layoutSlides();
    this.bindSlideTracking();
  }

  private layoutSlides(): void {
    if (!this.presentation) {
      return;
    }

    this.presentation.slides.forEach((slide, index) => {
      const shell = this.shells[index];
      if (!shell) {
        return;
      }

      shell.style.width = `${slide.width * this.state.scale}px`;
      shell.style.minHeight = `${slide.height * this.state.scale}px`;
      shell.style.height = `${slide.height * this.state.scale}px`;
    });

    this.syncMountedSlides();
    this.handleFallbackScroll();
  }

  private syncMountedSlides(): void {
    if (!this.presentation || !this.mediaRegistry) {
      return;
    }

    const allowed = new Set<number>();
    if (!this.options.virtual) {
      for (let index = 0; index < this.presentation.slides.length; index += 1) {
        allowed.add(index);
      }
    } else {
      for (let index = Math.max(0, this.state.currentSlide - 2); index <= Math.min(this.presentation.slides.length - 1, this.state.currentSlide + 2); index += 1) {
        allowed.add(index);
      }
    }

    for (const mounted of [...this.mountedSlides]) {
      if (!allowed.has(mounted)) {
        this.unmountSlide(mounted);
      }
    }

    for (const index of allowed) {
      if (this.mountedSlides.has(index)) {
        this.updateMountedSlide(index);
        continue;
      }

      this.mountSlide(index);
    }
  }

  private mountSlide(index: number): void {
    if (!this.presentation || !this.mediaRegistry) {
      return;
    }

    const shell = this.shells[index];
    if (!shell) {
      return;
    }

    const stage = document.createElement('div');
    stage.className = 'pptxv-slide-stage';

    const slideElement = renderSlideToElement(this.presentation.slides[index], this.presentation, {
      mediaRegistry: this.mediaRegistry
    });

    stage.appendChild(slideElement);
    shell.appendChild(stage);
    this.mountedStages.set(index, stage);
    this.slideRoots.set(index, slideElement);
    this.mountedSlides.add(index);
    this.updateMountedSlide(index);
  }

  private updateMountedSlide(index: number): void {
    if (!this.presentation) {
      return;
    }

    const stage = this.mountedStages.get(index);
    const slideElement = this.slideRoots.get(index);
    const slide = this.presentation.slides[index];
    if (!stage || !slideElement || !slide) {
      return;
    }

    stage.style.width = `${slide.width * this.state.scale}px`;
    stage.style.height = `${slide.height * this.state.scale}px`;
    slideElement.style.transform = `scale(${this.state.scale})`;
    slideElement.style.transformOrigin = 'top left';
  }

  private unmountSlide(index: number): void {
    this.mountedStages.get(index)?.remove();
    this.mountedStages.delete(index);
    this.slideRoots.delete(index);
    this.mountedSlides.delete(index);
  }

  private bindResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    this.resizeObserver = new ResizeObserver(() => {
      if (this.presentation && this.state.fit !== 'none') {
        this.applyFitScale();
        this.layoutSlides();
      }
    });
    this.resizeObserver.observe(this.root);
  }

  private bindSlideTracking(): void {
    this.scrollArea.removeEventListener('scroll', this.handleFallbackScroll);
    this.scrollArea.addEventListener('scroll', this.handleFallbackScroll, { passive: true });

    if (typeof window !== 'undefined') {
      window.removeEventListener('scroll', this.handleFallbackScroll);
      window.removeEventListener('resize', this.handleFallbackScroll);
      window.addEventListener('scroll', this.handleFallbackScroll, { passive: true });
      window.addEventListener('resize', this.handleFallbackScroll, { passive: true });
    }
  }

  private readonly handleFallbackScroll = () => {
    if (this.fallbackScrollRaf) {
      return;
    }

    this.fallbackScrollRaf = requestAnimationFrame(() => {
      this.fallbackScrollRaf = 0;
      this.syncCurrentSlideToViewport();
    });
  };

  private syncCurrentSlideToViewport(): void {
    const trackedIndex = this.findTrackedSlideIndex();
    if (trackedIndex == null) {
      return;
    }

    this.setCurrentSlide(trackedIndex);
  }

  private findTrackedSlideIndex(): number | null {
    if (!this.shells.length) {
      return null;
    }

    const viewport = this.getTrackingViewport();
    if (!viewport) {
      return null;
    }

    let bestVisibleIndex: number | null = null;
    let bestVisibleRatio = -1;
    let bestVisibleDistance = Number.POSITIVE_INFINITY;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    this.shells.forEach((shell, index) => {
      const rect = shell.getBoundingClientRect();
      if (!Number.isFinite(rect.top) || !Number.isFinite(rect.height) || rect.height <= 0) {
        return;
      }

      const shellCenter = rect.top + rect.height / 2;
      const centerDistance = Math.abs(shellCenter - viewport.center);
      if (centerDistance < nearestDistance) {
        nearestDistance = centerDistance;
        nearestIndex = index;
      }

      const visibleTop = Math.max(rect.top, viewport.top);
      const visibleBottom = Math.min(rect.bottom, viewport.bottom);
      const visibleHeight = visibleBottom - visibleTop;
      if (visibleHeight <= 0) {
        return;
      }

      const visibleRatio = visibleHeight / rect.height;
      const visibleCenter = visibleTop + visibleHeight / 2;
      const visibleDistance = Math.abs(visibleCenter - viewport.center);

      if (
        visibleRatio > bestVisibleRatio + 0.0001 ||
        (Math.abs(visibleRatio - bestVisibleRatio) <= 0.0001 && visibleDistance < bestVisibleDistance)
      ) {
        bestVisibleIndex = index;
        bestVisibleRatio = visibleRatio;
        bestVisibleDistance = visibleDistance;
      }
    });

    return bestVisibleIndex ?? nearestIndex;
  }

  private getTrackingViewport(): { top: number; bottom: number; center: number } | null {
    const rect = this.scrollArea.getBoundingClientRect();
    if (!Number.isFinite(rect.top) || !Number.isFinite(rect.bottom)) {
      return null;
    }

    const viewportHeight =
      typeof window !== 'undefined'
        ? window.innerHeight || document.documentElement.clientHeight || rect.height
        : rect.height;

    const top = Math.max(rect.top, 0);
    const bottom = Math.min(rect.bottom, viewportHeight);
    if (bottom <= top) {
      return null;
    }

    return {
      top,
      bottom,
      center: top + (bottom - top) / 2
    };
  }

  private readonly handleLinkClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target.closest('[data-slide-index], [data-slide-action]') : null;
    if (!(target instanceof HTMLAnchorElement)) {
      return;
    }

    const navigationAction = target.dataset.slideAction;
    if (navigationAction) {
      event.preventDefault();

      switch (navigationAction) {
        case 'next':
          this.next();
          return;
        case 'previous':
          this.prev();
          return;
        case 'first':
          this.goToSlide(0);
          return;
        case 'last':
          this.goToSlide(Math.max((this.presentation?.slides.length ?? 1) - 1, 0));
          return;
        case 'lastViewed':
          if (this.lastViewedSlide != null) {
            this.goToSlide(this.lastViewedSlide);
          }
          return;
        default:
          return;
      }
    }

    const slideIndex = Number(target.dataset.slideIndex);
    if (!Number.isFinite(slideIndex)) {
      return;
    }

    event.preventDefault();
    this.goToSlide(slideIndex);
  };

  private setCurrentSlide(index: number): void {
    if (index === this.state.currentSlide) {
      this.syncMountedSlides();
      return;
    }

    const previousScale = this.state.scale;
    const previousSlide = this.state.currentSlide;
    this.lastViewedSlide = this.navigationSourceSlide ?? previousSlide;
    this.state.currentSlide = index;
    if (this.state.fit !== 'none') {
      this.applyFitScale();
      this.layoutSlides();
    } else {
      this.syncMountedSlides();
    }
    this.emit('slidechange', this.getState());
    if (this.state.scale !== previousScale) {
      this.emit('scalechange', this.getState());
    }
  }

  private beginProgrammaticNavigation(): void {
    this.navigationSourceSlide = this.state.currentSlide;
    this.clearNavigationSettleTimer();
    if (typeof window === 'undefined') {
      return;
    }

    const releaseDelay = getPreferredScrollBehavior() === 'smooth' ? 700 : 50;
    this.navigationSettleTimer = window.setTimeout(() => {
      this.navigationSettleTimer = 0;
      this.navigationSourceSlide = null;
    }, releaseDelay);
  }

  private clearNavigationSettleTimer(): void {
    if (!this.navigationSettleTimer) {
      return;
    }

    clearTimeout(this.navigationSettleTimer);
    this.navigationSettleTimer = 0;
  }

  private applyFitScale(): void {
    if (!this.presentation?.slides.length) {
      return;
    }

    const slide = this.presentation.slides[this.state.currentSlide] ?? this.presentation.slides[0];
    const usableWidth = Math.max(this.scrollArea.clientWidth - 24, 120);
    const usableHeight = Math.max(this.scrollArea.clientHeight - 24, 120);
    const widthScale = usableWidth / slide.width;
    const containScale = Math.min(widthScale, usableHeight / slide.height);

    this.state.scale = clamp(
      this.state.fit === 'width' ? widthScale : containScale,
      this.options.minScale,
      this.options.maxScale
    );
  }

  private beginLoadingState(): void {
    this.mediaRegistry?.destroy();
    this.mediaRegistry = null;
    this.presentation = null;
    this.lastViewedSlide = null;
    this.navigationSourceSlide = null;
    this.clearNavigationSettleTimer();
    this.state.loading = true;
    this.state.error = null;
    this.state.presentation = null;
    this.state.mediaRegistry = null;
    this.state.currentSlide = 0;
    this.state.slideCount = 0;
    this.state.warnings = [];
  }

  private clearRenderedSlides(): void {
    this.clearNavigationSettleTimer();
    this.navigationSourceSlide = null;
    if (this.fallbackScrollRaf) {
      cancelAnimationFrame(this.fallbackScrollRaf);
      this.fallbackScrollRaf = 0;
    }
    this.scrollArea.removeEventListener('scroll', this.handleFallbackScroll);
    if (typeof window !== 'undefined') {
      window.removeEventListener('scroll', this.handleFallbackScroll);
      window.removeEventListener('resize', this.handleFallbackScroll);
    }
    this.shells = [];
    this.mountedSlides.clear();
    this.mountedStages.clear();
    this.slideRoots.clear();
    this.scrollArea.innerHTML = '';
  }
}

export function createViewer(container: HTMLElement, options?: ViewerOptions): ViewerInstance {
  return new PptxViewer(container, options);
}

export const init = createViewer;

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function getPreferredScrollBehavior(): ScrollBehavior {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'smooth';
  }

  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}
