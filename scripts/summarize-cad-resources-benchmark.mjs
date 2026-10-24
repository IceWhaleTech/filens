import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const args=process.argv.slice(2),option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const input=option('--input','tmp/continued-review/cad-resources-final/results.json'),bytes=fs.readFileSync(input),result=JSON.parse(bytes);
assert.equal(result.engineering,true);assert.equal(result.runs.length,result.samples.length*result.iterations*2);
const median=values=>{const a=[...values].sort((a,b)=>a-b),m=a.length>>1;return a.length%2?a[m]:(a[m-1]+a[m])/2;};
let seed=12345;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
const samples=result.samples.map(sample=>{
 const group=engine=>result.runs.filter(run=>run.sample===sample.name&&run.engine===engine).sort((a,b)=>a.iteration-b.iteration);
 const current=group('current'),baseline=group('baseline'),reference=baseline[0];
 const incompleteBinaryBaseline=['bytes','slice'].includes(sample.representation),comparable=!incompleteBinaryBaseline;
 for(const[engine,runs]of Object.entries({current,baseline})){
  assert.equal(runs.length,result.iterations);runs.forEach((run,index)=>{
   assert.equal(run.iteration,index);assert(!run.failure,run.failure);assert.deepEqual(run.errors,[]);
   for(const metric of['loadMs','hideMs','showMs'])assert(Number.isFinite(run[metric])&&run[metric]>=0,metric);
   assert.equal(run.modelSha256,reference.modelSha256);assert.equal(run.destroyed,true);
   if(engine==='current')assert.equal(run.remainingOwnedUrls,0);
   for(const state of['loaded','hidden','restored']){
    assert.deepEqual(run[state],runs[0][state],sample.name+': unstable '+engine+' '+state);
    if(comparable)assert.deepEqual(run[state],reference[state],sample.name+': '+state);
    for(const resource of run[state].resources){assert.equal(resource.sha256,sample.resourceSha256);assert.equal(resource.bytes,sample.resourceBytes);}
   }
   assert.equal(run.loaded.svgSha256,run.restored.svgSha256,sample.name+': restore');
   if(sample.expectedImages){
    const expected=engine==='baseline'&&incompleteBinaryBaseline?0:sample.expectedImages;
    assert.equal(run.loaded.images,expected);assert.equal(run.decodedImages,expected);
    if(expected)assert.equal(run.loaded.warnings,0);
   }
  });
 }
 if(comparable)assert.equal(current[0].preview.sha256,reference.preview.sha256,sample.name+': pixels');
 const metrics={};
 for(const metric of['loadMs','hideMs','showMs']){
  const a=current.map(run=>run[metric]),b=baseline.map(run=>run[metric]),am=median(a),bm=median(b);
  let ratio=null,interval=null;
  if(comparable&&bm>10&&am>0){
   ratio=bm/am;const ratios=[];
   for(let i=0;i<10000;i++){const indices=a.map(()=>Math.floor(random()*a.length));const denominator=median(indices.map(i=>a[i]));ratios.push(denominator?median(indices.map(i=>b[i]))/denominator:Infinity);}
   ratios.sort((a,b)=>a-b);interval=[ratios[250],ratios[9750]];assert(interval.every(Number.isFinite));
  }
  metrics[metric]={currentMs:am,baselineMs:bm,ratio,ratio95PercentBootstrapInterval:interval,below10MsControl:bm<=10,
   stableEngineeringReduction:comparable&&result.iterations>=7&&bm>10&&interval?.[0]>1};
 }
 return{sample:sample.name,comparable,exclusion:incompleteBinaryBaseline?'Old binary-resource output contains placeholders instead of raster images; no performance ratio.':null,
  completeModelsMatch:true,normalizedSvgAndStateMatch:comparable,initialPixelsMatch:comparable,currentDecodedImages:current.map(run=>run.decodedImages),baselineDecodedImages:baseline.map(run=>run.decodedImages),metrics,scopedSota:false};
});
const summary={engineering:true,scopedSota:false,sourceSha256:crypto.createHash('sha256').update(bytes).digest('hex'),iterations:result.iterations,runs:result.runs.length,cpu:result.cpu,browser:result.browser,
 method:'10,000 paired bootstrap median-ratio resamples, seed 12345. Claim only comparable complete outputs, seven repeats and baseline median above 10 ms with a 95% interval above 1. Binary-resource baselines omit images; their times are diagnostic and receive no ratio. Keep slower loads and sub-10 ms controls. No peer/SOTA ranking; visibility timings exclude layout and paint.',samples};
fs.writeFileSync(option('--output',path.join(path.dirname(input),'summary.json')),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
