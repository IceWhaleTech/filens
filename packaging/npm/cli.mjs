#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { access, mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadOCRModels, requestedSourceCount } from './scripts/download-agent-models.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const { version, name } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const profile = name.endsWith('-lite') ? 'lite' : 'full';
const platform = `${process.platform}-${process.arch}`;
const supported = ['darwin-arm64', 'linux-x64', 'linux-arm64'];
if (!supported.includes(platform)) {
  console.error(`filens: prebuilt packages support ${supported.join(', ')}; current platform is ${platform}`);
  process.exit(1);
}
const cache = path.resolve(process.env.FILENS_CACHE_DIR || path.join(os.homedir(), '.cache', 'filens'), version, platform);
const localRequire = createRequire(import.meta.url);
const cachedRequire = createRequire(path.join(cache, 'package.json'));
const ocrName = `filens-ocr-${platform}`;
function packageRoot(require, dependency) {
  try { return path.dirname(require.resolve(`${dependency}/package.json`)); }
  catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; return undefined; }
}
function findOCR() { return packageRoot(cachedRequire, ocrName) || packageRoot(localRequire, ocrName); }
const args = process.argv.slice(2);
if (args[0] === 'setup-ocr') {
  // Validate arguments before installing or writing anything.
  const options = args.slice(1);
  for (let i = 0; i < options.length; i++) {
    if (options[i] === '--sources') { i++; continue; }
    if (options[i] !== '--refresh') throw new Error(`Unknown setup-ocr option ${options[i]}`);
  }
  const sourceCount = requestedSourceCount(options);
  if (!findOCR()) {
    await mkdir(cache, { recursive: true });
    await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--prefix', cache, '--no-audit', '--no-fund', '--save-exact', process.env.FILENS_OCR_PACKAGE || `${ocrName}@${version}`]);
  }
  if (!findOCR()) throw new Error('OCR package installation did not produce the expected native component');
  // Explicit refreshes use the pinned downloader and a writable cache;
  // normal reads remain entirely offline.
  if (options.includes('--refresh')) await downloadOCRModels(cache, { sourceCount, force: true });
  const installedCore = packageRoot(localRequire, `filens-cli-${platform}`);
  if (!installedCore) throw new Error('Platform CLI is missing; reinstall without --omit=optional');
  const installedOCR = findOCR();
  const modelRoot = options.includes('--refresh') ? cache : installedOCR;
  await new Promise((resolve, reject) => {
    const child = spawn(path.join(installedCore, 'filens'), ['capacity', '--json'], {
      env:{...process.env,FILENS_PROFILE:profile,FILENS_OCR_LIBRARY:path.join(installedOCR,'native',process.platform === 'darwin' ? 'libzima_ncnn_runtime_v7.dylib' : 'libzima_ncnn_runtime_v7.so'),FILENS_OCR_MODEL_DIR:path.join(modelRoot,'models/rapidocr-ncnn')},
      stdio:['ignore','pipe','inherit']
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.once('error', reject);
    child.once('exit', code => {
      try {
        const response = JSON.parse(output);
        if (code !== 0 || !response.capacity?.ocr?.available) throw new Error(response.capacity?.ocr?.error || 'OCR health check failed');
        resolve();
      } catch (error) { reject(error); }
    });
  });
  console.error('RapidOCR NCNN is ready (no Python; max side 960; threads 2).');
  process.exit(0);
}
const core = packageRoot(localRequire, `filens-cli-${platform}`);
if (!core) {
  console.error('filens: platform binary is missing. Reinstall without --omit=optional.');
  process.exit(1);
}
const env = { ...process.env, FILENS_PROFILE: profile };
const ocr = findOCR();
if (ocr) {
  env.FILENS_OCR_LIBRARY ||= path.join(ocr, 'native', process.platform === 'darwin' ? 'libzima_ncnn_runtime_v7.dylib' : 'libzima_ncnn_runtime_v7.so');
  const refreshed = path.join(cache, 'models', 'rapidocr-ncnn');
  let models = path.join(ocr, 'models', 'rapidocr-ncnn');
  try { await access(path.join(refreshed, '.ready.json')); models = refreshed; } catch { /* Packaged models. */ }
  env.FILENS_OCR_MODEL_DIR ||= models;
}
process.exitCode = await run(path.join(core, 'filens'), args, env);

function run(command, argv, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argv, { env, stdio: 'inherit' });
    const signals = ['SIGINT', 'SIGTERM'];
    const handlers = signals.map(signal => { const handler = () => child.kill(signal); process.on(signal, handler); return handler; });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      signals.forEach((s,i) => process.removeListener(s, handlers[i]));
      if (args[0] === 'setup-ocr' && code !== 0) reject(new Error(`${command} failed (${code ?? signal})`));
      else resolve(code ?? (signal === 'SIGINT' ? 130 : 1));
    });
  });
}
