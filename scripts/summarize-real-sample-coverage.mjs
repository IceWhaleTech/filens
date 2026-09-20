import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectedFamilyForExt } from './_preview-family-map.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readJson(filePath, fallback = null) {
  try {
    let raw = await fs.readFile(filePath, 'utf8');
    raw = raw.replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function extForSample(sample) {
  const fromPath = path.extname(String(sample.path || '')).slice(1).toLowerCase();
  return fromPath || String(sample.sourceExt || sample.kind || 'unknown').toLowerCase();
}

function sourceBucket(samplePath) {
  const normalized = String(samplePath || '').replace(/\\/g, '/');
  const sourceMarker = 'tmp/real-samples/_sources/';
  const markerIndex = normalized.indexOf(sourceMarker);
  if (markerIndex >= 0) {
    const rest = normalized.slice(markerIndex + sourceMarker.length);
    return `upstream:${rest.split('/')[0] || 'unknown'}`;
  }
  if (normalized.startsWith('apps/demo/')) return 'repo:demo';
  if (normalized.startsWith('examples/')) return 'repo:examples';
  if (normalized.startsWith('packages/')) return 'repo:packages';
  return normalized.split('/')[0] || 'unknown';
}

function increment(map, key, amount = 1) {
  map[key] = (map[key] || 0) + amount;
}

function ensureBucket(map, key, initial) {
  if (!map[key]) map[key] = { ...initial };
  return map[key];
}

function strictStateFor(item) {
  if (!item) return 'not_run';
  if (item.ok && item.xpass) return 'xpass';
  if (item.ok) return 'passed';
  if (item.expectedOutcome === 'xfail') return 'xfailed';
  return 'failed';
}

function sortObjectByKey(input) {
  return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)));
}

function sortCounts(input) {
  return Object.fromEntries(
    Object.entries(input).sort(([aKey, aValue], [bKey, bValue]) => bValue - aValue || aKey.localeCompare(bKey))
  );
}

