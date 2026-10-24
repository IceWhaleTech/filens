import { basename, resolve } from 'node:path';
import crypto from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { createKmzDae, createKmzFixture } from '../../../packages/model3d/test/fixtures/kmz.mjs';

async function prepare(page: Page) {
  await page.route('**/kmz-resources-check', route => {
    const base = new URL('.', route.request().url());
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><script type="importmap">${JSON.stringify({ imports: {
      '@filens/core': new URL('kmz-core/index.js', base).href, three: new URL('kmz-three/three.module.js', base).href
    } })}</script>` });
  });
  for (const [prefix, directory] of [['kmz-model', 'packages/model3d/dist'], ['kmz-baseline', 'tmp/continued-review/kmz-resources-baseline/dist'],
    ['kmz-core', 'packages/core/dist'], ['kmz-three', 'node_modules/three/build']]) {
    await page.route(`**/${prefix}/*`, route => route.fulfill({ contentType: 'text/javascript', path: resolve(directory, basename(new URL(route.request().url()).pathname)) }));
  }
  await page.goto('./kmz-resources-check');
  await page.evaluate(async () => {
    const state = { lib: await import(/* @vite-ignore */ new URL('kmz-model/index.js', location.href).href),
      original: await import(/* @vite-ignore */ new URL('kmz-baseline/index.js', location.href).href), three: await import(/* @vite-ignore */ 'three'),
      active: new Set<string>(), created: [] as string[], revoked: [] as string[] };
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); state.active.add(url); state.created.push(url); return url; };
    URL.revokeObjectURL = url => { state.active.delete(url); state.revoked.push(url); revoke(url); };
    (window as any).kmzCheck = state;
  });
}

test('renders nested KMZ models and encoded textures identically to an original flat archive', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page);
  const flat = await createKmzFixture(), nested = await createKmzFixture({ nested: true });
  const rows = await page.evaluate(async ({ flat, nested, expected }) => {
    const state = (window as any).kmzCheck, { lib, original, three } = state;
    const renderer = new three.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true }); renderer.setSize(128, 128); renderer.setClearColor(0);
    const camera = new three.OrthographicCamera(-0.1, 1.1, 1.1, -0.1, 0.1, 10); camera.position.set(0, 0, 2);
    const scene = new three.Scene(); scene.add(new three.AmbientLight(0xffffff, 1));
    const sha = async (bytes: any) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
    const rows = [];
    for (const kind of ['original-flat', 'current-flat', 'current-nested', 'sync-nested']) {
      const loads: Promise<void>[] = [], load = three.TextureLoader.prototype.load;
      three.TextureLoader.prototype.load = function (url: string, onLoad: any, onProgress: any, onError: any) {
        let yes!: () => void, no!: (error: any) => void; loads.push(new Promise<void>((resolve, reject) => { yes = resolve; no = reject; }));
        return load.call(this, url, (texture: any) => { onLoad?.(texture); texture.image.decode().then(yes, no); }, onProgress, no);
      };
      const bytes = new Uint8Array(kind.endsWith('flat') ? flat : nested).buffer, start = state.created.length;
      const result = kind === 'original-flat' ? { object: original.loadKmzObject(bytes), warnings: [] }
        : kind === 'sync-nested' ? { object: lib.loadKmzObject(bytes), warnings: [] } : await lib.loadKmzObjectWithWarnings(bytes);
      const nodes: any[] = []; result.object.traverse((node: any) => { if (node.isMesh) nodes.push(node); });
      await Promise.all(loads); three.TextureLoader.prototype.load = load;
      scene.add(result.object); renderer.render(scene, camera); scene.remove(result.object);
      const mesh = nodes[0], image = mesh.material.map.image, canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(image, 0, 0);
      const gl = renderer.getContext(), pixels = new Uint8Array(128 * 128 * 4); gl.readPixels(0, 0, 128, 128, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let visible = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] || pixels[i + 1] || pixels[i + 2]) visible++;
      rows.push({ kind, meshes: nodes.length, positionsMatch: JSON.stringify([...mesh.geometry.attributes.position.array]) === JSON.stringify(expected.positions),
        normalsMatch: JSON.stringify([...mesh.geometry.attributes.normal.array]) === JSON.stringify(expected.normals), uvMatch: JSON.stringify([...mesh.geometry.attributes.uv.array]) === JSON.stringify(expected.uv),
        name: mesh.material.name, pixelHash: await sha(pixels), decodedHash: await sha(ctx.getImageData(0, 0, image.width, image.height).data), dimensions: [image.width, image.height],
        visible, glError: gl.getError(), warnings: result.warnings, created: state.created.length - start, activeBeforeCleanup: state.active.size });
      mesh.geometry.dispose(); mesh.material.map.dispose(); mesh.material.dispose();
      // The original loader leaks its private URLs; cleanup is outside all checks/timing.
      for (const url of [...state.active] as string[]) URL.revokeObjectURL(url);
    }
    renderer.dispose(); return rows;
  }, { flat: [...flat.bytes], nested: [...nested.bytes], expected: { positions: flat.positions, normals: flat.normals, uv: flat.uv } });
  const decoded = crypto.createHash('sha256').update(flat.image.pixels).digest('hex');
  for (const row of rows) {
    expect(row).toMatchObject({ meshes: 1, positionsMatch: true, normalsMatch: true, uvMatch: true, name: '底色0', decodedHash: decoded, dimensions: [8, 8], glError: 0, warnings: [], created: 1 });
    expect(row.visible).toBeGreaterThan(10000); expect(row.pixelHash).toBe(rows[0].pixelHash); expect(row.activeBeforeCleanup).toBe(row.kind === 'original-flat' ? 1 : 0);
  }
  expect(errors).toEqual([]); console.log('KMZ render checks:', JSON.stringify(rows));
});

