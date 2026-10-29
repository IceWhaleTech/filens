// Render a deterministic terminal replay from actual local CLI responses.
// Browser/FFmpeg are authoring tools; installed filens needs neither.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'docs/assets/agent-cli');
const work=path.join(root,'dist/agent-demo');await mkdir(work,{recursive:true});await mkdir(output,{recursive:true});
await copyFile(path.join(root,'dist/agent-layout/launch-brief.docx'),path.join(work,'launch-brief.docx'));
const binary=path.join(root,'dist/filens');
const runs=[];
function run(command,args,cwd=root){const result=spawnSync(command,args,{cwd,encoding:'utf8',timeout:120000,maxBuffer:32<<20});assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);return result.stdout;}
function cli(intent){const start=performance.now();const stdout=run(binary,[intent],work);runs.push({intent,stdout,ms:Math.round(performance.now()-start)});return stdout;}
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:630,height:720},deviceScaleFactor:1});
const invoice=path.join(work,'invoice.png');
await page.setContent(`<meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;background:#fff;color:#192b37;font-family:"PingFang SC",Arial,sans-serif}article{padding:40px 43px}header{border-bottom:2px solid #142b3d;padding-bottom:23px;margin-bottom:24px}h1{margin:0;font-size:34px;font-weight:600;letter-spacing:1px}small{display:block;color:#608783;font-size:13px;letter-spacing:2px;margin-top:10px}p{font-size:25px;margin:22px 0;line-height:1.5}.amount{border-top:1px solid #dce4df;border-bottom:1px solid #dce4df;padding:25px 0;margin:27px 0;font-size:29px;font-weight:600}.date{font-size:22px}.foot{font-size:16px;color:#648178;margin-top:31px}</style><article><header><h1>星河科技采购单</h1><small>PURCHASE ORDER / 2026</small></header><p>订单编号 FILENS2026</p><p>客户：上海示例公司</p><p>项目：本地文档读取与识别</p><p class="amount">应付金额：12345.67 元</p><p class="date">交付日期：2026年10月29日</p><p class="foot">无需 Python · 本地离线读取</p></article>`);
await page.screenshot({path:invoice});
const capacityIntent='你能做什么？以 JSON 输出';
const markdownIntent='read "launch-brief.docx" as markdown';
const layoutIntent='获取 "invoice.png" 的布局，以 JSON 输出';
const yamlIntent='获取 "invoice.png" 的布局，以 YAML 输出';
const capacity=JSON.parse(cli(capacityIntent));const markdown=cli(markdownIntent);const document=JSON.parse(cli(layoutIntent));const yaml=cli(yamlIntent);
assert.match(markdown,/# Aurora launch brief/);assert.match(document.content.text,/FILENS2026/);assert.match(document.content.text,/12345.67/);
const layout=document.content.layout;const b=layout.blocks[0];
const excerpt=`{\n  "version": "${layout.version}",\n  "pages": [${JSON.stringify(layout.pages[0])}],\n  "blocks": [{\n    "id": "${b.id}", "kind": "${b.kind}",\n    "bounds": ${JSON.stringify(b.bounds)},\n    "coordinateSpace": "${b.coordinateSpace}",\n    "detectionScore": ${b.detectionScore}\n  }]\n}`;
const yamlStart=yaml.indexOf('  layout:\n');assert.ok(yamlStart>=0);
const data={inputCount:capacity.capacity.formats.length,imageWidth:630,imageHeight:720,image:'data:image/png;base64,'+(await readFile(invoice)).toString('base64'),boxes:layout.blocks.filter(b=>b.bounds),focusIndex:layout.blocks.findIndex(b=>Buffer.from(document.content.text).subarray(b.startByte,b.endByte).toString().includes('12345.67')),capacity:{command:`filens '${capacityIntent}'`,excerpt:`{\n  "outputFormats": [\n    "text", "json", "markdown", "html",\n    "yaml", "xml", "csv", "tsv"\n  ],\n  "ocr": {\n    "provider": "${capacity.capacity.ocr.provider}",\n    "available": ${capacity.capacity.ocr.available},\n    "maxSideLen": ${capacity.capacity.ocr.maxSideLen},\n    "openmpThreads": ${capacity.capacity.ocr.openmpThreads}\n  }\n}`},markdown:{command:`filens '${markdownIntent}'`,output:markdown},layout:{command:`filens '${layoutIntent}'`,excerpt,version:layout.version,pages:layout.pages},yaml:{command:`filens '${yamlIntent}'`,excerpt:yaml.slice(yamlStart).split('\n').slice(0,15).map(s=>s.startsWith('  ')?s.slice(2):s).join('\n')}};
await writeFile(path.join(work,'responses.json'),JSON.stringify({runs,data:{...data,image:undefined}},null,2)+'\n');
await page.setViewportSize({width:1280,height:820});
await page.addInitScript(value=>{window.DEMO=value;},data);
await page.goto('file://'+path.join(root,'scripts/agent-cli-demo.html'));
await page.evaluate(()=>document.fonts.ready);
await page.evaluate(()=>window.renderAt(17200));
await page.screenshot({path:path.join(work,'poster.png')});
await copyFile(path.join(work,'poster.png'),path.join(output,'terminal-demo.png'));
if(process.argv.includes('--poster-only')){await browser.close();console.log('Actual CLI demo poster captured.');process.exit(0);}
const frames=await mkdtemp(path.join(os.tmpdir(),'filens-cli-demo-'));
try{
 const fps=12,duration=28.5,count=Math.ceil(fps*duration);
 for(let i=0;i<count;i++){
  await page.evaluate(t=>window.renderAt(t),i/fps*1000);
  await page.screenshot({path:path.join(frames,`frame-${String(i).padStart(4,'0')}.png`)});
  if(i%72===0)console.log(`Captured ${i}/${count} terminal frames`);
 }
 await browser.close();
 const pattern=path.join(frames,'frame-%04d.png');const palette=path.join(frames,'palette.png');
 run('ffmpeg',['-hide_banner','-loglevel','error','-y','-framerate',String(fps),'-i',pattern,'-vf','palettegen=max_colors=128:stats_mode=diff',palette]);
 const gif=path.join(output,'terminal-demo.gif');
 run('ffmpeg',['-hide_banner','-loglevel','error','-y','-framerate',String(fps),'-i',pattern,'-i',palette,'-lavfi','paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle','-gifflags','+transdiff','-loop','0',gif]);
 const bytes=await readFile(gif);
 await writeFile(path.join(work,'receipt.json'),JSON.stringify({createdAt:new Date().toISOString(),width:1280,height:820,duration,fps,frames:count,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),requests:runs.map(r=>({intent:r.intent,ms:r.ms})),notes:'Actual CLI responses, excerpts only; deterministic typing/response replay; right pane visualizes returned source geometry.'},null,2)+'\n');
 console.log(`Created docs/assets/agent-cli/terminal-demo.gif (${(bytes.length/1048576).toFixed(2)} MiB, ${duration}s).`);
}finally{await browser.close();await rm(frames,{recursive:true,force:true});}
