import { fontTraitsFromPanose } from './font-panose';
import type { PreviewFontCandidate, PreviewFontTraits } from './types';

export interface PreviewFontMetadata {
  fontFamily?: string;
  subfamily?: string;
  traits: PreviewFontTraits;
  coverage?: PreviewFontCandidate['coverage'];
}

/** Inspect a single SFNT TTF/OTF locally; does not load the font or extract outlines. */
export function readPreviewFontMetadata(source: ArrayBuffer | Uint8Array): PreviewFontMetadata {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const invalid = (): never => { throw new Error('Invalid SFNT font metadata.'); };
  const check = (offset: number, length: number) => {
    if (offset < 0 || length < 0 || offset > bytes.length || length > bytes.length - offset) invalid();
  };
  check(0, 12);
  const signature = view.getUint32(0);
  if (![0x00010000, 0x4f54544f, 0x74727565].includes(signature)) throw new Error('Font metadata supports single SFNT TTF/OTF files; this container is unsupported.');
  const count = view.getUint16(4);
  check(12, count * 16);
  const tables = new Map<string, DataView>();
  for (let i = 0; i < count; i++) {
    const entry = 12 + i * 16;
    const tag = String.fromCharCode(...bytes.subarray(entry, entry + 4));
    const offset = view.getUint32(entry + 8), length = view.getUint32(entry + 12);
    check(offset, length);
    if (tables.has(tag)) invalid();
    tables.set(tag, new DataView(bytes.buffer, bytes.byteOffset + offset, length));
  }
  const head = tables.get('head');
  const units = head && head.byteLength >= 20 ? head.getUint16(18) : 0;
  const em = units >= 16 && units <= 16384 ? units : undefined;
  const os2 = tables.get('OS/2');
  let traits: PreviewFontTraits = {};
  if (os2) {
    if (os2.byteLength < 8) invalid();
    if (os2.byteLength >= 42) {
      const panose = Array.from({ length: 10 }, (_, i) => os2.getUint8(32 + i).toString(16).padStart(2, '0')).join('');
      traits = fontTraitsFromPanose(panose);
    }
    const weight = os2.getUint16(4), width = os2.getUint16(6);
    if (weight >= 1 && weight <= 1000) traits.weight = weight;
    const widths = [50, 62.5, 75, 87.5, 100, 112.5, 125, 150, 200];
    if (width >= 1 && width <= 9) traits.stretch = widths[width - 1];
    const average = os2.getInt16(2);
    if (em && average > 0) traits.averageWidth = average / em;
  }
  const post = tables.get('post');
  if (post && post.byteLength >= 16) traits.monospace = post.getUint32(12) !== 0;
  const names = readNames(tables.get('name'));
  const maxp = tables.get('maxp');
  const glyphCount = maxp && maxp.byteLength >= 6 ? maxp.getUint16(4) : undefined;
  const coverage = readCoverage(tables.get('cmap'), glyphCount);
  return { ...names, traits, coverage };
}

function readNames(table: DataView | undefined): Pick<PreviewFontMetadata, 'fontFamily' | 'subfamily'> {
  if (!table) return {};
  if (table.byteLength < 6) throw new Error('Invalid SFNT name table.');
  const count = table.getUint16(2), storage = table.getUint16(4);
  if (6 + count * 12 > table.byteLength || storage < 6 + count * 12 || storage > table.byteLength) throw new Error('Invalid SFNT name table.');
  const chosen = new Map<string, { value: string; priority: number }>();
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 12;
    const platform = table.getUint16(entry), encoding = table.getUint16(entry + 2);
    const language = table.getUint16(entry + 4), id = table.getUint16(entry + 6);
    if (![1, 2, 16, 17].includes(id)) continue;
    const length = table.getUint16(entry + 8), offset = storage + table.getUint16(entry + 10);
    if (length > 4096 || offset > table.byteLength || length > table.byteLength - offset) throw new Error('Invalid SFNT name string.');
    let value = '';
    if (platform === 0 || (platform === 3 && [0, 1, 10].includes(encoding))) {
      if (length % 2) throw new Error('Invalid SFNT Unicode name.');
      for (let j = 0; j < length; j += 2) value += String.fromCharCode(table.getUint16(offset + j));
    } else if (platform === 1 && encoding === 0) {
      for (let j = 0; j < length; j++) {
        const point = table.getUint8(offset + j);
        if (point > 127) { value = ''; break; } // Do not misdecode MacRoman as Latin-1.
        value += String.fromCharCode(point);
      }
    }
    value = value.trim();
    if (!value || /[\x00-\x1f\x7f]/.test(value)) continue;
    const key = id === 1 || id === 16 ? 'fontFamily' : 'subfamily';
    const priority = (id >= 16 ? 100 : 0) + (platform === 3 ? 10 : 0) + (language === 0x409 ? 5 : 0);
    if (priority > (chosen.get(key)?.priority ?? -1)) chosen.set(key, { value, priority });
  }
  return { fontFamily: chosen.get('fontFamily')?.value, subfamily: chosen.get('subfamily')?.value };
}

