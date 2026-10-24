import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { createBookFixture, createComicFixture } from '../../../packages/ebook/test/fixtures/books.mjs';

test('opens EPUB chapters, replaces the book with ordered CBZ pages, and releases image URLs', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/ebook/src/index.ts')}`, page.url()).href;
  const result = await page.evaluate(async ({ moduleUrl, epub, cbz }) => {
    const { createEbookPreviewDriver } = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div');
    host.id = 'ebook-lifecycle-test'; host.style.cssText = 'position:fixed;inset:0;background:white';
    document.body.replaceChildren(host);
    const active = new Set<string>();
    const createUrl = URL.createObjectURL.bind(URL), revokeUrl = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = createUrl(blob); active.add(url); return url; };
    URL.revokeObjectURL = url => { active.delete(url); revokeUrl(url); };
    const session = createEbookPreviewDriver().createSession(host);
    const load = (bytes: number[], extension: string) => {
      const source = new Uint8Array(bytes);
      return session.load(source, { descriptor: { source, extension } });
    };
    await load(epub, 'epub');
    session.goToPage(1);
    const chapter = session.getState().chapterTitle;
    const previous = host.querySelector('iframe');
    await load(cbz, 'cbz');
    (window as any).ebookLifecycle = { host, session, active };
    return { chapter, replaced: previous !== host.querySelector('iframe'), state: session.getState(), active: active.size };
  }, { moduleUrl, epub: [...await createBookFixture(3, 5)], cbz: [...await createComicFixture(200)] });
  expect(result.chapter).toBe('Chapter 2');
  expect(result.replaced).toBe(true);
  expect(result.state).toMatchObject({ chapterIndex: 0, chapterCount: 200, chapterTitle: 'Page 1', loading: false, error: null });
  expect(result.active).toBe(200);
  const image = page.frameLocator('iframe.ebookv-frame').locator('img');
  await expect(image).toHaveAttribute('alt', 'Page 1');
  await expect.poll(() => image.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBe(600);
  await page.evaluate(() => (window as any).ebookLifecycle.session.goToPage(199));
  await expect(image).toHaveAttribute('alt', 'Page 200');
  await expect.poll(() => image.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBe(600);
  expect(await image.evaluate(async (image: HTMLImageElement) => (await (await fetch(image.src)).text()).includes('>Page 200</text>'))).toBe(true);
  const cleanup = await page.evaluate(() => {
    const { session, active, host } = (window as any).ebookLifecycle;
    session.destroy();
    return { urls: active.size, empty: !host.childElementCount };
  });
  expect(cleanup).toEqual({ urls: 0, empty: true });
  expect(errors).toEqual([]);
});

test('ignores cancelled, replaced and destroyed ebook reads', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/ebook/src/index.ts')}`, page.url()).href;
  const result = await page.evaluate(async ({ moduleUrl, epub }) => {
    const { createEbookPreviewDriver } = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div'); document.body.replaceChildren(host);
    const session = createEbookPreviewDriver().createSession(host);
    let rendered = 0, created = 0;
    session.on('rendered', () => rendered++);
    const createUrl = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => { created++; return createUrl(blob); };
    const delayed = () => {
      let finish!: (value: ArrayBuffer) => void;
      const source = new Blob([]);
      source.arrayBuffer = () => new Promise(resolve => { finish = resolve; });
      return { source, release: () => finish(new ArrayBuffer(0)) };
    };
    const load = (source: Blob | Uint8Array, signal?: AbortSignal) => session.load(source, { descriptor: { source, extension: source instanceof Blob ? 'cbz' : 'epub' }, signal });
    const old = delayed(), pending = load(old.source);
    await load(new Uint8Array(epub));
    old.release(); await pending;
    const preserved = session.getState().chapterTitle === 'Chapter 1' && host.querySelector('iframe')?.srcdoc.includes('Chapter 1');
    const controller = new AbortController(), cancelled = delayed();
    const cancellation = load(cancelled.source, controller.signal).then(() => 'loaded', (error: Error) => error.name);
    controller.abort(); cancelled.release();
    const aborted = await cancellation;
    const last = delayed(), unfinished = load(last.source);
    session.destroy(); last.release(); await unfinished;
    return { preserved, aborted, rendered, created, empty: !host.childElementCount };
  }, { moduleUrl, epub: [...await createBookFixture(2, 3)] });
  expect(result).toEqual({ preserved: true, aborted: 'AbortError', rendered: 1, created: 0, empty: true });
  expect(errors).toEqual([]);
});
