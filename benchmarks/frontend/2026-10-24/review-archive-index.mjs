import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
const root=process.cwd(), out='tmp/continued-review/archive-index-content-review.json';
const samples=JSON.parse(fs.readFileSync('tmp/performance-other/samples.json')).filter(s=>s.family==='zip');
samples.push(...['sample-archive.tar','sample-archive.tgz','sample-archive-tar-gz.bin'].map(name=>({name:name.endsWith('.bin')?'sample-archive.tar.gz':name,path:`apps/demo/public/samples/${name}`})));
samples.push(...['pax','gnu'].map(format=>({name:`${format}-long-path.tar`,path:`packages/archive/test/fixtures/${format}-long-path.tar`,long:true})));
const imports={'@filens/core':'/repo/packages/core/dist/index.js'};
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(`<script type="importmap">${JSON.stringify({imports})}</script>`);return;}
 const file=path.resolve(root,decodeURIComponent(url.pathname).slice('/repo/'.length));
 if(!url.pathname.startsWith('/repo/')||!file.startsWith(root+path.sep)){res.writeHead(404).end();return;}
 try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`, browser=await chromium.launch();
const result={method:'Functional checks outside benchmark timing. Every entry metadata field, complete decoded file and exact/URI/Windows resource resolution are hashed; ordinary inputs must match the previous build.',runs:[]};
try{
 for(const sample of samples)for(const engine of ['filens','filens-baseline']){
  const context=await browser.newContext(),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.goto(base);
  const checks=await page.evaluate(async({sample,engine})=>{
   const module=engine==='filens'?'/repo/packages/archive/dist/index.js':'/repo/tmp/continued-review/archive-index-baseline/dist/index.js';
   const {createArchiveResourceIndex}=await import(module);
   const bytes=new Uint8Array(await(await fetch(`/repo/${sample.path}`)).arrayBuffer());
   const descriptor={name:sample.name,extension:sample.name.endsWith('.tar.gz')?'gz':sample.name.split('.').pop()};
   const index=await createArchiveResourceIndex(bytes,{descriptor});
   const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
   const jsonHash=value=>hash(new TextEncoder().encode(JSON.stringify(value)));
   const metadata=index.entries.map(({name,type,size,modified,contentType})=>({name,type,size,modified,contentType}));
   const content=[],resolved=[];
   for(const entry of index.files){
    content.push([entry.name,await hash(await entry.readAsArrayBuffer())]);
    const basename=entry.name.split('/').pop();
    for(const name of [entry.name,encodeURI(entry.name)+'?v=1#preview',`C:\\upload\\${basename}`]){
     const resource=await index.resolve({source:name});
     resolved.push([name,resource?await hash(resource.source):null]);
    }
   }
   const first=index.files[0], before=first&&await first.readAsText();
   if(first)new Uint8Array(await first.readAsArrayBuffer()).fill(0);
   const independent=first?before===await first.readAsText():true;
   let longPathCorrect;
   if(sample.long){
    const name='目录/'+'long-file-name-'.repeat(12)+'预览.txt';
    longPathCorrect=index.files.length===2&&(await index.read(name)?.readAsText())==='Long path preview: 中文内容\n'&&(await index.read('next.txt')?.readAsText())==='Next entry\n';
   }
   return {entries:metadata.length,files:index.files.length,metadataSha256:await jsonHash(metadata),contentSha256:await jsonHash(content),resolutionsSha256:await jsonHash(resolved),independentBuffers:independent,longPathCorrect};
  },{sample,engine});
  result.runs.push({sample:sample.name,engine,errors,...checks});await context.close();
 }
 for(const sample of samples){
  const [a,b]=result.runs.filter(r=>r.sample===sample.name);
  if(a.errors.length||b.errors.length||!a.independentBuffers||!b.independentBuffers)throw Error('Browser/buffer check: '+sample.name);
  if(sample.long){if(!a.longPathCorrect||b.longPathCorrect)throw Error('Long path regression: '+sample.name);}
  else for(const key of ['metadataSha256','contentSha256','resolutionsSha256'])if(a[key]!==b[key])throw Error('Changed '+key+': '+sample.name);
 }
 fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');console.log(`${result.runs.length} functional runs passed: 6 common archives unchanged; PAX/GNU long paths repaired.`);
}finally{await browser.close();server.close();}
