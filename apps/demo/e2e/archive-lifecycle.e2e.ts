import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { createArchiveBitmap, createArchiveFixture, createArchiveTexturedGltf, createArchiveWav } from '../../../packages/archive/test/fixtures/lifecycle.mjs';

let archivedBaseline: Promise<any> | undefined;
async function baselineRuntime(name: string): Promise<Buffer> {
  archivedBaseline ??= readFile('benchmarks/frontend/2026-10-24/archive-lifecycle-diagnostic.json.gz')
    .then(bytes => JSON.parse(gunzipSync(bytes).toString('utf8'))).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  const archive = await archivedBaseline;
  if (!archive) return readFile(resolve('tmp/continued-review/archive-lifecycle-baseline/dist', name));
  const source = archive.baselineRuntimeFiles[`tmp/continued-review/archive-lifecycle-baseline/dist/${name}`];
  if (typeof source !== 'string') throw new Error(`Missing archived baseline module: ${name}`);
  return Buffer.from(source);
}

async function prepare(page: Page, factory = false) {
  await page.route('**/archive-lifecycle-check', route => {
    const base = new URL('.', route.request().url());
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><script type="importmap">${JSON.stringify({ imports: {
      '@filens/core': new URL('archive-core/index.js', base).href, three: new URL('archive-three/three.module.js', base).href
    } })}</script>` });
  });
  for (const [prefix, directory] of [['archive-current', 'packages/archive/dist'], ['archive-original', 'tmp/continued-review/archive-lifecycle-baseline/dist'],
    ['archive-core', 'packages/core/dist'], ['archive-model', 'packages/model3d/dist'], ['archive-three', 'node_modules/three/build']]) {
    await page.route(`**/${prefix}/*`, async route => {
      const name = basename(new URL(route.request().url()).pathname), contentType = name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript';
      return prefix === 'archive-original' ? route.fulfill({ contentType, body: await baselineRuntime(name) }) : route.fulfill({ contentType, path: resolve(directory, name) });
    });
  }
  await page.goto('./archive-lifecycle-check');
  await page.evaluate(async factory => {
    const lib = await import(/* @vite-ignore */ new URL('archive-current/index.js', location.href).href), core = await import(/* @vite-ignore */ '@filens/core');
    const model = factory ? await import(/* @vite-ignore */ new URL('archive-model/index.js', location.href).href) : null;
    const host = document.createElement('div'); host.style.cssText = 'width:640px;height:480px'; document.body.append(host);
    const state = { lib, core, host, active: new Set<string>(), created: 0, revoked: 0, errors: [] as string[], rendered: 0, done: false, error: '', controller: new AbortController() } as any;
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); state.active.add(url); state.created++; return url; };
    URL.revokeObjectURL = url => { state.active.delete(url); state.revoked++; revoke(url); };
    const childFactory = factory ? (element: HTMLElement, options: any) => core.createPreviewer(element, {
      drivers: [...core.createDefaultPreviewDrivers(), model.createModel3dPreviewDriver(), lib.createArchivePreviewDriver()],
      routes: lib.createArchivePreviewRoutes(model.createModel3dPreviewRoutes()), ...options
    }) : undefined;
    state.session = lib.createArchivePreviewDriver().createSession(host, { previewerFactory: childFactory });
    state.session.on('error', (error: Error) => state.errors.push(error.message)); state.session.on('rendered', () => state.rendered++);
    (window as any).archiveCheck = state;
  }, factory);
}

async function load(page: Page, bytes: Uint8Array, name = 'bundle.zip') {
  await page.evaluate(async ({ bytes, name }) => {
    const state = (window as any).archiveCheck, source = new Uint8Array(bytes);
    await state.session.load(source, { descriptor: { source, name, extension: name.split('.').pop() }, signal: state.controller.signal });
  }, { bytes: [...bytes], name });
}

