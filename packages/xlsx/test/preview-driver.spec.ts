import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { appendSheetRows, createSheetTable, createXlsxPreviewDriver, createXlsxPreviewRoutes, loadCsvWorkbook, loadXlsxWorkbook, resolveCellValue, type ParsedSheet } from '../src';

describe('XLSX preview driver', () => {
  it('returns identical cells for the fast and general worksheet parsers', async () => {
    const zip = await JSZip.loadAsync(await createWorkbookFixture());
    const rows = Array.from({ length: 500 }, (_, index) => {
      const r = index * 3 + 1;
      return `<row r='${r}' spans="1:5"><c s="2" r='A${r}'><v> ${index - 200}.125e-2 </v></c>` +
        `<c r="B${r}" t="s"><v>0</v></c><c r="C${r}" t="b"><v>${index % 2 ? 'true' : '0'}</v></c>` +
        `<c r="D${r}"/><c r="E${r}"><v/></c></row>`;
    }).join('\n');
    const xml = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>\n${rows}\n</sheetData></worksheet>`;
    zip.file('xl/worksheets/sheet1.xml', xml);
    const fast = await loadXlsxWorkbook(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
    zip.file('xl/worksheets/sheet1.xml', xml.replace('<sheetData>', '<sheetData><!-- general parser -->'));
    const general = await loadXlsxWorkbook(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
    expect(fast).toEqual(general);
    expect(fast.sheets[0].rows.at(-1)?.cells[0].value).toBe(' 299.125e-2 ');
    expect(fast.sheets[0].rowCount).toBe(1498);
  });

  it('preserves CRLF, blank rows, trailing fields and BOM in unquoted CSV', async () => {
    const workbook = await loadCsvWorkbook(new TextEncoder().encode('\uFEFFa,b,\r\n\r\nc,d,\r'));
    expect(workbook.sheets[0].rows.map(row => row.cells.map(cell => cell.value)))
      .toEqual([['a', 'b', ''], [''], ['c', 'd', '']]);
  });

  it.each(['""', 'a\n""', '""\r\n""', '\uFEFF""'])('preserves a final empty quoted CSV record: %j', async text => {
    const workbook = await loadCsvWorkbook(new TextEncoder().encode(text));
    const values = workbook.sheets[0].rows.map(row => row.cells.map(cell => cell.value));
    expect(values).toEqual(text.includes('\n') ? [[text.startsWith('a') ? 'a' : ''], ['']] : [['']]);
  });

  it('round-trips quoted CSV records with mixed line endings, Unicode and long fields', async () => {
    const values = Array.from({ length: 90 }, (_, row) => Array.from({ length: row % 9 + 1 }, (_, column) =>
      ['', '中文😀', 'a,b', 'say "hello"', 'line\nbreak', 'line\rbreak', 'line\r\nbreak', ' padded ', 'long '.repeat(2000)][(row + column) % 9]));
    values.push(['']);
    const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const text = values.map((row, index) => row.map(quote).join(',') + (index < values.length - 1 ? ['\r\n', '\n', '\r'][index % 3] : '')).join('');
    const sheet = (await loadCsvWorkbook(new TextEncoder().encode(text))).sheets[0];
    expect(sheet.rows.map(row => row.cells.map(cell => cell.value))).toEqual(values);
    expect(sheet.rowCount).toBe(values.length);
    expect(sheet.columnCount).toBe(9);
    expect(sheet.rows.at(-1)?.cells[0]).toEqual({ ref: 'A91', row: 91, column: 1, value: '' });
  });

  it('exposes direct XLSX routes and driver support', () => {
    const routes = createXlsxPreviewRoutes();
    const xlsxRoute = routes.find((route) => route.extensions.includes('xlsx'));
    const driver = createXlsxPreviewDriver();

    expect(xlsxRoute).toMatchObject({
      targetFormat: 'xlsx',
      family: 'workbook',
      driverId: 'xlsx'
    });
    expect(routes.find((route) => route.extensions.includes('csv'))).toMatchObject({
      targetFormat: 'csv',
      family: 'workbook',
      driverId: 'xlsx'
    });
    expect(xlsxRoute?.conversion).toBeUndefined();
    expect(driver.supports('xlsx')).toBe(true);
    expect(driver.supports('csv')).toBe(true);
    expect(driver.supports('.XLSX')).toBe(true);
    expect(driver.supports('docx')).toBe(false);
  });

  it('parses workbook sheets and shared strings', async () => {
    const bytes = await createWorkbookFixture();
    const workbook = await loadXlsxWorkbook(bytes);

    expect(workbook.sheets).toHaveLength(2);
    expect(workbook.sheets[0]).toMatchObject({
      name: 'Summary',
      columnCount: 2,
      rowCount: 2
    });
    expect(workbook.sheets[0]?.rows[0]?.cells.map((cell) => cell.value)).toEqual(['Name', '42']);
    expect(workbook.sheets[1]?.name).toBe('Data');
    expect(workbook.sheets[1]?.rows[0]?.cells[0]?.value).toBe('TRUE');
  });

  it('parses worksheets with more than 1000 escaped XML entities', async () => {
    const cellValue = '&'.repeat(1_658);
    const workbook = await loadXlsxWorkbook(
      await createWorkbookFixture(`<c r="C1" t="inlineStr"><is><t>${escapeXml(cellValue)}</t></is></c>`)
    );
    const cell = workbook.sheets[0]?.rows[0]?.cells.find((entry) => entry.ref === 'C1');

    expect(cell?.value).toBe(cellValue);
  });

  it('renders shared and inline rich strings with preserved spaces from Office converters', async () => {
    const zip = await JSZip.loadAsync(await createWorkbookFixture(
      '<c r="C1" t="s"><v>1</v></c>' +
      '<c r="D1" t="inlineStr"><is><r><t xml:space="preserve"> inline </t></r><r><t>text</t></r></is></c>'
    ));
    zip.file('xl/sharedStrings.xml', '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<si><t xml:space="preserve"> Name </t></si>' +
      '<si><r><t xml:space="preserve"> 中文 &amp; </t></r><r><t>text</t></r></si></sst>');
    const host = document.createElement('div');
    const session = createXlsxPreviewDriver().createSession(host);
    await session.load(await zip.generateAsync({ type: 'uint8array' }), {
      descriptor: { source: new Uint8Array(), name: 'converted.xlsx', extension: 'xlsx' }
    });
    expect(Array.from(host.querySelectorAll('tbody tr:first-child td')).map(cell => cell.textContent))
      .toEqual([' Name ', '42', ' 中文 & text', ' inline text']);
    session.destroy();
  });

  it('calculates formulas without cached values only when read', async () => {
    const workbook = await loadXlsxWorkbook(await createWorkbookFixture('<c r="C1"><f>SUM(B1:B2)+1</f></c>'));
    const sheet = workbook.sheets[0]!;
    const cell = sheet.rows[0]?.cells.find((entry) => entry.ref === 'C1');

    expect(cell).toMatchObject({ formula: 'SUM(B1:B2)+1', value: '', needsCalculation: true });
    expect(resolveCellValue(sheet, cell!)).toBe('50');
    expect(cell).toMatchObject({ value: '50', needsCalculation: false });
  });

  it('reads both numeric and XML boolean cached values', async () => {
    const workbook = await loadXlsxWorkbook(await createWorkbookFixture(
      ['true', 'false', ' 1 ', '0'].map((value, index) =>
        `<c r="${String.fromCharCode(67 + index)}1" t="b"><v>${value}</v></c>`).join('')
    ));
    expect(workbook.sheets[0]?.rows[0]?.cells.slice(2).map(cell => cell.value))
      .toEqual(['TRUE', 'FALSE', 'TRUE', 'FALSE']);
  });

  it('renders workbook sources into a sheet grid', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const session = createXlsxPreviewDriver().createSession(host);
    const renderedStates: unknown[] = [];

    session.on('rendered', (state) => {
      renderedStates.push(state);
    });

    await session.load(await createWorkbookFixture(), {
      descriptor: {
        source: new Uint8Array(),
        name: 'book.xlsx',
        extension: 'xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }
    });

    expect(session.getState()).toMatchObject({
      family: 'workbook',
      loading: false,
      activeSheetIndex: 0,
      sheets: [
        {
          id: '1',
          name: 'Summary'
        },
        {
          id: '2',
          name: 'Data'
        }
      ]
    });
    expect(host.querySelectorAll('.xlsxv-sheet-tab')).toHaveLength(2);
    expect(host.querySelector('.xlsxv-table')?.textContent).toContain('Name');
    expect(host.querySelector('.xlsxv-table')?.textContent).toContain('42');
    expect(renderedStates).toHaveLength(1);
    for (const index of [NaN, Infinity, 0.5]) {
      expect(() => session.goToPage?.(index)).not.toThrow();
      expect(session.getState().activeSheetIndex).toBe(0);
    }
    const grid = host.querySelector('.xlsxv-grid') as HTMLElement;
    grid.scrollTop = 100;

    session.next?.();
    expect(grid.scrollTop).toBe(0);
    expect(session.getState().activeSheetIndex).toBe(1);
    expect(host.querySelector('.xlsxv-table')?.textContent).toContain('TRUE');

    session.destroy();
    host.remove();
  });

  it('parses CSV sources into a workbook sheet', async () => {
    const workbook = await loadCsvWorkbook(
      new TextEncoder().encode('Name,Revenue,Note\nAlice,42,"hello, world"\nBob,7,"line\nbreak"'),
      {
        descriptor: {
          source: new Uint8Array(),
          name: 'sales.csv',
          extension: 'csv',
          contentType: 'text/csv'
        }
      }
    );

    expect(workbook.sheets).toHaveLength(1);
    expect(workbook.sheets[0]).toMatchObject({
      id: 'csv',
      name: 'sales',
      columnCount: 3,
      rowCount: 3
    });
    expect(workbook.sheets[0]?.rows[1]?.cells.map((cell) => cell.value)).toEqual(['Alice', '42', 'hello, world']);
    expect(workbook.sheets[0]?.rows[2]?.cells[2]?.value).toBe('line\nbreak');
  });

  it('renders CSV sources through the workbook driver', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const session = createXlsxPreviewDriver().createSession(host);

    await session.load(new TextEncoder().encode('Name,Revenue\nAlice,42'), {
      descriptor: {
        source: new Uint8Array(),
        name: 'sales.csv',
        extension: 'csv',
        contentType: 'text/csv'
      },
      route: {
        sourceFormat: 'csv',
        targetFormat: 'csv',
        family: 'workbook',
        driverId: 'xlsx'
      }
    });

    expect(session.getState()).toMatchObject({
      family: 'workbook',
      loading: false,
      activeSheetIndex: 0,
      sheets: [
        {
          id: 'csv',
          name: 'sales'
        }
      ]
    });
    expect(host.querySelector('.xlsxv-table')?.textContent).toContain('Alice');
    expect(host.querySelector('.xlsxv-table')?.textContent).toContain('42');

    session.destroy();
    host.remove();
  });

  it('renders large sheets in row batches', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const session = createXlsxPreviewDriver().createSession(host);
    const csv = Array.from({ length: 250 }, (_, index) => `Row ${index + 1},${index + 1}`).join('\n');

    await session.load(new TextEncoder().encode(csv), {
      descriptor: {
        source: new Uint8Array(),
        name: 'large.csv',
        extension: 'csv',
        contentType: 'text/csv'
      }
    });

    const grid = host.querySelector('.xlsxv-grid') as HTMLDivElement;
    expect(host.querySelectorAll('.xlsxv-table tbody tr')).toHaveLength(100);
    Object.defineProperties(grid, {
      clientHeight: { configurable: true, value: 500 },
      scrollHeight: { configurable: true, value: 2600 },
      scrollTop: { configurable: true, writable: true, value: 1800 }
    });
    grid.dispatchEvent(new Event('scroll'));
    expect(host.querySelectorAll('.xlsxv-table tbody tr')).toHaveLength(200);

    session.destroy();
    host.remove();
  });

  it.each(['csv', 'xlsx'] as const)('ignores destroyed, superseded and aborted %s source reads', async format => {
    const bytes = await createWorkbookFixture();
    for (const action of ['destroy', 'replace', 'abort']) {
      const host = document.createElement('div');
      const session = createXlsxPreviewDriver().createSession(host);
      const rendered = vi.fn(), errors = vi.fn();
      session.on('rendered', rendered); session.on('error', errors);
      let finish!: (value: any) => void;
      const source = new Blob([]);
      Object.defineProperty(source, format === 'csv' ? 'text' : 'arrayBuffer', {
        value: () => new Promise(resolve => { finish = resolve; })
      });
      const controller = new AbortController();
      const pending = session.load(source, { descriptor: { source, extension: format }, signal: controller.signal })
        .then(() => undefined, error => error);
      if (action === 'destroy') session.destroy();
      if (action === 'abort') controller.abort();
      if (action === 'replace') {
        const replacement = new TextEncoder().encode('Current,42');
        await session.load(replacement, { descriptor: { source: replacement, name: 'current.csv', extension: 'csv' } });
      }
      finish(format === 'csv' ? 'Stale,7' : bytes.buffer);
      const error = await pending;
      expect(error?.name).toBe(action === 'abort' ? 'AbortError' : undefined);
      expect(rendered).toHaveBeenCalledTimes(action === 'replace' ? 1 : 0);
      expect(errors).not.toHaveBeenCalled();
      if (action === 'replace') {
        expect(host.querySelector('.xlsxv-table')?.textContent).toContain('Current');
        expect(session.getState()).toMatchObject({ title: 'current.csv', error: null });
      } else {
        expect(host.querySelector('.xlsxv-table')).toBeNull();
        expect(session.getState()).toMatchObject({ loading: false, sheets: [] });
      }
      session.destroy();
    }
  });

  it('does not report an old read failure after loading a new workbook', async () => {
    const host = document.createElement('div');
    const session = createXlsxPreviewDriver().createSession(host);
    const errors = vi.fn(); session.on('error', errors);
    let fail!: (error: Error) => void;
    const source = new Blob([]);
    source.text = () => new Promise((_, reject) => { fail = reject; });
    const pending = session.load(source, { descriptor: { source, extension: 'csv' } }).catch(error => error);
    const current = new TextEncoder().encode('Current,42');
    await session.load(current, { descriptor: { source: current, extension: 'csv' } });
    fail(new Error('Old read failed'));
    expect(await pending).toBeUndefined();
    expect(errors).not.toHaveBeenCalled();
    expect(session.getState().error).toBeNull();
    expect(host.querySelector('.xlsxv-table')?.textContent).toContain('Current');
    session.destroy();
  });

  it.each([loadCsvWorkbook, loadXlsxWorkbook])('rejects already-aborted inputs without reading the source', async load => {
    const source = new Blob([]);
    source.text = vi.fn(); source.arrayBuffer = vi.fn();
    const controller = new AbortController(); controller.abort();
    await expect(load(source, { descriptor: { source }, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(source.text).not.toHaveBeenCalled();
    expect(source.arrayBuffer).not.toHaveBeenCalled();
  });

  it('preserves sparse, unordered, duplicate and edited rows between batches', () => {
    const sheet: ParsedSheet = {
      id: 'custom', name: 'Custom', rowCount: 5, columnCount: 2,
      rows: [
        { index: 3, cells: [{ ref: 'A3', row: 3, column: 1, value: 'old' }] },
        { index: 1, cells: [{ ref: 'B1', row: 1, column: 2, value: 'first' }, { ref: 'B1', row: 1, column: 2, value: 'last' }] },
        { index: 3, cells: [{ ref: 'A3', row: 3, column: 1, value: 'updated' }] }
      ]
    };
    const table = createSheetTable(sheet, 3);
    const values = () => Array.from(table.tBodies[0].rows, row => Array.from(row.querySelectorAll('td'), cell => cell.textContent));
    expect(values()).toEqual([['', 'last'], ['', ''], ['updated', '']]);
    sheet.rows.push({ index: 5, cells: [{ ref: 'B5', row: 5, column: 2, value: 'appended' }] });
    appendSheetRows(table.tBodies[0], sheet, 4, 5);
    expect(values()).toEqual([['', 'last'], ['', ''], ['updated', ''], ['', ''], ['', 'appended']]);
  });
});

async function createWorkbookFixture(extraCell = ''): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`
  );
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Summary" sheetId="1" r:id="rId1"/>
    <sheet name="Data" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>`
  );
  zip.file(
    'xl/sharedStrings.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2">
  <si><t>Name</t></si>
  <si><t>Region</t></si>
</sst>`
  );
  zip.file(
    'xl/worksheets/sheet1.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>42</v></c>${extraCell}</row>
    <row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>7</v></c></row>
  </sheetData>
</worksheet>`
  );
  zip.file(
    'xl/worksheets/sheet2.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="b"><v>1</v></c></row>
  </sheetData>
</worksheet>`
  );
  return zip.generateAsync({
    type: 'uint8array'
  });
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
