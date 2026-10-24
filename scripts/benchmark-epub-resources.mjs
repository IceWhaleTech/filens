// Complete ebook model extraction; engineering A/B, not a peer/SOTA comparison.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createBookFixture, createComicFixture, createAssetBookFixture } from '../packages/ebook/test/fixtures/books.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const iterations = Number(option('--iterations', '7'));
const baseline = option('--baseline', 'tmp/continued-review/epub-resources-baseline/dist/index.js');
assert(!path.isAbsolute(baseline) && !baseline.split(/[\\/]/).includes('..'));
const out = path.resolve(root, option('--output', 'tmp/continued-review/epub-resources'));
fs.mkdirSync(out, { recursive: true });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const samples = [
  { name: 'sample.epub', format: 'epub', bytes: fs.readFileSync(path.join(root, 'examples/go-wazero-converter/fixtures/doc/sample.epub')) },
  { name: 'generated-40-chapters.epub', format: 'epub', bytes: await createBookFixture() },
  { name: 'generated-200-assets.epub', format: 'epub', bytes: await createAssetBookFixture(200) },
  { name: 'generated-1000-assets.epub', format: 'epub', bytes: await createAssetBookFixture(1000) }
];
const modules = { current: 'packages/ebook/dist/index.js', baseline };
const result = { engineering: true, date: new Date().toISOString(), iterations, cpu: os.cpus()[0].model,
  method: 'Fresh Chromium context per invocation; rotated engine order. Source bytes and modules loaded before timing. Complete eager EPUB/CBZ extraction including decompression, resource URLs and serialized chapter HTML; no DOM display/image decoding or peer SOTA ranking. Full model and blob-byte SHA-256 signatures computed after timing. Generated SVG illustrations test per-resource overhead, not photographic payload throughput.',
  artifacts: [...Object.entries(modules).map(([engine, file]) => ({ engine, path: file, sha256: hash(fs.readFileSync(path.join(root, file))) })),
    ...['scripts/benchmark-epub-resources.mjs', 'packages/ebook/test/fixtures/books.mjs'].map(file => ({ path: file, sha256: hash(fs.readFileSync(path.join(root, file))) }))],
  samples: samples.map(({ name, format, bytes }) => ({ name, format, bytes: bytes.length, sha256: hash(bytes) })), runs: [] };
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  res.setHeader('Cache-Control', 'no-store');
  if (name === '/') { res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><script type="importmap">${JSON.stringify({ imports: { '@filens/core': '/repo/packages/core/dist/index.js' } })}</script>`); return; }
  const sample = samples.find(sample => name === '/' + sample.name);
  if (sample) { res.end(sample.bytes); return; }
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
          window.ebookBenchmark = { lib: await import('/repo/' + module), bytes: new Uint8Array(await (await fetch('/' + sample.name)).arrayBuffer()), sample };
        }, { module: modules[engine], sample: { name: sample.name, format: sample.format } });
        Object.assign(run, await page.evaluate(async () => {
          const { lib, bytes, sample } = window.ebookBenchmark;
          const blobs = [];
          const createUrl = blob => { blobs.push(blob); return `blob:benchmark-${blobs.length}`; };
          const start = performance.now();
          const book = await lib[sample.format === 'cbz' ? 'loadCbzBook' : 'loadEpubBook'](bytes, { descriptor: { source: bytes, name: sample.name, extension: sample.format } }, createUrl);
          const durationMs = performance.now() - start;
          const sha = async data => [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(v => v.toString(16).padStart(2, '0')).join('');
          const blobSignatures = [];
          for (const blob of blobs) blobSignatures.push({ type: blob.type, size: blob.size, sha256: await sha(await blob.arrayBuffer()) });
          return { durationMs, chapters: book.chapters.length, modelSha256: await sha(new TextEncoder().encode(JSON.stringify(book))), blobsSha256: await sha(new TextEncoder().encode(JSON.stringify(blobSignatures))), blobCount: blobs.length };
        }));
      } catch (error) { run.failure = String(error); }
      result.runs.push(run);
      fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2) + '\n');
      console.log(JSON.stringify(run));
      await context.close();
    }
  }
} finally { await browser.close(); server.close(); }
