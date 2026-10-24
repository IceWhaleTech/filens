import { Blob as NativeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreviewLoadContext, PreviewOptions, PreviewSource } from '@filens/core';
import { ArchivePreviewSession, createArchiveResourceIndex } from '../src';

const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('@filens/core', async importOriginal => ({ ...await importOriginal<typeof import('@filens/core')>(), openZipArchive: mocks.open }));
const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const observe = (pending: Promise<unknown>) => {
  const result = { done: false, error: undefined as any };
  void pending.then(() => { result.done = true; }, error => { result.done = true; result.error = error; }); return result;
};
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const encode = (value: string) => new TextEncoder().encode(value);
const context = (source: PreviewSource = new Uint8Array([1]), name = 'current.zip', signal?: AbortSignal): PreviewLoadContext => ({ descriptor: { source, name, extension: 'zip' }, signal });
function archive(files: Record<string, string | Uint8Array | ReturnType<typeof vi.fn>> = { 'current.txt': 'current' }) {
  return new Map(Object.entries(files).map(([name, value]) => [name, { name, directory: name.endsWith('/'), size: typeof value === 'string' ? encode(value).length : 3, modified: 1700000000000,
    bytes: typeof value === 'function' ? value : vi.fn(async () => typeof value === 'string' ? encode(value) : value) }]));
}
const sessions: ArchivePreviewSession[] = [];
function setup(options: PreviewOptions = {}) {
  const host = document.createElement('div'); document.body.append(host);
  const session = new ArchivePreviewSession(host, options); sessions.push(session);
  const errors = vi.fn(), rendered = vi.fn(), warnings = vi.fn(); session.on('error', errors); session.on('rendered', rendered); session.on('warnings', warnings);
  return { host, session, errors, rendered, warnings, raw: session as any };
}
function childFactory(held?: Promise<void>) {
  const children: any[] = [], options: PreviewOptions[] = [];
  const factory = vi.fn((_host: HTMLElement, value: PreviewOptions) => {
    options.push(value); const callbacks: Record<string, (value: any) => void> = {}, unsubscribes: any[] = [];
    const child = { preview: vi.fn(() => held ?? Promise.resolve()), destroy: vi.fn(), getState: () => ({ error: null }),
      on: vi.fn((event: string, callback: any) => { callbacks[event] = callback; const unsubscribe = vi.fn(); unsubscribes.push(unsubscribe); return unsubscribe; }), callbacks, unsubscribes };
    children.push(child); return child as any;
  });
  return { factory, children, options };
}
async function load(session: ArchivePreviewSession, name = 'current.zip', signal?: AbortSignal) { const source = new Uint8Array([1]); await session.load(source, context(source, name, signal)); }

