import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { createBinaryStlFixture, createGlbFixture } from '../../../packages/model3d/test/fixtures/mesh.mjs';
import { createObjTexture } from '../../../packages/model3d/test/fixtures/obj.mjs';
import { createCancellation3mfFixture, createTexturedGlbFixture } from '../../../packages/model3d/test/fixtures/cancellation.mjs';

let archivedBaseline: Promise<any> | undefined;
async function baselineRuntime(name: string): Promise<Buffer> {
  archivedBaseline ??= readFile('benchmarks/frontend/2026-10-24/model3d-cancel-diagnostic.json.gz')
    .then(bytes => JSON.parse(gunzipSync(bytes).toString('utf8'))).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  const archive = await archivedBaseline;
  if (!archive) return readFile(resolve('tmp/continued-review/model3d-cancel-baseline/dist', name));
  const text = archive.baselineRuntimeFiles[`tmp/continued-review/model3d-cancel-baseline/dist/${name}`];
  if (typeof text === 'string') return Buffer.from(text);
  // The unchanged WASM is shared with the current build; verify its archived binding.
  const path = `packages/model3d/dist/${name}`, binding = archive.sharedRuntimeBindings.find((row: any) => row.path === path);
  const bytes = await readFile(path);
  if (!binding || createHash('sha256').update(bytes).digest('hex') !== binding.sha256) throw new Error(`Baseline runtime binding mismatch: ${name}`);
  return bytes;
}

async function prepare(page: Page) {
  await page.route('**/model3d-cancel-check', route => {
    const base = new URL('.', route.request().url());
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><script type="importmap">${JSON.stringify({ imports: {
      '@filens/core': new URL('cancel-core/index.js', base).href, three: new URL('cancel-three/three.module.js', base).href
    } })}</script>` });
  });
  for (const [prefix, directory] of [['cancel-model', 'packages/model3d/dist'], ['cancel-baseline', 'tmp/continued-review/model3d-cancel-baseline/dist'],
    ['cancel-core', 'packages/core/dist'], ['cancel-three', 'node_modules/three/build']]) {
    await page.route(`**/${prefix}/*`, async route => {
      const name = basename(new URL(route.request().url()).pathname);
      const contentType = name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript';
      return prefix === 'cancel-baseline' ? route.fulfill({ contentType, body: await baselineRuntime(name) }) : route.fulfill({ contentType, path: resolve(directory, name) });
    });
  }
  await page.goto('./model3d-cancel-check');
  await page.evaluate(async () => {
    const host = document.createElement('div'); host.style.cssText = 'width:640px;height:480px'; document.body.append(host);
    const lib = await import(/* @vite-ignore */ new URL('cancel-model/index.js', location.href).href);
    const three = await import(/* @vite-ignore */ 'three');
    const session = lib.createModel3dPreviewDriver().createSession(host), state = { lib, three, host, session, done: false, error: '', rendered: 0, errors: [] as string[] };
    session.on('rendered', () => state.rendered++); session.on('error', (error: Error) => state.errors.push(error.message));
    (window as any).cancelCheck = state;
  });
}

