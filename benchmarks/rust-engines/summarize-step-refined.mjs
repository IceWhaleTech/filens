import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const work = path.join(root, 'tmp/rust-engines');
const readJSON = async file => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = await readJSON('tmp/rust-engines/results-step-refined.json');
const previous = await readJSON('docs/assets/rust-engines/results-step-reviewed.json');
const timing = await readJSON('tmp/rust-engines/timing-step-refined.json');
const provenance = await readJSON('tmp/rust-engines/wasm/truck-refined.build.json');
assert.equal(report.source.patchSha256, provenance.patchSha256);
report.source = provenance;
assert.equal(hash(await readFile(path.join(root, 'docs/upstream/truck', provenance.patch))), provenance.patchSha256);
assert.equal(hash(await readFile(path.join(root, 'benchmarks/rust-engines/Cargo.refined.lock'))), provenance.lockSha256);
for (const [file, digest] of Object.entries(provenance.adapterSha256)) {
  assert.equal(hash(await readFile(path.join(root, 'benchmarks/rust-engines/src', file))), digest);
}
const old = new Map(previous.step.map(row => [row.id, row]));
for (const row of report.step) {
  assert.equal(row.sha256, old.get(row.id).sha256, row.id);
  if (row.engines.truck.comparison) {
    const engine = row.engines.truck, c = engine.comparison;
    const expected = engine.missingFaces === 0 && c.boundsRelativeError < 0.01 && c.areaRelativeError < 0.03 && c.volumeRelativeError < 0.05 && Math.max(c.referenceToCandidate.p95, c.candidateToReference.p95) <= Math.max(0.2, row.engines.occt.geometry.diagonal * 0.001);
    assert.equal(engine.geometryScreenPass, expected, row.id);
  }
}
const rows = report.step.filter(row => row.engines.occt.success);
const passing = rows.filter(row => row.engines.truck.geometryScreenPass);
const regressions = rows.filter(row => old.get(row.id).engines.truck.geometryScreenPass && !row.engines.truck.geometryScreenPass).map(row => row.id);
const improved = passing.filter(row => !old.get(row.id).engines.truck.geometryScreenPass).map(row => row.id);
assert.equal(report.step.length, 55);
assert.equal(new Set(report.step.map(row => row.id)).size, 55);
assert.equal(rows.length, 44);
assert(rows.every(row => row.engines.truck.success && row.engines.truck.missingFaces === 0));
assert.equal(passing.length, 43);
assert.equal(regressions.length, 0);
assert.equal(improved.length, 3);
const size = report.sizes.find(size => size.name === 'truck-refined');
const bytes = await readFile(path.join(work, 'wasm/truck-refined.wasm'));
assert(WebAssembly.validate(bytes));
assert.equal(hash(bytes), size.sha256);
assert.equal(bytes.length, size.raw);
assert.equal(gzipSync(bytes, { level: 9 }).length, size.gzip);
assert.equal(brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length, size.brotli);
assert.equal(timing.rounds.length, 3);
for (const round of timing.rounds) assert.equal(round.rows.length, 44);
if (timing.optimizedMeshesIdentical) {
  for (const round of timing.rounds) {
    for (const row of round.rows) {
      assert.equal(row.engines['truck-refined'].geometrySha256, row.engines['truck-refined-preopt'].geometrySha256, row.id);
      assert.equal(row.engines['truck-refined'].triangles, row.engines['truck-refined-preopt'].triangles, row.id);
    }
  }
}
assert.equal(timing.artifactSha256['truck-refined'], size.sha256);
assert.equal(timing.artifactSha256['truck-reviewed'], previous.sizes.find(size => size.name === 'truck-reviewed').sha256);
const testCounts = async file => {
  const log = await readFile(path.join(root, file), 'utf8');
  const results = [...log.matchAll(/test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed/g)];
  assert.equal(results.length, 3, file);
  return results.reduce((sum, match) => ({ passed: sum.passed + Number(match[1]), failed: sum.failed + Number(match[2]) }), { passed: 0, failed: 0 });
};
const beforeEvidence = 'docs/upstream/truck/regressions-refined-before.txt';
const before = await testCounts(beforeEvidence);
const after = await testCounts('tmp/rust-engines/refined-tests-after.log');
assert.deepEqual(before, { passed: 1, failed: 7 });
assert.deepEqual(after, { passed: 8, failed: 0 });
const upstreamBase = '1ca3214e537004d466addbd85d6375807147a426';
const gitOptions = { cwd: path.join(work, 'upstream-truck'), maxBuffer: 4 << 20 };
try { await exec('git', ['cat-file', '-e', `${upstreamBase}^{commit}`], gitOptions); }
catch { await exec('git', ['fetch', '--depth=1', 'origin', upstreamBase], gitOptions); }
const sourceFiles = ['truck-geometry/src/decorators/processor.rs', 'truck-geometry/src/specifieds/sphere.rs', 'truck-meshalgo/src/tessellation/triangulation.rs', 'truck-stepio/src/in/step_geometry/sphere.rs'];
for (const file of sourceFiles) {
  const original = await exec('git', ['show', `${provenance.base}:${file}`], gitOptions);
  const upstream = await exec('git', ['show', `${upstreamBase}:${file}`], gitOptions);
  assert.equal(original.stdout, upstream.stdout, file);
}
const scratch = await mkdtemp(path.join(work, 'refined-apply-check-'));
const originalValidation = await readJSON('docs/upstream/truck/validation.json');
const publishedPR = (await readJSON('docs/upstream/truck/pull-requests.json')).pullRequests.find(pr => pr.patch === provenance.patch);
try {
  const options = { ...gitOptions, env: { ...process.env, GIT_INDEX_FILE: path.join(scratch, 'index') } };
  await exec('git', ['read-tree', upstreamBase], options);
  await exec('git', ['apply', '--cached', '--check', path.join(root, 'docs/upstream/truck', provenance.patch)], options);
  for (const patch of originalValidation.patches) {
    await exec('git', ['apply', '--cached', path.join(root, 'docs/upstream/truck', patch.file)], options);
  }
  await exec('git', ['apply', '--cached', '--check', path.join(root, 'docs/upstream/truck', provenance.patch)], options);
} finally { await rm(scratch, { recursive: true, force: true }); }
for (const patch of originalValidation.patches) assert.equal(hash(await readFile(path.join(root, 'docs/upstream/truck', patch.file))), patch.sha256);
report.summary = { files: 55, referenceNonempty: 44, candidateNonempty: 44, geometryScreenBeforeRefinement: 40, geometryScreenPasses: passing.length, improved, regressions, remaining: rows.filter(row => !row.engines.truck.geometryScreenPass).map(row => row.id), targetedRegressionTests: 8 };
report.performance = { method: timing.method, rounds: 3, medianTotalMeshMs: timing.medianTotalMeshMs, meshTimeRatio: timing.meshTimeRatio, ...(timing.optimizedMeshesIdentical ? { optimizationTimeRatio: timing.optimizationTimeRatio, optimizedMeshesIdentical: true, geometryHashMethod: timing.geometryHashMethod } : {}), beforeTriangles: rows.reduce((sum, row) => sum + old.get(row.id).engines.truck.triangles, 0), afterTriangles: rows.reduce((sum, row) => sum + row.engines.truck.triangles, 0) };
const publication = publishedPR ? { status: `published PR #${publishedPR.number}`, pullRequest: { number: publishedPR.number, url: publishedPR.url, headCommit: publishedPR.headCommit, baseBranch: 'master' } } : { status: 'local patch and PR draft; not published' };
const validation = { date: report.date, upstream: 'https://github.com/ricosjp/truck', ...publication, ...provenance, upstreamApplyCheckBase: upstreamBase, independentApplyCheck: true, combinedApplyWithFirstThreePatchesCheck: true, changedSourceFilesIdenticalBetweenBases: sourceFiles, fullHeadDependencyGraphTested: false, fullUpstreamSuiteTested: false, beforeEvidence: { file: path.basename(beforeEvidence), sha256: hash(await readFile(path.join(root, beforeEvidence))), note: 'Archived original-code execution; summarize checks this evidence, without rerunning the original code.' }, before, after, wasm: size, geometry: report.summary, performance: report.performance, limitations: ['Existing Filens preview adapters are still needed for the corpus result.', 'HEAD_BACK still fails; sphere-region and orientation disagreement is unresolved.', 'Refinement uses bounded centroid samples, not a certified maximum surface-error bound.', 'Timing covers Node WASI meshing and mesh assembly, not browser end-to-end time or peak memory.'] };
for (const [file, data] of [['docs/assets/rust-engines/results-step-refined.json', report], ['docs/assets/rust-engines/timing-step-refined.json', timing], ['docs/upstream/truck/validation-refined.json', validation]]) {
  const json = JSON.stringify(data, null, 2) + '\n';
  assert(!json.includes(root));
  await writeFile(path.join(root, file), json);
}
await writeFile(path.join(work, 'results-step-refined.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report.summary, wasm: size, performance: report.performance }, null, 2));
