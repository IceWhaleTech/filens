import { strToU8, zipSync, zlibSync } from 'fflate';

const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  for (let bit = 0; bit < 8; bit++) i = i & 1 ? 0xedb88320 ^ (i >>> 1) : i >>> 1;
  return i >>> 0;
});
const pngChunk = (name, bytes) => {
  const chunk = new Uint8Array(bytes.length + 12), view = new DataView(chunk.buffer);
  view.setUint32(0, bytes.length); chunk.set(strToU8(name), 4); chunk.set(bytes, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  view.setUint32(chunk.length - 4, (crc ^ 0xffffffff) >>> 0); return chunk;
};
const png = () => {
  const size = 256, pixels = new Uint8Array((size * 4 + 1) * size);
  let seed = 12345;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const offset = y * (size * 4 + 1) + x * 4 + 1;
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    pixels.set([seed & 255, (seed >>> 8) & 255, (seed >>> 16) & 255, 255], offset);
  }
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, size); view.setUint32(4, size); header.set([8, 6], 8);
  const chunks = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', zlibSync(pixels)), pngChunk('IEND', new Uint8Array())];
  const result = new Uint8Array(chunks.reduce((sum, bytes) => sum + bytes.length, 0));
  let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; } return result;
};

export function createDocxFixture(images = 400) {
  const ns = 'http://schemas.openxmlformats.org', rel = `${ns}/officeDocument/2006/relationships`;
  const image = i => `<w:p><w:r><w:t>Image ${i + 1}</w:t></w:r><w:r><w:drawing><wp:inline><wp:extent cx="609600" cy="609600"/><wp:docPr id="${i + 1}" name="Image ${i + 1}"/><a:graphic xmlns:a="${ns}/drawingml/2006/main"><a:graphicData uri="${ns}/drawingml/2006/picture"><pic:pic xmlns:pic="${ns}/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${i + 1}" name="noise.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="609600" cy="609600"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>${(i + 1) % 20 === 0 && i + 1 < images ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : ''}`;
  const files = {
    '[Content_Types].xml': `<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    '_rels/.rels': `<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rIdImage" Type="${rel}/image" Target="media/noise.png"/></Relationships>`,
    'word/document.xml': `<w:document xmlns:w="${ns}/wordprocessingml/2006/main" xmlns:r="${rel}" xmlns:wp="${ns}/drawingml/2006/wordprocessingDrawing"><w:body>${Array.from({ length: images }, (_, i) => image(i)).join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>`
  };
  return zipSync(Object.fromEntries([...Object.entries(files).map(([name, text]) => [name, [strToU8(text), { mtime: new Date(2020, 0, 1) }]]),
    ['word/media/noise.png', [png(), { mtime: new Date(2020, 0, 1) }]]]), { level: 6 });
}