for (const kind of ['blob', 'body'] as const) for (const action of ['replace', 'destroy', 'abort'] as const) {
  test(`settles held 3D ${kind} bytes before ${action} releases them`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page);
    await page.evaluate(({ kind, action }) => {
      const state = (window as any).cancelCheck; state.controller = new AbortController(); state.cancelled = 0; state.read = false;
      const bytes = new Promise<ArrayBuffer>(resolve => { state.release = resolve; });
      const source = kind === 'blob' ? new Blob() : '/noncooperative.stl';
      if (kind === 'blob') Object.defineProperty(source, 'arrayBuffer', { value: () => bytes });
      else window.fetch = (async () => ({ ok: true, arrayBuffer: () => { state.read = true; return bytes; }, body: { cancel: async () => { state.cancelled++; } } })) as any;
      state.pending = state.session.load(source, { descriptor: { source, name: 'old.stl', extension: 'stl' }, signal: state.controller.signal })
        .then(() => { state.done = true; }, (error: Error) => { state.done = true; state.error = error.name; });
      state.action = action;
    }, { kind, action });
    try {
      if (kind === 'body') await expect.poll(() => page.evaluate(() => (window as any).cancelCheck.read)).toBe(true);
      await page.evaluate(async bytes => {
        const state = (window as any).cancelCheck;
        if (state.action === 'replace') { const source = new Uint8Array(bytes); await state.session.load(source, { descriptor: { source, name: 'current.glb', extension: 'glb' } }); }
        else if (state.action === 'destroy') state.session.destroy(); else state.controller.abort();
      }, [...createGlbFixture()]);
      await expect.poll(() => page.evaluate(() => (window as any).cancelCheck.done)).toBe(true);
      const before = await page.evaluate(() => { const s = (window as any).cancelCheck; return { loading: s.session.getState().loading, error: s.error, rendered: s.rendered, errors: s.errors, canvases: s.host.querySelectorAll('canvas').length, cancelled: s.cancelled }; });
      expect(before).toEqual({ loading: false, error: action === 'abort' ? 'AbortError' : '', rendered: action === 'replace' ? 1 : 0, errors: [], canvases: action === 'replace' ? 1 : 0, cancelled: kind === 'body' ? 1 : 0 });
    } finally {
      await page.evaluate(async bytes => { const state = (window as any).cancelCheck; state.release(new Uint8Array(bytes).buffer); await state.pending; }, [...createBinaryStlFixture(3)]);
    }
    if (action === 'replace') expect(await page.evaluate(() => (window as any).cancelCheck.session.getState())).toMatchObject({ title: 'current.glb', error: null, metadata: { triangleCount: 1 } });
    expect(errors).toEqual([]);
  });
}

for (const action of ['replace', 'destroy', 'abort'] as const) {
  test(`settles real GLB texture parsing before ${action} releases the image and disposes late resources`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page);
    const texture = createObjTexture(8); let release!: () => void, requested = false;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/held-glb-image.png', async route => { requested = true; await held; await route.fulfill({ contentType: 'image/png', body: texture.png }).catch(() => {}); });
    const bytes = createTexturedGlbFixture(new URL('held-glb-image.png', page.url()).href);
    await page.evaluate(bytes => {
      const state = (window as any).cancelCheck; state.controller = new AbortController(); state.disposed = { geometry: 0, material: 0, texture: 0 };
      for (const [name, type] of [['geometry', 'BufferGeometry'], ['material', 'Material'], ['texture', 'Texture']]) {
        const original = state.three[type].prototype.dispose;
        state.three[type].prototype.dispose = function () { state.disposed[name]++; return original.call(this); };
      }
      const source = new Uint8Array(bytes);
      state.pending = state.session.load(source, { descriptor: { source, name: 'old.glb', extension: 'glb' }, signal: state.controller.signal })
        .then(() => { state.done = true; }, (error: Error) => { state.done = true; state.error = error.name; });
    }, [...bytes]);
    try {
      await expect.poll(() => requested).toBe(true);
      await page.evaluate(async ({ action, bytes }) => {
        const state = (window as any).cancelCheck;
        if (action === 'replace') { const source = new Uint8Array(bytes); await state.session.load(source, { descriptor: { source, name: 'current.stl', extension: 'stl' } }); }
        else if (action === 'destroy') state.session.destroy(); else state.controller.abort();
      }, { action, bytes: [...createBinaryStlFixture(2)] });
      await expect.poll(() => page.evaluate(() => (window as any).cancelCheck.done)).toBe(true);
      expect(await page.evaluate(() => (window as any).cancelCheck.error)).toBe(action === 'abort' ? 'AbortError' : '');
      expect(await page.evaluate(() => (window as any).cancelCheck.disposed)).toEqual({ geometry: 0, material: 0, texture: 0 });
    } finally { release(); }
    await expect.poll(() => page.evaluate(() => (window as any).cancelCheck.disposed)).toEqual({ geometry: 1, material: 1, texture: 1 });
    const final = await page.evaluate(() => { const s = (window as any).cancelCheck; return { state: s.session.getState(), rendered: s.rendered, errors: s.errors, canvases: s.host.querySelectorAll('canvas').length }; });
    expect(final).toMatchObject({ state: { loading: false, error: null }, errors: [], rendered: action === 'replace' ? 1 : 0, canvases: action === 'replace' ? 1 : 0 });
    if (action === 'replace') expect(final.state).toMatchObject({ title: 'current.stl', metadata: { triangleCount: 2 } });
    expect(errors).toEqual([]);
  });
}

