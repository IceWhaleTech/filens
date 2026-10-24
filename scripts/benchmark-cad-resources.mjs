// DXF lifecycle and layer interaction engineering A/B; no peer/SOTA ranking.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createLayeredDxfFixture, createPngFixture, createRasterDxfFixture } from '../packages/cad/test/fixtures/resources.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const iterations=Number(option('--iterations','7'));assert(Number.isSafeInteger(iterations)&&iterations>0);
const baseline=option('--baseline','tmp/continued-review/cad-resources-baseline/dist/index.js');
assert(!path.isAbsolute(baseline)&&!baseline.split(/[\\/]/).includes('..'));
const out=path.resolve(root,option('--output','tmp/continued-review/cad-resources-final'));fs.mkdirSync(out,{recursive:true});
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),png=await createPngFixture();
const samples=[
 {name:'generated-50000-lines.dxf',text:createLayeredDxfFixture(50000),lines:50000},
 {name:'generated-100000-lines.dxf',text:createLayeredDxfFixture(100000),lines:100000},
 ...['bytes','slice','blob'].map(representation=>({name:`generated-raster-${representation}.dxf`,text:createRasterDxfFixture(2),representation,expectedImages:2})),
 {name:'filens-cafe.dxf',text:fs.readFileSync(path.join(root,'apps/demo/public/samples/filens-cafe.dxf'),'utf8'),bundled:true}
];
const modules={current:'packages/cad/dist/index.js',baseline};
const method='Fresh Chromium context per invocation, alternating build order, inputs/modules ready before timing. loadMs measures session.load through parsing, resource preparation and SVG DOM construction. hideMs/showMs measure synchronous one-layer visibility updates only. Excludes file/module download, image decode readiness, layout and paint. Complete parsed models, normalized SVG/state and resource bytes are checked after timing; initial viewports captured in repeat zero. Binary-resource baselines render placeholders and cannot support a speed ratio. Generated inputs plus a bundled DXF; no peer/SOTA or peak-memory claim.';
const result={engineering:true,scopedSota:false,date:new Date().toISOString(),cpu:os.cpus()[0].model,iterations,method,
 artifacts:[...Object.entries(modules).map(([engine,file])=>({engine,path:file,sha256:hash(fs.readFileSync(path.join(root,file)))})),
 ...['packages/core/dist/index.js','packages/cad/dist/index.css','scripts/benchmark-cad-resources.mjs','packages/cad/test/fixtures/resources.mjs'].map(file=>({path:file,sha256:hash(fs.readFileSync(path.join(root,file)))}))],
 samples:samples.map(({text,...sample})=>({...sample,sourceSha256:hash(text),sourceBytes:Buffer.byteLength(text),...(sample.representation?{resourceSha256:hash(png),resourceBytes:png.length}:{} )})),runs:[]};
