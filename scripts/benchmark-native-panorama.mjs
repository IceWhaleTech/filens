// Camera-original INSP preview. Generic dual-fisheye timings do not establish
// equivalent vendor-calibrated output; review every seam before interpreting them.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repo, 'package.json'));
const { chromium } = require('playwright');
const { build } = require('esbuild');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const input = option('--input', process.env.INSP_SAMPLE);
if (!input || !fs.statSync(input).isFile()) throw new Error('Provide --input /path/to/camera-original.insp or INSP_SAMPLE.');
const iterations = Number(option('--iterations', '7'));
if (!Number.isInteger(iterations) || iterations < 1) throw new Error('Invalid iteration count.');
const out = path.resolve(repo, option('--output', 'tmp/performance-native-panorama/results'));
const deps = path.join(repo, 'tmp/performance-sota/node_modules');
const engines = ['filens', 'photo-sphere-viewer'].filter(engine => !args.includes('--engine') || engine === option('--engine'));
if (!engines.length) throw new Error('Unknown engine.');
const profiling = args.includes('--profile');
fs.mkdirSync(out, { recursive: true });
await build({
  stdin: { contents: `export {Viewer} from '@photo-sphere-viewer/core'; export {DualFisheyeAdapter} from '@photo-sphere-viewer/dual-fisheye-adapter';`, resolveDir: deps },
  bundle: true, format: 'esm', platform: 'browser', minify: true,
  outfile: path.join(out, 'psv-dual-fisheye.js'), logLevel: 'silent'
});
const panoramaModule = option('--panorama-module', 'packages/panorama/dist/index.js');
if (path.isAbsolute(panoramaModule) || path.normalize(panoramaModule).startsWith('..')) throw new Error('--panorama-module must be inside the repository.');
const imports = Object.fromEntries(['core', 'panorama', 'converter-client'].map(name => [`@filens/${name}`, `/repo/${name === 'panorama' ? panoramaModule : `packages/${name}/dist/index.js`}`]));
const html = `<!doctype html><html><head><meta charset="utf-8"><script type="importmap">${JSON.stringify({ imports })}</script>
  <link rel="stylesheet" href="/repo/packages/panorama/dist/index.css"><link rel="stylesheet" href="/deps/@photo-sphere-viewer/core/index.css">
  <style>html,body{margin:0;width:100%;height:100%;background:#111827}#host{width:100%;height:100%}</style>
  </head><body><div id="host"></div></body></html>`;
