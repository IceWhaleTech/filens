import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createWavFixture } from '../packages/core/test/fixtures/native-media.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetRoot = process.env.FILENS_PREVIEW_TEST_DIR || path.join(root, 'packages/preview/dist');
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/') {
      const mode = url.searchParams.get('mode');
      if (!['split', 'all-in-one'].includes(mode)) throw new Error('Unknown bundle');
      response.setHeader('Content-Type', 'text/html');
      response.end(`<input id="file" type="file"><div id="preview" style="height:600px"></div><script type="module">
        import { createPreview } from '/packages/preview/dist/${mode}/filens.js';
        let viewer;
        document.querySelector('#file').onchange = event => {
          viewer?.destroy(); document.body.dataset.state = 'loading'; delete document.body.dataset.error;
          const file = event.target.files[0];
          viewer = createPreview('#preview', { src: file, name: file.name,
            onRendered: () => { document.body.dataset.state = 'ready'; },
            onError: error => { document.body.dataset.state = 'error'; document.body.dataset.error = error.message; }
          });
        };
        window.previewReady = true;
      </script>`);
      return;
    }
    const prefix = '/packages/preview/dist/';
    if (!url.pathname.startsWith(prefix)) throw new Error('Unknown asset');
    const file = path.resolve(assetRoot, decodeURIComponent(url.pathname.slice(prefix.length)));
    if (!file.startsWith(`${assetRoot}${path.sep}`)) throw new Error('Unknown asset');
    response.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.FILENS_MEDIA_TEST_BROWSER ? {channel:process.env.FILENS_MEDIA_TEST_BROWSER} : {}) });
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
      await page.locator('#file').setInputFiles({name:'recording.wav',mimeType:'audio/wav',buffer:Buffer.from(createWavFixture())});
      await expect.poll(() => page.locator('body').getAttribute('data-state')).toBe('ready');
      await page.locator('audio').evaluate(audio => { audio.muted = true; return audio.play(); });
      await expect.poll(() => page.locator('audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(0);
      assert.ok(!requests.some(url => /libheif\.wasm|ffmpeg/i.test(url)), 'Audio must not load image or video decoders');
      console.log(`${mode}: native WAV audio played without an image/video decoder`);
      for (const extension of ['HEIC', 'MOV']) {
        await page.locator('#file').setInputFiles(path.join(root, `apps/demo/public/samples/live-photo/apple-iphone-15-live-photo.${extension}`));
        await expect.poll(async () => ['ready', 'error'].includes(await page.locator('body').getAttribute('data-state')), {
          timeout: 120000, message: `${mode} ${extension} must render`
        }).toBe(true);
        const state = await page.locator('body').getAttribute('data-state');
        if (extension === 'HEIC') {
          assert.equal(state, 'ready', await page.locator('body').getAttribute('data-error'));
          assert.ok(await page.locator('img.pptxv-native-image').evaluate(image => image.naturalWidth > 1000));
        } else if (state === 'ready') {
          assert.ok(await page.locator('video').evaluate(video => video.videoWidth > 0));
          await page.locator('video').evaluate(video => video.play());
          await expect.poll(() => page.locator('video').evaluate(video => video.currentTime)).toBeGreaterThan(0);
        } else {
          assert.match(await page.locator('body').getAttribute('data-error'), /codec/i);
          assert.notEqual(process.env.FILENS_MEDIA_TEST_BROWSER, 'chrome', 'Installed Chrome must play the original MOV on this Mac');
        }
        assert.ok(!requests.some(url => /ffmpeg/i.test(url)), 'Default previews must not load FFmpeg');
        console.log(`${mode}: original ${extension}: ${state === 'ready' ? (extension === 'MOV' ? 'native video played' : 'image decoded') : 'unsupported codec reported without a video engine'}`);
      }
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
