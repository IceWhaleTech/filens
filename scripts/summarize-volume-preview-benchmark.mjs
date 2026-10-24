import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2), option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const input = option('--input', 'tmp/continued-review/volume-preview-final/results.json'), bytes = fs.readFileSync(input), result = JSON.parse(bytes);
assert.equal(result.runs.length, result.samples.length * result.iterations * 2);
const median = values => { const a = [...values].sort((a, b) => a - b), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
let seed = 12345; const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const samples = result.samples.map(sample => {
  const group = engine => result.runs.filter(run => run.sample === sample.name && run.engine === engine).sort((a, b) => a.iteration - b.iteration);
  const current = group('current'), baseline = group('baseline');
  for (const runs of [current, baseline]) {
    assert.equal(runs.length, result.iterations);
    runs.forEach((run, i) => {
      assert.equal(run.iteration, i); assert(!run.failure, run.failure); assert.deepEqual(run.errors, []); assert(Number.isFinite(run.prepareMs) && run.prepareMs > 0);
      assert.equal(run.resolverCalls, 1); assert.equal(run.payloadBytes, sample.bytes);
      assert.equal(run.payloadSha256, sample.payloadSha256); assert.equal(run.inputSha256, sample.payloadSha256);
      assert.deepEqual(run.fields, { type: 'uchar', dimension: '3', sizes: `${sample.side} ${sample.side} ${sample.side}`, spacings: '1 2 3', encoding: 'raw' });
      if (run.engine === 'current') { assert.equal(run.decodedVoxels, sample.voxels); assert.equal(run.decodedSha256, sample.payloadSha256); assert.equal(run.decodedVoxelsMatchInput, true); }
    });
  }
  const a = current.map(run => run.prepareMs), b = baseline.map(run => run.prepareMs), before = median(b), after = median(a);
  const row = { sample: sample.name, bytes: sample.bytes, currentMs: after, baselineMs: before, below10MsControl: before <= 10,
    completePreparedPayloadAndCanonicalMetadataMatch: true, currentCompleteDecodedVoxelsMatchInput: true,
    baselineCorrectDecodedRuns: baseline.filter(run => run.decodedVoxelsMatchInput).length, scopedSota: false };
  if (before > 10) {
    const ratios = [];
    for (let i = 0; i < 10000; i++) { const indices = a.map(() => Math.floor(random() * a.length)); ratios.push(median(indices.map(i => b[i])) / median(indices.map(i => a[i]))); }
    ratios.sort((a, b) => a - b); row.ratio = before / after; row.ratio95PercentBootstrapInterval = [ratios[250], ratios[9750]]; row.stableEngineeringReduction = ratios[250] > 1;
  }
  return row;
});
const report = { engineering: true, scopedSota: false, sourceSha256: crypto.createHash('sha256').update(bytes).digest('hex'), cpu: result.cpu,
  browser: result.browser, iterations: result.iterations, runs: result.runs.length,
  method: 'Detached raw NHDR preparation only, excluding decoding, point construction, GPU/paint, input transfer, module loading and peak memory. 10,000 paired bootstrap median-ratio resamples, seed 12345, only for baseline medians above 10 ms. Complete prepared payload/metadata match. Current decoded voxels are separately checked after timing; original header decoding failures are retained. Same-project generated-input comparison, no SOTA ranking.', samples };
fs.writeFileSync(option('--output', path.join(path.dirname(input), 'summary.json')), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
