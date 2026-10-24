// Browser-only comparisons. All source bytes and libraries are ready before timing.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.join(root, 'tmp/performance-other');
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const iterations = Number(option('--iterations', '7'));
const profile = args.includes('--profile');
const selectedFamily = option('--family', 'all'), selectedSample = option('--sample', 'all');
const out = path.resolve(root, option('--output', 'tmp/performance-other/results'));
fs.mkdirSync(out, { recursive: true });
const samples = JSON.parse(fs.readFileSync(path.join(work, 'samples.json'))).filter(s =>
  (selectedFamily === 'all' || s.family === selectedFamily) && (selectedSample === 'all' || s.name === selectedSample));
const peers = { dxf: ['filens', 'dxf-parser'], xlsx: ['filens', 'sheetjs'], csv: ['filens', 'papaparse', 'sheetjs'], zip: ['filens', 'zip.js', 'fflate'], step: ['filens', 'occt-import-js'], conversion: ['filens', 'x2t'] };
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sizeCachePath = path.join(work, 'artifact-sizes.json');
const previousSizes = fs.existsSync(sizeCachePath) ? JSON.parse(fs.readFileSync(sizeCachePath))
  : fs.existsSync(path.join(work, 'pilot/results.json')) ? JSON.parse(fs.readFileSync(path.join(work, 'pilot/results.json'))).artifacts : [];
const sizeCache = new Map(previousSizes.map(row => [row.sha256, row]));
const measuredSize = file => {
  const b = fs.readFileSync(path.join(root, file));
  const hash = sha256(b), cached = sizeCache.get(hash);
  if (cached) return { ...cached, path: file };
  return { path: file, sha256: hash, raw: b.length, gzip: gzipSync(b, { level: 9 }).length,
    brotli: brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length };
};
const result = { date: new Date().toISOString(), cpu: os.cpus()[0].model, totalMemory: os.totalmem(), platform: `${os.platform()} ${os.release()} ${os.arch()}`, iterations, profiled: profile,
  versions: { 'dxf-parser': '1.1.2', 'occt-import-js': '0.0.23', sheetjs: '0.20.3', papaparse: '5.7.0', 'zip.js': '2.24.0', fflate: '0.8.2', x2t: 'v9.3.2+3' },
  method: 'Fresh Chromium context per invocation, shared browser, alternating engine order. Byte/text inputs and libraries loaded first. STEP and x2t WASM are precompiled; runtime instantiation/initialization is recorded separately. filens conversion includes fresh WASI instantiation. No fonts are added to x2t. zip.js runs without workers, checksum validation disabled for both ZIP paths. No rendering/FPS or Office visual-fidelity claim. Data/geometry signatures and output validation occur after timing.',
  artifacts: ['scripts/benchmark-other-formats.mjs', 'scripts/prepare-other-format-benchmark.mjs', 'benchmarks/frontend/other-formats/package-lock.json',
    ...['core', 'cad', 'xlsx', 'archive', 'converter-client'].map(n => `packages/${n}/dist/index.js`), 'packages/model3d/vendor/occt-import-js/occt-import-js.wasm',
    'tmp/performance-other/node_modules/occt-import-js/dist/occt-import-js.wasm', 'wasm/converter-core/dist/converter-core.wasm', 'tmp/performance-other/x2t/x2t.wasm', 'tmp/performance-other/x2t/x2t.js'].map(measuredSize),
  samples, runs: [] };
