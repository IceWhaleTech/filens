// Workbook DOM batching from prepared models; engineering A/B, not parser or peer/SOTA timing.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const iterations = Number(option('--iterations', '7'));
const baseline = option('--baseline', 'tmp/continued-review/workbook-rows-baseline/dist/index.js');
assert(!path.isAbsolute(baseline) && !baseline.split(/[\\/]/).includes('..'));
const out = path.resolve(root, option('--output', 'tmp/continued-review/workbook-rows'));
fs.mkdirSync(out, { recursive: true });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const samples = [
  { name: 'dense-20000-rows', rows: 20000, sparse: false },
  { name: 'dense-200000-rows', rows: 200000, sparse: false },
  { name: 'sparse-200000-rows', rows: 200000, sparse: true }
];
const modules = { current: 'packages/xlsx/dist/index.js', baseline };
const files = ['scripts/benchmark-workbook-rows.mjs', 'packages/xlsx/test/fixtures/rows.mjs', 'packages/core/dist/index.js'];
const result = { engineering: true, date: new Date().toISOString(), iterations, cpu: os.cpus()[0].model,
  method: 'Fresh Chromium context per invocation; rotated engine order. Complete deterministic two-column sheet models and modules ready before timing. Measures createSheetTable(first 100 rows) and appendSheetRows(next 100 rows) synchronously, excluding input parsing, layout and paint. Each table is attached to a host; layout is settled before append timing. Full 200-row table HTML signatures are checked after timing. Not an end-to-end or peer/SOTA comparison.',
  artifacts: [...Object.entries(modules).map(([engine, file]) => ({ engine, path: file, sha256: hash(fs.readFileSync(path.join(root, file))) })),
    ...files.map(file => ({ path: file, sha256: hash(fs.readFileSync(path.join(root, file))) }))],
  samples, runs: [] };
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  res.setHeader('Cache-Control', 'no-store');
  if (name === '/') { res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><script type="importmap">${JSON.stringify({ imports: { '@filens/core': '/repo/packages/core/dist/index.js' } })}</script>`); return; }
  const file = path.resolve(root, name.startsWith('/repo/') ? name.slice(6) : 'missing');
  if (!file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
  try { res.setHeader('Content-Type', file.endsWith('.js') || file.endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream'); res.end(fs.readFileSync(file)); }
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
          const { createSheetFixture } = await import('/repo/packages/xlsx/test/fixtures/rows.mjs');
          const sheet = createSheetFixture(sample.rows, sample.sparse);
          const host = document.createElement('div'); document.body.replaceChildren(host);
          window.workbookRows = { lib, sheet, host };
        }, { module: modules[engine], sample });
        Object.assign(run, await page.evaluate(async () => {
          const { lib, sheet, host } = window.workbookRows;
          const start = performance.now();
          const table = lib.createSheetTable(sheet, 100); host.append(table);
          const initialRowsMs = performance.now() - start;
          table.getBoundingClientRect();
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const appendStart = performance.now();
          lib.appendSheetRows(table.tBodies[0], sheet, 101, 200);
          const appendRowsMs = performance.now() - appendStart;
          const sha = async data => [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(v => v.toString(16).padStart(2, '0')).join('');
          return { initialRowsMs, appendRowsMs, renderedRows: table.tBodies[0].rows.length,
            htmlSha256: await sha(new TextEncoder().encode(table.outerHTML)) };
        }));
      } catch (error) { run.failure = String(error); }
      result.runs.push(run);
      fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2) + '\n');
      console.log(JSON.stringify(run));
      await context.close();
    }
  }
} finally { await browser.close(); server.close(); }
