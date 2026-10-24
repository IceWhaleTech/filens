import type { ParsedCell, ParsedRow, ParsedSheet } from './types';

/** Read the common numeric/shared-string cell representation directly into the
 * preview model. Rich text, formulas and other XML constructs use the general
 * parser; rejecting the entire fast path prevents partially missing content. */
export function readSimpleWorksheet(xml: string, options: { id: string; name: string; sharedStrings: string[] }): ParsedSheet | undefined {
  if (xml.includes('<!')) return undefined;
  const opening = /<sheetData\s*>/.exec(xml);
  if (!opening) return undefined;
  const start = opening.index + opening[0].length;
  const end = xml.indexOf('</sheetData>', start);
  if (end < 0) return undefined;
  const data = xml.slice(start, end);
  if (/<(?:f|is)\b/.test(data)) return undefined;
  const rows: ParsedRow[] = [];
  const rowPattern = /\s*<row\b([^<>]*?)(?:\/>|>([\s\S]*?)<\/row\s*>)/gy;
  const cellPattern = /\s*<c\b([^<>]*?)(?:\/>|>([\s\S]*?)<\/c\s*>)/gy;
  let offset = 0, maxRow = 0, maxColumn = 0;
  while (offset < data.length) {
    rowPattern.lastIndex = offset;
    const row = rowPattern.exec(data);
    if (!row) { if (data.slice(offset).trim()) return undefined; break; }
    const rowAttrs = attributes(row[1]);
    if (!rowAttrs) return undefined;
    const index = Number(rowAttrs.r ?? rows.length + 1);
    if (!Number.isInteger(index) || index < 1) return undefined;
    const cells: ParsedCell[] = [];
    const content = row[2] ?? '';
    let cellOffset = 0;
    while (cellOffset < content.length) {
      cellPattern.lastIndex = cellOffset;
      const cell = cellPattern.exec(content);
      if (!cell) { if (content.slice(cellOffset).trim()) return undefined; break; }
      const attrs = attributes(cell[1]);
      if (!attrs) return undefined;
      const body = cell[2] ?? '';
      const valueMatch = /^\s*(?:<v\s*>([\s\S]*?)<\/v\s*>|<v\s*\/>)?\s*$/.exec(body);
      if (!valueMatch) return undefined;
      const raw = valueMatch[1] ?? '';
      if (raw.trim() && !/^[\s]*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*$/.test(raw) && !/^\s*(?:true|false)\s*$/.test(raw)) return undefined;
      if (attrs.t && !['n', 's', 'b'].includes(attrs.t)) return undefined;
      if (attrs.r) {
        const ref = /^([A-Z]+)([1-9]\d*)$/i.exec(attrs.r);
        if (!ref) return undefined;
        let column = 0;
        for (const char of ref[1].toUpperCase()) column = column * 26 + char.charCodeAt(0) - 64;
        const value = attrs.t === 's' ? options.sharedStrings[Number(raw)] ?? '' :
          attrs.t === 'b' ? (raw.trim() === '1' || raw.trim() === 'true' ? 'TRUE' : 'FALSE') : raw;
        cells.push({ ref: attrs.r, row: Number(ref[2]), column, value });
        maxColumn = Math.max(maxColumn, column);
      }
      cellOffset = cellPattern.lastIndex;
    }
    rows.push({ index, cells });
    maxRow = Math.max(maxRow, index);
    offset = rowPattern.lastIndex;
  }
  return { id: options.id, name: options.name, rows, columnCount: maxColumn, rowCount: maxRow };
}

function attributes(source: string): Record<string, string> | undefined {
  const values: Record<string, string> = Object.create(null);
  const pattern = /\s+([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"<>&]*)"|'([^'<>&]*)')/gy;
  let offset = 0;
  while (offset < source.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(source);
    if (!match) return source.slice(offset).trim() ? undefined : values;
    values[match[1]] = match[2] ?? match[3];
    offset = pattern.lastIndex;
  }
  return values;
}
