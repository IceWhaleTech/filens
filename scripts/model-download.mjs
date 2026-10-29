// Transport only: concurrent mirror probes, verified ranges, and atomic cache
// installation. Inspired by Photos' internal/pkg/model/download_parallel.go.
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

export async function checksumMatches(file, artifact) {
  try {
    if ((await stat(file)).size !== artifact.bytes) return false;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest('hex') === artifact.sha256;
  } catch { return false; }
}

export async function downloadArtifact(artifact, options = {}) {
  const { signal, onEvent = () => {}, probeTimeoutMs = 5000, timeoutMs = 30000, chunkBytes = 1 << 20, concurrency = 4 } = options;
  const events = [];
  const emit = event => { events.push(event); onEvent({ artifact: artifact.name, ...event }); };
  signal?.throwIfAborted();
  if (!options.force && await checksumMatches(artifact.path, artifact)) {
    emit({ type: 'cached', bytes: artifact.bytes });
    return { name: artifact.name, cached: true, sha256: artifact.sha256, events };
  }
  if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0 || !/^[a-f0-9]{64}$/.test(artifact.sha256)) throw new Error('A pinned model size and SHA-256 are required');
  if (!artifact.sources?.length) throw new Error('No model sources configured');
  await mkdir(path.dirname(artifact.path), { recursive: true });
  const probes = await Promise.all(artifact.sources.map(async source => {
    const started = performance.now();
    const probeBytes = Math.min(256 << 10, artifact.bytes);
    try {
      const response = await fetch(source.url, {
        headers: { Range: `bytes=0-${probeBytes - 1}`, 'Accept-Encoding': 'identity' },
        signal: combinedSignal(signal, probeTimeoutMs)
      });
      if (response.status !== 200 && response.status !== 206) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
      }
      const ranges = response.status === 206;
      if (ranges && response.headers.get('content-range') !== `bytes 0-${probeBytes - 1}/${artifact.bytes}`) {
        await response.body?.cancel();
        throw new Error('Invalid probe Content-Range');
      }
      let received = 0;
      const reader = response.body.getReader();
      try {
        while (received < probeBytes) {
          const item = await reader.read();
          if (item.done) break;
          received += Math.min(item.value.length, probeBytes - received);
        }
      } finally { await reader.cancel(); }
      if (received !== probeBytes) throw new Error('Truncated probe');
      const elapsedMs = Math.max(10, performance.now() - started);
      const bytesPerSecond = received * 1000 / elapsedMs;
      emit({ type: 'probe', source: source.name, url: source.url, bytesPerSecond, elapsedMs, rangeSupported: ranges });
      return { ...source, bytesPerSecond, ranges };
    } catch (error) {
      emit({ type: 'probe', source: source.name, url: source.url, error: error.message });
      return { ...source, bytesPerSecond: 0, ranges: false };
    }
  }));
  signal?.throwIfAborted();
  probes.sort((a, b) => b.bytesPerSecond - a.bytesPerSecond);
  const ranged = probes.filter(p => p.ranges);
  const fastest = ranged[0]?.bytesPerSecond ?? 0;
  const selected = ranged.filter(p => p.bytesPerSecond >= fastest * 0.2);
  const temporary = `${artifact.path}.${randomUUID()}.part`;
  const started = performance.now();
  let used = new Set();
  try {
    if (selected.length) {
      const controller = new AbortController();
      const transferSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.truncate(artifact.bytes);
        let next = 0;
        let completed = 0;
        const count = Math.ceil(artifact.bytes / chunkBytes);
        const workers = Array.from({ length: Math.min(concurrency, count) }, async (_, worker) => {
          while (next < count) {
            transferSignal.throwIfAborted();
            const index = next++;
            const start = index * chunkBytes;
            const end = Math.min(artifact.bytes, start + chunkBytes) - 1;
            let failure;
            for (let attempt = 0; attempt < selected.length; attempt++) {
              const source = selected[(worker + attempt) % selected.length];
              try {
                await transfer(source, file, start, end, artifact.bytes, combinedSignal(transferSignal, timeoutMs), true);
                used.add(source.name);
                failure = undefined;
                break;
              } catch (error) {
                failure = error;
                emit({ type: 'retry', source: source.name, error: error.message, start, end });
                transferSignal.throwIfAborted();
              }
            }
            if (failure) throw failure;
            completed += end - start + 1;
            emit({ type: 'progress', completed, bytes: artifact.bytes, bytesPerSecond: completed * 1000 / Math.max(10, performance.now() - started) });
          }
        }).map(promise => promise.catch(error => { controller.abort(error); throw error; }));
        const results = await Promise.allSettled(workers);
        const failure = results.find(r => r.status === 'rejected');
        if (failure) throw failure.reason;
      } catch (error) {
        emit({ type: 'fallback', error: error.message });
      } finally { await file.close(); }
    }
    if (!(await checksumMatches(temporary, artifact))) {
      signal?.throwIfAborted();
      used = new Set();
      let lastError;
      for (const source of probes) {
        const file = await open(temporary, 'w', 0o600);
        try {
          await transfer(source, file, 0, artifact.bytes - 1, artifact.bytes, combinedSignal(signal, timeoutMs), false);
          await file.close();
          if (!(await checksumMatches(temporary, artifact))) throw new Error('Model SHA-256 mismatch');
          used.add(source.name);
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          emit({ type: 'retry', source: source.name, error: error.message });
          signal?.throwIfAborted();
        } finally { await file.close(); }
      }
      if (lastError) throw new Error(`All sources failed for ${artifact.name}: ${lastError.message}`);
    }
    signal?.throwIfAborted();
    await rename(temporary, artifact.path);
    const elapsedMs = performance.now() - started;
    emit({ type: 'complete', sources: [...used], bytes: artifact.bytes, elapsedMs, bytesPerSecond: artifact.bytes * 1000 / Math.max(10, elapsedMs) });
    return { name: artifact.name, cached: false, sha256: artifact.sha256, events };
  } finally { await rm(temporary, { force: true }); }
}

function combinedSignal(signal, timeout) {
  const deadline = AbortSignal.timeout(timeout);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

async function transfer(source, file, start, end, total, signal, ranged) {
  const headers = { 'Accept-Encoding': 'identity' };
  if (ranged) headers.Range = `bytes=${start}-${end}`;
  const response = await fetch(source.url, { headers, signal });
  const length = end - start + 1;
  if ((ranged && (response.status !== 206 || response.headers.get('content-range') !== `bytes ${start}-${end}/${total}`)) || (!ranged && response.status !== 200)) {
    await response.body?.cancel();
    throw new Error(`Invalid download response: HTTP ${response.status}`);
  }
  let written = 0;
  for await (const chunk of response.body) {
    if (written + chunk.length > length) throw new Error('Model response exceeds pinned size');
    let offset = 0;
    while (offset < chunk.length) {
      const result = await file.write(chunk, offset, chunk.length - offset, start + written + offset);
      if (!result.bytesWritten) throw new Error('Model cache write made no progress');
      offset += result.bytesWritten;
    }
    written += chunk.length;
  }
  if (written !== length) throw new Error('Truncated model download');
}
