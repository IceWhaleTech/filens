import type { PreviewFontReference } from '@filens/core';

export interface ParsedWorkbook {
  sheets: ParsedSheet[];
  warnings: string[];
  fonts?: PreviewFontReference[];
}

export interface ParsedSheet {
  id: string;
  name: string;
  rows: ParsedRow[];
  columnCount: number;
  rowCount: number;
}

export interface ParsedRow {
  index: number;
  cells: ParsedCell[];
}

export interface ParsedCell {
  ref: string;
  row: number;
  column: number;
  value: string;
  formula?: string;
  needsCalculation?: boolean;
  font?: PreviewFontReference;
}
