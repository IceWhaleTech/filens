import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const input = option('--input', 'tmp/performance-sota/final/results.json');
const output = option('--output', 'tmp/performance-sota/final/analysis.json');
const source = fs.readFileSync(input);
const result = JSON.parse(source);
if (result.profiling) throw new Error('Profiled runs cannot be ranked.');
const engineering = Boolean(result.engineering) || result.runs.some(run => run.engine.startsWith('filens-'));
const median = values => {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
let state = 12345;
const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const candidates = (result.summary ?? []).filter(row => row.engine !== 'filens')
  .map(row => [row.family, row.sample, row.engine, row.family === 'raw-view' ? 'processingMs' : 'readyMs']);
const comparisons = candidates.flatMap(([family, sample, peer, metric]) => {
  const values = engine => result.runs.filter(run => run.family === family && run.sample === sample && run.engine === engine && !run.failure && !run.errors.length).sort((a, b) => a.iteration - b.iteration).map(run => run[metric]);
  const ours = values('filens'), theirs = values(peer);
  if (ours.length !== result.iterations || theirs.length !== result.iterations) return [];
  const distribution = [];
  for (let iteration = 0; iteration < 10000; iteration++) {
    const indices = ours.map(() => Math.floor(random() * ours.length));
    distribution.push(median(indices.map(i => theirs[i])) / median(indices.map(i => ours[i])));
  }
  distribution.sort((a, b) => a - b);
  const ratio95PercentBootstrapInterval = [distribution[250], distribution[9750]];
  return [{ family, sample, peer, metric, filensMs: median(ours), peerMs: median(theirs), peerOverFilensRatio: median(theirs) / median(ours), ratio95PercentBootstrapInterval,
    stableLeadInThisComparison: result.iterations >= 7 && ratio95PercentBootstrapInterval[0] > 1 }];
});
const aggregates = ['pptx-model', 'pptx-view'].flatMap(family => ['pptxtojson', 'pptx-preview', 'vue-office'].flatMap(peer => {
  const pairs = result.summary.filter(row => row.family === family && row.engine === peer && row.successes === result.iterations)
    .map(row => [row, result.summary.find(ours => ours.family === family && ours.sample === row.sample && ours.engine === 'filens')])
    .filter(([, ours]) => ours?.successes === result.iterations);
  return pairs.length ? [{ family, peer, commonSuccessfulSamples: pairs.length, geometricMeanPeerOverFilensRatio: Math.exp(pairs.reduce((sum, [row, ours]) => sum + Math.log(row.medianMs / ours.medianMs), 0) / pairs.length) }] : [];
}));
const analysis = {
  sourceSha256: crypto.createHash('sha256').update(source).digest('hex'),
  date: result.date, cpu: result.cpu, platform: result.platform, browser: result.browser, gpu: result.gpu,
  versions: result.versions, iterations: result.iterations, totalRuns: result.runs.length, engineering,
  filensSuccessfulRuns: result.runs.filter(run => run.engine === 'filens' && !run.failure && !run.errors.length).length,
  method: 'Ratios are peer / filens (higher means filens is faster). Paired bootstrap of per-iteration measurements, 10000 resamples, percentile 95% interval, LCG seed 12345. Small single-machine sample; not an independent benchmark or a global SOTA proof.',
  comparisons,
  timingLeads: (result.summary ?? []).filter(row => row.engine === 'filens').map(row => {
    const peers = result.summary.filter(peer => peer.family === row.family && peer.sample === row.sample && peer.engine !== 'filens');
    const matching = comparisons.filter(pair => pair.family === row.family && pair.sample === row.sample);
    return { family: row.family, sample: row.sample, allMeasuredPeersHaveStableTimingLead: !engineering && peers.length > 0 && matching.length === peers.length && matching.every(pair => pair.stableLeadInThisComparison),
      note: engineering ? 'Current/previous implementation engineering check; excluded from peer SOTA.' : 'Timing only; output/visual review is required before any SOTA claim.' };
  }), aggregates, summary: result.summary
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(analysis, null, 2) + '\n');
console.log(output);
