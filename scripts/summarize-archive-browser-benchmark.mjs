import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const input = option('--input', 'tmp/zip-browser-e2e-2026-10-27/final/results.json');
const output = option('--output', path.join(path.dirname(input), 'summary.json'));
const bytes = fs.readFileSync(input), raw = JSON.parse(bytes);
assert.equal(raw.engineering, true);
assert.equal(raw.runs.length, raw.samples.length * raw.iterations * 2);
const median = values => {
  const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
let seed = 12345;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const sum = values => values.reduce((a, b) => a + b, 0);
const samples = raw.samples.map(sample => {
  const select = engine => raw.runs.filter(row => row.sample === sample.name && row.engine === engine).sort((a, b) => a.iteration - b.iteration);
  const baseline = select('baseline'), current = select('current');
  const expected = baseline[0];
  for (const rows of [baseline, current]) {
    assert.equal(rows.length, raw.iterations);
    rows.forEach((row, i) => {
      assert.equal(row.iteration, i); assert(!row.failure, row.failure); assert.deepEqual(row.errors, []);
      assert.equal(row.visits.length, Math.min(50, sample.directories));
      assert.equal(row.returns.length, row.visits.length);
      for (const key of ['listingSha256', 'htmlSha256', 'metadataSha256']) assert.equal(row[key], expected[key]);
    });
  }
  for (const key of ['rootPngSha256', 'directoryPngSha256']) assert.equal(current[0][key], expected[key]);
  const selectors = {
    localLoadToFramesMs: row => row.localLoadToFramesMs,
    inputReadyLoadToFramesMs: row => row.inputReadyLoadToFramesMs,
    inputReadyLoadDomMs: row => row.inputReadyLoadDomMs,
    firstDirectoryDomMs: row => row.visits[0].domMs,
    firstDirectoryToFramesMs: row => row.visits[0].toFramesMs,
    newDirectoriesTotalDomMs: row => sum(row.visits.map(visit => visit.domMs)),
    newDirectoriesTotalToFramesMs: row => sum(row.visits.map(visit => visit.toFramesMs)),
    newDirectoryMedianToFramesMs: row => median(row.visits.map(visit => visit.toFramesMs)),
    returnToRootTotalDomMs: row => sum(row.returns.map(visit => visit.domMs)),
    returnToRootTotalToFramesMs: row => sum(row.returns.map(visit => visit.toFramesMs)),
    completeBrowsingToFramesMs: row => row.localLoadToFramesMs + sum([...row.visits, ...row.returns].map(visit => visit.toFramesMs)),
    cachedDirectoryDomMs: row => row.cachedVisit.domMs,
    cachedDirectoryToFramesMs: row => row.cachedVisit.toFramesMs
  };
  const metrics = Object.fromEntries(Object.entries(selectors).map(([name, get]) => {
    const before = baseline.map(get), after = current.map(get);
    assert([...before, ...after].every(value => Number.isFinite(value) && value >= 0));
    const beforeMedian = median(before), afterMedian = median(after), distribution = [];
    for (let i = 0; i < 10000; i++) {
      const indices = before.map(() => Math.floor(random() * before.length));
      const denominator = median(indices.map(i => after[i]));
      distribution.push(denominator ? median(indices.map(i => before[i])) / denominator : null);
    }
    const finite = distribution.filter(value => value !== null).sort((a, b) => a - b);
    const ratio95 = finite.length === distribution.length ? [finite[250], finite[9750]] : null;
    return [name, { baselineMs: beforeMedian, currentMs: afterMedian, below10MsControl: beforeMedian <= 10,
      speedup: beforeMedian > 10 && afterMedian ? beforeMedian / afterMedian : null,
      ratio95: beforeMedian > 10 ? ratio95 : null,
      stableEngineeringLead: beforeMedian > 10 && raw.iterations >= 7 && Boolean(ratio95 && ratio95[0] > 1),
      scopedSota: false }];
  }));
  return { ...sample, directoriesVisited: baseline[0].visits.length, completeListingsAndMetadataMatch: true,
    rootAndDirectoryViewportPngsMatch: true, metrics };
});
const summary = { sourceSha256: crypto.createHash('sha256').update(bytes).digest('hex'), date: raw.date,
  engineering: true, scopedSota: false, cpu: raw.cpu, browser: raw.browser, iterations: raw.iterations,
  totalRuns: raw.runs.length, method: 'Same-project A/B, paired median-ratio bootstrap of independent browser runs, 10,000 resamples, seed 12345. Ratio is baseline/current. Per-run totals sum per-click measurements with layout observation and two frames; output verification and page-driver gaps between actions are excluded. Complete browsing combines the measured local load, directory entry and root-return intervals, not continuous wall-clock session time. No external browser peer or SOTA claim.',
  samples };
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(summary, null, 2) + '\n');
console.log(output);
