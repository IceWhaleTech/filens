import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { createPanoramaBitmap } from '../../../packages/panorama/test/fixtures/bitmap.mjs';

test.use({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });
const prepare = async (page: import('@playwright/test').Page) => {
  // Keep the demo's automatic PPTX preview from creating unrelated media URLs.
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/panorama/src/index.ts')}`, page.url()).href;
  await page.evaluate(async moduleUrl => {
    const lib = await import(/* @vite-ignore */ moduleUrl), host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;width:640px;height:480px;background:black;z-index:9999'; document.body.replaceChildren(host);
    const active = new Set<string>(), create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); active.add(url); return url; };
    URL.revokeObjectURL = url => { active.delete(url); revoke(url); };
    const image = async () => {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#158ac4'; ctx.fillRect(0,0,512,128); ctx.fillStyle = '#ad653a'; ctx.fillRect(0,128,512,128);
      return new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
    };
    const source = await image(), session = new lib.PanoramaPreviewSession(host);
    (window as any).panoramaLife = { lib, host, active, source, session, image };
  }, moduleUrl);
};

test('releases a real panorama context, URLs and retained interactions on abort, then reopens', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page);
  const result = await page.evaluate(async () => {
    const { session, source, host, active } = (window as any).panoramaLife, controller = new AbortController();
    await session.load(source, { descriptor: { name:'first.pano',extension:'pano',contentType:'image/png' }, signal:controller.signal });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const canvas = host.querySelector('canvas'), gl = canvas.getContext('webgl2'), before = session.getState();
    controller.abort(); canvas.dispatchEvent(new WheelEvent('wheel', { deltaY:-100 }));
    const aborted = { empty:!host.querySelector('canvas'),urls:active.size,error:session.getState().error,loading:session.getState().loading,scale:session.getState().scale,lost:gl.isContextLost() };
    await session.load(source, { descriptor: { name:'reopened.pano',extension:'pano',contentType:'image/png' } });
    const reopened = { title:session.getState().title,width:session.getState().naturalWidth,canvas:!!host.querySelector('canvas') };
    session.destroy(); return { before:[before.naturalWidth,before.naturalHeight],aborted,reopened,urls:active.size,empty:!host.childElementCount };
  });
  expect(result).toEqual({ before:[512,256],aborted:{empty:true,urls:0,error:null,loading:false,scale:1,lost:true},reopened:{title:'reopened.pano',width:512,canvas:true},urls:0,empty:true });
  expect(errors).toEqual([]);
});

