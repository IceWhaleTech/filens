// Actual browser Worker lifecycle engineering check; no peer/SOTA ranking.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const iterations = Number(option('--iterations', '7')); assert(Number.isSafeInteger(iterations) && iterations > 0);
const baseline = option('--baseline', 'tmp/continued-review/iwork-lifecycle-baseline/dist/index.js');
assert(!path.isAbsolute(baseline) && !baseline.split(/[\\/]/).includes('..'));
const output = path.resolve(root, option('--output', 'tmp/continued-review/iwork-lifecycle-final')); fs.mkdirSync(output, { recursive: true });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const modules = { current: 'packages/iwork/dist/index.js', baseline };
const samples = ['a.numbers', 'a.pages', 'filens-weekend.key'];
const artifact = file => ({ path: file, sha256: hash(fs.readFileSync(path.join(root, file))) });
const runtimeFiles = Object.values(modules).flatMap(file => [file, ...fs.readdirSync(path.join(root, path.dirname(file), 'assets')).filter(name => name.endsWith('.js')).map(name => `${path.dirname(file)}/assets/${name}`)]);
runtimeFiles.push(...fs.readdirSync(path.join(root, 'packages/core/dist')).filter(name => name.endsWith('.js')).map(name => 'packages/core/dist/' + name));
const result = { engineering: true, scopedSota: false, date: new Date().toISOString(), cpu: os.cpus()[0].model, platform: `${os.platform()} ${os.release()} ${os.arch()}`, iterations,
  method: 'Fresh Chromium context per sample/scenario/repeat/build, alternating build order. Real bundled native iWork files and real bundled parsing Workers. Imports/input ready before timing; Worker startup is included in healthy load. Cancellation fires 10 ms after the document postMessage; cancelWaitMs ends at preview promise settlement, excluding preceding dispatch/startup. Baseline ignores abort and completes obsolete work; cancellation is not equivalent-output parse acceleration. Healthy controls check complete returned document, normalized DOM, resource payloads, image decoding and every Numbers sheet after timing. No I/O, paint, peak-memory or peer/SOTA claim.',
  artifacts: [...runtimeFiles, 'packages/core/dist/index.js', 'packages/core/dist/zip.js', 'packages/xlsx/dist/index.js', 'packages/iwork/dist/index.css', 'scripts/benchmark-iwork-lifecycle.mjs', ...samples.map(name => `apps/demo/public/samples/${name}`)].map(artifact), runs: [] };
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); res.setHeader('Cache-Control', 'no-store');
  if (name === '/') { res.setHeader('Content-Type', 'text/html'); res.end(`<script type="importmap">${JSON.stringify({ imports: { '@filens/core': '/repo/packages/core/dist/index.js', '@filens/core/zip': '/repo/packages/core/dist/zip.js', '@filens/xlsx': '/repo/packages/xlsx/dist/index.js' } })}</script><link rel="stylesheet" href="/repo/packages/iwork/dist/index.css"><style>body{margin:0}#host{position:fixed;inset:0}</style><div id="host"></div>`); return; }
  const file = path.resolve(root, name.slice('/repo/'.length));
  if (!name.startsWith('/repo/') || !file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
  try { res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream'); res.end(fs.readFileSync(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true }); result.browser = browser.version();
try {
  for (const sample of samples) for (const scenario of ['healthy', 'cancel']) for (let iteration = 0; iteration < iterations; iteration++) for (const engine of iteration % 2 ? ['baseline', 'current'] : ['current', 'baseline']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }), page = await context.newPage(); page.setDefaultTimeout(120000);
    const run = { sample, scenario, engine, iteration, errors: [] }; page.on('pageerror', error => run.errors.push(error.message));
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.evaluate(async ({ module, sample, scenario }) => {
        const lib = await import('/repo/' + module), source = await (await fetch('/repo/apps/demo/public/samples/' + sample)).arrayBuffer();
        const urls = new Set(), create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = blob => { const url = create(blob); urls.add(url); return url; }; URL.revokeObjectURL = url => { urls.delete(url); revoke(url); };
        const tracked = [], NativeWorker = Worker;
        window.Worker = class extends NativeWorker {
          constructor(...args) { super(...args); this.record = { documents: 0, sheets: 0, clears: 0, terminated: false }; tracked.push(this.record); }
          postMessage(message, ...rest) {
            super.postMessage(message, ...rest);
            if (message.kind === 'document') { this.record.documents++; if (window.iworkBenchmark.onDocument) window.iworkBenchmark.onDocument(); }
            if (message.kind === 'sheet') this.record.sheets++;
            if (message.kind === 'clear') this.record.clears++;
          }
          terminate() { this.record.terminated = true; super.terminate(); }
        };
        const host = document.getElementById('host');
        window.iworkBenchmark = { lib, host, source, sample, scenario, urls, tracked, onDocument: null };
      }, { module: modules[engine], sample, scenario });
      Object.assign(run, await page.evaluate(async () => {
        const state = window.iworkBenchmark, { lib, host, source, sample, scenario, urls, tracked } = state;
        const sha = async data => [...new Uint8Array(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? new TextEncoder().encode(data) : data))].map(v => v.toString(16).padStart(2, '0')).join('');
        const viewer = lib.createIworkViewer(host); state.viewer = viewer;
        const controller = new AbortController(); let abortAt, dispatchedAt, timer, reportedErrors = 0;
        viewer.on('error', () => reportedErrors++);
        if (scenario === 'cancel') state.onDocument = () => { dispatchedAt = performance.now(); timer = setTimeout(() => { abortAt = performance.now(); controller.abort(); }, 10); };
        const start = performance.now(); let settled = 'done';
        try { await viewer.preview(source, { signal: controller.signal }); } catch (error) { settled = error.name; }
        const end = performance.now(); state.onDocument = null; clearTimeout(timer);
        const measured = { elapsedMs: end - start, settled, reportedErrors, ...(abortAt === undefined ? {} : { cancelWaitMs: end - abortAt, dispatchToAbortMs: abortAt - dispatchedAt }),
          afterLoad: { loading: viewer.getState().loading, error: viewer.getState().error, kind: viewer.getState().kind, pageCount: viewer.getState().pageCount, sheetCount: viewer.getState().sheetCount, urls: urls.size, nodes: host.querySelectorAll('*').length, workers: structuredClone(tracked) }, callerBufferBytes: source.byteLength };
        const inspect = async () => {
          const model = viewer.getState().document; if (!model) throw new Error('Missing healthy document');
          const clone = host.cloneNode(true), resources = [];
          for (const url of urls) { const data = await (await fetch(url)).arrayBuffer(); resources.push({ url, sha256: await sha(data), bytes: data.byteLength }); }
          for (const node of clone.querySelectorAll('*')) for (const attr of [...node.attributes]) {
            let value = attr.value; for (const resource of resources) value = value.split(resource.url).join('resource:' + resource.sha256); if (value !== attr.value) node.setAttribute(attr.name, value);
          }
          let images = 0; for (const image of host.querySelectorAll('img')) { if (image.src) { await image.decode(); if (!image.naturalWidth) throw new Error('Empty image'); images++; } }
          return { modelSha256: await sha(JSON.stringify(model)), domSha256: await sha(clone.innerHTML), textSha256: await sha(host.textContent), images, resources: resources.map(({ url, ...rest }) => rest).sort((a, b) => a.sha256.localeCompare(b.sha256)) };
        };
        if (scenario === 'healthy') {
          measured.content = [await inspect()]; const model = viewer.getState().document;
          if (model.kind === 'numbers') for (let index = 1; index < model.sheets.length; index++) {
            viewer.goToSheet(index); const deadline = performance.now() + 30000;
            while (model.sheets[index].loaded === false) { if (performance.now() > deadline) throw new Error('Lazy sheet timeout'); await new Promise(resolve => setTimeout(resolve, 5)); }
            measured.content.push(await inspect());
          }
        }
        if (scenario === 'cancel') {
          const recovered = viewer; await recovered.preview(new Uint8Array(await (await fetch('/repo/apps/demo/public/samples/' + sample)).arrayBuffer()));
          measured.recovery = { kind: recovered.getState().kind, error: recovered.getState().error, nodes: host.querySelectorAll('*').length }; recovered.destroy(); measured.recovery.remainingUrls = urls.size;
        }
        viewer.destroy(); measured.afterDestroy = { empty: !host.childElementCount, urls: urls.size, workers: structuredClone(tracked) };
        return measured;
      }));
    } catch (error) { run.failure = String(error); }
    result.runs.push(run); fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(run)); await context.close();
  }
} finally { await browser.close(); server.close(); }
