import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('opens the Agent console from the homepage and serves the distributable skill', async ({ page }) => {
  const skill = await readFile('skills/filens/SKILL.md', 'utf8');
  await page.goto('./');
  await page.getByRole('link', { name: 'Agent', exact: true }).click();
  await expect(page).toHaveURL(/view=agent/);
  await expect(page.getByRole('heading', { name: 'Agent 控制台', exact: true })).toBeAttached();
  await expect(page.getByRole('region', { name: 'Agent 能力', exact: true }).getByRole('article')).toHaveCount(6);
  await expect(page.locator('.wb-preview-stage')).toHaveCount(0);
  await page.getByRole('button', { name: '给 Agent 看 SKILL.md 原文', exact: true }).click();
  await expect(page.getByRole('button', { name: '给 Agent 看 SKILL.md 原文', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('SKILL.md 原文', { exact: true })).toHaveText(skill);
  const response = await page.request.get('./skills/filens/SKILL.md');
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toMatch(/text\/markdown/);
  expect(await response.text()).toBe(skill);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: '下载 SKILL.md', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('SKILL.md');
  expect(await readFile((await download.path())!, 'utf8')).toBe(skill);
  await page.goBack();
  await expect(page.locator('.landing')).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: '让 Agent 读懂你的文件。', exact: true })).toBeVisible();
});

test('copies installation commands, a matching Agent prompt and the original skill', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('./?view=agent');
  await page.getByRole('button', { name: '一键安装 Skill', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('npx --yes skills add IceWhaleTech/filens --skill filens --global --yes');
  await expect(page.locator('.agent-feedback')).toHaveText('安装命令已复制，请在终端运行。');
  await page.getByRole('combobox', { name: '目标 Agent', exact: true }).selectOption('codex');
  await page.getByRole('combobox', { name: '安装范围', exact: true }).selectOption('project');
  await page.getByRole('button', { name: '复制 Skill 安装命令', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('npx --yes skills add IceWhaleTech/filens --skill filens --agent codex --yes');
  await page.getByRole('combobox', { name: 'CLI 版本', exact: true }).selectOption('lite');
  await page.getByRole('button', { name: '复制 CLI 安装命令', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('npm install -g filens-cli-lite');
  await page.getByRole('button', { name: '复制给 Agent 的安装提示', exact: true }).click();
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt).toContain('npm install -g filens-cli-lite');
  expect(prompt).toContain('--skill filens --agent codex --yes');
  expect(prompt).not.toContain('--global');
  expect(prompt).toContain('filens capacity --json');
  expect(prompt).toContain(new URL('./skills/filens/SKILL.md', page.url()).href);
  await page.getByRole('button', { name: '复制跨文件搜索命令', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('filens search "./documents" --query "预算 风险" --json');
  await page.getByRole('button', { name: '给 Agent 看 SKILL.md 原文', exact: true }).click();
  await page.getByRole('button', { name: '复制 SKILL.md', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await readFile('skills/filens/SKILL.md', 'utf8'));
});

test('keeps the preview mounted when switching to Agent and back', async ({ page }) => {
  await page.goto('./?view=preview&format=pdf');
  await expect(page.locator('canvas.pdfv-page[data-rendered="true"]').first()).toBeVisible();
  await page.getByRole('button', { name: '显示工具栏', exact: true }).click();
  await page.locator('.pptxv-shell').getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('.pptxv-status').first()).toHaveText('2 / 3');
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page).toHaveURL(/view=agent/);
  await expect(page.locator('.wb-preview-stage')).not.toBeVisible();
  await page.getByRole('combobox', { name: '目标 Agent', exact: true }).selectOption('claude-code');
  await page.getByRole('button', { name: '文件预览', exact: true }).click();
  await expect(page).toHaveURL(/view=preview/);
  await expect(page.locator('.pptxv-status').first()).toHaveText('2 / 3');
  await page.goBack();
  await expect(page.getByRole('combobox', { name: '目标 Agent', exact: true })).toHaveValue('claude-code');
  await page.goBack();
  await expect(page.locator('.pptxv-status').first()).toHaveText('2 / 3');
});

test('keeps installation available if clipboard access is denied', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: () => Promise.reject(new Error('Clipboard denied')) }
  }));
  await page.goto('./?view=agent');
  await page.getByRole('button', { name: '一键安装 Skill', exact: true }).click();
  await expect(page.locator('.agent-feedback')).toHaveText('复制失败，请手动选择命令或原文复制。');
  await expect(page.getByRole('button', { name: '一键安装 Skill', exact: true })).toBeVisible();
  await expect(page.locator('.agent-command').filter({ hasText: 'npx --yes skills add' })).toBeVisible();
});

test('fits mobile screens and opens dropped files from the Agent console', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('./?view=agent');
  for (const width of [320, 390, 760]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole('button', { name: '一键安装 Skill', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    expect(await page.locator('.agent-workbench').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.getByRole('button', { name: /给 Agent 看/, exact: false }).click();
    expect(await page.locator('.agent-workbench').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.getByRole('button', { name: /给人看/, exact: false }).click();
  }
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File(['An Agent console drop.'], 'agent-drop.txt', { type: 'text/plain' }));
    return data;
  });
  await page.locator('.agent-workbench').dispatchEvent('drop', { dataTransfer: transfer });
  await expect(page).toHaveURL(/view=preview/);
  await expect(page.locator('.wb-preview-stage')).toContainText('An Agent console drop.');
  await transfer.dispose();
});
