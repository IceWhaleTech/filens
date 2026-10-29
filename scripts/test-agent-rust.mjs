// Exercise the compact distribution and process boundaries, independently of
// the developer bundle's uncompressed WASM files and source checkout paths.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const work = await mkdtemp(path.join(os.tmpdir(),'filens-rust-test-'));
const binary = path.join(work,'filens');
const env = { ...process.env, FILENS_PROFILE:'lite' };
delete env.FILENS_TEXT_WASM;
delete env.FILENS_PDFIUM_WASM;
delete env.FILENS_OCR_LIBRARY;
delete env.FILENS_OCR_MODEL_DIR;
let checks = 0;
function run(args, input = '', expected = 0, overrides = {}) {
  const r = spawnSync(binary,args,{cwd:work,env:{...env,...overrides},input,encoding:'utf8',timeout:120000,maxBuffer:16<<20});
  assert.equal(r.error,undefined,r.error?.message);
  assert.equal(r.status,expected,`${JSON.stringify(args)}: ${r.stderr}\n${r.stdout}`);
  const value = JSON.parse(r.stdout);
  assert.equal(value.version,'filens-agent-v1');
  assert.equal(r.stderr,'');
  checks++;
  return value;
}
try {
  await copyFile(path.join(root,'dist/agent-lite/filens'),binary);
  await chmod(binary,0o755);
  for (const name of ['converter-text.wasm.gz','converter-image.wasm.gz','pdfium.wasm.gz']) await copyFile(path.join(root,'dist',name),path.join(work,name));
  const text = path.join(work,'report $(whoami) 中文.txt');
  await writeFile(text,'中文证据\nBudget 42\n');
  const capacity = run(['capacity','--json']);
  assert.ok(capacity.capacity.formats.some(f=>f.format==='pdf' && f.textExtraction));
  assert.equal(capacity.capacity.ocr.enabled,false);
  assert.equal(run(['read',text,'--json']).content.text.trim(),'中文证据\nBudget 42');
  assert.equal(run(['convert',text,'converted.docx']).ok,true);
  assert.equal(run(['convert',path.join(root,'examples/go-wazero-converter/fixtures/raw/sample.dng'),'converted.jpg']).ok,true);
  assert.equal(run([],JSON.stringify({input:text,operation:'understand'})).operation,'understand');
  assert.equal(run(['--unknown','--json'],'',2).error.code,'invalid_request');
  for (const input of ['{"input":', '{"format":"toml","input":"x.txt"}', '{} {}', '{"unknown":true}']) {
    assert.equal(run(['-'],input,2).error.code,'invalid_request');
  }
  assert.equal(run(['read',text,'missing.pdf','--json'],'',2).error.code,'invalid_request');
  assert.equal(run(['read','missing.txt','--json'],'',1).error.code,'io_error');
  assert.equal(run(['capacity','--json','--wasm','missing.wasm'],'',1).error.code,'engine_unavailable');
  await writeFile(path.join(work,'bad.wasm.gz'),'invalid gzip');
  assert.equal(run(['capacity','--json','--wasm','bad.wasm.gz'],'',1).error.code,'engine_unavailable');
  assert.equal(run([text,'--json','--timeout','1ns'],'',1).error.code,'canceled');
  const pdf = path.join(root,'apps/demo/public/samples/filens-cosmic-atlas.pdf');
  assert.match(run([pdf,'--json','--no-ocr']).content.text,/COSMIC CLIFFS/);
  const scan = path.join(root,'converter/rapidocr/testdata/scan.pdf');
  assert.equal(run([scan,'--json'],'',3).error.code,'ocr_failed');
  await writeFile(path.join(work,'corrupt.pdf'),'not a PDF');
  assert.equal(run(['corrupt.pdf','--json'],'',3).error.code,'parse_error');
  const scratch = path.join(work,'scratch'); await mkdir(scratch);
  const canceled = await new Promise((resolve,reject) => {
    const child = spawn(binary,[scan,'--json'],{cwd:work,env:{...env,TMPDIR:scratch,FILENS_PROFILE:'full',FILENS_OCR_LIBRARY:path.join(root,'dist/native',process.platform==='darwin'?'libzima_ncnn_runtime_v7.dylib':'libzima_ncnn_runtime_v7.so'),FILENS_OCR_MODEL_DIR:path.join(root,'dist/models/rapidocr-ncnn')},stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    child.stdout.on('data',c=>{stdout+=c;}); child.stderr.on('data',c=>{stderr+=c;});
    const timer = setTimeout(()=>child.kill('SIGTERM'),200);
    const guard = setTimeout(()=>{child.kill('SIGKILL');reject(new Error('SIGTERM did not cancel request'));},10000);
    child.once('error',reject);
    child.once('exit',(code,signal)=>{clearTimeout(timer);clearTimeout(guard);resolve({code,signal,stdout,stderr});});
  });
  assert.equal(canceled.code,1,JSON.stringify(canceled));
  assert.equal(JSON.parse(canceled.stdout).error.code,'canceled');
  assert.equal(canceled.stderr,'');
  assert.deepEqual(await readdir(scratch),[],'request temporary files leaked after cancellation');
  checks++;
  console.log(`Rust CLI: ${checks} compact-bundle, JSON error, timeout, SIGTERM cleanup and PDF checks passed.`);
} finally { await rm(work,{recursive:true,force:true}); }
