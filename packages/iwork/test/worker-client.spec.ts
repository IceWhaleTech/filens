// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IworkWorkerClient } from '../src/worker/client';

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  messages: any[] = [];
  terminated = false;
  failPost = false;
  constructor(_url: URL, _options: WorkerOptions) { super(); FakeWorker.instances.push(this); }
  postMessage(message: object, transfer: Transferable[] = []) {
    if (this.failPost) throw new Error('postMessage failed');
    this.messages.push(structuredClone(message, { transfer }));
  }
  terminate() { this.terminated = true; }
  reply(data: object) { this.dispatchEvent(new MessageEvent('message', { data })); }
  fail(message: string) { this.dispatchEvent(Object.assign(new Event('error'), { message })); }
}
const input = () => new Uint8Array([1, 2, 3]);
beforeEach(() => { FakeWorker.instances = []; vi.stubGlobal('Worker', FakeWorker); });
afterEach(() => vi.unstubAllGlobals());

describe('iWork worker lifecycle', () => {
  it('terminates busy parsing immediately and recreates the worker on the next request', async () => {
    const client = new IworkWorkerClient(), first = FakeWorker.instances[0], task = client.parse(input());
    const rejected = expect(task).rejects.toMatchObject({ name: 'AbortError' }); client.cancel(); await rejected;
    expect(first.terminated).toBe(true); const next = client.parse(input()), second = FakeWorker.instances[1];
    first.reply({ id: first.messages[0].id, document: { kind: 'pages' } });
    second.reply({ id: second.messages[0].id, document: { kind: 'key' } }); await expect(next).resolves.toEqual({ kind: 'key' }); client.destroy();
  });
  it('clears an idle archive without discarding the warm worker', async () => {
    const client = new IworkWorkerClient(), worker = FakeWorker.instances[0], task = client.parse(input());
    worker.reply({ id: worker.messages[0].id, document: { kind: 'numbers' } }); await task; client.cancel();
    expect(worker.messages.at(-1)).toEqual({ kind: 'clear' }); expect(worker.terminated).toBe(false);
    const next = client.parse(input()); worker.reply({ id: worker.messages.at(-1).id, document: { kind: 'pages' } }); await next;
    expect(FakeWorker.instances).toHaveLength(1); client.destroy();
  });
  it('rejects old lazy sheets when a new document starts', async () => {
    const client = new IworkWorkerClient(), old = client.parseSheet(1), rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' });
    const current = client.parse(input()); await rejected; const worker = FakeWorker.instances[1];
    worker.reply({ id: worker.messages[0].id, document: { kind: 'pages' } }); await current; client.destroy();
  });
  it('recovers after an actual worker error', async () => {
    const client = new IworkWorkerClient(), old = client.parse(input()), rejected = expect(old).rejects.toThrow('broken worker');
    FakeWorker.instances[0].fail('broken worker'); await rejected;
    const next = client.parse(input()), worker = FakeWorker.instances[1];
    worker.reply({ id: worker.messages[0].id, document: { kind: 'pages' } }); await next; client.destroy();
  });
  it('does not leave orphan requests after synchronous postMessage failures', async () => {
    const client = new IworkWorkerClient(), worker = FakeWorker.instances[0]; worker.failPost = true;
    await expect(client.parse(input())).rejects.toThrow('postMessage failed'); worker.failPost = false; client.cancel();
    expect(worker.terminated).toBe(false); expect(worker.messages).toEqual([{ kind: 'clear' }]); client.destroy();
  });
  it('rejects all requests after destruction instead of leaving them pending', async () => {
    const client = new IworkWorkerClient(); client.destroy(); client.destroy();
    await expect(client.parse(input())).rejects.toThrow('destroyed'); await expect(client.parseSheet(0)).rejects.toThrow('destroyed');
    expect(FakeWorker.instances).toHaveLength(1);
  });
  for (const kind of ['slice', 'shared'] as const) it(`transfers only owned ${kind} bytes`, async () => {
    const client = new IworkWorkerClient(), worker = FakeWorker.instances[0];
    const backing = kind === 'slice' ? new ArrayBuffer(8) : new SharedArrayBuffer(8), original = new Uint8Array(backing);
    original.set([9, 1, 2, 3, 8]); const task = client.parse(original.subarray(1, 4));
    expect([...new Uint8Array(worker.messages[0].bytes)]).toEqual([1, 2, 3]); expect(original.byteLength).toBe(8);
    worker.reply({ id: worker.messages[0].id, document: { kind: 'pages' } }); await task; client.destroy();
  });
  it('clears a failed idle worker when releasing an archive fails', () => {
    const client = new IworkWorkerClient(), worker = FakeWorker.instances[0]; worker.failPost = true; client.cancel();
    expect(worker.terminated).toBe(true); client.destroy();
  });
});