fs.writeFileSync(sizeCachePath, JSON.stringify(result.artifacts));
const save = () => fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2) + '\n');
const imports = Object.fromEntries(['core', 'cad', 'xlsx', 'archive', 'converter-client'].map(n => [`@filens/${n}`, `/repo/packages/${n}/dist/index.js`]));
const html = `<!doctype html><meta charset="utf-8"><script type="importmap">${JSON.stringify({ imports })}</script>`;
const server = http.createServer((req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp'); res.setHeader('Cache-Control', 'no-store');
  const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (name === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
  const file = path.resolve(root, name.startsWith('/repo/') ? name.slice(6) : 'missing');
  if (!file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
  try { res.setHeader('Content-Type', file.endsWith('.js') || file.endsWith('.mjs') ? 'text/javascript' : file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream'); res.end(fs.readFileSync(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true }); result.browser = browser.version();
try {
  for (const sample of samples) for (let iteration = 0; iteration < iterations; iteration++) {
    const engines = peers[sample.family], start = iteration % engines.length;
    for (const engine of [...engines.slice(start), ...engines.slice(0, start)]) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
      const page = await context.newPage(); page.setDefaultTimeout(60000);
      const errors = [], logs = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', msg => { if (msg.type() === 'error' || msg.type() === 'warning') logs.push(msg.text().slice(0, 1000)); });
      const run = { family: sample.family, sample: sample.name, engine, iteration, errors, logs };
      try {
        await page.goto(base);
        const setup = await page.evaluate(async ({ sample, engine }) => {
          const script = url => new Promise((resolve, reject) => { const tag = document.createElement('script'); tag.src = url; tag.onload = resolve; tag.onerror = reject; document.head.append(tag); });
          const bytes = new Uint8Array(await (await fetch(`/repo/${sample.path}`)).arrayBuffer());
          window.input = bytes; window.text = new TextDecoder().decode(bytes); window.sample = sample;
          window.hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? new TextEncoder().encode(value) : value))].map(v => v.toString(16).padStart(2, '0')).join('');
          if (engine === 'filens' && sample.family !== 'step') window.lib = await import(`@filens/${({ dxf: 'cad', xlsx: 'xlsx', csv: 'xlsx', zip: 'archive', conversion: 'converter-client' })[sample.family]}`);
          else if (engine === 'dxf-parser') { await script('/repo/tmp/performance-other/node_modules/dxf-parser/dist/dxf-parser.js'); window.parser = new window.DxfParser(); }
          else if (engine === 'sheetjs') await script('/repo/tmp/performance-other/xlsx.full.min.js');
          else if (engine === 'papaparse') await script('/repo/tmp/performance-other/node_modules/papaparse/papaparse.min.js');
          else if (engine === 'zip.js') { window.zip = await import('/repo/tmp/performance-other/node_modules/@zip.js/zip.js/index.js'); window.zip.configure({ useWebWorkers: false }); }
          else if (engine === 'fflate') window.fflate = await import('/repo/tmp/performance-other/node_modules/fflate/esm/browser.js');
          let initMs = 0;
          if (sample.family === 'step' || sample.family === 'conversion') {
            let factory, wasm;
            if (sample.family === 'step') {
              const relative = engine === 'filens' ? 'packages/model3d/vendor/occt-import-js/occt-import-js' : 'tmp/performance-other/node_modules/occt-import-js/dist/occt-import-js';
              wasm = await WebAssembly.compile(await (await fetch(`/repo/${relative}.wasm`)).arrayBuffer());
              if (engine === 'filens') factory = (await import(`/repo/${relative}.js`)).default;
              else { await script(`/repo/${relative}.js`); factory = window.occtimportjs; }
              const t0 = performance.now();
              window.importer = await factory({ instantiateWasm(imports, ready) { WebAssembly.instantiate(wasm, imports).then(instance => ready(instance, wasm)); return {}; }, print() {}, printErr() {} });
              initMs = performance.now() - t0;
            } else {
              await script('/repo/node_modules/jszip/dist/jszip.min.js');
              await script('/repo/tmp/performance-other/xlsx.full.min.js');
              const relative = engine === 'filens' ? 'wasm/converter-core/dist/converter-core.wasm' : 'tmp/performance-other/x2t/x2t.wasm';
              wasm = await WebAssembly.compile(await (await fetch(`/repo/${relative}`)).arrayBuffer());
              if (engine === 'filens') window.converter = window.lib.createWasmConverterClient({ wasm });
              else {
                const code = await (await fetch('/repo/tmp/performance-other/x2t/x2t.js')).text();
                const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
                const t0 = performance.now();
                await new Promise((resolve, reject) => {
                  window.Module = { instantiateWasm(imports, ready) { WebAssembly.instantiate(wasm, imports).then(instance => ready(instance, wasm), reject); return {}; }, onRuntimeInitialized: resolve, onAbort: reject, print() {}, printErr(text) { console.warn(text); } };
                  script(url).catch(reject);
                });
                for (const name of ['/working', '/working/media', '/working/fonts', '/working/themes']) window.Module.FS.mkdir(name);
                initMs = performance.now() - t0; URL.revokeObjectURL(url);
              }
            }
          }
          return { initMs };
        }, { sample, engine });
        Object.assign(run, setup);
        const cdp = await context.newCDPSession(page); await cdp.send('HeapProfiler.collectGarbage');
        const before = await cdp.send('Runtime.getHeapUsage');
        if (profile) {
          await cdp.send('Profiler.enable');
          await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
          await cdp.send('Profiler.start');
        }
        Object.assign(run, await page.evaluate(async engine => {
          const { family, name, target } = window.sample, stats = {};
          const t0 = performance.now(); let model;
          if (family === 'dxf') model = engine === 'filens' ? window.lib.loadDxfDrawing(window.text) : window.parser.parseSync(window.text);
          else if (family === 'xlsx') model = engine === 'filens' ? await window.lib.loadXlsxWorkbook(window.input) : window.XLSX.read(window.input, { type: 'array', cellFormula: true });
          else if (family === 'csv') model = engine === 'filens' ? await window.lib.loadCsvWorkbook(window.input) : engine === 'papaparse' ? window.Papa.parse(new TextDecoder().decode(window.input), { delimiter: ',', dynamicTyping: false }) : window.XLSX.read(window.input, { type: 'array', raw: true });
          else if (family === 'step') {
            model = window.importer.ReadStepFile(window.input, { linearUnit: 'millimeter' });
            if (!model.success || !model.meshes?.length) throw new Error('STEP returned no geometry');
          } else if (family === 'conversion') {
            const ext = name.split('.').pop().toLowerCase();
            if (engine === 'filens') {
              const converted = await window.converter.convert({ source: window.input, sourceFormat: ext, targetFormat: target, name }, { descriptor: { source: window.input, name } });
              model = converted.source; stats.warnings = converted.warnings;
            } else {
              const fs = window.Module.FS, input = `/working/in.${ext}`, output = `/working/out.${target}`;
              fs.writeFile(input, window.input);
              fs.writeFile('/working/params.xml', `<?xml version="1.0" encoding="UTF-8"?><TaskQueueDataConvert><m_sFileFrom>${input}</m_sFileFrom><m_sFileTo>${output}</m_sFileTo><m_sFontDir>/working/fonts</m_sFontDir><m_sThemeDir>/working/themes</m_sThemeDir><m_nFormatTo>${({ docx: 65, xlsx: 257, pptx: 129 })[target]}</m_nFormatTo><m_nCsvTxtEncoding>46</m_nCsvTxtEncoding><m_nCsvDelimiter>4</m_nCsvDelimiter><m_bIsNoBase64>false</m_bIsNoBase64></TaskQueueDataConvert>`);
              stats.exitCode = window.Module.ccall('main1', 'number', ['string'], ['/working/params.xml']);
              model = fs.readFile(output);
              if (stats.exitCode) throw new Error(`x2t exit ${stats.exitCode}`);
            }
            if (!model?.byteLength) throw new Error('Empty conversion output');
            window.convertedBytes = model;
          } else {
            let entries;
            if (engine === 'filens') {
              const index = await window.lib.createArchiveResourceIndex(window.input, { descriptor: { source: window.input, name, extension: 'zip' } });
              entries = index.files;
            } else if (engine === 'zip.js') {
              window.zipReader = new window.zip.ZipReader(new window.zip.Uint8ArrayReader(window.input), { checkSignature: false });
              entries = (await window.zipReader.getEntries()).filter(e => !e.directory);
            } else {
              entries = [];
              window.fflate.unzipSync(window.input, { filter: e => { if (!e.name.endsWith('/')) entries.push({ name: e.name }); return false; } });
            }
            stats.indexMs = performance.now() - t0;
            model = [];
            const readStart = performance.now();
            if (engine === 'fflate') {
              const inflated = window.fflate.unzipSync(window.input);
              model = entries.map(e => ({ name: e.name, data: inflated[e.name] }));
            } else for (const e of entries) model.push({ name: e.name ?? e.filename, data: engine === 'filens' ? new Uint8Array(await e.readAsArrayBuffer()) : await e.getData(new window.zip.Uint8ArrayWriter()) });
            stats.extractMs = performance.now() - readStart;
          }
          stats.operationMs = performance.now() - t0; stats.firstOperationMs = stats.operationMs;
          window.model = model;
          if (family === 'dxf') {
            stats.entities = (model.entities ?? []).length; stats.warnings = model.warnings ?? [];
            stats.types = (model.entities ?? []).reduce((counts, entity) => { counts[entity.type] = (counts[entity.type] ?? 0) + 1; return counts; }, {});
            if (name === 'generated-20000-lines.dxf') {
              const lines = model.entities.map(e => engine === 'filens' ? [e.layer, e.start.x, e.start.y, e.end.x, e.end.y] : [e.layer, e.vertices[0].x, e.vertices[0].y, e.vertices[1].x, e.vertices[1].y]);
              stats.contentSha256 = await window.hash(JSON.stringify(lines));
            }
          } else if (family === 'step') {
            stats.meshes = model.meshes.length;
            stats.triangles = model.meshes.reduce((sum, m) => sum + m.index.array.length / 3, 0);
            const triangles = [], bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
            for (const mesh of model.meshes) {
              const p = mesh.attributes.position.array, n = mesh.attributes.normal.array, ix = mesh.index.array;
              for (let i = 0; i < p.length; i++) { const axis = i % 3; bounds[axis] = Math.min(bounds[axis], p[i]); bounds[axis + 3] = Math.max(bounds[axis + 3], p[i]); }
              for (let i = 0; i < ix.length; i += 3) {
                const vertices = ix.slice(i, i + 3).map(v => [...p.slice(v * 3, v * 3 + 3), ...n.slice(v * 3, v * 3 + 3)].map(x => Math.round(x * 1e5)));
                const strings = vertices.map(v => JSON.stringify(v)), start = strings.indexOf([...strings].sort()[0]);
                triangles.push(JSON.stringify([0, 1, 2].map(offset => vertices[(start + offset) % 3])));
              }
            }
            stats.bounds = bounds; stats.contentSha256 = await window.hash(JSON.stringify(triangles.sort()));
          } else if (family === 'xlsx' || family === 'csv') {
            let sheets;
            if (engine === 'filens') sheets = model.sheets.map(s => ({ name: s.name, cells: s.rows.flatMap(r => r.cells).map(c => [c.ref, c.value, c.formula ?? '']).filter(([, v, f]) => v !== '' || f) }));
            else if (engine === 'papaparse') {
              if (model.errors.length) throw new Error(JSON.stringify(model.errors));
              sheets = [{ name: 'CSV', cells: model.data.flatMap((row, r) => row.flatMap((v, c) => v === '' ? [] : [[`${c}:${r}`, v, '']])) }];
            } else sheets = model.SheetNames.map(name => ({ name, cells: Object.entries(model.Sheets[name]).filter(([ref, c]) => !ref.startsWith('!') && (c.v !== undefined || c.f)).map(([ref, c]) => [ref, typeof c.v === 'boolean' ? (c.v ? 'TRUE' : 'FALSE') : String(c.v ?? ''), c.f ?? '']).filter(([, v, f]) => v !== '' || f) }));
            if (family === 'csv') {
              // Compare values by source row/column, independently of model labels.
              const values = engine === 'papaparse' ? model.data : engine === 'filens' ? model.sheets[0].rows.map(r => r.cells.map(c => c.value)) : window.XLSX.utils.sheet_to_json(model.Sheets[model.SheetNames[0]], { header: 1, raw: true, defval: '' }).map(r => r.map(v => String(v)));
              stats.contentSha256 = await window.hash(JSON.stringify(values)); stats.rows = values.length;
            } else stats.contentSha256 = await window.hash(JSON.stringify(sheets.map(s => [s.name, s.cells.sort((a, b) => a[0].localeCompare(b[0]))])));
            stats.sheets = sheets.length; stats.cells = sheets.reduce((sum, s) => sum + s.cells.length, 0); stats.warnings = model.warnings ?? [];
          } else if (family === 'zip') {
            stats.files = model.length; stats.expandedBytes = model.reduce((sum, e) => sum + e.data.length, 0);
            const signatures = [];
            for (const e of model) signatures.push([e.name, await window.hash(e.data)]);
            stats.contentSha256 = await window.hash(JSON.stringify(signatures.sort((a, b) => a[0].localeCompare(b[0]))));
            await window.zipReader?.close();
          } else {
            stats.outputBytes = model.byteLength;
            const zip = await window.JSZip.loadAsync(model);
            if (!zip.file('[Content_Types].xml') || !zip.file('_rels/.rels')) throw new Error(`Invalid OpenXML package; entries: ${Object.keys(zip.files).slice(0, 12).join(', ')}`);
            stats.media = Object.keys(zip.files).filter(p => /\/media\/[^/]+$/.test(p) && !zip.files[p].dir).length;
            const texts = [], counts = { slides: 0, paragraphs: 0, tables: 0, formulas: 0, shapes: 0 };
            for (const p of Object.keys(zip.files).sort()) {
              if (!/^(?:word\/document|ppt\/slides\/slide\d+|xl\/worksheets\/sheet\d+)\.xml$/.test(p)) continue;
              const doc = new DOMParser().parseFromString(await zip.file(p).async('text'), 'text/xml');
              if (doc.querySelector('parsererror')) throw new Error(`Invalid output XML: ${p}`);
              if (p.startsWith('ppt/')) counts.slides++;
              for (const [tag, key] of [['p', 'paragraphs'], ['tbl', 'tables'], ['f', 'formulas'], ['sp', 'shapes']]) counts[key] += doc.getElementsByTagNameNS('*', tag).length;
              texts.push(...[...doc.getElementsByTagNameNS('*', 't')].map(t => t.textContent));
            }
            stats.structure = counts; stats.textCharacters = texts.join('').length;
            stats.textSha256 = await window.hash(texts.join(''));
            if (target === 'xlsx') {
              const workbook = window.XLSX.read(model, { type: 'array' });
              const sheets = workbook.SheetNames.map(name => Object.entries(workbook.Sheets[name]).filter(([k, v]) => !k.startsWith('!') && v.v !== undefined).map(([k, v]) => [k, String(v.v)]).sort((a, b) => a[0].localeCompare(b[0])));
              stats.cells = sheets.reduce((sum, s) => sum + s.length, 0); stats.contentSha256 = await window.hash(JSON.stringify(sheets));
            }
          }
          return stats;
        }, engine));
        if (profile) {
          const { profile: recording } = await cdp.send('Profiler.stop');
          fs.writeFileSync(path.join(out, `${engine}-${sample.name}-${iteration}.cpuprofile`), JSON.stringify(recording));
        }
        run.firstOperationMs += run.initMs;
        await cdp.send('HeapProfiler.collectGarbage');
        run.retainedMainThreadJsHeapMiB = ((await cdp.send('Runtime.getHeapUsage')).usedSize - before.usedSize) / 1024 ** 2;
        if (sample.family === 'conversion' && iteration === 0) {
          const bytes = await page.evaluate(() => Array.from(window.convertedBytes));
          fs.writeFileSync(path.join(out, `${engine}-${sample.name}.${sample.target}`), Buffer.from(bytes));
        }
      } catch (error) {
        run.failure = String(error);
        if (sample.family === 'conversion' && iteration === 0) {
          const bytes = await page.evaluate(() => window.convertedBytes ? Array.from(window.convertedBytes) : null).catch(() => null);
          if (bytes) fs.writeFileSync(path.join(out, `${engine}-${sample.name}.${sample.target}.invalid`), Buffer.from(bytes));
        }
      }
      result.runs.push(run); save();
      console.log(JSON.stringify({ family: run.family, sample: run.sample, engine, iteration, ms: run.operationMs, initMs: run.initMs, failure: run.failure }));
      await context.close();
    }
  }
} finally { await browser.close(); server.close(); }
save();
console.log(`Results: ${path.join(out, 'results.json')}`);
