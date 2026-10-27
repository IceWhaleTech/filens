// Same-project ZIP browsing through real directory click handlers and two frames.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createArchiveNavigationFixture } from '../packages/archive/test/fixtures/lifecycle.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const iterations = Number(option('--iterations', '7'));
assert(Number.isSafeInteger(iterations) && iterations > 0);
const baseline = option('--baseline', 'tmp/bbtree-followup-2026-10-27/baseline-archive-dist/index.js');
assert(!path.isAbsolute(baseline) && !baseline.split(/[\\/]/).includes('..'));
const out = path.resolve(root, option('--output', 'tmp/zip-browser-e2e-2026-10-27'));
fs.mkdirSync(out, { recursive: true });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const modules = { baseline, current: 'packages/archive/dist/index.js' };
const samples = [];
const specs = args.includes('--smoke') ? [[200, 20]] : [[200, 20], [10000, 100], [100000, 1000]];
for (const [count, directories] of specs) samples.push({ ...await createArchiveNavigationFixture(count, directories), name: `generated-${count}-${directories}.zip` });
const result = {
  date: new Date().toISOString(), engineering: true, scopedSota: false, iterations, cpu: os.cpus()[0].model,
  method: 'Same-project previous/current directory-index implementations, fresh Chromium context per invocation, alternating order, shared browser, 1024x768/DPR1/en-US/UTC, production CSS. localLoadToFramesMs starts before local HTTP input transfer and dynamic module import (parallel) and includes File creation, session creation, complete ZIP indexing, initial DOM construction, layout observation, fonts and two animation frames. inputReadyLoadToFramesMs excludes input/module setup. Directory timings use real DOM click handlers (synthetic click, not OS input), synchronous DOM/layout observation, fonts and two animation frames. Time includes direct-child index construction on first directory visit and full route-cache behavior. Each of up to 50 new directories is entered from the root; returning to the root is separately timed. Signatures, independent listing validation, screenshots, fixture creation, browser/HTML/CSS shell startup, remote NAS/backend, per-file extraction and peak memory are excluded. Two frames provide a display opportunity, not a physical input-to-photon measurement. No external ZIP browser peer; no SOTA claim.',
  artifacts: [...Object.values(modules), 'packages/core/dist/index.js', 'packages/archive/dist/index.css',
    'packages/archive/src/preview-driver.ts', 'packages/archive/test/fixtures/lifecycle.mjs', 'scripts/benchmark-archive-browser.mjs']
    .map(name => ({ path: name, sha256: hash(fs.readFileSync(path.join(root, name))) })),
  samples: samples.map(({ bytes, name, count, directories }) => ({ name, files: count, directories, bytes: bytes.length, sha256: hash(bytes) })),
  runs: []
};
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (name === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><link rel="stylesheet" href="/repo/packages/archive/dist/index.css"><script type="importmap">${JSON.stringify({ imports: { '@filens/core': '/repo/packages/core/dist/index.js' } })}</script><div id="host"></div>`);
    return;
  }
  const sample = samples.find(sample => '/' + sample.name === name);
  if (sample) { res.setHeader('Content-Type', 'application/zip'); res.end(sample.bytes); return; }
  const file = path.resolve(root, name.startsWith('/repo/') ? name.slice(6) : 'missing');
  if (!file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
  try { res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(fs.readFileSync(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
result.browser = browser.version();
const save = () => fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2) + '\n');
try {
  for (const sample of samples) for (let iteration = 0; iteration < iterations; iteration++) {
    for (const engine of iteration % 2 ? ['current', 'baseline'] : ['baseline', 'current']) {
      const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC' });
      const page = await context.newPage(); page.setDefaultTimeout(30000);
      const row = { sample: sample.name, engine, iteration, errors: [] };
      page.on('pageerror', error => row.errors.push(error.message));
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        Object.assign(row, await page.evaluate(async ({ module, sample }) => {
          const localStart = performance.now();
          const [lib, buffer] = await Promise.all([import('/repo/' + module), fetch('/' + sample).then(response => response.arrayBuffer())]);
          const source = new File([buffer], sample), host = document.getElementById('host');
          const inputReady = performance.now();
          const session = lib.createArchivePreviewDriver().createSession(host);
          window.archiveBrowser = { host, session };
          await session.load(source, { descriptor: { source, name: sample, extension: 'zip' } });
          const loadDomEnd = performance.now();
          host.getBoundingClientRect();
          await document.fonts.ready;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const ready = performance.now();
          return { localLoadToFramesMs: ready - localStart, setupMs: inputReady - localStart,
            inputReadyLoadToFramesMs: ready - inputReady, inputReadyLoadDomMs: loadDomEnd - inputReady };
        }, { module: modules[engine], sample: sample.name }));
        if (iteration === 0) row.rootPngSha256 = hash(await page.screenshot({ path: path.join(out, `${engine}-${sample.name}-root.png`) }));
        Object.assign(row, await page.evaluate(async ({ count, directories }) => {
          const { host, session } = window.archiveBrowser;
          const sha = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(value => value.toString(16).padStart(2, '0')).join('');
          const snapshots = [], html = [], visits = [], returns = [];
          const capture = () => {
            const state = session.getState();
            if (state.error || state.loading) throw new Error('Archive state failed: ' + state.error);
            const expected = state.route === '/'
              ? Array.from({ length: directories }, (_, i) => ({ name: `dir${String(i).padStart(3, '0')}/`, type: 'directory' }))
              : Array.from({ length: Math.ceil((count - Number(state.route.match(/dir(\d+)/)[1])) / directories) }, (_, i) => {
                const index = Number(state.route.match(/dir(\d+)/)[1]) + i * directories;
                return { name: `file${String(index).padStart(6, '0')}.txt`, type: 'file', size: new TextEncoder().encode(`Archive file ${index}\n`).length, modified: Date.UTC(2020, 0, 1) };
              });
            if (JSON.stringify(state.entries) !== JSON.stringify(expected)) throw new Error('Full listing differs from independent expected model at ' + state.route);
            snapshots.push(state.entries); html.push(host.innerHTML);
          };
          const click = async element => {
            if (!element) throw new Error('Missing directory or root control');
            const start = performance.now(); element.click(); const domEnd = performance.now();
            host.getBoundingClientRect(); await document.fonts.ready;
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            return { domMs: domEnd - start, toFramesMs: performance.now() - start };
          };
          const rootButton = () => [...host.querySelectorAll('.archivev-toolbar button')].find(button => button.textContent === 'Root');
          capture();
          for (let directory = 0; directory < Math.min(50, directories); directory++) {
            const name = `dir${String(directory).padStart(3, '0')}/`;
            const cell = [...host.querySelectorAll('.archivev-name')].find(cell => cell.textContent === name);
            visits.push(await click(cell?.parentElement)); capture();
            returns.push(await click(rootButton()));
          }
          const firstRow = host.querySelector('.archivev-row[data-type="directory"]');
          const cachedVisit = await click(firstRow); capture();
          const metadata = session.archiveStack[0].entries.map(({ name, type, size, modified }) => ({ name, type, size, modified }));
          return { visits, returns, cachedVisit,
            listingSha256: await sha(JSON.stringify(snapshots)), htmlSha256: await sha(JSON.stringify(html)), metadataSha256: await sha(JSON.stringify(metadata)) };
        }, { count: sample.count, directories: sample.directories }));
        if (iteration === 0) row.directoryPngSha256 = hash(await page.screenshot({ path: path.join(out, `${engine}-${sample.name}-directory.png`) }));
        await page.evaluate(() => window.archiveBrowser.session.destroy());
      } catch (error) { row.failure = String(error); }
      result.runs.push(row); save();
      console.log(JSON.stringify({ sample: sample.name, engine, iteration, load: row.localLoadToFramesMs, visits: row.visits?.length, failure: row.failure }));
      await context.close();
      if (row.failure || row.errors.length) throw new Error('Benchmark failed; see raw results.');
    }
  }
  for (const sample of samples) {
    const rows = result.runs.filter(row => row.sample === sample.name), expected = rows[0];
    for (const row of rows) for (const key of ['listingSha256', 'htmlSha256', 'metadataSha256']) assert.equal(row[key], expected[key]);
    for (const key of ['rootPngSha256', 'directoryPngSha256']) assert.equal(rows.find(row => row.engine === 'current' && row.iteration === 0)[key], expected[key]);
  }
} finally { await browser.close(); server.close(); save(); }
