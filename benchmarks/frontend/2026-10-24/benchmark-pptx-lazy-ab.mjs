// Reproducible browser benchmarks. See docs/performance-comparison.zh-CN.md.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const repo = process.cwd();
const require = createRequire(path.join(repo, 'package.json'));
const { chromium } = require('playwright');
const { build } = require('esbuild');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const iterations = Number(option('--iterations', '7'));
const cpuRate = Number(option('--cpu-rate', '1'));
const familyFilter = option('--family', 'all');
const sampleFilter = option('--sample', 'all');
const engineFilter = option('--engine', 'all');
const profiling = args.includes('--profile');
const reviewContent = args.includes('--review-content');
const work = path.join(repo, 'tmp/performance-sota');
const out = path.resolve(repo, option('--output', 'tmp/performance-sota/results'));
const deps = path.join(work, 'node_modules');
fs.mkdirSync(out, { recursive: true });
const vue = path.join(repo, 'node_modules/vue/dist/vue.runtime.esm-bundler.js');
await build({
  stdin: {
    contents: `import Pptx from ${JSON.stringify(path.join(deps, '@vue-office/pptx/lib/v3/vue-office-pptx.mjs'))};
      import {createApp,h,shallowRef,nextTick} from 'vue';
      export async function createViewer(host) {
        const source=shallowRef(); let current;
        const app=createApp({setup(){return()=>h(Pptx,{src:source.value,options:{width:1280,height:800},
          onRendered:model=>current.resolve(model),onError:error=>current.reject(error)})}});
        app.mount(host); await nextTick();
        return {preview(bytes){return new Promise((resolve,reject)=>{current={resolve,reject};source.value=bytes})},destroy(){app.unmount()}};
      }`,
    resolveDir: repo, sourcefile: 'vue-office-benchmark.js'
  },
  bundle: true, format: 'esm', platform: 'browser', minify: true,
  alias: { vue, 'vue-demi': vue },
  define: { 'process.env.NODE_ENV': '"production"', __VUE_OPTIONS_API__: 'true', __VUE_PROD_DEVTOOLS__: 'false' },
  outfile: path.join(out, 'vue-office.js'), logLevel: 'silent'
});
await build({
  entryPoints: [path.join(deps, '@photo-sphere-viewer/core/index.module.js')],
  bundle: true, format: 'esm', platform: 'browser', minify: true,
  outfile: path.join(out, 'photo-sphere-viewer.js'), logLevel: 'silent'
});
await build({
  entryPoints: [path.join(deps, 'pptx-preview/dist/pptx-preview.es.js')],
  bundle: true, format: 'esm', platform: 'browser', minify: true,
  outfile: path.join(out, 'pptx-preview.js'), logLevel: 'silent'
});
async function bounded(promise) {
  let timeout;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Benchmark operation exceeded 30 seconds')), 30000);
    })]);
  } finally { clearTimeout(timeout); }
}

const sample = (name, relative, family) => ({ name, path: relative, family });
const samples = [
  ...['vue-office-test.pptx', 'filens-field-notes.pptx', 'rich-pptx-shapes.pptx', 'rich-pptx-pictures.pptx', 'sample-deck.pptx']
    .map(name => sample(name, `apps/demo/public/samples/${name}`, 'pptx')),
  ...['SampleShow.pptx', 'pie-chart.pptx', '2411-Performance_Up.pptx']
    .map(name => sample(`poi-${name}`, `tmp/performance-sota/samples/${name}`, 'pptx')),
  ...['a.numbers', 'a.pages', 'filens-weekend.key'].map(name => sample(name, `apps/demo/public/samples/${name}`, 'iwork')),
  ...['pentax-k-r.dng', 'nikon-iss.nef', 'canon-40d-sraw.cr2', 'canon-r6.cr3', 'pentax-k-r.pef', 'olympus-stylus.orf']
    .map(name => sample(name, `apps/demo/public/samples/raw/${name}`, 'raw')),
  ...['insta360-oners-tallinn.jpg', 'osmo-360-leipzig.jpg']
    .map(name => sample(name, `apps/demo/public/samples/panorama/${name}`, 'panorama'))
];
const matrix = [];
for (const s of samples) {
  if (s.family === 'pptx') {
    matrix.push({ family: 'pptx-view', sample: s.name, engines: ['filens', 'filens-baseline'] });
    matrix.push({ family: 'pptx-model', sample: s.name, engines: ['filens', 'filens-baseline'] });
  } else if (s.family === 'iwork') {
    matrix.push({ family: 'iwork-view', sample: s.name, engines: ['filens'] });
    if (s.name.endsWith('.numbers')) matrix.push({ family: 'numbers-model', sample: s.name, engines: ['filens', 'sheetjs'] });
  } else if (s.family === 'raw') {
    matrix.push({ family: 'raw-view', sample: s.name, engines: ['filens', 'libraw-thumbnail', 'libraw-half'] });
  } else matrix.push({ family: 'panorama-view', sample: s.name, engines: ['filens', 'photo-sphere-viewer'] });
}
const selected = matrix.filter(task => (familyFilter === 'all' || task.family === familyFilter)
  && (sampleFilter === 'all' || task.sample === sampleFilter))
  .map(task => ({ ...task, engines: task.engines.filter(engine => engineFilter === 'all' || engine === engineFilter) }))
  .filter(task => task.engines.length);
