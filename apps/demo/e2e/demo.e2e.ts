import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

async function selectVueOfficeRegressionDeck(page: Page): Promise<void> {
  await page.locator('.wb-side-tab').last().click();
  await page.locator('button.wb-variant').filter({ hasText: 'vue-office-test.pptx' }).click();
  await expect(page.locator('.pptxv-status').first()).toContainText('/ 13', { timeout: 20000 });
  const shell = page.locator('.pptxv-shell').first();
  await shell.focus();
  await shell.press('Home');
}

async function goToSlide(page: Page, index: number): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const shell = page.locator('.pptxv-shell').first();
  await shell.focus();
  await shell.press('Home');
  for (let current = 0; current < index; current += 1) {
    await shell.getByRole('button', { name: 'Next' }).click();
    await expect(page.locator('.pptxv-status').first()).toContainText(`${current + 2} /`);
    await page.waitForTimeout(450);
  }
}

test('switches the redesigned preview layouts and formats', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: '文件预览台' })).toBeVisible();
  await page.getByRole('button', { name: '演示', exact: true }).click();
  await expect(page.locator('main.workbench')).toHaveAttribute('data-layout', 'presenter');

  await page.getByRole('button', { name: '对比', exact: true }).click();
  await expect(page.locator('main.workbench')).toHaveAttribute('data-layout', 'compare');
  await expect(page.locator('.wb-compare-pane')).toHaveCount(2);

  await page.getByRole('button', { name: 'PDF', exact: true }).first().click();
  await expect(page.locator('.wb-file-badge')).toHaveText('PDF');
});

test('loads converter-backed built-in samples from asset URLs', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'DOC', exact: true }).click();

  await expect(page.locator('.wb-preview-title strong')).toHaveText('legacy-project-workflow.doc');
  await expect(page.locator('.pptxv-shell[aria-label="flow preview"]')).toBeVisible();
  await expect(page.locator('.wb-preview-stage')).toContainText('The Lifecycle of a Project');
  await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
});

test('renders rich built-in document, workbook, and presentation samples', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'DOCX', exact: true }).click();
  await expect(page.locator('.wb-preview-title strong')).toHaveText('rich-docx-tables.docx');
  await expect(page.locator('.wb-preview-stage table')).toHaveCount(3);

  await page.getByRole('button', { name: 'XLSX', exact: true }).click();
  await expect(page.locator('.wb-preview-title strong')).toHaveText('rich-xlsx-many-columns.xlsx');
  await expect(page.locator('.wb-preview-stage')).toContainText('columns');

  await page.getByRole('button', { name: 'PPTX', exact: true }).click();
  await expect(page.locator('.wb-preview-title strong')).toHaveText('rich-pptx-pictures.pptx');
  await expect(page.locator('.wb-preview-stage img')).toHaveCount(4);
  await expect(page.locator('.wb-note.is-error')).toHaveCount(0);

  await page.getByRole('button', { name: 'PPS', exact: true }).click();
  await expect(page.locator('.wb-preview-title strong')).toHaveText('legacy-sample-show.pps');
  await expect(page.locator('.pptxv-slide-shell')).toHaveCount(2);
  await page.getByRole('button', { name: 'DPS', exact: true }).click();
  await expect(page.locator('.wb-preview-title strong')).toHaveText('legacy-strategy.dps');
});

test('loads a polished presentation sample by default', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.pptxv-shell')).toBeVisible();
  await expect(page.locator('.wb-preview-title strong')).toHaveText('rich-pptx-shapes.pptx');
  await expect(page.locator('.pptxv-slide-stage').first()).toBeVisible();
});

test('keeps rendering the regression deck when navigating past slide 5', async ({ page }) => {
  await page.goto('/');
  await selectVueOfficeRegressionDeck(page);
  const status = page.locator('.pptxv-status').first();
  await expect(status).toContainText('1 / 13', {
    timeout: 20000
  });
  await goToSlide(page, 4);
  await expect(status).toContainText('5 / 13');
  await expect(page.locator('.pptxv-slide-shell[data-slide-index="4"] .pptxv-slide-stage')).toBeVisible();
});

