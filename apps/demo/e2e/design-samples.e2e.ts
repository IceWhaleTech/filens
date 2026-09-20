import { expect, test } from '@playwright/test';

test('renders the showcase design samples', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Design', exact: true }).click();

  for (const [format, name, selector] of [
    ['DXF', 'neon-city.dxf', '.cadv-preview svg'],
    ['OBJ', 'crystal-crown.obj', '.model3dv-canvas'],
    ['MM', 'moonshot-2035.mm', '.mindmapv-node'],
    ['DRAWIO', 'ai-command-center.drawio', '.diagramv-node'],
    ['PSD', 'chromatic-layers.psd.svg', 'img.pptxv-native-image'],
    ['AI', 'neon-orbit.ai.svg', 'img.pptxv-native-image'],
    ['EPS', 'signal-void.eps.svg', 'img.pptxv-native-image'],
    ['PS', 'future-grid.ps.svg', 'img.pptxv-native-image']
  ] as const) {
    await page.getByRole('button', { name: format, exact: true }).click();
    await expect(page.locator('.wb-preview-title strong')).toHaveText(name);
    await expect(page.locator(selector).first()).toBeVisible();
    await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
  }
});
