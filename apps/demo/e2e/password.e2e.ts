import { expect, test } from '@playwright/test';
import path from 'node:path';

const fixtures = path.resolve('packages/converter-client/test/fixtures/password');
const officePassword = ' filens 密码🔐 ';

for (const [fixture, selector, text, password] of [
  ['agile.docx', 'section.docx', 'Fixture DOCX document', officePassword],
  ['agile.xlsx', '.xlsxv-preview', 'Fixture XLSX workbook', officePassword],
  ['agile.pptx', '.pptxv-slide', 'Fixture PPTX presentation slide', officePassword],
  ['encrypted.pdf', 'canvas.pdfv-page[data-rendered="true"]', '', 'test123'],
  ['reference/ecma376standard_password.docx', 'section.docx', 'lorem ipsum', 'Password1234_']
]) {
  test(`opens encrypted ${fixture} after correcting a wrong password`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('./?view=preview');
    await page.locator('input[type=file]').setInputFiles(path.join(fixtures, fixture));
    const field = page.getByLabel('文档密码', { exact: true });
    await expect(field).toBeVisible();
    await expect(field).toBeFocused();
    await field.fill('wrong');
    await field.press('Enter');
    await expect(page.getByRole('alert')).toContainText('密码不正确，请重试。');
    await expect(field).toHaveValue('');
    await field.fill(password);
    await field.press('Enter');
    await expect(field).toHaveCount(0);
    await expect(page.locator(selector).first()).toBeVisible();
    if (text) await expect(page.locator(selector).first()).toContainText(text);
    await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('cancels password entry, reopens it and clears it when switching documents', async ({ page }) => {
  await page.goto('./?view=preview');
  await page.locator('input[type=file]').setInputFiles(path.join(fixtures, 'agile.docx'));
  const field = page.getByLabel('文档密码', { exact: true });
  await expect(field).toBeVisible();
  await field.fill('secret that must be cleared');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(field).toHaveCount(0);
  await page.getByRole('button', { name: '重新输入密码' }).click();
  await expect(field).toHaveValue('');
  await page.locator('input[type=file]').setInputFiles({ name: 'hello.txt', mimeType: 'text/plain', buffer: Buffer.from('A different document') });
  await expect(field).toHaveCount(0);
  await expect(page.locator('.wb-preview-stage')).toContainText('A different document');
  await page.locator('input[type=file]').setInputFiles(path.join(fixtures, 'agile.docx'));
  await expect(field).toHaveValue('');
});
