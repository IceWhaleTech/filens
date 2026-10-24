import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { createPdfFixture } from '../../../packages/pdf/test/fixtures/document.mjs';

test('renders mixed PDF pages on demand and supports navigation, zoom and resize', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/pdf/src/index.ts')}`, page.url()).href;
  const bytes = [...createPdfFixture(100, true)];
  const result = await page.evaluate(async ({ moduleUrl, bytes }) => {
    const { createPdfPreviewDriver } = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div');
    host.id = 'pdf-lifecycle-test'; host.style.cssText = 'position:fixed;inset:0;width:800px;height:600px;background:white';
    document.body.replaceChildren(host);
    const session = createPdfPreviewDriver().createSession(host);
    (window as any).pdfLifecycle = { host, session };
    const source = new Uint8Array(bytes);
    await session.load(source, { descriptor: { source, name: 'mixed.pdf' } });
    return { state: session.getState(), canvases: host.querySelectorAll('canvas').length, slots: host.querySelectorAll('.pdfv-page-slot').length };
  }, { moduleUrl, bytes });
  expect(result.state).toMatchObject({ loading: false, error: null, pageCount: 100, pageIndex: 0 });
  expect(result.canvases).toBeLessThanOrEqual(3);
  expect(result.slots).toBe(100);
  await page.evaluate(() => (window as any).pdfLifecycle.session.goToPage(50));
  await expect(page.locator('canvas[data-page-index="50"][data-rendered="true"]')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (window as any).pdfLifecycle.session.getState().pageIndex)).toBe(50);
  expect(await page.locator('canvas').count()).toBeLessThanOrEqual(4);
  await page.evaluate(() => (window as any).pdfLifecycle.session.next());
  await expect(page.locator('canvas[data-page-index="51"][data-rendered="true"]')).toHaveCount(1);
  await page.evaluate(() => (window as any).pdfLifecycle.session.prev());
  await expect(page.locator('canvas[data-page-index="50"][data-rendered="true"]')).toHaveCount(1);
  const initialWidth = await page.locator('canvas[data-page-index="50"]').evaluate(canvas => (canvas as HTMLCanvasElement).width);
  await page.evaluate(() => (window as any).pdfLifecycle.session.setScale(1.5));
  await expect.poll(() => page.locator('canvas[data-page-index="50"][data-rendered="true"]').evaluateAll(canvases => (canvases[0] as HTMLCanvasElement)?.width ?? 0)).toBe(Math.ceil(initialWidth * 1.5));
  await page.evaluate(() => (window as any).pdfLifecycle.session.fit('width'));
  await expect.poll(() => page.locator('canvas[data-page-index="50"][data-rendered="true"]').evaluateAll(canvases => (canvases[0] as HTMLCanvasElement)?.width ?? 0)).toBe(1200);
  await page.evaluate(() => { (window as any).pdfLifecycle.host.style.width = '480px'; });
  await expect.poll(async () => Math.abs(await page.locator('canvas[data-page-index="50"][data-rendered="true"]').evaluateAll(canvases => (canvases[0] as HTMLCanvasElement)?.width ?? 0) - 720)).toBeLessThanOrEqual(1);
  expect(await page.locator('canvas[data-page-index="50"]').evaluate(canvas => Math.abs(canvas.getBoundingClientRect().width - 720))).toBeLessThanOrEqual(1);
  await page.evaluate(() => { const { session } = (window as any).pdfLifecycle; session.fit('contain'); session.setScale(0.1); session.goToPage(0); });
  // Several pages are genuinely visible at this scale; each must receive a canvas.
  await expect(page.locator('canvas[data-page-index="6"][data-rendered="true"]')).toHaveCount(1);
  await page.evaluate(() => (window as any).pdfLifecycle.session.destroy());
  await expect(page.locator('#pdf-lifecycle-test')).toBeEmpty();
  expect(errors).toEqual([]);
});

test('preserves the latest PDF while switching, aborting and destroying delayed reads', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/pdf/src/index.ts')}`, page.url()).href;
  const sampleUrl = new URL('samples/filens-cosmic-atlas.pdf', page.url()).href;
  const result = await page.evaluate(async ({ moduleUrl, sampleUrl }) => {
    const { createPdfPreviewDriver } = await import(/* @vite-ignore */ moduleUrl);
    const bytes = new Uint8Array(await (await fetch(sampleUrl)).arrayBuffer());
    const host = document.createElement('div'); host.style.cssText = 'width:800px;height:600px'; document.body.replaceChildren(host);
    const session = createPdfPreviewDriver().createSession(host);
    let rendered = 0;
    session.on('rendered', () => rendered++);
    const delayed = () => {
      let release!: (value: ArrayBuffer) => void;
      let start!: () => void;
      const started = new Promise<void>(resolve => { start = resolve; });
      const source = new File([], 'delayed.pdf');
      Object.defineProperty(source, 'arrayBuffer', { value: () => new Promise<ArrayBuffer>(resolve => { release = resolve; start(); }) });
      return { source, started, release: () => release(new ArrayBuffer(0)) };
    };
    const load = (source: File | Uint8Array, signal?: AbortSignal) => session.load(source, { descriptor: { source, name: source instanceof File ? source.name : 'current.pdf' }, signal });
    const old = delayed(), pending = load(old.source);
    await old.started;
    await load(bytes);
    old.release(); await pending;
    const currentPreserved = session.getState().title === 'current.pdf' && session.getState().pageCount === 3 && host.querySelectorAll('canvas').length > 0;
    const controller = new AbortController(), cancelled = delayed();
    const cancellation = load(cancelled.source, controller.signal).then(() => 'loaded', (error: Error) => error.name);
    await cancelled.started;
    controller.abort(); cancelled.release();
    const abort = await cancellation;
    const last = delayed(), unfinished = load(last.source);
    await last.started;
    session.destroy(); last.release(); await unfinished;
    return { currentPreserved, abort, rendered, destroyed: !host.childElementCount };
  }, { moduleUrl, sampleUrl });
  expect(result).toEqual({ currentPreserved: true, abort: 'AbortError', rendered: 1, destroyed: true });
  expect(errors).toEqual([]);
});
