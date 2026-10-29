import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const work = await mkdtemp(path.join(os.tmpdir(),'filens-convert-test-'));
const binary = process.env.FILENS_AGENT_BINARY || path.join(root,'dist/agent-lite/filens');
const fixtures = path.join(root,'examples/go-wazero-converter/fixtures');
let checks = 0;
function invoke(args,input='',expected=0) {
  const result = spawnSync(binary,args,{cwd:work,input,encoding:'utf8',timeout:120000,maxBuffer:16<<20});
  assert.equal(result.error,undefined,result.error?.message);
  assert.equal(result.status,expected,`${args.join(' ')}\n${result.stderr}\n${result.stdout}`);
  const response = JSON.parse(result.stdout);
  assert.equal(response.version,'filens-agent-v1');
  assert.equal(result.stderr,'');
  checks++;
  return response;
}
try {
  const capacity = invoke(['capacity','--json','--no-ocr']).capacity;
  const pairs = JSON.parse(await readFile(path.join(root,'wasm/converter-core/manifest/conversions.json'),'utf8'));
  assert.deepEqual(capacity.conversionPairs,pairs,'CLI must discover conversion policy from the running WASM');
  for (const [fixture,target,entry,token] of [
    ['doc/sample.doc','docx','word/document.xml','Fixture'],
    ['doc/sample.wps','docx','word/document.xml','Fixture'],
    ['doc/sample.rtf','docx','word/document.xml','42'],
    ['xls/sample.csv','xlsx','xl/worksheets/sheet1.xml','56.5'],
    ['ppt/sample.ppt','pptx','ppt/presentation.xml',null],
    ['ppt/sample.odp','pptx','ppt/presentation.xml',null],
  ]) {
    const output = path.join(work,`${path.basename(fixture)}.${target}`);
    const r = invoke(['convert',path.join(fixtures,fixture),output]);
    assert.equal(r.operation,'convert'); assert.equal(r.ok,true);
    assert.equal(r.output.path,output); assert.equal(r.conversion.fidelity,'lightweight');
    const bytes = await readFile(output); assert.equal(r.output.bytes,bytes.length);
    const zip = unzipSync(bytes);
    assert.ok(zip['[Content_Types].xml']); assert.ok(zip[entry],entry);
    if (token) assert.ok(strFromU8(zip[entry]).includes(token),`${fixture}: ${token}`);
  }
  for (const [fixture,target,signature] of [
    ['raw/sample.dng','jpg',[0xff,0xd8]],
    ['image/sample.icns','png',[0x89,0x50,0x4e,0x47]],
    ['image/sample.ppm','png',[0x89,0x50,0x4e,0x47]],
  ]) {
    const output = path.join(work,`${path.basename(fixture)}.${target}`);
    const r = invoke(['convert',path.join(fixtures,fixture),'--output',output,'--json']);
    assert.equal(r.ok,true);
    assert.deepEqual([...(await readFile(output)).subarray(0,signature.length)],signature);
  }
  const text = path.join(work,'季度 报告.txt'); await writeFile(text,'中文转换证据 Budget 42\n');
  const inferred = invoke(['convert',text,'--to','docx']);
  const destination = path.join(work,'季度 报告.docx');
  assert.equal(inferred.output.path,destination);
  assert.match(strFromU8(unzipSync(await readFile(destination))['word/document.xml']),/中文转换证据/);
  const existing = await readFile(destination);
  assert.equal(invoke(['convert',text,destination],'',2).error.code,'invalid_request');
  assert.deepEqual(await readFile(destination),existing);
  await writeFile(text,'Replacement evidence 43\n');
  const forced = invoke(['convert',text,destination,'--force']); assert.equal(forced.ok,true);
  assert.match(strFromU8(unzipSync(await readFile(destination))['word/document.xml']),/Replacement evidence 43/);
  assert.equal(invoke(['convert',text,text,'--force','--to','docx'],'',2).error.code,'invalid_request');
  const pipedOutput = path.join(work,'from-json.docx');
  assert.equal(invoke([],JSON.stringify({operation:'convert',input:text,output:pipedOutput,options:{locale:'zh-CN'}})).ok,true);
  const disguised = path.join(work,'source.blob'); await copyFile(text,disguised);
  assert.equal(invoke(['convert',disguised,'--from','txt','--to','docx']).ok,true);
  const untouched = path.join(work,'untouched.pdf'); await writeFile(untouched,'keep this file');
  assert.equal(invoke(['convert',text,untouched,'--force'],'',2).error.code,'unsupported_format');
  assert.equal(await readFile(untouched,'utf8'),'keep this file');
  const corrupt = path.join(work,'corrupt.docm'); await writeFile(corrupt,'not a ZIP package');
  assert.equal(invoke(['convert',corrupt,destination,'--force'],'',3).error.code,'parse_error');
  assert.match(strFromU8(unzipSync(await readFile(destination))['word/document.xml']),/Replacement evidence 43/);
  const canceled = path.join(work,'canceled.docx');
  assert.equal(invoke(['convert',text,canceled,'--timeout','1ns'],'',1).error.code,'canceled');
  await assert.rejects(stat(canceled),{code:'ENOENT'});
  console.log(`Convert CLI: ${checks} checks passed, including DOC/WPS/RTF/ODP/PPT/CSV/RAW/ICNS/PPM, ZIP contents, JSON requests, overwrite protection and cancellation.`);
} finally { await rm(work,{recursive:true,force:true}); }
