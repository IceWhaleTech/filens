import { basename, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createLDrawPartsFixture, createLDrawSmoothingFixture, ldrawReference } from '../../../packages/model3d/test/fixtures/ldraw.mjs';

async function prepare(page: Page) {
  await page.route('**/ldraw-resources-check', route => {
    const base = new URL('.', route.request().url());
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><script type="importmap">${JSON.stringify({ imports: {
      '@filens/core': new URL('ldraw-core/index.js', base).href, three: new URL('ldraw-three/three.module.js', base).href
    } })}</script>` });
  });
  for (const [prefix, directory] of [['ldraw-model', 'packages/model3d/dist'], ['ldraw-baseline', 'tmp/continued-review/ldraw-resources-baseline/dist'],
    ['ldraw-core', 'packages/core/dist'], ['ldraw-three', 'node_modules/three/build']]) {
    await page.route(`**/${prefix}/*`, route => route.fulfill({ contentType: 'text/javascript', path: resolve(directory, basename(new URL(route.request().url()).pathname)) }));
  }
  await page.goto('./ldraw-resources-check');
  await page.evaluate(async () => {
    const state = { lib: await import(/* @vite-ignore */ new URL('ldraw-model/index.js', location.href).href),
      three: await import(/* @vite-ignore */ 'three'), created: [] as string[], revoked: [] as string[] };
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); state.created.push(url); return url; };
    URL.revokeObjectURL = url => { state.revoked.push(url); revoke(url); };
    (window as any).ldrawCheck = state;
  });
}

test('renders native nested LDraw parts identically to the original packed MPD', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page);
  const rows = await page.evaluate(async fixture => {
    const state = (window as any).ldrawCheck, { lib, three } = state;
    const original = await import(/* @vite-ignore */ new URL('ldraw-baseline/index.js', location.href).href);
    const renderer = new three.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true }); renderer.setSize(384, 128); renderer.setClearColor(0);
    const camera = new three.OrthographicCamera(8, 40, 10, 0, 0.1, 100); camera.position.set(0, 0, 10);
    const scene = new three.Scene(); scene.add(new three.AmbientLight(0xffffff, 3));
    const rows = [];
    for (const kind of ['original-packed', 'current-packed', 'view', 'buffer', 'blob', 'base64', 'percent']) {
      const calls: string[] = [], start = state.created.length;
      const convert = (text: string) => {
        const bytes = new TextEncoder().encode(text), padded = new Uint8Array(bytes.length + 4); padded.set(bytes, 2);
        return kind === 'view' ? new DataView(padded.buffer, 2, bytes.length) : kind === 'buffer' ? padded.buffer.slice(2, -2)
          : kind === 'blob' ? new Blob([bytes]) : kind === 'base64' ? `data:text/plain;base64,${btoa(String.fromCharCode(...bytes))}` : `data:text/plain,${encodeURIComponent(text)}`;
      };
      const library = kind === 'original-packed' ? original : lib;
      const { object, warnings } = await library.loadLDrawObjectWithWarnings(kind.endsWith('-packed') ? fixture.packed : fixture.source, {
        resourceBasePath: 'models/main.ldr', resourceResolver: kind === 'original-packed' ? undefined : async ({ source }: any) => {
          calls.push(source);
          if (source === 'models/parts/box.dat') return convert(fixture.part);
          if (source === 'models/parts/s/face.dat') return convert(fixture.face);
          throw new Error('Unexpected resource: ' + source);
        }
      });
      object.updateMatrixWorld(true);
      const positions: number[] = [], normals: number[] = [], colors: string[] = [], names: string[] = [];
      let meshes = 0, lines = 0, conditionalLines = 0;
      object.traverse((node: any) => {
        if (node.name) names.push(node.name);
        if (node.isLineSegments) { lines++; if (node.isConditionalLine) conditionalLines++; }
        if (!node.isMesh) return;
        meshes++; colors.push(node.material.color.getHexString());
        const data = node.geometry.attributes.position, normal = node.geometry.attributes.normal;
        for (let i = 0; i < data.count; i++) {
          positions.push(...new three.Vector3().fromBufferAttribute(data, i).applyMatrix4(node.matrixWorld).toArray());
          normals.push(...new three.Vector3().fromBufferAttribute(normal, i).transformDirection(node.matrixWorld).toArray());
        }
      });
      scene.add(object); renderer.render(scene, camera); scene.remove(object);
      const gl = renderer.getContext(), pixels = new Uint8Array(384 * 128 * 4); gl.readPixels(0, 0, 384, 128, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let redPixels = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 200 && pixels[i + 1] < 30 && pixels[i + 2] < 30) redPixels++;
      rows.push({ kind, calls, meshes, lines, conditionalLines, colors, names, warnings,
        positionsMatch: JSON.stringify(positions) === JSON.stringify(fixture.expectedPositions), normalsMatch: JSON.stringify(normals) === JSON.stringify(fixture.expectedNormals),
        pixelHash: [...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels))].map(v => v.toString(16).padStart(2, '0')).join(''), redPixels,
        glError: gl.getError(), createdUrls: state.created.length - start });
      const geometries = new Set<any>(), materials = new Set<any>();
      object.traverse((node: any) => { if (node.geometry) geometries.add(node.geometry); for (const mat of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) materials.add(mat); });
      for (const value of geometries) value.dispose(); for (const value of materials) value.dispose();
    }
    renderer.dispose(); return rows;
  }, createLDrawPartsFixture());
  for (const row of rows) {
    expect(row).toMatchObject({ meshes: 2, lines: 4, conditionalLines: 2, colors: ['ff0000', 'ff0000'], warnings: [], positionsMatch: true, normalsMatch: true, glError: 0, createdUrls: 0 });
    expect(row.pixelHash).toBe(rows[0].pixelHash); expect(row.redPixels).toBeGreaterThan(3000);
    expect(row.names).toEqual(['parts/box.dat', 'parts/box.dat']);
    expect(row.calls).toEqual(row.kind.endsWith('-packed') ? [] : ['models/parts/box.dat', 'models/parts/s/face.dat']);
  }
  expect(errors).toEqual([]); console.log('LDraw native render checks:', JSON.stringify(rows));
});

