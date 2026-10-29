import { expect, test } from '@playwright/test';

test('searches formats across families and recovers from an empty search', async ({ page }) => {
  await page.goto('./?view=preview');
  const search = page.getByRole('searchbox', { name: '搜索文件格式' });
  await search.fill('.obj');
  await expect(page.getByRole('button', { name: 'OBJ', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'OBJ', exact: true }).click();
  await expect(page.locator('.wb-preview-title strong')).toHaveText('viking-helmet.obj');
  await expect(page.locator('canvas.model3dv-canvas')).toBeVisible();
  await expect(search).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Design', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await search.fill('no-such-format');
  await expect(page.getByText('没有找到这个格式', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '查看全部格式', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(page.getByRole('button', { name: 'OBJ', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('imports local files with both the picker and drag and drop', async ({ page }) => {
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'local-note.txt', mimeType: 'text/plain', buffer: Buffer.from('A file from the local picker.') });
  await expect(page.locator('.wb-preview-stage')).toContainText('A file from the local picker.');
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File(['A file opened by dropping it.'], 'dropped.txt', { type: 'text/plain' }));
    return data;
  });
  await page.locator('.wb-preview-stage').dispatchEvent('dragenter', { dataTransfer: transfer });
  await expect(page.getByText('松开，打开文件', { exact: true })).toBeVisible();
  await page.locator('.wb-preview-stage').dispatchEvent('drop', { dataTransfer: transfer });
  await expect(page.locator('.wb-drop-overlay')).toHaveCount(0);
  await expect(page.locator('.wb-preview-title strong')).toHaveText('dropped.txt');
  await expect(page.locator('.wb-preview-stage')).toContainText('A file opened by dropping it.');
  await expect(page.locator('.wb-workspace-label')).toContainText('本地文件');
  await transfer.dispose();
});

test('opens remote files from an accessible dialog and shows fetch errors', async ({ page }) => {
  await page.route('https://files.example.test/note.txt', route => route.fulfill({ body: 'A remote document.', contentType: 'text/plain' }));
  await page.route('https://files.example.test/missing.doc', route => route.fulfill({ status: 404, body: 'Missing' }));
  await page.goto('./?view=preview');
  const opener = page.getByRole('button', { name: '通过链接打开', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('文件 URL', { exact: true })).toBeFocused();
  await dialog.getByLabel('文件 URL', { exact: true }).fill('https://files.example.test/note.txt');
  await dialog.getByRole('button', { name: '打开预览', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.wb-preview-stage')).toContainText('A remote document.');
  await expect(opener).toBeFocused();
  await opener.click();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
  await opener.click();
  await dialog.getByLabel('文件 URL', { exact: true }).fill('https://files.example.test/missing.doc');
  await dialog.getByRole('button', { name: '打开预览', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('404');
  await expect(page.locator('.wb-status')).toHaveText('预览失败');
});

test('expands the preview without reloading it and keeps diagnostics in details', async ({ page }) => {
  await page.goto('./?view=preview&format=pdf');
  const canvas = page.locator('canvas.pdfv-page[data-rendered="true"]').first();
  await expect(canvas).toBeVisible();
  const initialWidth = await page.locator('.wb-preview').evaluate(element => element.clientWidth);
  await page.getByRole('button', { name: '显示工具栏', exact: true }).click();
  await page.locator('.pptxv-shell').getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('.pptxv-status').first()).toHaveText('2 / 3');
  await page.getByRole('button', { name: '收起格式面板', exact: true }).click();
  await expect(page.locator('.wb-sidebar')).not.toBeVisible();
  expect(await page.locator('.wb-preview').evaluate(element => element.clientWidth)).toBeGreaterThan(initialWidth);
  await expect(page.locator('.pptxv-status').first()).toHaveText('2 / 3');
  await page.getByRole('button', { name: '文件详情', exact: true }).click();
  await expect(page.locator('.wb-file-facts')).toContainText('PDF');
  await expect(page.locator('.wb-build-stat').first()).not.toBeVisible();
  await page.getByText('运行与构建信息', { exact: true }).click();
  await expect(page.locator('.wb-build-stat').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.wb-details')).toHaveCount(0);
  await page.getByRole('button', { name: '展开格式面板', exact: true }).click();
  await expect(page.locator('.wb-sidebar')).toBeVisible();
});

test('keeps the mobile preview usable with a dismissible format drawer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./?view=preview');
  await expect(page.locator('.wb-sidebar')).not.toBeVisible();
  await page.getByRole('button', { name: '展开格式面板', exact: true }).click();
  await expect(page.locator('.wb-sidebar')).toBeVisible();
  await page.getByRole('button', { name: 'PDF', exact: true }).click();
  await expect(page.locator('.wb-sidebar')).not.toBeVisible();
  await expect(page.locator('canvas.pdfv-page[data-rendered="true"]').first()).toBeVisible();
  for (const width of [320, 390, 760]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    const preview = await page.locator('.wb-preview').boundingBox();
    expect(preview?.height).toBeGreaterThan(500);
  }
});
