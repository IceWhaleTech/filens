import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildNumbersSheetAt, buildParsedDocument } from '../src/parser/semantic';
import { createIworkViewer } from '../src/viewer/create-iwork-viewer';
import type { IworkArchiveIndex, ParsedKeynoteDocument, ParsedPagesDocument } from '../src/types';

const parseMock = vi.fn();
const parseSheetMock = vi.fn();

vi.mock('../src/worker/client', () => ({
  IworkWorkerClient: class {
    parse = parseMock;
    parseSheet = parseSheetMock;
    destroy(): void {}
  }
}));

vi.mock('../src/parser/load-source', () => ({
  loadSourceBytes: vi.fn(async () => new Uint8Array([1, 2, 3]))
}));

function createPagesDocument(): ParsedPagesDocument {
  return {
    kind: 'pages',
    archive: {
      type: 'pages',
      records: {},
      references: {
        outgoing: {},
        incoming: {}
      },
      dataEntries: {},
      warnings: []
    },
    warnings: [],
    title: 'Doc',
    media: {},
    pages: [0, 1, 2].map((index) => ({
      id: `pages-${index + 1}`,
      index,
      width: 800,
      height: 1000,
      canvas: {
        id: `pages-${index + 1}`,
        title: `Page ${index + 1}`,
        width: 800,
        height: 1000,
        slide: {
          id: `pages-${index + 1}`,
          index,
          title: `Page ${index + 1}`,
          background: {
            type: 'solid',
            color: '#ffffff',
            alpha: 1
          },
          width: 800,
          height: 1000,
          items: [],
          warnings: []
        }
      },
      blocks: []
    }))
  };
}

function createKeynoteDocument(slideCount = 1): ParsedKeynoteDocument {
  const slides = Array.from({ length: slideCount }, (_, index) => ({
    id: `key-slide-${index + 1}`,
    index,
    title: `Slide ${index + 1}`,
    background: { type: 'solid' as const, color: '#ffffff', alpha: 1 },
    width: 800,
    height: 450,
    items: [],
    warnings: []
  }));
  return {
    kind: 'key',
    archive: {
      type: 'key',
      records: {},
      references: { outgoing: {}, incoming: {} },
      dataEntries: {},
      warnings: []
    },
    warnings: [],
    presentation: {
      size: { width: 800, height: 450 },
      theme: { colors: {}, fonts: {} },
      slides,
      media: {},
      warnings: []
    },
    slides: slides.map((slide) => ({
      id: slide.id,
      title: slide.title,
      width: slide.width,
      height: slide.height,
      slide
    }))
  };
}

