// Supporting Node/V8 check of the same production frontend WASM core.
// Keep these engineering timings separate from browser preview comparisons.
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import { createWasmCoreRunner } from '../packages/converter-client/dist/index.js';

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const output = option('--output', 'tmp/performance-sota/sensor.json');
const core = fs.readFileSync(option('--wasm', 'wasm/converter-image/dist/converter-image.wasm'));
const file = 'apps/demo/public/samples/raw/pentax-k-r.dng';
const input = new Uint8Array(fs.readFileSync(file));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const wasm = await WebAssembly.compile(core);
const run = createWasmCoreRunner({ wasm });
const results = [];
for (let iteration = 0; iteration < Number(option('--iterations', '4')); iteration++) {
  const start = performance.now();
  const result = await run({
    args: ['converter-image', '--input', '/work/in.dng', '--output', '/work/out.jpg', '--source', 'dng', '--target', 'jpg', '--options', '/work/options.json', '--result', '/work/result.json'],
    files: { '/work/in.dng': input, '/work/options.json': new TextEncoder().encode('{"preserveSensorGeometry":true}') },
    readFiles: ['/work/out.jpg', '/work/result.json']
  });
  const ms = performance.now() - start;
  const bytes = result.files['/work/out.jpg'];
  if (result.exitCode || !bytes?.length) throw new Error(new TextDecoder().decode(result.files['/work/result.json']));
  const record = { iteration, ms, sha256: sha256(bytes), bytes: bytes.length };
  results.push(record); console.log(JSON.stringify(record));
}
fs.writeFileSync(output, JSON.stringify({ date: new Date().toISOString(), node: process.version, v8: process.versions.v8, cpu: os.cpus()[0].model,
  method: 'Node/V8 production frontend WASM; preserveSensorGeometry=true; fresh WASI instance per invocation, shared compiled module. First invocation has cold code; subsequent invocations have warm module code. Compare JPEG bytes, not browser preview times.',
  coreSha256: sha256(core), input: { path: file, sha256: sha256(input) }, results }, null, 2) + '\n');
