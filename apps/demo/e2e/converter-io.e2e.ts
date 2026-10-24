import { expect, test } from '@playwright/test';
import { createImageDocmFixture } from '../../../packages/converter-client/test/fixtures/office.mjs';
import { createPngFixture } from '../../../packages/cad/test/fixtures/resources.mjs';

test('converts an image DOCM and previews every preserved picture through the demo', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const png = await createPngFixture(128), bytes = await createImageDocmFixture(png, 4);
  await page.goto('./?view=preview');
  await page.locator('input[type=file]').setInputFiles({ name: 'image-document.docm', mimeType: 'application/vnd.ms-word.document.macroEnabled.12', buffer: Buffer.from(bytes) });
  await expect(page.locator('.wb-preview-title strong')).toHaveText('image-document.docm');
  const sections = page.locator('section.docx'), images = sections.locator('img');
  await expect(images).toHaveCount(4);
  const sizes = await images.evaluateAll(async nodes => {
    const result = [];
    for (const node of nodes) { const image = node as HTMLImageElement; await image.decode(); result.push([image.naturalWidth, image.naturalHeight]); }
    return result;
  });
  expect(sizes).toEqual([[128,128], [128,128], [128,128], [128,128]]);
  for (let index = 1; index <= 4; index++) await expect(sections).toContainText(`Image ${index} / WASI output check`);
  await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
  expect(errors).toEqual([]);
});
