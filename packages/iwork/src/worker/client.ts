import type { IworkTypeHint, ParsedIworkDocument, ParsedNumbersSheet } from '../types';

interface WorkerResponse {
  id: number;
  document?: ParsedIworkDocument;
  sheet?: ParsedNumbersSheet;
  error?: string;
}

type WorkerResult = ParsedIworkDocument | ParsedNumbersSheet;

export class IworkWorkerClient {
  private worker: Worker | null = null;
  private destroyed = false;
  private requestId = 0;
  private readonly pending = new Map<number, { resolve(value: WorkerResult): void; reject(error: Error): void }>();

  constructor() {
    if (typeof Worker === 'undefined') {
      throw new Error('Web Worker is required for iWork preview parsing.');
    }

    this.getWorker();
  }

  private getWorker(): Worker {
    if (this.destroyed) throw new Error('iWork parser worker has been destroyed.');
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL('./iwork-worker.ts', import.meta.url), {
      type: 'module'
    });
    this.worker.addEventListener('message', this.handleMessage);
    this.worker.addEventListener('error', this.handleError);
    return this.worker;
  }

  parse(bytes: Uint8Array, hint?: IworkTypeHint, sourceName?: string): Promise<ParsedIworkDocument> {
    if (this.pending.size) this.cancel();
    const id = ++this.requestId;
    const payload = bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? bytes.buffer : bytes.slice().buffer;
    return new Promise<ParsedIworkDocument>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: WorkerResult) => void, reject });
      this.postRequest(id,
        {
          kind: 'document',
          id,
          bytes: payload,
          hint,
          sourceName
        },
        [payload]
      );
    });
  }

  parseSheet(index: number): Promise<ParsedNumbersSheet> {
    const id = ++this.requestId;
    return new Promise<ParsedNumbersSheet>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: WorkerResult) => void, reject });
      this.postRequest(id, { kind: 'sheet', id, index });
    });
  }

  cancel(): void {
    if (this.pending.size) {
      this.stopWorker(new DOMException('iWork parsing cancelled.', 'AbortError'));
    } else if (this.worker) {
      // Release the old archive while retaining an idle worker for the next file.
      try { this.worker.postMessage({ kind: 'clear' }); }
      catch { this.stopWorker(new DOMException('iWork parsing cancelled.', 'AbortError')); }
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.stopWorker(new DOMException('iWork parser worker terminated.', 'AbortError'));
  }

  private postRequest(id: number, message: object, transfer: Transferable[] = []): void {
    try { this.getWorker().postMessage(message, transfer); }
    catch (error) {
      const pending = this.pending.get(id);
      this.pending.delete(id);
      pending?.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private stopWorker(error: Error): void {
    const worker = this.worker;
    this.worker = null;
    worker?.removeEventListener('message', this.handleMessage);
    worker?.removeEventListener('error', this.handleError);
    worker?.terminate();
    for (const entry of this.pending.values()) {
      entry.reject(error);
    }
    this.pending.clear();
  }

  private readonly handleMessage = (event: MessageEvent<WorkerResponse>) => {
    const pending = this.pending.get(event.data.id);
    if (!pending) {
      return;
    }

    this.pending.delete(event.data.id);
    if (event.data.error) {
      pending.reject(new Error(event.data.error));
      return;
    }

    const result = event.data.document ?? event.data.sheet;
    if (!result) {
      pending.reject(new Error('iWork parser worker returned an empty result.'));
      return;
    }

    pending.resolve(result);
  };

  private readonly handleError = (event: ErrorEvent) => {
    const error = new Error(event.message || 'iWork parser worker failed.');
    this.stopWorker(error);
  };
}
