import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReleaseDirectory, assertReleaseArchive } from './agent-release-privacy.mjs';
import { npmInvocation } from './agent-platforms.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'dist/preview-npm');
await mkdir(directory, { recursive:true });
if (!process.argv.includes('--no-build')) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/build-preview.mjs')], {cwd:root, stdio:'inherit'});
  if (result.status !== 0) throw new Error('Preview build failed');
}
await assertReleaseDirectory(path.join(root, 'packages/preview/dist'));
const npm = npmInvocation(['pack', '--workspace', 'filens-preview', '--json', '--ignore-scripts', '--pack-destination', directory]);
const result = spawnSync(npm.command, npm.args, {cwd:root, encoding:'utf8'});
if (result.status !== 0) throw new Error(`Preview npm pack failed: ${result.stderr}`);
const packed = JSON.parse(result.stdout)[0];
const file = path.join(directory, packed.filename);
assertReleaseArchive(file);
const bytes = await readFile(file);
const release = {name:packed.name, version:packed.version, file:packed.filename,
  bytes:packed.size, unpackedBytes:packed.unpackedSize,
  sha256:createHash('sha256').update(bytes).digest('hex'), integrity:packed.integrity,
  files:packed.files.map(({path,size}) => ({path,bytes:size})), privacyChecked:true};
await writeFile(path.join(directory,'release.json'), `${JSON.stringify(release,null,2)}\n`);
console.log(`${release.name}@${release.version}: ${(release.bytes/1048576).toFixed(2)} MiB download, ${(release.unpackedBytes/1048576).toFixed(2)} MiB installed.`);