describe('iWork viewer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    parseMock.mockReset();
    parseSheetMock.mockReset();
    document.body.innerHTML = '';
  });

  it('supports fit height scaling', async () => {
    parseMock.mockResolvedValue(createPagesDocument());
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', {
      configurable: true,
      value: 900
    });
    Object.defineProperty(container, 'clientHeight', {
      configurable: true,
      value: 600
    });
    document.body.appendChild(container);

    const viewer = createIworkViewer(container, {
      fit: 'height'
    });
    await viewer.preview(new Uint8Array([1, 2, 3]));

    expect(viewer.getState().fit).toBe('height');
    expect(viewer.getState().scale).toBeGreaterThan(0);
    viewer.destroy();
  });

  it('uses width fit for Keynote only when fit was not explicitly provided', async () => {
    parseMock.mockResolvedValue(createKeynoteDocument());
    const container = document.body.appendChild(document.createElement('div'));
    const defaultViewer = createIworkViewer(container);
    await defaultViewer.preview(new Uint8Array([1, 2, 3]));
    expect(defaultViewer.getState().fit).toBe('width');
    defaultViewer.destroy();

    parseMock.mockResolvedValue(createKeynoteDocument());
    const explicitViewer = createIworkViewer(container, { fit: 'contain' });
    await explicitViewer.preview(new Uint8Array([1, 2, 3]));
    expect(explicitViewer.getState().fit).toBe('contain');
    explicitViewer.destroy();
  });

  it('renders every Keynote slide in a continuous stack', async () => {
    parseMock.mockResolvedValue(createKeynoteDocument(3));
    const container = document.body.appendChild(document.createElement('div'));
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 600 });
    container.getBoundingClientRect = () => ({ top: 0, bottom: 600, height: 600 } as DOMRect);
    const viewer = createIworkViewer(container, { fit: 'contain' });
    await viewer.preview(new Uint8Array([1, 2, 3]));

    const shells = Array.from(container.querySelectorAll<HTMLElement>('.iworkv-page-shell'));
    expect(shells).toHaveLength(3);
    expect(shells.map((shell) => shell.childElementCount)).toEqual([1, 1, 1]);
    shells[0]!.getBoundingClientRect = () => ({ top: -1500, bottom: -1050, height: 450 } as DOMRect);
    shells[1]!.getBoundingClientRect = () => ({ top: 40, bottom: 490, height: 450 } as DOMRect);
    shells[2]!.getBoundingClientRect = () => ({ top: 1400, bottom: 1850, height: 450 } as DOMRect);

    container.dispatchEvent(new Event('scroll'));
    await vi.waitFor(() => expect(viewer.getState().currentPage).toBe(1));
    expect(shells.map((shell) => shell.childElementCount)).toEqual([1, 1, 1]);

    const scrollSpy = vi.fn();
    shells[2]!.scrollIntoView = scrollSpy;

    viewer.goToPage(2);

    expect(viewer.getState().currentPage).toBe(2);
    expect(shells.map((shell) => shell.childElementCount)).toEqual([1, 1, 1]);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    viewer.destroy();
  });

  it('passes source file name to the worker parser', async () => {
    parseMock.mockResolvedValue(createPagesDocument());
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', {
      configurable: true,
      value: 900
    });
    Object.defineProperty(container, 'clientHeight', {
      configurable: true,
      value: 600
    });
    document.body.appendChild(container);

    const viewer = createIworkViewer(container);
    await viewer.preview('https://example.com/files/Quarterly%20Report.pages?download=1');

    expect(parseMock).toHaveBeenCalledWith(expect.any(Uint8Array), undefined, 'Quarterly Report.pages');
    expect(viewer.getState().fit).toBe('width');
    viewer.destroy();
  });

  it('clamps goToSheet to sheet bounds', async () => {
    parseMock.mockResolvedValue({
      kind: 'numbers',
      archive: {
        type: 'numbers',
        records: {},
        references: {
          outgoing: {},
          incoming: {}
        },
        dataEntries: {},
        warnings: []
      },
      warnings: [],
      media: {},
      sheets: [0, 1].map((index) => ({
        id: `sheet-${index + 1}`,
        index,
        name: `Sheet ${index + 1}`,
        canvas: {
          id: `sheet-${index + 1}`,
          title: `Sheet ${index + 1}`,
          width: 800,
          height: 600,
          slide: {
            id: `sheet-${index + 1}`,
            index,
            title: `Sheet ${index + 1}`,
            background: {
              type: 'solid',
              color: '#ffffff',
              alpha: 1
            },
            width: 800,
            height: 600,
            items: [],
            warnings: []
          }
        },
        tables: []
      }))
    });

    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', {
      configurable: true,
      value: 900
    });
    Object.defineProperty(container, 'clientHeight', {
      configurable: true,
      value: 600
    });
    document.body.appendChild(container);

    const viewer = createIworkViewer(container);
    await viewer.preview(new Uint8Array([1, 2, 3]));
    viewer.goToSheet(99);
    expect(viewer.getState().currentSheet).toBe(1);
    viewer.goToSheet(-10);
    expect(viewer.getState().currentSheet).toBe(0);
    viewer.destroy();
  });

  it('renders Numbers sheets with the XLSX workbook grid', async () => {
    parseMock.mockResolvedValue({
      kind: 'numbers',
      archive: {
        type: 'numbers',
        records: {},
        references: { outgoing: {}, incoming: {} },
        dataEntries: {},
        warnings: []
      },
      warnings: [],
      media: {
        photo: {
          id: 'photo',
          path: 'Data/photo.png',
          contentType: 'image/png',
          data: new Uint8Array([137, 80, 78, 71])
        }
      },
      sheets: [{
        id: 'sheet-1',
        index: 0,
        name: 'Sheet 1',
        canvas: {
          id: 'sheet-1',
          title: 'Sheet 1',
          width: 800,
          height: 1200,
          slide: {
            id: 'sheet-1',
            index: 0,
            title: 'Sheet 1',
            background: { type: 'solid', color: '#ffffff', alpha: 1 },
            width: 800,
            height: 1200,
            items: [{
              id: 'floating-photo',
              kind: 'image',
              name: 'Floating photo',
              order: 1,
              groupPath: [],
              transform: { x: 20, y: 40, width: 160, height: 90, rotation: 0, flipH: false, flipV: false },
              fill: { type: 'none' },
              mediaId: 'photo'
            }],
            warnings: []
          }
        },
        tables: [{
          id: 'table-1',
          item: {
            id: 'table-1',
            columns: [120, 120],
            rows: [26],
            cells: [{
              row: 0,
              column: 0,
              rowSpan: 1,
              colSpan: 1,
              isMergedContinuation: false,
              fill: { type: 'picture', mediaId: 'photo' },
              textFrame: {
                paragraphs: [{ runs: [{ text: 'Revenue' }] }]
              }
            }]
          }
        }]
      }]
    });

    const container = document.body.appendChild(document.createElement('div'));
    const viewer = createIworkViewer(container);
    await viewer.preview(new Uint8Array([1, 2, 3]));

    expect(container.querySelector('.xlsxv-sheet-tab')?.textContent).toBe('Sheet 1');
    expect(container.querySelector('.xlsxv-table')?.textContent).toContain('Revenue');
    expect(container.querySelector<HTMLImageElement>('.iworkv-cell-image')?.loading).toBe('lazy');
    expect(container.querySelector('.iworkv-numbers-objects .pptxv-item--image')).not.toBeNull();
    viewer.destroy();
  });

  it('preserves scrolled Numbers rows while resizing floating sheet objects', async () => {
    let notifyResize!: ResizeObserverCallback;
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { notifyResize = callback; }
      observe(): void {}
      disconnect(): void {}
    });
    let width = 832;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() =>
      ({ x: 0, y: 0, top: 0, left: 0, width, height: 600, right: width, bottom: 600 }) as DOMRect);
    const canvas = createPagesDocument().pages[0].canvas;
    canvas.slide.items.push({
      id: 'shape', kind: 'shape', shapeType: 'rect', order: 0, groupPath: [],
      transform: { x: 0, y: 0, width: 50, height: 50, rotation: 0, flipH: false, flipV: false },
      fill: { type: 'solid', color: '#ff0000' }
    });
    parseMock.mockResolvedValue({
      kind: 'numbers', archive: { records: {} }, media: {}, warnings: [],
      sheets: [{ id: 'one', name: 'One', index: 0, canvas, tables: [{ id: 'table', item: {
        id: 'table', columns: [100], rows: Array.from({ length: 200 }, () => 26),
        cells: [0, 199].map(row => ({
          row, column: 0, fill: { type: 'none' },
          textFrame: { paragraphs: [{ runs: [{ text: row === 0 ? 'First' : 'Last' }] }] }
        }))
      } }] }]
    });
    const container = document.body.appendChild(document.createElement('div'));
    const viewer = createIworkViewer(container);
    await viewer.preview(new Uint8Array([1, 2, 3]));
    const table = container.querySelector<HTMLTableElement>('.xlsxv-table')!;
    const grid = container.querySelector<HTMLElement>('.xlsxv-grid')!;
    expect(table.tBodies[0].rows).toHaveLength(100);
    Object.defineProperties(grid, { scrollHeight: { value: 6000 }, clientHeight: { value: 800 } });
    grid.scrollTop = 5200;
    grid.dispatchEvent(new Event('scroll'));
    expect(table.tBodies[0].rows).toHaveLength(200);
    const resized = () => notifyResize([], {} as ResizeObserver);
    resized();
    width = 432;
    resized();
    expect(container.querySelector('.xlsxv-table')).toBe(table);
    expect(table.tBodies[0].rows).toHaveLength(200);
    expect(table.tBodies[0].rows[199].textContent).toContain('Last');
    expect(grid.scrollTop).toBe(5200);
    const shell = container.querySelector<HTMLElement>('.iworkv-numbers-objects .iworkv-page-shell')!;
    expect(shell.style.width).toBe('400px');
    expect((shell.firstElementChild as HTMLElement).style.transform).toBe('scale(0.5)');
    viewer.destroy();
  });

  it('resizes mounted pages without replacing their content or resetting visible pages', async () => {
    let notifyResize!: ResizeObserverCallback;
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { notifyResize = callback; }
      observe(): void {}
      disconnect(): void {}
    });
    let width = 832;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() =>
      ({ top: 0, left: 0, width, height: 600, right: width, bottom: 600 }) as DOMRect);
    parseMock.mockResolvedValue(createPagesDocument());
    const container = document.body.appendChild(document.createElement('div'));
    const viewer = createIworkViewer(container);
    await viewer.preview(new Uint8Array([1, 2, 3]));
    const shells = Array.from(container.querySelectorAll<HTMLElement>('.iworkv-page-shell'));
    shells[2].scrollIntoView = vi.fn();
    viewer.goToPage(2);
    const content = shells[2].firstElementChild as HTMLElement;
    width = 432;
    notifyResize([], {} as ResizeObserver);
    expect(viewer.getState().currentPage).toBe(2);
    expect(shells[2].firstElementChild).toBe(content);
    expect(shells.map(shell => shell.childElementCount)).toEqual([0, 0, 1]);
    expect(shells[2].style.width).toBe('400px');
    expect(content.style.transform).toBe('scale(0.5)');
    expect(viewer.getState().scale).toBe(0.5);
    viewer.destroy();
  });

  it('loads placeholder Numbers sheets on demand', async () => {
    const archive: IworkArchiveIndex = {
      type: 'numbers',
      records: {
        '1': { id: 1, archiveId: 1, messageIndex: 0, typeId: 1, typeName: 'TN.DocumentArchive', value: { sheets: [{ identifier: 2 }, { identifier: 3 }] }, objectReferences: [], dataReferences: [] },
        '2': { id: 2, archiveId: 1, messageIndex: 1, typeId: 2, typeName: 'TN.SheetArchive', value: { name: 'One', drawableInfos: [] }, objectReferences: [], dataReferences: [] },
        '3': { id: 3, archiveId: 1, messageIndex: 2, typeId: 2, typeName: 'TN.SheetArchive', value: { name: 'Two', drawableInfos: [] }, objectReferences: [], dataReferences: [] }
      },
      references: { outgoing: {}, incoming: {} },
      dataEntries: {},
      warnings: []
    };
    const context = { archive, media: {} };
    const numbersDocument = buildParsedDocument(context, { numbersSheetIndexes: new Set([0]) });
    if (numbersDocument.kind !== 'numbers') {
      throw new Error('Expected Numbers document.');
    }
    const secondSheet = buildNumbersSheetAt(context, 1);
    expect(numbersDocument.sheets.map((sheet) => sheet.loaded)).toEqual([true, false]);
    parseMock.mockResolvedValue(numbersDocument);
    parseSheetMock.mockResolvedValue(secondSheet);

    const container = document.body.appendChild(document.createElement('div'));
    const viewer = createIworkViewer(container);
    await viewer.preview(new Uint8Array([1, 2, 3]));
    expect(parseSheetMock).not.toHaveBeenCalled();
    container.querySelectorAll<HTMLButtonElement>('.xlsxv-sheet-tab')[1]!.click();
    await vi.waitFor(() => expect(viewer.getState().document?.kind === 'numbers' && viewer.getState().document.sheets[1]?.loaded).toBe(true));

    expect(parseSheetMock).toHaveBeenCalledWith(1);
    viewer.destroy();
  });

  it('scrolls to target pages in pages mode when goToPage is called', async () => {
    parseMock.mockResolvedValue(createPagesDocument());
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', {
      configurable: true,
      value: 1200
    });
    Object.defineProperty(container, 'clientHeight', {
      configurable: true,
      value: 900
    });
    document.body.appendChild(container);

    const viewer = createIworkViewer(container, {
      fit: 'contain'
    });
    await viewer.preview(new Uint8Array([1, 2, 3]));

    const shells = Array.from(container.querySelectorAll<HTMLElement>('.iworkv-page-shell'));
    expect(shells).toHaveLength(3);
    expect(shells.map((shell) => shell.childElementCount)).toEqual([1, 0, 0]);
    const scrollSpy = vi.fn();
    shells[2].scrollIntoView = scrollSpy;

    viewer.goToPage(2);

    expect(viewer.getState().currentPage).toBe(2);
    expect(shells.map((shell) => shell.childElementCount)).toEqual([0, 0, 1]);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    viewer.destroy();
  });

  it('mounts Pages content when an outer scroll container reveals its shell', async () => {
    parseMock.mockResolvedValue(createPagesDocument());
    const container = document.body.appendChild(document.createElement('div'));
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 3000 });
    container.getBoundingClientRect = () => ({ top: -1000, bottom: 2000, height: 3000 } as DOMRect);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(900);

    const viewer = createIworkViewer(container, { virtual: true });
    await viewer.preview(new Uint8Array([1, 2, 3]));
    const shells = Array.from(container.querySelectorAll<HTMLElement>('.iworkv-page-shell'));
    expect(shells.map((shell) => shell.childElementCount)).toEqual([1, 0, 0]);
    shells[0]!.getBoundingClientRect = () => ({ top: -2100, bottom: -1100, height: 1000 } as DOMRect);
    shells[1]!.getBoundingClientRect = () => ({ top: 20, bottom: 1020, height: 1000 } as DOMRect);
    shells[2]!.getBoundingClientRect = () => ({ top: 2000, bottom: 3000, height: 1000 } as DOMRect);

    document.dispatchEvent(new Event('scroll'));
    await vi.waitFor(() => expect(shells[1]!.childElementCount).toBe(1));
    expect(shells.map((shell) => shell.childElementCount)).toEqual([0, 1, 0]);

    viewer.destroy();
  });
});
