// Detached raw volume preparation only; no peer/SOTA, rendering or memory ranking.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createVolumeFixture } from '../packages/model3d/test/fixtures/volume.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const iterations = Number(option('--iterations', '7')); assert(Number.isSafeInteger(iterations) && iterations > 0);
const baseline = option('--baseline', 'tmp/continued-review/volume-preview-baseline/dist/index.js');
assert(!path.isAbsolute(baseline) && !baseline.split(/[\\/]/).includes('..'));
const out = path.resolve(root, option('--output', 'tmp/continued-review/volume-preview-final')); fs.mkdirSync(out, { recursive: true });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const modules = { baseline, current: 'packages/model3d/dist/index.js' };
const samples = [32, 128, 256].map(side => ({ name: `generated-${side}-cubed.nhdr`, ...createVolumeFixture(side) }));
const files = ['packages/core/dist/index.js', 'node_modules/three/build/three.module.js', 'node_modules/three/build/three.core.js',
  'node_modules/three/examples/jsm/loaders/NRRDLoader.js', 'node_modules/three/examples/jsm/libs/fflate.module.js',
  'node_modules/three/examples/jsm/misc/Volume.js', 'node_modules/three/examples/jsm/misc/VolumeSlice.js',
  'packages/model3d/test/fixtures/volume.mjs', 'scripts/benchmark-volume-preview.mjs'];
const result = { engineering: true, scopedSota: false, date: new Date().toISOString(), iterations, cpu: os.cpus()[0].model,
  method: 'Fresh Chromium contexts, alternating build order. Imports and in-memory inputs ready before timing. prepareMs measures resolveNhdrBuffer: primary resolver lookup, binary preparation and header/payload assembly. Excludes external input transfer, HTTP/module loading, volume decoding, point construction, GPU/paint and peak memory. Complete source/payload hashes and canonical header fields checked after timing. An actual Three NRRD decode also runs after timing; original headers can decode incorrectly, which is recorded rather than treated as output equivalence. Baselines at or below 10 ms receive no speed claim. No peer/SOTA ranking.',
  artifacts: [...Object.entries(modules).map(([engine, file]) => ({ engine, path: file, sha256: hash(fs.readFileSync(path.join(root, file))) })),
    ...files.map(file => ({ path: file, sha256: hash(fs.readFileSync(path.join(root, file))) }))],
  samples: samples.map(({ name, side, header, bytes }) => ({ name, side, voxels: side ** 3, bytes: bytes.length, headerSha256: hash(header), payloadSha256: hash(bytes) })), runs: [] };
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store'); const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (name === '/') { res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><script type="importmap">${JSON.stringify({ imports: {
    '@filens/core': '/repo/packages/core/dist/index.js', three: '/repo/node_modules/three/build/three.module.js'
  } })}</script>`); return; }
  const sample = samples.find(sample => name === '/' + sample.name || name === '/' + sample.name + '.raw');
  if (sample) { res.end(name.endsWith('.raw') ? sample.bytes : sample.header); return; }
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
        const [lib, header, bytes, { NRRDLoader }] = await Promise.all([import('/repo/' + module), fetch('/' + sample).then(r => r.text()),
          fetch('/' + sample + '.raw').then(r => r.arrayBuffer()), import('/repo/node_modules/three/examples/jsm/loaders/NRRDLoader.js')]);
        window.volumeBenchmark = { lib, header, bytes, NRRDLoader };
      }, { module: modules[engine], sample: sample.name });
      Object.assign(run, await page.evaluate(async () => {
        const { lib, header, bytes, NRRDLoader } = window.volumeBenchmark;
        let resolverCalls = 0;
        const start = performance.now(), buffer = await lib.resolveNhdrBuffer(header, {
          resourceBasePath: 'scan/source.nhdr', resourceResolver: () => { resolverCalls++; return new Uint8Array(bytes); }
        }), prepareMs = performance.now() - start;
        const sha = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
        const merged = new Uint8Array(buffer); let end = -1;
        for (let i = 1; i < merged.length; i++) if (merged[i - 1] === 10 && merged[i] === 10) { end = i + 1; break; }
        if (end < 0) throw new Error('Missing NRRD header separator');
        const headerText = new TextDecoder().decode(merged.subarray(0, end)), fields = {};
        for (const line of headerText.split('\n')) { const match = /^([^:#]+):\s*(.*)$/.exec(line); if (match) fields[match[1].trim()] = match[2].trim(); }
        const payloadSha256 = await sha(merged.subarray(end)), inputSha256 = await sha(bytes);
        const decoded = new NRRDLoader().parse(buffer), decodedSha256 = await sha(decoded.data);
        return { prepareMs, resolverCalls, payloadBytes: merged.length - end, payloadSha256, inputSha256, fields,
          decodedVoxels: decoded.data.length, decodedSha256, decodedVoxelsMatchInput: decodedSha256 === inputSha256 };
      }));
    } catch (error) { run.failure = String(error); }
    result.runs.push(run); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(run));
    await context.close();
  }
} finally { await browser.close(); server.close(); }
