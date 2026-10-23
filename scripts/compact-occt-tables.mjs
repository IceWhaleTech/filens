import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scripts = path.dirname(fileURLToPath(import.meta.url));

export async function compactOcctTables(source, work) {
  const originals = path.join(work, 'numeric-original');
  await mkdir(originals, { recursive: true });
  const specs = [
    { file: 'AppCont_ContMatrices.cxx', name: 'IMatrix', first: 2, last: 26, size: 'classe' },
    { file: 'AppCont_ContMatrices_3.cxx', name: 'IBT', first: 1, last: 22, size: 'classe-4' }
  ];
  const layout = [];
  for (const spec of specs) {
    const file = path.join(source, 'AppCont', spec.file);
    const original = await readFile(file, 'utf8');
    await cp(file, path.join(originals, spec.file));
    const match = numericArray(original, spec.name);
    const literals = match[1].split(',').map(value => value.trim()).filter(Boolean);
    const values = literals.map(Number);
    assert(values.every(Number.isFinite));
    const packed = [];
    let offset = 0;
    for (let n = spec.first; n <= spec.last; ++n) {
      // Refuse to infer symmetry from an approximate match: every double must
      // match under both transformations, for every supported matrix order.
      for (let i = 0; i < n; ++i) for (let j = 0; j < n; ++j) {
        assert.equal(values[offset + i*n+j], values[offset + j*n+i], `${spec.name}: transpose ${n}/${i}/${j}`);
        assert.equal(values[offset + i*n+j], values[offset + (n-1-i)*n+n-1-j], `${spec.name}: reflection ${n}/${i}/${j}`);
      }
      for (let i = 0; i * 2 < n; ++i)
        for (let j = i; j < n-i; ++j) packed.push(literals[offset + i*n+j]);
      offset += n*n;
    }
    assert.equal(offset, values.length);
    const name = `FilensPacked${spec.name}`;
    const data = `${original.slice(0, original.indexOf('#ifndef'))}// Generated lossless symmetric wedge; see compact-occt-tables.mjs.\nstatic const double ${name}[] = {\n${packed.join(',\n')}\n};\n`;
    await writeFile(path.join(source, 'AppCont', `filens-${spec.name}.pxx`), data);
    let patched = original.replace(match[0], `#include "filens-${spec.name}.pxx"\n#include "filens-numeric.hpp"`);
    const nameOfFunction = spec.name === 'IMatrix' ? 'InvMMatrix' : 'IBTMatrix';
    patched = replaceBody(patched, nameOfFunction, `
  if (classe > ${spec.name === 'IMatrix' ? 24 : 26}) throw Standard_DimensionError("${nameOfFunction}: unsupported degree");
  FilensPackedMatrix(${spec.size}, ${spec.first}, ${name}, ${spec.name === 'IMatrix' ? 'InvM' : 'IBTMa'});`);
    await writeFile(file, patched);
    layout.push({ name: spec.name, originalValues: values.length, packedValues: packed.length, originalBytes: values.length*8, packedBytes: packed.length*8 });
  }
  const gram = path.join(source, 'AppCont/AppCont_ContMatrices_2.cxx');
  let original = await readFile(gram, 'utf8');
  await cp(gram, path.join(originals, 'AppCont_ContMatrices_2.cxx'));
  original = original.replace(numericArray(original, 'BBMatrix')[0], '#include "filens-numeric.hpp"');
  await writeFile(gram, replaceBody(original, 'MMatrix', `
  if (classe < 2 || classe > 24) throw Standard_DimensionError("MMatrix: unsupported degree");
  FilensGramMatrix(classe, M);`));
  const jacobi = path.join(source, 'PLib/PLib_JacobiPolynomial.cxx');
  original = await readFile(jacobi, 'utf8');
  await cp(jacobi, path.join(originals, 'PLib_JacobiPolynomial.cxx'));
  original = original.replace('#include "PLib_JacobiPolynomial_Data.pxx"', '#include "PLib_JacobiPolynomial_Data.pxx"\n#include "filens-numeric.hpp"');
  original = replaceBody(original, 'PLib_JacobiPolynomial::Weights', `
  math_Vector points(1, NbGaussPoints), weights(1, NbGaussPoints);
  math::GaussPoints(NbGaussPoints, points);
  math::GaussWeights(NbGaussPoints, weights);
  double values[31];
  for (int i = 1; i <= NbGaussPoints / 2; ++i) {
    const int index = NbGaussPoints / 2 - i + 1;
    FilensJacobiWeights(myNivConstr, myDegree, points(index), weights(index), values);
    for (int j = 0; j <= myDegree; ++j) TabWeights.SetValue(i, j, values[j]);
  }
  if (NbGaussPoints % 2) {
    FilensJacobiWeights(myNivConstr, myDegree, 0.0, weights(NbGaussPoints / 2 + 1), values);
    for (int j = 0; j <= myDegree; ++j) TabWeights.SetValue(0, j, values[j]);
  } else {
    for (int j = 0; j <= myDegree; ++j) TabWeights.SetValue(0, j, UNDEFINED);
  }`);
  const switchPattern = /  switch \(myNivConstr\) \{\s*case 0: pTr = &TransMatrix_C0\[0\]\[0\]; break;\s*case 1: pTr = &TransMatrix_C1\[0\]\[0\]; break;\s*case 2: pTr = &TransMatrix_C2\[0\]\[0\]; break;\s*}/g;
  assert.equal([...original.matchAll(switchPattern)].length, 1, 'Pinned Jacobi transform switch');
  original = original.replace(switchPattern, `  TColStd_Array2OfReal transform(0, Degree, 0, Degree);\n  FilensJacobiTransform(myNivConstr, Degree, transform);`);
  assert.equal(original.split('(*(pTr+iptt+j))').length-1, 2, 'Pinned Jacobi transform lookups');
  original = original.replace('(*(pTr+iptt+j))', 'transform(2*i, 2*j)')
    .replace('(*(pTr+iptt+j))', 'transform(2*i+1, 2*j+1)')
    .replace('  pTr += MAXM*(MAXM+1)/2;', '  // Odd-power coefficients use the same generated transform.');
  original = original.replace('  const Standard_Integer MAXM=31;\n', '')
    .replace('i,iptt,j,idim, ii, jj;', 'i,j,idim, ii, jj;')
    .replace('  Standard_Real const *pTr=NULL;  // the pointer to TransMatrix\n', '')
    .replaceAll('    iptt = i*MAXM-(i+1)*i/2;\n', '');
  await writeFile(jacobi, original);
  for (const module of ['AppCont', 'PLib']) await cp(path.join(scripts, 'occt-numeric.hpp'), path.join(source, module, 'filens-numeric.hpp'));
  await writeFile(path.join(work, 'numeric-layout.json'), `${JSON.stringify(layout, null, 2)}\n`);
  console.log(`Compacted exact symmetric matrix tables: ${JSON.stringify(layout)}; Gram/Jacobi weights now computed.`);
}

export function numericArray(source, name) {
  const match = new RegExp(`static\\s+const\\s+Standard_Real\\s+${name}\\[\\s*\\]\\s*=\\s*\\{([\\s\\S]*?)\\};`).exec(source);
  assert(match, `Missing pinned ${name} array`);
  return match;
}

function replaceBody(source, name, body) {
  const pattern = new RegExp(`\\b${name}\\s*\\([^)]*\\)[^{]*\\{`, 'g');
  const matches = [...source.matchAll(pattern)];
  assert.equal(matches.length, 1, `Expected one ${name} definition`);
  const start = matches[0].index + matches[0][0].length;
  let depth = 1, end = start;
  while (depth && end < source.length) {
    if (source[end] === '{') depth++;
    else if (source[end] === '}') depth--;
    end++;
  }
  assert.equal(depth, 0);
  return `${source.slice(0, start)}${body}\n${source.slice(end-1)}`;
}
