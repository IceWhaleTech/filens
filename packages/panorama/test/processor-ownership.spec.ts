// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createWasmPanoramaProcessor, type PanoramaAssetManifest } from '../src/wasm-processor';
import { dngFixture } from './fixtures/dng';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const turn = () => new Promise<void>(resolve => setTimeout(resolve, 0));
function observe(work: Promise<unknown>) {
  const result = { status: 'pending', done: Promise.resolve() };
  result.done = work.then(() => { result.status = 'resolved'; }, error => { result.status = error.name; });
  return result;
}
const body = (bytes: Uint8Array, size = bytes.length) => new Response(bytes, { headers: { 'Content-Length': String(size) } });
const attachTrack = (manifest: PanoramaAssetManifest, size = 4) => {
  const track = { id: 42, codec: 'avc1', decoderConfig: '', width: 1, height: 1, timescale: 30,
    samples: [{ offset: 0, size, pts: 0, duration: 1, key: true }] };
  manifest.tracks.push(track); return track;
};

describe('panorama processor source ownership', () => {
  let wasm: WebAssembly.Module, imageWasm: WebAssembly.Module;
  const source = dngFixture('x5');
  beforeAll(async () => {
    [wasm, imageWasm] = await Promise.all(['converter-core', 'converter-image'].map(async name =>
      WebAssembly.compile(await readFile(new URL(`../../../wasm/${name}/dist/${name}.wasm`, import.meta.url)))));
  });
  afterEach(() => vi.restoreAllMocks());

  it('settles a cancelled probe before its non-cooperative fetch rejects', async () => {
    const work = deferred<Response>(), controller = new AbortController();
    const processor = createWasmPanoramaProcessor({ wasm, fetch: () => work.promise });
    const outcome = observe(processor.open('/slow.dng', { format: 'dng', signal: controller.signal }));
    await turn(); controller.abort(); await turn(); const before = outcome.status;
    work.reject(new Error('late probe')); await outcome.done; processor.close();
    expect(before).toBe('AbortError'); expect(processor.getManifest()).toBeUndefined();
  });

  it('does not fetch or load a module for an already-aborted open', async () => {
    const controller = new AbortController(); controller.abort();
    const fetch = vi.fn(async () => body(source)), load = vi.fn(async () => wasm);
    const processor = createWasmPanoramaProcessor({ wasm: load, fetch });
    await expect(processor.open('/source.dng', { format: 'dng', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled(); processor.close();
  });

  it('cancels a closed open while preserving the module load for a replacement', async () => {
    const work = deferred<WebAssembly.Module>(), load = vi.fn(() => work.promise);
    const processor = createWasmPanoramaProcessor({ wasm: load });
    const outcome = observe(processor.open(source, { format: 'dng' }));
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce()); processor.close();
    const newest = processor.open(dngFixture('one-rs'), { format: 'dng' });
    await turn(); const before = outcome.status;
    const instantiate = vi.spyOn(WebAssembly, 'instantiate');
    work.resolve(wasm); await outcome.done; await newest;
    expect(before).toBe('AbortError'); expect(instantiate).toHaveBeenCalledTimes(1);
    expect(processor.getManifest()?.cameraModel).toBe('Insta360 OneRS'); expect(load).toHaveBeenCalledOnce(); processor.close();
  });

  it('retains the open signal for later sample reads', async () => {
    const controller = new AbortController(), processor = createWasmPanoramaProcessor({ wasm });
    attachTrack(await processor.open(source, { format: 'dng', signal: controller.signal })); controller.abort();
    await expect(processor.readSample(42, 0)).rejects.toMatchObject({ name: 'AbortError' }); processor.close();
  });

  it('never exposes a partial manifest while a companion is still loading', async () => {
    const work = deferred<Response>(), fetch = vi.fn(() => work.promise), processor = createWasmPanoramaProcessor({ wasm, fetch });
    const pending = processor.open(source, { format: 'dng', companion: '/companion.dng' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce()); const partial = processor.getManifest();
    work.resolve(body(dngFixture('one-rs'))); const complete = await pending;
    expect(partial).toBeUndefined(); expect(processor.getManifest()).toBe(complete); processor.close();
  });

  it('clears a failed companion open instead of publishing its primary source', async () => {
    const processor = createWasmPanoramaProcessor({ wasm, fetch: async () => new Response('missing', { status: 404 }) });
    await expect(processor.open(source, { format: 'dng', companion: '/missing.dng' })).rejects.toMatchObject({ code: 'range_unavailable' });
    expect(processor.getManifest()).toBeUndefined();
    await expect(processor.decodeImage!()).rejects.toMatchObject({ code: 'invalid_manifest' });
    await processor.open(source, { format: 'dng' }); expect(processor.getManifest()?.cameraModel).toBe('Insta360 X5'); processor.close();
  });

  it.each([-1, 1])('rejects a complete-body response with content length off by %s', async difference => {
    const processor = createWasmPanoramaProcessor({ wasm, fetch: async () => body(source, source.length + difference) });
    await expect(processor.open('/wrong-size.dng', { format: 'dng' })).rejects.toMatchObject({ code: 'range_unavailable' });
    expect(processor.getManifest()).toBeUndefined(); processor.close();
  });

  it('accepts browser-decoded HTTP bodies whose encoded content length differs', async () => {
    const processor = createWasmPanoramaProcessor({ wasm, fetch: async () => new Response(source,
      { headers: { 'Content-Length': '1000', 'Content-Encoding': 'gzip' } }) });
    expect((await processor.open('/decoded.dng', { format: 'dng' })).cameraModel).toBe('Insta360 X5'); processor.close();
  });

  it('settles cancellation during a non-cooperative complete-body read', async () => {
    const work = deferred<ArrayBuffer>(), controller = new AbortController(), response = body(source);
    Object.defineProperty(response, 'arrayBuffer', { value: () => work.promise });
    const processor = createWasmPanoramaProcessor({ wasm, fetch: async () => response });
    const outcome = observe(processor.open('/slow-body.dng', { format: 'dng', signal: controller.signal }));
    await turn(); controller.abort(); await turn(); const before = outcome.status;
    work.resolve(source.slice().buffer); await outcome.done;
    expect(before).toBe('AbortError'); expect(processor.getManifest()).toBeUndefined(); processor.close();
  });

  it('does not request an invalid HTTP range for an empty encoded sample', async () => {
    const fetch = vi.fn(async (_url, options) => {
      const [, start, end] = (options!.headers as Record<string, string>).Range.match(/^bytes=(\d+)-(\d+)$/)!;
      return new Response(source.slice(+start, +end + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${source.length}` } });
    });
    const processor = createWasmPanoramaProcessor({ wasm, fetch });
    attachTrack(await processor.open('/sample.dng', { format: 'dng' }), 0); const before = fetch.mock.calls.length;
    const sample = await processor.readSample(42, 0);
    expect(sample.data).toEqual(new Uint8Array()); expect(fetch).toHaveBeenCalledTimes(before); processor.close();
  });

  it('settles a pending sample read on replacement and ignores its late failure', async () => {
    const work = deferred<Response>(); let reading = false;
    const processor = createWasmPanoramaProcessor({ wasm, fetch: async (_url, options) => {
      if (reading) return work.promise;
      const [, start, end] = (options!.headers as Record<string, string>).Range.match(/^bytes=(\d+)-(\d+)$/)!;
      return new Response(source.slice(+start, +end + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${source.length}` } });
    } });
    attachTrack(await processor.open('/sample.dng', { format: 'dng' })); reading = true;
    const outcome = observe(processor.readSample(42, 0)); await turn();
    await processor.open(dngFixture('one-rs'), { format: 'dng' }); await turn(); const before = outcome.status;
    work.reject(new Error('late sample')); await outcome.done;
    expect(before).toBe('AbortError'); expect(processor.getManifest()?.cameraModel).toBe('Insta360 OneRS'); processor.close();
  });

  it('does not let a stale failed open clear a newer successful source', async () => {
    const work = deferred<Response>(), processor = createWasmPanoramaProcessor({ wasm, fetch: () => work.promise });
    const outcome = observe(processor.open('/old.dng', { format: 'dng' }));
    await processor.open(source, { format: 'dng' }); work.reject(new Error('late open')); await outcome.done;
    expect(processor.getManifest()?.cameraModel).toBe('Insta360 X5'); processor.close();
  });

  it.each(['caller', 'processor', 'close'] as const)('cancels a seam during module loading through %s', async reason => {
    const work = deferred<WebAssembly.Module>(), controller = new AbortController(), load = vi.fn(() => work.promise);
    const processor = createWasmPanoramaProcessor({ wasm: load });
    const outcome = observe(processor.computeSeam({ width: 2, height: 2, costs: [3, 1, 3, 1] }, controller.signal));
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    if (reason === 'caller') controller.abort(); else processor[reason === 'processor' ? 'abort' : 'close']();
    await turn(); const before = outcome.status; work.resolve(wasm); await outcome.done;
    expect(before).toBe('AbortError'); processor.close();
    await expect(processor.computeSeam({ width: 2, height: 2, costs: [3, 1, 3, 1] })).resolves.toMatchObject({ seam: [1, 1] });
    expect(load).toHaveBeenCalledOnce(); processor.close();
  });

  it('cancels RAW decoder loading without poisoning its next invocation', async () => {
    const work = deferred<WebAssembly.Module>(), load = vi.fn(() => work.promise), controller = new AbortController();
    const processor = createWasmPanoramaProcessor({ wasm, imageWasm: load });
    await processor.open(source, { format: 'dng' }); const outcome = observe(processor.decodeImage!(controller.signal));
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce()); controller.abort(); await turn(); const before = outcome.status;
    work.resolve(imageWasm); await outcome.done;
    expect(before).toBe('AbortError');
    expect((await processor.decodeImage!()).slice(0, 2)).toEqual(new Uint8Array([255, 216])); expect(load).toHaveBeenCalledOnce(); processor.close();
  });

  it('cancels metadata decoding while WASM instantiation is pending', async () => {
    const processor = createWasmPanoramaProcessor({ wasm }), manifest = await processor.open(source, { format: 'dng' });
    manifest.metadataTrack = { ...attachTrack(manifest), samples: [] };
    const native = WebAssembly.instantiate.bind(WebAssembly), work = deferred<WebAssembly.Instance>(), controller = new AbortController();
    let actual!: Promise<WebAssembly.Instance>;
    const instantiate = vi.spyOn(WebAssembly, 'instantiate').mockImplementationOnce(((module: WebAssembly.Module, imports: WebAssembly.Imports) => {
      actual = native(module, imports); return work.promise;
    }) as any);
    const outcome = observe(processor.readImuWindow(0, 0, controller.signal));
    await vi.waitFor(() => expect(instantiate).toHaveBeenCalledOnce()); controller.abort(); await turn(); const before = outcome.status;
    work.resolve(await actual);
    await outcome.done; expect(before).toBe('AbortError'); processor.close();
  });

  it('removes fallback signal listeners after repeated successful and failed reads', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'any')!;
    Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true });
    try {
      const parent = new AbortController(), read = new AbortController();
      const added = vi.spyOn(read.signal, 'addEventListener'), removed = vi.spyOn(read.signal, 'removeEventListener');
      const parentAdded = vi.spyOn(parent.signal, 'addEventListener'), parentRemoved = vi.spyOn(parent.signal, 'removeEventListener');
      const processor = createWasmPanoramaProcessor({ wasm }), manifest = await processor.open(source, { format: 'dng', signal: parent.signal });
      attachTrack(manifest);
      for (let i = 0; i < 20; i++) expect((await processor.readSample(42, 0, read.signal)).data).toEqual(source.slice(0, 4));
      await expect(processor.readSample(99, 0, read.signal)).rejects.toBeInstanceOf(RangeError);
      const outstanding = added.mock.calls.length - removed.mock.calls.length;
      processor.close();
      expect(outstanding).toBe(0); expect(parentAdded).toHaveBeenCalled();
      expect(parentRemoved.mock.calls.length).toBe(parentAdded.mock.calls.length);
    } finally { Object.defineProperty(AbortSignal, 'any', descriptor); }
  });
});
