import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ParsedPresentation } from '../src/types';
import { createViewer } from '../src/viewer';
import { readFixture } from './helpers';

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

class MockIntersectionObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}

  observe(target: Element): void {
    this.callback(
      [
        {
          isIntersecting: true,
          intersectionRatio: 1,
          target
        } as IntersectionObserverEntry
      ],
      this as unknown as IntersectionObserver
    );
  }

  disconnect(): void {}
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: MockResizeObserver,
    configurable: true
  });
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    value: MockIntersectionObserver,
    configurable: true
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    value: vi.fn(),
    configurable: true
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('PptxViewer', () => {
  it('keeps rapid navigation relative to the target while scrolling, then lets manual scrolling take over', () => {
    const container = document.createElement('div'); document.body.append(container);
    const viewer = createViewer(container, { fit: 'none' });
    const internal = viewer as unknown as {
      applyPresentation(presentation: ParsedPresentation): void;
      syncCurrentSlideToViewport(): void;
    };
    internal.applyPresentation(createPresentationWithSlideCount(4));
    const area = container.querySelector('.pptxv-scroll-area') as HTMLDivElement;
    area.getBoundingClientRect = () => createRect({ top: 20, bottom: 380, height: 360 });
    let visibleSlide = 0;
    [...container.querySelectorAll('.pptxv-slide-shell')].forEach((shell, index) => {
      shell.getBoundingClientRect = () => {
        const top = 20 + (index - visibleSlide) * 400;
        return createRect({ top, bottom: top + 360, height: 360 });
      };
    });
    viewer.next();
    internal.syncCurrentSlideToViewport();
    expect(viewer.getState().currentSlide).toBe(1);
    viewer.next();
    visibleSlide = 1; internal.syncCurrentSlideToViewport();
    expect(viewer.getState().currentSlide).toBe(2);
    expect(container.querySelector('.pptxv-slide-shell[data-slide-index="1"] .pptxv-slide-stage')).toBeTruthy();
    expect(container.querySelector('.pptxv-slide-shell[data-slide-index="2"] .pptxv-slide-stage')).toBeTruthy();
    area.dispatchEvent(new Event('wheel'));
    internal.syncCurrentSlideToViewport();
    expect(viewer.getState().currentSlide).toBe(1);
    viewer.destroy(); container.remove();
  });

  it('mounts the first slide and then every visible short slide without offscreen pre-rendering', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const viewer = createViewer(container, { fit: 'none', virtual: true });
    const internal = viewer as unknown as {
      applyPresentation(presentation: ParsedPresentation): void;
      syncCurrentSlideToViewport(): void;
    };
    internal.applyPresentation(createPresentationWithSlideCount(8));
    expect(container.querySelectorAll('.pptxv-slide-stage')).toHaveLength(1);
    const area = container.querySelector('.pptxv-scroll-area') as HTMLDivElement;
    area.getBoundingClientRect = () => createRect({ top: 20, bottom: 380, height: 360 });
    const shells = [...container.querySelectorAll('.pptxv-slide-shell')] as HTMLDivElement[];
    shells.forEach((shell, index) => {
      const top = 20 + index * 120;
      shell.getBoundingClientRect = () => createRect({ top, bottom: top + 100, height: 100 });
    });
    internal.syncCurrentSlideToViewport();
    expect(container.querySelectorAll('.pptxv-slide-stage')).toHaveLength(3);
    expect(shells[3].querySelector('.pptxv-slide-stage')).toBeNull();
    viewer.goToSlide(7);
    expect(shells[7].querySelector('.pptxv-slide-stage')).toBeTruthy();
    expect(shells[0].querySelector('.pptxv-slide-stage')).toBeTruthy();
    internal.syncCurrentSlideToViewport();
    expect(shells[7].querySelector('.pptxv-slide-stage')).toBeTruthy();
    viewer.destroy();
    container.remove();
  });

  it('reuses mounted slide DOM when the scale changes', async () => {
    const bytes = await readFixture('fixtures-text-theme.pptx');
    const container = document.createElement('div');
    document.body.appendChild(container);

    const viewer = createViewer(container, {
      fit: 'none',
      initialScale: 1
    });

    await viewer.preview(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

    const stageBefore = container.querySelector('.pptxv-slide-stage');
    const slideBefore = container.querySelector('.pptxv-slide');

    expect(stageBefore).toBeTruthy();
    expect(slideBefore).toBeTruthy();

    viewer.setScale(1.45);

    expect(container.querySelector('.pptxv-slide-stage')).toBe(stageBefore);
    expect(container.querySelector('.pptxv-slide')).toBe(slideBefore);

    viewer.destroy();
    container.remove();
  });

  it('clears stale presentation state and renders an error placeholder on failure', async () => {
    const bytes = await readFixture('fixtures-text-theme.pptx');
    const container = document.createElement('div');
    document.body.appendChild(container);

    const viewer = createViewer(container, {
      fit: 'none'
    });

    await viewer.preview(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    await viewer.preview(42 as unknown as ArrayBuffer);

    const state = viewer.getState();
    expect(state.presentation).toBeNull();
    expect(state.slideCount).toBe(0);
    expect(state.error).toContain('Unsupported PPTX source type');
    expect(container.textContent).toContain('Unable to load presentation');

    viewer.destroy();
    container.remove();
  });

  it('renders an explicit empty state for presentations with no slides', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const viewer = createViewer(container, {
      fit: 'none'
    });

    (viewer as unknown as { applyPresentation(presentation: ParsedPresentation): void }).applyPresentation(
      createPresentationWithSlideCount(0)
    );

    expect(viewer.getState().slideCount).toBe(0);
    expect(container.querySelector('.pptxv-loading--empty')?.textContent).toBe('No slides in presentation.');
    expect(container.querySelector('.pptxv-slide-shell')).toBeNull();

    viewer.destroy();
    container.remove();
  });

  it('recalculates fit scale when the current slide size changes', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const viewer = createViewer(container, {
      fit: 'width',
      minScale: 0.1,
      maxScale: 10
    });

    const scrollArea = container.querySelector('.pptxv-scroll-area');
    Object.defineProperties(scrollArea ?? {}, {
      clientWidth: {
        value: 400,
        configurable: true
      },
      clientHeight: {
        value: 300,
        configurable: true
      }
    });

    const scaleChanges: number[] = [];
    viewer.on('scalechange', (state) => {
      scaleChanges.push(state.scale);
    });

    (viewer as unknown as { applyPresentation(presentation: ParsedPresentation): void }).applyPresentation(
      createPresentationWithMixedSlideSizes()
    );

    const initialScale = viewer.getState().scale;
    viewer.goToSlide(1);

    expect(viewer.getState().currentSlide).toBe(1);
    expect(viewer.getState().scale).toBeLessThan(initialScale);
    expect(scaleChanges.at(-1)).toBe(viewer.getState().scale);

    viewer.destroy();
    container.remove();
  });

  it('aborts stale URL previews when a newer request starts', async () => {
    const bytes = await readFixture('fixtures-text-theme.pptx');
    const container = document.createElement('div');
    document.body.appendChild(container);

    let firstSignal: AbortSignal | undefined;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) => {
        firstSignal = init?.signal;
        return new Promise((_, reject) => {
          firstSignal?.addEventListener(
            'abort',
            () => {
              reject(createAbortError());
            },
            { once: true }
          );
        });
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      });

    Object.defineProperty(globalThis, 'fetch', {
      value: fetchMock,
      configurable: true
    });

    const viewer = createViewer(container, {
      fit: 'none'
    });
    const errors: Error[] = [];
    viewer.on('error', (error) => {
      errors.push(error);
    });

    const firstPreview = viewer.preview('/first.pptx');
    const secondPreview = viewer.preview('/second.pptx');

    await secondPreview;
    await firstPreview.catch(() => undefined);

    expect(firstSignal?.aborted).toBe(true);
    expect(errors).toHaveLength(0);
    expect(viewer.getState().presentation?.slides).toHaveLength(1);

    viewer.destroy();
    container.remove();
  });

  it('tracks the visible slide when the page scrolls instead of the inner scroll area', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const viewer = createViewer(container, {
      fit: 'none',
      virtual: true
    });

    (viewer as unknown as { applyPresentation(presentation: ParsedPresentation): void }).applyPresentation(
      createPresentationWithSlideCount(8)
    );

    Object.defineProperty(window, 'innerHeight', {
      value: 420,
      configurable: true
    });

    const scrollArea = container.querySelector('.pptxv-scroll-area') as HTMLDivElement | null;
    const shells = [...container.querySelectorAll('.pptxv-slide-shell')] as HTMLDivElement[];
    expect(scrollArea).toBeTruthy();
    expect(shells).toHaveLength(8);

    scrollArea!.getBoundingClientRect = () => createRect({ top: 20, bottom: 380, height: 360 });
    shells.forEach((shell, index) => {
      const top = -420 + index * 120;
      shell.getBoundingClientRect = () => createRect({ top, bottom: top + 100, height: 100 });
    });

    (viewer as unknown as { syncCurrentSlideToViewport(): void }).syncCurrentSlideToViewport();

    expect(viewer.getState().currentSlide).toBe(5);
    expect(container.querySelector('.pptxv-slide-shell[data-slide-index="5"] .pptxv-slide-stage')).toBeTruthy();
    expect(container.querySelector('.pptxv-slide-shell[data-slide-index="2"] .pptxv-slide-stage')).toBeNull();

    viewer.destroy();
    container.remove();
  });

  it('navigates to the linked slide when an internal slide link is clicked', async () => {
    const bytes = await readFixture('../../apps/demo/public/samples/sample-deck.pptx');
    const container = document.createElement('div');
    document.body.appendChild(container);

    const viewer = createViewer(container, {
      fit: 'none'
    });

    await viewer.preview(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

    const link = container.querySelector('[data-slide-index="2"]') as HTMLAnchorElement | null;
    expect(link).toBeTruthy();

    link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(viewer.getState().currentSlide).toBe(2);

    viewer.destroy();
    container.remove();
  });

  it('tracks a viewport deep in a long presentation without measuring every slide', () => {
    const container = document.createElement('div'); document.body.append(container);
    const viewer = createViewer(container, { fit: 'none' });
    const internal = viewer as unknown as { applyPresentation(p: ParsedPresentation): void; findTrackedSlideIndex(): number | null };
    internal.applyPresentation(createPresentationWithSlideCount(1024));
    const area = container.querySelector('.pptxv-scroll-area') as HTMLDivElement;
    area.getBoundingClientRect = () => createRect({ top: 20, bottom: 380, height: 360 });
    const shells = [...container.querySelectorAll('.pptxv-slide-shell')];
    let reads = 0;
    shells.forEach((shell, index) => {
      shell.getBoundingClientRect = () => {
        reads++;
        const top = (index - 750) * 120 + 100;
        return createRect({ top, bottom: top + 100, height: 100 });
      };
    });
    expect(internal.findTrackedSlideIndex()).toBe(750);
    expect(reads).toBeLessThan(30);
    viewer.destroy(); container.remove();
  });

  it('navigates with PowerPoint action links', async () => {
    const bytes = await readFixture('../../apps/demo/public/samples/sample-deck.pptx');
    const container = document.createElement('div');
    document.body.appendChild(container);

    const viewer = createViewer(container, {
      fit: 'none'
    });

    await viewer.preview(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    viewer.goToSlide(2);

    const link = container.querySelector('[data-slide-action="first"]') as HTMLAnchorElement | null;
    expect(link).toBeTruthy();

    link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(viewer.getState().currentSlide).toBe(0);

    viewer.destroy();
    container.remove();
  });

  it('returns to the last viewed slide when the action link is clicked', async () => {
    const bytes = await readFixture('../../apps/demo/public/samples/sample-deck.pptx');
    const container = document.createElement('div');
    document.body.appendChild(container);

    const viewer = createViewer(container, {
      fit: 'none'
    });

    await viewer.preview(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

    const jumpLink = container.querySelector('[data-slide-index="2"]') as HTMLAnchorElement | null;
    expect(jumpLink).toBeTruthy();

    jumpLink?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(viewer.getState().currentSlide).toBe(2);

    const lastViewedLink = container.querySelector('[data-slide-action="lastViewed"]') as HTMLAnchorElement | null;
    expect(lastViewedLink).toBeTruthy();
    lastViewedLink?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(viewer.getState().currentSlide).toBe(0);

    viewer.destroy();
    container.remove();
  });

  it('navigates to the linked slide when an image link is clicked', async () => {
    const bytes = await readFixture('../../apps/demo/public/samples/sample-deck.pptx');
    const container = document.createElement('div');
    document.body.appendChild(container);

    const viewer = createViewer(container, {
      fit: 'none'
    });

    await viewer.preview(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    viewer.goToSlide(1);

    const link = container.querySelector('.pptxv-item--image .pptxv-item-link[data-slide-index="2"]') as HTMLAnchorElement | null;
    expect(link).toBeTruthy();

    link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(viewer.getState().currentSlide).toBe(2);

    viewer.destroy();
    container.remove();
  });

  it('does not intercept item-level external link clicks', async () => {
    const bytes = await readFixture('../../apps/demo/public/samples/sample-deck.pptx');
    const container = document.createElement('div');
    document.body.appendChild(container);

    const viewer = createViewer(container, {
      fit: 'none'
    });

    await viewer.preview(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    viewer.goToSlide(1);

    const link = container.querySelector(
      '.pptxv-slide-shell[data-slide-index="1"] .pptxv-item--shape .pptxv-item-link[href="https://example.com/pptx-previewer/grouped-media"]'
    ) as HTMLAnchorElement | null;
    expect(link).toBeTruthy();

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    const dispatchResult = link?.dispatchEvent(clickEvent);

    expect(dispatchResult).toBe(true);
    expect(clickEvent.defaultPrevented).toBe(false);
    expect(viewer.getState().currentSlide).toBe(1);

    viewer.destroy();
    container.remove();
  });
});

function createPresentationWithMixedSlideSizes(): ParsedPresentation {
  return {
    size: {
      width: 100,
      height: 100
    },
    theme: {
      colors: {},
      fonts: {}
    },
    slides: [
      {
        id: 'slide-1',
        index: 0,
        title: 'Small slide',
        background: {
          type: 'solid',
          color: '#FFFFFF'
        },
        width: 100,
        height: 100,
        items: [],
        warnings: []
      },
      {
        id: 'slide-2',
        index: 1,
        title: 'Large slide',
        background: {
          type: 'solid',
          color: '#FFFFFF'
        },
        width: 200,
        height: 100,
        items: [],
        warnings: []
      }
    ],
    media: {},
    warnings: []
  };
}

function createPresentationWithSlideCount(count: number): ParsedPresentation {
  return {
    size: {
      width: 100,
      height: 100
    },
    theme: {
      colors: {},
      fonts: {}
    },
    slides: Array.from({ length: count }, (_, index) => ({
      id: `slide-${index + 1}`,
      index,
      title: `Slide ${index + 1}`,
      background: {
        type: 'solid' as const,
        color: '#FFFFFF'
      },
      width: 100,
      height: 100,
      items: [],
      warnings: []
    })),
    media: {},
    warnings: []
  };
}

function createRect({
  top,
  bottom,
  height
}: {
  top: number;
  bottom: number;
  height: number;
}): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    bottom,
    left: 0,
    right: 100,
    width: 100,
    height,
    toJSON: () => ({})
  } as DOMRect;
}

function createAbortError(): Error {
  try {
    return new DOMException('The operation was aborted.', 'AbortError');
  } catch {
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error;
  }
}
