// Diagram parsing and SVG construction engineering A/B; not a peer/SOTA comparison.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import JSZip from 'jszip';
import { createDrawioFixture, createVisioPage } from '../packages/diagram/test/fixtures/diagrams.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const iterations = Number(option('--iterations', '7'));
assert(Number.isInteger(iterations) && iterations > 0);
const baseline = option('--baseline', 'tmp/continued-review/diagram-baseline/dist/index.js');
assert(!path.isAbsolute(baseline) && !baseline.split(/[\\/]/).includes('..'));
const out = path.resolve(root, option('--output', 'tmp/continued-review/diagram'));
fs.mkdirSync(out, { recursive: true });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const inputs = [
  { name: 'drawio-3000-plain', format: 'drawio', text: createDrawioFixture(3000), nodeCount: 3000 },
  { name: 'drawio-3000-html', format: 'drawio', text: createDrawioFixture(3000, true), nodeCount: 3000 },
  { name: 'visio-1000', format: 'vdx', text: '<VisioDocument><Pages><Page Name="Flow">' + createVisioPage(1000) + '</Page></Pages></VisioDocument>', nodeCount: 1000 },
  { name: 'vsdx-3000', format: 'vsdx', text: createVisioPage(3000), nodeCount: 3000 },
  { name: 'drawio-small-30', format: 'drawio', text: createDrawioFixture(30), nodeCount: 30 }
];
for (const input of inputs) {
  if (input.format === 'vsdx') {
    const zip = new JSZip(); zip.file('visio/pages/page1.xml', input.text, { date: new Date('2000-01-01T00:00:00Z') });
    input.bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  } else input.bytes = new TextEncoder().encode(input.text);
}
const realInputManifest = option('--real-inputs', 'tmp/continued-review/diagram-inputs/sources.json');
for (const sample of JSON.parse(fs.readFileSync(path.resolve(root, realInputManifest)))) {
  const bytes = new Uint8Array(fs.readFileSync(path.resolve(root, sample.path)));
  assert.equal(hash(bytes), sample.sha256, sample.name);
  inputs.push({ ...sample, bytes, format: 'vsdx', real: true });
}
const samples = inputs.map(({ name, format, nodeCount, bytes, url, real }) => ({ name, format, nodeCount, sha256: hash(bytes), ...(real ? { real, url } : {}) }));
const modules = { current: 'packages/diagram/dist/index.js', baseline };
const files = ['scripts/benchmark-diagram.mjs', 'scripts/prepare-diagram-benchmark.mjs', 'packages/diagram/test/fixtures/diagrams.mjs', 'packages/core/dist/index.js'];
const result = { engineering: true, date: new Date().toISOString(), iterations, cpu: os.cpus()[0].model,
  method: 'Fresh Chromium context per invocation; rotated engine order. Generated draw.io / Visio inputs and three pinned libvisio samples; inputs and module ready before timing. Measures complete XML/ZIP-to-model parsing, then a separate session.load through SVG DOM construction with source bytes already ready. Session timing follows the parser measurement and excludes layout, paint and module/network loading. Complete model and SVG hashes checked after timing. Not a peer/SOTA comparison.',
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
  if (name.startsWith('/input/')) {
    const input = inputs.find(input => name === '/input/' + input.name);
    if (!input) { res.writeHead(404).end(); return; }
    res.end(input.bytes); return;
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
          const bytes = new Uint8Array(await (await fetch('/input/' + sample.name)).arrayBuffer());
          const text = new TextDecoder().decode(bytes);
          window.diagramBenchmark = { lib, text, bytes, format: sample.format };
        }, { module: modules[engine], sample });
        Object.assign(run, await page.evaluate(async () => {
          const { lib, text, bytes, format } = window.diagramBenchmark;
          const start = performance.now();
          const model = format === 'vsdx' ? await lib.loadVsdxDiagram(bytes.buffer) : format === 'vdx' ? lib.loadVdxDiagram(text) : lib.loadDrawioDiagram(text);
          const parseMs = performance.now() - start;
          const host = document.createElement('div'); document.body.replaceChildren(host);
          const session = lib.createDiagramPreviewDriver().createSession(host, { initialScale: 1, fit: 'none' });
          const previewStart = performance.now();
          await session.load(bytes, { descriptor: { source: bytes, name: 'flow.' + format, extension: format } });
          const sessionLoadMs = performance.now() - previewStart;
          const sha = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(v => v.toString(16).padStart(2, '0')).join('');
          const signature = { parseMs, sessionLoadMs, nodeCount: model.pages.reduce((sum, page) => sum + page.nodes.length, 0),
            renderedNodes: host.querySelectorAll('.diagramv-node').length,
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
