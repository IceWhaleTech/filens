import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const input = option('--input', 'tmp/performance-native-panorama/results/results.json');
const output = option('--output', 'tmp/performance-native-panorama/results/summary.json');
const bytes = fs.readFileSync(input);
const source = JSON.parse(bytes);
if (source.profiling) throw new Error('Profiled measurements cannot be ranked.');
const sourceSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
const reviewPath = option('--review');
const review = reviewPath ? JSON.parse(fs.readFileSync(reviewPath)) : undefined;
if (review && review.sourceSha256 !== sourceSha256) throw new Error('Visual review does not match these measurements.');
const median = values => {
  const sorted = values.toSorted((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return !sorted.length ? null : sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
let seed = 12345;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const runs = engine => source.runs.filter(run => run.engine === engine && !run.failure && !run.errors.length).toSorted((a, b) => a.iteration - b.iteration);
const ours = runs('filens'), peers = runs('photo-sphere-viewer');
const complete = rows => rows.length === source.iterations && rows.every((row, i) => row.iteration === i && Number.isFinite(row.readyMs) && row.width === 1280 && row.height === 800);
const completePair = complete(ours) && complete(peers);
let timing;
if (completePair) {
  const distribution = [];
  for (let iteration = 0; iteration < 10000; iteration++) {
    const indices = ours.map(() => Math.floor(random() * ours.length));
    distribution.push(median(indices.map(i => peers[i].readyMs)) / median(indices.map(i => ours[i].readyMs)));
  }
  distribution.sort((a, b) => a - b);
  const ratio95PercentBootstrapInterval = [distribution[250], distribution[9750]];
  timing = { metric: 'readyMs', filensMs: median(ours.map(run => run.readyMs)), peerMs: median(peers.map(run => run.readyMs)),
    peerOverFilensRatio: median(peers.map(run => run.readyMs)) / median(ours.map(run => run.readyMs)),
    ratio95PercentBootstrapInterval,
    stableLead: source.iterations >= 7 && ratio95PercentBootstrapInterval[0] > 1 };
}
const calibrated = ours.length > 0 && ours.every(run => run.source?.cameraModel === 'Insta360 X5'
  && run.source.calibrationSource === 'embedded' && run.source.lenses === 2
  && run.source.distortionModels.every(model => model === 'radtan_pro')
  && run.source.distortionCoefficientCounts.every(count => count === 13));
const peerReviewed = review?.peer === 'photo-sphere-viewer'
  && review.equivalentReadablePreview === true && review.vendorCalibrationEquivalent === false
  && ['filens', 'photo-sphere-viewer'].every(engine => {
    const actual = source.runs.find(run => run.engine === engine && run.iteration === 0)?.views;
    const checked = review.views?.[engine];
    return actual?.length >= 8 && checked?.length === actual.length
      && actual.every(view => checked.some(item => item.path === view.path && item.sha256 === view.sha256
        && item.yaw === view.yaw && item.pitch === view.pitch));
  });
const summary = {
  sourceSha256, date: source.date, cpu: source.cpu, platform: source.platform, browser: source.browser, gpu: source.gpu,
  versions: source.versions, sample: { ...source.sample, ...ours[0]?.source },
  iterations: source.iterations, totalRuns: source.runs.length, filensSuccessfulRuns: ours.length,
  method: 'Same-original readable preview, not equivalent calibration algorithms or seamless stitching. Paired median-ratio bootstrap, 10,000 resamples, seed 12345, percentile 95% interval. Scope is this input, machine and measured peer. JS imports, input and WASM compilation precede timing; renderer construction, native inspection, decode, upload, optional seam completion and two animation frames are included.',
  timing,
  scope: {
    equivalentReadablePreview: peerReviewed,
    nativeX5CalibrationVerified: calibrated,
    scopedPreviewSota: Boolean(completePair && timing?.stableLead && calibrated && peerReviewed),
    vendorCalibrationSota: false,
    seamlessStitchingClaim: false,
    note: 'The peer uses a fixed generic dual-fisheye mapping. On this reviewed sample, PSV visibly repeats scene elements across hard seams; filens retains more localized blending/ghosting and better scene continuity at those seams. Both provide readable previews. This qualitative observation does not establish a quantitative or general stitching-quality SOTA, nor a vendor-calibration parser speed ranking.'
  },
  summary: source.summary,
  review: review ? { path: reviewPath, sha256: crypto.createHash('sha256').update(fs.readFileSync(reviewPath)).digest('hex') } : null
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ timing, scope: summary.scope }, null, 2));
