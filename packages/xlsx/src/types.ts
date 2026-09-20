export interface ParsedWorkbook {
  sheets: ParsedSheet[];
  warnings: string[];
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
}
