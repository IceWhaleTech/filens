// Native audio input setup only; engineering A/B, not decoder throughput or peer/SOTA timing.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createWavFixture } from '../packages/core/test/fixtures/native-media.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const iterations = Number(option('--iterations', '7'));
assert(Number.isSafeInteger(iterations) && iterations > 0);
const baseline = option('--baseline', 'tmp/continued-review/native-lifecycle-baseline/dist/index.js');
assert(!path.isAbsolute(baseline) && !baseline.split(/[\\/]/).includes('..'));
const out = path.resolve(root, option('--output', 'tmp/continued-review/native-media-final')); fs.mkdirSync(out, { recursive: true });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const samples = ['typed', 'subview', 'array-buffer', 'blob'].map(kind => ({ name: `${kind}-64MiB-wav`, kind, byteLength: 64 * 1024 ** 2 }));
const expected = hash(createWavFixture(samples[0].byteLength));
const modules = { baseline, current: 'packages/core/dist/index.js' };
const files = ['scripts/benchmark-native-media.mjs', 'packages/core/test/fixtures/native-media.mjs'];
const result = { engineering: true, scopedSota: false, date: new Date().toISOString(), iterations, cpu: os.cpus()[0].model,
  method: 'Fresh Chromium context per invocation, rotating build order; modules and deterministic valid 64 MiB WAV inputs ready before timing. Measures native session creation, complete load() setup, Blob URL creation and optional artwork inspection; excludes metadata readiness, audible playback, file I/O, download, layout/paint and module loading. Complete Blob bytes and browser metadata are checked after timing. Not codec throughput, total-memory measurement, peer comparison or SOTA ranking.',
  samples, expectedPayloadSha256: expected,
  artifacts: [...Object.entries(modules).map(([engine, file]) => ({ engine, path: file, sha256: hash(fs.readFileSync(path.join(root, file))) })),
    ...files.map(file => ({ path: file, sha256: hash(fs.readFileSync(path.join(root, file))) }))], runs: [] };
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (name === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><body></body>'); return; }
  const file = path.resolve(root, name.startsWith('/repo/') ? name.slice(6) : 'missing');
  if (!file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
  try { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true }); result.browser = browser.version();
try {
  for (const sample of samples) for (let iteration = 0; iteration < iterations; iteration++) {
    for (const engine of iteration % 2 ? ['baseline', 'current'] : ['current', 'baseline']) {
      const context = await browser.newContext(); const page = await context.newPage();
      const run = { sample: sample.name, engine, iteration, errors: [] };
      page.on('pageerror', error => run.errors.push(error.message));
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.evaluate(async ({ module, sample }) => {
          const lib = await import('/repo/' + module);
          const { createWavFixture } = await import('/repo/packages/core/test/fixtures/native-media.mjs');
          const bytes = createWavFixture(sample.byteLength);
          let source = bytes;
          if (sample.kind === 'subview') {
            const storage = new Uint8Array(bytes.length + 32); storage.fill(91); storage.set(bytes, 16); source = storage.subarray(16, -16);
          } else if (sample.kind === 'array-buffer') source = bytes.buffer;
          else if (sample.kind === 'blob') source = new Blob([bytes], { type: 'audio/wav' });
          const host = document.createElement('div'); document.body.replaceChildren(host);
          window.nativeMediaBenchmark = { lib, source, host };
        }, { module: modules[engine], sample });
        Object.assign(run, await page.evaluate(async sample => {
          const { lib, source, host } = window.nativeMediaBenchmark;
          const start = performance.now(); const session = lib.createMediaPreviewDriver().createSession(host);
          await session.load(source, { descriptor: { source, name: 'fixture.wav', extension: 'wav' }, route: lib.resolveFormatRoute({ name: 'fixture.wav' }) });
          const setupMs = performance.now() - start;
          const audio = host.querySelector('audio');
          const url = audio.querySelector('source')?.src || audio.src;
          const metadata = new Promise((resolve, reject) => {
            if (audio.readyState >= 1) { resolve(); return; }
            const timeout = setTimeout(() => reject(new Error('Audio metadata timeout')), 5000);
            audio.addEventListener('loadedmetadata', () => { clearTimeout(timeout); resolve(); }, { once: true });
            audio.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Invalid WAV metadata')); }, { once: true });
          });
          const payload = await (await fetch(url)).arrayBuffer(); await metadata;
          const payloadSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', payload))].map(v => v.toString(16).padStart(2, '0')).join('');
          const state = session.getState(); const duration = audio.duration;
          session.destroy();
          return { setupMs, payloadBytes: payload.byteLength, payloadSha256, duration, stateError: state.error,
            expectedDuration: (sample.byteLength - 44) / 16000, destroyed: !host.childElementCount };
        }, sample));
      } catch (error) { run.failure = String(error); }
      result.runs.push(run); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2) + '\n');
      console.log(JSON.stringify(run)); await context.close();
    }
  }
} finally { await browser.close(); server.close(); }
