// Same-project OBJ texture load comparison; no peer/SOTA ranking.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createObjMaterialFixture, createObjTexture } from '../packages/model3d/test/fixtures/obj.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const iterations = Number(option('--iterations', '7')); assert(Number.isSafeInteger(iterations) && iterations > 0);
const baseline = option('--baseline', 'tmp/continued-review/obj-resources-baseline/dist/index.js');
assert(!path.isAbsolute(baseline) && !baseline.split(/[\\/]/).includes('..'));
const out = path.resolve(root, option('--output', 'tmp/continued-review/obj-resources-final')); fs.mkdirSync(out, { recursive: true });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const modules = { baseline, current: 'packages/model3d/dist/index.js' }, fixture = createObjMaterialFixture();
const samples = [128, 1024, 2048].map(side => ({ name: `generated-${side}-texture.obj`, ...createObjTexture(side) }));
const result = { engineering: true, scopedSota: false, date: new Date().toISOString(), iterations, cpu: os.cpus()[0].model,
  method: 'Fresh Chromium contexts, alternating build order. Imports, UTF-8 MTL bytes and PNG bytes ready before timing. loadMs includes native resource resolution/normalization, real MTL/OBJ parsing and explicit HTMLImageElement.decode() for every referenced texture. The same TextureLoader observer waits for image completion in both versions, since the baseline API returns early. Excludes input/network/module loading, renderer/GPU/paint and peak memory. Full geometry/UV/normal arrays, decoded texture pixels, materials and warnings checked after timing. Generated opaque noise textures; no unused padding or unused materials. Baselines at or below 10 ms receive no ratio. Same-project engineering comparison, no peer/SOTA ranking.',
  artifacts: [...Object.entries(modules).map(([engine, file]) => ({ engine, path: file, sha256: hash(fs.readFileSync(path.join(root, file))) })),
    ...['packages/core/dist/index.js', 'node_modules/three/build/three.module.js', 'node_modules/three/build/three.core.js',
      'packages/model3d/test/fixtures/obj.mjs', 'scripts/benchmark-obj-resources.mjs'].map(file => ({ path: file, sha256: hash(fs.readFileSync(path.join(root, file))) }))],
  fixture: { ...fixture, materialSha256: hash(fixture.material), sourceSha256: hash(fixture.source) },
  samples: samples.map(({ name, side, png, pixels }) => ({ name, side, bytes: png.length, pngSha256: hash(png), pixelsSha256: hash(pixels) })), runs: [] };
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store'); const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (name === '/') { res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><script type="importmap">${JSON.stringify({ imports: {
    '@filens/core': '/repo/packages/core/dist/index.js', three: '/repo/node_modules/three/build/three.module.js'
  } })}</script>`); return; }
  const sample = samples.find(sample => name === '/' + sample.name + '.png');
  if (sample) { res.setHeader('Content-Type', 'image/png'); res.end(sample.png); return; }
  const file = path.resolve(root, name.startsWith('/repo/') ? name.slice(6) : 'missing');
  if (!file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
  try { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(file)); } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true }); result.browser = browser.version();
try {
  for (const sample of samples) for (let iteration = 0; iteration < iterations; iteration++) for (const engine of iteration % 2 ? ['baseline', 'current'] : ['current', 'baseline']) {
    const context = await browser.newContext(), page = await context.newPage();
    const run = { sample: sample.name, engine, iteration, errors: [] }; page.on('pageerror', error => run.errors.push(error.message));
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.evaluate(async ({ module, sample, fixture }) => {
        const [lib, three, png] = await Promise.all([import('/repo/' + module), import('three'), fetch('/' + sample + '.png').then(r => r.arrayBuffer())]);
        window.objBenchmark = { lib, three, png, fixture, material: new TextEncoder().encode(fixture.material) };
      }, { module: modules[engine], sample: sample.name, fixture });
      Object.assign(run, await page.evaluate(async () => {
        const { lib, three, png, fixture, material } = window.objBenchmark;
        const active = new Set(), created = [], revoked = [], imageLoads = [];
        const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = blob => { const url = create(blob); active.add(url); created.push(url); return url; };
        URL.revokeObjectURL = url => { active.delete(url); revoked.push(url); revoke(url); };
        const load = three.TextureLoader.prototype.load;
        three.TextureLoader.prototype.load = function (url, onLoad, onProgress, onError) {
          let yes, no; imageLoads.push(new Promise((resolve, reject) => { yes = resolve; no = reject; }));
          return load.call(this, url, texture => { onLoad?.(texture); texture.image.decode().then(yes, no); }, onProgress, error => { onError?.(error); no(new Error('Image decode failed')); });
        };
        let resolverCalls = 0;
        const start = performance.now();
        const { object, warnings } = await lib.loadObjObjectWithWarnings(fixture.source, {
          resourceBasePath: 'models/scene.obj', resourceResolver: ({ relation }) => { resolverCalls++; return relation === 'material' ? material : new Uint8Array(png); }
        });
        await Promise.all(imageLoads); const loadMs = performance.now() - start;
        three.TextureLoader.prototype.load = load;
        const mesh = object.children[0], geometry = mesh.geometry, mat = mesh.material, image = mat.map.image;
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0);
        const sha = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
        const content = { positions: [...geometry.attributes.position.array], normals: [...geometry.attributes.normal.array], uv: [...geometry.attributes.uv.array],
          meshes: object.children.length, dimensions: [image.width, image.height], pixelsSha256: await sha(ctx.getImageData(0, 0, image.width, image.height).data),
          material: { name: mat.name, color: mat.color.toArray(), repeat: mat.map.repeat.toArray(), offset: mat.map.offset.toArray(), colorSpace: mat.map.colorSpace,
            side: mat.side, opacity: mat.opacity, shininess: mat.shininess }, warnings };
        geometry.dispose(); mat.map.dispose(); mat.dispose();
        return { loadMs, resolverCalls, imageLoads: imageLoads.length, ...content, createdUrls: created.length, revokedUrls: revoked.length, activeOwnedUrls: active.size };
      }));
    } catch (error) { run.failure = String(error); }
    result.runs.push(run); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(run));
    await context.close();
  }
} finally { await browser.close(); server.close(); }
