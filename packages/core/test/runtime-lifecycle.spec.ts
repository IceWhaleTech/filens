import { describe, expect, it, vi } from 'vitest';
import { createPreviewer } from '../src/preview/previewer';
import type {
  ConversionResult, PreviewDriver, PreviewEventMap, PreviewEventName,
  PreviewItemState, PreviewLoadContext, PreviewSession, PreviewerInstance
} from '../src/preview/types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup(load?: (session: TestSession, context: PreviewLoadContext) => Promise<void>) {
  const sessions: TestSession[] = [];
  const host = document.createElement('div');
  const driver: PreviewDriver = {
    id: 'text', family: 'text', supports: format => format === 'txt',
    createSession: () => {
      const handlers = new Map<PreviewEventName, Set<(payload: any) => void>>();
      const session: TestSession = {
        state: { loading: false, error: null, family: 'text', warnings: [], capabilities: {} },
        load: vi.fn(async (_source, context) => {
          session.context = context;
          session.state.title = context.descriptor.name;
          await load?.(session, context);
        }),
        destroy: vi.fn(),
        getState: () => session.state,
        on: (event, handler) => {
          const items = handlers.get(event) ?? new Set();
          items.add(handler); handlers.set(event, items);
          return () => { items.delete(handler); };
        },
        emit: (event, payload) => {
          for (const handler of handlers.get(event) ?? []) handler(payload);
        }
      };
      sessions.push(session);
      return session;
    }
  };
  return { host, driver, sessions };
}

interface TestSession extends PreviewSession {
  state: PreviewItemState;
  context?: PreviewLoadContext;
  emit<T extends PreviewEventName>(event: T, payload: PreviewEventMap[T]): void;
}

