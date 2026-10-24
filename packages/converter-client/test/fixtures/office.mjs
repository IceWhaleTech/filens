import JSZip from 'jszip';
// A valid generated DOCM with deterministic PNG media and a removable macro part.
export async function createImageDocmFixture(png, count) {
  const zip = new JSZip(), date = new Date('2000-01-01T00:00:00Z');
  const add = (name, data) => zip.file(name, data, { date, createFolders: false });
  add('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/><Override PartName="/word/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>');
  add('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  let body = '', relationships = '';
  for (let index = 1; index <= count; index++) {
    body += `<w:p><w:r><w:t>Image ${index} / WASI output check</w:t></w:r></w:p><w:p><w:r><w:drawing><wp:inline><wp:extent cx="5486400" cy="5486400"/><wp:docPr id="${index}" name="Image ${index}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${index}" name="Image ${index}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId${index}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="5486400" cy="5486400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    relationships += `<Relationship Id="rId${index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${index}.png"/>`;
    add(`word/media/image${index}.png`, png);
  }
  add('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:bottom="720" w:left="720" w:right="720"/></w:sectPr></w:body></w:document>`);
  add('word/_rels/document.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}<Relationship Id="macro" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/></Relationships>`);
  add('word/vbaProject.bin', new Uint8Array([77,65,67,82,79]));
  return zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
}
