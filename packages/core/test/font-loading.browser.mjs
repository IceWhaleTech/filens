import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import JSZip from 'jszip';

// Real browser/FontFace/metrics check; builds core and xlsx before running this file.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const font = await readFile(path.join(root, 'node_modules/pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf'));
const zip = new JSZip();
zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Fonts" sheetId="1" r:id="sheet"/></sheets></workbook>');
zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="sheet" Target="worksheets/sheet.xml"/></Relationships>');
zip.file('xl/styles.xml', '<styleSheet><fonts><font><name val="FilensBrowserFont"/></font></fonts><cellXfs><xf fontId="0"/></cellXfs></styleSheet>');
zip.file('xl/worksheets/sheet.xml', `<worksheet><sheetData>${Array.from({ length: 300 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>MMMMWWWWiiii1111</t></is></c></row>`).join('')}</sheetData></worksheet>`);
const workbook = await zip.generateAsync({ type: 'nodebuffer' });
let release;
const pending = new Promise(resolve => { release = resolve; });
const requests = [];
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/missing-font.ttf') { requests.push('missing'); response.writeHead(404).end(); return; }
    if (url.pathname === '/font.ttf') { requests.push('font'); await pending; response.writeHead(200, { 'Content-Type': 'font/ttf' }).end(font); return; }
    if (url.pathname === '/release') { release(); response.end('released'); return; }
    if (url.pathname === '/book.xlsx') { response.end(workbook); return; }
    if (url.pathname === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<html><head><script type="importmap">{"imports":{"@filens/core":"/packages/core/dist/index.js"}}</script><style>.xlsxv-grid{height:180px;overflow:auto}td,th{height:26px}</style></head><body><div id="host"></div></body></html>');
      return;
    }
    const file = path.resolve(root, `.${url.pathname}`);
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(origin);
  const before = await page.evaluate(async () => {
    const { createXlsxPreviewDriver } = await import('/packages/xlsx/dist/index.js');
    window.session = createXlsxPreviewDriver().createSession(document.querySelector('#host'), {
      fontLoading: { packs: [{ id: 'browser-test', version: '1', fonts: [{
        id: 'browser-font', fontFamily: 'FilensBrowserFont', sources: [{ url: '/missing-font.ttf' }, { url: '/font.ttf' }]
      }] }] }
    });
    window.state = null; window.session.on('statechange', state => { window.state = state; });
    const source = new Uint8Array(await (await fetch('/book.xlsx')).arrayBuffer());
    await window.session.load(source, { descriptor: { source, extension: 'xlsx' } });
    const grid = document.querySelector('.xlsxv-grid');
    grid.scrollTop = grid.scrollHeight; grid.dispatchEvent(new Event('scroll')); grid.scrollTop = 84;
    window.originalTable = document.querySelector('table');
    const context = document.createElement('canvas').getContext('2d'); context.font = '32px FilensBrowserFont';
    return { width: context.measureText('MMMMWWWWiiii1111').width, rows: document.querySelector('tbody').rows.length, status: window.state.fonts[0].status, scroll: grid.scrollTop };
  });
  assert.equal(before.status, 'missing'); assert.equal(before.rows, 200);
  await page.request.get(origin + '/release');
  try {
    await page.waitForFunction(() => window.state?.fonts?.[0]?.status === 'available', undefined, { timeout: 15000 });
  } catch (error) {
    console.error(JSON.stringify({ requests, errors, browser: await page.evaluate(async () => {
      let direct;
      try { const bytes = await (await fetch('/font.ttf')).arrayBuffer(); const face = await new FontFace('Direct Probe', bytes).load(); direct = { bytes: bytes.byteLength, status: face.status }; }
      catch (error) { direct = String(error); }
      return { state: window.state, direct, fonts: [...document.fonts].map(font => ({ family: font.family, status: font.status })) };
    }) }));
    throw error;
  }
  const after = await page.evaluate(() => {
    const context = document.createElement('canvas').getContext('2d'); context.font = '32px FilensBrowserFont';
    const grid = document.querySelector('.xlsxv-grid');
    return { width: context.measureText('MMMMWWWWiiii1111').width, rows: document.querySelector('tbody').rows.length, scroll: grid.scrollTop,
      replaced: window.originalTable !== document.querySelector('table'), loaded: [...document.fonts].some(font => font.family === 'FilensBrowserFont' && font.status === 'loaded') };
  });
  assert.equal(after.rows, before.rows); assert.equal(after.scroll, before.scroll); assert.equal(after.replaced, true); assert.equal(after.loaded, true);
  assert.ok(Math.abs(before.width - after.width) > 1, 'Real font metrics must change after the download.');
  assert.deepEqual(requests, ['missing', 'font']); assert.deepEqual(errors, []);
  await page.evaluate(() => window.session.destroy());
  assert.equal(await page.evaluate(() => [...document.fonts].some(font => font.family === 'FilensBrowserFont')), false);
  console.log(JSON.stringify({ ok: true, firstPreview: before.status, realFontWidth: [before.width, after.width], rowsPreserved: after.rows, scrollPreserved: after.scroll, mirrorFailover: requests, released: true }));
} finally { release(); await browser.close(); await new Promise(resolve => server.close(resolve)); }
