// Migrated with the Photos renderer; independent references protect pixel ownership and GPU work.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source=readFileSync('src/realtime/stitch-renderer.js','utf8').replace(/^export /gm,'');
function fixture(externalFrames=true) {
  const uniforms:{name:string;values:number[]}[]=[];
  const contexts:any[]=[];
  const pending=new Map<number,()=>void>();let next=0;
  const record=(name:string,...values:number[])=>uniforms.push({name,values});
  const gl=new Proxy({NO_ERROR:0,getError:()=>0,getParameter:()=>8192,getShaderParameter:()=>true,getProgramParameter:()=>true,
    createShader:()=>({}),createProgram:()=>({}),createBuffer:()=>({}),createTexture:()=>({}),getUniformLocation:(_p:any,name:string)=>name,
    uniform1f:record,uniform2f:record,uniform3f:record,uniform4f:record,uniform4fv:(name:string,values:number[])=>record(name,...values)},
    {get:(target,key)=>key in target?target[key as keyof typeof target]:()=>undefined});
  const canvas=Object.assign(new EventTarget(),{dataset:{},clientWidth:800,clientHeight:600,width:800,height:600,
    getContext:(_name:string,attributes:any)=>{contexts.push(attributes);return gl;}});
  const scope:any={HTMLVideoElement:class{},HTMLImageElement:class{},ImageData:class{},window:{devicePixelRatio:1},canvas,externalFrames,
    performance:{now:()=>0},requestAnimationFrame:(fn:()=>void)=>{pending.set(++next,fn);return next;},cancelAnimationFrame:(id:number)=>pending.delete(id)};
  runInNewContext(`${source}\nthis.renderer=createProjectionRenderer(canvas,{width:512,height:256},normalizeOptions({externalFrames,dualFisheyeFrontLens:'left'}),'dual_fisheye');`,scope);
  const draw=()=>{const callbacks=[...pending.values()];pending.clear();callbacks.forEach(fn=>fn());};
  const frame={displayWidth:256,displayHeight:256};
  const present=(time:number)=>{scope.renderer.presentFrames([frame,frame],time,true);draw();};
  return {renderer:scope.renderer,canvas,uniforms,contexts,present,draw,frame};
}

test('panorama video allocates neither multisample nor unused depth/stencil buffers',()=>{
  const {contexts}=fixture();
  assert.equal(contexts[0].antialias,false,'full-screen video has no geometry edges that need MSAA');
  assert.equal(contexts[0].depth,false);
  assert.equal(contexts[0].stencil,false);
  assert.equal(fixture(false).contexts[0].antialias,true,'preserve the still-image context policy');
});

test('stable video frames reuse projection uniforms while view and texture changes update them',()=>{
  const {renderer,uniforms,present,canvas,frame}=fixture();
  present(0);assert.ok(uniforms.some(u=>u.name==='uViewQuat'));
  uniforms.length=0;present(1/60);
  assert.ok(uniforms.length<=2,`unchanged frame resubmitted ${uniforms.length} uniforms`);
  renderer.setView(15,0,0,75);present(2/60);
  assert.ok(uniforms.some(u=>u.name==='uViewQuat'),'dragging must update the quaternion');
  uniforms.length=0;canvas.clientWidth=1000;present(3/60);
  assert.ok(uniforms.some(u=>u.name==='uViewport' && u.values[0]===1000));
  uniforms.length=0;frame.displayWidth=128;present(4/60);
  assert.ok(uniforms.some(u=>u.name==='uTexel' && u.values[0]===1/256),'resized source textures must invalidate texel uniforms');
});

test('the shader selects one logical lens only inside a safely covered viewport',()=>{
  const {renderer,uniforms,present}=fixture();
  const selected=()=>uniforms.filter(u=>u.name==='uVisibleLens').at(-1)?.values[0];
  present(0);assert.equal(selected(),1);
  renderer.setView(180,0,0,75);present(1/60);assert.equal(selected(),2);
  renderer.setView(90,0,0,75);present(2/60);assert.equal(selected(),0,'the seam keeps both projections');
  renderer.setView(0,65,0,75);present(3/60);assert.equal(selected(),0,'protected poles keep both projections');
});
