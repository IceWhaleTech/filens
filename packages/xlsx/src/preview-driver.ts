import {
  createDefaultPreviewRoutes,
  type FormatDefinition,
  type PreviewDriver,
  type PreviewEventMap,
  type PreviewEventName,
  type PreviewLoadContext,
  type PreviewOptions,
  type PreviewSession,
  type PreviewSource,
  type WorkbookPreviewState
} from '@filens/core';
import { loadXlsxWorkbook, resolveCellValue } from './parser';
import type { ParsedRow, ParsedSheet, ParsedWorkbook } from './types';

type PreviewListenerMap = {
  [K in PreviewEventName]: Set<(payload: PreviewEventMap[K]) => void>;
};

export const ROW_BATCH_SIZE = 100;

export const XLSX_FORMAT_ROUTES: FormatDefinition[] = [
  {
    extensions: ['xlsx'],
    family: 'workbook',
    driverId: 'xlsx',
    targetFormat: 'xlsx'
  },
  {
    extensions: ['csv'],
    family: 'workbook',
    driverId: 'xlsx',
    targetFormat: 'csv',
    contentTypes: ['text/csv', 'application/csv']
  }
];

export class XlsxPreviewSession implements PreviewSession<WorkbookPreviewState> {
  private readonly listeners: PreviewListenerMap = {
    loading: new Set(),
    rendered: new Set(),
    error: new Set(),
    statechange: new Set(),
    warnings: new Set()
  };
  private readonly root: HTMLDivElement;
  private readonly tabs: HTMLDivElement;
  private readonly grid: HTMLDivElement;
  private workbook: ParsedWorkbook | null = null;
  private loadGeneration = 0;
  private loadController?: AbortController;
  private removeAbortListener?: () => void;
  private state: WorkbookPreviewState;

  constructor(private readonly host: HTMLElement, options: PreviewOptions = {}) {
    this.root = document.createElement('div');
    this.root.className = 'xlsxv-preview';
    this.tabs = document.createElement('div');
    this.tabs.className = 'xlsxv-sheet-tabs';
    this.grid = document.createElement('div');
    this.grid.className = 'xlsxv-grid';
    this.root.replaceChildren(this.tabs, this.grid);
    this.host.replaceChildren(this.root);
    this.grid.addEventListener('scroll', this.handleGridScroll, { passive: true });
    this.state = {
      loading: false,
      error: null,
      family: 'workbook',
      warnings: [],
      capabilities: {
        workbook: true,
        sheets: true,
        search: true,
        download: true
      },
      activeSheetIndex: 0,
      sheets: [],
      scale: options.initialScale ?? 1
    };
  }

  async load(source: PreviewSource, context: PreviewLoadContext): Promise<void> {
    const generation = ++this.loadGeneration;
    this.loadController?.abort();
    this.removeAbortListener?.();
    this.releaseWorkbook();
    const controller = new AbortController();
    this.loadController = controller;
    const signal = context.signal;
    const abort = () => {
      controller.abort();
      if (generation === this.loadGeneration) {
        this.releaseWorkbook();
        this.state.loading = false;
        this.emit('statechange', this.state);
      }
    };
    signal?.addEventListener('abort', abort, { once: true });
    this.removeAbortListener = () => signal?.removeEventListener('abort', abort);
    this.state = {
      ...this.state,
      loading: true,
      error: null,
      title: context.descriptor.name,
      warnings: []
    };
    this.emit('loading', this.state);
    this.emit('statechange', this.state);

    try {
      if (signal?.aborted) abort();
      const workbook = await loadXlsxWorkbook(source, { ...context, signal: controller.signal });
      if (generation !== this.loadGeneration) return;
      if (controller.signal.aborted) throw new DOMException('Workbook preview aborted.', 'AbortError');
      this.workbook = workbook;
      this.state = {
        ...this.state,
        loading: false,
        error: null,
        warnings: this.workbook.warnings.slice(),
        activeSheetIndex: 0,
        sheets: this.workbook.sheets.map((sheet, index) => ({
          id: sheet.id || String(index + 1),
          name: sheet.name
        }))
      };
      this.render();
      if (this.state.warnings.length) {
        this.emit('warnings', this.state.warnings);
      }
      this.emit('rendered', this.state);
      this.emit('statechange', this.state);
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      this.releaseWorkbook();
      this.state.loading = false;
      if (controller.signal.aborted) throw new DOMException('Workbook preview aborted.', 'AbortError');
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      this.state.error = normalizedError.message;
      this.emit('error', normalizedError);
      this.emit('statechange', this.state);
      throw normalizedError;
    }
  }

  destroy(): void {
    this.loadGeneration++;
    this.loadController?.abort();
    this.removeAbortListener?.();
    this.releaseWorkbook();
    this.state.loading = false;
    this.grid.removeEventListener('scroll', this.handleGridScroll);
    this.root.replaceChildren();
    if (this.root.parentElement === this.host) {
      this.host.replaceChildren();
    }
    for (const listeners of Object.values(this.listeners)) listeners.clear();
  }

  getState(): WorkbookPreviewState {
    return {
      ...this.state,
      warnings: this.state.warnings.slice(),
      sheets: this.state.sheets.slice()
    };
  }

  on<T extends PreviewEventName>(event: T, handler: (payload: PreviewEventMap[T]) => void): () => void {
    this.listeners[event].add(handler as never);
    return () => {
      this.listeners[event].delete(handler as never);
    };
  }

  goToPage(index: number): void {
    this.goToSheet(index);
  }

