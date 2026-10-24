import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const input = option('--input', 'tmp/continued-review/diagram-final/results.json');
const bytes = fs.readFileSync(input), result = JSON.parse(bytes);
assert.equal(result.engineering, true);
assert.equal(result.runs.length, result.samples.length * result.iterations * 2);
const median = values => { const sorted = [...values].sort((a, b) => a - b), mid = sorted.length >> 1; return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; };
let seed = 12345;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const samples = result.samples.map(sample => {
  const runs = engine => result.runs.filter(run => run.sample === sample.name && run.engine === engine).sort((a, b) => a.iteration - b.iteration);
  const current = runs('current'), baseline = runs('baseline');
  for (const group of [current, baseline]) {
    assert.equal(group.length, result.iterations);
    group.forEach((run, index) => {
      assert.equal(run.iteration, index);
      assert(!run.failure && !run.errors.length);
      assert.equal(run.nodeCount, sample.nodeCount); assert.equal(run.renderedNodes, sample.nodeCount);
      assert.equal(run.modelSha256, baseline[0].modelSha256); assert.equal(run.svgSha256, baseline[0].svgSha256);
    });
  }
  const comparisons = ['parseMs', 'sessionLoadMs'].map(metric => {
    const a = current.map(run => run[metric]), b = baseline.map(run => run[metric]);
    assert(a.every(value => Number.isFinite(value) && value > 0) && b.every(value => Number.isFinite(value) && value > 0));
    const distribution = [];
    for (let repeat = 0; repeat < 10000; repeat++) {
      const indices = a.map(() => Math.floor(random() * a.length));
      distribution.push(median(indices.map(index => b[index])) / median(indices.map(index => a[index])));
    }
    distribution.sort((a, b) => a - b);
    const interval = [distribution[250], distribution[9750]];
    return { metric, currentMs: median(a), baselineMs: median(b), ratio: median(b) / median(a), ratio95PercentBootstrapInterval: interval,
      stableEngineeringReduction: interval[0] > 1, below10MsControl: median(b) <= 10, scopedSota: false };
  });
  return { sample: sample.name, nodeCount: sample.nodeCount, completeModelsAndSvgMatch: true, comparisons };
});
const report = { engineering: true, scopedSota: false, sourceSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  iterations: result.iterations, runs: result.runs.length, cpu: result.cpu, browser: result.browser,
  method: '10,000 paired bootstrap resamples of median ratios, seed 12345. XML/ZIP-to-model parsing and separate session load through SVG DOM construction; layout/paint excluded. Session measurement follows parser measurement in the same context. Baseline operations at or below 10 ms receive no speed claim. No peer/SOTA ranking.', samples };
const output = option('--output', path.join(path.dirname(input), 'summary.json'));
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
