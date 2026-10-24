import { MediaRegistry, type TableItem } from '@filens/core';
import { appendSheetRows, createSheetTable, ROW_BATCH_SIZE, type ParsedSheet } from '@filens/xlsx';
import type {
  IworkFitMode,
  IworkViewerEventMap,
  IworkViewerEventName,
  IworkViewerInstance,
  IworkViewerOptions,
  IworkViewerState
} from '../types';
import { loadSourceBytes } from '../parser/load-source';
import { IworkWorkerClient } from '../worker/client';
import { createCanvasElement, createMediaRegistry, documentCanvases } from './render';

type EventHandler<T extends IworkViewerEventName> = (payload: IworkViewerEventMap[T]) => void;

export function createIworkViewer(container: HTMLElement, options: IworkViewerOptions = {}): IworkViewerInstance {
  const listeners = new Map<IworkViewerEventName, Set<(payload: unknown) => void>>();
  const worker = new IworkWorkerClient();
  const usePagedWidthFitByDefault = options.fit === undefined;
  let mediaRegistry: MediaRegistry | null = null;
  const state: IworkViewerState = {
    loading: false,
    error: null,
    kind: null,
    currentPage: 0,
    pageCount: 0,
    currentSheet: 0,
    sheetCount: 0,
    scale: options.initialScale ?? 1,
    fit: options.fit ?? 'contain',
    warnings: [],
    document: null
  };

  container.classList.add('iworkv-root');
  container.innerHTML = '<div class="iworkv-stage"></div>';
  const stage = container.querySelector('.iworkv-stage') as HTMLDivElement;
  let resizeObserver: ResizeObserver | null = null;
  let pageShells: HTMLDivElement[] = [];
  const mountedPages = new Map<number, HTMLElement>();
  const visiblePages = new Set<number>();
  const sheetLoads = new Map<number, Promise<void>>();
  let scrollFrame = 0;

  const emit = <T extends IworkViewerEventName>(event: T, payload: IworkViewerEventMap[T]) => {
    listeners.get(event)?.forEach((handler) => handler(payload));
  };

  const setStatus = () => {
    container.classList.toggle('is-loading', state.loading);
    container.classList.toggle('is-error', Boolean(state.error));
    container.dataset.status = state.error ?? (state.loading ? 'Loading document...' : '');
  };

  const getState = (): IworkViewerState => ({
    ...state,
    warnings: state.warnings.slice()
  });

  const render = () => {
    stage.innerHTML = '';
    stage.classList.toggle('iworkv-numbers-stage', state.document?.kind === 'numbers');
    pageShells = [];
    mountedPages.clear();
    visiblePages.clear();
    if (!state.document) {
      return;
    }

    const canvases = documentCanvases(state.document);
    if (!canvases.length) {
      return;
    }

    if (state.document.kind === 'numbers') {
      renderNumbers();
      return;
    }

    if (state.document.kind === 'key' || state.document.kind === 'pages') {
      const pages = document.createElement('div');
      pages.className = 'iworkv-pages';
      const bounds = stage.getBoundingClientRect();
      canvases.forEach((canvas, index) => {
        const shell = document.createElement('div');
        shell.className = 'iworkv-page-shell';
        applyCanvasScale(shell, canvas.width, canvas.height, resolveScale(canvas.width, canvas.height, bounds));
        shell.dataset.pageIndex = String(index);
        pages.appendChild(shell);
        pageShells.push(shell);
      });
      stage.appendChild(pages);
      visiblePages.add(state.currentPage);
      syncMountedPages();
      return;
    }
  };

  const renderNumbers = () => {
    if (state.document?.kind !== 'numbers') {
      return;
    }
    const preview = document.createElement('div');
    preview.className = 'xlsxv-preview';
    const tabs = document.createElement('div');
    tabs.className = 'xlsxv-sheet-tabs';
    state.document.sheets.forEach((sheet, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'xlsxv-sheet-tab';
      button.classList.toggle('is-active', index === state.currentSheet);
      button.textContent = sheet.name;
      button.addEventListener('click', () => goToSheet(index));
      tabs.appendChild(button);
    });

    const grid = document.createElement('div');
    grid.className = 'xlsxv-grid';
    const tables = document.createElement('div');
    tables.className = 'iworkv-numbers-tables';
    const activeSheet = state.document.sheets[state.currentSheet];
    const renderedTables = (activeSheet?.tables ?? []).map(({ item }, index) => {
      const sheet = numbersTableToSheet(item, index);
      const section = document.createElement('section');
      section.className = 'iworkv-numbers-table';
      // Keep offscreen tables searchable and mounted, but defer their layout.
      // Estimate the initial height from the grid's 26px rows until measured.
      section.style.containIntrinsicBlockSize = `auto ${(Math.min(Math.max(sheet.rowCount, 1), ROW_BATCH_SIZE) + 1) * 26}px`;
      if ((activeSheet?.tables.length ?? 0) > 1) {
        const title = document.createElement('h3');
        title.className = 'iworkv-numbers-table-title';
        title.textContent = `Table ${index + 1}`;
        section.appendChild(title);
      }
      const table = createSheetTable(sheet, Math.min(Math.max(sheet.rowCount, 1), ROW_BATCH_SIZE));
      decorateNumbersCells(table, item, mediaRegistry);
      section.appendChild(table);
      tables.appendChild(section);
      return { sheet, item, table, body: table.tBodies[0] };
    });
    const floatingItems = activeSheet?.canvas.slide.items.filter((item) => item.kind !== 'table') ?? [];
    if (activeSheet && floatingItems.length) {
      const section = document.createElement('section');
      const title = document.createElement('h3');
      title.className = 'iworkv-numbers-table-title';
      title.textContent = 'Sheet objects';
      const canvas = {
        ...activeSheet.canvas,
        slide: {
          ...activeSheet.canvas.slide,
          items: floatingItems
        }
      };
      const shell = createCanvasElement(document, state.document, canvas, mediaRegistry ?? undefined);
      const availableWidth = Math.max(stage.getBoundingClientRect().width - 32, 1);
      applyCanvasScale(shell, canvas.width, canvas.height, availableWidth / Math.max(canvas.width, 1));
      section.className = 'iworkv-numbers-objects';
      section.append(title, shell);
      tables.appendChild(section);
    }
    grid.appendChild(tables);
    grid.addEventListener('scroll', () => {
      if (grid.scrollHeight - grid.scrollTop - grid.clientHeight > grid.clientHeight * 2) {
        return;
      }
      for (const { sheet, item, table, body } of renderedTables) {
        const renderedRows = body.rows.length;
        if (renderedRows < sheet.rowCount) {
          appendSheetRows(body, sheet, renderedRows + 1, Math.min(renderedRows + ROW_BATCH_SIZE, sheet.rowCount));
          decorateNumbersCells(table, item, mediaRegistry);
        }
      }
    }, { passive: true });

    preview.replaceChildren(tabs, grid);
    stage.appendChild(preview);
  };

  const syncMountedPages = () => {
    if (!state.document || state.document.kind === 'numbers') {
      return;
    }

    const canvases = documentCanvases(state.document);
    const shouldVirtualize = options.virtual ?? state.document.kind === 'pages';
    const targetPages = shouldVirtualize
      ? visiblePages
      : new Set(pageShells.map((_, index) => index));
    for (const [index, element] of mountedPages) {
      if (!targetPages.has(index)) {
        element.remove();
        mountedPages.delete(index);
      }
    }
    for (const index of targetPages) {
      if (mountedPages.has(index)) {
        continue;
      }
      const shell = pageShells[index];
      const canvas = canvases[index];
      if (!shell || !canvas) {
        continue;
      }
      const content = createCanvasElement(document, state.document, canvas, mediaRegistry ?? undefined).firstElementChild;
      if (content) {
        shell.appendChild(content);
        applyCanvasScale(shell, canvas.width, canvas.height, state.scale);
        mountedPages.set(index, content as HTMLElement);
      }
    }
  };

  const trackVisiblePage = () => {
    scrollFrame = 0;
    if (!state.document || state.document.kind === 'numbers' || !pageShells.length) {
      return;
    }
    const viewport = resolveVisibleViewport(container);
    const viewportCenter = (viewport.top + viewport.bottom) / 2;
    const overscan = Math.max(viewport.height, 1);
    let nearestIndex = state.currentPage;
    let nearestDistance = Number.POSITIVE_INFINITY;
    visiblePages.clear();
    pageShells.forEach((shell, index) => {
      const rect = shell.getBoundingClientRect();
      if (rect.bottom >= viewport.top - overscan && rect.top <= viewport.bottom + overscan) {
        visiblePages.add(index);
      }
      const distance = Math.abs((rect.top + rect.bottom) / 2 - viewportCenter);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });
    if (!visiblePages.size) {
      visiblePages.add(nearestIndex);
    }
    syncMountedPages();
    if (nearestIndex === state.currentPage) {
      return;
    }
    state.currentPage = nearestIndex;
    emit('pagechange', getState());
  };

  const handleScroll = () => {
    if (scrollFrame || typeof requestAnimationFrame === 'undefined') {
      if (!scrollFrame) {
        trackVisiblePage();
      }
      return;
    }
    scrollFrame = requestAnimationFrame(trackVisiblePage);
  };

  container.addEventListener('scroll', handleScroll, { passive: true });
  container.ownerDocument.addEventListener('scroll', handleScroll, { capture: true, passive: true });
  container.ownerDocument.defaultView?.addEventListener('scroll', handleScroll, { passive: true });

  const scrollToPageCanvas = (index: number) => {
    if (!state.document || state.document.kind === 'numbers') {
      return;
    }
    const shell = stage.querySelector<HTMLElement>(`.iworkv-page-shell[data-page-index="${index}"]`);
    if (!shell) {
      return;
    }
    shell.scrollIntoView({
      block: 'nearest',
      inline: 'nearest'
    });
  };

  const resolveScale = (width: number, height: number, measuredBounds?: DOMRect): number => {
    if (state.fit === 'none') {
      return state.scale;
    }

    const bounds = measuredBounds ?? stage.getBoundingClientRect();
    // The stage owns 16px padding on each side. Keep the fit calculation in
    // sync with that padding so paged iWork canvases use the viewport.
    const availableWidth = Math.max(bounds.width - 32, 1);
    const availableHeight = Math.max(bounds.height - 32, 1);
    if (state.fit === 'width') {
      state.scale = availableWidth / Math.max(width, 1);
      return state.scale;
    }

    if (state.fit === 'height') {
      state.scale = availableHeight / Math.max(height, 1);
      return state.scale;
    }

    state.scale = Math.min(availableWidth / Math.max(width, 1), availableHeight / Math.max(height, 1));
    return state.scale;
  };

  const bindResizeObserver = () => {
    resizeObserver?.disconnect();
    resizeObserver = null;

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    resizeObserver = new ResizeObserver(() => {
      if (!state.document) {
        return;
      }
      if (state.fit === 'none') {
        return;
      }
      if (state.document.kind === 'numbers') {
        // The workbook grid fills its container through CSS. Rebuilding it on
        // resize repeats table layout and discards rows loaded by scrolling.
        // Only floating sheet objects have a canvas scale to update.
        const canvas = state.document.sheets[state.currentSheet]?.canvas;
        const shell = stage.querySelector<HTMLElement>('.iworkv-numbers-objects .iworkv-page-shell');
        if (canvas && shell) {
          const availableWidth = Math.max(stage.getBoundingClientRect().width - 32, 1);
          applyCanvasScale(shell, canvas.width, canvas.height, availableWidth / Math.max(canvas.width, 1));
        }
        return;
      }
      const bounds = stage.getBoundingClientRect();
      documentCanvases(state.document).forEach((canvas, index) => {
        const shell = pageShells[index];
        if (shell) applyCanvasScale(shell, canvas.width, canvas.height, resolveScale(canvas.width, canvas.height, bounds));
      });
      emit('scalechange', getState());
    });
    resizeObserver.observe(stage);
  };

  const loadSheet = (index: number) => {
    const numbers = state.document?.kind === 'numbers' ? state.document : null;
    if (!numbers || numbers.sheets[index]?.loaded !== false) {
      return;
    }
    if (state.currentSheet === index) {
      container.classList.add('is-loading');
      container.dataset.status = 'Loading sheet...';
    }
    if (sheetLoads.has(index)) {
      return;
    }
    const task = worker.parseSheet(index)
      .then((sheet) => {
        if (state.document !== numbers) {
          return;
        }
        numbers.sheets[index] = sheet;
        if (state.currentSheet === index) {
          render();
          setStatus();
        }
      })
      .catch((error) => {
        if (state.document !== numbers) {
          return;
        }
        const normalized = error instanceof Error ? error : new Error(String(error));
        if (state.currentSheet === index) {
          state.error = normalized.message;
          setStatus();
          emit('error', normalized);
        }
      })
      .finally(() => {
        sheetLoads.delete(index);
      });
    sheetLoads.set(index, task);
  };

  const preview: IworkViewerInstance['preview'] = async (source, previewOptions = {}) => {
    state.loading = true;
    state.error = null;
    setStatus();
    try {
      const bytes = await loadSourceBytes(source, { signal: previewOptions.signal });
      const document = await worker.parse(bytes, options.type, resolveSourceName(source));
      state.document = document;
      state.kind = document.kind;
      state.warnings = document.warnings.slice();
      // Paged iWork canvases are best read at viewport width. The toolbar
      // still exposes Fit for users who prefer the full canvas in view.
      if (usePagedWidthFitByDefault && (document.kind === 'key' || document.kind === 'pages') && state.fit === 'contain') {
        state.fit = 'width';
      }
      state.currentPage = 0;
      state.currentSheet = 0;
      sheetLoads.clear();
      state.pageCount = document.kind === 'numbers' ? 0 : document.kind === 'key' ? document.slides.length : document.pages.length;
      state.sheetCount = document.kind === 'numbers' ? document.sheets.length : 0;
      mediaRegistry?.destroy();
      mediaRegistry = createMediaRegistry(document);
      state.loading = false;
      render();
      bindResizeObserver();
      setStatus();
      emit('warnings', state.warnings);
      emit('rendered', getState());
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      state.loading = false;
      state.error = normalized.message;
      setStatus();
      emit('error', normalized);
    }
  };

  const setScale = (scale: number) => {
    if (state.kind === 'numbers') {
      return;
    }
    state.fit = 'none';
    state.scale = Math.max(options.minScale ?? 0.25, Math.min(scale, options.maxScale ?? 4));
    render();
    emit('scalechange', getState());
  };

  const fit = (mode: IworkFitMode = 'contain') => {
    if (state.kind === 'numbers') {
      return;
    }
    state.fit = mode;
    render();
    emit('scalechange', getState());
  };

  const on = <T extends IworkViewerEventName>(event: T, handler: EventHandler<T>) => {
    const handlers = listeners.get(event) ?? new Set<(payload: unknown) => void>();
    handlers.add(handler as (payload: unknown) => void);
    listeners.set(event, handlers);
    return () => {
      handlers.delete(handler as (payload: unknown) => void);
    };
  };

  const goToSheet = (index: number) => {
    state.currentSheet = Math.max(0, Math.min(index, Math.max(state.sheetCount - 1, 0)));
    state.error = null;
    render();
    setStatus();
    loadSheet(state.currentSheet);
    emit('sheetchange', getState());
  };

  return {
    preview,
    destroy() {
      listeners.clear();
      mediaRegistry?.destroy();
      mediaRegistry = null;
      resizeObserver?.disconnect();
      resizeObserver = null;
      container.removeEventListener('scroll', handleScroll);
      container.ownerDocument.removeEventListener('scroll', handleScroll, true);
      container.ownerDocument.defaultView?.removeEventListener('scroll', handleScroll);
      if (scrollFrame && typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(scrollFrame);
      }
      scrollFrame = 0;
      worker.destroy();
      container.classList.remove('iworkv-root', 'is-loading', 'is-error');
      container.removeAttribute('data-status');
      container.innerHTML = '';
    },
    setScale,
    fit,
    goToPage(index: number) {
      state.currentPage = Math.max(0, Math.min(index, Math.max(state.pageCount - 1, 0)));
      if (state.document && state.document.kind !== 'numbers') {
        visiblePages.clear();
        visiblePages.add(state.currentPage);
        syncMountedPages();
        scrollToPageCanvas(state.currentPage);
      } else {
        render();
      }
      emit('pagechange', getState());
    },
    goToSheet,
    next() {
      if (state.kind === 'numbers') {
        this.goToSheet(Math.min(state.currentSheet + 1, Math.max(state.sheetCount - 1, 0)));
      } else {
        this.goToPage(Math.min(state.currentPage + 1, Math.max(state.pageCount - 1, 0)));
      }
    },
    prev() {
      if (state.kind === 'numbers') {
        this.goToSheet(Math.max(0, state.currentSheet - 1));
      } else {
        this.goToPage(Math.max(0, state.currentPage - 1));
      }
    },
    getState,
    on
  };
}

