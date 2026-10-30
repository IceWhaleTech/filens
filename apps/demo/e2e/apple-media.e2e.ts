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

test('plays original MOV natively or reports an unsupported codec without a video engine', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('./?view=preview');
  await expect(page.getByText('预览就绪', { exact: true })).toBeVisible();
  const requests: string[] = []; page.on('request', request => requests.push(request.url()));
  await page.locator('input[type=file]').setInputFiles(sample('MOV'));
  const video = page.locator('video.pptxv-native-media');
  await expect.poll(async () => (await page.locator('.wb-note.is-error').count()) > 0 ||
    await video.evaluate((video: HTMLVideoElement) => video.videoWidth > 0).catch(() => false), {timeout:30000}).toBe(true);
  if (await page.locator('.wb-note.is-error').count()) await expect(page.locator('.wb-note.is-error')).toContainText(/codec/i);
  else {
    await video.evaluate((video: HTMLVideoElement) => video.play());
    await expect.poll(() => video.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0);
  }
  expect(requests.some(url => /ffmpeg/i.test(url))).toBe(false);
  expect(errors).toEqual([]);
});
