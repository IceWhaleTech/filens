import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMediaConverterClient } from '../src/media-client';
import { convertMedia } from '../src/media-runtime';

vi.mock('../src/media-runtime', () => ({ convertMedia: vi.fn(async input => ({ source: input, format: 'png' })) }));
const context = { descriptor: { source: new Uint8Array() } };
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('browser media converter ownership', () => {
  it('snapshots only the supplied byte slice before yielding', async () => {
    const input = new Uint8Array([99, 1, 2, 3, 99]);
    const pending = createMediaConverterClient().convert({ source: input.subarray(1, 4), sourceFormat: 'HEIC', targetFormat: 'png' }, context);
    input.fill(0);
    const result = await pending;
    expect([...result.source as Uint8Array]).toEqual([1, 2, 3]);
    expect(input.byteLength).toBe(5);
  });

  it('does not start a worker for an aborted conversion', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(createMediaConverterClient().convert({ source: new Uint8Array([1]), sourceFormat: 'heic', targetFormat: 'png' },
      { ...context, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(convertMedia).not.toHaveBeenCalled();
  });

  it('cancels the source download before starting a worker', async () => {
    const controller = new AbortController();
    const fetch = vi.fn(async (_url, options) => {
      expect(options.signal).toBe(controller.signal);
      controller.abort();
      return new Response(new Uint8Array([1]));
    });
    vi.stubGlobal('fetch', fetch);
    await expect(createMediaConverterClient().convert({ source: 'https://example.com/clip.mov', sourceFormat: 'mov', targetFormat: 'mp4' },
      { ...context, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(convertMedia).not.toHaveBeenCalled();
  });
});
