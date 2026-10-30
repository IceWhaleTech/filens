import { geometryStats, compareGeometry } from './step-metrics.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const work = path.join(root, 'tmp/rust-engines');
const refinedStep = process.argv.includes('--step-refined');
const reviewedStep = refinedStep || process.argv.includes('--step-reviewed');
const fixedStep = reviewedStep || process.argv.includes('--truck-fixed');
const output = path.join(work, refinedStep ? 'output-step-refined' : reviewedStep ? 'output-step-reviewed' : fixedStep ? 'output-step-fixed' : 'output');
await mkdir(output, { recursive: true });
const { PNG } = await import(path.join(work, 'tools/node_modules/pngjs/lib/png.js'));

const reportPath = path.join(work, refinedStep ? 'results-step-refined.json' : reviewedStep ? 'results-step-reviewed.json' : fixedStep ? 'results-step-fixed.json' : 'results.json');
let report = { date: '2026-10-29', node: process.version, platform: `${process.platform}-${process.arch}`, rust: '1.93.0', target: 'wasm32-wasip1', optimization: 'opt-level=z, LTO, codegen-units=1, panic=abort, strip; Binaryen 131 -Oz', compression: 'gzip level 9; Brotli quality 11', truckCommit: '78d699b0792b39e27c2bf073b682986701644e91', sizes: [], pdf: [], step: [] };
try { report = JSON.parse(await readFile(reportPath, 'utf8')); } catch {}
if (reviewedStep) report.date = '2026-10-30';
if (refinedStep) report.source = JSON.parse(await readFile(path.join(work, 'wasm/truck-refined.build.json'), 'utf8'));
const save = () => writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
const hash = data => createHash('sha256').update(data).digest('hex');
const slug = s => s.replace(/[^a-zA-Z0-9.-]+/g, '_');

async function invoke(script, args, timeout = 30000) {
  let stdout = '', stderr = '', failed;
  try {
    ({ stdout, stderr } = await exec(process.execPath, ['--no-warnings', path.join(here, script), ...args], { cwd: root, timeout, killSignal: 'SIGKILL', maxBuffer: 16 << 20 }));
  } catch (error) {
    stdout = error.stdout ?? ''; stderr = error.stderr ?? ''; failed = error;
  }
  const lines = stdout.trim().split('\n').reverse();
  for (const line of lines) {
    try { return { ...JSON.parse(line), ...(failed ? { exitError: failed.killed ? 'timeout' : String(failed.code) } : {}) }; } catch {}
  }
  return { success: false, error: failed?.killed ? 'timeout' : (stderr || stdout || String(failed)).slice(0, 400) };
}

