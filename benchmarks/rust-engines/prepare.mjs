import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const work = path.join(root, 'tmp/rust-engines');
await mkdir(path.join(work, 'fixtures/pdf'), { recursive: true });
await mkdir(path.join(work, 'source'), { recursive: true });
await mkdir(path.join(work, 'wasm'), { recursive: true });
async function download(url, destination, sha256) {
  let bytes;
  try { bytes = await readFile(destination); } catch {}
  const digest = b => createHash('sha256').update(b).digest('hex');
  if (!bytes || digest(bytes) !== sha256) {
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (digest(bytes) !== sha256) throw new Error(`SHA-256 mismatch: ${url}`);
    await writeFile(destination, bytes);
  }
}
await download('https://raw.githubusercontent.com/klippa-app/go-pdfium/v1.17.3/webassembly/pdfium.wasm', path.join(work, 'pdfium.wasm'), '73417fa7cdcb34fba2a23aa1f7a480cc873a7301c8d74f08a1dea800f782a454');
await download('https://codeload.github.com/kovacsv/occt-import-js/tar.gz/refs/tags/0.0.23', path.join(work, 'source/occt.tar.gz'), '89d1b75def80be77cec271da46cefced9614add5448d3408c705f2f440083dde');
try { await access(path.join(work, 'source/occt-import-js-0.0.23')); }
catch { execFileSync('tar', ['-xzf', path.join(work, 'source/occt.tar.gz'), '-C', path.join(work, 'source')]); }
const corpus = JSON.parse(await readFile(path.join(root, 'docs/pdf-unicode-corpus.json'), 'utf8'));
for (const sample of corpus.samples) await download(sample.url, path.join(work, 'fixtures/pdf', sample.file), sample.sha256);
execFileSync('npm', ['install', '--prefix', path.join(work, 'tools'), '--save-exact', '--no-audit', '--no-fund', 'binaryen@131.0.0', 'three@0.180.0', 'three-mesh-bvh@0.9.1', 'pngjs@7.0.0', 'playwright@1.56.1'], { stdio: 'inherit' });
console.log('Prepared public inputs and benchmark tools in tmp/rust-engines.');
