// Behavioral tests of the real CLI/WASM pipeline, on public synthetic content.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executableName } from './agent-platforms.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const binary=path.join(root,'dist/agent-lite',executableName(`${process.platform}-${process.arch}`));
const work=await mkdtemp(path.join(os.tmpdir(),'filens-prune-'));
let checks=0;
function invoke(args,{input='',expected=0,exe=binary}={}){
  const r=spawnSync(exe,args,{cwd:work,input,encoding:'utf8',timeout:120000,maxBuffer:16<<20});
  assert.equal(r.error,undefined,r.error?.message);assert.equal(r.status,expected,r.stderr+'\n'+r.stdout);return r.stdout;
}
const json=(args,o)=>JSON.parse(invoke(args,o));
function evidence(read,summarized){
  const a=Buffer.from(read.content.text),b=Buffer.from(summarized.content.text),s=summarized.content.summary;
  assert.equal(s.extractive,true);assert.equal(s.sourceBytes,a.length);assert.equal(s.sourceComplete,read.content.complete&&!read.content.truncated);
  assert.ok([...summarized.content.text].length<=s.budgetCharacters);
  let end=0;for(const e of s.excerpts){assert.ok(e.sourceStartByte>=end);assert.ok(a.subarray(e.sourceStartByte,e.sourceEndByte).equals(b.subarray(e.startByte,e.endByte)));end=e.sourceEndByte;}
}
try{
  const source=await readFile(path.join(root,'docs/assets/agent-cli/prune-meeting.txt'),'utf8');
  const file=path.join(work,'项目 会议.txt');await writeFile(file,source);
  const full=json([file,'--json']);
  const capacity=json(['capacity','--json']).capacity;assert.ok(capacity.operations.some(o=>o.name==='summarize'));assert.equal(capacity.summary.requiresModel,false);checks++;
  const basic=json([`总结 "${file}"，以 JSON 输出`]);evidence(full,basic);assert.equal(basic.operation,'summarize');assert.equal(basic.content.truncated,false);assert.ok(basic.content.summary.omitted);assert.match(basic.content.text,/12345\.67/);checks++;
  const focus=json([`提取 "${file}" 的关键内容，关注预算和风险，保留40%，最多240字，以 JSON 输出`]);evidence(full,focus);assert.match(focus.content.text,/不得超过12345\.67元/);assert.match(focus.content.text,/风险/);assert.ok(!focus.content.text.includes('咖啡'));checks++;
  const english=json([`summarize "${file}" focusing on "预算 风险" as json`]);evidence(full,english);assert.match(english.content.text,/12345\.67/);checks++;
  const structured=json([],{input:JSON.stringify({operation:'prune',input:file,query:'预算 风险',summaryChars:240,summaryRatio:0.4})});evidence(full,structured);checks++;
  for(const format of ['text','json','markdown','html','yaml','xml','csv','tsv'])assert.ok(invoke(['summarize',file,'--query','预算','--summary-ratio','1','--format',format]).includes('12345.67'));checks++;
  const layout=json(['prune',file,'--layout','--json']);for(const b of layout.content.layout.blocks){assert.ok(b.startByte>=0&&b.endByte<=Buffer.byteLength(layout.content.text));assert.ok(b.sourceStartByte>=0&&b.sourceEndByte<=Buffer.byteLength(full.content.text));}checks++;
  const noMatch=json(['summarize',file,'--query','zzzzunmatched','--json']);assert.equal(noMatch.content.text,'');assert.equal(noMatch.content.summary.queryMatched,false);checks++;
  const tiny=json(['summarize',file,'--query','预算','--summary-chars','3','--json']);evidence(full,tiny);assert.ok(tiny.content.summary.excerpts[0].clipped);assert.ok(tiny.content.warnings.length);checks++;
  const partial=json(['summarize',file,'--max-bytes','150','--json'],{expected:3});assert.equal(partial.error.code,'content_truncated');assert.equal(partial.content.summary.sourceComplete,false);checks++;
  const empty=path.join(work,'empty.txt');await writeFile(empty,'');assert.equal(json(['prune',empty,'--json']).content.summary.characters,0);checks++;
  for(const args of [['--summary-ratio','2'],['--summary-chars','0'],['--summary-ratio','NaN']])assert.equal(json(['summarize',file,...args,'--json'],{expected:2}).error.code,'invalid_request');checks++;
  for(const intent of [`翻译 "${file}" 成英文`,`总结 "${file}" 并解释为什么预算这么高`])assert.equal(json([intent,'--json'],{expected:2}).error.code,'invalid_request');checks++;
  assert.equal(json([`read "${file}" as json`]).operation,'read');checks++;
  const englishFile=path.join(work,'release.txt');await writeFile(englishFile,'Welcome to our docs.\nDecision: deploy on Friday.\nRisk: do not deploy without a database backup.\nThe budget is 42000 dollars.\nCoffee is available in the lobby.\n');
  const englishFocus=json([`summarize "${englishFile}" focus on risk keep 70% at most 100 characters as json`]);assert.match(englishFocus.content.text,/do not deploy without a database backup/);assert.equal(englishFocus.content.summary.query,'risk');checks++;
  const exe=path.join(root,'dist',executableName(`${process.platform}-${process.arch}`));
  const scan=path.join(root,'converter/rapidocr/testdata/scan.pdf');
  const scannedRead=json([scan,'--json'],{exe});
  const scannedSummary=json(['summarize',scan,'--query','FILENS2026 BRIGHT2027','--summary-ratio','1','--layout','--json'],{exe});
  evidence(scannedRead,scannedSummary);assert.match(scannedSummary.content.text,/FILENS2026[\s\S]*BRIGHT2027/);assert.ok(scannedSummary.content.layout.blocks.some(b=>b.page===2&&b.bounds?.unit==='pt'));checks++;
  const failedOCR=json(['summarize',scan,'--no-ocr','--json'],{exe,expected:3});assert.equal(failedOCR.error.code,'ocr_failed');assert.equal(failedOCR.content.summary.sourceComplete,false);checks++;
  const longFile=path.join(work,'long.txt');await writeFile(longFile,Array.from({length:6000},(_,i)=>`Routine entry ${i}.\n`).join('')+'Critical deployment risk: database corruption.\n');
  const late=json(['prune',longFile,'--query','corruption','--json']);assert.match(late.content.text,/database corruption/);assert.equal(late.content.summary.sampled,true);assert.ok(late.content.summary.rankedSegments<=4096);checks++;
  console.log(`${checks} summary CLI/WASM groups passed: Chinese/English intents, density/BM25 pruning, budgets, original evidence, 8 outputs, layout and incomplete-source handling.`);
}finally{await rm(work,{recursive:true,force:true});}
