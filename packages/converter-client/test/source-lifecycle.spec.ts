// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createHttpConverterClient, createWasmConverterClient, createWasmCoreRunner } from '../src';
import { call, createWasiProgram, get32, iov, open, write } from './fixtures/wasi.mjs';
import type { ConversionRequest, PreviewLoadContext } from '@filens/core';

const input = new TextEncoder().encode('{\\rtf1\\ansi URL input preview}');
const context = (source: ConversionRequest['source'], signal?: AbortSignal): PreviewLoadContext => ({ descriptor: { source }, signal });
const request = (source: ConversionRequest['source'], name = 'preview.rtf'): ConversionRequest => ({ source, name, sourceFormat: 'rtf', targetFormat: 'docx' });
const response = () => new Response(JSON.stringify({ format: 'docx', base64: 'AQID' }), { headers: { 'Content-Type': 'application/json' } });
const nextTurn = () => new Promise<void>(resolve => setTimeout(resolve, 0));
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('conversion source ownership', () => {
  let wasm: WebAssembly.Module, expected: Uint8Array;
  beforeAll(async () => {
    wasm = await WebAssembly.compile(await readFile(new URL('../../../wasm/converter-core/dist/converter-core.wasm', import.meta.url)));
    expected = (await createWasmConverterClient({ wasm }).convert(request(input), context(input))).source as Uint8Array;
  });

  it.each(['https://example.test/a.rtf', '/samples/a.rtf', './samples/a.rtf', '../samples/a.rtf', 'blob:https://example.test/file'])('uploads downloaded bytes for HTTP source %s even when its name equals the URL', async source => {
    const controller = new AbortController();
    const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (url === source) { expect(init?.signal).toBe(controller.signal); return new Response(input); }
      expect(url).toBe('/convert');
      const file = (init!.body as FormData).get('file') as File;
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(input);
      return response();
    });
    const result = await createHttpConverterClient({ endpoint: '/convert', fetch }).convert(request(source, source), context(source, controller.signal));
    expect(result.source).toEqual(new Uint8Array([1, 2, 3]));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(['https://example.test/a.rtf', '/samples/a.rtf', './samples/a.rtf', '../samples/a.rtf'])('converts downloaded bytes for WASM source %s even when its name equals the URL', async source => {
    const fetch = vi.fn(async () => new Response(input));
    const result = await createWasmConverterClient({ wasm, fetch }).convert(request(source, source), context(source));
    expect(result.source).toEqual(expected);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps inline text as text and preserves complete typed-array slices and snapshots', async () => {
    const payloads: Uint8Array[] = [];
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      payloads.push(new Uint8Array(await ((init!.body as FormData).get('file') as File).arrayBuffer()));
      return response();
    });
    const client = createHttpConverterClient({ endpoint: '/convert', fetch });
    const backing = new Uint8Array([99, 1, 2, 3, 88]), slice = backing.subarray(1, 4);
    const pending = client.convert(request(slice), context(slice));
    backing.fill(0);
    await pending;
    const text = '{\\rtf1 literal / is text}';
    await client.convert(request(text), context(text));
    expect(payloads).toEqual([new Uint8Array([1, 2, 3]), new TextEncoder().encode(text)]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('preserves binary percent-encoded data URL bytes without treating them as UTF-8', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const file = (init!.body as FormData).get('file') as File;
      expect(file.type).toBe('application/octet-stream');
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([0, 255, 128, 43, 65]));
      return response();
    });
    const source = 'data:application/octet-stream,%00%FF%80+A';
    await createHttpConverterClient({ endpoint: '/convert', fetch }).convert(request(source), context(source));
  });

  it('snapshots SharedArrayBuffer views without exposing prefix or suffix bytes', async () => {
    const backing = new Uint8Array(new SharedArrayBuffer(5)); backing.set([99, 1, 2, 3, 88]);
    const source = backing.subarray(1, 4);
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const file = (init!.body as FormData).get('file') as File;
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
      return response();
    });
    const pending = createHttpConverterClient({ endpoint: '/convert', fetch }).convert(request(source), context(source));
    backing.fill(0); await pending;
  });

  it('preserves UTF-8 literal and escaped text in data URLs for both clients', async () => {
    const text = '{\\rtf1 Chinese}', source = `data:application/rtf,${encodeURIComponent(text)}`;
    const result = await createWasmConverterClient({ wasm }).convert(request(source), context(source));
    expect(result.source).toEqual((await createWasmConverterClient({ wasm }).convert(request(text), context(text))).source);
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const file = (init!.body as FormData).get('file') as File;
      expect(await file.text()).toBe('中文/中文+'); return response();
    });
    const unicode = 'data:text/plain,中文%2F%E4%B8%AD%E6%96%87+';
    await createHttpConverterClient({ endpoint: '/convert', fetch }).convert(request(unicode), context(unicode));
  });

  it('converts a binary percent-encoded ICNS data URL to the complete original PNG', async () => {
    const bytes = new Uint8Array(await readFile(new URL('../../../apps/demo/public/samples/photo-transparency.icns', import.meta.url)));
    const source = 'data:application/x-icns,' + [...bytes].map(byte => '%' + byte.toString(16).padStart(2, '0')).join('');
    const client = createWasmConverterClient({ wasm });
    const fromBytes = await client.convert({ source: bytes, sourceFormat: 'icns', targetFormat: 'png' }, context(bytes));
    const fromUrl = await client.convert({ source, sourceFormat: 'icns', targetFormat: 'png' }, context(source));
    expect(fromUrl.source).toEqual(fromBytes.source);
    expect((fromUrl.source as Uint8Array).slice(0, 8)).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
  });

  it('does not upload an already-aborted HTTP request', async () => {
    const controller = new AbortController(); controller.abort('caller stopped');
    const fetch = vi.fn(async () => response());
    await expect(createHttpConverterClient({ endpoint: '/convert', fetch }).convert(request(input), context(input, controller.signal))).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not POST after a cancelled source download', async () => {
    const controller = new AbortController();
    const fetch = vi.fn(async () => { controller.abort(); return new Response(input); });
    const source = '/sample.rtf';
    await expect(createHttpConverterClient({ endpoint: '/convert', fetch }).convert(request(source), context(source, controller.signal))).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not upload missing remote files', async () => {
    const fetch = vi.fn(async () => new Response('missing', { status: 404 }));
    const source = '/missing.rtf';
    await expect(createHttpConverterClient({ endpoint: '/convert', fetch }).convert(request(source), context(source))).rejects.toThrow('Failed to fetch conversion source: 404');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('settles cancellation while a non-cooperative HTTP fetch is pending and observes its late failure', async () => {
    const work = deferred<Response>(), controller = new AbortController();
    const fetch = vi.fn(() => work.promise);
    let outcome = 'pending';
    const pending = createHttpConverterClient({ endpoint: '/convert', fetch }).convert(request(input), context(input, controller.signal))
      .then(() => { outcome = 'loaded'; }, error => { outcome = error.name; });
    await nextTurn(); controller.abort(); await nextTurn(); const before = outcome;
    work.reject(new Error('late HTTP failure')); await pending;
    expect(before).toBe('AbortError');
  });

  it('settles cancellation while reading a non-cooperative HTTP response body', async () => {
    const work = deferred<unknown>(), controller = new AbortController();
    const result = response(); Object.defineProperty(result, 'json', { value: () => work.promise });
    let outcome = 'pending';
    const pending = createHttpConverterClient({ endpoint: '/convert', fetch: async () => result }).convert(request(input), context(input, controller.signal))
      .then(() => { outcome = 'loaded'; }, error => { outcome = error.name; });
    await nextTurn(); controller.abort(); await nextTurn(); const before = outcome;
    work.resolve({ text: 'late', format: 'docx' }); await pending;
    expect(before).toBe('AbortError');
  });

  it('settles cancellation of a delayed WASM Blob read without loading a module', async () => {
    const work = deferred<ArrayBuffer>(), controller = new AbortController();
    const source = new Blob([]); Object.defineProperty(source, 'arrayBuffer', { value: () => work.promise });
    const load = vi.fn(async () => wasm);
    let outcome = 'pending';
    const pending = createWasmConverterClient({ wasm: load }).convert(request(source), context(source, controller.signal))
      .then(() => { outcome = 'loaded'; }, error => { outcome = error.name; });
    await nextTurn(); controller.abort(); await nextTurn(); const before = outcome;
    work.resolve(input.slice().buffer); await pending;
    expect(before).toBe('AbortError'); expect(load).not.toHaveBeenCalled();
  });
});

