import type { ConversionResult } from '@filens/core';
import MediaWorker from './media-worker?worker&inline';
import heifWasmUrl from 'libheif-js/libheif-wasm/libheif.wasm?url';
import { throwIfAborted } from './source';

export function convertMedia(input: Uint8Array, format: string, signal?: AbortSignal): Promise<ConversionResult> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const worker = new MediaWorker();
    const cleanup = () => {
      signal?.removeEventListener('abort', abort);
      worker.terminate();
    };
    const abort = () => {
      cleanup();
      reject(new DOMException('Media conversion was aborted.', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = event => { cleanup(); reject(new Error(event.message || 'Media conversion worker failed.')); };
    worker.onmessageerror = () => { cleanup(); reject(new Error('Invalid media conversion response.')); };
    worker.onmessage = ({ data }: MessageEvent<ConversionResult & { error?: string }>) => {
      cleanup();
      if (data.error) reject(new Error(data.error));
      else resolve(data);
    };
    // Resolve asset URLs in the document, before passing them into a Blob worker.
    try {
      worker.postMessage({ input, format, wasmUrl: new URL(heifWasmUrl, import.meta.url).href }, [input.buffer as ArrayBuffer]);
    } catch (error) { cleanup(); reject(error); }
  });
}
