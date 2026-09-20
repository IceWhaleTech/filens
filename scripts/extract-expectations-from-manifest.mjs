import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readJson(filePath) {
  let raw = await fs.readFile(filePath, 'utf8');
  raw = raw.replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

async function main() {
  const manifestRel = process.argv[2] || 'tmp/real-samples/real-samples-manifest.json';
  const outRel = process.argv[3] || 'tmp/real-samples/real-samples-expectations.json';

  const manifestPath = path.resolve(rootDir, manifestRel);
  const outPath = path.resolve(rootDir, outRel);

  const manifest = await readJson(manifestPath);
  const samples = Array.isArray(manifest.samples) ? manifest.samples : [];

  const expectations = {
    version: 1,
    generatedAt: new Date().toISOString(),
    manifest: path.relative(rootDir, manifestPath).replace(/\\/g, '/'),
    expectations: []
  };

  for (const s of samples) {
    if (!s || !s.expect) continue;
    expectations.expectations.push({
      id: String(s.id),
      path: String(s.path),
      kind: s.kind,
      expect: s.expect
    });
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(expectations, null, 2), 'utf8');

  console.log(`Wrote ${path.relative(rootDir, outPath)} with ${expectations.expectations.length} expectations.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
