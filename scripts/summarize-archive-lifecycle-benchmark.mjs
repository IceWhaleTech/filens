import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2), option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const input = option('--input', 'tmp/continued-review/archive-lifecycle-final/results.json'), bytes = fs.readFileSync(input), raw = JSON.parse(bytes);
assert.equal(raw.engineering, true); assert.equal(raw.runs.length, raw.iterations * raw.samples.length * 2);
const median = values => { const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1; return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
let seed = 12345; const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const samples = raw.samples.map(sample => {
  const select = engine => raw.runs.filter(run => run.sample === sample.name && run.engine === engine).sort((a, b) => a.iteration - b.iteration);
  const current = select('current'), baseline = select('baseline'), reference = baseline[0];
  for (const runs of [current, baseline]) {
    assert.equal(runs.length, raw.iterations);
    runs.forEach((run, i) => {
      assert.equal(run.iteration, i); assert(!run.failure, run.failure); assert.deepEqual(run.errors, []);
      assert.equal(run.loading, false); assert.equal(run.error, null); assert.equal(run.fileCount, sample.files);
      assert.equal(run.initialRows, sample.directories || sample.files); assert.equal(run.finalRows, run.expectedRows);
      assert.equal(run.contentSha256, sample.expectedContentSha256);
      for (const field of ['metadataSha256', 'initialHtmlSha256', 'finalHtmlSha256', 'viewportPngSha256']) assert.equal(run[field], reference[field], `${sample.name}: ${field}`);
      assert(Number.isFinite(run.loadMs) && run.loadMs > 0);
      if (sample.directories) assert(Number.isFinite(run.navigationMs) && run.navigationMs > 0); else assert.equal(run.navigationMs, null);
    });
  }
  const metrics = {};
  for (const metric of sample.directories ? ['loadMs', 'navigationMs'] : ['loadMs']) {
    const a = current.map(run => run[metric]), b = baseline.map(run => run[metric]), before = median(b), after = median(a);
    const row = { baselineMs: before, currentMs: after, below10MsControl: before <= 10 };
    if (before > 10) {
      const ratios = [];
      for (let i = 0; i < 10000; i++) { const indices = a.map(() => Math.floor(random() * a.length)); ratios.push(median(indices.map(i => b[i])) / median(indices.map(i => a[i]))); }
      ratios.sort((a, b) => a - b); row.ratio = before / after; row.ratio95PercentBootstrapInterval = [ratios[250], ratios[9750]]; row.stableEngineeringReduction = ratios[250] > 1;
    }
    metrics[metric] = row;
  }
  return { sample: sample.name, bytes: sample.bytes, files: sample.files, directories: sample.directories, completeMetadataBytesHtmlAndViewportMatch: true, scopedSota: false, metrics };
});
const report = { engineering: true, scopedSota: false, sourceSha256: crypto.createHash('sha256').update(bytes).digest('hex'), cpu: raw.cpu, browser: raw.browser,
  iterations: raw.iterations, runs: raw.runs.length, method: raw.method + ' 10,000 paired-bootstrap median-ratio resamples, seed 12345.', samples };
fs.writeFileSync(option('--output', path.join(path.dirname(input), 'summary.json')), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
