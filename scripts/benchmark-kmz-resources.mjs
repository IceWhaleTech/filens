// Same-project KMZ archive preparation and complete textured model loading.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createKmzFixture } from '../packages/model3d/test/fixtures/kmz.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const iterations = Number(option('--iterations', '7')); assert(Number.isSafeInteger(iterations) && iterations > 0);
const baseline = option('--baseline', 'tmp/continued-review/kmz-resources-baseline/dist/index.js');
assert(!path.isAbsolute(baseline) && !baseline.split(/[\\/]/).includes('..'));
const out = path.resolve(root, option('--output', 'tmp/continued-review/kmz-resources-final')); fs.mkdirSync(out, { recursive: true });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const modules = { baseline, current: 'packages/model3d/dist/index.js' };
const samples = await Promise.all([0, 8, 32].map(async unused => ({ name: `generated-${unused}-unused-images.kmz`, ...await createKmzFixture({ unused, unusedSide: 1024 }) })));
const result = { engineering: true, scopedSota: false, date: new Date().toISOString(), iterations, cpu: os.cpus()[0].model,
  method: 'Fresh Chromium contexts, alternating build order. Imports and complete generated KMZ bytes ready before timing. Baseline uses the exported synchronous KMZLoader path, exactly the original async preview fast path for these valid root-doc.kml inputs; current uses the selective asynchronous preview API. Both explicitly wait for every image decode through the same TextureLoader observer. loadMs includes ZIP inspection/decompression, KML/DAE parsing, complete geometry/material construction and referenced texture decoding. Inputs contain one used 8x8 texture and 0/8/32 valid unreferenced 1024x1024 PNG noise images. These unused files deliberately exercise selective archive extraction, not representative model complexity or texture compression. Excludes input/network/module transfer, renderer/GPU/paint and peak memory. Complete attributes, materials and decoded pixels checked after timing; original leaked URLs cleaned only after checks. Baselines at or below 10 ms receive no ratio. No peer/SOTA ranking.',
  artifacts: [...Object.entries(modules).map(([engine, file]) => ({ engine, path: file, sha256: hash(fs.readFileSync(path.join(root, file))) })),
    ...['packages/core/dist/index.js', 'node_modules/three/build/three.module.js', 'node_modules/three/build/three.core.js',
      'packages/model3d/test/fixtures/kmz.mjs', 'packages/model3d/test/fixtures/obj.mjs', 'scripts/benchmark-kmz-resources.mjs'].map(file => ({ path: file, sha256: hash(fs.readFileSync(path.join(root, file))) }))],
  samples: samples.map(sample => ({ name: sample.name, bytes: sample.bytes.length, unusedImages: sample.unused, unusedDecodedBytes: sample.unusedDecodedBytes,
    archiveSha256: hash(sample.bytes), positions: sample.positions, normals: sample.normals, uv: sample.uv, decodedPixelsSha256: hash(sample.image.pixels) })), runs: [] };
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store'); const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (name === '/') { res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><script type="importmap">${JSON.stringify({ imports: {
    '@filens/core': '/repo/packages/core/dist/index.js', three: '/repo/node_modules/three/build/three.module.js'
  } })}</script>`); return; }
  const sample = samples.find(sample => name === '/' + sample.name);
  if (sample) { res.setHeader('Content-Type', 'application/zip'); res.end(sample.bytes); return; }
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
      await page.evaluate(async ({ module, sample, engine }) => {
        const [lib, three, bytes] = await Promise.all([import('/repo/' + module), import('three'), fetch('/' + sample).then(r => r.arrayBuffer())]);
        window.kmzBenchmark = { lib, three, bytes, engine };
      }, { module: modules[engine], sample: sample.name, engine });
      Object.assign(run, await page.evaluate(async () => {
        const { lib, three, bytes, engine } = window.kmzBenchmark;
        const active = new Set(), created = [], revoked = [], imageLoads = [];
        const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = blob => { const url = create(blob); active.add(url); created.push(url); return url; };
        URL.revokeObjectURL = url => { active.delete(url); revoked.push(url); revoke(url); };
        const load = three.TextureLoader.prototype.load;
        three.TextureLoader.prototype.load = function (url, onLoad, onProgress, onError) {
          let yes, no; imageLoads.push(new Promise((resolve, reject) => { yes = resolve; no = reject; }));
          return load.call(this, url, texture => { onLoad?.(texture); texture.image.decode().then(yes, no); }, onProgress, error => { onError?.(error); no(new Error('Image decode failed')); });
        };
        const start = performance.now();
        let result;
        if (engine === 'baseline') {
          const object = lib.loadKmzObject(bytes); let renderable = false;
          // Preserve the original async wrapper's fast-path content check.
          object.traverse(node => { if (node.geometry?.getAttribute('position')?.count) renderable = true; });
          if (!renderable) throw new Error('Benchmark must use the original renderable fast path.');
          result = { object, warnings: [] };
        } else result = await lib.loadKmzObjectWithWarnings(bytes);
        const { object, warnings } = result;
        await Promise.all(imageLoads); const loadMs = performance.now() - start;
        three.TextureLoader.prototype.load = load;
        const meshes = []; object.traverse(node => { if (node.isMesh) meshes.push(node); });
        const mesh = meshes[0], geometry = mesh.geometry, mat = mesh.material, image = mat.map.image;
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0);
        const sha = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
        const content = { meshes: meshes.length, positions: [...geometry.attributes.position.array], normals: [...geometry.attributes.normal.array], uv: [...geometry.attributes.uv.array],
          dimensions: [image.width, image.height], decodedPixelsSha256: await sha(ctx.getImageData(0, 0, image.width, image.height).data),
          material: { name: mat.name, color: mat.color.toArray(), repeat: mat.map.repeat.toArray(), offset: mat.map.offset.toArray(), colorSpace: mat.map.colorSpace,
            side: mat.side, opacity: mat.opacity, shininess: mat.shininess }, warnings };
        const lifetime = { createdUrls: created.length, revokedUrls: revoked.length, activeOwnedUrls: active.size };
        geometry.dispose(); mat.map.dispose(); mat.dispose(); for (const url of [...active]) URL.revokeObjectURL(url);
        return { loadMs, imageLoads: imageLoads.length, ...content, ...lifetime };
      }));
    } catch (error) { run.failure = String(error); }
    result.runs.push(run); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(run));
    await context.close();
  }
} finally { await browser.close(); server.close(); }
