// Compare complete manifests without publishing private camera metadata.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const input = option('--input', process.env.INSP_SAMPLE);
const baseline = option('--baseline-wasm');
if (!input || !baseline) throw new Error('Provide --input and --baseline-wasm.');
const current = option('--wasm', 'wasm/converter-core/dist/converter-core.wasm');
const currentModule = option('--module', 'packages/panorama/dist/index.js');
const baselineModule = option('--baseline-module', currentModule);
const output = option('--output', 'tmp/performance-native-panorama/metadata-review.json');
const format = option('--format', 'insp');
const bytes = fs.readFileSync(input);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const results = [];
for (const [wasmPath, modulePath] of [[baseline, baselineModule], [current, currentModule]]) {
  const { createWasmPanoramaProcessor } = await import(pathToFileURL(path.resolve(modulePath)).href);
  const reads = [];
  class TracedBlob extends Blob {
    slice(start, end, type) { reads.push({ offset: start, length: end - start }); return super.slice(start, end, type); }
  }
  const wasmBytes = fs.readFileSync(wasmPath);
  const wasm = await WebAssembly.compile(wasmBytes);
  const processor = createWasmPanoramaProcessor({ wasm });
  const manifest = await processor.open(new TracedBlob([bytes]), { format });
  processor.close();
  results.push({ wasm: { path: wasmPath, sha256: hash(wasmBytes) },
    module: { path: modulePath, sha256: hash(fs.readFileSync(modulePath)) }, reads,
    readBytes: reads.reduce((sum, read) => sum + read.length, 0), manifest,
    manifestSha256: hash(JSON.stringify(manifest)) });
}
const unchanged = results[0].manifestSha256 === results[1].manifestSha256;
const review = { date: new Date().toISOString(), sampleSha256: hash(bytes), sampleBytes: bytes.length, format,
  cameraModel: results[1].manifest.cameraModel, width: results[1].manifest.width, height: results[1].manifest.height,
  completeManifestUnchanged: unchanged,
  note: 'All complete manifest fields, including intrinsics, distortion and extrinsics, are compared. The baseline adapter can be supplied separately when the core range ABI changes. Only hashes and byte ranges are published.',
  results: results.map(({ manifest, ...result }) => result) };
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(review, null, 2)}\n`);
console.log(JSON.stringify(review, null, 2));
if (!unchanged) throw new Error('Complete panorama manifest changed.');
