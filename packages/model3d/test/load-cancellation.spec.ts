import { Blob as NativeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import type { PreviewLoadContext, PreviewSource } from '@filens/core';
import { createBinaryStlFixture } from './fixtures/mesh.mjs';

const mocks = vi.hoisted(() => ({ parse: vi.fn(), factory: vi.fn(), read: vi.fn(), zip: vi.fn(), renderers: [] as any[] }));
vi.mock('three', async () => ({ ...await vi.importActual<typeof import('three')>('three'), WebGLRenderer: class {
  domElement = document.createElement('canvas'); setPixelRatio() {} setClearColor() {} setSize() {} render() {} dispose = vi.fn();
  constructor() { mocks.renderers.push(this); }
} }));
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({ GLTFLoader: class { parseAsync = mocks.parse; } }));
vi.mock('../vendor/occt-import-js/occt-import-js.js', () => ({ default: mocks.factory }));
vi.mock('../vendor/occt-import-js/occt-import-js.wasm?url', () => ({ default: '/occt.wasm' }));
vi.mock('jszip', () => ({ default: { loadAsync: mocks.zip } }));

const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const observe = (pending: Promise<unknown>) => {
  const result = { done: false, error: undefined as any };
  void pending.then(() => { result.done = true; }, error => { result.done = true; result.error = error; });
  return result;
};
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const context = (source: PreviewSource, name: string, signal?: AbortSignal): PreviewLoadContext => ({ descriptor: { source, name, extension: name.split('.').pop() }, signal });
let lib: typeof import('../src');
const sessions: import('../src').Model3dPreviewSession[] = [];
function setup() {
  const host = document.createElement('div'); document.body.append(host);
  const session = new lib.Model3dPreviewSession(host); sessions.push(session);
  const rendered = vi.fn(), errors = vi.fn(); session.on('rendered', rendered); session.on('error', errors);
  return { host, session, rendered, errors };
}
const current = async (session: import('../src').Model3dPreviewSession) => {
  const source = createBinaryStlFixture(2); await session.load(source, context(source, 'current.stl'));
};
const stepResult = () => ({ success: true, root: { meshes: [0] }, meshes: [{
  attributes: { position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0] } }, index: { array: [0, 1, 2] }
}] });
const modelXml = '<model><resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>';
function archiveFixture() {
  const entry = { name: '3D/3dmodel.model', dir: false, async: vi.fn(async () => modelXml) };
  return { archive: { file: () => entry, files: { [entry.name]: entry } }, entry };
}

