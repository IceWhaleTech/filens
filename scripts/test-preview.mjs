import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.FILENS_AGENT_BINARY || path.join(root, 'dist/filens');
const assetRoot = process.env.FILENS_PREVIEW_TEST_DIR || path.join(root,'packages/preview/dist');
const work = await mkdtemp(path.join(os.tmpdir(), 'filens-preview-'));
const browser = await chromium.launch({ headless: true });
const observations = [];
await writeFile(path.join(work, '中文 preview.txt'), 'FILENS_PREVIEW_2026\nLocal browser preview 中文');
const files = [
  path.join(work, '中文 preview.txt'),
  path.join(root, 'apps/demo/public/samples/filens-aurora-guide.docx'),
  path.join(root, 'apps/demo/public/samples/filens-cosmic-atlas.pdf'),
  path.join(root, 'apps/demo/public/samples/a.pages'),
  path.join(root, 'apps/demo/public/samples/filens-weekend.key'),
  path.join(root, 'apps/demo/public/samples/filens-observatory.xlsx'),
  path.join(root, 'apps/demo/public/samples/rich-spreadsheet.ods'),
  path.join(root, 'apps/demo/public/samples/legacy-project-workflow.doc'),
  path.join(root, 'apps/demo/public/samples/filens-field-notes.pptx'),
  path.join(root, 'apps/demo/public/samples/a.numbers'),
  path.join(root, 'apps/demo/public/samples/raw/pentax-k-r.dng'),
  path.join(root, 'apps/demo/public/samples/showcase/milky-way-360.jpg'),
  path.join(root, 'apps/demo/public/samples/sample-nested-archives.zip')
];
// Also exercise the actual embedded STEP engine, rather than a mocked loader.
files.push(path.join(root, 'packages/model3d/test/fixtures/occt/cube.stp'));

