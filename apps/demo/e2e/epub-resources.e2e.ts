import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { createStyledBookFixture } from '../../../packages/ebook/test/fixtures/books.mjs';

test('renders EPUB imports, local fonts, CSS images and SVG illustrations in both chapters', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/ebook/src/index.ts')}`, page.url()).href;
  await page.evaluate(async ({ moduleUrl, bytes }) => {
    const { createEbookPreviewDriver } = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0;background:white'; document.body.replaceChildren(host);
    const active = new Set<string>(), create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); active.add(url); return url; };
    URL.revokeObjectURL = url => { active.delete(url); revoke(url); };
    const session = createEbookPreviewDriver().createSession(host), source = new Uint8Array(bytes);
    await session.load(source, { descriptor: { source, extension: 'epub' } });
    (window as any).epubResources = { session, active, host };
  }, { moduleUrl, bytes: [...await createStyledBookFixture()] });
  const frame = page.frameLocator('iframe.ebookv-frame');
  for (const title of ['First chapter', 'Last chapter']) {
    await expect(frame.locator('h1')).toHaveText(title);
    await expect(frame.locator('.imported')).toHaveCSS('color', 'rgb(18, 52, 86)');
    await expect(frame.locator('.cycle')).toHaveCSS('color', 'rgb(101, 67, 33)');
    expect(await frame.locator('.font').evaluate(async element =>
      (await element.ownerDocument.fonts.load('16px EpubFixture', 'A')).length)).toBe(1);
    for (const cover of await frame.locator('.cover').all()) {
      expect(await cover.evaluate(async element => {
        const image = new Image(); image.src = getComputedStyle(element).backgroundImage.slice(5, -2);
        try { await image.decode(); return [image.naturalWidth, image.naturalHeight]; } catch { return []; }
      })).toEqual([80, 64]);
    }
    await expect.poll(() => frame.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBe(80);
    expect(await frame.locator('svg image').evaluate(async image => {
      const href = image.getAttribute('xlink:href')!;
      return { blob: href.startsWith('blob:'), ok: (await fetch(href)).ok };
    })).toEqual({ blob: true, ok: true });
    await page.evaluate(() => (window as any).epubResources.session.next());
  }
  const released = await page.evaluate(() => {
    const { session, active, host } = (window as any).epubResources;
    const created = active.size; session.destroy(); return { created, remaining: active.size, empty: !host.childElementCount };
  });
  expect(released.created).toBeGreaterThan(0); expect(released.remaining).toBe(0); expect(released.empty).toBe(true);
  expect(errors).toEqual([]);
});

test('shows styled EPUB chapters through the demo upload flow', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('./?view=preview');
  await page.locator('input[type="file"]').setInputFiles({ name: 'styled.epub', mimeType: 'application/epub+zip', buffer: Buffer.from(await createStyledBookFixture()) });
  const frame = page.frameLocator('iframe.ebookv-frame');
  await expect(frame.locator('h1')).toHaveText('First chapter');
  await expect(frame.locator('.imported')).toHaveCSS('color', 'rgb(18, 52, 86)');
  expect(await frame.locator('.font').evaluate(async element =>
    (await element.ownerDocument.fonts.load('16px EpubFixture', 'A')).length)).toBe(1);
  await page.getByRole('button', { name: 'Last chapter', exact: true }).click();
  await expect(frame.locator('h1')).toHaveText('Last chapter');
  await expect(frame.locator('.imported')).toHaveCSS('color', 'rgb(18, 52, 86)');
  await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
  expect(errors).toEqual([]);
});
