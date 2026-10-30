import { Blob as NativeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BufferGeometry, Group, Mesh, MeshStandardMaterial, Texture } from 'three';

const mocks = vi.hoisted(() => ({ parse: vi.fn(), factory: vi.fn(), read: vi.fn() }));
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({ GLTFLoader: class { parseAsync = mocks.parse; } }));
vi.mock('../vendor/occt-import-js/occt-import-js.js', () => ({ default: mocks.factory }));
vi.mock('../src/rust-step-importer', () => ({ createRustStepImporter: mocks.factory }));
vi.mock('../vendor/occt-import-js/occt-import-js.wasm?url', () => ({ default: '/occt.wasm' }));

const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const source = (uris = ['mesh.bin']) => JSON.stringify({ asset: { version: '2.0' }, buffers: uris.map(uri => ({ uri, byteLength: 3 })) });
let lib: typeof import('../src/preview-driver');
let blobs: Map<string, NativeBlob>;

beforeEach(async () => {
  vi.resetModules();
  blobs = new Map();
  vi.stubGlobal('Blob', NativeBlob);
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn((blob: NativeBlob) => { const url = `blob:owned-${blobs.size}`; blobs.set(url, blob); return url; });
    static revokeObjectURL = vi.fn();
  });
  mocks.parse.mockReset().mockResolvedValue({ scene: new Group() });
  mocks.read.mockReset().mockReturnValue({ success: true, root: { meshes: [0] }, meshes: [{
    attributes: { position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0] } }, index: { array: [0, 1, 2] }
  }] });
  mocks.factory.mockReset().mockResolvedValue({ ReadStepFile: mocks.read });
  lib = await import('../src/preview-driver');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('glTF sidecar ownership and cancellation', () => {
  it.each(['slice', 'view', 'buffer', 'blob', 'shared'] as const)('loads a %s as an exact native Blob snapshot, then releases its URL', async kind => {
    const storage = kind === 'shared' ? new SharedArrayBuffer(5) : new ArrayBuffer(5);
    const bytes = new Uint8Array(storage); bytes.set([99, 1, 2, 3, 98]);
    const value = kind === 'blob' ? new Blob([bytes.subarray(1, 4)])
      : kind === 'buffer' ? bytes.slice(1, 4).buffer
      : kind === 'view' ? new DataView(storage, 1, 3) : bytes.subarray(1, 4);
    mocks.parse.mockImplementationOnce(async (text: string) => {
      const url = JSON.parse(text).buffers[0].uri;
      expect(url).toMatch(/^blob:/);
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
      bytes.fill(0);
      expect([...new Uint8Array(await blobs.get(url)!.arrayBuffer())]).toEqual([1, 2, 3]);
      expect(blobs.get(url)!.type).toBe(kind === 'blob' ? '' : 'application/octet-stream');
      return { scene: new Group() };
    });
    const result = await lib.loadGltfObjectWithWarnings(source(), { resourceResolver: () => ({ source: value, warnings: ['sidecar'] }) });
    expect(result.warnings).toEqual(['sidecar']);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:owned-0');
  });

  it('preserves borrowed URLs and does not mutate reusable resolver results', async () => {
    const resolved = { source: 'blob:borrowed', warnings: ['borrowed'] };
    const result = await lib.loadGltfObjectWithWarnings(source(), { resourceResolver: () => resolved });
    expect(JSON.parse(mocks.parse.mock.calls[0][0]).buffers[0].uri).toBe('blob:borrowed');
    expect(result.warnings).toEqual(['borrowed']);
    expect(resolved).toEqual({ source: 'blob:borrowed', warnings: ['borrowed'] });
    expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('accepts explicitly resolved HTTP URLs without requiring a separate resource path', async () => {
    await lib.loadGltfObject(source(), { resourceResolver: () => 'https://example.test/mesh.bin' });
    expect(JSON.parse(mocks.parse.mock.calls[0][0]).buffers[0].uri).toBe('https://example.test/mesh.bin');
    expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('does not cascade URI replacements when one result matches another original URI', async () => {
    const borrowed = 'https://example.test/mesh.bin', data = 'data:application/octet-stream;base64,AQID';
    await lib.loadGltfObject(source(['mesh.bin', borrowed]), { resourceResolver: ({ source: uri }) => uri === 'mesh.bin' ? borrowed : data });
    expect(JSON.parse(mocks.parse.mock.calls[0][0]).buffers.map((buffer: { uri: string }) => buffer.uri)).toEqual([borrowed, data]);
  });

  it.each(['resolver', 'missing', 'parser'] as const)('releases prior sidecars after a %s failure', async kind => {
    mocks.parse.mockRejectedValueOnce(new Error('parser failed'));
    const resolver = vi.fn(({ source: uri }) => {
      if (uri === 'mesh.bin') return new Blob(['abc']);
      if (kind === 'resolver') throw new Error('resolver failed');
      return undefined;
    });
    await expect(lib.loadGltfObjectWithWarnings(source(kind === 'parser' ? ['mesh.bin'] : ['mesh.bin', 'missing.bin']), {
      resourceResolver: resolver
    })).rejects.toThrow(kind === 'missing' ? 'not bundled' : `${kind} failed`);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:owned-0');
    expect(mocks.parse).toHaveBeenCalledTimes(kind === 'parser' ? 1 : 0);
  });

  it('rejects a pre-aborted load before parsing JSON or calling the resolver', async () => {
    const controller = new AbortController(); controller.abort(); const resolver = vi.fn();
    await expect(lib.loadGltfObjectWithWarnings('invalid JSON', { signal: controller.signal, resourceResolver: resolver }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(resolver).not.toHaveBeenCalled(); expect(mocks.parse).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)('settles cancellation before a held resolver can %s, without allocating a late URL', async outcome => {
    const held = deferred<Blob>(), controller = new AbortController();
    const pending = lib.loadGltfObjectWithWarnings(source(), { signal: controller.signal, resourceResolver: () => held.promise });
    const settled = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await settled;
    if (outcome === 'resolve') held.resolve(new Blob(['abc'])); else held.reject(new Error('late resolver error'));
    await Promise.resolve(); await Promise.resolve();
    expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(mocks.parse).not.toHaveBeenCalled();
  });

  it('releases earlier sidecars when cancellation interrupts a later resolver', async () => {
    const held = deferred<Blob>(), controller = new AbortController();
    const resolver = vi.fn(({ source: uri }) => uri === 'mesh.bin' ? new Blob(['abc']) : held.promise);
    const pending = lib.loadGltfObjectWithWarnings(source(['mesh.bin', 'texture.bin']), { signal: controller.signal, resourceResolver: resolver });
    await vi.waitFor(() => expect(resolver).toHaveBeenCalledTimes(2));
    const settled = expect(pending).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await settled;
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:owned-0');
    held.resolve(new Blob(['def'])); await Promise.resolve(); await Promise.resolve();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1); expect(mocks.parse).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)('releases URLs on parser cancellation and observes its late %s', async outcome => {
    const held = deferred<any>(), controller = new AbortController(); mocks.parse.mockReturnValueOnce(held.promise);
    const pending = lib.loadGltfObjectWithWarnings(source(), { signal: controller.signal, resourceResolver: () => new Blob(['abc']) });
    await vi.waitFor(() => expect(mocks.parse).toHaveBeenCalledTimes(1));
    const settled = expect(pending).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await settled;
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:owned-0');
    const geometry = new BufferGeometry(), texture = new Texture(), material = new MeshStandardMaterial({ map: texture });
    const scenes = [new Group(), new Group()]; scenes.forEach(scene => scene.add(new Mesh(geometry, material)));
    const spies = [vi.spyOn(geometry, 'dispose'), vi.spyOn(material, 'dispose'), vi.spyOn(texture, 'dispose')];
    if (outcome === 'resolve') held.resolve({ scene: scenes[0], scenes }); else held.reject(new Error('late parser error'));
    await vi.waitFor(() => { for (const spy of spies) expect(spy).toHaveBeenCalledTimes(outcome === 'resolve' ? 1 : 0); });
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('removes completed abort listeners without disposing a returned model on later abort', async () => {
    const controller = new AbortController(), add = vi.spyOn(controller.signal, 'addEventListener'), remove = vi.spyOn(controller.signal, 'removeEventListener');
    const scene = new Group(), geometry = new BufferGeometry(), dispose = vi.spyOn(geometry, 'dispose'); scene.add(new Mesh(geometry));
    mocks.parse.mockResolvedValueOnce({ scene });
    expect(await lib.loadGltfObject(source(), { signal: controller.signal, resourceResolver: () => new Blob(['abc']) })).toBe(scene);
    controller.abort(); expect(dispose).not.toHaveBeenCalled();
    expect(add.mock.calls.length).toBeGreaterThan(0); expect(remove.mock.calls.length).toBe(add.mock.calls.length);
    for (const [event, handler] of add.mock.calls) expect(remove).toHaveBeenCalledWith(event, handler);
  });

  it('keeps simultaneous loads in separate resource scopes', async () => {
    const held = deferred<any>(); mocks.parse.mockReturnValueOnce(held.promise);
    const first = lib.loadGltfObject(source(), { resourceResolver: () => new Blob(['abc']) });
    await vi.waitFor(() => expect(mocks.parse).toHaveBeenCalledTimes(1));
    await lib.loadGltfObject(source(), { resourceResolver: () => new Blob(['def']) });
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:owned-1');
    held.resolve({ scene: new Group() }); await first;
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:owned-0');
  });
});

describe('STEP importer initialization recovery', () => {
  it('shares a failed attempt, retries once on the next open and reuses successful initialization', async () => {
    const held = deferred<any>(); mocks.factory.mockReturnValueOnce(held.promise);
    const first = lib.loadStepObject(new ArrayBuffer(0)), second = lib.loadStepObject(new ArrayBuffer(0));
    const failures = [expect(first).rejects.toThrow('temporary WASM failure'), expect(second).rejects.toThrow('temporary WASM failure')];
    await vi.waitFor(() => expect(mocks.factory).toHaveBeenCalledTimes(1));
    held.reject(new Error('temporary WASM failure')); await Promise.all(failures);
    const results = await Promise.all([lib.loadStepObject(new ArrayBuffer(0)), lib.loadStepObject(new ArrayBuffer(0))]);
    expect(results.map(object => object.children.length)).toEqual([1, 1]);
    await lib.loadStepObject(new ArrayBuffer(0));
    expect(mocks.factory).toHaveBeenCalledTimes(2); expect(mocks.read).toHaveBeenCalledTimes(3);
  });

  it('keeps a successful importer after an invalid STEP file', async () => {
    mocks.read.mockReturnValueOnce({ success: false });
    await expect(lib.loadStepObject(new ArrayBuffer(0))).rejects.toThrow('could not read');
    await lib.loadStepObject(new ArrayBuffer(0)); expect(mocks.factory).toHaveBeenCalledTimes(1);
  });
});
