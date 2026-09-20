import type { TableCell, TableItem, TextFrame } from '@filens/core';
import type { IworkArchiveIndex } from '../types';
import {
  asArray,
  asObject,
  buildTextFrameFromStorage,
  colorToHex,
  fillFromValue,
  getRecordValue,
  getRefId,
  lineFromValue,
  paddingFromValue,
  readField,
  resolveMergedStyle,
  verticalAlignFromValue
} from './helpers';

interface TableCellInfo {
  offset: number;
  recordEnd: number;
  keyOffset: number;
  cellType: number;
  styleKey: number;
  contentKey: number;
  formatKey: number;
  numberValue: number;
  hasNumber: boolean;
  usePreBnc: boolean;
}

interface TableFormatEntry {
  formatType?: number;
  decimalPlaces?: number;
  currencyCode?: string;
  negativeStyle?: number;
  showThousandsSeparator?: boolean;
  useAccountingStyle?: boolean;
  scaleFactor?: number;
  customFormatString?: string;
  dateTimeFormat?: string;
  suppressDateFormat?: boolean;
  suppressTimeFormat?: boolean;
  usesPlusSign?: boolean;
  boolTrueString?: string;
  boolFalseString?: string;
}

interface TableContentLookup {
  strings: Map<number, string>;
  rich: Map<number, unknown>;
  styles: Map<number, number>;
  formats: Map<number, TableFormatEntry>;
  formatsPreBnc: Map<number, TableFormatEntry>;
  controlMenus: string[][];
}

interface TableMergeSpan {
  rowSpan: number;
  colSpan: number;
}

interface TableMergeMap {
  starts: Map<string, TableMergeSpan>;
  covered: Set<string>;
}

interface TableHeaderStyles {
  cellStyles: Map<number, number>;
  textStyles: Map<number, number>;
}

type TableBorderSide = NonNullable<TableCell['borders']>['top'];
type ResolvedTableBorderSide = TableBorderSide | false | undefined;
type ResolvedTableStyleBorders = Record<'top' | 'right' | 'bottom' | 'left', ResolvedTableBorderSide>;

interface TableStyleDefaults {
  bodyTextStyle?: unknown;
  headerRowTextStyle?: unknown;
  headerColumnTextStyle?: unknown;
  footerRowTextStyle?: unknown;
  bodyCellStyle?: number;
  headerRowStyle?: number;
  headerColumnStyle?: number;
  footerRowStyle?: number;
  bandedRows?: boolean;
  bandedFill?: TableCell['fill'];
  bodyHorizontalStroke?: ResolvedTableBorderSide;
  bodyVerticalStroke?: ResolvedTableBorderSide;
  bodyHorizontalBorderStroke?: ResolvedTableBorderSide;
  bodyVerticalBorderStroke?: ResolvedTableBorderSide;
  headerRowHorizontalStroke?: ResolvedTableBorderSide;
  headerRowVerticalStroke?: ResolvedTableBorderSide;
  headerRowBorderStroke?: ResolvedTableBorderSide;
  headerRowSeparatorStroke?: ResolvedTableBorderSide;
  headerColumnHorizontalStroke?: ResolvedTableBorderSide;
  headerColumnVerticalStroke?: ResolvedTableBorderSide;
  headerColumnBorderStroke?: ResolvedTableBorderSide;
  headerColumnSeparatorStroke?: ResolvedTableBorderSide;
  footerRowHorizontalStroke?: ResolvedTableBorderSide;
  footerRowVerticalStroke?: ResolvedTableBorderSide;
  footerRowBorderStroke?: ResolvedTableBorderSide;
  footerRowSeparatorStroke?: ResolvedTableBorderSide;
  vStrokesVisible?: boolean;
  hStrokesVisible?: boolean;
  hrSeparatorVisible?: boolean;
  hcSeparatorVisible?: boolean;
  footerSeparatorVisible?: boolean;
  tableBorderVisible?: boolean;
  tableHeaderBorderVisible?: boolean;
  tableHcDividerVisible?: boolean;
  tableHrDividerVisible?: boolean;
  tableFooterDividerVisible?: boolean;
  presetVisibleMask?: number;
}

interface TableUidIndexMap {
  rows: Map<string, number>;
  columns: Map<string, number>;
}

export function buildTableItem(
  archive: IworkArchiveIndex,
  tableDrawable: Record<string, unknown>,
  transform: TableItem['transform'],
  order: number,
  groupPath: string[] = []
): TableItem | undefined {
  const tableModel = getRecordValue<Record<string, unknown>>(archive, readField(tableDrawable, ['tableModel', 'table_model']));
  if (!tableModel) {
    return undefined;
  }

  const baseDataStore = asObject(readField(tableModel, ['baseDataStore', 'base_data_store']));
  const tileStorage = asObject(readField(baseDataStore, ['tiles']));
  const tileRefs = asArray<Record<string, unknown>>(readField(tileStorage, ['tiles']));
  if (!tileRefs.length) {
    return undefined;
  }

  const lookup = buildContentLookup(archive, baseDataStore);
  const headerRowCount = Number(readField<number>(tableModel, ['numberOfHeaderRows', 'number_of_header_rows']) ?? 0);
  const headerColumnCount = Number(readField<number>(tableModel, ['numberOfHeaderColumns', 'number_of_header_columns']) ?? 0);
  const footerRowCount = Number(readField<number>(tableModel, ['numberOfFooterRows', 'number_of_footer_rows']) ?? 0);
  const rowHeaderStyles = resolveHeaderStyles(archive, readField(baseDataStore, ['rowHeaders', 'row_headers']));
  const columnHeaderStyles = resolveHeaderStyles(archive, readField(baseDataStore, ['columnHeaders', 'column_headers']));
  const styleDefaults = resolveTableStyleDefaults(archive, tableModel);
  const columnWidths = resolveColumnWidths(archive, tableModel, baseDataStore);
  const rowHeights = resolveRowHeights(archive, tableModel, baseDataStore);
  const uidIndexMap = resolveTableUidIndexMap(archive, tableModel);
  const hiddenColumns = mergeIndexes(
    resolveHiddenHeaderIndexes(archive, readField(baseDataStore, ['columnHeaders', 'column_headers'])),
    resolveHiddenStateIndexes(tableModel, uidIndexMap, 'column')
  );
  const hiddenRows = mergeIndexes(
    resolveHiddenHeaderIndexes(archive, readField(baseDataStore, ['rowHeaders', 'row_headers'])),
    resolveHiddenStateIndexes(tableModel, uidIndexMap, 'row')
  );
  const mergeMap = resolveTableMergeMap(archive, baseDataStore);
  const cells: TableCell[] = [];
  const tableRows: Array<{ row: number; rowInfo: Record<string, unknown> }> = [];

  let rowIndexBase = 0;
  for (const tileRef of tileRefs) {
    const tile = getRecordValue<Record<string, unknown>>(archive, readField(tileRef, ['tile']));
    if (!tile) {
      continue;
    }

    const rowInfos = asArray<Record<string, unknown>>(readField(tile, ['rowInfos', 'row_infos']));
    for (const rowInfo of rowInfos) {
      const localRow = Number(readField<number>(rowInfo, ['tileRowIndex', 'tile_row_index']) ?? 0);
      const row = rowIndexBase + localRow;
      tableRows.push({ row, rowInfo });
    }

    rowIndexBase += rowInfos.length;
  }

  tableRows.sort((left, right) => left.row - right.row);
  const columnHeaderTexts = resolveColumnHeaderTexts(archive, tableRows, lookup, headerRowCount, columnWidths.length);

  for (const tableRow of tableRows) {
    const row = tableRow.row;
    const rowInfo = tableRow.rowInfo;
    const cellCount = Number(readField<number>(rowInfo, ['cellCount', 'cell_count']) ?? columnWidths.length);
    for (let column = 0; column < cellCount; column += 1) {
      const cellInfo = parseTableCell(archive.type, rowInfo, column);
      const cellKey = createCellPositionKey(row, column);
      const mergeSpan = mergeMap.starts.get(cellKey);
      const isMergedContinuation = mergeMap.covered.has(cellKey);
      if (!hasRenderablePayload(cellInfo) && !mergeSpan && !isMergedContinuation) {
        continue;
      }

      const cellStyleRefId =
        lookup.styles.get(cellInfo.styleKey) ??
        rowHeaderStyles.cellStyles.get(row) ??
        columnHeaderStyles.cellStyles.get(column) ??
        resolveDefaultCellStyleRefId(
          tableModel,
          styleDefaults,
          row,
          column,
          rowHeights.length,
          headerRowCount,
          headerColumnCount,
          footerRowCount
        );
      const cellStyle = resolveMergedStyle(archive, cellStyleRefId);
      const cellProps = asObject(readField(cellStyle, ['cellProperties', 'cell_properties']));
      const cellFill = fillFromValue(readField(cellProps, ['cellFill', 'cell_fill']));
      const textFrame = resolveTableCellTextFrame(
        archive,
        cellInfo,
        lookup,
        rowHeaderStyles.textStyles.get(row) ??
          columnHeaderStyles.textStyles.get(column) ??
          resolveDefaultTextStyleRefId(
            tableModel,
            styleDefaults,
            row,
            column,
            rowHeights.length,
            headerRowCount,
            headerColumnCount,
            footerRowCount
        ),
        paddingFromValue(readField(cellProps, ['padding']), 4),
        verticalAlignFromValue(readField(cellProps, ['verticalAlignment', 'vertical_alignment'])),
        resolveCellTextWrap(cellProps),
        columnHeaderTexts[column] ?? ''
      );

      cells.push({
        row,
        column,
        rowSpan: mergeSpan?.rowSpan ?? 1,
        colSpan: mergeSpan?.colSpan ?? 1,
        isMergedContinuation,
        fill: resolveTableCellFill(cellFill, styleDefaults, row, headerRowCount, footerRowCount, rowHeights.length),
        borders: createDefaultBorders(cellStyle, styleDefaults, row, column, rowHeights.length, columnWidths.length, headerRowCount, headerColumnCount, footerRowCount),
        textFrame
      });
    }
  }

  return {
    id: `table-${order}-${transform.x}-${transform.y}`,
    kind: 'table',
    name: String(readField<string>(tableModel, ['tableName', 'table_name']) ?? 'Table'),
    transform,
    fill: {
      type: 'none'
    },
    order,
    groupPath,
    columns: columnWidths,
    rows: rowHeights,
    hiddenColumns,
    hiddenRows,
    cells
  };
}

function resolveTableMergeMap(
  archive: IworkArchiveIndex,
  baseDataStore: Record<string, unknown> | undefined
): TableMergeMap {
  const mergeMap: TableMergeMap = {
    starts: new Map<string, TableMergeSpan>(),
    covered: new Set<string>()
  };

  const mergeRegionMap = getRecordValue<Record<string, unknown>>(archive, readField(baseDataStore, ['mergeRegionMap', 'merge_region_map']));
  if (!mergeRegionMap) {
    return mergeMap;
  }

  const cellRanges = asArray<Record<string, unknown>>(readField(mergeRegionMap, ['cellRange', 'cell_range']));
  for (const cellRange of cellRanges) {
    const resolved = resolveMergeCellRange(cellRange);
    if (!resolved) {
      continue;
    }

    const { row, column, rowSpan, colSpan } = resolved;
    const startKey = createCellPositionKey(row, column);
    mergeMap.starts.set(startKey, { rowSpan, colSpan });

    for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
      for (let columnOffset = 0; columnOffset < colSpan; columnOffset += 1) {
        if (rowOffset === 0 && columnOffset === 0) {
          continue;
        }
        mergeMap.covered.add(createCellPositionKey(row + rowOffset, column + columnOffset));
      }
    }
  }

  return mergeMap;
}

function resolveMergeCellRange(cellRange: Record<string, unknown>): { row: number; column: number; rowSpan: number; colSpan: number } | undefined {
  const origin = asObject(readField(cellRange, ['origin']));
  const size = asObject(readField(cellRange, ['size']));
  if (!origin || !size) {
    return undefined;
  }

  const coordinate = readPackedCellCoordinate(origin) ?? readExpandedCellCoordinate(asObject(readField(origin, ['expandedCoord', 'expanded_coord'])));
  if (!coordinate) {
    return undefined;
  }

  const resolvedSize = readTableSize(size);
  if (!resolvedSize || resolvedSize.rowSpan <= 0 || resolvedSize.colSpan <= 0) {
    return undefined;
  }

  return {
    row: coordinate.row,
    column: coordinate.column,
    rowSpan: resolvedSize.rowSpan,
    colSpan: resolvedSize.colSpan
  };
}

function readPackedCellCoordinate(value: Record<string, unknown>): { row: number; column: number } | undefined {
  const packed = readField<number>(value, ['packedData', 'packed_data']);
  if (typeof packed !== 'number' || !Number.isFinite(packed)) {
    return readExpandedCellCoordinate(value);
  }

  return {
    row: packed >>> 16,
    column: packed & 0xffff
  };
}

function readExpandedCellCoordinate(value: Record<string, unknown> | undefined): { row: number; column: number } | undefined {
  const row = readField<number>(value, ['row']);
  const column = readField<number>(value, ['column']);
  if (typeof row !== 'number' || !Number.isFinite(row) || typeof column !== 'number' || !Number.isFinite(column)) {
    return undefined;
  }

  return {
    row,
    column
  };
}

function readTableSize(value: Record<string, unknown>): { rowSpan: number; colSpan: number } | undefined {
  const directRows = readField<number>(value, ['numRows', 'num_rows']);
  const directColumns = readField<number>(value, ['numColumns', 'num_columns']);
  if (
    typeof directRows === 'number' &&
    Number.isFinite(directRows) &&
    typeof directColumns === 'number' &&
    Number.isFinite(directColumns)
  ) {
    return {
      rowSpan: directRows,
      colSpan: directColumns
    };
  }

  const packed = readField<number>(value, ['packedData', 'packed_data']);
  if (typeof packed !== 'number' || !Number.isFinite(packed)) {
    return undefined;
  }

  return {
    rowSpan: packed >>> 16,
    colSpan: packed & 0xffff
  };
}

function createCellPositionKey(row: number, column: number): string {
  return `${row}:${column}`;
}

function buildContentLookup(archive: IworkArchiveIndex, baseDataStore: Record<string, unknown> | undefined): TableContentLookup {
  return {
    strings: createStringLookup(archive, readField(baseDataStore, ['stringTable', 'string_table'])),
    rich: createRichLookup(archive, readField(baseDataStore, ['richTextTable', 'rich_text_table'])),
    styles: createStyleLookup(archive, readField(baseDataStore, ['styleTable', 'style_table'])),
    formats: createFormatLookup(archive, readField(baseDataStore, ['formatTable', 'format_table'])),
    formatsPreBnc: createFormatLookup(archive, readField(baseDataStore, ['formatTablePreBnc', 'format_table_pre_bnc'])),
    controlMenus: createControlMenus(archive, readField(baseDataStore, ['multipleChoiceListFormatTable', 'multiple_choice_list_format_table']))
  };
}

function createStringLookup(archive: IworkArchiveIndex, ref: unknown): Map<number, string> {
  const result = new Map<number, string>();
  const entries = resolveTableDataListEntries(archive, ref);
  for (const entry of entries) {
    const key = Number(readField<number>(entry, ['key']) ?? 0);
    const value = readField<string>(entry, ['string']);
    if (key && typeof value === 'string') {
      result.set(key, value);
    }
  }
  return result;
}

function createRichLookup(archive: IworkArchiveIndex, ref: unknown): Map<number, unknown> {
  const result = new Map<number, unknown>();
  const entries = resolveTableDataListEntries(archive, ref);
  for (const entry of entries) {
    const key = Number(readField<number>(entry, ['key']) ?? 0);
    const payloadRef = readField(entry, ['richTextPayload', 'rich_text_payload']);
    if (key && payloadRef) {
      result.set(key, payloadRef);
    }
  }
  return result;
}

function createStyleLookup(archive: IworkArchiveIndex, ref: unknown): Map<number, number> {
  const result = new Map<number, number>();
  const entries = resolveTableDataListEntries(archive, ref);
  for (const entry of entries) {
    const key = Number(readField<number>(entry, ['key']) ?? 0);
    const refId = getRefId(readField(entry, ['reference']));
    if (key && refId) {
      result.set(key, refId);
    }
  }
  return result;
}

