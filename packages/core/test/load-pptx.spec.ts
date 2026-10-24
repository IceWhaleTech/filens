import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { loadPptx } from '../src/parser/load-pptx';
import { applyShade, applyTint } from '../src/utils/colors';
import { fixtureExists, readFixture } from './helpers';

const BULLET = '\u2022';
const SOFT_HYPHEN = '\u00AD';
const NO_BREAK_HYPHEN = '\u2011';
const ooxmlTint = (value: number) => 1 - value;

describe('loadPptx', () => {
  it('parses text and theme based fixture', async () => {
    const presentation = await loadPptx(await readFixture('fixtures-text-theme.pptx'));
    const bodyItem = presentation.slides[0].items.find((item) => {
      if (item.kind !== 'shape') {
        return false;
      }

      return item.textFrame?.paragraphs.some((paragraph) =>
        paragraph.runs.some((run) => run.text.includes('Bullet paragraphs now keep indentation and spacing.'))
      );
    });
    const inheritedBulletItem = presentation.slides[0].items.find((item) => {
      if (item.kind !== 'shape') {
        return false;
      }

      return item.textFrame?.paragraphs.some((paragraph) =>
        paragraph.runs.some((run) => run.text === 'Inherited bullet placeholder style.')
      );
    });

    expect(presentation.slides).toHaveLength(1);
    expect(presentation.theme.colors.accent1).toBe('#2F6BFF');
    expect(presentation.slides[0].items.some((item) => item.kind === 'text' || item.kind === 'shape')).toBe(true);
    expect(presentation.slides[0].title).toContain('PPTX Previewer');
    expect(bodyItem && bodyItem.kind === 'shape').toBe(true);
    expect(inheritedBulletItem && inheritedBulletItem.kind === 'shape').toBe(true);

    if (bodyItem && bodyItem.kind === 'shape') {
      const bulletParagraph = bodyItem.textFrame?.paragraphs.find((paragraph) =>
        paragraph.runs.some((run) => run.text.includes('Bullet paragraphs now keep indentation and spacing.'))
      );
      const numberedParagraph = bodyItem.textFrame?.paragraphs.find((paragraph) =>
        paragraph.runs.some((run) => run.text.includes('Ordered roadmap item one.'))
      );
      const linkRun = bodyItem.textFrame?.paragraphs
        .flatMap((paragraph) => paragraph.runs)
        .find((run) => run.text === 'Open preview documentation');
      const fallbackLinkRun = bodyItem.textFrame?.paragraphs
        .flatMap((paragraph) => paragraph.runs)
        .find((run) => run.text === 'Theme fallback link');
      const inheritedRun = bodyItem.textFrame?.paragraphs
        .flatMap((paragraph) => paragraph.runs)
        .find((run) => run.text === 'Inherited master body style.');
      const styledRun = bodyItem.textFrame?.paragraphs
        .flatMap((paragraph) => paragraph.runs)
        .find((run) => run.text === 'Deprecated copy');
      const baselineParagraph = bodyItem.textFrame?.paragraphs.find(
        (paragraph) => paragraph.runs.map((run) => run.text).join('') === 'CO2 baseline and x2 notation.'
      );
      const orderedContentParagraph = bodyItem.textFrame?.paragraphs.find(
        (paragraph) => paragraph.runs.map((run) => run.text).join('') === 'Line one\nLine two\tField tail'
      );
      const tabbedParagraph = bodyItem.textFrame?.paragraphs.find(
        (paragraph) => paragraph.runs.map((run) => run.text).join('') === 'Milestone\tOwner\tDone'
      );
      const hyphenParagraph = bodyItem.textFrame?.paragraphs.find(
        (paragraph) => paragraph.runs.map((run) => run.text).join('') === `co${SOFT_HYPHEN}operate and re${NO_BREAK_HYPHEN}enter`
      );
      const themeFontParagraph = bodyItem.textFrame?.paragraphs.find(
        (paragraph) => paragraph.runs.map((run) => run.text).join('') === 'Theme heading font + body font'
      );
      const cjkThemeFontParagraph = bodyItem.textFrame?.paragraphs.find(
        (paragraph) => paragraph.runs.map((run) => run.text).join('') === '中文主题字体'
      );
      const symbolParagraph = bodyItem.textFrame?.paragraphs.find(
        (paragraph) => paragraph.runs.map((run) => run.text).join('') === 'Status ✓ complete'
      );

      expect(bulletParagraph?.bullet?.char).toBe(BULLET);
      expect(numberedParagraph?.bullet?.autoType).toBe('arabicPeriod');
      expect(numberedParagraph?.bullet?.startAt).toBe(3);
      expect(linkRun?.href).toBe('https://example.com/pptx-previewer');
      expect(fallbackLinkRun?.href).toBe('https://example.com/pptx-previewer');
      expect(fallbackLinkRun?.color).toBe('#2F6BFF');
      expect(fallbackLinkRun?.underline).toBe(true);
      expect(inheritedRun?.fontSize).toBe(24);
      expect(inheritedRun?.color).toBe('#122033');
      expect(bodyItem.textFrame?.verticalAlign).toBe('middle');
      expect(bodyItem.textFrame?.padding.left).toBeCloseTo(19.2, 4);
      expect(bodyItem.textFrame?.padding.right).toBeCloseTo(14.4, 4);
      expect(bodyItem.textFrame?.padding.top).toBeCloseTo(9.6, 4);
      expect(bodyItem.textFrame?.padding.bottom).toBeCloseTo(7.2, 4);
      expect(bulletParagraph?.marginLeft).toBeGreaterThan(0);
      expect(bulletParagraph?.indent).toBeLessThan(0);
      expect(bulletParagraph?.lineHeightUnit).toBe('multiple');
      expect(styledRun?.strike).toBe(true);
      expect(styledRun?.highlightColor).toBe('#FFF3A3');
      expect(baselineParagraph?.runs[1]?.baselineShift).toBeCloseTo(-0.25, 4);
      expect(baselineParagraph?.runs[3]?.baselineShift).toBeCloseTo(0.3, 4);
      expect(orderedContentParagraph?.runs.map((run) => run.text)).toEqual(['Line one', '\n', 'Line two', '\t', 'Field tail']);
      expect(orderedContentParagraph?.runs[1]?.bold).toBe(true);
      expect(orderedContentParagraph?.runs[1]?.fontSize).toBe(20);
      expect(orderedContentParagraph?.runs[1]?.color).toBe('#FF7A59');
      expect(orderedContentParagraph?.runs[4]?.italic).toBe(true);
      expect(orderedContentParagraph?.runs[4]?.color).toBe('#2F6BFF');
      expect(tabbedParagraph?.tabStops).toEqual([192, 336]);
      expect(tabbedParagraph?.runs[2]?.bold).toBe(true);
      expect(tabbedParagraph?.runs[4]?.color).toBe('#2ABF88');
      expect(hyphenParagraph?.runs.map((run) => run.text)).toEqual([
        'co',
        SOFT_HYPHEN,
        'operate and re',
        NO_BREAK_HYPHEN,
        'enter'
      ]);
      expect(hyphenParagraph?.runs[2]?.color).toBe('#FF7A59');
      expect(hyphenParagraph?.runs[4]?.bold).toBe(true);
      expect(hyphenParagraph?.runs[4]?.color).toBe('#2F6BFF');
      expect(themeFontParagraph?.runs[0]?.fontFamily).toBe('Aptos');
      expect(themeFontParagraph?.runs[1]?.fontFamily).toBe('Calibri');
      expect(cjkThemeFontParagraph?.runs[0]?.fontFamily).toBe('等线');
      expect(themeFontParagraph?.runs[1]?.color).toBe('#2ABF88');
      expect(symbolParagraph?.runs.map((run) => run.text)).toEqual(['Status ', '✓', ' complete']);
      expect(symbolParagraph?.runs[1]?.fontFamily).toBe('Segoe UI Symbol');
      expect(symbolParagraph?.runs[2]?.color).toBe('#2ABF88');
    }

    if (inheritedBulletItem && inheritedBulletItem.kind === 'shape') {
      const paragraph = inheritedBulletItem.textFrame?.paragraphs.find((entry) =>
        entry.runs.some((run) => run.text === 'Inherited bullet placeholder style.')
      );
      const run = paragraph?.runs.find((entry) => entry.text === 'Inherited bullet placeholder style.');

      expect(paragraph?.bullet?.char).toBe(BULLET);
      expect(paragraph?.marginLeft).toBeGreaterThan(0);
      expect(paragraph?.indent).toBeLessThan(0);
      expect(run?.italic).toBe(true);
      expect(run?.fontSize).toBeCloseTo(21.333, 3);
      expect(run?.color).toBe('#25A7C5');
      expect(inheritedBulletItem.textFrame?.verticalAlign).toBe('bottom');
      expect(inheritedBulletItem.textFrame?.padding.left).toBeCloseTo(14.4, 4);
      expect(inheritedBulletItem.textFrame?.padding.right).toBeCloseTo(9.6, 4);
      expect(inheritedBulletItem.textFrame?.padding.top).toBeCloseTo(7.2, 4);
      expect(inheritedBulletItem.textFrame?.padding.bottom).toBeCloseTo(9.6, 4);
    }
  });

  it('inherits presentation default text style for ordinary text boxes', async () => {
    const presentation = await loadPptx(await buildDefaultTextStyleFixture());
    const textBox = presentation.slides[0].items.find((item) => item.kind === 'text');

    expect(textBox && textBox.kind === 'text').toBe(true);

    if (textBox && textBox.kind === 'text') {
      const run = textBox.textFrame.paragraphs[0]?.runs[0];
      expect(run?.text).toBe('Defaulted textbox');
      expect(run?.fontSize).toBeCloseTo(24, 3);
      expect(run?.fontFamily).toBe('等线');
      expect(run?.color).toBe('#122033');
    }
  });

  it('parses cached clustered and stacked column charts from graphic frames', async () => {
    const presentation = await loadPptx(await buildColumnChartFixture());
    const charts = presentation.slides[0].items.filter((item) => item.kind === 'chart');

    expect(charts).toHaveLength(2);
    expect(charts[0]).toMatchObject({
      kind: 'chart',
      chartType: 'column',
      grouping: 'clustered',
      title: 'Chart 1',
      categories: ['Category 1', 'Category 2'],
      legendPosition: 'bottom',
      valueAxis: {
        min: -2,
        max: 8,
        majorUnit: 2,
        formatCode: '0.0'
      },
      series: [
        { name: 'Series 1', values: [4.3, 2.5], color: '#2F6BFF' },
        { name: 'Series 2', values: [2.4, null], color: '#FF7A59' }
      ]
    });
    expect(charts[1]).toMatchObject({
      kind: 'chart',
      grouping: 'stacked',
      title: 'Chart 2',
      legendPosition: 'right'
    });
    expect(presentation.slides[0].items.some((item) => item.kind === 'unsupported')).toBe(false);
    expect(presentation.warnings).toEqual([]);
  });

  it('parses the pie chart in the real shapes sample instead of an unsupported frame', async () => {
    const presentation = await loadPptx(await readFixture('../../apps/demo/public/samples/rich-pptx-shapes.pptx'));
    const chart = presentation.slides[0].items.find((item) => item.kind === 'chart');

    expect(chart).toMatchObject({
      kind: 'chart',
      chartType: 'pie',
      title: 'shapes[4]',
      firstSliceAngle: 0,
      categories: ['1st Qtr', '2nd Qtr', '3rd Qtr', '4th Qtr'],
      legendPosition: 'right',
      series: [{ name: 'Sales', values: [8.2, 3.2, 1.4, 1.2] }]
    });
    if (chart?.kind === 'chart') {
      expect(chart.series[0].pointStyles?.map((style) => style.color)).toEqual([
        presentation.theme.colors.accent1,
        presentation.theme.colors.accent2,
        presentation.theme.colors.accent3,
        presentation.theme.colors.accent4
      ]);
    }
    expect(presentation.slides[0].items.some((item) => item.kind === 'unsupported')).toBe(false);
    expect(presentation.warnings).toEqual([]);
  });

  it('preserves pie rotation, fixed series colors and individual slice fill overrides', async () => {
    const zip = await JSZip.loadAsync(await readFixture('../../apps/demo/public/samples/rich-pptx-shapes.pptx'));
    const chartXml = await zip.file('ppt/charts/chart1.xml')!.async('text');
    zip.file('ppt/charts/chart1.xml', chartXml
      .replace('<c:varyColors val="1"', '<c:varyColors val="0"')
      .replace('<c:firstSliceAng val="0"', '<c:firstSliceAng val="90"')
      .replace('</c:ser>', `<c:dPt><c:idx val="1"/><c:spPr><a:solidFill><a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr></a:solidFill></c:spPr></c:dPt></c:ser>`));

    const presentation = await loadPptx(await zip.generateAsync({ type: 'uint8array' }));
    const chart = presentation.slides[0].items.find((item) => item.kind === 'chart');

    expect(chart?.kind).toBe('chart');
    if (chart?.kind === 'chart') {
      expect(chart.firstSliceAngle).toBe(90);
      expect(chart.series[0].pointStyles).toEqual([
        { color: chart.series[0].color, alpha: undefined },
        { color: '#FF0000', alpha: 0.5 },
        { color: chart.series[0].color, alpha: undefined },
        { color: chart.series[0].color, alpha: undefined }
      ]);
    }
  });

  it('treats an empty root group transform as identity', async () => {
    const zip = await JSZip.loadAsync(await buildDefaultTextStyleFixture());
    const slideXml = await zip.file('ppt/slides/slide1.xml')?.async('text');
    zip.file(
      'ppt/slides/slide1.xml',
      slideXml?.replace(
        '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>',
        '<p:grpSpPr><a:xfrm/></p:grpSpPr>'
      ) ?? ''
    );

    const presentation = await loadPptx(new Uint8Array(await zip.generateAsync({ type: 'uint8array' })));
    const textBox = presentation.slides[0].items.find((item) => item.kind === 'text');

    expect(textBox?.transform).toEqual({
      x: 96,
      y: 96,
      width: 384,
      height: 96,
      rotation: 0,
      flipH: false,
      flipV: false
    });
  });

  it('does not inherit paragraph alignment or bullet defaults from master otherStyle for ordinary text boxes', async () => {
    const presentation = await loadPptx(await buildDefaultTextStyleFixture());
    const textBox = presentation.slides[0].items.find((item) => item.kind === 'text');

    expect(textBox && textBox.kind === 'text').toBe(true);

    if (textBox && textBox.kind === 'text') {
      const paragraph = textBox.textFrame.paragraphs[0];
      expect(paragraph?.align).toBeUndefined();
      expect(paragraph?.bullet).toBeUndefined();
    }
  });

  it('inherits master otherStyle run defaults for non-textbox shapes with text', async () => {
    const presentation = await loadPptx(await buildDefaultTextStyleFixture());
    const shape = presentation.slides[0].items.find((item) => item.kind === 'shape');

    expect(shape && shape.kind === 'shape').toBe(true);

    if (shape && shape.kind === 'shape') {
      const run = shape.textFrame?.paragraphs[0]?.runs[0];
      expect(run?.text).toBe('Defaulted shape');
      expect(run?.fontSize).toBeCloseTo(26.667, 3);
      expect(run?.fontFamily).toBe('等线');
      expect(run?.color).toBe('#2ABF88');
    }
  });

  it('prefers shape style fontRef colors over inherited master text defaults', async () => {
    const presentation = await loadPptx(await readFixture('../../apps/demo/public/samples/vue-office-test.pptx'));
    const slide = presentation.slides[1];
    const framedShape = slide.items.find((item) => item.kind === 'shape' && item.name === '矩形 3');
    const styleFillFallbackShape = slide.items.find(
      (item) => item.kind === 'shape' && item.shapeType === 'snipRoundRect' && item.line?.dash === 'lgDash'
    );
    const explicitColorShape = slide.items.find((item) => item.kind === 'shape' && item.name === '对角圆角矩形 11');

    expect(framedShape && framedShape.kind === 'shape').toBe(true);
    expect(styleFillFallbackShape && styleFillFallbackShape.kind === 'shape').toBe(true);
    expect(explicitColorShape && explicitColorShape.kind === 'shape').toBe(true);

    if (framedShape && framedShape.kind === 'shape') {
      const run = framedShape.textFrame?.paragraphs[0]?.runs[0];
      expect(run?.text).toBe('文字内容测试');
      expect(run?.fontFamily).toBe('等线');
      expect(run?.color).toBe('#FFFFFF');
    }

    if (styleFillFallbackShape && styleFillFallbackShape.kind === 'shape') {
      expect(styleFillFallbackShape.fill.type).toBe('solid');
      expect(styleFillFallbackShape.fill.color).toBe('#4472C4');
    }

    if (explicitColorShape && explicitColorShape.kind === 'shape') {
      const run = explicitColorShape.textFrame?.paragraphs[0]?.runs[0];
      expect(explicitColorShape.fill.type).toBe('solid');
      expect(explicitColorShape.fill.color).toBe('#4472C4');
      expect(run?.text).toBe('文字内容测试');
      expect(run?.color).toBe('#000000');
    }
  });

  it.skip('keeps title placeholder runs on the master major theme font when runs only specify language and size', async () => {
    const presentation = await loadPptx(await readFixture('../../apps/demo/public/samples/vue-office-test.pptx'));
    const titleShape = presentation.slides[0]?.items.find(
      (item) => item.kind === 'shape' && item.placeholder?.type === 'title'
    );

    expect(titleShape && titleShape.kind === 'shape').toBe(true);

    if (titleShape && titleShape.kind === 'shape') {
      const runs = titleShape.textFrame?.paragraphs[0]?.runs ?? [];
      expect(runs.map((run) => run.text).join('')).toBe('pptxPreview鑳藉姏娴嬭瘯');
      expect(runs[0]?.fontFamily).toBe('绛夌嚎 Light');
      expect(runs[1]?.fontFamily).toBe('绛夌嚎 Light');
      expect(runs[0]?.fontSize).toBe(80);
      expect(runs[1]?.fontSize).toBe(80);
    }
  });

  it('keeps real sample title placeholder runs on the major theme font', async () => {
    const presentation = await loadPptx(await readFixture('../../apps/demo/public/samples/vue-office-test.pptx'));
    const titleShape = presentation.slides[0]?.items.find(
      (item) => item.kind === 'shape' && item.placeholder?.type === 'title'
    );

    expect(titleShape && titleShape.kind === 'shape').toBe(true);

    if (titleShape && titleShape.kind === 'shape') {
      const runs = titleShape.textFrame?.paragraphs[0]?.runs ?? [];
      expect(runs.map((run) => run.text).join('')).toBe(`pptxPreview\u80fd\u529b\u6d4b\u8bd5`);
      expect(runs[0]?.fontFamily).toBe(`\u7b49\u7ebf Light`);
      expect(runs[1]?.fontFamily).toBe(`\u7b49\u7ebf Light`);
      expect(runs[0]?.fontSize).toBe(80);
      expect(runs[1]?.fontSize).toBe(80);
    }
  });

  it('keeps placeholder title line spacing but drops copied list-style line spacing for ordinary text boxes in the real sample', async () => {
    const presentation = await loadPptx(await readFixture('../../apps/demo/public/samples/vue-office-test.pptx'));
    const slide1Title = presentation.slides[0]?.items.find(
      (item) => item.kind === 'shape' && item.placeholder?.type === 'title'
    );
    const slide5Title = presentation.slides[4]?.items.find(
      (item) =>
        item.kind === 'text' &&
        item.textFrame?.paragraphs[0]?.runs.map((run) => run.text).join('') === '\u4e3b\u6807\u9898'
    );
    const slide5Content = presentation.slides[4]?.items.find(
      (item) =>
        item.kind === 'text' &&
        item.textFrame?.paragraphs[0]?.runs.map((run) => run.text).join('') === '\u526f\u6807\u9898'
    );

    expect(slide1Title && slide1Title.kind === 'shape').toBe(true);
    expect(slide5Title && slide5Title.kind === 'text').toBe(true);
    expect(slide5Content && slide5Content.kind === 'text').toBe(true);

    if (slide1Title && slide1Title.kind === 'shape') {
      expect(slide1Title.textFrame?.paragraphs[0]?.lineHeightUnit).toBe('multiple');
      expect(slide1Title.textFrame?.paragraphs[0]?.lineHeight).toBeCloseTo(0.9, 4);
    }

    if (slide5Title && slide5Title.kind === 'text') {
      expect(slide5Title.textFrame?.paragraphs[0]?.lineHeight).toBeUndefined();
      expect(slide5Title.textFrame?.paragraphs[0]?.lineHeightUnit).toBeUndefined();
      expect(slide5Title.textFrame?.paragraphs[0]?.runs[0]?.fontSize).toBeCloseTo(58.667, 3);
    }

    if (slide5Content && slide5Content.kind === 'text') {
      expect(slide5Content.textFrame?.paragraphs[0]?.lineHeight).toBeUndefined();
      expect(slide5Content.textFrame?.paragraphs[0]?.lineHeightUnit).toBeUndefined();
      expect(slide5Content.textFrame?.paragraphs[0]?.runs[0]?.fontSize).toBeCloseTo(37.333, 3);
      expect(slide5Content.textFrame?.paragraphs[1]?.lineHeight).toBeUndefined();
      expect(slide5Content.textFrame?.paragraphs[1]?.lineHeightUnit).toBeUndefined();
      expect(slide5Content.textFrame?.paragraphs[1]?.runs[0]?.fontSize).toBe(32);
    }
  });

  it('keeps slide-number placeholders while omitting disabled footer placeholders from rendered slide output', async () => {
    const presentation = await loadPptx(await readFixture('../../apps/demo/public/samples/vue-office-test.pptx'));
    const earlySlides = presentation.slides.slice(0, 3);
    const hasDisabledFooterPlaceholder = earlySlides.some((slide) =>
      slide.items.some(
        (item) =>
          (item.kind === 'text' || item.kind === 'shape') &&
          (item.placeholder?.type === 'dt' ||
            item.placeholder?.type === 'ftr' ||
            item.placeholder?.type === 'hdr')
      )
    );
    expect(hasDisabledFooterPlaceholder).toBe(false);
    expect(presentation.slides[0]?.title).toBe('pptxPreview能力测试');
    expect(presentation.slides[2]?.title).toBe('形状测试');
  });

  it.skipIf(!fixtureExists('../../tmp/qrpc-local.pptx'))('keeps explicit slide numbers but does not inject unused layout slide numbers on the local qrpc closing slides', async () => {
    const presentation = await loadPptx(await readFixture('../../tmp/qrpc-local.pptx'));
    const penultimateSlide = presentation.slides.at(-2);
    const lastSlide = presentation.slides.at(-1);
    const penultimateSlideNumber = penultimateSlide?.items.find(
      (item) => (item.kind === 'text' || item.kind === 'shape') && item.placeholder?.type === 'sldNum'
    );
    const lastSlideNumber = lastSlide?.items.find(
      (item) => (item.kind === 'text' || item.kind === 'shape') && item.placeholder?.type === 'sldNum'
    );

    expect(penultimateSlide?.title).toBe('pprof tips');
    expect(lastSlide?.title).toBe('QA');
    expect(
      penultimateSlideNumber && (penultimateSlideNumber.kind === 'text' || penultimateSlideNumber.kind === 'shape')
    ).toBe(true);
    expect(lastSlideNumber).toBeUndefined();

    if (penultimateSlideNumber && (penultimateSlideNumber.kind === 'text' || penultimateSlideNumber.kind === 'shape')) {
      const renderedNumber =
        penultimateSlideNumber.textFrame?.paragraphs
          .map((paragraph) => paragraph.runs.map((run) => run.text).join('').trim())
          .find(Boolean) ?? '';
      expect(renderedNumber).toBe('38');
    }
  });

  it.skipIf(!fixtureExists('../../tmp/qrpc-local.pptx'))('keeps slide-local content above inherited layout panels on qrpc slide 20', async () => {
    const presentation = await loadPptx(await readFixture('../../tmp/qrpc-local.pptx'));
    const slide20 = presentation.slides[19];
    const screenshotImageIndex = slide20?.items.findIndex(
      (item) => item.kind === 'image' && item.name === '图片 1'
    ) ?? -1;
    const whitePanelIndex = slide20?.items.findIndex(
      (item) => item.kind === 'shape' && item.name === 'Google Shape;35;p6'
    ) ?? -1;

    expect(slide20?.title).toBe('qrpc的特性 - 双向调用');
    expect(screenshotImageIndex).toBeGreaterThan(-1);
    expect(whitePanelIndex).toBeGreaterThan(-1);
    expect(screenshotImageIndex).toBeGreaterThan(whitePanelIndex);
  });

  it('preserves real sample slide 9 drawing order for overlapping transparent text shapes', async () => {
    const presentation = await loadPptx(await readFixture('../../apps/demo/public/samples/vue-office-test.pptx'));
    const slide9 = presentation.slides[8];
    const transparentTextShapeIndex =
      slide9?.items.findIndex(
        (item) =>
          item.kind === 'shape' &&
          item.name === '\u77e9\u5f62 32' &&
          item.textFrame?.paragraphs.some((paragraph) =>
            paragraph.runs.some((run) => run.text.includes('\u6211\u662f\u900f\u660e\u7684'))
          )
      ) ?? -1;
    const coveringEllipseIndex =
      slide9?.items.findIndex((item) => item.kind === 'shape' && item.name === '\u692d\u5706 33') ?? -1;

    expect(slide9?.title).toBe('\u989c\u8272\u6d4b\u8bd5');
    expect(transparentTextShapeIndex).toBeGreaterThan(-1);
    expect(coveringEllipseIndex).toBeGreaterThan(-1);
    expect(transparentTextShapeIndex).toBeGreaterThan(coveringEllipseIndex);
  });

  it('parses real sample slide 12 audio and video objects as media items with poster images', async () => {
    const presentation = await loadPptx(await readFixture('../../apps/demo/public/samples/vue-office-test.pptx'));
    const mediaSlide = presentation.slides[11];
    const videoItem = mediaSlide?.items.find((item) => item.kind === 'media' && item.name === 'flower.mp4');
    const audioItem = mediaSlide?.items.find((item) => item.kind === 'media' && item.name === '橘子香水.mp3');

    expect(mediaSlide?.title).toBe('媒体测试');
    expect(videoItem && videoItem.kind === 'media').toBe(true);
    expect(audioItem && audioItem.kind === 'media').toBe(true);

    if (videoItem && videoItem.kind === 'media') {
      expect(videoItem.mediaType).toBe('video');
      expect(videoItem.mediaId).toBe('ppt/media/media1.mp4');
      expect(videoItem.posterMediaId).toBe('ppt/media/image5.png');
      expect(videoItem.transform.width).toBeGreaterThan(700);
      expect(videoItem.transform.height).toBeGreaterThan(400);
    }

    if (audioItem && audioItem.kind === 'media') {
      expect(audioItem.mediaType).toBe('audio');
      expect(audioItem.mediaId).toBe('ppt/media/media2.mp3');
      expect(audioItem.posterMediaId).toBe('ppt/media/image6.png');
      expect(audioItem.transform.width).toBeCloseTo(85.333, 3);
      expect(audioItem.transform.height).toBeCloseTo(85.333, 3);
    }

    expect(presentation.media['ppt/media/media1.mp4']?.contentType).toContain('video');
    expect(presentation.media['ppt/media/media2.mp3']?.contentType).toContain('audio');
    expect(presentation.media['ppt/media/image5.png']?.contentType).toBe('image/png');
    expect(presentation.media['ppt/media/image6.png']?.contentType).toBe('image/png');
  });

  it('parses path gradient metadata for real sample backgrounds and panels', async () => {
    const presentation = await loadPptx(await readFixture('../../apps/demo/public/samples/vue-office-test.pptx'));
    const slide8Background = presentation.slides[7]?.background;
    const centeredOrangePanel = presentation.slides[8]?.items.find(
      (item) => item.kind === 'shape' && item.name === '矩形 24'
    );
    const cornerOrangePanel = presentation.slides[8]?.items.find(
      (item) => item.kind === 'shape' && item.name === '矩形 26'
    );
    const linearGreenPanel = presentation.slides[8]?.items.find(
      (item) => item.kind === 'shape' && item.name === '矩形 27'
    );
    const cornerGreenPanel = presentation.slides[8]?.items.find(
      (item) => item.kind === 'shape' && item.name === '矩形 29'
    );

    expect(slide8Background?.type).toBe('gradient');
    expect(centeredOrangePanel && centeredOrangePanel.kind === 'shape').toBe(true);
    expect(cornerOrangePanel && cornerOrangePanel.kind === 'shape').toBe(true);
    expect(linearGreenPanel && linearGreenPanel.kind === 'shape').toBe(true);
    expect(cornerGreenPanel && cornerGreenPanel.kind === 'shape').toBe(true);

    if (slide8Background?.type === 'gradient') {
      expect(slide8Background.gradientType).toBe('path');
      expect(slide8Background.gradientPath).toBe('circle');
      expect(slide8Background.gradientFillToRect).toEqual({
        left: 0.5,
        top: -0.8,
        right: 0.5,
        bottom: 1.8
      });
      expect(slide8Background.gradientTileRect).toEqual({
        left: 0,
        top: 0,
        right: 0,
        bottom: 0
      });
    } else {
      throw new Error('Expected slide 8 to inherit a path gradient background.');
    }

    if (centeredOrangePanel && centeredOrangePanel.kind === 'shape' && centeredOrangePanel.fill.type === 'gradient') {
      expect(centeredOrangePanel.fill.gradientType).toBe('path');
      expect(centeredOrangePanel.fill.gradientPath).toBe('circle');
      expect(centeredOrangePanel.fill.gradientTileRect).toEqual({
        left: 0,
        top: 0,
        right: 0,
        bottom: 0
      });
    } else {
      throw new Error('Expected centered orange panel to keep path gradient metadata.');
    }

    if (cornerOrangePanel && cornerOrangePanel.kind === 'shape' && cornerOrangePanel.fill.type === 'gradient') {
      expect(cornerOrangePanel.fill.gradientType).toBe('path');
      expect(cornerOrangePanel.fill.gradientPath).toBe('circle');
      expect(cornerOrangePanel.fill.gradientTileRect).toEqual({
        left: -1,
        top: -1,
        right: 0,
        bottom: 0
      });
    } else {
      throw new Error('Expected corner orange panel to keep tileRect corner metadata.');
    }

    if (linearGreenPanel && linearGreenPanel.kind === 'shape' && linearGreenPanel.fill.type === 'gradient') {
      expect(linearGreenPanel.fill.gradientType).toBe('linear');
      expect(linearGreenPanel.fill.gradientPath).toBeUndefined();
    } else {
      throw new Error('Expected linear green panel to stay linear.');
    }

    if (cornerGreenPanel && cornerGreenPanel.kind === 'shape' && cornerGreenPanel.fill.type === 'gradient') {
      expect(cornerGreenPanel.fill.gradientType).toBe('path');
      expect(cornerGreenPanel.fill.gradientPath).toBe('circle');
      expect(cornerGreenPanel.fill.gradientTileRect).toEqual({
        left: 0,
        top: -1,
        right: -1,
        bottom: 0
      });
    } else {
      throw new Error('Expected corner green panel to keep top-right tileRect metadata.');
    }
  });

  it('inherits group fills from grpSpPr into grpFill sample shapes', async () => {
    const presentation = await loadPptx(await readFixture('../../apps/demo/public/samples/vue-office-test.pptx'));
    const slide = presentation.slides[9];
    const yellowGroupBody = slide.items.find((item) => item.kind === 'shape' && item.name === '矩形 48');
    const yellowGroupRoof = slide.items.find((item) => item.kind === 'shape' && item.name === '三角形 49');
    const orangeGroupLabel = slide.items.find((item) => item.kind === 'shape' && item.name === '矩形 54');
    const orangeGroupBody = slide.items.find((item) => item.kind === 'shape' && item.name === '矩形 58');
    const orangeGroupRoof = slide.items.find((item) => item.kind === 'shape' && item.name === '三角形 59');

    expect(yellowGroupBody && yellowGroupBody.kind === 'shape').toBe(true);
    expect(yellowGroupRoof && yellowGroupRoof.kind === 'shape').toBe(true);
    expect(orangeGroupLabel && orangeGroupLabel.kind === 'shape').toBe(true);
    expect(orangeGroupBody && orangeGroupBody.kind === 'shape').toBe(true);
    expect(orangeGroupRoof && orangeGroupRoof.kind === 'shape').toBe(true);

    if (yellowGroupBody && yellowGroupBody.kind === 'shape') {
      expect(yellowGroupBody.fill.type).toBe('solid');
      expect(yellowGroupBody.fill.color).toBe('#FFC000');
    }

    if (yellowGroupRoof && yellowGroupRoof.kind === 'shape') {
      expect(yellowGroupRoof.fill.type).toBe('solid');
      expect(yellowGroupRoof.fill.color).toBe('#FFC000');
    }

    if (orangeGroupLabel && orangeGroupLabel.kind === 'shape') {
      expect(orangeGroupLabel.fill.type).toBe('solid');
      expect(orangeGroupLabel.fill.color).toBe('#C55A11');
    }

    if (orangeGroupBody && orangeGroupBody.kind === 'shape') {
      expect(orangeGroupBody.fill.type).toBe('solid');
      expect(orangeGroupBody.fill.color).toBe('#C55A11');
    }

    if (orangeGroupRoof && orangeGroupRoof.kind === 'shape') {
      expect(orangeGroupRoof.fill.type).toBe('solid');
      expect(orangeGroupRoof.fill.color).toBe('#C55A11');
    }
  });

  it('parses diagram txXfrm bounds for SmartArt shape text placement', async () => {
    const presentation = await loadPptx(await buildDiagramTextBoundsFixture());
    const shape = presentation.slides[0].items.find((item) => item.kind === 'shape');

    expect(shape && shape.kind === 'shape').toBe(true);

    if (shape && shape.kind === 'shape') {
      expect(shape.textBounds).toEqual({
        left: 41.6,
        top: 48,
        right: 57.067,
        bottom: 77.333
      });
      expect(shape.textFrame?.verticalAlign).toBe('middle');
      expect(shape.textFrame?.padding.left).toBeCloseTo(9.6, 3);
      expect(shape.textFrame?.padding.top).toBeCloseTo(4.8, 3);
      expect(shape.textFrame?.paragraphs[0]?.runs[0]?.text).toBe('Diagram node');
    }
  });

  it('parses custom geometry paths for freeform sample shapes', async () => {
    const presentation = await loadPptx(await readFixture('../../apps/demo/public/samples/vue-office-test.pptx'));
    const slide = presentation.slides[1];
    const blobShape = slide.items.find((item) => item.kind === 'shape' && item.name === '任意形状 14');
    const wedgeShape = slide.items.find((item) => item.kind === 'shape' && item.name === '任意形状 15');

    expect(blobShape && blobShape.kind === 'shape').toBe(true);
    expect(wedgeShape && wedgeShape.kind === 'shape').toBe(true);

    if (blobShape && blobShape.kind === 'shape' && blobShape.geometry?.type === 'custom') {
      expect(blobShape.geometry.paths).toHaveLength(1);
      expect(blobShape.geometry.paths[0]?.commands.some((command) => command.type === 'C')).toBe(true);
      expect(blobShape.geometry.paths[0]?.commands.at(-1)?.type).toBe('Z');
    } else {
      expect(blobShape?.geometry?.type).toBe('custom');
    }

    if (wedgeShape && wedgeShape.kind === 'shape' && wedgeShape.geometry?.type === 'custom') {
      expect(wedgeShape.geometry.paths).toHaveLength(1);
      expect(wedgeShape.geometry.paths[0]?.commands.map((command) => command.type)).toEqual(['M', 'L', 'L', 'L', 'L']);
    } else {
      expect(wedgeShape?.geometry?.type).toBe('custom');
    }
  });

  it('preserves custom geometry command order from ordered OOXML nodes', async () => {
    const presentation = await loadPptx(await buildCustomGeometryCommandOrderFixture());
    const shape = presentation.slides[0].items.find((item) => item.kind === 'shape' && item.name === 'Ordered Freeform');

    expect(shape && shape.kind === 'shape').toBe(true);

    if (shape && shape.kind === 'shape' && shape.geometry?.type === 'custom') {
      expect(shape.geometry.paths).toHaveLength(1);
      expect(shape.geometry.paths[0]?.commands.map((command) => command.type)).toEqual(['M', 'C', 'L', 'Q', 'Z']);
      expect(shape.geometry.paths[0]?.commands[0]).toMatchObject({ type: 'M', x: 10000, y: 10000 });
      expect(shape.geometry.paths[0]?.commands[1]).toMatchObject({
        type: 'C',
        x1: 20000,
        y1: 0,
        x2: 40000,
        y2: 0,
        x: 50000,
        y: 10000
      });
      expect(shape.geometry.paths[0]?.commands[2]).toMatchObject({ type: 'L', x: 80000, y: 20000 });
      expect(shape.geometry.paths[0]?.commands[3]).toMatchObject({
        type: 'Q',
        x1: 90000,
        y1: 50000,
        x: 60000,
        y: 90000
      });
      expect(shape.geometry.paths[0]?.commands[4]).toMatchObject({ type: 'Z' });
    } else {
      expect(shape?.geometry?.type).toBe('custom');
    }
  });

  it('parses grouped shapes and image relationships', async () => {
    const presentation = await loadPptx(await readFixture('fixtures-grouped-media.pptx'));
    const slide = presentation.slides[0];
    const connector = slide.items.find((item) => item.kind === 'shape' && item.shapeType === 'line');
    const callout = slide.items.find((item) => item.kind === 'shape' && item.name === 'Callout');
    const flowArrow = slide.items.find((item) => item.kind === 'shape' && item.name === 'Flow Arrow');
    const notchedArrow = slide.items.find((item) => item.kind === 'shape' && item.name === 'Notched Arrow');
    const homePlate = slide.items.find((item) => item.kind === 'shape' && item.name === 'Home Plate');
    const rightTriangle = slide.items.find((item) => item.kind === 'shape' && item.name === 'Right Triangle');
    const processCloud = slide.items.find((item) => item.kind === 'shape' && item.name === 'Process Cloud');
    const dataCube = slide.items.find((item) => item.kind === 'shape' && item.name === 'Data Cube');
    const starBadge = slide.items.find((item) => item.kind === 'shape' && item.name === 'Star Badge');
    const octagonChip = slide.items.find((item) => item.kind === 'shape' && item.name === 'Octagon Chip');
    const signalTriangle = slide.items.find((item) => item.kind === 'shape' && item.name === 'Signal Triangle');
    const planPentagon = slide.items.find((item) => item.kind === 'shape' && item.name === 'Plan Pentagon');
    const decisionDiamond = slide.items.find((item) => item.kind === 'shape' && item.name === 'Decision Diamond');
    const plaqueBanner = slide.items.find((item) => item.kind === 'shape' && item.name === 'Plaque Banner');
    const canPillar = slide.items.find((item) => item.kind === 'shape' && item.name === 'Can Pillar');
    const frameFocus = slide.items.find((item) => item.kind === 'shape' && item.name === 'Frame Focus');
    const pieSlice = slide.items.find((item) => item.kind === 'shape' && item.name === 'Pie Slice');
    const chordSlice = slide.items.find((item) => item.kind === 'shape' && item.name === 'Chord Slice');
    const donutRing = slide.items.find((item) => item.kind === 'shape' && item.name === 'Donut Ring');
    const arcSweep = slide.items.find((item) => item.kind === 'shape' && item.name === 'Arc Sweep');
    const circularLoop = slide.items.find((item) => item.kind === 'shape' && item.name === 'Circular Loop');
    const curvedForwardArrow = slide.items.find((item) => item.kind === 'shape' && item.name === 'Curved Forward Arrow');
    const smileyMarker = slide.items.find((item) => item.kind === 'shape' && item.name === 'Smiley Marker');
    const bevelPanel = slide.items.find((item) => item.kind === 'shape' && item.name === 'Bevel Panel');
    const chevronTag = slide.items.find((item) => item.kind === 'shape' && item.name === 'Chevron Tag');
    const skewPanel = slide.items.find((item) => item.kind === 'shape' && item.name === 'Skew Panel');
    const processTrapezoid = slide.items.find((item) => item.kind === 'shape' && item.name === 'Process Trapezoid');
    const hexNode = slide.items.find((item) => item.kind === 'shape' && item.name === 'Hex Node');
    const themeStylePanel = slide.items.find((item) => item.kind === 'shape' && item.name === 'Theme Style Panel');
    const pictureFillCard = slide.items.find((item) => item.kind === 'shape' && item.name === 'Picture Fill Card');
    const patternStyleChip = slide.items.find((item) => item.kind === 'shape' && item.name === 'Pattern Style Chip');
    const mirroredArrow = slide.items.find((item) => item.kind === 'shape' && item.name === 'Mirrored Arrow');
    const image = slide.items.find((item) => item.kind === 'image');
    const gradientNote = slide.items.find((item) => item.kind === 'text' && item.name === 'Gradient Note');
    const patternNote = slide.items.find((item) => item.kind === 'text' && item.name === 'Pattern Note');
    const verticalLabel = slide.items.find((item) => item.kind === 'text' && item.name === 'Vertical Label');
    const textBox = slide.items.find((item) => item.kind === 'text' && item.name === 'Status Note');
    const listStyleBox = slide.items.find((item) => item.kind === 'text' && item.name === 'List Style Note');

    expect(slide.items.some((item) => item.kind === 'image')).toBe(true);
    expect(slide.items.some((item) => item.groupPath.length > 0)).toBe(true);
    expect(Object.keys(presentation.media)).toContain('ppt/media/image1.png');
    expect(slide.background.type).toBe('gradient');
    expect(presentation.warnings.some((warning) => warning.includes('Unsupported geometry adjustment formula'))).toBe(false);
    expect(connector && connector.kind === 'shape').toBe(true);
    expect(callout && callout.kind === 'shape').toBe(true);
    expect(flowArrow && flowArrow.kind === 'shape').toBe(true);
    expect(notchedArrow && notchedArrow.kind === 'shape').toBe(true);
    expect(homePlate && homePlate.kind === 'shape').toBe(true);
    expect(rightTriangle && rightTriangle.kind === 'shape').toBe(true);
    expect(processCloud && processCloud.kind === 'shape').toBe(true);
    expect(dataCube && dataCube.kind === 'shape').toBe(true);
    expect(starBadge && starBadge.kind === 'shape').toBe(true);
    expect(octagonChip && octagonChip.kind === 'shape').toBe(true);
    expect(signalTriangle && signalTriangle.kind === 'shape').toBe(true);
    expect(planPentagon && planPentagon.kind === 'shape').toBe(true);
    expect(decisionDiamond && decisionDiamond.kind === 'shape').toBe(true);
    expect(plaqueBanner && plaqueBanner.kind === 'shape').toBe(true);
    expect(canPillar && canPillar.kind === 'shape').toBe(true);
    expect(frameFocus && frameFocus.kind === 'shape').toBe(true);
    expect(pieSlice && pieSlice.kind === 'shape').toBe(true);
    expect(chordSlice && chordSlice.kind === 'shape').toBe(true);
    expect(donutRing && donutRing.kind === 'shape').toBe(true);
    expect(arcSweep && arcSweep.kind === 'shape').toBe(true);
    expect(circularLoop && circularLoop.kind === 'shape').toBe(true);
    expect(curvedForwardArrow && curvedForwardArrow.kind === 'shape').toBe(true);
    expect(smileyMarker && smileyMarker.kind === 'shape').toBe(true);
    expect(bevelPanel && bevelPanel.kind === 'shape').toBe(true);
    expect(chevronTag && chevronTag.kind === 'shape').toBe(true);
    expect(skewPanel && skewPanel.kind === 'shape').toBe(true);
    expect(processTrapezoid && processTrapezoid.kind === 'shape').toBe(true);
    expect(hexNode && hexNode.kind === 'shape').toBe(true);
    expect(themeStylePanel && themeStylePanel.kind === 'shape').toBe(true);
    expect(pictureFillCard && pictureFillCard.kind === 'shape').toBe(true);
    expect(patternStyleChip && patternStyleChip.kind === 'shape').toBe(true);
    expect(mirroredArrow && mirroredArrow.kind === 'shape').toBe(true);
    expect(gradientNote && gradientNote.kind === 'text').toBe(true);
    expect(patternNote && patternNote.kind === 'text').toBe(true);
    expect(verticalLabel && verticalLabel.kind === 'text').toBe(true);
    expect(textBox && textBox.kind === 'text').toBe(true);

    if (slide.background.type === 'gradient') {
      expect(slide.background.angle).toBe(90);
      expect(slide.background.stops).toEqual([
        {
          position: 0,
          color: '#F6F8FB',
          alpha: undefined
        },
        {
          position: 0.65,
          color: '#25A7C5',
          alpha: 0.12
        },
        {
          position: 1,
          color: '#2F6BFF',
          alpha: 0.16
        }
      ]);
    } else {
      throw new Error('Expected grouped-media slide background to keep gradient fill metadata.');
    }

    if (connector && connector.kind === 'shape') {
      expect(connector.line?.alpha).toBeCloseTo(0.62, 4);
      expect(connector.line?.lineCap).toBe('round');
      expect(connector.line?.lineJoin).toBe('round');
      expect(connector.line?.headEnd).toBe('oval');
      expect(connector.line?.tailEnd).toBe('triangle');
    }

    if (callout && callout.kind === 'shape') {
      expect(callout.href).toBe('https://example.com/pptx-previewer/grouped-media');
    }

    if (flowArrow && flowArrow.kind === 'shape') {
      expect(flowArrow.shapeType).toBe('rightArrow');
      expect(flowArrow.geometry).toEqual({
        type: 'preset',
        preset: 'rightArrow',
        adjustments: {
          adj1: 52000,
          adj2: 42000
        }
      });
      expect(flowArrow.fill.type).toBe('solid');
      expect(flowArrow.fill.color).toMatch(/^#/);
      expect(flowArrow.line?.color).toBe('#2F6BFF');
      expect(flowArrow.line?.lineCap).toBe('square');
      expect(flowArrow.line?.lineJoin).toBe('bevel');
    }

    if (mirroredArrow && mirroredArrow.kind === 'shape') {
      expect(mirroredArrow.shapeType).toBe('rightArrow');
      expect(mirroredArrow.groupPath).toContain('Mirrored Group');
      expect(mirroredArrow.transform.flipH).toBe(true);
      expect(mirroredArrow.transform.flipV).toBe(false);
      expect(mirroredArrow.transform.x).toBeCloseTo(816, 3);
      expect(mirroredArrow.transform.y).toBeCloseTo(120, 3);
    }

    if (notchedArrow && notchedArrow.kind === 'shape') {
      expect(notchedArrow.shapeType).toBe('notchedRightArrow');
      expect(notchedArrow.geometry).toEqual({
        type: 'preset',
        preset: 'notchedRightArrow',
        adjustments: {
          adj1: 48000,
          adj2: 46000
        }
      });
      expect(notchedArrow.line?.color).toBe('#FF7A59');
    }

    if (homePlate && homePlate.kind === 'shape') {
      expect(homePlate.shapeType).toBe('homePlate');
      expect(homePlate.geometry).toEqual({
        type: 'preset',
        preset: 'homePlate',
        adjustments: {
          adj: 32000
        }
      });
      expect(homePlate.line?.color).toBe('#FFB020');
    }

    if (rightTriangle && rightTriangle.kind === 'shape') {
      expect(rightTriangle.shapeType).toBe('rtTriangle');
      expect(rightTriangle.geometry).toEqual({
        type: 'preset',
        preset: 'rtTriangle',
        adjustments: {}
      });
      expect(rightTriangle.line?.color).toBe('#2ABF88');
    }

    if (processCloud && processCloud.kind === 'shape') {
      expect(processCloud.shapeType).toBe('cloud');
      expect(processCloud.line?.color).toBe('#8A63D2');
      expect(processCloud.fill.type).toBe('gradient');
      if (processCloud.fill.type === 'gradient') {
        expect(processCloud.fill.angle).toBe(45);
        expect(processCloud.fill.stops).toEqual([
          {
            position: 0,
            color: '#8A63D2',
            alpha: undefined
          },
          {
            position: 1,
            color: '#25A7C5',
            alpha: undefined
          }
        ]);
      } else {
        throw new Error('Expected Process Cloud to keep gradient fill metadata.');
      }
    }

    if (dataCube && dataCube.kind === 'shape') {
      expect(dataCube.shapeType).toBe('cube');
      expect(dataCube.line?.color).toBe('#25A7C5');
    }

    if (starBadge && starBadge.kind === 'shape') {
      expect(starBadge.shapeType).toBe('star5');
      expect(starBadge.geometry).toEqual({
        type: 'preset',
        preset: 'star5',
        adjustments: {
          adj: 22000
        }
      });
      expect(starBadge.line?.color).toBe('#2F6BFF');
      expect(starBadge.fill.type).toBe('solid');
      expect(starBadge.fill.color).toBe(applyTint('#2F6BFF', ooxmlTint(0.35)));
    }

    if (octagonChip && octagonChip.kind === 'shape') {
      expect(octagonChip.shapeType).toBe('octagon');
      expect(octagonChip.geometry).toEqual({
        type: 'preset',
        preset: 'octagon',
        adjustments: {
          adj: 26000
        }
      });
      expect(octagonChip.line?.color).toBe('#25A7C5');
      expect(octagonChip.fill.type).toBe('solid');
      expect(octagonChip.fill.color).toBe(applyTint('#25A7C5', ooxmlTint(0.4)));
    }

    if (signalTriangle && signalTriangle.kind === 'shape') {
      expect(signalTriangle.shapeType).toBe('triangle');
      expect(signalTriangle.geometry).toEqual({
        type: 'preset',
        preset: 'triangle',
        adjustments: {
          adj: 42000
        }
      });
      expect(signalTriangle.line?.color).toBe('#FFB020');
      expect(signalTriangle.fill.type).toBe('solid');
      expect(signalTriangle.fill.color).toBe(applyTint('#FFB020', ooxmlTint(0.42)));
    }

    if (planPentagon && planPentagon.kind === 'shape') {
      expect(planPentagon.shapeType).toBe('pentagon');
      expect(planPentagon.geometry).toEqual({
        type: 'preset',
        preset: 'pentagon',
        adjustments: {}
      });
      expect(planPentagon.line?.color).toBe('#8A63D2');
      expect(planPentagon.fill.type).toBe('solid');
      expect(planPentagon.fill.color).toBe(applyTint('#8A63D2', ooxmlTint(0.38)));
    }

    if (decisionDiamond && decisionDiamond.kind === 'shape') {
      expect(decisionDiamond.shapeType).toBe('diamond');
      expect(decisionDiamond.geometry).toEqual({
        type: 'preset',
        preset: 'diamond',
        adjustments: {}
      });
      expect(decisionDiamond.line?.color).toBe('#FF7A59');
      expect(decisionDiamond.fill.type).toBe('solid');
      expect(decisionDiamond.fill.color).toBe(applyTint('#FF7A59', ooxmlTint(0.36)));
    }

    if (plaqueBanner && plaqueBanner.kind === 'shape') {
      expect(plaqueBanner.shapeType).toBe('plaque');
      expect(plaqueBanner.line?.color).toBe('#FF7A59');
      expect(plaqueBanner.fill.type).toBe('solid');
      expect(plaqueBanner.fill.color).toBe(applyTint('#FF7A59', ooxmlTint(0.42)));
    }

    if (canPillar && canPillar.kind === 'shape') {
      expect(canPillar.shapeType).toBe('can');
      expect(canPillar.line?.color).toBe('#2ABF88');
      expect(canPillar.fill.type).toBe('solid');
      expect(canPillar.fill.color).toBe(applyTint('#2ABF88', ooxmlTint(0.46)));
    }

    if (frameFocus && frameFocus.kind === 'shape') {
      expect(frameFocus.shapeType).toBe('frame');
      expect(frameFocus.geometry).toEqual({
        type: 'preset',
        preset: 'frame',
        adjustments: {
          adj1: 28000
        }
      });
      expect(frameFocus.line?.color).toBe('#FFB020');
      expect(frameFocus.fill.type).toBe('solid');
      expect(frameFocus.fill.color).toBe(applyTint('#FFB020', ooxmlTint(0.36)));
    }

    if (pieSlice && pieSlice.kind === 'shape') {
      expect(pieSlice.shapeType).toBe('pie');
      expect(pieSlice.geometry).toEqual({
        type: 'preset',
        preset: 'pie',
        adjustments: {
          adj1: 16200000,
          adj2: 1200000
        }
      });
      expect(pieSlice.line?.color).toBe('#2F6BFF');
      expect(pieSlice.fill.type).toBe('solid');
      expect(pieSlice.fill.color).toBe(applyTint('#2F6BFF', ooxmlTint(0.32)));
    }

    if (chordSlice && chordSlice.kind === 'shape') {
      expect(chordSlice.shapeType).toBe('chord');
      expect(chordSlice.geometry).toEqual({
        type: 'preset',
        preset: 'chord',
        adjustments: {
          adj1: 0,
          adj2: 16200000
        }
      });
      expect(chordSlice.line?.color).toBe('#FF7A59');
      expect(chordSlice.fill.type).toBe('solid');
      expect(chordSlice.fill.color).toBe(applyTint('#FF7A59', ooxmlTint(0.28)));
    }

    if (donutRing && donutRing.kind === 'shape') {
      expect(donutRing.shapeType).toBe('donut');
      expect(donutRing.geometry).toEqual({
        type: 'preset',
        preset: 'donut',
        adjustments: {
          adj: 32000
        }
      });
      expect(donutRing.line?.color).toBe('#8A63D2');
      expect(donutRing.fill.type).toBe('solid');
      expect(donutRing.fill.color).toBe(applyTint('#8A63D2', ooxmlTint(0.3)));
    }

    if (arcSweep && arcSweep.kind === 'shape') {
      expect(arcSweep.shapeType).toBe('arc');
      expect(arcSweep.geometry).toEqual({
        type: 'preset',
        preset: 'arc',
        adjustments: {
          adj1: 16200000,
          adj2: 5400000
        }
      });
      expect(arcSweep.fill.type).toBe('none');
      expect(arcSweep.line?.color).toBe('#25A7C5');
      expect(arcSweep.line?.width).toBeGreaterThan(2);
      expect(arcSweep.line?.lineCap).toBe('round');
      expect(arcSweep.line?.lineJoin).toBe('round');
    }

    if (circularLoop && circularLoop.kind === 'shape') {
      expect(circularLoop.shapeType).toBe('leftCircularArrow');
      expect(circularLoop.geometry).toEqual({
        type: 'preset',
        preset: 'leftCircularArrow',
        adjustments: {
          adj1: 17000,
          adj2: -3000000,
          adj3: 14400000,
          adj4: 2400000,
          adj5: 5000
        }
      });
      expect(circularLoop.line?.color).toBe('#2ABF88');
      expect(circularLoop.fill.type).toBe('solid');
      expect(circularLoop.fill.color).toBe(applyTint('#2ABF88', ooxmlTint(0.26)));
    }

    if (curvedForwardArrow && curvedForwardArrow.kind === 'shape') {
      expect(curvedForwardArrow.shapeType).toBe('curvedRightArrow');
      expect(curvedForwardArrow.geometry).toEqual({
        type: 'preset',
        preset: 'curvedRightArrow',
        adjustments: {
          adj1: 22000,
          adj2: 30000,
          adj3: 32000
        }
      });
      expect(curvedForwardArrow.line?.color).toBe('#FFB020');
      expect(curvedForwardArrow.fill.type).toBe('solid');
      expect(curvedForwardArrow.fill.color).toBe(applyTint('#FFB020', ooxmlTint(0.33)));
    }

    if (smileyMarker && smileyMarker.kind === 'shape') {
      expect(smileyMarker.shapeType).toBe('smileyFace');
      expect(smileyMarker.geometry).toEqual({
        type: 'preset',
        preset: 'smileyFace',
        adjustments: {
          adj: 3000
        }
      });
      expect(smileyMarker.line?.color).toBe('#122033');
      expect(smileyMarker.fill.type).toBe('solid');
      expect(smileyMarker.fill.color).toBe(applyTint('#FFB020', ooxmlTint(0.45)));
    }

    if (bevelPanel && bevelPanel.kind === 'shape') {
      expect(bevelPanel.shapeType).toBe('bevel');
      expect(bevelPanel.geometry).toEqual({
        type: 'preset',
        preset: 'bevel',
        adjustments: {
          adj: 24000
        }
      });
      expect(bevelPanel.line?.color).toBe('#8A63D2');
      expect(bevelPanel.fill.type).toBe('solid');
      expect(bevelPanel.fill.color).toBe(applyTint('#8A63D2', ooxmlTint(0.45)));
    }

    if (chevronTag && chevronTag.kind === 'shape') {
      expect(chevronTag.shapeType).toBe('chevron');
      expect(chevronTag.geometry).toEqual({
        type: 'preset',
        preset: 'chevron',
        adjustments: {
          adj: 30000
        }
      });
      expect(chevronTag.line?.color).toBe('#25A7C5');
      expect(chevronTag.fill.type).toBe('solid');
      expect(chevronTag.fill.color).toBe(applyTint('#25A7C5', ooxmlTint(0.3)));
    }

    if (skewPanel && skewPanel.kind === 'shape') {
      expect(skewPanel.shapeType).toBe('parallelogram');
      expect(skewPanel.geometry).toEqual({
        type: 'preset',
        preset: 'parallelogram',
        adjustments: {
          adj: 32000
        }
      });
      expect(skewPanel.line?.color).toBe('#2ABF88');
      expect(skewPanel.fill.type).toBe('solid');
      expect(skewPanel.fill.color).toBe(applyTint('#2ABF88', ooxmlTint(0.34)));
    }

    if (processTrapezoid && processTrapezoid.kind === 'shape') {
      expect(processTrapezoid.shapeType).toBe('trapezoid');
      expect(processTrapezoid.geometry).toEqual({
        type: 'preset',
        preset: 'trapezoid',
        adjustments: {
          adj: 22000
        }
      });
      expect(processTrapezoid.line?.color).toBe('#FF7A59');
      expect(processTrapezoid.fill.type).toBe('solid');
      expect(processTrapezoid.fill.color).toBe(applyTint('#FF7A59', ooxmlTint(0.28)));
    }

    if (hexNode && hexNode.kind === 'shape') {
      expect(hexNode.shapeType).toBe('hexagon');
      expect(hexNode.geometry).toEqual({
        type: 'preset',
        preset: 'hexagon',
        adjustments: {
          adj: 28000
        }
      });
      expect(hexNode.line?.color).toBe('#2F6BFF');
      expect(hexNode.fill.type).toBe('solid');
      expect(hexNode.fill.color).toBe(applyTint('#2F6BFF', ooxmlTint(0.36)));
    }

    if (themeStylePanel && themeStylePanel.kind === 'shape') {
      const themeStyleRun = themeStylePanel.textFrame?.paragraphs
        .flatMap((paragraph) => paragraph.runs)
        .find((run) => run.text === 'Theme style matrix');

      expect(themeStylePanel.shapeType).toBe('roundRect');
      expect(themeStylePanel.line?.color).toBe(applyShade('#FFB020', 0.75));
      expect(themeStylePanel.line?.width).toBe(2);
      expect(themeStylePanel.line?.lineCap).toBe('square');
      expect(themeStylePanel.line?.lineJoin).toBe('bevel');
      expect(themeStylePanel.fill.type).toBe('gradient');
      if (themeStylePanel.fill.type === 'gradient') {
        expect(themeStylePanel.fill.angle).toBe(0);
        expect(themeStylePanel.fill.stops).toEqual([
          {
            position: 0,
            color: applyTint('#2ABF88', ooxmlTint(0.65)),
            alpha: undefined
          },
          {
            position: 1,
            color: '#2ABF88',
            alpha: undefined
          }
        ]);
      } else {
        throw new Error('Expected Theme Style Panel to resolve theme style matrix fills.');
      }

      expect(
        themeStylePanel.textFrame?.paragraphs.some((paragraph) =>
          paragraph.runs.some((run) => run.text === 'Theme style matrix')
        )
      ).toBe(true);
      expect(themeStyleRun?.color).toBe('#FFFFFF');
      expect(themeStyleRun?.fontFamily).toBe('Calibri');
      expect(themeStylePanel.shadow?.color).toBe('#2ABF88');
      expect(themeStylePanel.shadow?.alpha).toBeCloseTo(0.36, 4);
      expect(themeStylePanel.shadow?.blur).toBeCloseTo(8, 4);
      expect(themeStylePanel.shadow?.distance).toBeCloseTo(5.333333, 4);
      expect(themeStylePanel.shadow?.offsetX).toBeCloseTo(3.771, 3);
      expect(themeStylePanel.shadow?.offsetY).toBeCloseTo(3.771, 3);
    }

    if (pictureFillCard && pictureFillCard.kind === 'shape') {
      expect(pictureFillCard.shapeType).toBe('roundRect');
      expect(pictureFillCard.fill.type).toBe('picture');
      expect(pictureFillCard.fill.mediaId).toBe('ppt/media/image1.png');
      expect(pictureFillCard.fill.crop?.left).toBeCloseTo(0.12, 4);
      expect(pictureFillCard.fill.crop?.right).toBeCloseTo(0.06, 4);
      expect(pictureFillCard.fill.crop?.top).toBeCloseTo(0.1, 4);
      expect(pictureFillCard.fill.crop?.bottom).toBeCloseTo(0.08, 4);
      expect(pictureFillCard.fill.alpha).toBeCloseTo(0.72, 4);
      expect(
        pictureFillCard.textFrame?.paragraphs.some((paragraph) =>
          paragraph.runs.some((run) => run.text === 'Picture fill support')
        )
      ).toBe(true);
    }

    if (patternStyleChip && patternStyleChip.kind === 'shape') {
      expect(patternStyleChip.fill.type).toBe('pattern');
      expect(patternStyleChip.fill.pattern).toBe('diagCross');
      expect(patternStyleChip.fill.foregroundColor).toBe('#8A63D2');
      expect(patternStyleChip.fill.backgroundColor).toBe('#F6F8FB');
      expect(patternStyleChip.fill.backgroundAlpha).toBeCloseTo(0.82, 4);
      expect(patternStyleChip.shadow?.color).toBe('#8A63D2');
      expect(
        patternStyleChip.textFrame?.paragraphs.some((paragraph) =>
          paragraph.runs.some((run) => run.text === 'Theme pattern fill')
        )
      ).toBe(true);
    }

    if (gradientNote && gradientNote.kind === 'text') {
      expect(gradientNote.fill.type).toBe('gradient');
      if (gradientNote.fill.type === 'gradient') {
        expect(gradientNote.fill.angle).toBe(0);
        expect(gradientNote.fill.stops).toEqual([
          {
            position: 0,
            color: '#2F6BFF',
            alpha: undefined
          },
          {
            position: 0.5,
            color: '#25A7C5',
            alpha: 0.78
          },
          {
            position: 1,
            color: '#2ABF88',
            alpha: undefined
          }
        ]);
      } else {
        throw new Error('Expected Gradient Note to keep gradient fill metadata.');
      }

      expect(
        gradientNote.textFrame.paragraphs.some((paragraph) =>
          paragraph.runs.some((run) => run.text === 'Gradient surface support')
        )
      ).toBe(true);
      expect(gradientNote.shadow?.color).toBe('#2F6BFF');
      expect(gradientNote.shadow?.alpha).toBeCloseTo(0.32, 4);
      expect(gradientNote.shadow?.blur).toBeCloseTo(6.666667, 4);
      expect(gradientNote.shadow?.distance).toBeCloseTo(4, 4);
      expect(gradientNote.shadow?.offsetX).toBeCloseTo(0, 4);
      expect(gradientNote.shadow?.offsetY).toBeCloseTo(4, 4);
    }

    if (patternNote && patternNote.kind === 'text') {
      expect(patternNote.fill.type).toBe('pattern');
      expect(patternNote.fill.pattern).toBe('diagCross');
      expect(patternNote.fill.foregroundColor).toBe('#25A7C5');
      expect(patternNote.fill.backgroundColor).toBe('#F6F8FB');
      expect(patternNote.fill.backgroundAlpha).toBeCloseTo(0.88, 4);
      const run = patternNote.textFrame.paragraphs[0]?.runs[0];
      expect(run?.highlightColor).toBe('#2F6BFF');
      expect(run?.highlightAlpha).toBeCloseTo(0.26, 4);
      expect(
        patternNote.textFrame.paragraphs.some((paragraph) =>
          paragraph.runs.some((run) => run.text === 'Pattern fill note')
        )
      ).toBe(true);
    }

    if (verticalLabel && verticalLabel.kind === 'text') {
      expect(verticalLabel.textFrame.direction).toBe('vertical270');
      expect(verticalLabel.textFrame.verticalAlign).toBe('middle');
      expect(
        verticalLabel.textFrame.paragraphs.some((paragraph) =>
          paragraph.runs.some((run) => run.text === 'Vertical label')
        )
      ).toBe(true);
    }

    if (image && image.kind === 'image') {
      expect(image.crop?.left).toBeCloseTo(0.08, 4);
      expect(image.crop?.right).toBeCloseTo(0.12, 4);
      expect(image.crop?.top).toBeCloseTo(0.05, 4);
      expect(image.crop?.bottom).toBeCloseTo(0.15, 4);
      expect(image.opacity).toBeCloseTo(0.68, 4);
      expect(image.line?.color).toBe('#FF7A59');
      expect(image.line?.width).toBeGreaterThan(1);
      expect(image.line?.dash).toBe('dashDot');
    }

    if (textBox && textBox.kind === 'text') {
      expect(textBox.fill.type).toBe('solid');
      expect(textBox.fill.color).toBe('#FF7A59');
      expect(textBox.fill.alpha).toBeCloseTo(0.18, 4);
      expect(textBox.line?.dash).toBe('dash');
      expect(textBox.line?.width).toBeGreaterThan(1);
      const run = textBox.textFrame.paragraphs[0]?.runs[0];
      expect(run?.color).toBe('#FF7A59');
      expect(run?.colorAlpha).toBeCloseTo(0.54, 4);
      expect(
        textBox.textFrame.paragraphs.some((paragraph) =>
          paragraph.runs.some((run) => run.text === 'Text box styles now keep fill and outline.')
        )
      ).toBe(true);
    }

    if (listStyleBox && listStyleBox.kind === 'text') {
      const paragraph = listStyleBox.textFrame.paragraphs.find((entry) =>
        entry.runs.some((run) => run.text === 'Inherited list style item')
      );
      const run = paragraph?.runs.find((entry) => entry.text === 'Inherited list style item');

      expect(paragraph?.bullet?.char).toBe(BULLET);
      expect(paragraph?.marginLeft).toBeGreaterThan(0);
      expect(paragraph?.indent).toBeLessThan(0);
      expect(run?.italic).toBe(true);
      expect(run?.fontSize).toBe(24);
      expect(run?.color).toBe('#2ABF88');
    }
  });

  it('records warnings and placeholders for unsupported preset shapes', async () => {
    const presentation = await loadPptx(await readFixture('fixtures-unsupported-shape.pptx'));
    const unsupported = presentation.slides[0].items.find(
      (item) => item.kind === 'unsupported' && item.name === 'Unsupported Wedge Callout'
    );

    expect(unsupported && unsupported.kind === 'unsupported').toBe(true);
    expect(presentation.warnings).toContain(
      'Unsupported shape Unsupported Wedge Callout (wedgeRoundRectCallout).'
    );

    if (unsupported && unsupported.kind === 'unsupported') {
      expect(unsupported.unsupportedType).toBe('wedgeRoundRectCallout');
      expect(unsupported.label).toBe('Unsupported shape');
    }
  });

  it('parses graphic frame tables into HTML-friendly cells', async () => {
    const presentation = await loadPptx(await readFixture('fixtures-table-placeholder.pptx'));
    const table = presentation.slides[0].items.find((item) => item.kind === 'table');

    expect(table && table.kind === 'table').toBe(true);
    expect(presentation.slides[0].background).toEqual({
      type: 'solid',
      color: '#25A7C5',
      alpha: 0.09
    });

    if (table && table.kind === 'table') {
      const headerCell = table.cells.find((cell) =>
        cell.textFrame.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text === 'Feature'))
      );
      const coverageCell = table.cells.find((cell) =>
        cell.textFrame.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text === 'Coverage'))
      );
      const previewEngineCell = table.cells.find((cell) =>
        cell.textFrame.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text === 'Preview engine'))
      );
      const horizontalContinuation = table.cells.find((cell) => cell.row === 0 && cell.column === 2);
      const verticalContinuation = table.cells.find((cell) => cell.row === 2 && cell.column === 0);

      expect(table.columns).toHaveLength(3);
      expect(table.rows).toHaveLength(3);
      expect(table.cells).toHaveLength(9);
      expect(table.cells.some((cell) => cell.textFrame.paragraphs[0]?.runs[0]?.text === 'Feature')).toBe(true);
      expect(headerCell?.borders?.top?.color).toBe('#FF7A59');
      expect(headerCell?.borders?.left?.width).toBeGreaterThan(1);
      expect(headerCell?.textFrame.padding.left).toBeGreaterThan(0);
      expect(headerCell?.textFrame.verticalAlign).toBe('middle');
      expect(coverageCell?.column).toBe(1);
      expect(coverageCell?.colSpan).toBe(2);
      expect(coverageCell?.isMergedContinuation).toBe(false);
      expect(previewEngineCell?.row).toBe(1);
      expect(previewEngineCell?.rowSpan).toBe(2);
      expect(previewEngineCell?.isMergedContinuation).toBe(false);
      expect(horizontalContinuation?.isMergedContinuation).toBe(true);
      expect(verticalContinuation?.isMergedContinuation).toBe(true);
    }
  });

  it('parses real sample table merges when span attributes live on a:tc nodes', async () => {
    const presentation = await loadPptx(await readFixture('../../apps/demo/public/samples/vue-office-test.pptx'));
    const table = presentation.slides[12]?.items.find((item) => item.kind === 'table');

    expect(table && table.kind === 'table').toBe(true);

    if (table && table.kind === 'table') {
      const noteHeader = table.cells.find((cell) => cell.row === 0 && cell.column === 5);
      const noteBody = table.cells.find((cell) => cell.row === 1 && cell.column === 5);
      const horizontalContinuationA = table.cells.find((cell) => cell.row === 0 && cell.column === 6);
      const horizontalContinuationB = table.cells.find((cell) => cell.row === 0 && cell.column === 7);
      const mergedBodyContinuationA = table.cells.find((cell) => cell.row === 1 && cell.column === 6);
      const mergedBodyContinuationB = table.cells.find((cell) => cell.row === 1 && cell.column === 7);

      expect(table.columns).toHaveLength(8);
      expect(noteHeader?.textFrame.paragraphs[0]?.runs[0]?.text).toBe('备注');
      expect(noteHeader?.colSpan).toBe(3);
      expect(noteHeader?.isMergedContinuation).toBe(false);
      expect(noteBody?.textFrame.paragraphs[0]?.runs[0]?.text).toBe('合并单元格的备注');
      expect(noteBody?.colSpan).toBe(3);
      expect(noteBody?.fill.color).toBe('#ED7D31');
      expect(noteBody?.textFrame.paragraphs[0]?.runs[0]?.bold).toBe(true);
      expect(noteBody?.textFrame.paragraphs[0]?.runs[0]?.color).toBe('#FFFFFF');
      expect(horizontalContinuationA?.isMergedContinuation).toBe(true);
      expect(horizontalContinuationB?.isMergedContinuation).toBe(true);
      expect(mergedBodyContinuationA?.isMergedContinuation).toBe(true);
      expect(mergedBodyContinuationB?.isMergedContinuation).toBe(true);
    }
  });

  it('inherits real sample table font sizes from presentation default text styles', async () => {
    const presentation = await loadPptx(await readFixture('../../apps/demo/public/samples/vue-office-test.pptx'));
    const table = presentation.slides[12]?.items.find((item) => item.kind === 'table');

    expect(table && table.kind === 'table').toBe(true);

    if (table && table.kind === 'table') {
      const headerCell = table.cells.find((cell) => cell.row === 0 && cell.column === 0);
      const bodyNameCell = table.cells.find((cell) => cell.row === 1 && cell.column === 1);
      const mergedNoteCell = table.cells.find((cell) => cell.row === 1 && cell.column === 5);

      expect(headerCell?.textFrame.paragraphs[0]?.runs[0]?.fontSize).toBe(24);
      expect(headerCell?.textFrame.verticalAlign).toBe('middle');
      expect(bodyNameCell?.textFrame.paragraphs[0]?.runs[0]?.fontSize).toBe(24);
      expect(bodyNameCell?.textFrame.verticalAlign).toBe('middle');
      expect(mergedNoteCell?.textFrame.paragraphs[0]?.runs[0]?.fontSize).toBe(24);
      expect(mergedNoteCell?.textFrame.verticalAlign).toBe('middle');
    }
  });

  it('maps real sample table band fills from OOXML tint values', async () => {
    const presentation = await loadPptx(await readFixture('../../apps/demo/public/samples/vue-office-test.pptx'));
    const table = presentation.slides[12]?.items.find((item) => item.kind === 'table');

    expect(table && table.kind === 'table').toBe(true);

    if (table && table.kind === 'table') {
      const headerCell = table.cells.find((cell) => cell.row === 0 && cell.column === 0);
      const bandedBodyCell = table.cells.find((cell) => cell.row === 1 && cell.column === 1);
      const paleBodyCell = table.cells.find((cell) => cell.row === 2 && cell.column === 2);

      expect(headerCell?.fill.color).toBe('#70AD47');
      expect(bandedBodyCell?.fill.color).toBe('#C5E0B4');
      expect(paleBodyCell?.fill.color).toBe('#E2F0D9');
    }
  });

  it('parses internal slide hyperlinks in multi-slide decks', async () => {
    const presentation = await loadPptx(await readFixture('../../apps/demo/public/samples/sample-deck.pptx'));
    const linkRun = presentation.slides[0].items
      .filter((item) => item.kind === 'shape')
      .flatMap((item) => item.textFrame?.paragraphs ?? [])
      .flatMap((paragraph) => paragraph.runs)
      .find((run) => run.text === 'Jump to table slide');

    expect(linkRun?.slideIndex).toBe(2);
  });

  it('parses PowerPoint navigation action hyperlinks', async () => {
    const presentation = await loadPptx(await readFixture('../../apps/demo/public/samples/sample-deck.pptx'));
    const runs = presentation.slides[2].items
      .filter((item) => item.kind === 'shape')
      .flatMap((item) => item.textFrame?.paragraphs ?? [])
      .flatMap((paragraph) => paragraph.runs);
    const image = presentation.slides[1].items.find((item) => item.kind === 'image');

    expect(runs.find((run) => run.text === 'Back to first slide')?.navigationAction).toBe('first');
    expect(runs.find((run) => run.text === 'Return to last viewed slide')?.navigationAction).toBe('lastViewed');
    expect(image?.slideIndex).toBe(2);
  });

  it('parses bodyPr overflow, anchor center, and downgraded warnings', async () => {
    const presentation = await loadPptx(await readFixture('fixtures-bodypr-wrap-anchor.pptx'));
    const box = presentation.slides[0].items.find((item) => item.kind === 'shape' && item.name === 'BodyPr Box');

    expect(box && box.kind === 'shape').toBe(true);
    expect(presentation.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('rtlCol'),
        expect.stringContaining('WordArt'),
        expect.stringContaining('numCol=2')
      ])
    );

    if (box && box.kind === 'shape') {
      expect(box.textFrame?.wrap).toBe('none');
      expect(box.textFrame?.anchorCenter).toBe(true);
      expect(box.textFrame?.verticalAlign).toBe('middle');
      expect(box.textFrame?.horizontalOverflow).toBe('clip');
      expect(box.textFrame?.verticalOverflow).toBe('clip');
      expect(box.textFrame?.columns).toBe(2);
      expect(box.textFrame?.columnSpacing).toBeCloseTo(19.2, 4);
      expect(box.textFrame?.rtlColumns).toBe(true);
      expect(box.textFrame?.fromWordArt).toBe(true);
      expect(box.textFrame?.padding.left).toBeCloseTo(9.6, 4);
      expect(box.textFrame?.padding.right).toBeCloseTo(19.2, 4);
      expect(box.textFrame?.autofit).toEqual({
        type: 'normal',
        fontScale: 0.82,
        lineSpaceReduction: 0.12
      });
      expect(box.textFrame?.paragraphs[0]?.lineHeightUnit).toBe('multiple');
      expect(box.textFrame?.paragraphs[0]?.lineHeight).toBeCloseTo(0.88, 3);
    }
  });

  it('parses preset shape text bounds fixture without warnings', async () => {
    const presentation = await loadPptx(await readFixture('fixtures-shape-text-bounds.pptx'));
    const arrow = presentation.slides[0].items.find((item) => item.kind === 'shape' && item.name === 'Arrow Label');
    const diamond = presentation.slides[0].items.find((item) => item.kind === 'shape' && item.name === 'Diamond Label');

    expect(presentation.warnings).toEqual([]);
    expect(arrow && arrow.kind === 'shape').toBe(true);
    expect(diamond && diamond.kind === 'shape').toBe(true);

    if (arrow && arrow.kind === 'shape') {
      expect(arrow.shapeType).toBe('rightArrow');
      expect(arrow.textFrame?.paragraphs[0]?.runs[0]?.text).toBe('Arrow CTA');
      expect(arrow.geometry).toEqual({
        type: 'preset',
        preset: 'rightArrow',
        adjustments: {
          adj1: 42000,
          adj2: 52000
        }
      });
    }
  });

  it('parses table text styles from table style parts and preserves local overrides', async () => {
    const presentation = await loadPptx(await readFixture('fixtures-table-style-text.pptx'));
    const table = presentation.slides[0].items.find((item) => item.kind === 'table');

    expect(table && table.kind === 'table').toBe(true);

    if (table && table.kind === 'table') {
      const tierCell = table.cells.find((cell) =>
        cell.textFrame.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text === 'Tier'))
      );
      const goldCell = table.cells.find((cell) =>
        cell.textFrame.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text === 'Gold'))
      );
      const notesCell = table.cells.find((cell) =>
        cell.textFrame.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text === 'Notes'))
      );
      const overrideCell = table.cells.find((cell) =>
        cell.textFrame.paragraphs.some((paragraph) =>
          paragraph.runs.some((run) => run.text === 'Local override stays italic')
        )
      );

      expect(tierCell?.fill.color).toBe('#2ABF88');
      expect(tierCell?.textFrame.paragraphs[0]?.align).toBe('center');
      expect(tierCell?.textFrame.paragraphs[0]?.runs[0]?.fontFamily).toBe('Aptos');
      expect(tierCell?.textFrame.paragraphs[0]?.runs[0]?.fontSize).toBeCloseTo(22.667, 3);
      expect(tierCell?.textFrame.paragraphs[0]?.runs[0]?.bold).toBe(true);
      expect(tierCell?.textFrame.paragraphs[0]?.runs[0]?.color).toBe('#FF7A59');

      expect(goldCell?.textFrame.paragraphs[0]?.align).toBe('center');
      expect(goldCell?.textFrame.paragraphs[0]?.runs[0]?.fontFamily).toBe('Aptos');
      expect(goldCell?.textFrame.paragraphs[0]?.runs[0]?.fontSize).toBeCloseTo(22.667, 3);
      expect(goldCell?.textFrame.paragraphs[0]?.runs[0]?.bold).toBe(true);
      expect(goldCell?.textFrame.paragraphs[0]?.runs[0]?.color).toBe('#FF7A59');

      expect(notesCell?.textFrame.paragraphs[0]?.runs[0]?.underline).toBe(true);
      expect(notesCell?.textFrame.paragraphs[0]?.runs[0]?.color).toBe('#2F6BFF');

      expect(overrideCell?.textFrame.paragraphs[0]?.align).toBe('center');
      expect(overrideCell?.textFrame.paragraphs[0]?.runs[0]?.fontFamily).toBe('Calibri');
      expect(overrideCell?.textFrame.paragraphs[0]?.runs[0]?.fontSize).toBe(20);
      expect(overrideCell?.textFrame.paragraphs[0]?.runs[0]?.italic).toBe(true);
      expect(overrideCell?.textFrame.paragraphs[0]?.runs[0]?.color).toBe('#C2410C');
    }
  });

  it.skipIf(!fixtureExists('../../tmp/zhangwei-promo.pptx'))('drops inherited generic placeholder prompt text from zhangwei promotion deck while keeping authored slide content', async () => {
    const presentation = await loadPptx(await readFixture('../../tmp/zhangwei-promo.pptx'));
    const collectTexts = (slideIndex: number): string[] =>
      presentation.slides[slideIndex].items.flatMap((item) => {
        if (item.kind !== 'text' && item.kind !== 'shape') {
          return [];
        }

        return (item.textFrame?.paragraphs ?? [])
          .map((paragraph) => paragraph.runs.map((run) => run.text).join('').trim())
          .filter(Boolean);
      });

    const collectAlignments = (slideIndex: number): Array<string | undefined> =>
      presentation.slides[slideIndex].items.flatMap((item) => {
        if (item.kind !== 'text' && item.kind !== 'shape') {
          return [];
        }

        return (item.textFrame?.paragraphs ?? [])
          .filter((paragraph) => paragraph.runs.map((run) => run.text).join('').trim())
          .map((paragraph) => paragraph.align);
      });

    const slide1Texts = collectTexts(0);
    const slide1Alignments = collectAlignments(0);
    const slide2Alignments = collectAlignments(1);
    const slide8Texts = collectTexts(7);
    const allTexts = presentation.slides.flatMap((_, slideIndex) => collectTexts(slideIndex));

    expect(presentation.slides).toHaveLength(8);
    expect(presentation.warnings).toEqual([]);
    expect(presentation.slides[0].title).toBe('月度OKR Review方法&规则');
    expect(slide1Texts).toContain('月度OKR Review方法&规则');
    expect(slide1Texts).toContain('答辩述职材料概要—张玮—I8');
    expect(slide8Texts).toContain('Q&A');
    expect(allTexts).not.toContain('标题文本');
    expect(allTexts.some((text) => text.includes('正文级别 1'))).toBe(false);
  });

  it.skipIf(!fixtureExists('../../tmp/zhangwei-promo.pptx'))('does not inherit master otherStyle right alignment into zhangwei ordinary text boxes', async () => {
    const presentation = await loadPptx(await readFixture('../../tmp/zhangwei-promo.pptx'));
    const collectAlignments = (slideIndex: number): Array<string | undefined> =>
      presentation.slides[slideIndex].items.flatMap((item) => {
        if (item.kind !== 'text' && item.kind !== 'shape') {
          return [];
        }

        return (item.textFrame?.paragraphs ?? [])
          .filter((paragraph) => paragraph.runs.map((run) => run.text).join('').trim())
          .map((paragraph) => paragraph.align);
      });

    expect(collectAlignments(0)).not.toContain('right');
    expect(collectAlignments(1)).not.toContain('right');
  });

  it.skipIf(!fixtureExists('../../tmp/zhangwei-promo.pptx'))('keeps zhangwei ordinary text box body copy at presentation default size', async () => {
    const presentation = await loadPptx(await readFixture('../../tmp/zhangwei-promo.pptx'));
    const slide = presentation.slides[5];
    const textBox = slide.items.find((item) => item.kind === 'text' && item.name === '文本框 8');

    expect(textBox && textBox.kind === 'text').toBe(true);

    if (textBox && textBox.kind === 'text') {
      const bodyParagraph = textBox.textFrame.paragraphs.find((paragraph) =>
        paragraph.runs.some((run) => run.text.includes('协助彩蛋排查ios某版本拉新提现页报错问题'))
      );
      const run = bodyParagraph?.runs.find((entry) => entry.text.trim());

      expect(run?.fontSize).toBeCloseTo(24, 3);
      expect(run?.fontFamily).not.toBe('Helvetica');
    }
  });

  it.skipIf(!fixtureExists('../../tmp/jifen.pptx'))('drops master-style template placeholder prompts from jifen deck while keeping authored content', async () => {
    const presentation = await loadPptx(await readFixture('../../tmp/jifen.pptx'));
    const collectTexts = (slideIndex: number): string[] =>
      presentation.slides[slideIndex].items.flatMap((item) => {
        if (item.kind !== 'text' && item.kind !== 'shape') {
          return [];
        }

        return (item.textFrame?.paragraphs ?? [])
          .map((paragraph) => paragraph.runs.map((run) => run.text).join('').trim())
          .filter(Boolean);
      });

    const allTexts = presentation.slides.flatMap((_, slideIndex) => collectTexts(slideIndex));
    const slide1Texts = collectTexts(0);
    const slide2Texts = collectTexts(1);

    expect(presentation.slides).toHaveLength(24);
    expect(presentation.warnings).toEqual([]);
    expect(slide1Texts).toContain('居住证积分');
    expect(slide2Texts).toContain('目录');
    expect(slide2Texts).toContain('什么是“居住证积分”？');
    expect(allTexts).not.toContain('编辑母版文本样式');
    expect(allTexts).not.toContain('第二级');
    expect(allTexts).not.toContain('第三级');
    expect(allTexts).not.toContain('第四级');
    expect(allTexts).not.toContain('第五级');
  });

  it('merges inherited bullet font and color when local paragraphs only override bullet type', async () => {
    const presentation = await loadPptx(await buildBulletInheritanceFixture());
    const slide = presentation.slides[0];
    const listStyleTextBox = slide.items.find((item) => item.kind === 'text' && item.name === 'List Style Inheritance');
    const placeholderShape = slide.items.find((item) => item.kind === 'shape' && item.name === 'Slide Body Placeholder');

    expect(listStyleTextBox && listStyleTextBox.kind === 'text').toBe(true);
    expect(placeholderShape && placeholderShape.kind === 'shape').toBe(true);

    if (listStyleTextBox && listStyleTextBox.kind === 'text') {
      const bulletParagraph = listStyleTextBox.textFrame.paragraphs.find((paragraph) =>
        paragraph.runs.some((run) => run.text === 'List style bullet override')
      );
      const autoNumberParagraph = listStyleTextBox.textFrame.paragraphs.find((paragraph) =>
        paragraph.runs.some((run) => run.text === 'List style auto number override')
      );

      expect(bulletParagraph?.bullet?.char).toBe('\u00FC');
      expect(bulletParagraph?.bullet?.fontFamily).toBe('Wingdings');
      expect(bulletParagraph?.bullet?.color).toBe('#FFB020');
      expect(bulletParagraph?.marginLeft).toBeCloseTo(36, 4);
      expect(bulletParagraph?.indent).toBeCloseTo(-18, 4);

      expect(autoNumberParagraph?.bullet?.autoType).toBe('arabicPeriod');
      expect(autoNumberParagraph?.bullet?.startAt).toBe(4);
      expect(autoNumberParagraph?.bullet?.fontFamily).toBe('Wingdings');
      expect(autoNumberParagraph?.bullet?.color).toBe('#FFB020');
      expect(autoNumberParagraph?.marginLeft).toBeCloseTo(36, 4);
      expect(autoNumberParagraph?.indent).toBeCloseTo(-18, 4);
    }

    if (placeholderShape && placeholderShape.kind === 'shape') {
      const paragraph = placeholderShape.textFrame?.paragraphs.find((entry) =>
        entry.runs.some((run) => run.text === 'Placeholder bullet override')
      );

      expect(paragraph?.bullet?.char).toBe('n');
      expect(paragraph?.bullet?.fontFamily).toBe('Wingdings');
      expect(paragraph?.bullet?.color).toBe('#8A63D2');
      expect(paragraph?.marginLeft).toBeCloseTo(48, 4);
      expect(paragraph?.indent).toBeCloseTo(-24, 4);
    }
  });

  it('inherits placeholder text styling even when the slide placeholder is exported as a text box', async () => {
    const presentation = await loadPptx(await buildCrossKindPlaceholderTextFixture());
    const titleBox = presentation.slides[0]?.items.find(
      (item) => item.kind === 'text' && item.placeholder?.type === 'ctrTitle'
    );

    expect(titleBox && titleBox.kind === 'text').toBe(true);

    if (titleBox && titleBox.kind === 'text') {
      const paragraphs = titleBox.textFrame.paragraphs;
      const firstRun = paragraphs[0]?.runs[0];
      const secondRun = paragraphs[1]?.runs[0];

      expect(paragraphs[0]?.bullet).toBeUndefined();
      expect(firstRun?.text).toBe('Cross-kind title');
      expect(firstRun?.fontFamily).toBe('Roboto');
      expect(firstRun?.fontSize).toBe(64);
      expect(firstRun?.color).toBe('#FFFFFF');
      expect(secondRun?.text).toBe('subtitle line');
      expect(secondRun?.fontFamily).toBe('Roboto');
      expect(secondRun?.fontSize).toBe(32);
      expect(secondRun?.color).toBe('#FFFFFF');
      expect(titleBox.textFrame.verticalAlign).toBe('bottom');
    }
  });
});

