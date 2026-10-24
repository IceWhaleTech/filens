import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2), option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const input = option('--input', 'tmp/continued-review/model3d-gltf-final/results.json'), bytes = fs.readFileSync(input), result = JSON.parse(bytes);
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
      assert.equal(run.vertices, sample.triangles * 3); assert.equal(run.normalValues, sample.triangles * 9); assert.equal(run.meshes, 1); assert.equal(run.indexCount, 0);
      for (const field of ['positionsSha256', 'normalsSha256', 'min', 'max']) assert.deepEqual(run[field], sample[field], sample.name + ': ' + field);
      for (const field of ['material', 'warnings']) assert.deepEqual(run[field], reference[field], sample.name + ': ' + field);
      assert.equal(run.createdUrls, run.engine === 'current' ? 1 : 0); assert.equal(run.revokedUrls, run.createdUrls); assert.equal(run.activeOwnedUrls, 0);
    });
  }
  const a = current.map(run => run.loadMs), b = baseline.map(run => run.loadMs), before = median(b), after = median(a);
  const row = { sample: sample.name, bytes: sample.bytes, currentMs: after, baselineMs: before, below10MsControl: before <= 10,
    completePositionsNormalsBoundsMaterialsWarningsMatch: true, ownedUrlsReleased: true, scopedSota: false };
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
  method: 'glTF sidecar normalization and complete Three.js model load only. 10,000 paired bootstrap median-ratio resamples, seed 12345, for baseline medians above 10 ms. Smaller controls retain times but omit ratios. Generated geometry; no renderer, GPU, paint, peak-memory or peer/SOTA measurement.', samples };
fs.writeFileSync(option('--output', path.join(path.dirname(input), 'summary.json')), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
