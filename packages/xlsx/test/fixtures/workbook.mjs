import JSZip from 'jszip';

export async function createWorkbookFixture() {
  const zip = new JSZip(), date = new Date('2020-01-01T00:00:00Z');
  zip.file('xl/workbook.xml', '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="First" sheetId="1" r:id="rId1"/><sheet name="Second" sheetId="2" r:id="rId2"/></sheets></workbook>', { date });
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>', { date });
  for (const [index, name] of ['First', 'Second'].entries()) {
    const rows = Array.from({ length: 240 }, (_, index) => {
      const row = index + 1;
      return `<row r="${row}"><c r="A${row}" t="inlineStr"><is><t>${name} ${row}</t></is></c><c r="B${row}"><v>${row * 7}</v></c>${row === 1 ? '<c r="C1"><f>SUM(B1:B2)</f></c>' : ''}</row>`;
    });
    zip.file(`xl/worksheets/sheet${index + 1}.xml`, `<worksheet><sheetData>${rows.join('')}</sheetData></worksheet>`, { date });
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