const conversionRoutes = [{
  extensions: ['legacy'], targetFormat: 'txt', family: 'text' as const, driverId: 'text',
  conversion: { required: true }
}, { extensions: ['txt'], family: 'text' as const, driverId: 'text' }];
const input = new Uint8Array([1]);
// A turn boundary tests settlement without waiting for non-cooperative work to finish.
const nextTurn = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('Previewer load ownership', () => {
  it.each(['replace', 'destroy'] as const)('settles a non-cooperative converter on %s and ignores its late rejection', async action => {
    const work = deferred<ConversionResult>();
    const fixture = setup();
    let signal: AbortSignal | undefined;
    const previewer = createPreviewer(fixture.host, {
      drivers: [fixture.driver], routes: conversionRoutes,
      converter: { convert: (_request, context) => { signal = context.signal; return work.promise; } }
    });
    const errors = vi.fn(); previewer.on('error', errors);
    let settled = false;
    const old = previewer.preview(input, { name: 'old.legacy' }).then(() => { settled = true; });
    if (action === 'replace') await previewer.preview(input, { name: 'new.txt' });
    else previewer.destroy();
    await nextTurn();
    const settledBeforeCompletion = settled;
    work.reject(new Error('late conversion failure')); await old;
    expect(settledBeforeCompletion).toBe(true);
    expect(signal?.aborted).toBe(true);
    expect(errors).not.toHaveBeenCalled();
    expect(previewer.getState()).toMatchObject(action === 'replace' ? { title: 'new.txt', error: null } : { family: 'unsupported' });
    previewer.destroy();
  });

  it.each(['replace', 'destroy'] as const)('settles a non-cooperative session on %s and discards late events', async action => {
    const work = deferred<void>();
    const fixture = setup(async session => { if (session.state.title === 'old.txt') await work.promise; });
    const previewer = createPreviewer(fixture.host, { drivers: [fixture.driver] });
    const errors = vi.fn(); previewer.on('error', errors);
    let settled = false;
    const old = previewer.preview(input, { name: 'old.txt' }).then(() => { settled = true; });
    await nextTurn();
    const oldSession = fixture.sessions[0];
    if (action === 'replace') await previewer.preview(input, { name: 'new.txt' });
    else previewer.destroy();
    await nextTurn(); const settledBeforeCompletion = settled;
    oldSession.emit('error', new Error('obsolete event'));
    oldSession.emit('rendered', { ...oldSession.state, title: 'obsolete' });
    work.reject(new Error('late driver failure')); await old;
    expect(settledBeforeCompletion).toBe(true);
    expect(oldSession.destroy).toHaveBeenCalledTimes(1);
    expect(errors).not.toHaveBeenCalled();
    expect(previewer.getState()).toMatchObject(action === 'replace' ? { title: 'new.txt', error: null } : { family: 'unsupported' });
    previewer.destroy();
  });

  it('keeps the load signal alive after initial load so replacement cancels background work', async () => {
    const fixture = setup();
    const previewer = createPreviewer(fixture.host, { drivers: [fixture.driver] });
    await previewer.preview(input, { name: 'old.txt' });
    const signal = fixture.sessions[0].context?.signal;
    expect(signal?.aborted).toBe(false);
    await previewer.preview(input, { name: 'new.txt' });
    expect(signal?.aborted).toBe(true);
    const currentSignal = fixture.sessions[1].context?.signal;
    previewer.destroy();
    expect(currentSignal?.aborted).toBe(true);
  });

  it.each([new Error('driver failed'), Object.assign(new Error('remote aborted'), { name: 'AbortError' })])(
    'exposes rejected loads in getState and releases the failed session: %s', async error => {
      const fixture = setup(async session => { session.state.loading = true; throw error; });
      const previewer = createPreviewer(fixture.host, { drivers: [fixture.driver] });
      const errors = vi.fn(); previewer.on('error', errors);
      await previewer.preview(input, { name: 'broken.txt' });
      expect(previewer.getState()).toMatchObject({ loading: false, error: error.message });
      expect(fixture.sessions[0].destroy).toHaveBeenCalledTimes(1);
      expect(fixture.sessions[0].context?.signal?.aborted).toBe(true);
      expect(errors).toHaveBeenCalledTimes(1);
      expect(errors).toHaveBeenCalledWith(error);
      previewer.destroy();
    }
  );

  it.each(['replace', 'destroy'] as const)('does not start conversion after a loading listener requests %s', async action => {
    const fixture = setup(); const convert = vi.fn(async () => ({ source: input, format: 'txt' }));
    const previewer = createPreviewer(fixture.host, { drivers: [fixture.driver], routes: conversionRoutes, converter: { convert } });
    let replacement: Promise<void> | undefined;
    const off = previewer.on('loading', () => {
      off();
      if (action === 'replace') replacement = previewer.preview(input, { name: 'new.txt' });
      else previewer.destroy();
    });
    await previewer.preview(input, { name: 'old.legacy' }); await replacement;
    expect(convert).not.toHaveBeenCalled();
    expect(previewer.getState()).toMatchObject(action === 'replace' ? { title: 'new.txt' } : { family: 'unsupported', loading: false });
    previewer.destroy();
  });

  it.each(['replace', 'destroy'] as const)('does not start a converted session after a warning listener requests %s', async action => {
    const fixture = setup();
    const previewer = createPreviewer(fixture.host, {
      drivers: [fixture.driver], routes: conversionRoutes,
      converter: { convert: async () => ({ source: input, format: 'txt', warnings: ['converted'] }) }
    });
    let replacement: Promise<void> | undefined;
    previewer.on('warnings', () => {
      if (action === 'replace') replacement = previewer.preview(input, { name: 'new.txt' });
      else previewer.destroy();
    });
    await previewer.preview(input, { name: 'old.legacy' }); await replacement;
    expect(fixture.sessions).toHaveLength(action === 'replace' ? 1 : 0);
    previewer.destroy();
  });

  it('detaches the old session before its destroy callback opens another preview', async () => {
    const fixture = setup();
    const previewer = createPreviewer(fixture.host, { drivers: [fixture.driver] });
    await previewer.preview(input, { name: 'old.txt' });
    let replacement: Promise<void> | undefined;
    vi.mocked(fixture.sessions[0].destroy).mockImplementationOnce(() => {
      replacement = previewer.preview(input, { name: 'callback.txt' });
    });
    await previewer.preview(input, { name: 'superseded.txt' }); await replacement;
    expect(fixture.sessions[0].destroy).toHaveBeenCalledTimes(1);
    expect(fixture.sessions).toHaveLength(2);
    expect(previewer.getState()).toMatchObject({ title: 'callback.txt' });
    expect(fixture.sessions[1].context?.signal?.aborted).toBe(false);
    previewer.destroy();
  });

  it('preserves a preview opened by an abort callback', async () => {
    let previewer!: PreviewerInstance;
    let replacement: Promise<void> | undefined;
    const fixture = setup(async (_session, context) => {
      if (context.descriptor.name === 'old.txt') context.signal?.addEventListener('abort', () => {
        replacement = previewer.preview(input, { name: 'callback.txt' });
      }, { once: true });
    });
    previewer = createPreviewer(fixture.host, { drivers: [fixture.driver] });
    await previewer.preview(input, { name: 'old.txt' });
    await previewer.preview(input, { name: 'superseded.txt' }); await replacement;
    expect(previewer.getState()).toMatchObject({ title: 'callback.txt' });
    expect(fixture.sessions).toHaveLength(2);
    expect(fixture.sessions[1].context?.signal?.aborted).toBe(false);
    previewer.destroy();
  });

  it('preserves a preview opened by a session destroy callback during destroy', async () => {
    const fixture = setup(); const previewer = createPreviewer(fixture.host, { drivers: [fixture.driver] });
    await previewer.preview(input, { name: 'old.txt' });
    let replacement: Promise<void> | undefined;
    vi.mocked(fixture.sessions[0].destroy).mockImplementationOnce(() => {
      replacement = previewer.preview(input, { name: 'reopened.txt' });
    });
    previewer.destroy(); await replacement;
    expect(fixture.sessions[0].destroy).toHaveBeenCalledTimes(1);
    expect(previewer.getState()).toMatchObject({ title: 'reopened.txt' });
    previewer.destroy();
  });

  it('keeps an emitted error visible after load resolves and allows explicit state recovery', async () => {
    const work = deferred<void>();
    const fixture = setup(async session => {
      session.emit('error', new Error('decoder failed'));
      await work.promise;
    });
    const previewer = createPreviewer(fixture.host, { drivers: [fixture.driver] });
    const seen: PreviewItemState[] = [];
    previewer.on('error', () => { seen.push(previewer.getState()); });
    const task = previewer.preview(input, { name: 'broken.txt' });
    await nextTurn();
    work.resolve(); await task;
    expect(seen[0]).toMatchObject({ error: 'decoder failed', loading: false });
    expect(previewer.getState()).toMatchObject({ error: 'decoder failed', loading: false });
    fixture.sessions[0].emit('statechange', { ...fixture.sessions[0].state, error: null });
    expect(previewer.getState().error).toBeNull();
    previewer.destroy();
  });

  it('does not deliver obsolete loading events to later listeners after a listener destroys the preview', async () => {
    const fixture = setup(); const previewer = createPreviewer(fixture.host, { drivers: [fixture.driver] });
    previewer.on('loading', () => { previewer.destroy(); });
    const later = vi.fn(); previewer.on('loading', later);
    await previewer.preview(input, { name: 'old.txt' });
    expect(later).not.toHaveBeenCalled();
    expect(fixture.sessions).toHaveLength(0);
  });

  it('discards a late successful conversion and its warnings', async () => {
    const fixture = setup(); const work = deferred<ConversionResult>();
    const previewer = createPreviewer(fixture.host, {
      drivers: [fixture.driver], routes: conversionRoutes,
      converter: { convert: () => work.promise }
    });
    const warnings = vi.fn(); previewer.on('warnings', warnings);
    const old = previewer.preview(input, { name: 'old.legacy' });
    await previewer.preview(input, { name: 'new.txt' });
    work.resolve({ source: input, format: 'txt', warnings: ['obsolete'] }); await old; await nextTurn();
    expect(warnings).not.toHaveBeenCalled();
    expect(fixture.sessions).toHaveLength(1);
    expect(previewer.getState().title).toBe('new.txt');
    previewer.destroy();
  });

  it('destroys a session superseded inside its factory without loading it', async () => {
    const fixture = setup(); const original = fixture.driver.createSession;
    let previewer!: PreviewerInstance;
    let replacement: Promise<void> | undefined;
    fixture.driver.createSession = (...args) => {
      const session = original(...args);
      fixture.driver.createSession = original;
      replacement = previewer.preview(input, { name: 'new.txt' });
      return session;
    };
    previewer = createPreviewer(fixture.host, { drivers: [fixture.driver] });
    await previewer.preview(input, { name: 'old.txt' }); await replacement;
    expect(fixture.sessions[0].load).not.toHaveBeenCalled();
    expect(fixture.sessions[0].destroy).toHaveBeenCalledTimes(1);
    expect(previewer.getState().title).toBe('new.txt');
    previewer.destroy();
  });
});
