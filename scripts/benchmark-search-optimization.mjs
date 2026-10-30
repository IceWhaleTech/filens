// Paired comparison of two shared WASM cores through the identical native CLI.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { quantile } from './search-benchmark-metrics.mjs';
import { privacyIssues } from './agent-release-privacy.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = path.join(root, 'dist/agent-search-optimization');
const work = path.join(root, 'dist/agent-search-benchmark');
const binary = path.join(root, 'dist/filens');
const wasm = { before: path.join(base, 'before.wasm'), after: path.join(base, 'after.wasm') };
const baseline = JSON.parse(await readFile(path.join(root, 'docs/agent-cli-search-benchmark.json')));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(await readFile(wasm.before)), baseline.metadata.textWasmSHA256, 'The before artifact must match the recorded baseline');
const rows = [], equality = [], failures = [];
function run(engine, directory, query, mode, label) {
  const started = performance.now();
  const r = spawnSync(binary, ['search', directory, '--query', query, '--search-mode', mode, '--max-results', '10', '--max-files', '20000', '--json', '--no-ocr', '--wasm', wasm[engine]], {
    cwd: root, env: { ...process.env, FILENS_SEARCH_CACHE_DIR: path.join(base, 'cache-' + engine) }, encoding: 'utf8', maxBuffer: 32 << 20, timeout: 120000,
  });
  assert.equal(r.error, undefined);
  const ms = performance.now() - started;
  const value = JSON.parse(r.stdout);
  if (r.status !== 0 || !value.search?.complete) failures.push({ engine, label, mode, query, exit: r.status, elapsedMs: ms, error: JSON.parse(JSON.stringify(value.error ?? {}).replaceAll(root + '/', '')) });
  const output = value.search ? JSON.stringify({ results: value.search.results, matchedFiles: value.search.matchedFiles, chunks: value.search.chunks, text: value.content.text }) : undefined;
  return { ms, output, success: r.status === 0 && value.search?.complete === true };
}
const categories = [...new Set(baseline.manifest.queries.map(q => q.category))];
const cases = categories.map(category => baseline.manifest.queries.find(q => q.category === category));
const corpus = path.join(work, 'corpus');
for (const engine of Object.keys(wasm)) run(engine, corpus, cases[0].query, 'bm25', 'prepare');
for (const mode of ['bm25', 'exact']) {
  for (const [index, q] of cases.entries()) {
    for (let repeat = 0; repeat < 3; repeat++) {
      const engines = repeat % 2 ? ['after', 'before'] : ['before', 'after'];
      const outputs = {};
      for (const engine of engines) {
        const r = run(engine, corpus, q.query, mode, q.id); outputs[engine] = r;
        rows.push({ engine, mode, queryId: q.id, category: q.category, repeat, elapsedMs: r.ms, success: r.success });
      }
      if (outputs.before.success && outputs.after.success) {
        assert.equal(outputs.before.output, outputs.after.output, `Scores or evidence changed: ${mode} ${q.id}`);
        equality.push({ mode, queryId: q.id, repeat, equal: true });
      }
    }
    console.log(`Compared ${mode} ${index + 1}/${cases.length}.`);
  }
}
const scale = path.join(work, 'scale-2000');
for (const engine of Object.keys(wasm)) run(engine, scale, 'SPEED2026', 'bm25', 'prepare-2000');
for (let repeat = 0; repeat < 5; repeat++) {
  const outputs = {};
  for (const engine of repeat % 2 ? ['after', 'before'] : ['before', 'after']) {
    const r = run(engine, scale, 'SPEED2026', 'bm25', 'scale-2000'); outputs[engine] = r;
    rows.push({ engine, mode: 'bm25-2000', repeat, elapsedMs: r.ms, success: r.success });
  }
  if (outputs.before.success && outputs.after.success) {
    assert.equal(outputs.before.output, outputs.after.output, 'Scale output changed'); equality.push({ mode: 'bm25-2000', repeat, equal: true });
  }
}
const summary = {};
for (const mode of ['bm25', 'exact', 'bm25-2000']) {
  summary[mode] = {};
  for (const engine of Object.keys(wasm)) {
    const all = rows.filter(r => r.mode === mode && r.engine === engine), values = all.filter(r => r.success).map(r => r.elapsedMs);
    summary[mode][engine] = { successful: values.length, failed: all.length - values.length, p50Ms: quantile(values, .5), minMs: Math.min(...values), maxMs: Math.max(...values) };
  }
  summary[mode].medianReduction = 1 - summary[mode].after.p50Ms / summary[mode].before.p50Ms;
}
const result = { observedAt: new Date().toISOString(), platform: baseline.metadata.platform, cpu: baseline.metadata.cpu,
  binarySHA256: hash(await readFile(binary)), beforeWasmSHA256: hash(await readFile(wasm.before)), afterWasmSHA256: hash(await readFile(wasm.after)),
  change: 'Reuse bounded per-chunk query TF/length features instead of tokenizing twice; literal mode skips unused BM25 statistics. Core algorithm, scores, ordering and original evidence are unchanged.',
  scope: 'Identical CLI, shared corpus, independent prewarmed extraction caches, alternating order, fresh process per request. Nine query types x three repeats; 2000-file query x five. Preparations excluded from timing summary and recorded failures are not retried.',
  interpretation: 'Small local paired observation, not proof of stable performance or superiority to ripgrep. Includes startup, file validation and cache reads; no inverted index or daemon added.',
  summary, equalSuccessfulPairs: equality.length, equality, failures, observations: rows };
const json = JSON.stringify(result, null, 2) + '\n'; assert.deepEqual(privacyIssues(Buffer.from(json)), []);
await writeFile(path.join(root, 'docs/agent-cli-search-optimization.json'), json);
console.log(JSON.stringify({ summary, equalSuccessfulPairs: equality.length, failures: failures.length }, null, 2));
