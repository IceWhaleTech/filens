import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { createWavFixture } from '../../../packages/core/test/fixtures/native-media.mjs';

const prepare = async (page: import('@playwright/test').Page) => {
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/core/src/preview/index.ts')}`, page.url()).href;
  await page.evaluate(async moduleUrl => {
    const lib = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0;background:white'; document.body.replaceChildren(host);
    const active = new Set<string>(), create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); active.add(url); return url; };
    URL.revokeObjectURL = url => { active.delete(url); revoke(url); };
    (window as any).nativeTest = { lib, host, active };
  }, moduleUrl);
};

test('renders HTML data URLs and fragments while retaining the script sandbox and releasing Blob URLs', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    const state = (window as any).nativeTest; state.session = state.lib.createHtmlPreviewDriver().createSession(state.host);
  });
  for (const source of ['data:text/html,%3Ch1%3EReadable%3C%2Fh1%3E', 'data:text/html;base64,PGgxPlJlYWRhYmxlPC9oMT4=',
    '<h1>Readable</h1><script>parent.inlineScriptRan = true;</script>', '<?xml version="1.0"?><html><body><h1>Readable</h1></body></html>']) {
    await page.evaluate(async source => {
      const { session } = (window as any).nativeTest;
      await session.load(source, { descriptor: { source, name: 'preview.html', extension: 'html' } });
    }, source);
    await expect(page.frameLocator('iframe').locator('h1')).toHaveText('Readable');
    await expect.poll(() => page.evaluate(() => (window as any).nativeTest.session.getState().loading)).toBe(false);
  }
  expect(await page.evaluate(() => (window as any).inlineScriptRan)).toBeUndefined();
  expect(await page.evaluate(() => {
    const { session, host, active } = (window as any).nativeTest; session.destroy(); return { empty: !host.childElementCount, urls: active.size };
  })).toEqual({ empty: true, urls: 0 });
});

test('keeps current image metadata after old events and cancels the current image without leaking URLs', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { lib, host, active } = (window as any).nativeTest;
    const session = lib.createImagePreviewDriver().createSession(host);
    const source = (width: number, height: number) => new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="teal"/></svg>`], { type: 'image/svg+xml' });
    const first = source(160, 90); await session.load(first, { descriptor: { source: first, name: 'first.svg' } });
    const old = host.querySelector('img')!;
    if (session.getState().loading) await new Promise<void>(resolve => old.addEventListener('load', () => resolve(), { once: true }));
    const second = source(80, 64), controller = new AbortController();
    await session.load(second, { descriptor: { source: second, name: 'second.svg' }, signal: controller.signal });
    const current = host.querySelector('img')!;
    if (session.getState().loading) await new Promise<void>(resolve => current.addEventListener('load', () => resolve(), { once: true }));
    old.dispatchEvent(new Event('load')); old.dispatchEvent(new Event('error'));
    const state = session.getState();
    controller.abort(); current.dispatchEvent(new Event('error'));
    const result = { title: state.title, width: state.naturalWidth, height: state.naturalHeight, error: state.error,
      loading: session.getState().loading, imageGone: !host.querySelector('img'), urls: active.size };
    session.destroy(); return result;
  });
  expect(result).toEqual({ title: 'second.svg', width: 80, height: 64, error: null, loading: false, imageGone: true, urls: 0 });
  expect(errors).toEqual([]);
});

test('plays real PCM audio, stops the old player on replacement, and releases playback on destroy', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await prepare(page);
  await page.evaluate(async bytes => {
    const state = (window as any).nativeTest;
    state.source = new Uint8Array(bytes); state.session = state.lib.createMediaPreviewDriver().createSession(state.host);
    await state.session.load(state.source, { descriptor: { source: state.source, name: 'first.wav', extension: 'wav' } });
    state.old = state.host.querySelector('audio');
    await state.old.play();
  }, [...createWavFixture(64_044)]);
  await expect.poll(() => page.evaluate(() => (window as any).nativeTest.old.currentTime)).toBeGreaterThan(0);
  const result = await page.evaluate(async () => {
    const { source, session, host, active, old } = (window as any).nativeTest;
    old.volume = 0.25; old.muted = true; old.dispatchEvent(new Event('volumechange'));
    await session.load(source, { descriptor: { source, name: 'second.wav', extension: 'wav' } });
    const current = host.querySelector('audio')!;
    const oldStopped = old.paused && !old.querySelector('source[src]');
    old.dispatchEvent(new Event('error')); old.dispatchEvent(new Event('timeupdate'));
    const preferences = [current.volume, current.muted];
    await current.play(); session.destroy();
    current.dispatchEvent(new Event('error'));
    return { oldStopped: !!oldStopped, currentStopped: current.paused, preferences, urls: active.size,
      empty: !host.childElementCount, error: session.getState().error };
  });
  expect(result).toEqual({ oldStopped: true, currentStopped: true, preferences: [0.25, true], urls: 0, empty: true, error: null });
  expect(errors).toEqual([]);
});

test('reports a real failed video source instead of remaining in loading state', async ({ page }) => {
  await page.route('**/broken-native.mp4', route => route.fulfill({ status: 404, body: 'Missing' }));
  await prepare(page);
  await page.evaluate(async () => {
    const state = (window as any).nativeTest;
    state.session = state.lib.createMediaPreviewDriver().createSession(state.host);
    await state.session.load('/broken-native.mp4', { descriptor: { source: '/broken-native.mp4', name: 'broken.mp4', extension: 'mp4' } });
  });
  await expect.poll(() => page.evaluate(() => (window as any).nativeTest.session.getState().error)).toContain('codec');
  expect(await page.evaluate(() => {
    const { session } = (window as any).nativeTest; const state = session.getState(); session.destroy(); return state.loading;
  })).toBe(false);
});

test('shows an uploaded HTML file through the demo', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('./?view=preview');
  await page.locator('input[type=file]').setInputFiles({ name: 'preview.html', mimeType: 'text/html', buffer: Buffer.from('<h1>Readable preview</h1><p>Local HTML</p>') });
  await expect(page.frameLocator('iframe.pptxv-native-html-frame').locator('h1')).toHaveText('Readable preview');
  await expect(page.locator('.wb-note.is-error')).toHaveCount(0); expect(errors).toEqual([]);
});
