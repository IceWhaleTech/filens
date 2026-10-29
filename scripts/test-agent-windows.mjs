// Portable Windows smoke test. Only Node 20+ is needed for this script;
// filens.exe itself requires neither Node nor Python nor a source checkout.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const index=process.argv.indexOf('--bundle');
const bundle=index>=0?path.resolve(process.argv[index+1]):here;
assert.equal(process.platform,'win32','Run this test on Windows x64');
assert.equal(process.arch,'x64','This candidate targets Windows x64');
const binary=path.join(bundle,'filens.exe');
const fixtures=path.join(bundle,'test-fixtures');
const work=await mkdtemp(path.join(os.tmpdir(),'filens-win-test-'));
const observations=[];
const ocrSamples=[];
const env={...process.env};
for(const name of ['FILENS_PROFILE','FILENS_TEXT_WASM','FILENS_IMAGE_WASM','FILENS_PDFIUM_WASM','FILENS_OCR_LIBRARY','FILENS_OCR_MODEL_DIR'])delete env[name];
let capacity;
const invoke=(args,{expected=0,input='',exe=binary,environment=env}={})=>{
  const result=spawnSync(exe,args,{cwd:work,env:environment,input,encoding:'utf8',timeout:120000,maxBuffer:20<<20});
  assert.equal(result.error,undefined,result.error?.message);
  assert.equal(result.status,expected,`${result.stderr}\n${result.stdout}`);
  return result.stdout;
};
const json=(args,options)=>JSON.parse(invoke(args,options));
async function check(name,fn){
  const start=performance.now();
  try{await fn();observations.push({name,ok:true,elapsedMs:Math.round(performance.now()-start)});console.log(`PASS ${name}`);}
  catch(e){
    let error=e.message;for(const prefix of [bundle,work,os.homedir()])error=error.split(prefix).join('<local>');
    observations.push({name,ok:false,elapsedMs:Math.round(performance.now()-start),error:error.slice(0,3000)});console.error(`FAIL ${name}: ${error.slice(0,300)}`);
  }
}
try{
  await check('capabilities and OCR health',()=>{
    const response=json(['你能做什么？以 JSON 输出']);assert.equal(response.ok,true);capacity=response.capacity;
    assert.ok(capacity.outputFormats.includes('yaml'));
    assert.equal(capacity.ocr.provider,'rapidocr-ncnn');assert.equal(capacity.ocr.maxSideLen,960);assert.equal(capacity.ocr.padding,50);assert.equal(capacity.ocr.openmpThreads,2);
    assert.equal(capacity.ocr.available,capacity.profile==='full');
  });
  const text=path.join(work,'季度 报告.txt');await writeFile(text,'中文证据\nBudget 42\n');
  await check('Chinese intent, spaces and UTF-8',()=>assert.match(json([`读取 "${text}"，以 JSON 输出`]).content.text,/中文证据/));
  await check('JSON stdin',()=>assert.equal(json([],{input:JSON.stringify({operation:'understand',input:text})}).operation,'understand'));
  await check('eight output formats',()=>{
    for(const format of ['text','json','markdown','html','yaml','xml','csv','tsv'])assert.ok(invoke([text,'--format',format]).includes('Budget'));
  });
  await check('text to DOCX, read back and overwrite protection',async()=>{
    const output=path.join(work,'converted.docx');assert.equal(json(['convert',text,output]).ok,true);
    assert.match(json([output,'--json']).content.text,/中文证据/);
    const before=await readFile(output);const rejected=json(['convert',text,output],{expected:2});assert.equal(rejected.ok,false);assert.deepEqual(await readFile(output),before);
  });
  await check('RAW to JPEG conversion',()=>assert.equal(json(['convert',path.join(fixtures,'sample.dng'),path.join(work,'photo.jpg')]).ok,true));
  await check('logical Word layout',()=>{
    const layout=json(['layout',path.join(fixtures,'embedded.docx'),'--json',...(capacity?.profile==='full'?[]:['--no-ocr'])],{expected:capacity?.profile==='full'?0:3}).content.layout;
    assert.ok(layout.blocks.some(b=>b.kind==='heading'));assert.ok(layout.blocks.some(b=>b.kind==='paragraph'));
  });
  if(capacity?.profile==='full'){
    await check('transparent, EXIF and inverted image OCR',()=>{
      for(const name of ['scan.png','scan-transparent.png','scan-exif.jpg','scan-rotated.png'])assert.match(json([path.join(fixtures,name),'--json']).content.text,/FILENS2026/);
    });
    await check('Chinese OCR, exact order and amount',()=>{
      const text=json([path.join(fixtures,'invoice-zh.png'),'--json']).content.text;ocrSamples.push({fixture:'invoice-zh.png',text});assert.match(text,/采购/);assert.match(text,/FILENS2026/);assert.match(text,/12345\.67/);
    });
    await check('two-page scanned PDF',()=>{
      const r=json(['layout',path.join(fixtures,'scan.pdf'),'--json']);assert.match(r.content.text,/FILENS2026/);assert.match(r.content.text,/BRIGHT2027/);
      assert.equal(r.content.layout.pages.length,2);assert.ok(r.content.layout.blocks.every(b=>b.bounds?.unit==='pt'));
    });
    await check('document embedded-image callback',()=>assert.match(json([path.join(fixtures,'embedded.docx'),'--json']).content.text,/BEFORE[\s\S]*FILENS2026[\s\S]*AFTER/));
    await check('OCR image coordinates',()=>{
      const r=json(['layout',path.join(fixtures,'invoice-zh.png'),'--json']);const l=r.content.layout;assert.equal(l.pages[0].width,1440);
      assert.ok(l.blocks.length>=7);for(const b of l.blocks){assert.equal(b.bounds.unit,'px');assert.equal(b.polygon.length,4);assert.ok(b.bounds.x>=0&&b.bounds.x+b.bounds.width<=1440);}
    });
    await check('no Node or Python on child PATH',()=>{
      const r=json([path.join(fixtures,'scan.png'),'--json'],{environment:{...env,PATH:path.join(process.env.SystemRoot??'C:\\Windows','System32')}});assert.match(r.content.text,/FILENS2026/);
    });
    await check('Chinese bundle/model directory',async()=>{
      const unicode=path.join(work,'中文目录 测试包');await cp(bundle,unicode,{recursive:true});
      assert.match(json([path.join(fixtures,'scan.png'),'--json'],{exe:path.join(unicode,'filens.exe')}).content.text,/FILENS2026/);
    });
    await check('scanned-PDF deadline and temporary-file cleanup',async()=>{
      const scratch=path.join(work,'scratch');await mkdir(scratch);
      const r=json([path.join(fixtures,'scan.pdf'),'--json','--timeout','200ms'],{expected:1,environment:{...env,TMP:scratch,TEMP:scratch,TMPDIR:scratch}});
      assert.equal(r.error.code,'canceled');assert.deepEqual(await readdir(scratch),[],'Temporary files leaked after cancellation');
    });
  }else await check('Lite reports missing OCR',()=>assert.equal(json([path.join(fixtures,'scan.pdf'),'--json'],{expected:3}).error.code,'ocr_failed'));
  await check('request timeout returns structured error',()=>assert.equal(json([text,'--json','--timeout','1ns'],{expected:1}).error.code,'canceled'));
}finally{
  const report={date:new Date().toISOString(),platform:`${process.platform}-${process.arch}`,windowsRelease:os.release(),cpu:os.cpus()[0]?.model,node:process.version,profile:capacity?.profile,ocr:capacity?.ocr,ocrSamples,passed:observations.filter(c=>c.ok).length,failed:observations.filter(c=>!c.ok).length,method:'Real native CLI on public synthetic fixtures; this is a smoke test, not a general OCR accuracy benchmark.',checks:observations};
  const output=path.resolve(process.argv.includes('--report')?process.argv[process.argv.indexOf('--report')+1]:'filens-windows-test.json');
  let serialized=JSON.stringify(report,null,2)+'\n';
  for(const prefix of [bundle,work,os.homedir()])serialized=serialized.split(JSON.stringify(prefix).slice(1,-1)).join('<local>');
  await writeFile(output,serialized);await rm(work,{recursive:true,force:true});
  console.log(`${report.passed} passed, ${report.failed} failed. Report: ${path.basename(output)}`);process.exitCode=report.failed?1:0;
}
