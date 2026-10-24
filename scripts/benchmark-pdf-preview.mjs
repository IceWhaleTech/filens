// Engineering comparison of the same PDF.js preview driver before/after scheduling changes.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createPdfFixture } from '../packages/pdf/test/fixtures/document.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const iterations = Number(option('--iterations', '7'));
const review = args.includes('--review');
const baseline = option('--baseline', 'tmp/continued-review/pdf-baseline/dist/index.js');
assert(!path.isAbsolute(baseline) && !baseline.split(/[\\/]/).includes('..'));
const out = path.resolve(root, option('--output', 'tmp/continued-review/pdf-preview'));
fs.mkdirSync(out, { recursive: true });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const samples = [
  { name: 'cosmic-atlas.pdf', bytes: fs.readFileSync(path.join(root, 'apps/demo/public/samples/filens-cosmic-atlas.pdf')) },
  { name: 'generated-100-pages.pdf', bytes: createPdfFixture(100) },
  { name: 'generated-100-mixed-pages.pdf', bytes: createPdfFixture(100, true) }
];
const modules = { current: 'packages/pdf/dist/index.js', baseline };
const result = { engineering: true, iterations, date: new Date().toISOString(), cpu: os.cpus()[0].model, versions: { 'pdfjs-dist': '5.4.624' },
  method: 'Fresh Chromium context per invocation; rotated current/baseline order. Same PDF.js version, viewport 1000x800, DPR 1, host 800x600. Inputs and JS ready before timing; worker startup remains included. First painted preview is sampled after two animation frames when the first canvas contains nonwhite content. Ready time waits for load() plus two frames: eager baseline completes every page; virtual current completes visible/nearby pages. Full-page pixel signatures and interactions are checked separately after timing. Engineering only, no peer SOTA ranking.',
  artifacts: [...Object.entries(modules).map(([engine, file]) => ({ engine, path: file, sha256: hash(fs.readFileSync(path.join(root, file))) })),
    ...['scripts/benchmark-pdf-preview.mjs', 'packages/pdf/test/fixtures/document.mjs'].map(file => ({ path: file, sha256: hash(fs.readFileSync(path.join(root, file))) }))],
  samples: samples.map(({ name, bytes }) => ({ name, bytes: bytes.length, sha256: hash(bytes) })), runs: [] };
const imports = { '@filens/core': '/repo/packages/core/dist/index.js' };
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  res.setHeader('Cache-Control', 'no-store');
  if (name === '/') { res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><script type="importmap">${JSON.stringify({ imports })}</script>`); return; }
  const sample = samples.find(sample => name === '/' + sample.name);
  if (sample) { res.setHeader('Content-Type', 'application/pdf'); res.end(sample.bytes); return; }
  const file = path.resolve(root, name.startsWith('/repo/') ? name.slice(6) : 'missing');
  if (!file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
  try { res.setHeader('Content-Type', file.endsWith('.js') || file.endsWith('.mjs') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream'); res.end(fs.readFileSync(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true }); result.browser = browser.version();
const save = () => fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2) + '\n');
try {
  for (const sample of samples) for (let iteration = 0; iteration < iterations; iteration++) {
    for (const engine of iteration % 2 ? ['baseline', 'current'] : ['current', 'baseline']) {
      const context = await browser.newContext({ viewport: { width: 1000, height: 800 }, deviceScaleFactor: 1 });
      const page = await context.newPage(); page.setDefaultTimeout(60000);
      const run = { sample: sample.name, engine, iteration, errors: [] };
      page.on('pageerror', error => run.errors.push(error.message));
      try {
        await page.goto(base);
        await page.evaluate(async ({ module, sample }) => {
          const lib = await import(`/repo/${module}`);
          await new Promise((resolve, reject) => { const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = `/repo/${module.slice(0, module.lastIndexOf('/'))}/index.css`; link.onload = resolve; link.onerror = reject; document.head.append(link); });
          const bytes = new Uint8Array(await (await fetch('/' + sample)).arrayBuffer());
          document.body.style.cssText = 'margin:0';
          const host = document.createElement('div'); host.style.cssText = 'width:800px;height:600px'; document.body.append(host);
          window.pdfBenchmark = { lib, bytes, host, sample };
        }, { module: modules[engine], sample: sample.name });
        Object.assign(run, await page.evaluate(async () => {
          const { lib, bytes, host, sample } = window.pdfBenchmark;
          const session = lib.createPdfPreviewDriver().createSession(host);
          window.pdfBenchmark.session = session;
          const t0 = performance.now();
          let done = false, firstPaintMs = null;
          const painted = (async () => {
            while (!done) {
              await new Promise(resolve => requestAnimationFrame(resolve));
              const canvas = host.querySelector('canvas');
              if (canvas?.width && canvas.height) {
                const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, Math.min(40, canvas.height)).data;
                if (pixels.some((value, index) => index % 4 !== 3 && pixels[index - index % 4 + 3] && value < 200)) {
                  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                  firstPaintMs = performance.now() - t0;
                  return;
                }
              }
            }
          })();
          await session.load(bytes, { descriptor: { source: bytes, name: sample, extension: 'pdf' } });
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const readyMs = performance.now() - t0;
          done = true; await painted;
          const canvases = [...host.querySelectorAll('canvas')];
          const first = canvases[0], data = first.getContext('2d').getImageData(0, 0, first.width, first.height).data;
          const firstPageSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(value => value.toString(16).padStart(2, '0')).join('');
          const output = { readyMs, firstPaintMs, pageCount: session.getState().pageCount, canvases: canvases.length,
            canvasPixels: canvases.reduce((sum, canvas) => sum + canvas.width * canvas.height, 0), firstPageSha256, firstPageSize: [first.width, first.height], state: session.getState() };
          return output;
        }));
        if (review && iteration === 0) {
          await page.screenshot({ path: path.join(out, `${engine}-${sample.name}.png`) });
          run.pageReview = await page.evaluate(async engine => {
            const { host, session } = window.pdfBenchmark;
            const pages = [];
            for (let index = 0; index < session.getState().pageCount; index++) {
              if (engine === 'current') {
                session.goToPage(index);
                const deadline = performance.now() + 15000;
                while (!host.querySelector(`canvas[data-page-index="${index}"][data-rendered="true"]`)) {
                  if (performance.now() > deadline) throw new Error(`Page ${index} did not render`);
                  await new Promise(resolve => requestAnimationFrame(resolve));
                }
              }
              const canvas = host.querySelector(`canvas[data-page-index="${index}"]`);
              const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
              const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels))].map(value => value.toString(16).padStart(2, '0')).join('');
              pages.push({ index, width: canvas.width, height: canvas.height, sha256 });
            }
            return pages;
          }, engine);
        }
        run.destroyed = await page.evaluate(() => { const { session, host } = window.pdfBenchmark; session.destroy(); return !host.childElementCount; });
      } catch (error) { run.failure = String(error); }
      result.runs.push(run); save();
      console.log(JSON.stringify(run));
      await context.close();
    }
  }
} finally { await browser.close(); server.close(); }