function createFormatLookup(archive: IworkArchiveIndex, ref: unknown): Map<number, TableFormatEntry> {
  const result = new Map<number, TableFormatEntry>();
  const entries = resolveTableDataListEntries(archive, ref);
  for (const entry of entries) {
    const key = Number(readField<number>(entry, ['key']) ?? 0);
    const format = asObject(readField(entry, ['format']));
    if (!key || !format) {
      continue;
    }
    result.set(key, {
      formatType: readOptionalNumber(format, ['formatType', 'format_type']),
      decimalPlaces: readOptionalNumber(format, ['decimalPlaces', 'decimal_places']),
      currencyCode: readOptionalString(format, ['currencyCode', 'currency_code']),
      negativeStyle: readOptionalNumber(format, ['negativeStyle', 'negative_style']),
      showThousandsSeparator: readOptionalBoolean(format, ['showThousandsSeparator', 'show_thousands_separator']),
      useAccountingStyle: readOptionalBoolean(format, ['useAccountingStyle', 'use_accounting_style']),
      scaleFactor: readOptionalNumber(format, ['scaleFactor', 'scale_factor']),
      customFormatString: readOptionalString(format, ['customFormatString', 'custom_format_string']),
      dateTimeFormat: readOptionalString(format, ['dateTimeFormat', 'date_time_format']),
      suppressDateFormat: readOptionalBoolean(format, ['suppressDateFormat', 'suppress_date_format']),
      suppressTimeFormat: readOptionalBoolean(format, ['suppressTimeFormat', 'suppress_time_format']),
      usesPlusSign: readOptionalBoolean(format, ['usesPlusSign', 'uses_plus_sign']),
      boolTrueString: readOptionalString(format, ['boolTrueString', 'bool_true_string']),
      boolFalseString: readOptionalString(format, ['boolFalseString', 'bool_false_string'])
    });
  }
  return result;
}

function createControlMenus(archive: IworkArchiveIndex, ref: unknown): string[][] {
  const menus: string[][] = [];
  const entries = resolveTableDataListEntries(archive, ref);
  for (const entry of entries) {
    const popup = getRecordValue<Record<string, unknown>>(archive, readField(entry, ['reference']));
    if (!popup) {
      continue;
    }

    const items = asArray<Record<string, unknown>>(readField(popup, ['item']));
    if (items.length) {
      const menu = items.map((item) => resolvePopupMenuItemText(item));
      if (menu.some((text) => text.length > 0)) {
        menus.push(menu);
      }
      continue;
    }

    const tsceItems = asArray<Record<string, unknown>>(readField(popup, ['tsceItem']));
    if (tsceItems.length) {
      const menu = tsceItems.map((item) => resolvePopupMenuTsceText(item));
      if (menu.some((text) => text.length > 0)) {
        menus.push(menu);
      }
    }
  }
  return menus;
}

function resolveTableDataListEntries(archive: IworkArchiveIndex, ref: unknown): Array<Record<string, unknown>> {
  const list = getRecordValue<Record<string, unknown>>(archive, ref);
  if (!list) {
    return [];
  }
  const entries = asArray<Record<string, unknown>>(readField(list, ['entries']));
  const segmentRefs = asArray<Record<string, unknown>>(readField(list, ['segments']));
  const segmentedEntries = segmentRefs.flatMap((segmentRef) => {
    const segment = getRecordValue<Record<string, unknown>>(archive, segmentRef);
    return asArray<Record<string, unknown>>(readField(segment, ['entries']));
  });
  return [...entries, ...segmentedEntries];
}

function resolveColumnWidths(
  archive: IworkArchiveIndex,
  tableModel: Record<string, unknown>,
  baseDataStore: Record<string, unknown> | undefined
): number[] {
  const fallbackWidth = positiveTableTrackSize(readField<number>(tableModel, ['defaultColumnWidth', 'default_column_width']), 72);
  const total = Number(readField<number>(tableModel, ['numberOfColumns', 'number_of_columns']) ?? 0);
  const headers = resolveHeaderStorage(archive, readField(baseDataStore, ['columnHeaders', 'column_headers']));
  if (!headers.length) {
    return Array.from({ length: total }, () => fallbackWidth);
  }

  const widths = Array.from({ length: total }, () => fallbackWidth);
  for (const header of headers) {
    const index = Number(readField<number>(header, ['index']) ?? -1);
    const span = resolveHeaderCellSpan(header);
    if (index >= 0 && index < widths.length) {
      const width = positiveTableTrackSize(readField<number>(header, ['size']), fallbackWidth);
      for (let offset = 0; offset < span && index + offset < widths.length; offset += 1) {
        widths[index + offset] = width;
      }
    }
  }
  return widths;
}

function resolveRowHeights(
  archive: IworkArchiveIndex,
  tableModel: Record<string, unknown>,
  baseDataStore: Record<string, unknown> | undefined
): number[] {
  const fallbackHeight = positiveTableTrackSize(readField<number>(tableModel, ['defaultRowHeight', 'default_row_height']), 22);
  const total = Number(readField<number>(tableModel, ['numberOfRows', 'number_of_rows']) ?? 0);
  const rowHeadersRef = readField(baseDataStore, ['rowHeaders', 'row_headers']);
  const rowHeaders = resolveHeaderStorage(archive, rowHeadersRef);
  if (!rowHeaders.length) {
    return Array.from({ length: total }, () => fallbackHeight);
  }

  const heights = Array.from({ length: total }, () => fallbackHeight);
  for (const header of rowHeaders) {
    const index = Number(readField<number>(header, ['index']) ?? -1);
    const span = resolveHeaderCellSpan(header);
    if (index >= 0 && index < heights.length) {
      const height = positiveTableTrackSize(readField<number>(header, ['size']), fallbackHeight);
      for (let offset = 0; offset < span && index + offset < heights.length; offset += 1) {
        heights[index + offset] = height;
      }
    }
  }
  return heights;
}

function positiveTableTrackSize(value: unknown, fallback: number): number {
  const size = Number(value);
  return Number.isFinite(size) && size > 0 ? size : fallback;
}

function resolveHeaderStorage(archive: IworkArchiveIndex, headersRef: unknown): Array<Record<string, unknown>> {
  const headerStorage = getRecordValue<Record<string, unknown>>(archive, headersRef) ?? asObject(headersRef);
  if (!headerStorage) {
    return [];
  }
  const directHeaders = asArray<Record<string, unknown>>(readField(headerStorage, ['headers']));
  if (directHeaders.length) {
    return directHeaders;
  }
  const buckets = asArray<Record<string, unknown>>(readField(headerStorage, ['buckets']));
  return buckets.flatMap((bucketRef) => {
    const bucket = getRecordValue<Record<string, unknown>>(archive, bucketRef);
    return asArray<Record<string, unknown>>(readField(bucket, ['headers']));
  });
}

function resolveHeaderStyles(archive: IworkArchiveIndex, headersRef: unknown): TableHeaderStyles {
  const cellStyles = new Map<number, number>();
  const textStyles = new Map<number, number>();
  for (const header of resolveHeaderStorage(archive, headersRef)) {
    const index = Number(readField<number>(header, ['index']) ?? -1);
    if (index < 0) {
      continue;
    }
    const span = resolveHeaderCellSpan(header);
    const cellStyleRefId = getRefId(readField(header, ['cellStyle', 'cell_style']));
    if (cellStyleRefId) {
      for (let offset = 0; offset < span; offset += 1) {
        cellStyles.set(index + offset, cellStyleRefId);
      }
    }
    const textStyleRefId = getRefId(readField(header, ['textStyle', 'text_style']));
    if (textStyleRefId) {
      for (let offset = 0; offset < span; offset += 1) {
        textStyles.set(index + offset, textStyleRefId);
      }
    }
  }
  return {
    cellStyles,
    textStyles
  };
}

function resolveHeaderCellSpan(header: Record<string, unknown>): number {
  const span = Number(readField<number>(header, ['numberOfCells', 'number_of_cells']) ?? 1);
  return Number.isFinite(span) && span > 0 ? Math.trunc(span) : 1;
}

function resolveHiddenHeaderIndexes(archive: IworkArchiveIndex, headersRef: unknown): number[] | undefined {
  const hiddenIndexes = new Set<number>();
  for (const header of resolveHeaderStorage(archive, headersRef)) {
    const index = Number(readField<number>(header, ['index']) ?? -1);
    if (index < 0 || !isHeaderHidden(header)) {
      continue;
    }

    const span = resolveHeaderCellSpan(header);
    for (let offset = 0; offset < span; offset += 1) {
      hiddenIndexes.add(index + offset);
    }
  }

  return hiddenIndexes.size ? [...hiddenIndexes].sort((left, right) => left - right) : undefined;
}

function isHeaderHidden(header: Record<string, unknown>): boolean {
  const hidingState = readField<number>(header, ['hidingState', 'hiding_state']);
  return typeof hidingState === 'number' && Number.isFinite(hidingState) && hidingState !== 0;
}

function resolveTableUidIndexMap(archive: IworkArchiveIndex, tableModel: Record<string, unknown>): TableUidIndexMap {
  const uidList = getRecordValue<Record<string, unknown>>(archive, readField(tableModel, ['baseColumnRowUids', 'base_column_row_uids']));
  return {
    rows: createUidLookup(resolveCellUidListUids(uidList, 'row')),
    columns: createUidLookup(resolveCellUidListUids(uidList, 'column'))
  };
}

function resolveCellUidListUids(cellUidList: Record<string, unknown> | undefined, axis: 'row' | 'column'): string[] {
  const directUids = readUuidList(readField(cellUidList, [axis === 'row' ? 'rowUids' : 'columnUids', axis === 'row' ? 'row_uids' : 'column_uids']));
  if (directUids.length) {
    return directUids;
  }

  const lookupList = asObject(readField(cellUidList, ['uncompressedLookupList', 'uncompressed_lookup_list']));
  const axisLookup = asObject(readField(lookupList, [axis === 'row' ? 'rowUids' : 'columnUids', axis === 'row' ? 'row_uids' : 'column_uids']));
  const lookupUids = readUuidList(readField(axisLookup, ['uuids']));
  const compressedIndexes = asArray<number>(
    readField(cellUidList, [
      axis === 'row' ? 'compressedRowIndexes' : 'compressedColumnIndexes',
      axis === 'row' ? 'compressed_row_indexes' : 'compressed_column_indexes'
    ])
  );
  if (!compressedIndexes.length) {
    return lookupUids;
  }

  return compressedIndexes
    .map((index) => lookupUids[index])
    .filter((uid): uid is string => Boolean(uid));
}

function createUidLookup(uids: string[]): Map<string, number> {
  const lookup = new Map<string, number>();
  uids.forEach((uid, index) => {
    if (uid) {
      lookup.set(uid, index);
    }
  });
  return lookup;
}

function resolveHiddenStateIndexes(
  tableModel: Record<string, unknown>,
  uidIndexMap: TableUidIndexMap,
  axis: 'row' | 'column'
): number[] | undefined {
  const hiddenStatesOwner = asObject(readField(tableModel, ['hiddenStatesOwner', 'hidden_states_owner']));
  if (!hiddenStatesOwner) {
    return undefined;
  }

  const hiddenIndexes = new Set<number>();
  const hiddenStates = asArray<Record<string, unknown>>(readField(hiddenStatesOwner, ['hiddenStates', 'hidden_states']));
  for (const hiddenState of hiddenStates) {
    const extent = asObject(
      readField(hiddenState, [
        axis === 'row' ? 'rowHiddenStateExtent' : 'columnHiddenStateExtent',
        axis === 'row' ? 'row_hidden_state_extent' : 'column_hidden_state_extent'
      ])
    );
    if (!extent) {
      continue;
    }

    collectHiddenRowColumnStates(hiddenIndexes, uidIndexMap[axis === 'row' ? 'rows' : 'columns'], readField(extent, ['baseHiddenStates', 'base_hidden_states']));
    collectHiddenRowColumnStates(
      hiddenIndexes,
      uidIndexMap[axis === 'row' ? 'rows' : 'columns'],
      readField(extent, ['summaryHiddenStates', 'summary_hidden_states'])
    );
  }

  return hiddenIndexes.size ? [...hiddenIndexes].sort((left, right) => left - right) : undefined;
}

function collectHiddenRowColumnStates(hiddenIndexes: Set<number>, uidIndexes: Map<string, number>, statesValue: unknown): void {
  for (const state of asArray<Record<string, unknown>>(statesValue)) {
    if (!isHiddenStateActive(state)) {
      continue;
    }

    const uid = uuidToKey(readField(state, ['rowOrColumnUid', 'row_or_column_uid']));
    if (!uid) {
      continue;
    }

    const index = uidIndexes.get(uid);
    if (index != null) {
      hiddenIndexes.add(index);
    }
  }
}

function isHiddenStateActive(state: Record<string, unknown>): boolean {
  return Boolean(
    readField(state, ['userHidden', 'user_hidden']) ||
      readField(state, ['filtered']) ||
      readField(state, ['pivotHidden', 'pivot_hidden'])
  );
}