function serve(file, mode) {
  const child = spawn(binary, ['preview', file, '--assets', path.join(assetRoot, mode), '--no-open', '--json'], { cwd:root });
  let stderr = ''; child.stderr.on('data', bytes => { stderr += bytes; });
  const lines = createInterface({ input: child.stdout });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`preview startup timeout: ${stderr}`)); }, 10000);
    child.once('error', reject);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`preview exited ${code}: ${stderr}`)); });
    lines.once('line', line => {
      clearTimeout(timer);
      const response = JSON.parse(line);
      resolve({ url:response.url, async close() {
        const closed = new Promise(resolve => child.once('close', resolve)); child.kill('SIGTERM'); await closed;
      } });
    });
  });
}
function raw(url, target, headers = {}, method = 'GET') {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ hostname:parsed.hostname, port:parsed.port, path:target, method, agent:false,
      headers:{ Host:parsed.host, ...headers } }, response => {
      const bytes = []; response.on('data', data => bytes.push(data));
      response.on('end', () => resolve({ status:response.statusCode, headers:response.headers, body:Buffer.concat(bytes) }));
    }); req.on('error', error => reject(new Error(`${method} ${target} ${JSON.stringify(headers)}: ${error.message}`))); req.end();
  });
}
try {
  for (const args of [
    ['preview', path.join(work,'中文 preview.txt'),'--assets',path.join(work,'missing'),'--json'],
    ['preview',work,'--json'],
    ['preview','--json']
  ]) {
    const result = spawnSync(binary,args,{encoding:'utf8'});
    assert.equal(result.status,1,result.stderr);
    assert.equal(JSON.parse(result.stdout).error.code,'preview_failed');
  }
  for (const mode of ['split', 'all-in-one']) {
    for (const file of files) {
      await readFile(file);
      const server = await serve(file, mode);
      const page = await browser.newPage();
      const requests = [], errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('requestfailed', request => {
        if (request.failure()?.errorText !== 'net::ERR_ABORTED') errors.push(`${request.url()}: ${request.failure()?.errorText}`);
      });
      page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
      await page.route('**/*', route => {
        const url = route.request().url();
        if (!url.startsWith(new URL(server.url).origin) && !url.startsWith('blob:') && !url.startsWith('data:')) {
          errors.push(`External dependency: ${url}`); return route.abort();
        }
        requests.push(url); return route.continue();
      });
      try {
        await page.goto(server.url);
        await page.waitForFunction(() => ['ready', 'error'].includes(document.body.dataset.state), null, {timeout:30000}).catch(async error => {
          throw new Error(`${mode} ${file}: ${error.message}; errors=${JSON.stringify(errors)}; requests=${JSON.stringify(requests)}; body=${await page.locator('body').innerText()}`);
        });
        const state = await page.evaluate(() => ({state:document.body.dataset.state,error:document.body.dataset.error,text:document.body.innerText,canvases:document.querySelectorAll('canvas').length}));
        assert.equal(state.state, 'ready', `${mode}: ${file}: ${JSON.stringify(state)}; ${errors}`);
        assert.deepEqual(errors, [], `${mode}: ${file}`);
        if (file.endsWith('.txt')) assert.match(state.text, /FILENS_PREVIEW_2026/);
        if (file.endsWith('.ods')) {
          assert.match(state.text, /Test spreadsheet/);
          assert.match(state.text, /2nd row 2nd column/);
          await page.locator('.xlsxv-sheet-tab').filter({ hasText:'Sheet Number 2' }).click();
          await page.locator('.xlsxv-grid').getByText('13', { exact:true }).waitFor();
          assert.equal(await page.locator('.xlsxv-sheet-tab').count(), 3);
        }
        if (mode === 'all-in-one') {
          assert.equal(requests.filter(url => /\.(js|mjs|wasm)(?:\?|$)/.test(url)).length, 1, requests.join('\n'));
        }
        observations.push({ mode, file:path.basename(file), state:state.state, canvases:state.canvases,
          runtimeRequests:requests.filter(url => /\.(js|mjs|wasm)(?:\?|$)/.test(url)).length });
        if (file.endsWith('.txt')) {
          await page.evaluate(async () => {
            const { createPreview } = await import(new URL('./filens.js', location.href).href);
            const host = document.createElement('div'); host.style.height='500px'; document.body.append(host);
            let rendered;
            const initial = new Promise(resolve => { rendered = resolve; });
            const viewer = createPreview(host, { src:new File(['FIRST_SOURCE'], 'first.txt'), name:'first.txt', onRendered:() => rendered() });
            await initial;
            const changed = new Promise(resolve => { rendered = resolve; });
            viewer.update({ src:new File(['SECOND_SOURCE'], 'second.txt'), name:'second.txt' });
            await changed;
            if (!host.textContent.includes('SECOND_SOURCE') || host.textContent.includes('FIRST_SOURCE')) throw new Error('Source update did not replace the preview');
            viewer.destroy();
            if (host.children.length) throw new Error('Preview was not unmounted');
            host.remove();
          });
          const prefix = new URL(server.url).pathname.replace('index.html', '');
          const source = (await raw(server.url, `${prefix}input.txt`));
          assert.equal(source.status, 200);
          const ranged = await raw(server.url, `${prefix}input.txt`, {Range:'bytes=0-5'});
          assert.equal(ranged.status,206); assert.equal(ranged.body.toString(), source.body.subarray(0,6).toString());
          assert.equal((await raw(server.url, `${prefix}input.txt`, {Range:'bytes=999999-'})).status,416);
          assert.equal((await raw(server.url, `${prefix}input.txt`, {}, 'HEAD')).body.length,0);
          for (const target of ['/source.json', `${prefix}../LICENSE`, `${prefix}%2e%2e/LICENSE`, `${prefix}source.json/../input.txt`]) {
            assert.equal((await raw(server.url,target)).status,404,target);
          }
          assert.equal((await raw(server.url, `${prefix}source.json`, {Host:'example.com'})).status,403);
          assert.equal((await raw(server.url, `${prefix}source.json`, {Origin:'https://example.com'})).status,403);
          assert.equal((await raw(server.url, `${prefix}source.json`, {'Sec-Fetch-Site':'cross-site'})).status,403);
          assert.equal((await raw(server.url, `${prefix}source.json`, {}, 'POST')).status,405);
        }
        console.log(`${mode}: ${path.basename(file)} rendered (${observations.at(-1).runtimeRequests} runtime requests)`);
      } finally { await page.close(); await server.close(); }
    }
  }
  await writeFile(path.join(root, 'docs/preview-validation.json'), `${JSON.stringify({
    date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date()),
    platform:`${process.platform}-${process.arch}`, browser:await browser.version(),
    scope:'Actual CLI loopback server and real shared engines. External network requests blocked. Render readiness and source text checked; no pixel-fidelity claim.',
    httpChecks:['GET','HEAD','byte ranges','invalid ranges','unscoped paths','directory traversal','Host','Origin','Sec-Fetch-Site','unsupported method'],
    observations
  },null,2)}\n`);
  console.log(`${observations.length} real preview checks passed; saved docs/preview-validation.json`);
} finally { await browser.close(); await rm(work,{recursive:true,force:true}); }
