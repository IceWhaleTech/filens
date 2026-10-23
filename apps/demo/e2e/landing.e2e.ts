import { expect, test } from '@playwright/test';

test('keeps the homepage and bundled preview public while protecting ZimaOS sample files', async ({
  page
}) => {
  await page.addInitScript(() => {
    (window as Window & { loginPaths?: string[] }).loginPaths = [];
    window.$wujie = {
      props: {
        jump: ({ path }) => {
          (window as Window & { loginPaths: string[] }).loginPaths.push(path);
        }
      }
    };
  });
  await page.goto('./?zimaAuth=1');
  await expect(page.locator('.landing')).toBeVisible();
  await page.getByRole('button', { name: '开始体验', exact: true }).click();
  await expect(page.locator('.wb-preview-stage')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as Window & { loginPaths: string[] }).loginPaths.length))
    .toBe(0);
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await page.getByRole('button', { name: 'MP3', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as Window & { loginPaths: string[] }).loginPaths[0]))
    .toMatch(/^\/login\?redirect=/);
});

test('switches between complete Chinese and English homepages and remembers the choice', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('文件的精彩，打开就看见。');
  await page.getByRole('button', { name: 'Switch to English', exact: true }).click();
  await expect(page).toHaveURL(/lang=en/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveTitle('filens · Every file has a story. Open it.');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Every file has a story.Open it.');
  await expect(page.getByRole('tab', { name: 'Docs', exact: true })).toBeVisible();
  await expect(page.locator('#demo')).toContainText('Add filens to your app');
  await expect(page.getByRole('link', { name: 'Documentation', exact: true })).toBeVisible();
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.goto('./?lang=zh');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
});

test('lets visitors select a preview with the keyboard and open the corresponding real sample', async ({
  page
}) => {
  await page.goto('./');
  const tabs = page.getByRole('tab');
  await tabs.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#preview-panel img')).toHaveAttribute('src', /document.webp$/);
  await page.getByRole('button', { name: '亲自打开看看' }).click();
  await expect(page).toHaveURL(/view=preview&format=docx/);
  await expect(page.locator('.wb-preview-title strong')).toHaveText('generated.docx');
  await expect(page.locator('.wb-preview-stage')).toContainText('Trip overview');
  await page.getByRole('button', { name: '← filens 首页' }).click();
  await expect(page.locator('.landing')).toBeVisible();
  await page.goBack();
  await expect(page.locator('.workbench')).toBeVisible();
  await page.goBack();
  await expect(page.locator('.landing')).toBeVisible();
});

test('opens a locally selected file using the existing previewer', async ({ page }) => {
  await page.goto('./');
  await page.getByLabel('选择本地文件', { exact: true }).setInputFiles({
    name: 'hello.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('A local file, ready to explore.')
  });
  await expect(page.locator('.wb-preview-title strong')).toHaveText('hello.txt');
  await expect(page.locator('.wb-preview-stage')).toContainText('A local file, ready to explore.');
  await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
});

test('plays the actual demo video on request with translated captions', async ({ page }) => {
  await page.goto('./?lang=en#demo');
  const video = page.locator('video');
  await expect(video).toHaveAttribute('preload', 'none');
  await expect(video.locator('track')).toHaveAttribute('src', /demo-en.vtt$/);
  await page.getByRole('button', { name: /Play the walkthrough/ }).click();
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(0);
  expect(await video.evaluate((element: HTMLVideoElement) => element.duration)).toBeGreaterThan(20);
  await expect(video).toHaveAttribute('controls', '');
});

test('opens the showcase through a shareable link and renders all three slides', async ({ page }) => {
  await page.goto('./?view=preview&format=showcase');
  await expect(page.locator('.wb-preview-title strong')).toHaveText('filens-field-notes.pptx');
  await expect(page.locator('.wb-preview-stage')).toContainText('FIELD');
  await expect(page.locator('.wb-preview-stage')).not.toContainText('Master Title');
  await expect(page.locator('.pptxv-slide-shell')).toHaveCount(3);
  await expect(page.locator('.pptxv-toolbar')).toHaveCount(0);
  await page.getByRole('button', { name: '显示工具栏', exact: true }).click();
  await expect(page.getByRole('button', { name: '隐藏工具栏', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('.pptxv-status').first()).toHaveText('2 / 3');
  await page.getByRole('button', { name: '隐藏工具栏', exact: true }).click();
  await expect(page.locator('.pptxv-toolbar')).toHaveCount(0);
  await page.locator('.pptxv-shell').first().press('ArrowLeft');
  await page.getByRole('button', { name: '显示工具栏', exact: true }).click();
  await expect(page.locator('.pptxv-status').first()).toHaveText('1 / 3');
});

test('opens the public Keynote travel sample with three fictional slides', async ({ page }) => {
  await page.goto('./?view=preview&format=key');
  await expect(page.locator('.wb-preview-title strong')).toHaveText('filens-weekend.key');
  const stage = page.locator('.wb-preview-stage');
  await expect(stage).toContainText('A weekend');
  await expect(stage).toContainText('THREE FICTIONAL STOPS');
  await expect(stage).toContainText('LEAVE ONLY FOOTPRINTS.');
  await expect(page.locator('.pptxv-toolbar')).toHaveCount(0);
  await page.getByRole('button', { name: '显示工具栏', exact: true }).click();
  await expect(stage).toContainText('1 / 3');
  await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
});

for (const lang of ['zh', 'en']) {
  test(`fits the ${lang} homepage on narrow screens without missing images`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`./?lang=${lang}`);
    await expect(page.locator('.site-header')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect
      .poll(() =>
        page.locator('.hero-preview-panel img').evaluate((img: HTMLImageElement) => img.naturalWidth)
      )
      .toBeGreaterThan(0);
    await page.locator('.site-footer').scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        page
          .locator('.landing img')
          .evaluateAll((images: HTMLImageElement[]) =>
            images.every((img) => img.complete && img.naturalWidth > 0)
          )
      )
      .toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
