import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2), option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const input = option('--input', 'tmp/continued-review/docx-final/results.json'), bytes = fs.readFileSync(input), result = JSON.parse(bytes);
assert.equal(result.engineering, true); assert.equal(result.runs.length, result.iterations * result.samples.length * 2);
const median = values => { const a = [...values].sort((a, b) => a - b), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
let seed = 12345; const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const samples = result.samples.map(sample => {
  const group = engine => result.runs.filter(run => run.sample === sample.name && run.engine === engine).sort((a, b) => a.iteration - b.iteration);
  const current = group('current'), baseline = group('baseline'), reference = baseline[0];
  for (const group of [current, baseline]) {
    assert.equal(group.length, result.iterations);
    group.forEach((run, i) => {
      assert.equal(run.iteration, i); assert(!run.failure, run.failure); assert.deepEqual(run.errors, []);
      assert(Number.isFinite(run.loadMs) && run.loadMs > 0); assert.equal(run.stateError, null); assert.equal(run.destroyed, true);
      assert.equal(run.decodedImages, run.images);
      for (const field of ['domSha256', 'textSha256', 'pages', 'images', 'tables', 'uniqueResources']) assert.deepEqual(run[field], reference[field], `${sample.name}: ${field}`);
      if (run.engine === 'current') assert.equal(run.remainingUrls, 0);
    });
  }
  assert.deepEqual(current[0].views.map(({ view, sha256 }) => ({ view, sha256 })), reference.views.map(({ view, sha256 }) => ({ view, sha256 })));
  for (const run of [current[0], reference]) {
    const last = run.views.find(view => view.view === 'last'); assert(last.scrollGap <= 1);
    if (sample.name.startsWith('generated-')) assert.equal(last.lastImageVisible, true);
  }
  const a = current.map(run => run.loadMs), b = baseline.map(run => run.loadMs), ratios = [];
  for (let repeat = 0; repeat < 10000; repeat++) {
    const indices = a.map(() => Math.floor(random() * a.length)); ratios.push(median(indices.map(i => b[i])) / median(indices.map(i => a[i])));
  }
  ratios.sort((a, b) => a - b); const interval = [ratios[250], ratios[9750]];
  return { sample: sample.name, currentMs: median(a), baselineMs: median(b), ratio: median(b) / median(a), ratio95PercentBootstrapInterval: interval,
    below10MsControl: median(b) <= 10, stableEngineeringReduction: median(b) > 10 && interval[0] > 1,
    currentResourceUrls: current.map(run => run.resourceCount), baselineResourceUrls: baseline.map(run => run.resourceCount),
    pages: reference.pages, images: reference.images, tables: reference.tables, completeDomAndImagePayloadsMatch: true, firstAndLastViewportsMatch: true, scopedSota: false };
});
const report = { engineering: true, scopedSota: false, sourceSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  cpu: result.cpu, browser: result.browser, iterations: result.iterations, runs: result.runs.length,
  method: '10,000 paired bootstrap resamples of load median ratios, seed 12345. Same docx-preview engine before/after resource reuse and lifecycle/input fixes. Excludes image decode readiness, paint, file I/O and module download. Losing/non-improving controls remain; baseline medians at or below 10 ms receive no speed claim. No peer/SOTA ranking.', samples };
fs.writeFileSync(option('--output', path.join(path.dirname(input), 'summary.json')), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
