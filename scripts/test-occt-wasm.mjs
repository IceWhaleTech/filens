import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const importerDirectory = path.resolve(process.env.FILENS_OCCT_BUILD || path.join(root, 'packages/model3d/vendor/occt-import-js'));
const { default: createImporter } = await import(pathToFileURL(path.join(importerDirectory, 'occt-import-js.js')));
const require = createRequire(new URL('../packages/model3d/package.json', import.meta.url));
const createOriginal = require('occt-import-js');
const originalWasm = await readFile(require.resolve('occt-import-js/dist/occt-import-js.wasm'));
const optimizedWasm = await readFile(path.join(importerDirectory, 'occt-import-js.wasm'));
assert(WebAssembly.validate(optimizedWasm), 'Optimized WASM must validate');
assert(!optimizedWasm.includes(Buffer.from(root)), 'Published WASM must not contain the build machine path');
assert(optimizedWasm.length < originalWasm.length, 'Read-only WASM must be smaller than upstream');
assert(gzipSync(optimizedWasm, { level: 9 }).length < gzipSync(originalWasm, { level: 9 }).length, 'Read-only WASM must also reduce compressed transfer');

const quiet = { print() {}, printErr() {} };
const original = await createOriginal({ wasmBinary: originalWasm, ...quiet });
const optimized = await createImporter({ wasmBinary: optimizedWasm, ...quiet });
for (const method of ['ReadStepFile']) {
  assert.equal(typeof optimized[method], 'function', `Missing importer API ${method}`);
}
assert.equal(optimized.ReadIgesFile, undefined, 'Unused IGES bindings must not retain their parser');
assert.equal(optimized.ReadBrepFile, undefined, 'Unused BREP bindings must not retain their parser');
assert.equal(optimized.ReadFile, undefined, 'Generic file dispatch is not part of the preview API');

const fixtureRoot = process.env.FILENS_OCCT_FIXTURES || path.join(root, 'packages/model3d/test/fixtures/occt');
const fixtures = await listFixtures(fixtureRoot);
assert(fixtures.length >= 3, 'Basic STEP, curved surfaces, and assemblies are required');
let comparisons = 0;
for (const file of fixtures) {
  const source = await readFile(file);
  const method = 'ReadStepFile';
  const label = path.relative(fixtureRoot, file);
  for (const params of [{ linearUnit: 'millimeter' }, { linearUnit: 'inch' }]) {
    const expected = original[method](source, params);
    const actual = optimized[method](source, params);
    assert.equal(expected.success, true, `Upstream must read ${label}`);
    compareGeometry(actual, expected, `${label} (${params.linearUnit})`);
    comparisons++;
  }
  const actual = optimized.ReadStepFile(source, null);
  compareGeometry(actual, original.ReadStepFile(source, null), `${label} (defaults)`);
  comparisons++;
}

// A geometric model may also contain simulation, PMI, and motion records.
// Ignoring their parsers must not reject the file or lose the visible model.
const cube = await readFile(path.join(root, 'packages/model3d/test/fixtures/occt/cube.stp'), 'utf8');
const annotated = Buffer.from(cube.replace(/ENDSEC;\s*END-ISO-10303-21;\s*$/, `
#1000=DATUM('A','datum on the solid',#13,.T.,'A');
#1001=FEA_MASS_DENSITY('steel',7.85);
#1002=DIRECTION('',(0.,0.,1.));
#1003=ROTATION_ABOUT_DIRECTION('joint',#1002,0.5);
#1004=ELEMENT_DESCRIPTOR(.LINEAR.,'simulation element');
ENDSEC;
END-ISO-10303-21;
`));
const annotatedOriginal = original.ReadStepFile(annotated, { linearUnit: 'millimeter' });
assert.equal(annotatedOriginal.success, true, 'Upstream must read the annotated solid');
compare(annotatedOriginal, original.ReadStepFile(Buffer.from(cube), { linearUnit: 'millimeter' }), 'Metadata must not change the upstream mesh');
compareGeometry(optimized.ReadStepFile(annotated, { linearUnit: 'millimeter' }), annotatedOriginal, 'Solid with ignored simulation/PMI/motion records');

for (const importer of [original, optimized]) {
  assert.equal(importer.ReadStepFile(new Uint8Array(), null).success, false);
  assert.equal(importer.ReadStepFile(new TextEncoder().encode('invalid STEP data'), null).success, false);
  // Errors must not poison the reusable module.
  assert.equal(importer.ReadStepFile(Buffer.from(cube), null).success, true);
}

