import { Blob as NativeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BufferGeometry, Material, Mesh, MeshPhongMaterial, Texture, TextureLoader } from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { loadObjObjectWithWarnings } from '../src/preview-driver';

const obj = (name = 'base') => `mtllib materials/base.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nusemtl ${name}\nf 1/1 2/2 3/3\n`;
const mtl = 'newmtl base\nKd 0.2 0.4 0.6\n';
const encode = (text: string) => new TextEncoder().encode(text);
const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
let blobs: Map<string, NativeBlob>;
let loads: Array<{ url: string; finish: (fail?: boolean) => void }>;
let holdImages: boolean;
const material = (object: any) => object.children[0].material as MeshPhongMaterial;

beforeEach(() => {
  blobs = new Map(); loads = []; holdImages = false;
  vi.stubGlobal('Blob', NativeBlob);
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn((blob: NativeBlob) => { const url = `blob:owned-${blobs.size}`; blobs.set(url, blob); return url; });
    static revokeObjectURL = vi.fn();
  });
  vi.spyOn(TextureLoader.prototype, 'load').mockImplementation(function (url, onLoad, _, onError) {
    const texture = new Texture(); this.manager.itemStart(url);
    const finish = (fail = false) => {
      if (fail) { onError?.(new Error('invalid image')); this.manager.itemError(url); }
      else { texture.image = { width: 2, height: 2 }; onLoad?.(texture); }
      this.manager.itemEnd(url);
    };
    loads.push({ url, finish }); if (!holdImages) queueMicrotask(() => finish());
    return texture;
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('native OBJ materials and managed texture lifetime', () => {
  it('preserves ASCII material properties without textures', async () => {
    const result = await loadObjObjectWithWarnings(obj(), { resourceResolver: () => encode(mtl) });
    expect(material(result.object).name).toBe('base'); expect(material(result.object).color.getHexString()).toBe('336699');
    expect(result.warnings).toEqual([]); expect(loads).toHaveLength(0); expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('loads geometry without a material resolver', async () => {
    const result = await loadObjObjectWithWarnings(obj());
    expect([...((result.object.children[0] as Mesh).geometry.attributes.position.array)]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(result.warnings).toEqual([]); expect(loads).toHaveLength(0);
  });

  it.each(['view', 'buffer', 'blob', 'base64', 'percent'] as const)('preserves UTF-8 material names from %s', async kind => {
    const unicodeMtl = mtl.replace('base', '底色'), bytes = encode(unicodeMtl), padded = new Uint8Array(bytes.length + 4); padded.set(bytes, 2);
    const value = kind === 'view' ? new DataView(padded.buffer, 2, bytes.length) : kind === 'buffer' ? padded.buffer.slice(2, -2)
      : kind === 'blob' ? new Blob([bytes]) : kind === 'base64' ? `data:text/plain;base64,${Buffer.from(bytes).toString('base64')}`
      : `data:text/plain,${encodeURIComponent(unicodeMtl)}`;
    const result = await loadObjObjectWithWarnings(obj('底色'), { resourceResolver: () => value });
    expect(material(result.object).name).toBe('底色'); expect(material(result.object).color.getHexString()).toBe('336699');
    expect([...((result.object.children[0] as Mesh).geometry.attributes.position.array)]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it.each(['map_Kd', 'map_Ks', 'map_Ke', 'map_Bump', 'bump', 'norm', 'disp', 'map_d'])('resolves %s with scale, offset, bump and displacement parameters', async directive => {
    const resolver = vi.fn(({ relation }) => relation === 'material'
      ? encode(`${mtl}${directive} -s 2 3 1 -o 0.1 0.2 0 -bm 0.4 -mm 0.2 0.8 纹理/diffuse map.png\n`)
      : new Uint8Array([99, 1, 2, 3, 98]).subarray(1, 4));
    const { object } = await loadObjObjectWithWarnings(obj(), { resourceBasePath: 'models/scene.obj', resourceResolver: resolver });
    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({ source: 'models/materials/纹理/diffuse map.png', relation: 'texture' }));
    const key = ({ map_kd: 'map', map_ks: 'specularMap', map_ke: 'emissiveMap', map_bump: 'bumpMap', bump: 'bumpMap', norm: 'normalMap', disp: 'displacementMap', map_d: 'alphaMap' } as const)[directive.toLowerCase()];
    const value = material(object)[key] as Texture;
    expect(value.image).toEqual({ width: 2, height: 2 }); expect(value.repeat.toArray()).toEqual([2, 3]); expect(value.offset.toArray()).toEqual([0.1, 0.2]);
    expect(material(object).bumpScale).toBe(0.4); expect(material(object).displacementBias).toBe(0.2); expect(material(object).displacementScale).toBe(0.8);
    expect(loads).toHaveLength(1); expect(loads[0].url).toBe('blob:owned-0');
    expect([...new Uint8Array(await blobs.get(loads[0].url)!.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1); expect(URL.revokeObjectURL).toHaveBeenCalledWith(loads[0].url);
  });

  it('waits for every used texture and retains owned URLs until image loading completes', async () => {
    holdImages = true; let done = false;
    const pending = loadObjObjectWithWarnings(obj(), { resourceResolver: ({ relation }) => relation === 'material'
      ? encode(`${mtl}map_Kd color.png\nnorm normal.png\n`) : new Blob(['texture']) }).then(value => { done = true; return value; });
    await settle(); expect(loads).toHaveLength(2); expect(done).toBe(false); expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    loads[0].finish(); await settle(); expect(done).toBe(false); expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    loads[1].finish(); const result = await pending;
    expect(material(result.object).map!.image.width).toBe(2); expect(material(result.object).normalMap!.image.height).toBe(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('leaves borrowed URLs caller-owned on image failure', async () => {
    holdImages = true;
    const pending = loadObjObjectWithWarnings(obj(), { resourceResolver: ({ relation }) => relation === 'material' ? encode(`${mtl}map_Kd x.png`) : 'blob:borrowed' });
    await settle(); loads[0].finish(true); const result = await pending;
    expect(result.warnings.join(' ')).toMatch(/texture.*failed/i); expect(result.object.children).toHaveLength(1);
    expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('does not load unused MTL textures', async () => {
    const { object } = await loadObjObjectWithWarnings(obj(), { resourceResolver: ({ relation }) => relation === 'material'
      ? encode(`${mtl}newmtl unused\nmap_Kd unused.png`) : new Blob(['unused']) });
    expect(material(object).map).toBeNull(); expect(loads).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(blobs.size);
  });

  it.each(['material', 'texture'] as const)('settles cancellation during a non-cooperative %s resolver', async relation => {
    const controller = new AbortController(), held = deferred<any>();
    const resolver = vi.fn(request => request.relation === relation ? held.promise : encode(`${mtl}map_Kd x.png`));
    const pending = loadObjObjectWithWarnings(obj(), { signal: controller.signal, resourceResolver: resolver });
    const checked = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await settle(); controller.abort(); await checked;
    held.reject(new Error('late resolver failure')); await settle();
    expect(loads).toHaveLength(0); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(blobs.size);
  });

  it.each(['blob', 'fetch', 'body'] as const)('settles cancellation during a non-cooperative material %s read', async kind => {
    const controller = new AbortController(), held = deferred<any>(); let read = false;
    const bodyCancel = vi.fn().mockResolvedValue(undefined);
    const response = { ok: true, arrayBuffer: () => { read = true; return held.promise; }, body: { cancel: bodyCancel } };
    const blob = new Blob(); Object.defineProperty(blob, 'arrayBuffer', { value: () => { read = true; return held.promise; } });
    vi.stubGlobal('fetch', vi.fn(() => { read = true; return kind === 'fetch' ? held.promise : Promise.resolve(response); }));
    const pending = loadObjObjectWithWarnings(obj(), { signal: controller.signal, resourceResolver: () => kind === 'blob' ? blob : 'https://example.test/base.mtl' });
    const checked = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await settle(); expect(read).toBe(true); controller.abort(); await checked;
    if (kind === 'fetch') held.resolve(response); else held.reject(new Error('late read failure'));
    await settle(); if (kind !== 'blob') expect(bodyCancel).toHaveBeenCalled();
    expect(loads).toHaveLength(0); expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('rejects pre-aborted OBJ loads even without libraries or a resolver', async () => {
    const signal = AbortSignal.abort();
    await expect(loadObjObjectWithWarnings('v 0 0 0', { signal })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(loadObjObjectWithWarnings(obj(), { signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('cancels pending textures and disposes the abandoned object exactly once', async () => {
    holdImages = true; const controller = new AbortController();
    const geometryDispose = vi.spyOn(BufferGeometry.prototype, 'dispose'), materialDispose = vi.spyOn(Material.prototype, 'dispose');
    const textureDispose = vi.spyOn(Texture.prototype, 'dispose');
    const pending = loadObjObjectWithWarnings(obj(), { signal: controller.signal, resourceResolver: ({ relation }) => relation === 'material'
      ? encode(`${mtl}map_Kd x.png`) : new Blob(['image']) });
    const checked = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await settle(); expect(loads).toHaveLength(1); controller.abort(); await checked;
    expect(geometryDispose).toHaveBeenCalledTimes(1); expect(materialDispose).toHaveBeenCalledTimes(1); expect(textureDispose).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1); expect(URL.revokeObjectURL).toHaveBeenCalledWith(loads[0].url);
    loads[0].finish(); await settle(); expect(textureDispose).toHaveBeenCalledTimes(1);
  });

  it('releases an earlier texture when a later resolver is cancelled', async () => {
    const held = deferred<Blob>(), controller = new AbortController(); let calls = 0;
    const pending = loadObjObjectWithWarnings(obj(), { signal: controller.signal, resourceResolver: ({ relation }) => relation === 'material'
      ? encode(`${mtl}map_Kd first.png\nnorm second.png`) : ++calls === 1 ? new Blob(['image']) : held.promise });
    const checked = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await settle(); expect(calls).toBe(2); expect(blobs.size).toBe(1); controller.abort(); await checked;
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1); held.resolve(new Blob(['late'])); await settle();
    expect(blobs.size).toBe(1); expect(loads).toHaveLength(0);
  });

  it.each(['line', 'points'] as const)('disposes a copied %s material without disposing retained textures', async kind => {
    const original = MTLLoader.prototype.parse; let cached!: Material;
    vi.spyOn(MTLLoader.prototype, 'parse').mockImplementationOnce(function (text, path) {
      const materials = original.call(this, text, path), create = materials.create.bind(materials);
      materials.create = name => { cached = create(name); return cached; }; return materials;
    });
    const disposedMaterials: Material[] = [], disposedTextures: Texture[] = [];
    vi.spyOn(Material.prototype, 'dispose').mockImplementation(function () { disposedMaterials.push(this); });
    vi.spyOn(Texture.prototype, 'dispose').mockImplementation(function () { disposedTextures.push(this); });
    const { object } = await loadObjObjectWithWarnings(obj().replace('f 1/1 2/2 3/3', kind === 'line' ? 'l 1 2 3' : 'p 1 2 3'), {
      resourceResolver: ({ relation }) => relation === 'material' ? encode(`${mtl}map_Kd x.png`) : new Blob(['image'])
    });
    expect(disposedMaterials).toEqual([cached]); expect(material(object)).not.toBe(cached);
    if (kind === 'points') { expect(material(object).map!.image.width).toBe(2); expect(disposedTextures).toHaveLength(0); }
    else expect(disposedTextures).toHaveLength(1);
  });

  it('preserves borrowed URLs after successful image loading', async () => {
    const { object } = await loadObjObjectWithWarnings(obj(), { resourceResolver: ({ relation }) => relation === 'material'
      ? encode(`${mtl}map_Kd x.png`) : 'https://example.test/color.png' });
    expect(material(object).map!.image.width).toBe(2); expect(loads[0].url).toBe('https://example.test/color.png');
    expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('keeps material and texture resolver fallback paths and warnings', async () => {
    const resolver = vi.fn(({ source, relation }) => {
      if (source === 'materials/base.mtl') return { source: encode(`${mtl}map_Kd x.png`), warnings: ['fallback MTL'] };
      if (source === 'x.png') return { source: new Blob(['image']), warnings: ['fallback image'] };
      return undefined;
    });
    const result = await loadObjObjectWithWarnings(obj(), { resourceBasePath: 'models/scene.obj', resourceResolver: resolver });
    expect(result.warnings).toEqual(['fallback MTL', 'fallback image']);
    expect(resolver.mock.calls.map(([request]) => request.source)).toEqual(['models/materials/base.mtl', 'materials/base.mtl', 'models/materials/x.png', 'x.png']);
    expect(material(result.object).map!.image.width).toBe(2); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('releases owned textures if OBJ parsing throws', async () => {
    vi.spyOn(OBJLoader.prototype, 'parse').mockImplementationOnce(() => { throw new Error('invalid OBJ'); });
    await expect(loadObjObjectWithWarnings(obj(), { resourceResolver: ({ relation }) => relation === 'material'
      ? encode(`${mtl}map_Kd x.png`) : new Blob(['image']) })).rejects.toThrow('invalid OBJ');
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(blobs.size); expect(blobs.size).toBe(1);
  });

  it('disposes materials created before parsing fails', async () => {
    const original = MTLLoader.prototype.parse;
    vi.spyOn(MTLLoader.prototype, 'parse').mockImplementationOnce(function (text, path) {
      const materials = original.call(this, text, path); materials.preload(); return materials;
    });
    const disposed = vi.spyOn(Texture.prototype, 'dispose');
    vi.spyOn(OBJLoader.prototype, 'parse').mockImplementationOnce(() => { throw new Error('invalid OBJ'); });
    await expect(loadObjObjectWithWarnings(obj(), { resourceResolver: ({ relation }) => relation === 'material'
      ? encode(`${mtl}map_Kd x.png`) : new Blob(['image']) })).rejects.toThrow('invalid OBJ');
    expect(disposed).toHaveBeenCalledTimes(1); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(blobs.size);
  });
});
