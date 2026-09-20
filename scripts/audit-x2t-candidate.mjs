import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseArgs(args) {
  const options = {
    candidate: '',
    outDir: 'tmp/x2t-candidate-audit',
    strict: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    switch (arg) {
      case '--candidate':
        options.candidate = next ?? '';
        index += 1;
        break;
      case '--out':
        options.outDir = next ?? '';
        index += 1;
        break;
      case '--strict':
        options.strict = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.candidate) {
    throw new Error('Missing --candidate <path>.');
  }
  if (!options.outDir) {
    throw new Error('Missing --out <path>.');
  }
  return options;
}

function printHelp() {
  console.log(`Usage:
  node ./scripts/audit-x2t-candidate.mjs --candidate <path> [--out tmp/x2t-candidate-audit]

This static audit does not execute third-party code. It checks whether a local
ONLYOFFICE x2t WASM candidate looks like a pure WASI module, an Emscripten
browser bundle, or neither. Use --strict to exit non-zero when blocked.`);
}

async function statSafe(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return undefined;
  }
}

async function listFilesRecursive(dir, limit = 5000) {
  const files = [];
  async function walk(current) {
    if (files.length >= limit) return;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= limit) return;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (['.git', 'node_modules', 'tmp', 'dist/.cache'].includes(entry.name)) continue;
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }
  await walk(dir);
  return files;
}