beforeEach(() => {
  mocks.open.mockReset().mockResolvedValue(archive());
  vi.stubGlobal('Blob', NativeBlob);
  let count = 0;
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => `blob:archive-${++count}`); static revokeObjectURL = vi.fn(); });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}); vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(() => { sessions.splice(0).forEach(session => session.destroy()); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

describe('archive source lifetime', () => {
  for (const stage of ['blob', 'fetch', 'body', 'index'] as const) {
    it.each(['replace', 'destroy', 'abort'] as const)(`settles a held ${stage} before %s releases the old archive`, async action => {
      const { session, host, errors, rendered } = setup(), held = deferred<any>(), controller = new AbortController(), cancel = vi.fn(async () => {});
      const read = vi.fn(() => held.promise), response = { ok: true, arrayBuffer: stage === 'body' ? read : vi.fn(async () => new ArrayBuffer(1)), body: { cancel } };
      const source = stage === 'blob' ? new Blob() : stage === 'fetch' || stage === 'body' ? '/old.zip' : new Uint8Array([1]);
      if (source instanceof Blob) Object.defineProperty(source, 'arrayBuffer', { value: read });
      if (stage === 'index') mocks.open.mockReturnValueOnce(held.promise);
      const fetch = vi.fn(() => stage === 'fetch' ? held.promise : Promise.resolve(response)); vi.stubGlobal('fetch', fetch);
      const result = observe(session.load(source, context(source, 'old.zip', controller.signal)));
      if (stage === 'body') await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
      if (stage === 'index') await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledOnce());
      try {
        if (action === 'replace') await load(session); else if (action === 'destroy') session.destroy(); else controller.abort();
        await vi.waitFor(() => expect(result.done).toBe(true), { timeout: 500, interval: 5 });
        expect(result.error?.name).toBe(action === 'abort' ? 'AbortError' : undefined); expect(session.getState().loading).toBe(false);
        expect(errors).not.toHaveBeenCalled(); expect(rendered).toHaveBeenCalledTimes(action === 'replace' ? 1 : 0);
      } finally { held.resolve(stage === 'fetch' ? response : stage === 'index' ? archive({ 'old.txt': 'old' }) : new ArrayBuffer(1)); await flush(); }
      expect(host.textContent).not.toContain('old.txt'); expect(errors).not.toHaveBeenCalled();
      if (action === 'replace') expect(session.getState()).toMatchObject({ title: 'current.zip', entries: [{ name: 'current.txt' }] });
      else expect(session.getState().entries).toEqual([]);
      if (stage === 'body' || stage === 'fetch') expect(cancel).toHaveBeenCalledOnce();
      if (stage === 'fetch') expect(response.arrayBuffer).not.toHaveBeenCalled();
    });

    it(`observes a late ${stage} rejection after replacement`, async () => {
      const { session, errors } = setup(), held = deferred<any>(), read = vi.fn(() => held.promise);
      const source = stage === 'blob' ? new Blob() : stage === 'index' ? new Uint8Array([1]) : '/old.zip';
      if (source instanceof Blob) Object.defineProperty(source, 'arrayBuffer', { value: read });
      if (stage === 'index') mocks.open.mockReturnValueOnce(held.promise);
      vi.stubGlobal('fetch', vi.fn(() => stage === 'fetch' ? held.promise : Promise.resolve({ ok: true, arrayBuffer: read, body: { cancel: async () => {} } })));
      const result = observe(session.load(source, context(source, 'old.zip')));
      if (stage === 'body' || stage === 'index') await vi.waitFor(() => expect(stage === 'body' ? read : mocks.open).toHaveBeenCalledOnce());
      try { await load(session); await vi.waitFor(() => expect(result.done).toBe(true), { timeout: 500, interval: 5 }); }
      finally { held.reject(new Error('obsolete failure')); await flush(); }
      expect(result.error).toBeUndefined(); expect(errors).not.toHaveBeenCalled(); expect(session.getState().error).toBeNull();
    });
  }

  it.each(['http', 'body'] as const)('releases a failed %s response and keeps the original error', async kind => {
    const { session } = setup(), cancel = vi.fn(async () => { throw new Error('cancel failed'); });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: kind !== 'http', status: 404, statusText: 'Not Found', arrayBuffer: async () => { throw new Error('body failed'); }, body: { cancel } })));
    await expect(session.load('/missing.zip', context('/missing.zip'))).rejects.toThrow(kind === 'http' ? '404 Not Found' : 'body failed');
    expect(cancel).toHaveBeenCalledOnce(); expect(session.getState().loading).toBe(false);
  });

  it.each(['session', 'index'] as const)('checks pre-abort before a %s source read or ZIP open', async kind => {
    const { session } = setup(), controller = new AbortController(), source = new Blob(), read = vi.fn(); controller.abort();
    Object.defineProperty(source, 'arrayBuffer', { value: read });
    const pending = kind === 'session' ? session.load(source, context(source, 'abort.zip', controller.signal)) : createArchiveResourceIndex(source, context(source, 'abort.zip', controller.signal));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(read).not.toHaveBeenCalled(); expect(mocks.open).not.toHaveBeenCalled();
  });

  it.each(['buffer', 'slice', 'shared-view'] as const)('snapshots exact %s input bytes before the first await', async kind => {
    const storage = kind === 'shared-view' ? new SharedArrayBuffer(5) : new ArrayBuffer(5), bytes = new Uint8Array(storage); bytes.set([9, 1, 2, 3, 8]);
    const source = kind === 'buffer' ? bytes.slice(1, 4).buffer : bytes.subarray(1, 4);
    const pending = createArchiveResourceIndex(source, context(source)); new Uint8Array(kind === 'buffer' ? source as ArrayBuffer : storage).fill(0); await pending;
    expect([...mocks.open.mock.calls[0][0]]).toEqual([1, 2, 3]);
  });
});

