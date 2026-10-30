// Fresh processes, no application cache, identical text. Includes tuned rg threads.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { quantile } from './search-benchmark-metrics.mjs';
import { privacyIssues } from './agent-release-privacy.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = path.join(root, 'dist/agent-search-parallel/filens');
const module = path.join(root, 'dist/agent-search-parallel/converter-text.wasm');
const tools = ['native-1', 'native-4', 'rg-default', 'rg-1', 'rg-4'];
const observations = [], equality = [], failures = [];
function run(tool, c, repeat) {
  const native = tool.startsWith('native');
  const args = native
    ? ['search', c.directory, '--query', c.query, '--search-mode', c.mode, '--max-files', '20000', '--json', '--no-ocr']
    : c.mode === 'files'
      ? ['--files', '--null', '--no-ignore', ...(tool === 'rg-default' ? [] : ['--threads', tool.slice(3)]), '.']
      : ['-l', '-0', '-F', '--no-ignore', ...(tool === 'rg-default' ? [] : ['--threads', tool.slice(3)]), '-e', c.query, '--', '.'];
  const env = { ...process.env, FILENS_SEARCH_JOBS: tool === 'native-1' ? '1' : '4' };
  delete env.FILENS_TEXT_WASM;
  const started = performance.now();
  const r = spawnSync(native ? binary : 'rg', args, { cwd: c.directory, env, encoding: 'utf8', timeout: 120000, maxBuffer: 32 << 20 });
  const elapsedMs = performance.now() - started;
  let value, files, error;
  try {
    assert.equal(r.error, undefined);
    assert.equal(r.status, 0);
    if (native) {
      value = JSON.parse(r.stdout);
      assert.equal(value.search.complete, true);
      assert.equal(value.search.scan.execution.sharedTextModules, 0);
      assert.equal(value.search.scan.execution.ranking, 'native-rust');
      assert.equal(value.search.scan.cache.writes, 0);
      assert.ok(value.search.results.every(hit => hit.sha256 === null));
      files = value.search.results.map(hit => path.relative(c.directory, hit.path)).sort();
    } else files = r.stdout.split('\0').filter(Boolean).map(s => s.replace(/^\.\//, '')).sort();
    assert.deepEqual(files, c.expected);
  } catch (e) { error = e.message.split('\n')[0]; }
  const row = { case: c.id, tool, repeat, elapsedMs, exit: r.status, success: !error,
    moduleLoads: value?.search.scan.execution.sharedTextModules, workers: value?.search.scan.execution.workers, matchedFiles: files?.length };
  observations.push(row);
  if (error) failures.push({ ...row, error });
  return value;
}
const cases = [];
cases.push({ id: '1-files', count: 1, mode: 'files', repeats: 15, directory: path.join(root, 'dist/agent-search-startup/one'), query: 'note', expected: ['note.txt'] });
for (const count of [1, 100, 2000]) for (const mode of ['exact', 'bm25']) cases.push({ id: `${count}-${mode}`, count, mode, repeats: 15,
  directory: path.join(root, count === 1 ? 'dist/agent-search-startup/one' : `dist/agent-search-benchmark/scale-${count}`),
  query: count === 1 ? 'APPROVED2026' : 'SPEED2026', expected: [count === 1 ? 'note.txt' : `f${String(Math.floor(count * .91)).padStart(5, '0')}.txt`] });
for (const c of cases) {
  for (let repeat = 0; repeat < c.repeats; repeat++) {
    const order = tools.slice(repeat % tools.length).concat(tools.slice(0, repeat % tools.length));
    const outputs = {};
    for (const tool of order) outputs[tool] = run(tool, c, repeat);
    if (outputs['native-1'] && outputs['native-4']) {
      assert.deepEqual(outputs['native-1'].search.results, outputs['native-4'].search.results);
      assert.deepEqual(outputs['native-1'].content, outputs['native-4'].content);
      equality.push({ case: c.id, repeat, equal: true });
    }
  }
  console.log(`${c.id}: ${c.repeats} samples per configuration`);
}
// Cross-target parity uses the exact selected module and actual natural-language
// corpus; score differences are measured separately from evidence/order equality.
const baseline = JSON.parse(await readFile(path.join(root, 'docs/agent-cli-search-benchmark.json')));
const parity = { comparisons: 0, maxRelativeScoreDifference: 0, tolerance: 1e-12, mismatches: [] };
function extract(mode, query, wasm) {
  const env = { ...process.env, FILENS_SEARCH_JOBS: '4' }; delete env.FILENS_TEXT_WASM;
  const r = spawnSync(binary, ['search', path.join(root, 'dist/agent-search-benchmark/corpus'), '--query', query, '--search-mode', mode, '--json', '--no-ocr', ...(wasm ? ['--wasm', module] : [])], { env, encoding: 'utf8', timeout: 120000, maxBuffer: 32 << 20 });
  assert.equal(r.status, 0);
  return JSON.parse(r.stdout);
}
function same(a, b) {
  if (typeof a === 'number' && typeof b === 'number') {
    const difference = Math.abs(a - b) / Math.max(1, Math.abs(a), Math.abs(b));
    parity.maxRelativeScoreDifference = Math.max(parity.maxRelativeScoreDifference, difference);
    return difference <= parity.tolerance;
  }
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') return JSON.stringify(Object.keys(a).sort()) === JSON.stringify(Object.keys(b).sort()) && Object.keys(a).every(k => same(a[k], b[k]));
  return a === b;
}
for (const mode of ['exact', 'bm25']) for (const query of baseline.manifest.queries) {
  const native = extract(mode, query.query, false), wasm = extract(mode, query.query, true);
  parity.comparisons++;
  if (!same({ results: native.search.results, text: native.content.text, matched: native.search.matchedFiles }, { results: wasm.search.results, text: wasm.content.text, matched: wasm.search.matchedFiles })) parity.mismatches.push({ queryId: query.id, mode });
}
const summary = cases.map(c => ({ case: c.id, files: c.count, mode: c.mode, samplesPerTool: c.repeats,
  tools: Object.fromEntries(tools.map(tool => {
    const rows = observations.filter(r => r.case === c.id && r.tool === tool), ms = rows.filter(r => r.success).map(r => r.elapsedMs);
    return [tool, { successful: ms.length, failed: rows.length - ms.length, firstMs: rows[0].elapsedMs, p50Ms: quantile(ms, .5), p95Ms: quantile(ms, .95) }];
  })) }));
const resources = [];
if (process.platform === 'darwin') for (const tool of tools) {
  const c = cases.find(c => c.id === '2000-exact'), native = tool.startsWith('native');
  const args = native ? [binary, 'search', c.directory, '--query', c.query, '--search-mode', 'exact', '--json', '--no-ocr']
    : ['rg', '-l', '-F', '--no-ignore', ...(tool === 'rg-default' ? [] : ['--threads', tool.slice(3)]), '-e', c.query, '--', '.'];
  const env = { ...process.env, FILENS_SEARCH_JOBS: tool === 'native-1' ? '1' : '4' }; delete env.FILENS_TEXT_WASM;
  const r = spawnSync('/usr/bin/time', ['-l', ...args], { cwd: c.directory, env, encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0);
  resources.push({ tool, maxProcessResidentBytes: Number(r.stderr.match(/(\d+)\s+maximum resident set size/)?.[1]) || null });
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { metadata: { observedAt: new Date().toISOString(), platform: `${process.platform}-${process.arch}`, cpu: os.cpus()[0].model,
  binarySHA256: sha(await readFile(binary)), parityWasmSHA256: sha(await readFile(module)), ripgrep: spawnSync('rg', ['--version'], { encoding: 'utf8' }).stdout.trim() },
  scope: 'Fresh process for every sample; no application cache, no source hashes, no persistent index. OS page cache is uncontrolled and may be warm. macOS purge was denied in the preceding startup run. Rotate five configurations; keep every first sample, no retries.',
  limits: ['Single macOS machine and synthetic short texts; not physical-cold disk.', 'Literal mode is the direct retrieval comparison. BM25 is separately reported and does more work than rg literal.', 'Default rg and explicit 1/4-thread settings are all shown; conclusions must include tuned baselines.', 'Process RSS is one separate maximum, not a stable memory distribution.', 'Cross-target score tolerance covers libc/libm differences; order, paths and strings must match exactly.'],
  summary, observations, equality, equalNativeWorkerPairs: equality.length, parity, resources, failures };
const bytes = Buffer.from(JSON.stringify(report, null, 2) + '\n'); assert.deepEqual(privacyIssues(bytes), []);
await writeFile(path.join(root, 'docs/agent-cli-search-native.json'), bytes);
console.log(JSON.stringify({ summary, parity, resources, failures: failures.length }, null, 2));
assert.equal(failures.length, 0); assert.equal(parity.mismatches.length, 0);