beforeEach(async () => {
  vi.resetModules(); mocks.renderers.length = 0;
  mocks.parse.mockReset().mockResolvedValue({ scene: new Group() });
  mocks.read.mockReset().mockReturnValue(stepResult());
  mocks.factory.mockReset().mockResolvedValue({ ReadStepFile: mocks.read });
  mocks.zip.mockReset().mockResolvedValue(archiveFixture().archive);
  vi.stubGlobal('Blob', NativeBlob);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('URL', class extends URL { static revokeObjectURL = vi.fn(); });
  lib = await import('../src');
});
afterEach(() => { sessions.splice(0).forEach(session => session.destroy()); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

describe('top-level 3D input cancellation', () => {
  for (const kind of ['blob', 'fetch', 'body'] as const) {
    it.each(['replace', 'destroy', 'abort'] as const)(`settles a held ${kind} before %s releases its bytes`, async action => {
      const { host, session, rendered, errors } = setup(), held = deferred<any>(), controller = new AbortController();
      const cancel = vi.fn(async () => {}), read = vi.fn(() => held.promise);
      const response = { ok: true, arrayBuffer: kind === 'body' ? read : vi.fn(async () => createBinaryStlFixture(1).buffer), body: { cancel } };
      const source = kind === 'blob' ? new Blob() : '/old.stl';
      if (source instanceof Blob) Object.defineProperty(source, 'arrayBuffer', { value: read });
      const fetch = vi.fn(async () => kind === 'fetch' ? held.promise : response); vi.stubGlobal('fetch', fetch);
      const result = observe(session.load(source, context(source, 'old.stl', controller.signal)));
      if (kind === 'body') await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
      try {
        if (action === 'replace') await current(session); else if (action === 'destroy') session.destroy(); else controller.abort();
        await vi.waitFor(() => expect(result.done).toBe(true), { timeout: 500, interval: 5 });
        expect(result.error?.name).toBe(action === 'abort' ? 'AbortError' : undefined);
        expect(session.getState().loading).toBe(false); expect(errors).not.toHaveBeenCalled();
        expect(host.querySelectorAll('canvas')).toHaveLength(action === 'replace' ? 1 : 0);
        expect(rendered).toHaveBeenCalledTimes(action === 'replace' ? 1 : 0);
        if (kind !== 'blob') expect((fetch.mock.calls[0] as any)[1].signal.aborted).toBe(true);
        if (kind === 'body') expect(cancel).toHaveBeenCalledOnce();
      } finally {
        held.resolve(kind === 'fetch' ? response : createBinaryStlFixture(1).buffer); await flush();
      }
      if (kind === 'fetch') { expect(cancel).toHaveBeenCalledOnce(); expect(response.arrayBuffer).not.toHaveBeenCalled(); }
      expect(mocks.renderers).toHaveLength(action === 'replace' ? 1 : 0);
      expect(errors).not.toHaveBeenCalled();
      if (action === 'replace') expect(session.getState()).toMatchObject({ title: 'current.stl', error: null, metadata: { triangleCount: 2 } });
    });

    it(`observes a late ${kind} rejection after replacement has settled`, async () => {
      const { session, errors } = setup(), held = deferred<any>(), source = kind === 'blob' ? new Blob() : '/old.stl';
      const read = vi.fn(() => held.promise), cancel = vi.fn(async () => {});
      if (source instanceof Blob) Object.defineProperty(source, 'arrayBuffer', { value: read });
      vi.stubGlobal('fetch', vi.fn(() => kind === 'fetch' ? held.promise : Promise.resolve({ ok: true, arrayBuffer: read, body: { cancel } })));
      const result = observe(session.load(source, context(source, 'old.stl')));
      if (kind === 'body') await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
      try { await current(session); await vi.waitFor(() => expect(result.done).toBe(true), { timeout: 500, interval: 5 }); }
      finally { held.reject(new Error('late read failure')); await flush(); }
      expect(result.error).toBeUndefined(); expect(errors).not.toHaveBeenCalled();
      expect(session.getState()).toMatchObject({ title: 'current.stl', error: null, metadata: { triangleCount: 2 } });
    });
  }

  it.each(['http', 'body'] as const)('releases an unsuccessful %s response and reports its error', async kind => {
    const { session, errors } = setup(), cancel = vi.fn(async () => {});
    const read = vi.fn(async () => { throw new Error('body failed'); });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: kind !== 'http', status: 404, statusText: 'Not Found', arrayBuffer: read, body: { cancel } })));
    await expect(session.load('/missing.stl', context('/missing.stl', 'missing.stl'))).rejects.toThrow(kind === 'http' ? '404 Not Found' : 'body failed');
    expect(cancel).toHaveBeenCalledOnce(); expect(read).toHaveBeenCalledTimes(kind === 'http' ? 0 : 1);
    expect(errors).toHaveBeenCalledOnce(); expect(session.getState().loading).toBe(false); expect(mocks.renderers).toHaveLength(0);
  });

  it('keeps a successful response body and displayed-model signal alive until cancellation', async () => {
    const { host, session } = setup(), controller = new AbortController(), cancel = vi.fn(async () => {});
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => createBinaryStlFixture(1).buffer, body: { cancel } })));
    await session.load('/model.stl', context('/model.stl', 'model.stl', controller.signal));
    expect(cancel).not.toHaveBeenCalled(); expect(host.querySelector('canvas')).not.toBeNull();
    controller.abort(); expect(host.querySelector('canvas')).toBeNull(); expect(session.getState()).toMatchObject({ loading: false, error: null });
  });

  it.each(['buffer', 'view', 'data-view', 'shared-view'] as const)('snapshots the exact %s bytes before yielding to the caller', async kind => {
    const { session } = setup(), encoded = createBinaryStlFixture(1);
    const storage = kind === 'shared-view' ? new SharedArrayBuffer(encoded.length + 8) : new ArrayBuffer(encoded.length + 8);
    const bytes = new Uint8Array(storage); bytes.set(encoded, 4);
    const source = kind === 'buffer' ? bytes.slice(4, -4).buffer : kind === 'data-view' ? new DataView(storage, 4, encoded.length) : bytes.subarray(4, -4);
    const pending = session.load(source, context(source, 'snapshot.stl')); new Uint8Array(kind === 'buffer' ? source as ArrayBuffer : storage).fill(0);
    await pending; expect(session.getState()).toMatchObject({ error: null, metadata: { triangleCount: 1 } });
  });
});