test('renders remote bullets, shape text, and table styles on key slides', async ({ page }) => {
  test.setTimeout(45000);
  await page.goto('/');
  await selectVueOfficeRegressionDeck(page);
  const status = page.locator('.pptxv-status').first();

  await expect(status).toContainText('1 / 13', {
    timeout: 20000
  });

  const slide1 = page.locator('.pptxv-slide-shell[data-slide-index="0"]');
  await expect(slide1).not.toContainText('2024/11/28');
  const slide1RunTexts = (await slide1
    .locator('.pptxv-item:not([data-placeholder-type="sldNum"]) .pptxv-run')
    .allTextContents())
    .map((text) => text.trim())
    .filter(Boolean);
  expect(slide1RunTexts).not.toContain('1');
  const slide1Background = await slide1.locator('.pptxv-slide').evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      backgroundImage: style.backgroundImage,
      styleAttr: node.getAttribute('style')
    };
  });

  expect(slide1Background.backgroundImage).toContain('linear-gradient');
  expect(slide1Background.styleAttr).toContain('linear-gradient(90deg');

  const slide1Typography = await slide1.evaluate((element) => {
    const titleParagraph = Array.from(element.querySelectorAll('.pptxv-text-frame p')).find((node) =>
      (node.textContent ?? '').includes('pptxPreview')
    ) as HTMLParagraphElement | undefined;
    const titleRun = Array.from(element.querySelectorAll('.pptxv-run')).find((node) =>
      (node.textContent ?? '').includes('pptxPreview')
    ) as HTMLSpanElement | undefined;
    const supportRun = Array.from(element.querySelectorAll('.pptxv-run')).find((node) =>
      (node.textContent ?? '').includes('npm')
    ) as HTMLSpanElement | undefined;

    return {
      titleLineHeight: titleParagraph?.style.lineHeight ?? null,
      titleLetterSpacing: titleRun?.style.letterSpacing ?? null,
      titleFontWeight: titleRun?.style.fontWeight ?? null,
      supportLetterSpacing: supportRun?.style.letterSpacing ?? null
    };
  });

  expect(slide1Typography.titleLineHeight).toBe('0.9');
  expect(slide1Typography.titleLetterSpacing).toBe('-0.04em');
  expect(slide1Typography.titleFontWeight).toBe('300');
  expect(slide1Typography.supportLetterSpacing).toBe('-0.04em');

  await goToSlide(page, 1);
  await expect(status).toContainText('2 / 13');
  const slide2 = page.locator('.pptxv-slide-shell[data-slide-index="1"]');
  const shapeTextColors = await slide2.evaluate((element) =>
    Array.from(element.querySelectorAll('.pptxv-item--shape .pptxv-run'))
      .map((node) => {
        if (!(node instanceof HTMLElement)) {
          return null;
        }

        const text = node.textContent?.trim() ?? '';
        if (!text || text === '‹#›') {
          return null;
        }

        return {
          text,
          color: getComputedStyle(node).color
        };
      })
      .filter((entry): entry is { text: string; color: string } => entry !== null)
  );

  expect(shapeTextColors.length).toBeGreaterThan(0);
  expect(shapeTextColors[0]?.text).toBe('文字内容测试');
  expect(shapeTextColors[0]?.color).toBe('rgb(255, 255, 255)');

  const slide2TopRowShapes = await slide2.locator('.pptxv-slide-stage').evaluate((element) => {
    const stageRect = element.getBoundingClientRect();
    return Array.from(element.querySelectorAll('.pptxv-item--shape'))
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const path = node.querySelector('svg path');
        const polygon = node.querySelector('svg polygon');
        const fill = path?.getAttribute('fill') ?? polygon?.getAttribute('fill') ?? '';
        const stroke = path?.getAttribute('stroke') ?? polygon?.getAttribute('stroke') ?? '';
        return {
          y: rect.top - stageRect.top,
          height: rect.height,
          fill,
          stroke
        };
      })
      .filter((entry) => entry.y < 105 && entry.height > 40);
  });

  expect(slide2TopRowShapes.length).toBeGreaterThanOrEqual(7);
  expect(slide2TopRowShapes.some((entry) => entry.fill === 'none' && entry.stroke === 'none')).toBe(false);

  const slide2TeardropMetrics = await slide2.locator('.pptxv-item--shape[data-shape-type="teardrop"]').evaluate((node) => {
    const shapeRect = node.getBoundingClientRect();
    const path = node.querySelector('path');
    const pathRect = path?.getBoundingClientRect();

    return {
      overhangRight: pathRect ? pathRect.right - shapeRect.right : 0,
      overhangTop: pathRect ? shapeRect.top - pathRect.top : 0
    };
  });

  expect(slide2TeardropMetrics.overhangRight).toBeGreaterThan(18);
  expect(slide2TeardropMetrics.overhangTop).toBeGreaterThan(18);

  const slide2TextInsets = await slide2.locator('.pptxv-slide-stage').evaluate((element) => {
    const readInsets = (shapeType: string) => {
      const shape = element.querySelector(`.pptxv-item--shape[data-shape-type="${shapeType}"]`);
      const overlay = shape?.querySelector('.pptxv-shape-text');
      if (!(shape instanceof HTMLElement) || !(overlay instanceof HTMLElement)) {
        return null;
      }

      const shapeWidth = parseFloat(shape.style.width || '0');
      const shapeHeight = parseFloat(shape.style.height || '0');
      const left = parseFloat(overlay.style.left || '0');
      const top = parseFloat(overlay.style.top || '0');
      const width = parseFloat(overlay.style.width || '0');
      return {
        left,
        top,
        right: Math.max(0, shapeWidth - left - width),
        centerOffset: Math.abs(top - shapeHeight / 2),
        transform: overlay.style.transform || ''
      };
    };

    return {
      snipSame: readInsets('snip2SameRect'),
      snipDiag: readInsets('snip2DiagRect'),
      roundSame: readInsets('round2SameRect'),
      roundDiag: readInsets('round2DiagRect'),
      ellipse: readInsets('ellipse'),
      octagon: readInsets('octagon'),
      pie: readInsets('pie'),
      teardrop: readInsets('teardrop')
    };
  });

  expect(Math.abs((slide2TextInsets.snipSame?.left ?? 0) - (slide2TextInsets.snipSame?.right ?? 0))).toBeLessThan(0.25);
  expect(slide2TextInsets.snipSame?.left ?? 0).toBeLessThan(3);
  expect(slide2TextInsets.snipSame?.right ?? 0).toBeLessThan(3);
  expect(slide2TextInsets.snipSame?.centerOffset ?? 1).toBeLessThan(0.25);
  expect(slide2TextInsets.snipSame?.transform ?? '').toContain('translateY(-50%)');

  expect(slide2TextInsets.snipDiag?.left ?? 0).toBeLessThan(3);
  expect(slide2TextInsets.snipDiag?.right ?? 0).toBeLessThan(3);
  expect(slide2TextInsets.snipDiag?.centerOffset ?? 1).toBeLessThan(0.25);
  expect(slide2TextInsets.snipDiag?.transform ?? '').toContain('translateY(-50%)');

  expect(slide2TextInsets.roundSame?.left ?? 0).toBeLessThan(3);
  expect(slide2TextInsets.roundSame?.right ?? 0).toBeLessThan(3);
  expect(slide2TextInsets.roundSame?.centerOffset ?? 1).toBeLessThan(0.25);
  expect(slide2TextInsets.roundSame?.transform ?? '').toContain('translateY(-50%)');

  expect(slide2TextInsets.roundDiag?.left ?? 0).toBeLessThan(0.5);
  expect(slide2TextInsets.roundDiag?.right ?? 0).toBeLessThan(0.5);
  expect(slide2TextInsets.roundDiag?.centerOffset ?? 1).toBeLessThan(0.25);
  expect(slide2TextInsets.roundDiag?.transform ?? '').toContain('translateY(-50%)');
  expect(slide2TextInsets.ellipse?.left ?? 0).toBeLessThan(0.5);
  expect(slide2TextInsets.ellipse?.right ?? 0).toBeLessThan(0.5);
  expect(slide2TextInsets.ellipse?.centerOffset ?? 1).toBeLessThan(0.25);
  expect(slide2TextInsets.ellipse?.transform ?? '').toContain('translateY(-50%)');
  expect(Math.abs((slide2TextInsets.octagon?.left ?? 0) - (slide2TextInsets.octagon?.right ?? 0))).toBeLessThan(0.25);
  expect(slide2TextInsets.octagon?.left ?? 0).toBeGreaterThan(10);
  expect(slide2TextInsets.octagon?.left ?? 0).toBeLessThan(12.5);
  expect(slide2TextInsets.octagon?.centerOffset ?? 1).toBeLessThan(0.25);
  expect(slide2TextInsets.octagon?.transform ?? '').toContain('translateY(-50%)');
  expect(Math.abs((slide2TextInsets.pie?.left ?? 0) - (slide2TextInsets.pie?.right ?? 0))).toBeLessThan(0.25);
  expect(slide2TextInsets.pie?.left ?? 0).toBeGreaterThan(25);
  expect(slide2TextInsets.pie?.left ?? 0).toBeLessThan(26.5);
  expect(slide2TextInsets.pie?.centerOffset ?? 1).toBeLessThan(0.25);
  expect(slide2TextInsets.pie?.transform ?? '').toContain('translateY(-50%)');
  expect(Math.abs((slide2TextInsets.teardrop?.left ?? 0) - (slide2TextInsets.teardrop?.right ?? 0))).toBeLessThan(0.25);
  expect(slide2TextInsets.teardrop?.left ?? 0).toBeGreaterThan(19);
  expect(slide2TextInsets.teardrop?.left ?? 0).toBeLessThan(20);
  expect(slide2TextInsets.teardrop?.centerOffset ?? 1).toBeLessThan(0.25);
  expect(slide2TextInsets.teardrop?.transform ?? '').toContain('translateY(-50%)');

  const slide2DashSummary = await slide2.evaluate((element) => {
    const readDash = (shapeType: string) =>
      element
        .querySelector(
          `.pptxv-item--shape[data-shape-type="${shapeType}"] svg path, .pptxv-item--shape[data-shape-type="${shapeType}"] svg polygon, .pptxv-item--shape[data-shape-type="${shapeType}"] svg rect, .pptxv-item--shape[data-shape-type="${shapeType}"] svg ellipse`
        )
        ?.getAttribute('stroke-dasharray') ?? null;

    return {
      round2SameRect: readDash('round2SameRect'),
      round2DiagRect: readDash('round2DiagRect'),
      roundRect: readDash('roundRect')
    };
  });

  expect(slide2DashSummary.round2SameRect).toBe('40 20 6.667 13.333 6.667 13.333');
  expect(slide2DashSummary.round2DiagRect).toBe('66.667 40 0.01 26.667 0.01 26.667');
  expect(slide2DashSummary.roundRect).toBe('6.667 12');

  const slide2CustomJoinSummary = await slide2.evaluate((element) => {
    const customShapes = Array.from(element.querySelectorAll('.pptxv-item--shape[data-shape-type="unknown"]'));
    const wedge = customShapes.find((node) => {
      const width = parseFloat((node as HTMLElement).style.width || '0');
      const height = parseFloat((node as HTMLElement).style.height || '0');
      return width > 80 && width < 95 && height > 120 && height < 130;
    });
    const blob = customShapes.find((node) => {
      const width = parseFloat((node as HTMLElement).style.width || '0');
      const height = parseFloat((node as HTMLElement).style.height || '0');
      return width > 110 && width < 120 && height > 85 && height < 90;
    });

    return {
      wedge: wedge?.querySelector('svg path')?.getAttribute('stroke-linejoin') ?? null,
      blob: blob?.querySelector('svg path')?.getAttribute('stroke-linejoin') ?? null
    };
  });

  expect(slide2CustomJoinSummary.wedge).toBe('miter');
  expect(slide2CustomJoinSummary.blob).toBe('round');

  const slide2JoinSummary = await slide2.evaluate((element) => {
    const readJoin = (shapeType: string) =>
      element
        .querySelector(
          `.pptxv-item--shape[data-shape-type="${shapeType}"] svg path, .pptxv-item--shape[data-shape-type="${shapeType}"] svg polygon`
        )
        ?.getAttribute('stroke-linejoin') ?? null;

    return {
      snip2SameRect: readJoin('snip2SameRect'),
      snip2DiagRect: readJoin('snip2DiagRect'),
      pie: readJoin('pie'),
      pentagon: readJoin('pentagon'),
      hexagon: readJoin('hexagon'),
      teardrop: readJoin('teardrop'),
      dodecagon: readJoin('dodecagon'),
      frame: readJoin('frame'),
      trapezoid: readJoin('trapezoid')
    };
  });

  expect(Object.values(slide2JoinSummary).every((value) => value === 'round')).toBe(true);
  await expect(slide2.locator('.pptxv-item--shape[data-shape-type="teardrop"] path')).toHaveAttribute(
    'd',
    'M 131.86 67.103 A 65.93 67.103 0 1 1 65.93 0 Q 112.713 0 159.496 -28.128 Q 131.86 19.487 131.86 67.103'
  );
  await expect(slide2.locator('.pptxv-item--shape[data-shape-type="pie"] path')).toHaveAttribute(
    'd',
    'M 162.54 97.391 A 87.712 64 0 1 1 136.982 11.051 L 87.712 64 Z'
  );
  await expect(slide2.locator('.pptxv-item--shape[data-shape-type="chord"] path')).toHaveAttribute(
    'd',
    'M 110.037 121.641 A 85.091 62.187 0 1 1 162.25 35.97 Z'
  );

  await goToSlide(page, 3);
  await expect(status).toContainText('4 / 13');
  const slide4 = page.locator('.pptxv-slide-shell[data-slide-index="3"]');
  await expect(slide4).not.toContainText('单击此处编辑母版');
  await expect(slide4).not.toContainText('Click to edit');
  await expect(slide4.locator('.pptxv-item--shape[data-shape-type="quadArrow"] polygon')).toHaveAttribute(
    'points',
    '0,80.412 36.185,44.227 36.185,62.319 93.09,62.319 93.09,36.185 74.997,36.185 111.183,0 147.368,36.185 129.275,36.185 129.275,62.319 186.18,62.319 186.18,44.227 222.365,80.412 186.18,116.598 186.18,98.505 129.275,98.505 129.275,124.639 147.368,124.639 111.183,160.824 74.997,124.639 93.09,124.639 93.09,98.505 36.185,98.505 36.185,116.598'
  );
  await expect(slide4.locator('.pptxv-item--shape[data-shape-type="leftArrowCallout"] polygon')).toHaveAttribute(
    'points',
    '0,58.787 29.316,29.394 29.316,44.091 56.003,44.091 56.003,0 159.903,0 159.903,117.575 56.003,117.575 56.003,73.484 29.316,73.484 29.316,88.181'
  );
  await expect(slide4.locator('.pptxv-item--shape[data-shape-type="rightArrowCallout"] polygon')).toHaveAttribute(
    'points',
    '0,0 66.341,0 66.341,47.454 118.706,47.454 118.706,31.636 150.342,63.272 118.706,94.908 118.706,79.09 66.341,79.09 66.341,126.544 0,126.544'
  );
  await expect(slide4.locator('.pptxv-item--shape[data-shape-type="upArrowCallout"] polygon')).toHaveAttribute(
    'points',
    '0,39.815 64.765,39.815 64.765,28.421 50.54,28.421 78.99,0 107.44,28.421 93.215,28.421 93.215,39.815 157.98,39.815 157.98,113.682 0,113.682'
  );
  const slide4ShapeStrokeSummary = await slide4.evaluate((element) => {
    const readJoin = (shapeType: string) => {
      const shape = element.querySelector(`.pptxv-item--shape[data-shape-type="${shapeType}"]`);
      const node = shape?.querySelector('svg path, svg polygon');
      return node?.getAttribute('stroke-linejoin') ?? null;
    };

    const readCurvedStroke = (shapeType: string) => {
      const shape = element.querySelector(`.pptxv-item--shape[data-shape-type="${shapeType}"]`);
      return Array.from(shape?.querySelectorAll('svg path') ?? []).map((node) => node.getAttribute('stroke'));
    };

    return {
      joins: {
        rightArrow: readJoin('rightArrow'),
        leftArrow: readJoin('leftArrow'),
        upArrow: readJoin('upArrow'),
        downArrow: readJoin('downArrow'),
        leftRightArrow: readJoin('leftRightArrow'),
        quadArrow: readJoin('quadArrow'),
        leftRightUpArrow: readJoin('leftRightUpArrow'),
        bentArrow: readJoin('bentArrow'),
        uturnArrow: readJoin('uturnArrow'),
        leftUpArrow: readJoin('leftUpArrow'),
        bentUpArrow: readJoin('bentUpArrow'),
        stripedRightArrow: readJoin('stripedRightArrow'),
        notchedRightArrow: readJoin('notchedRightArrow'),
        homePlate: readJoin('homePlate'),
        chevron: readJoin('chevron'),
        rightArrowCallout: readJoin('rightArrowCallout'),
        leftRightArrowCallout: readJoin('leftRightArrowCallout'),
        quadArrowCallout: readJoin('quadArrowCallout'),
        leftArrowCallout: readJoin('leftArrowCallout'),
        upArrowCallout: readJoin('upArrowCallout')
      },
      curvedStrokes: {
        curvedRightArrow: readCurvedStroke('curvedRightArrow'),
        curvedLeftArrow: readCurvedStroke('curvedLeftArrow'),
        curvedUpArrow: readCurvedStroke('curvedUpArrow'),
        curvedDownArrow: readCurvedStroke('curvedDownArrow')
      }
    };
  });

  expect(Object.values(slide4ShapeStrokeSummary.joins).every((value) => value === 'round')).toBe(true);
  expect(Object.values(slide4ShapeStrokeSummary.curvedStrokes).every((strokes) => strokes.every((stroke) => stroke === 'none'))).toBe(
    true
  );

  await goToSlide(page, 2);
  await expect(status).toContainText('3 / 13');
  const slide3 = page.locator('.pptxv-slide-shell[data-slide-index="2"]');
  await expect(slide3).not.toContainText('2024/11/28');
  const slide3RunTexts = (await slide3
    .locator('.pptxv-item:not([data-placeholder-type="sldNum"]) .pptxv-run')
    .allTextContents())
    .map((text) => text.trim())
    .filter(Boolean);
  expect(slide3RunTexts).not.toContain('3');

  await goToSlide(page, 4);
  await expect(status).toContainText('5 / 13');
  const slide5 = page.locator('.pptxv-slide-shell[data-slide-index="4"]');
  const slide5BulletSummary = await slide5.evaluate((element) => {
    const bulletMarkers = Array.from(element.querySelectorAll('.pptxv-run--bullet'))
      .map((node) => {
        const text =
          node instanceof HTMLElement ? node.dataset.resolvedLabel ?? node.textContent?.trim() ?? '' : node.textContent?.trim() ?? '';
        if (!text || !(node instanceof HTMLElement)) {
          return null;
        }

        return {
          text,
          color: getComputedStyle(node).color
        };
      })
      .filter((entry): entry is { text: string; color: string } => entry !== null);
    const paragraphTexts = Array.from(element.querySelectorAll('.pptxv-text-frame p'))
      .map((node) => node.textContent?.trim() ?? '')
      .filter(Boolean);

    return {
      bulletCount: bulletMarkers.length,
      decimalCount: bulletMarkers.filter((marker) => /\d/.test(marker.text)).length,
      dotCount: bulletMarkers.filter((marker) => marker.text === '\u2022').length,
      glyphCount: bulletMarkers.filter((marker) => !/[\dA-Za-z]/.test(marker.text)).length,
      colors: bulletMarkers.map((marker) => marker.color),
      nonEmptyParagraphCount: paragraphTexts.length
    };
  });

  expect(slide5BulletSummary.bulletCount).toBeGreaterThanOrEqual(19);
  expect(slide5BulletSummary.decimalCount).toBeGreaterThanOrEqual(2);
  expect(slide5BulletSummary.dotCount).toBeGreaterThanOrEqual(7);
  expect(slide5BulletSummary.glyphCount).toBeGreaterThanOrEqual(6);
  expect(slide5BulletSummary.colors.every((color) => color === 'rgb(0, 0, 0)')).toBe(true);
  expect(slide5BulletSummary.nonEmptyParagraphCount).toBeGreaterThanOrEqual(12);

  const slide5Typography = await slide5.evaluate((element) => {
    const findParagraph = (text: string) =>
      Array.from(element.querySelectorAll('.pptxv-text-frame p')).find((node) =>
        (node.textContent ?? '').includes(text)
      ) as HTMLParagraphElement | undefined;
    const findRun = (text: string) =>
      Array.from(element.querySelectorAll('.pptxv-run')).find((node) =>
        (node.textContent ?? '').includes(text)
      ) as HTMLSpanElement | undefined;

    const listParagraph = findParagraph('列表方形');
    const listRun = findRun('列表方形');
    const boldRun = findRun('文本测试');

    const titleWeights = Array.from(element.querySelectorAll('.pptxv-run'))
      .filter((node) => node instanceof HTMLElement && !node.classList.contains('pptxv-run--bullet'))
      .map((node) => ({
        fontSize: node instanceof HTMLElement ? node.style.fontSize : '',
        fontWeight: node instanceof HTMLElement ? node.style.fontWeight : ''
      }))
      .filter((entry) => parseFloat(entry.fontSize || '0') > 50)
      .map((entry) => entry.fontWeight);
    const lightAutoBulletWeights = Array.from(element.querySelectorAll('.pptxv-run--bullet-auto'))
      .map((node) => {
        if (!(node instanceof HTMLElement)) {
          return null;
        }

        const style = getComputedStyle(node);
        if (!style.fontFamily.includes('DengXian Light')) {
          return null;
        }

        return style.fontWeight;
      })
      .filter((weight): weight is string => weight !== null);

    return {
      titleWeights,
      lightAutoBulletWeights,
      listParagraphFontSize: listParagraph?.style.fontSize ?? null,
      listRunFontFamily: listRun?.style.fontFamily ?? null,
      boldRunFontSize: boldRun?.style.fontSize ?? null,
      boldRunFontWeight: boldRun?.style.fontWeight ?? null
    };
  });

  expect(slide5Typography.titleWeights.length).toBeGreaterThanOrEqual(2);
  expect(slide5Typography.titleWeights.every((weight) => weight === '300')).toBe(true);
  expect(slide5Typography.lightAutoBulletWeights.length).toBeGreaterThanOrEqual(4);
  expect(slide5Typography.lightAutoBulletWeights.every((weight) => weight === '300')).toBe(true);
  expect(slide5Typography.listParagraphFontSize).toBe('24px');
  expect(slide5Typography.listRunFontFamily).toContain('等线');
  expect(slide5Typography.boldRunFontSize).toBe('24px');
  expect(slide5Typography.boldRunFontWeight).toBe('700');

  const slide5CheckBullet = await slide5.evaluate((element) => {
    const checkBullet = Array.from(element.querySelectorAll('.pptxv-run--bullet')).find((node) => {
      const text = node instanceof HTMLElement ? node.dataset.resolvedLabel ?? node.textContent?.trim() ?? '' : (node.textContent ?? '').trim();
      return text === '✔' || text === '✓';
    }) as HTMLSpanElement | undefined;

    return checkBullet
      ? {
          text: checkBullet.dataset.resolvedLabel ?? checkBullet.textContent?.trim() ?? '',
          color: getComputedStyle(checkBullet).color
        }
      : null;
  });

  expect(slide5CheckBullet?.text).toBe('✔');
  expect(slide5CheckBullet?.color).toBe('rgb(0, 0, 0)');

  await goToSlide(page, 5);
  await expect(status).toContainText('6 / 13');
  const slide6 = page.locator('.pptxv-slide-shell[data-slide-index="5"]');
  const slide6BulletSummary = await slide6.evaluate((element) => {
    const bulletTexts = Array.from(element.querySelectorAll('.pptxv-run--bullet'))
      .map((node) =>
        node instanceof HTMLElement ? node.dataset.resolvedLabel ?? node.textContent?.trim() ?? '' : node.textContent?.trim() ?? ''
      )
      .filter(Boolean);
    const titleWeights = Array.from(element.querySelectorAll('.pptxv-run'))
      .filter((node) => node instanceof HTMLElement && !node.classList.contains('pptxv-run--bullet'))
      .map((node) => ({
        fontSize: node instanceof HTMLElement ? node.style.fontSize : '',
        fontWeight: node instanceof HTMLElement ? node.style.fontWeight : ''
      }))
      .filter((entry) => parseFloat(entry.fontSize || '0') > 50)
      .map((entry) => entry.fontWeight);
    const lightAutoBulletWeights = Array.from(element.querySelectorAll('.pptxv-run--bullet-auto'))
      .map((node) => {
        if (!(node instanceof HTMLElement)) {
          return null;
        }

        const style = getComputedStyle(node);
        if (!style.fontFamily.includes('DengXian Light')) {
          return null;
        }

        return style.fontWeight;
      })
      .filter((weight): weight is string => weight !== null);

    return {
      bulletCount: bulletTexts.length,
      dotCount: bulletTexts.filter((text) => text === '\u2022').length,
      squareCount: bulletTexts.filter((text) => text === '\u25a0').length,
      hasArrow: bulletTexts.includes('\u27a2'),
      titleWeights,
      lightAutoBulletWeights
    };
  });

  expect(slide6BulletSummary.titleWeights.length).toBeGreaterThanOrEqual(2);
  expect(slide6BulletSummary.titleWeights.every((weight) => weight === '300')).toBe(true);
  expect(slide6BulletSummary.bulletCount).toBeGreaterThanOrEqual(32);
  expect(slide6BulletSummary.dotCount).toBeGreaterThanOrEqual(2);
  expect(slide6BulletSummary.squareCount).toBeGreaterThanOrEqual(5);
  expect(slide6BulletSummary.hasArrow).toBe(true);
  expect(slide6BulletSummary.lightAutoBulletWeights.length).toBeGreaterThanOrEqual(8);
  expect(slide6BulletSummary.lightAutoBulletWeights.every((weight) => weight === '300')).toBe(true);

  await goToSlide(page, 7);
  await expect(status).toContainText('8 / 13');
  const slide8 = page.locator('.pptxv-slide-shell[data-slide-index="7"]');
  const slide8Background = await slide8.locator('.pptxv-slide-stage').evaluate((element) => {
    const slideRoot = element.querySelector('.pptxv-slide') as HTMLDivElement | null;
    if (!slideRoot) {
      return null;
    }

    const style = getComputedStyle(slideRoot);
    return {
      backgroundImage: style.backgroundImage,
      styleAttr: slideRoot.getAttribute('style')
    };
  });

  expect(slide8Background?.backgroundImage).toContain('radial-gradient');
  expect(slide8Background?.styleAttr).toContain('radial-gradient(circle');

  await goToSlide(page, 8);
  await expect(status).toContainText('9 / 13');
  const slide9 = page.locator('.pptxv-slide-shell[data-slide-index="8"]');
  const slide9Gradients = await slide9.locator('.pptxv-slide-stage').evaluate((element) =>
    Array.from(element.querySelectorAll('radialGradient, linearGradient')).map((node) => ({
      tag: node.tagName,
      cx: node.getAttribute('cx'),
      cy: node.getAttribute('cy')
    }))
  );

  expect(slide9Gradients.filter((gradient) => gradient.tag === 'radialGradient').length).toBeGreaterThanOrEqual(4);
  expect(slide9Gradients.some((gradient) => gradient.tag === 'linearGradient')).toBe(true);
  expect(slide9Gradients.some((gradient) => gradient.cx === '0%' && gradient.cy === '0%')).toBe(true);
  expect(slide9Gradients.some((gradient) => gradient.cx === '100%' && gradient.cy === '0%')).toBe(true);
  const slide9TransparentTextFrontmost = await slide9.locator('.pptxv-slide-stage').evaluate((element) => {
    const text = '\u6211\u662f\u900f\u660e\u7684';
    const run = Array.from(element.querySelectorAll('.pptxv-run')).find((node) =>
      (node.textContent ?? '').includes(text)
    );
    if (!(run instanceof HTMLElement)) {
      return null;
    }

    const rect = run.getBoundingClientRect();
    const topNode = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      text: run.textContent ?? '',
      isFrontmost: topNode === run || run.contains(topNode) || (topNode instanceof HTMLElement && topNode.contains(run))
    };
  });

  expect(slide9TransparentTextFrontmost?.text).toContain('\u6211\u662f\u900f\u660e\u7684');
  expect(slide9TransparentTextFrontmost?.isFrontmost).toBe(true);

  await goToSlide(page, 9);
  await expect(status).toContainText('10 / 13');
  const slide10 = page.locator('.pptxv-slide-shell[data-slide-index="9"]');
  const slide10BottomGroupFills = await slide10.locator('.pptxv-slide-stage').evaluate((element) => {
    const stageRect = element.getBoundingClientRect();
    return Array.from(element.querySelectorAll('.pptxv-item--shape'))
      .map((node) => {
        if (!(node instanceof HTMLElement)) {
          return null;
        }

        const rect = node.getBoundingClientRect();
        if (rect.top - stageRect.top < stageRect.height * 0.55) {
          return null;
        }

        const svgShape = node.querySelector('rect, polygon, path') as SVGElement | null;
        const fill = svgShape?.getAttribute('fill') ?? '';
        return fill && fill !== 'none' ? fill : null;
      })
      .filter((fill): fill is string => Boolean(fill));
  });

  expect(slide10BottomGroupFills).toContain('#FFC000');
  expect(slide10BottomGroupFills).toContain('#C55A11');

  await goToSlide(page, 10);
  await expect(status).toContainText('11 / 13');
  const slide11 = page.locator('.pptxv-slide-shell[data-slide-index="10"]');
  const stage11 = slide11.locator('.pptxv-slide-stage');
  const smartArtBounds = await stage11.evaluate((element) => {
    const stageRect = element.getBoundingClientRect();
    const boxes = Array.from(element.querySelectorAll('.pptxv-item--shape .pptxv-text-frame'))
      .map((node) => {
        if (!(node instanceof HTMLElement)) {
          return null;
        }

        const text = node.textContent?.replace(/\s+/g, '') ?? '';
        if (!text || text.length > 4 || /[0-9/#]/.test(text)) {
          return null;
        }

        const rect = node.getBoundingClientRect();
        return {
          text,
          x: rect.left - stageRect.left,
          y: rect.top - stageRect.top,
          right: rect.right - stageRect.left,
          bottom: rect.bottom - stageRect.top,
          width: rect.width,
          height: rect.height
        };
      })
      .filter(
        (
          box
        ): box is {
          text: string;
          x: number;
          y: number;
          right: number;
          bottom: number;
          width: number;
          height: number;
        } => box !== null
      );

    return {
      stage: {
        width: stageRect.width,
        height: stageRect.height
      },
      boxes
    };
  });

  expect(smartArtBounds.stage.width).toBeGreaterThan(0);
  expect(smartArtBounds.stage.height).toBeGreaterThan(0);
  expect(smartArtBounds.boxes.length).toBeGreaterThanOrEqual(5);

  for (const box of smartArtBounds.boxes) {
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.right).toBeLessThanOrEqual(smartArtBounds.stage.width + 2);
    expect(box.bottom).toBeLessThanOrEqual(smartArtBounds.stage.height + 2);
  }

  const smartArtTextBounds = await slide11.locator('.pptxv-item--shape').evaluateAll((nodes) => {
    return nodes
      .map((node) => {
        const shapeRect = node.getBoundingClientRect();
        const textNode = node.querySelector('.pptxv-shape-text, .pptxv-text-frame');
        if (!(textNode instanceof HTMLElement)) {
          return null;
        }

        const text = textNode.textContent?.replace(/\s+/g, '') ?? '';
        if (!text || text.length > 4 || /[0-9/#]/.test(text)) {
          return null;
        }

        const textRect = textNode.getBoundingClientRect();
        return {
          text,
          insetLeft: textRect.left - shapeRect.left,
          insetTop: textRect.top - shapeRect.top,
          insetRight: shapeRect.right - textRect.right,
          insetBottom: shapeRect.bottom - textRect.bottom,
          shapeWidth: shapeRect.width,
          textWidth: textRect.width
        };
      })
      .filter(
        (
          entry
        ): entry is {
          text: string;
          insetLeft: number;
          insetTop: number;
          insetRight: number;
          insetBottom: number;
          shapeWidth: number;
          textWidth: number;
        } => entry !== null
      );
  });

  const loveNode = smartArtTextBounds.find((entry) => entry.text === '爱情');
  expect(loveNode).toBeDefined();
  expect((loveNode?.insetLeft ?? 0) / Math.max(loveNode?.shapeWidth ?? 1, 1)).toBeLessThan(0.02);
  expect((loveNode?.insetTop ?? 0) / Math.max(loveNode?.shapeWidth ?? 1, 1)).toBeGreaterThan(0.28);
  expect((loveNode?.insetTop ?? 0) / Math.max(loveNode?.shapeWidth ?? 1, 1)).toBeLessThan(0.34);
  expect(Math.abs((loveNode?.insetLeft ?? 0) - (loveNode?.insetRight ?? 0))).toBeLessThan(1);
  expect(Math.abs((loveNode?.insetTop ?? 0) - (loveNode?.insetBottom ?? 0))).toBeLessThan(1);
  expect(loveNode?.textWidth ?? 0).toBeGreaterThan((loveNode?.shapeWidth ?? 0) * 0.95);

  await goToSlide(page, 11);
  await expect(status).toContainText('12 / 13');
  const slide12 = page.locator('.pptxv-slide-shell[data-slide-index="11"]');
  await expect(slide12.locator('.pptxv-item--media[data-media-type="video"] video')).toBeVisible();
  await expect(slide12.locator('.pptxv-item--media[data-media-type="audio"] audio')).toBeVisible();
  const slide12MediaSummary = await slide12.locator('.pptxv-slide-stage').evaluate((element) => {
    const videoHost = element.querySelector('.pptxv-item--media[data-media-type="video"]');
    const video = videoHost?.querySelector('video');
    const posterFrame = videoHost?.querySelector('.pptxv-media-poster-frame');
    const audioHost = element.querySelector('.pptxv-item--media[data-media-type="audio"]');
    const audio = audioHost?.querySelector('audio');
    if (!(videoHost instanceof HTMLElement) || !(video instanceof HTMLVideoElement)) {
      return null;
    }
    if (!(posterFrame instanceof HTMLElement)) {
      return null;
    }
    if (!(audioHost instanceof HTMLElement) || !(audio instanceof HTMLAudioElement)) {
      return null;
    }

    const videoRect = video.getBoundingClientRect();
    const audioRect = audio.getBoundingClientRect();

    return {
      videoControls: video.controls,
      videoSrc: video.getAttribute('src') ?? video.currentSrc,
      videoPoster: video.getAttribute('poster'),
      videoStyle: video.getAttribute('style') ?? '',
      posterFrameStyle: posterFrame.getAttribute('style') ?? '',
      videoWidth: videoRect.width,
      videoHeight: videoRect.height,
      videoAutoplay: video.autoplay,
      videoMuted: video.muted,
      videoPaused: video.paused,
      videoCurrentTime: video.currentTime,
      audioControls: audio.controls,
      audioSrc: audio.getAttribute('src') ?? audio.currentSrc,
      audioStyle: audio.getAttribute('style') ?? '',
      audioWidth: audioRect.width,
      audioHeight: audioRect.height,
      audioLeft: audioRect.left,
      audioHostLeft: audioHost.getBoundingClientRect().left,
      audioPosterExists: Boolean(audioHost.querySelector('img'))
    };
  });

  expect(slide12MediaSummary).not.toBeNull();
  expect(slide12MediaSummary?.videoControls).toBe(true);
  expect(slide12MediaSummary?.videoSrc ?? '').toContain('blob:');
  expect(slide12MediaSummary?.videoPoster).toBeNull();
  expect(slide12MediaSummary?.videoStyle ?? '').toContain('position: absolute');
  expect(slide12MediaSummary?.videoStyle ?? '').not.toContain('object-fit: fill');
  expect(slide12MediaSummary?.posterFrameStyle ?? '').toContain('width:');
  expect(slide12MediaSummary?.posterFrameStyle ?? '').toContain('height:');
  expect(slide12MediaSummary?.videoWidth ?? 0).toBeGreaterThan(350);
  expect(slide12MediaSummary?.videoHeight ?? 0).toBeGreaterThan(200);
  expect(slide12MediaSummary?.videoAutoplay).toBe(false);
  expect(slide12MediaSummary?.videoMuted).toBe(false);
  expect(slide12MediaSummary?.videoPaused).toBe(true);
  expect(slide12MediaSummary?.videoCurrentTime ?? 1).toBeLessThan(0.1);
  await slide12.locator('.pptxv-item--media[data-media-type="video"] video').evaluate(async (node) => {
    await node.play();
  });
  await page.waitForTimeout(1000);
  const slide12VideoPlayback = await slide12
    .locator('.pptxv-item--media[data-media-type="video"] video')
    .evaluate((node) => ({ currentTime: node.currentTime, paused: node.paused, error: node.error?.code ?? null }));
  expect(slide12VideoPlayback.error).toBeNull();
  expect(slide12VideoPlayback.paused).toBe(false);
  expect(slide12VideoPlayback.currentTime).toBeGreaterThan(0.5);
  expect(slide12MediaSummary?.audioControls).toBe(true);
  expect(slide12MediaSummary?.audioSrc ?? '').toContain('blob:');
  expect(slide12MediaSummary?.audioStyle ?? '').toContain('left: 0px');
  expect(slide12MediaSummary?.audioStyle ?? '').toContain('top: 0px');
  expect(slide12MediaSummary?.audioStyle ?? '').toContain('transform: translate(-50%)');
  expect(slide12MediaSummary?.audioWidth ?? 0).toBeGreaterThan(200);
  expect(slide12MediaSummary?.audioWidth ?? 0).toBeLessThan(340);
  expect(slide12MediaSummary?.audioHeight ?? 0).toBeGreaterThan(35);
  expect((slide12MediaSummary?.audioHostLeft ?? 0) - (slide12MediaSummary?.audioLeft ?? 0)).toBeGreaterThan(80);
  expect((slide12MediaSummary?.audioHostLeft ?? 0) - (slide12MediaSummary?.audioLeft ?? 0)).toBeLessThan(170);
  expect(slide12MediaSummary?.audioPosterExists).toBe(false);

  await goToSlide(page, 12);
  await expect(status).toContainText('13 / 13');
  const headerCell = page
    .locator('.pptxv-slide-shell[data-slide-index="12"] .pptxv-table tbody tr')
    .first()
    .locator('td')
    .first();
  await expect(headerCell).toBeVisible();
  await expect(headerCell.locator('.pptxv-run').first()).toHaveText(/\S+/);
  await expect(headerCell).toHaveCSS('background-color', 'rgb(112, 173, 71)');
  await expect(headerCell.locator('.pptxv-run').first()).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(headerCell.locator('.pptxv-run').first()).toHaveCSS('font-size', '24px');
  const bodyNameCell = page
    .locator('.pptxv-slide-shell[data-slide-index="12"] .pptxv-table tbody tr')
    .nth(1)
    .locator('td')
    .nth(1);
  await expect(bodyNameCell).toHaveCSS('background-color', 'rgb(197, 224, 180)');
  await expect(bodyNameCell).toHaveCSS('vertical-align', 'middle');
  await expect(bodyNameCell.locator('.pptxv-run').first()).toHaveCSS('font-size', '24px');
  await expect(bodyNameCell.locator('.pptxv-text-frame').first()).toHaveCSS('justify-content', 'center');
  const paleBodyCell = page
    .locator('.pptxv-slide-shell[data-slide-index="12"] .pptxv-table tbody tr')
    .nth(2)
    .locator('td')
    .nth(2);
  await expect(paleBodyCell).toHaveCSS('background-color', 'rgb(226, 240, 217)');
  const mergedNoteCell = page
    .locator('.pptxv-slide-shell[data-slide-index="12"] .pptxv-table tbody tr')
    .nth(1)
    .locator('td')
    .nth(5);
  await expect(mergedNoteCell).toHaveCSS('background-color', 'rgb(237, 125, 49)');
  await expect(mergedNoteCell).toHaveCSS('vertical-align', 'middle');
  await expect(mergedNoteCell.locator('.pptxv-run').first()).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(mergedNoteCell.locator('.pptxv-run').first()).toHaveCSS('font-weight', '700');
  await expect(mergedNoteCell.locator('.pptxv-run').first()).toHaveCSS('font-size', '24px');
  await expect(mergedNoteCell.locator('.pptxv-text-frame').first()).toHaveCSS('justify-content', 'center');
});

