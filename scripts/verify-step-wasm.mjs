import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('packages/step/vendor/manifest.json', root), 'utf8'));
for (const [name, expected] of Object.entries(manifest.inputs)) {
  const bytes = await readFile(new URL(name, root));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, `STEP build input changed: ${name}; rebuild with npm run build:step:wasm`);
}
const bytes = await readFile(new URL('packages/step/vendor/filens-step.wasm', root));
assert.equal(bytes.length, manifest.wasm.raw);
assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.wasm.sha256);
console.log('Verified STEP WASM, promoted Rust sources, dependency lock and upstream patch.');
