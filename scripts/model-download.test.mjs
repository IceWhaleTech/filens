import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { downloadArtifact } from './model-download.mjs';
import { modelSources } from './download-agent-models.mjs';

async function fixture(t, routes, size = 768 << 10) {
  const work = await mkdtemp(path.join(os.tmpdir(), 'filens-model-test-'));
  const data = Buffer.alloc(size, 'model-weights');
  let active = 0;
  let peak = 0;
  let requests = 0;
  const server = createServer(async (request, response) => {
    active++; requests++; peak = Math.max(active, peak);
    response.on('close', () => { active--; });
    const route = routes[request.url] ?? {};
    if (route.status) { response.writeHead(route.status); response.end(); return; }
    let start = 0;
    let end = data.length - 1;
    if (request.headers.range && !route.noRanges) {
      const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range);
      [start, end] = match.slice(1).map(Number);
      response.writeHead(206, { 'Content-Range': route.badRange ? 'bytes 1-5/6' : `bytes ${start}-${end}/${data.length}` });
    } else response.writeHead(200);
    const content = route.corrupt ? Buffer.alloc(end - start + 1, 'wrong') : data.subarray(start, end + 1);
    for (let offset = 0; offset < content.length; offset += 32768) {
      if (response.destroyed) return;
      response.write(content.subarray(offset, offset + 32768));
      await delay(route.delay ?? 1);
    }
    response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(work, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    work, data, get peak() { return peak; }, get requests() { return requests; },
    artifact: { name: 'test.onnx', path: path.join(work, 'test.onnx'), bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), sources: Object.keys(routes).map(name => ({ name: name.slice(1), url: base + name })) }
  };
}

test('probes mirrors concurrently, downloads parallel ranges, validates and reuses cache', async t => {
  const f = await fixture(t, { '/one': {}, '/two': {}, '/three': {}, '/four': {} });
  const report = await downloadArtifact(f.artifact, { chunkBytes: 128 << 10 });
  assert.equal(report.cached, false);
  assert.ok(f.peak >= 3);
  const probes = report.events.filter(e => e.type === 'probe');
  assert.equal(probes.length, 4);
  assert.ok(probes.every(p => p.bytesPerSecond > 0 && p.rangeSupported));
  assert.ok(report.events.find(e => e.type === 'complete').sources.length > 1);
  assert.deepEqual(await readFile(f.artifact.path), f.data);
  const count = f.requests;
  assert.equal((await downloadArtifact(f.artifact)).cached, true);
  assert.equal(f.requests, count);
  assert.equal((await downloadArtifact(f.artifact, { force: true, chunkBytes: 128 << 10 })).cached, false);
  assert.ok(f.requests > count);
});

test('corrupt range source cannot install a model and whole-file fallback verifies the hash', async t => {
  const f = await fixture(t, { '/bad': { corrupt: true }, '/good': { delay: 2 } });
  const report = await downloadArtifact(f.artifact, { chunkBytes: 128 << 10 });
  assert.deepEqual(await readFile(f.artifact.path), f.data);
  assert.ok(report.events.some(e => e.type === 'retry' && /SHA-256/.test(e.error)));
});

test('handles missing Range support and failed mirrors', async t => {
  const f = await fixture(t, { '/offline': { status: 503 }, '/bad-range': { badRange: true }, '/whole': { noRanges: true } });
  const report = await downloadArtifact(f.artifact);
  assert.deepEqual(await readFile(f.artifact.path), f.data);
  assert.ok(report.events.some(e => e.source === 'whole' && e.rangeSupported === false));
  assert.ok(report.events.some(e => e.source === 'offline' && /503/.test(e.error)));
});

test('cancellation cleans partial files and preserves an existing model', async t => {
  const f = await fixture(t, { '/one': { delay: 3 }, '/two': { delay: 3 } }, 2 << 20);
  await writeFile(f.artifact.path, 'existing model');
  const controller = new AbortController();
  await assert.rejects(downloadArtifact(f.artifact, { signal: controller.signal, chunkBytes: 128 << 10, onEvent(e) { if (e.type === 'progress') controller.abort(); } }), /abort/i);
  assert.equal(await readFile(f.artifact.path, 'utf8'), 'existing model');
  assert.deepEqual(await readdir(f.work), ['test.onnx']);
});

test('all corrupt mirrors fail without publishing an artifact', async t => {
  const f = await fixture(t, { '/bad': { corrupt: true, noRanges: true } });
  await assert.rejects(downloadArtifact(f.artifact), /SHA-256/);
  assert.deepEqual(await readdir(f.work), []);
});

test('three/four source profiles include HF, HF mirror and independent ModelScope paths', () => {
  const artifact = { huggingFacePath: 'PP-OCRv4/test.onnx', modelScopePath: 'onnx/PP-OCRv4/test.onnx' };
  assert.deepEqual(modelSources(artifact, 3).map(s => s.name), ['modelscope', 'hf-mirror', 'huggingface']);
  assert.equal(modelSources(artifact, 4).length, 4);
  assert.throws(() => modelSources(artifact, 2));
});
