import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import {
  createIworkPreviewDriver,
  createIworkPreviewRoutes,
  detectIworkType,
  loadIwork
} from '../src/index';
import { readFixture } from './helpers';

describe('iWork parsing', () => {
  it('resolves the same archive records when ZIP entries are stored in a different order', async () => {
    const bytes = await readFixture('vendor/iwork-converter/testdata/a.numbers');
    const original = await JSZip.loadAsync(bytes);
    const reversed = new JSZip();
    for (const entry of Object.values(original.files).filter(entry => !entry.dir).reverse()) {
      reversed.file(entry.name, await entry.async('uint8array'));
    }
    const before = await loadIwork(bytes, { hint: 'numbers' });
    const after = await loadIwork(await reversed.generateAsync({ type: 'uint8array' }), { hint: 'numbers' });
    expect(after.archive).toEqual(before.archive);
    if (before.kind !== 'numbers' || after.kind !== 'numbers') throw new Error('Expected Numbers documents');
    expect(after.sheets).toEqual(before.sheets);
  });

  it('fetches an unnamed download URL once when detecting its archive type', async () => {
    const bytes = await readFixture('vendor/iwork-converter/testdata/a.pages');
    const fetchMock = vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const document = await loadIwork('https://example.com/download?id=42');
      expect(document.kind).toBe('pages');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });
  it('detects vendored iWork fixtures by archive contents', async () => {
    const keyBytes = await readFixture('vendor/iwork-converter/testdata/a.key');
    const pagesBytes = await readFixture('vendor/iwork-converter/testdata/a.pages');
    const numbersBytes = await readFixture('vendor/iwork-converter/testdata/a.numbers');

    await expect(detectIworkType(keyBytes)).resolves.toBe('key');
    await expect(detectIworkType(pagesBytes)).resolves.toBe('pages');
    await expect(detectIworkType(numbersBytes)).resolves.toBe('numbers');
  });

  it('loads keynote fixtures into a slide-oriented model', async () => {
    const document = await loadIwork(await readFixture('vendor/iwork-converter/testdata/a.key'));

    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    expect(document.slides).toHaveLength(1);
    expect(document.presentation.slides).toHaveLength(1);
    expect(document.slides[0]?.title).toBe('账户passport');
    expect(document.slides[0]?.slide.items.length).toBeGreaterThanOrEqual(20);
    expect(
      document.slides[0]?.slide.items.some((item) => {
        const textFrame = 'textFrame' in item ? item.textFrame : undefined;
        return textFrame?.paragraphs.some((paragraph) =>
          paragraph.runs.some((run) => run.text.includes('聚合支付pay'))
        );
      })
    ).toBe(true);
  });

  it('loads pages fixtures into a page canvas with body text and tables', async () => {
    const document = await loadIwork(await readFixture('vendor/iwork-converter/testdata/a.pages'));

    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    expect(document.pages).toHaveLength(3);
    expect(document.title).toBe('购 销 合 同');
    expect(document.pages[0]?.canvas.slide.items.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(document.pages[0]?.canvas.slide.items.some((item) => item.kind === 'table')).toBe(true);
    expect(document.pages[0]?.canvas.slide.items.some((item) => item.kind === 'text')).toBe(true);
    expect(document.pages[0]?.blocks.length).toBeGreaterThanOrEqual(2);
    expect(document.pages[0]?.blocks.some((block) => block.kind === 'paragraphs')).toBe(true);
    expect(document.pages[0]?.blocks.some((block) => block.kind === 'table')).toBe(true);

    const bodyItem = document.pages[0]?.canvas.slide.items.find((item) => item.kind === 'text');
    expect(bodyItem && bodyItem.kind === 'text').toBe(true);

    if (bodyItem && bodyItem.kind === 'text') {
      const paragraphs = bodyItem.textFrame.paragraphs.map((paragraph) =>
        paragraph.runs.map((run) => run.text).join('')
      );
      expect(paragraphs[0]).toBe('购 销 合 同');
      expect(paragraphs).toContain('货物清单及价格');
    }

    const firstParagraphBlock = document.pages[0]?.blocks.find((block) => block.kind === 'paragraphs');
    expect(firstParagraphBlock?.paragraphs?.[0]?.runs.map((run) => run.text).join('')).toBe('购 销 合 同');
    expect(document.pages[1]?.canvas.slide.items).toHaveLength(1);
    expect(document.pages[1]?.canvas.slide.items[0]?.kind).toBe('text');
    expect(document.pages[2]?.canvas.slide.items).toHaveLength(1);
    expect(document.pages[2]?.canvas.slide.items[0]?.kind).toBe('text');

    const firstTable = document.pages
      .flatMap((page) => page.canvas.slide.items)
      .find((item) => item.kind === 'table');
    expect(firstTable && firstTable.kind === 'table').toBe(true);
    if (firstTable && firstTable.kind === 'table') {
      const cellText = (row: number, column: number): string | undefined =>
        firstTable.cells
          .find((cell) => cell.row === row && cell.column === column)
          ?.textFrame.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n');

      // Pages stores ordinary strings and rich cell payloads in overlapping
      // key spaces; empty cells must also remain in the table grid.
      expect(cellText(1, 2)).toBe('只');
      expect(cellText(9, 5)).toBe('60000');
      expect(cellText(10, 5)).toBe('');
    }
  });

  it('retains sparse trailing cells and row-tree positions across the full Numbers workbook', async () => {
    const document = await loadIwork(await readFixture('../../apps/demo/public/samples/a.numbers'), { hint: 'numbers' });
    if (document.kind !== 'numbers') throw new Error('Expected Numbers document');
    expect(document.sheets).toHaveLength(6);
    const tables = document.sheets.flatMap(sheet => sheet.tables);
    expect(tables).toHaveLength(14);
    const text = (table: number, row: number, column: number) => tables[table].item.cells
      .find(cell => cell.row === row && cell.column === column)?.textFrame.paragraphs
      .map(p => p.runs.map(r => r.text).join('')).join('\n');
    expect(tables.flatMap(table => table.item.cells).filter(cell => cell.textFrame.paragraphs
      .some(p => p.runs.some(r => r.text.trim())))).toHaveLength(5772);
    expect(text(0, 32, 10)).toBe('$0.000278');
    expect(text(7, 47, 0)).toBe('aws');
    expect(text(8, 0, 12)).toBe('billedTime');
    expect(text(8, 46, 12)).toBe('1.079');
  });

  it('loads numbers fixtures into sheet canvases with parsed tables', async () => {
    const document = await loadIwork(await readFixture('vendor/iwork-converter/testdata/a.numbers'));

    expect(document.kind).toBe('numbers');
    if (document.kind !== 'numbers') {
      return;
    }

    expect(document.sheets).toHaveLength(1);
    expect(document.sheets[0]?.name).toBe('工作表 1');
    expect(document.sheets[0]?.tables).toHaveLength(2);
    expect(document.sheets[0]?.tables.map((table) => table.item.name)).toEqual(['数盟指标统计', '各指标和大盘对比']);
    expect(document.sheets[0]?.tables.map((table) => table.item.rows.length)).toEqual([11, 10]);
    expect(document.sheets[0]?.tables.map((table) => table.item.columns.length)).toEqual([13, 11]);
    expect(document.sheets[0]?.tables.flatMap((table) => table.item.columns).every((width) => width > 0)).toBe(true);
    expect(document.sheets[0]?.canvas.width).toBeCloseTo(722, 1);
    expect(document.sheets[0]?.canvas.height).toBeCloseTo(872, 1);

    const footerTextItem = document.sheets[0]?.canvas.slide.items.find(
      (item) =>
        item.kind === 'text' &&
        item.name === 'footer-1' &&
        item.textFrame.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text === '1'))
    );
    expect(footerTextItem && footerTextItem.kind === 'text').toBe(true);

    const getCellText = (tableIndex: number, row: number, column: number): string | undefined => {
      const cell = document.sheets[0]?.tables[tableIndex]?.item.cells.find(
        (candidate) => candidate.row === row && candidate.column === column
      );
      return cell?.textFrame.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n');
    };

    expect(getCellText(0, 1, 6)).toBe('230.45');
    expect(getCellText(0, 1, 10)).toBe('-214.4');
    expect(getCellText(1, 1, 4)).toBe('2.54545454545455');
    expect(getCellText(1, 1, 7)).toBe('1.36842105263158');
    expect(getCellText(1, 7, 4)).toBe('5.36363636363636');
  });
});

