import { basename, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createObjMaterialFixture, createObjTexture } from '../../../packages/model3d/test/fixtures/obj.mjs';

async function prepare(page: Page) {
  await page.route('**/obj-resources-check', route => {
    const base = new URL('.', route.request().url());
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><script type="importmap">${JSON.stringify({ imports: {
      '@filens/core': new URL('obj-core/index.js', base).href, three: new URL('obj-three/three.module.js', base).href
    } })}</script>` });
  });
  for (const [prefix, directory] of [['obj-model', 'packages/model3d/dist'], ['obj-baseline', 'tmp/continued-review/obj-resources-baseline/dist'],
    ['obj-core', 'packages/core/dist'], ['obj-three', 'node_modules/three/build']]) {
    await page.route(`**/${prefix}/*`, route => route.fulfill({ contentType: 'text/javascript', path: resolve(directory, basename(new URL(route.request().url()).pathname)) }));
  }
  await page.goto('./obj-resources-check');
  await page.evaluate(async () => {
    const state = { lib: await import(/* @vite-ignore */ new URL('obj-model/index.js', location.href).href),
      three: await import(/* @vite-ignore */ 'three'), active: new Set<string>(), created: [] as string[], revoked: [] as string[] };
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); state.active.add(url); state.created.push(url); return url; };
    URL.revokeObjectURL = url => { state.active.delete(url); state.revoked.push(url); revoke(url); };
    (window as any).objCheck = state;
  });
}

test('renders UTF-8 OBJ materials and transformed textures identically across native sources', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page);
  const fixture = createObjMaterialFixture('底色', '纹理/颜色 图.png', '-s 1 1 1 -o 0 0 0 '), png = createObjTexture(8).png;
  const results = await page.evaluate(async ({ fixture, png }) => {
    const state = (window as any).objCheck, { lib, three } = state;
    const bytes = new Uint8Array(png), text = new TextEncoder().encode(fixture.material);
    const referenceImage = new Image(); referenceImage.src = `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`; await referenceImage.decode();
    const referenceTexture = new three.Texture(referenceImage); referenceTexture.colorSpace = three.SRGBColorSpace;
    referenceTexture.needsUpdate = true; referenceTexture.wrapS = referenceTexture.wrapT = three.RepeatWrapping;
    const geometry = new three.BufferGeometry(); geometry.setAttribute('position', new three.Float32BufferAttribute(fixture.positions, 3));
    geometry.setAttribute('normal', new three.Float32BufferAttribute(fixture.normals, 3)); geometry.setAttribute('uv', new three.Float32BufferAttribute(fixture.uv, 2));
    const reference = new three.Mesh(geometry, new three.MeshPhongMaterial({ map: referenceTexture }));
    const renderer = new three.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true }); renderer.setSize(128, 128); renderer.setClearColor(0);
    const camera = new three.OrthographicCamera(-0.1, 1.1, 1.1, -0.1, 0.1, 10); camera.position.set(0, 0, 2);
    const scene = new three.Scene(); scene.add(new three.AmbientLight(0xffffff, 1));
    const render = async (object: any) => {
      scene.add(object); renderer.render(scene, camera); scene.remove(object);
      const gl = renderer.getContext(), pixels = new Uint8Array(128 * 128 * 4); gl.readPixels(0, 0, 128, 128, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let visible = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] || pixels[i + 1] || pixels[i + 2]) visible++;
      return { hash: [...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels))].map(v => v.toString(16).padStart(2, '0')).join(''), visible, glError: gl.getError() };
    };
    const expected = await render(reference), results = [];
    for (const kind of ['view', 'buffer', 'blob', 'base64', 'percent']) {
      const start = state.created.length;
      const padded = new Uint8Array(text.length + 4); padded.set(text, 2);
      const materialSource = kind === 'view' ? new DataView(padded.buffer, 2, text.length) : kind === 'buffer' ? text.buffer : kind === 'blob' ? new Blob([text])
        : kind === 'base64' ? `data:text/plain;base64,${btoa(String.fromCharCode(...text))}` : `data:text/plain,${encodeURIComponent(fixture.material)}`;
      const { object, warnings } = await lib.loadObjObjectWithWarnings(fixture.source, {
        resourceBasePath: 'models/scene.obj', resourceResolver: ({ source, relation }: any) => {
          if (relation === 'material') return materialSource;
          if (source !== 'models/materials/纹理/颜色 图.png') throw new Error(`Wrong texture path: ${source}`);
          return kind === 'blob' ? new Blob([bytes], { type: 'image/png' }) : bytes;
        }
      });
      const mesh = object.children[0], rendered = await render(object);
      results.push({ kind, ...rendered, expected: expected.hash, name: mesh.material.name, dimensions: [mesh.material.map.image.width, mesh.material.map.image.height],
        positionsMatch: JSON.stringify([...mesh.geometry.attributes.position.array]) === JSON.stringify(fixture.positions),
        uvMatch: JSON.stringify([...mesh.geometry.attributes.uv.array]) === JSON.stringify(fixture.uv), warnings,
        created: state.created.length - start, active: state.active.size });
      mesh.geometry.dispose(); mesh.material.map.dispose(); mesh.material.dispose();
    }
    referenceTexture.dispose(); reference.material.dispose(); geometry.dispose(); renderer.dispose(); return results;
  }, { fixture, png: [...png] });
  for (const row of results) {
    expect(row.hash).toBe(row.expected); expect(row.visible).toBeGreaterThan(10000);
    expect(row).toMatchObject({ glError: 0, name: '底色', dimensions: [8, 8], positionsMatch: true, uvMatch: true, warnings: [], created: 1, active: 0 });
  }
  expect(errors).toEqual([]); console.log('OBJ native render checks:', JSON.stringify(results));
});

