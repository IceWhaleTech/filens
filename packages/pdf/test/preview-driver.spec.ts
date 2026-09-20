import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import { createPdfPreviewDriver, createPdfPreviewRoutes } from '../src';

const destroy = vi.fn(async () => undefined);
const render = vi.fn(() => ({ promise: Promise.resolve() }));

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(() => ({
    promise: Promise.resolve({
      numPages: 2,
      destroy,
      getPage: vi.fn(async () => ({
        getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }),
        render
      }))
    })
  }))
}));

beforeAll(() => {
  Object.defineProperty(globalThis, 'devicePixelRatio', { value: 1, configurable: true });
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('PDF preview driver', () => {
  it('exposes direct PDF routes and driver support', () => {
    const routes = createPdfPreviewRoutes();
    const pdfRoute = routes.find((route) => route.extensions.includes('pdf'));
    const driver = createPdfPreviewDriver();

    expect(pdfRoute).toMatchObject({
      targetFormat: 'pdf',
      family: 'paged',
      driverId: 'pdf'
    });
    expect(pdfRoute?.conversion).toBeUndefined();
    expect(driver.supports('pdf')).toBe(true);
    expect(driver.supports('.PDF')).toBe(true);
    expect(driver.supports('pptx')).toBe(false);
  });

  it('renders PDF pages into borderless canvases', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const session = createPdfPreviewDriver().createSession(host, {
      initialScale: 1,
      fit: 'contain'
    });
    const renderedStates: unknown[] = [];

    session.on('rendered', (state) => {
      renderedStates.push(state);
    });

    await session.load(new Uint8Array([37, 80, 68, 70]), {
      descriptor: {
        source: new Uint8Array([37, 80, 68, 70]),
        name: 'sample.pdf',
        extension: 'pdf',
        contentType: 'application/pdf'
      }
    });

    const pages = host.querySelectorAll('canvas.pdfv-page');
    expect(pages).toHaveLength(2);
    expect(host.querySelector('iframe')).toBeNull();
    expect(render).toHaveBeenCalledTimes(2);

    expect(session.getState()).toMatchObject({
      family: 'paged',
      loading: false,
      pageIndex: 0,
      pageCount: 2,
      capabilities: {
        paged: true,
        print: true
      }
    });
    expect(renderedStates).toHaveLength(1);

    session.destroy();
    expect(destroy).toHaveBeenCalled();
    host.remove();
  });
});
