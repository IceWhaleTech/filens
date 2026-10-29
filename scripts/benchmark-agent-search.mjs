// Reproducible synthetic retrieval measurements. Labels stay outside search roots.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { metrics, quantile, mean, summarize, pairedInterval } from './search-benchmark-metrics.mjs';
import { privacyIssues } from './agent-release-privacy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flag = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const binary = path.resolve(flag('--binary') ?? process.env.FILENS_AGENT_BINARY ?? path.join(root, 'dist/filens'));
const work = path.join(root, 'dist/agent-search-benchmark');
const resume = process.argv.includes('--resume');
const checkpointFile = path.join(work, 'checkpoint.json');
let checkpoint = {};
if (resume) checkpoint = JSON.parse(await readFile(checkpointFile, 'utf8'));
const corpus = path.join(work, 'corpus'), cache = path.join(work, 'cache');
const topicsBytes = await readFile(path.join(root, 'benchmarks/agent-search/topics.json'));
const topics = JSON.parse(topicsBytes);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const rel = name => path.relative(root, name).replaceAll('\\', '/');
const timing = values => ({ n: values.length, p50Ms: quantile(values, .5), p95Ms: quantile(values, .95), minMs: Math.min(...values), maxMs: Math.max(...values) });
function processRun(command, args, { cwd = root, env = process.env, statuses = [0, 1] } = {}) {
  const start = performance.now();
  const r = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 120000, maxBuffer: 32 << 20 });
  assert.equal(r.error, undefined, r.error?.message);
  assert.ok(statuses.includes(r.status), `${command} failed (${r.status}): ${r.stderr.slice(0, 1000)}`);
  return { stdout: r.stdout, stderr: r.stderr, ms: performance.now() - start, exit: r.status };
}
const filensArgs = (directory, query, mode = 'bm25', extra = [], ocr = false) => ['search', directory, '--query', query, '--search-mode', mode, '--max-results', '10', '--max-files', '20000', '--json', ...(ocr ? [] : ['--no-ocr']), ...extra];
function filens(directory, query, mode = 'bm25', cacheDirectory = cache, extra = [], ocr = false) {
  const r = processRun(binary, filensArgs(directory, query, mode, extra, ocr), { env: { ...process.env, FILENS_SEARCH_CACHE_DIR: cacheDirectory }, statuses: [0, 1, 2, 3] });
  const value = JSON.parse(r.stdout);
  if (!value.search) {
    operationalFailures.push({ directory: rel(directory), query, mode, exit: r.exit, elapsedMs: r.ms, error: JSON.parse(JSON.stringify(value.error ?? {}).replaceAll(root + '/', '')) });
    value.search = { results: [], complete: false, scan: { cache: { hits: 0 } } };
  }
  return { ...r, value, ids: value.search.results.map(hit => path.relative(directory, hit.path).replaceAll('\\', '/')) };
}
const stop = new Set('a an the is are was were who what which how do does must can may be to for of in on with and or under currently policy'.split(' '));
function queryTerms(query) {
  const result = [];
  for (const token of query.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+(?:[._:\-][\p{L}\p{N}]+)*/gu) ?? []) {
    if (/^[\p{Script=Han}]+$/u.test(token)) {
      const chars = [...token];
      if (chars.length === 1) result.push(token);
      for (let i = 1; i < chars.length; i++) result.push(chars[i - 1] + chars[i]);
    } else if (!stop.has(token)) result.push(token);
  }
  return [...new Set(result)].slice(0, 100);
}
function baseline(tool, directory, query) {
  const terms = tool === 'rg-phrase' ? [query] : queryTerms(query);
  const patterns = terms.flatMap(term => ['-e', term]);
  const command = tool.startsWith('rg') ? 'rg' : 'git';
  const args = tool.startsWith('rg')
    ? ['--files-with-matches', '--null', '--fixed-strings', '--no-ignore', ...(tool === 'rg-phrase' ? [] : ['--ignore-case']), ...patterns, '--', '.']
    : ['--no-pager', 'grep', '--no-index', '--no-exclude-standard', '-I', '-l', '-z', '-i', '-F', ...patterns, '--', '.'];
  const r = processRun(command, args, { cwd: directory });
  const ids = [...new Set(r.stdout.split('\0').filter(Boolean).map(id => id.replace(/^\.\//, '').replaceAll('\\', '/')))].sort();
  return { ...r, ids, command, args };
}
const tools = ['filens-bm25', 'filens-exact', 'rg-phrase', 'rg-terms', 'git-grep-terms'];
const docs = [], queries = [];
const operationalFailures = [];
if (!resume) await rm(work, { recursive: true, force: true });
await mkdir(corpus, { recursive: true });
for (const [index, topic] of topics.entries()) {
  const id = suffix => `f${String(index * 9 + suffix).padStart(3, '0')}.txt`;
  const current = [id(0), id(1)];
  const lead = topic.language === 'zh' ? '现行规定' : 'Current instruction';
  for (let i = 0; i < 9; i++) {
    let text;
    if (i < 2) text = `${lead}: ${topic.title}\n${topic.fact}\n${topic.language === 'zh' ? '记录编号' : 'Record'}: ${topic.code}\n`;
    else if (i === 2) text = `${topic.fact.replaceAll('现行', '归档2025年').replaceAll('current', 'archived').replaceAll(topic.number, topic.oldNumber)}\nArchived record: ${topic.code.replace('2026', '2025')}\n`;
    else if (i === 3) text = `${topic.language === 'zh' ? '术语展示，不包含现行业务规则' : 'Vocabulary display, without business instructions'}: ${topic.terms.join(', ')}.\n`;
    else text = `Field notebook ${index}-${i}.\nThe atrium has a blue desk beside the reading room. Plants are watered on Tuesday.\n资料室记录书架位置和窗帘颜色，不记录业务规定。\n`;
    if (topic.id === 'calibration' && i === 0) text = 'General background observations about the workshop and its wooden shelves.\n'.repeat(600) + text;
    docs.push({ id: id(i), family: topic.id, text, sha256: sha(Buffer.from(text)) });
    await writeFile(path.join(corpus, id(i)), text);
  }
  const add = (category, query, relevant, evidence = topic.evidence) => queries.push({ id: `${topic.id}-${category}`, family: topic.id, category, query, relevant, evidence });
  add('identifier', topic.code, current);
  add('number', topic.number, current);
  add(topic.language === 'zh' ? 'Chinese-terms' : 'English-terms', topic.lexical, current);
  add('literal-phrase', topic.phrase, docs.filter(d => d.text.includes(topic.phrase)).map(d => d.id), topic.phrase);
  add('paraphrase', (topic.language === 'zh' ? '按现行规定，' : 'Under the current policy, ') + topic.paraphrase, current);
  add('cross-language', (topic.language === 'zh' ? 'Under the current policy, ' : '按现行规定，') + topic.crossLanguage, current);
  add('absent-identifier', `UNKNOWN2099Z${index}`, []);
  add('absent-fact', topic.missing, []);
}
// Freeze generated text and relevance labels before observing any search result.
const manifest = { schema: 'filens-search-benchmark-v1', topicsSHA256: sha(topicsBytes),
  documents: docs.map(({ text, ...d }) => ({ ...d, bytes: Buffer.byteLength(text) })), queries };
const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
if (resume) assert.equal(checkpoint.manifestSHA256, sha(manifestBytes), 'Cannot resume with changed labels');
await writeFile(path.join(work, 'manifest.json'), manifestBytes);
const runMetadata = { date: new Date().toISOString(), platform: `${process.platform}-${process.arch}`, os: os.release(), cpu: os.cpus()[0].model, logicalCpus: os.cpus().length,
  totalMemoryBytes: os.totalmem(), node: process.version, binary: rel(binary), binarySHA256: sha(await readFile(binary)),
  textWasmSHA256: sha(await readFile(path.join(path.dirname(binary), 'converter-text.wasm'))),
  ripgrep: processRun('rg', ['--version']).stdout.trim(), git: processRun('git', ['--version']).stdout.trim(), corpusSHA256: sha(manifestBytes),
  corpusFiles: docs.length, corpusBytes: docs.reduce((n, d) => n + Buffer.byteLength(d.text), 0), queries: queries.length, relevance: 'Synthetic labels by construction, not human annotations or a held-out external dataset.' };
if (resume) assert.equal(checkpoint.binarySHA256, runMetadata.binarySHA256, 'Cannot resume a different binary');
const prep = checkpoint.prep ?? filens(corpus, queries[0].query);
console.log(`Prepared ${docs.length} documents and ${queries.length} frozen queries; initial extraction ${prep.ms.toFixed(0)} ms.`);
const observations = checkpoint.observations ?? [];
for (const [index, query] of queries.entries()) {
  if (observations.some(o => o.queryId === query.id)) continue;
  const order = tools.slice(index % tools.length).concat(tools.slice(0, index % tools.length));
  for (const tool of order) {
    const ranked = tool.startsWith('filens');
    const r = ranked ? filens(corpus, query.query, tool === 'filens-exact' ? 'exact' : 'bm25') : baseline(tool, corpus, query.query);
    const m = metrics(r.ids, query.relevant, ranked);
    if (ranked) {
      const hits = r.value.search.results;
      m.offsetsValid = hits.every(hit => {
        const original = docs.find(d => d.id === path.relative(corpus, hit.path));
        return original && hit.sha256 === original.sha256 && hit.excerpts.every(e => Buffer.from(original.text).subarray(e.startByte, e.endByte).toString() === e.text);
      });
      if (query.relevant.length) m.evidenceHit = hits.slice(0, 5).some(hit => query.relevant.includes(path.relative(corpus, hit.path)) && hit.excerpts.some(e => e.text.includes(query.evidence)));
    }
    observations.push({ queryId: query.id, family: query.family, category: query.category, tool, elapsedMs: r.ms, exit: r.exit, complete: ranked ? r.value.search.complete : true,
      files: r.ids, returnedBytes: Buffer.byteLength(r.stdout), cacheHits: ranked ? r.value.search.scan.cache.hits : null, metrics: m });
  }
  if (index % 12 === 0) console.log(`Accuracy: ${index + 1}/${queries.length} queries, all five configurations.`);
}
const quality = Object.fromEntries(tools.map(tool => {
  const rows = observations.filter(r => r.tool === tool);
  return [tool, { queries: rows.length, failures: rows.filter(r => !r.complete).length, ...summarize(rows.map(r => r.metrics)),
    latency: timing(rows.map(r => r.elapsedMs)), categories: Object.fromEntries([...new Set(queries.map(q => q.category))].map(category => [category, summarize(rows.filter(r => r.category === category).map(r => r.metrics))])) }];
}));
const scales = checkpoint.scales ?? [];
const saveCheckpoint = async () => writeFile(checkpointFile, JSON.stringify({ manifestSHA256: sha(manifestBytes), binarySHA256: runMetadata.binarySHA256, prep, observations, scales, operationalFailures }));
await saveCheckpoint();
for (const count of [100, 500, 2000]) {
  if (scales.some(s => s.files === count)) continue;
  const directory = path.join(work, `scale-${count}`), scaleCache = path.join(work, `cache-${count}`);
  await mkdir(directory, { recursive: true });
  for (let i = 0; i < count; i++) await writeFile(path.join(directory, `f${String(i).padStart(5, '0')}.txt`), 'Ordinary field observations. The corridor contains desks and books.\n'.repeat(6) + (i === Math.floor(count * .91) ? 'SPEED2026 approved evidence near the end.\n' : 'No special project identifier in this entry.\n'));
  const first = filens(directory, 'SPEED2026', 'bm25', scaleCache);
  const samples = { 'filens-bm25': [], 'rg-phrase': [], 'git-grep-terms': [] };
  const failureCounts = Object.fromEntries(Object.keys(samples).map(tool => [tool, 0]));
  for (let repeat = 0; repeat < 15; repeat++) {
    const order = Object.keys(samples); if (repeat % 2) order.reverse();
    for (const tool of order) {
      const r = tool === 'filens-bm25' ? filens(directory, 'SPEED2026', 'bm25', scaleCache) : baseline(tool, directory, 'SPEED2026');
      if (r.ids.length === 1 && (!r.value || r.value.search.complete)) samples[tool].push(r.ms);
      else failureCounts[tool]++;
    }
  }
  async function directoryBytes(dir) { let size = 0; for (const item of await readdir(dir, { withFileTypes: true })) size += item.isDirectory() ? await directoryBytes(path.join(dir, item.name)) : (await stat(path.join(dir, item.name))).size; return size; }
  const scale = { files: count, sourceBytes: await directoryBytes(directory), firstExtractionMs: first.ms, firstCacheWrites: first.value.search.scan.cache.writes,
    cacheBytes: await directoryBytes(scaleCache), attemptsPerTool: 15, failedCachedQueries: failureCounts, cached: Object.fromEntries(Object.entries(samples).map(([tool, values]) => [tool, timing(values)])) };
  if (process.platform === 'darwin') {
    const resource = processRun('/usr/bin/time', ['-l', binary, ...filensArgs(directory, 'SPEED2026')], { env: { ...process.env, FILENS_SEARCH_CACHE_DIR: scaleCache }, statuses: [0, 1, 3] });
    const match = resource.stderr.match(/(\d+)\s+maximum resident set size/);
    scale.maxProcessResidentBytes = match ? Number(match[1]) : null;
    scale.resourceScope = 'One cached CLI run via macOS time -l; maximum process RSS, not sum of simultaneous supervisor/worker memory.';
  }
  scales.push(scale); await saveCheckpoint(); console.log(`Scale ${count}: first ${first.ms.toFixed(0)} ms, cached p50 ${scale.cached['filens-bm25'].p50Ms?.toFixed(0)} ms, failures ${failureCounts['filens-bm25']}.`);
}
// Modifications and removals must affect the very next cached query.
const updateRoot = path.join(work, 'updates'), updateCache = path.join(work, 'cache-updates');
await mkdir(updateRoot, { recursive: true });
const updateFile = path.join(updateRoot, 'note.txt'); await writeFile(updateFile, 'UPDATE2026OLD\n');
filens(updateRoot, 'UPDATE2026OLD', 'bm25', updateCache);
const updates = [];
await writeFile(updateFile, 'UPDATE2026NEW\n');
for (const query of ['UPDATE2026OLD', 'UPDATE2026NEW']) { const r = filens(updateRoot, query, 'bm25', updateCache); updates.push({ action: 'edit', query, matchedFiles: r.ids.length, elapsedMs: r.ms }); }
await rm(updateFile);
{ const r = filens(updateRoot, 'UPDATE2026NEW', 'bm25', updateCache); updates.push({ action: 'delete', query: 'UPDATE2026NEW', matchedFiles: r.ids.length, elapsedMs: r.ms }); }
assert.deepEqual(updates.map(r => r.matchedFiles), [0, 1, 0]);
// Both tools use the exact same FiLens-extracted text for Office/PDF/image comparison.
const originals = path.join(work, 'documents'), extracted = path.join(work, 'extracted'), documentCache = path.join(work, 'cache-documents');
await mkdir(originals, { recursive: true }); await mkdir(extracted, { recursive: true });
const material = [['brief.docx', 'dist/agent-demo/en/launch-brief.docx'], ['invoice.png', 'dist/agent-demo/en/invoice.png'], ['scan.pdf', 'converter/rapidocr/testdata/scan.pdf']];
const extraction = [];
for (const [name, from] of material) {
  await copyFile(path.join(root, from), path.join(originals, name));
  const r = processRun(binary, ['read', path.join(originals, name), '--layout', '--json'], { statuses: [0, 3] });
  const value = JSON.parse(r.stdout);
  await writeFile(path.join(extracted, name + '.txt'), value.content?.text ?? '');
  extraction.push({ file: name, sha256: sha(await readFile(path.join(originals, name))), elapsedMs: r.ms, complete: value.content?.complete === true, characters: value.content?.text?.length ?? 0 });
}
const documentQueries = [{ query: 'BRIGHT2027', relevant: ['scan.pdf'] }, { query: '12345.67', relevant: ['brief.docx', 'invoice.png'] }, { query: 'FILENS2026', relevant: ['invoice.png'] }];
const documentResults = [];
for (const q of documentQueries) {
  const r = filens(originals, q.query, 'bm25', documentCache, ['--layout'], true);
  const b = baseline('rg-phrase', extracted, q.query);
  documentResults.push({ query: q.query, relevant: q.relevant, filens: { elapsedMs: r.ms, files: r.ids, complete: r.value.search.complete, metrics: metrics(r.ids, q.relevant),
    pageOrBounds: r.value.search.results.some(hit => hit.excerpts.some(e => e.layout?.blocks?.some(block => block.page || block.bounds))) },
    rgWithSharedExtraction: { elapsedMs: b.ms, files: b.ids.map(id => id.replace(/\.txt$/, '')), metrics: metrics(b.ids.map(id => id.replace(/\.txt$/, '')), q.relevant, false) } });
}
const result = { metadata: runMetadata, manifest, configurations: {
  'filens-bm25': 'CLI default BM25 + exact boost, cached full text, maxResults=10; source checked by SHA-256 every query.',
  'filens-exact': 'CLI case-sensitive literal mode, maxResults=10; capped result list.',
  'rg-phrase': 'rg -l -0 -F: case-sensitive literal query, all matching files.',
  'rg-terms': 'rg -l -0 -i -F: OR of Unicode word/Han-bigram query terms, all matching files; no relevance ranking.',
  'git-grep-terms': 'git grep --no-index -l -z -i -F: same OR terms, all matching files; no relevance ranking.' },
  measurement: { ordering: 'Five tool configurations rotated per query. Scaling alternates order across 15 repeats. Fresh process per request.',
    coldMeaning: 'Empty FiLens extraction cache, not a dropped OS page cache. One initial extraction per scale. Cached percentiles use nearest rank, n=15.',
    scopes: 'Same UTF-8 corpus for retrieval; raw document comparison uses the same FiLens extractor on both sides. Startup, enumeration, hashing/cache verification and ranking are included in CLI latency.',
    topKForUnranked: 'rg/git candidates are sorted by relative path for a reproducible capped Agent view; MRR and nDCG are not assigned. Candidate recall/precision includes their complete output. This ordering is not semantic ranking.',
    noAnswer: 'Any nonempty candidate set on absent-fact or absent-identifier queries is a false positive for this evaluation; retrieval scores do not constitute an answer detector.',
    tuning: 'Corpus and query labels frozen before runs. No query-dependent tuning; default search mode/thresholds used. Repeated documents belong to one topic family.',
    limits: ['Small synthetic developer-labelled corpus, not held-out real-world relevance or an Agent end-to-end benchmark.', 'Source-cache indexing and no embedding model in FiLens; this is not a full semantic-product comparison.', 'Numbers and phrase queries use literal relevance, including matching archives. Natural-language questions explicitly request current instructions.', 'Single macOS machine; no Windows/Linux performance conclusion.', 'Short synthetic documents dominate scaling; PDF/OCR and disk-cache behavior require larger separate studies.'] },
  prep: { elapsedMs: prep.ms, cacheWrites: prep.value.search.scan.cache.writes }, quality, observations,
  pairedHit5: pairedInterval(observations, 'filens-bm25', 'rg-terms'), scales, updates,
  documents: { extraction, sharedExtractionMs: extraction.reduce((n, r) => n + r.elapsedMs, 0), queries: documentResults }, operationalFailures,
  preliminaryAttempt: { completed: false, stage: '2000-file cached query', exit: 1, reason: 'Initial instrumentation aborted on an unexpected exit and did not retain stdout. Standalone replay succeeded; cause remains unconfirmed. Full rerun records failures and never retries them automatically.' },
  notMeasured: [{ tool: 'zvec-grep', commit: '891497fa87d3e03d0c9273fed0ba3e75af62f179', reason: 'Not executed in this run; needs a separate persistent-index/embedding comparison. Its ripgrep + BM25 + vector hybrid is not represented by rg alone; no superiority claim is made.' }] };
const json = JSON.stringify(result, null, 2) + '\n';
assert.deepEqual(privacyIssues(Buffer.from(json)), []);
await writeFile(path.join(work, 'report.json'), json);
await writeFile(path.join(root, 'docs/agent-cli-search-benchmark.json'), json);
console.log('Saved public benchmark observations.');
