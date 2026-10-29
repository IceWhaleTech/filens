import type { SlideModel, TextFrame } from '../types';
import { normalizeFontFamilyName, normalizeLocalizedFontAlias } from '../utils/fonts';
import type { PreviewFontCandidate, PreviewFontDiagnostic, PreviewFontReference } from './types';
import { classifyPreviewFont, getFontFallbackCandidates, rankPreviewFontCandidates } from './font-matching';
import { originalSceneFontFamily } from './font-scenes';

const GENERIC_FAMILY = /^(serif|sans-serif|monospace|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|cursive|fantasy|emoji|math|fangsong)$/i;
const PROBE_TEXT = 'BESbswy1234567890汉字かな한글';

/** Collect resolved scene references, including inherited runs and table/bullet text. */
export function collectSlideFontReferences(slides: readonly Pick<SlideModel, 'items'>[]): PreviewFontReference[] {
  const references = new Map<string, PreviewFontReference>();
  const add = (fontFamily: string | undefined) => {
    if (!fontFamily) return;
    const normalized = normalizeFontFamilyName(fontFamily);
    if (normalized) references.set(normalized.toLowerCase(), { fontFamily: normalized });
  };
  const collectFrame = (frame: TextFrame | undefined) => {
    for (const paragraph of frame?.paragraphs ?? []) {
      if (paragraph.bullet) add(originalSceneFontFamily(paragraph.bullet));
      for (const run of paragraph.runs) add(originalSceneFontFamily(run));
    }
  };
  for (const slide of slides) {
    for (const item of slide.items) {
      if (item.kind === 'text' || item.kind === 'shape') collectFrame(item.textFrame);
      else if (item.kind === 'table') {
        for (const cell of item.cells) collectFrame(cell.textFrame);
      }
    }
  }
  return [...references.values()];
}

