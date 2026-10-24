// Public panorama load() A/B; generated BMP, no peer/SOTA ranking.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createPanoramaBitmap } from '../packages/panorama/test/fixtures/bitmap.mjs';
const root = process.cwd(), args = process.argv.slice(2), option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const iterations = Number(option('--iterations', '7')); assert(Number.isSafeInteger(iterations) && iterations > 0);
const baseline = option('--baseline', 'tmp/continued-review/panorama-lifecycle-baseline/dist/index.js'); assert(!path.isAbsolute(baseline) && !baseline.split(/[\\/]/).includes('..'));
const output = path.resolve(option('--output', 'tmp/continued-review/panorama-lifecycle-final')); fs.mkdirSync(output, { recursive: true });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex'), bytes = createPanoramaBitmap();
const modules = { baseline, current: 'packages/panorama/dist/index.js' }, samples = ['typed','subview','array-buffer','blob'].map(kind => ({ name: `bmp-24MiB-${kind}`, kind }));
const artifacts = [...Object.values(modules), 'packages/core/dist/index.js', 'packages/core/dist/zip.js', 'packages/core/dist/zip-DUJ4pXRK.js', 'scripts/benchmark-panorama-lifecycle.mjs', 'packages/panorama/test/fixtures/bitmap.mjs', 'packages/panorama/src/preview-driver.ts', 'packages/panorama/src/raw-preview-driver.ts', 'packages/panorama/src/load-task.ts'];
const result = { engineering: true, scopedSota: false, date: new Date().toISOString(), iterations, cpu: os.cpus()[0].model,
  method: 'Fresh Chromium/SwiftShader context per invocation, alternating old/current. Imports and generated 4096x2048 24-bit BMP input ready before timer. Timer covers public session construction and complete load(), including WebGL context construction, input Blob snapshot, image decoding, geometry and DOM setup. Ends before scheduled upload/drawing; input/source hashing, full Blob hash, two frames, complete canvas pixels and destroy checks occur afterward. Excludes network/module loading. Generated input, no camera/vendor calibration, peer/SOTA or peak-memory claim.',
  samples, input: { bytes: bytes.length, sha256: hash(bytes), width: 4096, height: 2048 }, artifacts: artifacts.map(file => ({ path: file, sha256: hash(fs.readFileSync(file)) })), runs: [] };
const server = http.createServer((req,res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); res.setHeader('Cache-Control','no-store');
  if (name === '/') { res.setHeader('Content-Type','text/html'); res.end('<!doctype html><script type="importmap">{"imports":{"@filens/core":"/repo/packages/core/dist/index.js"}}</script><style>body{margin:0}.host{width:640px;height:320px}.panoramav-stage{width:640px;height:320px}</style>'); return; }
  const file = path.resolve(root, name.slice(6)); if (!name.startsWith('/repo/') || !file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
  try { res.setHeader('Content-Type','text/javascript'); res.end(fs.readFileSync(file)); } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader'] }); result.browser = browser.version();
try {
  for (const sample of samples) for (let iteration=0; iteration<iterations; iteration++) for (const engine of iteration%2 ? ['baseline','current'] : ['current','baseline']) {
    const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 }), page = await context.newPage();
    const run = { sample: sample.name, engine, iteration, pageErrors: [] }; page.on('pageerror', error => run.pageErrors.push(error.message));
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.evaluate(async ({ module,kind }) => {
        const lib = await import('/repo/' + module), { createPanoramaBitmap } = await import('/repo/packages/panorama/test/fixtures/bitmap.mjs');
        const bytes = createPanoramaBitmap(); let source = bytes;
        if (kind === 'subview') { const storage = new Uint8Array(bytes.length+32).fill(91); storage.set(bytes,16); source = storage.subarray(16,-16); }
        else if (kind === 'array-buffer') source = bytes.buffer; else if (kind === 'blob') source = new Blob([bytes],{type:'image/bmp'});
        const host = document.createElement('div'); host.className='host'; document.body.append(host);
        const created = new Map(), create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = blob => { const url = create(blob); created.set(url,blob); return url; };
        URL.revokeObjectURL = url => { created.delete(url); revoke(url); };
        window.panoramaLifecycle = { lib,source,host,created };
      }, { module: modules[engine], kind: sample.kind });
      Object.assign(run, await page.evaluate(async () => {
        const state = window.panoramaLifecycle, { lib,source,host,created } = state;
        const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
        const started = performance.now(), session = new lib.PanoramaPreviewSession(host);
        state.session = session;
        await session.load(source,{ descriptor: { source,name:'generated.pano',extension:'pano',contentType:'image/bmp' }, route: { family:'panorama',sourceFormat:'pano' } });
        const elapsedMs = performance.now()-started; state.measured = {elapsedMs};
        if (source instanceof ArrayBuffer) new Uint8Array(source).fill(0); else if (ArrayBuffer.isView(source)) new Uint8Array(source.buffer,source.byteOffset,source.byteLength).fill(0);
        const payload = await (await fetch([...created.keys()].at(-1))).arrayBuffer();
        const payloadSha256 = await hash(payload);
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const canvas = host.querySelector('canvas'), gl = canvas.getContext('webgl2'), pixels = new Uint8Array(canvas.width*canvas.height*4);
        gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        const pixelSha256 = await hash(pixels), before = session.getState(), content = { payloadBytes:payload.byteLength,payloadSha256,pixelSha256,canvasWidth:canvas.width,canvasHeight:canvas.height,naturalWidth:before.naturalWidth,naturalHeight:before.naturalHeight };
        state.measured.content = content;
        session.destroy(); return { elapsedMs,content,error:before.error,destroyed:host.childElementCount===0,urlsAfterDestroy:created.size };
      }));
    } catch(error) { Object.assign(run,await page.evaluate(()=>window.panoramaLifecycle?.measured).catch(()=>undefined)); run.failure=String(error); }
    result.runs.push(run); fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(result,null,2)+'\n'); console.log(JSON.stringify(run)); await context.close();
  }
} finally { await browser.close(); server.close(); }
