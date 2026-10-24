import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test('opens 200,000 code lines, preserves selection, and aligns the last line number after scrolling', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/core/src/preview/index.ts')}`, page.url()).href;
  const result = await page.evaluate(async moduleUrl => {
    const lib = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0'; document.body.replaceChildren(host);
    const text = Array.from({ length: 200_000 }, (_, i) => `const row${i + 1} = ${i + 1};`).join('\n');
    const source = new TextEncoder().encode(text);
    const session = lib.createTextPreviewDriver().createSession(host);
    await session.load(source, { descriptor: { source, name: 'large.js' }, route: lib.resolveFormatRoute({ name: 'large.js' }) });
    const root = host.querySelector('.pptxv-native-preview') as HTMLElement;
    const pre = host.querySelector('pre')!, gutter = host.querySelector('.pptxv-native-text-gutter')!;
    root.scrollTop = root.scrollHeight;
    const lastLineRect = (element: Element) => {
      const node = element.firstChild!;
      const range = document.createRange(); range.setStart(node, node.textContent!.lastIndexOf('\n') + 1); range.setEnd(node, node.textContent!.length);
      return { range, rect: range.getBoundingClientRect() };
    };
    const bodyLine = lastLineRect(pre), numberLine = lastLineRect(gutter);
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(bodyLine.range);
    const result = { lineCount: session.getState().lineCount, contentMatches: pre.textContent === text,
      number: numberLine.range.toString(), selected: selection.toString(), deltaY: Math.abs(bodyLine.rect.y - numberLine.rect.y),
      visible: bodyLine.rect.top >= 0 && bodyLine.rect.bottom <= innerHeight,
      gutterElements: gutter.childElementCount };
    session.destroy();
    return { ...result, empty: !host.childElementCount };
  }, moduleUrl);
  expect(result).toMatchObject({ lineCount: 200_000, contentMatches: true, number: '200000',
    selected: 'const row200000 = 200000;', visible: true, empty: true });
  expect(result.deltaY).toBeLessThan(1);
  expect(result.gutterElements).toBeLessThan(100);
  expect(errors).toEqual([]);
});

test('keeps the current file when a replaced URL finishes late and clears pending work on destroy', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/core/src/preview/index.ts')}`, page.url()).href;
  const result = await page.evaluate(async moduleUrl => {
    const lib = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div'); document.body.replaceChildren(host);
    const session = lib.createTextPreviewDriver().createSession(host);
    const originalFetch = window.fetch;
    let finish!: (response: Response) => void;
    let signal!: AbortSignal;
    window.fetch = (_source, options) => { signal = options!.signal!; return new Promise(resolve => { finish = resolve; }); };
    try {
      const events: string[] = [], sessionErrors: string[] = [];
      session.on('rendered', state => events.push(state.title));
      session.on('error', error => sessionErrors.push(String(error)));
      const pending = session.load('/slow.txt', { descriptor: { source: '/slow.txt', name: 'old.txt' } });
      const source = new TextEncoder().encode('current');
      await session.load(source, { descriptor: { source, name: 'current.txt' } });
      const abortedOnReplace = signal.aborted;
      finish(new Response('stale')); await pending;
      const current = host.querySelector('pre')?.textContent;
      const destroyed = session.load('/slow-again.txt', { descriptor: { source: '/slow-again.txt', name: 'destroyed.txt' } });
      session.destroy(); const abortedOnDestroy = signal.aborted;
      finish(new Response('destroyed')); await destroyed;
      return { current, events, sessionErrors, abortedOnReplace, abortedOnDestroy, empty: !host.childElementCount };
    } finally { window.fetch = originalFetch; session.destroy(); }
  }, moduleUrl);
  expect(result).toEqual({ current: 'current', events: ['current.txt'], sessionErrors: [], abortedOnReplace: true, abortedOnDestroy: true, empty: true });
  expect(errors).toEqual([]);
});

test('previews highlighted code through the demo upload flow', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('./?view=preview');
  const text = 'const answer: number = 42;\nconsole.log(answer);';
  await page.locator('input[type="file"]').setInputFiles({ name: 'answer.ts', mimeType: 'text/plain', buffer: Buffer.from(text) });
  await expect(page.locator('pre.pptxv-native-text')).toHaveText(text);
  await expect(page.locator('.pptxv-native-text-gutter')).toHaveText('1\n2');
  await expect(page.locator('.pptxv-token--keyword').first()).toHaveText('const');
  await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
  expect(errors).toEqual([]);
});