test('shares repeated KMZ texture URLs and waits for all material images', async ({ page }) => {
  await prepare(page); const fixture = await createKmzFixture({ materials: 2 });
  const result = await page.evaluate(async bytes => {
    const state = (window as any).kmzCheck, { object, warnings } = await state.lib.loadKmzObjectWithWarnings(new Uint8Array(bytes).buffer);
    const meshes: any[] = []; object.traverse((node: any) => { if (node.isMesh) meshes.push(node); });
    const rows = meshes.map(node => ({ name: node.material.name, width: node.material.map.image.width, complete: node.material.map.image.complete }));
    const geometries = new Set<any>(), materials = new Set<any>(); for (const mesh of meshes) { geometries.add(mesh.geometry); materials.add(mesh.material); }
    for (const geometry of geometries) geometry.dispose(); for (const material of materials) { material.map.dispose(); material.dispose(); }
    return { rows, warnings, created: state.created.length, revoked: state.revoked.length, active: state.active.size };
  }, [...fixture.bytes]);
  expect(result).toEqual({ rows: [{ name: '底色0', width: 8, complete: true }, { name: '底色1', width: 8, complete: true }], warnings: [], created: 1, revoked: 1, active: 0 });
});

test('settles replaced KMZ texture loading before a delayed external image and reopens cleanly', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page);
  let release!: () => void, requested = false;
  const held = new Promise<void>(resolve => { release = resolve; }), fixture = await createKmzFixture(), valid = await createKmzFixture({ texture: false });
  await page.route('**/held-kmz-texture.png', async route => { requested = true; await held; await route.fulfill({ contentType: 'image/png', body: fixture.image.png }); });
  fixture.zip.file(fixture.modelName, createKmzDae({ texture: new URL('held-kmz-texture.png', page.url()).href }));
  const bytes = await fixture.zip.generateAsync({ type: 'uint8array' });
  await page.evaluate(bytes => {
    const state = (window as any).kmzCheck, host = document.createElement('div'); host.style.cssText = 'width:640px;height:480px'; document.body.append(host); state.host = host;
    state.done = false; state.rendered = 0; state.session = state.lib.createModel3dPreviewDriver().createSession(host, {});
    state.session.on('rendered', () => state.rendered++); const source = new Uint8Array(bytes);
    state.pending = state.session.load(source, { descriptor: { source, name: 'old.kmz', extension: 'kmz' } }).then(() => { state.done = true; });
  }, [...bytes]);
  try {
    await expect.poll(() => requested).toBe(true);
    await page.evaluate(async bytes => { const state = (window as any).kmzCheck, source = new Uint8Array(bytes); await state.session.load(source, { descriptor: { source, name: 'current.kmz', extension: 'kmz' } }); }, [...valid.bytes]);
    await expect.poll(() => page.evaluate(() => (window as any).kmzCheck.done)).toBe(true);
    const result = await page.evaluate(() => {
      const state = (window as any).kmzCheck, snapshot = state.session.getState();
      return { title: snapshot.title, triangles: snapshot.metadata.triangleCount, rendered: state.rendered, canvases: state.host.querySelectorAll('canvas').length, active: state.active.size, error: snapshot.error };
    });
    expect(result).toEqual({ title: 'current.kmz', triangles: 2, rendered: 1, canvases: 1, active: 0, error: null });
    const response = page.waitForResponse('**/held-kmz-texture.png'); release(); await response;
    await page.evaluate(async () => { const state = (window as any).kmzCheck; await state.pending; state.session.destroy(); }); expect(errors).toEqual([]);
  } finally { release(); }
});

