// Same-project glTF sidecar A/B comparison; no peer/SOTA or peak-memory ranking.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createGltfSidecarFixture } from '../packages/model3d/test/fixtures/gltf.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const iterations = Number(option('--iterations', '7')); assert(Number.isSafeInteger(iterations) && iterations > 0);
const baseline = option('--baseline', 'tmp/continued-review/model3d-resources-baseline/dist/index.js');
assert(!path.isAbsolute(baseline) && !baseline.split(/[\\/]/).includes('..'));
const out = path.resolve(root, option('--output', 'tmp/continued-review/model3d-gltf-final')); fs.mkdirSync(out, { recursive: true });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const modules = { baseline, current: 'packages/model3d/dist/index.js' };
const samples = [1000, 100000, 300000].map(triangles => ({ name: `generated-${triangles}-triangles.gltf`, triangles, ...createGltfSidecarFixture(triangles) }));
const files = ['packages/core/dist/index.js', 'node_modules/three/build/three.module.js', 'node_modules/three/build/three.core.js',
  'packages/model3d/test/fixtures/gltf.mjs', 'scripts/benchmark-model3d-gltf.mjs'];
const result = {
  engineering: true, scopedSota: false, date: new Date().toISOString(), iterations, cpu: os.cpus()[0].model,
  method: 'Fresh Chromium context for each invocation; alternating build order, seven repeats in final run. Inputs and imports ready before timing. loadMs includes glTF JSON processing, resolver normalization and complete Three.js geometry/material loading. In-memory sidecar contains only referenced positions and normals. Excludes file/network/module loading, scene helpers, renderer/GPU/paint. Complete position/normal bytes, computed bounds, material values and warnings checked after timing. Native Blob URL bookkeeping runs in both builds. No peak-memory, peer or SOTA claim. Baseline medians at or below 10 ms receive no speed claim.',
  artifacts: [...Object.entries(modules).map(([engine, file]) => ({ engine, path: file, sha256: hash(fs.readFileSync(path.join(root, file))) })),
    ...files.map(file => ({ path: file, sha256: hash(fs.readFileSync(path.join(root, file))) }))],
  samples: samples.map(({ name, triangles, json, bytes, positions, normals, min, max }) => ({ name, triangles, bytes: bytes.byteLength,
    sourceSha256: hash(JSON.stringify(json)), sidecarSha256: hash(bytes), positionsSha256: hash(positions), normalsSha256: hash(normals), min, max })), runs: []
};
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store'); const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (name === '/') {
    res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><script type="importmap">${JSON.stringify({ imports: {
      '@filens/core': '/repo/packages/core/dist/index.js', three: '/repo/node_modules/three/build/three.module.js'
    } })}</script>`); return;
  }
  const sample = samples.find(sample => name === '/' + sample.name || name === '/' + sample.name + '.bin');
  if (sample) { res.end(name.endsWith('.bin') ? sample.bytes : JSON.stringify(sample.json)); return; }
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
      await page.evaluate(async ({ module, sample }) => {
        const [lib, json, buffer] = await Promise.all([import('/repo/' + module), fetch('/' + sample).then(r => r.text()), fetch('/' + sample + '.bin').then(r => r.arrayBuffer())]);
        window.gltfBenchmark = { lib, json, buffer };
      }, { module: modules[engine], sample: sample.name });
      Object.assign(run, await page.evaluate(async () => {
        const { lib, json, buffer } = window.gltfBenchmark;
        const urls = new Set(), created = [], revoked = [];
        const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = blob => { const url = create(blob); urls.add(url); created.push(url); return url; };
        URL.revokeObjectURL = url => { urls.delete(url); revoked.push(url); revoke(url); };
        const start = performance.now();
        const { object, warnings } = await lib.loadGltfObjectWithWarnings(json, {
          resourceResolver: () => ({ source: new Uint8Array(buffer), warnings: ['generated geometry sidecar'] })
        });
        const loadMs = performance.now() - start;
        const sha = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
        const meshes = []; object.traverse(node => { if (node.isMesh) meshes.push(node); });
        const mesh = meshes[0], geometry = mesh.geometry; geometry.computeBoundingBox();
        const positions = geometry.attributes.position, normals = geometry.attributes.normal;
        const content = {
          positionsSha256: await sha(positions.array), normalsSha256: await sha(normals.array), vertices: positions.count,
          normalValues: normals.array.length, indexCount: geometry.index?.count ?? 0, meshes: meshes.length,
          min: geometry.boundingBox.min.toArray(), max: geometry.boundingBox.max.toArray(), warnings,
          material: { color: mesh.material.color.toArray(), metalness: mesh.material.metalness, roughness: mesh.material.roughness, side: mesh.material.side }
        };
        for (const node of meshes) { node.geometry.dispose(); for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.dispose(); }
        return { loadMs, ...content, createdUrls: created.length, revokedUrls: revoked.length, activeOwnedUrls: urls.size };
      }));
    } catch (error) { run.failure = String(error); }
    result.runs.push(run); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(run));
    await context.close();
  }
} finally { await browser.close(); server.close(); }
