import { expect, test } from '@playwright/test';

test('unfolds the file story with the keyboard, pauses, and finishes without looping', async ({ page }) => {
  await page.clock.install();
  await page.goto('./?lang=en');
  const story = page.locator('.file-story');
  const caption = story.getByRole('status');
  await expect(story).toHaveAttribute('data-phase', 'idle');
  await story.getByRole('button', { name: 'Click to unfold', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.clock.runFor(700);
  await expect(story).toHaveAttribute('data-phase', 'revealed');
  await expect(caption).toHaveText('A presentation. A story unfolding.');
  await story.getByRole('button', { name: 'Pause animation', exact: true }).click();
  await page.clock.runFor(8000);
  await expect(caption).toHaveText('A presentation. A story unfolding.');
  await story.getByRole('button', { name: 'Resume animation', exact: true }).click();
  await page.clock.runFor(700);
  await expect(caption).toHaveText('A model. A different perspective.');
  await page.clock.runFor(4300);
  await expect(caption).toHaveText('A panorama. A world to step into.');
  await expect(story.getByRole('button', { name: 'Play again', exact: true })).toBeEnabled();
  await expect(story.getByRole('button', { name: 'Pause animation', exact: true })).toHaveCount(0);
  await story.getByRole('button', { name: 'Presentation', exact: true }).click();
  await expect(caption).toHaveText('A presentation. A story unfolding.');
});

test('lets visitors explore the story without automatic motion when reduced motion is requested', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  await page.goto('./?lang=zh');
  const story = page.locator('.file-story');
  await story.getByRole('button', { name: '点击，让文件展开', exact: true }).click();
  await expect(story).toHaveAttribute('data-phase', 'revealed');
  await page.clock.runFor(10000);
  await expect(story.getByRole('status')).toHaveText('一份演示，展开一个故事。');
  await expect(story.getByRole('button', { name: '再看一次', exact: true })).toBeEnabled();
  await story.getByRole('button', { name: '三维模型', exact: true }).click();
  await expect(story.getByRole('status')).toHaveText('一个模型，看见每个角度。');
  await expect(story.getByRole('button', { name: '三维模型', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Switch to English', exact: true }).click();
  await expect(story.getByRole('status')).toHaveText('A model. A different perspective.');
  await story.getByRole('button', { name: 'Panorama', exact: true }).click();
  await expect(story.getByRole('status')).toHaveText('A panorama. A world to step into.');
});

test('opens public samples without NAS authentication even inside a host', async ({
  page
}) => {
  await page.addInitScript(() => {
    (window as Window & { loginPaths?: string[] }).loginPaths = [];
    Object.assign(window, {
      $wujie: {
        props: {
          jump: ({ path }: { path: string }) => {
            (window as Window & { loginPaths: string[] }).loginPaths.push(path);
          }
        }
      }
    });
  });
  let hostRequests = 0;
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/v3/file') hostRequests++;
  });
  await page.route('**/external-samples/mdn-audio/t-rex-roar.mp3', route => route.fulfill({
    path: 'apps/demo/public/samples/sample-video.mp4', contentType: 'video/mp4'
  }));
  await page.goto('./');
  await expect(page.locator('.landing')).toBeVisible();
  await page.getByRole('button', { name: '开始体验', exact: true }).click();
  await expect(page.locator('.wb-preview-stage')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as Window & { loginPaths: string[] }).loginPaths.length))
    .toBe(0);
  await page.getByRole('button', { name: '← 探微首页', exact: true }).click();
  await page.getByRole('button', { name: '打开视频样例', exact: true }).click();
  await expect(page).toHaveURL(/view=preview&format=mp4/);
  await expect(page.locator('.wb-preview-title strong')).toHaveText('sample-video.mp4');
  await expect
    .poll(() => page.locator('video.pptxv-native-media').evaluate((video: HTMLVideoElement) => video.readyState))
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as Window & { loginPaths: string[] }).loginPaths.length)).toBe(0);
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  const sampleResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/external-samples/mdn-audio/t-rex-roar.mp3');
  await page.getByRole('button', { name: 'MP3', exact: true }).click();
  const response = await sampleResponse;
  expect(new URL(response.url()).search).toBe('');
  await expect(page.locator('.wb-preview-title strong')).toHaveText('t-rex-roar.mp3');
  await expect.poll(() => page.locator('audio.pptxv-native-media').evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as Window & { loginPaths: string[] }).loginPaths)).toEqual([]);
  expect(hostRequests).toBe(0);
});