function readUuidList(value: unknown): string[] {
  return asArray<unknown>(value)
    .map((entry) => uuidToKey(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function uuidToKey(value: unknown): string | undefined {
  const uuid = asObject(value);
  if (!uuid) {
    return undefined;
  }

  const lower = readField<number | string>(uuid, ['lower']);
  const upper = readField<number | string>(uuid, ['upper']);
  if (lower == null && upper == null) {
    return undefined;
  }
  return `${String(upper ?? 0)}:${String(lower ?? 0)}`;
}

function mergeIndexes(...indexes: Array<number[] | undefined>): number[] | undefined {
  const merged = new Set<number>();
  for (const values of indexes) {
    for (const value of values ?? []) {
      merged.add(value);
    }
  }
  return merged.size ? [...merged].sort((left, right) => left - right) : undefined;
}

function resolveColumnHeaderTexts(
  archive: IworkArchiveIndex,
  tableRows: Array<{ row: number; rowInfo: Record<string, unknown> }>,
  lookup: TableContentLookup,
  headerRowCount: number,
  columnCount: number
): string[] {
  const headers = Array.from({ length: columnCount }, () => '');
  if (headerRowCount <= 0) {
    return headers;
  }

  for (const tableRow of tableRows) {
    if (tableRow.row >= headerRowCount) {
      break;
    }
    const cellCount = Number(readField<number>(tableRow.rowInfo, ['cellCount', 'cell_count']) ?? columnCount);
    for (let column = 0; column < Math.min(cellCount, columnCount); column += 1) {
      if (headers[column]) {
        continue;
      }
      const cellInfo = parseTableCell(archive.type, tableRow.rowInfo, column);
      const text = resolveCellPlainText(archive, cellInfo, lookup, '');
      if (text.trim().length) {
        headers[column] = text;
      }
    }
  }

  return headers;
}

function createDefaultBorders(
  styleLike: unknown,
  styleDefaults: TableStyleDefaults,
  row: number,
  column: number,
  rowCount: number,
  columnCount: number,
  headerRowCount: number,
  headerColumnCount: number,
  footerRowCount: number
): TableCell['borders'] {
  const style = asObject(styleLike);
  const cellProps = asObject(readField(style, ['cellProperties', 'cell_properties']));
  const fallbackStroke = lineFromValue(readField(cellProps, ['stroke'])) ?? {
    color: colorToHex(undefined, '#cbd5e1'),
    width: 1
  };
  const tableStyleBorders = resolveTableStyleBorders(styleDefaults, row, column, rowCount, columnCount, headerRowCount, headerColumnCount, footerRowCount);
  const borders: TableCell['borders'] = {
    top: resolveBorderSide(readCellBorderStroke(cellProps, 'top'), tableStyleBorders.top, fallbackStroke),
    right: resolveBorderSide(readCellBorderStroke(cellProps, 'right'), tableStyleBorders.right, fallbackStroke),
    bottom: resolveBorderSide(readCellBorderStroke(cellProps, 'bottom'), tableStyleBorders.bottom, fallbackStroke),
    left: resolveBorderSide(readCellBorderStroke(cellProps, 'left'), tableStyleBorders.left, fallbackStroke)
  };
  return Object.values(borders).some(Boolean) ? borders : undefined;
}

function resolveBorderSide(
  local: ResolvedTableBorderSide,
  tableStyle: ResolvedTableBorderSide,
  fallback: TableBorderSide
): TableBorderSide {
  if (local === false) {
    return undefined;
  }
  if (local) {
    return local;
  }
  if (tableStyle === false) {
    return undefined;
  }
  return tableStyle ?? fallback;
}

function resolveTableStyleBorders(
  styleDefaults: TableStyleDefaults,
  row: number,
  column: number,
  rowCount: number,
  columnCount: number,
  headerRowCount: number,
  headerColumnCount: number,
  footerRowCount: number
): ResolvedTableStyleBorders {
  const isHeaderRow = row < headerRowCount;
  const isHeaderColumn = column < headerColumnCount;
  const isFooter = footerRowCount > 0 && row >= rowCount - footerRowCount;
  if (isHeaderRow) {
    return {
      top: visibleStroke(
        row === 0 ? (styleDefaults.headerRowBorderStroke ?? styleDefaults.headerRowHorizontalStroke) : styleDefaults.headerRowHorizontalStroke,
        styleDefaults.hStrokesVisible,
        row === 0 ? styleDefaults.tableHeaderBorderVisible : undefined,
        row === 0 ? presetBorderVisible(styleDefaults.presetVisibleMask, 'top') : undefined
      ),
      right: visibleStroke(
        column === columnCount - 1 ? (styleDefaults.headerRowBorderStroke ?? styleDefaults.headerRowVerticalStroke) : styleDefaults.headerRowVerticalStroke,
        styleDefaults.vStrokesVisible,
        column === columnCount - 1 ? styleDefaults.tableHeaderBorderVisible : undefined,
        column === columnCount - 1 ? presetBorderVisible(styleDefaults.presetVisibleMask, 'right') : presetBorderVisible(styleDefaults.presetVisibleMask, 'insideV')
      ),
      bottom:
        row === headerRowCount - 1
          ? visibleStroke(
              styleDefaults.headerRowSeparatorStroke ?? styleDefaults.headerRowBorderStroke ?? styleDefaults.headerRowHorizontalStroke,
              styleDefaults.hStrokesVisible,
              styleDefaults.hrSeparatorVisible,
              styleDefaults.tableHrDividerVisible,
              presetBorderVisible(styleDefaults.presetVisibleMask, 'insideH')
            )
          : visibleStroke(styleDefaults.headerRowHorizontalStroke, styleDefaults.hStrokesVisible, presetBorderVisible(styleDefaults.presetVisibleMask, 'insideH')),
      left: visibleStroke(
        column === 0 ? (styleDefaults.headerRowBorderStroke ?? styleDefaults.headerRowVerticalStroke) : styleDefaults.headerRowVerticalStroke,
        styleDefaults.vStrokesVisible,
        column === 0 ? styleDefaults.tableHeaderBorderVisible : undefined,
        column === 0 ? presetBorderVisible(styleDefaults.presetVisibleMask, 'left') : presetBorderVisible(styleDefaults.presetVisibleMask, 'insideV')
      )
    };
  }

  if (isFooter) {
    return {
      top:
        row === rowCount - footerRowCount
          ? visibleStroke(
              styleDefaults.footerRowSeparatorStroke ?? styleDefaults.footerRowBorderStroke ?? styleDefaults.footerRowHorizontalStroke,
              styleDefaults.hStrokesVisible,
              styleDefaults.footerSeparatorVisible,
              styleDefaults.tableFooterDividerVisible,
              presetBorderVisible(styleDefaults.presetVisibleMask, 'insideH')
            )
          : visibleStroke(styleDefaults.footerRowHorizontalStroke, styleDefaults.hStrokesVisible, presetBorderVisible(styleDefaults.presetVisibleMask, 'insideH')),
      right: visibleStroke(
        column === columnCount - 1 ? (styleDefaults.footerRowBorderStroke ?? styleDefaults.footerRowVerticalStroke) : styleDefaults.footerRowVerticalStroke,
        styleDefaults.vStrokesVisible,
        column === columnCount - 1 ? styleDefaults.tableBorderVisible : undefined,
        column === columnCount - 1 ? presetBorderVisible(styleDefaults.presetVisibleMask, 'right') : presetBorderVisible(styleDefaults.presetVisibleMask, 'insideV')
      ),
      bottom: visibleStroke(
        row === rowCount - 1 ? (styleDefaults.footerRowBorderStroke ?? styleDefaults.footerRowHorizontalStroke) : styleDefaults.footerRowHorizontalStroke,
        styleDefaults.hStrokesVisible,
        row === rowCount - 1 ? styleDefaults.tableBorderVisible : undefined,
        row === rowCount - 1 ? presetBorderVisible(styleDefaults.presetVisibleMask, 'bottom') : presetBorderVisible(styleDefaults.presetVisibleMask, 'insideH')
      ),
      left: visibleStroke(
        column === 0 ? (styleDefaults.footerRowBorderStroke ?? styleDefaults.footerRowVerticalStroke) : styleDefaults.footerRowVerticalStroke,
        styleDefaults.vStrokesVisible,
        column === 0 ? styleDefaults.tableBorderVisible : undefined,
        column === 0 ? presetBorderVisible(styleDefaults.presetVisibleMask, 'left') : presetBorderVisible(styleDefaults.presetVisibleMask, 'insideV')
      )
    };
  }

  if (isHeaderColumn) {
    return {
      top: visibleStroke(styleDefaults.headerColumnHorizontalStroke, styleDefaults.hStrokesVisible, presetBorderVisible(styleDefaults.presetVisibleMask, row === 0 ? 'top' : 'insideH')),
      right:
        column === headerColumnCount - 1
          ? visibleStroke(
              styleDefaults.headerColumnSeparatorStroke ?? styleDefaults.headerColumnBorderStroke ?? styleDefaults.headerColumnVerticalStroke,
              styleDefaults.vStrokesVisible,
              styleDefaults.hcSeparatorVisible,
              styleDefaults.tableHcDividerVisible,
              presetBorderVisible(styleDefaults.presetVisibleMask, 'insideV')
            )
          : visibleStroke(styleDefaults.headerColumnVerticalStroke, styleDefaults.vStrokesVisible, presetBorderVisible(styleDefaults.presetVisibleMask, 'insideV')),
      bottom: visibleStroke(styleDefaults.headerColumnHorizontalStroke, styleDefaults.hStrokesVisible, presetBorderVisible(styleDefaults.presetVisibleMask, 'insideH')),
      left: visibleStroke(
        column === 0 ? (styleDefaults.headerColumnBorderStroke ?? styleDefaults.headerColumnVerticalStroke) : styleDefaults.headerColumnVerticalStroke,
        styleDefaults.vStrokesVisible,
        column === 0 ? styleDefaults.tableBorderVisible : undefined,
        column === 0 ? presetBorderVisible(styleDefaults.presetVisibleMask, 'left') : presetBorderVisible(styleDefaults.presetVisibleMask, 'insideV')
      )
    };
  }

  return {
    top: visibleStroke(
      row === 0 ? (styleDefaults.bodyHorizontalBorderStroke ?? styleDefaults.bodyHorizontalStroke) : styleDefaults.bodyHorizontalStroke,
      styleDefaults.hStrokesVisible,
      row === 0 ? styleDefaults.tableBorderVisible : undefined,
      row === 0 ? presetBorderVisible(styleDefaults.presetVisibleMask, 'top') : presetBorderVisible(styleDefaults.presetVisibleMask, 'insideH')
    ),
    right: visibleStroke(
      column === columnCount - 1 ? (styleDefaults.bodyVerticalBorderStroke ?? styleDefaults.bodyVerticalStroke) : styleDefaults.bodyVerticalStroke,
      styleDefaults.vStrokesVisible,
      column === columnCount - 1 ? styleDefaults.tableBorderVisible : undefined,
      column === columnCount - 1 ? presetBorderVisible(styleDefaults.presetVisibleMask, 'right') : presetBorderVisible(styleDefaults.presetVisibleMask, 'insideV')
    ),
    bottom:
      row === rowCount - 1 || (footerRowCount > 0 && row === rowCount - footerRowCount - 1)
        ? visibleStroke(
            styleDefaults.bodyHorizontalBorderStroke ?? styleDefaults.bodyHorizontalStroke,
            styleDefaults.hStrokesVisible,
            styleDefaults.tableBorderVisible,
            row === rowCount - 1 ? presetBorderVisible(styleDefaults.presetVisibleMask, 'bottom') : presetBorderVisible(styleDefaults.presetVisibleMask, 'insideH')
          )
        : visibleStroke(styleDefaults.bodyHorizontalStroke, styleDefaults.hStrokesVisible, presetBorderVisible(styleDefaults.presetVisibleMask, 'insideH')),
    left: visibleStroke(
      column === 0 ? (styleDefaults.bodyVerticalBorderStroke ?? styleDefaults.bodyVerticalStroke) : styleDefaults.bodyVerticalStroke,
      styleDefaults.vStrokesVisible,
      column === 0 ? styleDefaults.tableBorderVisible : undefined,
      column === 0 ? presetBorderVisible(styleDefaults.presetVisibleMask, 'left') : presetBorderVisible(styleDefaults.presetVisibleMask, 'insideV')
    )
  };
}

function visibleStroke(stroke: ResolvedTableBorderSide, ...flags: Array<boolean | undefined>): ResolvedTableBorderSide {
  if (stroke === false) {
    return false;
  }
  return flags.some((flag) => flag === false) ? false : stroke;
}

function presetBorderVisible(mask: number | undefined, side: 'top' | 'right' | 'bottom' | 'left' | 'insideH' | 'insideV'): boolean | undefined {
  if (typeof mask !== 'number' || !Number.isFinite(mask)) {
    return undefined;
  }

  const bits: Record<typeof side, number> = {
    top: 1,
    right: 2,
    bottom: 4,
    left: 8,
    insideH: 16,
    insideV: 32
  };
  return (Math.trunc(mask) & bits[side]) !== 0;
}

function readCellBorderStroke(
  cellProps: Record<string, unknown> | undefined,
  side: 'top' | 'right' | 'bottom' | 'left'
): ResolvedTableBorderSide {
  const direct = lineFromValue(readField(cellProps, [`${side}Stroke`, `${side}_stroke`]));
  if (direct) {
    return direct;
  }

  const deprecated = asObject(readField(cellProps, [`deprecated${capitalize(side)}Stroke`, `deprecated_${side}_stroke`]));
  return readDeprecatedTableStroke(deprecated);
}

function readTableStyleStroke(
  tableProperties: Record<string, unknown> | undefined,
  directKeys: string[],
  deprecatedKeys: string[]
): ResolvedTableBorderSide {
  const direct = lineFromValue(readField(tableProperties, directKeys));
  if (direct) {
    return direct;
  }

  return readDeprecatedTableStroke(readField(tableProperties, deprecatedKeys));
}

function readDeprecatedTableStroke(strokeWrapperLike: unknown): ResolvedTableBorderSide {
  const strokeWrapper = asObject(strokeWrapperLike);
  if (!strokeWrapper) {
    return undefined;
  }
  if (readField<boolean>(strokeWrapper, ['empty']) === true) {
    return false;
  }

  const stroke = lineFromValue(readField(strokeWrapper, ['stroke']));
  if (!stroke) {
    return undefined;
  }

  const opacity = readField<number>(strokeWrapper, ['opacity']);
  if (typeof opacity !== 'number' || !Number.isFinite(opacity)) {
    return stroke;
  }
  if (opacity <= 0) {
    return false;
  }

  return {
    ...stroke,
    alpha: Number(Math.max(0, Math.min(1, (stroke.alpha ?? 1) * opacity)).toFixed(4))
  };
}

function readTableStrokePreset(
  tableProperties: Record<string, unknown> | undefined
): { horizontalStroke?: ResolvedTableBorderSide; verticalStroke?: ResolvedTableBorderSide; exteriorStroke?: ResolvedTableBorderSide; visibleMask?: number } | undefined {
  const presetList = asObject(readField(tableProperties, ['strokePresetList', 'stroke_preset_list']));
  if (!presetList) {
    return undefined;
  }

  const preset = asArray<Record<string, unknown>>(readField(presetList, ['preset']))[0];
  if (preset) {
    return {
      horizontalStroke: lineFromValue(readField(preset, ['horizontalStroke', 'horizontal_stroke'])),
      verticalStroke: lineFromValue(readField(preset, ['verticalStroke', 'vertical_stroke'])),
      exteriorStroke: lineFromValue(readField(preset, ['exteriorStroke', 'exterior_stroke'])),
      visibleMask: readOptionalNumber(preset, ['visibleMask', 'visible_mask'])
    };
  }

  const deprecatedPreset = asArray<Record<string, unknown>>(readField(presetList, ['deprecatedPreset', 'deprecated_preset']))[0];
  if (!deprecatedPreset) {
    return undefined;
  }

  return {
    horizontalStroke: readDeprecatedTableStroke(readField(deprecatedPreset, ['deprecatedHorizontalStroke', 'deprecated_horizontal_stroke'])),
    verticalStroke: readDeprecatedTableStroke(readField(deprecatedPreset, ['deprecatedVerticalStroke', 'deprecated_vertical_stroke'])),
    exteriorStroke: readDeprecatedTableStroke(readField(deprecatedPreset, ['deprecatedExteriorStroke', 'deprecated_exterior_stroke'])),
    visibleMask: readOptionalNumber(deprecatedPreset, ['deprecatedVisibleMask', 'deprecated_visible_mask'])
  };
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function resolveTableCellFill(
  localFill: TableCell['fill'],
  styleDefaults: TableStyleDefaults,
  row: number,
  headerRowCount: number,
  footerRowCount: number,
  rowCount: number
): TableCell['fill'] {
  if (localFill.type !== 'none') {
    return localFill;
  }

  if (!styleDefaults.bandedRows || !styleDefaults.bandedFill || styleDefaults.bandedFill.type === 'none') {
    return localFill;
  }

  const isHeader = row < headerRowCount;
  const isFooter = footerRowCount > 0 && row >= rowCount - footerRowCount;
  if (isHeader || isFooter) {
    return localFill;
  }

  return (row - headerRowCount) % 2 === 1 ? styleDefaults.bandedFill : localFill;
}

function resolveTableStyleDefaults(archive: IworkArchiveIndex, tableModel: Record<string, unknown>): TableStyleDefaults {
  const styleNetwork = resolveTableStyleNetwork(archive, tableModel);
  if (!styleNetwork) {
    return {};
  }
  const tableStyle = resolveMergedStyle(archive, readField(styleNetwork, ['tableStyle', 'table_style']));
  const tableProperties = asObject(readField(tableStyle, ['tableProperties', 'table_properties']));
  const strokePreset = readTableStrokePreset(tableProperties);

  return {
    bodyTextStyle: readField(styleNetwork, ['bodyTextStyle', 'body_text_style']),
    headerRowTextStyle: readField(styleNetwork, ['headerRowTextStyle', 'header_row_text_style']),
    headerColumnTextStyle: readField(styleNetwork, ['headerColumnTextStyle', 'header_column_text_style']),
    footerRowTextStyle: readField(styleNetwork, ['footerRowTextStyle', 'footer_row_text_style']),
    bodyCellStyle: getRefId(readField(styleNetwork, ['bodyCellStyle', 'body_cell_style'])),
    headerRowStyle: getRefId(readField(styleNetwork, ['headerRowStyle', 'header_row_style'])),
    headerColumnStyle: getRefId(readField(styleNetwork, ['headerColumnStyle', 'header_column_style'])),
    footerRowStyle: getRefId(readField(styleNetwork, ['footerRowStyle', 'footer_row_style'])),
    bandedRows: Boolean(readField(tableProperties, ['bandedRows', 'banded_rows'])),
    bandedFill: fillFromValue(readField(tableProperties, ['bandedFill', 'banded_fill'])),
    bodyHorizontalStroke: readTableStyleStroke(tableProperties, ['tableBodyHorizontalStroke', 'table_body_horizontal_stroke'], ['deprecatedTableBodyHorizontalStroke', 'deprecated_table_body_horizontal_stroke']) ?? strokePreset?.horizontalStroke,
    bodyVerticalStroke: readTableStyleStroke(tableProperties, ['tableBodyVerticalStroke', 'table_body_vertical_stroke'], ['deprecatedTableBodyVerticalStroke', 'deprecated_table_body_vertical_stroke']) ?? strokePreset?.verticalStroke,
    bodyHorizontalBorderStroke:
      readTableStyleStroke(
        tableProperties,
        ['tableBodyHorizontalBorderStroke', 'table_body_horizontal_border_stroke'],
        ['deprecatedTableBodyHorizontalBorderStroke', 'deprecated_table_body_horizontal_border_stroke']
      ) ?? strokePreset?.exteriorStroke,
    bodyVerticalBorderStroke:
      readTableStyleStroke(
        tableProperties,
        ['tableBodyVerticalBorderStroke', 'table_body_vertical_border_stroke'],
        ['deprecatedTableBodyVerticalBorderStroke', 'deprecated_table_body_vertical_border_stroke']
      ) ?? strokePreset?.exteriorStroke,
    headerRowHorizontalStroke: readTableStyleStroke(tableProperties, ['headerRowHorizontalStroke', 'header_row_horizontal_stroke'], ['deprecatedHeaderRowHorizontalStroke', 'deprecated_header_row_horizontal_stroke']),
    headerRowVerticalStroke: readTableStyleStroke(tableProperties, ['headerRowVerticalStroke', 'header_row_vertical_stroke'], ['deprecatedHeaderRowVerticalStroke', 'deprecated_header_row_vertical_stroke']),
    headerRowBorderStroke: readTableStyleStroke(tableProperties, ['headerRowBorderStroke', 'header_row_border_stroke'], ['deprecatedHeaderRowBorderStroke', 'deprecated_header_row_border_stroke']),
    headerRowSeparatorStroke: readTableStyleStroke(tableProperties, ['headerRowSeparatorStroke', 'header_row_separator_stroke'], ['deprecatedHeaderRowSeparatorStroke', 'deprecated_header_row_separator_stroke']),
    headerColumnHorizontalStroke: readTableStyleStroke(
      tableProperties,
      ['headerColumnHorizontalStroke', 'header_column_horizontal_stroke'],
      ['deprecatedHeaderColumnHorizontalStroke', 'deprecated_header_column_horizontal_stroke']
    ),
    headerColumnVerticalStroke: readTableStyleStroke(tableProperties, ['headerColumnVerticalStroke', 'header_column_vertical_stroke'], ['deprecatedHeaderColumnVerticalStroke', 'deprecated_header_column_vertical_stroke']),
    headerColumnBorderStroke: readTableStyleStroke(tableProperties, ['headerColumnBorderStroke', 'header_column_border_stroke'], ['deprecatedHeaderColumnBorderStroke', 'deprecated_header_column_border_stroke']),
    headerColumnSeparatorStroke: readTableStyleStroke(
      tableProperties,
      ['headerColumnSeparatorStroke', 'header_column_separator_stroke'],
      ['deprecatedHeaderColumnSeparatorStroke', 'deprecated_header_column_separator_stroke']
    ),
    footerRowHorizontalStroke: readTableStyleStroke(tableProperties, ['footerRowHorizontalStroke', 'footer_row_horizontal_stroke'], ['deprecatedFooterRowHorizontalStroke', 'deprecated_footer_row_horizontal_stroke']),
    footerRowVerticalStroke: readTableStyleStroke(tableProperties, ['footerRowVerticalStroke', 'footer_row_vertical_stroke'], ['deprecatedFooterRowVerticalStroke', 'deprecated_footer_row_vertical_stroke']),
    footerRowBorderStroke: readTableStyleStroke(tableProperties, ['footerRowBorderStroke', 'footer_row_border_stroke'], ['deprecatedFooterRowBorderStroke', 'deprecated_footer_row_border_stroke']),
    footerRowSeparatorStroke: readTableStyleStroke(tableProperties, ['footerRowSeparatorStroke', 'footer_row_separator_stroke'], ['deprecatedFooterRowSeparatorStroke', 'deprecated_footer_row_separator_stroke']),
    vStrokesVisible: readOptionalBoolean(tableProperties ?? {}, ['vStrokesVisible', 'v_strokes_visible']),
    hStrokesVisible: readOptionalBoolean(tableProperties ?? {}, ['hStrokesVisible', 'h_strokes_visible']),
    hrSeparatorVisible: readOptionalBoolean(tableProperties ?? {}, ['hrSeparatorVisible', 'hr_separator_visible']),
    hcSeparatorVisible: readOptionalBoolean(tableProperties ?? {}, ['hcSeparatorVisible', 'hc_separator_visible']),
    footerSeparatorVisible: readOptionalBoolean(tableProperties ?? {}, ['footerSeparatorVisible', 'footer_separator_visible']),
    tableBorderVisible: readOptionalBoolean(tableProperties ?? {}, ['tableBorderVisible', 'table_border_visible']),
    tableHeaderBorderVisible: readOptionalBoolean(tableProperties ?? {}, ['tableHeaderBorderVisible', 'table_header_border_visible']),
    tableHcDividerVisible: readOptionalBoolean(tableProperties ?? {}, ['tableHcDividerVisible', 'table_hc_divider_visible']),
    tableHrDividerVisible: readOptionalBoolean(tableProperties ?? {}, ['tableHrDividerVisible', 'table_hr_divider_visible']),
    tableFooterDividerVisible: readOptionalBoolean(tableProperties ?? {}, ['tableFooterDividerVisible', 'table_footer_divider_visible']),
    presetVisibleMask: strokePreset?.visibleMask
  };
}

function resolveTableStyleNetwork(
  archive: IworkArchiveIndex,
  tableModel: Record<string, unknown>
): Record<string, unknown> | undefined {
  const directNetwork =
    getRecordValue<Record<string, unknown>>(archive, readField(tableModel, ['tableStyleNetwork', 'table_style_network', 'styleNetwork', 'style_network'])) ??
    resolveTableStylePresetNetwork(archive, readField(tableModel, ['tableStylePreset', 'table_style_preset']));
  if (directNetwork) {
    return directNetwork;
  }

  for (const referenceId of tableModelObjectReferences(tableModel)) {
    const record = archive.records[String(referenceId)];
    if (record?.typeName === 'TST.TableStyleNetworkArchive') {
      return asObject(record.value);
    }
    if (record?.typeName === 'TST.TableStylePresetArchive') {
      const presetNetwork = resolveTableStylePresetNetwork(archive, { identifier: referenceId });
      if (presetNetwork) {
        return presetNetwork;
      }
    }
  }

  return undefined;
}

function resolveTableStylePresetNetwork(archive: IworkArchiveIndex, presetRef: unknown): Record<string, unknown> | undefined {
  const preset = getRecordValue<Record<string, unknown>>(archive, presetRef);
  if (!preset) {
    return undefined;
  }
  return getRecordValue<Record<string, unknown>>(archive, readField(preset, ['styleNetwork', 'style_network']));
}

function tableModelObjectReferences(tableModel: Record<string, unknown>): number[] {
  const refIds = new Set<number>();
  for (const value of Object.values(tableModel)) {
    const refId = getRefId(value);
    if (refId) {
      refIds.add(refId);
    }
  }
  return [...refIds];
}

function resolveDefaultTextStyleRefId(
  tableModel: Record<string, unknown>,
  styleDefaults: TableStyleDefaults,
  row: number,
  column: number,
  rowCount: number,
  headerRowCount: number,
  headerColumnCount: number,
  footerRowCount: number
): unknown {
  if (row < headerRowCount) {
    return readField(tableModel, ['headerRowTextStyle', 'header_row_text_style']) ?? styleDefaults.headerRowTextStyle;
  }
  if (footerRowCount > 0 && row >= rowCount - footerRowCount) {
    return readField(tableModel, ['footerRowTextStyle', 'footer_row_text_style']) ?? styleDefaults.footerRowTextStyle;
  }
  if (column < headerColumnCount) {
    return readField(tableModel, ['headerColumnTextStyle', 'header_column_text_style']) ?? styleDefaults.headerColumnTextStyle;
  }
  return readField(tableModel, ['bodyTextStyle', 'body_text_style']) ?? styleDefaults.bodyTextStyle;
}

function resolveDefaultCellStyleRefId(
  tableModel: Record<string, unknown>,
  styleDefaults: TableStyleDefaults,
  row: number,
  column: number,
  rowCount: number,
  headerRowCount: number,
  headerColumnCount: number,
  footerRowCount: number
): number | undefined {
  const ref =
    row < headerRowCount
      ? (readField(tableModel, ['headerRowStyle', 'header_row_style']) ?? styleDefaults.headerRowStyle)
      : footerRowCount > 0 && row >= rowCount - footerRowCount
        ? (readField(tableModel, ['footerRowStyle', 'footer_row_style']) ?? styleDefaults.footerRowStyle)
        : column < headerColumnCount
          ? (readField(tableModel, ['headerColumnStyle', 'header_column_style']) ?? styleDefaults.headerColumnStyle)
          : (readField(tableModel, ['bodyCellStyle', 'body_cell_style']) ?? styleDefaults.bodyCellStyle);
  return getRefId(ref);
}

function resolveTableCellTextFrame(
  archive: IworkArchiveIndex,
  cellInfo: TableCellInfo,
  lookup: TableContentLookup,
  defaultTextStyleRef: unknown,
  padding: TextFrame['padding'],
  verticalAlign: TextFrame['verticalAlign'],
  wrap: TextFrame['wrap'],
  headerText: string
): TextFrame {
  const richPayloadRef = lookup.rich.get(cellInfo.contentKey);
  if (richPayloadRef) {
    const payload = getRecordValue<Record<string, unknown>>(archive, richPayloadRef);
    const storageRef = readField(payload, ['storage']);
    const frame = buildTextFrameFromStorage(archive, storageRef, {
      defaultParagraphStyleRef: defaultTextStyleRef,
      padding,
      verticalAlign
    });
    if (frame) {
      frame.wrap = wrap;
      return frame;
    }
  }

  const text = resolveCellPlainText(archive, cellInfo, lookup, headerText);
  return buildPlainTextFrame(archive, text, defaultTextStyleRef, padding, verticalAlign, wrap);
}

function buildPlainTextFrame(
  archive: IworkArchiveIndex,
  text: string,
  defaultTextStyleRef: unknown,
  padding: TextFrame['padding'],
  verticalAlign: TextFrame['verticalAlign'],
  wrap: TextFrame['wrap']
): TextFrame {
  const mergedStyle = resolveMergedStyle(archive, defaultTextStyleRef);
  const paraProps = asObject(readField(mergedStyle, ['paraProperties', 'para_properties']));
  const charProps = asObject(readField(mergedStyle, ['charProperties', 'char_properties']));
  const baseFrame = buildTextFrameFromStorage(
    archive,
      {
        text: [text],
        tableParaStyle: {
          entries: []
        },
      tableCharStyle: {
        entries: []
      }
    },
    {
      defaultParagraphStyleRef: defaultTextStyleRef,
      padding,
      verticalAlign
    }
  );

  if (baseFrame) {
    baseFrame.wrap = wrap;
    return baseFrame;
  }

  return {
    paragraphs: [
      {
        align: Number(readField<number>(paraProps, ['alignment']) ?? 0) === 2 ? 'center' : 'left',
        runs: [
          {
            text,
            bold: Boolean(readField(charProps, ['bold'])),
            italic: Boolean(readField(charProps, ['italic'])),
            fontFamily: readField<string>(charProps, ['fontName', 'font_name']),
            fontSize: readField<number>(charProps, ['fontSize', 'font_size']),
            color: colorToHex(readField(charProps, ['fontColor', 'font_color']), '#111827')
          }
        ]
      }
    ],
    verticalAlign,
    padding,
    wrap
  };
}

function resolveCellTextWrap(cellProps: Record<string, unknown> | undefined): TextFrame['wrap'] {
  return readField<boolean>(cellProps, ['textWrap', 'text_wrap']) === false ? 'none' : 'square';
}

function resolveCellPlainText(
  archive: IworkArchiveIndex,
  cellInfo: TableCellInfo,
  lookup: TableContentLookup,
  headerText: string
): string {
  const formatLookup = cellInfo.usePreBnc ? lookup.formatsPreBnc : lookup.formats;
  switch (cellInfo.cellType) {
    case 0:
      return resolveControlCellText(cellInfo.contentKey, lookup);
    case 2:
      if (cellInfo.hasNumber) {
        return formatNumericCellValue(cellInfo.numberValue, formatLookup.get(cellInfo.formatKey), headerText);
      }
      if (cellInfo.contentKey !== 0) {
        return String(cellInfo.contentKey);
      }
      return '';
    case 3:
      return formatTextCellValue(resolveCellStringContent(archive, cellInfo.contentKey, lookup), formatLookup.get(cellInfo.formatKey));
    case 5:
      if (cellInfo.hasNumber) {
        const dateText = formatExcelSerialDateTime(cellInfo.numberValue);
        if (dateText) {
          return dateText;
        }
      }
      return formatTextCellValue(resolveCellStringContent(archive, cellInfo.contentKey, lookup), formatLookup.get(cellInfo.formatKey));
    case 9:
      return formatTextCellValue(resolveCellStringContent(archive, cellInfo.contentKey, lookup), formatLookup.get(cellInfo.formatKey));
    default:
      if (cellInfo.hasNumber) {
        return formatNumericCellValue(cellInfo.numberValue, formatLookup.get(cellInfo.formatKey), headerText);
      }
      return formatTextCellValue(resolveCellStringContent(archive, cellInfo.contentKey, lookup), formatLookup.get(cellInfo.formatKey));
  }
}

function hasRenderablePayload(cellInfo: TableCellInfo): boolean {
  return cellInfo.hasNumber || (cellInfo.contentKey !== 0 && cellInfo.contentKey !== 65535);
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '';
  }
  if (Math.abs(value - Math.round(value)) < 1e-9) {
    return String(Math.round(value));
  }
  return String(value);
}

function resolveCellStringContent(archive: IworkArchiveIndex, key: number, lookup: TableContentLookup): string {
  if (key && lookup.strings.has(key)) {
    return lookup.strings.get(key) ?? '';
  }

  const richPayloadRef = lookup.rich.get(key);
  if (!richPayloadRef) {
    return '';
  }

  const payload = getRecordValue<Record<string, unknown>>(archive, richPayloadRef);
  const storage = getRecordValue<Record<string, unknown>>(archive, readField(payload, ['storage']));
  return normalizeStoragePlainText(asArray<string>(readField(storage, ['text'])).join(''));
}

function formatTextCellValue(text: string, format: TableFormatEntry | undefined): string {
  const customFormat = format?.customFormatString;
  if (!customFormat) {
    return text;
  }

  const textSection = splitCustomNumberSections(customFormat)[3];
  if (textSection == null) {
    return text;
  }
  return renderCustomTextSection(textSection, text);
}

function renderCustomTextSection(section: string, text: string): string {
  const body = stripLeadingCustomNumberMarkers(section);
  let output = '';
  let inQuotedText = false;
  let escaped = false;
  let bracketDepth = 0;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index] ?? '';
    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inQuotedText = !inQuotedText;
      continue;
    }
    if (!inQuotedText && char === '[') {
      bracketDepth += 1;
      continue;
    }
    if (!inQuotedText && char === ']' && bracketDepth > 0) {
      bracketDepth -= 1;
      continue;
    }
    if (bracketDepth > 0) {
      continue;
    }
    if (!inQuotedText && char === '_') {
      index += 1;
      continue;
    }
    if (!inQuotedText && char === '*') {
      index += 1;
      continue;
    }
    if (!inQuotedText && char === '@') {
      output += text;
      continue;
    }
    if (
      !inQuotedText &&
      body.slice(index, index + 7).toLowerCase() === 'general' &&
      isCustomTextSectionTokenBoundary(body, index - 1) &&
      isCustomTextSectionTokenBoundary(body, index + 7)
    ) {
      output += text;
      index += 6;
      continue;
    }
    output += char;
  }

  if (escaped) {
    output += '\\';
  }
  return output;
}