test('settles an obsolete browser image request before its response and preserves the replacement', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let release!: () => void, seen = false; const gate = new Promise<void>(resolve => release = resolve);
  await page.route('**/slow-panorama.svg', async route => { seen = true; await gate; await route.fulfill({ contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="red"/></svg>' }); });
  try {
    await prepare(page);
    await page.evaluate(() => {
      const state = (window as any).panoramaLife;
      const create = document.createElementNS.bind(document);
      document.createElementNS = ((...args: Parameters<typeof document.createElementNS>) => {
        const node = create(...args);
        if (args[1] === 'img') node.addEventListener('load', () => {
          if ((node as HTMLImageElement).src.endsWith('slow-panorama.svg')) state.oldDecoded = true;
        }, { once: true });
        return node;
      }) as typeof document.createElementNS;
      state.old = state.session.load(new URL('slow-panorama.svg',location.href).href, { descriptor:{name:'old.pano',extension:'pano'} }).then(()=>'loaded',(error:Error)=>error.name);
    });
    await expect.poll(() => seen).toBe(true);
    await page.evaluate(async () => {
      const { session,source } = (window as any).panoramaLife; await session.load(source,{descriptor:{name:'new.pano',extension:'pano',contentType:'image/png'}});
    });
    expect(await page.evaluate(() => (window as any).panoramaLife.old)).toBe('AbortError');
    release(); await expect.poll(() => page.evaluate(() => (window as any).panoramaLife.oldDecoded)).toBe(true);
    const state = await page.evaluate(() => { const { session,host,active } = (window as any).panoramaLife; const before=session.getState();session.destroy();return {title:before.title,width:before.naturalWidth,error:before.error,empty:!host.childElementCount,urls:active.size}; });
    expect(state).toEqual({title:'new.pano',width:512,error:null,empty:true,urls:0}); expect(errors).toEqual([]);
  } finally { release(); }
});

test('cancels an ordinary DNG after real WASM conversion and releases its image', async ({ page }) => {
  test.setTimeout(60_000); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page);
  const converterUrl = new URL(`@fs${resolve('packages/converter-client/src/index.ts')}`, page.url()).href;
  const result = await page.evaluate(async converterUrl => {
    const state=(window as any).panoramaLife, { createWasmConverterClient }=await import(/* @vite-ignore */ converterUrl);
    state.session.destroy();
    const wasm=new URL('externals/converter-core.wasm',location.href).href, imageWasm=new URL('externals/converter-image.wasm',location.href).href;
    const processor=state.lib.createWasmPanoramaProcessor({wasm,imageWasm}), converter=createWasmConverterClient({wasm,imageWasm});
    const session=state.lib.createRawImagePreviewDriver({processor,converter}).createSession(state.host), controller=new AbortController();
    const source=await (await fetch(new URL('samples/raw/pentax-k-r.dng',location.href))).blob();
    await session.load(source,{descriptor:{name:'ordinary.dng',extension:'dng'},signal:controller.signal});
    const image=state.host.querySelector('img'); await image.decode(); image.dispatchEvent(new Event('load'));
    const width=image.naturalWidth; controller.abort(); image.dispatchEvent(new Event('error'));
    const result={width,imageGone:!state.host.querySelector('img'),loading:session.getState().loading,error:session.getState().error,urls:state.active.size}; session.destroy();return result;
  }, converterUrl);
  expect(result.width).toBeGreaterThan(100); expect(result).toMatchObject({imageGone:true,loading:false,error:null,urls:0}); expect(errors).toEqual([]);
});

test('stops real spherical video playback and retires player events on replacement', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page);
  await page.evaluate(async () => {
    const state=(window as any).panoramaLife;
    await state.session.load(new URL('samples/panorama/nasa-black-hole-360.webm',location.href).href, {
      descriptor:{name:'video.360v',extension:'360v',contentType:'video/webm'}, route:{family:'panorama-video',sourceFormat:'360v'}
    });
    state.video=state.host.querySelector('video'); await state.video.play();
  });
  await expect.poll(() => page.evaluate(() => (window as any).panoramaLife.video.currentTime)).toBeGreaterThan(0);
  const result=await page.evaluate(async () => {
    const {session,video,source,host,active}=(window as any).panoramaLife;
    await session.load(source,{descriptor:{name:'photo.pano',extension:'pano',contentType:'image/png'}});
    video.dispatchEvent(new Event('timeupdate')); video.dispatchEvent(new Event('error'));
    const before=session.getState(); session.destroy();return{stopped:video.paused&&!video.hasAttribute('src'),removed:!host.querySelector('video'),title:before.title,duration:before.duration??null,error:before.error,urls:active.size};
  });
  expect(result).toEqual({stopped:true,removed:true,title:'photo.pano',duration:null,error:null,urls:0});expect(errors).toEqual([]);
});

test('demo replaces an uploaded panorama with a flat image and releases its GL context', async ({ page }) => {
  const errors: string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const bytes=Buffer.from(createPanoramaBitmap(512));await page.goto('./?view=preview');
  await page.locator('.wb-upload input[type=file]').setInputFiles({name:'horizon.pano',mimeType:'image/bmp',buffer:bytes});
  const canvas=page.locator('canvas.panoramav-canvas');await expect(canvas).toBeVisible();
  const retained=await canvas.elementHandle();
  await page.locator('.wb-upload input[type=file]').setInputFiles({name:'flat.bmp',mimeType:'image/bmp',buffer:bytes});
  await expect(page.locator('img.pptxv-native-image')).toBeVisible();await expect(canvas).toHaveCount(0);
  expect(await retained!.evaluate(node=>(node as HTMLCanvasElement).getContext('webgl2')!.isContextLost())).toBe(true);
  expect(errors).toEqual([]);
});
