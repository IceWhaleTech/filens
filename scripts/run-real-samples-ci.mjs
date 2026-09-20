import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nodeBin = process.platform === 'win32' ? 'node.exe' : 'node';

function parseArgs(args) {
  const options = {
    dryRun: false,
    skipGenerate: false,
    skipStrict: false,
    skipE2e: false,
    manifest: 'tmp/real-samples/real-samples-manifest.json',
    stagingDir: 'tmp/real-samples/selected-auto2',
    strictReport: 'tmp/real-samples/preview-report-strict.json',
    coverageJson: 'tmp/real-samples/real-samples-coverage.json',
    coverageMarkdown: 'tmp/real-samples/real-samples-coverage.md',
    report: 'tmp/real-samples/real-samples-ci-report.json'
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--skip-generate':
        options.skipGenerate = true;
        break;
      case '--skip-strict':
        options.skipStrict = true;
        break;
      case '--skip-e2e':
        options.skipE2e = true;
        break;
      case '--manifest':
        options.manifest = next;
        i += 1;
        break;
      case '--staging-dir':
        options.stagingDir = next;
        i += 1;
        break;
      case '--strict-report':
        options.strictReport = next;
        i += 1;
        break;
      case '--coverage-json':
        options.coverageJson = next;
        i += 1;
        break;
      case '--coverage-md':
        options.coverageMarkdown = next;
        i += 1;
        break;
      case '--report':
        options.report = next;
        i += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function commandLine(command, args) {
  return [command, ...args].join(' ');
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function runStep(report, options, step) {
  const startedAt = new Date().toISOString();
  const display = commandLine(step.command, step.args);
  console.log(`[real-samples-ci] ${options.dryRun ? 'dry-run ' : ''}${step.name}: ${display}`);

  if (options.dryRun) {
    report.steps.push({ step: step.name, ok: true, dryRun: true, command: display, startedAt, finishedAt: new Date().toISOString() });
    return true;
  }

  const exitCode = await run(step.command, step.args, {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit'
  });
  const ok = exitCode === 0;
  report.steps.push({ step: step.name, ok, exitCode, command: display, startedAt, finishedAt: new Date().toISOString() });
  return ok;
}

function buildSteps(options) {
  const steps = [];
  if (!options.skipGenerate) {
    steps.push({
      name: 'generate_manifest',
      command: nodeBin,
      args: ['./scripts/generate-real-samples-manifest.mjs', options.manifest]
    });
  }

  steps.push(
    {
      name: 'verify_manifest',
      command: nodeBin,
      args: ['./scripts/verify-real-samples.mjs', options.manifest]
    },
    {
      name: 'stage_samples',
      command: nodeBin,
      args: ['./scripts/stage-real-samples.mjs', options.manifest, options.stagingDir]
    }
  );

  if (!options.skipStrict) {
    steps.push({
      name: 'preview_strict',
      command: nodeBin,
      args: ['./scripts/run-real-sample-preview-strict.mjs', options.manifest, options.stagingDir, options.strictReport]
    });
  }

  steps.push(
    {
      name: 'summarize_coverage',
      command: nodeBin,
      args: ['./scripts/summarize-real-sample-coverage.mjs', options.manifest, options.strictReport, options.coverageJson, options.coverageMarkdown]
    },
    {
      name: 'verify_coverage',
      command: nodeBin,
      args: ['./scripts/verify-real-sample-coverage.mjs', '--coverage', options.coverageJson]
    }
  );

  if (!options.skipE2e) {
    steps.push({
      name: 'e2e_converted_outputs',
      command: nodeBin,
      args: ['./scripts/run-real-samples-e2e.mjs', options.manifest]
    });
  }

  return steps;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const reportPath = path.resolve(rootDir, options.report);
  const report = {
    ok: true,
    dryRun: options.dryRun,
    generatedAt: new Date().toISOString(),
    options,
    steps: []
  };

  for (const step of buildSteps(options)) {
    const ok = await runStep(report, options, step);
    if (!ok) {
      report.ok = false;
      await writeJson(reportPath, report);
      console.log(`Real samples CI report: ${path.relative(rootDir, reportPath)} (ok=false)`);
      process.exit(1);
    }
  }

  await writeJson(reportPath, report);
  console.log(`Real samples CI report: ${path.relative(rootDir, reportPath)} (ok=true)`);
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