async function buildBulletInheritanceFixture(): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(await buildDefaultTextStyleFixture());
  zip.file(
    'ppt/slideLayouts/slideLayout1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" preserve="1">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Layout Body Placeholder"/>
          <p:cNvSpPr/>
          <p:nvPr><p:ph type="body" idx="1"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="5486400" y="914400"/><a:ext cx="2743200" cy="914400"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
          <a:ln><a:noFill/></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p>
            <a:pPr marL="457200" indent="-228600">
              <a:buChar char="&#8226;"/>
              <a:buFont typeface="Wingdings"/>
              <a:buClr><a:schemeClr val="accent5"/></a:buClr>
            </a:pPr>
            <a:r><a:t>Base placeholder bullet</a:t></a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sldLayout>`
  );
  zip.file(
    'ppt/slides/slide1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="List Style Inheritance"/>
          <p:cNvSpPr txBox="1"/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="914400" y="914400"/><a:ext cx="3657600" cy="1371600"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
          <a:ln><a:noFill/></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle>
            <a:lvl1pPr marL="342900" indent="-171450">
              <a:buChar char="&#8226;"/>
              <a:buFont typeface="Wingdings"/>
              <a:buClr><a:schemeClr val="accent4"/></a:buClr>
            </a:lvl1pPr>
          </a:lstStyle>
          <a:p>
            <a:pPr><a:buChar char="&#252;"/></a:pPr>
            <a:r><a:t>List style bullet override</a:t></a:r>
          </a:p>
          <a:p>
            <a:pPr><a:buAutoNum type="arabicPeriod" startAt="4"/></a:pPr>
            <a:r><a:t>List style auto number override</a:t></a:r>
          </a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="3" name="Slide Body Placeholder"/>
          <p:cNvSpPr/>
          <p:nvPr><p:ph type="body" idx="1"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="5486400" y="914400"/><a:ext cx="2743200" cy="914400"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
          <a:ln><a:noFill/></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p>
            <a:pPr><a:buChar char="n"/></a:pPr>
            <a:r><a:t>Placeholder bullet override</a:t></a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`
  );

  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
}

