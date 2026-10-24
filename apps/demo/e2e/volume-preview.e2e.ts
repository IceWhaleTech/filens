import { basename, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { createVolumeFixture, inlineVolume } from '../../../packages/model3d/test/fixtures/volume.mjs';

async function prepare(page: Page) {
  await page.route('**/volume-preview-check', route => {
    const base = new URL('.', route.request().url());
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><script type="importmap">${JSON.stringify({ imports: {
      '@filens/core': new URL('volume-core/index.js', base).href, three: new URL('volume-three/three.module.js', base).href
    } })}</script>` });
  });
  for (const [prefix, directory] of [['volume-model', 'packages/model3d/dist'], ['volume-core', 'packages/core/dist'], ['volume-three', 'node_modules/three/build']]) {
    await page.route(`**/${prefix}/*`, route => route.fulfill({ contentType: 'text/javascript', path: resolve(directory, basename(new URL(route.request().url()).pathname)) }));
  }
  await page.goto('./volume-preview-check');
  await page.evaluate(async () => {
    (window as any).volumeCheck = {
      lib: await import(/* @vite-ignore */ new URL('volume-model/index.js', location.href).href),
      three: await import(/* @vite-ignore */ 'three')
    };
  });
}

test('renders known voxels from twelve detached, inline, compressed and byte-order variants', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page);
  const variants: Array<{ name: string; group: string; header?: string; bytes: number[]; values: number[]; max: number }> = [];
  for (const encoding of ['raw', 'gzip', 'gz', 'ascii', 'text', 'txt', 'hex']) {
    const fixture = createVolumeFixture(2, encoding, gzipSync);
    variants.push({ name: encoding, group: 'uchar', header: fixture.header, bytes: [...fixture.payload], values: [...fixture.bytes], max: 255 });
  }
  const fixture = createVolumeFixture();
  for (const lineEnding of ['\n', '\r\n']) variants.push({ name: lineEnding === '\n' ? 'inline-lf' : 'inline-crlf', group: 'uchar',
    bytes: [...new Uint8Array(inlineVolume(fixture.header, fixture.bytes, lineEnding))], values: [...fixture.bytes], max: 255 });
  const values = [0, 128, 255, 256, 512, 1024, 16384, 65535];
  for (const [endian, encoding] of [['little', 'raw'], ['big', 'raw'], ['big', 'gzip']]) {
    const bytes = new Uint8Array(16); values.forEach((value, i) => new DataView(bytes.buffer).setUint16(i * 2, value, endian === 'little'));
    const header = `NRRD0005\ntype: ushort\ndimension: 3\nsizes: 2 2 2\nspacings: 1 2 3\nencoding: ${encoding}\nendian: ${endian}\n`;
    variants.push({ name: `${endian}-${encoding}`, group: 'ushort', bytes: [...new Uint8Array(inlineVolume(header, encoding === 'raw' ? bytes : gzipSync(bytes)))], values, max: 65535 });
  }
  const results = await page.evaluate(async variants => {
    const { lib, three } = (window as any).volumeCheck;
    const renderer = new three.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true }); renderer.setSize(128, 128); renderer.setClearColor(0);
    const camera = new three.OrthographicCamera(-4, 4, 4, -4, 0.1, 100); camera.position.set(6, 9, 11); camera.lookAt(0.5, 1, 1.5);
    const results = [];
    for (const variant of variants) {
      const bytes = new Uint8Array(variant.bytes);
      const buffer = variant.header ? await lib.resolveNhdrBuffer(variant.header, { resourceResolver: () => bytes }) : bytes.buffer;
      const object = lib.loadNrrdObject(buffer), geometry = object.geometry;
      const expectedPositions = Array.from({ length: 8 }, (_, i) => [i % 2, Math.floor(i / 2) % 2 * 2, Math.floor(i / 4) * 3]).flat();
      const expectedColors = [...new Float32Array(variant.values.flatMap(value => [0.22 + value / variant.max * 0.64, 0.3 + value / variant.max * 0.55, 0.4 + value / variant.max * 0.52]))];
      const scene = new three.Scene(); scene.add(object); renderer.render(scene, camera);
      const gl = renderer.getContext(), pixels = new Uint8Array(128 * 128 * 4); gl.readPixels(0, 0, 128, 128, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let visiblePixels = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] || pixels[i + 1] || pixels[i + 2]) visiblePixels++;
      results.push({ name: variant.name, group: variant.group, voxels: geometry.attributes.position.count,
        positionsMatch: JSON.stringify([...geometry.attributes.position.array]) === JSON.stringify(expectedPositions),
        colorsMatch: JSON.stringify([...geometry.attributes.color.array]) === JSON.stringify(expectedColors),
        pixelHash: [...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels))].map(v => v.toString(16).padStart(2, '0')).join(''), visiblePixels, glError: gl.getError() });
      geometry.dispose(); object.material.dispose();
    }
    renderer.dispose(); return results;
  }, variants);
  expect(results).toHaveLength(12);
  for (const row of results) {
    expect(row).toMatchObject({ voxels: 8, positionsMatch: true, colorsMatch: true, glError: 0 }); expect(row.visiblePixels).toBeGreaterThanOrEqual(6);
    expect(row.pixelHash).toBe(results.find(reference => reference.group === row.group)!.pixelHash);
  }
  expect(errors).toEqual([]); console.log('Volume render checks:', JSON.stringify(results));
});

