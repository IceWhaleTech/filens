import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const manifestRel = process.argv[2] || 'tmp/real-samples/real-samples-manifest.json';
  const wasmRel = process.argv[3] || 'wasm/converter-core/dist/converter-core.wasm';

  const manifestPath = path.resolve(rootDir, manifestRel);
  const wasmPath = path.resolve(rootDir, wasmRel);
  const reportPath = path.resolve(rootDir, 'tmp/real-samples/conversion-report.json');
  const tmpOutDir = path.resolve(rootDir, 'tmp/real-samples/converted');

  let raw = await fs.readFile(manifestPath, 'utf8');
  raw = raw.replace(/^\uFEFF/, '');
  const manifest = JSON.parse(raw);
  const samples = Array.isArray(manifest.samples) ? manifest.samples : [];

  // Only 'convert' entries.
  const conversions = samples.filter((s) => s && s.kind === 'convert');
  if (!conversions.length) {
    console.log('No convert samples in manifest.');
    return;
  }

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.mkdir(tmpOutDir, { recursive: true });

  const jobs = conversions.map((s) => {
    const srcPath = String(s.path);
    const sourceFormat = String(s.sourceExt || '');
    const targetFormat = String(s.targetExt || '');
    const ext = path.extname(srcPath).slice(1).toLowerCase();
    const outName = `${String(s.id || ext)}.${targetFormat}`;
    const outRel = path.relative(path.resolve(rootDir, 'examples/go-wazero-converter'), path.join(tmpOutDir, outName));

    return {
      inputPath: path.relative(path.resolve(rootDir, 'examples/go-wazero-converter'), path.resolve(rootDir, srcPath)).replace(/\\/g, '/'),
      outputPath: outRel.replace(/\\/g, '/'),
      sourceFormat,
      targetFormat
    };
  });

  const batchManifest = {
    defaults: { locale: 'zh-CN' },
    jobs
  };

  const batchManifestPath = path.resolve(rootDir, 'tmp/real-samples/convert-manifest.json');
  await fs.writeFile(batchManifestPath, JSON.stringify(batchManifest, null, 2), 'utf8');

  console.log(`Running converter-batch for ${jobs.length} jobs...`);

  const exampleDir = path.resolve(rootDir, 'examples/go-wazero-converter');
  const relativeWasm = path.relative(exampleDir, wasmPath);
  const relativeManifest = path.relative(exampleDir, batchManifestPath);
  const relativeReport = path.relative(exampleDir, reportPath);

  const code = await run(process.platform === 'win32' ? 'go.exe' : 'go', [
    'run',
    './cmd/converter-batch',
    '--wasm',
    relativeWasm,
    '--manifest',
    relativeManifest,
    '--report',
    relativeReport
  ], exampleDir);

  process.exit(code);
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        // Avoid locked-down default go build cache locations.
        GOCACHE: path.resolve(rootDir, 'tmp/gocache')
      },
      stdio: 'inherit'
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