async function readPrefix(filePath, length) {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function readTextMaybe(filePath, maxBytes = 256 * 1024) {
  const stat = await statSafe(filePath);
  if (!stat || stat.size > maxBytes) return '';
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

function isWasmMagic(prefix) {
  return prefix.length >= 4 && prefix[0] === 0x00 && prefix[1] === 0x61 && prefix[2] === 0x73 && prefix[3] === 0x6d;
}

async function classifyWasm(filePath, baseDir = rootDir) {
  const prefix = await readPrefix(filePath, 512 * 1024);
  const text = prefix.toString('latin1');
  const importsWASI = text.includes('wasi_snapshot_preview1') || text.includes('wasi:');
  const mentionsEmscripten = text.includes('emscripten') || text.includes('Emscripten') || text.includes('__indirect_function_table');
  const hasStart = text.includes('_start');
  return {
    path: displayPath(filePath, baseDir),
    bytes: (await fs.stat(filePath)).size,
    importsWASI,
    mentionsEmscripten,
    hasStart
  };
}

export async function summarizeCandidate(candidatePath, options = {}) {
  const baseDir = options.rootDir ?? rootDir;
  const resolved = path.resolve(baseDir, candidatePath);
  const stat = await statSafe(resolved);
  if (!stat) {
    throw new Error(`Candidate path does not exist: ${resolved}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Candidate path must be a directory: ${resolved}`);
  }

  const files = await listFilesRecursive(resolved);
  const wasmFiles = [];
  const jsFiles = [];
  const licenseFiles = [];
  const readmeFiles = [];
  const packageFiles = [];

  for (const file of files) {
    const lower = path.basename(file).toLowerCase();
    if (lower.endsWith('.wasm')) wasmFiles.push(file);
    if (lower.endsWith('.js') || lower.endsWith('.mjs')) jsFiles.push(file);
    if (lower === 'license' || lower.startsWith('license.') || lower === 'copying') licenseFiles.push(file);
    if (lower === 'readme' || lower.startsWith('readme.')) readmeFiles.push(file);
    if (lower === 'package.json') packageFiles.push(file);
  }

  const wasm = [];
  for (const file of wasmFiles) {
    const prefix = await readPrefix(file, 4);
    if (isWasmMagic(prefix)) {
      wasm.push(await classifyWasm(file, baseDir));
    }
  }

  const jsHints = [];
  for (const file of jsFiles.slice(0, 20)) {
    const text = await readTextMaybe(file);
    const hints = [];
    if (text.includes('FS.') || text.includes('FS_createDataFile')) hints.push('Emscripten FS');
    if (text.includes('ccall') || text.includes('cwrap')) hints.push('ccall/cwrap');
    if (text.includes('main1')) hints.push('main1');
    if (text.includes('wasmBinary')) hints.push('wasmBinary');
    if (hints.length && text.includes('Module')) hints.push('Module');
    if (hints.length) {
      jsHints.push({
        path: displayPath(file, baseDir),
        hints
      });
    }
  }

  const manifestPath = options.manifestPath ?? path.join(rootDir, 'wasm/converter-core/manifest/conversions.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const totalWasmBytes = wasm.reduce((sum, item) => sum + item.bytes, 0);
  const hasWASI = wasm.some((item) => item.importsWASI && item.hasStart);
  const hasEmscripten = wasm.some((item) => item.mentionsEmscripten) || jsHints.length > 0;
  const wazeroEligible = hasWASI && !hasEmscripten;
  const browserAdapterCandidate = hasEmscripten && wasm.length > 0;
  const blockedReasons = [];

  if (!wasm.length) blockedReasons.push('no valid .wasm files found');
  if (!licenseFiles.length) blockedReasons.push('no license file found in candidate directory');
  if (!wazeroEligible) blockedReasons.push('candidate is not a clear pure WASI _start module for wazero');
  if (browserAdapterCandidate) blockedReasons.push('candidate appears to need JavaScript/Emscripten glue; keep it out of Go/wazero wrapper');

  return {
    candidatePath: displayPath(resolved, baseDir),
    generatedAt: new Date().toISOString(),
    fileCount: files.length,
    wasmFiles: wasm,
    jsGlueHints: jsHints,
    licenseFiles: licenseFiles.map((file) => displayPath(file, baseDir)),
    readmeFiles: readmeFiles.map((file) => displayPath(file, baseDir)),
    packageFiles: packageFiles.map((file) => displayPath(file, baseDir)),
    totalWasmBytes,
    allowedDefaultConversions: manifest,
    gates: {
      boundaryGate: true,
      wazeroEligible,
      browserAdapterCandidate,
      blocked: blockedReasons.length > 0,
      blockedReasons
    }
  };
}

export function displayPath(filePath, baseDir = rootDir) {
  return path.relative(baseDir, filePath) || '.';
}

export function renderMarkdown(report) {
  const lines = [];
  lines.push('# x2t WASM Candidate Audit');
  lines.push('');
  lines.push(`- candidate: \`${report.candidatePath}\``);
  lines.push(`- generated: \`${report.generatedAt}\``);
  lines.push(`- files scanned: ${report.fileCount}`);
  lines.push(`- wasm files: ${report.wasmFiles.length}`);
  lines.push(`- total wasm bytes: ${report.totalWasmBytes}`);
  lines.push(`- wazero eligible: ${report.gates.wazeroEligible ? 'yes' : 'no'}`);
  lines.push(`- browser adapter candidate: ${report.gates.browserAdapterCandidate ? 'yes' : 'no'}`);
  lines.push(`- blocked: ${report.gates.blocked ? 'yes' : 'no'}`);
  lines.push('');

  if (report.gates.blockedReasons.length) {
    lines.push('## Blocked Reasons');
    lines.push('');
    for (const reason of report.gates.blockedReasons) {
      lines.push(`- ${reason}`);
    }
    lines.push('');
  }

  lines.push('## WASM Files');
  lines.push('');
  if (!report.wasmFiles.length) {
    lines.push('- none');
  } else {
    for (const item of report.wasmFiles) {
      lines.push(
        `- \`${item.path}\`: ${item.bytes} bytes, wasi=${item.importsWASI}, emscripten=${item.mentionsEmscripten}, start=${item.hasStart}`
      );
    }
  }
  lines.push('');

  lines.push('## JavaScript Glue Hints');
  lines.push('');
  if (!report.jsGlueHints.length) {
    lines.push('- none');
  } else {
    for (const item of report.jsGlueHints) {
      lines.push(`- \`${item.path}\`: ${item.hints.join(', ')}`);
    }
  }
  lines.push('');

  lines.push('## Default Conversion Boundary');
  lines.push('');
  for (const pair of report.allowedDefaultConversions) {
    lines.push(`- ${pair.sourceFormat} -> ${pair.targetFormat}`);
  }
  lines.push('');
  lines.push('No integration should expose conversions outside this manifest by default.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await summarizeCandidate(options.candidate);
  const outDir = path.resolve(rootDir, options.outDir);
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(path.join(outDir, 'report.md'), renderMarkdown(report));

  const status = report.gates.blocked ? 'blocked' : 'ok';
  console.log(`x2t candidate audit ${status}: ${path.relative(rootDir, outDir)}`);
  if (report.gates.blockedReasons.length) {
    for (const reason of report.gates.blockedReasons) console.log(`- ${reason}`);
  }
  if (options.strict && report.gates.blocked) {
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