describe('WASM module loading ownership', () => {
  const module = () => WebAssembly.compile(createWasiProgram());

  it('keeps the public runner input snapshot while its module is loading', async () => {
    const work = deferred<WebAssembly.Module>(), input = new Uint8Array([1, 2, 3]);
    const program = createWasiProgram({ data: [[1024, 'input.bin'], [1040, 'output.bin']], commands: [
      open(1024, 'input.bin', 128, 0), iov(4096, 3), call('fd_read', [get32(128), 64, 1, 256]),
      open(1040, 'output.bin', 132), write(132)
    ] });
    const pending = createWasmCoreRunner({ wasm: () => work.promise })({ args: [], files: { '/work/input.bin': input }, readFiles: ['/work/output.bin'] });
    input.fill(0); work.resolve(await WebAssembly.compile(program));
    expect((await pending).files['/work/output.bin']).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('retries a failed loader on the next invocation and then reuses the successful module', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('temporary load failure')).mockImplementation(module);
    const run = createWasmCoreRunner({ wasm: load });
    await expect(run({ args: [], files: {} })).rejects.toThrow('temporary load failure');
    expect((await run({ args: [], files: {} })).exitCode).toBe(0);
    expect((await run({ args: [], files: {} })).exitCode).toBe(0);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('recovers the shared image ABI runtime after a temporary module load failure', async () => {
    const image = await WebAssembly.compile(await readFile(new URL('../../../wasm/converter-image/dist/converter-image.wasm', import.meta.url)));
    const bytes = new Uint8Array(await readFile(new URL('../../../apps/demo/public/samples/raw/pentax-k-r.dng', import.meta.url)));
    const load = vi.fn().mockRejectedValueOnce(new Error('temporary image failure')).mockResolvedValue(image);
    const client = createWasmConverterClient({ wasm: () => { throw new Error('image route loaded document core'); }, imageWasm: load });
    const input = { source: bytes, sourceFormat: 'dng', targetFormat: 'jpg' };
    await expect(client.convert(input, context(bytes))).rejects.toThrow('temporary image failure');
    const recovered = await client.convert(input, context(bytes));
    expect(recovered).toMatchObject({ format: 'jpg', contentType: 'image/jpeg' });
    expect((recovered.source as Uint8Array).slice(0, 2)).toEqual(new Uint8Array([255, 216]));
    expect((await client.convert(input, context(bytes))).source).toEqual(recovered.source);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('cancels one invocation without poisoning a shared module load or starting its instance', async () => {
    const work = deferred<WebAssembly.Module>(), controller = new AbortController(), load = vi.fn(() => work.promise);
    const run = createWasmCoreRunner({ wasm: load });
    let outcome = 'pending';
    const old = run({ args: [], files: {}, signal: controller.signal })
      .then(() => { outcome = 'loaded'; }, error => { outcome = error.name; });
    const current = run({ args: [], files: {} });
    await nextTurn(); controller.abort(); await nextTurn(); const before = outcome;
    const instantiate = vi.spyOn(WebAssembly, 'instantiate');
    try {
      work.resolve(await module()); await old;
      expect((await current).exitCode).toBe(0);
      expect(before).toBe('AbortError'); expect(load).toHaveBeenCalledTimes(1);
      expect(instantiate).toHaveBeenCalledTimes(1);
    } finally { instantiate.mockRestore(); }
  });
});
