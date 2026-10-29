import { normalizeFontFamilyName, normalizeLocalizedFontAlias } from '../utils/fonts';
import type { PreviewFontCandidate, PreviewFontClassification, PreviewFontReference, PreviewFontTraits } from './types';
import { fontTraitsFromPanose, parseFontPanose } from './font-panose';

const SERIF = ['Liberation Serif', 'Tinos', 'Times New Roman', 'Times', 'Noto Serif', 'Georgia', 'serif'];
const SANS = ['Arial', 'Liberation Sans', 'Arimo', 'Helvetica Neue', 'Noto Sans', 'sans-serif'];
const MONO = ['Cascadia Mono', 'Consolas', 'Liberation Mono', 'Courier New', 'Menlo', 'Noto Sans Mono', 'monospace'];
const HANDWRITING = ['Segoe Print', 'Bradley Hand', 'Comic Sans MS', 'Chalkboard SE', 'cursive'];
const DECORATIVE = ['Papyrus', 'Copperplate', 'fantasy'];
const CJK_SERIF = ['Songti SC', 'SimSun', 'STSong', 'Noto Serif CJK SC', 'Source Han Serif SC', 'serif'];
const CJK_SANS = ['PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Source Han Sans SC', 'sans-serif'];
const CJK_MONOSPACE: Record<string, string> = {
  'cjk-sc': 'Noto Sans Mono CJK SC', 'cjk-tc': 'Noto Sans Mono CJK TC',
  japanese: 'Noto Sans Mono CJK JP', korean: 'Noto Sans Mono CJK KR'
};

const METRIC_SUBSTITUTES = new Map<string, string[]>([
  ['times new roman', ['Liberation Serif', 'Tinos', 'Times']],
  ['arial', ['Liberation Sans', 'Arimo']],
  ['courier new', ['Liberation Mono', 'Cousine', 'Courier']],
  ['calibri', ['Carlito']],
  ['cambria', ['Caladea']],
  ['aptos', ['Aptos', 'Calibri', 'Carlito']]
]);

const KNOWN: Array<[RegExp, PreviewFontTraits]> = [
  [/^serif$/i, { serif: true, style: 'text' }],
  [/^sans-serif$/i, { serif: false, style: 'text' }],
  [/^monospace$/i, { monospace: true, style: 'text' }],
  [/^cursive$/i, { style: 'handwriting' }],
  [/^fantasy$/i, { style: 'decorative' }],
  [/^(?:times new roman|times|georgia|cambria|caladea|tinos|liberation serif|palatino(?: linotype)?|book antiqua|garamond|baskerville|noto serif)$/i, { serif: true, monospace: false, style: 'text', script: 'latin' }],
  [/^(?:arial|helvetica(?: neue)?|calibri(?: light)?|carlito|aptos(?: display| narrow)?|segoe ui|verdana|tahoma|roboto|arimo|liberation sans|noto sans)$/i, { serif: false, monospace: false, style: 'text', script: 'latin' }],
  [/^(?:arial narrow|roboto condensed|noto sans condensed)$/i, { serif: false, monospace: false, style: 'text', script: 'latin', stretch: 75 }],
  [/^(?:courier(?: new)?|consolas|cascadia (?:mono|code)|menlo|monaco|liberation mono|cousine|roboto mono|noto sans mono)$/i, { monospace: true, style: 'text', script: 'latin' }],
  [/^(?:simsun|nsimsun|songti sc|stsong|noto serif cjk sc|source han serif sc)$/i, { serif: true, style: 'text', script: 'cjk-sc' }],
  [/^(?:simhei|microsoft yahei|pingfang sc|dengxian(?: light)?|noto sans cjk sc|source han sans sc)$/i, { serif: false, style: 'text', script: 'cjk-sc' }],
  [/^(?:kaiti|stkaiti|fangsong|stfangsong)$/i, { serif: true, style: 'handwriting', script: 'cjk-sc' }],
  [/^(?:mingliu|pmingliu|songti tc|noto serif cjk tc)$/i, { serif: true, style: 'text', script: 'cjk-tc' }],
  [/^(?:microsoft jhenghei|pingfang tc|noto sans cjk tc)$/i, { serif: false, style: 'text', script: 'cjk-tc' }],
  [/^(?:yu mincho|ms pmincho|hiragino mincho pron|noto serif cjk jp)$/i, { serif: true, style: 'text', script: 'japanese' }],
  [/^(?:yu gothic(?: ui| light)?|meiryo|ms pgothic|hiragino sans|noto sans cjk jp)$/i, { serif: false, style: 'text', script: 'japanese' }],
  [/^(?:batang|applemyungjo|noto serif cjk kr)$/i, { serif: true, style: 'text', script: 'korean' }],
  [/^(?:malgun gothic|apple sd gothic neo|noto sans cjk kr)$/i, { serif: false, style: 'text', script: 'korean' }],
  [/^(?:comic sans ms|segoe print|bradley hand|chalkboard se|chalkboard)$/i, { style: 'handwriting', script: 'latin' }],
  [/^(?:papyrus|copperplate|algerian|jokerman)$/i, { style: 'decorative', script: 'latin' }],
  [/^impact$/i, { serif: false, style: 'text', script: 'latin' }],
  [/^(?:wingdings(?: [23])?|webdings|symbol|segoe ui symbol|apple symbols|noto sans symbols(?: 2)?)$/i, { style: 'symbol' }],
  [/^(?:segoe ui emoji|apple color emoji|noto color emoji)$/i, { style: 'symbol', script: 'emoji' }]
];

