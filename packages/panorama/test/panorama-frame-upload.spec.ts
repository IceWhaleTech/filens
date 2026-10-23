// Migrated with the Photos renderer; independent references protect pixel ownership and GPU work.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source=readFileSync('src/realtime/stitch-renderer.js','utf8');
const implementation=`const canRegisterVideo=false,canRegisterDJI=false;let videoRegistered=true,videoRegistrationAttempts=0,videoSeamFailures=0,useSeamMask=0;`+
  source.slice(source.indexOf('  let externalGpuLimit'),source.indexOf('  return {\n    reset:'));
test('decoded lens textures reuse GPU storage and resize independently',()=>{
  const allocations:unknown[]=[],updates:unknown[]=[];
  const gl:any={MAX_TEXTURE_SIZE:1,NO_ERROR:0, getParameter:()=>16384,getError:()=>0,uniform1f(){},activeTexture(){},bindTexture(){},pixelStorei(){},texImage2D:(...args:unknown[])=>allocations.push(args),texSubImage2D:(...args:unknown[])=>updates.push(args)};
  const scope:any={gl,running:true,externalFrames:true,separateLoc:0,verticalLoc:0,verticalDualFisheye:false,textureFlipY:false,tex:{},backTex:{},clearWebGLErrors(){},projectionKind:'dual_fisheye',canProtectVideo:false,requestFrame(){},ImageData:class{},performance:{now:()=>0}};
  runInNewContext(`let externalTextureSizes=[];let previousExternalTime=null,previousVideoMask=null,nextVideoSeamTime=-Infinity;const videoAnalysisCache={};${implementation};this.present=presentFrames;this.size=()=>uploadedTextureSize;`,scope);
  const lens=(n:number)=>({displayWidth:n,displayHeight:n});
  scope.present([lens(2880),lens(2880)],0);
  scope.present([lens(2880),lens(2880)],1/60);
  scope.present([lens(2880),lens(1440)],2/60);
  assert.equal(allocations.length,3,'only initial allocation or a changed lens size may reallocate');
  assert.equal(updates.length,3);
});
test('native lens uploads use decoded video dimensions rather than the element attributes',()=>{
  const gl:any={MAX_TEXTURE_SIZE:1,NO_ERROR:0,getParameter:()=>16384,getError:()=>0,uniform1f(){},activeTexture(){},bindTexture(){},pixelStorei(){},texImage2D(){},texSubImage2D(){}};
  const scope:any={gl,running:true,externalFrames:true,separateLoc:0,verticalLoc:0,verticalDualFisheye:false,textureFlipY:false,tex:{},backTex:{},clearWebGLErrors(){},projectionKind:'dual_fisheye',canProtectVideo:false,requestFrame(){},ImageData:class{},performance:{now:()=>0}};
  runInNewContext(`let externalTextureSizes=[];let previousExternalTime=null,previousVideoMask=null,nextVideoSeamTime=-Infinity;const videoAnalysisCache={};let uploadedTextureSize;${implementation};this.present=presentFrames;this.size=()=>uploadedTextureSize;`,scope);
  scope.present([{videoWidth:2880,videoHeight:2880,width:0,height:0},{videoWidth:2880,videoHeight:2880,width:0,height:0}],0);
  assert.equal(scope.size().width,5760);assert.equal(scope.size().height,2880);
});

