// Fresh-process search measurements. Never equate an empty app cache with cold disk.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { quantile } from './search-benchmark-metrics.mjs';
import { privacyIssues } from './agent-release-privacy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = path.join(root, 'dist/agent-search-startup');
const flag = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const binaries = { before: path.resolve(flag('--before') ?? path.join(base, 'before-filens')), after: path.resolve(flag('--after') ?? path.join(base, 'filens')) };
const wasm = path.resolve(flag('--wasm') ?? path.join(root, 'dist/converter-text.wasm'));
const env = { ...process.env, FILENS_SEARCH_CACHE_DIR: path.join(base, 'must-remain-absent'), FILENS_PROFILE: 'lite' };
delete env.FILENS_TEXT_WASM;
await assert.rejects(access(env.FILENS_SEARCH_CACHE_DIR), { code: 'ENOENT' });
// Normal bundle layout activates the shared metadata fast path. Both executables
// load the identical source module; no compilation cache or daemon is present.
for (const binary of Object.values(binaries)) {
  const modulePath = path.join(path.dirname(binary), 'converter-text.wasm');
  try { await symlink(wasm, modulePath); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  assert.ok((await readFile(modulePath)).equals(await readFile(wasm)));
}
await mkdir(path.join(base, 'empty'), { recursive: true });
await mkdir(path.join(base, 'one'), { recursive: true });
await writeFile(path.join(base, 'one/note.txt'), '预算不得超过12345.67元；APPROVED2026 evidence.\n');
const diskCache = { requested: process.argv.includes('--purge'), available: false, attempts: 0,
  regime: 'OS page cache uncontrolled; source and executable pages may be warm. Fresh processes and no application caches only.' };
if (diskCache.requested) {
  assert.equal(process.platform, 'darwin', '--purge currently supports macOS only');
  const attempt = spawnSync('/usr/sbin/purge', [], { encoding: 'utf8', timeout: 30000 });
  diskCache.attempts++;
  diskCache.available = attempt.status === 0;
  diskCache.exit = attempt.status;
  diskCache.reason = attempt.status === 0 ? 'purge succeeded; repeated before each sample' : attempt.error?.code ?? attempt.stderr.trim();
  if (diskCache.available) diskCache.regime = 'macOS purge before each sample, outside the measured interval; not hardware-cache eviction.';
}
const one = path.join(base, 'one'), empty = path.join(base, 'empty');
const cases = [
  { id: 'help', label: '帮助入口（启动开销参照）', args: ['--help'], rgArgs: ['--help'], repeats: 15 },
  { id: 'empty-bm25', label: '空目录 BM25', directory: empty, query: 'APPROVED2026', mode: 'bm25', repeats: 15, expected: [] },
  { id: 'one-files', label: '单文件路径搜索', directory: one, query: 'note', mode: 'files', repeats: 15, expected: ['note.txt'] },
  { id: 'one-exact', label: '单文件精确搜索', directory: one, query: 'APPROVED2026', mode: 'exact', repeats: 15, expected: ['note.txt'] },
  { id: 'one-bm25', label: '单文件 BM25', directory: one, query: 'APPROVED2026', mode: 'bm25', repeats: 15, expected: ['note.txt'] },
  { id: 'scale-2000-exact', label: '2000 短文本精确搜索', directory: path.join(root, 'dist/agent-search-benchmark/scale-2000'), query: 'SPEED2026', mode: 'exact', repeats: 3, expected: ['f01820.txt'] },
];
const observations = [], failures = [], equal = [];
const comparable = value => JSON.stringify({ search: { ...value.search, results: value.search.results.map(({ sha256, ...hit }) => hit), scan: undefined }, content: value.content });
function sample(tool, c, repeat) {
  if (diskCache.available) {
    const purge = spawnSync('/usr/sbin/purge', [], { encoding: 'utf8', timeout: 30000 });
    diskCache.attempts++;
    assert.equal(purge.status, 0, 'Disk-cache purge stopped working; refuse a mixed cold/warm summary');
  }
  const args = tool === 'rg'
    ? c.rgArgs ?? (c.mode === 'files' ? ['--files', '--null', '--no-ignore', '.'] : ['-l', '--null', '-F', '--no-ignore', '-e', c.query, '--', '.'])
    : c.args ?? ['search', c.directory, '--query', c.query, '--search-mode', c.mode, '--max-files', '20000', '--json', '--no-ocr', '--no-cache'];
  const started = performance.now();
  const result = spawnSync(tool === 'rg' ? 'rg' : binaries[tool], args, { cwd: c.directory ?? root, env, encoding: 'utf8', timeout: 120000, maxBuffer: 32 << 20 });
  const elapsedMs = performance.now() - started;
  let value, ids, error;
  try {
    assert.equal(result.error, undefined);
    assert.ok((tool === 'rg' ? [0, 1] : [0]).includes(result.status));
    if (!c.args) {
      if (tool === 'rg') ids = result.stdout.split('\0').filter(Boolean).map(s => s.replace(/^\.\//, '')).sort();
      else {
        value = JSON.parse(result.stdout);
        assert.equal(value.search.complete, true);
        ids = value.search.results.map(hit => path.relative(c.directory, hit.path)).sort();
        if (tool === 'after') {
          assert.equal(value.search.scan.cache.writes, 0);
          assert.equal(value.search.scan.cache.enabled, false);
          assert.ok(value.search.results.every(hit => hit.sha256 === null));
        }
      }
      assert.deepEqual(ids, c.expected);
    }
  } catch (e) { error = e.message.split('\n')[0]; }
  const row = { case: c.id, tool, repeat, elapsedMs, exit: result.status, success: !error, matchedFiles: ids?.length };
  observations.push(row);
  if (error) failures.push({ ...row, error });
  return value;
}
for (const c of cases) {
  for (let repeat = 0; repeat < c.repeats; repeat++) {
    const tools = ['before', 'after', 'rg'];
    const order = tools.slice(repeat % 3).concat(tools.slice(0, repeat % 3));
    const outputs = {};
    for (const tool of order) outputs[tool] = sample(tool, c, repeat);
    if (outputs.before && outputs.after) {
      const same = comparable(outputs.before) === comparable(outputs.after);
      equal.push({ case: c.id, repeat, equal: same });
      assert.ok(same, `Ranking or original evidence changed: ${c.id}`);
    }
  }
  console.log(`${c.id}: ${c.repeats} fresh processes per tool`);
}
await assert.rejects(access(env.FILENS_SEARCH_CACHE_DIR), { code: 'ENOENT' });
const summary = cases.map(c => ({ case: c.id, label: c.label, samplesPerTool: c.repeats,
  tools: Object.fromEntries(['before', 'after', 'rg'].map(tool => {
    const rows = observations.filter(r => r.case === c.id && r.tool === tool), ms = rows.filter(r => r.success).map(r => r.elapsedMs);
    return [tool, { successful: ms.length, failed: rows.length - ms.length, firstMs: rows[0].elapsedMs, p50Ms: quantile(ms, .5), p95Ms: quantile(ms, .95) }];
  })) }));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const metadata = { observedAt: new Date().toISOString(), platform: `${process.platform}-${process.arch}`, cpu: os.cpus()[0].model,
  binarySHA256: Object.fromEntries(await Promise.all(Object.entries(binaries).map(async ([k, p]) => [k, sha(await readFile(p))]))), textWasmSHA256: sha(await readFile(wasm)),
  ripgrep: spawnSync('rg', ['--version'], { encoding: 'utf8' }).stdout.trim() };
const report = { metadata, storage: 'No persistent index or body cache. Before explicitly uses --no-cache, after never persists. Source hashes removed after; benchmark artifact hashes are recorded outside measured requests.',
  processCold: 'Every sample spawns a new process. No warm-up samples discarded. firstMs is the first observed invocation in this run, not a guarantee of cold executable pages.',
  diskCache, ordering: 'Rotate before/after/rg each repetition; no automatic retries; startup, traversal, extraction/ranking and serialization included.',
  limits: ['Single macOS machine, tiny synthetic documents. Not a universal performance claim.', 'BM25 and literal are different retrieval operations; the shared identifier only checks equivalent matches in this controlled workload.', 'Filename comparison uses rg --files without relevance ranking; one-file workload has a single candidate.', '2000-file sample uses three repeats; p95 is the maximum and is unstable. Existing source corpus must be generated by benchmark-agent-search.mjs.'],
  summary, equalOutputPairsIgnoringSourceHash: equal.length, equality: equal, failures, observations };
const bytes = Buffer.from(JSON.stringify(report, null, 2) + '\n');
assert.deepEqual(privacyIssues(bytes), []);
await writeFile(path.join(root, 'docs/agent-cli-search-startup.json'), bytes);
console.log(JSON.stringify({ summary, equalPairs: equal.length, failures: failures.length, diskCache }, null, 2));
assert.equal(failures.length, 0);
