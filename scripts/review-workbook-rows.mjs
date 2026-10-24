// Untimed model and table correctness checks against the previous workbook build.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const currentPath = 'packages/xlsx/dist/index.js';
const baselinePath = option('--baseline', 'tmp/continued-review/workbook-rows-baseline/dist/index.js');
const current = await import(pathToFileURL(path.join(root, currentPath)));
const baseline = await import(pathToFileURL(path.resolve(root, baselinePath)));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const dom = new JSDOM(); globalThis.document = dom.window.document;
const report = { currentArtifactSha256: hash(fs.readFileSync(path.join(root, currentPath))), baselineArtifactSha256: hash(fs.readFileSync(path.resolve(root, baselinePath))),
  samples: [], generatedTables: [], sourceRepresentations: [] };
const samples = JSON.parse(fs.readFileSync(path.join(root, 'tmp/performance-other/samples.json'))).filter(sample => ['csv', 'xlsx'].includes(sample.family));
for (const sample of samples) {
  const bytes = new Uint8Array(fs.readFileSync(path.join(root, sample.path)));
  assert.equal(hash(bytes), sample.sha256);
  const context = { descriptor: { source: bytes, name: sample.name, extension: sample.family } };
  const actual = await current.loadXlsxWorkbook(bytes, context), previous = await baseline.loadXlsxWorkbook(bytes, context);
  assert.deepEqual(actual, previous);
  const tables = actual.sheets.map((sheet, index) => {
    const table = current.createSheetTable(sheet, Math.min(sheet.rowCount, 100));
    const old = baseline.createSheetTable(previous.sheets[index], Math.min(sheet.rowCount, 100));
    current.appendSheetRows(table.tBodies[0], sheet, 101, Math.min(sheet.rowCount, 200));
    baseline.appendSheetRows(old.tBodies[0], previous.sheets[index], 101, Math.min(sheet.rowCount, 200));
    assert.equal(table.outerHTML, old.outerHTML);
    return { sheet: sheet.name, rows: table.tBodies[0].rows.length, htmlSha256: hash(table.outerHTML) };
  });
  report.samples.push({ name: sample.name, inputSha256: sample.sha256, fullModelSha256: hash(JSON.stringify(actual)), modelsMatch: true, tables });
}
let seed = 20261024;
const random = limit => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % limit);
for (let index = 0; index < 64; index++) {
  const sheet = { id: 'generated', name: 'Generated', rowCount: 80, columnCount: 5, rows: Array.from({ length: 120 }, () => {
    const row = 1 + random(80);
    return { index: row, cells: Array.from({ length: 6 }, (_, item) => {
      const column = 1 + random(5);
      return { ref: `cell-${item}`, row, column, value: `${index}:${row}:${item}:中文` };
    }) };
  }) };
  const oldSheet = structuredClone(sheet);
  const table = current.createSheetTable(sheet, 30), old = baseline.createSheetTable(oldSheet, 30);
  for (const [lib, model, output] of [[current, sheet, table], [baseline, oldSheet, old]]) {
    model.rows.reverse();
    model.rows.push({ index: 80, cells: [{ ref: 'E80', row: 80, column: 5, value: 'added after initial batch' }] });
    lib.appendSheetRows(output.tBodies[0], model, 31, 80);
  }
  assert.equal(table.outerHTML, old.outerHTML);
  report.generatedTables.push({ index, inputSha256: hash(JSON.stringify(sheet)), htmlSha256: hash(table.outerHTML), rows: table.tBodies[0].rows.length });
}
const bytes = new TextEncoder().encode('Name,Note\r\n中文,"line\nbreak"\r\n""');
const padded = new Uint8Array(bytes.length + 8); padded.set(bytes, 4);
const variants = { bytes, arrayBuffer: bytes.buffer, offsetView: new DataView(padded.buffer, 4, bytes.length), blob: new Blob([bytes]),
  dataUrl: `data:text/csv,${encodeURIComponent(new TextDecoder().decode(bytes))}`, base64Url: `data:text/csv;base64,${Buffer.from(bytes).toString('base64')}` };
const expected = await baseline.loadCsvWorkbook(bytes);
for (const [name, source] of Object.entries(variants)) { assert.deepEqual(await current.loadCsvWorkbook(source), expected); report.sourceRepresentations.push(name); }
dom.window.close();
const output = path.resolve(root, option('--output', 'tmp/continued-review/workbook-rows-content-review.json'));
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log({ samples: report.samples.length, generatedTables: report.generatedTables.length, sourceRepresentations: report.sourceRepresentations.length });