test('preserves smooth and hard-edge LDraw shading pixel for pixel', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page);
  const results = await page.evaluate(async fixtures => {
    const { lib, three } = (window as any).ldrawCheck;
    const original = await import(/* @vite-ignore */ new URL('ldraw-baseline/index.js', location.href).href);
    const renderer = new three.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true }); renderer.setSize(192, 192); renderer.setClearColor(0);
    const camera = new three.OrthographicCamera(-3, 3, 3, -3, 0.1, 100); camera.position.set(7, 6, 9); camera.lookAt(2, 2, 0.5);
    const scene = new three.Scene(); scene.add(new three.AmbientLight(0xffffff, 0.3));
    const light = new three.DirectionalLight(0xffffff, 2); light.position.set(-3, 5, 6); scene.add(light);
    const sha = async (bytes: any) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
    const results = [];
    for (const fixture of fixtures) for (const [engine, library] of [['original', original], ['current', lib]] as const) {
      const { object } = await library.loadLDrawObjectWithWarnings(fixture.source); scene.add(object); renderer.render(scene, camera); scene.remove(object);
      const gl = renderer.getContext(), pixels = new Uint8Array(192 * 192 * 4); gl.readPixels(0, 0, 192, 192, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const normalHashes: string[] = []; let visible = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] || pixels[i + 1] || pixels[i + 2]) visible++;
      const nodes: any[] = []; object.traverse((node: any) => { if (node.geometry) nodes.push(node); });
      for (const node of nodes) {
        if (node.geometry.attributes.normal) normalHashes.push(await sha(node.geometry.attributes.normal.array));
        node.geometry.dispose(); for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.dispose();
      }
      results.push({ mode: fixture.mode, engine, pixelHash: await sha(pixels), normalHashes, visible, glError: gl.getError() });
    }
    renderer.dispose(); return results;
  }, ['curved', 'hard', 'multicolor'].map(mode => ({ mode, source: createLDrawSmoothingFixture(mode) })));
  for (let i = 0; i < results.length; i += 2) {
    expect(results[i + 1].pixelHash).toBe(results[i].pixelHash); expect(results[i + 1].normalHashes).toEqual(results[i].normalHashes);
    expect(results[i].visible).toBeGreaterThan(1000); expect(results[i].glError).toBe(0); expect(results[i + 1].glError).toBe(0);
  }
  expect(errors).toEqual([]); console.log('LDraw shading checks:', JSON.stringify(results));
});

