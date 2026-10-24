import { resolve } from 'node:path';
import { expect, test, type Route } from '@playwright/test';
import { createPdfFixture } from '../../../packages/pdf/test/fixtures/document.mjs';

for (const action of ['replace', 'destroy'] as const) {
  test(`settles a preview on ${action} before a non-cooperative HTTP converter responds`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    let receive!: (route: Route) => void;
    const request = new Promise<Route>(resolve => { receive = resolve; });
    await page.route('**/runtime-convert', route => { receive(route); });
    await page.goto('./');
    const urls = ['packages/core/src/preview/index.ts', 'packages/converter-client/src/index.ts']
      .map(file => new URL(`@fs${resolve(file)}`, page.url()).href);
    await page.evaluate(async ([coreUrl, converterUrl]) => {
      const lib = await import(/* @vite-ignore */ coreUrl);
      const { createHttpConverterClient } = await import(/* @vite-ignore */ converterUrl);
      const host = document.createElement('div'); document.body.replaceChildren(host);
      const client = createHttpConverterClient({ endpoint: 'runtime-convert' });
      const state = (window as any).runtimeTest = { host, settled: false, responseDone: false, warnings: [], errors: [] };
      state.previewer = lib.createPreviewer(host, {
        routes: lib.createDefaultPreviewRoutes([{
          extensions: ['legacy'], targetFormat: 'txt', family: 'text', driverId: 'text', conversion: { required: true }
        }]),
        converter: {
          convert: async (input: any, context: any) => {
            state.signal = context.signal;
            // Deliberately emulate an adapter that ignores cancellation; use real fetch and response decoding.
            const result = await client.convert(input, { ...context, signal: undefined });
            state.responseDone = true; return result;
          }
        }
      });
      state.previewer.on('warnings', (items: string[]) => state.warnings.push(...items));
      state.previewer.on('error', (error: Error) => state.errors.push(error.message));
      state.old = state.previewer.preview(new Uint8Array([1]), { name: 'old.legacy' }).then(() => { state.settled = true; });
    }, urls);
    const held = await request;
    try {
      await page.evaluate(async action => {
        const state = (window as any).runtimeTest;
        if (action === 'destroy') state.previewer.destroy();
        else await state.previewer.preview(new TextEncoder().encode('Current text'), { name: 'current.txt' });
      }, action);
      await expect.poll(() => page.evaluate(() => (window as any).runtimeTest.settled)).toBe(true);
      expect(await page.evaluate(() => {
        const state = (window as any).runtimeTest; return { aborted: state.signal.aborted, responseDone: state.responseDone };
      })).toEqual({ aborted: true, responseDone: false });
    } finally {
      await held.fulfill({ json: { format: 'txt', text: 'Obsolete text', warnings: ['obsolete warning'] } });
    }
    await expect.poll(() => page.evaluate(() => (window as any).runtimeTest.responseDone)).toBe(true);
    const result = await page.evaluate(async action => {
      const state = (window as any).runtimeTest;
      // Allow the conversion continuation to run before checking the current DOM and state.
      await new Promise(resolve => setTimeout(resolve, 0));
      const previous = state.previewer.getState();
      const content = state.host.textContent;
      if (action === 'destroy') await state.previewer.preview(new TextEncoder().encode('Reopened text'), { name: 'reopened.txt' });
      const reopened = state.host.textContent;
      state.previewer.destroy();
      return { title: previous.title ?? null, content, reopened, warnings: state.warnings, errors: state.errors, empty: !state.host.childElementCount };
    }, action);
    expect(result).toEqual({
      title: action === 'replace' ? 'current.txt' : null,
      content: action === 'replace' ? '1Current text' : '',
      reopened: action === 'replace' ? '1Current text' : '1Reopened text',
      warnings: [], errors: [], empty: true
    });
    expect(errors).toEqual([]);
  });
}

