import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { dngFixture } from '../../../packages/panorama/test/fixtures/dng';

const x5 = Buffer.from(dngFixture('x5')), oneRs = [...dngFixture('one-rs')];
async function prepare(page: Page) {
  await page.route('**/processor-check', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Panorama processor checks</title>' }));
  await page.route('**/processor-library.js', async route => route.fulfill({ contentType: 'text/javascript',
    body: (await readFile('packages/panorama/dist/index.js', 'utf8')).replace('from "@filens/core"', 'from "./processor-core/index.js"') }));
  await page.route('**/processor-core/*', route => route.fulfill({ contentType: 'text/javascript',
    path: resolve('packages/core/dist', new URL(route.request().url()).pathname.split('/').at(-1)!) }));
  await page.route('**/processor-source.dng', route => {
    const range = route.request().headers().range!.match(/^bytes=(\d+)-(\d+)$/)!;
    const start = +range[1], end = +range[2];
    return route.fulfill({ status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${x5.length}` }, body: x5.subarray(start, end + 1) });
  });
  await page.goto('./processor-check');
  await page.evaluate(async () => {
    const lib = await import(/* @vite-ignore */ new URL('processor-library.js', location.href).href);
    const wasm = new URL('externals/converter-core.wasm', location.href).href;
    const imageWasm = new URL('externals/converter-image.wasm', location.href).href;
    (window as any).processorCheck = { lib, wasm, imageWasm };
  });
}

test('keeps the open signal for RAW reads and reopens a real ranged DNG', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page);
  let decoderRequests = 0; page.on('request', request => { if (request.url().includes('converter-image.wasm')) decoderRequests++; });
  const cancelled = await page.evaluate(async () => {
    const state = (window as any).processorCheck, controller = new AbortController();
    state.processor = state.lib.createWasmPanoramaProcessor({ wasm: state.wasm, imageWasm: state.imageWasm });
    const manifest = await state.processor.open(new URL('processor-source.dng', location.href).href, { format: 'dng', signal: controller.signal });
    controller.abort(); let outcome = '';
    try { await state.processor.decodeImage(); } catch (error) { outcome = (error as Error).name; }
    return { outcome, model: manifest.cameraModel };
  });
  expect(cancelled).toEqual({ outcome: 'AbortError', model: 'Insta360 X5' }); expect(decoderRequests).toBe(0);
  const reopened = await page.evaluate(async () => {
    const { processor } = (window as any).processorCheck;
    await processor.open(new URL('processor-source.dng', location.href).href, { format: 'dng' });
    const bytes = await processor.decodeImage(), bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
    const result = { dimensions: [bitmap.width, bitmap.height], bytes: bytes.length }; bitmap.close();
    processor.close(); return { ...result, closed: processor.getManifest() === undefined };
  });
  expect(reopened.dimensions).toEqual([1024, 512]); expect(reopened.bytes).toBeGreaterThan(1000); expect(reopened.closed).toBe(true); expect(errors).toEqual([]);
});

test('settles an obsolete non-cooperative probe and releases its late real response', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page);
  await page.evaluate(async () => {
    const state = (window as any).processorCheck;
    const wasm = await WebAssembly.compile(await (await fetch(state.wasm)).arrayBuffer());
    const gate = new Promise<void>(resolve => { state.release = resolve; });
    state.processor = state.lib.createWasmPanoramaProcessor({ wasm,
      fetch: async (url: string, options: RequestInit) => {
        const response = await fetch(url, { headers: options.headers }); state.response = response;
        await gate; return response;
      }
    });
    state.outcome = 'pending';
    state.old = state.processor.open(new URL('processor-source.dng', location.href).href, { format: 'dng' })
      .then(() => { state.outcome = 'resolved'; }, (error: Error) => { state.outcome = error.name; });
  });
  try {
    await expect.poll(() => page.evaluate(() => !!(window as any).processorCheck.response)).toBe(true);
    await page.evaluate(() => (window as any).processorCheck.processor.close());
    await expect.poll(() => page.evaluate(() => (window as any).processorCheck.outcome)).toBe('AbortError');
    const result = await page.evaluate(async bytes => {
      const state = (window as any).processorCheck;
      await state.processor.open(new Uint8Array(bytes), { format: 'dng' });
      state.release(); await state.old;
      await new Promise(resolve => setTimeout(resolve, 0));
      const result = { model: state.processor.getManifest().cameraModel, released: state.response.bodyUsed };
      state.processor.close(); return result;
    }, oneRs);
    expect(result).toEqual({ model: 'Insta360 OneRS', released: true }); expect(errors).toEqual([]);
  } finally { await page.evaluate(() => (window as any).processorCheck.release()); }
});

test('cancels one seam caller while reusing a shared real WASM load', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page);
  await page.evaluate(async () => {
    const state = (window as any).processorCheck;
    const module = await WebAssembly.compile(await (await fetch(state.wasm)).arrayBuffer());
    const gate = new Promise<WebAssembly.Module>(resolve => { state.release = () => resolve(module); });
    state.loads = 0; state.outcome = 'pending'; state.controller = new AbortController();
    state.processor = state.lib.createWasmPanoramaProcessor({ wasm: () => { state.loads++; return gate; } });
    state.request = { width: 2, height: 2, costs: [3, 1, 3, 1] };
    state.old = state.processor.computeSeam(state.request, state.controller.signal)
      .then(() => { state.outcome = 'resolved'; }, (error: Error) => { state.outcome = error.name; });
    state.current = state.processor.computeSeam(state.request);
  });
  try {
    await page.evaluate(() => (window as any).processorCheck.controller.abort());
    await expect.poll(() => page.evaluate(() => (window as any).processorCheck.outcome)).toBe('AbortError');
    const result = await page.evaluate(async () => {
      const state = (window as any).processorCheck; state.release(); await state.old;
      const first = await state.current, second = await state.processor.computeSeam(state.request); state.processor.close();
      return { first, second, loads: state.loads };
    });
    expect(result.first.seam).toEqual([1, 1]); expect(result.second).toEqual(result.first); expect(result.loads).toBe(1); expect(errors).toEqual([]);
  } finally { await page.evaluate(() => (window as any).processorCheck.release()); }
});
