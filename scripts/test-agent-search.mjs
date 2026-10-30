// Real CLI/WASM retrieval, traversal, offsets and request-local storage checks.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, copyFile, mkdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import { executableName } from './agent-platforms.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.FILENS_AGENT_BINARY || path.join(root, 'dist/agent-lite', executableName(`${process.platform}-${process.arch}`));
const directory = path.join(root, 'dist/agent-search' + (process.env.FILENS_WALKER === 'hdrw-wasi' ? '-hdrw' : '') + (process.argv.includes('--ocr') ? '-ocr' : ''));
const corpus = path.join(directory, 'corpus docs');
const cache = path.join(directory, 'cache');
await rm(directory, { recursive: true, force: true });
await mkdir(corpus, { recursive: true });
const observations = [];
function run(args, expected = 0, stdin, environment = {}, executable = binary) {
  const start = performance.now();
  const result = spawnSync(executable, args, { cwd: root, input: stdin, encoding: 'utf8',
    env: { ...process.env, FILENS_SEARCH_CACHE_DIR: cache, ...environment }, timeout: 120000, maxBuffer: 32 << 20 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, expected, `${args.join(' ')}\n${result.stderr}\n${result.stdout}`);
  observations.push({ args, exit: result.status, ms: Math.round(performance.now() - start) });
  return result.stdout;
}
const json = (args, expected = 0, stdin) => JSON.parse(run(args, expected, stdin));
const query = (text, extra = [], expected = 0) => json(['search', corpus, '--query', text, '--json', '--no-ocr', ...extra], expected);
const cap = json(['capacity', '--json', '--no-ocr']);
assert.ok(cap.capacity.operations.some(o => o.name === 'search'));
assert.equal(cap.capacity.search.semantic, false);
if (process.platform === 'darwin' && process.env.FILENS_WALKER !== 'hdrw-wasi') {
  assert.equal(cap.capacity.search.discovery.backend, 'fts');
  assert.equal(cap.capacity.search.discovery.hdrwEmbedded, false);
}
const budget = '会议记录\n预算不得超过12345.67元；新增开销必须由负责人审批。\n风险：极小字体可能漏字，请核对原图。\n';
await writeFile(path.join(corpus, 'budget.txt'), budget);
await writeFile(path.join(corpus, 'wrong.txt'), '预算12345.76元，编号FILENS2027。');
await writeFile(path.join(corpus, 'release.txt'), 'Release decision: FILENS2026 must pass Windows testing. Do not publish before verification.');
await writeFile(path.join(corpus, 'long.txt'), 'ordinary background\n'.repeat(1000) + 'TAILNEEDLE782 approval at the end.\n');
await writeFile(path.join(corpus, 'opaque.bin'), new Uint8Array([0, 1, 2]));
await writeFile(path.join(corpus, '.hidden.txt'), 'HIDDENNEEDLE782');
await mkdir(path.join(corpus, 'nested'), { recursive: true });
await writeFile(path.join(corpus, 'nested/note.txt'), 'DEPTHNEEDLE782');
for (const name of ['node_modules', '.git', 'dist', 'target']) {
  await mkdir(path.join(corpus, name), { recursive: true });
  await writeFile(path.join(corpus, name, 'ignore.txt'), 'EXCLUDEDNEEDLE782');
}
let symlinks = false;
try {
  await writeFile(path.join(directory, 'outside.txt'), 'OUTSIDENEEDLE782');
  await symlink(path.join(directory, 'outside.txt'), path.join(corpus, 'link.txt'));
  await symlink(corpus, path.join(corpus, 'cycle'), 'dir');
  symlinks = true;
} catch (error) {
  if (!['EPERM', 'EACCES'].includes(error.code)) throw error;
}
const source = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Milestone evidence</w:t></w:r></w:p><w:p><w:r><w:t>The native OCR milestone is ready.</w:t></w:r></w:p></w:body></w:document>';
await writeFile(path.join(corpus, 'milestone.docx'), zipSync({
  '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
  'word/document.xml': strToU8(source),
}));
const cold = query('预算');
assert.equal(cold.search.complete, true);
assert.equal(cold.search.semantic, false);
assert.ok(cold.search.results.some(r => r.path.endsWith('budget.txt')));
assert.deepEqual(cold.search.scope.extensions, cap.capacity.formats.filter(f => f.textExtraction || f.archiveSearch).map(f => f.format));
const warm = query('预算');
assert.equal(warm.search.scan.cache.enabled, false);
assert.equal(warm.search.scan.cache.hits, 0);
assert.equal(warm.search.scan.cache.writes, 0);
assert.equal(warm.search.scan.integrity, 'assumed');
await assert.rejects(access(cache), { code: 'ENOENT' });
assert.equal(warm.search.matchedFiles, cold.search.matchedFiles);
const precise = query('预算 12345.67');
assert.equal(precise.search.matchedFiles, 1);
assert.ok(precise.search.results[0].path.endsWith('budget.txt'));
for (const hit of precise.search.results) {
  assert.equal(hit.sha256, null);
  const full = json(['read', hit.path, '--json', '--no-ocr']).content.text;
  for (const excerpt of hit.excerpts) {
    assert.equal(Buffer.from(full).subarray(excerpt.startByte, excerpt.endByte).toString(), excerpt.text);
    assert.equal(full.slice(0, Buffer.from(full).subarray(0, excerpt.startByte).toString().length).split('\n').length, excerpt.startLine);
  }
}
assert.equal(query('FILENS2026').search.matchedFiles, 1);
assert.equal(query('UNOBTAINIUM782').search.matchedFiles, 0);
assert.equal(query('TAILNEEDLE782').search.matchedFiles, 1);
assert.equal(query('HIDDENNEEDLE782').search.matchedFiles, 0);
assert.equal(query('HIDDENNEEDLE782', ['--include-hidden']).search.matchedFiles, 1);
assert.equal(query('EXCLUDEDNEEDLE782', ['--include-hidden']).search.matchedFiles, 0);
assert.equal(query('DEPTHNEEDLE782', ['--max-depth', '1']).search.matchedFiles, 0);
if (symlinks) assert.equal(query('OUTSIDENEEDLE782').search.matchedFiles, 0);
const names = query('opaque', ['--search-mode', 'files']);
assert.equal(names.search.matchedFiles, 1);
assert.equal(names.search.results[0].sha256, null);
assert.deepEqual(names.search.results[0].excerpts, []);
const literal = query('must pass Windows testing.', ['--search-mode', 'exact']);
assert.equal(literal.search.matchedFiles, 1);
assert.equal(query('MUST PASS Windows testing.', ['--search-mode', 'exact']).search.matchedFiles, 0);
const structured = json(['-'], 0, JSON.stringify({ operation: 'search', input: corpus, query: '预算', format: 'json', cache: false }));
assert.equal(structured.search.scan.cache.enabled, false);
const chinese = json([`在 "${corpus}" 中搜索 "预算"，以 JSON 输出`, '--no-ocr']);
const english = json([`search "${corpus}" for "budget" as json`, '--no-ocr']);
assert.equal(chinese.operation, 'search');
assert.ok(english.search.results.some(r => r.path.endsWith('budget.txt')));
const logical = query('milestone', ['--layout', '--no-cache']);
assert.ok(logical.search.results[0].excerpts[0].layout.blocks.some(b => b.kind === 'heading'));
assert.ok(logical.search.results[0].excerpts[0].layout.blocks.every(b => !b.bounds));
for (const format of ['text', 'json', 'markdown', 'html', 'yaml', 'xml', 'csv', 'tsv']) {
  const value = run(['search', corpus, '--query', '预算', '--format', format, '--no-ocr']);
  assert.ok(value.includes('budget.txt'));
  if (format === 'json') assert.equal(JSON.parse(value).operation, 'search');
  if (format === 'html') assert.match(value, /<!doctype html>/);
  if (format === 'csv') assert.match(value, /^"path","score"/);
  if (format === 'tsv') assert.match(value, /^"path"\t"score"/);
}
assert.equal(query('预算', ['--max-results', '1']).search.returnedFiles, 1);
assert.equal(query('预算', ['--max-files', '1'], 3).search.complete, false);
await writeFile(path.join(corpus, 'budget.txt'), budget.replace('12345.67', '98765.43'));
assert.equal(query('12345.67').search.matchedFiles, 0);
assert.equal(query('98765.43').search.matchedFiles, 1);
await unlink(path.join(corpus, 'budget.txt'));
assert.equal(query('98765.43').search.matchedFiles, 0);
await writeFile(path.join(corpus, 'broken.docx'), 'not a document');
const incomplete = query('FILENS2026', [], 3);
assert.equal(incomplete.search.scan.extractionErrorCount, 1);
assert.equal(incomplete.search.matchedFiles, 1);
for (const request of [
  { operation: 'search', input: corpus },
  { operation: 'search', input: corpus, query: 'budget', maxResults: 0 },
  { operation: 'search', input: corpus, query: 'budget', searchMode: 'semantic' },
  { operation: 'search', input: corpus, query: 'budget', summaryChars: 100 },
  { operation: 'search', input: corpus, query: 'budget', cache: true },
]) assert.equal(json(['-', '--no-ocr'], 2, JSON.stringify(request)).ok, false);
// Actual pooled-WASM coverage: deterministic results and partial errors must
// survive multiple workers, independently of the single-file startup path.
const pooled = path.join(directory, 'parallel');
await mkdir(pooled, { recursive: true });
for (let i = 0; i < 80; i++) await writeFile(path.join(pooled, `${String(i).padStart(3, '0')}.txt`), `ordinary field notes ${i}.\nTHREAD2026 approved evidence ${i}.\n`);
await writeFile(path.join(pooled, 'broken.docx'), 'not a document');
const pooledArgs = ['search', pooled, '--query', 'THREAD2026', '--no-ocr', '--json'];
const serial = JSON.parse(run(pooledArgs, 3, undefined, { FILENS_SEARCH_JOBS: '1' }));
const parallel = JSON.parse(run(pooledArgs, 3, undefined, { FILENS_SEARCH_JOBS: '4' }));
assert.deepEqual(serial.search.results, parallel.search.results);
assert.deepEqual(serial.content, parallel.content);
assert.equal(parallel.search.scan.execution.sharedTextModules, 1);
assert.equal(parallel.search.scan.execution.workers, 4);
assert.equal(parallel.search.scan.extractionErrorCount, 1);
assert.equal(serial.search.matchedFiles, 80);
await unlink(path.join(pooled, 'broken.docx'));
const pure = JSON.parse(run(pooledArgs, 0, undefined, { FILENS_SEARCH_JOBS: '4', FILENS_TEXT_WASM: undefined }));
assert.equal(pure.search.scan.execution.sharedTextModules, 0);
assert.equal(pure.search.scan.execution.nativeFiles, 80);
assert.equal(pure.search.scan.execution.ranking, 'native-rust');
assert.deepEqual(pure.search.results, parallel.search.results);
const standalone = path.join(directory, 'standalone');
const encodings = path.join(directory, 'encodings');
await mkdir(standalone, { recursive: true });
await mkdir(encodings, { recursive: true });
const standaloneBinary = path.join(standalone, path.basename(binary));
await copyFile(binary, standaloneBinary);
await writeFile(path.join(encodings, 'utf16.txt'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('ENCODE2026 café\r\n', 'utf16le')]));
await writeFile(path.join(encodings, 'latin.txt'), Buffer.from('ENCODE2026 café\r\n', 'latin1'));
await writeFile(path.join(encodings, 'utf8.txt'), '\ufeffENCODE2026 café\r\n');
const standaloneResult = JSON.parse(run(['search', encodings, '--query', 'ENCODE2026', '--json'], 0, undefined, { FILENS_TEXT_WASM: undefined }, standaloneBinary));
assert.equal(standaloneResult.search.matchedFiles, 3);
assert.equal(standaloneResult.search.scan.execution.sharedTextModules, 0);
assert.ok(standaloneResult.search.results.every(hit => hit.excerpts[0].text === 'ENCODE2026 café'));
const standaloneNames = JSON.parse(run(['search', encodings, '--query', 'latin', '--search-mode', 'files', '--json'], 0, undefined, { FILENS_TEXT_WASM: undefined }, standaloneBinary));
assert.equal(standaloneNames.search.matchedFiles, 1);
assert.equal(standaloneNames.search.scan.execution.sharedTextModules, 0);
await assert.rejects(access(cache), { code: 'ENOENT' });
if (process.argv.includes('--ocr')) {
  await unlink(path.join(corpus, 'broken.docx'));
  const scan = path.join(corpus, 'scanned.pdf');
  await copyFile(path.join(root, 'converter/rapidocr/testdata/scan.pdf'), scan);
  const recognized = json(['search', corpus, '--query', 'BRIGHT2027', '--layout', '--no-cache', '--json']);
  assert.equal(recognized.search.matchedFiles, 1);
  const hit = recognized.search.results[0];
  assert.ok(hit.excerpts.some(e => e.layout.blocks.some(b => b.page === 2 && b.bounds.unit === 'pt')));
  const absent = query('BRIGHT2027', ['--no-cache'], 3);
  assert.ok(absent.search.scan.extractionErrorCount >= 1);
  assert.equal(absent.search.matchedFiles, 0);
}
await writeFile(path.join(directory, 'report.json'), JSON.stringify({ platform: `${process.platform}-${process.arch}`, binary, symlinks, observations,
  coldMs: observations[1].ms, warmMs: observations[2].ms, note: 'Functional checks on synthetic data, not a retrieval-quality benchmark.' }, null, 2) + '\n');
console.log(`${observations.length} real CLI search checks passed: traversal, Chinese/English, eight outputs, source offsets/layout, limits, no persistent cache/hashes, changes/deletes and partial errors.`);
