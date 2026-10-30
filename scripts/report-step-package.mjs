import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = async file => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const release = await json('dist/step-npm/release.json');
const install = await json('dist/step-npm/install-check.json');
const corpus = await json('docs/assets/rust-engines/browser-integration.json');
const manifest = await json('packages/step/vendor/manifest.json');
const normalRegression = await json('docs/assets/rust-engines/browser-normal-regression.json');
assert.equal(install.tarballSha256, release.sha256);
assert.equal(install.wasmSha256, manifest.wasm.sha256);
assert.equal(corpus.wasmSha256, manifest.wasm.sha256);
assert.equal(normalRegression.after.wasmSha256, manifest.wasm.sha256);
const loaderBytes = await readFile(path.join(root, 'packages/step/dist/index.js'));
const loader = { raw: loaderBytes.length, gzip: gzipSync(loaderBytes, { level: 9 }).length,
  brotli: brotliCompressSync(loaderBytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length };
const inputs = {};
for (const file of ['packages/step/package.json', 'packages/step/README.md', 'packages/step/src/index.ts',
  'packages/step/src/assets.d.ts', 'packages/step/vite.config.ts',
  'packages/converter-client/src/wasi-runner.ts', 'packages/converter-client/src/source.ts',
  'scripts/step-wasm-plugin.ts', 'scripts/verify-step-wasm.mjs', 'scripts/package-step-npm.mjs',
  'scripts/agent-rust-licenses.mjs', 'packages/step/vendor/THIRD-PARTY-NOTICES.txt', 'packages/step/vendor/manifest.json']) {
  inputs[file] = createHash('sha256').update(await readFile(path.join(root, file))).digest('hex');
}
const report = { date: new Date().toISOString(), ...release, wasm: manifest.wasm, loader,
  measurement: 'WASM/loader raw and gzip9/Brotli11 bytes measured separately. npm tarball/unpacked totals include all shipped files and notices; exclude npm caches and filesystem allocation.',
  sourceInputs: inputs, install, corpus: { file: 'assets/rust-engines/browser-integration.json', fixtureCount: corpus.fixtureCount, displayable: corpus.displayable, rejectedExternalOnly: corpus.rejectedExternalOnly },
  normalRegression: 'assets/rust-engines/browser-normal-regression.json',
  priorGeometryScreen: { passed: 43, total: 44, unresolved: 'cax-if/s1-c5-214/HEAD_BACK.stp', report: 'assets/rust-engines/results-step-refined.json' },
  upstreamPullRequest: manifest.upstreamPullRequest };
await writeFile(path.join(root, 'docs/rust-step-browser-release.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`Recorded ${release.name}@${release.version}: ${(release.bytes / 1024).toFixed(2)} KiB npm tarball; ${(manifest.wasm.brotli / 1024).toFixed(2)} KiB Brotli WASM. Publication deferred.`);
