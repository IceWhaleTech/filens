// Public deterministic scalar volumes; compression is supplied by the caller.
export function createVolumeFixture(side = 2, encoding = 'raw', compressed) {
  if (!Number.isSafeInteger(side) || side < 2 || side > 512) throw new Error('Invalid volume size');
  const bytes = new Uint8Array(side ** 3);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 73 + (i >>> 8) * 19) & 255;
  const payload = encoding === 'raw' ? bytes : encoding === 'gzip' || encoding === 'gz' ? compressed(bytes)
    : new TextEncoder().encode([...bytes].map(value => encoding === 'hex' ? value.toString(16).padStart(2, '0') : String(value)).join(' ') + '\n');
  const header = `NRRD0005\ntype: uchar\ndimension: 3\nsizes: ${side} ${side} ${side}\nspacings: 1 2 3\nencoding: ${encoding}\ndata file: volume.raw\n`;
  return { header, payload, bytes, side };
}

export function inlineVolume(header, payload, lineEnding = '\n') {
  const text = header.replace(/^data\s*file:.*\n?/mi, '').trimEnd().replace(/\r?\n/g, lineEnding);
  const encoded = new TextEncoder().encode(text + lineEnding + lineEnding);
  const buffer = new Uint8Array(encoded.length + payload.length); buffer.set(encoded); buffer.set(payload, encoded.length);
  return buffer.buffer;
}
