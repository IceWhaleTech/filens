import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';
import type { PreviewLoadContext, PreviewSource } from '@filens/core';
import type { ParsedCell, ParsedRow, ParsedSheet, ParsedWorkbook } from './types';

const MAX_XML_ENTITY_EXPANSIONS = 100_000;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: {
    enabled: true,
    maxEntitySize: 10_000,
    maxExpansionDepth: 10,
    maxTotalExpansions: MAX_XML_ENTITY_EXPANSIONS,
    maxExpandedLength: 100_000,
    maxEntityCount: 100
  }
});

interface WorkbookSheetRef {
  name: string;
  sheetId: string;
  relationshipId: string;
}

interface RelationshipRef {
  id: string;
  target: string;
}

export async function loadXlsxWorkbook(source: PreviewSource, context?: PreviewLoadContext): Promise<ParsedWorkbook> {
  const format = normalizeFormat(context?.route?.sourceFormat ?? context?.descriptor.extension);
  if (format === 'csv') {
    return loadCsvWorkbook(source, context);
  }

  const bytes = await sourceToBytes(source, context);
  const zip = await JSZip.loadAsync(bytes);
  const warnings: string[] = [];
  const workbookXml = await readRequiredText(zip, 'xl/workbook.xml');
  const relsXml = await readRequiredText(zip, 'xl/_rels/workbook.xml.rels');
  const sharedStrings = await readSharedStrings(zip);
  const workbook = parser.parse(workbookXml) as Record<string, unknown>;
  const relationships = readRelationships(relsXml);
  const sheets = readWorkbookSheets(workbook);

  const parsedSheets: ParsedSheet[] = [];
  for (const sheet of sheets) {
    const relationship = relationships.find((entry) => entry.id === sheet.relationshipId);
    if (!relationship) {
      warnings.push(`Missing relationship for sheet ${sheet.name}.`);
      continue;
    }

    const sheetPath = resolveWorkbookTarget(relationship.target);
    const sheetXml = await zip.file(sheetPath)?.async('text');
    if (!sheetXml) {
      warnings.push(`Missing worksheet file for sheet ${sheet.name}.`);
      continue;
    }

    parsedSheets.push(readWorksheet(sheetXml, {
      id: sheet.sheetId,
      name: sheet.name,
      sharedStrings
    }));
  }

  return {
    sheets: parsedSheets,
    warnings
  };
}

export async function loadCsvWorkbook(source: PreviewSource, context?: PreviewLoadContext): Promise<ParsedWorkbook> {
  const text = await sourceToText(source, context);
  const records = parseCsv(text);
  const columnCount = records.reduce((max, row) => Math.max(max, row.length), 0);
  const rows: ParsedRow[] = records.map((record, rowIndex) => ({
    index: rowIndex + 1,
    cells: record.map((value, columnIndex) => ({
      ref: `${columnIndexToName(columnIndex + 1)}${rowIndex + 1}`,
      row: rowIndex + 1,
      column: columnIndex + 1,
      value
    }))
  }));

  return {
    sheets: [
      {
        id: 'csv',
        name: inferCsvSheetName(context?.descriptor.name),
        rows,
        columnCount,
        rowCount: rows.length
      }
    ],
    warnings: []
  };
}

