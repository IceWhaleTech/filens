// Native text preview engineering A/B. This does not establish a peer/SOTA ranking.
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
assert(Number.isSafeInteger(iterations) && iterations > 0);
const baseline = option('--baseline', 'tmp/continued-review/text-preview-baseline/dist');
assert(!path.isAbsolute(baseline) && !baseline.split(/[\\/]/).includes('..'));
const output = path.resolve(root, option('--output', 'tmp/continued-review/text-preview-final'));
fs.mkdirSync(output, { recursive: true });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const modules = { baseline, current: 'packages/core/dist' };
const samples = [
  { name: 'log-20000-lines', lines: 20_000, extension: 'log' },
  { name: 'code-100000-lines', lines: 100_000, extension: 'js' },
  { name: 'code-200000-lines', lines: 200_000, extension: 'js' },
  { name: 'small-highlighted-code', lines: 40, extension: 'js' }
];
const result = { engineering: true, scopedSota: false, date: new Date().toISOString(), iterations,
  cpu: os.cpus()[0].model, samples,
  method: 'Fresh Chromium context per invocation, rotated build order; bytes and imports ready before timing. loadMs measures session creation plus complete native text load; loadAndLayoutMs also forces synchronous layout. Neither metric includes file I/O, module download, or paint. Text, every line number, state and attached DOM are checked after timing. Failures remain in raw runs. No optimization claim for baseline operations at or below 10 ms. No peer/SOTA comparison.',
  artifacts: [
    ...Object.entries(modules).flatMap(([engine, directory]) => ['index.js', 'index.css'].map(name => {
      const file = `${directory}/${name}`;
      return { engine, path: file, sha256: hash(fs.readFileSync(path.join(root, file))) };
    })),
    { path: 'scripts/benchmark-text-preview.mjs', sha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))) }
  ], runs: [] };
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (name === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><body></body>'); return; }
  const file = path.resolve(root, name.startsWith('/repo/') ? name.slice(6) : 'missing');
  if (!file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
  try {
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream');
    res.end(fs.readFileSync(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true }); result.browser = browser.version();
try {
  for (const sample of samples) for (let iteration = 0; iteration < iterations; iteration++) {
    for (const engine of iteration % 2 ? ['baseline', 'current'] : ['current', 'baseline']) {
      const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      const page = await context.newPage();
      const run = { sample: sample.name, engine, iteration, errors: [] };
      page.on('pageerror', error => run.errors.push(error.message));
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.evaluate(async ({ directory, sample }) => {
          const lib = await import(`/repo/${directory}/index.js`);
          const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = `/repo/${directory}/index.css`;
          await new Promise((resolve, reject) => { style.onload = resolve; style.onerror = reject; document.head.append(style); });
          const text = Array.from({ length: sample.lines }, (_, index) => `const row${index + 1} = ${index + 1};`).join('\n');
          const source = new TextEncoder().encode(text);
          const host = document.createElement('div'); host.style.cssText = 'width:960px;height:640px'; document.body.replaceChildren(host);
          host.getBoundingClientRect();
          window.textBenchmark = { lib, source, text, host };
        }, { directory: modules[engine], sample });
        Object.assign(run, await page.evaluate(async sample => {
          const { lib, source, text, host } = window.textBenchmark;
          const start = performance.now();
          const session = lib.createTextPreviewDriver().createSession(host);
          let failure;
          try { await session.load(source, { descriptor: { source, name: `sample.${sample.extension}`, extension: sample.extension },
            route: lib.resolveFormatRoute({ name: `sample.${sample.extension}` }) }); }
          catch (error) { failure = String(error); }
          const loadMs = performance.now() - start;
          const pre = host.querySelector('pre');
          const height = pre?.getBoundingClientRect().height;
          const loadAndLayoutMs = performance.now() - start;
          const gutter = host.querySelector('.pptxv-native-text-gutter');
          const numbers = gutter?.childElementCount ? [...gutter.children].map(line => line.textContent) : gutter?.textContent.split('\n');
          const state = session.getState();
          const out = { loadMs, loadAndLayoutMs, failure, height, lineCount: state.lineCount, stateError: state.error,
            contentMatches: pre?.textContent === text,
            numbersMatch: numbers?.length === sample.lines && numbers.every((number, index) => number === String(index + 1)),
            gutterElements: gutter?.childElementCount,
            highlighted: pre?.dataset.highlighted === 'true' };
          session.destroy(); out.destroyed = !host.childElementCount;
          return out;
        }, sample));
      } catch (error) { run.failure = String(error); }
      result.runs.push(run);
      fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n');
      console.log(JSON.stringify(run));
      await context.close();
    }
  }
} finally { await browser.close(); server.close(); }
