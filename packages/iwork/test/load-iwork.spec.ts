import { describe, expect, it } from 'vitest';
import {
  createIworkPreviewDriver,
  createIworkPreviewRoutes,
  detectIworkType,
  loadIwork
} from '../src/index';
import { readFixture } from './helpers';

describe('iWork parsing', () => {
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
