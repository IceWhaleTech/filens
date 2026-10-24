import type { PanoramaProcessor } from './wasm-processor';

export function checkPanoramaLoad(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Panorama preview was aborted.', 'AbortError');
}

/** Settle cancellation promptly and release resources returned by obsolete work. */
export function waitForPanoramaLoad<T>(work: Promise<T>, signal: AbortSignal, release?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Panorama preview was aborted.', 'AbortError'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    work.then(value => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) release?.(value);
      else resolve(value);
    }, error => {
      signal.removeEventListener('abort', abort);
      if (!signal.aborted) reject(error);
    });
  });
}

/** Old renderers must not start reads or seam work on a replacement source. */
export function bindPanoramaProcessor(processor: PanoramaProcessor, signal: AbortSignal): PanoramaProcessor {
  const run = <T>(work: () => Promise<T>): Promise<T> => {
    checkPanoramaLoad(signal);
    return waitForPanoramaLoad(work(), signal);
  };
  return {
    open: (source, options) => run(() => processor.open(source, { ...options, signal })),
    ...(processor.decodeImage ? { decodeImage: () => run(() => processor.decodeImage!(signal)) } : {}),
    readSample: (track, index, readSignal) => run(() => processor.readSample(track, index, readSignal ?? signal)),
    readImuWindow: (start, count, readSignal) => run(() => processor.readImuWindow(start, count, readSignal ?? signal)),
    computeSeam: (request, readSignal) => run(() => processor.computeSeam(request, readSignal ?? signal)),
    seek: seconds => { checkPanoramaLoad(signal); return processor.seek(seconds); },
    getManifest: () => { checkPanoramaLoad(signal); return processor.getManifest(); },
    close: () => { if (!signal.aborted) processor.close(); },
    abort: () => { if (!signal.aborted) processor.abort(); }
  };
}