for (const action of ['replace', 'destroy', 'abort'] as const) {
  test(`cancels a held archive Blob before ${action} releases its bytes`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page);
    await page.evaluate(() => {
      const state = (window as any).archiveCheck, source = new Blob();
      Object.defineProperty(source, 'arrayBuffer', { value: () => new Promise(resolve => { state.release = resolve; }) });
      state.pending = state.session.load(source, { descriptor: { source, name: 'old.zip', extension: 'zip' }, signal: state.controller.signal })
        .then(() => { state.done = true; }, (error: Error) => { state.done = true; state.error = error.name; });
    });
    try {
      if (action === 'replace') await load(page, await createArchiveFixture({ 'current.txt': 'current' }), 'current.zip');
      else await page.evaluate(action => { const state = (window as any).archiveCheck; action === 'destroy' ? state.session.destroy() : state.controller.abort(); }, action);
      await expect.poll(() => page.evaluate(() => (window as any).archiveCheck.done)).toBe(true);
      expect(await page.evaluate(() => (window as any).archiveCheck.error)).toBe(action === 'abort' ? 'AbortError' : '');
    } finally {
      const old = await createArchiveFixture({ 'old.txt': 'old' }); await page.evaluate(async bytes => { const state = (window as any).archiveCheck; state.release(new Uint8Array(bytes).buffer); await state.pending; }, [...old]);
    }
    const final = await page.evaluate(() => { const s = (window as any).archiveCheck; return { state: s.session.getState(), errors: s.errors, rendered: s.rendered }; });
    expect(final).toMatchObject({ state: { loading: false, error: null }, errors: [], rendered: action === 'replace' ? 1 : 0 });
    if (action === 'replace') expect(final.state).toMatchObject({ title: 'current.zip', entries: [{ name: 'current.txt' }] }); else expect(final.state.entries).toEqual([]);
    expect(errors).toEqual([]);
  });
}

for (const action of ['back', 'directory', 'second'] as const) {
  test(`discards a held archive entry after ${action} without restoring its content`, async ({ page }) => {
    await prepare(page); await load(page, await createArchiveFixture({ 'old.txt': 'obsolete', 'next.txt': 'next', 'docs/readme.txt': 'docs' }));
    await page.evaluate(() => {
      const state = (window as any).archiveCheck, entry = state.session.archiveStack[0].entries.find((entry: any) => entry.name === 'old.txt');
      entry.read = () => new Promise(resolve => { state.release = resolve; });
      state.pending = state.session.openEntryPreview('old.txt').then(() => { state.done = true; });
    });
    try {
      if (action === 'back') await page.getByRole('button', { name: 'Back to archive', exact: true }).click();
      else if (action === 'directory') await page.locator('tr.archivev-row').filter({ hasText: 'docs/' }).click();
      else await page.locator('tr.archivev-row').filter({ hasText: 'next.txt' }).click();
      await expect.poll(() => page.evaluate(() => (window as any).archiveCheck.done)).toBe(true);
    } finally { await page.evaluate(async () => { const state = (window as any).archiveCheck; state.release(new TextEncoder().encode('obsolete')); await state.pending; }); }
    await expect(page.locator('.archivev-preview')).not.toContainText('obsolete');
    if (action === 'second') await expect(page.locator('.archivev-entry-text')).toHaveText('next');
    if (action === 'directory') expect(await page.evaluate(() => (window as any).archiveCheck.session.getState().route)).toBe('/docs/');
    expect(await page.evaluate(() => (window as any).archiveCheck.errors)).toEqual([]);
  });
}

