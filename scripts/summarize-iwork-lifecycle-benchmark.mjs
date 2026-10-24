import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2), option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const input = option('--input', 'tmp/continued-review/iwork-lifecycle-final/results.json'), bytes = fs.readFileSync(input), result = JSON.parse(bytes);
assert.equal(result.engineering, true); assert.equal(result.runs.length, result.iterations * 12);
const median = values => { const a = [...values].sort((a, b) => a - b), middle = a.length >> 1; return a.length % 2 ? a[middle] : (a[middle - 1] + a[middle]) / 2; };
let seed = 12345; const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const samples = [...new Set(result.runs.map(run => run.sample))].map(sample => {
  const group = (engine, scenario) => result.runs.filter(run => run.sample === sample && run.engine === engine && run.scenario === scenario).sort((a, b) => a.iteration - b.iteration);
  const baseline = group('baseline', 'healthy'), current = group('current', 'healthy');
  for (const engine of ['baseline', 'current']) for (const scenario of ['healthy', 'cancel']) {
    const runs = group(engine, scenario); assert.equal(runs.length, result.iterations);
    for (const [iteration, run] of runs.entries()) {
      assert.equal(run.iteration, iteration); assert(!run.failure, run.failure); assert.deepEqual(run.errors, []); assert.equal(run.afterLoad.error, null); assert.equal(run.reportedErrors, 0);
      assert.equal(run.afterDestroy.empty, true); assert.equal(run.afterDestroy.urls, 0); assert(run.afterDestroy.workers.every(worker => worker.terminated));
      if (engine === 'current') assert(run.callerBufferBytes > 0);
      if (scenario === 'healthy') { assert.deepEqual(run.content, baseline[0].content, `${sample} complete models, DOM and resources`); assert.equal(run.settled, 'done'); }
      else {
        assert(Number.isFinite(run.cancelWaitMs)); assert(run.dispatchToAbortMs >= 9); assert.equal(run.recovery.error, null); assert.equal(run.recovery.remainingUrls, 0);
        if (engine === 'current') {
          assert.equal(run.settled, 'AbortError'); assert.equal(run.afterLoad.loading, false); assert.equal(run.afterLoad.kind, null); assert.equal(run.afterLoad.urls, 0); assert.equal(run.afterLoad.pageCount, 0); assert.equal(run.afterLoad.sheetCount, 0);
          assert(run.afterLoad.workers.every(worker => worker.terminated)); assert.equal(run.afterDestroy.workers.length, 2);
        } else { assert.equal(run.settled, 'done'); assert(run.afterLoad.kind); assert(run.afterLoad.workers.every(worker => !worker.terminated)); }
      }
    }
  }
  const a = current.map(run => run.elapsedMs), b = baseline.map(run => run.elapsedMs), ratios = [];
  for (let repeat = 0; repeat < 10000; repeat++) { const indexes = a.map(() => Math.floor(random() * a.length)); ratios.push(median(indexes.map(index => b[index])) / median(indexes.map(index => a[index]))); }
  ratios.sort((a, b) => a - b);
  return { sample, healthy: { baselineMs: median(b), currentMs: median(a), baselineOverCurrent: median(b) / median(a), pairedBootstrapRatio95: [ratios[250], ratios[9750]], completeModelDomAndResourceChecksMatch: true, sheetsChecked: baseline[0].content.length },
    cancellation: { baselineObsoleteWaitMs: median(group('baseline', 'cancel').map(run => run.cancelWaitMs)), currentAbortSettlementMs: median(group('current', 'cancel').map(run => run.cancelWaitMs)), currentWorkerStoppedAndSameViewerRecovered: true,
      ratio: null, reason: 'Baseline finishes obsolete output; current cancels it. Different completion semantics, no parse-speed ratio.' }, scopedSota: false };
});
const summary = { engineering: true, scopedSota: false, sourceSha256: crypto.createHash('sha256').update(bytes).digest('hex'), iterations: result.iterations, runs: result.runs.length, browser: result.browser, cpu: result.cpu,
  method: '10,000 paired bootstrap median-ratio resamples with seed 12345 for healthy-load controls. Cancellation measured from abort to promise settlement; no equivalent-output speed ratio. Includes real Worker startup; excludes input/module loading and paint. No peer/SOTA claim or external-total increment.', samples };
fs.writeFileSync(option('--output', path.join(path.dirname(input), 'summary.json')), JSON.stringify(summary, null, 2) + '\n'); console.log(JSON.stringify(summary, null, 2));
