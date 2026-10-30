import { describe, expect, it, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { getDocument } from 'pdfjs-dist';
import { createPdfPreviewDriver, createPdfPreviewRoutes } from '../src';

const destroy = vi.fn(async () => undefined);
const render = vi.fn(() => ({ promise: Promise.resolve() }));

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(() => ({
    destroy,
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

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

afterAll(() => {
  vi.restoreAllMocks();
});

describe('PDF preview driver', () => {
  it('passes document passwords to PDF.js without trimming them', async () => {
    const session = createPdfPreviewDriver().createSession(document.createElement('div'));
    try {
      await session.load(new Uint8Array([37, 80]), { descriptor: { source: new Uint8Array(), password: ' 密码🔐 ' } });
      expect(getDocument).toHaveBeenCalledWith({ data: new Uint8Array([37, 80]), password: ' 密码🔐 ' });
      expect(session.getState()).not.toHaveProperty('password');
    } finally { session.destroy(); }
  });

  it.each([[1, 'password_required'], [2, 'password_invalid']])('maps PDF.js password reason %s to %s', async (code, expected) => {
    const task = { promise: Promise.reject(Object.assign(new Error('Password needed'), { name: 'PasswordException', code })), destroy };
    // Observe the rejection before the asynchronous source read completes.
    task.promise.catch(() => undefined);
    vi.mocked(getDocument).mockReturnValueOnce(task as never);
    const session = createPdfPreviewDriver().createSession(document.createElement('div'));
    try {
      await expect(session.load(new Uint8Array(), { descriptor: { source: new Uint8Array() } })).rejects.toMatchObject({ code: expected });
    } finally { session.destroy(); }
  });
  it('discovers renderer font identifiers after rendering without inventing original names or embedded provenance', async () => {
    const getTextContent = vi.fn(async () => ({ styles: { g_d0_f1: { fontFamily: 'serif', ascent: 0.8, descent: -0.2, vertical: false } } }));
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }), render, getTextContent };
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve({ numPages: 1, destroy, getPage: vi.fn(async () => page) }), destroy } as never);
    const session = createPdfPreviewDriver().createSession(document.createElement('div'));
    try {
      await session.load(new Uint8Array(), { descriptor: { source: new Uint8Array() } });
      await vi.waitFor(() => expect(session.getState().fonts).toMatchObject([{ fontId: 'g_d0_f1', fontFamily: 'serif', status: 'unknown', source: 'unknown' }]));
      expect(getTextContent).toHaveBeenCalledTimes(1);
      expect(session.getState().warnings).toEqual([]);
      session.destroy(); expect(session.getState().fonts).toEqual([]);
    } finally { session.destroy(); }
  });

  it('does not block the preview on slow font metadata or publish results from a replaced document', async () => {
    let resolve!: (value: unknown) => void;
    const getTextContent = vi.fn(() => new Promise(yes => { resolve = yes; }));
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }), render, getTextContent };
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve({ numPages: 1, destroy, getPage: vi.fn(async () => page) }), destroy } as never);
    const session = createPdfPreviewDriver().createSession(document.createElement('div'));
    try {
      await session.load(new Uint8Array(), { descriptor: { source: new Uint8Array(), name: 'old.pdf' } });
      expect(session.getState().loading).toBe(false);
      await session.load(new Uint8Array(), { descriptor: { source: new Uint8Array(), name: 'current.pdf' } });
      resolve({ styles: { obsolete: { fontFamily: 'Old Serif' } } });
      await Promise.resolve(); await Promise.resolve();
      expect(session.getState().fonts).toEqual([]);
      expect(session.getState().title).toBe('current.pdf');
    } finally { session.destroy(); }
  });

  it('keeps a rendered PDF usable when optional font metadata extraction fails', async () => {
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }), render,
      getTextContent: vi.fn(async () => { throw new Error('Metadata failed'); }) };
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve({ numPages: 1, destroy, getPage: vi.fn(async () => page) }), destroy } as never);
    const session = createPdfPreviewDriver().createSession(document.createElement('div'));
    try {
      await session.load(new Uint8Array(), { descriptor: { source: new Uint8Array() } });
      await vi.waitFor(() => expect(session.getState().warnings).toContain('Font metadata is unavailable for PDF page 1.'));
      expect(session.getState()).toMatchObject({ loading: false, error: null });
    } finally { session.destroy(); }
  });

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
      fit: 'contain',
      virtual: false
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

  it('renders only nearby pages, updates page controls and releases distant canvases', async () => {
    mockLayout();
    const host = document.createElement('div'); document.body.append(host);
    const session = createPdfPreviewDriver().createSession(host);
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }), render };
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve({ numPages: 100, destroy, getPage: vi.fn(async () => page) }), destroy } as never);
    await session.load(new Uint8Array(), { descriptor: { source: new Uint8Array(), name: 'long.pdf' } });
    expect(host.querySelectorAll('.pdfv-page-slot')).toHaveLength(100);
    expect(host.querySelectorAll('canvas')).toHaveLength(1);
    const first = host.querySelector('canvas')!;
    session.goToPage?.(50);
    await vi.waitFor(() => expect(host.querySelector('canvas[data-page-index="50"][data-rendered="true"]')).not.toBeNull());
    expect(session.getState().pageIndex).toBe(50);
    expect(host.querySelectorAll('canvas').length).toBeLessThanOrEqual(3);
    expect(first.width).toBe(0);
    session.next?.(); expect(session.getState().pageIndex).toBe(51);
    session.prev?.(); expect(session.getState().pageIndex).toBe(50);
    session.goToPage?.(NaN); expect(session.getState().pageIndex).toBe(50);
    session.destroy();
  });

  it('renders every visible page at low zoom and supports scale and fit changes', async () => {
    mockLayout();
    const host = document.createElement('div'); document.body.append(host);
    const session = createPdfPreviewDriver().createSession(host, { initialScale: 0.1 });
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }), render };
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve({ numPages: 20, destroy, getPage: vi.fn(async () => page) }), destroy } as never);
    await session.load(new Uint8Array(), { descriptor: { source: new Uint8Array() } });
    for (let index = 0; index < 8; index++) expect(host.querySelector(`canvas[data-page-index="${index}"][data-rendered="true"]`)).not.toBeNull();
    session.setScale?.(2);
    await vi.waitFor(() => expect(host.querySelector('canvas')?.width).toBe(900));
    session.fit?.('width');
    await vi.waitFor(() => expect(host.querySelector('canvas')?.width).toBe(1600));
    session.setScale?.(NaN); expect(session.getState().scale).toBe(2);
    session.destroy();
  });

  it('does not start PDF.js after a file read is aborted', async () => {
    let release!: (bytes: ArrayBuffer) => void;
    const source = new Blob([]);
    Object.defineProperty(source, 'arrayBuffer', { value: () => new Promise<ArrayBuffer>(resolve => { release = resolve; }) });
    const controller = new AbortController();
    const session = createPdfPreviewDriver().createSession(document.createElement('div'));
    const pending = session.load(source, { descriptor: { source }, signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    controller.abort(); release(new ArrayBuffer(0));
    await rejected;
    expect(getDocument).not.toHaveBeenCalled();
    expect(session.getState()).toMatchObject({ loading: false, error: null, pageCount: 0 });
    session.destroy();
  });

  it('cancels in-flight drawing and renders the current scale without an error', async () => {
    mockLayout();
    let reject!: (error: Error) => void;
    const cancel = vi.fn(() => reject(Object.assign(new Error('Cancelled'), { name: 'RenderingCancelledException' })));
    render.mockReturnValueOnce({ promise: new Promise<void>((_, fail) => { reject = fail; }), cancel } as never);
    const host = document.createElement('div'); document.body.append(host);
    const session = createPdfPreviewDriver().createSession(host), errors = vi.fn();
    session.on('error', errors);
    const pending = session.load(new Uint8Array(), { descriptor: { source: new Uint8Array() } });
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    session.setScale?.(2);
    await pending;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(host.querySelector('canvas[data-rendered="true"]')?.getAttribute('width')).toBe('900');
    expect(errors).not.toHaveBeenCalled();
    session.destroy();
  });

  it('destroys a pending PDF.js loading task on abort without emitting an error', async () => {
    let reject!: (error: Error) => void;
    const task = { promise: new Promise((_, fail) => { reject = fail; }), destroy: vi.fn(async () => reject(new Error('Loading aborted'))) };
    vi.mocked(getDocument).mockReturnValueOnce(task as never);
    const controller = new AbortController(), errors = vi.fn();
    const session = createPdfPreviewDriver().createSession(document.createElement('div'));
    session.on('error', errors);
    const pending = session.load(new Uint8Array(), { descriptor: { source: new Uint8Array() }, signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(getDocument).toHaveBeenCalled());
    controller.abort(); await rejected;
    expect(task.destroy).toHaveBeenCalledTimes(1);
    expect(errors).not.toHaveBeenCalled();
    session.destroy();
  });

  it('ignores a stale page result after switching documents', async () => {
    let release!: (value: unknown) => void;
    const oldPage = new Promise(resolve => { release = resolve; });
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve({ numPages: 100, destroy, getPage: () => oldPage }), destroy } as never);
    const host = document.createElement('div'), session = createPdfPreviewDriver().createSession(host);
    const pending = session.load(new Uint8Array(), { descriptor: { source: new Uint8Array(), name: 'old.pdf' } });
    await vi.waitFor(() => expect(getDocument).toHaveBeenCalledTimes(1));
    await session.load(new Uint8Array(), { descriptor: { source: new Uint8Array(), name: 'current.pdf' } });
    release({}); await pending;
    expect(session.getState()).toMatchObject({ title: 'current.pdf', pageCount: 2, error: null });
    expect(host.querySelectorAll('.pdfv-page-slot')).toHaveLength(2);
    session.destroy();
  });

  it('ignores an old background page failure after a new document loads', async () => {
    mockLayout();
    let reject!: (error: Error) => void;
    const delayedPage = new Promise((_, fail) => { reject = fail; });
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }), render };
    const getPage = vi.fn((number: number) => number === 1 ? Promise.resolve(page) : delayedPage);
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve({ numPages: 3, destroy, getPage }), destroy } as never);
    const host = document.createElement('div'); document.body.append(host);
    const session = createPdfPreviewDriver().createSession(host), errors = vi.fn();
    session.on('error', errors);
    await session.load(new Uint8Array(), { descriptor: { source: new Uint8Array(), name: 'old.pdf' } });
    await vi.waitFor(() => expect(getPage).toHaveBeenCalledWith(2));
    await session.load(new Uint8Array(), { descriptor: { source: new Uint8Array(), name: 'current.pdf' } });
    reject(new Error('Old worker failed'));
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(session.getState()).toMatchObject({ title: 'current.pdf', error: null, loading: false });
    expect(errors).not.toHaveBeenCalled();
    session.destroy();
  });
});

function mockLayout(): void {
  const offset = (element: HTMLElement) => {
    let top = 0;
    for (const sibling of Array.from(element.parentElement?.children ?? [])) {
      if (sibling === element) break;
      top += parseFloat((sibling as HTMLElement).style.height || '0') + 16;
    }
    return top;
  };
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function () { return (this as HTMLElement).classList.contains('pdfv-preview') ? 800 : 0; });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function () { return (this as HTMLElement).classList.contains('pdfv-preview') ? 600 : 0; });
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function () { return offset(this as HTMLElement); });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const element = this as HTMLElement;
    const top = element.classList.contains('pdfv-page-slot') ? offset(element) - (element.parentElement?.scrollTop ?? 0) : 0;
    const height = element.classList.contains('pdfv-page-slot') ? parseFloat(element.style.height) : 600;
    return { top, bottom: top + height, left: 0, right: 800, width: 800, height, x: 0, y: top, toJSON() {} };
  });
}