test('renders remote 3d preset shapes with reference-like svg primitives on slide 3', async ({ page }) => {
  await page.goto('/');
  await selectVueOfficeRegressionDeck(page);
  const status = page.locator('.pptxv-status').first();

  await expect(status).toContainText('1 / 13', {
    timeout: 20000
  });

  await goToSlide(page, 2);
  await expect(status).toContainText('3 / 13');

  const slide3 = page.locator('.pptxv-slide-shell[data-slide-index="2"]');
  const svgShapeSummary = await slide3.locator('.pptxv-item--shape').evaluateAll((nodes) =>
    nodes.map((node) => ({
      shapeType: (node as HTMLElement).dataset.shapeType ?? '',
      pathCount: node.querySelectorAll('svg path').length,
      polygonCount: node.querySelectorAll('svg polygon').length,
      ellipseCount: node.querySelectorAll('svg ellipse').length
    }))
  );
  const getShape = (shapeType: string) => svgShapeSummary.find((entry) => entry.shapeType === shapeType);

  expect(getShape('frame')).toMatchObject({ pathCount: 1, polygonCount: 0, ellipseCount: 0 });
  expect(getShape('halfFrame')).toMatchObject({ pathCount: 1, polygonCount: 0, ellipseCount: 0 });
  expect(getShape('corner')).toMatchObject({ pathCount: 1, polygonCount: 0, ellipseCount: 0 });
  expect(getShape('diagStripe')).toMatchObject({ pathCount: 1, polygonCount: 0, ellipseCount: 0 });
  expect(getShape('plus')).toMatchObject({ pathCount: 1, polygonCount: 0, ellipseCount: 0 });
  expect(getShape('can')).toMatchObject({ pathCount: 1, polygonCount: 0, ellipseCount: 1 });
  expect(getShape('cube')).toMatchObject({ pathCount: 3, polygonCount: 0, ellipseCount: 0 });
  expect(getShape('bevel')).toMatchObject({ pathCount: 5, polygonCount: 0, ellipseCount: 0 });
  expect(getShape('donut')).toMatchObject({ pathCount: 1, polygonCount: 0, ellipseCount: 0 });
  expect(getShape('noSmoking')).toMatchObject({ pathCount: 1, polygonCount: 0, ellipseCount: 0 });
  await expect(slide3).not.toContainText('‹#›');
});

