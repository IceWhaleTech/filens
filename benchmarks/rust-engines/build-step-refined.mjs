// Build the experimental WASM from a clean, pinned truck checkout plus the
// reviewed patch. Keep Cargo's shared Git cache and the product runtime intact.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const adapterDir = process.argv.includes('--production') ? path.join(root, 'wasm/converter-step-rust/src') : path.join(here, 'src');
const adapterMain = process.argv.includes('--production') ? 'main.rs' : 'step.rs';
const lockFile = process.argv.includes('--production') ? path.join(root, 'wasm/converter-step-rust/Cargo.lock') : path.join(here, 'Cargo.refined.lock');
const outputName = process.argv.includes('--production') ? 'filens-step' : 'truck-refined';
const work = path.join(root, 'tmp/rust-engines');
const base = '78d699b0792b39e27c2bf073b682986701644e91';
const patchFile = path.join(root, 'docs/upstream/truck/0004-refine-trimmed-surfaces-and-poles.patch');
const sha256 = data => createHash('sha256').update(data).digest('hex');
const patchHash = sha256(await readFile(patchFile));
const source = path.join(work, `refined-truck-${patchHash.slice(0, 12)}`);
const upstream = path.join(work, 'upstream-truck');
const git = async (cwd, ...args) => (await exec('git', args, { cwd, maxBuffer: 8 << 20 })).stdout;
await mkdir(work, { recursive: true });
try { await access(path.join(upstream, '.git')); }
catch { await exec('git', ['clone', '--filter=blob:none', 'https://github.com/ricosjp/truck.git', upstream]); }
try { await git(upstream, 'cat-file', '-e', `${base}^{commit}`); }
catch { await git(upstream, 'fetch', '--depth=1', 'origin', base); }
try { await access(path.join(source, '.git')); }
catch {
  const staging = await mkdtemp(path.join(work, 'refined-checkout-'));
  try {
    await exec('git', ['clone', '--shared', '--quiet', '--no-checkout', upstream, staging]);
    // A shared clone does not inherit a partial clone's lazy-fetch metadata.
    await git(staging, 'remote', 'set-url', 'origin', 'https://github.com/ricosjp/truck.git');
    await git(staging, 'config', 'remote.origin.promisor', 'true');
    await git(staging, 'config', 'remote.origin.partialclonefilter', 'blob:none');
    await git(staging, 'checkout', '--quiet', '--detach', base);
    await git(staging, 'apply', '--index', patchFile);
    await writeFile(path.join(staging, '.git/filens-refined.json'), JSON.stringify({ base, patchHash, diffHash: sha256(await git(staging, 'diff', '--cached', '--binary')) }));
    await rename(staging, source);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
const state = JSON.parse(await readFile(path.join(source, '.git/filens-refined.json'), 'utf8'));
assert.equal((await git(source, 'rev-parse', 'HEAD')).trim(), base);
assert.equal(state.patchHash, patchHash);
assert.equal(sha256(await git(source, 'diff', '--cached', '--binary')), state.diffHash);
assert.equal((await git(source, 'diff', '--name-only')).trim(), '', 'Unexpected local truck edits');
assert.equal((await git(source, 'ls-files', '--others', '--exclude-standard')).trim(), '', 'Unexpected untracked truck files');
await git(source, 'diff', '--cached', '--check');

const manifestDir = path.join(work, 'refined-core');
await mkdir(manifestDir, { recursive: true });
const relative = path.relative(manifestDir, source).replaceAll('\\', '/');
const dependencies = ['stepio', 'meshalgo', 'assembly', 'topology', 'geometry'].map(name => {
  const features = name === 'stepio' ? ', default-features = false, features = ["in", "derive"]' : name === 'meshalgo' ? ', default-features = false, features = ["tessellation"]' : '';
  return `truck-${name} = { path = "${relative}/truck-${name}"${features} }`;
});
const tests = [['trimmed_surface_sampling', 'meshalgo'], ['degenerate_boundary_points', 'meshalgo'], ['import_sphere_hints', 'stepio']];
await writeFile(path.join(manifestDir, 'Cargo.toml'), `[package]
name = "filens-truck-refined"
version = "0.1.0"
edition = "2024"
[workspace]
[dependencies]
serde_json = "1.0"
${dependencies.join('\n')}
[[bin]]
name = "truck-refined"
path = "${path.relative(manifestDir, path.join(adapterDir, adapterMain)).replaceAll('\\', '/')}"
${tests.map(([name, crate]) => `[[test]]\nname = "${name}"\npath = "${relative}/truck-${crate}/tests/${name}.rs"`).join('\n')}
[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
panic = "abort"
strip = true
`);
await copyFile(lockFile, path.join(manifestDir, 'Cargo.lock'));
const env = { ...process.env, CARGO_TARGET_DIR: path.join(work, 'target'), CARGO_BUILD_JOBS: '3', CARGO_PROFILE_DEV_DEBUG: '0', CARGO_PROFILE_TEST_DEBUG: '0', CARGO_INCREMENTAL: '0' };
function run(program, args, overrides = {}, logFile) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd: root, env: { ...env, ...overrides }, stdio: logFile ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    let transcript = '';
    if (logFile) {
      child.stdout.on('data', data => { transcript += data; process.stdout.write(data); });
      child.stderr.on('data', data => { transcript += data; process.stderr.write(data); });
    }
    child.on('error', reject);
    child.on('close', async code => {
      try {
        if (logFile) await writeFile(logFile, transcript);
        code === 0 ? resolve() : reject(new Error(`${program} exited ${code}`));
      } catch (error) { reject(error); }
    });
  });
}
const manifest = path.join(manifestDir, 'Cargo.toml');
if (process.argv.includes('--test')) {
  await run('cargo', ['+1.93.0', 'test', '--locked', '--offline', '--manifest-path', manifest, ...tests.flatMap(([name]) => ['--test', name])], {}, path.join(work, 'refined-tests-after.log'));
}
await run('cargo', ['+1.93.0', 'build', '--locked', '--offline', '--release', '--manifest-path', manifest, '--target', 'wasm32-wasip1', '--bin', 'truck-refined'], {
  RUSTFLAGS: `--remap-path-prefix=${root}=/filens --remap-path-prefix=${process.env.HOME}/.cargo=/cargo --remap-path-prefix=${source}=/truck`,
});
await mkdir(path.join(work, 'wasm'), { recursive: true });
const raw = path.join(work, `wasm/${outputName}.unoptimized.wasm`);
await copyFile(path.join(work, 'target/wasm32-wasip1/release/truck-refined.wasm'), raw);
await run(process.execPath, [path.join(work, 'tools/node_modules/binaryen/bin/wasm-opt'), raw, '-Oz', '--strip-debug', '--strip-producers', '--enable-bulk-memory', '--enable-sign-ext', '--enable-nontrapping-float-to-int', '-o', path.join(work, `wasm/${outputName}.wasm`)]);
const adapterSha256 = Object.fromEntries(await Promise.all(['step.rs', 'step_prepare.rs', 'step_units.rs'].map(async file => [file, sha256(await readFile(path.join(adapterDir, file === 'step.rs' ? adapterMain : file)))])));
await writeFile(path.join(work, `wasm/${outputName}.build.json`), JSON.stringify({ base, patch: path.basename(patchFile), patchSha256: patchHash, sourceDiffSha256: state.diffHash, lockSha256: sha256(await readFile(lockFile)), adapterSha256, compiler: (await exec('rustc', ['+1.93.0', '--version'])).stdout.trim(), dependencyOverlay: null, target: 'wasm32-wasip1' }, null, 2) + '\n');
