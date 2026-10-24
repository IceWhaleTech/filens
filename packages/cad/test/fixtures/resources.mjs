// Deterministic DXF raster references, with one IMAGEDEF per image.
export function createRasterDxfFixture(count = 1) {
  let objects = '', entities = '';
  for (let index = 0; index < count; index++) {
    const handle = (index + 32).toString(16).toUpperCase();
    objects += `0\nIMAGEDEF\n5\n${handle}\n1\ntextures/image-${index}.png\n10\n64\n20\n64\n`;
    entities += `0\nIMAGE\n8\nRASTER\n10\n${(index % 2) * 72}\n20\n${Math.floor(index / 2) * 72}\n11\n1\n21\n0\n12\n0\n22\n1\n13\n64\n23\n64\n340\n${handle}\n`;
  }
  return `0\nSECTION\n2\nOBJECTS\n${objects}0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}0\nTEXT\n8\nLABELS\n10\n0\n20\n-8\n40\n4\n1\n配套图片 / Raster\n0\nENDSEC\n0\nEOF\n`;
}

export const lineDxfFixture = '0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nLINES\n10\n0\n20\n0\n11\n10\n21\n10\n0\nENDSEC\n0\nEOF\n';

export function createLayeredDxfFixture(count, layers = 16) {
  const table = Array.from({ length: layers }, (_, layer) =>
    `0\nLAYER\n2\nLayer-${layer}\n70\n0\n62\n${layer === layers - 1 ? -7 : 7}\n`).join('');
  const entities = Array.from({ length: count }, (_, index) =>
    `0\nLINE\n8\nLayer-${index % layers}\n60\n${index % 101 === 0 ? 1 : 0}\n10\n${index % 1000}\n20\n${Math.floor(index / 1000)}\n11\n${index % 1000 + 0.7}\n21\n${Math.floor(index / 1000) + 0.7}\n`).join('');
  return `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n${table}0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`;
}

// A valid opaque PNG with deterministic noise; no external images or dependencies.
export async function createPngFixture(size = 1024) {
  const raw = new Uint8Array((size * 4 + 1) * size);
  let seed = 12345;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    for (let channel = 0; channel < 3; channel++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      raw[offset + channel] = seed >>> 24;
    }
    raw[offset + 3] = 255;
  }
  const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  const chunk = (type, data) => {
    const bytes = new Uint8Array(12 + data.length), view = new DataView(bytes.buffer);
    view.setUint32(0, data.length); bytes.set(new TextEncoder().encode(type), 4); bytes.set(data, 8);
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(4, 8 + data.length)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    view.setUint32(8 + data.length, (crc ^ 0xffffffff) >>> 0); return bytes;
  };
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, size); view.setUint32(4, size); header[8] = 8; header[9] = 6;
  const chunks = [new Uint8Array([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', compressed), chunk('IEND', new Uint8Array())];
  const result = new Uint8Array(chunks.reduce((sum, bytes) => sum + bytes.length, 0));
  let offset = 0; for (const bytes of chunks) { result.set(bytes, offset); offset += bytes.length; }
  return result;
}
