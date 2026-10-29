import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ocrLibraryName } from './agent-platforms.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let binary = path.join(root, 'dist', process.platform === 'win32' ? 'filens.exe' : 'filens');
const work = await mkdtemp(path.join(os.tmpdir(), 'filens-agent-test-'));
let checks = 0;
try {
  const fixtures = path.join(root, 'converter/rapidocr/testdata');
  for (const name of ['scan.png', 'scan.pdf']) await copyFile(path.join(fixtures, name), path.join(work, name));
  await writeFile(path.join(work, 'embedded.docx'), zipSync({
    'word/document.xml': strToU8('<w:document xmlns:w="word" xmlns:a="drawing" xmlns:r="rels"><w:body><w:p><w:r><w:t>BEFORE 中文</w:t><a:blip r:embed="r1"/><w:t>AFTER</w:t></w:r></w:p></w:body></w:document>'),
    'word/_rels/document.xml.rels': strToU8('<Relationships><Relationship Id="r1" Target="media/scan.png"/></Relationships>'),
    'word/media/scan.png': await readFile(path.join(fixtures, 'scan-transparent.png'))
  }));

  const capabilities = json(['你能做什么？以 JSON 输出']);
  assert.equal(capabilities.capacity.ocr.available, true);
  assert.equal(capabilities.capacity.ocr.provider, 'rapidocr-ncnn');
  assert.equal(capabilities.capacity.ocr.openmpThreads, 2);
  assert.ok(capabilities.capacity.formats.some(f => f.format === 'pdf'));
  assert.ok(capabilities.capacity.formats.some(f => f.format === 'txt'));
  assert.equal(capabilities.capacity.ocr.maxSideLen, 960);
  checks++;

  for (const name of ['scan-rotated.png', 'scan-transparent.png', 'scan-exif.jpg']) {
    const prepared = json([path.join(fixtures, name), '--json']);
    assert.match(prepared.content.text, /FILENS2026/, name);
  }
  checks++;

  const textPath = path.join(work, '季度 报告.txt');
  const text = '中文证据\nBudget 42\n';
  await writeFile(textPath, text);
  const read = json([`理解 "${textPath}"，以 JSON 输出`]);
  assert.equal(read.operation, 'understand');
  assert.equal(read.content.text.trim(), text.trim());
  verifyEvidence(read);
  const piped = json([], JSON.stringify({ input: textPath, operation: 'understand' }));
  assert.equal(piped.content.text, read.content.text);
  const plain = invoke([`读取 "${textPath}"，以纯文本输出`]);
  assert.equal(plain.stdout, read.content.text);
  assert.equal(plain.stderr, '');
  checks++;

  const image = json([`read "${path.join(work, 'scan.png')}" as json`]);
  assert.match(image.content.text, /FILENS2026/);
  assert.match(image.content.text, /12345[.,]?67/);
  verifyEvidence(image);
  const pdf = json([`读取 "${path.join(work, 'scan.pdf')}"，以 JSON 输出`]);
  assert.match(pdf.content.text, /FILENS2026/);
  assert.match(pdf.content.text, /BRIGHT2027/);
  assert.ok(pdf.content.text.indexOf('FILENS2026') < pdf.content.text.indexOf('BRIGHT2027'));
  verifyEvidence(pdf);
  checks++;

  const embedded = json(['understand', path.join(work, 'embedded.docx'), '--json']);
  assert.match(embedded.content.text, /BEFORE 中文[\s\S]*FILENS2026[\s\S]*AFTER/);
  const missingOCR = json(['read', path.join(work, 'embedded.docx'), '--json', '--no-ocr'], undefined, 3);
  assert.equal(missingOCR.ok, false);
  assert.equal(missingOCR.content.complete, false);
  assert.equal(missingOCR.error.code, 'ocr_failed');
  assert.match(missingOCR.content.text, /BEFORE 中文[\s\S]*AFTER/);
  checks++;

  const truncated = json(['read', textPath, '--json', '--max-bytes', '4'], undefined, 3);
  assert.equal(truncated.content.text, '中');
  assert.equal(truncated.content.truncated, true);
  verifyEvidence(truncated);
  const emptyPath = path.join(work, 'empty.txt');
  await writeFile(emptyPath, '');
  const empty = json([emptyPath, '--json']);
  assert.equal(empty.ok, true);
  assert.equal(empty.content.text, '');
  assert.equal(empty.content.complete, true);
  checks++;

  const invalid = json(['--json', '--unknown'], undefined, 2);
  assert.equal(invalid.error.code, 'invalid_request');
  const unknown = path.join(work, 'unknown.zip');
  await writeFile(unknown, 'not a supported extraction format');
  assert.equal(json([unknown, '--json'], undefined, 2).error.code, 'unsupported_format');
  const corrupt = path.join(work, 'corrupt.docx');
  await writeFile(corrupt, 'not a ZIP');
  assert.equal(json([corrupt, '--json'], undefined, 3).error.code, 'parse_error');
  const passwordPDF = path.join(root, 'converter/testdata/password_test123.pdf');
  // This fixture is present in the developer corpus; the portable tests above
  // need no downloaded corpus.
  try {
    await readFile(passwordPDF);
    assert.equal(json([passwordPDF, '--json'], undefined, 3).error.code, 'password_required');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  checks++;
  binary = path.join(root, 'dist', 'agent-lite', process.platform === 'win32' ? 'filens.exe' : 'filens');
  const liteCapacity = json(['capacity', '--json']);
  assert.equal(liteCapacity.capacity.profile, 'lite');
  assert.equal(liteCapacity.capacity.ocr.enabled, false);
  assert.equal(liteCapacity.capacity.ocr.available, false);
  assert.equal(json([textPath, '--json']).content.text, read.content.text);
  const liteScan = json([path.join(work, 'scan.pdf'), '--json'], undefined, 3);
  assert.equal(liteScan.error.code, 'ocr_failed');
  // An existing OCR installation can be injected without installing anything
  // into the lite bundle. It is discovered when explicitly selected.
  const attached = spawnSync(binary, [path.join(work, 'scan.png'), '--json'], { cwd: root, encoding: 'utf8', env: { ...process.env, FILENS_OCR_LIBRARY: path.join(root, 'dist/native', ocrLibraryName(`${process.platform}-${process.arch}`)), FILENS_OCR_MODEL_DIR: path.join(root, 'dist/models/rapidocr-ncnn') }, timeout: 120000 });
  assert.equal(attached.status, 0, attached.stderr);
  assert.match(JSON.parse(attached.stdout).content.text, /FILENS2026/);
  checks++;
  console.log(`Agent CLI: ${checks} end-to-end groups passed, including preprocessing, real RapidOCR NCNN on PNG, two-page scanned PDF and embedded DOCX images.`);
} finally {
  await rm(work, { recursive: true, force: true });
}

function invoke(args, input, expected = 0) {
  const result = spawnSync(binary, args, { cwd: root, input: input ?? '', encoding: 'utf8', timeout: 120000, maxBuffer: 16 << 20 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, expected, `${JSON.stringify(args)}: ${result.stderr}\n${result.stdout}`);
  return result;
}

function json(args, input, expected = 0) {
  return JSON.parse(invoke(args, input, expected).stdout);
}

function verifyEvidence(result) {
  const bytes = Buffer.from(result.content.text);
  let cursor = 0;
  for (const block of result.content.document.blocks) {
    assert.equal(block.startByte, cursor);
    assert.ok(Buffer.from(bytes.subarray(block.startByte, block.endByte).toString()).equals(bytes.subarray(block.startByte, block.endByte)));
    cursor = block.endByte;
  }
  assert.equal(cursor, bytes.length);
  assert.equal(result.content.document.bytes, bytes.length);
}