describe('archive navigation and embedded previews', () => {
  it.each(['back', 'directory', 'replace', 'destroy', 'abort', 'second'] as const)('settles an entry read before %s and cannot restore the old preview', async action => {
    const held = deferred<Uint8Array>(), read = vi.fn(() => held.promise), { host, session, raw, errors } = setup(), controller = new AbortController();
    mocks.open.mockResolvedValue(archive({ 'old.txt': read, 'next.txt': 'new entry', 'docs/readme.txt': 'docs' })); await load(session, 'bundle.zip', controller.signal);
    const result = observe(raw.openEntryPreview('old.txt')); await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    try {
      if (action === 'back') { const back = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Back to archive')!; expect(back.disabled).toBe(false); back.click(); }
      else if (action === 'directory') raw.setRoute('/docs/'); else if (action === 'replace') await load(session);
      else if (action === 'destroy') session.destroy(); else if (action === 'abort') controller.abort(); else await raw.openEntryPreview('next.txt');
      await vi.waitFor(() => expect(result.done).toBe(true), { timeout: 500, interval: 5 });
    } finally { held.resolve(encode('obsolete content')); await flush(); }
    expect(result.error).toBeUndefined(); expect(host.textContent).not.toContain('obsolete content'); expect(errors).not.toHaveBeenCalled(); expect(session.getState().loading).toBe(false);
    if (action === 'second') expect(host.querySelector('.archivev-entry-text')?.textContent).toBe('new entry');
    if (action === 'directory') expect(session.getState().route).toBe('/docs/');
  });

  for (const stage of ['read', 'index'] as const) {
    it.each(['back', 'replace', 'destroy'] as const)(`settles a nested archive ${stage} before %s and preserves the correct stack`, async action => {
      const held = deferred<any>(), read = vi.fn(() => stage === 'read' ? held.promise : Promise.resolve(new Uint8Array([2])));
      const { session, raw, errors, host } = setup(); mocks.open.mockResolvedValueOnce(archive({ 'inner.zip': read })); await load(session, 'outer.zip');
      if (stage === 'index') mocks.open.mockReturnValueOnce(held.promise);
      const result = observe(raw.openNestedArchive('inner.zip'));
      await vi.waitFor(() => expect(stage === 'read' ? read : mocks.open).toHaveBeenCalledTimes(stage === 'read' ? 1 : 2));
      try {
        if (action === 'back') raw.closeEntryPreview(); else if (action === 'replace') await load(session); else session.destroy();
        await vi.waitFor(() => expect(result.done).toBe(true), { timeout: 500, interval: 5 });
      } finally { held.resolve(stage === 'read' ? new Uint8Array([2]) : archive({ 'late.txt': 'late' })); await flush(); }
      expect(errors).not.toHaveBeenCalled(); expect(host.textContent).not.toContain('late.txt'); expect(raw.archiveStack).toHaveLength(action === 'destroy' ? 0 : 1);
      if (action === 'back') expect(host.querySelector('.archivev-breadcrumb')?.textContent).toBe('outer.zip');
    });
  }

  it.each(['back', 'replace', 'destroy', 'abort', 'second'] as const)('destroys the prior child and ignores its late events after %s', async action => {
    const held = deferred<void>(), child = childFactory(held.promise), { session, raw, errors, warnings } = setup({ previewerFactory: child.factory }), controller = new AbortController();
    mocks.open.mockResolvedValue(archive({ 'old.txt': 'old', 'next.txt': 'next' })); await load(session, 'bundle.zip', controller.signal);
    const result = observe(raw.openEntryPreview('old.txt')); await vi.waitFor(() => expect(child.children).toHaveLength(1)); const old = child.children[0];
    try {
      if (action === 'back') raw.closeEntryPreview(); else if (action === 'replace') await load(session); else if (action === 'destroy') session.destroy(); else if (action === 'abort') controller.abort();
      else { void raw.openEntryPreview('next.txt'); await vi.waitFor(() => expect(child.children).toHaveLength(2)); }
      await vi.waitFor(() => expect(result.done).toBe(true), { timeout: 500, interval: 5 });
      expect(old.destroy).toHaveBeenCalledOnce(); old.unsubscribes.forEach((unsubscribe: any) => expect(unsubscribe).toHaveBeenCalledOnce());
      old.callbacks.error(new Error('old child error')); old.callbacks.warnings(['old child warning']);
      expect(errors).not.toHaveBeenCalled(); expect(warnings).not.toHaveBeenCalled(); expect(session.getState().error).toBeNull();
    } finally { held.resolve(); await flush(); }
  });

  it('forwards preview options and resolves relative, parent, encoded and root assets from the entry directory', async () => {
    const child = childFactory(), fontResolver = vi.fn(), external = vi.fn(async () => ({ source: '/external.png' }));
    const { session, raw } = setup({ previewerFactory: child.factory, resourceResolver: external, fontResolver, fit: 'width', initialScale: 1.5 });
    mocks.open.mockResolvedValue(archive({ 'models/scene.gltf': '{}', 'models/textures/色 图.png': 'relative', 'textures/parent.png': 'parent', 'root.png': 'root', 'elsewhere/shared.png': 'unrelated' }));
    await load(session); raw.setRoute('/models/'); await raw.openEntryPreview('scene.gltf');
    expect(child.options[0]).toMatchObject({ fontResolver, fit: 'width', initialScale: 1.5, previewerFactory: child.factory });
    const resolver = child.options[0].resourceResolver!;
    for (const [source, expected] of [['./textures/色%20图.png?version=1#preview', 'relative'], ['../textures/parent.png', 'parent'], ['/root.png', 'root'], ['models/textures/色 图.png', 'relative']]) {
      const resolved = await resolver({ source }) as any; expect(new TextDecoder().decode(resolved.source)).toBe(expected);
    }
    await expect(resolver({ source: 'shared.png' })).resolves.toEqual({ source: '/external.png' });
    await expect(resolver({ source: 'https://example.test/root.png' })).resolves.toEqual({ source: '/external.png' }); expect(external).toHaveBeenCalledTimes(2);
  });

  it('cannot resolve assets from a replacement archive using an obsolete child resolver', async () => {
    const child = childFactory(), { session, raw } = setup({ previewerFactory: child.factory });
    mocks.open.mockResolvedValueOnce(archive({ 'scene.gltf': '{}', 'shared.bin': 'old' })); await load(session); await raw.openEntryPreview('scene.gltf');
    const resolver = child.options[0].resourceResolver!, nextRead = vi.fn(async () => encode('new'));
    mocks.open.mockResolvedValueOnce(archive({ 'shared.bin': nextRead })); await load(session, 'replacement.zip');
    await expect(resolver({ source: 'shared.bin' })).rejects.toMatchObject({ name: 'AbortError' }); expect(nextRead).not.toHaveBeenCalled();
  });

  it('settles a held external child resource lookup on close and observes late errors', async () => {
    const held = deferred<any>(), child = childFactory(), { session, raw, errors } = setup({ previewerFactory: child.factory, resourceResolver: () => held.promise });
    mocks.open.mockResolvedValueOnce(archive({ 'scene.gltf': '{}' })); await load(session); await raw.openEntryPreview('scene.gltf');
    const result = observe(Promise.resolve(child.options[0].resourceResolver!({ source: 'missing.bin' })));
    try { raw.closeEntryPreview(); await vi.waitFor(() => expect(result.done).toBe(true), { timeout: 500, interval: 5 }); }
    finally { held.reject(new Error('late external error')); await flush(); }
    expect(result.error?.name).toBe('AbortError'); expect(errors).not.toHaveBeenCalled();
  });

  it('ignores detached directory rows and breadcrumbs when a new archive has opened', async () => {
    const { session, host, raw } = setup(); mocks.open.mockResolvedValueOnce(archive({ 'docs/a.txt': 'a', 'root.txt': 'root' })); await load(session);
    const oldRow = host.querySelector('tr.archivev-row')!; raw.setRoute('/docs/'); const oldBreadcrumb = host.querySelector('button.archivev-breadcrumb')!;
    await load(session, 'replacement.zip');
    for (const activate of [() => oldRow.dispatchEvent(new MouseEvent('click')), () => oldRow.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })), () => oldBreadcrumb.dispatchEvent(new MouseEvent('click'))]) {
      activate(); expect(session.getState()).toMatchObject({ title: 'replacement.zip', route: '/', entries: [{ name: 'current.txt' }] });
    }
  });

  it('does not preserve caller mutations in cached directory listings', async () => {
    const { session, raw } = setup(); mocks.open.mockResolvedValueOnce(archive({ 'docs/a.txt': 'a' })); await load(session); session.getState().entries[0].name = 'mutated';
    raw.setRoute('/docs/'); raw.setRoute('/'); expect(session.getState().entries[0].name).toBe('docs/');
  });
});

