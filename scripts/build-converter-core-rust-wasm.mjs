import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const coreDir = path.join(rootDir, 'wasm', 'converter-core-rust');
const inputPath = path.join(coreDir, 'target', 'wasm32-wasip1', 'release', 'converter-core.wasm');
const productionDir = path.join(rootDir, 'wasm', 'converter-core', 'dist');
const outputPath = path.join(productionDir, 'converter-core.wasm');

await mkdir(productionDir, { recursive: true });
await run(process.platform === 'win32' ? 'cargo.exe' : 'cargo', ['build', '--locked', '--release', '--target', 'wasm32-wasip1'], coreDir);
await run(process.execPath, [
  path.join(rootDir, 'node_modules', 'binaryen', 'bin', 'wasm-opt'),
  inputPath,
  '-Oz',
  '--enable-bulk-memory',
  '--enable-nontrapping-float-to-int',
  '-o',
  outputPath
], rootDir);
console.log(`Built Rust production WASM -> ${path.relative(rootDir, outputPath)}`);

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code ?? 1}`)));
  });
}
