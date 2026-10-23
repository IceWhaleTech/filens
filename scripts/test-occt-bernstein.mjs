import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.resolve(root, process.env.FILENS_OCCT_WORKDIR || 'tmp/occt-wasm');
const emcmake = process.env.EMCMAKE || 'emcmake';
const emcc = path.join(path.dirname(emcmake), process.platform === 'win32' ? 'emcc.bat' : 'emcc');
const directory = path.join(work, 'bernstein-check');
await mkdir(directory, { recursive: true });
const input = path.join(directory, 'check.cpp'), output = path.join(directory, 'check.wasm');
await writeFile(input, `#include ${JSON.stringify(path.join(root, 'scripts/occt-bernstein.hpp'))}
static double values[26];
extern "C" double* EvaluateBernstein(int degree, double parameter) {
  FilensBernsteinValues(degree, parameter, values);
  return values;
}
`);
await new Promise((resolve, reject) => {
  const child = spawn(emcc, [input, '-Oz', '--no-entry', '-sSTANDALONE_WASM=1', '-sFILESYSTEM=0',
    '-Wl,--export=EvaluateBernstein', '-o', output], { stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Bernstein check compiler exited with ${code}`)));
});
const { instance } = await WebAssembly.instantiate(await readFile(output), {
  wasi_snapshot_preview1: { proc_exit(code) { throw new Error(`Numeric check WASM exited with ${code}`); } }
});
instance.exports._initialize?.();
const expected = array(await readFile(path.join(work, 'bernstein-original.cxx'), 'utf8'), 'VBMatrix');
const points = array(await readFile(path.join(work, 'source/occt/src/math/math.cxx'), 'utf8'), 'Point');
assert.equal(expected.length, 105000, 'Pinned table must cover all 25 degrees and 24 Gauss rules');
const gaussRules = [];
let gaussOffset = 0;
for (let count = 1; count <= 24; count++) {
  const half = Math.ceil(count / 2);
  const rule = points.slice(gaussOffset + 1, gaussOffset + half + 1);
  for (let i = 0; i + half < count; i++) rule.push(-rule[i]);
  gaussRules.push(rule.sort((a, b) => a - b));
  gaussOffset += half;
}
let compared = 0, maximumAbsoluteError = 0, maximumRelativeError = 0;
for (let size = 2; size <= 26; size++) {
  for (const rule of gaussRules) {
    const columns = rule.map(point => {
      const address = instance.exports.EvaluateBernstein(size - 1, (point + 1) * 0.5);
      return [...new Float64Array(instance.exports.memory.buffer, address, size)];
    });
    for (let i = 0; i < size; i++) for (let j = 0; j < rule.length; j++) {
      const actual = columns[j][i], reference = expected[compared++];
      const absolute = Math.abs(actual - reference), relative = absolute / Math.max(1e-300, Math.abs(reference));
      assert(Number.isFinite(actual) && actual >= 0, 'Finite, nonnegative Bernstein coefficients');
      assert(absolute <= 2e-13 && relative <= 2e-11,
        `Degree ${size - 1}, rule ${rule.length}, coefficient ${i}/${j}: ${actual} != ${reference}`);
      maximumAbsoluteError = Math.max(maximumAbsoluteError, absolute);
      maximumRelativeError = Math.max(maximumRelativeError, relative);
    }
    for (const column of columns) assert(Math.abs(column.reduce((sum, value) => sum + value, 0) - 1) < 2e-14, 'Partition of unity');
  }
}
// Exercise endpoint behavior independently of the interior Gauss samples.
for (const point of [0, 1]) {
  const address = instance.exports.EvaluateBernstein(25, point);
  assert.deepEqual([...new Float64Array(instance.exports.memory.buffer, address, 26)],
    Array.from({ length: 26 }, (_, i) => i === point * 25 ? 1 : 0));
}
const result = { compared, maximumAbsoluteError, maximumRelativeError };
await writeFile(path.join(directory, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(`Bernstein numeric check: ${JSON.stringify(result)}; degree 25 endpoints and partition of unity passed.`);

function array(source, name) {
  const match = new RegExp(`static\\s+const\\s+Standard_Real\\s+${name}\\[\\s*\\]\\s*=\\s*\\{([\\s\\S]*?)\\};`).exec(source);
  assert(match, `Missing pinned numeric array ${name}`);
  const values = match[1].replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').split(',').map(value => value.trim()).filter(Boolean).map(Number);
  assert(values.every(Number.isFinite), `Unexpected numeric literals in ${name}`);
  return values;
}
