import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createWideMmFixture } from '../../../packages/mindmap/test/fixtures/maps.mjs';

const diagram = '<mxfile><diagram name="A detailed overview of the workflow and its dependencies"><mxGraphModel><root>' +
  [[0, 0], [1600, 0], [0, 1000], [1600, 1000]].map(([x, y], id) =>
    `<mxCell id="n${id}" vertex="1" value="Task ${id}"><mxGeometry x="${x}" y="${y}" width="120" height="60"/></mxCell>`).join('') +
  '</root></mxGraphModel></diagram></mxfile>';

async function mount(page: Page, family: 'mindmap' | 'diagram', options = {}) {
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve(`packages/${family}/src/index.ts`)}`, page.url()).href;
  await page.evaluate(async ({ moduleUrl, family, options, xml }) => {
    const lib = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:440px;background:white';
    document.body.replaceChildren(host);
    const session = lib[family === 'mindmap' ? 'createMindmapPreviewDriver' : 'createDiagramPreviewDriver']().createSession(host, options);
    const source = new TextEncoder().encode(xml);
    await session.load(source, { descriptor: { source, extension: family === 'mindmap' ? 'mm' : 'drawio' } });
    (window as any).svgFit = { host, session, family, svg: host.querySelector('svg') };
  }, { moduleUrl, family, options, xml: family === 'mindmap' ? createWideMmFixture(30, true) : diagram });
}

async function geometry(page: Page) {
  return page.evaluate(() => {
    const { host, session, family, svg } = (window as any).svgFit;
    const root = host.firstElementChild as HTMLElement;
    const canvas = host.querySelector(`.${family}v-canvas`) as SVGSVGElement;
    const summary = host.querySelector(`.${family}v-summary`) as HTMLElement;
    const box = canvas.viewBox.baseVal, rect = canvas.getBoundingClientRect();
    return { scale: session.getState().scale, width: rect.width, height: rect.height,
      naturalWidth: box.width, naturalHeight: box.height,
      availableWidth: root.clientWidth, availableHeight: root.clientHeight - summary.offsetHeight,
      clientHeight: root.clientHeight, scrollWidth: root.scrollWidth, scrollHeight: root.scrollHeight,
      scrollLeft: root.scrollLeft, scrollTop: root.scrollTop, sameSvg: svg === canvas,
      selected: host.querySelectorAll('.is-selected').length };
  });
}

async function expectFit(page: Page, mode: 'contain' | 'width' | 'height') {
  await expect.poll(async () => {
    const g = await geometry(page);
    const expected = mode === 'width' ? g.availableWidth / g.naturalWidth : mode === 'height'
      ? g.availableHeight / g.naturalHeight : Math.min(g.availableWidth / g.naturalWidth, g.availableHeight / g.naturalHeight);
    return Math.abs(g.scale - expected);
  }).toBeLessThan(0.00001);
  const g = await geometry(page);
  expect(g.width).toBeCloseTo(g.naturalWidth * g.scale, 1);
  expect(g.height).toBeCloseTo(g.naturalHeight * g.scale, 1);
  if (mode !== 'height') expect(g.scrollWidth).toBeLessThanOrEqual(g.availableWidth + 1);
  if (mode !== 'width') expect(g.scrollHeight).toBeLessThanOrEqual(g.clientHeight + 1);
  expect(g.sameSvg).toBe(true);
  return g;
}

for (const family of ['mindmap', 'diagram'] as const) {
  test(`${family} fits its SVG to the viewport, width and height without rebuilding nodes`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await mount(page, family);
    await expectFit(page, 'contain');
    await page.locator(`.${family}v-node`).last().click();
    for (const mode of ['width', 'height', 'contain'] as const) {
      await page.evaluate(mode => (window as any).svgFit.session.fit(mode), mode);
      const g = await expectFit(page, mode);
      expect(g.scrollLeft).toBe(0); expect(g.scrollTop).toBe(0); expect(g.selected).toBe(1);
    }
    await page.evaluate(() => (window as any).svgFit.session.fit('none'));
    expect((await geometry(page)).scale).toBe(1);
    expect(errors).toEqual([]);
    await page.evaluate(() => (window as any).svgFit.session.destroy());
  });

  test(`${family} resizes fitted views and removes empty scroll space at manual zoom`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await mount(page, family, { fit: 'none', initialScale: 1.3 });
    expect((await geometry(page)).scale).toBe(1.3);
    await page.evaluate(() => {
      const { session, host } = (window as any).svgFit;
      session.pan(200, 200); session.setScale(0.25);
      host.style.width = '800px'; host.style.height = '600px';
    });
    await expect.poll(async () => (await geometry(page)).clientHeight).toBe(600);
    let g = await geometry(page);
    expect(g.width).toBeCloseTo(g.naturalWidth * 0.25, 1);
    expect(g.height).toBeCloseTo(g.naturalHeight * 0.25, 1);
    expect(g.scrollWidth).toBeLessThanOrEqual(g.availableWidth + 1);
    expect(g.scrollHeight).toBeLessThanOrEqual(g.clientHeight + 1);
    await page.locator(`.${family}v-node`).last().click();
    await page.evaluate(() => (window as any).svgFit.host.style.width = '740px');
    await expect.poll(async () => (await geometry(page)).availableWidth).toBe(740);
    expect((await geometry(page)).scale).toBe(0.25);
    await page.evaluate(() => (window as any).svgFit.session.fit('contain'));
    await expectFit(page, 'contain');
    // A compact host also catches the old 320px minimum-height overflow.
    await page.evaluate(() => {
      const { host } = (window as any).svgFit;
      host.style.width = '240px'; host.style.height = '180px';
    });
    await expect.poll(async () => (await geometry(page)).clientHeight).toBe(180);
    g = await expectFit(page, 'contain');
    expect(g.scale).toBeLessThan(0.25); expect(g.selected).toBe(1);
    await page.evaluate(() => (window as any).svgFit.host.style.display = 'none');
    await expect.poll(async () => (await geometry(page)).clientHeight).toBe(0);
    expect((await geometry(page)).scale).toBe(g.scale);
    await page.evaluate(() => {
      const { host } = (window as any).svgFit;
      host.style.display = ''; host.style.width = '500px'; host.style.height = '400px';
    });
    await expect.poll(async () => (await geometry(page)).clientHeight).toBe(400);
    await expectFit(page, 'contain');
    await page.evaluate(() => (window as any).svgFit.session.destroy());
    await page.setViewportSize({ width: 900, height: 700 });
    await expect(page.locator(`.${family}v-preview`)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('keeps the demo fit toolbar and zoom percentage in sync for both SVG drivers', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('./?view=preview');
  await page.getByRole('button', { name: '显示工具栏', exact: true }).click();
  for (const [family, name, xml] of [
    ['mindmap', 'plan.mm', createWideMmFixture(30, true)],
    ['diagram', 'flow.drawio', diagram]
  ]) {
    await page.locator('input[type="file"]').setInputFiles({ name, mimeType: 'application/xml', buffer: Buffer.from(xml) });
    const canvas = page.locator(`svg.${family}v-canvas`);
    await expect(canvas).toBeVisible();
    const shell = page.locator('.pptxv-generic-shell');
    for (const mode of ['Width', 'Height', 'Fit']) {
      await shell.getByRole('button', { name: mode, exact: true }).click();
      await expect.poll(async () => canvas.evaluate((svg: SVGSVGElement, mode) => {
        const root = svg.closest('[class$="v-preview"]') as HTMLElement;
        const summary = root.firstElementChild as HTMLElement, rect = svg.getBoundingClientRect(), box = svg.viewBox.baseVal;
        const width = root.clientWidth / box.width, height = (root.clientHeight - summary.offsetHeight) / box.height;
        return Math.abs(rect.width / box.width - (mode === 'Width' ? width : mode === 'Height' ? height : Math.min(width, height)));
      }, mode)).toBeLessThan(0.0001);
      const percentage = await canvas.evaluate((svg: SVGSVGElement) =>
        `${Math.round(svg.getBoundingClientRect().width / svg.viewBox.baseVal.width * 100)}%`);
      await expect(shell.locator('.pptxv-status').filter({ hasText: /^\d+%$/ })).toHaveText(percentage);
    }
  }
  expect(errors).toEqual([]);
});
