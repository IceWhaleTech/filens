import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { createXlsxPreviewDriver, createXlsxPreviewRoutes, loadCsvWorkbook, loadXlsxWorkbook, resolveCellValue } from '../src';

describe('XLSX preview driver', () => {
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

  it('calculates formulas without cached values only when read', async () => {
    const workbook = await loadXlsxWorkbook(await createWorkbookFixture('<c r="C1"><f>SUM(B1:B2)+1</f></c>'));
    const sheet = workbook.sheets[0]!;
    const cell = sheet.rows[0]?.cells.find((entry) => entry.ref === 'C1');

    expect(cell).toMatchObject({ formula: 'SUM(B1:B2)+1', value: '', needsCalculation: true });
    expect(resolveCellValue(sheet, cell!)).toBe('50');
    expect(cell).toMatchObject({ value: '50', needsCalculation: false });
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

    session.next?.();
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
      scrollTop: { configurable: true, value: 1800 }
    });
    grid.dispatchEvent(new Event('scroll'));
    expect(host.querySelectorAll('.xlsxv-table tbody tr')).toHaveLength(200);

    session.destroy();
    host.remove();
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
