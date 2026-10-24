export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function abortError(): Error {
  return Object.assign(new Error('The conversion was aborted.'), { name: 'AbortError' });
}

export function waitForConversion<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError());
    // Observe late failures even if the operation was cancelled synchronously.
    work.then(
      value => { signal.removeEventListener('abort', abort); resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(error); }
    );
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

export function retryableLoader<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    if (!pending) {
      const attempt = Promise.resolve().then(load);
      pending = attempt;
      void attempt.catch(() => { if (pending === attempt) pending = undefined; });
    }
    return pending;
  };
}

export function isConversionSourceUrl(source: string): boolean {
  return /^(?:https?:|blob:|\/|\.{1,2}\/)/i.test(source);
}

export function isDataUrl(source: string): boolean {
  return source.trimStart().toLowerCase().startsWith('data:');
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < bytes.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function readDataUrl(source: string): { bytes: Uint8Array; contentType?: string } {
  const url = source.trimStart(), comma = url.indexOf(',');
  if (comma < 0) throw new Error('Conversion data URL is missing its payload separator.');
  const meta = url.slice(0, comma), payload = url.slice(comma + 1);
  const contentType = meta.match(/^data:([^;,]+)/i)?.[1];
  if (/;base64$/i.test(meta)) return { bytes: base64ToBytes(payload), contentType };
  // Decode percent escapes as bytes: binary payloads need not be valid UTF-8.
  const bytes = new TextEncoder().encode(payload);
  let written = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 37) {
      const high = hexDigit(bytes[i + 1]), low = hexDigit(bytes[i + 2]);
      if (high >= 0 && low >= 0) {
        bytes[written++] = (high << 4) | low;
        i += 2;
        continue;
      }
    }
    bytes[written++] = bytes[i];
  }
  return { bytes: bytes.subarray(0, written), contentType };
}

function hexDigit(value: number): number {
  if (value >= 48 && value <= 57) return value - 48;
  const lower = value | 32;
  return lower >= 97 && lower <= 102 ? lower - 87 : -1;
}
