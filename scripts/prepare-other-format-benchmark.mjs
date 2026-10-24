import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.join(root, 'tmp/performance-other');
await fs.mkdir(path.join(work, 'samples'), { recursive: true });
for (const name of ['package.json', 'package-lock.json']) {
  await fs.copyFile(path.join(root, 'benchmarks/frontend/other-formats', name), path.join(work, name));
}
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--prefix', work, '--ignore-scripts', '--no-audit', '--no-fund'], { stdio: 'inherit' });
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const encode = text => new TextEncoder().encode(text);
const samples = [];
async function add(name, family, bytes, source) {
  const target = path.join(work, 'samples', name);
  await fs.writeFile(target, bytes);
  samples.push({ name, family, path: path.relative(root, target), bytes: bytes.length, sha256: sha256(bytes), source });
}
async function local(name, family, relative) {
  await add(name, family, await fs.readFile(path.join(root, relative)), { repository: relative });
}
async function archive(name, url, hash, cache) {
  const target = path.join(work, name);
  let bytes = await fs.readFile(target).catch(() => null);
  if (!bytes || sha256(bytes) !== hash) {
    bytes = cache ? await fs.readFile(path.join(root, cache)).catch(() => null) : null;
    if (!bytes || sha256(bytes) !== hash) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url}: ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
    }
    if (sha256(bytes) !== hash) throw new Error(`${name}: checksum mismatch`);
    await fs.writeFile(target, bytes);
  }
  return target;
}
const dxfCommit = '4a164a1dcdbc7dbaae714fae9c2997157c1b5c13';
const dxfArchive = await archive('dxf-parser.tar.gz', `https://codeload.github.com/gdsestimating/dxf-parser/tar.gz/${dxfCommit}`,
  '68bbfbd28ed66299cbbc9098d3f05c3d008c2bbe6236f1d4189aba590b69f549');
await local('filens-cafe.dxf', 'dxf', 'apps/demo/public/samples/filens-cafe.dxf');
for (const relative of ['samples/data/api-cw750-details.dxf', 'test/data/blocks2.dxf', 'test/data/splines.dxf']) {
  await add(path.basename(relative), 'dxf', execFileSync('tar', ['-xOzf', dxfArchive, `dxf-parser-${dxfCommit}/${relative}`], { maxBuffer: 64 * 1024 * 1024 }),
    { url: `https://raw.githubusercontent.com/gdsestimating/dxf-parser/${dxfCommit}/${relative}` });
}
let dxf = '0\nSECTION\n2\nENTITIES\n';
for (let i = 0; i < 20000; i++) dxf += `0\nLINE\n8\nL${i % 4}\n10\n${i % 200}\n20\n${Math.floor(i / 200)}\n30\n0\n11\n${i % 200 + 1}\n21\n${Math.floor(i / 200) + 1}\n31\n0\n`;
await add('generated-20000-lines.dxf', 'dxf', encode(dxf + '0\nENDSEC\n0\nEOF\n'), { generated: '20,000 deterministic LINE entities, four layers; no blocks or omitted entities' });
for (const name of ['filens-observatory.xlsx', 'rich-xlsx-data-types.xlsx', 'rich-xlsx-formulas.xlsx', 'rich-xlsx-many-columns.xlsx']) {
  await local(name, 'xlsx', `apps/demo/public/samples/${name}`);
}
const mtime = new Date(2020, 0, 1);
const zipped = entries => zipSync(Object.fromEntries(Object.entries(entries).map(([name, bytes]) => [name, [bytes, { mtime }]])), { level: 6 });
let sheet = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
for (let r = 1; r <= 10000; r++) {
  sheet += `<row r="${r}">`;
  for (let c = 0; c < 8; c++) sheet += `<c r="${String.fromCharCode(65 + c)}${r}" t="n"><v>${r * 8 + c}</v></c>`;
  sheet += '</row>';
}
sheet += '</sheetData></worksheet>';
await add('generated-80000-cells.xlsx', 'xlsx', zipped({
  '[Content_Types].xml': encode('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
  '_rels/.rels': encode('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
  'xl/workbook.xml': encode('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>'),
  'xl/_rels/workbook.xml.rels': encode('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
  'xl/worksheets/sheet1.xml': encode(sheet)
}), { generated: '10,000 rows × eight numeric cells; integer values, no formatting or formulas' });
await add('generated-numeric.csv', 'csv', encode(Array.from({ length: 20000 }, (_, r) => Array.from({ length: 8 }, (_, c) => String(r * 8 + c)).join(',')).join('\r\n')),
  { generated: '20,000 rows × eight numeric fields, CRLF, no trailing newline' });
const quote = value => `"${value.replaceAll('"', '""')}"`;
await add('generated-quoted.csv', 'csv', encode(Array.from({ length: 10000 }, (_, r) => [String(r), quote(`中文, field ${r}`), quote('say "hello"'), quote('line one\nline two'), ''].join(',')).join('\r\n')),
  { generated: '10,000 rows × five fields: UTF-8, comma, escaped quote, multiline field and empty last field' });
await local('sample-nested-archives.zip', 'zip', 'apps/demo/public/samples/sample-nested-archives.zip');
await add('generated-1000-files.zip', 'zip', zipped(Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`part-${String(i).padStart(4, '0')}.txt`, encode(`Document ${i}: ` + 'sample content\n'.repeat(80))]))),
  { generated: '1,000 deterministic text files, DEFLATE level 6' });
