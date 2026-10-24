// Frontend WASI I/O engineering A/B; no peer/SOTA ranking.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createWasiWriteFixture } from '../packages/converter-client/test/fixtures/wasi.mjs';
import { createImageDocmFixture } from '../packages/converter-client/test/fixtures/office.mjs';
import { createPngFixture } from '../packages/cad/test/fixtures/resources.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const iterations = Number(option('--iterations', '7')); assert(Number.isSafeInteger(iterations) && iterations > 0);
const baseline = option('--baseline', 'tmp/continued-review/converter-io-baseline/dist/index.js');
assert(!path.isAbsolute(baseline) && !baseline.split(/[\\/]/).includes('..'));
const output = path.resolve(root, option('--output', 'tmp/continued-review/converter-io-final')); fs.mkdirSync(output, { recursive: true });
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const png = await createPngFixture(512), samples = [];
for (const [totalBytes, blockBytes] of [[64 << 10, 4096], [8 << 20, 16 << 10], [32 << 20, 64 << 10]]) {
  const { wasm, pattern } = createWasiWriteFixture(totalBytes, blockBytes), expected = crypto.createHash('sha256');
  for (let offset = 0; offset < totalBytes; offset += blockBytes) expected.update(pattern);
  samples.push({ name: `wasi-${totalBytes}-${blockBytes}`, kind: 'io', bytes: wasm, totalBytes, blockBytes, expectedSha256: expected.digest('hex') });
}
for (const images of [4, 16]) samples.push({ name: `generated-${images}-images.docm`, kind: 'conversion', format: 'docm', images, bytes: await createImageDocmFixture(png, images) });
samples.push({ name: 'rich-text.rtf', kind: 'conversion', format: 'rtf', bytes: fs.readFileSync(path.join(root, 'apps/demo/public/samples/rich-text.rtf')) });
const modules = { current: 'packages/converter-client/dist/index.js', baseline };
const artifacts = [...Object.values(modules), 'wasm/converter-core/dist/converter-core.wasm', 'packages/converter-client/src/wasm-client.ts', 'scripts/benchmark-converter-io.mjs', 'packages/converter-client/test/fixtures/wasi.mjs', 'packages/converter-client/test/fixtures/office.mjs', 'packages/cad/test/fixtures/resources.mjs', 'node_modules/fflate/esm/browser.js', 'apps/demo/public/samples/rich-text.rtf'];
const result = { engineering: true, scopedSota: false, date: new Date().toISOString(), cpu: os.cpus()[0].model, platform: `${os.platform()} ${os.release()} ${os.arch()}`, node: process.version, iterations,
  method: 'Fresh Chromium context per invocation, alternating old/new order. Main imports, source bytes and compiled WASM ready before timing. IO cases execute an actual generated WASM producer through createWasmCoreRunner, including fresh instantiation, host writes and output extraction. Conversion cases use the unchanged real document converter-core.wasm via createWasmConverterClient. Hashing, full package-part validation, macro-removal checks and PNG decoding are after timing. No rendering/paint, peak-memory or peer/SOTA claim. Ignore speed claims for baseline median at or below 10 ms.',
  artifacts: artifacts.map(file => ({ path: file, sha256: sha(fs.readFileSync(path.join(root, file))) })),
  samples: samples.map(({ bytes, ...sample }) => ({ ...sample, sourceBytes: bytes.byteLength, sourceSha256: sha(bytes), ...(sample.images ? { imageSha256: sha(png), imageBytes: png.length, imageSize: 512 } : {}) })), runs: [] };
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); res.setHeader('Cache-Control', 'no-store');
  if (name === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html>'); return; }
  const sample = samples.find(sample => '/input/' + sample.name === name); if (sample) { res.end(sample.bytes); return; }
  const file = path.resolve(root, name.slice('/repo/'.length));
  if (!name.startsWith('/repo/') || !file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
  try { res.setHeader('Content-Type', /\.(js|mjs)$/.test(file) ? 'text/javascript' : file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream'); res.end(fs.readFileSync(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const browser = await chromium.launch({ headless: true }); result.browser = browser.version();
try {
  for (const sample of result.samples) for (let iteration = 0; iteration < iterations; iteration++) for (const engine of iteration % 2 ? ['baseline', 'current'] : ['current', 'baseline']) {
    const context = await browser.newContext(), page = await context.newPage(); page.setDefaultTimeout(120000);
    const run = { sample: sample.name, kind: sample.kind, engine, iteration, pageErrors: [] }; page.on('pageerror', error => run.pageErrors.push(error.message));
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.evaluate(async ({ module, sample }) => {
        const lib = await import('/repo/' + module), { unzipSync } = await import('/repo/node_modules/fflate/esm/browser.js');
        const input = new Uint8Array(await (await fetch('/input/' + sample.name)).arrayBuffer());
        const wasm = await WebAssembly.compile(sample.kind === 'io' ? input : await (await fetch('/repo/wasm/converter-core/dist/converter-core.wasm')).arrayBuffer());
        window.converterIo = { input, sample, unzipSync, runner: lib.createWasmCoreRunner({ wasm }), client: lib.createWasmConverterClient({ wasm }) };
      }, { module: modules[engine], sample });
      Object.assign(run, await page.evaluate(async () => {
        const { input, sample, unzipSync, runner, client } = window.converterIo;
        const hash = async data => [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(value => value.toString(16).padStart(2, '0')).join('');
        let output, contract;
        const started = performance.now();
        if (sample.kind === 'io') { const result = await runner({ args: ['generated-writer'], files: {}, readFiles: ['/work/output.bin'] }); if (result.exitCode !== 0) throw new Error('WASM producer failed'); output = result.files['/work/output.bin']; }
        else { const result = await client.convert({ source: input, sourceFormat: sample.format, targetFormat: 'docx', name: sample.name }, { descriptor: { source: input, name: sample.name, extension: sample.format } }); output = result.source; contract = { format: result.format, contentType: result.contentType, warnings: result.warnings }; }
        const elapsedMs = performance.now() - started; window.converterIo.measured = { elapsedMs };
        const content = { outputBytes: output.byteLength, outputSha256: await hash(output), ...(contract ? { contract } : {}) };
        window.converterIo.measured.content = content;
        if (sample.kind === 'io') { if (content.outputBytes !== sample.totalBytes || content.outputSha256 !== sample.expectedSha256) throw new Error('Incomplete WASI output'); }
        else {
          const entries = unzipSync(output), parts = [];
          for (const name of Object.keys(entries).sort()) {
            if (/vbaProject/i.test(name)) throw new Error('Macro part retained');
            if (/\.(xml|rels)$/.test(name)) { const doc = new DOMParser().parseFromString(new TextDecoder().decode(entries[name]), 'application/xml'); if (doc.querySelector('parsererror')) throw new Error('Invalid XML ' + name); }
            parts.push({ name, bytes: entries[name].length, sha256: await hash(entries[name]) });
          }
          content.parts = parts; content.decodedImages = [];
          for (const name of Object.keys(entries).filter(name => name.endsWith('.png')).sort()) {
            const image = await createImageBitmap(new Blob([entries[name]], { type: 'image/png' }));
            content.decodedImages.push({ name, width: image.width, height: image.height }); image.close();
          }
          if (sample.images) {
            const original = unzipSync(input);
            for (const name of Object.keys(original)) if (name !== '[Content_Types].xml' && name !== 'word/vbaProject.bin' && !name.endsWith('.rels')) {
              if (!entries[name] || await hash(original[name]) !== await hash(entries[name])) throw new Error('Changed preserved part ' + name);
            }
            for (const name of Object.keys(original).filter(name => name.endsWith('.rels'))) {
              const relationships = bytes => [...new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml').getElementsByTagNameNS('*', 'Relationship')].filter(node => !node.getAttribute('Type').includes('vbaProject')).map(node => ['Id','Type','Target','TargetMode'].map(key => node.getAttribute(key))).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
              if (JSON.stringify(relationships(original[name])) !== JSON.stringify(relationships(entries[name]))) throw new Error('Changed relationship contract ' + name);
            }
            if (content.decodedImages.length !== sample.images || content.decodedImages.some(image => image.width !== 512 || image.height !== 512)) throw new Error('Missing image');
            for (const part of parts.filter(part => part.name.endsWith('.png'))) if (part.sha256 !== sample.imageSha256) throw new Error('Changed PNG payload');
            const types = new TextDecoder().decode(entries['[Content_Types].xml']), relationships = new TextDecoder().decode(entries['word/_rels/document.xml.rels']);
            if (/macroEnabled|vbaProject/.test(types) || /vbaProject/.test(relationships) || !types.includes('wordprocessingml.document.main+xml')) throw new Error('Normalization contract failed');
          }
        }
        return { elapsedMs, content };
      }));
    } catch (error) { Object.assign(run, await page.evaluate(() => window.converterIo?.measured).catch(() => undefined)); run.failure = String(error); }
    result.runs.push(run); fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(run)); await context.close();
  }
} finally { await browser.close(); server.close(); }
