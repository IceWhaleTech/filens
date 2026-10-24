// FreeMind parsing and session-load engineering A/B; not a peer/SOTA comparison.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createWideMmFixture } from '../packages/mindmap/test/fixtures/maps.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const iterations = Number(option('--iterations', '7'));
assert(Number.isInteger(iterations) && iterations > 0);
const baseline = option('--baseline', 'tmp/continued-review/mindmap-baseline/dist/index.js');
assert(!path.isAbsolute(baseline) && !baseline.split(/[\\/]/).includes('..'));
const out = path.resolve(root, option('--output', 'tmp/continued-review/mindmap'));
fs.mkdirSync(out, { recursive: true });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const samples = [
  { name: 'wide-1000-no-ids', nodeCount: 1000, explicitIds: false },
  { name: 'wide-3000-no-ids', nodeCount: 3000, explicitIds: false },
  { name: 'wide-3000-explicit-ids', nodeCount: 3000, explicitIds: true },
  { name: 'small-30-no-ids', nodeCount: 30, explicitIds: false }
].map(sample => ({ ...sample, sha256: hash(createWideMmFixture(sample.nodeCount, sample.explicitIds)) }));
const modules = { current: 'packages/mindmap/dist/index.js', baseline };
const files = ['scripts/benchmark-mindmap.mjs', 'packages/mindmap/test/fixtures/maps.mjs', 'packages/core/dist/index.js'];
const result = { engineering: true, date: new Date().toISOString(), iterations, cpu: os.cpus()[0].model,
  method: 'Fresh Chromium context per invocation; rotated engine order. Generated FreeMind XML and module ready before timing. Measures complete XML-to-model parsing synchronously, then a separate session.load through SVG DOM construction with source bytes already ready. Session timing follows the parser measurement and excludes layout, paint and module/network loading. Complete model and SVG hashes checked after timing. Not a peer/SOTA comparison.',
  artifacts: [...Object.entries(modules).map(([engine, file]) => ({ engine, path: file, sha256: hash(fs.readFileSync(path.join(root, file))) })),
    ...files.map(file => ({ path: file, sha256: hash(fs.readFileSync(path.join(root, file))) }))], samples, runs: [] };
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  res.setHeader('Cache-Control', 'no-store');
  if (name === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><script type="importmap">${JSON.stringify({ imports: { '@filens/core': '/repo/packages/core/dist/index.js' } })}</script>`);
    return;
  }
  const file = path.resolve(root, name.startsWith('/repo/') ? name.slice(6) : 'missing');
  if (!file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
  try { res.setHeader('Content-Type', /\.m?js$/.test(file) ? 'text/javascript' : 'application/octet-stream'); res.end(fs.readFileSync(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true }); result.browser = browser.version();
try {
  for (const sample of samples) for (let iteration = 0; iteration < iterations; iteration++) {
    for (const engine of iteration % 2 ? ['baseline', 'current'] : ['current', 'baseline']) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const run = { sample: sample.name, engine, iteration, errors: [] };
      page.on('pageerror', error => run.errors.push(error.message));
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.evaluate(async ({ module, sample }) => {
          const lib = await import('/repo/' + module);
          const { createWideMmFixture } = await import('/repo/packages/mindmap/test/fixtures/maps.mjs');
          const xml = createWideMmFixture(sample.nodeCount, sample.explicitIds);
          window.mindmapBenchmark = { lib, xml, bytes: new TextEncoder().encode(xml) };
        }, { module: modules[engine], sample });
        Object.assign(run, await page.evaluate(async () => {
          const { lib, xml, bytes } = window.mindmapBenchmark;
          const start = performance.now();
          const model = lib.loadMindmapDocument(xml, 'mm');
          const parseMs = performance.now() - start;
          const host = document.createElement('div'); document.body.replaceChildren(host);
          const session = lib.createMindmapPreviewDriver().createSession(host, { initialScale: 1, fit: 'none' });
          const previewStart = performance.now();
          await session.load(bytes, { descriptor: { source: bytes, name: 'plan.mm', extension: 'mm' } });
          const sessionLoadMs = performance.now() - previewStart;
          const sha = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(v => v.toString(16).padStart(2, '0')).join('');
          const signature = { parseMs, sessionLoadMs, nodeCount: model.nodeCount,
            renderedNodes: host.querySelectorAll('.mindmapv-node').length,
            modelSha256: await sha(JSON.stringify(model)), svgSha256: await sha(host.querySelector('svg').outerHTML) };
          session.destroy();
          return signature;
        }));
      } catch (error) { run.failure = String(error); }
      result.runs.push(run);
      fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2) + '\n');
      console.log(JSON.stringify(run));
      await context.close();
    }
  }
} finally { await browser.close(); server.close(); }
