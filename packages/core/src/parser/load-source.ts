import type { PptxSource } from '../types';

export interface LoadSourceOptions {
  signal?: AbortSignal;
}

export async function loadSourceBytes(source: PptxSource, options: LoadSourceOptions = {}): Promise<Uint8Array> {
  throwIfAborted(options.signal);

  if (typeof source === 'string') {
    const response = await fetch(source, {
      signal: options.signal
    });
    throwIfAborted(options.signal);
    if (!response.ok) {
      throw new Error(`Failed to fetch PPTX source: ${response.status} ${response.statusText}`);
    }

    const bytes = await response.arrayBuffer();
    throwIfAborted(options.signal);
    return new Uint8Array(bytes);
  }

  if (ArrayBuffer.isView(source)) {
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength).slice();
  }

  if (isArrayBufferLike(source)) {
    return new Uint8Array(source);
  }

  if (isBlobLike(source)) {
    const bytes = await source.arrayBuffer();
    throwIfAborted(options.signal);
    return new Uint8Array(bytes);
  }

  throw new Error('Unsupported PPTX source type.');
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function createAbortError(): Error {
  try {
    return new DOMException('The operation was aborted.', 'AbortError');
  } catch {
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error;
  }
}

function isArrayBufferLike(value: unknown): value is ArrayBufferLike {
  return (
    value instanceof ArrayBuffer ||
    Object.prototype.toString.call(value) === '[object ArrayBuffer]' ||
    Object.prototype.toString.call(value) === '[object SharedArrayBuffer]'
  );
}

function isBlobLike(value: unknown): value is Blob {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Blob).arrayBuffer === 'function' &&
    typeof (value as Blob).size === 'number'
  );
}
