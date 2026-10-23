import { spawn, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cargoHome = process.env.CARGO_HOME || path.join(homedir(), '.cargo');
const env = {
  ...process.env,
  PATH: `${path.join(cargoHome, 'bin')}${path.delimiter}${process.env.PATH || ''}`,
  VITE_BASE_PATH: '/'
};

// Vercel's Node build image may not include Rust. Each converter's
// rust-toolchain.toml pins the compiler and WASI target used by Cargo.
if (spawnSync('rustup', ['--version'], { env, stdio: 'ignore' }).status !== 0) {
  if (process.platform === 'win32') {
    throw new Error('Install Rust with rustup before running build:vercel on Windows.');
  }
  const response = await fetch('https://sh.rustup.rs');
  if (!response.ok) throw new Error(`Failed to download rustup: HTTP ${response.status}`);
  await run('sh', ['-s', '--', '-y', '--profile', 'minimal', '--default-toolchain', 'none', '--no-modify-path'], await response.text());
}

// Build from source: generated dist/ artifacts are absent on a clean checkout.
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
await run(npm, ['run', 'build:wasm']);
await run(npm, ['run', 'build:demo']);

function run(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env,
      stdio: [input === undefined ? 'inherit' : 'pipe', 'inherit', 'inherit']
    });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code ?? 1}`)));
    if (input !== undefined) child.stdin.end(input);
  });
}
