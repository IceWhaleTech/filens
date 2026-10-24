// Complete Three LDraw model loading, with generated in-memory native sidecars.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createLDrawBenchmarkFixture } from '../packages/model3d/test/fixtures/ldraw.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const iterations = Number(option('--iterations', '7')); assert(Number.isSafeInteger(iterations) && iterations > 0);
const baseline = option('--baseline', 'tmp/continued-review/ldraw-resources-baseline/dist/index.js');
assert(!path.isAbsolute(baseline) && !baseline.split(/[\\/]/).includes('..'));
const out = path.resolve(root, option('--output', 'tmp/continued-review/ldraw-resources-final')); fs.mkdirSync(out, { recursive: true });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const modules = { baseline, current: 'packages/model3d/dist/index.js' };
const samples = [100, 2000, 10000].map(triangles => ({ name: `generated-${triangles}-triangles.ldr`, ...createLDrawBenchmarkFixture(triangles) }));
const result = { engineering: true, scopedSota: false, date: new Date().toISOString(), iterations, cpu: os.cpus()[0].model,
  method: 'Fresh Chromium contexts, alternating build order. Imports and UTF-8 sidecar bytes prepared before timing. loadMs includes resource normalization/dependency preparation and complete Three LDraw geometry/material construction. The original file map embeds data URLs in part names: Three probes three invalid prefixed URLs before trying the URL itself. A strict local HTTP server returns 404 for those probes; their time is included and counts retained. HTTP fallback-HTML servers can instead fail, as recorded in separate correctness tests. Excludes original input transfer, module loading, renderer/GPU/paint and peak memory. Complete positions/normals and material values checked against the generated fixture after timing. No ignored padding. Baselines at or below 10 ms receive no speed ratio; no peer/SOTA ranking.',
  artifacts: [...Object.entries(modules).map(([engine, file]) => ({ engine, path: file, sha256: hash(fs.readFileSync(path.join(root, file))) })),
    ...['packages/core/dist/index.js', 'node_modules/three/build/three.module.js', 'node_modules/three/build/three.core.js',
      'packages/model3d/test/fixtures/ldraw.mjs', 'scripts/benchmark-ldraw-resources.mjs'].map(file => ({ path: file, sha256: hash(fs.readFileSync(path.join(root, file))) }))],
  samples: samples.map(({ name, triangles, source, part, positions, normals }) => ({ name, triangles, bytes: Buffer.byteLength(part),
    sourceSha256: hash(source), sidecarSha256: hash(part), positionsSha256: hash(positions), normalsSha256: hash(normals) })), runs: [] };
let activeRun;
const server = http.createServer({ maxHeaderSize: 64 * 1024 * 1024 }, (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (name === '/') { res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><script type="importmap">${JSON.stringify({ imports: {
    '@filens/core': '/repo/packages/core/dist/index.js', three: '/repo/node_modules/three/build/three.module.js'
  } })}</script>`); return; }
  const sample = samples.find(sample => name === '/' + sample.name || name === '/' + sample.name + '.dat');
  if (sample) { res.setHeader('Content-Type', 'text/plain'); res.end(name.endsWith('.dat') ? sample.part : sample.source); return; }
  if (/^\/(?:parts|p|models)\/data:/.test(name)) { if (activeRun) activeRun.lookupMisses++; res.writeHead(404).end(); return; }
  const file = path.resolve(root, name.startsWith('/repo/') ? name.slice(6) : 'missing');
  if (!file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
  try { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(file)); } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true }); result.browser = browser.version();
try {
  for (const sample of samples) for (let iteration = 0; iteration < iterations; iteration++) for (const engine of iteration % 2 ? ['baseline', 'current'] : ['current', 'baseline']) {
    const context = await browser.newContext(), page = await context.newPage();
    const run = { sample: sample.name, engine, iteration, lookupMisses: 0, errors: [] }; activeRun = run;
    page.on('pageerror', error => run.errors.push(error.message));
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.evaluate(async ({ module, sample }) => {
        const [lib, source, bytes] = await Promise.all([import('/repo/' + module), fetch('/' + sample).then(r => r.text()), fetch('/' + sample + '.dat').then(r => r.arrayBuffer())]);
        window.ldrawBenchmark = { lib, source, bytes };
      }, { module: modules[engine], sample: sample.name });
      Object.assign(run, await page.evaluate(async () => {
        const { lib, source, bytes } = window.ldrawBenchmark; let resolverCalls = 0, createdUrls = 0, revokedUrls = 0;
        const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = blob => { createdUrls++; return create(blob); }; URL.revokeObjectURL = url => { revokedUrls++; revoke(url); };
        const start = performance.now();
        const { object, warnings } = await lib.loadLDrawObjectWithWarnings(source, {
          resourceBasePath: 'models/main.ldr', resourceResolver: () => { resolverCalls++; return new Uint8Array(bytes); }
        });
        const loadMs = performance.now() - start;
        const meshes = [], geometries = new Set(), materials = new Set(); let indirectResourceNames = 0;
        object.traverse(node => {
          if (node.isMesh) meshes.push(node); if (node.geometry) geometries.add(node.geometry);
          if (/^(?:data|blob):/.test(node.name)) indirectResourceNames++;
          for (const mat of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) materials.add(mat);
        });
        const mesh = meshes[0], geometry = mesh.geometry;
        const sha = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
        const content = { meshes: meshes.length, vertices: geometry.attributes.position.count, positionsSha256: await sha(geometry.attributes.position.array),
          normalsSha256: await sha(geometry.attributes.normal.array), material: { color: mesh.material.color.getHexString(), roughness: mesh.material.roughness,
            metalness: mesh.material.metalness, side: mesh.material.side, opacity: mesh.material.opacity }, warnings, indirectResourceNames };
        for (const geometry of geometries) geometry.dispose(); for (const material of materials) material.dispose();
        return { loadMs, resolverCalls, ...content, createdUrls, revokedUrls };
      }));
    } catch (error) { run.failure = String(error); }
    result.runs.push(run); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(run));
    await context.close(); activeRun = undefined;
  }
} finally { await browser.close(); server.close(); }
