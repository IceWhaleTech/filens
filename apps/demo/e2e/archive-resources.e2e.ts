import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

for (const format of ['pax', 'gnu']) {
  test(`browses and reads long ${format} TAR paths`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('./');
    const moduleUrl = new URL(`@fs${resolve('packages/archive/src/index.ts')}`, page.url()).href;
    const bytes = [...await readFile(resolve(`packages/archive/test/fixtures/${format}-long-path.tar`))];
    const result = await page.evaluate(async ({ moduleUrl, bytes, format }) => {
      const { createArchivePreviewDriver, createArchiveResourceIndex } = await import(/* @vite-ignore */ moduleUrl);
      const source = new Uint8Array(bytes);
      const context = { descriptor: { name: `${format}.tar`, extension: 'tar' } };
      const index = await createArchiveResourceIndex(source, context);
      const name = `目录/${'long-file-name-'.repeat(12)}预览.txt`;
      const text = await index.read(name)?.readAsText();
      const host = document.createElement('div');
      host.id = 'long-tar-test';
      document.body.replaceChildren(host);
      const session = createArchivePreviewDriver().createSession(host);
      await session.load(source, context);
      (window as any).archiveResourceTest = session;
      return { text, files: index.files.map(entry => entry.name), error: session.getState().error };
    }, { moduleUrl, bytes, format });
    expect(result.error).toBeNull();
    expect(result.text).toBe('Long path preview: 中文内容\n');
    expect(result.files).toHaveLength(2);
    const rootNames = await page.locator('tr.archivev-row').allTextContents();
    expect(rootNames.join(' ')).toContain('目录/');
    await page.locator('tr.archivev-row').filter({ hasText: '目录/' }).click();
    await expect(page.locator('tr.archivev-row')).toHaveCount(1);
    await expect(page.locator('tr.archivev-row')).toContainText(`${'long-file-name-'.repeat(12)}预览.txt`);
    await page.locator('button.archivev-breadcrumb').first().click();
    await expect(page.locator('tr.archivev-row')).toHaveCount(2);
    await page.evaluate(() => (window as any).archiveResourceTest.destroy());
    await expect(page.locator('#long-tar-test')).toBeEmpty();
    expect(errors).toEqual([]);
  });
}
