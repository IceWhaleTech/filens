// Engineering comparison of the same docx-preview engine; not a peer/SOTA ranking.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createDocxFixture } from '../packages/docx/test/fixtures/document.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const iterations = Number(option('--iterations', '7')); assert(Number.isSafeInteger(iterations) && iterations > 0);
const baseline = option('--baseline', 'tmp/continued-review/docx-baseline/dist/index.js');
assert(!path.isAbsolute(baseline) && !baseline.split(/[\\/]/).includes('..'));
const out = path.resolve(root, option('--output', 'tmp/continued-review/docx-final')); fs.mkdirSync(out, { recursive: true });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const generated = createDocxFixture();
const samples = ['filens-aurora-guide', 'rich-docx-images', 'rich-docx-tables'].map(name => ({ name: `${name}.docx`, kind: 'typed', bytes: fs.readFileSync(path.join(root, 'apps/demo/public/samples', name + '.docx')) }));
samples.push({ name: 'generated-400-images.docx', kind: 'typed', bytes: generated }, { name: 'generated-400-images-blob.docx', kind: 'blob', bytes: generated });
const modules = { baseline, current: 'packages/docx/dist/index.js' };
const files = ['packages/core/dist/index.js', 'packages/docx/dist/index.css', 'scripts/benchmark-docx-preview.mjs', 'packages/docx/test/fixtures/document.mjs'];
const result = { engineering: true, scopedSota: false, date: new Date().toISOString(), iterations, cpu: os.cpus()[0].model,
  method: 'Fresh Chromium context per invocation, rotating engine order. Inputs/imports ready before timing. loadMs includes session construction, input snapshot/read, docx-preview parsing and DOM/resource task completion. Excludes image decode readiness, paint, file I/O and module download. After timing, decode every image, canonicalize complete DOM using all resource payload hashes, check teardown and compare first/last viewport screenshots in repeat zero. Same underlying renderer; no peer/SOTA or memory claim.',
  artifacts: [...Object.entries(modules).map(([engine, file]) => ({ engine, path: file, sha256: hash(fs.readFileSync(path.join(root, file))) })), ...files.map(file => ({ path: file, sha256: hash(fs.readFileSync(path.join(root, file))) }))],
  samples: samples.map(({ name, kind, bytes }) => ({ name, kind, bytes: bytes.length, sha256: hash(bytes) })), runs: [] };
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (name === '/') { res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><script type="importmap">${JSON.stringify({ imports: { '@filens/core': '/repo/packages/core/dist/index.js' } })}</script><link rel="stylesheet" href="/repo/packages/docx/dist/index.css"><style>html,body{margin:0;width:100%;height:100%}#host{position:fixed;inset:0}</style><div id="host"></div>`); return; }
  const sample = samples.find(sample => name === '/' + sample.name);
  if (sample) { res.end(sample.bytes); return; }
  const file = path.resolve(root, name.startsWith('/repo/') ? name.slice(6) : 'missing');
  if (!file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
  try { res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(fs.readFileSync(file)); } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true }); result.browser = browser.version();
try {
  for (const sample of samples) for (let iteration = 0; iteration < iterations; iteration++) for (const engine of iteration % 2 ? ['baseline', 'current'] : ['current', 'baseline']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage(), run = { sample: sample.name, engine, iteration, errors: [] };
    page.on('pageerror', error => run.errors.push(error.message));
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.evaluate(async ({ module, sample }) => {
        const lib = await import('/repo/' + module), bytes = new Uint8Array(await (await fetch('/' + sample.name)).arrayBuffer());
        const source = sample.kind === 'blob' ? new Blob([bytes]) : bytes;
        const blobs = new Map(), active = new Set(), create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = blob => { const url = create(blob); blobs.set(url, blob); active.add(url); return url; };
        URL.revokeObjectURL = url => { active.delete(url); revoke(url); };
        window.docxBenchmark = { lib, source, blobs, active, revoke, sample, host: document.getElementById('host') };
      }, { module: modules[engine], sample: { name: sample.name, kind: sample.kind } });
      Object.assign(run, await page.evaluate(async () => {
        const state = window.docxBenchmark, { lib, source, host, sample } = state;
        const start = performance.now(); const session = state.session = lib.createDocxPreviewDriver().createSession(host);
        await session.load(source, { descriptor: { source, name: sample.name, extension: 'docx' } });
        const loadMs = performance.now() - start;
        const images = [...host.querySelectorAll('img')]; await Promise.all(images.map(image => image.decode()));
        const sha = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
        let html = host.querySelector('.docxv-document').innerHTML; const resources = [];
        for (const [url, blob] of state.blobs) {
          const signature = { type: blob.type, size: blob.size, sha256: await sha(await blob.arrayBuffer()) };
          const canonical = JSON.stringify(signature); resources.push(canonical); html = html.replaceAll(url, 'resource:' + signature.sha256);
        }
        await document.fonts.ready;
        return { loadMs, domSha256: await sha(new TextEncoder().encode(html)), textSha256: await sha(new TextEncoder().encode(host.textContent)),
          pages: host.querySelectorAll('section.docx').length, images: images.length, tables: host.querySelectorAll('table').length,
          decodedImages: images.filter(image => image.naturalWidth > 0 && image.naturalHeight > 0).length,
          resourceCount: resources.length, uniqueResources: [...new Set(resources)].sort(), stateError: session.getState().error };
      }));
      if (iteration === 0) {
        run.views = [];
        for (const view of ['first', 'last']) {
          // content-visibility can replace estimated page heights after scrolling.
          for (let settle = 0; settle < 4; settle++) {
            await page.evaluate(view => { const root = document.querySelector('.docxv-preview'); root.scrollTop = view === 'first' ? 0 : root.scrollHeight; }, view);
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          }
          const viewport = await page.evaluate(() => {
            const root = document.querySelector('.docxv-preview'), image = [...root.querySelectorAll('img')].at(-1);
            const bounds = root.getBoundingClientRect(), last = image?.getBoundingClientRect();
            return { scrollGap: root.scrollHeight - root.scrollTop - root.clientHeight, lastImageVisible: !!last && last.top >= bounds.top && last.bottom <= bounds.bottom };
          });
          if (view === 'last') { assert(viewport.scrollGap <= 1); if (sample.name.startsWith('generated-')) assert(viewport.lastImageVisible); }
          const file = path.join(out, `${sample.name}-${engine}-${view}.png`), screenshot = await page.screenshot({ path: file });
          run.views.push({ view, sha256: hash(screenshot), path: path.relative(root, file), ...viewport });
        }
      }
      Object.assign(run, await page.evaluate(() => {
        const state = window.docxBenchmark; state.session.destroy();
        const remainingUrls = state.active.size; for (const url of state.active) state.revoke(url);
        return { destroyed: !state.host.childElementCount, remainingUrls };
      }));
    } catch (error) { run.failure = String(error); }
    result.runs.push(run); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(run));
    await context.close();
  }
} finally { await browser.close(); server.close(); }
