import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parseArgs, renderMarkdown, summarizeCandidate } from './audit-x2t-candidate.mjs';

async function writeFile(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, data);
}

function fakeWasm(...markers) {
  return Buffer.concat([
    Buffer.from([0x00, 0x61, 0x73, 0x6d]),
    Buffer.from('\n'),
    Buffer.from(markers.join('\n'))
  ]);
}

async function createFixture(root) {
  const manifestPath = path.join(root, 'manifest.json');
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      [
        { sourceFormat: 'doc', targetFormat: 'docx' },
        { sourceFormat: 'xls', targetFormat: 'xlsx' },
        { sourceFormat: 'ppt', targetFormat: 'pptx' }
      ],
      null,
      2
    )}\n`
  );

  await writeFile(path.join(root, 'pure-wasi', 'LICENSE'), 'fixture license\n');
  await writeFile(path.join(root, 'pure-wasi', 'x2t.wasm'), fakeWasm('wasi_snapshot_preview1', '_start'));

  await writeFile(path.join(root, 'emscripten', 'LICENSE'), 'fixture license\n');
  await writeFile(path.join(root, 'emscripten', 'x2t.wasm'), fakeWasm('emscripten', '__indirect_function_table'));
  await writeFile(
    path.join(root, 'emscripten', 'x2t.js'),
    'const Module = {}; Module.FS = FS; FS.createDataFile = FS_createDataFile; ccall("main1"); const wasmBinary = null;\n'
  );

  await writeFile(path.join(root, 'no-wasm', 'LICENSE'), 'fixture license\n');

  return manifestPath;
}

async function testPureWasi(root, manifestPath) {
  const report = await summarizeCandidate('pure-wasi', { rootDir: root, manifestPath });
  assert.equal(report.candidatePath, 'pure-wasi');
  assert.equal(report.wasmFiles.length, 1);
  assert.equal(report.gates.wazeroEligible, true);
  assert.equal(report.gates.browserAdapterCandidate, false);
  assert.equal(report.gates.blocked, false);
  assert.deepEqual(report.gates.blockedReasons, []);
  assert.equal(report.allowedDefaultConversions.length, 3);

  const markdown = renderMarkdown(report);
  assert.match(markdown, /wazero eligible: yes/);
  assert.match(markdown, /doc -> docx/);
}

async function testEmscripten(root, manifestPath) {
  const report = await summarizeCandidate('emscripten', { rootDir: root, manifestPath });
  assert.equal(report.wasmFiles.length, 1);
  assert.equal(report.jsGlueHints.length, 1);
  assert.equal(report.gates.wazeroEligible, false);
  assert.equal(report.gates.browserAdapterCandidate, true);
  assert.equal(report.gates.blocked, true);
  assert(
    report.gates.blockedReasons.some((reason) => reason.includes('JavaScript/Emscripten glue')),
    'expected Emscripten glue blocked reason'
  );
}

async function testNoWasm(root, manifestPath) {
  const report = await summarizeCandidate('no-wasm', { rootDir: root, manifestPath });
  assert.equal(report.wasmFiles.length, 0);
  assert.equal(report.gates.wazeroEligible, false);
  assert.equal(report.gates.browserAdapterCandidate, false);
  assert.equal(report.gates.blocked, true);
  assert(
    report.gates.blockedReasons.some((reason) => reason.includes('no valid .wasm files found')),
    'expected missing wasm blocked reason'
  );
}

function testParseArgs() {
  assert.deepEqual(parseArgs(['--candidate', 'bundle']), {
    candidate: 'bundle',
    outDir: 'tmp/x2t-candidate-audit',
    strict: false
  });
  assert.deepEqual(parseArgs(['--candidate', 'bundle', '--out', 'tmp/report', '--strict']), {
    candidate: 'bundle',
    outDir: 'tmp/report',
    strict: true
  });
  assert.throws(() => parseArgs([]), /Missing --candidate/);
  assert.throws(() => parseArgs(['--candidate', 'bundle', '--wat']), /Unknown argument/);
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'x2t-audit-test-'));
  const manifestPath = await createFixture(root);

  try {
    testParseArgs();
    await testPureWasi(root, manifestPath);
    await testEmscripten(root, manifestPath);
    await testNoWasm(root, manifestPath);
    console.log('audit-x2t-candidate self-test ok');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
