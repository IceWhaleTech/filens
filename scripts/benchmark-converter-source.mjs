// HTTP adapter input preparation A/B; excludes transport and format conversion.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const iterations = Number(option('--iterations', '7')); assert(Number.isSafeInteger(iterations) && iterations > 0);
const output = path.resolve(root, option('--output', 'tmp/continued-review/converter-source-final')); fs.mkdirSync(output, { recursive: true });
const modules = { baseline: option('--baseline', 'tmp/continued-review/converter-source-baseline/dist/index.js'), current: 'packages/converter-client/dist/index.js' };
for (const file of Object.values(modules)) assert(!path.isAbsolute(file) && !file.split(/[\\/]/).includes('..'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const payload = size => { const bytes = Buffer.allocUnsafe(size); for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 17) & 255; return bytes; };
const large = payload(64 << 20), small = large.subarray(0, 8 << 20);
const samples = ['uint8array', 'subview', 'arraybuffer', 'blob', 'base64'].map(kind => ({
  name: kind, bytes: kind === 'base64' ? small.length : large.length, sha256: sha(kind === 'base64' ? small : large)
}));
const artifacts = [...Object.values(modules), 'packages/converter-client/src/index.ts', 'packages/converter-client/src/source.ts', 'scripts/benchmark-converter-source.mjs'];
const result = {
  date: new Date().toISOString(), engineering: true, scopedSota: false, cpu: os.cpus()[0].model, platform: `${os.platform()} ${os.release()} ${os.arch()}`,
  node: process.version, iterations, samples,
  method: 'Fresh Chromium context per invocation, rotating build order. Imports and synthetic inputs ready before timing. Public HTTP convert() includes Blob/FormData preparation, an in-process custom fetch and tiny JSON response decoding. No HTTP serialization, network, server conversion, renderer, peak-memory or peer/SOTA measurement. After timing verify all uploaded bytes, snapshot/slice ownership, filename/type and response bytes. Ignore speed claims where baseline median is <=10 ms; retain all runs.',
  artifacts: artifacts.map(file => ({ path: file, sha256: sha(fs.readFileSync(path.join(root, file))) })), runs: []
};
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); res.setHeader('Cache-Control', 'no-store');
  if (pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html>'); return; }
  if (pathname === '/large') { res.end(large); return; }
  if (pathname === '/small') { res.end(small); return; }
  const file = path.resolve(root, pathname.slice('/repo/'.length));
  if (!pathname.startsWith('/repo/') || !file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
  try { res.setHeader('Content-Type', /\.(mjs|js)$/.test(file) ? 'text/javascript' : 'application/octet-stream'); res.end(fs.readFileSync(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true }); result.browser = browser.version();
try {
  for (const sample of samples) for (let iteration = 0; iteration < iterations; iteration++) for (const engine of iteration % 2 ? ['baseline', 'current'] : ['current', 'baseline']) {
    const context = await browser.newContext(), page = await context.newPage();
    const run = { sample: sample.name, engine, iteration, pageErrors: [] }; page.on('pageerror', error => run.pageErrors.push(error.message));
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.evaluate(async ({ module, sample }) => {
        const lib = await import('/repo/' + module);
        let bytes = new Uint8Array(await (await fetch(sample.name === 'base64' ? '/small' : '/large')).arrayBuffer()), source;
        if (sample.name === 'subview') {
          const backing = new Uint8Array(bytes.length + 22); backing.fill(231); backing.set(bytes, 11); bytes = backing.subarray(11, 11 + bytes.length);
        }
        if (sample.name === 'blob') source = new Blob([bytes], { type: 'application/octet-stream' });
        else if (sample.name === 'arraybuffer') source = bytes.buffer;
        else if (sample.name === 'base64') {
          const blocks = []; for (let i = 0; i < bytes.length; i += 32768) blocks.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
          source = 'data:application/octet-stream;base64,' + btoa(blocks.join(''));
        } else source = bytes;
        const state = window.converterSource = { bytes, source, sample };
        state.client = lib.createHttpConverterClient({ endpoint: '/convert', fetch: async (url, init) => {
          if (url !== '/convert' || init.method !== 'POST') throw new Error('Unexpected adapter request');
          state.file = init.body.get('file');
          return new Response('{"text":"accepted","format":"bin"}', { headers: { 'Content-Type': 'application/json' } });
        } });
      }, { module: modules[engine], sample });
      Object.assign(run, await page.evaluate(async () => {
        const state = window.converterSource, { source, bytes, sample, client } = state;
        const started = performance.now();
        const result = await client.convert({ source, sourceFormat: 'bin', targetFormat: 'bin', name: 'payload.bin' }, { descriptor: { source, name: 'payload.bin' } });
        const elapsedMs = performance.now() - started; state.measured = { elapsedMs };
        // Mutation happens after the public call completes, outside the timed section.
        bytes.fill(0); if (sample.name === 'subview') new Uint8Array(bytes.buffer).fill(0);
        const file = state.file, uploaded = await file.arrayBuffer();
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', uploaded))].map(byte => byte.toString(16).padStart(2, '0')).join('');
        const content = { bytes: uploaded.byteLength, sha256: digest, filename: file.name, contentType: file.type, response: [...result.source], format: result.format };
        state.measured.content = content;
        if (uploaded.byteLength !== sample.bytes || digest !== sample.sha256) throw new Error('Uploaded bytes or snapshot changed');
        if (file.name !== 'payload.bin' || file.type !== 'application/octet-stream' || result.format !== 'bin' || new TextDecoder().decode(result.source) !== 'accepted') throw new Error('Changed HTTP adapter contract');
        return { elapsedMs, content };
      }));
    } catch (error) { Object.assign(run, await page.evaluate(() => window.converterSource?.measured).catch(() => undefined)); run.failure = String(error); }
    result.runs.push(run); fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(run));
    await context.close();
  }
} finally { await browser.close(); server.close(); }
