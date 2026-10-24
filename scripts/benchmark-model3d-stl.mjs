// Binary STL parsing only, engineering old/new comparison; no peer/SOTA ranking.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createBinaryStlFixture } from '../packages/model3d/test/fixtures/mesh.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), option = (key, fallback) => args.includes(key) ? args[args.indexOf(key)+1] : fallback;
const iterations = Number(option('--iterations','7')); assert(Number.isSafeInteger(iterations) && iterations > 0);
const baseline = option('--baseline','tmp/continued-review/model3d-baseline/dist/index.js');
assert(!path.isAbsolute(baseline) && !baseline.split(/[\\/]/).includes('..'));
const out = path.resolve(root, option('--output','tmp/continued-review/model3d-stl-final')); fs.mkdirSync(out,{recursive:true});
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const modules = {baseline,current:'packages/model3d/dist/index.js'};
const samples = [1000,200000,500000].map(triangles => ({name:`generated-${triangles}-triangles.stl`,triangles,bytes:createBinaryStlFixture(triangles)}));
const files = ['packages/core/dist/index.js','node_modules/three/build/three.module.js','node_modules/three/build/three.core.js','packages/model3d/test/fixtures/mesh.mjs','scripts/benchmark-model3d-stl.mjs'];
const result = {engineering:true,scopedSota:false,date:new Date().toISOString(),iterations,cpu:os.cpus()[0].model,
  method:'Fresh Chromium context per invocation, rotating build order. Inputs and imports ready before timing. parseMs measures complete binary STL positions/normals/bounds construction only; no session, edge helpers, GPU, layout/paint, file I/O or module loading. Complete position/normal bytes and bounds hashed after timing. Repeat zero of the 1,000-triangle control also renders a fixed initial view after timing, with animation frozen for a deterministic pixel comparison. Generated inputs; not a peer/SOTA or memory measurement.',
  artifacts:[...Object.entries(modules).map(([engine,file])=>({engine,path:file,sha256:hash(fs.readFileSync(path.join(root,file)))})),...files.map(file=>({path:file,sha256:hash(fs.readFileSync(path.join(root,file)))}))],
  samples:samples.map(({name,triangles,bytes})=>({name,triangles,bytes:bytes.length,sha256:hash(bytes)})),runs:[]};
const server = http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store'); const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(name==='/'){res.setHeader('Content-Type','text/html');res.end(`<!doctype html><script type="importmap">${JSON.stringify({imports:{'@filens/core':'/repo/packages/core/dist/index.js','three':'/repo/node_modules/three/build/three.module.js'}})}</script><link rel="stylesheet" href="/repo/packages/model3d/dist/index.css"><style>body{margin:0}#host{position:fixed;inset:0}</style><div id="host"></div>`);return;}
  const sample=samples.find(sample=>name==='/'+sample.name); if(sample){res.end(sample.bytes);return;}
  const file=path.resolve(root,name.startsWith('/repo/')?name.slice(6):'missing'); if(!file.startsWith(root+path.sep)){res.writeHead(404).end();return;}
  try{res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});result.browser=browser.version();
try{
  for(const sample of samples)for(let iteration=0;iteration<iterations;iteration++)for(const engine of iteration%2?['baseline','current']:['current','baseline']){
    const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1}),page=await context.newPage();
    const run={sample:sample.name,engine,iteration,errors:[]};page.on('pageerror',error=>run.errors.push(error.message));
    try{
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.evaluate(async({module,sample})=>{window.stlBenchmark={lib:await import('/repo/'+module),buffer:await(await fetch('/'+sample.name)).arrayBuffer(),sample};},{module:modules[engine],sample:{name:sample.name,triangles:sample.triangles}});
      Object.assign(run,await page.evaluate(async()=>{
        const {lib,buffer}=window.stlBenchmark,start=performance.now(),model=lib.loadStlGeometry(buffer),parseMs=performance.now()-start;
        const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
        return {parseMs,positionsSha256:await sha(model.positions),normalsSha256:await sha(model.normals),bounds:model.bounds,triangles:model.triangleCount,vertices:model.positions.length/3,normalValues:model.normals.length};
      }));
      if(iteration===0&&sample.triangles===1000){
        Object.assign(run,await page.evaluate(async()=>{
          const {lib,buffer,sample}=window.stlBenchmark;
          window.requestAnimationFrame=()=>0;
          const host=document.getElementById('host'),session=lib.createModel3dPreviewDriver().createSession(host);
          await session.load(buffer,{descriptor:{source:buffer,name:sample.name,extension:'stl'}});
          const canvas=host.querySelector('canvas'),pixels=canvas.toDataURL('image/png');const metadata=session.getState().metadata;
          session.destroy();return{previewPng:pixels,previewMetadata:metadata,destroyed:!host.childElementCount};
        }));
        const png=Buffer.from(run.previewPng.split(',')[1],'base64');delete run.previewPng;
        const file=path.join(out,`${engine}-1000-triangles.png`);fs.writeFileSync(file,png);run.preview={path:path.relative(root,file),sha256:hash(png)};
      }
    }catch(error){run.failure=String(error);}
    result.runs.push(run);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(run));await context.close();
  }
}finally{await browser.close();server.close();}
