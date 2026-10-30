import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/') {
      const mode = url.searchParams.get('mode');
      if (!['split', 'all-in-one'].includes(mode)) throw new Error('Unknown bundle');
      response.setHeader('Content-Type', 'text/html');
      response.end(`<input type="file"><div id="preview" style="height:600px"></div><script type="module">
        import { createPreview } from '/packages/preview/dist/${mode}/filens.js';
        let viewer;
        document.querySelector('input').onchange = event => {
          viewer?.destroy(); document.body.dataset.state = 'loading'; delete document.body.dataset.error;
          const file = event.target.files[0];
          viewer = createPreview('#preview', { src: file, name: file.name,
            onRendered: () => { document.body.dataset.state = 'ready'; },
            onError: error => { document.body.dataset.state = 'error'; document.body.dataset.error = error.message; }
          });
        };
        new MutationObserver(() => {
          const source = document.querySelector('video source[type="video/quicktime"]');
          if (source) source.dispatchEvent(new Event('error'));
        }).observe(document.body, {childList:true,subtree:true});
        window.previewReady = true;
      </script>`);
      return;
    }
    const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(`${root}${path.sep}`)) throw new Error('Unknown asset');
    response.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  for (const mode of ['split', 'all-in-one']) {
    const page = await browser.newPage();
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = route.request().url(); requests.push(url);
      return url.startsWith(origin) || /^(blob:|data:)/.test(url) ? route.continue() : route.abort();
    });
    try {
      await page.goto(`${origin}/?mode=${mode}`);
      await page.waitForFunction(() => window.previewReady);
      for (const extension of ['HEIC', 'MOV']) {
        await page.locator('input').setInputFiles(path.join(root, `apps/demo/public/samples/live-photo/apple-iphone-15-live-photo.${extension}`));
        await expect.poll(() => page.locator('body').getAttribute('data-state'), {
          timeout: 120000, message: `${mode} ${extension} must render`
        }).toBe('ready');
        assert.equal(await page.locator('body').getAttribute('data-error'), null);
        if (extension === 'HEIC') {
          assert.ok(await page.locator('img.pptxv-native-image').evaluate(image => image.naturalWidth > 1000));
          assert.ok(!requests.some(url => url.endsWith('/ffmpeg-core.wasm')), 'HEIC must not fetch the video core');
        } else {
          assert.equal(await page.locator('video source').getAttribute('type'), 'video/mp4');
          await page.locator('video').evaluate(video => video.play());
          await expect.poll(() => page.locator('video').evaluate(video => video.currentTime)).toBeGreaterThan(0);
        }
        console.log(`${mode}: original ${extension} rendered${extension === 'MOV' ? ' and played' : ''}`);
      }
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
