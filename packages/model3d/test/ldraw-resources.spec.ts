import { Blob as NativeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BufferGeometry, FileLoader, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { LDrawLoader as OriginalLDrawLoader } from 'three/examples/jsm/loaders/LDrawLoader.js';
import { LDrawLoader } from '../vendor/three/LDrawLoader.js';
import { loadLDrawObjectWithWarnings } from '../src/preview-driver';
import { createLDrawPartsFixture, ldrawReference } from './fixtures/ldraw.mjs';

const encode = (text: string) => new TextEncoder().encode(text);
const simple = '0 !LDRAW_ORG Part\n0 BFC CERTIFY CCW\n3 16 0 0 0 1 0 0 0 1 0\n';
const root = '0 FILE main.ldr\n' + ldrawReference('part.dat');
const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
};
const mockParse = (implementation: (...args: any[]) => any) => {
  vi.spyOn(OriginalLDrawLoader.prototype, 'parse').mockImplementation(implementation);
  return vi.spyOn(LDrawLoader.prototype, 'parse').mockImplementation(implementation);
};
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const positions = (object: Group | any) => {
  const values: number[] = []; object.updateMatrixWorld(true);
  object.traverse((node: any) => {
    if (!node.isMesh) return;
    const data = node.geometry.attributes.position;
    for (let i = 0; i < data.count; i++) values.push(...new Vector3().fromBufferAttribute(data, i).applyMatrix4(node.matrixWorld).toArray());
  }); return values;
};
let urls: Map<string, NativeBlob>;
let fetchPart: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  urls = new Map(); vi.stubGlobal('Blob', NativeBlob);
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn((blob: NativeBlob) => { const url = `blob:owned-${urls.size}`; urls.set(url, blob); return url; });
    static revokeObjectURL = vi.fn();
  });
  fetchPart = vi.spyOn(FileLoader.prototype, 'loadAsync').mockImplementation(async url => {
    if (url === 'blob:caller-owned') return simple;
    if (url.startsWith('data:')) return new TextDecoder().decode(await (await fetch(url)).arrayBuffer());
    if (urls.has(url)) return urls.get(url)!.text();
    throw new Error('Missing external part: ' + url);
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('LDraw native parts, dependency graph and cancellation', () => {
  it('preserves a self-contained model without resource resolution', async () => {
    const result = await loadLDrawObjectWithWarnings(simple); expect(positions(result.object)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]); expect(result.warnings).toEqual([]);
    expect(fetchPart).not.toHaveBeenCalled();
  });

  it('preserves packed MPD geometry, transforms, lines and inherited color without a resolver', async () => {
    const fixture = createLDrawPartsFixture(), result = await loadLDrawObjectWithWarnings(fixture.packed);
    expect(positions(result.object)).toEqual(fixture.expectedPositions); expect(result.warnings).toEqual([]); expect(fetchPart).not.toHaveBeenCalled();
    const meshes: Mesh[] = [], lines: any[] = [];
    result.object.traverse((node: any) => { if (node.isMesh) meshes.push(node); if (node.isLineSegments) lines.push(node); });
    expect(meshes).toHaveLength(2); expect(lines).toHaveLength(4);
    for (const mesh of meshes) expect((mesh.material as MeshStandardMaterial).color.getHexString()).toBe('ff0000');
  });

  it('normalizes CRLF, leading metadata and NOFILE sections without resolving packed parts', async () => {
    const fixture = createLDrawPartsFixture(), resolver = vi.fn(() => undefined);
    const source = ('0 Packed example\n' + fixture.packed.replace('0 FILE parts/box.dat', '0 NOFILE\n0 Ignored outside the main file\n0 FILE parts/box.dat')).replace(/\n/g, '\r\n');
    const result = await loadLDrawObjectWithWarnings(source, { resourceResolver: resolver });
    expect(positions(result.object)).toEqual(fixture.expectedPositions); expect(result.warnings).toEqual([]); expect(resolver).not.toHaveBeenCalled();
  });

  it.each(['view', 'buffer', 'blob', 'base64', 'percent'] as const)('loads nested native %s parts once with their original names and no temporary URLs', async kind => {
    const fixture = createLDrawPartsFixture();
    const convert = (text: string) => {
      const bytes = encode(text), padded = new Uint8Array(bytes.length + 4); padded.set(bytes, 2);
      return kind === 'view' ? new DataView(padded.buffer, 2, bytes.length) : kind === 'buffer' ? padded.buffer.slice(2, -2)
        : kind === 'blob' ? new Blob([bytes]) : kind === 'base64' ? `data:text/plain;base64,${Buffer.from(bytes).toString('base64')}` : `data:text/plain,${encodeURIComponent(text)}`;
    };
    const resolver = vi.fn(({ source }) => source === 'models/parts/box.dat' ? { source: convert(fixture.part), warnings: ['box loaded'] }
      : source === 'models/parts/s/face.dat' ? convert(fixture.face) : undefined);
    const result = await loadLDrawObjectWithWarnings(fixture.source, { resourceBasePath: 'models/main.ldr', resourceResolver: resolver });
    expect(positions(result.object)).toEqual(fixture.expectedPositions); expect(result.warnings).toEqual(['box loaded']);
    expect(resolver.mock.calls.map(([request]) => request.source)).toEqual(['models/parts/box.dat', 'models/parts/s/face.dat']);
    expect(fetchPart).not.toHaveBeenCalled(); expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    const names: string[] = []; result.object.traverse(node => { if (node.name) names.push(node.name); });
    expect(names).toContain('parts/box.dat'); expect(names.some(name => /blob:|data:/.test(name))).toBe(false);
  });

  it('keeps packed MPD definitions ahead of an external resolver and does not fetch unused dependencies', async () => {
    const fixture = createLDrawPartsFixture(), resolver = vi.fn(() => { throw new Error('Should remain packed'); });
    const result = await loadLDrawObjectWithWarnings(fixture.packed + '0 FILE unused.dat\n' + ldrawReference('missing.dat'), { resourceResolver: resolver });
    expect(positions(result.object)).toEqual(fixture.expectedPositions); expect(resolver).not.toHaveBeenCalled(); expect(fetchPart).not.toHaveBeenCalled();
  });

  it('preserves case-insensitive and Windows references without duplicate resource reads', async () => {
    const source = root.replace('part.dat', 'dir\\part.dat') + ldrawReference('DIR/part.DAT', 3), resolver = vi.fn(() => encode(simple));
    const result = await loadLDrawObjectWithWarnings(source, { resourceResolver: resolver });
    expect(positions(result.object)).toHaveLength(18); expect(resolver).toHaveBeenCalledTimes(1); expect(fetchPart).not.toHaveBeenCalled();
  });

  it('resolves nested relative paths from the containing external part', async () => {
    const resolver = vi.fn(({ source }) => source === 'models/part.dat' ? encode(ldrawReference('sub/child.dat'))
      : source === 'models/sub/child.dat' ? encode(simple) : undefined);
    const result = await loadLDrawObjectWithWarnings(root, { resourceBasePath: 'models/main.ldr', resourceResolver: resolver });
    expect(positions(result.object)).toHaveLength(9); expect(resolver.mock.calls.map(([request]) => request.source)).toEqual(['models/part.dat', 'models/sub/child.dat']);
  });

  it('keeps same-named relative children in different part directories separate', async () => {
    const source = '0 FILE main.ldr\n' + ldrawReference('a/parent.dat') + ldrawReference('b/parent.dat', 10);
    const resolver = vi.fn(({ source }) => /parent\.dat$/.test(source) ? encode(ldrawReference('child.dat'))
      : source === 'models/a/child.dat' ? encode(simple) : source === 'models/b/child.dat' ? encode(simple.replace('1 0 0 0 1 0', '2 0 0 0 2 0')) : undefined);
    const result = await loadLDrawObjectWithWarnings(source, { resourceBasePath: 'models/main.ldr', resourceResolver: resolver });
    expect(positions(result.object)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 10, 0, 0, 12, 0, 0, 10, 2, 0]);
    expect(resolver.mock.calls.map(([request]) => request.source)).toEqual(['models/a/parent.dat', 'models/a/child.dat', 'models/b/parent.dat', 'models/b/child.dat']);
  });

  it('keeps private MPD definitions in separate external documents scoped to their document', async () => {
    const source = '0 FILE main.ldr\n' + ldrawReference('a/parent.mpd') + ldrawReference('b/parent.mpd', 10);
    const resolver = vi.fn(({ source }) => encode('0 FILE parent.ldr\n' + ldrawReference('child.dat') + '0 FILE child.dat\n'
      + (source.includes('/a/') ? simple : simple.replace('1 0 0 0 1 0', '2 0 0 0 2 0'))));
    const result = await loadLDrawObjectWithWarnings(source, { resourceBasePath: 'models/main.ldr', resourceResolver: resolver });
    expect(positions(result.object)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 10, 0, 0, 12, 0, 0, 10, 2, 0]);
    expect(resolver).toHaveBeenCalledTimes(2); expect(fetchPart).not.toHaveBeenCalled();
  });

  it('loads embedded definitions from an externally resolved MPD without consulting the resolver again', async () => {
    const resolver = vi.fn(() => encode('0 FILE external.ldr\n' + ldrawReference('leaf.dat') + '0 FILE leaf.dat\n' + simple));
    const result = await loadLDrawObjectWithWarnings(root, { resourceResolver: resolver });
    expect(positions(result.object)).toHaveLength(9); expect(resolver).toHaveBeenCalledTimes(1); expect(fetchPart).not.toHaveBeenCalled();
  });

  it('uses fallback sources and preserves resolver warnings', async () => {
    const resolver = vi.fn(({ source }) => source === 'part.dat' ? { source: encode(simple), warnings: ['fallback part'] } : undefined);
    const result = await loadLDrawObjectWithWarnings(root, { resourceBasePath: 'models/main.ldr', resourceResolver: resolver });
    expect(result.warnings).toEqual(['fallback part']); expect(positions(result.object)).toHaveLength(9);
    expect(resolver.mock.calls.map(([request]) => request.source)).toEqual(['models/part.dat', 'part.dat']);
  });

  it('warns for a missing part and preserves available geometry without network retries', async () => {
    const result = await loadLDrawObjectWithWarnings(simple + ldrawReference('missing.dat'), { resourceResolver: () => undefined });
    expect(positions(result.object)).toHaveLength(9); expect(result.warnings).toContain('LDraw part "missing.dat" could not be resolved; dependent geometry may be missing.');
    expect(fetchPart).not.toHaveBeenCalled();
  });

  it('does not revoke borrowed part URLs after reading them', async () => {
    const url = 'blob:caller-owned'; vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => encode(simple).buffer }));
    const result = await loadLDrawObjectWithWarnings(root, { resourceResolver: () => url });
    expect(positions(result.object)).toHaveLength(9); expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it.each(['embedded', 'external'] as const)('rejects a %s dependency cycle before entering the upstream parser', async kind => {
    const parse = mockParse((source: any, done: any) => done(new Group()));
    const source = kind === 'embedded' ? '0 FILE main.ldr\n' + ldrawReference('a.dat') + '0 FILE a.dat\n' + ldrawReference('main.ldr') : root;
    await expect(loadLDrawObjectWithWarnings(source, { resourceResolver: () => encode(ldrawReference('part.dat')) })).rejects.toThrow(/cyclic|cycle/i);
    expect(parse).not.toHaveBeenCalled();
  });

  it('rejects pre-aborted loads without calling the resolver or parser', async () => {
    const resolver = vi.fn(), parse = vi.spyOn(LDrawLoader.prototype, 'parse');
    await expect(loadLDrawObjectWithWarnings(simple, { signal: AbortSignal.abort(), resourceResolver: resolver })).rejects.toMatchObject({ name: 'AbortError' });
    expect(resolver).not.toHaveBeenCalled(); expect(parse).not.toHaveBeenCalled();
  });

  it.each(['resolver', 'blob', 'fetch', 'body'] as const)('cancels a non-cooperative part %s and observes late failure', async kind => {
    const held = deferred<any>(), controller = new AbortController(); let entered = false;
    const cancel = vi.fn().mockResolvedValue(undefined), response = { ok: true, arrayBuffer: () => { entered = true; return held.promise; }, body: { cancel } };
    const blob = new Blob(); Object.defineProperty(blob, 'arrayBuffer', { value: () => { entered = true; return held.promise; } });
    vi.stubGlobal('fetch', vi.fn(() => { entered = true; return kind === 'fetch' ? held.promise : Promise.resolve(response); }));
    const pending = loadLDrawObjectWithWarnings(root, { signal: controller.signal, resourceResolver: () => {
      if (kind === 'resolver') { entered = true; return held.promise; }
      return kind === 'blob' ? blob : 'https://example.test/part.dat';
    } });
    const checked = expect(pending).rejects.toMatchObject({ name: 'AbortError' }); await settle(); expect(entered).toBe(true); controller.abort(); await checked;
    if (kind === 'fetch') held.resolve(response); else held.reject(new Error('late part failure'));
    await settle(); expect(URL.createObjectURL).not.toHaveBeenCalled(); if (kind === 'fetch' || kind === 'body') expect(cancel).toHaveBeenCalled();
  });

  it('cancels an upstream parser and disposes its late scene once', async () => {
    let finish!: (group: Group) => void; const controller = new AbortController();
    mockParse((source: any, done: any) => { finish = done; });
    const pending = loadLDrawObjectWithWarnings(simple, { signal: controller.signal });
    const checked = expect(pending).rejects.toMatchObject({ name: 'AbortError' }); await settle(); controller.abort(); await checked;
    const object = new Group(), geometry = new BufferGeometry(), material = new MeshStandardMaterial(); object.add(new Mesh(geometry, material));
    const geometryDispose = vi.spyOn(geometry, 'dispose'), materialDispose = vi.spyOn(material, 'dispose');
    finish(object); await settle(); expect(geometryDispose).toHaveBeenCalledTimes(1); expect(materialDispose).toHaveBeenCalledTimes(1);
  });

  it('preserves AbortError after earlier missing-part warnings', async () => {
    const controller = new AbortController(); mockParse(() => {});
    const pending = loadLDrawObjectWithWarnings(root, { signal: controller.signal, resourceResolver: () => undefined });
    const checked = expect(pending).rejects.toMatchObject({ name: 'AbortError' }); await settle(); controller.abort(); await checked;
  });

  it('preserves the caller error object when annotating parse errors with warnings', async () => {
    const failure = new Error('invalid part');
    mockParse((source: any, done: any, fail: any) => fail(failure));
    await expect(loadLDrawObjectWithWarnings(root, { resourceResolver: () => undefined })).rejects.toThrow(/invalid part.*Warnings/);
    expect(failure.message).toBe('invalid part');
  });
});
