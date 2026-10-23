// Migrated with the Photos renderer; independent references protect pixel ownership and GPU work.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source=readFileSync('src/realtime/stitch-renderer.js','utf8');
const start=source.indexOf('  let previousVideoMask = null;');
const end=source.indexOf('  function scheduleVideoFrameCallback()',start);
for(const [cost,interval] of [[10,1],[60,3],[200,5]])test(`full-frame seam analysis costing ${cost}ms refreshes every ${interval}s while view rendering stays independent`,()=>{
  let calls=0,clockCalls=0;
  const scope:any={canProtectVideo:true,videoRegistered:true,mediaEl:{currentTime:0,seeking:false},Date:{now:()=>clockCalls++%2?cost:0},
    options:{},calibration:{},analysisFrontLens:{},analysisBackLens:{},frontFocal:[.1,.2],backFocal:[.1,.2],frontValidRadius:1,backValidRadius:1,videoOffsets:[],lensGain:[],polarInverseDepth:[],
    analyzeX5VideoSeamFrame:()=>{calls++;return{mask:new Uint8Array(4)};},blendDualFisheyeVideoMasks:(mask:unknown)=>mask,uploadSeamMask:()=>true,Uint8Array,canvas:{dataset:{}},useSeamMask:1};
  runInNewContext(`${source.slice(start,end)};this.protect=protectVideoFrame;this.next=()=>nextVideoSeamTime;`,scope);
  scope.protect();assert.equal(scope.next(),interval);
  scope.mediaEl.currentTime=interval-.01;scope.protect();assert.equal(calls,1);
  scope.mediaEl.currentTime=interval;scope.protect();assert.equal(calls,2);
});
