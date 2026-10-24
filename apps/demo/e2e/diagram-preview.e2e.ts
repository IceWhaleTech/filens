import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import { createDrawioFixture, createVisioPage, legacyVdxFixture } from '../../../packages/diagram/test/fixtures/diagrams.mjs';

test('retains draw.io pages on invalid navigation and renders missing sizes after paging', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/diagram/src/index.ts')}`, page.url()).href;
  const xml = createDrawioFixture(600).replace('</mxfile>', '<diagram name="Defaults"><mxGraphModel><root><mxCell id="fallback" vertex="1" value="Default size"><mxGeometry x="40" y="40"/></mxCell></root></mxGraphModel></diagram></mxfile>');
  const result = await page.evaluate(async ({ moduleUrl, xml }) => {
    const { createDiagramPreviewDriver } = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0;background:white';
    document.body.replaceChildren(host);
    const session = createDiagramPreviewDriver().createSession(host, { fit: 'none' });
    const source = new TextEncoder().encode(xml);
    await session.load(source, { descriptor: { source, extension: 'drawio' } });
    const root = host.querySelector<HTMLElement>('.diagramv-preview')!;
    session.pan(200, 100);
    const scrolled = root.scrollLeft > 0 && root.scrollTop > 0;
    for (const index of [NaN, Infinity, 0.5]) session.goToPage(index);
    const preserved = session.getState().pageIndex === 0 && host.querySelectorAll('.diagramv-node').length === 600;
    session.next();
    (window as any).diagramPreview = { session, host };
    return { scrolled, preserved, scrollLeft: root.scrollLeft, scrollTop: root.scrollTop, page: session.getState().pageIndex };
  }, { moduleUrl, xml });
  expect(result).toEqual({ scrolled: true, preserved: true, scrollLeft: 0, scrollTop: 0, page: 1 });
  const rect = page.locator('[data-element-id="fallback"] rect');
  await expect(rect).toHaveAttribute('width', '120'); await expect(rect).toHaveAttribute('height', '60');
  expect(await rect.evaluate(element => element.getBoundingClientRect().width)).toBe(120);
  await page.locator('[data-element-id="fallback"]').click();
  expect(await page.evaluate(() => (window as any).diagramPreview.session.getState().selectedElementId)).toBe('fallback');
  expect(errors).toEqual([]);
  await page.evaluate(() => (window as any).diagramPreview.session.destroy());
});

test('shows legacy VDX positions, colors and the Shape connector in VDX and VSDX', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/diagram/src/index.ts')}`, page.url()).href;
  const zip = new JSZip();
  zip.file('visio/pages/page1.xml', '<PageContents><PageSheet><Cell N="PageHeight" V="5"/></PageSheet><Shapes><Shape ID="1" Type="Shape"><Text>Start</Text><Cell N="PinX" V="1.5"/><Cell N="PinY" V="3.5"/><Cell N="Width" V="1.2"/><Cell N="Height" V="0.6"/><Cell N="FillForegnd" V="#dae8fc"/></Shape><Shape ID="2" Type="Shape"><Text>Done</Text><Cell N="PinX" V="4.5"/><Cell N="PinY" V="3.5"/><Cell N="Width" V="1.2"/><Cell N="Height" V="0.6"/></Shape><Shape ID="3" Type="Shape"><Text>Next</Text></Shape></Shapes><Connects><Connect FromSheet="3" FromCell="BeginX" ToSheet="1"/><Connect FromSheet="3" FromCell="EndX" ToSheet="2"/></Connects></PageContents>');
  for (const fixture of [
    { format: 'vdx', bytes: [...new TextEncoder().encode(legacyVdxFixture)] },
    { format: 'vsdx', bytes: [...await zip.generateAsync({ type: 'uint8array' })] }
  ]) {
    const counts = await page.evaluate(async ({ moduleUrl, fixture }) => {
      const { createDiagramPreviewDriver } = await import(/* @vite-ignore */ moduleUrl);
      const previous = (window as any).diagramPreview; previous?.session.destroy();
      const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0;background:white'; document.body.replaceChildren(host);
      const session = createDiagramPreviewDriver().createSession(host, { fit: 'none' });
      const source = new Uint8Array(fixture.bytes); await session.load(source, { descriptor: { source, extension: fixture.format } });
      (window as any).diagramPreview = { host, session };
      return { nodes: host.querySelectorAll('.diagramv-node').length, edges: host.querySelectorAll('.diagramv-edge').length };
    }, { moduleUrl, fixture });
    expect(counts).toEqual({ nodes: 2, edges: 1 });
    const start = page.locator('[data-element-id="1"] rect');
    expect(Number(await start.getAttribute('x'))).toBeCloseTo(86.4);
    expect(Number(await start.getAttribute('y'))).toBeCloseTo(115.2);
    await expect(start).toHaveAttribute('fill', '#dae8fc');
    const edge = page.locator('[data-element-id="3"]');
    const points = await edge.locator('polyline').getAttribute('points');
    const coordinates = points!.split(' ').map(point => point.split(',').map(Number));
    expect(coordinates[0][0]).toBeCloseTo(201.6); expect(coordinates[1][0]).toBeCloseTo(374.4);
    const midpoint = await edge.locator('polyline').evaluate((line: SVGPolylineElement) => {
      const a = line.points.getItem(0), b = line.points.getItem(1);
      const point = new DOMPoint((a.x + b.x) / 2, (a.y + b.y) / 2).matrixTransform(line.getScreenCTM()!);
      return { x: point.x, y: point.y };
    });
    await page.mouse.click(midpoint.x, midpoint.y); await expect(edge).toHaveClass(/is-selected/);
  }
  expect(errors).toEqual([]);
  await page.evaluate(() => (window as any).diagramPreview.session.destroy());
});

