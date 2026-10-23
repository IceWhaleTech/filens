/** Synthetic, uncompressed Bayer DNG; contains no camera-original pixels. */
export function dngFixture(kind: 'one-rs' | 'x5' | 'ordinary' = 'one-rs', orientation = 1): Uint8Array {
  const size = 512;
  const width = kind === 'one-rs' ? size : size * 2;
  const height = kind === 'one-rs' ? size * 2 : size;
  const text = (s: string) => new TextEncoder().encode(s + '\0');
  const shorts = (...values: number[]) => {
    const bytes = new Uint8Array(values.length * 2);
    values.forEach((value, i) => new DataView(bytes.buffer).setUint16(i * 2, value, true));
    return bytes;
  };
  const longs = (...values: number[]) => {
    const bytes = new Uint8Array(values.length * 4);
    values.forEach((value, i) => new DataView(bytes.buffer).setUint32(i * 4, value, true));
    return bytes;
  };
  const model = kind === 'one-rs' ? 'Insta360 OneRS' : kind === 'x5' ? 'Insta360 X5' : 'Synthetic camera';
  const comment = kind === 'one-rs'
    ? 'INSTA3602_150_256_256_0_0_180_150_256_768_0_0_0_512_1024_0'
    : kind === 'x5'
      ? '2_2_368_368_224_224_0_0_90_0_0_0_0_0_0_0_0_896_448_0_2_368_368_672_224_0_0_90_0_0_-0.03_0_0_0_0_0_896_448_0_0'
      : '';
  const tags: Array<[number, number, Uint8Array]> = [
    [256, 4, longs(width)], [257, 4, longs(height)], [258, 3, shorts(16)],
    [259, 3, shorts(1)], [262, 3, shorts(32803)], [271, 2, text('Synthetic')],
    [272, 2, text(model)], [273, 4, longs(0)], [274, 3, shorts(orientation)],
    [277, 3, shorts(1)], [278, 4, longs(height)], [279, 4, longs(width * height * 2)],
    [33421, 3, shorts(2, 2)], [33422, 1, Uint8Array.of(0, 1, 1, 2)],
    [37510, 7, text('ASCII\0\0\0' + comment)], [50706, 1, Uint8Array.of(1, 4, 0, 0)],
    [50717, 4, longs(65535)]
  ];
  let cursor = 8 + 2 + tags.length * 12 + 4;
  const offsets = tags.map(([, , bytes]) => { const offset = cursor; if (bytes.length > 4) cursor += bytes.length + bytes.length % 2; return offset; });
  const sensorOffset = cursor;
  tags.find(([tag]) => tag === 273)![2] = longs(sensorOffset);
  const result = new Uint8Array(sensorOffset + width * height * 2);
  const view = new DataView(result.buffer);
  result.set([73, 73, 42, 0, 8, 0, 0, 0]);
  view.setUint16(8, tags.length, true);
  tags.forEach(([tag, type, bytes], index) => {
    const start = 10 + index * 12;
    view.setUint16(start, tag, true); view.setUint16(start + 2, type, true);
    view.setUint32(start + 4, bytes.length / (type === 3 ? 2 : type === 4 ? 4 : 1), true);
    if (bytes.length <= 4) result.set(bytes, start + 8);
    else { view.setUint32(start + 8, offsets[index], true); result.set(bytes, offsets[index]); }
  });
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const cx = x % size - size / 2;
    const cy = y % size - size / 2;
    const valid = Math.hypot(cx, cy) < size * 0.475;
    const green = y % 2 !== x % 2;
    const blue = !green && y % 2 === 1;
    const channel = green ? 1 : blue ? 2 : 0;
    // The first OneRS sensor is rolled by 180 degrees; the second is reflected
    // by its opposite optical axis. Both should display the blue half above red.
    const sky = kind === 'one-rs' ? cy > 0 : cy < 0;
    const value = valid ? (sky ? [7000, 15000, 42000] : [42000, 12000, 7000])[channel] : 0;
    view.setUint16(sensorOffset + (y * width + x) * 2, value, true);
  }
  return result;
}
