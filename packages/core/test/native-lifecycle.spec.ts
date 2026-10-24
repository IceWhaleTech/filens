import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHtmlPreviewDriver, createImagePreviewDriver, createMediaPreviewDriver, resolveFormatRoute,
  type PreviewDriver, type PreviewLoadContext, type PreviewSource } from '../src/preview';

const context = (source: PreviewSource, name: string, signal?: AbortSignal): PreviewLoadContext => ({
  descriptor: { source, name, extension: name.split('.').pop() }, route: resolveFormatRoute({ name }) ?? undefined, signal
});
const cases = [
  ['image', createImagePreviewDriver, 'picture.png', 'img', 'load'],
  ['html', createHtmlPreviewDriver, 'page.html', 'iframe', 'load'],
  ['media', createMediaPreviewDriver, 'clip.mp4', 'video', 'loadedmetadata']
] as const;
const sessions: ReturnType<PreviewDriver['createSession']>[] = [];
const readBlob = (blob: Blob) => new Promise<Uint8Array>((resolve, reject) => {
  const reader = new FileReader(); reader.onerror = reject;
  reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer)); reader.readAsArrayBuffer(blob);
});
let blobs: Map<string, Blob>;
const setup = (driver: () => PreviewDriver) => {
  const host = document.createElement('div'); document.body.append(host);
  const session = driver().createSession(host); sessions.push(session);
  return { host, session };
};
beforeEach(() => {
  blobs = new Map();
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn();
    static revokeObjectURL = vi.fn();
  });
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { const url = `blob:fixture-${blobs.size}`; blobs.set(url, blob as Blob); return url; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(() => { for (const session of sessions.splice(0)) session.destroy(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

describe('native element preview lifecycles', () => {
  for (const [family, driver, name, selector, readyEvent] of cases) {
    it(`${family}: ignores detached success/error/progress events after replacement and destruction`, async () => {
      const { host, session } = setup(driver);
      const rendered = vi.fn(), error = vi.fn(), statechange = vi.fn();
      session.on('rendered', rendered); session.on('error', error); session.on('statechange', statechange);
      await session.load('/first', context('/first', name));
      const old = host.querySelector(selector)!;
      await session.load('/second', context('/second', `second-${name}`));
      old.dispatchEvent(new Event(readyEvent)); old.dispatchEvent(new Event('error')); old.dispatchEvent(new Event('timeupdate'));
      expect(session.getState()).toMatchObject({ loading: true, error: null, title: `second-${name}` });
      expect(rendered).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
      const current = host.querySelector(selector)!;
      current.dispatchEvent(new Event(readyEvent));
      expect(rendered).toHaveBeenCalledTimes(1);
      session.destroy(); rendered.mockClear(); statechange.mockClear();
      current.dispatchEvent(new Event(readyEvent)); current.dispatchEvent(new Event('error')); current.dispatchEvent(new Event('timeupdate'));
      expect(host.childElementCount).toBe(0);
      expect(rendered).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); expect(statechange).not.toHaveBeenCalled();
    });

    it(`${family}: releases pending content and owned URLs on abort without an error notification`, async () => {
      const { host, session } = setup(driver), controller = new AbortController();
      const source = new Uint8Array([1, 2, 3]);
      const error = vi.fn(), rendered = vi.fn(); session.on('error', error); session.on('rendered', rendered);
      await session.load(source, context(source, name, controller.signal));
      const element = host.querySelector(selector)!;
      controller.abort();
      element.dispatchEvent(new Event(readyEvent)); element.dispatchEvent(new Event('error'));
      expect(session.getState()).toMatchObject({ loading: false, error: null });
      expect(host.querySelector(selector)).toBeNull();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fixture-0');
      expect(error).not.toHaveBeenCalled(); expect(rendered).not.toHaveBeenCalled();
    });

    it(`${family}: rejects an already cancelled input before assigning a resource URL`, async () => {
      const { host, session } = setup(driver), controller = new AbortController(); controller.abort();
      const source = new Uint8Array([1, 2]);
      await expect(session.load(source, context(source, name, controller.signal))).rejects.toMatchObject({ name: 'AbortError' });
      expect(host.querySelector(selector)).toBeNull(); expect(URL.createObjectURL).not.toHaveBeenCalled();
      expect(session.getState()).toMatchObject({ loading: false, error: null });
    });
  }

  it('resets stale image dimensions and ignores nonfinite transforms', async () => {
    const { host, session } = setup(createImagePreviewDriver);
    await session.load('/first.png', context('/first.png', 'first.png'));
    const old = host.querySelector('img')!;
    Object.defineProperties(old, { naturalWidth: { value: 800 }, naturalHeight: { value: 600 } });
    old.dispatchEvent(new Event('load'));
    await session.load('/second.png', context('/second.png', 'second.png'));
    expect(session.getState()).toMatchObject({ naturalWidth: undefined, naturalHeight: undefined });
    session.setScale?.(NaN); session.setScale?.(Infinity); session.rotate?.(NaN); session.rotate?.(Infinity);
    expect(session.getState()).toMatchObject({ scale: 1, rotation: 0 });
  });

  it.each(['data:text/html,%3Ch1%3EData%20URL%3C%2Fh1%3E', 'data:text/html;base64,PGgxPkRhdGEgVVJMPC9oMT4='])('keeps an HTML data URL navigable: %s', async source => {
    const { host, session } = setup(createHtmlPreviewDriver);
    await session.load(source, context(source, 'data.html'));
    expect(host.querySelector('iframe')?.src).toBe(source); expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('accepts HTML fragments and releases the previous HTML Blob when switching to a URL', async () => {
    const { host, session } = setup(createHtmlPreviewDriver);
    const source = '<h1>Fragment</h1><p>Body</p>';
    await session.load(source, context(source, 'fragment.html'));
    expect(host.querySelector('iframe')?.src).toBe('blob:fixture-0');
    await session.load('/page.html', context('/page.html', 'page.html'));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fixture-0');
  });

  it('reports a failed source element instead of leaving media loading indefinitely', async () => {
    const { host, session } = setup(createMediaPreviewDriver);
    const error = vi.fn(); session.on('error', error);
    await session.load('/missing.mp4', context('/missing.mp4', 'missing.mp4'));
    host.querySelector('source')!.dispatchEvent(new Event('error'));
    expect(session.getState()).toMatchObject({ loading: false, error: expect.stringContaining('codec') });
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('pauses and clears the previous media resource on replacement and destruction', async () => {
    const { host, session } = setup(createMediaPreviewDriver);
    await session.load('/first.mp4', context('/first.mp4', 'first.mp4'));
    const old = host.querySelector('video')!;
    await session.load('/second.mp4', context('/second.mp4', 'second.mp4'));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
    expect(old.querySelector('source[src]')).toBeNull();
    const current = host.querySelector('video')!;
    session.destroy();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(2);
    expect(current.querySelector('source[src]')).toBeNull();
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(2);
  });

  it.each(['replace', 'destroy', 'abort'] as const)('does not attach late audio artwork after %s', async action => {
    const { host, session } = setup(createMediaPreviewDriver);
    let finish!: (bytes: ArrayBuffer) => void;
    const blob = new Blob();
    Object.defineProperty(blob, 'slice', { value: () => ({ arrayBuffer: () => new Promise(resolve => { finish = resolve; }) }) });
    const controller = new AbortController();
    const pending = session.load(blob, context(blob, 'old.mp3', controller.signal));
    expect(host.querySelector('audio')).toBeTruthy();
    if (action === 'replace') await session.load('/current.mp4', context('/current.mp4', 'current.mp4'));
    if (action === 'destroy') session.destroy();
    if (action === 'abort') controller.abort();
    const settled = pending.catch(error => { expect(action).toBe('abort'); expect(error.name).toBe('AbortError'); });
    finish(new ArrayBuffer(0)); await settled;
    expect(host.querySelector('audio')).toBeNull();
    if (action === 'replace') expect(session.getState()).toMatchObject({ title: 'current.mp4', family: 'video' });
  });

  it('still offers audio playback if optional artwork cannot be read', async () => {
    const { host, session } = setup(createMediaPreviewDriver);
    const blob = new Blob();
    Object.defineProperty(blob, 'slice', { value: () => ({ arrayBuffer: () => Promise.reject(new Error('Artwork unavailable')) }) });
    await session.load(blob, context(blob, 'audio.mp3'));
    expect(host.querySelector('audio')).toBeTruthy(); expect(session.getState().error).toBeNull();
  });

  it.each(['view', 'data-view', 'shared-view'] as const)('snapshots only the supplied byte slice for a %s', async kind => {
    const { host, session } = setup(createImagePreviewDriver);
    const buffer = kind === 'shared-view' ? new SharedArrayBuffer(64) : new ArrayBuffer(64);
    const bytes = new Uint8Array(buffer); bytes.fill(99); bytes.set([1, 2, 3, 4], 7);
    const source = kind === 'data-view' ? new DataView(buffer, 7, 4) : new Uint8Array(buffer, 7, 4);
    await session.load(source, context(source, 'image.png'));
    bytes.fill(0);
    const blob = blobs.get(host.querySelector('img')!.src)!;
    expect([...await readBlob(blob)]).toEqual([1, 2, 3, 4]);
  });

  it('snapshots artwork before the caller mutates the audio input at the first await', async () => {
    const { host, session } = setup(createMediaPreviewDriver);
    const image = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const mime = new TextEncoder().encode('image/png');
    const payload = new Uint8Array(1 + mime.length + 3 + image.length);
    payload.set(mime, 1); payload[1 + mime.length + 1] = 3; payload.set(image, 1 + mime.length + 3);
    const source = new Uint8Array(20 + payload.length);
    source.set([73, 68, 51, 3, 0, 0, 0, 0, 0, payload.length + 10]);
    source.set([65, 80, 73, 67, 0, 0, 0, payload.length, 0, 0], 10); source.set(payload, 20);
    const expected = source.slice();
    const pending = session.load(source, context(source, 'artwork.mp3'));
    source.fill(0); await pending;
    const media = host.querySelector('audio source') as HTMLSourceElement;
    const cover = host.querySelector('img')!;
    expect([...await readBlob(blobs.get(media.src)!)]).toEqual([...expected]);
    expect([...await readBlob(blobs.get(cover.src)!)]).toEqual([...image]);
  });
});
