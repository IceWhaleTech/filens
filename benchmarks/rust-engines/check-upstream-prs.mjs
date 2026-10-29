import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const work = path.join(root, 'tmp/rust-engines');
const source = path.join(work, 'upstream-truck');
const base = '1ca3214e537004d466addbd85d6375807147a426';
const out = path.join(root, 'docs/upstream/truck');
const patches = ['0001-normalize-step-placement-directions.patch', '0002-honor-optional-assembly-descriptions.patch', '0003-stop-nonfinite-curve-subdivision.patch'];
await mkdir(work, { recursive: true });
try { await access(path.join(source, '.git')); }
catch { await exec('git', ['clone', '--filter=blob:none', 'https://github.com/ricosjp/truck.git', source]); }
const scratch = await mkdtemp(path.join(work, 'upstream-pr-check-'));
async function checkout(name) {
  const dir = path.join(scratch, name);
  await exec('git', ['clone', '--shared', '--quiet', source, dir]);
  await exec('git', ['-C', dir, 'checkout', '--quiet', '--detach', base]);
  return dir;
}
const result = { date: '2026-10-30', upstream: 'https://github.com/ricosjp/truck', base, compiler: (await exec('rustc', ['+1.93.0', '--version'])).stdout.trim(), dependencyOverlay: { file: 'truck-topology/Cargo.toml', parking_lot: '0.12.5 (upstream HEAD requires 0.13.0 / Rust 1.95)', rclite: '0.4.1 (upstream HEAD: 0.4.2)' }, fullHeadDependencyGraphTested: false, fullUpstreamSuiteTested: false, patches: [], before: {}, after: {} };
for (const file of patches) {
  const clean = await checkout(path.basename(file, '.patch'));
  await exec('git', ['-C', clean, 'apply', '--check', path.join(out, file)]);
  const bytes = await readFile(path.join(out, file));
  result.patches.push({ file, sha256: createHash('sha256').update(bytes).digest('hex'), independentApplyCheck: true });
}
const applied = await checkout('combined');
for (const file of patches) await exec('git', ['-C', applied, 'apply', path.join(out, file)]);
await exec('git', ['-C', applied, 'diff', '--check']);
const compat = path.join(work, 'truck-pr-verify');
await cp(applied, compat, { recursive: true, filter: p => !p.split(path.sep).includes('.git') });
const topologyManifest = path.join(compat, 'truck-topology/Cargo.toml');
await writeFile(topologyManifest, (await readFile(topologyManifest, 'utf8')).replace('parking_lot = "0.13.0"', 'parking_lot = "0.12.5"').replace('version = "0.4.2"', 'version = "0.4.1"'));
const harness = path.join(work, 'pr-tests');
await mkdir(harness, { recursive: true });
await writeFile(path.join(harness, 'Cargo.toml'), `[package]
name = "filens-truck-pr-regressions"
version = "0.1.0"
edition = "2021"
[workspace]
[dependencies]
truck-stepio = { path = "../truck-pr-verify/truck-stepio" }
truck-base = { path = "../truck-pr-verify/truck-base" }
truck-geotrait = { path = "../truck-pr-verify/truck-geotrait" }
serde_json = "1.0"
[profile.dev]
debug = 0
incremental = false
[[test]]
name = "direction_ratios"
path = "../truck-pr-verify/truck-stepio/tests/import_direction_ratios.rs"
[[test]]
name = "optional_descriptions"
path = "../truck-pr-verify/truck-stepio/tests/import_optional_descriptions.rs"
[[test]]
name = "curve_nonfinite"
path = "../truck-pr-verify/truck-geotrait/tests/curve_division_nonfinite.rs"
[[test]]
name = "core_preparation"
path = "core-preparation.rs"
`);
await writeFile(path.join(harness, 'core-preparation.rs'), `#[path="../../../benchmarks/rust-engines/src/step_units.rs"] mod step_units;
#[path="../../../benchmarks/rust-engines/src/step_prepare.rs"] mod step_prepare;
`);
const env = { ...process.env, CARGO_TARGET_DIR: path.join(work, 'pr-test-target'), CARGO_BUILD_JOBS: '3' };
const changedSources = ['truck-stepio/src/in/mod.rs', 'truck-stepio/src/in/convert.rs', 'truck-geotrait/src/algo/curve.rs'];
for (const file of changedSources) {
  const bytes = (await exec('git', ['-C', applied, 'show', `${base}:${file}`], { maxBuffer: 16 << 20 })).stdout;
  await writeFile(path.join(compat, file), bytes);
}
function testResults(log) {
  const map = {};
  for (const line of log.split('\n')) {
    const stats = line.match(/test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed/);
    if (stats) {
      const passed = Number(stats[1]), failed = Number(stats[2]);
      const name = { 9: 'direction_ratios', 5: 'optional_descriptions', 6: 'curve_nonfinite', 10: 'core_preparation' }[passed + failed];
      assert(name, `Unexpected test count: ${line}`);
      map[name] = { passed, failed };
    }
  }
  return map;
}
async function runTests(label, args, expectedCode) {
  let log = '', code = 0;
  try {
    const output = await exec('cargo', ['+1.93.0', 'test', '--offline', '--manifest-path', path.join(harness, 'Cargo.toml'), ...args], { cwd: root, env, maxBuffer: 32 << 20 });
    log = output.stdout + '\n' + output.stderr;
  } catch (error) { code = error.code; log = (error.stdout ?? '') + '\n' + (error.stderr ?? ''); }
  await writeFile(path.join(harness, `${label}.log`), log);
  assert.equal(code, expectedCode, log.slice(-8000));
  return testResults(log);
}
console.log('Patches apply independently and together. Running bounded regressions on the original code…');
result.before = await runTests('before-final', ['--no-fail-fast', '--test', 'direction_ratios', '--test', 'optional_descriptions', '--test', 'curve_nonfinite'], 101);
for (const file of changedSources) await cp(path.join(applied, file), path.join(compat, file));
console.log('Running patched source regressions and conversion-core checks…');
result.after = await runTests('after-final', [], 0);
assert.deepEqual(Object.keys(result.before).sort(), ['curve_nonfinite', 'direction_ratios', 'optional_descriptions']);
assert.equal(Object.keys(result.after).length, 4);
assert(Object.values(result.before).every(x => x.failed > 0));
assert(Object.values(result.after).every(x => x.failed === 0));
result.patchedRegressionTests = Object.values(result.after).reduce((n,x) => n+x.passed,0);
assert.equal(result.patchedRegressionTests, 30);
await writeFile(path.join(out, 'validation.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