describe('iWork preview driver', () => {
  it('overrides iWork conversion routes with native driver routes', () => {
    const routes = createIworkPreviewRoutes();
    const keyRoute = routes.find((route) => route.extensions.includes('key'));
    const pagesRoute = routes.find((route) => route.extensions.includes('pages'));
    const numbersRoute = routes.find((route) => route.extensions.includes('numbers'));

    expect(keyRoute).toMatchObject({
      targetFormat: 'key',
      family: 'paged',
      driverId: 'iwork'
    });
    expect(pagesRoute).toMatchObject({
      targetFormat: 'pages',
      family: 'paged',
      driverId: 'iwork'
    });
    expect(numbersRoute).toMatchObject({
      targetFormat: 'numbers',
      family: 'workbook',
      driverId: 'iwork'
    });
    expect(keyRoute?.conversion).toBeUndefined();
  });

  it('exposes a generic preview driver for iWork formats', () => {
    const driver = createIworkPreviewDriver();

    expect(driver.id).toBe('iwork');
    expect(driver.family).toBe('paged');
    expect(driver.supports('key')).toBe(true);
    expect(driver.supports('.pages')).toBe(true);
    expect(driver.supports('numbers')).toBe(true);
    expect(driver.supports('pptx')).toBe(false);
    expect(driver.createSession).toEqual(expect.any(Function));
  });
});
