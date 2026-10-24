// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { createWasmConverterClient, createWasmCoreRunner } from '../src';

const root = new URL('../../../', import.meta.url);
const imageBytes = () => readFile(new URL('wasm/converter-image/dist/converter-image.wasm', root));
const source = () => readFile(new URL('apps/demo/public/samples/raw/pentax-k-r.dng', root));
const context = { descriptor: { source: new Uint8Array() } };

describe('direct image core preview', () => {
  it('stops an aborted preview before loading a conversion core', async () => {
    const controller = new AbortController();
    const loadCore = vi.fn(() => { throw Error('aborted work loaded a core'); });
    const client = createWasmConverterClient({ wasm: loadCore, imageWasm: loadCore });
    const pending = client.convert({ source: new Uint8Array([1, 2, 3]), sourceFormat: 'dng', targetFormat: 'jpg' }, { ...context, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(loadCore).not.toHaveBeenCalled();
  });

  it('forwards cancellation to remote source downloads', async () => {
    const controller = new AbortController();
    const fetchSource = vi.fn(async (_url: RequestInfo | URL, options?: RequestInit) => {
      expect(options?.signal).toBe(controller.signal);
      controller.abort();
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const client = createWasmConverterClient({ wasm: () => { throw Error('aborted work loaded a core'); }, fetch: fetchSource });
    await expect(client.convert({ source: 'https://example.com/photo.dng', sourceFormat: 'dng', targetFormat: 'jpg' }, { ...context, signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchSource).toHaveBeenCalledOnce();
  });
  it('returns identical JPEG bytes and warnings to the WASI entrypoint', async () => {
    const wasm = await WebAssembly.compile(await imageBytes());
    const input = new Uint8Array(await source());
    const client = createWasmConverterClient({ wasm, imageWasm: wasm });
    const result = await client.convert({ source: input, sourceFormat: 'dng', targetFormat: 'jpg' }, context);
    const wasi = await createWasmCoreRunner({ wasm })({
      args: ['converter-image', '--input', '/work/in.dng', '--output', '/work/out.jpg', '--source', 'dng', '--target', 'jpg', '--result', '/work/result.json'],
      files: { '/work/in.dng': input }, readFiles: ['/work/out.jpg', '/work/result.json']
    });
    expect(wasi.exitCode).toBe(0);
    expect(Buffer.from(result.source as Uint8Array).equals(wasi.files['/work/out.jpg'])).toBe(true);
    expect(result.warnings).toEqual(JSON.parse(new TextDecoder().decode(wasi.files['/work/result.json'])).warnings);
  });

  it('reuses a Response once across concurrent previews, errors and WASI fallback', async () => {
    const response = new Response(new Uint8Array(await imageBytes()), { headers: { 'Content-Type': 'application/wasm' } });
    const client = createWasmConverterClient({ wasm: () => { throw Error('image route loaded the document core'); }, imageWasm: response });
    const input = new Uint8Array(await source());
    const request = { source: input, sourceFormat: 'dng', targetFormat: 'jpg' };
    const first = await client.convert(request, context);
    for (let i = 0; i < 3; i++) {
      const results = await Promise.all([client.convert(request, context), client.convert(request, context)]);
      results.forEach(result => expect(Buffer.from(result.source as Uint8Array).equals(first.source as Uint8Array)).toBe(true));
    }
    await expect(client.convert({ ...request, source: new Uint8Array([1, 2, 3]) }, context))
      .rejects.toMatchObject({ result: { errorCode: 'parse_error' } });
    // Empty input uses the legacy entrypoint, sharing the already-consumed Response.
    await expect(client.convert({ ...request, source: new Uint8Array() }, context))
      .rejects.toMatchObject({ result: { ok: false } });
    expect(Buffer.from((await client.convert(request, context)).source as Uint8Array).equals(first.source as Uint8Array)).toBe(true);
  });

  it('keeps modules without the optional image ABI compatible', async () => {
    // Hide the optional exports from a real module without changing its WASI code.
    const bytes = new Uint8Array(await imageBytes());
    const original = new TextEncoder().encode('filens_image_');
    for (let i = 0; i <= bytes.length - original.length; i++) {
      if (original.every((value, index) => bytes[i + index] === value)) bytes[i] = 'x'.charCodeAt(0);
    }
    const wasm = await WebAssembly.compile(bytes);
    expect(WebAssembly.Module.exports(wasm).some(entry => entry.name === 'filens_image_preview')).toBe(false);
    const result = await createWasmConverterClient({ wasm, imageWasm: wasm }).convert({
      source: new Uint8Array(await source()), sourceFormat: 'dng', targetFormat: 'jpg'
    }, context);
    expect(result).toMatchObject({ format: 'jpg', contentType: 'image/jpeg' });
    expect(Array.from((result.source as Uint8Array).subarray(0, 2))).toEqual([255, 216]);
  });
});
