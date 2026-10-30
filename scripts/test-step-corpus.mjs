// Full adapter integration check against the previously measured public corpus.
// Runs the browser WASI host on Node; does not repeat the OCCT distance screen.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStepReader } from '../packages/step/dist/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const corpus = process.argv[2] ?? path.join(root, 'tmp/rust-engines/source/occt-import-js-0.0.23/test/testfiles');
const baseline = JSON.parse(await readFile(path.join(root, 'docs/assets/rust-engines/results-step-refined.json'), 'utf8'));
const wasm = new Uint8Array(await readFile(path.join(root, 'packages/step/dist/filens-step.wasm')));
const reader = createStepReader({ wasm }), results = [];
for (const fixture of baseline.step) {
  const source = await readFile(path.join(corpus, fixture.id));
  assert.equal(createHash('sha256').update(source).digest('hex'), fixture.sha256);
  const previous = fixture.engines.truck;
  if (!previous.success) {
    await assert.rejects(reader.read(source), error => {
      results.push({ id: fixture.id, displayable: false, rejected: true, error: error.code ?? error.name }); return true;
    });
    continue;
  }
  let mesh;
  try { mesh = await reader.read(source); }
  catch (error) { console.error(`STEP integration failed: ${fixture.id}: ${error.message}`); throw error; }
  assert.equal(mesh.triangleCount, previous.triangles, fixture.id);
  assert.equal(mesh.metadata.faces, previous.faces, fixture.id);
  assert.equal(mesh.metadata.instances, previous.instances, fixture.id);
  assert.equal(mesh.metadata.missingFaces, 0, fixture.id);
  assert.equal(mesh.positions.every(Number.isFinite), true, fixture.id);
  assert.equal(mesh.normals.every(Number.isFinite), true, fixture.id);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i++) { min[i % 3] = Math.min(min[i % 3], mesh.positions[i]); max[i % 3] = Math.max(max[i % 3], mesh.positions[i]); }
  for (const [actual, expected] of [[min, previous.geometry.min], [max, previous.geometry.max]]) {
    for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(actual[axis] - expected[axis]) <= Math.max(1e-5, Math.abs(expected[axis]) * 5e-7), fixture.id);
  }
  results.push({ id: fixture.id, displayable: true, triangles: mesh.triangleCount, faces: mesh.metadata.faces, instances: mesh.metadata.instances, missingFaces: 0, finite: true, boundsMatchWithinFloat32: true });
}
const report = {
  date: new Date().toISOString(), host: 'Node running the shared browser WASI host; not a full browser geometry-quality screen',
  wasmSha256: createHash('sha256').update(wasm).digest('hex'),
  fixtureCount: results.length, displayable: results.filter(row => row.displayable).length,
  rejectedExternalOnly: results.filter(row => !row.displayable).length,
  comparison: 'Same triangle/face/instance counts, finite coordinates and normals, Float32 bounds versus results-step-refined.json. The prior independent geometry screen remains 43/44.', results
};
await writeFile(path.join(root, 'docs/assets/rust-engines/browser-integration.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`STEP browser-host corpus: ${report.displayable}/44 meshes, ${report.rejectedExternalOnly}/11 external-only inputs rejected; counts and Float32 bounds match.`);
