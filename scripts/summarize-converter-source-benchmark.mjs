import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2), option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const input = option('--input', 'tmp/continued-review/converter-source-final/results.json'), bytes = fs.readFileSync(input), result = JSON.parse(bytes);
assert(result.engineering); assert.equal(result.runs.length, result.samples.length * result.iterations * 2);
const median = values => { const sorted = [...values].sort((a, b) => a - b), i = sorted.length >> 1; return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2; };
let seed = 12345; const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const samples = result.samples.map(sample => {
  const group = engine => result.runs.filter(run => run.engine === engine && run.sample === sample.name).sort((a, b) => a.iteration - b.iteration);
  const current = group('current'), baseline = group('baseline');
  for (const runs of [current, baseline]) {
    assert.equal(runs.length, result.iterations);
    runs.forEach((run, i) => {
      assert.equal(run.iteration, i); assert(!run.failure, run.failure); assert.deepEqual(run.pageErrors, []);
      assert(Number.isFinite(run.elapsedMs) && run.elapsedMs >= 0);
      assert.equal(run.content.sha256, sample.sha256); assert.equal(run.content.bytes, sample.bytes);
      assert.deepEqual(run.content, current[0].content);
    });
  }
  const a = current.map(run => run.elapsedMs), b = baseline.map(run => run.elapsedMs), am = median(a), bm = median(b), ratios = [];
  if (bm > 10 && am > 0) for (let j = 0; j < 10000; j++) {
    const indexes = a.map(() => Math.floor(random() * a.length)), denominator = median(indexes.map(i => a[i]));
    ratios.push(denominator ? median(indexes.map(i => b[i])) / denominator : Infinity);
  }
  ratios.sort((a, b) => a - b);
  const interval = ratios.length ? [ratios[250], ratios[9750]] : null;
  return { sample: sample.name, bytes: sample.bytes, baselineMs: bm, currentMs: am, below10MsControl: bm <= 10,
    ratio: ratios.length ? bm / am : null, pairedBootstrapRatio95: interval,
    stableEngineeringReduction: result.iterations >= 7 && bm > 10 && interval?.[0] > 1, completeUploadedBytesMatch: true, scopedSota: false };
});
const report = { engineering: true, scopedSota: false, sourceSha256: crypto.createHash('sha256').update(bytes).digest('hex'), iterations: result.iterations,
  runs: result.runs.length, cpu: result.cpu, browser: result.browser,
  method: '10,000 paired bootstrap resamples of median ratios, seed 12345. Seven repeats, baseline >10 ms and a 95% interval above 1 required for a stable reduction. HTTP adapter input preparation only: no network, HTTP serialization, server conversion, rendering or peak-memory claim. Every payload hash, snapshot and response checked after timing.', samples };
fs.writeFileSync(option('--output', path.join(path.dirname(input), 'summary.json')), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
