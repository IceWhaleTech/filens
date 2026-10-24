// Browser sensor-preview comparison. No embedded JPEG extraction is timed here.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repo, 'package.json'));
const { chromium } = require('playwright');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const iterations = Number(option('--iterations', '7'));
const filter = option('--sample', 'all');
const engineFilter = option('--engine', 'all');
const profiled = args.includes('--profile');
const imageWasmPath = option('--image-wasm', 'wasm/converter-image/dist/converter-image.wasm');
const out = path.resolve(repo, option('--output', 'tmp/performance-raw-preview/results'));
const deps = path.join(repo, 'tmp/performance-sota/node_modules');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
fs.mkdirSync(out, { recursive: true });

// Only remove 8-bit display JPEGs. In particular, 12/14/16-bit lossless JPEG
// sensor compression must remain intact. This mirrors the core's JPEG parser.
function jpegBounds(bytes, start) {
  let cursor = start + 2, dimensions;
  while (cursor + 1 < bytes.length) {
    while (bytes[cursor] === 0xff) cursor++;
    const marker = bytes[cursor++];
    if (marker === 0x00 || marker === 0xd8 || marker >= 0xd0 && marker <= 0xd7) continue;
    if (marker === 0xd9) return dimensions && { start, end: cursor, ...dimensions };
    if (cursor + 2 > bytes.length) return;
    const length = bytes.readUInt16BE(cursor);
    if (length < 2 || cursor + length > bytes.length) return;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 8) return;
      const precision = bytes[cursor + 2], height = bytes.readUInt16BE(cursor + 3), width = bytes.readUInt16BE(cursor + 5);
      if (precision !== 8 || !width || !height || ![1, 3, 4].includes(bytes[cursor + 7])) return;
      dimensions = { width, height };
    }
    cursor += length;
    if (marker === 0xda) {
      while (cursor + 1 < bytes.length) {
        cursor = bytes.indexOf(0xff, cursor);
        if (cursor < 0) return;
        const markerStart = cursor;
        while (bytes[cursor] === 0xff) cursor++;
        const next = bytes[cursor];
        if (next === 0x00 || next >= 0xd0 && next <= 0xd7) cursor++;
        else if (next === 0xd9) return dimensions && { start, end: cursor + 1, ...dimensions };
        else { cursor = markerStart; break; }
      }
    }
  }
}
function displayJpegs(bytes) {
  const ranges = [];
  for (let cursor = 0; cursor < bytes.length - 1;) {
    const start = bytes.indexOf(Buffer.from([0xff, 0xd8]), cursor);
    if (start < 0) break;
    const range = jpegBounds(bytes, start);
    if (range) ranges.push(range);
    cursor = start + 2;
  }
  return ranges;
}
const names = ['pentax-k-r.dng', 'nikon-iss.nef', 'canon-40d-sraw.cr2', 'pentax-k-r.pef', 'olympus-stylus.orf', 'canon-r6.cr3'];
const samples = names.filter(name => filter === 'all' || name === filter).map(name => {
  const source = `apps/demo/public/samples/raw/${name}`;
  const original = fs.readFileSync(path.join(repo, source));
  const bytes = Buffer.from(original);
  const removedJpegs = displayJpegs(original);
  for (const { start, end } of removedJpegs) bytes.fill(0, start, end);
  if (displayJpegs(bytes).length) throw new Error(`Display JPEG still present: ${name}`);
  fs.writeFileSync(path.join(out, `no-jpeg-${name}`), bytes);
  return { name, source, sourceSha256: sha256(original), bytes: bytes.length, sha256: sha256(bytes), removedJpegs,
    sensorBenchmarkEligible: name !== 'canon-r6.cr3',
    ...(name === 'canon-r6.cr3' ? { note: 'Exiv2 Canon-R6-pruned.CR3 metadata fixture, not an intact sensor RAW. Retained for diagnostics only; empty/black outputs cannot qualify for sensor-preview ranking.' } : {}),
  };
});
if (!samples.length || !Number.isInteger(iterations) || iterations < 1) throw new Error('Invalid samples/iterations');
const engines = ['filens', 'libraw-half', 'libraw-fast', 'libraw-full'].filter(engine => engineFilter === 'all' || engine === engineFilter);
if (!engines.length) throw new Error('Invalid engine');
const settings = {
  'libraw-half': { halfSize: true, useCameraWb: true },
  // Fast valid RGB preview: no denoising, no automatic brightness histogram,
  // camera WB, native half-size interpolation. No raw mosaic shortcuts.
  'libraw-fast': { halfSize: true, useCameraWb: true, userQual: 0, noAutoBright: true, gamm: [1 / 2.4, 12.92] },
  'libraw-full': { halfSize: false },
};
const html = `<!doctype html><meta charset="utf-8"><script type="importmap">${JSON.stringify({ imports: {
  '@filens/converter-client': '/repo/packages/converter-client/dist/index.js',
} })}</script><style>html,body{margin:0;background:#17191e;color:#eee;font:14px system-ui}#label{height:36px;padding:8px;box-sizing:border-box}canvas{display:block}</style><div id="label"></div><canvas id="preview" width="1280" height="800"></canvas>`;
const roots = { '/repo/': repo, '/deps/': deps, '/out/': out };
const server = http.createServer((req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cache-Control', 'no-store');
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
  for (const [prefix, root] of Object.entries(roots)) if (pathname.startsWith(prefix)) {
    const file = path.resolve(root, pathname.slice(prefix.length));
    if (!file.startsWith(root + path.sep)) break;
    try {
      res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.wasm': 'application/wasm' })[path.extname(file)] ?? 'application/octet-stream');
      res.end(fs.readFileSync(file)); return;
    } catch { break; }
  }
  res.statusCode = 404; res.end('Not found');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const artifacts = ['scripts/benchmark-raw-preview.mjs', 'packages/converter-client/dist/index.js',
  'wasm/converter-core/dist/converter-core.wasm', imageWasmPath,
  'tmp/performance-sota/package-lock.json', ...['index.js', 'worker.js', 'libraw.js', 'libraw.wasm'].map(name => `tmp/performance-sota/node_modules/libraw-wasm/dist/${name}`)]
  .filter(file => fs.existsSync(path.join(repo, file)))
  .map(file => ({ path: file, sha256: sha256(fs.readFileSync(path.join(repo, file))) }));
const result = {
  date: new Date().toISOString(), cpu: os.cpus()[0].model, platform: `${os.platform()} ${os.release()} ${os.arch()}`,
  totalMemory: os.totalmem(), browser: browser.version(), iterations, profiled, viewport: { width: 1280, height: 836 },
  gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  versions: { 'libraw-wasm': JSON.parse(fs.readFileSync(path.join(deps, 'libraw-wasm/package.json'))).version }, settings,
  method: 'Derived camera inputs with every parseable 8-bit display JPEG zeroed, offsets/file length retained; high-bit-depth sensor JPEG compression retained. Original and derived unpacked sensor data compared outside timer with LibRaw (processed RGB for Canon sRAW). Fast LibRaw uses Photos-style fixed sRGB, camera WB, no auto-bright, and signed BaselineExposure brightness read during untimed validation; its parameter lookup is excluded. Fresh browser context per run, input bytes and compiled libraries/worker ready before timer. Timed: local File/bytes through sensor decode, color/render, JPEG encode+decode for filens or RGB transfer+RGBA canvas for LibRaw, then common 1280x800 fitted canvas. operationMs ends after canvas draw; readyMs adds two rAFs. Native intermediate dimensions differ and are recorded. Not a full-quality RAW developer comparison. Engine order rotated. Hashes, image review, and screenshots after timing; no download/cold-library claim.',
  artifacts, samples, sensorChecks: [], runs: [],
};
const save = () => fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2) + '\n');
try {
  // Independent check: erasing display JPEGs did not modify sensor decoding.
  for (const sample of samples) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(base);
      const check = await page.evaluate(async sample => {
        const { default: LibRaw } = await import('/deps/libraw-wasm/dist/index.js');
        const hash = async data => [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(b => b.toString(16).padStart(2, '0')).join('');
        const records = [];
        for (const url of [`/repo/${sample.source}`, `/out/no-jpeg-${sample.name}`]) {
          const raw = new LibRaw();
          try {
            await raw.open(new Uint8Array(await (await fetch(url)).arrayBuffer()));
            const metadata = await raw.metadata(true);
            const sensor = await raw.rawImageData();
            const raster = sensor ?? await raw.imageData();
            if (!raster?.data?.length) throw new Error('No sensor raster returned for this input');
            const { data, ...dimensions } = raster;
            if (!data?.length) throw new Error('Empty unpacked sensor');
            records.push({ check: sensor ? 'unpacked-sensor' : 'processed-rgb', baselineExposure: metadata?.color_data?.dng_levels?.baseline_exposure ?? null, ...dimensions, bytes: data.byteLength, sha256: await hash(data) });
          } finally { raw.dispose(); }
        }
        return { original: records[0], withoutJpeg: records[1], equal: JSON.stringify(records[0]) === JSON.stringify(records[1]) };
      }, sample);
      result.sensorChecks.push({ sample: sample.name, ...check });
      const ev = check.original.baselineExposure;
      sample.fastSettings = { ...settings['libraw-fast'], bright: Number.isFinite(ev) && ev !== -999 ? 2 ** Math.max(-4, Math.min(4, ev)) : 1 };
      if (!check.equal) throw new Error(`Sensor changed: ${sample.name}`);
    } catch (error) {
      result.sensorChecks.push({ sample: sample.name, failure: String(error) });
      if (String(error).includes('Sensor changed:')) throw error;
    } finally { await context.close(); }
    save();
  }
  for (const sample of samples) for (let iteration = 0; iteration < iterations; iteration++) {
    // Retain the pruned CR3 fixture as a diagnostic, including an explicit
    // unpack route. This input cannot qualify as an intact sensor benchmark.
    const selected = engines.filter(engine => engine !== 'libraw-full' || sample.name.endsWith('.cr3'));
    const offset = iteration % selected.length;
    for (const engine of [...selected.slice(offset), ...selected.slice(0, offset)]) {
      const context = await browser.newContext({ viewport: result.viewport, deviceScaleFactor: 1 });
      const page = await context.newPage();
      page.setDefaultTimeout(60000);
      const run = { sample: sample.name, engine, iteration, errors: [] };
      page.on('pageerror', error => run.errors.push(error.message));
      try {
        await page.goto(base);
        run.setupMs = await page.evaluate(async ({ sample, engine, imageWasmPath }) => {
          window.input = await (await fetch(`/out/no-jpeg-${sample.name}`)).arrayBuffer();
          window.file = new File([window.input], sample.name);
          document.querySelector('#label').textContent = `${sample.name} · no embedded JPEG · ${engine}`;
          const t0 = performance.now();
          if (engine === 'filens') {
            const { createWasmConverterClient } = await import('@filens/converter-client');
            const [wasm, imageWasm] = await Promise.all(['wasm/converter-core/dist/converter-core.wasm', imageWasmPath].map(async file => WebAssembly.compile(await (await fetch(`/repo/${file}`)).arrayBuffer())));
            window.converter = createWasmConverterClient({ wasm, imageWasm });
          } else {
            const { default: LibRaw } = await import('/deps/libraw-wasm/dist/index.js');
            window.raw = new LibRaw(); await window.raw.metadata();
          }
          return performance.now() - t0;
        }, { sample, engine, imageWasmPath });
        const cdp = await context.newCDPSession(page);
        await cdp.send('HeapProfiler.collectGarbage');
        if (profiled) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
        Object.assign(run, await page.evaluate(async ({ sample, engine, settings }) => {
          let source, stats = {};
          const t0 = performance.now();
          if (engine === 'filens') {
            const converted = await window.converter.convert({ source: window.file, sourceFormat: sample.name.split('.').pop(), targetFormat: 'jpg', name: sample.name }, {});
            stats.processingMs = performance.now() - t0;
            stats.outputBytes = converted.source.byteLength; stats.warnings = converted.warnings;
            window.jpeg = new Uint8Array(await new Blob([converted.source]).arrayBuffer());
            const image = new Image(); image.src = URL.createObjectURL(new Blob([converted.source], { type: 'image/jpeg' }));
            await image.decode(); source = image; stats.outputFormat = 'jpeg';
            stats.width = image.naturalWidth; stats.height = image.naturalHeight;
          } else {
            const params = engine === 'libraw-fast' ? sample.fastSettings ?? settings[engine] : settings[engine];
            await window.raw.open(new Uint8Array(window.input), params);
            if (engine === 'libraw-full') {
              await window.raw.metadata(true);
              await window.raw.rawImageData();
            }
            const image = await window.raw.imageData();
            if (!image?.data?.length || image.bits !== undefined && image.bits !== 8 || image.colors !== undefined && image.colors !== 3) throw new Error(`Expected 8-bit RGB sensor preview; returned ${JSON.stringify({ width: image?.width, height: image?.height, colors: image?.colors, bits: image?.bits, dataLength: image?.data?.length })}`);
            stats.processingMs = performance.now() - t0;
            stats.width = image.width; stats.height = image.height; stats.outputBytes = image.data.byteLength; stats.outputFormat = 'rgb';
            const rgba = new ImageData(image.width, image.height);
            for (let i = 0; i < image.width * image.height; i++) {
              rgba.data[i * 4] = image.data[i * 3]; rgba.data[i * 4 + 1] = image.data[i * 3 + 1]; rgba.data[i * 4 + 2] = image.data[i * 3 + 2]; rgba.data[i * 4 + 3] = 255;
            }
            source = document.createElement('canvas'); source.width = image.width; source.height = image.height;
            source.getContext('2d').putImageData(rgba, 0, 0);
          }
          const canvas = document.querySelector('#preview'), ctx = canvas.getContext('2d');
          const scale = Math.min(canvas.width / stats.width, canvas.height / stats.height, 1);
          stats.displayWidth = Math.round(stats.width * scale); stats.displayHeight = Math.round(stats.height * scale);
          const x = Math.floor((canvas.width - stats.displayWidth) / 2), y = Math.floor((canvas.height - stats.displayHeight) / 2);
          ctx.fillStyle = '#17191e'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(source, x, y, stats.displayWidth, stats.displayHeight);
          stats.operationMs = performance.now() - t0;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          stats.readyMs = performance.now() - t0;
          window.outputImage = source;
          return stats;
        }, { sample, engine, settings }));
        if (profiled) {
          const { profile } = await cdp.send('Profiler.stop');
          fs.writeFileSync(path.join(out, `${engine}-${sample.name}-${iteration}.cpuprofile`), JSON.stringify(profile));
        }
        run.validation = await page.evaluate(async () => {
          const canvas = document.querySelector('#preview');
          const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          const hash = async data => [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(b => b.toString(16).padStart(2, '0')).join('');
          let sum = 0, sum2 = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            const value = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
            sum += value; sum2 += value * value;
          }
          const mean = sum / (pixels.length / 4);
          return { displayPixelSha256: await hash(pixels), mean, stddev: Math.sqrt(sum2 / (pixels.length / 4) - mean * mean),
            ...(window.jpeg ? { jpegSha256: await hash(window.jpeg) } : {}) };
        });
        if (iteration === 0 && !profiled) {
          await page.screenshot({ path: path.join(out, `${engine}-${sample.name}.png`) });
          if (args.includes('--save-full')) {
          const png = await page.evaluate(() => {
            const source = window.outputImage, canvas = document.createElement('canvas');
            canvas.width = source.naturalWidth ?? source.width; canvas.height = source.naturalHeight ?? source.height;
            canvas.getContext('2d').drawImage(source, 0, 0); return canvas.toDataURL('image/png').split(',')[1];
          });
          fs.writeFileSync(path.join(out, `${engine}-${sample.name}-output.png`), Buffer.from(png, 'base64'));
          }
        }
      } catch (error) { run.failure = String(error); }
      finally { await context.close(); }
      result.runs.push(run); save();
      console.log(JSON.stringify(run));
    }
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
