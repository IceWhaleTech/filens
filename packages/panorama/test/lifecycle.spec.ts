import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreviewLoadContext } from '@filens/core';
import type { PanoramaAssetManifest, PanoramaProcessor } from '../src/wasm-processor';
import { PanoramaPreviewSession } from '../src/preview-driver';
import { createRawImagePreviewDriver } from '../src/raw-preview-driver';
import { Texture } from 'three';

const hooks = vi.hoisted(() => ({ textures: [] as any[], renderers: [] as any[], calibrated: vi.fn() }));
vi.mock('three', async original => {
  const lib = await original<typeof import('three')>();
  return { ...lib, WebGLRenderer: class {
    domElement = document.createElement('canvas'); capabilities = { getMaxAnisotropy: () => 1 };
    setPixelRatio = vi.fn(); setClearColor = vi.fn(); setSize = vi.fn(); render = vi.fn(); dispose = vi.fn(); forceContextLoss = vi.fn();
    constructor() { hooks.renderers.push(this); }
  }, TextureLoader: class { loadAsync(url: string) { const task = deferred<any>(); hooks.textures.push({ url, ...task }); return task.promise; } } };
});
vi.mock('../src/calibrated-renderer', async original => ({ ...await original<typeof import('../src/calibrated-renderer')>(),
  createCalibratedPanoramaRenderer: (...args: any[]) => hooks.calibrated(...args),
  createCalibratedPanoramaImageRenderer: (...args: any[]) => hooks.calibrated(...args)
}));
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const context = (name: string, signal?: AbortSignal): PreviewLoadContext => ({ descriptor: { name, extension: name.split('.').at(-1) }, route: {
  family: /\.(360v|insv|osv)$/.test(name) ? 'panorama-video' : 'panorama', sourceFormat: name.split('.').at(-1)! }, signal });
const manifest = (projection = 'unknown'): PanoramaAssetManifest => ({ vendor: 'insta360', format: 'dng', projection: { kind: projection } as any,
  calibrationSource: 'embedded', confidence: 'experimental', tracks: [], lenses: [], warnings: [], width: 200, height: 100 });
const texture = (width = 200) => { const value = new Texture({ width, height: width / 2 } as any); vi.spyOn(value, 'dispose'); return value; };
const processor = (value = manifest()): PanoramaProcessor => ({ open: vi.fn().mockResolvedValue(value), close: vi.fn(), abort: vi.fn(), getManifest: () => value,
  decodeImage: vi.fn(), readSample: vi.fn(), readImuWindow: vi.fn(), computeSeam: vi.fn(), seek: vi.fn() });
