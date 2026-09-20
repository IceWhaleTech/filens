import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readJson(filePath) {
  let raw = await fs.readFile(filePath, 'utf8');
  raw = raw.replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function main() {
  const baseManifestRel = process.argv[2] || 'tmp/real-samples/real-samples-manifest.json';
  const outReportRel = process.argv[3] || 'tmp/real-samples/e2e-report.json';

  const baseManifestPath = path.resolve(rootDir, baseManifestRel);
  const outReportPath = path.resolve(rootDir, outReportRel);

  const report = {
    ok: true,
    steps: [],
    artifacts: {}
  };

  // Step 1: Ensure base manifest exists
  const baseExists = await fs
    .stat(baseManifestPath)
    .then((st) => st.isFile() && st.size > 0)
    .catch(() => false);
  if (!baseExists) {
    report.ok = false;
    report.steps.push({ step: 'check_manifest', ok: false, error: `Missing ${path.relative(rootDir, baseManifestPath)}` });
    await writeJson(outReportPath, report);
    process.exit(1);
  }
  report.steps.push({ step: 'check_manifest', ok: true });

  // Step 2: Run conversions (Go/wazero + converter-core.wasm)
  const conversionsScript = path.resolve(rootDir, 'scripts/run-real-sample-conversions.mjs');
  const conversionCode = await run(process.platform === 'win32' ? 'node.exe' : 'node', [conversionsScript], {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit'
  });
  report.steps.push({ step: 'convert_legacy', ok: conversionCode === 0, exitCode: conversionCode });
  if (conversionCode !== 0) {
    report.ok = false;
    await writeJson(outReportPath, report);
    process.exit(conversionCode);
  }

  const conversionReportPath = path.resolve(rootDir, 'tmp/real-samples/conversion-report.json');
  report.artifacts.conversionReport = path.relative(rootDir, conversionReportPath);

  // Step 3: Build a manifest for converted outputs
  const conversionReport = await readJson(conversionReportPath);
  const convertedItems = [];
  for (const item of conversionReport.results ?? []) {
    const outPath = item?.job?.outputPath;
    if (!outPath) continue;
    // outputPath is relative to examples/go-wazero-converter.
    const abs = path.resolve(rootDir, 'examples/go-wazero-converter', outPath);
    const rel = path.relative(rootDir, abs).replace(/\\/g, '/');
    const ext = path.extname(rel).slice(1).toLowerCase();
    const id = path.basename(rel, path.extname(rel));
    convertedItems.push({ id, kind: ext, tags: ['converted', 'wasi'], path: rel });
  }

  const convertedManifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    description: 'Converted OpenXML outputs from manifest-backed conversion smoke (for preview e2e).',
    samples: convertedItems
  };

  const convertedManifestPath = path.resolve(rootDir, 'tmp/real-samples/converted-manifest.json');
  await writeJson(convertedManifestPath, convertedManifest);
  report.steps.push({ step: 'write_converted_manifest', ok: true, count: convertedItems.length });
  report.artifacts.convertedManifest = path.relative(rootDir, convertedManifestPath);

  // Step 4: Stage converted outputs into a clean staging dir
  const stagingDir = path.resolve(rootDir, 'tmp/real-samples/selected-converted');
  const stageScript = path.resolve(rootDir, 'scripts/stage-real-samples.mjs');
  const stageCode = await run(process.platform === 'win32' ? 'node.exe' : 'node', [stageScript, convertedManifestPath, stagingDir], {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit'
  });
  report.steps.push({ step: 'stage_converted', ok: stageCode === 0, exitCode: stageCode });
  if (stageCode !== 0) {
    report.ok = false;
    await writeJson(outReportPath, report);
    process.exit(stageCode);
  }

  report.artifacts.convertedStagingDir = path.relative(rootDir, stagingDir);

  // Step 5: Preview smoke test the converted OpenXML outputs
  const previewScript = path.resolve(rootDir, 'scripts/run-real-sample-preview.mjs');
  const previewReportPath = path.resolve(rootDir, 'tmp/real-samples/preview-converted-report.json');
  const previewCode = await run(process.platform === 'win32' ? 'node.exe' : 'node', [previewScript, convertedManifestPath, stagingDir, previewReportPath], {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit'
  });
  report.steps.push({ step: 'preview_converted', ok: previewCode === 0, exitCode: previewCode });
  report.artifacts.previewConvertedReport = path.relative(rootDir, previewReportPath);

  if (previewCode !== 0) {
    report.ok = false;
  }

  // Step 6: Strict preview test the converted OpenXML outputs
  const strictPreviewScript = path.resolve(rootDir, 'scripts/run-real-sample-preview-strict.mjs');
  const strictPreviewReportPath = path.resolve(rootDir, 'tmp/real-samples/preview-converted-report-strict.json');
  const strictPreviewCode = await run(
    process.platform === 'win32' ? 'node.exe' : 'node',
    [strictPreviewScript, convertedManifestPath, stagingDir, strictPreviewReportPath],
    {
      cwd: rootDir,
      env: process.env,
      stdio: 'inherit'
    }
  );
  report.steps.push({ step: 'preview_converted_strict', ok: strictPreviewCode === 0, exitCode: strictPreviewCode });
  report.artifacts.previewConvertedStrictReport = path.relative(rootDir, strictPreviewReportPath);

  if (strictPreviewCode !== 0) {
    report.ok = false;
  }

  await writeJson(outReportPath, report);
  console.log(`E2E report: ${path.relative(rootDir, outReportPath)} (ok=${report.ok})`);
  if (!report.ok) {
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error(err);
  try {
    await fs.mkdir(path.resolve(rootDir, 'tmp/real-samples'), { recursive: true });
  } catch {
    // ignore
  }
  process.exit(1);
});