test('cancels a non-cooperative OBJ texture resolver, releases prior URLs and reopens', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page);
  const fixture = createObjMaterialFixture();
  await page.evaluate(fixture => {
    const state = (window as any).objCheck; state.controller = new AbortController(); state.calls = 0; state.outcome = 'pending';
    const held = new Promise<Blob>(resolve => { state.release = () => resolve(new Blob(['late'])); });
    state.pending = state.lib.loadObjObjectWithWarnings(fixture.source, {
      signal: state.controller.signal, resourceResolver: ({ relation }: any) => relation === 'material'
        ? new TextEncoder().encode(fixture.material + 'norm normal.png\n') : ++state.calls === 1 ? new Blob(['first']) : held
    }).then(() => { state.outcome = 'resolved'; }, (error: Error) => { state.outcome = error.name; });
  }, fixture);
  try {
    await expect.poll(() => page.evaluate(() => (window as any).objCheck.calls)).toBe(2);
    await page.evaluate(() => (window as any).objCheck.controller.abort());
    await expect.poll(() => page.evaluate(() => (window as any).objCheck.outcome)).toBe('AbortError');
    expect(await page.evaluate(() => (window as any).objCheck.active.size)).toBe(0);
    await page.evaluate(async () => { const state = (window as any).objCheck; state.release(); await state.pending; });
    const count = await page.evaluate(async fixture => {
      const state = (window as any).objCheck;
      const { object } = await state.lib.loadObjObjectWithWarnings(fixture.source, { resourceResolver: () => new TextEncoder().encode('newmtl base\nKd 1 1 1\n') });
      const mesh = object.children[0]; mesh.geometry.dispose(); mesh.material.dispose(); return mesh.geometry.attributes.position.count;
    }, fixture);
    expect(count).toBe(6); expect(errors).toEqual([]);
  } finally { await page.evaluate(() => (window as any).objCheck.release()); }
});

test('cancels an in-flight image and disposes abandoned OBJ resources before its late response', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page);
  let release!: () => void, requested = false;
  const held = new Promise<void>(resolve => { release = resolve; }), png = createObjTexture(2).png;
  await page.route('**/held-obj-texture.png', async route => { requested = true; await held; await route.fulfill({ contentType: 'image/png', body: png }); });
  const fixture = createObjMaterialFixture();
  await page.evaluate(fixture => {
    const state = (window as any).objCheck, { three } = state; state.controller = new AbortController(); state.outcome = 'pending';
    state.disposed = { geometries: 0, materials: 0, textures: 0 };
    for (const [type, key] of [[three.BufferGeometry, 'geometries'], [three.Material, 'materials'], [three.Texture, 'textures']]) {
      const original = type.prototype.dispose; type.prototype.dispose = function () { state.disposed[key]++; return original.call(this); };
    }
    state.pending = state.lib.loadObjObjectWithWarnings(fixture.source, { signal: state.controller.signal,
      resourceResolver: ({ relation }: any) => relation === 'material' ? new Blob([fixture.material]) : new URL('held-obj-texture.png', location.href).href
    }).then(() => { state.outcome = 'resolved'; }, (error: Error) => { state.outcome = error.name; });
  }, fixture);
  try {
    await expect.poll(() => requested).toBe(true); await page.evaluate(() => (window as any).objCheck.controller.abort());
    await expect.poll(() => page.evaluate(() => (window as any).objCheck.outcome)).toBe('AbortError');
    expect(await page.evaluate(() => (window as any).objCheck.disposed)).toEqual({ geometries: 1, materials: 1, textures: 1 });
    release(); await page.waitForResponse('**/held-obj-texture.png');
    await page.evaluate(async () => { await (window as any).objCheck.pending; });
    expect(await page.evaluate(() => (window as any).objCheck.active.size)).toBe(0); expect(errors).toEqual([]);
  } finally { release(); }
});

test('reports invalid texture bytes and preserves the OBJ geometry', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page);
  const result = await page.evaluate(async fixture => {
    const state = (window as any).objCheck;
    const { object, warnings } = await state.lib.loadObjObjectWithWarnings(fixture.source, {
      resourceResolver: ({ relation }: any) => relation === 'material' ? new TextEncoder().encode(fixture.material) : new Blob(['not a PNG'])
    });
    const mesh = object.children[0], vertices = mesh.geometry.attributes.position.count;
    mesh.geometry.dispose(); mesh.material.map.dispose(); mesh.material.dispose(); return { warnings, vertices, active: state.active.size };
  }, createObjMaterialFixture());
  expect(result.vertices).toBe(6); expect(result.active).toBe(0); expect(result.warnings.join(' ')).toMatch(/texture.*failed/i); expect(errors).toEqual([]);
});

test('opens OBJ with UTF-8 MTL and a local texture through the demo upload flow', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await page.goto('./?view=preview');
  const fixture = createObjMaterialFixture('底色'), png = createObjTexture(8).png;
  await page.locator('.wb-upload input[type=file]').setInputFiles([
    { name: 'scene.obj', mimeType: 'text/plain', buffer: Buffer.from(fixture.source) },
    { name: 'base.mtl', mimeType: 'text/plain', buffer: Buffer.from(fixture.material) },
    { name: 'color.png', mimeType: 'image/png', buffer: png }
  ]);
  await expect(page.locator('.wb-preview-title strong')).toHaveText('scene.obj');
  await expect(page.locator('canvas.model3dv-canvas')).toBeVisible();
  await expect(page.locator('.wb-note.is-error')).toHaveCount(0); expect(errors).toEqual([]);
});