function numbersTableToSheet(table: TableItem, index: number): ParsedSheet {
  const rows = new Map<number, ParsedSheet['rows'][number]>();
  for (const cell of table.cells) {
    if (cell.isMergedContinuation) {
      continue;
    }
    const rowIndex = cell.row + 1;
    const row = rows.get(rowIndex) ?? { index: rowIndex, cells: [] };
    row.cells.push({
      ref: `${rowIndex}:${cell.column + 1}`,
      row: rowIndex,
      column: cell.column + 1,
      value: cell.textFrame.paragraphs
        .map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
        .join('\n')
    });
    rows.set(rowIndex, row);
  }
  return {
    id: table.id,
    name: `Table ${index + 1}`,
    rows: [...rows.values()].sort((left, right) => left.index - right.index),
    columnCount: Math.max(table.columns.length, 1),
    rowCount: Math.max(table.rows.length, 1)
  };
}

function decorateNumbersCells(table: HTMLTableElement, item: TableItem, registry: MediaRegistry | null): void {
  if (!registry) {
    return;
  }
  for (const cell of item.cells) {
    if (cell.isMergedContinuation || cell.fill.type !== 'picture' || !cell.fill.mediaId) {
      continue;
    }
    const element = table.tBodies[0]?.rows[cell.row]?.cells[cell.column + 1];
    if (!element || element.querySelector('.iworkv-cell-image')) {
      continue;
    }
    const image = document.createElement('img');
    image.className = 'iworkv-cell-image';
    image.src = registry.getUrl(cell.fill.mediaId);
    image.alt = '';
    image.loading = 'lazy';
    element.prepend(image);
  }
}

