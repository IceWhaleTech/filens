import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIworkViewer } from '../src/viewer/create-iwork-viewer';
import { IworkPreviewSession } from '../src/preview-driver';
import type { ParsedIworkDocument, ParsedNumbersDocument, ParsedNumbersSheet, ParsedPagesDocument } from '../src/types';

const mocks = vi.hoisted(() => ({ parse: vi.fn(), parseSheet: vi.fn(), cancel: vi.fn(), destroy: vi.fn() }));
vi.mock('../src/worker/client', () => ({ IworkWorkerClient: class {
  parse = mocks.parse; parseSheet = mocks.parseSheet; cancel = mocks.cancel; destroy = mocks.destroy;
} }));

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function pages(title = 'Current'): ParsedPagesDocument {
  return { kind: 'pages', title, warnings: [], media: {}, archive: { type: 'pages', records: {}, references: { outgoing: {}, incoming: {} }, dataEntries: {}, warnings: [] },
    pages: [{ id: title, index: 0, width: 800, height: 1000, blocks: [], canvas: { id: title, title, width: 800, height: 1000,
      slide: { id: title, index: 0, title, width: 800, height: 1000, items: [], warnings: [], background: { type: 'solid', color: '#ffffff' } } } }] };
}
function numbers(): ParsedNumbersDocument {
  const canvas = pages().pages[0].canvas;
  return { kind: 'numbers', warnings: [], media: {}, archive: { ...pages().archive, type: 'numbers' },
    sheets: [0, 1].map(index => ({ id: String(index), index, name: `Sheet ${index}`, loaded: index === 0, canvas,
      tables: [{ id: 'table', item: { id: 'table', columns: [100], rows: Array.from({ length: 200 }, () => 26),
        cells: [{ row: 0, column: 0, fill: { type: 'none' }, textFrame: { paragraphs: [{ runs: [{ text: 'Cell' }] }] } }] } as any }] })) };
}
const bytes = new Uint8Array([1, 2, 3]);
const host = () => document.body.appendChild(document.createElement('div'));
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); Object.values(mocks).forEach(mock => mock.mockReset()); document.body.replaceChildren(); });

