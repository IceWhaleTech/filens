import { spawn } from 'node:child_process';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const work = path.join(root, 'tmp/rust-engines');
const target = path.join(work, 'target');
await mkdir(path.join(work, 'wasm'), { recursive: true });
const env = { ...process.env, CARGO_TARGET_DIR: target, CARGO_BUILD_JOBS: '3', RUSTFLAGS: `--remap-path-prefix=${root}=/filens --remap-path-prefix=${process.env.HOME}/.cargo=/cargo` };
function run(program, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd: root, env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${program} exited ${code}`)));
  });
}
const builds = process.argv.includes('--step-reviewed')
  ? [['truck-reviewed', 'step', 'truck-eval']]
  : process.argv.includes('--truck-fixed')
  ? [['truck-fixed', 'step', 'truck-eval']]
  : [['hayro-fonts', 'pdf-fonts', 'hayro-eval'], ['hayro-no-fonts', 'pdf', 'hayro-eval'], ['truck', 'step', 'truck-baseline']];
for (const [name, features, binary] of builds) {
  await run('cargo', ['+1.93.0', 'build', '--locked', '--release', '--manifest-path', path.join(here, 'Cargo.toml'), '--target', 'wasm32-wasip1', '--features', features, '--bin', binary]);
  const raw = path.join(work, `wasm/${name}.unoptimized.wasm`);
  await copyFile(path.join(target, `wasm32-wasip1/release/${binary}.wasm`), raw);
  await run(process.execPath, [path.join(work, 'tools/node_modules/binaryen/bin/wasm-opt'), raw, '-Oz', '--strip-debug', '--strip-producers', '--enable-bulk-memory', '--enable-sign-ext', '--enable-nontrapping-float-to-int', '-o', path.join(work, `wasm/${name}.wasm`)]);
}
