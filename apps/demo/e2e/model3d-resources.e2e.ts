import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createGltfSidecarFixture } from '../../../packages/model3d/test/fixtures/gltf.mjs';

async function prepare(page: Page) {
  await page.route('**/model3d-resources-check', route => {
    const base = new URL('.', route.request().url());
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><script type="importmap">${JSON.stringify({ imports: {
      '@filens/core': new URL('resource-core/index.js', base).href, three: new URL('resource-three/three.module.js', base).href
    } })}</script>` });
  });
  for (const [prefix, directory] of [
    ['resource-model', 'packages/model3d/dist'], ['resource-baseline', 'tmp/continued-review/model3d-resources-baseline/dist'],
    ['resource-core', 'packages/core/dist'], ['resource-three', 'node_modules/three/build']
  ]) await page.route(`**/${prefix}/*`, route => {
    const name = basename(new URL(route.request().url()).pathname);
    return route.fulfill({ contentType: name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript', path: resolve(directory, name) });
  });
  await page.goto('./model3d-resources-check');
  await page.evaluate(async () => {
    const lib = await import(/* @vite-ignore */ new URL('resource-model/index.js', location.href).href);
    const three = await import(/* @vite-ignore */ 'three');
    const state = { lib, three, active: new Set<string>(), created: [] as string[], revoked: [] as string[] };
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); state.active.add(url); state.created.push(url); return url; };
    URL.revokeObjectURL = url => { state.active.delete(url); state.revoked.push(url); revoke(url); };
    (window as any).modelResources = state;
  });
}

test('renders identical textured glTF pixels after releasing binary sidecar URLs', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page);
  const fixture = createGltfSidecarFixture(2);
  const results = await page.evaluate(async ({ json, bytes }) => {
    const state = (window as any).modelResources, { lib, three } = state;
    const baseline = await import(/* @vite-ignore */ new URL('resource-baseline/index.js', location.href).href);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2;
    const ctx = canvas.getContext('2d')!;
    for (const [x, y, color] of [[0, 0, '#ff0000'], [1, 0, '#00ff00'], [0, 1, '#0000ff'], [1, 1, '#ffff00']] as const) {
      ctx.fillStyle = color; ctx.fillRect(x, y, 1, 1);
    }
    const png = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
    const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);
    const gltf = json as any;
    gltf.buffers.push({ uri: 'uv.bin', byteLength: uv.byteLength });
    gltf.bufferViews.push({ buffer: 1, byteOffset: 0, byteLength: uv.byteLength, target: 34962 });
    gltf.accessors.push({ bufferView: 2, componentType: 5126, count: 6, type: 'VEC2' });
    gltf.meshes[0].primitives[0].attributes.TEXCOORD_0 = 2;
    gltf.images = [{ uri: 'color.png' }]; gltf.samplers = [{ magFilter: 9728, minFilter: 9728 }];
    gltf.textures = [{ source: 0, sampler: 0 }]; gltf.extensionsUsed = ['KHR_materials_unlit'];
    gltf.materials[0].extensions = { KHR_materials_unlit: {} };
    gltf.materials[0].pbrMetallicRoughness.baseColorFactor = [1, 1, 1, 1];
    gltf.materials[0].pbrMetallicRoughness.baseColorTexture = { index: 0 };
    const renderer = new three.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true }); renderer.setSize(256, 256); renderer.setClearColor(0);
    const camera = new three.OrthographicCamera(-0.08, 0.08, 0.08, -0.08, 0.01, 2);
    camera.position.set(0.0625, 0.0625, 1); camera.lookAt(0.0625, 0.0625, 0);
    const results = [];
    for (const [engine, library] of [['baseline', baseline], ['current', lib]] as const) {
      const startCreated = state.created.length, startRevoked = state.revoked.length;
      const { object } = await library.loadGltfObjectWithWarnings(JSON.stringify(gltf), {
        resourceResolver: ({ source }: { source: string }) => source === 'terrain.bin' ? new Uint8Array(bytes) : source === 'uv.bin' ? uv : png
      });
      const scene = new three.Scene(); scene.add(object); renderer.render(scene, camera);
      const gl = renderer.getContext(), pixels = new Uint8Array(256 * 256 * 4); gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const counts = [0, 0, 0, 0];
      for (let i = 0; i < pixels.length; i += 4) {
        const [r, g, b] = pixels.subarray(i, i + 3);
        if (r > 200 && g < 30 && b < 30) counts[0]++;
        if (g > 200 && r < 30 && b < 30) counts[1]++;
        if (b > 200 && r < 30 && g < 30) counts[2]++;
        if (r > 200 && g > 200 && b < 30) counts[3]++;
      }
      let vertices = 0, dimensions: number[] = [];
      object.traverse((node: any) => {
        if (!node.isMesh) return;
        vertices += node.geometry.attributes.position.count;
        dimensions = [node.material.map.image.width, node.material.map.image.height];
        node.geometry.dispose(); node.material.map.dispose(); node.material.dispose();
      });
      results.push({ engine, counts, vertices, dimensions, glError: gl.getError(),
        pixelHash: [...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels))].map(v => v.toString(16).padStart(2, '0')).join(''),
        created: state.created.length - startCreated, revoked: state.revoked.length - startRevoked, active: state.active.size });
      for (const url of [...state.active] as string[]) URL.revokeObjectURL(url);
    }
    renderer.dispose(); return results;
  }, { json: fixture.json, bytes: [...fixture.bytes] });
  expect(results[0].pixelHash).toBe(results[1].pixelHash);
  for (const row of results) {
    expect(row.vertices).toBe(6); expect(row.dimensions).toEqual([2, 2]); expect(row.glError).toBe(0);
    for (const count of row.counts) expect(count).toBeGreaterThan(5000);
  }
  expect(results[1]).toMatchObject({ created: 3, revoked: 3, active: 0 }); expect(errors).toEqual([]);
  console.log('glTF render equivalence:', JSON.stringify(results));
});

