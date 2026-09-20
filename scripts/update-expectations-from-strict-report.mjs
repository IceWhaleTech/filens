import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readJson(filePath) {
  let raw = await fs.readFile(filePath, 'utf8');
  raw = raw.replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function xfailReasonForStrictFailure(errorMessage) {
  const msg = String(errorMessage || '');
  const lower = msg.toLowerCase();
  if (msg.includes('Unsupported preview format')) return 'unsupported_format';
  if (lower.includes('references external resources')) return 'external_resources_required';
  if (lower.includes('dracoloader')) return 'draco_not_available';
  if (lower.includes('invalid xlsx')) return 'known_invalid_fixture';
  if (
    lower.includes('unknown format') ||
    lower.includes('lexing error') ||
    lower.includes('invalid typed array length') ||
    lower.includes('ply header') ||
    lower.includes('cannot read properties of null') ||
    lower.includes('cannot read properties of undefined') ||
    lower.includes('legacy binary') ||
    lower.includes('map is not a function')
  ) {
    return 'loader_limitations';
  }
  return null;
}

async function main() {
  const strictReportRel = process.argv[2] || 'tmp/real-samples/preview-report-strict.json';
  const manifestRel = process.argv[3] || 'tmp/real-samples/real-samples-manifest.json';
  const expectationsRel = process.argv[4] || 'tmp/real-samples/real-samples-expectations.json';

  const strictReportPath = path.resolve(rootDir, strictReportRel);
  const manifestPath = path.resolve(rootDir, manifestRel);
  const expectationsPath = path.resolve(rootDir, expectationsRel);

  const strictReport = await readJson(strictReportPath);
  const manifest = await readJson(manifestPath);
  const samples = Array.isArray(manifest.samples) ? manifest.samples : [];
  const byId = new Map(samples.map((s) => [String(s.id), s]));

  const existing = (await fs.stat(expectationsPath).then(() => true).catch(() => false))
    ? await readJson(expectationsPath)
    : { version: 1, generatedAt: new Date().toISOString(), expectations: [] };

  const expectationList = Array.isArray(existing.expectations) ? existing.expectations : [];
  const byPath = new Map(expectationList.map((e) => [String(e.path), e]));

  let added = 0;
  let updated = 0;

  for (const item of strictReport.items ?? []) {
    if (item.ok) continue;

    const sample = byId.get(String(item.id));
    if (!sample) continue;

    const reason = xfailReasonForStrictFailure(item.error);
    if (!reason) continue;

    const keyPath = String(sample.path);
    const next = {
      id: String(sample.id),
      path: keyPath,
      kind: sample.kind,
      expect: {
        outcome: 'xfail',
        reason
      }
    };

    const prev = byPath.get(keyPath);
    if (!prev) {
      byPath.set(keyPath, next);
      added += 1;
      continue;
    }

    // Keep existing manual edits unless the reason differs.
    const prevReason = prev?.expect?.reason;
    if (prev?.expect?.outcome !== 'xfail' || prevReason !== reason) {
      byPath.set(keyPath, next);
      updated += 1;
    }
  }

  const merged = {
    version: existing.version ?? 1,
    generatedAt: new Date().toISOString(),
    manifest: path.relative(rootDir, manifestPath).replace(/\\/g, '/'),
    expectations: Array.from(byPath.values()).sort((a, b) => String(a.path).localeCompare(String(b.path)))
  };

  await writeJson(expectationsPath, merged);
  console.log(`Updated expectations: +${added}, ~${updated} -> ${path.relative(rootDir, expectationsPath)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