describe('GLB parser cancellation', () => {
  it.each(['replace', 'destroy', 'abort'] as const)('settles before a delayed parser returns after %s and disposes every late scene once', async action => {
    const { host, session, errors, rendered } = setup(), held = deferred<any>(), controller = new AbortController();
    const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    const texture = new Texture(), material = new MeshStandardMaterial({ map: texture, normalMap: texture });
    const scenes = [new Group(), new Group()]; for (const scene of scenes) scene.add(new Mesh(geometry, material));
    scenes[1].userData.previewObjectUrls = ['blob:late-scene'];
    const dispose = [geometry, material, texture].map(value => vi.spyOn(value, 'dispose'));
    mocks.parse.mockReturnValueOnce(held.promise); const source = new ArrayBuffer(1);
    const result = observe(session.load(source, context(source, 'old.glb', controller.signal)));
    await vi.waitFor(() => expect(mocks.parse).toHaveBeenCalledOnce());
    try {
      if (action === 'replace') await current(session); else if (action === 'destroy') session.destroy(); else controller.abort();
      await vi.waitFor(() => expect(result.done).toBe(true), { timeout: 500, interval: 5 });
      expect(result.error?.name).toBe(action === 'abort' ? 'AbortError' : undefined);
    } finally { held.resolve({ scene: scenes[0], scenes }); await flush(); }
    for (const spy of dispose) expect(spy).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:late-scene');
    expect(errors).not.toHaveBeenCalled(); expect(rendered).toHaveBeenCalledTimes(action === 'replace' ? 1 : 0);
    expect(host.querySelectorAll('canvas')).toHaveLength(action === 'replace' ? 1 : 0);
  });

  it('observes a parser rejection after the cancelled load has already settled', async () => {
    const held = deferred<any>(), controller = new AbortController(); mocks.parse.mockReturnValueOnce(held.promise);
    const result = observe(lib.loadGlbObject(new ArrayBuffer(1), { signal: controller.signal }));
    try { controller.abort(); await vi.waitFor(() => expect(result.done).toBe(true), { timeout: 500, interval: 5 }); }
    finally { held.reject(new Error('late parser failure')); await flush(); }
    expect(result.error?.name).toBe('AbortError');
  });

  it('checks pre-abort before invoking the public GLB parser', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(lib.loadGlbObject(new ArrayBuffer(1), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.parse).not.toHaveBeenCalled();
  });
});

