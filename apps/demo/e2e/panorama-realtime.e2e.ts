import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test.use({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });

for (const packed of [false, true]) {
  test(`renders ${packed ? 'packed' : 'separate'} calibrated video and supports paused interaction and seeking`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('./?view=preview');
    const moduleUrl = new URL(`@fs${resolve('packages/panorama/src/index.ts')}`, page.url()).href;
    await page.evaluate(async ({ moduleUrl, packed }) => {
      const { PanoramaPreviewSession } = await import(/* @vite-ignore */ moduleUrl);
      const width = packed ? 512 : 256;
      const encoded: Array<{ pts: number; duration: number; key: boolean; data: Uint8Array }> = [];
      let decoderConfig = '';
      const encoder = new VideoEncoder({
        output(chunk, metadata) {
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          encoded.push({ pts: chunk.timestamp, duration: chunk.duration ?? 100_000, key: chunk.type === 'key', data });
          const description = metadata?.decoderConfig?.description;
          if (description) decoderConfig = Array.from(new Uint8Array(description as ArrayBuffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
        },
        error(error) { throw error; }
      });
      encoder.configure({ codec: 'avc1.42001e', width, height: 256, framerate: 10, bitrate: 200_000, avc: { format: 'avc' } });
      const surface = document.createElement('canvas');
      surface.width = width;
      surface.height = 256;
      const context = surface.getContext('2d')!;
      for (let index = 0; index < 20; index++) {
        const gradient = context.createLinearGradient(0, 0, width, 256);
        gradient.addColorStop(0, '#a0d0ff');
        gradient.addColorStop(1, '#304050');
        context.fillStyle = gradient;
        context.fillRect(0, 0, width, 256);
        context.fillStyle = '#ffffff';
        context.fillRect(index * 4, 100, 32, 32);
        const frame = new VideoFrame(surface, { timestamp: index * 100_000, duration: 100_000 });
        encoder.encode(frame, { keyFrame: true });
        frame.close();
      }
      await encoder.flush();
      encoder.close();
      const track = (id: number) => ({
        id, codec: 'avc1', decoderConfig, width, height: 256, timescale: 1_000_000,
        samples: encoded.map((sample) => ({ ...sample, offset: 0, size: sample.data.length }))
      });
      const manifest = {
        vendor: 'insta360', format: 'insv', cameraModel: 'Insta360 OneRS',
        textureOrigin: 'top-left', projection: { kind: 'mei-extended', xi: 1.5 },
        calibrationSource: 'embedded', confidence: 'experimental', warnings: [],
        tracks: packed ? [track(1)] : [track(1), track(2)],
        lenses: [0, 1].map((index) => ({
          sourceTrackId: packed ? 1 : index + 1,
          sourceRect: packed ? { x: index / 2, y: 0, width: 0.5, height: 1 } : undefined,
          width: 256, height: 256, fx: 80, fy: 80, cx: 128, cy: 128, xi: 1.5,
          radial: [0, 0, 0, 0], tangential: [0, 0], thinPrism: [0, 0, 0, 0],
          extrinsicQuaternion: index ? [0, 0, 1, 0] : [1, 0, 0, 0]
        }))
      };
      const host = document.createElement('div');
      host.id = 'realtime-panorama-test';
      host.style.cssText = 'position:fixed;inset:0;width:640px;height:480px;z-index:9999';
      document.body.append(host);
      const processor = {
        open: async () => manifest,
        readSample: async (trackId: number, index: number) => ({ ...encoded[index], trackId, timescale: 1_000_000 }),
        seek: (seconds: number) => ({ 1: Math.floor(seconds * 10), 2: Math.floor(seconds * 10) }),
        close() {}, abort() {}, getManifest: () => manifest
      };
      const session = new PanoramaPreviewSession(host, {}, processor);
      (window as any).realtimePanoramaTest = session;
      await session.load(new Blob(['synthetic encoded sample source']), {
        descriptor: { name: 'synthetic.insv', extension: 'insv' }, route: { family: 'panorama-video', sourceFormat: 'insv' }
      });
    }, { moduleUrl, packed });

    const canvas = page.locator('#realtime-panorama-test canvas');
    await expect(canvas).toHaveAttribute('data-insta360-context-status', 'ready');
    await expect.poll(() => page.evaluate(() => (window as any).realtimePanoramaTest.getState().currentTime)).toBeGreaterThan(0.1);
    await page.getByRole('button', { name: 'Pause panorama video', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).realtimePanoramaTest.getState().paused)).toBe(true);
    // Let the final requested video paint settle, then ensure pause is idle.
    await page.waitForTimeout(100);
    const paused = await page.evaluate(() => (window as any).realtimePanoramaTest.getState().currentTime);
    const draws = Number(await canvas.getAttribute('data-insta360-draw-count'));
    await page.waitForTimeout(150);
    expect(Number(await canvas.getAttribute('data-insta360-draw-count'))).toBe(draws);

    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 250);
    await page.mouse.up();
    await expect.poll(async () => Number(await canvas.getAttribute('data-insta360-draw-count'))).toBeGreaterThan(draws);
    await page.mouse.wheel(0, -100);
    await expect.poll(() => page.evaluate(() => (window as any).realtimePanoramaTest.getState().scale)).toBeGreaterThan(1);
    expect(await page.evaluate(() => (window as any).realtimePanoramaTest.getState().currentTime)).toBeCloseTo(paused, 2);

    await page.getByRole('slider', { name: 'Panorama video position' }).evaluate((element) => {
      (element as HTMLInputElement).value = '1.2';
      element.dispatchEvent(new Event('change'));
    });
    await expect.poll(() => page.evaluate(() => (window as any).realtimePanoramaTest.getState().currentTime)).toBeCloseTo(1.2, 2);
    await expect(page.getByRole('button', { name: 'Play panorama video', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
    await page.evaluate(() => (window as any).realtimePanoramaTest.destroy());
    await expect(canvas).toHaveCount(0);
  });
}

test('stitches a real raw INSV with the Photos renderer', async ({ page }) => {
  test.setTimeout(90_000);
  const sample = process.env.RAW_INSV_SAMPLE;
  test.skip(!sample || !existsSync(sample), 'Set RAW_INSV_SAMPLE to a calibrated camera-original INSV.');
  await page.goto('./?view=preview');
  await page.locator('.wb-upload input[type=file]').setInputFiles(sample!);
  const canvas = page.locator('canvas.panoramav-canvas');
  await expect(canvas).toHaveAttribute('data-insta360-projection-kind', 'dual_fisheye', { timeout: 30_000 });
  await expect(canvas).toHaveAttribute('data-insta360-video-seam', /ready|cached/, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Pause panorama video', exact: true }).click();
  await page.getByRole('slider', { name: 'Panorama video position' }).evaluate((element) => {
    (element as HTMLInputElement).value = '3';
    element.dispatchEvent(new Event('change'));
  });
  await expect(page.getByRole('button', { name: 'Play panorama video', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(canvas).toHaveAttribute('data-insta360-video-seam', /ready|cached/, { timeout: 30_000 });
  await expect(page.locator('.panoramav-notice')).toHaveCount(0);
});
