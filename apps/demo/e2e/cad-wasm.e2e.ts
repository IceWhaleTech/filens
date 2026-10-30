import path from 'node:path';
import { expect, test } from '@playwright/test';

test('loads Rust STEP WASM on demand, reuses it and leaves OCCT unloaded', async ({ page }) => {
  const wasmRequests: string[] = [];
  const occtRequests: string[] = [];
  const loaderRequests: string[] = [];
  const errors: string[] = [];
  page.on('response', response => {
    // Vite's development ?url import is a JavaScript module, not a WASM download.
    if (/filens-step[^/]*\.wasm(?:\?|$)/.test(response.url()) &&
        response.headers()['content-type']?.startsWith('application/wasm')) {
      wasmRequests.push(response.url());
    }
    if (/occt-import-js[^/]*\.wasm(?:\?|$)/.test(response.url()) && response.headers()['content-type']?.startsWith('application/wasm')) occtRequests.push(response.url());
  });
  page.on('request', request => {
    if (/rust-step-importer[^/]*\.(?:ts|js)(?:\?|$)/.test(request.url())) loaderRequests.push(request.url());
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
    expect(occtRequests).toHaveLength(0);
  }
  expect(errors).toEqual([]);
});