test('renders the three pinned real VSDX controls', async ({ page }) => {
  test.skip(!existsSync(resolve('tmp/continued-review/diagram-inputs/sources.json')), 'Run node scripts/prepare-diagram-benchmark.mjs for external corpus checks.');
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/diagram/src/index.ts')}`, page.url()).href;
  // Prepare with node scripts/prepare-diagram-benchmark.mjs; files remain outside tracked sources.
  const samples = JSON.parse(readFileSync(resolve('tmp/continued-review/diagram-inputs/sources.json'), 'utf8'));
  for (const sample of samples) {
    const actual = await page.evaluate(async ({ moduleUrl, bytes }) => {
      const { createDiagramPreviewDriver } = await import(/* @vite-ignore */ moduleUrl);
      const host = document.createElement('div'); document.body.replaceChildren(host);
      const session = createDiagramPreviewDriver().createSession(host);
      const source = new Uint8Array(bytes); await session.load(source, { descriptor: { source, extension: 'vsdx' } });
      const actual = { nodes: host.querySelectorAll('.diagramv-node').length, pages: session.getState().pageCount };
      session.destroy(); return actual;
    }, { moduleUrl, bytes: [...readFileSync(resolve(sample.path))] });
    expect(actual).toEqual({ nodes: sample.nodeCount, pages: 1 });
  }
  expect(errors).toEqual([]);
});

test('discards replaced, cancelled and destroyed reads in every diagram loader', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const zip = new JSZip(); zip.file('visio/pages/page1.xml', createVisioPage(2));
  const fixtures = [
    ...['drawio', 'dio'].map(format => ({ format, bytes: [...new TextEncoder().encode(createDrawioFixture(2))] })),
    { format: 'vdx', bytes: [...new TextEncoder().encode(legacyVdxFixture)] },
    { format: 'vsdx', bytes: [...await zip.generateAsync({ type: 'uint8array' })] }
  ];
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/diagram/src/index.ts')}`, page.url()).href;
  const results = await page.evaluate(async ({ moduleUrl, fixtures }) => {
    const { createDiagramPreviewDriver } = await import(/* @vite-ignore */ moduleUrl);
    const results = [];
    for (const fixture of fixtures) {
      const host = document.createElement('div'); document.body.replaceChildren(host);
      const session = createDiagramPreviewDriver().createSession(host);
      let rendered = 0, errors = 0;
      session.on('rendered', () => rendered++); session.on('error', () => errors++);
      const delayed = () => {
        let finish!: (value: any) => void, reject!: (error: Error) => void;
        const promise = new Promise((resolve, fail) => { finish = resolve; reject = fail; });
        const source = new Blob([]);
        Object.defineProperty(source, fixture.format === 'vsdx' ? 'arrayBuffer' : 'text', { value: () => promise });
        return { source, reject, release: () => finish(fixture.format === 'vsdx'
          ? new Uint8Array(fixture.bytes).buffer : new TextDecoder().decode(new Uint8Array(fixture.bytes))) };
      };
      const load = (source: Blob | Uint8Array, signal?: AbortSignal) =>
        session.load(source, { descriptor: { source, extension: fixture.format }, signal });
      const old = delayed(), pending = load(old.source);
      await load(new Uint8Array(fixture.bytes));
      const svg = host.querySelector('svg'), state = JSON.stringify(session.getState());
      old.release(); await pending;
      const preserved = host.querySelector('svg') === svg && JSON.stringify(session.getState()) === state;
      const failed = delayed(), failure = load(failed.source);
      await load(new Uint8Array(fixture.bytes));
      failed.reject(new Error('Old read failed')); await failure;
      const controller = new AbortController(), cancelled = delayed();
      const cancellation = load(cancelled.source, controller.signal).then(() => 'loaded', (error: Error) => error.name);
      controller.abort(); cancelled.release(); const aborted = await cancellation;
      const last = delayed(), unfinished = load(last.source);
      session.destroy(); last.release(); await unfinished;
      results.push({ format: fixture.format, preserved, aborted, rendered, errors, empty: !host.childElementCount,
        idle: !session.getState().loading, pages: session.getState().pageCount, noSelection: session.getState().selectedElementId === undefined });
    }
    return results;
  }, { moduleUrl, fixtures });
  for (const result of results) expect(result).toEqual({ format: result.format, preserved: true,
    aborted: 'AbortError', rendered: 2, errors: 0, empty: true, idle: true, pages: 0, noSelection: true });
  expect(errors).toEqual([]);
});
