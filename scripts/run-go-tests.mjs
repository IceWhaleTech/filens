import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const moduleDirs = process.argv.slice(2);

if (moduleDirs.length === 0) {
  console.error('Usage: node ./scripts/run-go-tests.mjs <module-dir> [...module-dir]');
  process.exit(1);
}

const command = process.platform === 'win32' ? 'go.exe' : 'go';

for (const moduleDir of moduleDirs) {
  const cwd = path.resolve(rootDir, moduleDir);
  const label = path.relative(rootDir, cwd) || '.';
  console.log(`Running Go tests in ${label}`);

  const packages = await listTestPackages(command, cwd);
  if (packages.length === 0) {
    console.log(`No Go packages found in ${label}`);
    continue;
  }

  const exitCode = await run(command, ['test', ...packages, '-count=1'], cwd);
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

async function listTestPackages(command, cwd) {
  const { code, stdout, stderr } = await capture(command, ['list', '-e', '-f', '{{.ImportPath}}\t{{.Dir}}\t{{if .Error}}{{.Error.Err}}{{end}}', './...'], cwd);
  if (code !== 0) {
    process.stderr.write(stderr);
    process.exit(code);
  }

  const packages = [];
  const cwdNormalized = normalizePath(cwd);
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [importPath, dir = '', error = ''] = line.split('\t');
    const dirNormalized = normalizePath(dir);
    const rel = path.relative(cwd, dir).split(path.sep).join('/');
    if (rel === 'fixtures' || rel.startsWith('fixtures/')) {
      continue;
    }
    if (dirNormalized.includes('/fixtures/')) {
      continue;
    }
    if (error.trim()) {
      process.stderr.write(`${importPath}: ${error}\n`);
      process.exit(1);
    }
    if (dirNormalized === cwdNormalized) {
      packages.push('.');
    } else {
      packages.push(`./${rel}`);
    }
  }
  return packages;
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: 'inherit'
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

function capture(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function normalizePath(value) {
  return path.resolve(value).split(path.sep).join('/');
}