async function sourceToBytes(source: PreviewSource, context?: PreviewLoadContext): Promise<Uint8Array> {
  if (typeof source === 'string') {
    const response = await fetch(source, {
      signal: context?.signal
    });
    if (!response.ok) {
      throw new Error(`Failed to load XLSX source: ${response.status} ${response.statusText}`.trim());
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  if (source instanceof Uint8Array) {
    return source;
  }
  if (ArrayBuffer.isView(source)) {
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  }
  if (source instanceof ArrayBuffer) {
    return new Uint8Array(source);
  }
  if (source instanceof Blob) {
    return new Uint8Array(await source.arrayBuffer());
  }
  return new Uint8Array();
}

async function sourceToText(source: PreviewSource, context?: PreviewLoadContext): Promise<string> {
  if (typeof source === 'string') {
    if (source.trimStart().toLowerCase().startsWith('data:')) {
      return readDataUrlText(source);
    }
    const response = await fetch(source, {
      signal: context?.signal
    });
    if (!response.ok) {
      throw new Error(`Failed to load CSV source: ${response.status} ${response.statusText}`.trim());
    }
    return response.text();
  }

  if (source instanceof Blob) {
    return source.text();
  }
  if (ArrayBuffer.isView(source)) {
    return new TextDecoder().decode(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
  }
  if (source instanceof ArrayBuffer) {
    return new TextDecoder().decode(source);
  }
  return String(source);
}

function readDataUrlText(source: string): string {
  const commaIndex = source.indexOf(',');
  if (commaIndex < 0) {
    return source;
  }
  const meta = source.slice(0, commaIndex).toLowerCase();
  const payload = source.slice(commaIndex + 1);
  if (meta.endsWith(';base64')) {
    return new TextDecoder().decode(Uint8Array.from(atob(payload), (char) => char.charCodeAt(0)));
  }
  return decodeURIComponent(payload);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let index = 0;
  let quoted = false;

  while (index < text.length) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      cell += char;
      index += 1;
      continue;
    }

    if (char === '"' && cell.length === 0) {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      row.push(cell);
      cell = '';
      index += 1;
      continue;
    }
    if (char === '\r' || char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (char === '\r' && text[index + 1] === '\n') {
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }
    cell += char;
    index += 1;
  }

  if (cell.length || row.length || text.length === 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

async function readRequiredText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) {
    throw new Error(`Invalid XLSX file: missing ${path}.`);
  }
  return file.async('text');
}

async function readSharedStrings(zip: JSZip): Promise<string[]> {
  const file = zip.file('xl/sharedStrings.xml');
  if (!file) {
    return [];
  }
  const xml = await file.async('text');
  const document = parser.parse(xml) as Record<string, unknown>;
  const items = toArray(readPath(document, ['sst', 'si']));
  return items.map(readSharedStringItem);
}

function readSharedStringItem(item: unknown): string {
  const text = readPath(item, ['t']);
  if (typeof text === 'string') {
    return text;
  }

  const runs = toArray(readPath(item, ['r']));
  if (runs.length) {
    return runs
      .map((run) => {
        const runText = readPath(run, ['t']);
        return typeof runText === 'string' ? runText : '';
      })
      .join('');
  }

  return '';
}

function readRelationships(xml: string): RelationshipRef[] {
  const document = parser.parse(xml) as Record<string, unknown>;
  return toArray(readPath(document, ['Relationships', 'Relationship']))
    .map((relationship) => ({
      id: String(readPath(relationship, ['Id']) ?? ''),
      target: String(readPath(relationship, ['Target']) ?? '')
    }))
    .filter((relationship) => relationship.id && relationship.target);
}

function readWorkbookSheets(workbook: Record<string, unknown>): WorkbookSheetRef[] {
  return toArray(readPath(workbook, ['workbook', 'sheets', 'sheet']))
    .map((sheet) => ({
      name: String(readPath(sheet, ['name']) ?? 'Sheet'),
      sheetId: String(readPath(sheet, ['sheetId']) ?? readPath(sheet, ['name']) ?? 'sheet'),
      relationshipId: String(readPath(sheet, ['r:id']) ?? '')
    }))
    .filter((sheet) => sheet.relationshipId);
}

function readWorksheet(
  xml: string,
  options: {
    id: string;
    name: string;
    sharedStrings: string[];
  }
): ParsedSheet {
  const document = parser.parse(xml) as Record<string, unknown>;
  const rowEntries = toArray(readPath(document, ['worksheet', 'sheetData', 'row']));
  const rows: ParsedRow[] = [];
  let maxColumn = 0;

  for (const rowEntry of rowEntries) {
    const rowIndex = Number(readPath(rowEntry, ['r']) ?? rows.length + 1);
    const cells = toArray(readPath(rowEntry, ['c']))
      .map((cellEntry) => readCell(cellEntry, options.sharedStrings))
      .filter((cell): cell is ParsedCell => cell != null);
    for (const cell of cells) {
      maxColumn = Math.max(maxColumn, cell.column);
    }
    rows.push({
      index: rowIndex,
      cells
    });
  }

  return {
    id: options.id,
    name: options.name,
    rows,
    columnCount: maxColumn,
    rowCount: rows.length ? Math.max(...rows.map((row) => row.index)) : 0
  };
}

function readCell(cellEntry: unknown, sharedStrings: string[]): ParsedCell | null {
  const ref = String(readPath(cellEntry, ['r']) ?? '');
  if (!ref) {
    return null;
  }

  const position = parseCellRef(ref);
  const valueType = String(readPath(cellEntry, ['t']) ?? '');
  const rawValue = readCellRawValue(cellEntry);
  const formula = readCellFormula(cellEntry);
  let value = rawValue ?? '';

  if (valueType === 's') {
    value = sharedStrings[Number(rawValue ?? '')] ?? '';
  } else if (valueType === 'b') {
    value = rawValue === '1' ? 'TRUE' : 'FALSE';
  } else if (valueType === 'inlineStr') {
    const inlineText = readPath(cellEntry, ['is', 't']);
    value = typeof inlineText === 'string' ? inlineText : '';
  }

  return {
    ref,
    row: position.row,
    column: position.column,
    value,
    ...(formula ? { formula, needsCalculation: rawValue == null } : {})
  };
}

function readCellRawValue(cellEntry: unknown): string | null {
  const value = readPath(cellEntry, ['v']);
  if (value == null) {
    return null;
  }
  return String(value);
}

function readCellFormula(cellEntry: unknown): string {
  const formula = readPath(cellEntry, ['f']);
  if (typeof formula === 'string') {
    return formula;
  }
  const text = readPath(formula, ['#text']);
  return typeof text === 'string' ? text : '';
}

export function resolveCellValue(sheet: ParsedSheet, cell: ParsedCell, resolving = new Set<string>()): string {
  if (!cell.formula || !cell.needsCalculation) {
    return cell.value;
  }
  if (resolving.has(cell.ref)) {
    return `=${cell.formula}`;
  }

  resolving.add(cell.ref);
  try {
    const result = new FormulaReader(cell.formula, (ref) => readFormulaCellNumber(sheet, ref, resolving)).read();
    cell.value = String(result);
  } catch {
    // ponytail: unsupported Excel functions stay visible as formulas; add a full engine only when preview parity requires it.
    cell.value = `=${cell.formula}`;
  } finally {
    resolving.delete(cell.ref);
    cell.needsCalculation = false;
  }
  return cell.value;
}

function readFormulaCellNumber(sheet: ParsedSheet, ref: string, resolving: Set<string>): number {
  const position = parseCellRef(ref.replace(/\$/g, ''));
  // ponytail: linear lookup is enough for preview-sized sheets; add an index if profiling shows it matters.
  const cell = sheet.rows.find((row) => row.index === position.row)?.cells.find((entry) => entry.column === position.column);
  if (!cell) {
    return 0;
  }
  const value = resolveCellValue(sheet, cell, resolving).trim();
  if (value === '') {
    return 0;
  }
  if (value.toUpperCase() === 'TRUE') {
    return 1;
  }
  if (value.toUpperCase() === 'FALSE') {
    return 0;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Formula reference ${ref} is not numeric.`);
  }
  return number;
}

class FormulaReader {
  private readonly tokens: string[];
  private index = 0;

  constructor(formula: string, private readonly readCell: (ref: string) => number) {
    this.tokens = tokenizeFormula(formula.replace(/^=/, '').trim());
  }

  read(): number {
    const value = this.readExpression();
    if (this.index !== this.tokens.length || Array.isArray(value) || !Number.isFinite(value)) {
      throw new Error('Unsupported formula.');
    }
    return value;
  }

  private readExpression(): FormulaValue {
    let value = this.readTerm();
    while (this.peek() === '+' || this.peek() === '-') {
      const operator = this.take();
      const right = this.readTerm();
      value = operator === '+' ? scalar(value) + scalar(right) : scalar(value) - scalar(right);
    }
    return value;
  }

  private readTerm(): FormulaValue {
    let value = this.readPower();
    while (this.peek() === '*' || this.peek() === '/') {
      const operator = this.take();
      const right = this.readPower();
      value = operator === '*' ? scalar(value) * scalar(right) : scalar(value) / scalar(right);
    }
    return value;
  }

  private readPower(): FormulaValue {
    let value = this.readUnary();
    if (this.peek() === '^') {
      this.take();
      value = scalar(value) ** scalar(this.readPower());
    }
    return value;
  }

  private readUnary(): FormulaValue {
    if (this.peek() === '+' || this.peek() === '-') {
      return (this.take() === '-' ? -1 : 1) * scalar(this.readUnary());
    }
    return this.readPrimary();
  }

  private readPrimary(): FormulaValue {
    const token = this.take();
    if (token === '(') {
      const value = this.readExpression();
      this.expect(')');
      return value;
    }
    if (/^(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?$/i.test(token)) {
      return Number(token);
    }
    if (/^\$?[A-Z]+\$?\d+$/i.test(token)) {
      if (this.peek() !== ':') {
        return this.readCell(token);
      }
      this.take();
      return this.readRange(token, this.take());
    }
    if (/^[A-Z][A-Z0-9_.]*$/i.test(token)) {
      if (token.toUpperCase() === 'TRUE') {
        return 1;
      }
      if (token.toUpperCase() === 'FALSE') {
        return 0;
      }
      if (token.toUpperCase() !== 'SUM') {
        throw new Error('Unsupported function.');
      }
      this.expect('(');
      const values: number[] = [];
      if (this.peek() !== ')') {
        do {
          const value = this.readExpression();
          values.push(...(Array.isArray(value) ? value : [value]));
        } while (this.peek() === ',' && Boolean(this.take()));
      }
      this.expect(')');
      return values.reduce((sum, value) => sum + value, 0);
    }
    throw new Error('Unsupported formula token.');
  }

  private readRange(firstRef: string, lastRef: string): number[] {
    if (!/^\$?[A-Z]+\$?\d+$/i.test(lastRef)) {
      throw new Error('Invalid range.');
    }
    const first = parseCellRef(firstRef.replace(/\$/g, ''));
    const last = parseCellRef(lastRef.replace(/\$/g, ''));
    const values: number[] = [];
    for (let row = Math.min(first.row, last.row); row <= Math.max(first.row, last.row); row += 1) {
      for (let column = Math.min(first.column, last.column); column <= Math.max(first.column, last.column); column += 1) {
        values.push(this.readCell(`${columnIndexToName(column)}${row}`));
      }
    }
    return values;
  }

  private peek(): string {
    return this.tokens[this.index] ?? '';
  }

  private take(): string {
    const token = this.tokens[this.index];
    if (!token) {
      throw new Error('Unexpected end of formula.');
    }
    this.index += 1;
    return token;
  }

  private expect(token: string): void {
    if (this.take() !== token) {
      throw new Error(`Expected ${token}.`);
    }
  }
}

type FormulaValue = number | number[];

function scalar(value: FormulaValue): number {
  if (Array.isArray(value)) {
    throw new Error('Range cannot be used as a scalar.');
  }
  return value;
}

function tokenizeFormula(formula: string): string[] {
  const tokens: string[] = [];
  const pattern = /\s*((?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?|\$?[A-Z]+\$?\d+|[A-Z][A-Z0-9_.]*|[()+\-*/^,:])/iy;
  let offset = 0;
  while (offset < formula.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(formula);
    if (!match) {
      throw new Error('Unsupported formula token.');
    }
    tokens.push(match[1] ?? '');
    offset = pattern.lastIndex;
  }
  return tokens;
}

function parseCellRef(ref: string): { row: number; column: number } {
  const match = /^([A-Z]+)(\d+)$/i.exec(ref);
  if (!match) {
    return {
      row: 1,
      column: 1
    };
  }
  return {
    column: columnNameToIndex(match[1] ?? 'A'),
    row: Number(match[2] ?? 1)
  };
}

function columnNameToIndex(name: string): number {
  let index = 0;
  for (const char of name.toUpperCase()) {
    index = index * 26 + char.charCodeAt(0) - 64;
  }
  return index;
}

function columnIndexToName(index: number): string {
  let cursor = index;
  let name = '';
  while (cursor > 0) {
    const remainder = (cursor - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    cursor = Math.floor((cursor - 1) / 26);
  }
  return name || 'A';
}

function inferCsvSheetName(name: string | undefined): string {
  const baseName = String(name ?? '').split(/[?#]/, 1)[0]?.split(/[\\/]/).pop() ?? '';
  return baseName.replace(/\.[^.]+$/, '') || 'CSV';
}

function normalizeFormat(format: string | undefined): string {
  return String(format ?? '').trim().replace(/^\./, '').toLowerCase();
}

function resolveWorkbookTarget(target: string): string {
  const normalized = target.replace(/\\/g, '/').replace(/^\//, '');
  return normalized.startsWith('xl/') ? normalized : `xl/${normalized}`;
}

function readPath(source: unknown, path: string[]): unknown {
  let cursor = source;
  for (const part of path) {
    if (!cursor || typeof cursor !== 'object') {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function toArray<T = unknown>(value: unknown): T[] {
  if (value == null) {
    return [];
  }
  return Array.isArray(value) ? (value as T[]) : [value as T];
}