  next(): void {
    this.goToSheet(Math.min(this.state.activeSheetIndex + 1, Math.max(this.state.sheets.length - 1, 0)));
  }

  prev(): void {
    this.goToSheet(Math.max(this.state.activeSheetIndex - 1, 0));
  }

  private goToSheet(index: number): void {
    if (!Number.isInteger(index) || !this.workbook) return;
    const nextIndex = Math.max(0, Math.min(index, Math.max(this.state.sheets.length - 1, 0)));
    if (nextIndex === this.state.activeSheetIndex) {
      return;
    }
    this.state.activeSheetIndex = nextIndex;
    this.render();
    this.emit('statechange', this.state);
  }

  private render(): void {
    this.renderTabs();
    this.renderActiveSheet();
  }

  private renderTabs(): void {
    this.tabs.replaceChildren();
    for (const [index, sheet] of this.state.sheets.entries()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'xlsxv-sheet-tab';
      button.classList.toggle('is-active', index === this.state.activeSheetIndex);
      button.textContent = sheet.name;
      button.addEventListener('click', () => this.goToSheet(index));
      this.tabs.appendChild(button);
    }
  }

  private renderActiveSheet(): void {
    const sheet = this.workbook?.sheets[this.state.activeSheetIndex];
    this.grid.replaceChildren();
    this.grid.scrollTop = this.grid.scrollLeft = 0;
    if (!sheet) {
      return;
    }
    this.grid.appendChild(createSheetTable(sheet, Math.min(Math.max(sheet.rowCount, 1), ROW_BATCH_SIZE)));
  }

  private readonly handleGridScroll = () => {
    const sheet = this.workbook?.sheets[this.state.activeSheetIndex];
    const body = this.grid.querySelector('tbody');
    if (!sheet || !body || this.grid.scrollHeight - this.grid.scrollTop - this.grid.clientHeight > this.grid.clientHeight * 2) {
      return;
    }

    const renderedRows = body.rows.length;
    const totalRows = Math.max(sheet.rowCount, 1);
    if (renderedRows >= totalRows) {
      return;
    }
    // ponytail: rows stay mounted after loading; switch to windowed rows if million-row sheets become a real use case.
    appendSheetRows(body, sheet, renderedRows + 1, Math.min(renderedRows + ROW_BATCH_SIZE, totalRows));
  };

  private releaseWorkbook(): void {
    this.workbook = null;
    this.tabs.replaceChildren();
    this.grid.replaceChildren();
    this.grid.scrollTop = this.grid.scrollLeft = 0;
    this.state.activeSheetIndex = 0;
    this.state.sheets = [];
  }

  private emit<T extends PreviewEventName>(event: T, payload: PreviewEventMap[T]): void {
    for (const handler of this.listeners[event]) {
      handler(payload as never);
    }
  }
}

export function createXlsxPreviewDriver(): PreviewDriver<WorkbookPreviewState> {
  return {
    id: 'xlsx',
    family: 'workbook',
    supports: (format) => ['xlsx', 'csv'].includes(normalizeFormat(format)),
    createSession: (host, options) => new XlsxPreviewSession(host, options)
  };
}

export function createXlsxPreviewRoutes(baseRoutes = createDefaultPreviewRoutes()): FormatDefinition[] {
  return [
    ...XLSX_FORMAT_ROUTES,
    ...baseRoutes.filter((route) => !route.extensions.some((extension) => extension === 'xlsx' || (extension === 'csv' && !route.conversion?.required)))
  ];
}

export function createSheetTable(sheet: ParsedSheet, rowCount = Math.max(sheet.rowCount, 1)): HTMLTableElement {
  const table = document.createElement('table');
  table.className = 'xlsxv-table';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const corner = document.createElement('th');
  corner.className = 'xlsxv-corner';
  headerRow.appendChild(corner);
  for (let column = 1; column <= Math.max(sheet.columnCount, 1); column += 1) {
    const header = document.createElement('th');
    header.className = 'xlsxv-col-header';
    header.textContent = columnIndexToName(column);
    headerRow.appendChild(header);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  appendSheetRows(tbody, sheet, 1, rowCount);
  table.appendChild(tbody);
  return table;
}

export function appendSheetRows(tbody: HTMLTableSectionElement, sheet: ParsedSheet, firstRow: number, lastRow: number): void {
  if (firstRow > lastRow) return;
  // Index only this batch. Preserve unordered/duplicate rows and caller edits
  // without allocating a complete-sheet map on every scroll.
  const rowMap = new Map<number, ParsedRow>();
  for (const row of sheet.rows) {
    if (row.index >= firstRow && row.index <= lastRow) rowMap.set(row.index, row);
  }
  const fragment = document.createDocumentFragment();
  for (let rowIndex = firstRow; rowIndex <= lastRow; rowIndex += 1) {
    const row = rowMap.get(rowIndex);
    const tr = document.createElement('tr');
    const rowHeader = document.createElement('th');
    rowHeader.className = 'xlsxv-row-header';
    rowHeader.textContent = String(rowIndex);
    tr.appendChild(rowHeader);
    const cells = new Map(row?.cells.map((cell) => [cell.column, cell]) ?? []);
    for (let column = 1; column <= Math.max(sheet.columnCount, 1); column += 1) {
      const td = document.createElement('td');
      td.className = 'xlsxv-cell';
      const cell = cells.get(column);
      td.textContent = cell ? resolveCellValue(sheet, cell) : '';
      tr.appendChild(td);
    }
    fragment.appendChild(tr);
  }
  tbody.appendChild(fragment);
}

function normalizeFormat(format: string): string {
  return format.trim().replace(/^\./, '').toLowerCase();
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