test('plays a real WAV inside ZIP and releases its URL and player when returning', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page);
  await load(page, await createArchiveFixture({ 'tone.wav': createArchiveWav(), 'readme.txt': 'Readme' }));
  await page.locator('tr.archivev-row').filter({ hasText: 'tone.wav' }).click();
  await expect(page.locator('audio.archivev-entry-media')).toBeVisible();
  await expect.poll(() => page.locator('audio').evaluate((element: HTMLAudioElement) => element.readyState)).toBeGreaterThanOrEqual(2);
  const audio = await page.locator('audio').evaluate((element: HTMLAudioElement) => { (window as any).archiveCheck.oldMedia = element; return { duration: element.duration, error: element.error?.message ?? null }; });
  expect(audio.duration).toBeCloseTo(0.1, 3); expect(audio.error).toBeNull();
  await page.getByRole('button', { name: 'Back to archive', exact: true }).click();
  expect(await page.evaluate(() => { const s = (window as any).archiveCheck; return { active: s.active.size, created: s.created, revoked: s.revoked, detached: !s.oldMedia.isConnected, source: s.oldMedia.getAttribute('src'), paused: s.oldMedia.paused }; }))
    .toEqual({ active: 0, created: 1, revoked: 1, detached: true, source: null, paused: true });
  expect(errors).toEqual([]);
});

test('decodes exact BMP pixels inside ZIP and releases the image when cancelled', async ({ page }) => {
  await prepare(page); const image = createArchiveBitmap(); await load(page, await createArchiveFixture({ 'color.bmp': image.bytes }));
  await page.locator('tr.archivev-row').click();
  const result = await page.locator('img.archivev-entry-image').evaluate(async (element: HTMLImageElement) => {
    await element.decode(); const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2; const ctx = canvas.getContext('2d')!; ctx.drawImage(element, 0, 0);
    return { size: [element.naturalWidth, element.naturalHeight], pixels: [...ctx.getImageData(0, 0, 2, 2).data] };
  });
  expect(result).toEqual({ size: [2, 2], pixels: image.pixels });
  await page.evaluate(() => (window as any).archiveCheck.controller.abort());
  await expect(page.locator('.archivev-preview')).toBeEmpty(); expect(await page.evaluate(() => (window as any).archiveCheck.active.size)).toBe(0);
});

test('previews a real glTF entry with a parent-relative encoded texture through the shared runtime', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page, true);
  const model = createArchiveTexturedGltf(), image = createArchiveBitmap();
  await load(page, await createArchiveFixture({ 'models/scene.gltf': model.json, 'textures/色 图.bmp': image.bytes, 'readme.txt': 'Readme' }));
  await page.locator('tr.archivev-row').filter({ hasText: 'models/' }).click(); await page.locator('tr.archivev-row').filter({ hasText: 'scene.gltf' }).click();
  await expect(page.locator('canvas.model3dv-canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).archiveCheck.session.getState().loading)).toBe(false);
  const result = await page.evaluate(() => {
    const state = (window as any).archiveCheck, child = state.session.entryPreviewer, model = child.activeSession;
    const meshes: any[] = []; model.modelGroup.traverse((node: any) => { if (node.isMesh) meshes.push(node); });
    const mesh = meshes[0], image = mesh.material.map.image, canvas = document.createElement('canvas'); canvas.width = canvas.height = 2;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
    return { state: child.getState(), positions: [...mesh.geometry.attributes.position.array], uv: [...mesh.geometry.attributes.uv.array], pixels: [...ctx.getImageData(0, 0, 2, 2).data],
      glError: model.renderer.getContext().getError(), errors: state.errors, active: state.active.size };
  });
  expect(result).toMatchObject({ state: { family: 'model3d', error: null, warnings: [], metadata: { triangleCount: 1 } }, positions: model.positions, uv: model.uv, pixels: image.pixels, glError: 0, errors: [], active: 0 });
  await page.getByRole('button', { name: 'Back to archive', exact: true }).click(); await expect(page.locator('canvas')).toHaveCount(0); await expect(page.locator('.archivev-table')).toContainText('scene.gltf');
  expect(errors).toEqual([]);
});

