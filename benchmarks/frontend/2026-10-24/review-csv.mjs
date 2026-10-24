// Untimed correctness review. Reconstruct the baseline as described in csv-review.json.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const currentPath = 'packages/xlsx/dist/index.js';
const baselinePath = option('--baseline', 'tmp/continued-review/csv-baseline/dist/index.js');
const current = await import(pathToFileURL(path.join(root, currentPath)));
const baseline = await import(pathToFileURL(path.resolve(root, baselinePath)));
const require = createRequire(import.meta.url);
const Papa = require(path.join(root, 'tmp/performance-other/node_modules/papaparse/papaparse.js'));
const sandbox = {};
vm.runInNewContext(fs.readFileSync(path.join(root, 'tmp/performance-other/xlsx.full.min.js'), 'utf8'), sandbox);
const { XLSX } = sandbox;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const report = {
  currentArtifactSha256: hash(fs.readFileSync(path.join(root, currentPath))),
  baselineArtifactSha256: hash(fs.readFileSync(path.resolve(root, baselinePath))),
  samples: [], randomCases: 240, sourceRepresentations: [], repairedCases: []
};
const samples = JSON.parse(fs.readFileSync(path.join(root, 'tmp/performance-other/samples.json')))
  .filter(sample => ['csv', 'xlsx'].includes(sample.family));
for (const sample of samples) {
  const bytes = new Uint8Array(fs.readFileSync(path.join(root, sample.path)));
  assert.equal(hash(bytes), sample.sha256);
  const context = { descriptor: { source: bytes, name: sample.name, extension: sample.family } };
  const load = module => sample.family === 'csv' ? module.loadCsvWorkbook(bytes, context) : module.loadXlsxWorkbook(bytes, context);
  const actual = await load(current), previous = await load(baseline);
  assert.deepEqual(actual, previous);
  if (sample.family === 'csv') {
    const parsed = Papa.parse(new TextDecoder().decode(bytes), { delimiter: ',', dynamicTyping: false });
    assert.deepEqual(parsed.errors, []);
    assert.deepEqual(actual.sheets[0].rows.map(row => row.cells.map(cell => cell.value)), parsed.data);
    const workbook = XLSX.read(bytes, { type: 'array', raw: true, codepage: 65001 });
    const sheetJsValues = Array.from(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, raw: true, defval: '' }), row => Array.from(row, String));
    assert.deepEqual(actual.sheets[0].rows.map(row => row.cells.map(cell => cell.value)), sheetJsValues);
  }
  report.samples.push({ name: sample.name, inputSha256: sample.sha256, fullModelSha256: hash(JSON.stringify(actual)), fullModelMatches: true,
    rows: actual.sheets.reduce((total, sheet) => total + sheet.rows.length, 0),
    cells: actual.sheets.reduce((total, sheet) => total + sheet.rows.reduce((count, row) => count + row.cells.length, 0), 0),
    papaParseValuesMatch: sample.family === 'csv', sheetJsUtf8ValuesMatch: sample.family === 'csv' });
}

let seed = 20261024;
const random = limit => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % limit);
const quote = value => `"${value.replaceAll('"', '""')}"`;
const pool = ['', '中文😀', ' a ', 'a,b', '"', 'say "hello"', 'line\nbreak', 'line\rbreak', 'line\r\nbreak', 'notes '.repeat(300)];
for (let iteration = 0; iteration < report.randomCases; iteration++) {
  const newline = ['\r\n', '\r', '\n'][iteration % 3];
  const values = Array.from({ length: 1 + random(20) }, () => Array.from({ length: 1 + random(32) }, () => pool[random(pool.length)]));
  // Keep mixed CR/LF inside fields; alternate always-quoted and minimally quoted writers.
  const text = values.map(row => row.map(value => iteration % 2 || /[",\r\n]/.test(value) || value === '' ? quote(value) : value).join(',')).join(newline);
  const source = new TextEncoder().encode((iteration % 5 === 0 ? '\uFEFF' : '') + text);
  const sheet = (await current.loadCsvWorkbook(source)).sheets[0];
  assert.deepEqual(sheet.rows.map(row => row.cells.map(cell => cell.value)), values);
  assert.equal(sheet.rowCount, values.length);
  assert.equal(sheet.columnCount, Math.max(...values.map(row => row.length)));
}

const sourceText = 'Name,Note\r\n中文,"line\nbreak"\r\n""';
const bytes = new TextEncoder().encode(sourceText);
const padded = new Uint8Array(bytes.length + 8); padded.set(bytes, 4);
const variants = {
  bytes, arrayBuffer: bytes.buffer, offsetView: new DataView(padded.buffer, 4, bytes.length),
  blob: new Blob([bytes]), dataUrl: `data:text/csv,${encodeURIComponent(sourceText)}`,
  base64Url: `data:text/csv;base64,${Buffer.from(bytes).toString('base64')}`
};
const expected = await current.loadCsvWorkbook(bytes);
for (const [name, source] of Object.entries(variants)) {
  assert.deepEqual(await current.loadCsvWorkbook(source), expected);
  report.sourceRepresentations.push(name);
}
for (const text of ['""', 'a\n""', '""\r\n""', '\uFEFF""']) {
  const source = new TextEncoder().encode(text);
  const actual = await current.loadCsvWorkbook(source), previous = await baseline.loadCsvWorkbook(source);
  const expected = text.includes('\n') ? [[text.startsWith('a') ? 'a' : ''], ['']] : [['']];
  assert.deepEqual(actual.sheets[0].rows.map(row => row.cells.map(cell => cell.value)), expected);
  assert.notDeepEqual(actual, previous);
  report.repairedCases.push({ input: text, values: expected, previousRowCount: previous.sheets[0].rowCount, currentRowCount: actual.sheets[0].rowCount });
}
const output = path.resolve(root, option('--output', 'tmp/continued-review/csv-content-review.json'));
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ samples: report.samples.length, randomCases: report.randomCases, sourceRepresentations: report.sourceRepresentations.length, repairedCases: report.repairedCases.length, output }));