/** Local, synchronous diagnostics. Never fetches fonts or treats FontFaceSet.check as proof. */
export function analyzePreviewFonts(
  references: readonly PreviewFontReference[],
  documentLike: Document | undefined = typeof document === 'undefined' ? undefined : document,
  options: { substitute?: boolean; candidates?: readonly PreviewFontCandidate[] } = {}
): { fonts: PreviewFontDiagnostic[]; warnings: string[] } {
  const fonts = new Map<string, PreviewFontDiagnostic>();
  const availability = new Map<string, boolean | undefined>();
  let context: CanvasRenderingContext2D | null | undefined;
  const measure = (family: string): number | undefined => {
    try {
      if (context === undefined) context = documentLike?.createElement('canvas').getContext('2d') ?? null;
      if (!context) return undefined;
      context.font = `normal 400 32px ${family}`;
      const width = context.measureText(PROBE_TEXT).width;
      return Number.isFinite(width) && width > 0 ? width : undefined;
    } catch {
      return undefined;
    }
  };
  const baselines = new Map<string, number | undefined>();
  const probe = (family: string): boolean | undefined => {
    const key = family.toLowerCase();
    if (availability.has(key)) return availability.get(key);
    // A CSS stack is not one font. The browser may silently choose any member.
    if (family.includes(',') || /[\x00-\x1f\x7f]/.test(family)) return undefined;
    if (GENERIC_FAMILY.test(family)) return documentLike ? true : undefined;
    let result: boolean | undefined = false;
    const candidates = new Set([family, normalizeLocalizedFontAlias(family)]);
    for (const baseline of ['monospace', 'serif', 'sans-serif']) {
      if (!baselines.has(baseline)) baselines.set(baseline, measure(baseline));
      const baselineWidth = baselines.get(baseline);
      for (const candidate of candidates) {
        const width = measure(`${quoteFamily(candidate)}, ${baseline}`);
        if (width == null || baselineWidth == null) result = undefined;
        else if (Math.abs(width - baselineWidth) > 0.1) {
          availability.set(key, true);
          return true;
        }
      }
    }
    availability.set(key, result);
    return result;
  };

  for (const reference of references) {
    const fontFamily = normalizeFontFamilyName(reference.fontFamily ?? '') || undefined;
    const fontFile = reference.fontFile?.trim() || undefined;
    if (!fontFamily && !fontFile) continue;
    let resolvedFontFamily = normalizeFontFamilyName(reference.resolvedFontFamily ?? '') || undefined;
    let target = resolvedFontFamily ?? fontFamily;
    const unsupported = reference.browserUnsupported || /\.shx$/i.test(fontFile ?? '');
    let found = target && (!unsupported || resolvedFontFamily) ? probe(target) : undefined;
    const classification = classifyPreviewFont(fontFamily ?? '', reference.traits);
    let substitutionReason: string | undefined;
    let matchScore: number | undefined;
    let coverage: PreviewFontDiagnostic['coverage'];
    if (options.substitute && found === false && fontFamily && !resolvedFontFamily && !unsupported && !reference.embedded) {
      const candidates = new Map<string, PreviewFontCandidate>();
      for (const family of getFontFallbackCandidates(fontFamily, reference.traits)) candidates.set(family.toLowerCase(), { fontFamily: family });
      for (const candidate of options.candidates ?? []) candidates.set(candidate.fontFamily.toLowerCase(), candidate);
      const replacement = rankPreviewFontCandidates(reference, [...candidates.values()])
        .find(match => !GENERIC_FAMILY.test(match.candidate.fontFamily) && probe(match.candidate.fontFamily) === true);
      if (replacement) {
        resolvedFontFamily = target = replacement.candidate.fontFamily;
        found = true;
        matchScore = replacement.score;
        coverage = replacement.coverage;
        substitutionReason = classification.monospace ? 'monospace' : classification.style === 'handwriting' ? 'handwriting'
          : classification.style === 'decorative' ? 'decorative' : classification.script === 'emoji' ? 'emoji'
            : classification.serif === true ? 'serif' : classification.serif === false ? 'sans-serif' : 'similar-traits';
        const details = replacement.reasons.filter(reason => ['weight', 'stretch', 'average-width', 'PANOSE', 'glyph-coverage'].includes(reason));
        if (details.length) substitutionReason += `, ${details.join(', ')}`;
      }
    }
    let status: PreviewFontDiagnostic['status'] = 'unknown';
    let source = reference.source ?? 'unknown';
    if (unsupported && !resolvedFontFamily) {
      status = 'unsupported';
      source = 'fallback';
    } else if (found === false && !reference.embedded) {
      status = 'missing';
      source = 'fallback';
    } else if (found === true) {
      status = resolvedFontFamily && (unsupported || resolvedFontFamily.toLowerCase() !== fontFamily?.toLowerCase())
        ? 'substituted' : 'available';
      source = substitutionReason ? 'fallback' : reference.source ?? (GENERIC_FAMILY.test(target!) ? 'fallback' : 'environment');
    }
    const diagnostic: PreviewFontDiagnostic = {
      fontFamily, fontFile, styleName: reference.styleName, resolvedFontFamily, status, source,
      classification, substitutionReason, matchScore, coverage, embedded: reference.embedded
    };
    const key = JSON.stringify([fontFamily?.toLowerCase(), fontFile?.toLowerCase(), reference.styleName, resolvedFontFamily?.toLowerCase(), source, classification, reference.embedded]);
    if (!fonts.has(key)) fonts.set(key, diagnostic);
  }
  const diagnostics = [...fonts.values()];
  return { fonts: diagnostics, warnings: getPreviewFontWarnings(diagnostics) };
}

/** Drivers with existing format-specific warnings can select which diagnostics need a warning. */
export function getPreviewFontWarnings(fonts: readonly PreviewFontDiagnostic[]): string[] {
  const warnings = new Map<string, string>();
  const warn = (warning: string) => {
    const key = warning.toLowerCase();
    if (!warnings.has(key)) warnings.set(key, warning);
  };
  for (const font of fonts) {
    const label = font.fontFamily ?? font.fontFile;
    if (!label) continue;
    if (font.status === 'unsupported') {
      warn(`Font "${label}" cannot be rendered directly by the browser; fallback fonts may change layout.`);
    } else if (font.status === 'missing') {
      warn(`Font "${font.resolvedFontFamily ?? label}" was not detected; fallback fonts may change layout.`);
    } else if (font.status === 'substituted') {
      warn(font.substitutionReason
        ? `Font "${label}" is automatically substituted with "${font.resolvedFontFamily}" (${font.substitutionReason}); text layout may differ.`
        : `Font "${label}" is mapped to "${font.resolvedFontFamily}"; text layout may differ.`);
    }
  }
  return [...warnings.values()];
}

function quoteFamily(family: string): string {
  return `"${family.replace(/["\\]/g, '\\$&')}"`;
}
