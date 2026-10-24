import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const args=process.argv.slice(2), option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const input=option('--input','tmp/continued-review/panorama-lifecycle-final/results.json'), bytes=fs.readFileSync(input), result=JSON.parse(bytes);
assert.equal(result.engineering,true); assert.equal(result.runs.length,result.samples.length*result.iterations*2);
const median=values=>{const a=[...values].sort((x,y)=>x-y), m=a.length>>1;return a.length%2?a[m]:(a[m-1]+a[m])/2;};
let seed=12345;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
const reference=result.runs[0].content;
const samples=result.samples.map(sample=>{
  const group=engine=>result.runs.filter(run=>run.sample===sample.name&&run.engine===engine).sort((a,b)=>a.iteration-b.iteration), current=group('current'),baseline=group('baseline');
  for(const runs of [current,baseline]){assert.equal(runs.length,result.iterations);runs.forEach((run,i)=>{
    assert.equal(run.iteration,i);assert(!run.failure,run.failure);assert.deepEqual(run.pageErrors,[]);assert.equal(run.error,null);assert(run.destroyed);assert.equal(run.urlsAfterDestroy,0);
    assert(Number.isFinite(run.elapsedMs)&&run.elapsedMs>=0);assert.deepEqual(run.content,reference);assert.equal(run.content.payloadSha256,result.input.sha256);assert.equal(run.content.payloadBytes,result.input.bytes);
    assert.equal(run.content.naturalWidth,result.input.width);assert.equal(run.content.naturalHeight,result.input.height);
  });}
  const a=current.map(run=>run.elapsedMs),b=baseline.map(run=>run.elapsedMs),am=median(a),bm=median(b),ratios=[];
  if(bm>10&&am>0)for(let j=0;j<10000;j++){const indexes=a.map(()=>Math.floor(random()*a.length)),d=median(indexes.map(i=>a[i]));ratios.push(d?median(indexes.map(i=>b[i]))/d:Infinity);}
  ratios.sort((a,b)=>a-b);const interval=ratios.length?[ratios[250],ratios[9750]]:null;
  return{sample:sample.name,baselineMs:bm,currentMs:am,ratio:ratios.length?bm/am:null,pairedBootstrapRatio95:interval,below10MsControl:bm<=10,stableEngineeringReduction:result.iterations>=7&&bm>10&&interval?.[0]>1,completeBlobAndCanvasPixelsMatch:true,scopedSota:false};
});
const report={engineering:true,scopedSota:false,sourceSha256:crypto.createHash('sha256').update(bytes).digest('hex'),iterations:result.iterations,runs:result.runs.length,cpu:result.cpu,browser:result.browser,
method:'10,000 paired bootstrap resamples of public panorama load median ratios, seed 12345. Seven repeats, baseline above 10 ms and an interval above 1 required for a stable reduction. Includes WebGL context, Blob snapshot, image decoding and DOM setup; excludes scheduled drawing/upload, source/module preparation and post-timer content checks. Complete Blob/pixel equivalence checked in every run. No peer/SOTA or peak-memory claim.',samples};
fs.writeFileSync(option('--output',path.join(path.dirname(input),'summary.json')),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