test('reports broken and missing KMZ images while preserving geometry and releasing URLs', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page);
  const fixture = await createKmzFixture(); fixture.zip.file(fixture.textureName, 'invalid PNG');
  const broken = await fixture.zip.generateAsync({ type: 'uint8array' }); fixture.zip.remove(fixture.textureName);
  const missing = await fixture.zip.generateAsync({ type: 'uint8array' });
  const results = await page.evaluate(async inputs => {
    const state = (window as any).kmzCheck, rows = [];
    for (const input of inputs) {
      const { object, warnings } = await state.lib.loadKmzObjectWithWarnings(new Uint8Array(input).buffer); let vertices = 0, fallback: number[] = [];
      object.traverse((node: any) => { if (node.isMesh) {
        vertices += node.geometry.attributes.position.count;
        if (node.material.map.image) {
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const ctx = canvas.getContext('2d')!;
          ctx.drawImage(node.material.map.image, 0, 0); fallback = [...ctx.getImageData(0, 0, 1, 1).data];
        }
        node.geometry.dispose(); node.material.map.dispose(); node.material.dispose();
      } });
      rows.push({ warnings, vertices, fallback, active: state.active.size });
    }
    return rows;
  }, [[...broken], [...missing]]);
  expect(results[0].warnings.join(' ')).toMatch(/texture failed/i); expect(results[1].warnings.join(' ')).toMatch(/could not be resolved/i);
  expect(results[1].fallback).toEqual([255, 255, 255, 255]);
  for (const row of results) expect(row).toMatchObject({ vertices: 6, active: 0 }); expect(errors).toEqual([]);
});

test('opens a nested UTF-8 KMZ with its texture through the demo upload flow', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); const fixture = await createKmzFixture({ nested: true });
  await page.goto('./?view=preview');
  await page.locator('.wb-upload input[type=file]').setInputFiles({ name: 'nested.kmz', mimeType: 'application/vnd.google-earth.kmz', buffer: Buffer.from(fixture.bytes) });
  await expect(page.locator('.wb-preview-title strong')).toHaveText('nested.kmz'); await expect(page.locator('canvas.model3dv-canvas')).toBeVisible();
  const pixels = await page.locator('canvas.model3dv-canvas').evaluate((canvas: HTMLCanvasElement) => {
    const gl = canvas.getContext('webgl2')!, data = new Uint8Array(canvas.width * canvas.height * 4); gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    const colors = new Set<number>(); for (let i = 0; i < data.length; i += 4) if (data[i + 3]) colors.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    return { colors: colors.size, error: gl.getError() };
  });
  expect(pixels.colors).toBeGreaterThan(20); expect(pixels.error).toBe(0);
  await expect(page.locator('.wb-note.is-error')).toHaveCount(0); expect(errors).toEqual([]);
});
