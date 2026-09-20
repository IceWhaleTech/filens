import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const defaultThresholds = {
  minSamples: 150,
  minExtensions: 35,
  minFamilies: 7,
  minConvert: 18,
  allowXpass: false,
  allowNotRun: false,
  requireStrictOk: true
};

function parseArgs(args) {
  const options = {
    coverageRel: 'tmp/real-samples/real-samples-coverage.json',
    ...defaultThresholds
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case '--coverage':
        options.coverageRel = next;
        i += 1;
        break;
      case '--min-samples':
        options.minSamples = Number(next);
        i += 1;
        break;
      case '--min-extensions':
        options.minExtensions = Number(next);
        i += 1;
        break;
      case '--min-families':
        options.minFamilies = Number(next);
        i += 1;
        break;
      case '--min-convert':
        options.minConvert = Number(next);
        i += 1;
        break;
      case '--allow-xpass':
        options.allowXpass = true;
        break;
      case '--allow-not-run':
        options.allowNotRun = true;
        break;
      case '--no-strict-ok':
        options.requireStrictOk = false;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function checkNumber(name, actual, min, failures) {
  if (!Number.isFinite(actual)) {
    failures.push(`${name} is not a finite number`);
    return;
  }
  if (actual < min) {
    failures.push(`${name} ${actual} is below minimum ${min}`);
  }
}

function formatStrict(strict) {
  return [
    `ok=${strict?.ok}`,
    `passed=${strict?.passed ?? 0}`,
    `failed=${strict?.failed ?? 0}`,
    `xfailed=${strict?.xfailed ?? 0}`,
    `xpassed=${strict?.xpassed ?? 0}`,
    `notRun=${strict?.notRun ?? 0}`
  ].join(', ');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const coveragePath = path.resolve(rootDir, options.coverageRel);
  const coverage = JSON.parse((await fs.readFile(coveragePath, 'utf8')).replace(/^\uFEFF/, ''));

  const failures = [];
  checkNumber('total samples', coverage.total, options.minSamples, failures);
  checkNumber('extension count', coverage.extensionCount, options.minExtensions, failures);
  checkNumber('family count', coverage.familyCount, options.minFamilies, failures);
  checkNumber('conversion candidate count', coverage.convertCount, options.minConvert, failures);

  const strict = coverage.strict || {};
  if (options.requireStrictOk && strict.ok !== true) {
    failures.push(`strict preview is not ok (${formatStrict(strict)})`);
  }
  if ((strict.failed || 0) > 0) {
    failures.push(`strict preview has ${strict.failed} unexpected failure(s)`);
  }
  if (!options.allowXpass && (strict.xpassed || 0) > 0) {
    failures.push(`strict preview has ${strict.xpassed} xpass item(s); update expectations`);
  }
  if (!options.allowNotRun && (strict.notRun || 0) > 0) {
    failures.push(`strict preview has ${strict.notRun} sample(s) not run`);
  }

  if (failures.length) {
    console.error(`Coverage gate failed for ${path.relative(rootDir, coveragePath)}:`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log(
    [
      `Coverage gate OK: ${path.relative(rootDir, coveragePath)}`,
      `samples=${coverage.total}`,
      `extensions=${coverage.extensionCount}`,
      `families=${coverage.familyCount}`,
      `convert=${coverage.convertCount}`,
      `strict=(${formatStrict(strict)})`
    ].join(' ')
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
