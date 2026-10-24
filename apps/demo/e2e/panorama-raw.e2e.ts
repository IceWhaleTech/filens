import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { dngFixture } from '../../../packages/panorama/test/fixtures/dng';

test.use({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });

for (const kind of ['one-rs', 'x5'] as const) {
  test(`develops and stitches synthetic ${kind} DNG with upright sensor rows`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('./?view=preview');
    await page.locator('.wb-upload input[type=file]').setInputFiles({
      name: `${kind}.dng`, mimeType: 'image/dng', buffer: Buffer.from(dngFixture(kind, 6))
    });
    const canvas = page.locator('canvas.panoramav-canvas');
    // A fresh browser also fetches/compiles both WASM modules and the GL shaders.
    await expect(canvas).toHaveAttribute('data-insta360-context-status', 'ready', { timeout: 20_000 });
    await expect(canvas).toHaveAttribute('data-insta360-static-seam-analyzed', 'true');
    await expect(canvas).toHaveAttribute('data-insta360-static-seam-status', 'ready');
    const pixels = await canvas.evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      const gl = canvas.getContext('webgl')!;
      const sample = (height: number) => {
        const pixel = new Uint8Array(4);
        gl.readPixels(Math.floor(canvas.width / 2), Math.floor(canvas.height * height), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        return [...pixel];
      };
      return { sky: sample(.75), ground: sample(.25) };
    });
    expect(pixels.sky[2]).toBeGreaterThan(pixels.sky[0] + 40);
    expect(pixels.ground[0]).toBeGreaterThan(pixels.ground[2] + 40);
    await page.setViewportSize({ width: 768, height: 900 });
    await expect(canvas).toHaveAttribute('data-insta360-context-status', 'ready');
    // Switching away releases the GL canvas and restores the ordinary RAW path.
    await page.locator('.wb-upload input[type=file]').setInputFiles('apps/demo/public/samples/raw/pentax-k-r.dng');
    await expect(page.locator('img.pptxv-native-image')).toBeVisible();
    await expect(canvas).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('previews an ordinary camera DNG as a flat image', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./?view=preview');
  await page.locator('.wb-upload input[type=file]').setInputFiles('apps/demo/public/samples/raw/pentax-k-r.dng');
  const image = page.locator('img.pptxv-native-image');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(100);
  await expect(page.locator('canvas.panoramav-canvas')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('stitches a camera-original panorama DNG through WASM', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const sample = process.env.RAW_DNG_SAMPLE;
  test.skip(!sample || !existsSync(sample), 'Set RAW_DNG_SAMPLE to a supported Insta360 DNG.');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./?view=preview');
  await page.locator('.wb-upload input[type=file]').setInputFiles(sample!);
  const canvas = page.locator('canvas.panoramav-canvas');
  await expect(canvas).toHaveAttribute('data-insta360-context-status', 'ready', { timeout: 90_000 });
  await expect(canvas).toHaveAttribute('data-insta360-projection-kind', 'dual_fisheye');
  await expect(canvas).toHaveAttribute('data-insta360-static-seam-analyzed', 'true');
  expect(await canvas.getAttribute('data-insta360-static-seam-error')).toBeNull();
  await expect(canvas).toHaveAttribute('data-insta360-static-seam-status', 'ready');
  const draws = Number(await canvas.getAttribute('data-insta360-draw-count'));
  await page.waitForTimeout(200);
  expect(Number(await canvas.getAttribute('data-insta360-draw-count'))).toBe(draws);
  await page.screenshot({ path: testInfo.outputPath('dng-preview.png') });
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 320, box.y + 250);
  await page.mouse.up();
  await expect.poll(async () => Number(await canvas.getAttribute('data-insta360-draw-count'))).toBeGreaterThan(draws);
  await page.mouse.wheel(0, -100);
  await expect(page.locator('.panoramav-notice')).toHaveCount(0);
  expect(errors).toEqual([]);
});
