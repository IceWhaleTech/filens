// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSourceBytes } from '../src/parser/load-source';
afterEach(() => vi.unstubAllGlobals());
describe('iWork source ownership', () => {
  it('retains caller-owned buffers when the loaded bytes are transferred to a Worker', async () => {
    const source = new Uint8Array([9, 8, 7]), loaded = await loadSourceBytes(source.buffer);
    const transferred = structuredClone(loaded, { transfer: [loaded.buffer] });
    expect([...transferred]).toEqual([9, 8, 7]); expect([...source]).toEqual([9, 8, 7]);
  });
  it('copies exactly the selected view', async () => {
    const source = new Uint8Array([9, 1, 2, 8]), loaded = await loadSourceBytes(source.subarray(1, 3)); source.fill(0);
    expect([...loaded]).toEqual([1, 2]); expect(loaded.byteLength).toBe(loaded.buffer.byteLength);
  });
  for (const kind of ['blob', 'network'] as const) it(`checks cancellation after a ${kind} body completes`, async () => {
    const controller = new AbortController(); let finish!: (value: ArrayBuffer) => void;
    const body = { size: 3, arrayBuffer: () => new Promise<ArrayBuffer>(resolve => { finish = resolve; }) };
    if (kind === 'network') vi.stubGlobal('fetch', async () => ({ ...body, ok: true }));
    const task = loadSourceBytes(kind === 'network' ? '/file.pages' : body as Blob, { signal: controller.signal });
    await Promise.resolve(); controller.abort(); finish(new ArrayBuffer(3));
    await expect(task).rejects.toMatchObject({ name: 'AbortError' });
  });
});
