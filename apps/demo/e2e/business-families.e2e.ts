import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test('groups formats by business family on desktop and mobile', async ({ page }) => {
  await page.goto('./?view=preview');

  await expect(page.locator('.wb-tabs .wb-tab')).toHaveText(['Office', 'Design', 'Media', 'Archive', 'Text']);
  await expect(page.getByRole('button', { name: 'CSV', exact: true })).toHaveCount(1);

  await page.getByRole('button', { name: 'Design', exact: true }).click();
  await expect(page.locator('.wb-format-category h3')).toContainText(['CAD', '3D 模型', '流程图', '思维导图', '设计稿']);

  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await expect(page.locator('.wb-format-category h3')).toContainText(['TXT', 'Markdown', '代码', '配置', '日志', '电子书']);
  await expect(page.getByRole('button', { name: 'TXT', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'HTML', exact: true })).toHaveCount(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await expect(page.locator('.wb-format-category h3')).toContainText(['图片', '实况图', '全景图', '音频', '视频']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth)
  );
});

test('offers representative samples for text, markup, config, and source formats', async ({ page }) => {
  await page.goto('./?view=preview');
  await page.getByRole('button', { name: 'Text', exact: true }).click();

  for (const [format, name] of [
    ['TXT', 'notes.txt'],
    ['LOG', 'preview.log'],
    ['MD', 'README.md'],
    ['JSON', 'preview.json'],
    ['YAML', 'preview.yaml'],
    ['TOML', 'preview.toml'],
    ['XML', 'preview.xml'],
    ['TS', 'preview.ts'],
    ['PY', 'preview.py']
  ] as const) {
    const button = page.getByRole('button', { name: format, exact: true });
    await expect(button).toBeEnabled();
    await button.click();
    await expect(page.locator('.wb-preview-title strong')).toHaveText(name);
    await expect(page.locator('.pptxv-native-text')).toBeVisible();
  }
});

test('offers polished samples across the supported Office families', async ({ page }) => {
  await page.goto('./?view=preview');

  for (const format of [
    'DOCM', 'DOT', 'DOTX', 'DOTM', 'WPT',
    'XLSM', 'XLT', 'XLTX', 'XLTM', 'ETT', 'TSV', 'TAB', 'PSV',
    'POT', 'PPTM', 'PPSX', 'PPSM', 'POTX', 'POTM', 'DPS', 'DPT',
    'ODT', 'OTT', 'FODT', 'ODS', 'OTS', 'FODS', 'ODP', 'OTP', 'FODP',
    'SXW', 'STW', 'SXC', 'STC', 'SXI', 'STI',
    'ODG', 'OTG', 'FODG', 'SXD', 'STD'
  ]) {
    await expect(page.getByRole('button', { name: format, exact: true })).toBeEnabled();
  }

  for (const [format, name, text] of [
    ['DOCM', 'office-showcase.docm', 'Weekend Field Guide'],
    ['DOTM', 'office-showcase.dotm', 'Weekend Field Guide'],
    ['WPT', 'project-brief.wpt', 'The Lifecycle of a Project'],
    ['XLTX', 'finance-dashboard.xltx', 'Fictional Sample Dashboard'],
    ['XLTM', 'finance-dashboard.xltm', 'Fictional Sample Dashboard'],
    ['PPTM', 'visual-story.pptm', 'Smart Art'],
    ['ODT', 'product-brief.odt', 'Weekend Trip Brief'],
    ['ODP', 'quarterly-review.odp', 'Quarterly Review'],
    ['SXW', 'openoffice-project.sxw', 'Weekend Trip Brief'],
    ['SXC', 'openoffice-dashboard.sxc', 'Dashboard'],
    ['SXI', 'openoffice-review.sxi', 'Quarterly Review'],
    ['ODG', 'design-boards.odg', 'Brand System'],
    ['SXD', 'design-boards.sxd', 'Brand System']
  ] as const) {
    await page.getByRole('button', { name: format, exact: true }).click();
    await expect(page.locator('.wb-preview-title strong')).toHaveText(name);
    await expect(page.locator('.wb-preview-stage')).toContainText(text);
    await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
    if (format === 'ODG' || format === 'SXD') {
      const showToolbar = page.getByRole('button', { name: '显示工具栏', exact: true });
      if (await showToolbar.isVisible()) await showToolbar.click();
      const shell = page.locator('.pptxv-generic-shell');
      await expect(shell.locator('.pptxv-status').first()).toHaveText('1 / 3');
      await shell.getByRole('button', { name: 'Next', exact: true }).click();
      await expect(page.locator('.wb-preview-stage')).toContainText('User Journey');
      await shell.getByRole('button', { name: 'Next', exact: true }).click();
      await expect(shell.locator('.pptxv-status').first()).toHaveText('3 / 3');
      await expect(page.locator('.wb-preview-stage')).toContainText('Delivery Board');
      await expect.poll(() => shell.locator('.pptxv-slide-shell[data-slide-index="2"]').evaluate(element => {
        const rect = element.getBoundingClientRect(), viewport = element.parentElement!.getBoundingClientRect();
        const center = viewport.top + viewport.height / 2;
        return rect.top < center && rect.bottom > center;
      })).toBe(true);
    }
  }

  await page.getByRole('button', { name: 'DOCX', exact: true }).click();
  await expect(page.locator('.wb-preview-title strong')).toHaveText('filens-aurora-guide.docx');
  await expect(page.locator('.wb-preview-stage')).toContainText('Trip overview');
  await expect(page.locator('.wb-preview-stage')).toContainText('Route and activities');
  await expect(page.locator('.wb-preview-stage')).toContainText('All places, groups, dates, and figures in this guide are fictional.');
  await expect(page.locator('.wb-preview-stage')).not.toContainText(/technical decisions|release candidate|WASM smoke test|conversion core/i);
  await expect(page.locator('.wb-preview-stage')).toContainText('Packing checklist');
  await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
});

