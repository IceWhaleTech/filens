// Maintainer-only compilation. Private sources remain in the external checkout.
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './agent-rust-build.mjs';
import { privacyIssues } from './agent-release-privacy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(process.env.FILENS_HDRW_SOURCE || path.join(root, '../hdrw'));
const directory = path.join(root, 'dist/hdrw-build');
const assets = path.join(root, 'cli/assets');
await mkdir(directory, { recursive: true });
await mkdir(assets, { recursive: true });
await copyFile(path.join(root, 'packaging/hdrw-wasi/main.go.tmpl'), path.join(directory, 'main.go'));
await copyFile(path.join(root, 'packaging/hdrw-wasi/compat_wasip1.go.tmpl'), path.join(directory, 'compat_wasip1.go'));
// Go's overlay adds the compatibility file without modifying the private tree.
await writeFile(path.join(directory, 'overlay.json'), JSON.stringify({ Replace: {
  [path.join(source, 'filens_wasip1.go')]: path.join(directory, 'compat_wasip1.go'),
} }));
await writeFile(path.join(directory, 'go.mod'), `module filens-hdrw-build\n\ngo 1.24.0\n\nrequire github.com/IceWhaleTech/hdrw v0.0.0\nreplace github.com/IceWhaleTech/hdrw => ${JSON.stringify(path.relative(directory, source).replaceAll('\\', '/'))}\n`);
const env = { ...process.env, GOOS: 'wasip1', GOARCH: 'wasm', CGO_ENABLED: '0', GOWORK: 'off' };
await run('go', ['build', '-mod=mod', '-overlay', path.join(directory, 'overlay.json'), '-trimpath', '-ldflags=-s -w -buildid=', '-o', path.join(directory, 'hdrw.wasm'), 'main.go'], { cwd: directory, env });
await run(process.execPath, [path.join(root, 'node_modules/binaryen/bin/wasm-opt'), path.join(directory, 'hdrw.wasm'), '-Oz', '--strip-debug', '--strip-producers', '--enable-bulk-memory', '-o', path.join(directory, 'hdrw-stripped.wasm')]);
const bytes = await readFile(path.join(directory, 'hdrw-stripped.wasm'));
if (privacyIssues(bytes).length) throw new Error('Private WASM contains a build path or credential');
const compressed = gzipSync(bytes, { level: 9, mtime: 0 });
await writeFile(path.join(assets, 'hdrw.wasm.gz'), compressed);
const commit = (await run('git', ['rev-parse', 'HEAD'], { cwd: source, capture: true })).trim();
const trackedChanges = (await run('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: source, capture: true })).trim().length > 0;
await writeFile(path.join(assets, 'hdrw.json'), JSON.stringify({
  name: 'hdrw', license: 'proprietary', sourceCommit: commit, sourceHasChanges: trackedChanges,
  abi: 'wasi-preview1', adapter: 'filens-directory-v1', bytes: bytes.length, gzipBytes: compressed.length,
  sha256: createHash('sha256').update(bytes).digest('hex'), gzipSHA256: createHash('sha256').update(compressed).digest('hex'),
  mode: 'OS-backed read-only directory enumeration; no raw devices or filesystem drivers exposed',
}, null, 2) + '\n');
console.log(`Compiled private hdrw WASI: ${(compressed.length / 1048576).toFixed(2)} MiB compressed; no private source copied into FiLens.`);
