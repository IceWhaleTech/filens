import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const inspSample = process.env.INSP_SAMPLE;
const insvSample = process.env.INSV_SAMPLE;
const osvSample = process.env.OSV_SAMPLE;
const osvProxySample = process.env.OSV_PROXY_SAMPLE;

test('previews a real Insta360 INSP through embedded dual-fisheye calibration', async ({ page }) => {
  test.skip(!inspSample || !existsSync(inspSample), 'Set INSP_SAMPLE to a real local .insp file.');

  await page.goto('./?view=preview');
  await page.locator('.wb-upload input[type=file]').setInputFiles(inspSample!);

  await expect(page.locator('.wb-preview-title strong')).toHaveText(/\.insp$/i);
  await expect(page.locator('canvas.panoramav-canvas')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.panoramav-notice')).toHaveCount(0);
});

test('previews a real stitched Insta360 INSV proxy as panorama video', async ({ page }) => {
  test.skip(!insvSample || !existsSync(insvSample), 'Set INSV_SAMPLE to a real local stitched .insv proxy.');

  await page.goto('./?view=preview');
  await page.locator('.wb-upload input[type=file]').setInputFiles(insvSample!);

  await expect(page.locator('.wb-preview-title strong')).toHaveText(/\.insv$/i);
  await expect(page.locator('canvas.panoramav-canvas')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('video.panoramav-video-controls')).toBeVisible();
  await expect(page.locator('.panoramav-notice')).toHaveCount(0);
});

test('previews a real Osmo OSV recording through its matching LRF proxy', async ({ page }) => {
  test.skip(
    !osvSample || !osvProxySample || !existsSync(osvSample) || !existsSync(osvProxySample),
    'Set OSV_SAMPLE and OSV_PROXY_SAMPLE to a matching local Osmo pair.'
  );

  await page.goto('./?view=preview');
  await page.locator('.wb-upload input[type=file]').setInputFiles([osvSample!, osvProxySample!]);

  await expect(page.locator('.wb-preview-title strong')).toHaveText(/\.osv$/i);
  await expect(page.locator('canvas.panoramav-canvas')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('video.panoramav-video-controls')).toBeVisible();
  await expect(page.locator('.panoramav-notice')).toHaveCount(0);
});