test('offers read-only TAR, TGZ, and GZIP samples', async ({ page }) => {
  await page.goto('./?view=preview');
  await page.getByRole('button', { name: 'Archive', exact: true }).click();

  for (const [format, name, entry] of [
    ['TAR', 'sample-archive.tar', 'SOURCES.md'],
    ['TGZ', 'sample-archive.tgz', 'rich-text.rtf'],
    ['GZ', 'sample-readme.md.gz', 'sample-readme.md'],
    ['JAR', 'sample-library.jar', 'META-INF/'],
    ['WAR', 'sample-webapp.war', 'WEB-INF/'],
    ['EAR', 'sample-enterprise.ear', 'sample-webapp.war'],
    ['APK', 'sample-app.apk', 'AndroidManifest.xml']
  ] as const) {
    await page.getByRole('button', { name: format, exact: true }).click();
    await expect(page.locator('.wb-preview-title strong')).toHaveText(name);
    await expect(page.locator('.archivev-table')).toContainText(entry);
  }

  await page.locator('input[type="file"]').setInputFiles({
    name: 'sample-archive.tar.gz', mimeType: 'application/gzip',
    buffer: await readFile(resolve('apps/demo/public/samples/sample-archive-tar-gz.bin'))
  });
  await expect(page.locator('.archivev-table')).toContainText('SOURCES.md');

  await page.locator('input[type="file"]').setInputFiles(resolve('apps/demo/public/samples/sample-nested-archives.zip'));
  await page.locator('tr.archivev-row').filter({ hasText: 'archives/' }).click();
  await page.locator('tr.archivev-row').filter({ hasText: 'sample-archive.tar' }).click();
  await expect(page.locator('.archivev-table')).toContainText('rich-text.rtf');
});

test('offers playable samples for more audio and video formats', async ({ page }) => {
  await page.goto('./?view=preview');
  await page.getByRole('button', { name: 'Media', exact: true }).click();

  for (const format of ['MP3', 'OGG']) {
    await expect(page.getByRole('button', { name: format, exact: true })).toBeEnabled();
  }

  await page.getByRole('button', { name: 'MP3', exact: true }).click();
  await expect(page.locator('.wb-preview-title strong')).toHaveText('t-rex-roar.mp3');
  await expect(page.locator('audio.pptxv-native-media')).toBeVisible();

  await page.getByRole('button', { name: 'OGG', exact: true }).click();
  await expect(page.locator('.wb-preview-title strong')).toHaveText('example.ogg');
  await expect(page.locator('audio.pptxv-native-media')).toBeVisible();

  const videoCategory = page.locator('.wb-format-category').filter({
    has: page.getByRole('heading', { name: '视频', exact: true })
  });
  for (const [format, name] of [
    ['MP4', 'sample-video.mp4'],
    ['WEBM', 'flower.webm'],
    ['MOV', 'sample.mov'],
    ['M4V', 'sample.m4v'],
    ['OGV', 'sample.ogv'],
    ['MKV', 'sample.mkv'],
    ['AVI', 'sample.avi'],
    ['MPEG', 'sample.mpeg'],
    ['MPG', 'sample.mpg'],
    ['3GP', 'sample.3gp']
  ] as const) {
    const button = videoCategory.getByRole('button', { name: format, exact: true });
    await expect(button).toBeEnabled();
    await button.click();
    await expect(page.locator('.wb-preview-title strong')).toHaveText(name);
    await expect(page.locator('video.pptxv-native-media')).toBeVisible();
  }
});