for (const [name, file] of (fixedStep ? [ [refinedStep ? 'truck-refined' : reviewedStep ? 'truck-reviewed' : 'truck-fixed', refinedStep ? 'wasm/truck-refined.wasm' : reviewedStep ? 'wasm/truck-reviewed.wasm' : 'wasm/truck-fixed.wasm'], ['occt', ''] ] : [
  ['pdfium', 'pdfium.wasm'], ['hayro-fonts', 'wasm/hayro-fonts.wasm'], ['hayro-no-fonts', 'wasm/hayro-no-fonts.wasm'], ['truck', 'wasm/truck.wasm'],
  ['occt', '../../packages/model3d/vendor/occt-import-js/occt-import-js.wasm'],
])) {
  const full = name === 'occt' ? path.join(root, 'packages/model3d/vendor/occt-import-js/occt-import-js.wasm') : path.join(work, file);
  try {
    const bytes = await readFile(full);
    const size = { name, sha256: hash(bytes), raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length, brotli: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length };
    report.sizes = report.sizes.filter(x => x.name !== name).concat(size);
    console.log('size', JSON.stringify(size));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
await save();

if (!fixedStep && !process.argv.includes('--step-only') && !process.argv.includes('--size-only')) {
  const cases = [
    ['demo-cover', 'apps/demo/public/samples/filens-cosmic-atlas.pdf', 0],
    ['demo-page2', 'apps/demo/public/samples/filens-cosmic-atlas.pdf', 1],
    ['demo-page3', 'apps/demo/public/samples/filens-cosmic-atlas.pdf', 2],
    ['scan', 'converter/rapidocr/testdata/scan.pdf', 0],
    ['unicode-radicals', 'tmp/rust-engines/fixtures/pdf/pdfjs-11066-copy-paste.pdf', 0],
    ['unicode-missing-font', 'tmp/rust-engines/fixtures/pdf/pdfjs-19747-test-031.pdf', 0],
    ['python-first', 'tmp/rust-engines/fixtures/pdf/pymupdf-3538-python.pdf', 0],
    ['python-middle', 'tmp/rust-engines/fixtures/pdf/pymupdf-3538-python.pdf', 43],
    ['python-last', 'tmp/rust-engines/fixtures/pdf/pymupdf-3538-python.pdf', 87],
    ['type3-first', 'tmp/rust-engines/fixtures/pdf/pymupdf-3945-1015.pdf', 0],
    ['type3-middle', 'tmp/rust-engines/fixtures/pdf/pymupdf-3945-1015.pdf', 8],
    ['type3-last', 'tmp/rust-engines/fixtures/pdf/pymupdf-3945-1015.pdf', 17],
    ['password', 'converter/testdata/password_test123.pdf', 0],
  ];
  for (const [id, relative, page] of cases) {
    const input = path.join(root, relative);
    const row = { id, input: relative, sha256: hash(await readFile(input)), page, dpi: 96, engines: {} };
    for (const engine of ['pdfium', 'hayro-fonts', 'hayro-no-fonts']) {
      const rgbaPath = path.join(output, `${id}-${engine}.rgba`);
      const args = engine === 'pdfium' ? ['pdf', input, rgbaPath, String(page), '96'] : [path.join(work, `wasm/${engine}.wasm`), input, rgbaPath, String(page), '96'];
      const result = await invoke(engine === 'pdfium' ? 'reference.mjs' : 'wasi-runner.mjs', args);
      if (result.success) {
        const rgba = await readFile(rgbaPath);
        const png = new PNG({ width: result.width, height: result.height });
        png.data = rgba;
        await writeFile(path.join(output, `${id}-${engine}.png`), PNG.sync.write(png));
        result.image = `${id}-${engine}.png`;
        result.textSha256 = hash(result.text ?? '');
        result.textLength = [...(result.text ?? '')].length;
        if (engine !== 'pdfium' && row.engines.pdfium.success) {
          const ref = row.engines.pdfium;
          const expected = await readFile(path.join(output, `${id}-pdfium.rgba`));
          result.pixels = comparePixels(expected, ref.width, ref.height, rgba, result.width, result.height);
          result.textEqualIgnoringWhitespace = cleanText(result.text) === cleanText(ref.text);
        }
      }
      row.engines[engine] = result;
    }
    report.pdf = report.pdf.filter(x => x.id !== id).concat(row);
    await save();
    console.log('pdf', id, Object.fromEntries(Object.entries(row.engines).map(([k, v]) => [k, { success: v.success, mae: v.pixels?.meanAbsoluteError, textEqual: v.textEqualIgnoringWhitespace }])));
  }
}

if (!process.argv.includes('--pdf-only') && !process.argv.includes('--size-only')) {
  const fixtures = path.join(work, 'source/occt-import-js-0.0.23/test/testfiles');
  const cases = await listFixtures(fixtures);
  for (const input of cases) {
    const id = path.relative(fixtures, input);
    const row = { id, sha256: hash(await readFile(input)), engines: {} };
    for (const engine of ['occt', 'truck']) {
      const geometryFile = path.join(output, `${slug(id)}-${engine}.json`);
      const args = engine === 'occt' ? ['step', input, geometryFile] : [path.join(work, refinedStep ? 'wasm/truck-refined.wasm' : reviewedStep ? 'wasm/truck-reviewed.wasm' : fixedStep ? 'wasm/truck-fixed.wasm' : 'wasm/truck.wasm'), input, geometryFile, '0.1', ...(reviewedStep ? ['--reviewed'] : [])];
      const result = await invoke(engine === 'occt' ? 'reference.mjs' : 'wasi-runner.mjs', args, 20000);
      if (result.success) {
        const geometry = JSON.parse(await readFile(geometryFile));
        result.geometry = geometryStats(geometry);
        if (engine === 'truck' && row.engines.occt.success) {
          const baseline = JSON.parse(await readFile(path.join(output, `${slug(id)}-occt.json`)));
          result.comparison = compareGeometry(baseline, geometry);
          const c = result.comparison;
          result.geometryScreenPass = result.missingFaces === 0 && c.boundsRelativeError < 0.01 && c.areaRelativeError < 0.03 && c.volumeRelativeError < 0.05 && Math.max(c.referenceToCandidate.p95, c.candidateToReference.p95) <= Math.max(0.2, row.engines.occt.geometry.diagonal * 0.001);
          // Diagnostic only: does a common unit scale explain the bounds?
          // This does not modify the candidate output or its pass result.
          const ref = row.engines.occt.geometry, actual = result.geometry;
          const scales = [1, 25.4, 1000, 1 / 25.4, 0.001];
          const ranked = scales.map(scale => ({ scale, error: Math.max(...ref.min.map((v, i) => Math.abs(v - actual.min[i] * scale)), ...ref.max.map((v, i) => Math.abs(v - actual.max[i] * scale))) / ref.diagonal })).sort((a, b) => a.error - b.error);
          if (ranked[0].scale !== 1 && ranked[0].error < 0.02) {
            result.unitScaleDiagnostic = { scale: ranked[0].scale, boundsRelativeErrorAfterScale: ranked[0].error, areaRelativeErrorAfterScale: Math.abs(ref.area - actual.area * ranked[0].scale ** 2) / ref.area };
          }
        }
      }
      row.engines[engine] = result;
    }
    report.step = report.step.filter(x => x.id !== id).concat(row);
    await save();
    console.log('step', id, Object.fromEntries(Object.entries(row.engines).map(([k, v]) => [k, { success: v.success, triangles: v.triangles, missingFaces: v.missingFaces, screen: v.geometryScreenPass, error: v.error?.slice(0, 100) }])));
  }
}

function cleanText(s = '') { return s.replace(/\s/g, ''); }

function comparePixels(a, aw, ah, b, bw, bh) {
  const width = Math.min(aw, bw), height = Math.min(ah, bh);
  let absolute = 0, changed = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let max = 0;
    for (let c = 0; c < 3; c++) { const d = Math.abs(a[(y * aw + x) * 4 + c] - b[(y * bw + x) * 4 + c]); absolute += d; max = Math.max(max, d); }
    if (max > 32) changed++;
  }
  return { meanAbsoluteError: absolute / (width * height * 3 * 255), fractionPixelsOver32: changed / (width * height), dimensionsEqual: aw === bw && ah === bh };
}

async function listFixtures(dir) {
  const output = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, item.name);
    if (item.isDirectory()) output.push(...await listFixtures(p));
    else if (/\.(step|stp)$/i.test(item.name)) output.push(p);
  }
  return output.sort();
}

