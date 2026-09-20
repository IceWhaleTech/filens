import type { IworkTypeHint, ParsedIworkDocument, ParsedNumbersSheet } from '../types';

interface WorkerResponse {
  id: number;
  document?: ParsedIworkDocument;
  sheet?: ParsedNumbersSheet;
  error?: string;
}

type WorkerResult = ParsedIworkDocument | ParsedNumbersSheet;

export class IworkWorkerClient {
  private readonly worker: Worker;
  private requestId = 0;
  private readonly pending = new Map<number, { resolve(value: WorkerResult): void; reject(error: Error): void }>();

  constructor() {
    if (typeof Worker === 'undefined') {
      throw new Error('Web Worker is required for iWork preview parsing.');
    }

    this.worker = new Worker(new URL('./iwork-worker.ts', import.meta.url), {
      type: 'module'
    });
    this.worker.addEventListener('message', this.handleMessage);
    this.worker.addEventListener('error', this.handleError);
  }

  parse(bytes: Uint8Array, hint?: IworkTypeHint, sourceName?: string): Promise<ParsedIworkDocument> {
    const id = ++this.requestId;
    const payload = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer;
    return new Promise<ParsedIworkDocument>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: WorkerResult) => void, reject });
      this.worker.postMessage(
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
      this.worker.postMessage({ kind: 'sheet', id, index });
    });
  }

  destroy(): void {
    this.worker.removeEventListener('message', this.handleMessage);
    this.worker.removeEventListener('error', this.handleError);
    this.worker.terminate();
    for (const entry of this.pending.values()) {
      entry.reject(new Error('iWork parser worker terminated.'));
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
    for (const entry of this.pending.values()) {
      entry.reject(error);
    }
    this.pending.clear();
  };
}