test('offers samples for browser-native images and panorama aliases', async ({ page }) => {
  let inspRequests = 0;
  // Exercise the sample alias using a bundled stitched image; native calibration has separate tests.
  await page.route(url => url.pathname === '/external-samples/insta360/insp',
  route => {
    inspRequests++;
    return route.fulfill({ path: 'apps/demo/public/samples/panorama/insta360-oners-tallinn.jpg', contentType: 'image/jpeg' });
  });
  await page.goto('./?view=preview');
  await page.getByRole('button', { name: 'Media', exact: true }).click();

  const imageCategory = page.locator('.wb-format-category').filter({
    has: page.getByRole('heading', { name: '图片', exact: true })
  });
  for (const format of ['PNG', 'JPG', 'GIF', 'WEBP', 'AVIF', 'APNG', 'ICO', 'ICNS', 'BMP']) {
    await expect(imageCategory.getByRole('button', { name: format, exact: true })).toBeEnabled();
  }
  await expect(imageCategory.getByRole('button', { name: 'JPEG', exact: true })).toHaveCount(0);
  await expect(imageCategory.getByRole('button', { name: 'SVG', exact: true })).toHaveCount(0);

  await imageCategory.getByRole('button', { name: 'JPG', exact: true }).click();
  await expect(page.locator('.wb-preview-title strong')).toHaveText('photo-alpine-lake.jpg');
  await expect(page.locator('img.pptxv-native-image')).toBeVisible();

  for (const [format, name] of [
    ['AVIF', 'photo-alpine-lake.avif'],
    ['APNG', 'photo-animated-earth.apng'],
    ['ICO', 'photo-transparency.ico'],
    ['ICNS', 'photo-transparency.icns']
  ]) {
    await imageCategory.getByRole('button', { name: format, exact: true }).click();
    await expect(page.locator('.wb-preview-title strong')).toHaveText(name);
    await expect(page.locator('img.pptxv-native-image')).toBeVisible();
  }

  for (const [format, name] of [
    ['CR2', 'canon-40d-sraw.cr2'],
    ['CR3', 'canon-r6.cr3'],
    ['NEF', 'nikon-iss.nef'],
    ['ORF', 'olympus-stylus.orf'],
    ['PEF', 'pentax-k-r.pef'],
    ['DNG', 'pentax-k-r.dng']
  ]) {
    await imageCategory.getByRole('button', { name: format, exact: true }).click();
    await expect(page.locator('.wb-preview-title strong')).toHaveText(name);
    await expect(page.locator('img.pptxv-native-image')).toBeVisible();
    await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
  }
  expect(await page.evaluate(() => {
    const preview = document.querySelector('.pptxv-native-preview--image')?.getBoundingClientRect();
    const image = document.querySelector('img.pptxv-native-image')?.getBoundingClientRect();
    return preview && image ? image.top - preview.top : Number.POSITIVE_INFINITY;
  })).toBeLessThanOrEqual(24);

  const panoramaCategory = page.locator('.wb-format-category').filter({
    has: page.getByRole('heading', { name: '全景图', exact: true })
  });
  for (const format of ['PANO', 'PANORAMA', '360', 'INSP', '360V', 'INSV', 'OSV']) {
    await expect(panoramaCategory.getByRole('button', { name: format, exact: true })).toBeEnabled();
  }
  await expect(panoramaCategory.getByRole('button', { name: 'INSV', exact: true })).toHaveCount(1);
  await expect(panoramaCategory.getByRole('button', { name: 'OSV', exact: true })).toHaveCount(1);
  await expect(panoramaCategory.getByRole('button', { name: 'Insta360 One RS', exact: true })).toBeEnabled();
  await expect(panoramaCategory.getByRole('button', { name: 'Osmo 360', exact: true })).toBeEnabled();

  await panoramaCategory.getByRole('button', { name: 'Osmo 360', exact: true }).click();
  await expect(page.locator('.wb-preview-title strong')).toHaveText('osmo-360-leipzig.jpg');
  await expect(page.locator('canvas.panoramav-canvas')).toBeVisible({ timeout: 15_000 });

  await panoramaCategory.getByRole('button', { name: 'Insta360 One RS', exact: true }).click();
  await expect(page.locator('.wb-preview-title strong')).toHaveText('insta360-oners-tallinn.jpg');
  await expect(page.locator('canvas.panoramav-canvas')).toBeVisible({ timeout: 15_000 });

  await panoramaCategory.getByRole('button', { name: 'INSP', exact: true }).click();
  await expect(page.locator('.wb-preview-title strong')).toHaveText('IMG_20220701_170732_00_018.insp');
  await expect(page.locator('canvas.panoramav-canvas')).toBeVisible({ timeout: 15_000 });
  expect(inspRequests).toBeGreaterThan(0);
  // A canvas is mounted before the image finishes loading. Wait for a rendered pixel.
  await expect.poll(() => page.locator('canvas.panoramav-canvas').evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    const gl = canvas.getContext('webgl2')!;
    const pixel = new Uint8Array(4);
    gl.readPixels(canvas.width / 2, canvas.height / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return pixel[0] + pixel[1] + pixel[2];
  })).toBeGreaterThan(100);
  await expect(page.locator('.wb-note.is-error')).toHaveCount(0);

  await panoramaCategory.getByRole('button', { name: '360V', exact: true }).click();
  await expect(page.locator('.wb-preview-title strong')).toHaveText('nasa-black-hole-360.webm');
  await expect(page.locator('canvas.panoramav-canvas')).toBeVisible({ timeout: 15_000 });
  const panoramaVideo = page.locator('video.panoramav-video-controls');
  await expect(panoramaVideo).toBeVisible();
  await panoramaVideo.evaluate((video: HTMLVideoElement) => video.play());
  await expect.poll(() => panoramaVideo.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0);
  await panoramaVideo.evaluate((video: HTMLVideoElement) => video.pause());
});

