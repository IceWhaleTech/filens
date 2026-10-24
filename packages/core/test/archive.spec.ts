// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { loadPptxArchive } from '../src/parser/archive';

describe('presentation archive', () => {
  it.each([128, 17 * 1024 * 1024])('does not inflate an unsupported %i-byte attachment when reading XML', async size => {
    const bytes = zipSync({ 'slide.xml': new TextEncoder().encode('<slide/>'), 'unused.bin': new Uint8Array(size) });
    // Make this unused entry unsupported to prove that it is never inflated.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 0; offset + 46 < bytes.length; offset++) {
      if (view.getUint32(offset, true) !== 0x02014b50) continue;
      const length = view.getUint16(offset + 28, true);
      if (new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + length)) === 'unused.bin') {
        view.setUint16(offset + 10, 99, true);
        break;
      }
    }
    const archive = await loadPptxArchive(bytes);
    expect(await archive.file('slide.xml')!.async('text')).toBe('<slide/>');
    expect(archive.file('missing.xml')).toBeNull();
    await expect(archive.file('unused.bin')!.async('uint8array')).rejects.toThrow();
  });

  it('defers corrupt unused payloads until they are requested', async () => {
    const bytes = zipSync({ 'unused.bin': new Uint8Array(128), 'slide.xml': new TextEncoder().encode('<slide/>') });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const start = 30 + view.getUint16(26, true) + view.getUint16(28, true);
    bytes[start] = 7; // Invalid DEFLATE block type in the first entry.
    const archive = await loadPptxArchive(bytes);
    expect(await archive.file('slide.xml')!.async('text')).toBe('<slide/>');
    await expect(archive.file('unused.bin')!.async('uint8array')).rejects.toThrow();
  });

});
