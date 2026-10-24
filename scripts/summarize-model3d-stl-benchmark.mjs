import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const args=process.argv.slice(2),option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const input=option('--input','tmp/continued-review/model3d-stl-final/results.json'),bytes=fs.readFileSync(input),result=JSON.parse(bytes);
assert.equal(result.engineering,true);assert.equal(result.runs.length,result.samples.length*result.iterations*2);
const median=values=>{const a=[...values].sort((a,b)=>a-b),m=a.length>>1;return a.length%2?a[m]:(a[m-1]+a[m])/2;};
let seed=12345;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
const samples=result.samples.map(sample=>{
 const group=engine=>result.runs.filter(run=>run.sample===sample.name&&run.engine===engine).sort((a,b)=>a.iteration-b.iteration);
 const current=group('current'),baseline=group('baseline'),reference=baseline[0];
 for(const group of[current,baseline]){assert.equal(group.length,result.iterations);group.forEach((run,i)=>{
  assert.equal(run.iteration,i);assert(!run.failure,run.failure);assert.deepEqual(run.errors,[]);assert(Number.isFinite(run.parseMs)&&run.parseMs>0);
  assert.equal(run.triangles,sample.triangles);assert.equal(run.vertices,sample.triangles*3);assert.equal(run.normalValues,sample.triangles*9);
  for(const field of['positionsSha256','normalsSha256','bounds'])assert.deepEqual(run[field],reference[field],sample.name+': '+field);
 });}
 if(sample.triangles===1000){assert.equal(current[0].preview.sha256,reference.preview.sha256);assert.deepEqual(current[0].previewMetadata,reference.previewMetadata);assert.equal(current[0].destroyed,true);}
 const a=current.map(run=>run.parseMs),b=baseline.map(run=>run.parseMs),ratios=[];
 for(let i=0;i<10000;i++){const indices=a.map(()=>Math.floor(random()*a.length));ratios.push(median(indices.map(i=>b[i]))/median(indices.map(i=>a[i])));}
 ratios.sort((a,b)=>a-b);const interval=[ratios[250],ratios[9750]];
 return{sample:sample.name,currentMs:median(a),baselineMs:median(b),ratio:median(b)/median(a),ratio95PercentBootstrapInterval:interval,below10MsControl:median(b)<=10,stableEngineeringReduction:median(b)>10&&interval[0]>1,completePositionsNormalsAndBoundsMatch:true,scopedSota:false};
});
const report={engineering:true,scopedSota:false,sourceSha256:crypto.createHash('sha256').update(bytes).digest('hex'),cpu:result.cpu,browser:result.browser,iterations:result.iterations,runs:result.runs.length,
 method:'10,000 paired bootstrap median-ratio resamples, seed 12345. Binary STL parsing only, excluding input loading, session/edge construction, GPU work and paint. Generated models, no peer/SOTA or peak-memory ranking. Baseline medians at or below 10 ms receive no speed claim; all measurements remain.',samples};
fs.writeFileSync(option('--output',path.join(path.dirname(input),'summary.json')),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
