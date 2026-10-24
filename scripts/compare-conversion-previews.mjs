// Render saved conversion outputs through the same production preview drivers.
// Visual evidence is collected separately and never changes conversion timings.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const root = process.cwd();
const input = path.resolve(option('--input', 'tmp/performance-other/final'));
const out = path.resolve(option('--output', path.join(input, 'previews')));
fs.mkdirSync(out, { recursive: true });
const results = JSON.parse(fs.readFileSync(path.join(input, 'results.json')));
const imports = Object.fromEntries(['core', 'docx', 'xlsx'].map(n => [`@filens/${n}`, `/packages/${n}/dist/index.js`]));
const html = `<!doctype html><meta charset="utf-8"><script type="importmap">${JSON.stringify({ imports })}</script>
${['core', 'docx', 'xlsx'].map(n => `<link rel="stylesheet" href="/packages/${n}/dist/index.css">`).join('')}
<style>html,body,#host{margin:0;width:100%;height:100%;overflow:hidden}</style><div id="host"></div>`;
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (name === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
  const file = path.resolve(root, '.' + name);
  if (!file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
  try {
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream');
    res.end(fs.readFileSync(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch();
const review = { date: new Date().toISOString(), browser: browser.version(), viewport: { width: 1280, height: 900 },
  benchmarkResultSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(input, 'results.json'))).digest('hex'),
  artifacts: ['core', 'docx', 'xlsx'].map(n => ({ path: `packages/${n}/dist/index.js`, sha256: crypto.createHash('sha256').update(fs.readFileSync(`packages/${n}/dist/index.js`)).digest('hex') })),
  method: 'Both saved outputs rendered by identical production filens drivers. Exact XLSX display signatures include resolved cells, sheet dimensions and sheet order, ignoring tab names. A separate preview-content signature ignores trailing empty rows/columns and rounds decimal display values to 12 significant digits; every nonempty cell address and text remains checked. Screenshots cover each sheet/slide and first/last DOCX view. This checks preview similarity, not editable round-trip fidelity.', runs: [] };
try {
  for (const sample of results.samples.filter(s => s.family === 'conversion')) for (const engine of ['filens', 'x2t']) {
    const file = path.join(input, `${engine}-${sample.name}.${sample.target}`);
    if (!fs.existsSync(file)) continue;
    const context = await browser.newContext({ viewport: review.viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const row = { sample: sample.name, engine, outputSha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), errors, screenshots: [] };
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      Object.assign(row, await page.evaluate(async ({ file, target, sampleName }) => {
        const bytes = new Uint8Array(await (await fetch(file)).arrayBuffer());
        const host = document.querySelector('#host');
        const lib = await import(`@filens/${target === 'pptx' ? 'core' : target}`);
        const descriptor = { source: bytes, name: file.split('/').pop(), extension: target };
        window.target = target;
        if (target === 'pptx') {
          window.session = lib.init(host, { fit: 'contain', virtual: false });
          await window.session.preview(new File([bytes], descriptor.name));
          return { views: window.session.getState().slideCount };
        }
        window.session = target === 'docx' ? new lib.DocxPreviewSession(host) : new lib.XlsxPreviewSession(host);
        await window.session.load(bytes, { descriptor });
        if (target === 'docx') {
          await document.fonts.ready;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const visibleText = [...document.querySelectorAll('section.docx')].map(p => p.innerText).join('\n');
          if (sampleName === 'hyperlink.doc' && !visibleText.replace(/\s+/g, ' ').includes('Hyperlink text')) throw new Error('Hyperlink cached text is missing from the visible DOC preview');
          const visibleTextSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(visibleText)))].map(v => v.toString(16).padStart(2, '0')).join('');
          return { views: 2, pages: document.querySelectorAll('section.docx').length, visibleCharacters: visibleText.length, visibleTextSha256 };
        }
        const model = await lib.loadXlsxWorkbook(bytes);
        const display = model.sheets.map(sheet => ({ rows: sheet.rowCount, columns: sheet.columnCount,
          cells: sheet.rows.flatMap(r => r.cells.map(c => [c.ref, String(lib.resolveCellValue(sheet, c))]).filter(([, value]) => value !== '')) }));
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(display))))].map(v => v.toString(16).padStart(2, '0')).join('');
        const content = display.map(s => s.cells.map(([ref, value]) => [ref,
          /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value) && Number.isFinite(Number(value))
            ? { number: Number(value).toPrecision(12) } : value]).sort((a, b) => a[0].localeCompare(b[0])));
        const contentHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(content))))].map(v => v.toString(16).padStart(2, '0')).join('');
        return { views: model.sheets.length, displaySha256: hash, previewContentSha256: contentHash, sheets: display.map(s => ({ rows: s.rows, columns: s.columns, cells: s.cells.length })) };
      }, { file: '/' + path.relative(root, file), target: sample.target, sampleName: sample.name }));
      for (let view = 0; view < row.views; view++) {
        await page.evaluate(async view => {
          if (window.target === 'xlsx') window.session.goToPage(view);
          if (window.target === 'pptx') window.session.goToSlide(view);
          if (window.target === 'docx') { const el = document.querySelector('.docxv-preview'); el.scrollTop = view ? el.scrollHeight : 0; }
          await document.fonts.ready;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }, view);
        const name = `${engine}-${sample.name}-${view}.png`;
        await page.screenshot({ path: path.join(out, name) });
        row.screenshots.push({ path: name, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(out, name))).digest('hex') });
      }
    } catch (error) { row.failure = String(error); }
    review.runs.push(row); await context.close();
    console.log(JSON.stringify({ sample: row.sample, engine, views: row.views, failure: row.failure }));
  }
} finally { await browser.close(); server.close(); }
fs.writeFileSync(path.join(out, 'review.json'), JSON.stringify(review, null, 2) + '\n');