function markdownTable(headers, rows) {
  const header = `| ${headers.join(' | ')} |`;
  const divider = `| ${headers.map(() => '---').join(' | ')} |`;
  return [header, divider, ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n');
}

function writeCoverageMarkdown(summary) {
  const familyRows = Object.entries(summary.byFamily).map(([family, data]) => [
    family,
    String(data.total),
    String(data.extCount),
    String(data.convertCount),
    String(data.strict.passed),
    String(data.strict.xfailed),
    String(data.strict.failed)
  ]);

  const extRows = Object.entries(summary.byExt).map(([ext, data]) => [
    ext,
    data.family || 'unknown',
    String(data.total),
    String(data.convertCount),
    String(data.strict.passed),
    String(data.strict.xfailed),
    String(data.strict.failed)
  ]);

  const sourceRows = Object.entries(summary.bySource)
    .slice(0, 20)
    .map(([source, count]) => [source, String(count)]);

  const lines = [
    '# Real Sample Coverage',
    '',
    `Generated at: ${summary.generatedAt}`,
    '',
    `Total samples: ${summary.total}`,
    `Extensions: ${summary.extensionCount}`,
    `Families: ${summary.familyCount}`,
    `Conversion candidates: ${summary.convertCount}`,
    `Expected xfail: ${summary.expectedXfail}`,
    '',
    '## Strict Preview',
    '',
    `Report: ${summary.strict.report || 'not found'}`,
    `Passed: ${summary.strict.passed}`,
    `Failed: ${summary.strict.failed}`,
    `Xfailed: ${summary.strict.xfailed}`,
    `Xpassed: ${summary.strict.xpassed}`,
    '',
    '## By Family',
    '',
    markdownTable(['Family', 'Samples', 'Extensions', 'Convert', 'Strict Passed', 'Strict Xfailed', 'Strict Failed'], familyRows),
    '',
    '## By Extension',
    '',
    markdownTable(['Ext', 'Family', 'Samples', 'Convert', 'Strict Passed', 'Strict Xfailed', 'Strict Failed'], extRows),
    '',
    '## Top Sources',
    '',
    markdownTable(['Source', 'Samples'], sourceRows),
    ''
  ];

  return `${lines.join('\n')}\n`;
}

async function main() {
  const manifestRel = process.argv[2] || 'tmp/real-samples/real-samples-manifest.json';
  const strictReportRel = process.argv[3] || 'tmp/real-samples/preview-report-strict.json';
  const outJsonRel = process.argv[4] || 'tmp/real-samples/real-samples-coverage.json';
  const outMdRel = process.argv[5] || 'tmp/real-samples/real-samples-coverage.md';

  const manifestPath = path.resolve(rootDir, manifestRel);
  const strictReportPath = path.resolve(rootDir, strictReportRel);
  const outJsonPath = path.resolve(rootDir, outJsonRel);
  const outMdPath = path.resolve(rootDir, outMdRel);

  const manifest = await readJson(manifestPath);
  if (!manifest || !Array.isArray(manifest.samples)) {
    throw new Error(`Manifest not found or invalid: ${path.relative(rootDir, manifestPath)}`);
  }

  const strictReport = await readJson(strictReportPath, { items: [] });
  const strictById = new Map((strictReport.items || []).map((item) => [String(item.id), item]));

  const byExt = {};
  const byFamily = {};
  const bySource = {};
  const byTag = {};
  let convertCount = 0;
  let expectedXfail = 0;

  const strictTotals = {
    passed: 0,
    failed: 0,
    xfailed: 0,
    xpassed: 0,
    notRun: 0
  };

  for (const sample of manifest.samples) {
    const ext = extForSample(sample);
    const family = expectedFamilyForExt(ext) || 'unknown';
    const source = sourceBucket(sample.path);
    const isConvert = sample.kind === 'convert' || Boolean(sample.targetExt);
    const isXfail = sample?.expect?.outcome === 'xfail';
    const strictItem = strictById.get(String(sample.id));
    const strictState = strictStateFor(strictItem);

    if (isConvert) convertCount += 1;
    if (isXfail) expectedXfail += 1;
    increment(bySource, source);
    for (const tag of sample.tags || []) increment(byTag, tag);

    const extBucket = ensureBucket(byExt, ext, {
      family,
      total: 0,
      convertCount: 0,
      expectedXfail: 0,
      strict: { passed: 0, failed: 0, xfailed: 0, xpassed: 0, notRun: 0 }
    });
    extBucket.total += 1;
    if (isConvert) extBucket.convertCount += 1;
    if (isXfail) extBucket.expectedXfail += 1;
    extBucket.strict[strictState === 'not_run' ? 'notRun' : strictState] += 1;

    const familyBucket = ensureBucket(byFamily, family, {
      total: 0,
      extensions: {},
      extCount: 0,
      convertCount: 0,
      expectedXfail: 0,
      strict: { passed: 0, failed: 0, xfailed: 0, xpassed: 0, notRun: 0 }
    });
    familyBucket.total += 1;
    familyBucket.extensions[ext] = true;
    if (isConvert) familyBucket.convertCount += 1;
    if (isXfail) familyBucket.expectedXfail += 1;
    familyBucket.strict[strictState === 'not_run' ? 'notRun' : strictState] += 1;

    strictTotals[strictState === 'not_run' ? 'notRun' : strictState] += 1;
  }

  for (const data of Object.values(byFamily)) {
    data.extCount = Object.keys(data.extensions).length;
    data.extensions = Object.keys(data.extensions).sort();
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    manifest: path.relative(rootDir, manifestPath).replace(/\\/g, '/'),
    total: manifest.samples.length,
    extensionCount: Object.keys(byExt).length,
    familyCount: Object.keys(byFamily).length,
    convertCount,
    expectedXfail,
    strict: {
      report: strictReport ? path.relative(rootDir, strictReportPath).replace(/\\/g, '/') : null,
      ok: strictReport?.ok ?? null,
      ...strictTotals
    },
    byFamily: sortObjectByKey(byFamily),
    byExt: sortObjectByKey(byExt),
    bySource: sortCounts(bySource),
    byTag: sortCounts(byTag)
  };

  await fs.mkdir(path.dirname(outJsonPath), { recursive: true });
  await fs.writeFile(outJsonPath, JSON.stringify(summary, null, 2), 'utf8');
  await fs.writeFile(outMdPath, writeCoverageMarkdown(summary), 'utf8');

  console.log(`Coverage JSON: ${path.relative(rootDir, outJsonPath)}`);
  console.log(`Coverage Markdown: ${path.relative(rootDir, outMdPath)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