test('single-lens presentation retains the hidden texture and skips its upload and seam analysis',()=>{
  let uploads=0,analysis=0;
  const gl:any={MAX_TEXTURE_SIZE:1,NO_ERROR:0,getParameter:()=>16384,getError:()=>0,uniform1f(){},activeTexture(){},bindTexture(){},pixelStorei(){},texImage2D(){uploads++;},texSubImage2D(){uploads++;}};
  const scope:any={gl,running:true,externalFrames:true,separateLoc:0,verticalLoc:0,verticalDualFisheye:false,textureFlipY:false,tex:{},backTex:{},clearWebGLErrors(){},projectionKind:'dual_fisheye',canProtectVideo:true,requestFrame(){},ImageData:class{},performance:{now:()=>0},
    getRequiredTracks:()=>[true,false],mediaEl:{width:320,height:160,getContext:()=>({drawImage(){analysis++;}})},registerVideoFrame(){},protectVideoFrame(){}};
  runInNewContext(`let externalTextureSizes=[];let previousExternalTime=null,previousVideoMask=null,nextVideoSeamTime=-Infinity;const videoAnalysisCache={};let uploadedTextureSize;${implementation};this.present=presentFrames;`,scope);
  const lens={displayWidth:2880,displayHeight:2880};
  scope.present([lens,lens],0);assert.equal(uploads,2,'prime both textures once for dragging');
  scope.present([lens,null],.1);scope.present([null,lens],.2);
  assert.equal(uploads,4);assert.equal(analysis,2,'incomplete pairs must not overwrite the cached seam analysis');
});

test('failed foreground analysis stops CPU frame copies and a seek clears stale ownership before retrying', () => {
  let copies = 0;
  const gl: any = { MAX_TEXTURE_SIZE: 1, NO_ERROR: 0, getParameter: () => 16384, getError: () => 0,
    uniform1f() {}, activeTexture() {}, bindTexture() {}, pixelStorei() {}, texImage2D() {}, texSubImage2D() {} };
  const scope: any = { gl, running: true, externalFrames: true, separateLoc: 0, verticalLoc: 0,
    verticalDualFisheye: false, textureFlipY: false, tex: {}, backTex: {}, clearWebGLErrors() {},
    projectionKind: 'dual_fisheye', canProtectVideo: true, requestFrame() {}, ImageData: class {},
    performance: { now: () => 0 }, mediaEl: { width: 320, height: 160, getContext: () => ({ drawImage() { copies++; } }) },
    registerVideoFrame() {}, protectVideoFrame() {} };
  runInNewContext(`let externalTextureSizes=[];let previousExternalTime=null,previousVideoMask=null,nextVideoSeamTime=-Infinity;
    const videoAnalysisCache={};let uploadedTextureSize;${implementation};this.present=presentFrames;
    this.fail=()=>{videoSeamFailures=3;useSeamMask=1;};this.mask=()=>useSeamMask;`, scope);
  const frame = { displayWidth: 1024, displayHeight: 1024 };
  scope.present([frame, frame], 0, true);
  assert.equal(copies, 2);
  scope.fail();
  for (let index = 1; index < 10; index++) scope.present([frame, frame], index / 10, true);
  assert.equal(copies, 2, 'exhausted optional analysis must not copy every decoded frame');
  scope.present([frame, null], 0, true);
  assert.equal(scope.mask(), 0, 'seeking must immediately stop drawing stale ownership, even with one missing lens');
  scope.present([frame, frame], 0, true);
  assert.equal(copies, 4, 'a seek must allow the current paired frame to rebuild ownership');
});

test('stable video textures do not force synchronous GPU state queries on every frame',()=>{
  let limits=0,errors=0;
  const gl:any={MAX_TEXTURE_SIZE:1,NO_ERROR:0,getParameter:()=>{limits++;return 16384;},getError:()=>{errors++;return 0;},uniform1f(){},activeTexture(){},bindTexture(){},pixelStorei(){},texImage2D(){},texSubImage2D(){}};
  const scope:any={gl,running:true,externalFrames:true,separateLoc:0,verticalLoc:0,verticalDualFisheye:false,textureFlipY:false,tex:{},backTex:{},clearWebGLErrors(){},projectionKind:'dual_fisheye',canProtectVideo:false,requestFrame(){},ImageData:class{},performance:{now:()=>0}};
  runInNewContext(`let externalTextureSizes=[];let previousExternalTime=null,previousVideoMask=null,nextVideoSeamTime=-Infinity;const videoAnalysisCache={};let uploadedTextureSize;${implementation};this.present=presentFrames;`,scope);
  const frame={displayWidth:2880,displayHeight:2880};
  for(let i=0;i<60;i++)scope.present([frame,frame],i/60);
  assert.equal(limits,1,'MAX_TEXTURE_SIZE is a device limit, not per-frame state');
  assert.ok(errors<=2,`GPU readbacks serialized ${errors} uploads`);
});

