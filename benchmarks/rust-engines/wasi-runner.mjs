import { WASI } from 'node:wasi';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [wasm, input, output, ...rest] = process.argv.slice(2);
const virtual = file => `/repo/${path.relative(root, path.resolve(file)).split(path.sep).join('/')}`;
const wasi = new WASI({
  version: 'preview1',
  args: [wasm, virtual(input), virtual(output), ...rest],
  env: {},
  preopens: { '/repo': root },
  returnOnExit: true,
});
const instance = await WebAssembly.instantiate(await WebAssembly.compile(await readFile(wasm)), wasi.getImportObject());
process.exitCode = wasi.start(instance);
