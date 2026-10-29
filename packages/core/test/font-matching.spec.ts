import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzePreviewFonts } from '../src/preview/fonts';
import { buildPreviewFontStack, classifyPreviewFont, getFontFallbackCandidates, officeFontTraits, rankPreviewFontCandidates, splitPreviewFontFamilies } from '../src/preview/font-matching';
import { fontTraitsFromPanose } from '../src/preview/font-panose';

afterEach(() => vi.restoreAllMocks());

function availableFonts(names: string[]) {
  const context = { font: '', measureText: () => ({ width: names.some(name => context.font.includes(`"${name}"`)) ? 140 : 100 }) };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
}

describe('font classification and similar substitutes', () => {
  it.each([
    ['Times New Roman', { serif: true, style: 'text', evidence: 'known' }],
    ['Arial', { serif: false, style: 'text', evidence: 'known' }],
    ['Consolas', { monospace: true, evidence: 'known' }],
    ['Comic Sans MS', { style: 'handwriting', evidence: 'known' }],
    ['Papyrus', { style: 'decorative', evidence: 'known' }],
    ['微软雅黑', { serif: false, script: 'cjk-sc', evidence: 'known' }],
    ['游ゴシック', { serif: false, script: 'japanese', evidence: 'known' }],
    ['Unknown Serif', { serif: true, evidence: 'name' }],
    ['Unknown', { evidence: 'unknown' }]
  ])('classifies %s with explicit evidence', (family, expected) => {
    expect(classifyPreviewFont(family as string)).toMatchObject(expected);
  });

  it('prioritizes file metadata over name inference and distinguishes Office family classes', () => {
    expect(classifyPreviewFont('Unknown Sans', officeFontTraits('roman'))).toMatchObject({ serif: true, evidence: 'metadata' });
    expect(classifyPreviewFont('Times New Roman', officeFontTraits(3))).toMatchObject({ monospace: true, evidence: 'metadata' });
    expect(officeFontTraits('auto', 'fixed')).toEqual({ monospace: true });
    expect(officeFontTraits('script')).toEqual({ style: 'handwriting' });
    expect(officeFontTraits(5)).toEqual({ style: 'decorative' });
  });

  it('keeps serif, monospace, decorative, CJK regions and legacy symbols separate', () => {
    expect(getFontFallbackCandidates('Times New Roman')[0]).toBe('Liberation Serif');
    expect(getFontFallbackCandidates('Calibri')[0]).toBe('Carlito');
    expect(getFontFallbackCandidates('Unknown', { monospace: true })).toContain('Liberation Mono');
    expect(getFontFallbackCandidates('Unknown', { style: 'decorative' })).not.toContain('Arial');
    expect(getFontFallbackCandidates('Unknown', { serif: true, script: 'japanese' })).toContain('Noto Serif CJK JP');
    expect(getFontFallbackCandidates('Unknown', { serif: true, script: 'japanese' })).not.toContain('Songti SC');
    expect(getFontFallbackCandidates('Wingdings')).toEqual([]);
    expect(getFontFallbackCandidates('Unknown')).toEqual([]);
    expect(getFontFallbackCandidates('constructor')).toEqual([]);
    expect(getFontFallbackCandidates('__proto__')).toEqual([]);
    expect(getFontFallbackCandidates('Calibri', officeFontTraits('swiss'))[0]).toBe('Carlito');
    expect(getFontFallbackCandidates('Times New Roman', officeFontTraits('modern'))).not.toContain('Liberation Serif');
  });

  it('only records substitution after detecting a named compatible candidate', () => {
    availableFonts(['Liberation Serif', 'Liberation Mono', 'Papyrus']);
    const { fonts } = analyzePreviewFonts([
      { fontFamily: 'Missing Serif', traits: { serif: true } },
      { fontFamily: 'Missing Code', traits: { monospace: true } },
      { fontFamily: 'Missing Ornamental', traits: { style: 'decorative' } }
    ], document, { substitute: true });
    expect(fonts).toMatchObject([
      { status: 'substituted', source: 'fallback', resolvedFontFamily: 'Liberation Serif', substitutionReason: 'serif' },
      { status: 'substituted', source: 'fallback', resolvedFontFamily: 'Liberation Mono', substitutionReason: 'monospace' },
      { status: 'substituted', source: 'fallback', resolvedFontFamily: 'Papyrus', substitutionReason: 'decorative' }
    ]);
  });

  it('preserves explicit mappings, embedded declarations and SHX instead of guessing another font', () => {
    availableFonts(['Liberation Serif']);
    expect(analyzePreviewFonts([
      { fontFamily: 'Missing Serif', resolvedFontFamily: 'Host Choice', source: 'application' },
      { fontFamily: 'Embedded Serif', embedded: true },
      { fontFamily: 'CAD Serif', fontFile: 'romans.shx' }
    ], document, { substitute: true }).fonts).toMatchObject([
      { status: 'missing', resolvedFontFamily: 'Host Choice' },
      { status: 'unknown', embedded: true, resolvedFontFamily: undefined },
      { status: 'unsupported', resolvedFontFamily: undefined }
    ]);
  });

  it('does not claim a generic fallback or an unavailable probe is an installed replacement', () => {
    availableFonts([]);
    expect(analyzePreviewFonts([{ fontFamily: 'Missing Serif' }], document, { substitute: true }).fonts[0]).toMatchObject({ status: 'missing', resolvedFontFamily: undefined });
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    expect(analyzePreviewFonts([{ fontFamily: 'Missing Serif' }], document, { substitute: true }).fonts[0].status).toBe('unknown');
  });

  it('preserves explicit CSS stack order and quoted commas before classified fallbacks', () => {
    expect(splitPreviewFontFamilies('"A, B", Times New Roman, Arial')).toEqual(['A, B', 'Times New Roman', 'Arial']);
    const families = splitPreviewFontFamilies(buildPreviewFontStack('"A, B", Times New Roman, Arial'));
    expect(families.slice(0, 3)).toEqual(['A, B', 'Times New Roman', 'Arial']);
    expect(families).toContain('Liberation Serif');
    expect(families).toContain('Liberation Sans');
    expect(buildPreviewFontStack('Unknown', { monospace: true })).toContain('monospace');
  });

  it('interprets PANOSE dimensions by family and ignores malformed or reserved values', () => {
    expect(fontTraitsFromPanose('020B0806050405020304')).toMatchObject({ serif: false, monospace: false, style: 'text', weight: 700, stretch: 75 });
    expect(fontTraitsFromPanose('02020609050405020304')).toMatchObject({ serif: true, monospace: true, weight: 400 });
    expect(fontTraitsFromPanose('030B0809050405020304')).toEqual({ panose: '030B0809050405020304', style: 'handwriting', weight: 700 });
    expect(fontTraitsFromPanose('040B0809050405020304').style).toBe('decorative');
    expect(fontTraitsFromPanose('050B0809050405020304')).toEqual({ panose: '050B0809050405020304', style: 'symbol' });
    for (const value of ['', 'not-hex', '020B08', '00000000000000000000']) expect(fontTraitsFromPanose(value)).toEqual({});
    expect(fontTraitsFromPanose('02000101000000000000')).toEqual({ panose: '02000101000000000000', style: 'text' });
    expect(classifyPreviewFont('Unfamiliar', { panose: 'invalid' })).toEqual({ evidence: 'unknown' });
    expect(classifyPreviewFont('Unfamiliar', { panose: '020B0806050405020304', weight: 600 })).toMatchObject({ serif: false, weight: 600, stretch: 75, evidence: 'metadata' });
  });

  it('recognizes face suffixes and favors matching width, weight and average advance', () => {
    expect(classifyPreviewFont('Arial Narrow Bold')).toMatchObject({ serif: false, stretch: 75, weight: 700 });
    const ranked = rankPreviewFontCandidates({ fontFamily: 'Custom Sans', traits: { weight: 700, stretch: 75, averageWidth: 0.45 } }, [
      { fontFamily: 'Normal Sans', traits: { weight: 400, stretch: 100, averageWidth: 0.6 } },
      { fontFamily: 'Compact Sans', traits: { weight: 700, stretch: 75, averageWidth: 0.45 } },
      { fontFamily: 'Book Serif' }
    ]);
    expect(ranked.map(match => match.candidate.fontFamily)).toEqual(['Compact Sans', 'Normal Sans']);
    expect(ranked[0].reasons).toEqual(expect.arrayContaining(['weight', 'stretch', 'average-width']));
    expect(getFontFallbackCandidates('Custom Sans', { stretch: 75 })[0]).toBe('Arial Narrow');
  });

  it('compares supported PANOSE text dimensions without scoring reserved values', () => {
    const ranked = rankPreviewFontCandidates({ fontFamily: 'Custom', traits: { panose: '020B0603050405020304' } }, [
      { fontFamily: 'Far', traits: { panose: '020B0603090A0B0F0D07' } },
      { fontFamily: 'Near', traits: { panose: '020B0603050405020304' } }
    ]);
    expect(ranked[0].candidate.fontFamily).toBe('Near');
    expect(ranked[0].reasons).toContain('PANOSE');
    const reserved = rankPreviewFontCandidates({ fontFamily: 'Custom', traits: { panose: '020B0603FFFFFFFFFFFF' } }, [
      { fontFamily: 'Other', traits: { panose: '020B0603000000000000' } }
    ]);
    expect(reserved[0].reasons).not.toContain('PANOSE');
  });

  it('rejects known missing glyphs and favors verified sample coverage over metric similarity', () => {
    const ranked = rankPreviewFontCandidates({ fontFamily: 'Times New Roman', text: 'A汉😀', traits: { weight: 700 } }, [
      { fontFamily: 'Liberation Serif' },
      { fontFamily: 'Missing Serif', coverage: [[65, 90]] },
      { fontFamily: 'Covered Serif', traits: { weight: 300 }, coverage: [[65, 90], [0x6c49, 0x6c49], [0x1f600, 0x1f600]] }
    ]);
    expect(ranked.map(match => [match.candidate.fontFamily, match.coverage])).toEqual([
      ['Covered Serif', 'matched'], ['Liberation Serif', 'unknown']
    ]);
    expect(rankPreviewFontCandidates({ fontFamily: 'Missing Code', traits: { monospace: true } }, [{ fontFamily: 'Unknown', traits: { weight: 400 } }])).toEqual([]);
    expect(rankPreviewFontCandidates({ fontFamily: 'Brush Script' }, [{ fontFamily: 'Unknown', traits: { weight: 400 } }])).toEqual([]);
    expect(rankPreviewFontCandidates({ fontFamily: 'Wingdings' }, [{ fontFamily: 'Noto Sans Symbols' }])).toEqual([]);
    expect(rankPreviewFontCandidates({ fontFamily: 'Segoe UI Emoji' }, [{ fontFamily: 'Apple Color Emoji' }])).toHaveLength(1);
  });

  it('uses ranked locally available candidates without exporting the local text sample', () => {
    availableFonts(['Compact Sans', 'Arial']);
    const result = analyzePreviewFonts([{ fontFamily: 'Private Sans', text: 'Secret', traits: { stretch: 75 } }], document, {
      substitute: true, candidates: [{ fontFamily: 'Compact Sans', traits: { stretch: 75 }, coverage: [[32, 126]] }]
    });
    expect(result.fonts[0]).toMatchObject({ status: 'substituted', resolvedFontFamily: 'Compact Sans', coverage: 'matched', substitutionReason: 'sans-serif, stretch, glyph-coverage' });
    expect(result.fonts[0].matchScore).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain('Secret');
    const stack = splitPreviewFontFamilies(buildPreviewFontStack('Private Sans, Explicit Choice', { serif: false }, ['Compact Sans']));
    expect(stack.slice(0, 4)).toEqual(['Private Sans', 'Explicit Choice', 'Compact Sans', 'Arial']);
  });

  it('does not turn invalid numeric metadata into a NaN score', () => {
    const matches = rankPreviewFontCandidates({ fontFamily: 'Missing Sans', traits: { weight: NaN, stretch: Infinity, averageWidth: -1 } }, [{ fontFamily: 'Arial' }]);
    expect(matches).toHaveLength(1);
    expect(Number.isFinite(matches[0].score)).toBe(true);
    expect(classifyPreviewFont('Arial', { weight: NaN }).weight).toBe(400);
  });
});
