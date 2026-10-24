import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const input = option('--input', 'tmp/performance-raw-preview/final/results.json');
const output = option('--output', path.join(path.dirname(input), 'summary.json'));
const reviewPath = option('--review', undefined);
const bytes = fs.readFileSync(input), data = JSON.parse(bytes);
if (data.profiled) throw new Error('Diagnostic profiles cannot be ranked');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const resultsSha256 = sha256(bytes);
const review = reviewPath ? JSON.parse(fs.readFileSync(reviewPath)) : undefined;
if (review && review.resultsSha256 !== resultsSha256) throw new Error('Review does not match these results');
const median = values => {
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
function interval(own, peer) {
  let seed = 12345;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  const ratios = [];
  for (let trial = 0; trial < 10000; trial++) {
    const indices = Array.from({ length: own.length }, () => Math.floor(random() * own.length));
    ratios.push(median(indices.map(i => peer[i])) / median(indices.map(i => own[i])));
  }
  ratios.sort((a, b) => a - b);
  return [ratios[250], ratios[9749]];
}
const configurations = [];
for (const sample of data.samples) {
  const groups = new Map();
  for (const run of data.runs.filter(run => run.sample === sample.name)) {
    if (!groups.has(run.engine)) groups.set(run.engine, []);
    groups.get(run.engine).push(run);
  }
  for (const [engine, runs] of groups) {
    const valid = runs.filter(run => !run.failure);
    const metrics = {};
    for (const key of ['setupMs', 'processingMs', 'operationMs', 'readyMs']) {
      const values = valid.map(run => run[key]).filter(Number.isFinite);
      if (values.length) metrics[key] = { median: median(values), min: Math.min(...values), max: Math.max(...values), values };
    }
    configurations.push({ sample: sample.name, engine, successful: valid.length, total: runs.length,
      complete: runs.length === data.iterations && valid.length === data.iterations,
      metrics, output: valid.length ? { width: valid[0].width, height: valid[0].height, displayWidth: valid[0].displayWidth, displayHeight: valid[0].displayHeight, format: valid[0].outputFormat } : null,
      failures: [...new Set(runs.filter(run => run.failure).map(run => run.failure))],
      stableDisplayPixels: valid.length ? new Set(valid.map(run => run.validation.displayPixelSha256)).size === 1 : null,
    });
  }
}
const comparisons = data.samples.map(sample => {
  const rows = configurations.filter(row => row.sample === sample.name);
  const own = rows.find(row => row.engine === 'filens');
  const peers = rows.filter(row => row.engine !== 'filens');
  const sensorCheck = data.sensorChecks.find(check => check.sample === sample.name);
  const inspected = review?.samples.find(item => item.sample === sample.name);
  const evidenceComplete = sample.sensorBenchmarkEligible !== false && data.iterations >= 7 && !!own?.complete && peers.length >= 2 && peers.every(row => row.complete)
    && rows.every(row => row.stableDisplayPixels)
    && sensorCheck?.equal === true && inspected?.previewComparable === true;
  const ratios = peers.filter(peer => own?.complete && peer.complete).map(peer => {
    const ownRuns = data.runs.filter(run => run.sample === sample.name && run.engine === 'filens').sort((a, b) => a.iteration - b.iteration);
    const peerRuns = data.runs.filter(run => run.sample === sample.name && run.engine === peer.engine).sort((a, b) => a.iteration - b.iteration);
    const ci95 = interval(ownRuns.map(run => run.operationMs), peerRuns.map(run => run.operationMs));
    return { engine: peer.engine, ratio: peer.metrics.operationMs.median / own.metrics.operationMs.median, ci95 };
  });
  const fastestPeer = peers.filter(peer => peer.complete).sort((a, b) => a.metrics.operationMs.median - b.metrics.operationMs.median)[0];
  return { sample: sample.name, sensorBenchmarkEligible: sample.sensorBenchmarkEligible !== false, sensorUnchanged: sensorCheck?.equal ?? null, sensorCheck: sensorCheck?.original?.check ?? null,
    previewComparable: inspected?.previewComparable ?? null, fastestPeer: fastestPeer?.engine ?? null, ratios,
    scopedSota: evidenceComplete && own.metrics.operationMs.median >= 10 && ratios.length === peers.length && ratios.every(ratio => ratio.ci95[0] > 1),
  };
});
const summary = { date: data.date, resultsSha256, runs: data.runs.length, successful: data.runs.filter(run => !run.failure).length,
  filens: { successful: data.runs.filter(run => run.engine === 'filens' && !run.failure).length, total: data.runs.filter(run => run.engine === 'filens').length },
  iterations: data.iterations, cpu: data.cpu, browser: data.browser,
  method: 'Median of 7 fresh-context runs. operationMs includes sensor processing, output decode/transfer and common preview-canvas drawing; readyMs adds two animation frames. Both measured LibRaw modes must be complete and beaten with paired bootstrap 95% lower ratio bound >1. SOTA also requires an unchanged-sensor check and an explicit visual review tied to this results SHA. Only tasks >=10ms qualify. Scope is this machine, inputs and peers; native intermediate resolutions and image processing differ.',
  ...(review ? { review: { path: path.basename(reviewPath), sha256: sha256(fs.readFileSync(reviewPath)) } } : {}),
  configurations, comparisons,
};
fs.writeFileSync(output, JSON.stringify(summary, null, 2) + '\n');
for (const comparison of comparisons) {
  const rows = configurations.filter(row => row.sample === comparison.sample);
  console.log(comparison.sample, rows.map(row => `${row.engine}: ${row.metrics.operationMs?.median.toFixed(1) ?? 'failed'} ms`).join(' / '), comparison.scopedSota ? 'scoped SOTA' : '');
}