function readCoverage(table: DataView | undefined, glyphCount: number | undefined): Array<[number, number]> | undefined {
  if (!table) return undefined;
  const invalid = (): never => { throw new Error('Invalid SFNT Unicode cmap.'); };
  if (table.byteLength < 4) invalid();
  const count = table.getUint16(2);
  if (4 + count * 8 > table.byteLength) invalid();
  const subtables: Array<{ offset: number; format: number; priority: number }> = [];
  for (let i = 0; i < count; i++) {
    const entry = 4 + i * 8;
    const platform = table.getUint16(entry), encoding = table.getUint16(entry + 2), offset = table.getUint32(entry + 4);
    if (platform !== 0 && !(platform === 3 && [1, 10].includes(encoding))) continue;
    if (offset > table.byteLength - 2) invalid();
    const format = table.getUint16(offset);
    if (format === 4 || format === 12) subtables.push({ offset, format, priority: (format === 12 ? 100 : 0) + (platform === 3 ? 10 : 0) });
  }
  const subtable = subtables.sort((a, b) => b.priority - a.priority)[0];
  if (!subtable) return undefined;
  const { offset, format } = subtable;
  const ranges: Array<[number, number]> = [];
  const add = (start: number, end: number) => {
    if (start > end) return;
    if (start <= 0xdfff && end >= 0xd800) {
      add(start, Math.min(end, 0xd7ff)); add(Math.max(start, 0xe000), end); return;
    }
    const previous = ranges[ranges.length - 1];
    if (previous && previous[1] + 1 === start) previous[1] = end;
    else ranges.push([start, end]);
  };
  if (format === 12) {
    if (offset > table.byteLength - 16) invalid();
    const length = table.getUint32(offset + 4), groups = table.getUint32(offset + 12);
    if (length < 16 || length > table.byteLength - offset || groups > (length - 16) / 12) invalid();
    let previous = -1;
    for (let i = 0; i < groups; i++) {
      const entry = offset + 16 + i * 12;
      const start = table.getUint32(entry), end = table.getUint32(entry + 4), glyph = table.getUint32(entry + 8);
      if (start > end || start <= previous || end > 0x10ffff || glyph + end - start > 0xffff || (glyphCount !== undefined && glyph + end - start >= glyphCount)) invalid();
      add(start + (glyph === 0 ? 1 : 0), end);
      previous = end;
    }
  } else {
    if (offset > table.byteLength - 14) invalid();
    const length = table.getUint16(offset + 2), twice = table.getUint16(offset + 6), segments = twice / 2;
    if (!twice || twice % 2 || length < 16 + segments * 8 || length > table.byteLength - offset) invalid();
    let previous = -1;
    for (let i = 0; i < segments; i++) {
      const end = table.getUint16(offset + 14 + i * 2), start = table.getUint16(offset + 16 + twice + i * 2);
      const delta = table.getInt16(offset + 16 + twice * 2 + i * 2), rangePos = offset + 16 + twice * 3 + i * 2;
      const range = table.getUint16(rangePos);
      if (start > end || start <= previous || range % 2) invalid();
      for (let point = start; point <= end && point !== 0xffff; point++) {
        const pos = rangePos + range + (point - start) * 2;
        if (range && (pos < offset + 16 + twice * 4 || pos > offset + length - 2)) invalid();
        const raw = range ? table.getUint16(pos) : point;
        const glyph = range && raw === 0 ? 0 : (raw + delta) & 0xffff;
        if (glyphCount !== undefined && glyph >= glyphCount) invalid();
        if (glyph) add(point, point);
      }
      previous = end;
    }
  }
  return ranges;
}
