// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { unzipSync, zipSync } from 'fflate';
import { loadPptxArchive, PptxArchiveEntry } from '../src/parser/archive';
import { loadPptx } from '../src/parser/load-pptx';
import { readFixture } from './helpers';

describe('presentation archive', () => {
  it('rejects a cancelled archive before ZIP indexing', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(loadPptxArchive(new Uint8Array(4), { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not inflate a cancelled entry', async () => {
    const controller = new AbortController();
    const read = vi.fn(async () => new Uint8Array(4));
    const entry = new PptxArchiveEntry(read, controller.signal);
    controller.abort();
    await expect(entry.async('text')).rejects.toMatchObject({ name: 'AbortError' });
    expect(read).not.toHaveBeenCalled();
  });

  it('discards an entry that finishes inflating after cancellation', async () => {
    const controller = new AbortController();
    let resolve!: (value: Uint8Array) => void;
    const entry = new PptxArchiveEntry(() => new Promise(done => { resolve = done; }), controller.signal);
    const loaded = entry.async('text');
    controller.abort();
    resolve(new TextEncoder().encode('<slide/>'));
    await expect(loaded).rejects.toMatchObject({ name: 'AbortError' });
  });

  it.each([false, true])('cancels later and cached reads in the %s fallback archive', async fallback => {
    const bytes = zipSync({ 'slide.xml': new TextEncoder().encode('<slide/>'), 'unused.bin': new Uint8Array(16) });
    if (fallback) {
      const view = new DataView(bytes.buffer);
      for (let offset = 0; offset + 46 < bytes.length; offset++) {
        if (view.getUint32(offset, true) !== 0x02014b50) continue;
        const size = view.getUint16(offset + 28, true);
        if (new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + size)) === 'unused.bin') {
          view.setUint16(offset + 10, 99, true);
          break;
        }
      }
    }
    const controller = new AbortController();
    const archive = await loadPptxArchive(bytes, { signal: controller.signal });
    expect(await archive.file('slide.xml')!.async('text')).toBe('<slide/>');
    controller.abort();
    await expect(archive.file('slide.xml')!.async('text')).rejects.toMatchObject({ name: 'AbortError' });
    await expect(archive.file('unused.bin')!.async('uint8array')).rejects.toMatchObject({ name: 'AbortError' });
  });

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

  it('previews a complete presentation despite a corrupt unrelated attachment', async () => {
    const original = await readFixture('fixtures-text-theme.pptx');
    const bytes = zipSync({ 'unused.bin': new Uint8Array(128), ...unzipSync(original) });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const start = 30 + view.getUint16(26, true) + view.getUint16(28, true);
    bytes[start] = 7;
    // Generated IDs increase between loads; compare all parsed content.
    const content = (presentation: Awaited<ReturnType<typeof loadPptx>>) => ({
      ...presentation,
      slides: presentation.slides.map(({ id, ...slide }) => ({
        ...slide,
        items: slide.items.map(({ id, ...item }) => item)
      }))
    });
    expect(content(await loadPptx(bytes))).toEqual(content(await loadPptx(original)));
  });

});