const roots = { '/repo/': repo, '/deps/': deps, '/bench/': out };
const server = http.createServer((req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cache-Control', 'no-store');
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); return res.end(html); }
  let file = url.pathname === '/input' ? path.resolve(input) : undefined;
  for (const [prefix, root] of Object.entries(roots)) if (url.pathname.startsWith(prefix)) {
    const candidate = path.resolve(root, decodeURIComponent(url.pathname.slice(prefix.length)));
    if (candidate.startsWith(`${root}${path.sep}`)) file = candidate;
  }
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; return res.end(); }
  const type = file === path.resolve(input) ? 'image/jpeg' : ({ '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' })[path.extname(file)] ?? 'application/octet-stream';
  res.setHeader('Content-Type', type);
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hashFile = file => ({ path: path.relative(repo, file), bytes: fs.statSync(file).size, sha256: sha256(fs.readFileSync(file)) });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const result = {
  date: new Date().toISOString(), cpu: os.cpus()[0].model, platform: `${os.platform()} ${os.release()} ${os.arch()}`,
  browser: browser.version(), gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  iterations, profiling, viewport: { width: 1280, height: 800 },
  versions: Object.fromEntries(['@photo-sphere-viewer/core', '@photo-sphere-viewer/dual-fisheye-adapter'].map(name => [name, JSON.parse(fs.readFileSync(path.join(deps, name, 'package.json'))).version])),
  method: 'Same original INSP bytes. Fresh context for every run, rotated order, shared browser, DPR 1, SwiftShader. Input/File, JS imports and WASM compilation ready before timing. Timer includes renderer construction, file inspection for filens, JPEG decode, texture upload and first preview plus two animation frames. Optional seam work is awaited. Default native paths without manually fitted calibration. Generic dual-fisheye output must pass visual review before any speed ranking. Private originals and screenshots are not published.',
  sample: { name: 'camera-original.insp', bytes: fs.statSync(input).size, sha256: sha256(fs.readFileSync(input)) },
  artifacts: ['scripts/benchmark-native-panorama.mjs', panoramaModule, 'packages/converter-client/dist/index.js', 'packages/core/dist/index.js', 'wasm/converter-core/dist/converter-core.wasm', 'benchmarks/frontend/package-lock.json'].map(file => hashFile(path.join(repo, file))),
  peerArtifacts: ['@photo-sphere-viewer/core/index.module.js', '@photo-sphere-viewer/dual-fisheye-adapter/index.module.js', 'three/build/three.module.js'].map(file => hashFile(path.join(deps, file))),
  runs: []
};
const save = () => fs.writeFileSync(path.join(out, 'results.json'), `${JSON.stringify(result, null, 2)}\n`);
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function imageRecord(page, filename) {
  const bytes = await page.screenshot({ path: path.join(out, filename) });
  return { path: filename, sha256: sha256(bytes) };
}
try {
  const page = await browser.newPage();
  await page.goto(base);
  result.gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null, maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE), devicePixelRatio };
  });
  await page.close();
  for (let iteration = 0; iteration < iterations; iteration++) {
    const offset = iteration % engines.length;
    for (const engine of [...engines.slice(offset), ...engines.slice(0, offset)]) {
      const context = await browser.newContext({ viewport: result.viewport, deviceScaleFactor: 1 });
      await context.route('**/*', route => route.request().url().startsWith(base) || /^(blob:|data:)/.test(route.request().url()) ? route.continue() : route.abort());
      const page = await context.newPage();
      const run = { family: 'native-panorama-view', sample: result.sample.name, engine, iteration, errors: [], warnings: [] };
      page.on('pageerror', error => run.errors.push(error.message));
      page.on('console', message => { if (['warning', 'error'].includes(message.type())) run.warnings.push(message.text()); });
      const cdp = await context.newCDPSession(page);
      try {
        await page.goto(base);
        run.setupMs = await page.evaluate(async engine => {
          window.host = document.getElementById('host');
          window.file = new File([await (await fetch('/input')).arrayBuffer()], 'camera-original.insp', { type: 'image/jpeg' });
          const start = performance.now();
          window.metrics = { inspectionMs: 0, seamCalls: 0, pendingSeams: 0, draws: 0, mipmaps: 0, uploads: [] };
          for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
            for (const key of ['drawArrays', 'drawElements']) {
              const original = proto[key];
              proto[key] = function (...args) { window.metrics.draws++; return original.apply(this, args); };
            }
            const originalMipmap = proto.generateMipmap;
            proto.generateMipmap = function (...args) { window.metrics.mipmaps++; return originalMipmap.apply(this, args); };
            for (const key of ['texImage2D', 'texSubImage2D']) {
              const upload = proto[key];
              proto[key] = function (...args) {
                const source = args[args.length - 1];
                const width = source?.naturalWidth ?? source?.width;
                const height = source?.naturalHeight ?? source?.height;
                if (width > 1 && height > 1) window.metrics.uploads.push({ width, height });
                return upload.apply(this, args);
              };
            }
          }
          if (engine === 'filens') {
            window.lib = await import('@filens/panorama');
            const wasm = await WebAssembly.compile(await (await fetch('/repo/wasm/converter-core/dist/converter-core.wasm')).arrayBuffer());
            window.processor = window.lib.createWasmPanoramaProcessor({ wasm });
            const open = window.processor.open.bind(window.processor);
            window.processor.open = async (...args) => {
              const start = performance.now();
              try { return await open(...args); } finally { window.metrics.inspectionMs += performance.now() - start; }
            };
            const compute = window.processor.computeSeam.bind(window.processor);
            window.processor.computeSeam = async (...args) => {
              window.metrics.seamCalls++; window.metrics.pendingSeams++;
              try { return await compute(...args); } finally { window.metrics.pendingSeams--; }
            };
          } else window.lib = await import('/bench/psv-dual-fisheye.js');
          return performance.now() - start;
        }, engine);
        if (profiling) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
        Object.assign(run, await page.evaluate(async engine => {
          const start = performance.now();
          if (engine === 'filens') {
            window.viewer = new window.lib.PanoramaPreviewSession(window.host, {}, window.processor);
            await window.viewer.load(window.file, { descriptor: { source: window.file, name: window.file.name, extension: 'insp', contentType: 'image/jpeg' }, route: { family: 'panorama', sourceFormat: 'insp' } });
            if (window.viewer.getState().error) throw new Error(window.viewer.getState().error);
            // The native analyzer may yield while the minimum-cost seams run in WASM.
            while (window.metrics.pendingSeams) await new Promise(resolve => setTimeout(resolve, 0));
          } else {
            window.url = URL.createObjectURL(window.file);
            window.viewer = new window.lib.Viewer({
              container: window.host, adapter: window.lib.DualFisheyeAdapter, navbar: false,
              mousewheel: true, keyboard: false, minFov: 30, maxFov: 100, defaultZoomLvl: 100 * (100 - 75) / 70,
              rendererParameters: { preserveDrawingBuffer: true }
            });
            await window.viewer.setPanorama(window.url, { transition: false });
          }
          const operationMs = performance.now() - start;
          await document.fonts.ready;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const readyMs = performance.now() - start;
          const canvas = window.host.querySelector('canvas');
          if (!canvas || !window.metrics.draws) throw new Error('No rendered panorama.');
          const manifest = window.processor?.getManifest();
          return { operationMs, readyMs, width: canvas.width, height: canvas.height, metrics: structuredClone(window.metrics),
            cameraFov: engine === 'filens' ? window.viewer.camera?.fov : window.viewer.renderer?.camera?.fov,
            state: engine === 'filens' ? window.viewer.getState() : null,
            source: manifest ? { cameraModel: manifest.cameraModel, width: manifest.width, height: manifest.height, projection: manifest.projection.kind,
              calibrationSource: manifest.calibrationSource, lenses: manifest.lenses.length, distortionModels: manifest.lenses.map(lens => lens.distortionModel), distortionCoefficientCounts: manifest.lenses.map(lens => lens.distortionCoeffs?.length ?? lens.distortion?.length ?? 0) } : null
          };
        }, engine));
        if (profiling) {
          const { profile } = await cdp.send('Profiler.stop');
          fs.writeFileSync(path.join(out, `${engine}-${iteration}.cpuprofile`), JSON.stringify(profile));
        }
        run.preview = await imageRecord(page, `${engine}-${iteration}-first.png`);
        if (iteration === 0) {
          const draws = await page.evaluate(() => window.metrics.draws);
          await page.waitForTimeout(1000);
          run.idleGlDrawCalls = await page.evaluate(start => window.metrics.draws - start, draws);
          run.views = [];
          for (const [yaw, pitch] of [[0, 0], [90, 0], [180, 0], [-90, 0], [90, 50], [90, -50], [-90, 50], [-90, -50]]) {
            if (engine === 'filens') {
              await page.evaluate(() => window.viewer.fit());
              await page.mouse.move(640, 400);
              await page.mouse.down();
              await page.mouse.move(640 - yaw * 10, 400 + pitch * 10);
              await page.mouse.up();
            } else await page.evaluate(({ yaw, pitch }) => window.viewer.rotate({ yaw: yaw * Math.PI / 180, pitch: pitch * Math.PI / 180 }), { yaw, pitch });
            await settle(page);
            run.views.push({ yaw, pitch, ...await imageRecord(page, `${engine}-yaw${yaw}-pitch${pitch}.png`) });
          }
          await page.evaluate(engine => engine === 'filens' ? window.viewer.setScale(1.5) : window.viewer.zoom(70), engine);
          await settle(page);
          run.zoom = await imageRecord(page, `${engine}-zoom.png`);
          await page.setViewportSize({ width: 768, height: 900 });
          await page.waitForFunction(() => {
            const canvas = window.host.querySelector('canvas');
            return canvas?.width === 768 && canvas?.height === 900;
          });
          await settle(page);
          run.resize = await page.evaluate(() => {
            const canvas = window.host.querySelector('canvas');
            return { width: canvas.width, height: canvas.height };
          });
        }
      } catch (error) { run.failure = String(error); }
      result.runs.push(run);
      save();
      console.log(JSON.stringify({ engine, iteration, readyMs: run.readyMs, inspectionMs: run.metrics?.inspectionMs, source: run.source, failure: run.failure }));
      await context.close();
    }
  }
} finally { await browser.close(); server.close(); }
const median = values => { const sorted = values.toSorted((a, b) => a - b); return sorted.length ? sorted.length % 2 ? sorted[Math.floor(sorted.length / 2)] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2 : null; };
result.summary = engines.map(engine => {
  const runs = result.runs.filter(run => run.engine === engine);
  const ok = runs.filter(run => !run.failure && !run.errors.length);
  return { engine, attempted: runs.length, successes: ok.length, medianReadyMs: median(ok.map(run => run.readyMs)),
    medianOperationMs: median(ok.map(run => run.operationMs)), medianInspectionMs: median(ok.map(run => run.metrics.inspectionMs)),
    nativeX5Calibration: engine === 'filens', outputEquivalence: 'Requires explicit visual review; no automatic SOTA label.',
    failures: runs.filter(run => run.failure).map(run => run.failure) };
});
save();
console.log(JSON.stringify(result.summary, null, 2));
