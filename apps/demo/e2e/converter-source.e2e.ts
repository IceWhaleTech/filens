import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';
import { unzipSync } from 'fflate';
import { createDocxFixture } from '../../../packages/docx/test/fixtures/document.mjs';

const input = Buffer.from('{\\rtf1\\ansi Real URL source / alpha}');
const converted = createDocxFixture(1);
const prepare = async (page: Page) => {
  await page.route('**/converter-library.js', route => route.fulfill({ contentType: 'text/javascript', path: resolve('packages/converter-client/dist/index.js') }));
  await page.goto('./');
  const url = new URL('converter-library.js', page.url()).href;
  await page.evaluate(async url => {
    const lib = await import(/* @vite-ignore */ url);
    (window as any).converterSource = { lib };
  }, url);
};

test('downloads an HTTP source and uploads its complete bytes before reading a binary response', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/adapter-source.rtf', route => route.fulfill({ contentType: 'application/rtf', body: input }));
  let uploaded: Buffer | undefined;
  await page.route('**/adapter-convert', async route => {
    const request = route.request(), form = await new Response(request.postDataBuffer()!, { headers: { 'Content-Type': request.headers()['content-type'] } }).formData();
    uploaded = Buffer.from(await (form.get('file') as File).arrayBuffer());
    expect(form.get('sourceFormat')).toBe('rtf'); expect(form.get('targetFormat')).toBe('docx');
    await route.fulfill({ contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', body: Buffer.from(converted), headers: { 'x-preview-format': 'docx' } });
  });
  await prepare(page);
  const bytes = await page.evaluate(async () => {
    const { lib } = (window as any).converterSource;
    const source = new URL('adapter-source.rtf', location.href).href;
    const client = lib.createHttpConverterClient({ endpoint: 'adapter-convert', responseType: 'blob' });
    const result = await client.convert({ source, name: source, sourceFormat: 'rtf', targetFormat: 'docx' }, { descriptor: { source, name: source } });
    return { format: result.format, bytes: [...new Uint8Array(await result.source.arrayBuffer())] };
  });
  expect(uploaded).toEqual(input); expect(bytes.format).toBe('docx'); expect(Buffer.from(bytes.bytes)).toEqual(Buffer.from(converted));
  expect(errors).toEqual([]);
});

test('cancels a real source download without submitting it for HTTP conversion', async ({ page }) => {
  let receive!: (route: Route) => void;
  const held = new Promise<Route>(resolve => { receive = resolve; });
  let posts = 0;
  await page.route('**/delayed-adapter-source.rtf', route => { receive(route); });
  await page.route('**/adapter-convert', route => { posts++; return route.fulfill({ json: { format: 'docx', text: 'unexpected' } }); });
  await prepare(page);
  await page.evaluate(() => {
    const state = (window as any).converterSource, source = new URL('delayed-adapter-source.rtf', location.href).href;
    state.controller = new AbortController(); state.outcome = 'pending';
    state.task = state.lib.createHttpConverterClient({ endpoint: 'adapter-convert' })
      .convert({ source, name: source, sourceFormat: 'rtf', targetFormat: 'docx' }, { descriptor: { source }, signal: state.controller.signal })
      .then(() => { state.outcome = 'loaded'; }, (error: Error) => { state.outcome = error.name; });
  });
  const route = await held;
  try {
    await page.evaluate(() => (window as any).converterSource.controller.abort());
    await expect.poll(() => page.evaluate(() => (window as any).converterSource.outcome)).toBe('AbortError');
  } finally { await route.fulfill({ body: input }); }
  await page.evaluate(() => (window as any).converterSource.task);
  expect(posts).toBe(0);
});

test('retries a real WASM URL after a temporary failure and converts a source whose name is its URL', async ({ page }) => {
  let loads = 0;
  await page.route('**/retry-converter.wasm', async route => {
    loads++;
    if (loads === 1) await route.fulfill({ status: 503, body: 'temporary failure' });
    else await route.fulfill({ contentType: 'application/wasm', body: await readFile('wasm/converter-core/dist/converter-core.wasm') });
  });
  await page.route('**/adapter-source.rtf', route => route.fulfill({ contentType: 'application/rtf', body: input }));
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { lib } = (window as any).converterSource, source = new URL('adapter-source.rtf', location.href).href;
    const client = lib.createWasmConverterClient({ wasm: new URL('retry-converter.wasm', location.href) });
    const request = { source, name: source, sourceFormat: 'rtf', targetFormat: 'docx' }, context = { descriptor: { source, name: source } };
    let failure = '';
    try { await client.convert(request, context); } catch (error) { failure = (error as Error).message; }
    const result = await client.convert(request, context);
    const again = await client.convert(request, context);
    return { failure, format: result.format, bytes: [...result.source], same: String(result.source) === String(again.source) };
  });
  expect(result.failure).toContain('Failed to fetch converter WASM: 503'); expect(loads).toBe(2);
  expect(result.format).toBe('docx'); expect(result.same).toBe(true);
  const entries = unzipSync(new Uint8Array(result.bytes));
  expect(new TextDecoder().decode(entries['word/document.xml'])).toContain('Real URL source / alpha');
});

test('previews a remotely supplied RTF through the shared HTTP adapter and DOCX driver', async ({ page }) => {
  await page.route('**/adapter-source.rtf', route => route.fulfill({ contentType: 'application/rtf', body: input }));
  let uploaded: Buffer | undefined;
  await page.route('**/adapter-convert', async route => {
    const request = route.request(), form = await new Response(request.postDataBuffer()!, { headers: { 'Content-Type': request.headers()['content-type'] } }).formData();
    uploaded = Buffer.from(await (form.get('file') as File).arrayBuffer());
    await route.fulfill({ json: { format: 'docx', base64: Buffer.from(converted).toString('base64') } });
  });
  await prepare(page);
  const urls = ['packages/core/src/preview/index.ts', 'packages/docx/src/index.ts'].map(file => new URL(`@fs${resolve(file)}`, page.url()).href);
  await page.evaluate(async ([coreUrl, docxUrl]) => {
    const core = await import(/* @vite-ignore */ coreUrl), docx = await import(/* @vite-ignore */ docxUrl);
    const state = (window as any).converterSource, host = document.createElement('div'); document.body.replaceChildren(host);
    state.host = host;
    state.previewer = core.createPreviewer(host, { drivers: [docx.createDocxPreviewDriver()], converter: state.lib.createHttpConverterClient({ endpoint: 'adapter-convert' }) });
    await state.previewer.preview(new URL('adapter-source.rtf', location.href).href);
  }, urls);
  expect(uploaded).toEqual(input);
  await expect(page.locator('section.docx')).toContainText('Image 1');
  expect(await page.locator('section.docx img').evaluate(async node => { const image = node as HTMLImageElement; await image.decode(); return [image.naturalWidth, image.naturalHeight]; })).toEqual([256, 256]);
  expect(await page.evaluate(() => { const state = (window as any).converterSource; state.previewer.destroy(); return state.host.childElementCount; })).toBe(0);
});