function resolveSourceName(source: unknown): string | undefined {
  if (typeof source === 'string') {
    return extractSourceName(source);
  }

  if (typeof File !== 'undefined' && source instanceof File) {
    return source.name;
  }

  return undefined;
}

function extractSourceName(path: string): string | undefined {
  const normalized = path.split('?')[0]?.split('#')[0] ?? '';
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  const fileName = segments.at(-1);
  if (!fileName) {
    return undefined;
  }

  try {
    return decodeURIComponent(fileName);
  } catch {
    return fileName;
  }
}

function resolveVisibleViewport(container: HTMLElement): { top: number; bottom: number; height: number } {
  const ownerWindow = container.ownerDocument.defaultView;
  const containerRect = container.getBoundingClientRect();
  let top = ownerWindow ? 0 : containerRect.top;
  let bottom = ownerWindow ? ownerWindow.innerHeight : containerRect.bottom;

  for (let element: HTMLElement | null = container; element; element = element.parentElement) {
    const overflowY = ownerWindow?.getComputedStyle(element).overflowY ?? 'visible';
    if (!/^(auto|scroll|hidden|clip)$/.test(overflowY)) {
      continue;
    }
    const rect = element.getBoundingClientRect();
    top = Math.max(top, rect.top);
    bottom = Math.min(bottom, rect.bottom);
  }

  if (bottom <= top) {
    const fallbackTop = ownerWindow ? 0 : containerRect.top;
    const fallbackBottom = ownerWindow ? ownerWindow.innerHeight : containerRect.bottom;
    return {
      top: fallbackTop,
      bottom: fallbackBottom,
      height: Math.max(fallbackBottom - fallbackTop, 1)
    };
  }

  return { top, bottom, height: bottom - top };
}

function applyCanvasScale(shell: HTMLElement, width: number, height: number, scale: number): void {
  shell.style.width = `${width * scale}px`;
  shell.style.height = `${height * scale}px`;
  shell.style.position = 'relative';
  const inner = shell.firstElementChild as HTMLElement | null;
  if (!inner) {
    return;
  }
  inner.style.transform = `scale(${scale})`;
  inner.style.transformOrigin = 'top left';
}