console.log(`CAD WASM: ${fixtures.length} real fixtures, ${comparisons} matching world-space triangle/normal sets; mixed metadata preserved geometry; invalid inputs rejected.`);
console.log(`WASM size: ${originalWasm.length} -> ${optimizedWasm.length} bytes.`);

async function listFixtures(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFixtures(file));
    else if (/\.(?:step|stp)$/i.test(entry.name)) files.push(file);
  }
  return files.sort();
}

// Flattening changes mesh grouping and vertex offsets, so compare oriented
// triangles in world coordinates. This also checks every assembly instance and
// its normals; bounds alone would miss duplicated, absent, or misplaced parts.
function compareGeometry(actual, expected, at) {
  if (!expected.meshes?.some(mesh => mesh.index.array.length)) {
    assert.equal(actual.success, false, `${at}: external-reference-only document has no embedded triangles`);
    return;
  }
  assert.equal(actual.success, true, at);
  assert(actual.meshes?.length > 0, `${at}: no visible geometry`);
  assert.deepEqual(actual.root, { meshes: actual.meshes.map((_, i) => i) }, `${at}: flat preview root`);
  for (const mesh of actual.meshes) {
    assert.deepEqual(Object.keys(mesh).sort(), ['attributes', 'index'], `${at}: geometry-only mesh`);
  }
  const scale = Math.max(1, ...expected.meshes.map(mesh =>
    mesh.attributes.position.array.reduce((max, value) => Math.max(max, Math.abs(value)), 0)));
  const expectedTriangles = triangles(expected, scale, at);
  const actualTriangles = triangles(actual, scale, at);
  compare(actualTriangles, expectedTriangles, `${at}.triangles`);
}

function triangles(result, scale, at) {
  const output = [];
  for (const mesh of result.meshes) {
    const positions = mesh.attributes.position.array;
    const normals = mesh.attributes.normal?.array;
    assert.equal(positions.length % 3, 0, at);
    assert.equal(normals?.length, positions.length, `${at}: complete lighting normals`);
    const indices = mesh.index.array;
    assert.equal(indices.length % 3, 0, at);
    for (let i = 0; i < indices.length; i += 3) {
      const vertices = indices.slice(i, i + 3).map(index => {
        assert(Number.isInteger(index) && index >= 0 && index * 3 < positions.length, `${at}: valid vertex index`);
        return [...positions.slice(index * 3, index * 3 + 3), ...normals.slice(index * 3, index * 3 + 3)];
      });
      const keys = vertices.map(vertex => vertex.map((value, axis) => {
        assert(Number.isFinite(value), `${at}: finite vertex/normal`);
        return Math.round(value / (axis < 3 ? scale : 1) * 1e6);
      }));
      const order = [0, 1, 2].sort((a, b) => lexicographic(keys[a], keys[b]));
      const start = order[0];
      const key = [0, 1, 2].flatMap(offset => keys[(start + offset) % 3]);
      const value = [0, 1, 2].flatMap(offset => vertices[(start + offset) % 3]);
      output.push({ key, value });
    }
  }
  return output.sort((a, b) => lexicographic(a.key, b.key)).map(triangle => triangle.value);
}

function lexicographic(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

function compare(actual, expected, at) {
  if (typeof expected === 'number') {
    // Compiler/LTO changes may round the last bits of geometric calculations.
    assert.equal(typeof actual, 'number', at);
    assert(Number.isFinite(actual), `${at}: nonfinite coordinate`);
    assert(Math.abs(actual - expected) <= 1e-7 * Math.max(1, Math.abs(expected)), `${at}: ${actual} differs from ${expected}`);
  } else if (expected !== null && typeof expected === 'object') {
    assert(actual !== null && typeof actual === 'object', at);
    assert.equal(Array.isArray(actual), Array.isArray(expected), at);
    if (Array.isArray(expected)) {
      assert.equal(actual.length, expected.length, `${at}.length`);
      for (let index = 0; index < expected.length; index++) compare(actual[index], expected[index], `${at}[${index}]`);
    } else {
      assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), at);
      for (const key of Object.keys(expected)) {
        // Connectivity and face ranges are integers and must match exactly.
        const exact = ['index', 'first', 'last'].includes(key)
          || (key === 'meshes' && expected[key].every(item => typeof item === 'number'));
        if (exact) assert.deepEqual(actual[key], expected[key], `${at}.${key}`);
        else compare(actual[key], expected[key], `${at}.${key}`);
      }
    }
  } else assert.equal(actual, expected, at);
}
