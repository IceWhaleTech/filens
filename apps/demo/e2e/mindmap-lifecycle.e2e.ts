import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import { createPackagedMapFixtures, mixedMmFixture } from '../../../packages/mindmap/test/fixtures/maps.mjs';

async function fixtures() {
  return [
    { name: 'freemind', format: 'mm', bytes: new TextEncoder().encode(mixedMmFixture) },
    { name: 'outline', format: 'opml', bytes: new TextEncoder().encode('<opml><body><outline text="Plan"><outline text="First"/><outline text="Last"/></outline></body></opml>') },
    ...await createPackagedMapFixtures(JSZip)
  ].map(fixture => ({ ...fixture, bytes: [...fixture.bytes] }));
}

test('renders and selects nodes in MM, OPML, both XMind variants and MindManager', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/mindmap/src/index.ts')}`, page.url()).href;
  await page.evaluate(async moduleUrl => {
    const { createMindmapPreviewDriver } = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0;background:white';
    document.body.replaceChildren(host);
    (window as any).mindmapLifecycle = { host, session: createMindmapPreviewDriver().createSession(host) };
  }, moduleUrl);
  for (const fixture of await fixtures()) {
    const count = await page.evaluate(async ({ bytes, format }) => {
      const { host, session } = (window as any).mindmapLifecycle;
      const source = new Uint8Array(bytes);
      await session.load(source, { descriptor: { source, extension: format } });
      return host.querySelectorAll('.mindmapv-node').length;
    }, fixture);
    expect(count).toBe(fixture.format === 'mm' ? 5 : fixture.format === 'opml' ? 3 : 4);
    const last = page.locator('.mindmapv-node').last();
    await last.click();
    await expect(last).toHaveClass(/is-selected/);
    expect(await page.evaluate(() => (window as any).mindmapLifecycle.session.getState().selectedNodeId))
      .toBe(await last.getAttribute('data-node-id'));
    await page.evaluate(() => (window as any).mindmapLifecycle.session.setScale(1.3));
    const scale = await page.locator('svg.mindmapv-canvas').evaluate((svg: SVGSVGElement) =>
      svg.getBoundingClientRect().width / svg.viewBox.baseVal.width);
    expect(scale).toBeCloseTo(1.3, 3);
  }
  expect(errors).toEqual([]);
  await page.evaluate(() => (window as any).mindmapLifecycle.session.destroy());
  await expect(page.locator('svg.mindmapv-canvas')).toHaveCount(0);
});

test('ignores replaced, cancelled and destroyed reads for every mind-map loader', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/mindmap/src/index.ts')}`, page.url()).href;
  const results = await page.evaluate(async ({ moduleUrl, fixtures }) => {
    const { createMindmapPreviewDriver } = await import(/* @vite-ignore */ moduleUrl);
    const results = [];
    for (const fixture of fixtures) {
      const host = document.createElement('div'); document.body.replaceChildren(host);
      const session = createMindmapPreviewDriver().createSession(host);
      let rendered = 0, errors = 0;
      session.on('rendered', () => rendered++); session.on('error', () => errors++);
      const delayed = () => {
        let finish!: (value: any) => void, reject!: (error: Error) => void;
        const source = new Blob([]);
        const promise = new Promise((resolve, fail) => { finish = resolve; reject = fail; });
        Object.defineProperty(source, ['mm', 'opml'].includes(fixture.format) ? 'text' : 'arrayBuffer', { value: () => promise });
        return { source, release: () => finish(['mm', 'opml'].includes(fixture.format) ? '<invalid/>' : new ArrayBuffer(0)), reject };
      };
      const load = (source: Blob | Uint8Array, signal?: AbortSignal) => session.load(source, { descriptor: { source, extension: fixture.format }, signal });
      const old = delayed(), pending = load(old.source);
      await load(new Uint8Array(fixture.bytes));
      const html = host.innerHTML, selected = session.getState().selectedNodeId;
      old.release(); await pending;
      const preserved = host.innerHTML === html && session.getState().selectedNodeId === selected;
      const failed = delayed(), failure = load(failed.source);
      await load(new Uint8Array(fixture.bytes));
      failed.reject(new Error('Old read failed')); await failure;
      const preservedAfterError = host.innerHTML === html && session.getState().error === null;
      const controller = new AbortController(), cancelled = delayed();
      const cancellation = load(cancelled.source, controller.signal).then(() => 'loaded', (error: Error) => error.name);
      controller.abort(); cancelled.release(); const aborted = await cancellation;
      const last = delayed(), unfinished = load(last.source);
      session.destroy(); last.release(); await unfinished;
      results.push({ name: fixture.name, preserved, preservedAfterError, aborted, rendered, errors,
        empty: !host.childElementCount, noSelection: session.getState().selectedNodeId === undefined, idle: !session.getState().loading });
    }
    return results;
  }, { moduleUrl, fixtures: await fixtures() });
  for (const result of results) expect(result).toEqual({ name: result.name, preserved: true, preservedAfterError: true,
    aborted: 'AbortError', rendered: 2, errors: 0, empty: true, noSelection: true, idle: true });
  expect(errors).toEqual([]);
});
