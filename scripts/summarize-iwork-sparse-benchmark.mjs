import fs from 'node:fs';
import crypto from 'node:crypto';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node scripts/summarize-iwork-sparse-benchmark.mjs input.json output.json');
const bytes = fs.readFileSync(input);
const result = JSON.parse(bytes);
const median = values => {
  const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
let state = 12345;
const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
const comparisons = [...new Set(result.runs.map(run => run.sample))].map(sample => {
  const runs = result.runs.filter(run => run.sample === sample);
  const values = engine => runs.filter(run => run.engine === engine).sort((a, b) => a.iteration - b.iteration);
  const current = values('current'), baseline = values('baseline');
  if (current.length !== result.iterations || baseline.length !== result.iterations
    || [...current, ...baseline].some(run => !run.ok || !Number.isFinite(run.ms) || run.ms <= 0)) {
    throw new Error(`Incomplete/failed comparison: ${sample}`);
  }
  const allModelsIdentical = new Set(runs.map(run => run.modelSha256)).size === 1;
  if (!allModelsIdentical) throw new Error(`Model differs: ${sample}`);
  const ratios = [];
  for (let repeat = 0; repeat < 10000; repeat++) {
    const indices = current.map(() => Math.floor(random() * current.length));
    ratios.push(median(indices.map(i => baseline[i].ms)) / median(indices.map(i => current[i].ms)));
  }
  ratios.sort((a, b) => a - b);
  const currentMs = median(current.map(run => run.ms)), baselineMs = median(baseline.map(run => run.ms));
  return { sample, currentMs, baselineMs, baselineOverCurrent: baselineMs / currentMs,
    ratio95PercentBootstrapInterval: [ratios[250], ratios[9750]], allModelsIdentical,
    modelSha256: current[0].modelSha256, cells: current[0].cells, nonempty: current[0].nonempty };
});
const summary = { sourceSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  method: 'Engineering comparison only. Paired bootstrap, 10000 resamples, percentile 95% interval, LCG seed 12345. Synthetic sparse input is an existing grid model, excluding ZIP/Snappy/protobuf and rendering. No peer/SOTA claim.',
  date: result.date, cpu: result.cpu, platform: result.platform, browser: result.browser,
  iterations: result.iterations, totalRuns: result.runs.length,
  successfulRuns: result.runs.filter(run => run.ok).length, comparisons };
fs.writeFileSync(output, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