function isCustomTextSectionTokenBoundary(section: string, index: number): boolean {
  const char = section[index];
  return char == null || !/[A-Za-z]/.test(char);
}

function formatNumericCellValue(value: number, format: TableFormatEntry | undefined, headerText: string): string {
  if (format) {
    const boolText = formatBooleanWithFormat(value, format);
    if (boolText) {
      return boolText;
    }

    const durationText = formatDurationWithFormat(value, format);
    if (durationText) {
      return durationText;
    }

    const dateText = formatDateTimeWithFormat(value, format);
    if (dateText) {
      return dateText;
    }
  }

  if (headerSuggestsDateTime(headerText)) {
    const dateText = formatExcelSerialDateTime(value);
    if (dateText) {
      return dateText;
    }
  }

  if (format) {
    return formatNumberWithFormat(value, format);
  }

  return formatNumber(value);
}

function headerSuggestsDateTime(text: string): boolean {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normalized.length) {
    return false;
  }
  return ['date', 'time', '\u65e5\u671f', '\u65f6\u95f4'].some((keyword) => normalized.includes(keyword));
}

function looksLikeExcelSerialDateTime(value: number): boolean {
  return Number.isFinite(value) && value >= 20000 && value < 80000;
}

function formatExcelSerialDateTime(value: number): string {
  if (!looksLikeExcelSerialDateTime(value)) {
    return '';
  }

  const parts = excelSerialDateTimeParts(value);
  if (!parts) {
    return '';
  }
  const { dateText, timeText, hasTime } = parts;
  return hasTime ? `${dateText} ${timeText}` : dateText;
}

