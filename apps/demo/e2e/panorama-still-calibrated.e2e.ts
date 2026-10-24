import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test.use({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });

for (const failSeam of [false, true]) {
  test(`calibrated still preserves sRGB and stays idle with ${failSeam ? 'failed' : 'delayed'} seam analysis`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('./?view=preview');
    const moduleUrl = new URL(`@fs${resolve('packages/panorama/src/index.ts')}`, page.url()).href;
    await page.evaluate(async ({ moduleUrl, failSeam }) => {
      const { PanoramaPreviewSession } = await import(/* @vite-ignore */ moduleUrl);
      const source = document.createElement('canvas');
      source.width = 800; source.height = 400;
      const ctx = source.getContext('2d')!;
      ctx.fillStyle = 'rgb(118,118,118)'; ctx.fillRect(0, 0, 800, 400);
      const jpeg = await new Promise<Blob>(resolve => source.toBlob(blob => resolve(blob!), 'image/jpeg', 1));
      const manifest = {
        vendor: 'insta360', format: 'insp', cameraModel: 'Insta360 OneRS', width: 800, height: 400,
        textureOrigin: 'top-left', projection: { kind: 'mei-extended', xi: 1 },
        calibrationSource: 'embedded', confidence: 'experimental', tracks: [], warnings: [],
        lenses: [0, 1].map(index => ({
          sourceRect: { x: index / 2, y: 0, width: 0.5, height: 1 },
          width: 400, height: 400, fx: 130, fy: 130, cx: 200, cy: 200, xi: 1,
          radial: [0, 0, 0, 0], tangential: [0, 0], thinPrism: [0, 0, 0, 0], sensorTilt: [0, 0],
          extrinsicQuaternion: index ? [0, 0, 1, 0] : [1, 0, 0, 0]
        }))
      };
      const state = { pending: 0, calls: 0, draws: 0, mipmaps: 0 };
      for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
        const draw = proto.drawElements;
        proto.drawElements = function (...args) { state.draws++; return draw.apply(this, args); };
        const mipmap = proto.generateMipmap;
        proto.generateMipmap = function (...args) { state.mipmaps++; return mipmap.apply(this, args); };
      }
      const processor = {
        open: async () => manifest, close() {}, abort() {}, getManifest: () => manifest,
        async computeSeam({ width, height }: { width: number; height: number }) {
          state.calls++; state.pending++;
          try {
            await new Promise(resolve => setTimeout(resolve, 30));
            if (failSeam) throw new Error('optional seam unavailable');
            return { seam: new Array(height).fill(Math.floor(width / 2)), cost: 0 };
          } finally { state.pending--; }
        }
      };
      const host = document.createElement('div');
      host.id = 'calibrated-still-test';
      host.style.cssText = 'position:fixed;inset:0;width:640px;height:480px;z-index:9999';
      document.body.append(host);
      const session = new PanoramaPreviewSession(host, {}, processor);
      (window as any).calibratedStillTest = { session, state };
      await session.load(jpeg, {
        descriptor: { name: 'gray.insp', extension: 'insp' }, route: { family: 'panorama', sourceFormat: 'insp' }
      });
    }, { moduleUrl, failSeam });
    const canvas = page.locator('#calibrated-still-test canvas');
    await expect(canvas).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as any).calibratedStillTest.state.pending)).toBe(0);
    expect(await page.evaluate(() => (window as any).calibratedStillTest.state.calls)).toBe(2);
    const sample = () => canvas.evaluate(element => {
      const canvas = element as HTMLCanvasElement;
      const gl = canvas.getContext('webgl2')!;
      const pixel = new Uint8Array(4);
      gl.readPixels(canvas.width / 2, canvas.height / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return [...pixel];
    });
    await expect.poll(async () => (await sample())[0]).toBeGreaterThan(110);
    for (const value of (await sample()).slice(0, 3)) expect(Math.abs(value - 118)).toBeLessThanOrEqual(2);
    const state = await page.evaluate(() => ({ ...((window as any).calibratedStillTest.state) }));
    expect(state.mipmaps).toBe(0);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => (window as any).calibratedStillTest.state.draws)).toBe(state.draws);
    // A real pointer drag and zoom must still repaint the retained image.
    await page.mouse.move(400, 200); await page.mouse.down(); await page.mouse.move(100, 230); await page.mouse.up();
    await expect.poll(() => page.evaluate(() => (window as any).calibratedStillTest.state.draws)).toBeGreaterThan(state.draws);
    await page.mouse.wheel(0, -100);
    await expect.poll(() => page.evaluate(() => (window as any).calibratedStillTest.session.getState().scale)).toBeGreaterThan(1);
    for (const value of (await sample()).slice(0, 3)) expect(Math.abs(value - 118)).toBeLessThanOrEqual(2);
    expect(errors).toEqual([]);
    await page.evaluate(() => (window as any).calibratedStillTest.session.destroy());
    await expect(canvas).toHaveCount(0);
  });
}
