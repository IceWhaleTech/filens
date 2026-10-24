import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2), option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const input = option('--input', 'tmp/continued-review/obj-resources-final/results.json'), bytes = fs.readFileSync(input), result = JSON.parse(bytes);
assert.equal(result.engineering, true); assert.equal(result.runs.length, result.samples.length * result.iterations * 2);
const median = values => { const a = [...values].sort((a, b) => a - b), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
let seed = 12345; const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const samples = result.samples.map(sample => {
  const group = engine => result.runs.filter(run => run.sample === sample.name && run.engine === engine).sort((a, b) => a.iteration - b.iteration);
  const current = group('current'), baseline = group('baseline'), reference = baseline[0];
  for (const runs of [current, baseline]) {
    assert.equal(runs.length, result.iterations);
    runs.forEach((run, i) => {
      assert.equal(run.iteration, i); assert(!run.failure, run.failure); assert.deepEqual(run.errors, []); assert(Number.isFinite(run.loadMs) && run.loadMs > 0);
      assert.equal(run.resolverCalls, 2); assert.equal(run.imageLoads, 1); assert.equal(run.meshes, 1); assert.deepEqual(run.dimensions, [sample.side, sample.side]);
      assert.equal(run.pixelsSha256, sample.pixelsSha256);
      for (const field of ['positions', 'normals', 'uv']) assert.deepEqual(run[field], result.fixture[field]);
      for (const field of ['material', 'warnings']) assert.deepEqual(run[field], reference[field]);
      assert.deepEqual(run.warnings, []); assert.equal(run.material.name, 'base'); assert.deepEqual(run.material.color, [1, 1, 1]);
      assert.equal(run.createdUrls, run.engine === 'current' ? 1 : 0); assert.equal(run.revokedUrls, run.createdUrls); assert.equal(run.activeOwnedUrls, 0);
    });
  }
  const a = current.map(run => run.loadMs), b = baseline.map(run => run.loadMs), before = median(b), after = median(a);
  const row = { sample: sample.name, bytes: sample.bytes, currentMs: after, baselineMs: before, below10MsControl: before <= 10,
    fullGeometryMaterialsDecodedTexturePixelsMatch: true, ownedUrlsReleased: true, scopedSota: false };
  if (before > 10) {
    const ratios = [];
    for (let i = 0; i < 10000; i++) { const indices = a.map(() => Math.floor(random() * a.length)); ratios.push(median(indices.map(i => b[i])) / median(indices.map(i => a[i]))); }
    ratios.sort((a, b) => a - b); row.ratio = before / after; row.ratio95PercentBootstrapInterval = [ratios[250], ratios[9750]]; row.stableEngineeringReduction = ratios[250] > 1;
  }
  return row;
});
const report = { engineering: true, scopedSota: false, sourceSha256: crypto.createHash('sha256').update(bytes).digest('hex'), cpu: result.cpu,
  browser: result.browser, iterations: result.iterations, runs: result.runs.length,
  method: 'Complete OBJ/MTL and referenced texture decoding from in-memory native sources. Both versions explicitly await HTMLImageElement.decode() through the same TextureLoader observer. 10,000 paired bootstrap median-ratio resamples, seed 12345, only for baseline medians above 10 ms. Generated textures; excludes input transfer, module loading, renderer/GPU/paint and peak memory. No peer/SOTA measurement.', samples };
fs.writeFileSync(option('--output', path.join(path.dirname(input), 'summary.json')), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