test('switches between complete Chinese and English homepages and remembers the choice', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('文件的精彩，打开就看见。');
  await expect(page.getByRole('button', { name: '打开全景视频样例', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '查看完整支持矩阵' })).toHaveAttribute('href', /support-matrix\.zh-CN\.md$/);
  await page.getByRole('button', { name: 'Switch to English', exact: true }).click();
  await expect(page).toHaveURL(/lang=en/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveTitle('filens · Files shine bright. Dreams take flight.');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Files shine bright.Dreams take flight.');
  await expect(page.getByRole('tab', { name: 'Docs', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'More files. More possibilities.', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open live photos sample', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View the full support matrix' })).toHaveAttribute('href', /support-matrix\.md$/);
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
  await expect(page.locator('.wb-preview-title strong')).toHaveText('filens-aurora-guide.docx');
  await expect(page.locator('.wb-preview-stage')).toContainText('Trip overview');
  await page.getByRole('button', { name: '← 探微首页' }).click();
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

test('opens the 3D showcase from its matching preview tab', async ({ page }) => {
  await page.goto('./?lang=en');
  await page.getByRole('tab', { name: '3D', exact: true }).click();
  await expect(page.locator('#preview-panel img')).toHaveAttribute('src', /model.webp$/);
  await expect(page.locator('.preview-window-bar')).toContainText('viking-helmet.obj');
  await page.getByRole('button', { name: 'Explore this file', exact: true }).click();
  await expect(page.locator('.wb-preview-title strong')).toHaveText('viking-helmet.obj');
  await expect(page.locator('canvas.model3dv-canvas')).toBeVisible();
});

test('opens the bundled Milky Way panorama from its matching preview tab', async ({ page }) => {
  await page.goto('./?lang=en');
  await page.getByRole('tab', { name: '360°', exact: true }).click();
  await expect(page.locator('.preview-window-bar')).toContainText('milky-way-360.pano');
  const source = page.waitForResponse(response => response.url().endsWith('/samples/showcase/milky-way-360.jpg'));
  await page.getByRole('button', { name: 'Explore this file', exact: true }).click();
  expect((await source).ok()).toBe(true);
  await expect(page.locator('.wb-preview-title strong')).toHaveText('milky-way-360.pano');
  await expect(page.locator('.wb-preview-stage canvas')).toBeVisible();
  await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
});

for (const [label, format, file, preview] of [
  ['STEP solids', 'step', 'rounded-cube.step', 'canvas.model3dv-canvas'],
  ['camera RAW', 'dng', 'pentax-k-r.dng', 'img.pptxv-native-image'],
  ['PPM images', 'ppm', 'photo-alpine-lake.ppm', 'img.pptxv-native-image'],
  ['legacy Office / WPS', 'doc', 'legacy-project-workflow.doc', '.docx'],
] as const) {
  test(`opens the public ${label} sample from the homepage`, async ({ page }) => {
    await page.goto('./?lang=en');
    await page.getByRole('button', { name: `Open ${label.toLowerCase()} sample`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`view=preview&format=${format}`));
    await expect(page.locator('.wb-preview-title strong')).toHaveText(file);
    await expect(page.locator('.wb-preview-stage').locator(preview).first()).toBeVisible();
    await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
  });
}

test('plays the actual demo video on request with translated captions', async ({ page }) => {
  await page.goto('./?lang=en#demo');
  const video = page.locator('video');
  await expect(video).toHaveAttribute('preload', 'none');
  await expect(video.locator('track')).toHaveAttribute('src', /demo-en\.vtt\?v=[a-f0-9]{12}$/);
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
  await expect(page.locator('.wb-preview-stage')).toContainText('BEYOND');
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

test('opens the public Keynote night-sky sample with three slides', async ({ page }) => {
  await page.goto('./?view=preview&format=key');
  await expect(page.locator('.wb-preview-title strong')).toHaveText('filens-weekend.key');
  const stage = page.locator('.wb-preview-stage');
  await expect(stage).toContainText('BEYOND');
  await expect(stage).toContainText('CHASE THE LIGHT.');
  await expect(stage).toContainText('THE COSMIC ATLAS');
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
    await expect(page.getByRole('tab')).toHaveCount(8);
    await expect(page.locator('.format-family-card')).toHaveCount(16);
    expect(await page.locator('.format-family-card').evaluateAll((cards) => cards.every((card) => {
      const bounds = card.getBoundingClientRect();
      return bounds.left >= 0 && bounds.right <= window.innerWidth && card.scrollWidth <= card.clientWidth;
    }))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