test('DJI direct analysis never retains full decoder frames after an analysis error', () => {
  let copies = 0;
  const gl: any = { NO_ERROR: 0, getParameter: () => 8192, getError: () => 0, uniform1f() {}, activeTexture() {},
    bindTexture() {}, pixelStorei() {}, texImage2D() {}, texSubImage2D() {} };
  class Image { width = 1024; height = 1024; }
  const scope: any = { gl, running: true, externalFrames: true, ImageData: Image, performance: { now: () => 0 },
    separateLoc: 0, verticalLoc: 0, verticalDualFisheye: false, textureFlipY: false, tex: {}, backTex: {},
    clearWebGLErrors() {}, projectionKind: 'dual_fisheye', canProtectVideo: true, requestFrame() {}, registerVideoFrame() {},
    mediaEl: { width: 2048, height: 1024, getContext: () => ({ drawImage() { copies++; } }) } };
  runInNewContext(`let externalTextureSizes=[];let previousExternalTime=null,previousVideoMask=null,nextVideoSeamTime=-Infinity;
    const videoAnalysisCache={};let uploadedTextureSize;${implementation.replace('canRegisterDJI=false', 'canRegisterDJI=true')};
    this.present=presentFrames;this.cache=videoAnalysisCache;`, scope);
  const frames = [new Image(), new Image()];
  scope.protectVideoFrame = () => {
    assert.equal(scope.cache.softwareFrames, frames);
    assert.equal(typeof scope.cache.prepareSoftwareFallback, 'function');
    throw new Error('simulated analysis error');
  };
  assert.throws(() => scope.present(frames, 0, true), /simulated analysis error/);
  assert.equal(scope.cache.softwareFrames, null);
  assert.equal(scope.cache.prepareSoftwareFallback, null);
  assert.equal(copies, 0, 'ordinary opaque software frames must skip the packed canvas round trip');
});

test('expensive uploads reduce presentation work dynamically without delaying a paused seek or changed lens',()=>{
  let now=0,uploads=0;
  const gl:any={MAX_TEXTURE_SIZE:1,NO_ERROR:0,getParameter:()=>16384,getError:()=>0,uniform1f(){},activeTexture(){},bindTexture(){},pixelStorei(){},
    texImage2D(){uploads++;now+=40;},texSubImage2D(){uploads++;now+=40;}};
  const scope:any={gl,running:true,externalFrames:true,separateLoc:0,verticalLoc:0,verticalDualFisheye:false,textureFlipY:false,tex:{},backTex:{},clearWebGLErrors(){},projectionKind:'dual_fisheye',canProtectVideo:false,requestFrame(){},ImageData:class{},performance:{now:()=>now}};
  runInNewContext(`let externalTextureSizes=[];let previousExternalTime=null,previousVideoMask=null,nextVideoSeamTime=-Infinity;const videoAnalysisCache={};let uploadedTextureSize;${implementation};this.present=presentFrames;`,scope);
  const frame={displayWidth:2880,displayHeight:2880};
  assert.equal(scope.present([frame,null],0),40,'report only measured local upload cost to the device policy');assert.equal(uploads,1);
  now=45;assert.equal(scope.present([frame,null],1/60),undefined,'paced frames must not duplicate performance samples');assert.equal(uploads,1,'slow uploads must leave room for decoding and controls');
  scope.present([null,frame],2/60);assert.equal(uploads,2,'a newly visible track bypasses presentation pacing');
  scope.present([null,frame],3/60,true);assert.equal(uploads,3,'a paused seek must upload its target even inside the pacing interval');
  now+=100;scope.present([null,frame],4/60);assert.equal(uploads,4,'presentation resumes without a fixed 30fps limit');
});
