import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { writeRustLicenses } from './agent-rust-licenses.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.join(root, 'tmp/rust-engines');
const vendor = path.join(root, 'packages/step/vendor');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const outputName = process.argv.includes('--from-validated') ? 'truck-refined' : 'filens-step';
if (!process.argv.includes('--from-validated')) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['benchmarks/rust-engines/build-step-refined.mjs', '--production'], { cwd: root, stdio: 'inherit' });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`STEP build exited ${code}`)));
  });
}
// Promotion can reuse the already tested artifact only when every parser,
// preparation, unit, dependency-lock and upstream-patch hash still matches.
const build = JSON.parse(await readFile(path.join(work, `wasm/${outputName}.build.json`), 'utf8'));
const inputs = {};
for (const [file, expected] of Object.entries(build.adapterSha256)) {
  const source = `wasm/converter-step-rust/src/${file === 'step.rs' ? 'main.rs' : file}`;
  inputs[source] = sha(await readFile(path.join(root, source)));
  assert.equal(inputs[source], expected, `Validated STEP adapter differs: ${source}`);
}
for (const [file, expected] of [[`docs/upstream/truck/${build.patch}`, build.patchSha256], ['wasm/converter-step-rust/Cargo.lock', build.lockSha256]]) {
  inputs[file] = sha(await readFile(path.join(root, file)));
  assert.equal(inputs[file], expected, `Validated STEP build differs: ${file}`);
}
for (const file of ['scripts/build-step-wasm.mjs', 'benchmarks/rust-engines/build-step-refined.mjs']) inputs[file] = sha(await readFile(path.join(root, file)));
const bytes = await readFile(path.join(work, `wasm/${outputName}.wasm`));
await mkdir(vendor, { recursive: true });
await copyFile(path.join(work, `wasm/${outputName}.wasm`), path.join(vendor, 'filens-step.wasm'));
await writeRustLicenses(vendor, {
  graphs: [{ manifest: 'tmp/rust-engines/refined-core/Cargo.toml', target: 'wasm32-wasip1' }],
  heading: 'filens-step locked Rust WASM dependency notices\n', filename: 'THIRD-PARTY-NOTICES.txt'
});
const notices = path.join(vendor, 'THIRD-PARTY-NOTICES.txt');
const license = await readFile(path.join(work, `refined-truck-${build.patchSha256.slice(0, 12)}/LICENSE`), 'utf8');
await writeFile(notices, `${await readFile(notices, 'utf8')}\ntruck crates: https://github.com/ricosjp/truck/tree/${build.base}\nModified with ${build.patch}; upstream PR https://github.com/ricosjp/truck/pull/141\n\n${license}\n`);
await writeFile(path.join(vendor, 'manifest.json'), JSON.stringify({
  engine: 'truck', target: build.target, compiler: build.compiler, upstreamCommit: build.base,
  upstreamPullRequest: 'https://github.com/ricosjp/truck/pull/141', inputs,
  wasm: { sha256: sha(bytes), raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length,
    brotli: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length },
  limitations: ['Approximate preview; unresolved trimmed sphere region/orientation difference on HEAD_BACK.stp.',
    'External assembly references require their part files; multi-file assembly loading is not implemented.',
    'Source colors, names and the assembly tree are omitted.']
}, null, 2) + '\n');
console.log(`Prepared production Rust STEP WASM: ${bytes.length} bytes (${sha(bytes)}).`);