/** Format metadata takes precedence; name inference remains explicitly labelled. */
export function classifyPreviewFont(fontFamily: string, hints: PreviewFontTraits = {}): PreviewFontClassification {
  const name = normalizeLocalizedFontAlias(fontFamily);
  const base = name.replace(/\b(?:extra[- ]?light|ultra[- ]?light|semi[- ]?bold|demi[- ]?bold|extra[- ]?bold|ultra[- ]?bold|very condensed|extra condensed|condensed|narrow|expanded|extended|wide|thin|hairline|light|regular|medium|bold|black|heavy|italic|oblique)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  const known = KNOWN.find(([pattern]) => pattern.test(name) || pattern.test(base))?.[1];
  const traits: PreviewFontTraits = known ? { weight: 400, stretch: 100, ...known } : {};
  let evidence: PreviewFontClassification['evidence'] = known ? 'known' : 'unknown';
  if (!known) {
    if (/\b(?:mono(?:space)?|typewriter|courier|code)\b/i.test(name)) traits.monospace = true;
    if (/\bsans(?:[ -]serif)?\b/i.test(name)) traits.serif = false;
    else if (/\bserif\b/i.test(name)) traits.serif = true;
    if (/\b(?:script|handwriting|handwritten|brush|calligraphy)\b/i.test(name)) traits.style = 'handwriting';
    else if (/\b(?:decorative|ornamental|fantasy)\b/i.test(name)) traits.style = 'decorative';
    if (Object.keys(traits).length) evidence = 'name';
  }
  const face: PreviewFontTraits = {};
  if (/\b(?:extra[- ]?bold|ultra[- ]?bold)\b/i.test(name)) face.weight = 800;
  else if (/\b(?:semi[- ]?bold|demi[- ]?bold)\b/i.test(name)) face.weight = 600;
  else if (/\b(?:black|heavy)\b/i.test(name)) face.weight = 900;
  else if (/\bbold\b/i.test(name)) face.weight = 700;
  else if (/\b(?:extra[- ]?light|ultra[- ]?light)\b/i.test(name)) face.weight = 200;
  else if (/\b(?:thin|hairline)\b/i.test(name)) face.weight = 100;
  else if (/\blight\b/i.test(name)) face.weight = 300;
  else if (/\bmedium\b/i.test(name)) face.weight = 500;
  if (/\b(?:very condensed|extra condensed)\b/i.test(name)) face.stretch = 62.5;
  else if (/\b(?:condensed|narrow)\b/i.test(name)) face.stretch = 75;
  else if (/\b(?:expanded|extended|wide)\b/i.test(name)) face.stretch = 125;
  if (Object.keys(face).length && evidence === 'unknown') evidence = 'name';
  const supplied = Object.fromEntries(Object.entries(hints).filter(([, value]) => value !== undefined));
  if (parseFontPanose(hints.panose)) supplied.panose = hints.panose!.trim().toUpperCase();
  else delete supplied.panose;
  for (const [key, min, max] of [['weight', 1, 1000], ['stretch', 1, 1000], ['averageWidth', Number.MIN_VALUE, 100]] as const) {
    const value = supplied[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) delete supplied[key];
  }
  return { ...traits, ...face, ...fontTraitsFromPanose(hints.panose), ...supplied, evidence: Object.keys(supplied).length ? 'metadata' : evidence };
}

/** OOXML family values: Roman, Swiss, Modern, Script and Decorative. */
export function officeFontTraits(family: string | number | undefined, pitch?: string): PreviewFontTraits {
  const families: Record<string, PreviewFontTraits> = {
    '1': { serif: true, style: 'text' }, roman: { serif: true, style: 'text' },
    '2': { serif: false, style: 'text' }, swiss: { serif: false, style: 'text' },
    '3': { monospace: true, style: 'text' }, modern: { monospace: true, style: 'text' },
    '4': { style: 'handwriting' }, script: { style: 'handwriting' },
    '5': { style: 'decorative' }, decorative: { style: 'decorative' }
  };
  const traits = { ...families[String(family).toLowerCase()] };
  if (pitch === 'fixed') traits.monospace = true;
  else if (pitch === 'variable') traits.monospace = false;
  return traits;
}

export function getFontFallbackCandidates(fontFamily: string, hints?: PreviewFontTraits): string[] {
  const name = normalizeLocalizedFontAlias(fontFamily).toLowerCase();
  const traits = classifyPreviewFont(fontFamily, hints);
  let candidates: string[] = [];
  if (traits.script === 'emoji') candidates = ['Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', 'emoji'];
  else if (traits.style === 'symbol') return []; // Legacy symbol encodings require glyph mapping, not family similarity.
  else if (traits.monospace) candidates = CJK_MONOSPACE[traits.script ?? '']
    ? [CJK_MONOSPACE[traits.script!], 'monospace'] : MONO;
  else if (traits.script === 'cjk-sc') {
    candidates = traits.style === 'handwriting' ? ['KaiTi', 'STKaiti', 'FangSong', 'STFangsong', ...CJK_SERIF] : traits.serif ? CJK_SERIF : CJK_SANS;
  } else if (traits.script === 'cjk-tc') candidates = traits.serif ? ['Songti TC', 'MingLiU', 'Noto Serif CJK TC', 'serif'] : ['PingFang TC', 'Microsoft JhengHei', 'Noto Sans CJK TC', 'sans-serif'];
  else if (traits.script === 'japanese') candidates = traits.serif ? ['Yu Mincho', 'Hiragino Mincho ProN', 'Noto Serif CJK JP', 'serif'] : ['Yu Gothic', 'Meiryo', 'Hiragino Sans', 'Noto Sans CJK JP', 'sans-serif'];
  else if (traits.script === 'korean') candidates = traits.serif ? ['Batang', 'AppleMyungjo', 'Noto Serif CJK KR', 'serif'] : ['Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans CJK KR', 'sans-serif'];
  else if (traits.style === 'handwriting') candidates = HANDWRITING;
  else if (traits.style === 'decorative') candidates = DECORATIVE;
  else if (traits.serif === true) candidates = SERIF;
  else if (traits.serif === false) candidates = traits.stretch !== undefined && traits.stretch < 90
    ? ['Arial Narrow', 'Roboto Condensed', 'Noto Sans Condensed', ...SANS] : SANS;
  const metric = (METRIC_SUBSTITUTES.get(name) ?? []).filter(candidate => {
    const match = classifyPreviewFont(candidate);
    return (['monospace', 'serif', 'style', 'script'] as const).every(key =>
      traits[key] === undefined || match[key] === undefined || traits[key] === match[key]);
  });
  return [...new Set([...metric, ...candidates])].filter(candidate => candidate.toLowerCase() !== name);
}

/** Preserve the document's explicit stack before appending classified fallbacks. */
export function buildPreviewFontStack(
  fontFamily: string,
  hints?: PreviewFontTraits | ((family: string) => PreviewFontTraits | undefined),
  preferredFallbacks: readonly string[] = []
): string {
  const families = splitPreviewFontFamilies(fontFamily);
  const fallback = families.flatMap(family => getFontFallbackCandidates(family, typeof hints === 'function' ? hints(family) : hints));
  return [...new Set([...families, ...preferredFallbacks, ...fallback])].map(family => /^(?:serif|sans-serif|monospace|system-ui|cursive|fantasy|emoji|math)$/i.test(family)
    ? family : `"${family.replace(/["\\]/g, '\\$&')}"`).join(', ');
}

export interface PreviewFontMatch {
  candidate: PreviewFontCandidate;
  score: number;
  reasons: string[];
  coverage: 'matched' | 'unknown';
}

/** Rank compatible candidates; callers still must verify that the chosen family is loaded. */
export function rankPreviewFontCandidates(request: PreviewFontReference, candidates: readonly PreviewFontCandidate[]): PreviewFontMatch[] {
  const source = classifyPreviewFont(request.fontFamily ?? '', request.traits);
  if (source.style === 'symbol' && source.script !== 'emoji') return [];
  const sample = new Set<number>();
  for (const character of request.text ?? '') {
    const point = character.codePointAt(0)!;
    if (point > 32 && !(point >= 0x7f && point <= 0x9f) && point !== 0x200d && !(point >= 0xfe00 && point <= 0xfe0f) && !(point >= 0xe0100 && point <= 0xe01ef)) sample.add(point);
    if (sample.size === 256) break;
  }
  const metric = METRIC_SUBSTITUTES.get(normalizeLocalizedFontAlias(request.fontFamily ?? '').toLowerCase()) ?? [];
  const matches: PreviewFontMatch[] = [];
  for (const candidate of candidates) {
    const target = classifyPreviewFont(candidate.fontFamily, candidate.traits);
    if (source.monospace === true && target.monospace !== true) continue;
    if (['handwriting', 'decorative', 'symbol'].includes(source.style ?? '') && target.style !== source.style) continue;
    if (source.script === 'emoji' && target.script !== 'emoji') continue;
    if ((['monospace', 'serif', 'style', 'script'] as const).some(key => source[key] !== undefined && target[key] !== undefined && source[key] !== target[key])) continue;
    const ranges = candidate.coverage;
    if (ranges && sample.size && [...sample].some(point => !ranges.some(([start, end]) => point >= start && point <= end))) continue;
    let score = 0;
    const reasons: string[] = [];
    for (const key of ['monospace', 'serif', 'style', 'script'] as const) {
      if (source[key] !== undefined && source[key] === target[key]) {
        score += key === 'monospace' || key === 'script' ? 20 : 10;
        reasons.push(key);
      }
    }
    if (source.weight !== undefined && target.weight !== undefined) {
      score += 15 - Math.min(30, Math.abs(source.weight - target.weight) / 25);
      reasons.push('weight');
    }
    if (source.stretch !== undefined && target.stretch !== undefined) {
      score += 25 - Math.min(50, Math.abs(source.stretch - target.stretch));
      reasons.push('stretch');
    }
    if (source.averageWidth && target.averageWidth) {
      score += 25 - Math.min(50, Math.abs(Math.log(target.averageWidth / source.averageWidth)) * 60);
      reasons.push('average-width');
    }
    const panose = parseFontPanose(source.panose), other = parseFontPanose(target.panose);
    if (panose && other && panose[0] === 2 && other[0] === 2) {
      // Text-family dimensions only. Other PANOSE families use different enums.
      const maxima = [9, 10, 11, 15, 13, 7];
      let compared = false;
      for (let i = 4; i < 10; i++) {
        if (panose[i] < 2 || other[i] < 2 || panose[i] > maxima[i - 4] || other[i] > maxima[i - 4]) continue;
        score += 4 - Math.min(8, Math.abs(panose[i] - other[i]));
        compared = true;
      }
      if (compared) reasons.push('PANOSE');
    }
    if (metric.some(family => family.toLowerCase() === candidate.fontFamily.toLowerCase())) {
      score += 30;
      reasons.push('compatible-metrics');
    }
    const coverage = ranges && sample.size ? 'matched' : 'unknown';
    if (coverage === 'matched') { score += 40; reasons.push('glyph-coverage'); }
    if (reasons.length) matches.push({ candidate, score, reasons, coverage });
  }
  return matches.sort((a, b) => Number(b.coverage === 'matched') - Number(a.coverage === 'matched') || b.score - a.score);
}

export function splitPreviewFontFamilies(stack: string): string[] {
  // Tokenize commas outside quotes without interpreting document CSS as code.
  const families: string[] = [];
  let quote = '', escaped = false, start = 0;
  for (let i = 0; i <= stack.length; i++) {
    const char = stack[i];
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (quote) { if (char === quote) quote = ''; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === ',' || i === stack.length) {
      const family = normalizeFontFamilyName(stack.slice(start, i));
      if (family && !/[()\x00-\x1f]/.test(family)) families.push(family);
      start = i + 1;
    }
  }
  return families;
}