test('keeps real STEP WASM initialization usable by another caller after cancelling the preview', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page);
  let release!: () => void, requested = 0;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/cancel-model/occt-import-js.wasm', async route => { requested++; await held; await route.fulfill({ contentType: 'application/wasm', path: resolve('packages/model3d/dist/occt-import-js.wasm') }); });
  const bytes = await readFile('packages/model3d/test/fixtures/occt/cube.stp');
  await page.evaluate(bytes => {
    const state = (window as any).cancelCheck, source = new Uint8Array(bytes); state.controller = new AbortController();
    state.pending = state.session.load(source, { descriptor: { source, name: 'old.step', extension: 'step' }, signal: state.controller.signal })
      .then(() => { state.done = true; }, (error: Error) => { state.done = true; state.error = error.name; });
    state.live = state.lib.loadStepObject(source.buffer, { signal: new AbortController().signal });
  }, [...bytes]);
  try {
    await expect.poll(() => requested).toBe(1); await page.evaluate(() => (window as any).cancelCheck.controller.abort());
    await expect.poll(() => page.evaluate(() => (window as any).cancelCheck.done)).toBe(true);
    expect(await page.evaluate(() => (window as any).cancelCheck.error)).toBe('AbortError');
  } finally { release(); }
  const result = await page.evaluate(async bytes => {
    const state = (window as any).cancelCheck, object = await state.live, next = await state.lib.loadStepObject(new Uint8Array(bytes).buffer);
    const summarize = (object: any) => { let triangles = 0; object.traverse((node: any) => { if (node.isMesh) triangles += node.geometry.index.count / 3; }); return triangles; };
    return { live: summarize(object), next: summarize(next), canvases: state.host.querySelectorAll('canvas').length, rendered: state.rendered, errors: state.errors };
  }, [...bytes]);
  expect(result).toEqual({ live: 12, next: 12, canvases: 0, rendered: 0, errors: [] }); expect(requested).toBe(1); expect(errors).toEqual([]);
});