function formatDateTimeWithFormat(value: number, format: TableFormatEntry): string {
  if (!hasExplicitDateTimeFormat(format)) {
    return '';
  }

  const parts = excelSerialDateTimeParts(value);
  if (!parts) {
    return '';
  }

  const wantsDate = !format.suppressDateFormat && dateTimeFormatIncludesDate(format.dateTimeFormat);
  const wantsTime = !format.suppressTimeFormat && dateTimeFormatIncludesTime(format.dateTimeFormat);
  const formatted = format.dateTimeFormat ? renderDateTimePattern(format.dateTimeFormat, parts, wantsDate, wantsTime) : '';
  if (formatted) {
    return formatted;
  }

  if (wantsDate && wantsTime) {
    return `${parts.dateText} ${parts.timeText}`;
  }
  if (wantsTime && !wantsDate) {
    return parts.timeText;
  }
  return parts.dateText;
}

function formatDurationWithFormat(value: number, format: TableFormatEntry): string {
  if (!hasExplicitDateTimeFormat(format) || !format.dateTimeFormat || !Number.isFinite(value)) {
    return '';
  }
  if (!dateTimeFormatIncludesDuration(format.dateTimeFormat)) {
    return '';
  }

  return renderDurationPattern(format.dateTimeFormat, value);
}

function renderDurationPattern(pattern: string, value: number): string {
  const totalMilliseconds = Math.round(Math.abs(value) * 24 * 60 * 60 * 1000);
  const totalSeconds = Math.floor(totalMilliseconds / 1000);
  const totalDays = Math.floor(totalSeconds / (24 * 60 * 60));
  const totalHours = Math.floor(totalSeconds / (60 * 60));
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millisecond = totalMilliseconds % 1000;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / (60 * 60)) % 24;
  const sign = value < 0 ? '-' : '';
  let output = '';
  let index = 0;

  while (index < pattern.length) {
    const char = pattern[index];
    if (char === '\\') {
      const escapedBracketLiteral = readEscapedBracketLiteral(pattern, index);
      if (escapedBracketLiteral) {
        output += escapedBracketLiteral.text;
        index += escapedBracketLiteral.length;
        continue;
      }
      output += pattern[index + 1] ?? '';
      index += pattern[index + 1] == null ? 1 : 2;
      continue;
    }
    if (char === '"') {
      const end = pattern.indexOf('"', index + 1);
      if (end < 0) {
        output += pattern.slice(index + 1);
        break;
      }
      output += pattern.slice(index + 1, end);
      index = end + 1;
      continue;
    }
    const quotedLiteral = readIcuQuotedLiteral(pattern, index);
    if (quotedLiteral) {
      output += quotedLiteral.text;
      index += quotedLiteral.length;
      continue;
    }
    if (char === '[') {
      const end = pattern.indexOf(']', index + 1);
      if (end > index) {
        const token = pattern.slice(index + 1, end);
        const rendered = renderDurationElapsedToken(token, totalDays, totalHours, totalMinutes, totalSeconds);
        if (rendered != null) {
          output += rendered;
          index = end + 1;
          continue;
        }
      }
    }
    const fractionalSecond = renderFractionalSecondToken(pattern, index, output, millisecond, { allowElapsedSeconds: true });
    if (fractionalSecond) {
      output += fractionalSecond.text;
      index += fractionalSecond.length;
      continue;
    }
    const icuFractionalSecond = renderIcuFractionalSecondToken(pattern, index, millisecond);
    if (icuFractionalSecond && output.endsWith('.')) {
      output += icuFractionalSecond.text;
      index += icuFractionalSecond.length;
      continue;
    }

    const token = ['hh', 'HH', 'h', 'H', 'mm', 'm', 'ss', 's'].find((candidate) => pattern.startsWith(candidate, index));
    if (token) {
      output += renderDurationRemainderToken(token, hours, minutes, seconds);
      index += token.length;
      continue;
    }

    output += char;
    index += 1;
  }

  return output.length ? `${sign}${output}` : '';
}

function renderDurationElapsedToken(
  token: string,
  totalDays: number,
  totalHours: number,
  totalMinutes: number,
  totalSeconds: number
): string | undefined {
  const normalized = token.toLowerCase();
  if (/^d+$/.test(normalized)) {
    return formatDurationInteger(totalDays, token.length);
  }
  if (/^h+$/.test(normalized)) {
    return formatDurationInteger(totalHours, token.length);
  }
  if (/^m+$/.test(normalized)) {
    return formatDurationInteger(totalMinutes, token.length);
  }
  if (/^s+$/.test(normalized)) {
    return formatDurationInteger(totalSeconds, token.length);
  }
  return undefined;
}

function renderDurationRemainderToken(token: string, hours: number, minutes: number, seconds: number): string {
  switch (token) {
    case 'hh':
    case 'HH':
      return padNumber(hours);
    case 'h':
    case 'H':
      return String(hours);
    case 'mm':
      return padNumber(minutes);
    case 'm':
      return String(minutes);
    case 'ss':
      return padNumber(seconds);
    case 's':
      return String(seconds);
    default:
      return token;
  }
}

function formatDurationInteger(value: number, width: number): string {
  return width > 1 ? String(value).padStart(width, '0') : String(value);
}

function excelSerialDateTimeParts(
  value: number
):
  | {
      year: number;
      month: number;
      day: number;
      dayOfYear: number;
      weekOfYear: number;
      weekday: number;
      hour: number;
      minute: number;
      second: number;
      millisecond: number;
      dateText: string;
      timeText: string;
      hasTime: boolean;
    }
  | undefined {
  if (!looksLikeExcelSerialDateTime(value)) {
    return undefined;
  }
  const totalMilliseconds = Math.round(value * 24 * 60 * 60 * 1000);
  const time = new Date(Date.UTC(1899, 11, 30) + totalMilliseconds);
  const year = time.getUTCFullYear();
  const month = time.getUTCMonth() + 1;
  const day = time.getUTCDate();
  const dayOfYear = Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / (24 * 60 * 60 * 1000)) + 1;
  const weekOfYear = Math.floor((dayOfYear + new Date(Date.UTC(year, 0, 1)).getUTCDay()) / 7) + 1;
  const weekday = time.getUTCDay();
  const hour = time.getUTCHours();
  const minute = time.getUTCMinutes();
  const second = time.getUTCSeconds();
  const millisecond = time.getUTCMilliseconds();
  const dateText = `${year}-${padNumber(month)}-${padNumber(day)}`;
  const timeText = `${padNumber(hour)}:${padNumber(minute)}:${padNumber(second)}`;
  return {
    year,
    month,
    day,
    dayOfYear,
    weekOfYear,
    weekday,
    hour,
    minute,
    second,
    millisecond,
    dateText,
    timeText,
    hasTime: totalMilliseconds % (24 * 60 * 60 * 1000) !== 0
  };
}

function renderDateTimePattern(
  pattern: string,
  parts: NonNullable<ReturnType<typeof excelSerialDateTimeParts>>,
  wantsDate: boolean,
  wantsTime: boolean
): string {
  const normalized = stripDateTimeFormatMarkers(pattern).trim();
  if (!normalized.length) {
    return '';
  }

  const usesMeridiem = dateTimePatternUsesMeridiem(normalized);
  const rendered = renderDateTimeTokens(normalized, parts, usesMeridiem);

  if (!wantsDate && wantsTime) {
    return stripDatePatternFragments(rendered).trim();
  }
  if (wantsDate && !wantsTime) {
    return stripTimePatternFragments(rendered).trim();
  }
  return rendered;
}

function renderDateTimeTokens(pattern: string, parts: NonNullable<ReturnType<typeof excelSerialDateTimeParts>>, usesMeridiem: boolean): string {
  const tokens = [
    'AM/PM',
    'am/pm',
    'A/P',
    'a/p',
    'aaaaa',
    'aaaa',
    'aaa',
    'aa',
    'a',
    'yyyy',
    'YYYY',
    'yy',
    'YY',
    'LLLLL',
    'MMMMM',
    'mmmmm',
    'LLLL',
    'MMMM',
    'mmmm',
    'LLL',
    'MMM',
    'mmm',
    'EEEEE',
    'EEEE',
    'EEE',
    'EE',
    'E',
    'dddd',
    'ddd',
    'hh',
    'HH',
    'h',
    'H',
    'QQQQQ',
    'QQQQ',
    'QQQ',
    'QQ',
    'Q',
    'qq',
    'q',
    'ww',
    'w',
    'mm',
    'LL',
    'L',
    'MM',
    'M',
    'm',
    'DDD',
    'dd',
    'DD',
    'D',
    'd',
    'SSS',
    'SS',
    'S',
    'ss',
    's'
  ];
  let output = '';
  let index = 0;

  while (index < pattern.length) {
    const char = pattern[index];
    if (char === '\\') {
      const escapedBracketLiteral = readEscapedBracketLiteral(pattern, index);
      if (escapedBracketLiteral) {
        output += escapedBracketLiteral.text;
        index += escapedBracketLiteral.length;
        continue;
      }
      output += pattern[index + 1] ?? '';
      index += pattern[index + 1] == null ? 1 : 2;
      continue;
    }
    if (char === '"') {
      const end = pattern.indexOf('"', index + 1);
      if (end < 0) {
        output += pattern.slice(index + 1);
        break;
      }
      output += pattern.slice(index + 1, end);
      index = end + 1;
      continue;
    }
    const quotedLiteral = readIcuQuotedLiteral(pattern, index);
    if (quotedLiteral) {
      output += quotedLiteral.text;
      index += quotedLiteral.length;
      continue;
    }
    const fractionalSecond = renderFractionalSecondToken(pattern, index, output, parts.millisecond);
    if (fractionalSecond) {
      output += fractionalSecond.text;
      index += fractionalSecond.length;
      continue;
    }
    const icuFractionalSecond = renderIcuFractionalSecondToken(pattern, index, parts.millisecond);
    if (icuFractionalSecond && output.endsWith('.')) {
      output += icuFractionalSecond.text;
      index += icuFractionalSecond.length;
      continue;
    }

    const token = tokens.find((candidate) => pattern.startsWith(candidate, index));
    if (token) {
      output += renderDateTimeToken(token, pattern, index, parts, usesMeridiem);
      index += token.length;
      continue;
    }

    output += char;
    index += 1;
  }

  return output;
}

function readEscapedBracketLiteral(pattern: string, offset: number): { text: string; length: number } | undefined {
  if (pattern[offset] !== '\\' || pattern[offset + 1] !== '[') {
    return undefined;
  }

  let text = '[';
  let index = offset + 2;
  while (index < pattern.length) {
    if (pattern[index] === '\\' && pattern[index + 1] === ']') {
      text += ']';
      return {
        text,
        length: index - offset + 2
      };
    }
    text += pattern[index] ?? '';
    index += 1;
  }
  return undefined;
}

function renderDateTimeToken(
  token: string,
  pattern: string,
  offset: number,
  parts: NonNullable<ReturnType<typeof excelSerialDateTimeParts>>,
  usesMeridiem: boolean
): string {
  switch (token) {
    case 'AM/PM':
    case 'am/pm':
    case 'A/P':
    case 'a/p':
    case 'aaaaa':
    case 'aaaa':
    case 'aaa':
    case 'aa':
    case 'a':
      return meridiemText(token, parts.hour);
    case 'yyyy':
    case 'YYYY':
      return String(parts.year);
    case 'yy':
    case 'YY':
      return padNumber(parts.year % 100);
    case 'EEEE':
    case 'dddd':
      return weekdayName(parts.weekday, 'long');
    case 'EEEEE':
      return weekdayName(parts.weekday, 'narrow');
    case 'EEE':
    case 'EE':
    case 'E':
    case 'ddd':
      return weekdayName(parts.weekday, 'short');
    case 'dd':
      return padNumber(parts.day);
    case 'd':
      return String(parts.day);
    case 'DDD':
      return String(parts.dayOfYear).padStart(3, '0');
    case 'DD':
      return padNumber(parts.dayOfYear);
    case 'D':
      return String(parts.dayOfYear);
    case 'SSS':
      return String(parts.millisecond).padStart(3, '0');
    case 'SS':
      return String(parts.millisecond).padStart(3, '0').slice(0, 2);
    case 'S':
      return String(parts.millisecond).padStart(3, '0').slice(0, 1);
    case 'LLLL':
    case 'MMMM':
    case 'mmmm':
      return monthName(parts.month, 'long');
    case 'LLLLL':
    case 'MMMMM':
    case 'mmmmm':
      return monthName(parts.month, 'narrow');
    case 'LLL':
    case 'MMM':
    case 'mmm':
      return monthName(parts.month, 'short');
    case 'LL':
    case 'MM':
      return padNumber(parts.month);
    case 'L':
    case 'M':
      return String(parts.month);
    case 'hh':
    case 'HH':
      return padNumber(usesMeridiem ? hour12(parts.hour) : parts.hour);
    case 'h':
    case 'H':
      return String(usesMeridiem ? hour12(parts.hour) : parts.hour);
    case 'QQQQQ':
      return String(Math.ceil(parts.month / 3));
    case 'QQQQ':
      return `Quarter ${Math.ceil(parts.month / 3)}`;
    case 'QQQ':
      return `Q${Math.ceil(parts.month / 3)}`;
    case 'QQ':
    case 'qq':
      return padNumber(Math.ceil(parts.month / 3));
    case 'Q':
    case 'q':
      return String(Math.ceil(parts.month / 3));
    case 'ww':
      return padNumber(parts.weekOfYear);
    case 'w':
      return String(parts.weekOfYear);
    case 'ss':
      return padNumber(parts.second);
    case 's':
      return String(parts.second);
    case 'mm':
      return shouldRenderMinutes(pattern, offset) ? padNumber(parts.minute) : padNumber(parts.month);
    case 'm':
      return shouldRenderMinutes(pattern, offset) ? String(parts.minute) : String(parts.month);
    default:
      return token;
  }
}

function weekdayName(weekday: number, style: 'short' | 'long' | 'narrow'): string {
  const shortNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const longNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  if (style === 'narrow') {
    return (shortNames[weekday] ?? String(weekday)).slice(0, 1);
  }
  return (style === 'short' ? shortNames : longNames)[weekday] ?? String(weekday);
}

function monthName(month: number, style: 'short' | 'long' | 'narrow'): string {
  const shortNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const longNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December'
  ];
  if (style === 'narrow') {
    return (shortNames[month - 1] ?? String(month)).slice(0, 1);
  }
  return (style === 'short' ? shortNames : longNames)[month - 1] ?? String(month);
}

function hour12(hour: number): number {
  const normalized = hour % 12;
  return normalized === 0 ? 12 : normalized;
}

function meridiemText(token: string, hour: number): string {
  const isPm = hour >= 12;
  if (token === 'aaaaa') {
    return isPm ? 'p' : 'a';
  }
  if (token === 'A/P') {
    return isPm ? 'P' : 'A';
  }
  if (token === 'a/p') {
    return isPm ? 'p' : 'a';
  }
  if (token === 'am/pm') {
    return isPm ? 'pm' : 'am';
  }
  return isPm ? 'PM' : 'AM';
}

function dateTimePatternUsesMeridiem(pattern: string): boolean {
  return /am\/pm|a\/p/i.test(pattern) || /(^|[^a-z])a{1,5}($|[^a-z])/i.test(pattern);
}

function renderFractionalSecondToken(
  pattern: string,
  offset: number,
  renderedPrefix: string,
  millisecond: number,
  options: { allowElapsedSeconds?: boolean } = {}
): { text: string; length: number } | undefined {
  if (pattern[offset] !== '.') {
    return undefined;
  }
  const match = pattern.slice(offset + 1).match(/^0{1,3}/);
  if (
    !match ||
    (!/(^|[:\s])\d{1,2}:\d{2}:\d{2}$|\d{1,2}:\d{2}$/.test(renderedPrefix) &&
      !(options.allowElapsedSeconds && /^\d+$/.test(renderedPrefix)))
  ) {
    return undefined;
  }

  const width = match[0].length;
  const millisecondsText = String(millisecond).padStart(3, '0').slice(0, width);
  return {
    text: `.${millisecondsText}`,
    length: 1 + width
  };
}