const binary = new Uint8Array(16 * 1024 * 1024);
for (let i = 0; i < binary.length; i++) binary[i] = (i * 31 + (i >>> 8)) & 255;
await add('generated-16mib.zip', 'zip', zipped({ 'payload.bin': binary }), { generated: 'One 16 MiB deterministic binary entry, DEFLATE level 6' });
const stepArchive = await archive('occt-importer.tar.gz', 'https://codeload.github.com/kovacsv/occt-import-js/tar.gz/refs/tags/0.0.23',
  '89d1b75def80be77cec271da46cefced9614add5448d3408c705f2f440083dde', 'tmp/occt-size/importer.tar.gz');
for (const relative of ['simple-basic-cube/cube.stp', 'rounded-cube/rounded-cube.step', 'cax-if/as1_pe_203.stp', 'cax-if/as1-oc-214.stp', 'cax-if/dm1-oc-214.stp', 'cax-if/s1-tu-203/tailturbine.stp']) {
  await add(path.basename(relative), 'step', execFileSync('tar', ['-xOzf', stepArchive, `occt-import-js-0.0.23/test/testfiles/${relative}`], { maxBuffer: 64 * 1024 * 1024 }),
    { url: `https://raw.githubusercontent.com/kovacsv/occt-import-js/c2148e54b456b571238d35cac037d304053d64b2/test/testfiles/${relative}` });
}
const sheetjsPath = path.join(work, 'xlsx.full.min.js');
let sheetjs = await fs.readFile(sheetjsPath).catch(() => null);
const sheetjsHash = 'cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41';
if (!sheetjs || sha256(sheetjs) !== sheetjsHash) {
  const tar = await archive('xlsx-0.20.3.tgz', 'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz',
    '8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8', 'tmp/performance-sota/xlsx-0.20.3.tgz');
  sheetjs = execFileSync('tar', ['-xOzf', tar, 'package/dist/xlsx.full.min.js'], { maxBuffer: 8 * 1024 * 1024 });
  if (sha256(sheetjs) !== sheetjsHash) throw new Error('SheetJS checksum mismatch');
  await fs.writeFile(sheetjsPath, sheetjs);
}
await fs.writeFile(path.join(work, 'samples.json'), JSON.stringify(samples, null, 2) + '\n');
console.log(`Prepared ${samples.length} samples and pinned peers in ${path.relative(root, work)}.`);

const x2t = await archive('x2t.zip', 'https://github.com/cryptpad/onlyoffice-x2t-wasm/releases/download/v9.3.2%2B3/x2t.zip',
  '9fee31b60964d8145396bf1fb992f38ea3bf099a1c64e949fa4976c5c4fdd290');
await fs.mkdir(path.join(work, 'x2t'), { recursive: true });
for (const name of ['x2t.js', 'x2t.wasm']) {
  await fs.writeFile(path.join(work, 'x2t', name), execFileSync('unzip', ['-p', x2t, name], { maxBuffer: 64 * 1024 * 1024 }));
}
const conversions = [
  ['legacy-project-workflow.doc', 'apps/demo/public/samples/legacy-project-workflow.doc', 'docx'],
  ['hyperlink.doc', 'examples/go-wazero-converter/fixtures/real/apache-poi/hyperlink.doc', 'docx'],
  ['table-merges.doc', 'examples/go-wazero-converter/fixtures/real/apache-poi/table-merges.doc', 'docx'],
  ['Simple.xls', 'examples/go-wazero-converter/fixtures/real/apache-poi/Simple.xls', 'xlsx'],
  ['SimpleWithFormula.xls', 'examples/go-wazero-converter/fixtures/real/apache-poi/SimpleWithFormula.xls', 'xlsx'],
  ['SOLVSAMP.XLS', 'examples/go-wazero-converter/fixtures/xls/SOLVSAMP.XLS', 'xlsx'],
  ['legacy-sample-show.ppt', 'apps/demo/public/samples/legacy-sample-show.ppt', 'pptx'],
  ['rich-text.rtf', 'apps/demo/public/samples/rich-text.rtf', 'docx'],
  ['sample.odt', 'examples/go-wazero-converter/fixtures/doc/sample.odt', 'docx'],
  ['convert-numeric.csv', 'tmp/performance-other/samples/generated-numeric.csv', 'xlsx']
];
for (const [name, source, target] of conversions) {
  await local(name, 'conversion', source);
  Object.assign(samples.at(-1), { target });
}
const csv = await fs.readFile(path.join(work, 'samples/generated-numeric.csv'), 'utf8');
await add('convert-numeric-8000.csv', 'conversion', encode(csv.split('\r\n').slice(0, 8000).join('\r\n')),
  { generated: 'First 8,000 rows × eight numeric fields of generated-numeric.csv, within the existing 10,000-row preview conversion limit' });
Object.assign(samples.at(-1), { target: 'xlsx' });
await add('generated-notes.txt', 'conversion', encode(Array.from({ length: 2000 }, (_, i) => `Note ${i}: plain text conversion, 中文和 English.`).join('\n')),
  { generated: '2,000 plain-text lines, UTF-8; no source layout, fonts or embedded media' });
Object.assign(samples.at(-1), { target: 'docx' });
await fs.writeFile(path.join(work, 'samples.json'), JSON.stringify(samples, null, 2) + '\n');
console.log(`Ready: ${samples.length} samples, x2t v9.3.2+3 checksum verified.`);
