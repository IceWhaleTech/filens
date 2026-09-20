import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allowedExpectationOutcomes = new Set(['xfail']);
const allowedExpectationReasons = new Set([
  'draco_not_available',
  'external_resources_required',
  'known_invalid_fixture',
  'loader_limitations',
  'unsupported_format'
]);

async function readJson(filePath) {
  let raw = await fs.readFile(filePath, 'utf8');
  raw = raw.replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

async function readJsonIfExists(filePath) {
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
}

function pushDuplicate(map, key, value) {
  const list = map.get(key) || [];
  list.push(value);
  map.set(key, list);
}

function stagedRelativePath(sample) {
  const relPath = String(sample.path || '');
  const ext = path.extname(relPath).slice(1).toLowerCase() || 'bin';
  const id = String(sample.id || path.basename(relPath, path.extname(relPath)));
  return `${ext}/${id}${path.extname(relPath)}`.replace(/\\/g, '/');
}

async function main() {
  const manifestRel = process.argv[2] || 'tmp/real-samples/real-samples-manifest.json';
  const expectationsRel = process.argv[3] || 'tmp/real-samples/real-samples-expectations.json';
  const manifestPath = path.resolve(rootDir, manifestRel);
  const expectationsPath = path.resolve(rootDir, expectationsRel);

  const manifest = await readJson(manifestPath);
  const samples = Array.isArray(manifest.samples) ? manifest.samples : [];
  const expectations = await readJsonIfExists(expectationsPath);

  const checks = {
    total: samples.length,
    exists: 0,
    missing: [],
    invalid: [],
    duplicates: {
      ids: [],
      paths: [],
      stagedPaths: []
    },
    expectations: {
      checked: 0,
      dangling: [],
      invalid: []
    },
    byExt: {}
  };

  const ids = new Map();
  const paths = new Map();
  const stagedPaths = new Map();
  const samplePaths = new Set();

  for (const sample of samples) {
    const relPath = sample.path;
    const id = sample.id;
    if (typeof id !== 'string' || id.trim() === '') {
      checks.invalid.push(`Sample has missing id for path ${String(relPath || '<missing>')}`);
    } else {
      pushDuplicate(ids, id, sample);
    }
    if (typeof relPath !== 'string' || relPath.trim() === '') {
      checks.invalid.push(`Sample ${String(id || '<missing>')} has missing path`);
      continue;
    }

    pushDuplicate(paths, relPath, sample);
    pushDuplicate(stagedPaths, stagedRelativePath(sample), sample);
    samplePaths.add(relPath);

    const abs = path.resolve(rootDir, relPath);
    try {
      const st = await fs.stat(abs);
      if (!st.isFile() || st.size <= 0) {
        checks.missing.push(relPath);
        continue;
      }
      checks.exists += 1;

      const ext = path.extname(relPath).slice(1).toLowerCase() || 'none';
      checks.byExt[ext] = (checks.byExt[ext] || 0) + 1;
    } catch {
      checks.missing.push(relPath);
    }

    const expect = sample.expect;
    if (expect != null) {
      checks.expectations.checked += 1;
      if (!allowedExpectationOutcomes.has(String(expect.outcome || ''))) {
        checks.expectations.invalid.push(`${relPath}: invalid outcome ${String(expect.outcome)}`);
      }
      if (!allowedExpectationReasons.has(String(expect.reason || ''))) {
        checks.expectations.invalid.push(`${relPath}: invalid reason ${String(expect.reason)}`);
      }
    }
  }

  for (const [id, list] of ids) {
    if (list.length > 1) checks.duplicates.ids.push(id);
  }
  for (const [relPath, list] of paths) {
    if (list.length > 1) checks.duplicates.paths.push(relPath);
  }
  for (const [stagedPath, list] of stagedPaths) {
    if (list.length > 1) checks.duplicates.stagedPaths.push(stagedPath);
  }

  if (expectations && Array.isArray(expectations.expectations)) {
    const expectationPaths = new Map();
    for (const entry of expectations.expectations) {
      const relPath = String(entry?.path || '');
      if (!relPath) {
        checks.expectations.invalid.push('Expectation entry has missing path');
        continue;
      }
      pushDuplicate(expectationPaths, relPath, entry);
      if (!samplePaths.has(relPath)) {
        checks.expectations.dangling.push(relPath);
      }
      const expect = entry.expect || {};
      if (!allowedExpectationOutcomes.has(String(expect.outcome || ''))) {
        checks.expectations.invalid.push(`${relPath}: invalid overlay outcome ${String(expect.outcome)}`);
      }
      if (!allowedExpectationReasons.has(String(expect.reason || ''))) {
        checks.expectations.invalid.push(`${relPath}: invalid overlay reason ${String(expect.reason)}`);
      }
    }
    for (const [relPath, list] of expectationPaths) {
      if (list.length > 1) checks.expectations.invalid.push(`${relPath}: duplicate expectation overlay entry`);
    }
  }

  const failureCount =
    checks.missing.length +
    checks.invalid.length +
    checks.duplicates.ids.length +
    checks.duplicates.paths.length +
    checks.duplicates.stagedPaths.length +
    checks.expectations.dangling.length +
    checks.expectations.invalid.length;
  const ok = failureCount === 0;
  console.log(`Manifest verification: ${ok ? 'OK' : 'FAIL'} (${checks.exists}/${checks.total} files, ${checks.expectations.checked} expectations)`);
  if (!ok) {
    printList('Missing/non-empty file failures', checks.missing);
    printList('Invalid samples', checks.invalid);
    printList('Duplicate sample ids', checks.duplicates.ids);
    printList('Duplicate source paths', checks.duplicates.paths);
    printList('Duplicate staged paths', checks.duplicates.stagedPaths);
    printList('Dangling expectation overlay paths', checks.expectations.dangling);
    printList('Invalid expectations', checks.expectations.invalid);
    process.exit(1);
  }

  const extPairs = Object.entries(checks.byExt).sort((a, b) => b[1] - a[1]);
  console.log('Top extensions:');
  for (const [ext, count] of extPairs.slice(0, 15)) {
    console.log(`- ${ext}: ${count}`);
  }
}

function printList(title, items) {
  if (!items.length) return;
  console.log(`${title}:`);
  for (const item of items.slice(0, 50)) console.log(`- ${item}`);
  if (items.length > 50) console.log(`...and ${items.length - 50} more`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
