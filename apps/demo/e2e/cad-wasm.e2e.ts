import path from 'node:path';
import { expect, test } from '@playwright/test';

test('loads the optional CAD WASM on the first STEP preview and reuses it', async ({ page }) => {
  const wasmRequests: string[] = [];
  const loaderRequests: string[] = [];
  const errors: string[] = [];
  page.on('request', request => {
    if (/occt-import-js[^/]*\.wasm(?:\?|$)/.test(request.url())) wasmRequests.push(request.url());
    if (/(?:occt-runtime[^/]*|occt-import-js)\.js(?:\?|$)/.test(request.url())) loaderRequests.push(request.url());
  });
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('./?view=preview');
  await expect(page.locator('.wb-upload input[type=file]')).toBeAttached();
  expect(wasmRequests).toHaveLength(0);
  expect(loaderRequests).toHaveLength(0);

  for (const name of ['cube.stp', 'assembly.stp']) {
    await page.locator('.wb-upload input[type=file]').setInputFiles(path.resolve('packages/model3d/test/fixtures/occt', name));
    await expect(page.locator('.wb-preview-title strong')).toHaveText(name);
    await expect(page.locator('canvas.model3dv-canvas')).toBeVisible();
    await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
    expect(wasmRequests).toHaveLength(1);
    expect(loaderRequests).toHaveLength(1);
  }
  expect(errors).toEqual([]);
});