test('keeps toolbar state in sync while navigating the built-in sample deck', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Preview built-in sample' }).click();
  const status = page.locator('.pptxv-status').first();

  await expect(status).toContainText('1 / 3');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(status).toContainText('2 / 3');
  await expect(page.locator('.pptxv-thumb-button.is-active')).toContainText('2');

  await page.getByRole('button', { name: 'Width' }).click();
  await expect(page.locator('.pptxv-slide-stage').first()).toBeVisible();
});

test('supports keyboard navigation after the preview shell is focused', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Preview built-in sample' }).click();
  const shell = page.locator('.pptxv-shell');
  const status = page.locator('.pptxv-status').first();

  await expect(page.locator('.pptxv-slide-stage').first()).toBeVisible();
  await expect(status).toContainText('1 / 3');
  await shell.focus();
  await expect(shell).toBeFocused();
  await shell.press('ArrowRight');
  await expect(status).toContainText('2 / 3');
  await expect(page.locator('.pptxv-thumb-button[aria-current="true"]')).toContainText('2');

  await shell.press('Home');
  await expect(status).toContainText('1 / 3');
});

test('supports slide links and action links inside the presentation content', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Preview built-in sample' }).click();
  const status = page.locator('.pptxv-status').first();
  const main = page.locator('.pptxv-main');

  await main.getByText('Jump to table slide').click();
  await expect(status).toContainText('3 / 3');

  await main.getByText('Return to last viewed slide').click();
  await expect(status).toContainText('1 / 3');
});

