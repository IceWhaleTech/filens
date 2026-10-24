import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

async function prepare(page: Page) {
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/iwork/src/index.ts')}`, page.url()).href;
  await page.evaluate(async moduleUrl => {
    const lib = await import(/* @vite-ignore */ moduleUrl), host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0'; document.body.replaceChildren(host);
    const urls = new Set<string>(), create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); urls.add(url); return url; };
    URL.revokeObjectURL = url => { urls.delete(url); revoke(url); };
    const NativeWorker = Worker, workers: { terminated: boolean }[] = [];
    window.Worker = class extends NativeWorker {
      record: { terminated: boolean };
      constructor(url: string | URL, options?: WorkerOptions) { super(url, options); this.record = { terminated: false }; workers.push(this.record); }
      postMessage(message: any, transfer: Transferable[]) { super.postMessage(message, transfer); if (message.kind === 'document') (window as any).iworkTest.onDocument?.(); }
      terminate() { this.record.terminated = true; super.terminate(); }
    };
    (window as any).iworkTest = { lib, host, urls, workers };
  }, moduleUrl);
}

for (const sample of ['a.numbers', 'a.pages', 'filens-weekend.key']) {
  test(`reuses an idle native Worker and retains caller bytes for ${sample}`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page);
    const actual = await page.evaluate(async sample => {
      const state = (window as any).iworkTest, { lib, host, urls, workers } = state;
      const input = await (await fetch(new URL('samples/' + sample, location.href))).arrayBuffer(), original = input.byteLength;
      const viewer = lib.createIworkViewer(host); await viewer.preview(input);
      let sheets = 0;
      if (viewer.getState().kind === 'numbers') {
        const model = viewer.getState().document;
        for (let index = 0; index < model.sheets.length; index++) {
          viewer.goToSheet(index);
          while (model.sheets[index].loaded === false) await new Promise(resolve => setTimeout(resolve, 5));
          if (host.querySelector('.xlsxv-sheet-tab.is-active')?.textContent !== model.sheets[index].name) throw new Error('Wrong sheet');
          sheets++;
        }
      }
      const first = { kind: viewer.getState().kind, pages: viewer.getState().pageCount, sheets, callerRetained: input.byteLength === original };
      const controller = new AbortController(); await viewer.preview(input, { signal: controller.signal });
      const reused = workers.length === 1 && !workers[0].terminated; controller.abort();
      const cancelled = !host.querySelector('.iworkv-page-shell,.xlsxv-grid') && viewer.getState().document === null && urls.size === 0;
      await viewer.preview(input); const reopened = viewer.getState().kind === first.kind && workers.length === 1;
      viewer.destroy(); return { first, reused, cancelled, reopened, empty: !host.childElementCount, urls: urls.size, terminated: workers.every((worker: any) => worker.terminated) };
    }, sample);
    expect(actual.first).toMatchObject({ kind: sample.endsWith('numbers') ? 'numbers' : sample.endsWith('pages') ? 'pages' : 'key', callerRetained: true });
    if (sample.endsWith('numbers')) expect(actual.first.sheets).toBe(6); else expect(actual.first.pages).toBeGreaterThan(0);
    expect(actual).toMatchObject({ reused: true, cancelled: true, reopened: true, empty: true, urls: 0, terminated: true }); expect(errors).toEqual([]);
  });
}

test('terminates real busy parsing and reopens using the same viewer', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page);
  const result = await page.evaluate(async () => {
    const state = (window as any).iworkTest, { lib, host, workers, urls } = state;
    const bytes = await (await fetch(new URL('samples/a.numbers', location.href))).arrayBuffer();
    const viewer = lib.createIworkViewer(host), controller = new AbortController(); let rendered = 0, reportedErrors = 0;
    viewer.on('rendered', () => rendered++); viewer.on('error', () => reportedErrors++);
    state.onDocument = () => queueMicrotask(() => controller.abort());
    const settled = await viewer.preview(bytes, { signal: controller.signal }).then(() => 'done', (error: Error) => error.name);
    state.onDocument = null; const stopped = workers.length === 1 && workers[0].terminated;
    const clean = viewer.getState().document === null && !viewer.getState().loading && urls.size === 0;
    await viewer.preview(bytes); const reopened = viewer.getState().sheetCount === 6 && workers.length === 2;
    viewer.destroy(); return { settled, stopped, clean, reopened, rendered, reportedErrors, urls: urls.size };
  });
  expect(result).toEqual({ settled: 'AbortError', stopped: true, clean: true, reopened: true, rendered: 1, reportedErrors: 0, urls: 0 }); expect(errors).toEqual([]);
});

test('keeps the active document when an obsolete Blob completes after replacement', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const { lib, host } = (window as any).iworkTest, viewer = lib.createIworkViewer(host);
    const bytes = await (await fetch(new URL('samples/filens-weekend.key', location.href))).arrayBuffer();
    let finish!: (bytes: ArrayBuffer) => void, rendered = 0; viewer.on('rendered', () => rendered++);
    const blob = new Blob([]); Object.defineProperty(blob, 'arrayBuffer', { value: () => new Promise(resolve => { finish = resolve; }) });
    const old = viewer.preview(blob); await viewer.preview(bytes); await old; finish(new ArrayBuffer(3));
    await new Promise(resolve => setTimeout(resolve, 30));
    const state = viewer.getState(); viewer.destroy(); return { rendered, kind: state.kind, pages: state.pageCount, error: state.error };
  });
  expect(result).toEqual({ rendered: 1, kind: 'key', pages: 3, error: null });
});

test('uploads all native iWork formats through the demo', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await page.goto('./?view=preview');
  for (const sample of ['a.numbers', 'a.pages', 'filens-weekend.key']) {
    await page.locator('input[type=file]').setInputFiles(resolve('apps/demo/public/samples/' + sample));
    await expect(page.locator('.wb-preview-title strong')).toHaveText(sample);
    await expect(page.locator(sample.endsWith('numbers') ? '.xlsxv-sheet-tabs' : '.iworkv-page-shell').first()).toBeVisible();
    await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
