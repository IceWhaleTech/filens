import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { createWorkbookFixture } from '../../../packages/xlsx/test/fixtures/workbook.mjs';

test('keeps workbook values/formulas while appending rows and resets scrolling on sheet changes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/xlsx/src/index.ts')}`, page.url()).href;
  await page.evaluate(async ({ moduleUrl, bytes }) => {
    const { createXlsxPreviewDriver } = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div');
    host.id = 'workbook-lifecycle-test'; host.style.cssText = 'position:fixed;inset:0;width:800px;height:600px;background:white';
    document.body.replaceChildren(host);
    const session = createXlsxPreviewDriver().createSession(host);
    (window as any).workbookLifecycle = { session, host };
    const source = new Uint8Array(bytes);
    await session.load(source, { descriptor: { source, name: 'sheets.xlsx', extension: 'xlsx' } });
  }, { moduleUrl, bytes: [...await createWorkbookFixture()] });
  const rows = page.locator('.xlsxv-table tbody tr'), grid = page.locator('.xlsxv-grid');
  await expect(rows).toHaveCount(100);
  expect(await rows.first().locator('td').allTextContents()).toEqual(['First 1', '7', '21']);
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; });
  await expect(rows).toHaveCount(200);
  await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; });
  await expect(rows).toHaveCount(240);
  expect(await rows.last().locator('td').allTextContents()).toEqual(['First 240', '1680', '']);
  await page.evaluate(() => (window as any).workbookLifecycle.session.next());
  await expect(rows).toHaveCount(100);
  expect(await rows.first().locator('td').allTextContents()).toEqual(['Second 1', '7', '21']);
  expect(await grid.evaluate(grid => grid.scrollTop)).toBe(0);
  await page.evaluate(() => (window as any).workbookLifecycle.session.prev());
  await expect(rows).toHaveCount(100);
  expect(await rows.first().locator('td').allTextContents()).toEqual(['First 1', '7', '21']);
  await page.evaluate(() => (window as any).workbookLifecycle.session.destroy());
  await expect(page.locator('#workbook-lifecycle-test')).toBeEmpty();
  expect(errors).toEqual([]);
});

test('discards replaced, aborted and destroyed CSV/XLSX reads without stale events', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/xlsx/src/index.ts')}`, page.url()).href;
  const results = await page.evaluate(async moduleUrl => {
    const { createXlsxPreviewDriver } = await import(/* @vite-ignore */ moduleUrl);
    const results = [];
    for (const format of ['csv', 'xlsx']) for (const action of ['replace', 'abort', 'destroy']) {
      const host = document.createElement('div'); document.body.replaceChildren(host);
      const session = createXlsxPreviewDriver().createSession(host);
      let rendered = 0, reportedErrors = 0, finish!: (value: any) => void;
      session.on('rendered', () => rendered++); session.on('error', () => reportedErrors++);
      const source = new Blob([]);
      Object.defineProperty(source, format === 'csv' ? 'text' : 'arrayBuffer', { value: () => new Promise(resolve => { finish = resolve; }) });
      const controller = new AbortController();
      const pending = session.load(source, { descriptor: { source, extension: format }, signal: controller.signal })
        .then(() => 'settled', (error: Error) => error.name);
      if (action === 'replace') {
        const current = new TextEncoder().encode('Current,42');
        await session.load(current, { descriptor: { source: current, extension: 'csv', name: 'current.csv' } });
      } else if (action === 'abort') controller.abort();
      else session.destroy();
      finish(format === 'csv' ? 'Stale,7' : new ArrayBuffer(0));
      const outcome = await pending;
      const correctContent = action === 'replace' ? host.querySelector('.xlsxv-table')?.textContent?.includes('Current') : !host.querySelector('.xlsxv-table');
      const state = session.getState(); session.destroy();
      results.push({ format, action, outcome, rendered, reportedErrors, correctContent, loading: state.loading });
    }
    return results;
  }, moduleUrl);
  expect(results).toHaveLength(6);
  for (const result of results) expect(result).toMatchObject({ outcome: result.action === 'abort' ? 'AbortError' : 'settled', rendered: result.action === 'replace' ? 1 : 0, reportedErrors: 0, correctContent: true, loading: false });
  expect(errors).toEqual([]);
});