test('cancels a non-cooperative sidecar resolver and releases resources before it finishes', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page);
  await page.evaluate(() => {
    const state = (window as any).modelResources; state.controller = new AbortController(); state.calls = 0; state.outcome = 'pending';
    const held = new Promise<Blob>(resolve => { state.release = () => resolve(new Blob(['late'])); });
    state.pending = state.lib.loadGltfObjectWithWarnings(JSON.stringify({ asset: { version: '2.0' },
      buffers: [{ uri: 'first.bin', byteLength: 3 }, { uri: 'late.bin', byteLength: 4 }] }), {
      signal: state.controller.signal, resourceResolver: () => ++state.calls === 1 ? new Blob(['abc']) : held
    }).then(() => { state.outcome = 'resolved'; }, (error: Error) => { state.outcome = error.name; });
  });
  try {
    await expect.poll(() => page.evaluate(() => (window as any).modelResources.calls)).toBe(2);
    await page.evaluate(() => (window as any).modelResources.controller.abort());
    await expect.poll(() => page.evaluate(() => (window as any).modelResources.outcome)).toBe('AbortError');
    const result = await page.evaluate(async () => {
      const state = (window as any).modelResources, activeBeforeRelease = state.active.size;
      state.release(); await state.pending; await new Promise(resolve => setTimeout(resolve, 0));
      return { activeBeforeRelease, active: state.active.size, created: state.created.length, revoked: state.revoked.length };
    });
    expect(result).toEqual({ activeBeforeRelease: 0, active: 0, created: 1, revoked: 1 }); expect(errors).toEqual([]);
  } finally { await page.evaluate(() => (window as any).modelResources.release()); }
});

test('recovers after actual STEP WASM download failure and reuses the successful importer', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page);
  let requests = 0;
  await page.route('**/resource-model/*.wasm', async route => {
    requests++;
    // Emscripten retries the failed streaming request using an ArrayBuffer fetch.
    if (requests <= 2) return route.fulfill({ status: 503, contentType: 'text/plain', body: 'temporary outage' });
    return route.fulfill({ contentType: 'application/wasm', path: resolve('packages/model3d/dist/occt-import-js.wasm') });
  });
  const bytes = [...await readFile('packages/model3d/test/fixtures/occt/cube.stp')];
  const first = await page.evaluate(async bytes => {
    const state = (window as any).modelResources; state.bytes = new Uint8Array(bytes).buffer;
    return state.lib.loadStepObject(state.bytes).then(() => 'unexpected success', (error: Error) => String(error));
  }, bytes);
  expect(first).toMatch(/503|abort|failed|fetch/i); expect(requests).toBe(2);
  const result = await page.evaluate(async () => {
    const { lib, bytes } = (window as any).modelResources, counts: number[] = [];
    for (let i = 0; i < 2; i++) {
      const object = await lib.loadStepObject(bytes); let triangles = 0;
      object.traverse((node: any) => {
        if (!node.isMesh) return;
        triangles += node.geometry.index.count / 3; node.geometry.dispose(); node.material.dispose();
      }); counts.push(triangles);
    }
    return counts;
  });
  expect(result).toEqual([12, 12]); expect(requests).toBe(3); expect(errors).toEqual([]);
});

test('disposes a real glTF scene when its texture finishes after cancellation', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); let requested = false;
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2;
    canvas.getContext('2d')!.fillRect(0, 0, 2, 2); return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.route('**/late-texture.png', async route => { requested = true; await gate; await route.fulfill({ contentType: 'image/png', body: Buffer.from(png, 'base64') }); });
  const fixture = createGltfSidecarFixture(1);
  await page.evaluate(({ json, bytes }) => {
    const state = (window as any).modelResources, { three } = state;
    state.disposals = { geometry: 0, material: 0, texture: 0 };
    for (const [key, prototype] of [['geometry', three.BufferGeometry.prototype], ['material', three.Material.prototype], ['texture', three.Texture.prototype]]) {
      const original = prototype.dispose;
      prototype.dispose = function () { state.disposals[key]++; return original.call(this); };
    }
    const gltf = json as any;
    gltf.images = [{ uri: 'late-texture.png' }]; gltf.textures = [{ source: 0 }];
    gltf.materials[0].pbrMetallicRoughness.baseColorTexture = { index: 0 };
    state.controller = new AbortController(); state.outcome = 'pending';
    state.pending = state.lib.loadGltfObjectWithWarnings(JSON.stringify(gltf), {
      signal: state.controller.signal, resourceResolver: ({ source }: { source: string }) => source === 'terrain.bin'
        ? new Uint8Array(bytes) : new URL('late-texture.png', location.href).href
    }).then(() => { state.outcome = 'resolved'; }, (error: Error) => { state.outcome = error.name; });
  }, { json: fixture.json, bytes: [...fixture.bytes] });
  try {
    await expect.poll(() => requested).toBe(true);
    await page.evaluate(() => (window as any).modelResources.controller.abort());
    await expect.poll(() => page.evaluate(() => (window as any).modelResources.outcome)).toBe('AbortError');
    expect(await page.evaluate(() => (window as any).modelResources.active.size)).toBe(0);
    release();
    await expect.poll(() => page.evaluate(() => (window as any).modelResources.disposals)).toEqual({ geometry: 1, material: 1, texture: 1 });
    expect(errors).toEqual([]);
  } finally { release(); }
});
