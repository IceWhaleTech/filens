import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const sample = (extension: string) => resolve(`apps/demo/public/samples/live-photo/apple-iphone-15-live-photo.${extension}`);

test('previews an uploaded original iPhone HEIC with the WASM decoder', async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('./?view=preview');
  await expect(page.getByText('预览就绪', { exact: true })).toBeVisible();
  await page.locator('input[type=file]').setInputFiles(sample('HEIC'));
  const image = page.locator('img.pptxv-native-image');
  await expect.poll(() => image.evaluate((image: HTMLImageElement) => image.naturalWidth).catch(() => 0), { timeout: 60000 }).toBeGreaterThan(1000);
  await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('converts the original iPhone MOV after native playback rejects it', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('./?view=preview');
  await expect(page.getByText('预览就绪', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    // Trigger the codec fallback even when this machine has a native HEVC decoder.
    new MutationObserver(() => {
      document.querySelector('video source[type="video/quicktime"]')?.dispatchEvent(new Event('error'));
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page.locator('input[type=file]').setInputFiles(sample('MOV'));
  const converted = page.locator('video source[type="video/mp4"]');
  await expect(converted).toHaveCount(1, { timeout: 90000 });
  const video = page.locator('video.pptxv-native-media');
  await expect.poll(() => video.evaluate((video: HTMLVideoElement) => video.readyState), { timeout: 30000 }).toBeGreaterThanOrEqual(2);
  await video.evaluate((video: HTMLVideoElement) => video.play());
  await expect.poll(() => video.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0);
  await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
  expect(errors).toEqual([]);
});
