import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocxPreviewDriver } from '../src';
import type { PreviewLoadContext, PreviewSource } from '@filens/core';

const mocks = vi.hoisted(() => ({ parse: vi.fn(), render: vi.fn(), legacyRender: vi.fn() }));
vi.mock('docx-preview', () => ({ parseAsync: mocks.parse, renderDocument: mocks.render, renderAsync: mocks.legacyRender }));
const pending = <T>() => { let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const context = (source: PreviewSource, name: string, signal?: AbortSignal): PreviewLoadContext => ({ descriptor: { source, name, extension: 'docx' }, signal });
const sessions: ReturnType<ReturnType<typeof createDocxPreviewDriver>['createSession']>[] = [];
const setup = () => { const host = document.createElement('div'); document.body.append(host);
  const session = createDocxPreviewDriver().createSession(host); sessions.push(session); return { host, session }; };
const render = async (doc: any, host: HTMLElement) => { const article = document.createElement('article'); article.className = 'docx'; article.textContent = doc.text; host.append(article); };
beforeEach(() => {
  mocks.parse.mockReset().mockImplementation(async () => ({ text: 'Current' }));
  mocks.render.mockReset().mockImplementation(render);
  mocks.legacyRender.mockReset().mockImplementation(async (source, host) => render(await mocks.parse(source), host));
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:owned'); static revokeObjectURL = vi.fn(); });
});
afterEach(() => { sessions.splice(0).forEach(session => session.destroy()); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

describe('DOCX asynchronous loading and resource lifetime', () => {
  it('keeps a newer document when the old parser resolves late', async () => {
    const { host, session } = setup(), old = pending<any>(); mocks.parse.mockImplementationOnce(() => old.promise);
    const first = session.load(new Blob(), context(new Blob(), 'old.docx'));
    await Promise.resolve(); await session.load(new Blob(), context(new Blob(), 'current.docx'));
    old.resolve({ text: 'Old' }); await first;
    expect(host.querySelectorAll('.docx')).toHaveLength(1); expect(host.textContent).toBe('Current');
    expect(session.getState()).toMatchObject({ title: 'current.docx', loading: false, error: null });
  });

  it('isolates a renderer already running when another document replaces it', async () => {
    const { host, session } = setup(), finish = pending<void>();
    mocks.render.mockImplementationOnce(async (doc, container) => { await finish.promise; await render({ text: 'Old' }, container); });
    mocks.legacyRender.mockImplementationOnce(async (source, container) => mocks.render(await mocks.parse(source), container));
    const first = session.load(new Blob(), context(new Blob(), 'old.docx'));
    await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(1));
    await session.load(new Blob(), context(new Blob(), 'current.docx'));
    finish.resolve(); await first;
    expect(host.querySelectorAll('.docx')).toHaveLength(1); expect(host.textContent).toBe('Current');
  });

  it.each(['destroy', 'abort'] as const)('discards late rendering after %s', async action => {
    const { host, session } = setup(), finish = pending<void>(), controller = new AbortController();
    const rendered = vi.fn(), error = vi.fn(); session.on('rendered', rendered); session.on('error', error);
    mocks.render.mockImplementationOnce(async (doc, container) => { await finish.promise; await render(doc, container); });
    mocks.legacyRender.mockImplementationOnce(async (source, container) => mocks.render(await mocks.parse(source), container));
    const load = session.load(new Blob(), context(new Blob(), 'old.docx', controller.signal));
    await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(1));
    if (action === 'destroy') session.destroy(); else controller.abort();
    const settled = load.catch(error => { expect(action).toBe('abort'); expect(error.name).toBe('AbortError'); });
    finish.resolve(); await settled;
    expect(host.querySelector('.docx')).toBeNull(); expect(rendered).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    expect(session.getState().loading).toBe(false);
  });

  it('does not emit an error from an obsolete parser failure', async () => {
    const { session } = setup(), old = pending<any>(), error = vi.fn(); session.on('error', error);
    mocks.parse.mockImplementationOnce(() => old.promise);
    const first = session.load(new Blob(), context(new Blob(), 'old.docx')).catch(() => {});
    await Promise.resolve(); await session.load(new Blob(), context(new Blob(), 'current.docx'));
    old.reject(new Error('Old failure')); await first;
    expect(error).not.toHaveBeenCalled(); expect(session.getState()).toMatchObject({ title: 'current.docx', error: null });
  });

  it('cancels an obsolete network request with a session-owned signal', async () => {
    const { session } = setup(), response = pending<Response>();
    const fetch = vi.fn(() => response.promise); vi.stubGlobal('fetch', fetch);
    const first = session.load('/old.docx', context('/old.docx', 'old.docx'));
    await Promise.resolve(); const signal = (fetch.mock.calls[0] as any)[1]?.signal;
    await session.load(new Blob(), context(new Blob(), 'current.docx'));
    expect(signal).toBeInstanceOf(AbortSignal); expect(signal.aborted).toBe(true);
    response.resolve(new Response(new Uint8Array([80, 75]))); await first;
  });

  it('rejects a pre-aborted source before invoking the parser', async () => {
    const { session } = setup(), controller = new AbortController(); controller.abort();
    await expect(session.load(new Blob(), context(new Blob(), 'abort.docx', controller.signal))).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.parse).not.toHaveBeenCalled(); expect(session.getState()).toMatchObject({ loading: false, error: null });
  });

  it('releases embedded image, numbering and font URLs when a load is replaced', async () => {
    const { session } = setup();
    const doc = { loadDocumentImage: vi.fn(async () => 'blob:image'), loadNumberingImage: vi.fn(async () => 'blob:bullet'), loadFont: vi.fn(async () => 'blob:font') };
    mocks.parse.mockResolvedValueOnce(doc);
    const renderResources = async (doc: any) => { await doc.loadDocumentImage('image'); await doc.loadNumberingImage('bullet'); await doc.loadFont('font', 'key'); };
    mocks.render.mockImplementationOnce(renderResources); mocks.legacyRender.mockImplementationOnce(async source => renderResources(await mocks.parse(source)));
    await session.load(new Blob(), context(new Blob(), 'old.docx'));
    await session.load(new Blob(), context(new Blob(), 'current.docx'));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:image'); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:bullet'); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:font');
  });

  it('deduplicates repeated image references but keeps header/body parts distinct', async () => {
    const { session } = setup(), body = {}, header = {};
    const image = vi.fn(async (_id, part) => part === header ? 'blob:header' : 'blob:body');
    const doc = { documentPart: body, loadDocumentImage: image };
    mocks.parse.mockResolvedValueOnce(doc);
    const renderResources = async (doc: any) => { await Promise.all([doc.loadDocumentImage('rId1'), doc.loadDocumentImage('rId1', body), doc.loadDocumentImage('rId1', header)]); };
    mocks.render.mockImplementationOnce(renderResources); mocks.legacyRender.mockImplementationOnce(async source => renderResources(await mocks.parse(source)));
    await session.load(new Blob(), context(new Blob(), 'images.docx'));
    expect(image).toHaveBeenCalledTimes(2); session.destroy();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('releases a resource which resolves after cancellation', async () => {
    const { session } = setup(), late = pending<string>(), controller = new AbortController();
    mocks.parse.mockResolvedValueOnce({ loadDocumentImage: () => late.promise });
    const renderResources = async (doc: any) => { await doc.loadDocumentImage('image'); };
    mocks.render.mockImplementationOnce(renderResources); mocks.legacyRender.mockImplementationOnce(async source => renderResources(await mocks.parse(source)));
    const load = session.load(new Blob(), context(new Blob(), 'old.docx', controller.signal));
    await vi.waitFor(() => expect(mocks.parse).toHaveBeenCalledTimes(1)); await Promise.resolve(); controller.abort();
    const settled = load.catch(error => expect(error.name).toBe('AbortError'));
    late.resolve('blob:late'); await settled;
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:late');
  });
  it.each(['array-buffer', 'view', 'data-view', 'shared-view'] as const)('snapshots the exact %s input before the caller changes it', async kind => {
    const { session } = setup();
    const buffer = kind === 'shared-view' ? new SharedArrayBuffer(12) : new ArrayBuffer(12);
    const bytes = new Uint8Array(buffer); bytes.fill(91); bytes.set([80, 75, 3, 4], 3);
    const source = kind === 'array-buffer' ? buffer as ArrayBuffer : kind === 'data-view' ? new DataView(buffer, 3, 4) : new Uint8Array(buffer, 3, 4);
    const expected = kind === 'array-buffer' ? [...bytes] : [80, 75, 3, 4];
    const load = session.load(source, context(source, 'bytes.docx')); bytes.fill(0); await load;
    expect([...new Uint8Array(mocks.parse.mock.calls[0][0])]).toEqual(expected);
  });

  it('reports a current rendering failure and releases resources already created', async () => {
    const { host, session } = setup(), error = vi.fn(); session.on('error', error);
    mocks.parse.mockResolvedValueOnce({ loadDocumentImage: async () => 'blob:failed' });
    mocks.render.mockImplementationOnce(async doc => { await doc.loadDocumentImage('image'); throw new Error('Render failed'); });
    await expect(session.load(new Blob(), context(new Blob(), 'bad.docx'))).rejects.toThrow('Render failed');
    expect(error).toHaveBeenCalledTimes(1); expect(session.getState()).toMatchObject({ loading: false, error: 'Render failed' });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:failed'); expect(host.querySelector('.docxv-document')).toBeNull();
  });

});
