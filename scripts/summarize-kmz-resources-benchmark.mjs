import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2), option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const input = option('--input', 'tmp/continued-review/kmz-resources-final/results.json'), bytes = fs.readFileSync(input), result = JSON.parse(bytes);
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
      assert.equal(run.meshes, 1); assert.equal(run.imageLoads, 1);
      for (const field of ['positions', 'normals', 'uv', 'decodedPixelsSha256']) assert.deepEqual(run[field], sample[field]);
      assert.deepEqual(run.material, reference.material); assert.equal(run.material.name, '底色0'); assert.deepEqual(run.dimensions, [8, 8]); assert.deepEqual(run.warnings, []);
      assert.equal(run.createdUrls, 1); assert.equal(run.revokedUrls, run.engine === 'current' ? 1 : 0); assert.equal(run.activeOwnedUrls, run.engine === 'current' ? 0 : 1);
    });
  }
  const a = current.map(run => run.loadMs), b = baseline.map(run => run.loadMs), before = median(b), after = median(a);
  const row = { sample: sample.name, bytes: sample.bytes, unusedImages: sample.unusedImages, unusedDecodedBytes: sample.unusedDecodedBytes,
    currentMs: after, baselineMs: before, below10MsControl: before <= 10, completeGeometryMaterialsDecodedPixelsMatch: true, scopedSota: false };
  if (before > 10) {
    const ratios = [];
    for (let i = 0; i < 10000; i++) { const indices = a.map(() => Math.floor(random() * a.length)); ratios.push(median(indices.map(i => b[i])) / median(indices.map(i => a[i]))); }
    ratios.sort((a, b) => a - b); row.ratio = before / after; row.ratio95PercentBootstrapInterval = [ratios[250], ratios[9750]];
    row.stableEngineeringReduction = ratios[250] > 1;
  }
  return row;
});
const report = { engineering: true, scopedSota: false, sourceSha256: crypto.createHash('sha256').update(bytes).digest('hex'), cpu: result.cpu,
  browser: result.browser, iterations: result.iterations, runs: result.runs.length,
  method: 'Complete KMZ model loading plus explicit referenced-image decode. One used 8x8 texture, 0/8/32 unused valid PNG images; targets selective archive decompression. Original exported sync path is the original preview fast path for these root-doc.kml inputs. Excludes input/module transfer, GPU/paint and peak memory. 10,000 paired bootstrap median-ratio resamples, seed 12345, only for baseline medians above 10 ms. Same-project engineering comparison; no peer/SOTA ranking.', samples };
fs.writeFileSync(option('--output', path.join(path.dirname(input), 'summary.json')), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