test('browses real nested ZIP and TGZ entries and returns to their parent', async ({ page }) => {
  await prepare(page); const tar = await readFile('packages/archive/test/fixtures/pax-long-path.tar');
  const inner = await createArchiveFixture({ 'inside.txt': 'Nested archive' }), outer = await createArchiveFixture({ 'archives/inner.zip': inner, 'archives/inner.tgz': gzipSync(tar) });
  await load(page, outer); await page.locator('tr.archivev-row').filter({ hasText: 'archives/' }).click();
  await page.locator('tr.archivev-row').filter({ hasText: 'inner.zip' }).click(); await expect(page.locator('.archivev-table')).toContainText('inside.txt');
  await page.locator('tr.archivev-row').filter({ hasText: 'inside.txt' }).click(); await expect(page.locator('.archivev-entry-text')).toHaveText('Nested archive');
  await page.getByRole('button', { name: 'Back to archive', exact: true }).click(); await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.locator('tr.archivev-row').filter({ hasText: 'archives/' }).click(); await page.locator('tr.archivev-row').filter({ hasText: 'inner.tgz' }).click();
  await expect(page.locator('.archivev-table')).toContainText('目录/'); await page.locator('tr.archivev-row').filter({ hasText: '目录/' }).click(); await page.locator('tr.archivev-row').click();
  await expect(page.locator('.archivev-entry-text')).toHaveText('Long path preview: 中文内容\n'); expect(await page.evaluate(() => (window as any).archiveCheck.errors)).toEqual([]);
});

test('preserves all ZIP, TAR, TGZ and GZIP file bytes and metadata from the original build', async ({ page }) => {
  await prepare(page); const tar = await readFile('packages/archive/test/fixtures/gnu-long-path.tar');
  const inputs = [{ name: 'bundle.zip', bytes: await createArchiveFixture({ 'docs/a.txt': 'Alpha', 'empty.txt': '', '中文/b.txt': '乙' }) },
    { name: 'bundle.tar', bytes: tar }, { name: 'bundle.tgz', bytes: gzipSync(tar) }, { name: 'note.txt.gz', bytes: gzipSync(Buffer.from('Single gzip file\n')) }];
  const rows = await page.evaluate(async inputs => {
    const { lib } = (window as any).archiveCheck, original = await import(/* @vite-ignore */ new URL('archive-original/index.js', location.href).href), rows = [];
    const sha = async (data: any) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(v => v.toString(16).padStart(2, '0')).join('');
    for (const { name, bytes } of inputs) for (const [engine, library] of [['original', original], ['current', lib]] as const) {
      const source = new Uint8Array(bytes), index = await library.createArchiveResourceIndex(source, { descriptor: { source, name, extension: name.split('.').pop() } });
      const full = []; for (const entry of index.files) full.push({ name: entry.name, size: entry.size, modified: entry.modified, bytes: [...new Uint8Array(await entry.readAsArrayBuffer())] });
      rows.push({ name, engine, files: full.length, completeHash: await sha(new TextEncoder().encode(JSON.stringify(full))) });
    }
    return rows;
  }, inputs.map(input => ({ name: input.name, bytes: [...input.bytes] })));
  for (let i = 0; i < rows.length; i += 2) { expect(rows[i].files).toBeGreaterThan(0); expect(rows[i + 1]).toEqual({ ...rows[i], engine: 'current' }); }
  console.log('Archive complete content:', JSON.stringify(rows));
});

test('opens a TAR upload and browses its text entry through the demo', async ({ page }) => {
  await page.goto('./?view=preview'); await page.locator('input[type=file]').setInputFiles({ name: 'long-path.tar', mimeType: 'application/x-tar', buffer: await readFile('packages/archive/test/fixtures/pax-long-path.tar') });
  await expect(page.locator('.archivev-table')).toContainText('next.txt'); await page.locator('tr.archivev-row').filter({ hasText: 'next.txt' }).click();
  await expect(page.locator('.pptxv-native-text')).toHaveText('Next entry\n'); await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
});
