import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { numericArray } from './compact-occt-tables.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.resolve(root, process.env.FILENS_OCCT_WORKDIR || 'tmp/occt-wasm');
const source = path.join(work, 'source/occt/src');
const emcmake = process.env.EMCMAKE || 'emcmake';
const emcc = path.join(path.dirname(emcmake), process.platform === 'win32' ? 'emcc.bat' : 'emcc');
const directory = path.join(work, 'numeric-check');
await mkdir(directory, { recursive: true });
const names = ['BBMatrix', 'IMatrix', 'IBT'];
const refs = [];
for (const [i, file] of ['AppCont_ContMatrices_2.cxx', 'AppCont_ContMatrices.cxx', 'AppCont_ContMatrices_3.cxx'].entries()) {
  const original = await readFile(path.join(work, 'numeric-original', file), 'utf8');
  refs.push(numericArray(original, names[i])[0]);
}
const input = path.join(directory, 'check.cpp'), output = path.join(directory, 'check.wasm');
await writeFile(input, `#include ${JSON.stringify(path.join(root, 'scripts/occt-numeric.hpp'))}
using Standard_Real = double;
${refs.join('\n')}
#include ${JSON.stringify(path.join(source, 'AppCont/filens-IMatrix.pxx'))}
#include ${JSON.stringify(path.join(source, 'AppCont/filens-IBT.pxx'))}
#include ${JSON.stringify(path.join(source, 'PLib/PLib_JacobiPolynomial_Data.pxx'))}
struct Matrix {
  int size;
  double values[62*62];
  int LowerRow() const { return -3; }
  int LowerCol() const { return 7; }
  double& operator()(int row, int col) { return values[(row+3)*size+col-7]; }
};
static Matrix matrix;
static double weights[61];
extern "C" double* Gram(int size) { matrix.size = size; FilensGramMatrix(size, matrix); return matrix.values; }
extern "C" double* Packed(int type, int size) {
  matrix.size = size;
  FilensPackedMatrix(size, type ? 1 : 2, type ? FilensPackedIBT : FilensPackedIMatrix, matrix);
  return matrix.values;
}
extern "C" double* Jacobi(int constraint, int degree, double point, double weight) {
  FilensJacobiWeights(constraint, degree, point, weight, weights); return weights;
}
extern "C" double* Transform(int constraint) {
  matrix.size = 62; FilensJacobiTransform(constraint, 61, matrix); return matrix.values;
}
extern "C" const double* Reference(int type) {
  switch(type) {
    case 0: return BBMatrix; case 1: return IMatrix; case 2: return IBT;
    case 3: return WeightsDB_C0; case 4: return WeightsDB_C1; case 5: return WeightsDB_C2;
    case 6: return WeightsDB0_C0; case 7: return WeightsDB0_C1; case 8: return WeightsDB0_C2;
    case 9: return &TransMatrix_C0[0][0]; case 10: return &TransMatrix_C1[0][0]; default: return &TransMatrix_C2[0][0];
  }
}
`);
await new Promise((resolve, reject) => {
  const child = spawn(emcc, [input, '-Oz', '--no-entry', '-sSTANDALONE_WASM=1', '-sFILESYSTEM=0',
    ...['Gram', 'Packed', 'Jacobi', 'Transform', 'Reference'].map(name => `-Wl,--export=${name}`), '-o', output], { stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Numeric check compiler exited with ${code}`)));
});
const { instance } = await WebAssembly.instantiate(await readFile(output), {
  wasi_snapshot_preview1: { proc_exit(code) { throw new Error(`Numeric check exited with ${code}`); } }
});
instance.exports._initialize?.();
const doubles = (address, count) => [...new Float64Array(instance.exports.memory.buffer, address, count)];
const gram = { compared: 0, maximumAbsoluteError: 0, maximumRelativeError: 0 };
const referenceGram = doubles(instance.exports.Reference(0), 6200);
let index = 0;
for (let size = 2; size <= 26; ++size) {
  const values = doubles(instance.exports.Gram(size), size*size);
  assert.deepEqual(values, referenceGram.slice(index, index+size*size), `Gram order ${size}: correctly rounded rational coefficients`);
  for (const value of values) check(value, referenceGram[index++], gram, 'Bernstein Gram matrix');
  for (let i = 0; i < size; ++i) {
    assert(Math.abs(values.slice(i*size, (i+1)*size).reduce((a,b) => a+b, 0) - 1/size) < 1e-15);
    for (let j = 0; j < size; ++j) assert.equal(values[i*size+j], values[j*size+i]);
  }
}
let exactCompared = 0;
for (const [type, first, last, count] of [[0, 2, 26, 6200], [1, 1, 22, 3795]]) {
  const reference = doubles(instance.exports.Reference(type+1), count);
  let offset = 0;
  for (let size = first; size <= last; ++size) {
    const actual = doubles(instance.exports.Packed(type, size), size*size);
    assert.deepEqual(actual, reference.slice(offset, offset+size*size), `${names[type+1]} order ${size}: every double must be exact`);
    offset += size*size;
  }
  assert.equal(offset, count);
  exactCompared += count;
}
const math = await readFile(path.join(source, 'math/math.cxx'), 'utf8');
const points = readArray(math, 'Point'), gaussWeights = readArray(math, 'Weight');
const jacobi = { compared: 0, maximumAbsoluteError: 0, maximumRelativeError: 0 };
for (let constraint = 0; constraint <= 2; ++constraint) {
  const expected = doubles(instance.exports.Reference(3+constraint), [4761,4505,4249][constraint]);
  const expectedZero = doubles(instance.exports.Reference(6+constraint), [49,46,43][constraint]);
  let offset = 0, zeroOffset = 0;
  for (const count of [8,10,15,20,25,30,40,50,61]) {
    const degree = count - 2*(constraint+1) - 1;
    let gaussOffset = 0;
    for (let n = 1; n < count; ++n) gaussOffset += Math.ceil(n/2);
    const columns = [];
    for (let i = 1; i <= Math.floor(count/2); ++i) {
      const index = gaussOffset + Math.floor(count/2) - i + 1;
      columns.push(doubles(instance.exports.Jacobi(constraint, degree, points[index], gaussWeights[index]), degree+1));
    }
    for (let j = 0; j <= degree; ++j) for (const column of columns)
      check(column[j], expected[offset++], jacobi, `Jacobi C${constraint}, rule ${count}, degree ${j}`);
    if (count % 2) {
      const zero = doubles(instance.exports.Jacobi(constraint, degree, 0, gaussWeights[gaussOffset+Math.ceil(count/2)]), degree+1);
      for (let j = 0; j <= degree; ++j) {
        if (j % 2) assert.equal(zero[j], 0);
        else check(zero[j], expectedZero[zeroOffset++], jacobi, `Jacobi center C${constraint}, rule ${count}, degree ${j}`);
      }
    }
  }
  assert.equal(offset, expected.length);
  assert.equal(zeroOffset, expectedZero.length);
}
const transform = { compared: 0, maximumRelativeError: 0 };
for (let constraint = 0; constraint <= 2; ++constraint) {
  const reference = doubles(instance.exports.Reference(9+constraint), 992);
  const actual = doubles(instance.exports.Transform(constraint), 62*62);
  let offset = 0;
  for (let parity = 0; parity < 2; ++parity) {
    for (let row = 0; row < 31; ++row) for (let col = row; col < 31; ++col) {
      const expected = reference[offset++], value = actual[(2*row+parity)*62+2*col+parity];
      const relative = Math.abs(value-expected) / Math.max(1e-300, Math.abs(expected));
      if (!expected) assert.equal(value, 0, 'Structural zeros remain exact');
      assert(Number.isFinite(value) && relative <= 3e-14, `Jacobi transform C${constraint} ${row}/${col}/${parity}: ${value} != ${expected}; relative ${relative}`);
      transform.compared++;
      transform.maximumRelativeError = Math.max(transform.maximumRelativeError, relative);
    }
  }
}
const result = { gram, packed: { compared: exactCompared, bitExact: true }, jacobi, transform };
await writeFile(path.join(directory, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(`OCCT numeric replacement check: ${JSON.stringify(result)}`);

function check(actual, expected, stats, label) {
  assert(Number.isFinite(actual) && Number.isFinite(expected), `${label}: finite coefficients`);
  const absolute = Math.abs(actual - expected), relative = absolute / Math.max(1e-300, Math.abs(expected));
  // Quadrature coefficients are bounded and may be arbitrarily close to a
  // polynomial root. Use an absolute error bound; still report relative error.
  assert(absolute <= 2e-14,
    `${label}: ${actual} != ${expected}; abs=${absolute}, rel=${relative}`);
  stats.compared++;
  stats.maximumAbsoluteError = Math.max(stats.maximumAbsoluteError, absolute);
  stats.maximumRelativeError = Math.max(stats.maximumRelativeError, relative);
}

function readArray(source, name) {
  return numericArray(source, name)[1].replace(/\/\/[^\n]*/g, '').split(',').map(value => value.trim()).filter(Boolean).map(Number);
}