for (const format of ['stl', 'glb', 'step', '3mf'] as const) {
  test(`preserves complete ${format} geometry, materials and rendered pixels with an active signal`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page);
    const texture = createObjTexture(8);
    const bytes = format === 'stl' ? createBinaryStlFixture(1000) : format === 'glb' ? createTexturedGlbFixture(`data:image/png;base64,${texture.png.toString('base64')}`)
      : format === '3mf' ? await createCancellation3mfFixture() : await readFile('packages/model3d/test/fixtures/occt/cube.stp');
    const rows = await page.evaluate(async ({ format, bytes, texturePixels }) => {
      const { lib, three } = (window as any).cancelCheck, baseline = await import(/* @vite-ignore */ new URL('cancel-baseline/index.js', location.href).href);
      const renderer = new three.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true }); renderer.setSize(128, 128); renderer.setClearColor(0);
      const rows = [], hash = async (data: any) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(v => v.toString(16).padStart(2, '0')).join('');
      for (const [name, engine, options] of [['original', baseline, undefined], ['current', lib, undefined], ['signal', lib, { signal: new AbortController().signal }]] as const) {
        const buffer = new Uint8Array(bytes).buffer; let object: any;
        if (format === 'glb') object = await engine.loadGlbObject(buffer, options);
        else if (format === 'step') object = await engine.loadStepObject(buffer, options);
        else {
          const model = format === 'stl' ? engine.loadStlGeometry(buffer) : await engine.load3mfGeometry(buffer, options), geometry = new three.BufferGeometry();
          for (const [key, values] of [['position', model.positions], ['normal', model.normals], ['color', model.colors]]) if (values) geometry.setAttribute(key, new three.BufferAttribute(values, 3));
          if (model.indices) geometry.setIndex(new three.BufferAttribute(model.indices, 1));
          object = new three.Mesh(geometry, new three.MeshStandardMaterial({ color: 0x8ab5dc, side: three.DoubleSide, vertexColors: Boolean(model.colors) }));
        }
        object.updateMatrixWorld(true); const full: any[] = [], geometries = new Set<any>(), materials = new Set<any>(), textures = new Set<any>();
        let texturePixelsMatch = true;
        object.traverse((node: any) => {
          if (!node.isMesh) return; const geometry = node.geometry, material = node.material; geometries.add(geometry); materials.add(material);
          let map = null;
          if (material.map) {
            textures.add(material.map); const image = material.map.image, canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
            const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0); const pixels = [...ctx.getImageData(0, 0, image.width, image.height).data];
            texturePixelsMatch &&= JSON.stringify(pixels) === JSON.stringify(texturePixels); map = { width: image.width, height: image.height, pixels, colorSpace: material.map.colorSpace };
          }
          full.push({ matrix: node.matrixWorld.toArray(), index: geometry.index ? [...geometry.index.array] : null,
            attributes: Object.fromEntries(Object.entries(geometry.attributes).map(([key, value]: any) => [key, { itemSize: value.itemSize, normalized: value.normalized, values: [...value.array] }])),
            material: { color: material.color.toArray(), metalness: material.metalness, roughness: material.roughness, side: material.side, vertexColors: material.vertexColors, map } });
        });
        const box = new three.Box3().setFromObject(object), center = box.getCenter(new three.Vector3()), size = box.getSize(new three.Vector3()).length();
        const camera = new three.PerspectiveCamera(45, 1, size / 100, size * 10); camera.position.copy(center).add(new three.Vector3(size, size, size)); camera.lookAt(center);
        const scene = new three.Scene(), light = new three.DirectionalLight(0xffffff, 3); light.position.copy(camera.position);
        scene.add(object, new three.AmbientLight(0xffffff, 1), light); renderer.render(scene, camera);
        const gl = renderer.getContext(), pixels = new Uint8Array(128 * 128 * 4); gl.readPixels(0, 0, 128, 128, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let visible = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] || pixels[i + 1] || pixels[i + 2]) visible++;
        rows.push({ format, name, meshes: full.length, geometryHash: await hash(new TextEncoder().encode(JSON.stringify(full))), pixelHash: await hash(pixels), visible, glError: gl.getError(), textureCount: textures.size, texturePixelsMatch });
        geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); textures.forEach(value => value.dispose());
      }
      renderer.dispose(); return rows;
    }, { format, bytes: [...bytes], texturePixels: [...texture.pixels] });
    for (const row of rows) { expect(row.meshes).toBeGreaterThan(0); expect(row.visible).toBeGreaterThan(500); expect(row.glError).toBe(0); expect(row.geometryHash).toBe(rows[0].geometryHash); expect(row.pixelHash).toBe(rows[0].pixelHash); expect(row.textureCount).toBe(format === 'glb' ? 1 : 0); expect(row.texturePixelsMatch).toBe(true); }
    expect(errors).toEqual([]); console.log('3D cancellation content:', JSON.stringify(rows));
  });
}
