// Deterministic uncompressed 24-bit BMP; no private camera imagery.
export function createPanoramaBitmap(width = 4096, height = width / 2) {
  const stride = Math.ceil(width * 3 / 4) * 4, bytes = new Uint8Array(54 + stride * height), view = new DataView(bytes.buffer);
  bytes.set([66,77]); view.setUint32(2, bytes.length, true); view.setUint32(10, 54, true); view.setUint32(14, 40, true);
  view.setInt32(18, width, true); view.setInt32(22, height, true); view.setUint16(26, 1, true); view.setUint16(28, 24, true); view.setUint32(34, stride * height, true);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = 54 + y * stride + x * 3;
    bytes[offset] = (x >> 4) & 255; bytes[offset + 1] = (y >> 3) & 255; bytes[offset + 2] = ((x >> 6) ^ (y >> 5)) & 255;
  }
  return bytes;
}
