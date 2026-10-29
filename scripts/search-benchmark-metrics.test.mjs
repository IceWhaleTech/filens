import test from 'node:test';
import assert from 'node:assert/strict';
import { metrics, quantile, summarize, pairedInterval } from './search-benchmark-metrics.mjs';
test('deduplicates files and uses all relevant files in the recall denominator', () => {
  const m = metrics(['wrong', 'a', 'a', 'b'], ['a', 'b']);
  assert.equal(m.hit1, 0); assert.equal(m.hit5, 1); assert.equal(m.recall5, 1);
  assert.equal(m.mrr10, .5); assert.equal(m.candidatePrecision, 2 / 3);
  assert.ok(m.ndcg10 < 1 && m.ndcg10 > 0);
  assert.equal(metrics(['a'], ['a', 'b']).recall5, .5);
});
test('unordered candidates have no semantic ranking metrics; no-answer cases are separate', () => {
  assert.equal(metrics(['a'], ['a'], false).mrr10, null);
  assert.equal(metrics(['a'], [], false).falsePositive, true);
  assert.equal(metrics([], []).empty, true);
  const s = summarize([metrics(['a'], ['a']), metrics(['x'], [])]);
  assert.equal(s.hit5, 1); assert.equal(s.falsePositive, 1);
});
test('latency percentiles use nearest rank and do not mutate samples', () => {
  const values = [5, 1, 4, 2, 3];
  assert.equal(quantile(values, .5), 3); assert.equal(quantile(values, .95), 5);
  assert.deepEqual(values, [5, 1, 4, 2, 3]); assert.equal(quantile([], .5), null);
});
test('paired confidence intervals resample complete families reproducibly', () => {
  const rows = ['one', 'two'].flatMap(family => ['a', 'b'].map(tool => ({ family, tool, metrics: { hit5: tool === 'a' ? 1 : 0 } })));
  const interval = pairedInterval(rows, 'a', 'b');
  assert.equal(interval.difference, 1); assert.equal(interval.lower95, 1); assert.equal(interval.upper95, 1);
  assert.deepEqual(interval, pairedInterval(rows, 'a', 'b'));
});