test('keeps a loaded image signal until replacement and ignores detached image events', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/core/src/preview/index.ts')}`, page.url()).href;
  const result = await page.evaluate(async moduleUrl => {
    const lib = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div'); document.body.replaceChildren(host);
    const driver = lib.createImagePreviewDriver();
    const create = driver.createSession;
    let signal!: AbortSignal;
    driver.createSession = (...args: any[]) => {
      const session = create(...args), load = session.load.bind(session);
      session.load = (source: any, context: any) => { signal = context.signal; return load(source, context); };
      return session;
    };
    const active = new Set<string>(), makeUrl = URL.createObjectURL.bind(URL), releaseUrl = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = makeUrl(blob); active.add(url); return url; };
    URL.revokeObjectURL = url => { active.delete(url); releaseUrl(url); };
    const previewer = lib.createPreviewer(host, { drivers: [driver, lib.createTextPreviewDriver()] });
    const previewErrors: string[] = []; previewer.on('error', (error: Error) => previewErrors.push(error.message));
    try {
      const image = new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="teal"/></svg>'], { type: 'image/svg+xml' });
      await previewer.preview(image, { name: 'old.svg' });
      const oldImage = host.querySelector('img')!;
      await oldImage.decode();
      const abortedBefore = signal.aborted;
      await previewer.preview(new TextEncoder().encode('Current text'), { name: 'current.txt' });
      oldImage.dispatchEvent(new Event('load')); oldImage.dispatchEvent(new Event('error'));
      const state = previewer.getState();
      const result = { abortedBefore, abortedAfter: signal.aborted, title: state.title, error: state.error,
        content: host.querySelector('pre')?.textContent, urls: active.size, previewErrors };
      previewer.destroy(); return { ...result, empty: !host.childElementCount };
    } finally { previewer.destroy(); URL.createObjectURL = makeUrl; URL.revokeObjectURL = releaseUrl; }
  }, moduleUrl);
  expect(result).toEqual({ abortedBefore: false, abortedAfter: true, title: 'current.txt', error: null,
    content: 'Current text', urls: 0, previewErrors: [], empty: true });
  expect(errors).toEqual([]);
});

test('recovers from a failed document through the demo upload flow', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('./?view=preview');
  const upload = page.locator('input[type=file]');
  await upload.setInputFiles({ name: 'broken.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('invalid ZIP') });
  await expect(page.locator('.pptxv-overlay.is-error')).toBeVisible();
  await upload.setInputFiles({ name: 'recovered.txt', mimeType: 'text/plain', buffer: Buffer.from('Preview recovered') });
  await expect(page.locator('pre.pptxv-native-text')).toHaveText('Preview recovered');
  await expect(page.locator('.pptxv-overlay.is-error')).toHaveCount(0);
  await expect(page.locator('.wb-preview-title strong')).toHaveText('recovered.txt');
  expect(errors).toEqual([]);
});

test('loads the PDF engine only when opening a PDF through the demo', async ({ page }) => {
  const engines: string[] = [], errors: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (/\/assets\/pdf-runtime-[^/]+\.js$/.test(path) || /\/deps\/pdfjs-dist\.js$/.test(path)) engines.push(path);
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./?view=preview');
  const upload = page.locator('input[type=file]');
  await upload.setInputFiles({ name: 'before-pdf.txt', mimeType: 'text/plain', buffer: Buffer.from('Readable before PDF') });
  await expect(page.locator('pre.pptxv-native-text')).toHaveText('Readable before PDF');
  expect(engines).toHaveLength(0);
  await upload.setInputFiles({ name: 'on-demand.pdf', mimeType: 'application/pdf', buffer: Buffer.from(createPdfFixture(3)) });
  const canvas = page.locator('canvas.pdfv-page[data-page-index="0"][data-rendered="true"]');
  await expect(canvas).toHaveCount(1);
  expect(engines).toHaveLength(1);
  expect(await canvas.evaluate(node => {
    const canvas = node as HTMLCanvasElement;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 240 && pixels[i + 3] > 0) ink++;
    return ink;
  })).toBeGreaterThan(100);
  await expect(page.locator('.wb-preview-title strong')).toHaveText('on-demand.pdf');
  await upload.setInputFiles({ name: 'after-pdf.txt', mimeType: 'text/plain', buffer: Buffer.from('Readable after PDF') });
  await expect(page.locator('pre.pptxv-native-text')).toHaveText('Readable after PDF');
  await expect(page.locator('canvas.pdfv-page')).toHaveCount(0);
  expect(engines).toHaveLength(1);
  expect(errors).toEqual([]);
});