function renderIcuFractionalSecondToken(pattern: string, offset: number, millisecond: number): { text: string; length: number } | undefined {
  const match = pattern.slice(offset).match(/^S{1,3}/);
  if (!match) {
    return undefined;
  }
  const width = match[0].length;
  return {
    text: String(millisecond).padStart(3, '0').slice(0, width),
    length: width
  };
}

function readIcuQuotedLiteral(pattern: string, offset: number): { text: string; length: number } | undefined {
  if (pattern[offset] !== "'") {
    return undefined;
  }
  if (pattern[offset + 1] === "'") {
    return { text: "'", length: 2 };
  }

  let text = '';
  let index = offset + 1;
  while (index < pattern.length) {
    if (pattern[index] === "'") {
      if (pattern[index + 1] === "'") {
        text += "'";
        index += 2;
        continue;
      }
      return { text, length: index - offset + 1 };
    }
    text += pattern[index];
    index += 1;
  }
  return { text, length: pattern.length - offset };
}

function shouldRenderMinutes(pattern: string, offset: number): boolean {
  const before = pattern.slice(0, offset);
  const after = pattern.slice(offset);
  return /h{1,2}[^ymd]*$/i.test(before) || /^[^ymd]*(h{1,2}|s{1,2})/i.test(after);
}

function stripDatePatternFragments(text: string): string {
  return text.replace(/\b\d{2,4}[/-]\d{1,2}[/-]\d{1,2}\b/g, '').replace(/^[\s,/-]+|[\s,/-]+$/g, '');
}

function stripTimePatternFragments(text: string): string {
  return text.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, '').replace(/^[\s,/-]+|[\s,/-]+$/g, '');
}

function stripDateTimeFormatMarkers(pattern: string): string {
  let output = '';
  let inQuotedText = false;
  let escaped = false;

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] ?? '';
    if (escaped) {
      output += `\\${char}`;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inQuotedText = !inQuotedText;
      output += char;
      continue;
    }
    if (!inQuotedText && char === '[') {
      const end = pattern.indexOf(']', index + 1);
      if (end > index) {
        const content = pattern.slice(index + 1, end).trim();
        if (isDateTimeLocaleMarker(content)) {
          index = end;
          continue;
        }
      }
    }
    output += char;
  }

  if (escaped) {
    output += '\\';
  }
  return output;
}

function isDateTimeLocaleMarker(content: string): boolean {
  return /^\$-?[a-z0-9]+$/i.test(content) || /^[$\w-]+-[a-f0-9]+$/i.test(content);
}

function formatNumberWithFormat(value: number, format: TableFormatEntry): string {
  if (!Number.isFinite(value)) {
    return '';
  }

  const isPercent = isPercentFormat(format);
  const isPermille = isPermilleFormat(format);
  const isCurrency = isCurrencyFormat(format);
  const scaledValue = isPermille ? value * 1000 : isPercent ? value * resolvePercentScale(format) : value;
  const customUnitSymbol = isPermille ? '\u2030' : isPercent ? '%' : '';
  const customPattern = customNumberPattern(format.customFormatString, scaledValue);
  const displayValue = customPattern.scaleDivisor ? scaledValue / customPattern.scaleDivisor : scaledValue;
  const scientificText = formatScientificNumber(displayValue, format.customFormatString, {
    omitPercentLiteral: isPercent,
    omitPermilleLiteral: isPermille,
    unitSymbol: customUnitSymbol
  });
  if (scientificText) {
    return decorateFormattedNumber(scientificText, format, false, isCurrency, { omitCustomAffixes: true });
  }
  const fractionText = formatFractionNumber(displayValue, format.customFormatString, {
    omitPercentLiteral: isPercent,
    omitPermilleLiteral: isPermille,
    unitSymbol: customUnitSymbol
  });
  if (fractionText) {
    return decorateFormattedNumber(fractionText, format, false, isCurrency, { omitCustomAffixes: true });
  }
  const decimals = format.decimalPlaces ?? customPattern.decimalPlaces;
  const usesExplicitDecimalPlaces = format.decimalPlaces != null;
  if (typeof decimals !== 'number' || !Number.isFinite(decimals) || decimals < 0 || decimals > 12 || decimals === 253) {
    return formatNumberWithDecorations(displayValue, format, isPercent, isCurrency, isPermille);
  }
  if (decimals === 0) {
    const rounded = Math.round(displayValue);
    if (usesExplicitDecimalPlaces && Math.abs(displayValue - rounded) >= 1e-9) {
      return formatNumberWithDecorations(displayValue, format, isPercent, isCurrency, isPermille);
    }
  }

  let text = displayValue.toFixed(decimals);
  if (format.decimalPlaces == null && customPattern.requiredDecimalPlaces != null) {
    text = trimOptionalDecimalPlaces(text, customPattern.requiredDecimalPlaces);
  }
  if (format.decimalPlaces == null) {
    text = applyNumberPlaceholderPadding(text, customPattern);
  }
  if (text.startsWith('-') && Number(text) === 0) {
    text = text.slice(1);
  }
  if (format.showThousandsSeparator || customPattern.showThousandsSeparator) {
    text = addThousandsSeparators(text);
  }
  return decorateFormattedNumber(text, format, isPercent, isCurrency, { isPermille });
}

function formatNumberWithDecorations(
  value: number,
  format: TableFormatEntry,
  isPercent: boolean,
  isCurrency: boolean,
  isPermille = false
): string {
  let text = formatNumber(value);
  if (format.showThousandsSeparator || customNumberPattern(format.customFormatString, value).showThousandsSeparator) {
    text = addThousandsSeparators(text);
  }
  return decorateFormattedNumber(text, format, isPercent, isCurrency, { isPermille });
}

function decorateFormattedNumber(
  text: string,
  format: TableFormatEntry,
  isPercent: boolean,
  isCurrency: boolean,
  options: { isPermille?: boolean; omitCustomAffixes?: boolean } = {}
): string {
  if (!text.length) {
    return text;
  }

  const negative = text.startsWith('-');
  let body = negative ? text.slice(1) : text;
  const numericValue = Number(text.replace(/,/g, ''));
  const affixes = options.omitCustomAffixes
    ? { prefix: '', suffix: '', hasCustomCurrency: hasCustomCurrencyMarker(format.customFormatString ?? '') }
    : customNumberAffixes(format.customFormatString, numericValue, { omitPercentLiteral: isPercent, omitPermilleLiteral: options.isPermille });
  if (affixes.replacementText && Math.abs(numericValue) < 1e-9) {
    return affixes.replacementText;
  }
  if (isCurrency && !affixes.hasCustomCurrency) {
    body = `${currencyPrefix(format.currencyCode)}${body}`;
  }
  if (isPercent) {
    body = `${body}%`;
  }
  if (options.isPermille) {
    body = `${body}\u2030`;
  }
  body = `${affixes.prefix}${body}${affixes.suffix}`;

  if (!negative && numericValue > 0 && format.usesPlusSign) {
    return `+${body}`;
  }
  if (!negative) {
    return body;
  }
  if (affixes.handlesNegative) {
    return body;
  }
  return usesParenthesesForNegative(format.negativeStyle, format) ? `(${body})` : `-${body}`;
}

function isPercentFormat(format: TableFormatEntry): boolean {
  if (format.formatType === 3) {
    return true;
  }
  return hasUnescapedPercent(format.customFormatString);
}

function isPermilleFormat(format: TableFormatEntry): boolean {
  return hasUnescapedPermille(format.customFormatString);
}

function isCurrencyFormat(format: TableFormatEntry): boolean {
  return typeof format.currencyCode === 'string' && format.currencyCode.trim().length > 0;
}

function formatBooleanWithFormat(value: number, format: TableFormatEntry): string {
  if (!format.boolTrueString && !format.boolFalseString) {
    return '';
  }
  if (Math.abs(value) < 1e-9) {
    return format.boolFalseString ?? 'FALSE';
  }
  if (Math.abs(value - 1) < 1e-9) {
    return format.boolTrueString ?? 'TRUE';
  }
  return '';
}

function customNumberAffixes(
  pattern: string | undefined,
  value = 1,
  options: { omitPercentLiteral?: boolean; omitPermilleLiteral?: boolean } = {}
): { prefix: string; suffix: string; handlesNegative?: boolean; replacementText?: string; hasCustomCurrency?: boolean } {
  if (!pattern) {
    return { prefix: '', suffix: '' };
  }

  const selectedSection = selectCustomNumberSection(pattern, value);
  const leadingCurrency = leadingCustomNumberCurrencyMarker(selectedSection);
  const hasCustomCurrency = hasCustomCurrencyMarker(selectedSection);
  const firstSection = stripLeadingCustomNumberMarkers(selectedSection);
  const numberPlaceholder = findCustomNumberPlaceholder(firstSection);
  const generalPlaceholder = numberPlaceholder ? undefined : findCustomGeneralPlaceholder(firstSection);
  if (!numberPlaceholder && !generalPlaceholder) {
    const replacementText = customNumberLiteralText(firstSection);
    return replacementText ? { prefix: '', suffix: '', replacementText } : { prefix: '', suffix: '' };
  }

  const placeholderStart = numberPlaceholder?.index ?? generalPlaceholder?.index ?? 0;
  const placeholderEnd = placeholderStart + (numberPlaceholder?.length ?? generalPlaceholder?.length ?? 0);
  const prefix = `${leadingCurrency}${customNumberLiteralText(firstSection.slice(0, placeholderStart), options)}`;
  const suffix = customNumberLiteralText(firstSection.slice(placeholderEnd), options);
  return {
    prefix,
    suffix,
    hasCustomCurrency,
    handlesNegative: value < 0 && (prefix.includes('-') || suffix.includes('-') || prefix.includes('(') || suffix.includes(')'))
  };
}

function findCustomNumberPlaceholder(section: string): { index: number; length: number } | undefined {
  let inQuotedText = false;
  let escaped = false;
  let bracketDepth = 0;
  for (let index = 0; index < section.length; index += 1) {
    const char = section[index] ?? '';
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inQuotedText = !inQuotedText;
      continue;
    }
    if (!inQuotedText && char === '[') {
      bracketDepth += 1;
      continue;
    }
    if (!inQuotedText && char === ']' && bracketDepth > 0) {
      bracketDepth -= 1;
      continue;
    }
    if (inQuotedText || bracketDepth > 0 || !/[#,0?]/.test(char)) {
      continue;
    }

    const match = section.slice(index).match(/^[#,0?]+(?:\.[#,0?]+)?/);
    return {
      index,
      length: match?.[0]?.length ?? 1
    };
  }
  return undefined;
}

function findCustomGeneralPlaceholder(section: string): { index: number; length: number } | undefined {
  let inQuotedText = false;
  let escaped = false;
  let bracketDepth = 0;
  for (let index = 0; index < section.length; index += 1) {
    const char = section[index] ?? '';
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inQuotedText = !inQuotedText;
      continue;
    }
    if (!inQuotedText && char === '[') {
      bracketDepth += 1;
      continue;
    }
    if (!inQuotedText && char === ']' && bracketDepth > 0) {
      bracketDepth -= 1;
      continue;
    }
    if (inQuotedText || bracketDepth > 0) {
      continue;
    }
    if (
      section.slice(index, index + 7).toLowerCase() === 'general' &&
      isCustomGeneralTokenBoundary(section, index - 1) &&
      isCustomGeneralTokenBoundary(section, index + 7)
    ) {
      return { index, length: 7 };
    }
  }
  return undefined;
}

function isCustomGeneralTokenBoundary(section: string, index: number): boolean {
  const char = section[index];
  return char == null || !/[A-Za-z]/.test(char);
}

function customNumberLiteralText(text: string, options: { omitPercentLiteral?: boolean; omitPermilleLiteral?: boolean } = {}): string {
  return renderCustomNumberLiteralText(text, options);
}

function renderCustomNumberLiteralText(text: string, options: { omitPercentLiteral?: boolean; omitPermilleLiteral?: boolean } = {}): string {
  const chars: Array<{ char: string; protected: boolean }> = [];
  let inQuotedText = false;
  let escaped = false;
  let bracketDepth = 0;
  let bracketContent = '';

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? '';
    if (escaped) {
      if (bracketDepth > 0) {
        bracketContent += char;
      } else {
        chars.push({ char, protected: true });
      }
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inQuotedText = !inQuotedText;
      continue;
    }
    if (!inQuotedText && char === '[') {
      bracketDepth += 1;
      if (bracketDepth === 1) {
        bracketContent = '';
      } else {
        bracketContent += char;
      }
      continue;
    }
    if (!inQuotedText && char === ']' && bracketDepth > 0) {
      if (bracketDepth === 1) {
        const currencySymbol = currencySymbolFromCustomNumberMarker(bracketContent);
        if (currencySymbol) {
          chars.push({ char: currencySymbol, protected: false });
        }
        bracketContent = '';
      } else {
        bracketContent += char;
      }
      bracketDepth -= 1;
      continue;
    }
    if (bracketDepth > 0) {
      bracketContent += char;
      continue;
    }
    if (!inQuotedText && (char === '_' || char === '*')) {
      index += 1;
      continue;
    }
    chars.push({ char, protected: inQuotedText });
  }

  if (escaped) {
    chars.push({ char: '\\', protected: true });
  }

  let start = 0;
  while (start < chars.length && !chars[start]?.protected && /\s/.test(chars[start]?.char ?? '')) {
    start += 1;
  }
  let end = chars.length;
  while (end > start && !chars[end - 1]?.protected && /\s/.test(chars[end - 1]?.char ?? '')) {
    end -= 1;
  }
  const filtered = chars.slice(start, end).filter((entry) => {
      if (entry.protected) {
        return true;
      }
      if (options.omitPercentLiteral && entry.char === '%') {
        return false;
      }
      if (options.omitPermilleLiteral && entry.char === '\u2030') {
        return false;
      }
      return true;
    });

  let filteredStart = 0;
  while (filteredStart < filtered.length && !filtered[filteredStart]?.protected && /\s/.test(filtered[filteredStart]?.char ?? '')) {
    filteredStart += 1;
  }
  let filteredEnd = filtered.length;
  while (filteredEnd > filteredStart && !filtered[filteredEnd - 1]?.protected && /\s/.test(filtered[filteredEnd - 1]?.char ?? '')) {
    filteredEnd -= 1;
  }
  return filtered
    .slice(filteredStart, filteredEnd)
    .map((entry) => entry.char)
    .join('');
}

function currencySymbolFromCustomNumberMarker(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith('$') || trimmed.length <= 1) {
    return '';
  }
  return trimmed.slice(1).split('-', 1)[0]?.trim() ?? '';
}

function hasUnescapedPercent(pattern: string | undefined): boolean {
  return hasUnescapedFormatLiteral(pattern, '%');
}

function hasUnescapedPermille(pattern: string | undefined): boolean {
  return hasUnescapedFormatLiteral(pattern, '\u2030');
}

function hasUnescapedFormatLiteral(pattern: string | undefined, literal: string): boolean {
  if (!pattern) {
    return false;
  }

  let inQuotedText = false;
  let escaped = false;
  let bracketDepth = 0;
  for (const char of pattern) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inQuotedText = !inQuotedText;
      continue;
    }
    if (!inQuotedText && char === '[') {
      bracketDepth += 1;
      continue;
    }
    if (!inQuotedText && char === ']' && bracketDepth > 0) {
      bracketDepth -= 1;
      continue;
    }
    if (char === literal && !inQuotedText && bracketDepth === 0) {
      return true;
    }
  }
  return false;
}

