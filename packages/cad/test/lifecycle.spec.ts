import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCadPreviewDriver } from '../src';
import type { PreviewLoadContext, PreviewOptions, PreviewSource } from '@filens/core';
import { createRasterDxfFixture, lineDxfFixture } from './fixtures/resources.mjs';

const context = (source: PreviewSource, name = 'drawing.dxf', signal?: AbortSignal): PreviewLoadContext =>
  ({ descriptor: { source, name, extension: name.split('.').pop() }, signal });
const bytes = (text = lineDxfFixture) => new TextEncoder().encode(text);
const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const sessions: ReturnType<ReturnType<typeof createCadPreviewDriver>['createSession']>[] = [];
const setup = (options?: PreviewOptions) => {
  const host = document.createElement('div'); document.body.append(host);
  const session = createCadPreviewDriver().createSession(host, options); sessions.push(session);
  return { host, session };
};
beforeEach(() => {
  let serial = 0;
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => `blob:owned-${++serial}`);
    static revokeObjectURL = vi.fn();
  });
});
afterEach(() => { sessions.splice(0).forEach(session => session.destroy()); vi.unstubAllGlobals(); document.body.replaceChildren(); });

describe('DXF load and raster resource lifetime', () => {
  it.each(['success', 'failure'])('discards a late source %s after replacement', async outcome => {
    const { host, session } = setup(), old = deferred<string>(), source = new Blob();
    Object.defineProperty(source, 'text', { value: () => old.promise });
    const error = vi.fn(); session.on('error', error);
    const pending = session.load(source, context(source, 'old.dxf')).catch(() => 'rejected');
    await session.load(bytes(), context(bytes(), 'current.dxf'));
    const html = host.innerHTML, state = session.getState();
    if (outcome === 'success') old.resolve(createRasterDxfFixture()); else old.reject(new Error('Obsolete failure'));
    expect(await pending).toBeUndefined(); expect(host.innerHTML).toBe(html); expect(session.getState()).toEqual(state);
    expect(error).not.toHaveBeenCalled();
  });

  it.each(['replace', 'destroy', 'abort'])('discards a late resource after %s without creating an orphan URL', async action => {
    const result = deferred<Blob>(), resolver = vi.fn(() => result.promise), { host, session } = setup({ resourceResolver: resolver });
    const controller = new AbortController(), source = bytes(createRasterDxfFixture(2)), error = vi.fn(); session.on('error', error);
    const pending = session.load(source, context(source, 'old.dxf', controller.signal)).then(() => 'done', error => error.name);
    await vi.waitFor(() => expect(resolver).toHaveBeenCalledTimes(1));
    if (action === 'replace') await session.load(bytes(), context(bytes(), 'current.dxf'));
    else if (action === 'destroy') session.destroy(); else controller.abort();
    result.resolve(new Blob(['image']));
    expect(await pending).toBe(action === 'abort' ? 'AbortError' : 'done');
    expect(resolver).toHaveBeenCalledTimes(1); expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    expect(host.querySelectorAll('svg')).toHaveLength(action === 'replace' ? 1 : 0);
    expect(session.getState().loading).toBe(false);
  });

  it('aborts the internal fetch when its source is replaced', async () => {
    const response = deferred<Response>(), fetch = vi.fn(() => response.promise), { session } = setup(); vi.stubGlobal('fetch', fetch);
    const pending = session.load('/old.dxf', context('/old.dxf'));
    const signal = (fetch.mock.calls[0] as any)[1]?.signal;
    await session.load(bytes(), context(bytes())); expect(signal).toBeInstanceOf(AbortSignal); expect(signal.aborted).toBe(true);
    response.resolve(new Response(createRasterDxfFixture())); await pending;
    expect(session.getState().layers?.map(layer => layer.id)).toEqual(['LINES']);
  });

  it('rejects pre-aborted input before reading and clears the displayed drawing on cancellation', async () => {
    const { host, session } = setup(), controller = new AbortController(), source = new Blob(), read = vi.fn();
    Object.defineProperty(source, 'text', { value: read }); controller.abort();
    await expect(session.load(source, context(source, 'abort.dxf', controller.signal))).rejects.toMatchObject({ name: 'AbortError' });
    expect(read).not.toHaveBeenCalled();
    const active = new AbortController(); await session.load(bytes(), context(bytes(), 'current.dxf', active.signal)); active.abort();
    expect(host.querySelector('svg')).toBeNull(); expect(session.getState()).toMatchObject({ loading: false, error: null, layers: [], activeLayerIds: [] });
  });

  it.each(['blob', 'bytes', 'slice', 'buffer', 'object'])('displays resolver %s and releases only session-owned URLs', async kind => {
    const source = bytes(createRasterDxfFixture()), raw = new Uint8Array([90, 1, 2, 3, 91]);
    const payload = kind === 'blob' ? new Blob([raw]) : kind === 'bytes' ? raw : kind === 'slice' ? raw.subarray(1, 4)
      : kind === 'buffer' ? new ArrayBuffer(4) : { source: new Blob([raw]), warnings: ['Raster warning'] };
    const { host, session } = setup({ resourceResolver: () => payload }); await session.load(source, context(source));
    expect(host.querySelector('image')?.getAttribute('href')).toBe('blob:owned-1'); expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(blob.size).toBe(kind === 'slice' ? 3 : kind === 'buffer' ? 4 : 5);
    if (kind === 'object') expect(session.getState().warnings).toEqual(['Raster warning']);
    await session.load(bytes(), context(bytes()));
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:owned-1');
    session.destroy(); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('keeps caller-owned blob URLs intact', async () => {
    const { session } = setup({ resourceResolver: () => 'blob:caller-owned' }), source = bytes(createRasterDxfFixture());
    await session.load(source, context(source)); session.destroy(); expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('releases previous resolver resources if a later resolver fails', async () => {
    const resolver = vi.fn().mockResolvedValueOnce(new Blob(['first'])).mockRejectedValueOnce(new Error('Missing second image'));
    const { host, session } = setup({ resourceResolver: resolver }), source = bytes(createRasterDxfFixture(2));
    await expect(session.load(source, context(source))).rejects.toThrow('Missing second image');
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:owned-1');
    expect(host.querySelector('svg')).toBeNull();
  });

  it('clears a previous drawing on invalid input and resets pan for the next drawing', async () => {
    const { host, session } = setup(); await session.load(bytes(), context(bytes())); session.pan?.(100, 50);
    await expect(session.load(bytes(), context(bytes(), 'bad.unsupported'))).rejects.toThrow('browser-native DXF');
    expect(host.querySelector('svg')).toBeNull(); expect(session.getState().layers).toEqual([]);
    await session.load(bytes(), context(bytes())); expect(host.querySelector('svg')?.style.transform).toBe('translate(0px, 0px) scale(1)');
  });

  it('decodes UTF-8 text in base64 data URLs', async () => {
    const { host, session } = setup(), binary = Array.from(bytes(createRasterDxfFixture()), byte => String.fromCharCode(byte)).join('');
    const source = `data:application/dxf;base64,${btoa(binary)}`; await session.load(source, context(source));
    expect(host.querySelector('text[data-layer="LABELS"]')?.textContent).toBe('配套图片 / Raster');
  });
});
