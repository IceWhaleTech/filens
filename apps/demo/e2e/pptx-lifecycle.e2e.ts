import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test('refreshes PPTX font weights after a font is added and removed', async ({ page }) => {
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/core/src/index.ts')}`, page.url()).href;
  const bytes = [...await readFile(resolve('node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf'))];
  const weights = await page.evaluate(async ({ moduleUrl, bytes }) => {
    const { renderSlideToElement } = await import(/* @vite-ignore */ moduleUrl);
    const family = 'Filens Dynamic Light';
    const slide = {
      id: 'dynamic-font', index: 0, title: 'Dynamic font', width: 400, height: 200,
      background: { type: 'solid', color: '#ffffff' }, warnings: [],
      items: [{
        id: 'title', kind: 'text', name: 'Title', order: 1, groupPath: [],
        transform: { x: 0, y: 0, width: 320, height: 100, rotation: 0, flipH: false, flipV: false },
        fill: { type: 'none' },
        textFrame: {
          verticalAlign: 'top', padding: { top: 0, right: 0, bottom: 0, left: 0 },
          paragraphs: [{ runs: [{ text: 'Dynamic title', fontSize: 44, fontFamily: family }] }]
        }
      }]
    };
    const presentation = { size: { width: 400, height: 200 }, slides: [slide], media: {}, warnings: [] };
    const weight = () => (renderSlideToElement(slide, presentation).querySelector('.pptxv-run') as HTMLElement).style.fontWeight;
    const before = weight();
    const face = new FontFace(family, new Uint8Array(bytes));
    try {
      await face.load();
      document.fonts.add(face);
      const loaded = weight();
      document.fonts.delete(face);
      return { before, loaded, removed: weight() };
    } finally {
      document.fonts.delete(face);
    }
  }, { moduleUrl, bytes });
  expect(weights).toEqual({ before: '310', loaded: '', removed: '310' });
});

test('stops a cancelled file and preserves the latest preview through switching and destruction', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/core/src/index.ts')}`, page.url()).href;
  const sampleUrl = new URL('samples/filens-field-notes.pptx', page.url()).href;
  const result = await page.evaluate(async ({ moduleUrl, sampleUrl }) => {
    const { createViewer, loadPptx } = await import(/* @vite-ignore */ moduleUrl);
    const bytes = await (await fetch(sampleUrl)).arrayBuffer();
    const delayedFile = () => {
      let release!: (value: ArrayBuffer) => void;
      const file = new File([], 'late.pptx');
      Object.defineProperty(file, 'arrayBuffer', { value: () => new Promise<ArrayBuffer>(done => { release = done; }) });
      return { file, release: () => release(new ArrayBuffer(4)) };
    };
    const controller = new AbortController();
    const direct = delayedFile();
    const pending = loadPptx(direct.file, { signal: controller.signal }).then(
      () => 'parsed', (error: Error) => error.name
    );
    controller.abort();
    direct.release();
    const cancelled = await pending;
    const host = document.createElement('div');
    host.style.cssText = 'width:800px;height:600px';
    document.body.append(host);
    const viewer = createViewer(host);
    let rendered = 0, errors = 0;
    viewer.on('rendered', () => rendered++);
    viewer.on('error', () => errors++);
    try {
      const first = delayedFile();
      const previous = viewer.preview(first.file);
      await viewer.preview(new File([bytes], 'current.pptx'));
      const current = viewer.getState().presentation;
      first.release();
      await previous;
      const latestPreserved = !!current && viewer.getState().presentation === current && !!host.querySelector('.pptxv-slide');
      const last = delayedFile();
      const unfinished = viewer.preview(last.file);
      viewer.destroy();
      last.release();
      await unfinished;
      return { cancelled, latestPreserved, rendered, errors, destroyed: !host.childElementCount && !viewer.getState().presentation };
    } finally {
      viewer.destroy();
      host.remove();
    }
  }, { moduleUrl, sampleUrl });
  expect(result).toEqual({ cancelled: 'AbortError', latestPreserved: true, rendered: 1, errors: 0, destroyed: true });
  expect(errors).toEqual([]);
});
