import { Blob as NativeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import * as core from '@filens/core';
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { loadKmzObject, loadKmzObjectWithWarnings } from '../src/preview-driver';
import { createKmzDae, createKmzFixture } from './fixtures/kmz.mjs';

vi.mock('@filens/core', async importOriginal => {
  const actual = await importOriginal<typeof import('@filens/core')>();
  return { ...actual, openZipArchive: vi.fn(actual.openZipArchive) };
});

const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
};
const bytes = async (zip: JSZip) => (await zip.generateAsync({ type: 'uint8array' })).buffer as ArrayBuffer;
const entries = (archive: JSZip): Map<string, core.ZipEntry> => new Map(Object.values(archive.files).map(entry => [entry.name, {
  name: entry.name, directory: entry.dir, bytes: () => entry.async('uint8array'), text: () => entry.async('text')
}]));
const mesh = () => {
  const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  const object = new Group(); object.add(new Mesh(geometry, new MeshStandardMaterial({ map: new Texture() }))); return object;
};
const mockTextures = (hrefs: string[], hold = false, fail = false) => {
  let manager: any; const urls: string[] = []; const object = mesh();
  vi.spyOn(ColladaLoader.prototype, 'parse').mockImplementation(function () {
    manager = this.manager;
    for (const href of hrefs) { const url = manager.resolveURL(href); urls.push(url); manager.itemStart(url); }
    if (!hold) queueMicrotask(() => { for (const url of urls) { if (fail) manager.itemError(url); manager.itemEnd(url); } });
    return { scene: object } as any;
  });
  return { object, urls, finish: () => { for (const url of urls) manager.itemEnd(url); } };
};
let urls: Map<string, NativeBlob>;
beforeEach(() => {
  urls = new Map(); vi.stubGlobal('Blob', NativeBlob);
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn((blob: NativeBlob) => { const url = `blob:owned-${urls.size}`; urls.set(url, blob); return url; });
    static revokeObjectURL = vi.fn();
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('KMZ archive selection, selective images and lifetime', () => {
  it('preserves complete texture-free geometry through synchronous and asynchronous APIs', async () => {
    const fixture = await createKmzFixture({ texture: false });
    for (const object of [loadKmzObject(fixture.bytes.buffer), (await loadKmzObjectWithWarnings(fixture.bytes.buffer)).object]) {
      const meshes: Mesh[] = []; object.traverse(node => { if ((node as Mesh).isMesh) meshes.push(node as Mesh); });
      expect(meshes).toHaveLength(1); expect([...meshes[0].geometry.attributes.position.array]).toEqual(fixture.positions);
      expect([...meshes[0].geometry.attributes.normal.array]).toEqual(fixture.normals); expect([...meshes[0].geometry.attributes.uv.array]).toEqual(fixture.uv);
    }
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it.each(['async', 'sync'] as const)('selects nested encoded models relative to KML and textures relative to DAE through %s loading', async kind => {
    const fixture = await createKmzFixture({ nested: true }), mock = mockTextures([fixture.textureHref]);
    if (kind === 'sync') loadKmzObject(fixture.bytes.buffer); else await loadKmzObjectWithWarnings(fixture.bytes.buffer);
    await Promise.resolve(); expect(mock.urls).toEqual(['blob:owned-0']);
    expect(Buffer.from(await urls.get(mock.urls[0])!.arrayBuffer())).toEqual(fixture.image.png);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:owned-0');
  });

  it('decompresses only the selected model and its declared images, once per image', async () => {
    const fixture = await createKmzFixture({ unused: 2 });
    const archive = await JSZip.loadAsync(fixture.bytes); const reads: string[] = [];
    for (const entry of Object.values(archive.files)) {
      const original = entry.async.bind(entry);
      vi.spyOn(entry, 'async').mockImplementation(((type: any) => { reads.push(entry.name); return original(type); }) as any);
    }
    vi.spyOn(JSZip, 'loadAsync').mockResolvedValue(archive); vi.spyOn(core, 'openZipArchive').mockResolvedValue(entries(archive)); mockTextures([fixture.textureHref]);
    await loadKmzObjectWithWarnings(fixture.bytes.buffer);
    expect(reads).toEqual([fixture.kmlName, fixture.modelName, fixture.textureName]);
  });

  it('opens the selected model through both APIs when an unused image has invalid compressed bytes', async () => {
    const fixture = await createKmzFixture({ texture: false, unused: 1, unusedSide: 8 });
    const data = fixture.bytes.slice(), view = new DataView(data.buffer); let damaged = false;
    for (let offset = 0; offset + 30 <= data.length && view.getUint32(offset, true) === 0x04034b50;) {
      const nameLength = view.getUint16(offset + 26, true), extraLength = view.getUint16(offset + 28, true);
      const start = offset + 30 + nameLength + extraLength, size = view.getUint32(offset + 18, true);
      const name = new TextDecoder().decode(data.subarray(offset + 30, offset + 30 + nameLength));
      if (name === 'unreferenced/photo-0.png') { data[start] = 0xff; damaged = true; break; }
      offset = start + size;
    }
    expect(damaged).toBe(true);
    for (const object of [loadKmzObject(data.buffer), (await loadKmzObjectWithWarnings(data.buffer)).object]) {
      const meshes: Mesh[] = []; object.traverse(node => { if ((node as Mesh).isMesh) meshes.push(node as Mesh); });
      expect(meshes).toHaveLength(1); expect([...meshes[0].geometry.attributes.position.array]).toEqual(fixture.positions);
    }
  });

  it('prefers an exact containing-directory texture over earlier matching basenames', async () => {
    const fixture = await createKmzFixture({ nested: true }); fixture.zip.file('other/颜色 #1.png', [9, 8, 7]);
    const mock = mockTextures([fixture.textureHref]); await loadKmzObjectWithWarnings(await bytes(fixture.zip));
    expect(Buffer.from(await urls.get(mock.urls[0])!.arrayBuffer())).toEqual(fixture.image.png);
  });

  it('resolves dot segments before discarding parent directories', async () => {
    const zip = new JSZip(); zip.file('maps/deep/doc.kml', '<kml><Model><Link><href>../../models/model.dae</href></Link></Model></kml>');
    zip.file('wrong.dae', createKmzDae({ texture: null, offset: 9 })); zip.file('models/model.dae', createKmzDae({ texture: null, offset: 3 }));
    const result = await loadKmzObjectWithWarnings(await bytes(zip)); expect(result.object.children[0].position.x).toBe(3); expect(result.warnings).toEqual([]);
  });

  it('selects Model/Link href instead of an unrelated icon href, including KML namespaces', async () => {
    const zip = new JSZip(); zip.file('doc.kml', '<k:kml xmlns:k="urn:kml"><k:Icon><k:href>wrong.dae</k:href></k:Icon><k:Model><k:Link><k:href>good.dae</k:href></k:Link></k:Model></k:kml>');
    zip.file('wrong.dae', createKmzDae({ texture: null, offset: 9 })); zip.file('good.dae', createKmzDae({ texture: null, offset: 3 }));
    const result = await loadKmzObjectWithWarnings(await bytes(zip)); expect(result.object.children[0].position.x).toBe(3);
  });

  it('prefers the root KML and resolves archive-root hrefs without prefixing the model directory', async () => {
    const zip = new JSZip();
    zip.file('nested/doc.kml', '<kml><Model><Link><href>wrong.dae</href></Link></Model></kml>');
    zip.file('DOC.KML', '<kml><Model><Link><href>/models/good.dae</href></Link></Model></kml>');
    zip.file('wrong.dae', createKmzDae({ texture: null, offset: 9 })); zip.file('models/good.dae', createKmzDae({ texture: null, offset: 3 }));
    const result = await loadKmzObjectWithWarnings(await bytes(zip)); expect(result.object.children[0].position.x).toBe(3);
  });

  it('decodes percent escapes once and preserves a literal percent sequence in ZIP filenames', async () => {
    const zip = new JSZip(); zip.file('doc.kml', '<kml><Model><Link><href>model%2520.dae</href></Link></Model></kml>');
    zip.file('model%20.dae', createKmzDae({ texture: 'color%2520.png' })); zip.file('color%20.png', [1, 2, 3]);
    const mock = mockTextures(['color%2520.png']); await loadKmzObjectWithWarnings(await bytes(zip));
    expect([...new Uint8Array(await urls.get(mock.urls[0])!.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it('does not guess an ambiguous texture suffix or fetch application HTML for missing local images', async () => {
    const fixture = await createKmzFixture(); fixture.zip.remove(fixture.textureName); fixture.zip.file('a/textures/color.png', [1]); fixture.zip.file('b/textures/color.png', [2]);
    const mock = mockTextures([fixture.textureHref]); const result = await loadKmzObjectWithWarnings(await bytes(fixture.zip));
    expect(mock.urls[0]).toMatch(/^data:image\/svg\+xml/); expect(result.warnings.join(' ')).toMatch(/could not be resolved/i); expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('reuses one owned URL for repeated texture requests and releases it only after image completion', async () => {
    const fixture = await createKmzFixture(), mock = mockTextures([fixture.textureHref, fixture.textureHref], true);
    let done = false; const pending = loadKmzObjectWithWarnings(fixture.bytes.buffer).then(result => { done = true; return result; });
    await vi.waitFor(() => expect(mock.urls).toHaveLength(2));
    expect(done).toBe(false); expect(mock.urls).toEqual(['blob:owned-0', 'blob:owned-0']); expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    mock.finish(); await pending; expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1); expect(mock.object.userData.previewObjectUrls).toBeUndefined();
  });

  it.each(['blob:caller-owned', 'data:image/png;base64,AQID', 'https://example.test/color.png'])('leaves explicit borrowed %s URLs unchanged', async href => {
    const fixture = await createKmzFixture(); fixture.zip.file(fixture.modelName, createKmzDae({ texture: href })); const mock = mockTextures([href]);
    await loadKmzObjectWithWarnings(await bytes(fixture.zip)); expect(mock.urls).toEqual([href]); expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('reports image decode failures without discarding available geometry', async () => {
    const fixture = await createKmzFixture(); mockTextures([fixture.textureHref], false, true);
    const result = await loadKmzObjectWithWarnings(fixture.bytes.buffer); expect(result.warnings.join(' ')).toMatch(/texture failed/i); expect(result.object.children).toHaveLength(1); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('releases earlier texture URLs when Collada parsing throws', async () => {
    const fixture = await createKmzFixture(); vi.spyOn(ColladaLoader.prototype, 'parse').mockImplementation(function () { this.manager.resolveURL(fixture.textureHref); throw new Error('bad geometry'); });
    await expect(loadKmzObjectWithWarnings(fixture.bytes.buffer)).rejects.toThrow('bad geometry'); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('rejects pre-aborted input before opening the ZIP', async () => {
    const controller = new AbortController(); controller.abort(); const spy = vi.spyOn(core, 'openZipArchive');
    await expect(loadKmzObjectWithWarnings(new ArrayBuffer(0), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' }); expect(spy).not.toHaveBeenCalled();
  });

  it.each(['archive', 'kml', 'model', 'image'] as const)('settles cancellation during a non-cooperative %s read and observes its late rejection', async stage => {
    const fixture = await createKmzFixture(), archive = await JSZip.loadAsync(fixture.bytes), held = deferred<any>(), controller = new AbortController();
    vi.spyOn(JSZip, 'loadAsync').mockImplementation(() => stage === 'archive' ? held.promise : Promise.resolve(archive));
    const spy = vi.spyOn(core, 'openZipArchive').mockImplementation(() => stage === 'archive' ? held.promise : Promise.resolve(entries(archive)));
    const name = stage === 'kml' ? fixture.kmlName : stage === 'model' ? fixture.modelName : fixture.textureName;
    const read = vi.spyOn(archive.files[name], 'async').mockReturnValue(held.promise);
    const pending = loadKmzObjectWithWarnings(fixture.bytes.buffer, { signal: controller.signal });
    await vi.waitFor(() => expect(stage === 'archive' ? spy : read).toHaveBeenCalled());
    const settled = expect(pending).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await settled; held.reject(new Error('late ZIP failure')); await Promise.resolve();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('cancels pending textures, disposes abandoned resources and leaves later image completion harmless', async () => {
    const fixture = await createKmzFixture(), mock = mockTextures([fixture.textureHref], true), controller = new AbortController();
    const node = mock.object.children[0] as Mesh, geometry = vi.spyOn(node.geometry, 'dispose'), material = vi.spyOn(node.material as MeshStandardMaterial, 'dispose');
    const texture = vi.spyOn((node.material as MeshStandardMaterial).map!, 'dispose');
    const pending = loadKmzObjectWithWarnings(fixture.bytes.buffer, { signal: controller.signal });
    await vi.waitFor(() => expect(mock.urls).toHaveLength(1)); const settled = expect(pending).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await settled;
    expect(geometry).toHaveBeenCalledTimes(1); expect(material).toHaveBeenCalledTimes(1); expect(texture).toHaveBeenCalledTimes(1); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    mock.finish(); await Promise.resolve(); expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('removes listeners and leaves a returned scene alive after later cancellation', async () => {
    const fixture = await createKmzFixture(), mock = mockTextures([fixture.textureHref]), controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener'), remove = vi.spyOn(controller.signal, 'removeEventListener'); const dispose = vi.spyOn((mock.object.children[0] as Mesh).geometry, 'dispose');
    await loadKmzObjectWithWarnings(fixture.bytes.buffer, { signal: controller.signal }); controller.abort();
    expect(dispose).not.toHaveBeenCalled(); expect(remove.mock.calls.length).toBe(add.mock.calls.length);
  });

  it.each(['no model', 'invalid ZIP', 'invalid XML'] as const)('rejects %s input explicitly', async kind => {
    const zip = new JSZip(); zip.file(kind === 'no model' ? 'doc.kml' : 'model.dae', kind === 'invalid XML' ? '<COLLADA>' : '<kml/>');
    await expect(loadKmzObjectWithWarnings(kind === 'invalid ZIP' ? new Uint8Array([1, 2, 3]).buffer : await bytes(zip))).rejects.toThrow();
  });
});
