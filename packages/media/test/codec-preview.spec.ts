import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPreviewAcceptAttribute, resolveFormatRoute, type ConverterClient, type PreviewSession } from '@filens/core';
import { createCodecPreviewDrivers } from '../src/codec-preview-driver';
import { createMediaPreviewRoutes } from '../src';

const sessions: PreviewSession[] = [];
const context = (name: string, signal?: AbortSignal) => ({
  descriptor: { source: new Uint8Array([1]), name, extension: name.split('.').pop()!.toLowerCase() }, signal
});
const setup = (converter: ConverterClient, image = false) => {
  const host = document.createElement('div');
  const session = createCodecPreviewDrivers(converter)[image ? 0 : 1].createSession(host);
  sessions.push(session);
  return { host, session };
};

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() }));
});
afterEach(() => { sessions.splice(0).forEach(session => session.destroy()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('WASM media previews', () => {
  it('routes uppercase HEIC, HEIF and MIME-only images and exposes their accept types', () => {
    const routes = createMediaPreviewRoutes();
    for (const descriptor of [{ name: 'iPhone.HEIC' }, { name: 'photo.heif' }, { contentType: 'image/heic' }, { contentType: 'image/heif' }]) {
      expect(resolveFormatRoute(descriptor, { routes })).toMatchObject({ family: 'image', driverId: 'heif-image' });
    }
    const accept = createPreviewAcceptAttribute({ routes });
    for (const type of ['.heic', '.heif', 'image/heic', 'image/heif']) expect(accept).toContain(type);
  });

  it('decodes HEIC into the native image viewer and preserves the original title', async () => {
    const convert = vi.fn(async () => ({ source: new Uint8Array([137, 80]), format: 'png', contentType: 'image/png' }));
    const { host, session } = setup({ convert }, true);
    const load = context('iPhone.HEIC');
    await session.load(load.descriptor.source, load);
    expect(convert.mock.calls[0]).toMatchObject([{ sourceFormat: 'heic', targetFormat: 'png' }, { signal: expect.any(AbortSignal) }]);
    const image = host.querySelector('img')!;
    image.dispatchEvent(new Event('load'));
    expect(session.getState()).toMatchObject({ family: 'image', loading: false, error: null, title: 'iPhone.HEIC' });
    session.rotate?.();
    expect(session.getState()).toMatchObject({ rotation: 90 });
  });

  it('keeps native MOV playback when supported and transcodes only after an error', async () => {
    const convert = vi.fn(async () => ({ source: new Uint8Array([1, 2]), format: 'mp4', contentType: 'video/mp4' }));
    const { host, session } = setup({ convert });
    const errors = vi.fn(); session.on('error', errors);
    const load = context('iPhone.MOV');
    await session.load(load.descriptor.source, load);
    const original = host.querySelector('video')!;
    original.dispatchEvent(new Event('loadedmetadata'));
    expect(convert).not.toHaveBeenCalled();
    original.querySelector('source')!.dispatchEvent(new Event('error'));
    await vi.waitFor(() => expect(host.querySelector('source')?.type).toBe('video/mp4'));
    original.dispatchEvent(new Event('error'));
    expect(convert).toHaveBeenCalledOnce();
    host.querySelector('video')!.dispatchEvent(new Event('loadedmetadata'));
    expect(session.getState()).toMatchObject({ loading: false, error: null, title: 'iPhone.MOV' });
    expect(errors).not.toHaveBeenCalled();
  });

  it('cancels conversion on replacement and ignores late results', async () => {
    let complete!: (result: { source: Uint8Array; format: string }) => void;
    const convert = vi.fn(async () => ({ source: new Uint8Array([2]), format: 'png' }))
      .mockImplementationOnce(() => new Promise<{ source: Uint8Array; format: string }>(resolve => { complete = resolve; }));
    const { host, session } = setup({ convert }, true);
    const first = context('first.heic');
    const pending = session.load(first.descriptor.source, first);
    const signal = (convert.mock.calls[0] as unknown as [unknown, { signal: AbortSignal }])[1].signal;
    const second = context('second.heif');
    await session.load(second.descriptor.source, second);
    expect(signal.aborted).toBe(true);
    complete({ source: new Uint8Array([1]), format: 'png' });
    await pending;
    host.querySelector('img')!.dispatchEvent(new Event('load'));
    expect(session.getState().title).toBe('second.heif');
    expect(session.getState()).toMatchObject({ loading: false, error: null });
  });

  it('stops a pending decoder when its parent load is aborted', async () => {
    const controller = new AbortController();
    const convert = vi.fn(async (_request, context) => new Promise<never>((_resolve, reject) => {
      context.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
    }));
    const { host, session } = setup({ convert }, true);
    const errors = vi.fn(); session.on('error', errors);
    const load = context('cancel.heic', controller.signal);
    const pending = session.load(load.descriptor.source, load);
    controller.abort();
    await pending;
    expect(host.children).toHaveLength(0);
    expect(session.getState()).toMatchObject({ loading: false, error: null });
    expect(errors).not.toHaveBeenCalled();
  });

  it('reports a failed conversion without retrying the failed media', async () => {
    const convert = vi.fn(async () => { throw new Error('Cannot decode this clip'); });
    const { host, session } = setup({ convert });
    const errors = vi.fn(); session.on('error', errors);
    const load = context('broken.mov');
    await session.load(load.descriptor.source, load);
    host.querySelector('source')!.dispatchEvent(new Event('error'));
    await vi.waitFor(() => expect(session.getState()).toMatchObject({ loading: false, error: 'Cannot decode this clip' }));
    expect(convert).toHaveBeenCalledOnce();
    expect(errors).toHaveBeenCalledOnce();
  });
});