describe('iWork load ownership', () => {
  for (const failure of [false, true]) {
    it(`ignores a replaced Blob's late ${failure ? 'failure' : 'success'}`, async () => {
      const pending = deferred<ArrayBuffer>(), blob = { size: 3, arrayBuffer: vi.fn(() => pending.promise) } as unknown as Blob;
      mocks.parse.mockResolvedValue(pages());
      const viewer = createIworkViewer(host()), rendered = vi.fn(), error = vi.fn();
      viewer.on('rendered', rendered); viewer.on('error', error);
      const old = viewer.preview(blob);
      await viewer.preview(bytes);
      await old;
      if (failure) pending.reject(new Error('Obsolete read')); else pending.resolve(bytes.buffer);
      await flush();
      expect(mocks.parse).toHaveBeenCalledTimes(1); expect(rendered).toHaveBeenCalledTimes(1); expect(error).not.toHaveBeenCalled();
      expect(viewer.getState().document).toMatchObject({ title: 'Current' }); viewer.destroy();
    });
  }
  for (const action of ['replace', 'abort', 'destroy'] as const) for (const failure of [false, true]) {
    it(`ignores a late worker ${failure ? 'error' : 'result'} after ${action}`, async () => {
      const pending = deferred<ParsedIworkDocument>(); mocks.parse.mockReturnValueOnce(pending.promise).mockResolvedValue(pages());
      const container = host(), viewer = createIworkViewer(container), controller = new AbortController(), error = vi.fn(), rendered = vi.fn();
      viewer.on('error', error); viewer.on('rendered', rendered);
      const old = viewer.preview(bytes, { signal: controller.signal }).then(() => 'done', error => error.name);
      await vi.waitFor(() => expect(mocks.parse).toHaveBeenCalledTimes(1));
      if (action === 'replace') await viewer.preview(bytes); else if (action === 'abort') controller.abort(); else viewer.destroy();
      expect(await old).toBe(action === 'abort' ? 'AbortError' : 'done');
      if (failure) pending.reject(new Error('Obsolete worker error')); else pending.resolve(pages('Obsolete'));
      await flush();
      expect(error).not.toHaveBeenCalled(); expect(rendered).toHaveBeenCalledTimes(action === 'replace' ? 1 : 0);
      expect(viewer.getState().document).toEqual(action === 'replace' ? pages() : null);
      if (action !== 'replace') expect(container.querySelector('.iworkv-page-shell')).toBeNull();
      viewer.destroy();
    });
  }
  it('never reads a pre-aborted source or leaves the session loading', async () => {
    const session = new IworkPreviewSession(host()), controller = new AbortController(), arrayBuffer = vi.fn(); controller.abort();
    await expect(session.load({ size: 3, arrayBuffer } as unknown as Blob, { signal: controller.signal, descriptor: {} })).rejects.toMatchObject({ name: 'AbortError' });
    expect(arrayBuffer).not.toHaveBeenCalled(); expect(mocks.parse).not.toHaveBeenCalled();
    expect(session.getState()).toMatchObject({ loading: false, error: null, pageCount: 0 }); session.destroy();
  });
  it('aborts the old network request when replaced', async () => {
    let signal!: AbortSignal;
    vi.stubGlobal('fetch', vi.fn((_source, options) => { signal = options.signal; return new Promise(() => {}); }));
    mocks.parse.mockResolvedValue(pages()); const viewer = createIworkViewer(host());
    const old = viewer.preview('/old.pages'); expect(signal.aborted).toBe(false);
    await viewer.preview(bytes); await old; expect(signal.aborted).toBe(true); viewer.destroy();
  });
  it('snapshots caller-owned ArrayBuffers before the first await', async () => {
    mocks.parse.mockResolvedValue(pages()); const viewer = createIworkViewer(host()), source = new Uint8Array([9, 8, 7]);
    const task = viewer.preview(source.buffer); source.fill(0); await task;
    expect([...mocks.parse.mock.calls[0][0]]).toEqual([9, 8, 7]); expect(source.byteLength).toBe(3); viewer.destroy();
  });
  for (const action of ['replace', 'abort', 'destroy'] as const) {
    it(`releases document image URLs on ${action}`, async () => {
      const create = vi.fn(() => 'blob:owned'), revoke = vi.fn();
      vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
      const doc = pages(); doc.media = { photo: { id: 'photo', path: 'photo.png', contentType: 'image/png', data: bytes } };
      doc.pages[0].canvas.slide.background = { type: 'picture', mediaId: 'photo' };
      mocks.parse.mockResolvedValueOnce(doc).mockResolvedValue(pages());
      const viewer = createIworkViewer(host()), controller = new AbortController(); await viewer.preview(bytes, { signal: controller.signal });
      expect(create).toHaveBeenCalledTimes(1);
      if (action === 'replace') await viewer.preview(bytes); else if (action === 'abort') controller.abort(); else viewer.destroy();
      expect(revoke).toHaveBeenCalledWith('blob:owned'); expect(revoke).toHaveBeenCalledTimes(1); viewer.destroy();
    });
  }
  it('updates the wrapper state when an already displayed workbook is cancelled', async () => {
    mocks.parse.mockResolvedValue(numbers()); const container = host(), session = new IworkPreviewSession(container), controller = new AbortController();
    const change = vi.fn(), error = vi.fn(); session.on('statechange', change); session.on('error', error);
    await session.load(bytes, { signal: controller.signal, descriptor: {} }); expect(session.getState().family).toBe('workbook');
    controller.abort(); expect(session.getState()).toMatchObject({ family: 'paged', pageCount: 0, loading: false, error: null });
    expect(container.querySelector('.xlsxv-grid')).toBeNull(); expect(change.mock.lastCall?.[0]).toEqual(session.getState()); expect(error).not.toHaveBeenCalled(); session.destroy();
  });
  it('clears destroyed state and prevents navigation or late source reads from reviving it', async () => {
    mocks.parse.mockResolvedValue(pages()); const container = host(), viewer = createIworkViewer(container);
    await viewer.preview(bytes); viewer.destroy(); viewer.goToPage(3); viewer.goToSheet(1); viewer.fit(); viewer.setScale(2);
    const arrayBuffer = vi.fn(); await expect(viewer.preview({ size: 3, arrayBuffer } as unknown as Blob)).rejects.toThrow('destroyed');
    expect(arrayBuffer).not.toHaveBeenCalled(); expect(container.childElementCount).toBe(0);
    expect(viewer.getState()).toMatchObject({ document: null, loading: false, pageCount: 0, sheetCount: 0 });
  });
  it('keeps ordinary parse errors in the existing error event API', async () => {
    mocks.parse.mockRejectedValue(new Error('Bad document')); const viewer = createIworkViewer(host()), error = vi.fn(); viewer.on('error', error);
    await expect(viewer.preview(bytes)).resolves.toBeUndefined(); expect(viewer.getState()).toMatchObject({ error: 'Bad document', loading: false, document: null });
    expect(error).toHaveBeenCalledTimes(1); viewer.destroy();
  });
});

describe('Numbers render and lazy-sheet ownership', () => {
  it('detaches old tab and row-scroll listeners on rerender and replacement', async () => {
    mocks.parse.mockResolvedValue(numbers()); const container = host(), viewer = createIworkViewer(container); await viewer.preview(bytes);
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('.xlsxv-sheet-tab')], grid = container.querySelector('.xlsxv-grid')!, table = container.querySelector<HTMLTableElement>('table')!;
    viewer.goToSheet(0);
    tabs[1].click(); grid.dispatchEvent(new Event('scroll'));
    expect(viewer.getState().currentSheet).toBe(0); expect(mocks.parseSheet).not.toHaveBeenCalled(); expect(table.tBodies[0].rows.length).toBe(100);
    await viewer.preview(bytes); tabs[1].click(); expect(viewer.getState().currentSheet).toBe(0); viewer.destroy();
  });
  it('does not let old sheet completion delete the new document sheet request', async () => {
    const oldSheet = deferred<ParsedNumbersSheet>(), newSheet = deferred<ParsedNumbersSheet>(), oldDoc = numbers(), newDoc = numbers();
    mocks.parse.mockResolvedValueOnce(oldDoc).mockResolvedValueOnce(newDoc);
    mocks.parseSheet.mockReturnValueOnce(oldSheet.promise).mockReturnValueOnce(newSheet.promise);
    const viewer = createIworkViewer(host()); await viewer.preview(bytes); viewer.goToSheet(1);
    await viewer.preview(bytes); viewer.goToSheet(1); oldSheet.resolve({ ...oldDoc.sheets[1], loaded: true, name: 'Obsolete' }); await flush();
    viewer.goToSheet(1); expect(mocks.parseSheet).toHaveBeenCalledTimes(2);
    newSheet.resolve({ ...newDoc.sheets[1], loaded: true, name: 'Current sheet' }); await flush();
    expect(viewer.getState().document).toMatchObject({ sheets: [{}, { name: 'Current sheet', loaded: true }] }); viewer.destroy();
  });
});
