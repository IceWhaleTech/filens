export function quantile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}
export function metrics(found, relevant, ranked = true) {
  const ids = [...new Set(found)], gold = new Set(relevant);
  if (!gold.size) return { empty: ids.length === 0, falsePositive: ids.length > 0 };
  const hit = k => ids.slice(0, k).some(id => gold.has(id)) ? 1 : 0;
  const recall = k => ids.slice(0, k).filter(id => gold.has(id)).length / gold.size;
  const first = ids.slice(0, 10).findIndex(id => gold.has(id));
  const dcg = ids.slice(0, 10).reduce((n, id, i) => n + (gold.has(id) ? 1 / Math.log2(i + 2) : 0), 0);
  const ideal = Array.from({ length: Math.min(10, gold.size) }, (_, i) => 1 / Math.log2(i + 2)).reduce((a, b) => a + b, 0);
  return { hit1: hit(1), hit5: hit(5), hit10: hit(10), recall5: recall(5),
    candidateRecall: recall(ids.length), candidatePrecision: ids.length ? ids.filter(id => gold.has(id)).length / ids.length : 0,
    mrr10: ranked ? first < 0 ? 0 : 1 / (first + 1) : null,
    ndcg10: ranked ? dcg / ideal : null };
}
export const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
export function summarize(rows) {
  const fields = ['hit1', 'hit5', 'hit10', 'recall5', 'candidateRecall', 'candidatePrecision', 'mrr10', 'ndcg10', 'falsePositive', 'evidenceHit', 'offsetsValid'];
  return Object.fromEntries(fields.map(key => [key, mean(rows.map(row => row[key]).filter(value => value !== undefined && value !== null).map(Number))]));
}
// Paired sampling of whole topic families, including all their queries.
export function pairedInterval(rows, first, second) {
  const families = [...new Set(rows.map(r => r.family))];
  const differences = families.map(family => {
    const group = rows.filter(r => r.family === family && r.metrics.hit5 !== undefined);
    return mean(group.filter(r => r.tool === first).map(r => r.metrics.hit5)) - mean(group.filter(r => r.tool === second).map(r => r.metrics.hit5));
  });
  let state = 20261030;
  const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const samples = Array.from({ length: 2000 }, () => mean(differences.map(() => differences[Math.floor(next() * differences.length)])));
  return { metric: 'Hit@5', first, second, unit: 'topic family', families: families.length, resamples: samples.length, seed: 20261030,
    difference: mean(differences), lower95: quantile(samples, .025), upper95: quantile(samples, .975) };
}
