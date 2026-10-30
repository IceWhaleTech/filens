// Real mixed-format retrieval. Fixture facts and labels stay outside the search root.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import { privacyIssues } from './agent-release-privacy.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.FILENS_AGENT_BINARY ?? path.join(root, 'dist/agent-search-parallel/filens');
const work = path.join(root, 'dist/agent-search-formats');
const corpus = path.join(work, 'corpus'), extracted = path.join(work, 'extracted');
await rm(work, { recursive: true, force: true });
await mkdir(corpus, { recursive: true }); await mkdir(extracted, { recursive: true });
const fact = '项目 BUDGET2026：预算上限12345.67元，新增开销需审批。 Budget risk requires approval.';
const fixtures = [];
async function fixture(name, data, query = 'BUDGET2026') { await writeFile(path.join(corpus, name), data); fixtures.push({ name, query }); }
const pack = files => zipSync(Object.fromEntries(Object.entries(files).map(([p, s]) => [p, strToU8(s)])));
const contentTypes = body => `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${body}</Types>`;
const rels = (target, type = 'officeDocument') => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/></Relationships>`;
await fixture('f00.txt', fact);
await fixture('f01.md', `# 项目预算\n\n${fact}`);
await fixture('f02.html', `<html><body><h1>项目预算</h1><p>${fact}</p></body></html>`);
await fixture('f03.csv', `id,fact\nBUDGET2026,"${fact}"\n`);
await fixture('f04.json', JSON.stringify([{ id: 'BUDGET2026', fact }]));
await fixture('f05.docx', pack({
  '[Content_Types].xml': contentTypes('<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'),
  '_rels/.rels': rels('word/document.xml'),
  'word/document.xml': `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>项目预算</w:t></w:r></w:p><w:p><w:r><w:t>${fact}</w:t></w:r></w:p></w:body></w:document>`,
}));
await fixture('f06.pptx', pack({
  '[Content_Types].xml': contentTypes('<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'),
  '_rels/.rels': rels('ppt/presentation.xml'),
  'ppt/presentation.xml': '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>',
  'ppt/_rels/presentation.xml.rels': rels('slides/slide1.xml', 'slide'),
  'ppt/slides/slide1.xml': `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${fact}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
}));
await fixture('f07.xlsx', pack({
  '[Content_Types].xml': contentTypes('<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'),
  '_rels/.rels': rels('xl/workbook.xml'),
  'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': rels('worksheets/sheet1.xml', 'worksheet'),
  'xl/worksheets/sheet1.xml': `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>BUDGET2026</t></is></c><c r="B1" t="inlineStr"><is><t>${fact}</t></is></c></row></sheetData></worksheet>`,
}));
await fixture('f08.odt', pack({ mimetype: 'application/vnd.oasis.opendocument.text', 'content.xml': `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:h text:outline-level="1">项目预算</text:h><text:p>${fact}</text:p></office:text></office:body></office:document-content>` }));
await fixture('f09.rtf', '{\\rtf1\\ansi BUDGET2026 budget cap 12345.67; approval required.}');
function pdf(text) {
  const stream = `BT /F1 14 Tf 60 200 Td (${text}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let bytes = '%PDF-1.4\n'; const offsets = [];
  objects.forEach((o, i) => { offsets.push(bytes.length); bytes += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = bytes.length;
  return bytes + `xref\n0 6\n0000000000 65535 f \n${offsets.map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}
await fixture('f10.pdf', pdf('BUDGET2026 budget cap 12345.67; approval required.'));
if (process.argv.includes('--ocr')) {
  for (const [name, source] of [['f11.png', 'docs/assets/agent-cli/invoice-zh.png'], ['f12.pdf', 'converter/rapidocr/testdata/scan.pdf']]) {
    await copyFile(path.join(root, source), path.join(corpus, name)); fixtures.push({ name, query: 'FILENS2026' });
  }
}
let requests = 0;
function invoke(args) {
  const r = spawnSync(binary, args, { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 64 << 20 });
  requests++;
  assert.equal(r.error, undefined); assert.equal(r.status, 0, r.stderr + '\n' + r.stdout);
  return JSON.parse(r.stdout);
}
const rows = [], reference = new Map();
for (const fixture of fixtures) {
  const value = invoke(['read', path.join(corpus, fixture.name), '--layout', '--json']);
  assert.ok(value.content.text.includes(fixture.query), fixture.name);
  reference.set(fixture.name, value.content.text);
  await writeFile(path.join(extracted, fixture.name + '.txt'), value.content.text);
}
for (const query of [...new Set(fixtures.map(f => f.query))]) {
  const value = invoke([`在 "${corpus}" 中搜索 "${query}"，以 JSON 输出`, '--layout', '--max-results', '100']);
  const expected = fixtures.filter(f => f.query === query).map(f => f.name).sort();
  assert.deepEqual(value.search.results.map(h => path.basename(h.path)).sort(), expected);
  const rg = spawnSync('rg', ['-l', '-0', '-F', '--no-ignore', '-e', query, '--', '.'], { cwd: extracted, encoding: 'utf8' });
  assert.equal(rg.status, 0);
  assert.deepEqual(rg.stdout.split('\0').filter(Boolean).map(f => f.replace(/^\.\//, '').replace(/\.txt$/, '')).sort(), expected);
  for (const hit of value.search.results) {
    const name = path.basename(hit.path), text = reference.get(name);
    for (const excerpt of hit.excerpts) assert.equal(Buffer.from(text).subarray(excerpt.startByte, excerpt.endByte).toString(), excerpt.text);
    const blocks = hit.excerpts.flatMap(e => e.layout.blocks);
    rows.push({ file: name, format: path.extname(name).slice(1), query, read: true, search: true, utf8Evidence: true,
      blockKinds: [...new Set(blocks.map(b => b.kind))], coordinateUnits: [...new Set(blocks.map(b => b.bounds?.unit).filter(Boolean))], pages: [...new Set(blocks.map(b => b.page).filter(Boolean))], rgAfterSameExtraction: true });
  }
}
assert.ok(rows.find(r => r.file === 'f05.docx').blockKinds.includes('paragraph'));
assert.ok(rows.find(r => r.file === 'f07.xlsx').blockKinds.includes('cell'));
assert.ok(rows.find(r => r.file === 'f10.pdf').coordinateUnits.includes('pt'));
if (process.argv.includes('--ocr')) {
  assert.ok(rows.find(r => r.file === 'f11.png').coordinateUnits.includes('px'));
  assert.ok(rows.find(r => r.file === 'f12.pdf').coordinateUnits.includes('pt'));
}
rows.sort((a, b) => a.file.localeCompare(b.file));
const report = { observedAt: new Date().toISOString(), platform: `${process.platform}-${process.arch}`, cases: rows.length,
  formats: [...new Set(rows.map(r => r.format))], requests, rows,
  method: 'Known synthetic identifier in 11 small documents plus optional public OCR fixtures. Read, mixed-root Chinese-intent search, UTF-8 evidence and layout checked. Offsets refer to the read operation\'s extracted text, not bytes in the original container. rg reads exactly the same extracted texts; no direct binary-search superiority claim.',
  limitations: ['Functional format/identifier coverage, not general retrieval or OCR accuracy.', 'Minimal synthetic document containers; full OOXML schema conformance is not checked. Complex layouts, formulas, attachments, corrupt files and all subformats are not covered.', 'Coordinate fields checked, not spatial IoU or OCR CER.', 'Single macOS machine; not Windows/Linux native execution.'] };
const bytes = Buffer.from(JSON.stringify(report, null, 2) + '\n'); assert.deepEqual(privacyIssues(bytes), []);
await writeFile(path.join(root, 'docs/agent-cli-search-formats.json'), bytes);
console.log(`${rows.length} mixed-format cases passed (${requests} real CLI requests): original evidence, logical/physical layout and rg after shared extraction.`);
