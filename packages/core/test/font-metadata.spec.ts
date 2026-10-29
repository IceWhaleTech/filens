import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readPreviewFontMetadata } from '../src/preview/font-metadata';

function table(length: number, write: (view: DataView) => void) {
  const bytes = new Uint8Array(length);
  write(new DataView(bytes.buffer));
  return bytes;
}

function sfnt(tables: Record<string, Uint8Array>) {
  const entries = Object.entries(tables);
  const bytes = new Uint8Array(12 + entries.length * 16 + entries.reduce((n, [, bytes]) => n + bytes.length, 0));
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x00010000); view.setUint16(4, entries.length);
  let offset = 12 + entries.length * 16;
  entries.forEach(([tag, data], i) => {
    const entry = 12 + i * 16;
    for (let j = 0; j < 4; j++) bytes[entry + j] = tag.charCodeAt(j);
    view.setUint32(entry + 8, offset); view.setUint32(entry + 12, data.length);
    bytes.set(data, offset); offset += data.length;
  });
  return bytes;
}

function cmap12(groups: Array<[number, number, number]>) {
  return table(28 + groups.length * 12, view => {
    view.setUint16(2, 1); view.setUint16(4, 3); view.setUint16(6, 10); view.setUint32(8, 12);
    view.setUint16(12, 12); view.setUint32(16, 16 + groups.length * 12); view.setUint32(24, groups.length);
    groups.forEach(([start, end, glyph], i) => {
      const pos = 28 + i * 12;
      view.setUint32(pos, start); view.setUint32(pos + 4, end); view.setUint32(pos + 8, glyph);
    });
  });
}

function cmap4(useGlyphArray = false) {
  // Two segments: A–C and the required U+FFFF sentinel.
  return table(useGlyphArray ? 50 : 44, view => {
    view.setUint16(2, 1); view.setUint16(4, 3); view.setUint16(6, 1); view.setUint32(8, 12);
    view.setUint16(12, 4); view.setUint16(14, useGlyphArray ? 38 : 32); view.setUint16(18, 4);
    view.setUint16(26, 67); view.setUint16(28, 0xffff);
    view.setUint16(32, 65); view.setUint16(34, 0xffff);
    view.setInt16(36, useGlyphArray ? 1 : -64); view.setInt16(38, 1);
    if (useGlyphArray) {
      view.setUint16(40, 4); view.setUint16(44, 1); view.setUint16(46, 0); view.setUint16(48, 3);
    }
  });
}

function names(records: Array<{ id: number; value: string; platform?: number; language?: number }>) {
  const storage = 6 + records.length * 12;
  return table(storage + records.reduce((n, record) => n + record.value.length * 2, 0), view => {
    view.setUint16(2, records.length); view.setUint16(4, storage);
    let offset = 0;
    records.forEach((record, i) => {
      const pos = 6 + i * 12;
      view.setUint16(pos, record.platform ?? 3); view.setUint16(pos + 2, 1); view.setUint16(pos + 4, record.language ?? 0x409);
      view.setUint16(pos + 6, record.id); view.setUint16(pos + 8, record.value.length * 2); view.setUint16(pos + 10, offset);
      for (let j = 0; j < record.value.length; j++) view.setUint16(storage + offset + j * 2, record.value.charCodeAt(j));
      offset += record.value.length * 2;
    });
  });
}

