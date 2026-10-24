import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSourceBytes } from '../src/parser/load-source';
import { loadPptx } from '../src/parser/load-pptx';

afterEach(() => vi.unstubAllGlobals());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('PPTX source cancellation', () => {
  it('stops before parsing when a local file finishes reading after cancellation', async () => {
    const pending = deferred<ArrayBuffer>();
    const controller = new AbortController();
    const file = { size: 4, arrayBuffer: () => pending.promise } as Blob;
    const loaded = loadPptx(file, { signal: controller.signal });
    controller.abort();
    // These invalid bytes would produce a ZIP error if parsing continued.
    pending.resolve(new ArrayBuffer(4));
    await expect(loaded).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not read a late fetch response body after cancellation', async () => {
    const pending = deferred<Response>();
    const controller = new AbortController();
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(4));
    vi.stubGlobal('fetch', vi.fn(() => pending.promise));
    const loaded = loadSourceBytes('/late.pptx', { signal: controller.signal });
    controller.abort();
    pending.resolve({ ok: true, arrayBuffer } as unknown as Response);
    await expect(loaded).rejects.toMatchObject({ name: 'AbortError' });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('discards a response body that finishes after cancellation', async () => {
    const pending = deferred<ArrayBuffer>();
    const controller = new AbortController();
    const arrayBuffer = vi.fn(() => pending.promise);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer })));
    const loaded = loadSourceBytes('/late-body.pptx', { signal: controller.signal });
    await vi.waitFor(() => expect(arrayBuffer).toHaveBeenCalledOnce());
    controller.abort();
    pending.resolve(new ArrayBuffer(4));
    await expect(loaded).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects an already cancelled file without starting a read', async () => {
    const controller = new AbortController();
    controller.abort();
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(4));
    await expect(loadSourceBytes({ size: 4, arrayBuffer } as Blob, { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
});
