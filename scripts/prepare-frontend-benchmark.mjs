import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = path.join(repo, 'benchmarks/frontend');
const work = path.join(repo, 'tmp/performance-sota');
await fs.mkdir(path.join(work, 'samples'), { recursive: true });
for (const name of ['package.json', 'package-lock.json', 'external-samples.json']) await fs.copyFile(path.join(config, name), path.join(work, name));
await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--prefix', work, '--ignore-scripts', '--no-audit', '--no-fund']);
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const download = async url => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  return new Uint8Array(await response.arrayBuffer());
};
const sheetjs = path.join(work, 'xlsx-0.20.3.full.min.js');
const sheetjsHash = 'cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41';
if (await fs.readFile(sheetjs).then(bytes => sha256(bytes) !== sheetjsHash, () => true)) {
  const tar = await download('https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz');
  if (sha256(tar) !== '8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8') throw new Error('SheetJS archive checksum mismatch');
  await fs.writeFile(path.join(work, 'xlsx-0.20.3.tgz'), tar);
  const extracted = await run('tar', ['-xOzf', path.join(work, 'xlsx-0.20.3.tgz'), 'package/dist/xlsx.full.min.js'], true);
  if (sha256(extracted) !== sheetjsHash) throw new Error('SheetJS script checksum mismatch');
  await fs.writeFile(sheetjs, extracted);
}
const samples = JSON.parse(await fs.readFile(path.join(config, 'external-samples.json'), 'utf8'));
const gitBlobSha = bytes => crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
for (const sample of samples) {
  const target = path.join(work, 'samples', sample.name);
  if (await fs.readFile(target).then(bytes => gitBlobSha(bytes) === sample.gitBlobSha, () => false)) continue;
  const response = await fetch(`https://api.github.com/repos/apache/poi/git/blobs/${sample.gitBlobSha}`);
  if (!response.ok) throw new Error(`Could not fetch Apache POI sample: ${sample.name} (${response.status})`);
  const metadata = await response.json();
  const bytes = Buffer.from(metadata.content, 'base64');
  if (gitBlobSha(bytes) !== sample.gitBlobSha) throw new Error(`Apache POI sample checksum mismatch: ${sample.name}`);
  await fs.writeFile(target, bytes);
}
console.log('Pinned frontend benchmark dependencies and samples are ready.');

function run(command, args, capture = false) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const child = spawn(command, args, { cwd: repo, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
    if (capture) child.stdout.on('data', chunk => chunks.push(chunk));
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`${command} exited with ${code}`)));
  });
}
