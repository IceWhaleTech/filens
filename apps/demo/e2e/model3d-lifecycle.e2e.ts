import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { createBinaryStlFixture, createGlbFixture } from '../../../packages/model3d/test/fixtures/mesh.mjs';

const prepare = async (page: import('@playwright/test').Page) => {
  await page.goto('./'); const url = new URL(`@fs${resolve('packages/model3d/src/index.ts')}`, page.url()).href;
  await page.evaluate(async url => {
    const lib = await import(/* @vite-ignore */ url), host = document.createElement('div'); host.style.cssText='position:fixed;inset:0';document.body.replaceChildren(host);
    const session = lib.createModel3dPreviewDriver().createSession(host); (window as any).modelTest={lib,host,session};
  },url);
};

test('opens actual STL and GLB models and discards events from the previous WebGL canvas',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await prepare(page);
 await page.evaluate(async bytes=>{const state=(window as any).modelTest,source=new Uint8Array(bytes);await state.session.load(source,{descriptor:{source,name:'terrain.stl',extension:'stl'}});state.old=state.host.querySelector('canvas');},[...createBinaryStlFixture(1000)]);
 await expect(page.locator('canvas.model3dv-canvas')).toBeVisible();
 const result=await page.evaluate(async bytes=>{
  const {session,host,old}=(window as any).modelTest,source=new Uint8Array(bytes);await session.load(source,{descriptor:{source,name:'triangle.glb',extension:'glb'}});
  const before=session.getState();old.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,cancelable:true}));const after=session.getState();
  const context=host.querySelector('canvas').getContext('webgl2');const glError=context.getError();
  const result={title:after.title,triangles:after.metadata.triangleCount,scaleUnchanged:before.scale===after.scale,canvases:host.querySelectorAll('canvas').length,glError};
  session.destroy();return{...result,empty:!host.childElementCount};
 },[...createGlbFixture()]);
 expect(result).toEqual({title:'triangle.glb',triangles:1,scaleUnchanged:true,canvases:1,glError:0,empty:true});expect(errors).toEqual([]);
});

test('does not mount an old model when a replaced source response arrives late',async({page})=>{
 let complete!:()=>void,requested!:()=>void;const response=new Promise<void>(resolve=>{complete=resolve;}),request=new Promise<void>(resolve=>{requested=resolve;});
 await page.route('**/delayed-model.stl',async route=>{requested();await response;await route.fulfill({body:Buffer.from(createBinaryStlFixture(2))}).catch(()=>{});});
 await prepare(page);
 await page.evaluate(()=>{const {session}=(window as any).modelTest;(window as any).modelTest.pending=session.load('/delayed-model.stl',{descriptor:{source:'/delayed-model.stl',name:'old.stl',extension:'stl'}});});await request;
 await page.evaluate(async bytes=>{const{session}=(window as any).modelTest,source=new Uint8Array(bytes);await session.load(source,{descriptor:{source,name:'current.glb',extension:'glb'}});},[...createGlbFixture()]);
 complete();await page.evaluate(async()=>{await(window as any).modelTest.pending;});
 expect(await page.evaluate(()=>(window as any).modelTest.session.getState())).toMatchObject({title:'current.glb',loading:false,error:null,metadata:{triangleCount:1}});
 await expect(page.locator('canvas.model3dv-canvas')).toHaveCount(1);
});

test('cancels a displayed 3D model and stops its detached controls and animation',async({page})=>{
 await prepare(page);
 const result=await page.evaluate(async bytes=>{
  const{session,host}=(window as any).modelTest,source=new Uint8Array(bytes),controller=new AbortController();let rendered=0;session.on('rendered',()=>rendered++);
  await session.load(source,{descriptor:{source,name:'terrain.stl',extension:'stl'},signal:controller.signal});const old=host.querySelector('canvas'),before=session.getState().scale;
  controller.abort();old.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,cancelable:true}));
  const state=session.getState();const result={canvases:host.querySelectorAll('canvas').length,loading:state.loading,error:state.error,scaleUnchanged:before===state.scale,rendered};session.destroy();return result;
 },[...createBinaryStlFixture(50)]);
 expect(result).toEqual({canvases:0,loading:false,error:null,scaleUnchanged:true,rendered:1});
});

test('opens binary STL through the demo upload flow',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('./?view=preview');
 await page.locator('input[type=file]').setInputFiles({name:'terrain.stl',mimeType:'model/stl',buffer:Buffer.from(createBinaryStlFixture(1000))});
 await expect(page.locator('canvas.model3dv-canvas')).toBeVisible();await expect(page.locator('.wb-note.is-error')).toHaveCount(0);expect(errors).toEqual([]);
});
