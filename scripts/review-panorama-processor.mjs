// Correctness-only comparison of source ownership changes; no timed ranking.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const baseline = option('--baseline', 'tmp/continued-review/panorama-processor-baseline/wasm-processor.ts');
assert(!path.isAbsolute(baseline) && !baseline.split(/[\\/]/).includes('..'));
const output = path.resolve(root, option('--output', 'tmp/continued-review/panorama-processor-content'));
fs.mkdirSync(output, { recursive: true });
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const binding = file => ({ path: path.relative(root, file), bytes: fs.statSync(file).size, sha256: sha(fs.readFileSync(file)) });
const sources = { baseline, current: 'packages/panorama/src/wasm-processor.ts', fixture: 'packages/panorama/test/fixtures/dng.ts' };
for (const [name, entry] of Object.entries(sources)) await build({ entryPoints: [path.join(root, entry)], outfile: path.join(output, `${name}.mjs`), bundle: true,
  platform: 'node', format: 'esm', sourcemap: true, logLevel: 'silent' });
const { dngFixture } = await import(pathToFileURL(path.join(output, 'fixture.mjs')));
const coreFile = path.join(root, 'wasm/converter-core/dist/converter-core.wasm');
const imageFile = path.join(root, 'wasm/converter-image/dist/converter-image.wasm');
const wasm = await WebAssembly.compile(fs.readFileSync(coreFile)), imageWasm = await WebAssembly.compile(fs.readFileSync(imageFile));
const libraries = Object.fromEntries(await Promise.all(['baseline', 'current'].map(async name => [name, await import(pathToFileURL(path.join(output, `${name}.mjs`)))])));
const result = { kind: 'complete-output-equivalence', measuredPerformance: false, scopedSota: false,
  method: 'Bundle previous/current processor sources against the same installed converter runtime, compile unchanged production WASM once, then compare complete manifests and developed JPEG bytes. Synthetic fixtures and one public ordinary DNG; no private originals. This is correctness validation, without timing or visual-quality/SOTA ranking.',
  artifacts: [...Object.values(sources).map(file => binding(path.join(root, file))), binding(coreFile), binding(imageFile),
    binding(path.join(root, 'scripts/review-panorama-processor.mjs')), binding(path.join(root, 'packages/converter-client/dist/index.js')),
    ...['baseline', 'current', 'fixture'].flatMap(name => [binding(path.join(output, `${name}.mjs`)), binding(path.join(output, `${name}.mjs.map`))])],
  samples: [], seam: undefined };
const samples = ['one-rs', 'x5', 'ordinary'].map(name => ({ name: `synthetic-${name}.dng`, bytes: dngFixture(name) }));
const publicFile = path.join(root, 'apps/demo/public/samples/raw/pentax-k-r.dng');
samples.push({ name: 'pentax-k-r.dng', bytes: new Uint8Array(fs.readFileSync(publicFile)), provenance: binding(publicFile) });
for (const sample of samples) {
  const runs = {};
  for (const [name, lib] of Object.entries(libraries)) {
    const processor = lib.createWasmPanoramaProcessor({ wasm, imageWasm });
    try {
      const manifest = await processor.open(sample.bytes, { format: 'dng' }), jpeg = await processor.decodeImage();
      runs[name] = { manifest, jpegBytes: jpeg.length, jpegSha256: sha(jpeg) };
    } finally { processor.close(); }
  }
  assert.deepEqual(runs.current, runs.baseline, sample.name);
  result.samples.push({ name: sample.name, inputBytes: sample.bytes.length, inputSha256: sha(sample.bytes),
    ...(sample.provenance ? { provenance: sample.provenance } : {}), identicalCompleteOutput: true, runs });
}
const request = { width: 128, height: 64, costs: Uint16Array.from({ length: 128 * 64 }, (_, i) => (i * 31 + 17) % 1000),
  previous: new Array(64).fill(64), temporalWeight: 3, maxStep: 2 };
const seams = {};
for (const [name, lib] of Object.entries(libraries)) {
  const processor = lib.createWasmPanoramaProcessor({ wasm });
  try { seams[name] = await processor.computeSeam(request); } finally { processor.close(); }
}
assert.deepEqual(seams.current, seams.baseline);
result.seam = { identicalCompleteOutput: true, requestSha256: sha(JSON.stringify({ ...request, costs: [...request.costs] })), outputs: seams };
fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ manifestsAndJpegsMatch: result.samples.length, fullSeamMatches: true, measuredPerformance: false }, null, 2));
