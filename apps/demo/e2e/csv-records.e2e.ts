import { expect, test } from '@playwright/test';

test('previews multiline CSV and loads its final empty quoted row', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./?view=preview');
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const note = '中文😀, say "hello"\r\nnext line';
  const csv = ['Name,Note', ...Array.from({ length: 100 }, (_, index) => `${index + 1},${quote(note)}`), '""'].join('\r\n');
  await page.locator('input[type="file"]').setInputFiles({ name: 'quoted-records.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.locator('.wb-preview-title strong')).toHaveText('quoted-records.csv');
  const rows = page.locator('.xlsxv-table tbody tr');
  await expect(rows).toHaveCount(100);
  expect(await rows.nth(1).locator('td').allTextContents()).toEqual(['1', note]);
  await page.locator('.xlsxv-grid').evaluate(grid => { grid.scrollTop = grid.scrollHeight; });
  await expect(rows).toHaveCount(102);
  await expect(rows.last().locator('th')).toHaveText('102');
  expect(await rows.last().locator('td').allTextContents()).toEqual(['', '']);
  await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
  expect(errors).toEqual([]);
});