test('settles a non-cooperative volume Blob read on abort and can reopen afterward', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page);
  const fixture = createVolumeFixture();
  await page.evaluate(({ header, bytes }) => {
    const state = (window as any).volumeCheck; state.header = header; state.bytes = new Uint8Array(bytes); state.controller = new AbortController(); state.outcome = 'pending';
    const held = new Promise<ArrayBuffer>(resolve => { state.release = () => resolve(state.bytes.buffer); }), blob = new Blob();
    Object.defineProperty(blob, 'arrayBuffer', { value: () => { state.read = true; return held; } });
    state.pending = state.lib.resolveNhdrBuffer(header, { resourceResolver: () => blob, signal: state.controller.signal })
      .then(() => { state.outcome = 'resolved'; }, (error: Error) => { state.outcome = error.name; });
  }, { header: fixture.header, bytes: [...fixture.bytes] });
  try {
    await expect.poll(() => page.evaluate(() => !!(window as any).volumeCheck.read)).toBe(true);
    await page.evaluate(() => (window as any).volumeCheck.controller.abort());
    await expect.poll(() => page.evaluate(() => (window as any).volumeCheck.outcome)).toBe('AbortError');
    const result = await page.evaluate(async () => {
      const state = (window as any).volumeCheck; state.release(); await state.pending;
      const buffer = await state.lib.resolveNhdrBuffer(state.header, { resourceResolver: () => state.bytes });
      const object = state.lib.loadNrrdObject(buffer), count = object.geometry.attributes.position.count;
      object.geometry.dispose(); object.material.dispose(); return count;
    });
    expect(result).toBe(8); expect(errors).toEqual([]);
  } finally { await page.evaluate(() => (window as any).volumeCheck.release()); }
});

test('opens real inline CRLF and gzip volume files through the demo upload flow', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await page.goto('./?view=preview');
  for (const [encoding, lineEnding] of [['raw', '\r\n'], ['gzip', '\n']]) {
    const fixture = createVolumeFixture(2, encoding, gzipSync), name = `scalar-${encoding}.nrrd`;
    await page.locator('.wb-upload input[type=file]').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(inlineVolume(fixture.header, fixture.payload, lineEnding)) });
    await expect(page.locator('.wb-preview-title strong')).toHaveText(name);
    await expect(page.locator('canvas.model3dv-canvas')).toBeVisible(); await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
