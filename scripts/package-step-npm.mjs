import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReleaseArchive, assertReleaseDirectory } from './agent-release-privacy.mjs';
import { npmInvocation } from './agent-platforms.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'dist/step-npm');
await mkdir(directory, { recursive: true });
await assertReleaseDirectory(path.join(root, 'packages/step/dist'));
const npm = npmInvocation(['pack', '--workspace', 'filens-step', '--json', '--ignore-scripts', '--pack-destination', directory]);
const result = spawnSync(npm.command, npm.args, { cwd: root, encoding: 'utf8' });
if (result.status !== 0) throw new Error(`STEP npm pack failed: ${result.stderr}`);
const packed = JSON.parse(result.stdout)[0];
const file = path.join(directory, packed.filename);
assertReleaseArchive(file);
const bytes = await readFile(file);
const release = {
  name: packed.name, version: packed.version, distTag: 'next', published: false,
  publication: 'deferred at user request; waiting for other changes', file: packed.filename,
  bytes: packed.size, unpackedBytes: packed.unpackedSize,
  sha256: createHash('sha256').update(bytes).digest('hex'), integrity: packed.integrity,
  files: packed.files.map(({ path, size }) => ({ path, bytes: size })), privacyChecked: true
};
await writeFile(path.join(directory, 'release.json'), JSON.stringify(release, null, 2) + '\n');
console.log(`${packed.name}@${packed.version}: ${packed.size} bytes compressed, ${packed.unpackedSize} bytes unpacked. Not published.`);