const server=http.createServer((req,res)=>{
 res.setHeader('Cache-Control','no-store');const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 if(name==='/'){res.setHeader('Content-Type','text/html');res.end(`<!doctype html><script type="importmap">${JSON.stringify({imports:{'@filens/core':'/repo/packages/core/dist/index.js'}})}</script><link rel="stylesheet" href="/repo/packages/cad/dist/index.css"><style>body{margin:0}#host{position:fixed;inset:0}</style><div id="host"></div>`);return;}
 if(name==='/raster.png'){res.setHeader('Content-Type','image/png');res.end(png);return;}
 const input=samples.find(sample=>name==='/input/'+sample.name);if(input){res.end(input.text);return;}
 const file=path.resolve(root,name.startsWith('/repo/')?name.slice(6):'missing');if(!file.startsWith(root+path.sep)){res.writeHead(404).end();return;}
 try{res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});result.browser=browser.version();
try{
 for(const sample of samples)for(let iteration=0;iteration<iterations;iteration++)for(const engine of iteration%2?['baseline','current']:['current','baseline']){
  const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1}),page=await context.newPage();page.setDefaultTimeout(120000);
  const run={sample:sample.name,engine,iteration,errors:[]};page.on('pageerror',error=>run.errors.push(error.message));
  try{
   await page.goto(`http://127.0.0.1:${server.address().port}`);
   await page.evaluate(async({module,sample})=>{
    const lib=await import('/repo/'+module),source=new Uint8Array(await(await fetch('/input/'+sample.name)).arrayBuffer());
    let resource;if(sample.representation){const bytes=new Uint8Array(await(await fetch('/raster.png')).arrayBuffer());
     if(sample.representation==='blob')resource=new Blob([bytes],{type:'image/png'});
     else if(sample.representation==='slice'){const padded=new Uint8Array(bytes.length+20);padded.set(bytes,10);resource=padded.subarray(10,-10);}else resource=bytes;
    }
    const active=new Set(),create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
    URL.createObjectURL=blob=>{const url=create(blob);active.add(url);return url;};URL.revokeObjectURL=url=>{active.delete(url);revoke(url);};
    const host=document.getElementById('host'),session=lib.createCadPreviewDriver().createSession(host,{resourceResolver:resource?()=>resource:undefined});
    window.cadBenchmark={lib,source,resource,host,session,active,sample};
   },{module:modules[engine],sample:result.samples.find(item=>item.name===sample.name)});
   Object.assign(run,await page.evaluate(async()=>{
    const{lib,source,host,session,active,sample}=window.cadBenchmark;
    const sha=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value))].map(v=>v.toString(16).padStart(2,'0')).join('');
    const inspect=async()=>{
     const svg=host.querySelector('svg').cloneNode(true),resources=[];
     const sources=[...new Set([...svg.querySelectorAll('[data-image-source]')].map(node=>node.getAttribute('data-image-source')))];
     for(const source of sources){if(!/^(blob:|data:)/.test(source))continue;const bytes=await(await fetch(source)).arrayBuffer();resources.push({source,sha256:await sha(bytes),bytes:bytes.byteLength});}
     for(const node of svg.querySelectorAll('[data-image-source],image'))for(const attribute of['href','data-image-source']){
      const resource=resources.find(item=>item.source===node.getAttribute(attribute));if(resource)node.setAttribute(attribute,'resource:'+resource.sha256);
     }
     const state=session.getState();for(const resource of resources)state.warnings=state.warnings.map(warning=>warning.split(resource.source).join('resource:'+resource.sha256));
     host.getBoundingClientRect();
     return{svgSha256:await sha(svg.outerHTML),stateSha256:await sha(JSON.stringify(state)),images:host.querySelectorAll('image').length,
      visibleImages:host.querySelectorAll('g[data-layer-visible="true"] image').length,
      visibleLayerNodes:host.querySelectorAll('[data-layer-visible="true"]').length,
      resources:resources.map(({source,...resource})=>resource).sort((a,b)=>a.sha256.localeCompare(b.sha256)),warnings:state.warnings.length};
    };
    const start=performance.now();await session.load(source,{descriptor:{source,name:sample.name,extension:'dxf'}});const loadMs=performance.now()-start;
    const modelSha256=await sha(JSON.stringify(lib.loadDxfDrawing(new TextDecoder().decode(source))));
    const loaded=await inspect(),initial=session.getState().activeLayerIds,layer=initial[0];
    const hideStart=performance.now();session.toggleLayer(layer,false);const hideMs=performance.now()-hideStart;const hidden=await inspect();
    const showStart=performance.now();session.toggleLayer(layer,true);const showMs=performance.now()-showStart;const restored=await inspect();
    let decodedImages=0;for(const node of host.querySelectorAll('image')){const image=new Image();image.src=node.getAttribute('href');await image.decode();if(!image.naturalWidth)throw new Error('Empty raster image');decodedImages++;}
    window.cadBenchmark.ready={loadMs,hideMs,showMs,modelSha256,loaded,hidden,restored,decodedImages,createdUrls:active.size};
    return window.cadBenchmark.ready;
   }));
   if(iteration===0){const file=path.join(out,`${engine}-${sample.name}.png`);await page.screenshot({path:file});run.preview={path:path.relative(root,file),sha256:hash(fs.readFileSync(file))};}
   Object.assign(run,await page.evaluate(()=>{const{session,host,active}=window.cadBenchmark;session.destroy();return{destroyed:!host.childElementCount,remainingOwnedUrls:active.size};}));
  }catch(error){run.failure=String(error);}
  result.runs.push(run);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(run));await context.close();
 }
}finally{await browser.close();server.close();}