describe('archive extraction and fallback resource lifetime', () => {
  it.each(['readAsArrayBuffer', 'readAsBlob', 'readAsText', 'resolve'] as const)('cancels a held %s extraction before its bytes arrive', async method => {
    const held = deferred<Uint8Array>(), read = vi.fn(() => held.promise), controller = new AbortController(); mocks.open.mockResolvedValueOnce(archive({ 'held.txt': read }));
    const index = await createArchiveResourceIndex(new Uint8Array([1]), context(undefined, 'bundle.zip', controller.signal));
    const result = observe(method === 'resolve' ? Promise.resolve(index.resolve({ source: 'held.txt' })) : index.files[0][method]());
    try { controller.abort(); await vi.waitFor(() => expect(result.done).toBe(true), { timeout: 500, interval: 5 }); }
    finally { held.resolve(encode('late')); await flush(); }
    expect(result.error?.name).toBe('AbortError'); expect(read).toHaveBeenCalledOnce();
    await expect(index.files[0].readAsText()).rejects.toMatchObject({ name: 'AbortError' }); expect(read).toHaveBeenCalledOnce();
  });

  it.each([['png', 'image/png'], ['pdf', 'application/pdf'], ['mp4', 'video/mp4'], ['mp3', 'audio/mpeg'], ['wav', 'audio/wav']] as const)('assigns %s entries their usable MIME type', async (extension, type) => {
    mocks.open.mockResolvedValueOnce(archive({ ['file.' + extension]: 'bytes' }));
    const index = await createArchiveResourceIndex(new Uint8Array([1]), context()); expect(index.files[0].contentType).toBe(type); expect((await index.files[0].readAsBlob()).type).toBe(type);
  });

  it.each(['png', 'mp4', 'wav'] as const)('clears and releases a %s fallback when switching entries', async extension => {
    const { session, raw, host } = setup(); mocks.open.mockResolvedValueOnce(archive({ ['asset.' + extension]: 'bytes', 'next.txt': 'next' })); await load(session);
    await raw.openEntryPreview('asset.' + extension); const old = host.querySelector('img, audio, video') as HTMLMediaElement;
    expect(old).not.toBeNull(); await raw.openEntryPreview('next.txt');
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce(); expect(old.isConnected).toBe(false); expect(host.querySelector('.archivev-entry-text')?.textContent).toBe('next');
    if (extension !== 'png') { expect(old.getAttribute('src')).toBeNull(); expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledOnce(); expect(HTMLMediaElement.prototype.load).toHaveBeenCalledOnce(); }
  });
});
