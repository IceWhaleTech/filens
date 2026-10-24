import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const directory = args.includes('--output') ? args[args.indexOf('--output') + 1] : 'tmp/continued-review/diagram-inputs';
const base = 'https://raw.githubusercontent.com/LibreOffice/libvisio/81bf0a433c276d8ee9befd522f0242cf95beeb7d/src/test/data/';
const samples = [
  { name: 'blue-box.vsdx', nodeCount: 1, sha256: '6c67a8b3ccd2b81b3d9d41b74aa0ef5f31b506a714b761b4b4fb4c76ebeb7a94' },
  { name: 'color-boxes.vsdx', nodeCount: 7, sha256: '75072b91b5c3023eeea25d2480776e5a1ee8c336ca263adf3a6440e25f35f800' },
  { name: 'testfile1.vsdx', nodeCount: 12, sha256: '2ebcf3e9ce4a599c749e5dc7d31030ef4d7d8b69dfbd2565b59b854133cdeec8' }
];
await fs.mkdir(path.resolve(root, directory), { recursive: true });
const records = [];
for (const sample of samples) {
  const file = path.join(directory, sample.name), url = base + sample.name;
  let bytes;
  try { bytes = await fs.readFile(path.resolve(root, file)); }
  catch {
    const response = await fetch(url); assert(response.ok, `${response.status} ${url}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), sample.sha256, sample.name);
  await fs.writeFile(path.resolve(root, file), bytes);
  records.push({ ...sample, url, path: file, bytes: bytes.length });
}
await fs.writeFile(path.resolve(root, directory, 'sources.json'), JSON.stringify(records, null, 2) + '\n');
console.log(`Prepared ${records.length} pinned libvisio samples in ${directory}.`);
