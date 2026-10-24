import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const input = option('--input', 'tmp/continued-review/native-media-final/results.json');
const bytes = fs.readFileSync(input), result = JSON.parse(bytes);
assert.equal(result.engineering, true);
assert.equal(result.runs.length, result.samples.length * result.iterations * 2);
const median = values => { const a = [...values].sort((x, y) => x - y), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
let seed = 12345;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const samples = result.samples.map(sample => {
  const runs = engine => result.runs.filter(run => run.sample === sample.name && run.engine === engine).sort((a, b) => a.iteration - b.iteration);
  const current = runs('current'), baseline = runs('baseline');
  for (const group of [current, baseline]) {
    assert.equal(group.length, result.iterations);
    group.forEach((run, i) => {
      assert.equal(run.iteration, i); assert(!run.failure); assert.deepEqual(run.errors, []);
      assert.equal(run.payloadBytes, sample.byteLength); assert.equal(run.payloadSha256, result.expectedPayloadSha256);
      assert(Math.abs(run.duration - run.expectedDuration) < 1e-6);
      assert.equal(run.stateError, null); assert.equal(run.destroyed, true); assert(Number.isFinite(run.setupMs) && run.setupMs > 0);
    });
  }
  const a = current.map(run => run.setupMs), b = baseline.map(run => run.setupMs), ratios = [];
  for (let repeat = 0; repeat < 10_000; repeat++) {
    const indices = a.map(() => Math.floor(random() * a.length));
    ratios.push(median(indices.map(i => b[i])) / median(indices.map(i => a[i])));
  }
  ratios.sort((x, y) => x - y);
  const interval = [ratios[250], ratios[9750]];
  return { sample: sample.name, currentMs: median(a), baselineMs: median(b), ratio: median(b) / median(a),
    ratio95PercentBootstrapInterval: interval, below10MsControl: median(b) <= 10,
    stableEngineeringReduction: median(b) > 10 && interval[0] > 1, scopedSota: false,
    completePayloadAndBrowserMetadataMatch: true };
});
const report = { engineering: true, scopedSota: false, sourceSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  iterations: result.iterations, runs: result.runs.length, cpu: result.cpu, browser: result.browser,
  method: '10,000 paired bootstrap resamples of native audio setup median ratios, seed 12345. Excludes metadata readiness, playback, layout/paint and file I/O. Baseline operations at or below 10 ms receive no speed claim. Losing and non-improving controls remain. No peer/SOTA ranking.', samples };
const output = option('--output', path.join(path.dirname(input), 'summary.json'));
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
