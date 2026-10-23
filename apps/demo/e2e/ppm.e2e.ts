import { expect, test } from '@playwright/test';

test('previews the PPM sample and local P3/P6 files through WASM', async ({ page }) => {
  await page.goto('./?view=preview');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  const images = page.locator('.wb-format-category').filter({
    has: page.getByRole('heading', { name: '图片', exact: true })
  });
  await images.getByRole('button', { name: 'PPM', exact: true }).click();
  await expect(page.locator('.wb-preview-title strong')).toHaveText('photo-alpine-lake.ppm');
  const image = page.locator('img.pptxv-native-image');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(256);
  for (const input of [
    Buffer.from('P3\n# colors\n2 1\n15\n15 0 0 0 15 0\n'),
    Buffer.concat([Buffer.from('P6\n2 1\n255\n'), Buffer.from([255, 0, 0, 0, 255, 0])]),
    Buffer.concat([Buffer.from('P6\n2 1\n65535\n'), Buffer.from([255, 255, 0, 0, 0, 0, 0, 0, 255, 255, 0, 0])])
  ]) {
    const previousSource = await image.getAttribute('src');
    await page.locator('input[type="file"]').first().setInputFiles({ name: 'colors.PPM', mimeType: 'image/x-portable-pixmap', buffer: input });
    await expect(page.locator('.wb-preview-title strong')).toHaveText('colors.PPM');
    await expect(image).not.toHaveAttribute('src', previousSource!);
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2);
    const pixels = await image.evaluate((img: HTMLImageElement) => {
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 1;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      return Array.from(ctx.getImageData(0, 0, 2, 1).data);
    });
    expect(pixels).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
    await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
  }
});
