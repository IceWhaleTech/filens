import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const input = option('--input', 'tmp/continued-review/pdf-final/results.json');
const bytes = fs.readFileSync(input), result = JSON.parse(bytes);
assert.equal(result.engineering, true);
const median = values => { const sorted = [...values].sort((a, b) => a - b), mid = sorted.length >> 1; return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; };
let seed = 12345;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const samples = result.samples.map(sample => {
  const runs = engine => result.runs.filter(run => run.sample === sample.name && run.engine === engine).sort((a, b) => a.iteration - b.iteration);
  const current = runs('current'), baseline = runs('baseline');
  const successful = runs => runs.length === result.iterations && runs.every(run => !run.failure && !run.errors.length && run.destroyed);
  assert(successful(current) && successful(baseline), `${sample.name}: incomplete measurements`);
  assert(current.every((run, index) => run.firstPageSha256 === baseline[index].firstPageSha256));
  const a = current.find(run => run.pageReview)?.pageReview, b = baseline.find(run => run.pageReview)?.pageReview;
  if (a || b) assert.deepEqual(a, b, `${sample.name}: every rendered page must match`);
  const comparisons = ['readyMs', 'firstPaintMs', 'canvasPixels', 'canvases'].map(metric => {
    const a = current.map(run => run[metric]), b = baseline.map(run => run[metric]);
    assert(a.every(Number.isFinite) && b.every(Number.isFinite));
    const distribution = [];
    for (let repeat = 0; repeat < 10000; repeat++) {
      const indices = a.map(() => Math.floor(random() * a.length));
      distribution.push(median(indices.map(index => b[index])) / median(indices.map(index => a[index])));
    }
    distribution.sort((a, b) => a - b);
    const interval = [distribution[250], distribution[9750]];
    return { metric, current: median(a), baseline: median(b), ratio: median(b) / median(a), ratio95PercentBootstrapInterval: interval,
      stableEngineeringReduction: interval[0] > 1, stableEngineeringIncrease: interval[1] < 1, scopedSota: false };
  });
  return { sample: sample.name, firstPagePixelsMatch: true, completePageReviewMatches: Boolean(a), reviewedPages: a?.length ?? 0, comparisons };
});
const report = { engineering: true, scopedSota: false, sourceSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  iterations: result.iterations, runs: result.runs.length, cpu: result.cpu, browser: result.browser,
  method: '10,000 paired bootstrap resamples of median ratios, seed 12345. Ready time is load settlement plus two display frames, not first visible content. Canvas pixels count backing-store dimensions and are not a process-memory measurement. Engineering-only comparison of scheduling around the same PDF.js engine.', samples };
const output = option('--output', path.join(path.dirname(input), 'summary.json'));
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