async function buildCrossKindPlaceholderTextFixture(): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(await buildDefaultTextStyleFixture());
  zip.file(
    'ppt/slideMasters/slideMaster1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Master Title Placeholder"/>
          <p:cNvSpPr/>
          <p:nvPr><p:ph type="title"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="457200" y="457200"/><a:ext cx="7315200" cy="914400"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
          <a:ln><a:noFill/></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr anchor="b"/>
          <a:lstStyle>
            <a:lvl1pPr>
              <a:buNone/>
              <a:defRPr sz="3200">
                <a:solidFill><a:schemeClr val="lt1"/></a:solidFill>
                <a:latin typeface="Roboto"/>
                <a:ea typeface="Roboto"/>
                <a:cs typeface="Roboto"/>
                <a:sym typeface="Roboto"/>
              </a:defRPr>
            </a:lvl1pPr>
          </a:lstStyle>
          <a:p><a:endParaRPr/></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst>
    <p:sldLayoutId id="2147483649" r:id="rId1"/>
  </p:sldLayoutIdLst>
  <p:txStyles>
    <p:titleStyle>
      <a:lvl1pPr>
        <a:buNone/>
        <a:defRPr sz="1400">
          <a:solidFill><a:srgbClr val="000000"/></a:solidFill>
          <a:latin typeface="Arial"/>
          <a:ea typeface="Arial"/>
          <a:cs typeface="Arial"/>
          <a:sym typeface="Arial"/>
        </a:defRPr>
      </a:lvl1pPr>
    </p:titleStyle>
  </p:txStyles>
</p:sldMaster>`
  );
  zip.file(
    'ppt/slideLayouts/slideLayout1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" preserve="1">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Layout Center Title"/>
          <p:cNvSpPr/>
          <p:nvPr><p:ph type="ctrTitle"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="390525" y="1819275"/><a:ext cx="8222100" cy="933600"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
          <a:ln><a:noFill/></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr anchor="b"/>
          <a:lstStyle>
            <a:lvl1pPr>
              <a:buNone/>
              <a:defRPr sz="4800"/>
            </a:lvl1pPr>
          </a:lstStyle>
          <a:p><a:endParaRPr/></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sldLayout>`
  );
  zip.file(
    'ppt/slides/slide1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Cross Kind Title"/>
          <p:cNvSpPr txBox="1"/>
          <p:nvPr><p:ph type="ctrTitle"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="390525" y="597125"/><a:ext cx="8222100" cy="2155800"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
          <a:ln><a:noFill/></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr anchor="b"/>
          <a:lstStyle/>
          <a:p>
            <a:pPr marL="0" indent="0" algn="l"/>
            <a:r><a:rPr lang="en"/><a:t>Cross-kind title</a:t></a:r>
          </a:p>
          <a:p>
            <a:pPr marL="0" indent="0" algn="l"/>
            <a:r><a:rPr lang="en" sz="2400"/><a:t>subtitle line</a:t></a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`
  );

  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
}

async function buildColumnChartFixture(): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(await buildDefaultTextStyleFixture());
  const slideXml = await zip.file('ppt/slides/slide1.xml')?.async('text');
  zip.file(
    'ppt/slides/slide1.xml',
    slideXml?.replace(
      '</p:spTree>',
      `<p:graphicFrame>
        <p:nvGraphicFramePr><p:cNvPr id="4" name="Clustered chart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
        <p:xfrm><a:off x="4572000" y="457200"/><a:ext cx="4114800" cy="2057400"/></p:xfrm>
        <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId2"/></a:graphicData></a:graphic>
      </p:graphicFrame>
      <p:graphicFrame>
        <p:nvGraphicFramePr><p:cNvPr id="5" name="Stacked chart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
        <p:xfrm><a:off x="4572000" y="2743200"/><a:ext cx="4114800" cy="2057400"/></p:xfrm>
        <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId3"/></a:graphicData></a:graphic>
      </p:graphicFrame>
    </p:spTree>`
    ) ?? ''
  );

  const relationshipsXml = await zip.file('ppt/slides/_rels/slide1.xml.rels')?.async('text');
  zip.file(
    'ppt/slides/_rels/slide1.xml.rels',
    relationshipsXml?.replace(
      '</Relationships>',
      `  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart2.xml"/>
</Relationships>`
    ) ?? ''
  );

  zip.file('ppt/charts/chart1.xml', buildColumnChartXml('clustered', 'Chart 1', 'b', true));
  zip.file('ppt/charts/chart2.xml', buildColumnChartXml('stacked', 'Chart 2', 'r', false));
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
}

function buildColumnChartXml(grouping: 'clustered' | 'stacked', title: string, legendPosition: string, axisBounds: boolean): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <c:chart>
    <c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${title}</a:t></a:r></a:p></c:rich></c:tx></c:title>
    <c:plotArea>
      <c:barChart>
        <c:barDir val="col"/><c:grouping val="${grouping}"/>
        <c:ser>
          <c:idx val="0"/><c:order val="0"/>
          <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Series 1</c:v></c:pt></c:strCache></c:strRef></c:tx>
          <c:spPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></c:spPr>
          <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>Category 1</c:v></c:pt><c:pt idx="1"><c:v>Category 2</c:v></c:pt></c:strCache></c:strRef></c:cat>
          <c:val><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>4.3</c:v></c:pt><c:pt idx="1"><c:v>2.5</c:v></c:pt></c:numCache></c:numRef></c:val>
        </c:ser>
        <c:ser>
          <c:idx val="1"/><c:order val="1"/>
          <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Series 2</c:v></c:pt></c:strCache></c:strRef></c:tx>
          <c:spPr><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></c:spPr>
          <c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>Category 1</c:v></c:pt><c:pt idx="1"><c:v>Category 2</c:v></c:pt></c:strCache></c:strRef></c:cat>
          <c:val><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>2.4</c:v></c:pt></c:numCache></c:numRef></c:val>
        </c:ser>
      </c:barChart>
      <c:valAx>
        <c:scaling>${axisBounds ? '<c:min val="-2"/><c:max val="8"/>' : ''}</c:scaling>
        <c:numFmt formatCode="0.0" sourceLinked="0"/>
        ${axisBounds ? '<c:majorUnit val="2"/>' : ''}
      </c:valAx>
    </c:plotArea>
    <c:legend><c:legendPos val="${legendPosition}"/></c:legend>
  </c:chart>
</c:chartSpace>`;
}

async function buildDefaultTextStyleFixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
  );
  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst>
    <p:sldMasterId id="2147483648" r:id="rId1"/>
  </p:sldMasterIdLst>
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId2"/>
  </p:sldIdLst>
  <p:sldSz cx="9144000" cy="5143500"/>
  <p:defaultTextStyle>
    <a:defPPr>
      <a:defRPr lang="zh-CN"/>
    </a:defPPr>
    <a:lvl1pPr>
      <a:defRPr sz="1800">
        <a:solidFill><a:schemeClr val="tx1"/></a:solidFill>
      </a:defRPr>
    </a:lvl1pPr>
  </p:defaultTextStyle>
</p:presentation>`
  );
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`
  );
  zip.file(
    'ppt/slideMasters/slideMaster1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst>
    <p:sldLayoutId id="2147483649" r:id="rId1"/>
  </p:sldLayoutIdLst>
  <p:txStyles>
    <p:otherStyle>
      <a:lvl1pPr algn="r">
        <a:buChar char="&#8226;"/>
        <a:defRPr sz="2000">
          <a:solidFill><a:schemeClr val="accent3"/></a:solidFill>
        </a:defRPr>
      </a:lvl1pPr>
    </p:otherStyle>
  </p:txStyles>
</p:sldMaster>`
  );
  zip.file(
    'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`
  );
  zip.file(
    'ppt/slideLayouts/slideLayout1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" preserve="1">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
</p:sldLayout>`
  );
  zip.file(
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`
  );
  zip.file(
    'ppt/theme/theme1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Fixture Theme">
  <a:themeElements>
    <a:clrScheme name="Fixture Colors">
      <a:dk1><a:srgbClr val="122033"/></a:dk1>
      <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="20324A"/></a:dk2>
      <a:lt2><a:srgbClr val="F6F8FB"/></a:lt2>
      <a:accent1><a:srgbClr val="2F6BFF"/></a:accent1>
      <a:accent2><a:srgbClr val="FF7A59"/></a:accent2>
      <a:accent3><a:srgbClr val="2ABF88"/></a:accent3>
      <a:accent4><a:srgbClr val="FFB020"/></a:accent4>
      <a:accent5><a:srgbClr val="8A63D2"/></a:accent5>
      <a:accent6><a:srgbClr val="25A7C5"/></a:accent6>
      <a:hlink><a:srgbClr val="2F6BFF"/></a:hlink>
      <a:folHlink><a:srgbClr val="8A63D2"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Fixture Fonts">
      <a:majorFont>
        <a:latin typeface="Aptos"/>
        <a:font script="Hans" typeface="等线 Light"/>
      </a:majorFont>
      <a:minorFont>
        <a:latin typeface="Calibri"/>
        <a:font script="Hans" typeface="等线"/>
      </a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Fixture Format">
      <a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
      <a:lnStyleLst><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
      <a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
      <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>`
  );
  zip.file(
    'ppt/slides/slide1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Default Text Box"/>
          <p:cNvSpPr txBox="1"/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="914400" y="914400"/><a:ext cx="3657600" cy="914400"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
          <a:ln><a:noFill/></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p>
            <a:r>
              <a:rPr lang="zh-CN"/>
              <a:t>Defaulted textbox</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="3" name="Default Shape Text"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="914400" y="2286000"/><a:ext cx="3657600" cy="914400"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:noFill/>
          <a:ln><a:noFill/></a:ln>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p>
            <a:r>
              <a:rPr lang="zh-CN"/>
              <a:t>Defaulted shape</a:t>
            </a:r>
          </a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`
  );
  zip.file(
    'ppt/slides/_rels/slide1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`
  );

  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
}

async function buildDiagramTextBoundsFixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/diagrams/data1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml"/>
  <Override PartName="/ppt/diagrams/drawing1.xml" ContentType="application/vnd.ms-office.drawingml.diagramDrawing+xml"/>
</Types>`
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
  );
  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst>
    <p:sldMasterId id="2147483648" r:id="rId1"/>
  </p:sldMasterIdLst>
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId2"/>
  </p:sldIdLst>
  <p:sldSz cx="9144000" cy="5143500"/>
</p:presentation>`
  );
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`
  );
  zip.file(
    'ppt/slideMasters/slideMaster1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst>
    <p:sldLayoutId id="2147483649" r:id="rId1"/>
  </p:sldLayoutIdLst>
</p:sldMaster>`
  );
  zip.file(
    'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`
  );
  zip.file(
    'ppt/slideLayouts/slideLayout1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" preserve="1">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
</p:sldLayout>`
  );
  zip.file(
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`
  );
  zip.file(
    'ppt/theme/theme1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Fixture Theme">
  <a:themeElements>
    <a:clrScheme name="Fixture Colors">
      <a:dk1><a:srgbClr val="122033"/></a:dk1>
      <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="20324A"/></a:dk2>
      <a:lt2><a:srgbClr val="F6F8FB"/></a:lt2>
      <a:accent1><a:srgbClr val="2F6BFF"/></a:accent1>
      <a:accent2><a:srgbClr val="FF7A59"/></a:accent2>
      <a:accent3><a:srgbClr val="2ABF88"/></a:accent3>
      <a:accent4><a:srgbClr val="FFB020"/></a:accent4>
      <a:accent5><a:srgbClr val="8A63D2"/></a:accent5>
      <a:accent6><a:srgbClr val="25A7C5"/></a:accent6>
      <a:hlink><a:srgbClr val="2F6BFF"/></a:hlink>
      <a:folHlink><a:srgbClr val="8A63D2"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Fixture Fonts">
      <a:majorFont><a:latin typeface="Aptos"/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Fixture Format">
      <a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
      <a:lnStyleLst><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
      <a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
      <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>`
  );
  zip.file(
    'ppt/slides/slide1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:graphicFrame>
        <p:nvGraphicFramePr>
          <p:cNvPr id="2" name="Diagram"/>
          <p:cNvGraphicFramePr/>
          <p:nvPr/>
        </p:nvGraphicFramePr>
        <p:xfrm><a:off x="0" y="0"/><a:ext cx="3048000" cy="3048000"/></p:xfrm>
        <a:graphic>
          <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram">
            <dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:dm="rId2"/>
          </a:graphicData>
        </a:graphic>
      </p:graphicFrame>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`
  );
  zip.file(
    'ppt/slides/_rels/slide1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData" Target="../diagrams/data1.xml"/>
  <Relationship Id="rId6" Type="http://schemas.microsoft.com/office/2007/relationships/diagramDrawing" Target="../diagrams/drawing1.xml"/>
</Relationships>`
  );
  zip.file(
    'ppt/diagrams/data1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <dgm:ptLst>
    <dgm:pt modelId="{doc}" type="doc"><dgm:prSet phldr="1"/></dgm:pt>
  </dgm:ptLst>
  <dgm:extLst>
    <a:ext uri="http://schemas.microsoft.com/office/drawing/2008/diagram">
      <dsp:dataModelExt xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram" relId="rId6" minVer="http://schemas.openxmlformats.org/drawingml/2006/diagram"/>
    </a:ext>
  </dgm:extLst>
</dgm:dataModel>`
  );
  zip.file(
    'ppt/diagrams/drawing1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<dsp:drawing xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <dsp:spTree>
    <dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr>
    <dsp:grpSpPr/>
    <dsp:sp>
      <dsp:nvSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvSpPr/></dsp:nvSpPr>
      <dsp:spPr>
        <a:xfrm><a:off x="304800" y="304800"/><a:ext cx="1828800" cy="1828800"/></a:xfrm>
        <a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>
        <a:solidFill><a:schemeClr val="accent1"/></a:solidFill>
      </dsp:spPr>
      <dsp:txBody>
        <a:bodyPr anchor="ctr"/>
        <a:lstStyle/>
        <a:p><a:r><a:rPr lang="en-US" sz="2200"/><a:t>Diagram node</a:t></a:r></a:p>
      </dsp:txBody>
      <dsp:txXfrm><a:off x="701040" y="762000"/><a:ext cx="889000" cy="635000"/></dsp:txXfrm>
    </dsp:sp>
  </dsp:spTree>
</dsp:drawing>`
  );

  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
}

async function buildCustomGeometryCommandOrderFixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
  );
  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst>
    <p:sldMasterId id="2147483648" r:id="rId1"/>
  </p:sldMasterIdLst>
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId2"/>
  </p:sldIdLst>
  <p:sldSz cx="9144000" cy="5143500"/>
</p:presentation>`
  );
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`
  );
  zip.file(
    'ppt/slideMasters/slideMaster1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst>
    <p:sldLayoutId id="2147483649" r:id="rId1"/>
  </p:sldLayoutIdLst>
</p:sldMaster>`
  );
  zip.file(
    'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`
  );
  zip.file(
    'ppt/slideLayouts/slideLayout1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" preserve="1">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
</p:sldLayout>`
  );
  zip.file(
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`
  );
  zip.file(
    'ppt/theme/theme1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Fixture Theme">
  <a:themeElements>
    <a:clrScheme name="Fixture Colors">
      <a:dk1><a:srgbClr val="122033"/></a:dk1>
      <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="20324A"/></a:dk2>
      <a:lt2><a:srgbClr val="F6F8FB"/></a:lt2>
      <a:accent1><a:srgbClr val="2F6BFF"/></a:accent1>
      <a:accent2><a:srgbClr val="FF7A59"/></a:accent2>
      <a:accent3><a:srgbClr val="2ABF88"/></a:accent3>
      <a:accent4><a:srgbClr val="FFB020"/></a:accent4>
      <a:accent5><a:srgbClr val="8A63D2"/></a:accent5>
      <a:accent6><a:srgbClr val="25A7C5"/></a:accent6>
      <a:hlink><a:srgbClr val="2F6BFF"/></a:hlink>
      <a:folHlink><a:srgbClr val="8A63D2"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Fixture Fonts">
      <a:majorFont><a:latin typeface="Aptos"/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Fixture Format">
      <a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
      <a:lnStyleLst><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
      <a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
      <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>`
  );
  zip.file(
    'ppt/slides/slide1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Ordered Freeform"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="914400" y="914400"/><a:ext cx="3657600" cy="1828800"/></a:xfrm>
          <a:custGeom>
            <a:avLst/>
            <a:pathLst>
              <a:path w="100000" h="100000">
                <a:moveTo><a:pt x="10000" y="10000"/></a:moveTo>
                <a:cubicBezTo>
                  <a:pt x="20000" y="0"/>
                  <a:pt x="40000" y="0"/>
                  <a:pt x="50000" y="10000"/>
                </a:cubicBezTo>
                <a:lnTo><a:pt x="80000" y="20000"/></a:lnTo>
                <a:quadBezTo>
                  <a:pt x="90000" y="50000"/>
                  <a:pt x="60000" y="90000"/>
                </a:quadBezTo>
                <a:close/>
              </a:path>
            </a:pathLst>
          </a:custGeom>
          <a:solidFill><a:schemeClr val="accent3"/></a:solidFill>
          <a:ln><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`
  );
  zip.file(
    'ppt/slides/_rels/slide1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`
  );

  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
}