test('supports image links inside the presentation content', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Preview built-in sample' }).click();
  const status = page.locator('.pptxv-status').first();

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(status).toContainText('2 / 3');

  await page.locator('.pptxv-main .pptxv-item--image .pptxv-item-link').click();
  await expect(status).toContainText('3 / 3');
});

test('exposes external item links with accessible attributes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Preview built-in sample' }).click();
  await page.getByRole('button', { name: 'Next' }).click();

  const link = page.locator(
    '.pptxv-main .pptxv-item--shape .pptxv-item-link[href="https://example.com/pptx-previewer/grouped-media"]'
  );

  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(link).toHaveAttribute('aria-label', 'Open link: Callout');

  await link.focus();
  await expect(link).toBeFocused();
});

test('renders local qrpc sdk links with reference-like blue underlines', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(path.resolve('tmp/qrpc-local.pptx'));
  await expect(page.locator('.pptxv-status').first()).toContainText('1 / 39', {
    timeout: 20000
  });

  await page.locator('.pptxv-thumb-button').nth(24).click();
  const slide25 = page.locator('.pptxv-slide-shell[data-slide-index="24"]');
  const androidLink = slide25.locator('.pptxv-run--link', { hasText: 'android sdk' });
  const bullet = slide25.locator('.pptxv-run--bullet').first();

  await expect(androidLink).toHaveCSS('color', 'rgb(3, 102, 214)');
  await expect(androidLink).toHaveCSS('text-decoration-line', 'underline');
  await expect(bullet).toHaveCSS('color', 'rgb(3, 102, 214)');
});

test('renders local qrpc slide 20 code screenshot instead of a blank page', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles(path.resolve('tmp/qrpc-local.pptx'));
  await expect(page.locator('.pptxv-status').first()).toContainText('1 / 39', {
    timeout: 20000
  });

  await page.locator('.pptxv-thumb-button').nth(19).click();
  await expect(page.locator('.pptxv-status').first()).toContainText('20 / 39');

  const slide20 = page.locator('.pptxv-slide-shell[data-slide-index="19"]');
  await expect(slide20).toContainText('qrpc的特性 - 双向调用');

  const screenshotImage = slide20.locator('.pptxv-item--image .pptxv-image').first();
  await expect(screenshotImage).toBeVisible();

  const imageInfo = await screenshotImage.evaluate((node) => ({
    complete: node.complete,
    naturalWidth: node.naturalWidth,
    naturalHeight: node.naturalHeight
  }));

  expect(imageInfo.complete).toBe(true);
  expect(imageInfo.naturalWidth).toBeGreaterThan(1200);
  expect(imageInfo.naturalHeight).toBeGreaterThan(250);
});
