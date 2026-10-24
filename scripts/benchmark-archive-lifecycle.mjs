// Same-project archive preview DOM construction and repeated directory navigation.
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
const args = process.argv.slice(2), option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const iterations = Number(option('--iterations', '7')); assert(Number.isSafeInteger(iterations) && iterations > 0);
const out = path.resolve(root, option('--output', 'tmp/continued-review/archive-lifecycle-final')); fs.mkdirSync(out, { recursive: true });
const baseline = option('--baseline', 'tmp/continued-review/archive-lifecycle-baseline/dist/index.js');
assert(!path.isAbsolute(baseline) && !baseline.split(/[\\/]/).includes('..'));
const modules = { baseline, current: 'packages/archive/dist/index.js' }, hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const specs = option('--smoke', '') ? [[200, 0], [1000, 0], [10000, 100]] : [[200, 0], [10000, 0], [100000, 1000]];
const samples = [];
for (const [count, directories] of specs) samples.push({ name: `generated-${count}-${directories}-directories.zip`, ...await createArchiveNavigationFixture(count, directories) });
const result = { engineering: true, scopedSota: false, date: new Date().toISOString(), cpu: os.cpus()[0].model, iterations,
  method: 'Fresh Chromium contexts, alternating engine order. Real generated ZIP files; imports and complete input bytes are ready before timing. loadMs includes input-view snapshot, complete ZIP indexing, initial directory listing and DOM construction until session.load resolves. navigationMs measures returning to a previously visited directory after its first visit and a return to the root, including directory selection and complete DOM construction. It deliberately tests repeated navigation, not cold random access. Input/module transfer, layout, paint/GPU, output verification, screenshots, archive creation and peak memory are excluded. All archive metadata, every file name and byte, complete listing HTML and viewport screenshot hashes are checked after timing. Only baseline medians above 10 ms receive ratios. Same-project engineering comparison, no peer/SOTA ranking.',
  artifacts: [...Object.entries(modules).map(([engine, name]) => ({ engine, path: name, sha256: hash(fs.readFileSync(path.join(root, name))) })),
    ...['packages/core/dist/index.js', ...fs.readdirSync(path.join(root, 'packages/core/dist')).filter(name => /^zip.*\.js$/.test(name)).map(name => 'packages/core/dist/' + name),
      'packages/archive/src/preview-driver.ts', 'packages/archive/dist/index.js.map', 'packages/archive/test/fixtures/lifecycle.mjs', 'scripts/benchmark-archive-lifecycle.mjs']
      .map(name => ({ path: name, sha256: hash(fs.readFileSync(path.join(root, name))) }))],
  samples: samples.map(sample => ({ name: sample.name, bytes: sample.bytes.length, files: sample.count, directories: sample.directories,
    archiveSha256: hash(sample.bytes), expectedContentSha256: sample.contentSha256 })), runs: [] };

const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store'); const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (name === '/') {
    res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><link rel="stylesheet" href="/repo/packages/archive/dist/index.css"><script type="importmap">${JSON.stringify({ imports: { '@filens/core': '/repo/packages/core/dist/index.js' } })}</script>`); return;
  }
  const sample = samples.find(sample => '/' + sample.name === name);
  if (sample) { res.setHeader('Content-Type', 'application/zip'); res.end(sample.bytes); return; }
  const file = path.resolve(root, name.startsWith('/repo/') ? name.slice(6) : 'missing');
  if (!file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
  try { res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(fs.readFileSync(file)); } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true }); result.browser = browser.version();
try {
  for (const sample of samples) for (let iteration = 0; iteration < iterations; iteration++) for (const engine of iteration % 2 ? ['baseline', 'current'] : ['current', 'baseline']) {
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, locale: 'en-US', timezoneId: 'UTC' }), page = await context.newPage();
    const run = { sample: sample.name, engine, iteration, errors: [] }; page.on('pageerror', error => run.errors.push(error.message));
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.evaluate(async ({ module, sample }) => {
        const [lib, buffer] = await Promise.all([import('/repo/' + module), fetch('/' + sample).then(response => response.arrayBuffer())]);
        const host = document.createElement('div'); host.style.width = '1000px'; document.body.append(host);
        window.archiveBenchmark = { lib, source: new Uint8Array(buffer), host };
      }, { module: modules[engine], sample: sample.name });
      Object.assign(run, await page.evaluate(async ({ name, directories, count }) => {
        const { lib, host, source } = window.archiveBenchmark, session = lib.createArchivePreviewDriver().createSession(host);
        window.archiveBenchmark.session = session;
        const sha = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
        const start = performance.now(); await session.load(source, { descriptor: { source, name, extension: 'zip' } }); const loadMs = performance.now() - start;
        const initialRows = session.getState().entries.length, initialHtmlSha256 = await sha(new TextEncoder().encode(host.innerHTML));
        let navigationMs = null;
        if (directories) {
          session.setRoute('/dir000/'); session.setRoute('/');
          const navigationStart = performance.now(); session.setRoute('/dir000/'); navigationMs = performance.now() - navigationStart;
        }
        const finalRows = session.getState().entries.length, finalHtmlSha256 = await sha(new TextEncoder().encode(host.innerHTML));
        const frame = session.archiveStack[0], metadata = [], contents = [];
        for (const entry of frame.entries) {
          metadata.push({ name: entry.name, type: entry.type, size: entry.size, modified: entry.modified });
          if (entry.type === 'file') contents.push({ name: entry.name, text: new TextDecoder().decode(await entry.read()) });
        }
        return { loadMs, navigationMs, fileCount: contents.length, initialRows, finalRows, expectedRows: directories ? Math.ceil(count / directories) : count,
          contentSha256: await sha(new TextEncoder().encode(JSON.stringify(contents))), metadataSha256: await sha(new TextEncoder().encode(JSON.stringify(metadata))), initialHtmlSha256, finalHtmlSha256,
          loading: session.getState().loading, error: session.getState().error };
      }, { name: sample.name, directories: sample.directories, count: sample.count }));
      await page.evaluate(() => document.fonts.ready); run.viewportPngSha256 = hash(await page.screenshot());
      await page.evaluate(() => window.archiveBenchmark.session.destroy());
    } catch (error) { run.failure = String(error); }
    result.runs.push(run); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(run));
    await context.close();
  }
} finally { await browser.close(); server.close(); }
if (result.runs.some(run => run.failure || run.errors.length)) process.exitCode = 1;
