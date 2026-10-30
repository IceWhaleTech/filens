import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = [
  ['converter-core', 'wasm/converter-core/dist/converter-core.wasm'],
  ['converter-image', 'wasm/converter-image/dist/converter-image.wasm'],
  ['filens-step (default Rust STEP)', 'packages/step/vendor/filens-step.wasm'],
  ['occt-import-js', 'packages/model3d/vendor/occt-import-js/occt-import-js.wasm'],
  ['occt-import-js upstream (reference)', 'node_modules/occt-import-js/dist/occt-import-js.wasm']
];
const rows = [];
for (const [name, relativePath] of artifacts) {
  const filePath = path.join(rootDir, relativePath);
  try {
    const bytes = await readFile(filePath);
    rows.push({
      artifact: name,
      raw: bytes.byteLength,
      gzip: gzipSync(bytes, { level: 9 }).byteLength,
      brotli: brotliCompressSync(bytes, {
        params: { [constants.BROTLI_PARAM_QUALITY]: 11 }
      }).byteLength
    });
  } catch {
    // The production artifact may not exist before its build command runs.
  }
}
console.table(rows);
if (rows.length === 0) process.exitCode = 1;
