import { Blob as NativeBlob } from 'node:buffer';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadNrrdObject, resolveNhdrBuffer } from '../src/preview-driver';
import { createVolumeFixture, inlineVolume } from './fixtures/volume.mjs';

const deferred = <T>() => { let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const content = (buffer: ArrayBuffer) => {
  const object = loadNrrdObject(buffer) as any;
  const result = { positions: [...object.geometry.attributes.position.array], colors: [...object.geometry.attributes.color.array] };
  object.geometry.dispose(); object.material.dispose(); return result;
};
const expected = (bytes: Uint8Array) => ({
  positions: Array.from({ length: bytes.length }, (_, i) => [i % 2, Math.floor(i / 2) % 2 * 2, Math.floor(i / 4) * 3]).flat(),
  colors: [...new Float32Array([...bytes].flatMap(value => [0.22 + value / 255 * 0.64, 0.3 + value / 255 * 0.55, 0.4 + value / 255 * 0.52]))]
});
beforeEach(() => {
  vi.stubGlobal('Blob', NativeBlob);
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:unexpected'); static revokeObjectURL = vi.fn(); });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('native scalar volume content', () => {
  it.each(['raw', 'gzip', 'gz', 'ascii', 'text', 'txt', 'hex'])('preserves detached %s data and renders every expected voxel', async encoding => {
    const fixture = createVolumeFixture(2, encoding, gzipSync);
    const merged = await resolveNhdrBuffer(fixture.header, { resourceResolver: () => fixture.payload });
    const bytes = new Uint8Array(merged), separator = new TextDecoder().decode(bytes).indexOf('\n\n');
    expect(new TextDecoder().decode(bytes.subarray(0, separator))).toContain(`encoding: ${encoding}`);
    expect([...bytes.subarray(separator + 2)]).toEqual([...fixture.payload]);
    expect(content(merged)).toEqual(expected(fixture.bytes));
  });

  it.each(['\n', '\r\n'])('loads an inline header with %j line endings without truncating the last field', lineEnding => {
    const fixture = createVolumeFixture();
    expect(content(inlineVolume(fixture.header, fixture.payload, lineEnding))).toEqual(expected(fixture.bytes));
  });

  it.each(['raw', 'gzip'])('normalizes %s binary byte order without changing the input buffer', encoding => {
    const values = [0, 128, 255, 256, 512, 1024, 16384, 65535];
    const header = `NRRD0005\ntype: ushort\ndimension: 3\nsizes: 2 2 2\nspacings: 1 2 3\nencoding: ${encoding}\n`;
    const big = new Uint8Array(16), little = new Uint8Array(16);
    values.forEach((value, i) => { new DataView(big.buffer).setUint16(i * 2, value, false); new DataView(little.buffer).setUint16(i * 2, value, true); });
    const source = inlineVolume(header + 'endian: big\n', encoding === 'raw' ? big : gzipSync(big)), original = source.slice(0);
    expect(content(source)).toEqual(content(inlineVolume(header + 'endian: little\n', encoding === 'raw' ? little : gzipSync(little))));
    expect(source).toEqual(original);
  });

  it('keeps text floating-point values independent of declared binary endian', () => {
    const header = 'NRRD0005\ntype: float\ndimension: 3\nsizes: 2 2 2\nencoding: ascii\n';
    const bytes = new TextEncoder().encode('-1.25 0 1.5 3.25 4.5 6.75 8.25 10.5\n');
    expect(content(inlineVolume(header + 'endian: big\n', bytes))).toEqual(content(inlineVolume(header + 'endian: little\n', bytes)));
  });

  it('keeps the legacy raw default when a detached header omits encoding', async () => {
    const fixture = createVolumeFixture();
    const merged = await resolveNhdrBuffer(fixture.header.replace('encoding: raw\n', ''), { resourceResolver: () => fixture.bytes });
    expect(content(merged)).toEqual(expected(fixture.bytes));
  });

  it('keeps already readable inline raw volumes unchanged', () => {
    const fixture = createVolumeFixture();
    expect(content(inlineVolume(fixture.header + '# protected final line\n', fixture.bytes))).toEqual(expected(fixture.bytes));
  });

  it('rejects a truncated binary volume instead of displaying header or missing bytes', async () => {
    const fixture = createVolumeFixture();
    const buffer = await resolveNhdrBuffer(fixture.header, { resourceResolver: () => fixture.bytes.subarray(0, 7) });
    expect(() => content(buffer)).toThrow(/voxel|length|truncated/i);
  });

  it.each(['byte skip: 4', 'line skip: 1', 'dimension: 4'])('rejects unsupported %s instead of silently misplacing samples', field => {
    const fixture = createVolumeFixture();
    const header = field.startsWith('dimension:') ? fixture.header.replace('dimension: 3', field) : fixture.header + field + '\n';
    expect(() => content(inlineVolume(header, fixture.bytes))).toThrow(/skip|dimension/i);
  });
});

describe('detached volume resource reads', () => {
  it.each(['view', 'buffer', 'blob'] as const)('reads a %s directly without allocating a URL or Base64, preserving exact boundaries', async kind => {
    const fixture = createVolumeFixture(), storage = new Uint8Array(fixture.bytes.length + 4); storage.fill(99); storage.set(fixture.bytes, 2);
    const source = kind === 'view' ? new DataView(storage.buffer, 2, fixture.bytes.length)
      : kind === 'blob' ? new Blob([fixture.bytes]) : fixture.bytes.slice().buffer;
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const merged = await resolveNhdrBuffer(fixture.header, { resourceResolver: () => ({ source, warnings: ['volume'] }) });
    expect(content(merged)).toEqual(expected(fixture.bytes));
    expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(URL.revokeObjectURL).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves borrowed URLs and resolves a missing primary path through its fallback', async () => {
    const fixture = createVolumeFixture(), fetch = vi.fn(async () => new Response(fixture.bytes)); vi.stubGlobal('fetch', fetch);
    const resolver = vi.fn(({ source }: { source: string }) => source === 'volume.raw' ? 'blob:borrowed' : undefined);
    const merged = await resolveNhdrBuffer(fixture.header, { resourceBasePath: 'scan/source.nhdr', resourceResolver: resolver });
    expect(resolver.mock.calls.map(([request]) => request.source)).toEqual(['scan/volume.raw', 'volume.raw']);
    expect(content(merged)).toEqual(expected(fixture.bytes)); expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('rejects pre-aborted reads even if the header has no detached data', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(resolveNhdrBuffer('NRRD0005\n', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('reports a missing detached resolver', async () => {
    await expect(resolveNhdrBuffer(createVolumeFixture().header)).rejects.toThrow('no resourceResolver');
  });

  it.each(['resolve', 'reject'] as const)('cancels a held resolver before its late %s without trying a fallback or allocating a URL', async outcome => {
    const fixture = createVolumeFixture(), held = deferred<Blob>(), controller = new AbortController(), resolver = vi.fn(() => held.promise);
    const pending = resolveNhdrBuffer(fixture.header, { resourceBasePath: 'scan/source.nhdr', resourceResolver: resolver, signal: controller.signal });
    const checked = expect(pending).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await checked;
    if (outcome === 'resolve') held.resolve(new Blob([fixture.bytes])); else held.reject(new Error('late resolver'));
    await Promise.resolve(); await Promise.resolve();
    expect(resolver).toHaveBeenCalledTimes(1); expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('cancels a non-cooperative Blob read before it finishes', async () => {
    const fixture = createVolumeFixture(), held = deferred<ArrayBuffer>(), blob = new Blob(), controller = new AbortController();
    const read = vi.fn(() => held.promise); Object.defineProperty(blob, 'arrayBuffer', { value: read });
    const pending = resolveNhdrBuffer(fixture.header, { resourceResolver: () => blob, signal: controller.signal });
    void pending.catch(() => {});
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    const checked = expect(pending).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await checked;
    held.resolve(fixture.bytes.buffer); await Promise.resolve();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('cancels a held response body and observes its late error', async () => {
    const fixture = createVolumeFixture(), held = deferred<ArrayBuffer>(), controller = new AbortController(), cancel = vi.fn(async () => {});
    const read = vi.fn(() => held.promise);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: read, body: { cancel } })));
    const pending = resolveNhdrBuffer(fixture.header, { resourceResolver: () => '/volume.raw', signal: controller.signal });
    void pending.catch(() => {});
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    const checked = expect(pending).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await checked;
    held.reject(new Error('late response body')); await Promise.resolve(); expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('cancels a held fetch and releases a response that arrives later', async () => {
    const fixture = createVolumeFixture(), held = deferred<any>(), controller = new AbortController(), cancel = vi.fn(async () => {});
    const fetch = vi.fn(() => held.promise); vi.stubGlobal('fetch', fetch);
    const pending = resolveNhdrBuffer(fixture.header, { resourceResolver: () => '/volume.raw', signal: controller.signal });
    void pending.catch(() => {});
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const checked = expect(pending).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await checked;
    held.resolve({ ok: true, body: { cancel } }); await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
  });
});
