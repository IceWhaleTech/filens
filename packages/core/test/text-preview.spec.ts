import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTextPreviewDriver, resolveFormatRoute, type PreviewLoadContext, type PreviewSource } from '../src/preview';

const context = (source: PreviewSource, name = 'notes.txt', signal?: AbortSignal): PreviewLoadContext => ({
  descriptor: { source, name }, route: resolveFormatRoute({ name }) ?? undefined, signal
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const delayedBlob = () => {
  const pending = deferred<string>();
  const blob = new Blob();
  Object.defineProperty(blob, 'text', { value: () => pending.promise });
  return { ...pending, blob };
};
const makeSession = () => {
  const host = document.createElement('div'); document.body.append(host);
  return { host, session: createTextPreviewDriver().createSession(host) };
};
afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

describe('native text preview', () => {
  it.each([
    ['', 0], ['one', 1], ['one\n', 2], ['\r\n', 2], ['a\rb\nc\r\nd\n', 5]
  ])('counts mixed line endings and keeps the entire text: %j', async (text, count) => {
    const { host, session } = makeSession();
    const source = new TextEncoder().encode(text);
    await session.load(source, context(source));
    expect(session.getState()).toMatchObject({ lineCount: count, loading: false, error: null });
    expect(host.querySelector('pre')?.textContent).toBe(text);
    expect(host.querySelector('.pptxv-native-text-gutter')?.textContent)
      .toBe(Array.from({ length: count }, (_, i) => String(i + 1)).join('\n'));
    session.destroy();
  });

  it('opens more lines than the browser argument limit and retains all content and numbers', async () => {
    const { host, session } = makeSession();
    const text = 'const value = 1;\n'.repeat(200_000);
    const source = new TextEncoder().encode(text);
    await session.load(source, context(source, 'large.js'));
    expect(session.getState()).toMatchObject({ lineCount: 200_001, family: 'code', loading: false, error: null });
    const pre = host.querySelector('pre')!;
    expect(pre.textContent).toBe(text);
    expect(pre.dataset.highlighted).toBe('false');
    const gutter = host.querySelector('.pptxv-native-text-gutter')!;
    const numbers = gutter.textContent!.split('\n');
    expect(numbers).toHaveLength(200_001);
    expect(numbers.every((number, i) => number === String(i + 1))).toBe(true);
    expect(gutter.childElementCount).toBeLessThan(100);
    session.destroy();
  });

  it.each(['resolve', 'reject'] as const)('discards a replaced Blob read that later %ss', async action => {
    const { host, session } = makeSession();
    const old = delayedBlob();
    const rendered = vi.fn(), error = vi.fn(); session.on('rendered', rendered); session.on('error', error);
    const pending = session.load(old.blob, context(old.blob, 'old.txt'));
    const source = new TextEncoder().encode('const current = true;');
    await session.load(source, context(source, 'current.ts'));
    if (action === 'resolve') old.resolve('stale'); else old.reject(new Error('stale failure'));
    await pending;
    expect(host.querySelector('pre')?.textContent).toBe('const current = true;');
    expect(session.getState()).toMatchObject({ title: 'current.ts', family: 'code', error: null });
    expect(rendered).toHaveBeenCalledTimes(1); expect(error).not.toHaveBeenCalled();
    session.destroy();
  });

  it('aborts an old network read when replacing its source', async () => {
    const { host, session } = makeSession();
    let oldSignal!: AbortSignal;
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => {
      oldSignal = init.signal;
      oldSignal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    })));
    const old = session.load('/old.txt', context('/old.txt'));
    const source = new TextEncoder().encode('current');
    await session.load(source, context(source));
    await old;
    expect(oldSignal.aborted).toBe(true);
    expect(host.querySelector('pre')?.textContent).toBe('current');
    session.destroy();
  });

  it('immediately stops loading when an uncancellable Blob read is aborted', async () => {
    const { host, session } = makeSession();
    const old = delayedBlob(), controller = new AbortController();
    const rendered = vi.fn(), error = vi.fn(); session.on('rendered', rendered); session.on('error', error);
    const pending = session.load(old.blob, context(old.blob, 'old.txt', controller.signal));
    controller.abort();
    expect(session.getState()).toMatchObject({ loading: false, error: null });
    old.resolve('cancelled');
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(host.querySelector('pre')).toBeNull();
    expect(rendered).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    session.destroy();
  });

  it('does not request an already aborted source', async () => {
    const { host, session } = makeSession();
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const controller = new AbortController(); controller.abort();
    await expect(session.load('/cancelled.txt', context('/cancelled.txt', 'cancelled.txt', controller.signal)))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled(); expect(host.querySelector('pre')).toBeNull();
    expect(session.getState()).toMatchObject({ loading: false, error: null });
    session.destroy();
  });

  it('does not render or emit events after destruction during a Blob read', async () => {
    const { host, session } = makeSession();
    const old = delayedBlob();
    const pending = session.load(old.blob, context(old.blob));
    const rendered = vi.fn(), statechange = vi.fn(), error = vi.fn();
    session.on('rendered', rendered); session.on('statechange', statechange); session.on('error', error);
    session.destroy(); old.resolve('stale'); await pending;
    expect(host.childElementCount).toBe(0);
    expect(rendered).not.toHaveBeenCalled(); expect(statechange).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    expect(session.getState().loading).toBe(false);
  });

  it('clears the previous preview when a new network source fails', async () => {
    const { host, session } = makeSession();
    const source = new TextEncoder().encode('old content');
    await session.load(source, context(source));
    const error = vi.fn(); session.on('error', error);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' }));
    await expect(session.load('/missing.txt', context('/missing.txt', 'missing.txt'))).rejects.toThrow('404 Not Found');
    expect(host.querySelector('pre')).toBeNull(); expect(error).toHaveBeenCalledTimes(1);
    expect(session.getState()).toMatchObject({ loading: false, title: 'missing.txt', lineCount: undefined });
    session.destroy();
  });
});