const sessions: Array<{ destroy(): void }> = [];
let urls: Map<string, Blob>, nextUrl: number;
function session(options: ConstructorParameters<typeof PanoramaPreviewSession>[1] = {}, p?: PanoramaProcessor) {
  const host = document.createElement('div'); document.body.append(host); const s = new PanoramaPreviewSession(host, options, p); sessions.push(s); return { host, s };
}
async function photo(s: PanoramaPreviewSession, signal?: AbortSignal) {
  const before = hooks.textures.length, work = s.load(new Blob(['image']), context('current.pano', signal));
  await vi.waitFor(() => expect(hooks.textures.length).toBe(before + 1)); const value = texture(); hooks.textures.at(-1).resolve(value); await work; return value;
}
beforeEach(() => {
  urls = new Map(); nextUrl = 0; hooks.textures.length = hooks.renderers.length = 0; hooks.calibrated.mockReset(); const OriginalURL = URL;
  vi.stubGlobal('URL', class extends OriginalURL {
    static createObjectURL(blob: Blob) { const url = `blob:panorama-${++nextUrl}`; urls.set(url, blob); return url; }
    static revokeObjectURL(url: string) { urls.delete(url); }
  });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}); vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(() => { sessions.splice(0).forEach(s => s.destroy()); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

describe('panorama load ownership', () => {
  it.each(['success', 'failure'])('ignores obsolete image %s without damaging the replacement', async outcome => {
    const { host, s } = session(), errors = vi.fn(); s.on('error', errors);
    const old = s.load(new Blob(['old']), context('old.pano')), rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(hooks.textures).toHaveLength(1)); const pending = hooks.textures[0]; await photo(s); await rejected;
    const current = host.querySelector('canvas'), late = texture(800);
    if (outcome === 'success') pending.resolve(late); else pending.reject(new Error('obsolete decode')); await Promise.resolve();
    if (outcome === 'success') expect(late.dispose).toHaveBeenCalledOnce();
    expect(host.querySelector('canvas')).toBe(current); expect(errors).not.toHaveBeenCalled(); expect(hooks.renderers[1].dispose).not.toHaveBeenCalled();
    expect(s.getState()).toMatchObject({ title: 'current.pano', naturalWidth: 200, error: null, loading: false }); expect(urls.size).toBe(1);
  });
  it('settles destruction before an uncooperative request and releases its late output', async () => {
    const { host, s } = session(), work = s.load(new Blob(['old']), context('old.pano')), rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(hooks.textures).toHaveLength(1)); s.destroy(); await rejected;
    expect(host.children.length).toBe(0); expect(urls.size).toBe(0); expect(s.getState().loading).toBe(false);
    const late = texture(); hooks.textures[0].resolve(late); await Promise.resolve(); expect(late.dispose).toHaveBeenCalledOnce(); expect(host.children.length).toBe(0);
  });
  it('clears displayed photos on abort and retires retained canvas events', async () => {
    const { host, s } = session(), abort = new AbortController(), value = await photo(s, abort.signal);
    const canvas = host.querySelector('canvas')!, events = vi.fn(); s.on('statechange', events); abort.abort(); const calls = events.mock.calls.length;
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 })); expect(events).toHaveBeenCalledTimes(calls);
    expect(s.getState()).toMatchObject({ loading: false, error: null, scale: 1 }); expect(host.querySelector('canvas')).toBeNull(); expect(urls.size).toBe(0);
    expect(value.dispose).toHaveBeenCalledOnce(); expect(hooks.renderers[0].forceContextLoss).toHaveBeenCalledOnce();
  });
  it('does not start work for a pre-aborted context', async () => {
    const { s } = session(), abort = new AbortController(); abort.abort();
    await expect(s.load('missing.pano', context('missing.pano', abort.signal))).rejects.toMatchObject({ name: 'AbortError' });
    expect(hooks.renderers).toHaveLength(0); expect(s.getState()).toMatchObject({ loading: false, error: null });
  });
  it('releases failed images and supports reopening after destruction', async () => {
    const { host, s } = session(), work = s.load(new Blob(['x']), context('bad.pano')), rejected = expect(work).rejects.toThrow('bad image');
    await vi.waitFor(() => expect(hooks.textures).toHaveLength(1)); hooks.textures[0].reject(new Error('bad image')); await rejected;
    expect(urls.size).toBe(0); expect(host.querySelector('canvas')).toBeNull(); s.destroy(); await photo(s);
    expect(host.querySelector('canvas')).not.toBeNull(); expect(s.getState().error).toBeNull();
  });
  it.each([false, true])('stops %s-ready video and ignores its obsolete events', async ready => {
    const { host, s } = session(), work = s.load(new Blob(['video']), context('old.360v'));
    const settled = work.then(() => 'loaded', error => error.name);
    await vi.waitFor(() => expect((s as any).video).not.toBeNull()); const old = (s as any).video as HTMLVideoElement;
    if (ready) { Object.defineProperties(old, { videoWidth: { value: 200 }, videoHeight: { value: 100 }, duration: { value: 12 } }); old.dispatchEvent(new Event('loadeddata')); await work; }
    await photo(s); expect(await settled).toBe(ready ? 'loaded' : 'AbortError'); const events = vi.fn(); s.on('statechange', events);
    old.dispatchEvent(new Event('loadeddata')); old.dispatchEvent(new Event('timeupdate')); old.dispatchEvent(new Event('error'));
    expect(events).not.toHaveBeenCalled(); expect(old.hasAttribute('src')).toBe(false); expect(old.pause).toHaveBeenCalled(); expect(host.querySelector('video')).toBeNull();
    expect(s.getState()).toMatchObject({ title: 'current.pano', loading: false, duration: undefined, error: null });
  });
  it('ignores a late companion resolver without inspecting or closing replacement media', async () => {
    const pending = deferred<Blob>(), p = processor(), { s } = session({ resourceResolver: () => pending.promise }, p);
    const work = s.load('old.insv', context('VID_00_001.insv')), rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' });
    await photo(s); await rejected; const closes = (p.close as any).mock.calls.length; pending.resolve(new Blob(['companion'])); await Promise.resolve();
    expect(p.open).not.toHaveBeenCalled(); expect(p.close).toHaveBeenCalledTimes(closes); expect(s.getState().title).toBe('current.pano');
  });
  it('does not forward stale proxy warnings or create a stale video', async () => {
    const pending = deferred<Blob>(), resolver = vi.fn(() => pending.promise), { host, s } = session({ resourceResolver: resolver });
    const work = s.load('old.osv', context('old.osv')), rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(resolver).toHaveBeenCalledOnce()); await photo(s); await rejected; pending.resolve(new Blob(['proxy'])); await Promise.resolve();
    expect(host.querySelector('video')).toBeNull(); expect(s.getState().warnings).toEqual([]);
  });
  it('closes a late calibrated renderer and blocks its stale processor access', async () => {
    const pending = deferred<any>(), p = processor(manifest('dji-fisheye-lut')); hooks.calibrated.mockReturnValue(pending.promise);
    const { host, s } = session({}, p), work = s.load('old.osv', context('old.osv')), rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(hooks.calibrated).toHaveBeenCalledOnce()); const bound = hooks.calibrated.mock.calls[0][0] as PanoramaProcessor;
    await photo(s); await rejected; const close = vi.fn(); pending.resolve({ close }); await Promise.resolve(); expect(close).toHaveBeenCalledOnce();
    expect(() => bound.readSample(1, 0)).toThrow(/aborted/); expect(p.readSample).not.toHaveBeenCalled(); expect(host.querySelector('canvas')).not.toBeNull();
  });
  it('retires calibrated controls retained after destruction', () => {
    const { host, s } = session(), renderer = { pause: vi.fn(), play: vi.fn(), seek: vi.fn(), close: vi.fn(), paused: false, duration: 10, currentTime: 2 };
    (s as any).calibratedRenderer = renderer; (s as any).createCalibratedControls(renderer); const button = host.querySelector('button')!, range = host.querySelector('input')!;
    s.destroy(); button.click(); range.dispatchEvent(new Event('change')); expect(renderer.pause).not.toHaveBeenCalled(); expect(renderer.seek).not.toHaveBeenCalled();
  });
  it('clears calibrated image decoding handlers and its URL on destruction', async () => {
    const { s } = session(), images: HTMLImageElement[] = [], create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((name: string, options?: any) => {
      const node = create(name, options); if (name === 'img') images.push(node as HTMLImageElement); return node;
    }) as typeof document.createElement);
    const work = s.loadCalibratedImage(new Uint8Array([255,216]), manifest(), context('old.dng'));
    const rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' }); s.destroy(); await rejected;
    expect(images[0].onload).toBeNull(); expect(images[0].onerror).toBeNull(); expect(images[0].hasAttribute('src')).toBe(false); expect(urls.size).toBe(0);
  });
  it('snapshots the exact caller slice before later mutation', async () => {
    const { s } = session(), backing = new Uint8Array([9,1,2,3,9]), work = s.load(backing.subarray(1,4), context('slice.pano'));
    await vi.waitFor(() => expect(hooks.textures).toHaveLength(1)); const blob = [...urls.values()][0]; backing.fill(0);
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob);
    });
    expect([...new Uint8Array(bytes)]).toEqual([1,2,3]); hooks.textures[0].resolve(texture()); await work;
  });
});