test('settles a replaced LDraw load before a non-cooperative nested Blob returns', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page);
  await page.evaluate(fixture => {
    const state = (window as any).ldrawCheck; state.calls = 0; state.done = false; state.rendered = 0;
    const held = new Promise<ArrayBuffer>((resolve, reject) => { state.release = () => reject(new Error('late part failure')); });
    const blob = new Blob(); Object.defineProperty(blob, 'arrayBuffer', { value: () => { state.read = true; return held; } });
    const host = document.createElement('div'); host.style.cssText = 'width:640px;height:480px'; document.body.append(host); state.host = host;
    state.session = state.lib.createModel3dPreviewDriver().createSession(host, { resourceResolver: () => ++state.calls === 1 ? new TextEncoder().encode(fixture.part) : blob });
    state.session.on('rendered', () => state.rendered++);
    const bytes = new TextEncoder().encode(fixture.source);
    state.pending = state.session.load(bytes, { descriptor: { source: bytes, name: 'old.ldr', extension: 'ldr' } }).then(() => { state.done = true; });
  }, createLDrawPartsFixture());
  try {
    await expect.poll(() => page.evaluate(() => !!(window as any).ldrawCheck.read)).toBe(true);
    await page.evaluate(async fixture => {
      const state = (window as any).ldrawCheck, bytes = new TextEncoder().encode(fixture.packed);
      await state.session.load(bytes, { descriptor: { source: bytes, name: 'current.mpd', extension: 'mpd' } });
    }, createLDrawPartsFixture());
    await expect.poll(() => page.evaluate(() => (window as any).ldrawCheck.done)).toBe(true);
    const result = await page.evaluate(async () => {
      const state = (window as any).ldrawCheck, snapshot = state.session.getState(); state.release(); await state.pending;
      await new Promise(resolve => setTimeout(resolve, 0));
      const result = { title: snapshot.title, triangles: snapshot.metadata.triangleCount, rendered: state.rendered, calls: state.calls,
        canvases: state.host.querySelectorAll('canvas').length, created: state.created.length, error: snapshot.error };
      state.session.destroy(); return { ...result, empty: !state.host.childElementCount };
    });
    expect(result).toEqual({ title: 'current.mpd', triangles: 4, rendered: 1, calls: 2, canvases: 1, created: 0, error: null, empty: true }); expect(errors).toEqual([]);
  } finally { await page.evaluate(() => (window as any).ldrawCheck.release()); }
});

test('rejects cyclic LDraw dependencies and can open a valid model afterward', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page);
  const result = await page.evaluate(async ({ cycle, valid }) => {
    const state = (window as any).ldrawCheck;
    const error = await state.lib.loadLDrawObjectWithWarnings(cycle).then(() => 'unexpected success', (error: Error) => error.message);
    const { object } = await state.lib.loadLDrawObjectWithWarnings(valid);
    let vertices = 0; object.traverse((node: any) => { if (node.isMesh) vertices += node.geometry.attributes.position.count; });
    return { error, vertices };
  }, { cycle: '0 FILE main.ldr\n' + ldrawReference('a.dat') + '0 FILE a.dat\n' + ldrawReference('main.ldr'), valid: createLDrawPartsFixture().packed });
  expect(result.error).toMatch(/cyclic/i); expect(result.vertices).toBe(12); expect(errors).toEqual([]);
});

test('opens an LDraw assembly with nested local parts through the demo upload flow', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await page.goto('./?view=preview');
  const fixture = createLDrawPartsFixture();
  await page.locator('.wb-upload input[type=file]').setInputFiles([
    { name: 'main.ldr', mimeType: 'model/vnd.ldraw', buffer: Buffer.from(fixture.source) },
    { name: 'box.dat', mimeType: 'text/plain', buffer: Buffer.from(fixture.part) },
    { name: 'face.dat', mimeType: 'text/plain', buffer: Buffer.from(fixture.face) }
  ]);
  await expect(page.locator('.wb-preview-title strong')).toHaveText('main.ldr');
  await expect(page.locator('canvas.model3dv-canvas')).toBeVisible(); await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
  const pixels = await page.locator('canvas.model3dv-canvas').evaluate((canvas: HTMLCanvasElement) => {
    const gl = canvas.getContext('webgl2')!, pixels = new Uint8Array(canvas.width * canvas.height * 4); gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let red = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 100 && pixels[i] > pixels[i + 1] * 2 && pixels[i] > pixels[i + 2] * 2) red++;
    return { red, error: gl.getError() };
  });
  expect(pixels.red).toBeGreaterThan(100); expect(pixels.error).toBe(0); expect(errors).toEqual([]);
});
