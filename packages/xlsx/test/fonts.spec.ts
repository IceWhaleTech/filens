import { afterEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { splitPreviewFontFamilies } from '@filens/core';
import { createXlsxPreviewDriver, loadXlsxWorkbook } from '../src';

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

async function workbook(sheet: string, theme?: string, bold = '') {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Fonts" sheetId="1" r:id="sheet"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="sheet" Target="worksheets/sheet.xml"/></Relationships>');
  zip.file('xl/styles.xml', '<styleSheet><fonts><font><name val="Book Face"/><family val="1"/></font><font><name val="Code Face"/><family val="3"/></font><font><name val="Art Face"/><family val="5"/></font></fonts><cellStyleXfs><xf fontId="1"/></cellStyleXfs><cellXfs><xf fontId="0"/><xf fontId="1"/><xf fontId="2"/><xf fontId="2" xfId="0" applyFont="0"/></cellXfs></styleSheet>');
  zip.file('xl/worksheets/sheet.xml', sheet);
  if (theme) {
    zip.file('xl/styles.xml', `<styleSheet><fonts><font><name val="Saved Font"/><scheme val="minor"/><family val="1"/>${bold}</font></fonts><cellXfs><xf fontId="0"/></cellXfs></styleSheet>`);
    zip.file('xl/theme/theme1.xml', theme);
  }
  return zip.generateAsync({ type: 'uint8array' });
}

describe('XLSX font styles', () => {
  it('refreshes loaded cells without losing lazy rows or scroll position', async () => {
    const context = { font: '', measureText: () => ({ width: 100 }) };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>(yes => { resolve = yes; });
    vi.stubGlobal('fetch', vi.fn(() => pending));
    vi.stubGlobal('FontFace', class { async load() { return this; } });
    Object.defineProperty(document, 'fonts', { configurable: true, value: { add: vi.fn(), delete: vi.fn() } });
    const source = await workbook(`<worksheet><sheetData>${Array.from({ length: 300 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c></row>`).join('')}</sheetData></worksheet>`);
    const host = document.body.appendChild(document.createElement('div'));
    const session = createXlsxPreviewDriver().createSession(host, { fontLoading: { packs: [{ id: 'test', version: '1', fonts: [{ id: 'book', fontFamily: 'Web Book', traits: { serif: true }, sources: [{ url: 'https://fonts.example/book.woff2' }] }] }] } });
    try {
      await session.load(source, { descriptor: { source, extension: 'xlsx' } });
      const grid = host.querySelector<HTMLElement>('.xlsxv-grid')!;
      grid.dispatchEvent(new Event('scroll'));
      expect(host.querySelector('tbody')?.rows.length).toBe(200);
      grid.scrollTop = 144; grid.scrollLeft = 37;
      const before = host.querySelector('table');
      resolve(new Response(new Uint8Array([1, 2, 3])));
      await vi.waitFor(() => expect(session.getState().fonts?.[0].resolvedFontFamily).toBe('Web Book'));
      expect(host.querySelector('table')).not.toBe(before);
      expect(host.querySelector('tbody')?.rows.length).toBe(200);
      expect(grid.scrollTop).toBe(144); expect(grid.scrollLeft).toBe(37);
      expect(splitPreviewFontFamilies(host.querySelector<HTMLElement>('td.xlsxv-cell')!.style.fontFamily).slice(0, 2)).toEqual(['Book Face', 'Web Book']);
      expect(session.getFontReferences?.().map(ref => ref.fontFamily)).toEqual(['Book Face']);
      expect(session.getState().fonts?.map(font => font.fontFamily)).toEqual(['Book Face', 'Code Face', 'Art Face']);
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { session.destroy(); vi.unstubAllGlobals(); delete (document as unknown as { fonts?: unknown }).fonts; }
  });
  it.each([false, true])('keeps default, cell, row and inherited font styles on the numeric/general parser (general: %s)', async general => {
    const source = await workbook(`<worksheet><sheetData${general ? ' custom="1"' : ''}><row r="1"><c r="A1"><v>1</v></c><c r="B1" s="1"><v>2</v></c><c r="C1" s="3"><v>3</v></c></row><row r="2" s="2" customFormat="1"><c r="A2"><v>4</v></c><c r="B2" s="0"><v>5</v></c></row></sheetData></worksheet>`);
    const result = await loadXlsxWorkbook(source);
    expect(result.fonts).toMatchObject([{ traits: { serif: true } }, { traits: { monospace: true } }, { traits: { style: 'decorative' } }]);
    expect(result.sheets[0].rows.flatMap(row => row.cells.map(cell => cell.font?.fontFamily))).toEqual(['Book Face', 'Code Face', 'Code Face', 'Art Face', 'Book Face']);
  });

  it('honors column font styles and row overrides without overriding explicit cell styles', async () => {
    const source = await workbook('<worksheet><cols><col min="2" max="3" style="2"/></cols><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c><c r="C1" s="1"><v>3</v></c></row><row r="2" customFormat="1" s="0"><c r="B2"><v>4</v></c></row></sheetData></worksheet>');
    const result = await loadXlsxWorkbook(source);
    expect(result.sheets[0].rows.flatMap(row => row.cells.map(cell => cell.font?.fontFamily))).toEqual(['Book Face', 'Art Face', 'Code Face', 'Book Face']);
  });

  it('resolves a theme font with a non-default XML prefix', async () => {
    const source = await workbook('<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>', '<d:theme><d:themeElements><d:fontScheme><d:minorFont><d:latin typeface="Theme Serif"/></d:minorFont></d:fontScheme></d:themeElements></d:theme>');
    expect((await loadXlsxWorkbook(source)).sheets[0].rows[0].cells[0].font?.fontFamily).toBe('Theme Serif');
  });

  it.each([['', 400], ['<b/>', 700], ['<b val="0"/>', 400], ['<b val="false"/>', 400]])('reads theme PANOSE/pitch and explicit bold state %s', async (bold, weight) => {
    const source = await workbook('<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>',
      '<d:theme><d:themeElements><d:fontScheme><d:minorFont><d:latin typeface="Theme Face" panose="020B0806050405020304" pitchFamily="17"/></d:minorFont></d:fontScheme></d:themeElements></d:theme>', String(bold));
    const result = await loadXlsxWorkbook(source);
    expect(result.fonts?.[0]).toMatchObject({ fontFamily: 'Theme Face', traits: { serif: false, monospace: true, stretch: 75, weight } });
  });

  it('renders the classified serif/mono/art fallbacks and reports detected automatic substitutes', async () => {
    const context = { font: '', measureText: () => ({ width: ['Liberation Serif', 'Liberation Mono', 'Papyrus'].some(name => context.font.includes(`"${name}"`)) ? 140 : 100 }) };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const source = await workbook('<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1" s="1"><v>2</v></c><c r="C1" s="2"><v>3</v></c></row></sheetData></worksheet>');
    const host = document.body.appendChild(document.createElement('div')), session = createXlsxPreviewDriver().createSession(host);
    try {
      await session.load(source, { descriptor: { source, extension: 'xlsx' } });
      expect(session.getState().fonts?.map(font => font.resolvedFontFamily)).toEqual(['Liberation Serif', 'Liberation Mono', 'Papyrus']);
      const cells = [...host.querySelectorAll<HTMLElement>('td.xlsxv-cell')];
      expect(cells[0].style.fontFamily).toContain('Liberation Serif');
      expect(cells[1].style.fontFamily).toContain('Liberation Mono');
      expect(cells[2].style.fontFamily).toContain('Papyrus');
      expect(cells.map(cell => splitPreviewFontFamilies(cell.style.fontFamily).slice(0, 2))).toEqual([
        ['Book Face', 'Liberation Serif'], ['Code Face', 'Liberation Mono'], ['Art Face', 'Papyrus']
      ]);
      session.destroy(); expect(session.getState().fonts).toEqual([]);
    } finally { session.destroy(); }
  });
});