describe('RAW load ownership', () => {
  function raw(p = processor(), converter = { convert: vi.fn().mockResolvedValue({ source: new Uint8Array([1]), format: 'jpg' }) }) {
    const host = document.createElement('div'); document.body.append(host); const s = createRawImagePreviewDriver({ processor: p, converter }).createSession(host); sessions.push(s); return { host, s, p, converter };
  }
  it('settles cancellation before an uncooperative converter returns', async () => {
    const pending = deferred<any>(), converter = { convert: vi.fn(() => pending.promise) }, { host, s } = raw(undefined, converter), abort = new AbortController();
    const work = s.load(new Blob(['raw']), context('old.dng', abort.signal)), rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(converter.convert).toHaveBeenCalledOnce()); abort.abort(); await rejected; expect(s.getState()).toMatchObject({ loading: false, error: null });
    pending.resolve({ source: new Uint8Array([1]), format: 'jpg' }); await Promise.resolve(); expect(host.querySelector('img')).toBeNull(); expect(urls.size).toBe(0);
  });
  it('ignores late failures without closing or removing the replacement', async () => {
    const pending = deferred<any>(), converter = { convert: vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue({ source: new Uint8Array([1]), format: 'jpg' }) }, { host, s, p } = raw(undefined, converter);
    const work = s.load(new Blob(['old']), context('old.dng')), rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(converter.convert).toHaveBeenCalledOnce()); await s.load(new Blob(['new']), context('new.dng')); await rejected;
    const current = host.querySelector('img'), closes = (p.close as any).mock.calls.length; pending.reject(new Error('obsolete')); await Promise.resolve();
    expect(host.querySelector('img')).toBe(current); expect(p.close).toHaveBeenCalledTimes(closes); expect(s.getState().error).toBeNull();
  });
  it('clears a displayed RAW on abort and ignores old image events', async () => {
    const { host, s } = raw(), abort = new AbortController(); await s.load(new Blob(['raw']), context('raw.dng', abort.signal));
    const image = host.querySelector('img')!; image.dispatchEvent(new Event('load')); abort.abort(); image.dispatchEvent(new Event('error'));
    expect(host.querySelector('img')).toBeNull(); expect(urls.size).toBe(0); expect(s.getState()).toMatchObject({ loading: false, error: null });
  });
  it('does not start pre-aborted RAW work', async () => {
    const { s, p, converter } = raw(), abort = new AbortController(); abort.abort();
    await expect(s.load(new Blob(['raw']), context('raw.dng', abort.signal))).rejects.toMatchObject({ name: 'AbortError' });
    expect(p.open).not.toHaveBeenCalled(); expect(converter.convert).not.toHaveBeenCalled(); expect(s.getState().loading).toBe(false);
  });
  it('retains warnings and protects state snapshots', async () => {
    const { host, s } = raw(undefined, { convert: vi.fn().mockResolvedValue({ source: new Uint8Array([1]), format: 'jpg', warnings: ['RAW fallback'] }) });
    await s.load(new Blob(['raw']), context('raw.dng')); host.querySelector('img')!.dispatchEvent(new Event('load'));
    s.getState().warnings.push('external'); expect(s.getState().warnings).toEqual(['RAW fallback']);
  });
  it('discards a late calibrated sensor decode without closing a replacement source', async () => {
    const value = manifest('mei-extended');
    value.lenses = [0,1].map(index => ({ sourceRect:{x:index / 2,y:0,width:.5,height:1}, width:100,height:100,fx:50,fy:50,cx:50,cy:50,extrinsicQuaternion:index ? [0,0,1,0] : [1,0,0,0] }));
    const pending = deferred<Uint8Array>(), p = processor(value); (p.decodeImage as any).mockReturnValue(pending.promise);
    const { s, host } = raw(p), work = s.load(new Blob(['old']), context('old.dng')), rejected = expect(work).rejects.toMatchObject({name:'AbortError'});
    await vi.waitFor(() => expect(p.decodeImage).toHaveBeenCalledOnce()); (p.open as any).mockResolvedValue(manifest());
    await s.load(new Blob(['new']), context('new.dng')); await rejected; const closes = (p.close as any).mock.calls.length;
    pending.resolve(new Uint8Array([1])); await Promise.resolve(); expect(p.close).toHaveBeenCalledTimes(closes); expect(host.querySelector('img')).not.toBeNull();
  });
});
