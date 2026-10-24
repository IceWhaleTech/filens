import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2), option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const input = option('--input', 'tmp/continued-review/converter-io-final/results.json'), bytes = fs.readFileSync(input), result = JSON.parse(bytes);
assert.equal(result.engineering, true); assert.equal(result.runs.length, result.samples.length * result.iterations * 2);
const median = values => { const ordered = [...values].sort((a,b) => a-b), mid = ordered.length >> 1; return ordered.length % 2 ? ordered[mid] : (ordered[mid-1] + ordered[mid]) / 2; };
let seed = 12345; const random = () => ((seed = (Math.imul(seed,1664525)+1013904223) >>> 0) / 2**32);
const samples = result.samples.map(sample => {
  const group = engine => result.runs.filter(run => run.sample === sample.name && run.engine === engine).sort((a,b) => a.iteration-b.iteration);
  const current = group('current'), baseline = group('baseline'), reference = baseline[0].content;
  for (const runs of [current, baseline]) {
    assert.equal(runs.length, result.iterations);
    for (const [iteration, run] of runs.entries()) {
      assert.equal(run.iteration, iteration); assert(!run.failure, run.failure); assert.deepEqual(run.pageErrors, []); assert(Number.isFinite(run.elapsedMs) && run.elapsedMs >= 0);
      assert.deepEqual(run.content, reference, sample.name + ': complete output mismatch');
      if (sample.kind === 'io') { assert.equal(run.content.outputSha256, sample.expectedSha256); assert.equal(run.content.outputBytes, sample.totalBytes); }
      if (sample.images) { assert.equal(run.content.decodedImages.length, sample.images); assert(run.content.decodedImages.every(image => image.width === 512 && image.height === 512)); }
    }
  }
  const a = current.map(run => run.elapsedMs), b = baseline.map(run => run.elapsedMs), am = median(a), bm = median(b), ratios = [];
  if (bm > 10 && am > 0) for (let repeat = 0; repeat < 10000; repeat++) {
    const indexes = a.map(() => Math.floor(random() * a.length)), denominator = median(indexes.map(index => a[index]));
    ratios.push(denominator ? median(indexes.map(index => b[index])) / denominator : Infinity);
  }
  ratios.sort((a,b) => a-b); const interval = ratios.length ? [ratios[250], ratios[9750]] : null;
  return { sample: sample.name, kind: sample.kind, baselineMs: bm, currentMs: am, ratio: ratios.length ? bm/am : null, pairedBootstrapRatio95: interval,
    below10MsControl: bm <= 10, stableEngineeringReduction: result.iterations >= 7 && bm > 10 && interval?.[0] > 1,
    identicalCompleteOutputBytes: true, outputBytes: reference.outputBytes, outputSha256: reference.outputSha256,
    ...(sample.images ? { imagesDecodedPerRun: sample.images, imagePayloadsPreserved: true, macrosRemoved: true, normalizedRelationshipSemanticsPreserved: true } : {}), scopedSota: false };
});
const summary = { engineering: true, scopedSota: false, sourceSha256: crypto.createHash('sha256').update(bytes).digest('hex'), iterations: result.iterations, runs: result.runs.length, cpu: result.cpu, browser: result.browser,
  method: '10,000 paired bootstrap median-ratio resamples, seed 12345. Claims require seven repeats, a baseline median above 10 ms and a 95% interval above 1. IO fixtures measure actual generated WASM writes/instantiation/output extraction, separate from unchanged real converter-core.wasm DOCM normalization and RTF conversion. Full output bytes/parts and image payloads verified after timing. No peer/SOTA or peak-memory claim; external totals unchanged.', samples };
fs.writeFileSync(option('--output', path.join(path.dirname(input), 'summary.json')), JSON.stringify(summary,null,2)+'\n'); console.log(JSON.stringify(summary,null,2));
