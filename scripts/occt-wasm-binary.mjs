import assert from 'node:assert/strict';

// Remove analysis metadata without reserializing or changing executable code.
// This keeps function byte attribution identical to the published artifact.
export function stripWasmDebug(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x6d736100);
  const sections = [bytes.subarray(0, 8)];
  let offset = 8;
  const uleb = () => {
    let value = 0, shift = 0, byte;
    do { byte = bytes[offset++]; value += (byte & 127) * 2 ** shift; shift += 7; } while (byte & 128);
    return value;
  };
  while (offset < bytes.length) {
    const start = offset, id = bytes[offset++], length = uleb(), end = offset + length;
    assert(end <= bytes.length, 'Truncated WASM section');
    let omit = false;
    if (id === 0) {
      const size = uleb(), name = bytes.toString('utf8', offset, offset + size);
      omit = name === 'name' || name === 'producers' || name === 'sourceMappingURL' || name.startsWith('.debug_');
    }
    if (!omit) sections.push(bytes.subarray(start, end));
    offset = end;
  }
  const result = Buffer.concat(sections);
  assert(WebAssembly.validate(result), 'Stripped preview WASM must validate');
  return result;
}