test('lists only locally bundled real-device live photo samples', async ({ page }) => {
  await page.route('https://cdn.apple-livephotoskit.com/lpk/1/livephotoskit.js', async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      body: `window.LivePhotosKit = {
        PlaybackStyle: { FULL: 'full' },
        augmentElementAsPlayer(element, options) {
          window.__livePhotoOptions = options;
          element.classList.add('lpk-live-photo-player');
          element.textContent = 'Live Photo';
          element.stop = () => {};
          element.updateSize = () => {};
          return element;
        }
      };`
    });
  });
  await page.goto('./?view=preview');
  await page.getByRole('button', { name: 'Media', exact: true }).click();

  const livePhotoCategory = page.locator('.wb-format-category').filter({
    has: page.getByRole('heading', { name: '实况图', exact: true })
  });
  for (const vendor of [
    'Apple · iPhone 15',
    'Google · Pixel 9 Pro XL',
    'Samsung · Galaxy A34',
    'Samsung · Galaxy S20 FE',
    'Samsung · Galaxy Tab S9'
  ]) {
    await expect(livePhotoCategory.getByRole('button', { name: vendor, exact: true })).toBeEnabled();
  }

  await livePhotoCategory.getByRole('button', { name: 'Apple · iPhone 15', exact: true }).click();
  await expect(page.locator('.wb-preview-title strong')).toHaveText('apple-iphone-15-live-photo.HEIC + MOV');
  await expect(page.locator('.apple-live-photo-player.lpk-live-photo-player')).toBeVisible();
  expect(await page.evaluate(() => (window as typeof window & {
    __livePhotoOptions?: { photoSrc?: string; videoSrc?: string };
  }).__livePhotoOptions)).toMatchObject({
    photoSrc: new URL('samples/live-photo/apple-iphone-15-live-photo.jpg', page.url()).pathname,
    videoSrc: new URL('samples/live-photo/apple-iphone-15-live-photo.mp4', page.url()).pathname
  });
  await expect(page.getByRole('link', { name: '原始 HEIC' })).toHaveAttribute('href', new URL('samples/live-photo/apple-iphone-15-live-photo.HEIC', page.url()).pathname);
  await expect(page.getByRole('link', { name: '原始 MOV' })).toHaveAttribute('href', new URL('samples/live-photo/apple-iphone-15-live-photo.MOV', page.url()).pathname);

  await livePhotoCategory.getByRole('button', { name: 'Google · Pixel 9 Pro XL', exact: true }).click();
  await expect(page.locator('.wb-preview-title strong')).toHaveText('pixel-9-pro-xl-ultra-hdr-motion-photo.jpg');
  await expect(page.locator('img.pptxv-native-image')).toBeVisible();

  await livePhotoCategory.getByRole('button', { name: 'Samsung · Galaxy S20 FE', exact: true }).click();
  await expect(page.locator('.wb-preview-title strong')).toHaveText('galaxy-s20fe-motion-photo.jpg');
  await expect(page.locator('img.pptxv-native-image')).toBeVisible();
});