describe('local SFNT font metadata', () => {
  it.each(['Regular', 'Bold'])('reads real Liberation Sans %s metadata and Unicode coverage', async face => {
    const bytes = await readFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), `../../../node_modules/pdfjs-dist/standard_fonts/LiberationSans-${face}.ttf`));
    const metadata = readPreviewFontMetadata(bytes);
    expect(metadata).toMatchObject({ fontFamily: 'Liberation Sans', subfamily: face, traits: { serif: false, monospace: false, weight: face === 'Bold' ? 700 : 400, stretch: 100 } });
    expect(metadata.traits.averageWidth).toBeGreaterThan(0);
    expect(metadata.coverage?.some(([start, end]) => start <= 65 && end >= 65)).toBe(true);
    expect(metadata.coverage?.some(([start, end]) => start <= 0x6c49 && end >= 0x6c49)).toBe(false);
  });

  it('uses explicit OS/2 weight/width and fixed-pitch metrics over PANOSE estimates', () => {
    const bytes = sfnt({
      head: table(20, v => v.setUint16(18, 1000)),
      'OS/2': table(42, v => {
        v.setInt16(2, 450); v.setUint16(4, 650); v.setUint16(6, 3);
        [2, 11, 6, 3, 5, 4, 5, 2, 3, 4].forEach((byte, i) => v.setUint8(32 + i, byte));
      }),
      post: table(16, v => v.setUint32(12, 1))
    });
    expect(readPreviewFontMetadata(bytes).traits).toMatchObject({ serif: false, style: 'text', monospace: true, weight: 650, stretch: 75, averageWidth: 0.45 });
    const padded = new Uint8Array(bytes.length + 12); padded.set(bytes, 5);
    expect(readPreviewFontMetadata(padded.subarray(5, 5 + bytes.length))).toEqual(readPreviewFontMetadata(bytes.buffer));
  });

  it('prefers typographic names and English Windows records while decoding Unicode', () => {
    const metadata = readPreviewFontMetadata(sfnt({ name: names([
      { id: 1, value: 'Legacy Family' }, { id: 2, value: 'Legacy Face' },
      { id: 16, value: '字体家族', language: 0x804 }, { id: 16, value: 'Book Family' },
      { id: 17, value: 'SemiBold' }
    ]) }));
    expect(metadata.fontFamily).toBe('Book Family'); expect(metadata.subfamily).toBe('SemiBold');
  });

  it('reads astral cmap12 ranges, excluding glyph zero and surrogate code points', () => {
    const metadata = readPreviewFontMetadata(sfnt({ cmap: cmap12([[64, 67, 0], [0xd7ff, 0xe000, 10], [0x1f600, 0x1f601, 3000]]) }));
    expect(metadata.coverage).toEqual([[65, 67], [0xd7ff, 0xd7ff], [0xe000, 0xe000], [0x1f600, 0x1f601]]);
  });

  it.each([false, true])('reads cmap4 delta and glyph-array mappings (array: %s)', array => {
    expect(readPreviewFontMetadata(sfnt({ cmap: cmap4(array), maxp: table(6, v => v.setUint16(4, 5)) })).coverage)
      .toEqual(array ? [[65, 65], [67, 67]] : [[65, 67]]);
  });

  it('distinguishes unsupported Unicode maps from an explicitly empty map', () => {
    const unsupported = table(18, v => { v.setUint16(2, 1); v.setUint16(4, 3); v.setUint16(6, 1); v.setUint32(8, 12); v.setUint16(12, 6); });
    expect(readPreviewFontMetadata(sfnt({ cmap: unsupported })).coverage).toBeUndefined();
    expect(readPreviewFontMetadata(sfnt({ cmap: cmap12([[65, 65, 0]]) })).coverage).toEqual([]);
  });

  it('rejects malformed directories, names, ranges and glyph pointers without out-of-bounds reads', () => {
    const truncated = sfnt({}); new DataView(truncated.buffer).setUint16(4, 1);
    const invalidName = names([{ id: 1, value: 'Book' }]); new DataView(invalidName.buffer).setUint16(16, 0xffff);
    const invalidRange = cmap4(true); new DataView(invalidRange.buffer).setUint16(40, 200);
    const cases = [truncated, sfnt({ name: invalidName }), sfnt({ cmap: invalidRange }),
      sfnt({ cmap: cmap12([[100, 90, 1]]) }), sfnt({ cmap: cmap12([[65, 70, 1], [70, 75, 8]]) }),
      sfnt({ cmap: cmap12([[65, 70, 3]]), maxp: table(6, v => v.setUint16(4, 5)) })];
    for (const bytes of cases) expect(() => readPreviewFontMetadata(bytes)).toThrow(/Invalid SFNT/);
    const directory = sfnt({ name: new Uint8Array(6) }); new DataView(directory.buffer).setUint32(20, 0xffffffff);
    expect(() => readPreviewFontMetadata(directory)).toThrow(/Invalid SFNT/);
  });

  it.each([0x774f4646, 0x774f4632, 0x74746366])('leaves unsupported font container %s explicit', signature => {
    expect(() => readPreviewFontMetadata(table(12, v => v.setUint32(0, signature)))).toThrow(/container is unsupported/);
  });
});
