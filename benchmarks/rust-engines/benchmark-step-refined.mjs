// Compare both WASM artifacts without replacing any historical geometry output.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const work = path.join(root, 'tmp/rust-engines');
const report = JSON.parse(await readFile(path.join(work, 'results-step-refined.json')));
const previous = JSON.parse(await readFile(path.join(root, 'docs/assets/rust-engines/results-step-reviewed.json')));
const comparePreopt = process.argv.includes('--compare-preopt');
const preopt = comparePreopt ? JSON.parse(await readFile(path.join(work, 'results-step-refined-preopt.json'))) : null;
const cases = report.step.filter(row => row.engines.occt.success);
const engines = comparePreopt ? ['truck-reviewed', 'truck-refined-preopt', 'truck-refined'] : ['truck-reviewed', 'truck-refined'];
function geometryHash(bytes) {
  const geometry = JSON.parse(bytes);
  const triangles = [];
  for (let i = 0; i < geometry.positions.length; i += 3) {
    triangles.push(JSON.stringify([geometry.positions.slice(i, i + 3), geometry.normals.slice(i, i + 3)]));
  }
  // Assembly instances can be emitted in different orders between processes.
  // Retain every position, normal, triangle, and winding while ignoring that order.
  return createHash('sha256').update(triangles.sort().join('\n')).digest('hex');
}
const artifactSha256 = {};
for (const name of engines) {
  const bytes = await readFile(path.join(work, `wasm/${name}.wasm`));
  artifactSha256[name] = createHash('sha256').update(bytes).digest('hex');
  const expected = (name === 'truck-reviewed' ? previous : name === 'truck-refined-preopt' ? preopt : report).sizes.find(size => size.name === (name === 'truck-refined-preopt' ? 'truck-refined' : name));
  assert.equal(artifactSha256[name], expected.sha256);
}
const scratch = await mkdtemp(path.join(work, 'refined-timing-'));
const rounds = [];
try {
  for (let round = 0; round < 3; round++) {
    const rows = [];
    for (const [index, fixture] of cases.entries()) {
      const input = path.join(work, 'source/occt-import-js-0.0.23/test/testfiles', fixture.id);
      assert.equal(createHash('sha256').update(await readFile(input)).digest('hex'), fixture.sha256);
      const offset = (round + index) % engines.length;
      const enginesInOrder = [...engines.slice(offset), ...engines.slice(0, offset)];
      const row = { id: fixture.id, engines: {} };
      for (const name of enginesInOrder) {
        const { stdout } = await exec(process.execPath, ['--no-warnings', path.join(here, 'wasi-runner.mjs'), path.join(work, `wasm/${name}.wasm`), input, path.join(scratch, 'mesh.json'), '0.1', '--reviewed'], { cwd: root, timeout: 20000, maxBuffer: 1 << 20 });
        const result = JSON.parse(stdout.trim().split('\n').at(-1));
        assert(result.success && result.missingFaces === 0, `${name}: ${fixture.id}`);
        const geometrySha256 = comparePreopt && name !== 'truck-reviewed' ? geometryHash(await readFile(path.join(scratch, 'mesh.json'), 'utf8')) : undefined;
        row.engines[name] = { meshMs: result.meshMs, parseMs: result.parseMs, triangles: result.triangles, ...(geometrySha256 ? { geometrySha256 } : {}) };
      }
      if (comparePreopt) assert.equal(row.engines['truck-refined'].geometrySha256, row.engines['truck-refined-preopt'].geometrySha256, `Optimization changed mesh: ${fixture.id}`);
      rows.push(row);
    }
    const totals = Object.fromEntries(engines.map(name => [name, rows.reduce((sum, row) => sum + row.engines[name].meshMs, 0)]));
    rounds.push({ totals, rows });
    console.log(JSON.stringify({ round: round + 1, totals }));
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const medianTotalMeshMs = Object.fromEntries(engines.map(name => [name, median(rounds.map(round => round.totals[name]))]));
const result = { date: new Date().toISOString(), node: process.version, platform: `${process.platform}-${process.arch}`, method: 'Three sequential rounds over the same 44 nonempty fixtures; engine order rotates per fixture and round; meshMs includes tessellation and mesh assembly, excludes parsing, WASM compilation/startup, and output serialization. No peak-memory measurement.', artifactSha256, medianTotalMeshMs, meshTimeRatio: medianTotalMeshMs['truck-refined'] / medianTotalMeshMs['truck-reviewed'], ...(comparePreopt ? { optimizationTimeRatio: medianTotalMeshMs['truck-refined'] / medianTotalMeshMs['truck-refined-preopt'], optimizedMeshesIdentical: true, geometryHashMethod: 'SHA256 of sorted JSON triangle arrays, each preserving exact vertex positions, normals, vertex order and winding. No rounding; only triangle/instance emission order is ignored.' } : {}), rounds };
await writeFile(path.join(work, 'timing-step-refined.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ medianTotalMeshMs, ratio: result.meshTimeRatio }));
