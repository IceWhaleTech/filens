import { deflateSync } from 'node:zlib';

export function createObjMaterialFixture(name = 'base', texture = 'color.png', options = '') {
  const source = `mtllib materials/base.mtl\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\nvn 0 0 1\nusemtl ${name}\nf 1/1/1 2/2/1 3/3/1\nf 1/1/1 3/3/1 4/4/1\n`;
  return { source, material: `newmtl ${name}\nKd 1 1 1\nmap_Kd ${options}${texture}\n`, name,
    positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0],
    normals: Array.from({ length: 6 }, () => [0, 0, 1]).flat(), uv: [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1] };
}

// Deterministic RGBA PNG with full independently checkable decoded pixels.
export function createObjTexture(side = 128) {
  const pixels = Buffer.alloc(side * side * 4), rows = Buffer.alloc(side * (side * 4 + 1)); let seed = 12345;
  for (let i = 0; i < pixels.length; i += 4) {
    for (let channel = 0; channel < 3; channel++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; pixels[i + channel] = seed & 255; }
    pixels[i + 3] = 255;
  }
  for (let y = 0; y < side; y++) pixels.copy(rows, y * (side * 4 + 1) + 1, y * side * 4, (y + 1) * side * 4);
  const crc32 = bytes => { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const bytes = Buffer.alloc(data.length + 12); bytes.writeUInt32BE(data.length); bytes.write(type, 4); data.copy(bytes, 8);
    bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4); return bytes;
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(side); ihdr.writeUInt32BE(side, 4); ihdr[8] = 8; ihdr[9] = 6;
  return { side, pixels, png: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]) };
}