const imports = Object.fromEntries(['core', 'xlsx', 'iwork', 'panorama', 'converter-client']
  .map(name => [`@filens/${name}`, `/repo/packages/${name}/dist/index.js`]));
const html = `<!doctype html><html><head><meta charset="utf-8">
  <script type="importmap">${JSON.stringify({ imports })}</script>
  ${['core', 'iwork', 'panorama'].map(name => `<link rel="stylesheet" href="/repo/packages/${name}/dist/index.css">`).join('')}
  <link rel="stylesheet" href="/deps/@photo-sphere-viewer/core/index.css">
  <style>html,body{margin:0;width:1280px;height:800px}#host{width:1280px;height:800px;overflow:auto}img.raw{max-width:100%;max-height:100%}</style>
  </head><body><div id="host"></div></body></html>`;
const roots = { '/repo/': repo, '/deps/': deps, '/bench/': out };
const server = http.createServer((req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cache-Control', 'no-store');
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
  let file;
  if (pathname.startsWith('/sample/')) {
    const s = samples.find(item => item.name === pathname.slice('/sample/'.length));
    if (s) file = path.join(repo, s.path);
  } else {
    for (const [prefix, root] of Object.entries(roots)) if (pathname.startsWith(prefix)) {
      const resolved = path.resolve(root, pathname.slice(prefix.length));
      if (resolved.startsWith(root + path.sep)) file = resolved;
    }
  }
  try {
    const ext = path.extname(file ?? '');
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.jpg': 'image/jpeg' })[ext] ?? 'application/octet-stream');
    res.end(fs.readFileSync(file));
  } catch { res.statusCode = 404; res.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hashFile = relative => ({ path: relative, sha256: sha256(fs.readFileSync(path.join(repo, relative))) });
const git = require('node:child_process').execFileSync;
const result = {
  date: new Date().toISOString(), cpu: os.cpus()[0].model, platform: `${os.platform()} ${os.release()} ${os.arch()}`,
  totalMemory: os.totalmem(), browser: browser.version(), iterations, cpuRate, profiling, viewport: { width: 1280, height: 800 },
  gitHead: git('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  versions: { 'pptxtojson': '2.2.0', 'pptx-preview': '1.0.7', '@vue-office/pptx': '1.0.1', 'libraw-wasm': '1.6.0', '@photo-sphere-viewer/core': '5.15.1', sheetjs: '0.20.3' },
  method: 'Fresh browser context per run; libraries, workers, WASM and input bytes ready before timer; local File/bytes to model or first preview plus image decoding, document.fonts.ready, two rAFs. Browser process shared; no claim of cold download timings. Deterministically rotated engine order. PPTX: filens mounts visible pages; pptx-preview single-slide mode; vue-office default full DOM. Parser outputs and RAW output quality are recorded separately; this is not a fidelity score. JS heap excludes workers, WASM and GPU. Panorama uses already-stitched JPEGs, not vendor-original stitching.',
  artifacts: ['scripts/benchmark-frontends.mjs', ...['core', 'iwork', 'panorama', 'converter-client', 'xlsx'].map(name => `packages/${name}/dist/index.js`),
    'wasm/converter-core/dist/converter-core.wasm', 'wasm/converter-image/dist/converter-image.wasm',
    'tmp/performance-sota/package-lock.json', 'tmp/performance-sota/xlsx-0.20.3.full.min.js'].map(hashFile),
  samples: samples.map(s => ({ ...s, bytes: fs.statSync(path.join(repo, s.path)).size, sha256: sha256(fs.readFileSync(path.join(repo, s.path))) })),
  runs: []
};
const save = () => fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2) + '\n');
try {
  const info = await browser.newPage();
  await info.goto(base);
  result.gpu = await info.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null, vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : null, devicePixelRatio };
  });
  await info.close();
  for (const task of selected) for (let iteration = 0; iteration < iterations; iteration++) {
    const offset = iteration % task.engines.length;
    const order = [...task.engines.slice(offset), ...task.engines.slice(0, offset)];
    for (const engine of order) {
      const context = await browser.newContext({ viewport: result.viewport, deviceScaleFactor: 1 });
      await context.route('**/*', route => {
        const url = route.request().url();
        return url.startsWith(base) || url.startsWith('blob:') || url.startsWith('data:') ? route.continue() : route.abort();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const run = { family: task.family, sample: task.sample, engine, iteration, errors };
      try {
        const cdp = await context.newCDPSession(page);
        if (cpuRate !== 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
        await page.goto(base);
        run.setupMs = await bounded(page.evaluate(async ({ task, engine }) => {
          const baseline = engine === 'filens-baseline';
          if (baseline) engine = 'filens';
          const bytes = await (await fetch(`/sample/${task.sample}`)).arrayBuffer();
          window.inputBytes = bytes;
          window.inputFile = new File([bytes], task.sample);
          window.host = document.querySelector('#host');
          window.task = task;
          const start = performance.now();
          if (engine === 'filens') {
            if (task.family.startsWith('pptx')) {
              window.lib = await import(baseline ? '/repo/tmp/performance-sota/oct24-lazy-baseline/core-dist/index.js' : '@filens/core');
              if (task.family === 'pptx-view') window.viewer = window.lib.init(window.host, { fit: 'contain', virtual: true });
            } else if (task.family.includes('iwork') || task.family === 'numbers-model') {
              window.lib = await import('@filens/iwork');
              if (task.family === 'iwork-view') {
                window.viewer = window.lib.createIworkViewer(window.host);
                // Start the real parser worker before timing; no document is parsed here.
                await new Promise(resolve => setTimeout(resolve, 100));
              }
            } else if (task.family === 'raw-view') {
              window.lib = await import('@filens/converter-client');
              const [wasm, imageWasm] = await Promise.all(['core', 'image'].map(async name => WebAssembly.compile(await (await fetch(`/repo/wasm/converter-${name}/dist/converter-${name}.wasm`)).arrayBuffer())));
              window.converter = window.lib.createWasmConverterClient({ wasm, imageWasm });
            } else {
              window.lib = await import('@filens/panorama');
            }
          } else if (engine === 'vue-office') {
            window.lib = await import('/bench/vue-office.js');
            window.viewer = await window.lib.createViewer(window.host);
          } else if (engine === 'pptx-preview') {
            window.lib = await import('/bench/pptx-preview.js');
            window.viewer = window.lib.init(window.host, { width: 1280, height: 800, mode: 'slide' });
          } else if (engine === 'pptxtojson') window.lib = await import('/deps/pptxtojson/dist/index.js');
          else if (engine === 'sheetjs') {
            await new Promise((resolve, reject) => { const el = document.createElement('script'); el.src = '/repo/tmp/performance-sota/xlsx-0.20.3.full.min.js'; el.onload = resolve; el.onerror = reject; document.head.append(el); });
          } else if (engine.startsWith('libraw')) {
            const { default: LibRaw } = await import('/deps/libraw-wasm/dist/index.js');
            window.raw = new LibRaw();
            await window.raw.metadata();
          } else {
            window.lib = await import('/bench/photo-sphere-viewer.js');
          }
          window.longTasks = [];
          window.observer = new PerformanceObserver(list => window.longTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration }))));
          window.observer.observe({ type: 'longtask', buffered: false });
          // Count actual GL draw calls, including viewers that keep a rAF loop while idle.
          window.glDraws = 0;
          for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) for (const key of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
            const original = proto[key];
            if (original) proto[key] = function (...args) { window.glDraws++; return original.apply(this, args); };
          }
          return performance.now() - start;
        }, { task, engine }));
        await cdp.send('HeapProfiler.collectGarbage');
        const before = await cdp.send('Runtime.getHeapUsage');
        if (profiling) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
        const measured = await bounded(page.evaluate(async engine => {
          if (engine === 'filens-baseline') engine = 'filens';
          const { family, sample } = window.task;
          const stats = {};
          let node;
          const t0 = performance.now();
          window.measureStart = t0;
          if (family === 'pptx-model') {
            const model = engine === 'filens' ? await window.lib.loadPptx(window.inputFile)
              : engine === 'pptx-preview' ? await window.viewer.load(window.inputBytes)
              : await window.lib.parse(window.inputBytes, { imageMode: 'blob', videoMode: 'blob', audioMode: 'blob' });
            window.model = model;
            stats.slides = model.slides.length;
            stats.objects = model.slides.reduce((n, slide) => n + (slide.items ?? slide.elements ?? []).length, 0);
            stats.unsupported = engine === 'filens' ? model.slides.flatMap(s => s.items).filter(item => item.kind === 'unsupported').length : null;
            stats.warnings = model.warnings ?? [];
          } else if (family === 'pptx-view') {
            const model = await window.viewer.preview(engine === 'filens' ? window.inputFile : window.inputBytes);
            node = document.querySelector(engine === 'filens' ? '.pptxv-slide-stage' : '.pptx-preview-slide-wrapper');
            if (!node) throw new Error('No first slide');
            stats.mountedSlides = document.querySelectorAll(engine === 'filens' ? '.pptxv-slide-stage' : '.pptx-preview-slide-wrapper').length;
            const state = engine === 'filens' ? window.viewer.getState() : null;
            stats.slides = state?.slideCount ?? model?.slides?.length;
            stats.warnings = state?.warnings ?? [];
            stats.unsupportedFrames = document.querySelectorAll('.pptxv-unsupported').length;
          } else if (family === 'numbers-model') {
            if (engine === 'filens') {
              const model = await window.lib.loadIwork(window.inputFile);
              window.model = model;
              stats.sheets = model.sheets.length;
              stats.tables = model.sheets.reduce((n, sheet) => n + sheet.tables.length, 0);
              const cells = model.sheets.flatMap(s => s.tables).flatMap(t => t.item.cells);
              stats.nonemptyCells = cells.filter(cell => cell.textFrame.paragraphs.some(p => p.runs.some(r => r.text?.trim()))).length;
              stats.warnings = model.warnings;
            } else {
              const model = window.XLSX.read(window.inputBytes, { type: 'array' });
              window.model = model;
              stats.sheets = model.SheetNames.length;
              stats.nonemptyCells = Object.values(model.Sheets).reduce((sum, sheet) => sum + Object.entries(sheet).filter(([key, value]) => !key.startsWith('!') && value?.v !== undefined && String(value.v).trim()).length, 0);
            }
          } else if (family === 'iwork-view') {
            await window.viewer.preview(window.inputFile);
            const state = window.viewer.getState();
            if (state.error) throw new Error(state.error);
            node = document.querySelector('.iworkv-page-shell, .iworkv-numbers-tables');
            if (!node) throw new Error('No iWork canvas');
            stats.pages = state.pageCount;
            stats.sheets = state.sheetCount;
            stats.warnings = state.warnings;
          } else if (family === 'raw-view') {
            if (engine === 'filens') {
              const converted = await window.converter.convert({ source: window.inputFile, sourceFormat: sample.split('.').pop(), targetFormat: 'jpg', name: sample }, {});
              stats.processingMs = performance.now() - t0;
              stats.warnings = converted.warnings;
              node = new Image();
              node.src = URL.createObjectURL(new Blob([converted.source], { type: 'image/jpeg' }));
              node.className = 'raw'; window.host.append(node);
              await node.decode();
              stats.width = node.naturalWidth; stats.height = node.naturalHeight;
              stats.outputBytes = converted.source.byteLength;
              window.previewBytes = converted.source;
            } else {
              await window.raw.open(new Uint8Array(window.inputBytes), { halfSize: true });
              const data = engine === 'libraw-thumbnail' ? await window.raw.thumbnailData() : await window.raw.imageData();
              if (!data?.data?.length) throw new Error('No RAW preview returned');
              stats.processingMs = performance.now() - t0;
              stats.width = data.width; stats.height = data.height; stats.outputBytes = data.data.byteLength;
              stats.outputFormat = data.format ?? 'rgb';
              if (data.format === 'jpeg') window.previewBytes = data.data;
              if (data.format === 'jpeg') {
                node = new Image(); node.src = URL.createObjectURL(new Blob([data.data], { type: 'image/jpeg' }));
                node.className = 'raw'; window.host.append(node); await node.decode();
                stats.width = node.naturalWidth; stats.height = node.naturalHeight;
              } else {
                const canvas = document.createElement('canvas'); canvas.width = data.width; canvas.height = data.height;
                canvas.style.cssText = 'max-width:100%;max-height:100%';
                const image = new ImageData(data.width, data.height);
                for (let i = 0; i < data.width * data.height; i++) {
                  image.data[i * 4] = data.data[i * 3]; image.data[i * 4 + 1] = data.data[i * 3 + 1]; image.data[i * 4 + 2] = data.data[i * 3 + 2]; image.data[i * 4 + 3] = 255;
                }
                canvas.getContext('2d').putImageData(image, 0, 0); window.host.append(canvas); node = canvas;
              }
            }
          } else {
            const url = URL.createObjectURL(new Blob([window.inputBytes], { type: 'image/jpeg' }));
            // Include renderer construction for both APIs: filens creates its
            // WebGL renderer in load(), whereas PSV creates it in Viewer().
            if (engine === 'filens') {
              window.viewer = new window.lib.PanoramaPreviewSession(window.host);
              await window.viewer.load(url, { descriptor: { source: url, name: sample, extension: 'pano', contentType: 'image/jpeg' }, route: { family: 'panorama', sourceFormat: 'pano' } });
            } else {
              window.viewer = new window.lib.Viewer({ container: window.host, navbar: false, mousewheel: false, keyboard: false, size: { width: '1280px', height: '800px' } });
              await window.viewer.setPanorama(url, { transition: false });
            }
            node = window.host.querySelector('canvas');
            if (!node) throw new Error('No panorama canvas');
            stats.width = node.width; stats.height = node.height;
            stats.state = engine === 'filens' ? window.viewer.getState() : null;
          }
          stats.operationMs = performance.now() - t0;
          if (node) {
            await Promise.all([...node.querySelectorAll('img')].map(img => img.decode()));
            await document.fonts.ready;
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          }
          stats.readyMs = performance.now() - t0;
          window.measureEnd = performance.now();
          stats.domElements = window.host.querySelectorAll('*').length;
          stats.previewText = node?.innerText?.slice(0, 150);
          if (window.previewBytes) {
            const digest = await crypto.subtle.digest('SHA-256', window.previewBytes);
            stats.previewSha256 = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
          }
          if (family === 'panorama-view') {
            // Settle initial loading before measuring two seconds of unchanged view.
            await new Promise(resolve => setTimeout(resolve, 300));
            const draws = window.glDraws, idleStart = performance.now();
            await new Promise(resolve => setTimeout(resolve, 2000));
            stats.idleMs = performance.now() - idleStart;
            stats.idleGlDrawCalls = window.glDraws - draws;
          }
          await new Promise(resolve => setTimeout(resolve, 0));
          stats.mainThreadLongTasks = window.longTasks.filter(e => e.start >= window.measureStart && e.start <= window.measureEnd);
          return stats;
        }, engine));
        Object.assign(run, measured);
        if (profiling) {
          const { profile } = await cdp.send('Profiler.stop');
          fs.writeFileSync(path.join(out, `${task.family}-${engine}-${task.sample}-${iteration}.cpuprofile`), JSON.stringify(profile));
        }
        await cdp.send('HeapProfiler.collectGarbage');
        const after = await cdp.send('Runtime.getHeapUsage');
        run.mainThreadRetainedJsHeapDeltaMiB = (after.usedSize - before.usedSize) / 1024 ** 2;
        if (iteration === 0 && !task.family.endsWith('model')) await page.screenshot({ path: path.join(out, `${task.family}-${engine}-${task.sample}.png`) });
        if (reviewContent && iteration === 0 && task.family === 'numbers-model') {
          const content = await page.evaluate(engine => engine.startsWith('filens')
            ? window.model.sheets.flatMap(sheet => sheet.tables.map(table => ({ sheet: sheet.name, table: table.item.name,
                cells: table.item.cells.map(cell => ({ row: cell.row, column: cell.column,
                  text: cell.textFrame.paragraphs.map(p => p.runs.map(r => r.text).join('')).join('\n') })) })))
            : window.model.SheetNames.map(name => ({ table: name, cells: Object.entries(window.model.Sheets[name])
                .filter(([key, cell]) => !key.startsWith('!') && cell.v !== undefined).map(([address, cell]) => ({
                  ...window.XLSX.utils.decode_cell(address), address, value: cell.v, type: cell.t, text: cell.w })) })), engine);
          fs.writeFileSync(path.join(out, `numbers-content-${engine}.json`), JSON.stringify(content, null, 2) + '\n');
          run.contentSha256 = sha256(JSON.stringify(content));
        }
        if (reviewContent && iteration === 0 && task.family === 'iwork-view' && engine === 'filens') {
          run.interactions = await bounded(page.evaluate(async () => {
            const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const state = window.viewer.getState();
            // Exercise the archive's public lazy values after a real worker
            // transfer, then check every lazily loaded Numbers sheet.
            const direct = await window.lib.loadIwork(window.inputFile);
            const archiveValues = doc => JSON.stringify(Object.fromEntries(Object.entries(doc.archive.records)
              .map(([id, record]) => [id, record.value])));
            const archiveMatches = archiveValues(state.document) === archiveValues(direct);
            if (state.kind === 'numbers') {
              let sheetsMatch = true;
              for (let index = 0; index < state.sheetCount; index++) {
                window.viewer.goToSheet(index);
                const deadline = performance.now() + 10000;
                while (state.document.sheets[index].loaded === false && performance.now() < deadline) await settle();
                const current = window.viewer.getState();
                const sheet = current.document.sheets[index];
                sheetsMatch &&= !current.error && sheet.loaded !== false
                  && JSON.stringify(sheet) === JSON.stringify(direct.sheets[index]);
                sheetsMatch &&= window.host.querySelectorAll('.xlsxv-sheet-tab').length === state.sheetCount
                  && !!window.host.querySelector('.iworkv-numbers-tables .xlsxv-table');
              }
              return { archiveMatches, sheetsMatch, sheets: state.sheetCount,
                tables: state.document.sheets.reduce((n, sheet) => n + sheet.tables.length, 0) };
            }
            const last = state.pageCount - 1;
            window.viewer.goToPage(last); await settle();
            const navigated = window.viewer.getState().currentPage === last
              && !!window.host.querySelector(`.iworkv-page-shell[data-page-index="${last}"] .pptxv-slide`);
            window.viewer.setScale(0.5); window.viewer.goToPage(0); await settle();
            const zoomed = window.viewer.getState().scale === 0.5
              && !!window.host.querySelector('.iworkv-page-shell[data-page-index="0"] .pptxv-slide');
            return { archiveMatches, navigated, zoomed };
          }));
          if (Object.values(run.interactions).some(value => value === false)) throw new Error('iWork archive/navigation/content check failed');
        }
        if (reviewContent && iteration === 0 && task.family === 'pptx-view' && engine === 'filens') {
          run.interactions = await page.evaluate(async () => {
            const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const visiblePagesMounted = () => {
              const viewport = window.host.getBoundingClientRect();
              return [...window.host.querySelectorAll('.pptxv-slide-shell')].every(shell => {
                const rect = shell.getBoundingClientRect();
                return rect.bottom <= viewport.top || rect.top >= viewport.bottom || !!shell.querySelector('.pptxv-slide-stage');
              });
            };
            const initialVisible = visiblePagesMounted();
            const last = window.viewer.getState().slideCount - 1;
            window.viewer.goToSlide(last); await settle();
            const jumped = !!window.host.querySelector(`.pptxv-slide-shell[data-slide-index="${last}"] .pptxv-slide-stage`);
            window.viewer.setScale(0.4); window.viewer.goToSlide(0); await settle();
            const scroll = window.host.querySelector('.pptxv-scroll-area');
            scroll.scrollTo({ top: 0, behavior: 'instant' }); scroll.dispatchEvent(new Event('scroll')); await settle();
            const zoomedVisible = visiblePagesMounted();
            scroll.scrollTo({ top: scroll.scrollHeight, behavior: 'instant' }); scroll.dispatchEvent(new Event('scroll')); await settle();
            const scrolledVisible = visiblePagesMounted();
            return { initialVisible, jumped, zoomedVisible, scrolledVisible };
          });
          if (Object.values(run.interactions).some(value => !value)) throw new Error('PPTX visible-page/navigation check failed');
        }
        if (iteration === 0 && task.family === 'raw-view' && engine !== 'libraw-half') {
          run.decodedPixelSha256 = await page.evaluate(async () => {
            const image = window.host.querySelector('img, canvas');
            const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth ?? image.width; canvas.height = image.naturalHeight ?? image.height;
            const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
            const digest = await crypto.subtle.digest('SHA-256', ctx.getImageData(0, 0, canvas.width, canvas.height).data);
            return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
          });
        }
        if (iteration === 0 && task.family === 'panorama-view' && engine === 'filens') {
          await page.evaluate(() => { window.initialPanoramaPixels = window.host.querySelector('canvas').toDataURL(); });
          await page.mouse.move(200, 200); await page.mouse.down(); await page.mouse.move(400, 260, { steps: 4 }); await page.mouse.up();
          run.interactions = await page.evaluate(async () => {
            const canvas = window.host.querySelector('canvas');
            const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            await settle(); const dragged = canvas.toDataURL();
            window.viewer.setScale(1.5); await settle(); const zoomed = canvas.toDataURL();
            await new Promise(resolve => setTimeout(resolve, 200));
            return { dragChangesPixels: window.initialPanoramaPixels !== dragged, zoomChangesPixels: dragged !== zoomed, idleRetainsPixels: zoomed === canvas.toDataURL() };
          });
          if (Object.values(run.interactions).some(value => !value)) throw new Error('Panorama interaction or retained-frame check failed');
        }
      } catch (error) { run.failure = String(error); }
      result.runs.push(run); save();
      console.log(JSON.stringify({ family: run.family, sample: run.sample, engine, iteration, readyMs: run.readyMs, width: run.width, height: run.height, failure: run.failure, errors: run.errors }));
      await context.close();
    }
  }
} finally { await browser.close(); server.close(); }
const median = values => {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b), mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};
result.summary = selected.flatMap(task => task.engines.map(engine => {
  const all = result.runs.filter(r => r.family === task.family && r.sample === task.sample && r.engine === engine);
  const ok = all.filter(r => !r.failure && !r.errors.length);
  return { family: task.family, sample: task.sample, engine, successes: ok.length, attempted: all.length,
    medianMs: median(ok.map(r => r.readyMs)), minMs: ok.length ? Math.min(...ok.map(r => r.readyMs)) : null,
    medianProcessingMs: median(ok.map(r => r.processingMs).filter(Number.isFinite)),
    maxMs: ok.length ? Math.max(...ok.map(r => r.readyMs)) : null,
    medianMainThreadRetainedJsHeapDeltaMiB: median(ok.map(r => r.mainThreadRetainedJsHeapDeltaMiB)),
    medianLongestMainThreadTaskMs: median(ok.map(r => Math.max(0, ...r.mainThreadLongTasks.map(t => t.duration)))),
    medianIdleGlDrawCalls: median(ok.map(r => r.idleGlDrawCalls).filter(Number.isFinite)),
    output: ok.length ? { width: ok[0].width, height: ok[0].height, slides: ok[0].slides, mountedSlides: ok[0].mountedSlides,
      objects: ok[0].objects, unsupported: ok[0].unsupported, sheets: ok[0].sheets, nonemptyCells: ok[0].nonemptyCells } : null,
    failures: [...new Set(all.map(r => r.failure).filter(Boolean))]
  };
}));
save();
console.log(`Results: ${path.join(out, 'results.json')}`);
