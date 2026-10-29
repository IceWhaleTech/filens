import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzePreviewFonts, collectSlideFontReferences } from '../src/preview/fonts';
import { applySlideFontMappings, collectSlideFontLoadingReferences } from '../src/preview/font-scenes';
import type { SlideModel, TextFrame, TextItem } from '../src/types';
import { createPptxPreviewDriver } from '../src/preview/pptx-driver';
import { readFixture } from './helpers';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mockFonts(available: string[] = []) {
  const context = {
    font: '',
    measureText: vi.fn(() => ({ width: available.some((name) => context.font.includes(`"${name}"`)) ? 140 : 100 }))
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  return context;
}

describe('font diagnostics', () => {
  it('does not mistake FontFaceSet.check success or fallback glyphs for a found font', () => {
    mockFonts();
    const check = vi.fn(() => true);
    const documentLike = { createElement: document.createElement.bind(document), fonts: { check } } as unknown as Document;
    const result = analyzePreviewFonts([{ fontFamily: 'Missing Desktop Font' }], documentLike);
    expect(result.fonts).toMatchObject([{ status: 'missing', source: 'fallback' }]);
    expect(result.warnings).toEqual(['Font "Missing Desktop Font" was not detected; fallback fonts may change layout.']);
    expect(check).not.toHaveBeenCalled();
  });

  it('keeps unknown results when measurement is unavailable, invalid, or a CSS stack is supplied', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    for (const documentLike of [document, undefined]) {
      const result = analyzePreviewFonts([{ fontFamily: 'Unverified' }, { fontFamily: 'Aptos, sans-serif' }], documentLike);
      expect(result.fonts.map((font) => [font.status, font.source])).toEqual([['unknown', 'unknown'], ['unknown', 'unknown']]);
      expect(result.warnings).toEqual([]);
    }
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(() => { throw new Error('Unavailable canvas'); });
    expect(analyzePreviewFonts([{ fontFamily: 'Unverified' }]).fonts[0].status).toBe('unknown');
  });

  it('detects available families and localized aliases without claiming operating-system provenance', () => {
    mockFonts(['Found', 'Microsoft YaHei']);
    const result = analyzePreviewFonts([{ fontFamily: 'Found' }, { fontFamily: '微软雅黑' }, { fontFamily: 'system-ui' }]);
    expect(result.fonts).toMatchObject([
      { fontFamily: 'Found', status: 'available', source: 'environment' },
      { fontFamily: '微软雅黑', status: 'available', source: 'environment' },
      { fontFamily: 'system-ui', status: 'available', source: 'fallback' }
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('can inspect references outside a browser without claiming availability', () => {
    vi.stubGlobal('document', undefined);
    expect(analyzePreviewFonts([{ fontFamily: 'Aptos' }, { fontFamily: 'system-ui' }]).fonts.map((font) => font.status))
      .toEqual(['unknown', 'unknown']);
  });

  it('reports SHX as unsupported and verifies application mappings before declaring substitution', () => {
    mockFonts(['Web CAD']);
    const result = analyzePreviewFonts([
      { fontFile: 'romans.shx', styleName: 'Unmapped' },
      { fontFile: 'romans.shx', styleName: 'Mapped', resolvedFontFamily: 'Web CAD', source: 'application' },
      { fontFile: 'romans.shx', styleName: 'Missing mapping', resolvedFontFamily: 'Absent', source: 'application' }
    ]);
    expect(result.fonts).toMatchObject([
      { status: 'unsupported', source: 'fallback' },
      { status: 'substituted', source: 'application', resolvedFontFamily: 'Web CAD' },
      { status: 'missing', source: 'fallback', resolvedFontFamily: 'Absent' }
    ]);
    expect(result.warnings).toHaveLength(3);
  });

  it('preserves explicitly known embedded provenance without inferring it from a family name', () => {
    mockFonts(['Embedded Font']);
    expect(analyzePreviewFonts([{ fontFamily: 'Embedded Font', source: 'embedded' }]).fonts[0])
      .toMatchObject({ status: 'available', source: 'embedded' });
  });

  it('deduplicates references and warnings while preserving distinct styles and rechecking later calls', () => {
    const context = mockFonts();
    const references = [{ fontFamily: ' Missing ' }, { fontFamily: '"missing"' }, { fontFamily: 'Missing', styleName: 'Other' }];
    const result = analyzePreviewFonts(references);
    expect(result.fonts).toHaveLength(2);
    expect(result.warnings).toHaveLength(1);
    // Distinct styles share one measurement pass for this analysis only.
    expect(context.measureText).toHaveBeenCalledTimes(6);
    context.measureText.mockImplementation(() => ({ width: context.font.includes('"Missing"') ? 150 : 100 }));
    expect(analyzePreviewFonts(references).fonts.every((font) => font.status === 'available')).toBe(true);
  });

  it.each([0, NaN, Infinity])('treats unusable measurement %s as unknown', (width) => {
    const context = mockFonts();
    context.measureText.mockReturnValue({ width });
    expect(analyzePreviewFonts([{ fontFamily: 'Unverified' }]).fonts[0].status).toBe('unknown');
  });
});

describe('scene font discovery', () => {
  it('publishes PPTX diagnostics through state and warning events and clears them on replacement', async () => {
    mockFonts();
    const host = document.body.appendChild(document.createElement('div'));
    const session = createPptxPreviewDriver().createSession(host, { fit: 'none' });
    const warnings = vi.fn(), rendered = vi.fn();
    session.on('warnings', warnings);
    session.on('rendered', rendered);
    try {
      const source = await readFixture('fixtures-text-theme.pptx');
      await session.load(source, { descriptor: { source } });
      const state = session.getState();
      expect(state.fonts?.length).toBeGreaterThan(0);
      expect(state.fonts?.every((font) => font.status === 'missing')).toBe(true);
      expect(warnings).toHaveBeenLastCalledWith(state.warnings);
      expect(rendered.mock.lastCall?.[0].fonts).toEqual(state.fonts);
      state.fonts![0].status = 'available';
      expect(session.getState().fonts![0].status).toBe('missing');
      const invalid = new Uint8Array([1, 2, 3]);
      await session.load(invalid, { descriptor: { source: invalid } });
      expect(session.getState().fonts).toEqual([]);
      expect(session.getState().warnings).toEqual([]);
    } finally {
      session.destroy();
      host.remove();
    }
  });

  it('finds text, shape, table, and bullet fonts on every slide without exporting document text', () => {
    const frame = (fontFamily: string): TextFrame => ({
      verticalAlign: 'top', padding: { top: 0, right: 0, bottom: 0, left: 0 },
      paragraphs: [{ bullet: { char: '•', fontFamily: 'Symbol Font' }, runs: [{ text: 'Private document text', fontFamily }] }]
    });
    const text: TextItem = {
      id: 'text', kind: 'text', order: 0, groupPath: [], fill: { type: 'none' },
      transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, flipH: false, flipV: false }, textFrame: frame('Text Font')
    };
    const slide: SlideModel = {
      id: 'slide', index: 0, title: '', width: 800, height: 600, warnings: [], background: { type: 'none' },
      items: [text, { ...text, id: 'shape', kind: 'shape', shapeType: 'rect', textFrame: frame('Shape Font') },
        { ...text, id: 'table', kind: 'table', rows: [100], columns: [100],
          cells: [{ row: 0, column: 0, rowSpan: 1, colSpan: 1, isMergedContinuation: false, fill: { type: 'none' }, textFrame: frame('Table Font') }] }]
    };
    const references = collectSlideFontReferences([slide, { ...slide, items: [{ ...text, textFrame: frame('Other Slide Font') }] }]);
    expect(references.map((reference) => reference.fontFamily)).toEqual(['Symbol Font', 'Text Font', 'Shape Font', 'Table Font', 'Other Slide Font']);
    expect(JSON.stringify(references)).not.toContain('Private document text');
  });

  it('retains a loaded regular mapping when the same family has an unresolved italic face', () => {
    const regular = { text: 'Normal', fontFamily: 'Source Book', bold: false };
    const italic = { text: 'Italic', fontFamily: 'Source Book', bold: false, italic: true };
    const bold = { text: 'Bold', fontFamily: 'Source Book', bold: true };
    const text: TextItem = {
      id: 'text', kind: 'text', order: 0, groupPath: [], fill: { type: 'none' },
      transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, flipH: false, flipV: false },
      textFrame: { verticalAlign: 'top', padding: { top: 0, right: 0, bottom: 0, left: 0 }, paragraphs: [{ runs: [regular, italic, bold] }] }
    };
    const slides = [{ items: [text] }];
    const references = collectSlideFontLoadingReferences(slides).map(ref => ({ ...ref,
      resolvedFontFamily: ref.fontStyle === 'italic' ? undefined : ref.traits?.weight === 700 ? 'Backup Book' : 'Web Book'
    }));
    applySlideFontMappings(slides, references);
    expect([regular.fontFamily, italic.fontFamily, bold.fontFamily]).toEqual(['Web Book', 'Source Book', 'Backup Book']);
    expect(collectSlideFontLoadingReferences(slides).map(ref => ref.fontFamily)).toEqual(['Source Book', 'Source Book', 'Source Book']);
    applySlideFontMappings(slides, references);
    expect([regular.fontFamily, italic.fontFamily, bold.fontFamily]).toEqual(['Web Book', 'Source Book', 'Backup Book']);
  });
});