describe('shared STEP initialization cancellation', () => {
  it.each(['replace', 'destroy', 'abort'] as const)('skips stale STEP conversion after %s without cancelling the shared initializer', async action => {
    const { session, errors } = setup(), held = deferred<any>(), controller = new AbortController(); mocks.factory.mockReturnValueOnce(held.promise);
    const source = new ArrayBuffer(1), result = observe(session.load(source, context(source, 'old.step', controller.signal)));
    await vi.waitFor(() => expect(mocks.factory).toHaveBeenCalledOnce());
    const live = new AbortController(), second = lib.loadStepObject(new ArrayBuffer(2), { signal: live.signal });
    try {
      if (action === 'replace') await current(session); else if (action === 'destroy') session.destroy(); else controller.abort();
      await vi.waitFor(() => expect(result.done).toBe(true), { timeout: 500, interval: 5 });
      expect(result.error?.name).toBe(action === 'abort' ? 'AbortError' : undefined); expect(mocks.read).not.toHaveBeenCalled();
    } finally { held.resolve({ ReadStepFile: mocks.read }); await second; await flush(); }
    expect(mocks.factory).toHaveBeenCalledOnce(); expect(mocks.read).toHaveBeenCalledOnce();
    expect((mocks.read.mock.calls[0][0] as Uint8Array).byteLength).toBe(2); expect(errors).not.toHaveBeenCalled();
  });

  it('checks pre-abort before starting a WASM import', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(lib.loadStepObject(new ArrayBuffer(1), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.factory).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });

  it('observes late initialization failure and permits a subsequent STEP retry', async () => {
    const held = deferred<any>(), controller = new AbortController(); mocks.factory.mockReturnValueOnce(held.promise);
    const result = observe(lib.loadStepObject(new ArrayBuffer(1), { signal: controller.signal }));
    await vi.waitFor(() => expect(mocks.factory).toHaveBeenCalledOnce());
    try { controller.abort(); await vi.waitFor(() => expect(result.done).toBe(true), { timeout: 500, interval: 5 }); }
    finally { held.reject(new Error('WASM init failed')); await flush(); }
    expect(result.error?.name).toBe('AbortError');
    await lib.loadStepObject(new ArrayBuffer(2)); expect(mocks.factory).toHaveBeenCalledTimes(2); expect(mocks.read).toHaveBeenCalledOnce();
  });
});

describe('3MF archive cancellation', () => {
  for (const stage of ['index', 'entry'] as const) {
    it.each(['replace', 'destroy', 'abort'] as const)(`settles a pending 3MF ${stage} before %s and skips late XML`, async action => {
      const { session, errors } = setup(), held = deferred<any>(), controller = new AbortController(), { archive, entry } = archiveFixture();
      if (stage === 'index') mocks.zip.mockReturnValueOnce(held.promise); else { entry.async.mockReturnValueOnce(held.promise); mocks.zip.mockResolvedValueOnce(archive); }
      const source = new ArrayBuffer(1), result = observe(session.load(source, context(source, 'old.3mf', controller.signal)));
      await vi.waitFor(() => expect(stage === 'index' ? mocks.zip : entry.async).toHaveBeenCalledOnce());
      const parseXml = vi.spyOn(DOMParser.prototype, 'parseFromString');
      try {
        if (action === 'replace') await current(session); else if (action === 'destroy') session.destroy(); else controller.abort();
        await vi.waitFor(() => expect(result.done).toBe(true), { timeout: 500, interval: 5 });
        expect(result.error?.name).toBe(action === 'abort' ? 'AbortError' : undefined);
      } finally { held.resolve(stage === 'index' ? archive : modelXml); await flush(); }
      expect(parseXml).not.toHaveBeenCalled(); expect(errors).not.toHaveBeenCalled();
      if (stage === 'index') expect(entry.async).not.toHaveBeenCalled();
    });

    it(`observes a late 3MF ${stage} rejection after cancellation`, async () => {
      const held = deferred<any>(), controller = new AbortController(), { archive, entry } = archiveFixture();
      if (stage === 'index') mocks.zip.mockReturnValueOnce(held.promise); else { entry.async.mockReturnValueOnce(held.promise); mocks.zip.mockResolvedValueOnce(archive); }
      const result = observe(lib.load3mfGeometry(new ArrayBuffer(1), { signal: controller.signal }));
      await vi.waitFor(() => expect(stage === 'index' ? mocks.zip : entry.async).toHaveBeenCalledOnce());
      try { controller.abort(); await vi.waitFor(() => expect(result.done).toBe(true), { timeout: 500, interval: 5 }); }
      finally { held.reject(new Error('late archive failure')); await flush(); }
      expect(result.error?.name).toBe('AbortError');
    });
  }

  it.each(['load3mfGeometry', 'load3mfGeometryWithWarnings'] as const)('checks pre-abort in public %s before indexing', async name => {
    const controller = new AbortController(); controller.abort();
    await expect(lib[name](new ArrayBuffer(1), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.zip).not.toHaveBeenCalled();
  });
});