function customNumberPattern(
  pattern: string | undefined,
  value = 1
): {
  decimalPlaces?: number;
  requiredDecimalPlaces?: number;
  showThousandsSeparator?: boolean;
  scaleDivisor?: number;
  integerToken?: string;
  decimalToken?: string;
} {
  if (!pattern) {
    return {};
  }

  const firstSection = stripLeadingCustomNumberMarkers(selectCustomNumberSection(pattern, value));
  const placeholderRef = findCustomNumberPlaceholder(firstSection);
  if (!placeholderRef) {
    return {};
  }

  const placeholder = firstSection.slice(placeholderRef.index, placeholderRef.index + placeholderRef.length);
  const scaleCommas = placeholder.match(/,+$/)?.[0]?.length ?? 0;
  const placeholderWithoutScale = placeholder.replace(/,+$/, '');
  const integerPart = placeholderWithoutScale.split('.', 2)[0] ?? '';
  const scaleDivisor = scaleCommas > 0 ? Math.pow(1000, scaleCommas) : undefined;
  const decimalPart = placeholderWithoutScale.split('.', 2)[1];
  const decimalTokens = decimalPart ? decimalPart.replace(/[^0#?]/g, '') : '';
  return {
    decimalPlaces: decimalPart != null ? decimalTokens.length : 0,
    requiredDecimalPlaces: decimalTokens ? decimalTokens.replace(/[^0]/g, '').length : undefined,
    showThousandsSeparator: integerPart.includes(','),
    scaleDivisor,
    integerToken: integerPart,
    decimalToken: decimalTokens
  };
}

function formatScientificNumber(
  value: number,
  pattern: string | undefined,
  literalOptions: { omitPercentLiteral?: boolean; omitPermilleLiteral?: boolean; unitSymbol?: string } = {}
): string {
  if (!pattern || !Number.isFinite(value)) {
    return '';
  }

  const section = stripLeadingCustomNumberMarkers(selectCustomNumberSection(pattern, value));
  const scientificMatch = findScientificNumberPlaceholder(section);
  if (!scientificMatch) {
    return '';
  }

  const mantissaPattern = scientificMatch.mantissaPattern;
  const exponentSign = scientificMatch.exponentSign;
  const exponentPattern = scientificMatch.exponentPattern;
  const placeholderStart = scientificMatch.index;
  const placeholderEnd = placeholderStart + scientificMatch.length;
  const prefix = customNumberLiteralText(section.slice(0, placeholderStart), literalOptions);
  const suffix = customNumberLiteralText(section.slice(placeholderEnd), literalOptions);
  const decimalPart = mantissaPattern.split('.', 2)[1] ?? '';
  const decimalPlaces = decimalPart.replace(/[^0#?]/g, '').length;
  const requiredDecimalPlaces = decimalPart.replace(/[^0]/g, '').length;
  const [mantissaRaw = '0', exponentRaw = '0'] = Math.abs(value).toExponential(decimalPlaces).split('e');
  const mantissa = trimOptionalDecimalPlaces(mantissaRaw, requiredDecimalPlaces);
  const exponent = Number(exponentRaw);
  const exponentPrefix = exponent < 0 ? '-' : exponentSign === '+' ? '+' : '';
  const exponentDigits = String(Math.abs(exponent)).padStart(exponentPattern.length, '0');
  const body = `${mantissa}E${exponentPrefix}${exponentDigits}`;
  const handlesNegative = value < 0 && (prefix.includes('-') || suffix.includes('-') || prefix.includes('(') || suffix.includes(')'));
  return `${handlesNegative || value >= 0 ? '' : '-'}${prefix}${body}${literalOptions.unitSymbol ?? ''}${suffix}`;
}

function formatFractionNumber(
  value: number,
  pattern: string | undefined,
  literalOptions: { omitPercentLiteral?: boolean; omitPermilleLiteral?: boolean; unitSymbol?: string } = {}
): string {
  if (!pattern || !Number.isFinite(value)) {
    return '';
  }

  const section = stripLeadingCustomNumberMarkers(selectCustomNumberSection(pattern, value));
  const fractionMatch = findFractionNumberPlaceholder(section);
  if (!fractionMatch) {
    return '';
  }

  const placeholder = fractionMatch.placeholder;
  const parts = placeholder.trim().split(/\s+/, 2);
  const mixed = parts.length === 2;
  const wholeToken = mixed ? (parts[0] ?? '') : '';
  const fractionPart = mixed ? (parts[1] ?? '') : placeholder;
  const numeratorToken = fractionPart.split('/', 2)[0] ?? '';
  const denominatorToken = fractionPart.split('/', 2)[1] ?? '';
  if (!denominatorToken) {
    return '';
  }

  const absolute = Math.abs(value);
  let whole = mixed ? Math.floor(absolute) : 0;
  const fractional = mixed ? absolute - whole : absolute;
  const fixedDenominator = /^\d+$/.test(denominatorToken) ? Math.max(1, Number(denominatorToken)) : undefined;
  const fraction = fixedDenominator
    ? approximateFixedDenominatorFraction(fractional, fixedDenominator)
    : approximateFraction(fractional, Math.max(1, Math.pow(10, denominatorToken.length) - 1));
  if (mixed && fraction.numerator >= fraction.denominator) {
    whole += Math.floor(fraction.numerator / fraction.denominator);
    fraction.numerator %= fraction.denominator;
  }
  const placeholderStart = fractionMatch.index;
  const placeholderEnd = placeholderStart + placeholder.length;
  const prefix = customNumberLiteralText(section.slice(0, placeholderStart), literalOptions);
  const suffix = customNumberLiteralText(section.slice(placeholderEnd), literalOptions);

  let body: string;
  const numeratorText = formatFractionPlaceholderNumber(fraction.numerator, numeratorToken);
  const denominatorText = formatFractionPlaceholderNumber(fraction.denominator, denominatorToken);
  const wholeText = formatWholePlaceholderNumber(whole, wholeToken);
  if (fraction.numerator === 0) {
    body = mixed ? wholeText || '0' : '0';
  } else if (mixed && wholeText) {
    body = `${wholeText} ${numeratorText}/${denominatorText}`;
  } else {
    body = `${numeratorText}/${denominatorText}`;
  }

  const handlesNegative = value < 0 && (prefix.includes('-') || suffix.includes('-') || prefix.includes('(') || suffix.includes(')'));
  return `${handlesNegative || value >= 0 ? '' : '-'}${prefix}${body}${literalOptions.unitSymbol ?? ''}${suffix}`;
}

function findScientificNumberPlaceholder(
  section: string
): { index: number; length: number; mantissaPattern: string; exponentSign: string; exponentPattern: string } | undefined {
  return findCustomPatternMatch(section, /^([#,0?]+(?:\.[#,0?]+)?)[Ee]([+-])([0#]+)/, (match, index) => ({
    index,
    length: match[0]?.length ?? 0,
    mantissaPattern: match[1] ?? '0',
    exponentSign: match[2] ?? '+',
    exponentPattern: match[3] ?? '0'
  }));
}

function findFractionNumberPlaceholder(section: string): { index: number; placeholder: string } | undefined {
  return findCustomPatternMatch(section, /^[#0?]+(?:\s+[#0?]+)?\/(?:[#0?]+|\d+)/, (match, index) => ({
    index,
    placeholder: match[0] ?? ''
  }));
}

function findCustomPatternMatch<T>(section: string, pattern: RegExp, map: (match: RegExpMatchArray, index: number) => T): T | undefined {
  let inQuotedText = false;
  let escaped = false;
  let bracketDepth = 0;
  for (let index = 0; index < section.length; index += 1) {
    const char = section[index] ?? '';
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inQuotedText = !inQuotedText;
      continue;
    }
    if (!inQuotedText && char === '[') {
      bracketDepth += 1;
      continue;
    }
    if (!inQuotedText && char === ']' && bracketDepth > 0) {
      bracketDepth -= 1;
      continue;
    }
    if (inQuotedText || bracketDepth > 0) {
      continue;
    }

    const match = section.slice(index).match(pattern);
    if (match) {
      return map(match, index);
    }
  }
  return undefined;
}

function approximateFixedDenominatorFraction(value: number, denominator: number): { numerator: number; denominator: number } {
  return {
    numerator: Math.max(0, Math.round(value * denominator)),
    denominator
  };
}

function formatWholePlaceholderNumber(value: number, token: string): string {
  if (!token) {
    return value > 0 ? String(value) : '';
  }
  if (value === 0 && !token.includes('0')) {
    return token.includes('?') ? ' '.repeat(token.length) : '';
  }
  return formatFractionPlaceholderNumber(value, token);
}

function formatFractionPlaceholderNumber(value: number, token: string): string {
  const text = String(value);
  if (!token.includes('?')) {
    return text;
  }
  return text.padStart(Math.max(token.length, text.length), ' ');
}

function approximateFraction(value: number, denominatorMax: number): { numerator: number; denominator: number } {
  let bestNumerator = 0;
  let bestDenominator = 1;
  let bestError = Number.POSITIVE_INFINITY;

  for (let denominator = 1; denominator <= denominatorMax; denominator += 1) {
    const numerator = Math.round(value * denominator);
    const error = Math.abs(value - numerator / denominator);
    if (error < bestError) {
      bestNumerator = numerator;
      bestDenominator = denominator;
      bestError = error;
    }
    if (bestError < 1e-9) {
      break;
    }
  }

  if (bestNumerator === 0) {
    return { numerator: 0, denominator: 1 };
  }

  const divisor = greatestCommonDivisor(bestNumerator, bestDenominator);
  return {
    numerator: bestNumerator / divisor,
    denominator: bestDenominator / divisor
  };
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(Math.trunc(left));
  let b = Math.abs(Math.trunc(right));
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a || 1;
}

function selectCustomNumberSection(pattern: string, value: number): string {
  const sections = splitCustomNumberSections(pattern);
  const conditionedSections = sections
    .map((section) => ({ section, condition: customNumberSectionCondition(section) }))
    .filter((entry): entry is { section: string; condition: CustomNumberCondition } => entry.condition != null);
  if (conditionedSections.length) {
    const matching = conditionedSections.find((entry) => evaluateCustomNumberCondition(value, entry.condition));
    if (matching) {
      return matching.section;
    }

    const fallback = sections.find((section) => !customNumberSectionCondition(section));
    if (fallback != null && fallback !== '') {
      return fallback;
    }
  }

  if (value < 0 && sections[1] != null && sections[1] !== '') {
    return sections[1] ?? '';
  }
  if (Math.abs(value) < 1e-9 && sections[2] != null && sections[2] !== '') {
    return sections[2] ?? '';
  }
  return sections[0] ?? '';
}

function splitCustomNumberSections(pattern: string): string[] {
  const sections: string[] = [];
  let current = '';
  let inQuotedText = false;
  let bracketDepth = 0;
  let escaped = false;

  for (const char of pattern) {
    if (escaped) {
      current += `\\${char}`;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inQuotedText = !inQuotedText;
      current += char;
      continue;
    }
    if (!inQuotedText && char === '[') {
      bracketDepth += 1;
      current += char;
      continue;
    }
    if (!inQuotedText && char === ']' && bracketDepth > 0) {
      bracketDepth -= 1;
      current += char;
      continue;
    }
    if (char === ';' && !inQuotedText && bracketDepth === 0) {
      sections.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  if (escaped) {
    current += '\\';
  }
  sections.push(current);
  return sections;
}

function stripLeadingCustomNumberMarkers(section: string): string {
  return section.slice(readLeadingCustomNumberMarkers(section).bodyStart);
}

function leadingCustomNumberCurrencyMarker(section: string): string {
  for (const content of readLeadingCustomNumberMarkers(section).markers) {
    if (content.startsWith('$') && content.length > 1) {
      const symbol = content.slice(1).split('-', 1)[0]?.trim() ?? '';
      if (symbol.length > 0) {
        return symbol;
      }
    }
  }
  return '';
}

function hasCustomCurrencyMarker(section: string): boolean {
  return findCustomNumberBracketMarkers(section).some((content) => currencySymbolFromCustomNumberMarker(content).length > 0);
}

function readCustomNumberMarkersBeforePlaceholder(section: string): string[] {
  const markers: string[] = [];
  let inQuotedText = false;
  let escaped = false;
  let markerStart = -1;

  for (let index = 0; index < section.length; index += 1) {
    const char = section[index] ?? '';
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inQuotedText = !inQuotedText;
      continue;
    }
    if (inQuotedText) {
      continue;
    }
    if (char === '[') {
      markerStart = index + 1;
      continue;
    }
    if (char === ']' && markerStart >= 0) {
      markers.push(section.slice(markerStart, index).trim());
      markerStart = -1;
      continue;
    }
    if (markerStart >= 0) {
      continue;
    }
    if (
      /[#0?]/.test(char) ||
      (section.slice(index, index + 7).toLowerCase() === 'general' &&
        isCustomGeneralTokenBoundary(section, index - 1) &&
        isCustomGeneralTokenBoundary(section, index + 7))
    ) {
      break;
    }
  }

  return markers;
}

function readLeadingCustomNumberMarkers(section: string): { markers: string[]; bodyStart: number } {
  const markers: string[] = [];
  let index = 0;

  while (index < section.length) {
    while (section[index] === ' ') {
      index += 1;
    }
    if (section[index] !== '[') {
      break;
    }

    const start = index + 1;
    let end = start;
    let escaped = false;
    while (end < section.length) {
      const char = section[end] ?? '';
      if (escaped) {
        escaped = false;
        end += 1;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        end += 1;
        continue;
      }
      if (char === ']') {
        break;
      }
      end += 1;
    }
    if (end >= section.length || section[end] !== ']') {
      break;
    }

    markers.push(section.slice(start, end).trim());
    index = end + 1;
  }

  return {
    markers,
    bodyStart: index
  };
}

interface CustomNumberCondition {
  operator: '<' | '<=' | '>' | '>=' | '=' | '<>';
  value: number;
}

function customNumberSectionCondition(section: string): CustomNumberCondition | undefined {
  for (const content of findCustomNumberBracketMarkers(section)) {
    const conditionMatch = content.match(/^(<=|>=|<>|<|>|=)\s*(-?(?:\d+\.?\d*|\.\d+))$/);
    if (!conditionMatch) {
      continue;
    }

    const value = Number(conditionMatch[2]);
    if (!Number.isFinite(value)) {
      continue;
    }
    return {
      operator: conditionMatch[1] as CustomNumberCondition['operator'],
      value
    };
  }
  return undefined;
}

function findCustomNumberBracketMarkers(section: string): string[] {
  const markers: string[] = [];
  let inQuotedText = false;
  let escaped = false;
  let markerStart = -1;

  for (let index = 0; index < section.length; index += 1) {
    const char = section[index] ?? '';
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inQuotedText = !inQuotedText;
      continue;
    }
    if (inQuotedText) {
      continue;
    }
    if (char === '[') {
      markerStart = index + 1;
      continue;
    }
    if (char === ']' && markerStart >= 0) {
      markers.push(section.slice(markerStart, index).trim());
      markerStart = -1;
    }
  }

  return markers;
}

function evaluateCustomNumberCondition(value: number, condition: CustomNumberCondition): boolean {
  switch (condition.operator) {
    case '<':
      return value < condition.value;
    case '<=':
      return value <= condition.value;
    case '>':
      return value > condition.value;
    case '>=':
      return value >= condition.value;
    case '=':
      return Math.abs(value - condition.value) < 1e-9;
    case '<>':
      return Math.abs(value - condition.value) >= 1e-9;
    default:
      return false;
  }
}

function trimOptionalDecimalPlaces(text: string, requiredDecimalPlaces: number): string {
  if (!text.includes('.')) {
    return text;
  }

  const sign = text.startsWith('-') ? '-' : '';
  const unsigned = sign ? text.slice(1) : text;
  const [integerPart, decimalPart = ''] = unsigned.split('.', 2);
  let decimals = decimalPart;
  while (decimals.length > requiredDecimalPlaces && decimals.endsWith('0')) {
    decimals = decimals.slice(0, -1);
  }
  return decimals.length ? `${sign}${integerPart}.${decimals}` : `${sign}${integerPart}`;
}

function applyNumberPlaceholderPadding(
  text: string,
  pattern: {
    integerToken?: string;
    decimalToken?: string;
  }
): string {
  const sign = text.startsWith('-') ? '-' : '';
  const unsigned = sign ? text.slice(1) : text;
  const [integerPartRaw, decimalPartRaw] = unsigned.split('.', 2);
  const integerPart = applyIntegerPlaceholderPadding(integerPartRaw, pattern.integerToken ?? '');
  const decimalPart =
    decimalPartRaw != null && pattern.decimalToken
      ? applyDecimalPlaceholderPadding(decimalPartRaw, pattern.decimalToken)
      : decimalPartRaw;
  return `${sign}${decimalPart != null && decimalPart.length ? `${integerPart}.${decimalPart}` : integerPart}`;
}

function applyIntegerPlaceholderPadding(text: string, token: string): string {
  if (!token.includes('?') && !(Number(text) === 0 && !token.includes('0'))) {
    return text;
  }
  const cleanToken = token.replace(/,/g, '');
  if (Number(text) === 0 && !cleanToken.includes('0')) {
    return cleanToken.includes('?') ? ' '.repeat(cleanToken.length) : '';
  }
  return cleanToken.includes('?') ? text.padStart(Math.max(cleanToken.length, text.length), ' ') : text;
}

function applyDecimalPlaceholderPadding(text: string, token: string): string {
  let output = text;
  while (output.length < token.length) {
    const placeholder = token[output.length];
    if (placeholder === '?') {
      output += ' ';
    } else if (placeholder === '0') {
      output += '0';
    } else {
      break;
    }
  }
  return output;
}

function hasExplicitDateTimeFormat(format: TableFormatEntry): boolean {
  return typeof format.dateTimeFormat === 'string' && format.dateTimeFormat.trim().length > 0;
}

function dateTimeFormatIncludesDate(format: string | undefined): boolean {
  if (!format) {
    return true;
  }
  const normalized = format.toLowerCase();
  return /y|d|q/.test(normalized);
}

function dateTimeFormatIncludesTime(format: string | undefined): boolean {
  if (!format) {
    return false;
  }
  const normalized = format.toLowerCase();
  return /h|s|am\/pm|a\/p/.test(normalized);
}

function dateTimeFormatIncludesDuration(format: string | undefined): boolean {
  if (!format) {
    return false;
  }
  let inQuotedText = false;
  let escaped = false;
  let index = 0;

  while (index < format.length) {
    const char = format[index] ?? '';
    if (escaped) {
      escaped = false;
      index += 1;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotedText = !inQuotedText;
      index += 1;
      continue;
    }
    if (!inQuotedText && char === "'") {
      const quotedLiteral = readIcuQuotedLiteral(format, index);
      if (quotedLiteral) {
        index += quotedLiteral.length;
        continue;
      }
    }
    if (!inQuotedText && char === '[') {
      const end = format.indexOf(']', index + 1);
      if (end > index) {
        const token = format.slice(index + 1, end).trim();
        if (/^(?:d+|h+|m+|s+)$/i.test(token)) {
          return true;
        }
        index = end + 1;
        continue;
      }
    }
    index += 1;
  }
  return false;
}

function resolvePercentScale(format: TableFormatEntry): number {
  const scale = format.scaleFactor;
  return typeof scale === 'number' && Number.isFinite(scale) && scale !== 0 ? scale : 100;
}

function currencyPrefix(code: string | undefined): string {
  const normalized = code?.trim().toUpperCase();
  switch (normalized) {
    case 'CNY':
    case 'RMB':
    case 'JPY':
      return '\u00a5';
    case 'EUR':
      return '\u20ac';
    case 'GBP':
      return '\u00a3';
    case 'USD':
      return '$';
    default:
      return normalized ? `${normalized} ` : '';
  }
}

function usesParenthesesForNegative(style: number | undefined, format?: TableFormatEntry): boolean {
  return format?.useAccountingStyle === true || style === 1 || style === 3;
}

function addThousandsSeparators(text: string): string {
  if (!text.length) {
    return text;
  }

  const sign = text.startsWith('-') ? '-' : '';
  const unsigned = sign ? text.slice(1) : text;
  const [integerPart, decimalPart] = unsigned.split('.', 2);
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decimalPart != null ? `${sign}${grouped}.${decimalPart}` : `${sign}${grouped}`;
}

function normalizeStoragePlainText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\uFFFC/g, '');
}

function resolveControlCellText(key: number, lookup: TableContentLookup): string {
  if (!Number.isFinite(key) || key <= 0 || key === 65535) {
    return '';
  }

  const itemIndex = Math.trunc(key) - 1;
  for (const menu of lookup.controlMenus) {
    const text = menu[itemIndex];
    if (typeof text === 'string' && text.trim().length > 0) {
      return text.trim();
    }
  }

  return '';
}

function resolvePopupMenuItemText(item: Record<string, unknown>): string {
  const stringValue = asObject(readField(item, ['stringValue', 'string_value']));
  return normalizeStoragePlainText(String(readField<string>(stringValue, ['value']) ?? ''));
}

function resolvePopupMenuTsceText(item: Record<string, unknown>): string {
  const direct = readField<string>(item, ['stringValue', 'string_value']);
  if (typeof direct === 'string') {
    return normalizeStoragePlainText(direct);
  }
  const value = asObject(readField(item, ['stringValue', 'string_value']));
  return normalizeStoragePlainText(String(readField<string>(value, ['value']) ?? ''));
}

function padNumber(value: number): string {
  return String(value).padStart(2, '0');
}

function readOptionalNumber(value: Record<string, unknown>, keys: string[]): number | undefined {
  const raw = readField<number>(value, keys);
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

function readOptionalBoolean(value: Record<string, unknown>, keys: string[]): boolean | undefined {
  const raw = readField<boolean>(value, keys);
  return typeof raw === 'boolean' ? raw : undefined;
}

function readOptionalString(value: Record<string, unknown>, keys: string[]): string | undefined {
  const raw = readField<string>(value, keys);
  return typeof raw === 'string' && raw.length ? raw : undefined;
}

function parseTableCell(type: IworkArchiveIndex['type'], rowInfo: Record<string, unknown>, column: number): TableCellInfo {
  const cellCount = Number(readField<number>(rowInfo, ['cellCount', 'cell_count']) ?? 0);
  if (type === 'numbers') {
    const offsets = decodeOffsets(readField(rowInfo, ['cellOffsets', 'cell_offsets']), cellCount);
    const regular = column < offsets.length ? parseTableCellFromBuffer(type, offsets, readField(rowInfo, ['cellStorageBuffer', 'cell_storage_buffer']), column, false) : emptyCell();
    const preOffsets = decodeOffsets(readField(rowInfo, ['cellOffsetsPreBnc', 'cell_offsets_pre_bnc']), cellCount);
    const fallback =
      column < preOffsets.length
        ? parseTableCellFromBuffer(type, preOffsets, readField(rowInfo, ['cellStorageBufferPreBnc', 'cell_storage_buffer_pre_bnc']), column, true)
        : emptyCell();
    return mergeNumbersCellInfo(regular, fallback);
  }

  const offsets = decodeOffsets(readField(rowInfo, ['cellOffsets', 'cell_offsets']), cellCount);
  if (column < offsets.length) {
    const info = parseTableCellFromBuffer(type, offsets, readField(rowInfo, ['cellStorageBuffer', 'cell_storage_buffer']), column, false);
    if (info.offset !== 65535) {
      return info;
    }
  }

  const preOffsets = decodeOffsets(readField(rowInfo, ['cellOffsetsPreBnc', 'cell_offsets_pre_bnc']), cellCount);
  if (column < preOffsets.length) {
    const info = parseTableCellFromBuffer(type, preOffsets, readField(rowInfo, ['cellStorageBufferPreBnc', 'cell_storage_buffer_pre_bnc']), column, true);
    if (info.offset !== 65535) {
      return info;
    }
  }

  return emptyCell();
}

function emptyCell(): TableCellInfo {
  return {
    offset: 65535,
    recordEnd: 0,
    keyOffset: -1,
    cellType: 0,
    styleKey: 0,
    contentKey: 0,
    formatKey: 0,
    numberValue: 0,
    hasNumber: false,
    usePreBnc: false
  };
}

function decodeOffsets(raw: unknown, _cellCount: number): number[] {
  const bytes = raw instanceof Uint8Array ? raw : raw ? Uint8Array.from(raw as number[]) : new Uint8Array(0);
  const count = Math.floor(bytes.length / 2);
  const offsets = new Array<number>(count);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < count; index += 1) {
    offsets[index] = view.getUint16(index * 2, true);
  }
  return offsets;
}

function parseTableCellFromBuffer(
  type: IworkArchiveIndex['type'],
  offsets: number[],
  rawBuffer: unknown,
  column: number,
  usePreBnc: boolean
): TableCellInfo {
  const buffer = rawBuffer instanceof Uint8Array ? rawBuffer : rawBuffer ? Uint8Array.from(rawBuffer as number[]) : new Uint8Array(0);
  const info: TableCellInfo = {
    offset: 65535,
    recordEnd: buffer.length,
    keyOffset: -1,
    cellType: 0,
    styleKey: 0,
    contentKey: 0,
    formatKey: 0,
    numberValue: 0,
    hasNumber: false,
    usePreBnc
  };

  if (column < 0 || column >= offsets.length) {
    return info;
  }

  const offset = offsets[column];
  if (offset === 65535 || offset >= buffer.length) {
    return info;
  }

  info.offset = offset;
  info.recordEnd = nextCellBoundary(offsets, column, buffer.length);
  info.cellType = buffer[offset + 1] ?? 0;

  if (type !== 'numbers') {
    const recordType = buffer[offset];
    if (recordType === 4) {
      if (offset + 16 <= buffer.length) {
        info.styleKey = readUint32(buffer, offset + 12);
      }

      let candidateKeyOffset = -1;
      if (offset + 6 <= buffer.length) {
        const flags = readUint16(buffer, offset + 4);
        const keyOffset = popcount(flags) * 4 + 8 + offset;
        if (keyOffset + 4 <= info.recordEnd && keyOffset + 4 <= buffer.length) {
          candidateKeyOffset = keyOffset;
        }
      }

      const candidate16 = offset + 20 <= Math.min(info.recordEnd, buffer.length) ? readUint32(buffer, offset + 16) : 0;
      const candidate20 = offset + 24 <= Math.min(info.recordEnd, buffer.length) ? readUint32(buffer, offset + 20) : 0;

      if (info.cellType === 2) {
        if (usePreBnc && candidateKeyOffset >= 0 && candidateKeyOffset + 12 <= info.recordEnd && candidate16 !== 0) {
          const trailingFormatKey = readUint32(buffer, candidateKeyOffset + 8);
          if (trailingFormatKey === candidate16) {
            info.keyOffset = candidateKeyOffset;
            info.formatKey = candidate16;
            info.numberValue = readFloat64(buffer, candidateKeyOffset);
            info.hasNumber = Number.isFinite(info.numberValue);
            info.contentKey = readUint32(buffer, candidateKeyOffset);
            return info;
          }
        }

        const decoded = decodeLegacyNumericCellValue(candidate16, candidate20);
        if (decoded != null) {
          info.keyOffset = offset + 16;
          info.numberValue = decoded;
          info.hasNumber = true;
          if (candidate20 === 0) {
            info.contentKey = candidate16;
          }
        } else if (candidate20 !== 0) {
          info.keyOffset = offset + 20;
          info.contentKey = candidate20;
        } else if (!usePreBnc && candidate16 !== 0) {
          info.keyOffset = offset + 16;
          info.contentKey = candidate16;
        }
      } else if (candidate20 !== 0) {
        info.keyOffset = offset + 20;
        info.contentKey = candidate20;
      } else if (candidate16 !== 0) {
        info.keyOffset = offset + 16;
        info.contentKey = candidate16;
      }
    } else if (recordType === 5) {
      const keyOffset = offset + 12;
      if (keyOffset + 4 <= info.recordEnd && keyOffset + 4 <= buffer.length) {
        info.keyOffset = keyOffset;
        info.contentKey = readUint32(buffer, keyOffset);
        info.styleKey = info.contentKey;
      }
    } else if (offset + 16 <= buffer.length) {
      info.keyOffset = offset + 12;
      info.contentKey = readUint32(buffer, info.keyOffset);
      info.styleKey = info.contentKey;
    }
    return info;
  }

  const recordType = buffer[offset];
  if (recordType === 4) {
    let keyOffset = info.recordEnd - 4;
    if (offset + 6 <= buffer.length) {
      const flags = readUint16(buffer, offset + 4);
      const candidateKeyOffset = popcount(flags) * 4 + 8 + offset;
      if (candidateKeyOffset + 4 <= info.recordEnd) {
        keyOffset = candidateKeyOffset;
      }
    }
    if (keyOffset < offset || keyOffset + 4 > info.recordEnd) {
      return info;
    }

    info.keyOffset = keyOffset;
    const rawValue = readUint32(buffer, keyOffset);
    if (usePreBnc && offset + 16 <= info.recordEnd) {
      info.formatKey = readUint32(buffer, offset + 12);
    }
    if (info.cellType === 2 || info.cellType === 5) {
      if (keyOffset + 8 <= info.recordEnd) {
        info.numberValue = readFloat64(buffer, keyOffset);
        info.hasNumber = Number.isFinite(info.numberValue);
      }
      if (info.cellType === 5) {
        info.contentKey = rawValue;
      }
    } else {
      info.contentKey = rawValue;
    }
    const styleKeys = collectStyleKeys(buffer, offset, keyOffset, info.contentKey);
    if (styleKeys.length) {
      info.styleKey = styleKeys[0] ?? 0;
    }
  } else if (recordType === 5) {
    const keyOffset = offset + 12;
    if (keyOffset + 4 > info.recordEnd) {
      return info;
    }
    info.keyOffset = keyOffset;
    if (info.cellType === 2) {
      info.numberValue = readInt32(buffer, keyOffset);
      info.hasNumber = true;
    } else if (info.cellType === 3 || info.cellType === 9) {
      info.contentKey = readUint32(buffer, keyOffset);
    } else if (info.cellType === 5) {
      info.contentKey = readUint32(buffer, keyOffset);
      info.numberValue = info.contentKey;
      info.hasNumber = true;
    } else {
      info.contentKey = readUint32(buffer, keyOffset);
    }

    if (keyOffset + 8 <= info.recordEnd && (info.cellType === 3 || info.cellType === 9)) {
      const candidateStyle = readUint32(buffer, keyOffset + 4);
      if (candidateStyle !== 0 && candidateStyle !== info.contentKey) {
        info.styleKey = candidateStyle;
      }
    }

    if (keyOffset + 8 <= info.recordEnd && (info.cellType === 2 || info.cellType === 5)) {
      info.numberValue = readInt32(buffer, keyOffset);
      info.hasNumber = true;
    }
  }

  return info;
}

function collectStyleKeys(buffer: Uint8Array, offset: number, keyOffset: number, key: number): number[] {
  if (keyOffset - offset < 8) {
    return [];
  }

  const keys: number[] = [];
  for (let position = keyOffset - 4; position >= offset + 8; position -= 4) {
    const value = readUint32(buffer, position);
    if (value === 0 || value === key || keys.includes(value)) {
      continue;
    }
    keys.push(value);
    if (keys.length === 2) {
      break;
    }
  }
  return keys;
}

function mergeNumbersCellInfo(primary: TableCellInfo, fallback: TableCellInfo): TableCellInfo {
  if (primary.offset === 65535) {
    return fallback;
  }
  if (fallback.offset === 65535) {
    return primary;
  }

  const merged = { ...primary };
  if (!hasRenderablePayload(merged) && hasRenderablePayload(fallback)) {
    return { ...fallback, styleKey: fallback.styleKey || primary.styleKey };
  }
  if (fallback.hasNumber) {
    merged.hasNumber = true;
    merged.numberValue = fallback.numberValue;
    if (fallback.formatKey) {
      merged.formatKey = fallback.formatKey;
    }
    merged.keyOffset = fallback.keyOffset;
    merged.usePreBnc = fallback.usePreBnc;
  }
  if ((!merged.contentKey || merged.contentKey === 65535) && fallback.contentKey && fallback.contentKey !== 65535) {
    merged.contentKey = fallback.contentKey;
  }
  if (!merged.styleKey && fallback.styleKey) {
    merged.styleKey = fallback.styleKey;
  }
  return merged;
}

function nextCellBoundary(offsets: number[], column: number, bufferLength: number): number {
  const current = offsets[column];
  if (current == null || current === 65535) {
    return bufferLength;
  }
  for (let index = column + 1; index < offsets.length; index += 1) {
    if (offsets[index] !== 65535 && offsets[index] > current) {
      return offsets[index];
    }
  }
  return bufferLength;
}

function popcount(value: number): number {
  let current = value;
  let total = 0;
  while (current !== 0) {
    current &= current - 1;
    total += 1;
  }
  return total;
}

function readUint16(buffer: Uint8Array, offset: number): number {
  return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getUint16(offset, true);
}

function readUint32(buffer: Uint8Array, offset: number): number {
  return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getUint32(offset, true);
}

function readInt32(buffer: Uint8Array, offset: number): number {
  return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getInt32(offset, true);
}

function readFloat64(buffer: Uint8Array, offset: number): number {
  return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getFloat64(offset, true);
}

function decodeLegacyNumericCellValue(lowBits: number, highBits: number): number | undefined {
  if (highBits !== 0) {
    const raw = new Uint8Array(8);
    const view = new DataView(raw.buffer);
    view.setUint32(0, lowBits, true);
    view.setUint32(4, highBits, true);
    const value = view.getFloat64(0, true);
    return Number.isFinite(value) ? value : undefined;
  }
  if (lowBits !== 0) {
    const raw = new Uint8Array(4);
    new DataView(raw.buffer).setUint32(0, lowBits, true);
    return new DataView(raw.buffer).getInt32(0, true);
  }
  return undefined;
}
