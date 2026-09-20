import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectedFamilyForExt } from './_preview-family-map.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultRoots = [
  'apps/demo/public/samples',
  'examples/go-wazero-converter/fixtures',
  'tmp/real-samples/_sources'
];

function parseArgs(args) {
  const positional = [];
  const options = {
    allExtensions: false
  };

  for (const arg of args) {
    if (arg === '--all-extensions') {
      options.allExtensions = true;
    } else {
      positional.push(arg);
    }
  }

  return {
    manifestRel: positional[0] || 'tmp/real-samples/real-samples-manifest.json',
    outJsonRel: positional[1] || 'tmp/real-samples/real-samples-candidates.json',
    outMdRel: positional[2] || 'tmp/real-samples/real-samples-candidates.md',
    ...options
  };
}

async function readJson(filePath) {
  let raw = await fs.readFile(filePath, 'utf8');
  raw = raw.replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

async function statSafe(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

function normalizeRel(filePath) {
  return path.relative(rootDir, filePath).replace(/\\/g, '/');
}

function sourceBucket(relPath) {
  const normalized = String(relPath || '').replace(/\\/g, '/');
  const marker = 'tmp/real-samples/_sources/';
  if (normalized.startsWith(marker)) {
    return `upstream:${normalized.slice(marker.length).split('/')[0] || 'unknown'}`;
  }
  if (normalized.startsWith('apps/demo/')) return 'repo:demo';
  if (normalized.startsWith('examples/')) return 'repo:examples';
  return normalized.split('/')[0] || 'unknown';
}

function increment(map, key, amount = 1) {
  map[key] = (map[key] || 0) + amount;
}

function ensureExt(map, ext) {
  if (!map[ext]) {
    map[ext] = {
      family: expectedFamilyForExt(ext) || 'unknown',
      available: 0,
      selected: 0,
      unselected: 0,
      bytes: 0,
      sources: {},
      examples: []
    };
  }
  return map[ext];
}

async function listCandidateFiles(rootRel) {
  const rootPath = path.resolve(rootDir, rootRel);
  const rootStat = await statSafe(rootPath);
  if (!rootStat?.isDirectory()) return [];

  const results = [];
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        await walk(next);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).slice(1).toLowerCase();
      if (!ext) continue;
      const st = await statSafe(next);
      if (!st?.isFile() || st.size <= 0) continue;
      results.push({
        path: normalizeRel(next),
        ext,
        size: st.size,
        source: sourceBucket(normalizeRel(next))
      });
    }
  }

  await walk(rootPath);
  return results;
}

function sortCounts(input) {
  return Object.fromEntries(
    Object.entries(input).sort(([aKey, aValue], [bKey, bValue]) => bValue - aValue || aKey.localeCompare(bKey))
  );
}

function sortExtBuckets(input) {
  return Object.entries(input)
    .map(([ext, data]) => ({
      ext,
      ...data,
      sources: sortCounts(data.sources),
      examples: data.examples.slice(0, 12)
    }))
    .sort((a, b) => b.available - a.available || a.ext.localeCompare(b.ext));
}

function markdownTable(headers, rows) {
  const header = `| ${headers.join(' | ')} |`;
  const divider = `| ${headers.map(() => '---').join(' | ')} |`;
  return [header, divider, ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n');
}

function writeMarkdown(summary) {
  const extRows = summary.extensions
    .slice(0, 60)
    .map((data) => [
      data.ext,
      data.family,
      String(data.available),
      String(data.selected),
      String(data.unselected),
      Object.entries(data.sources)
        .slice(0, 3)
        .map(([source, count]) => `${source} (${count})`)
        .join('<br>')
    ]);

  const sourceRows = Object.entries(summary.bySource).map(([source, count]) => [source, String(count)]);
  const familyRows = Object.entries(summary.byFamily).map(([family, data]) => [
    family,
    String(data.available),
    String(data.selected),
    String(data.unselected)
  ]);

  return `${[
    '# Real Sample Candidate Audit',
    '',
    `Generated at: ${summary.generatedAt}`,
    '',
    `Candidate files: ${summary.totalCandidates}`,
    `Selected candidates: ${summary.selectedCandidates}`,
    `Unselected candidates: ${summary.unselectedCandidates}`,
    `Extensions: ${summary.extensionCount}`,
    '',
    '## By Family',
    '',
    markdownTable(['Family', 'Available', 'Selected', 'Unselected'], familyRows),
    '',
    '## By Extension',
    '',
    markdownTable(['Ext', 'Family', 'Available', 'Selected', 'Unselected', 'Top Sources'], extRows),
    '',
    '## By Source',
    '',
    markdownTable(['Source', 'Candidate Files'], sourceRows),
    ''
  ].join('\n')}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { manifestRel, outJsonRel, outMdRel } = options;

  const manifestPath = path.resolve(rootDir, manifestRel);
  const outJsonPath = path.resolve(rootDir, outJsonRel);
  const outMdPath = path.resolve(rootDir, outMdRel);

  const manifest = await readJson(manifestPath);
  const selectedPaths = new Set((manifest.samples || []).map((sample) => String(sample.path || '').replace(/\\/g, '/')));
  const selectedExts = new Set(
    (manifest.samples || [])
      .map((sample) => path.extname(String(sample.path || '')).slice(1).toLowerCase())
      .filter(Boolean)
  );
  const candidates = [];
  for (const root of defaultRoots) {
    const rootCandidates = await listCandidateFiles(root);
    candidates.push(
      ...rootCandidates.filter((candidate) => {
        if (options.allExtensions) return true;
        return Boolean(expectedFamilyForExt(candidate.ext)) || selectedExts.has(candidate.ext);
      })
    );
  }

  const byExt = {};
  const bySource = {};
  const byFamily = {};
  let selectedCandidates = 0;
  let unselectedCandidates = 0;

  for (const candidate of candidates) {
    const selected = selectedPaths.has(candidate.path);
    if (selected) selectedCandidates += 1;
    else unselectedCandidates += 1;

    const extBucket = ensureExt(byExt, candidate.ext);
    extBucket.available += 1;
    extBucket.bytes += candidate.size;
    if (selected) extBucket.selected += 1;
    else {
      extBucket.unselected += 1;
      extBucket.examples.push(candidate.path);
    }
    increment(extBucket.sources, candidate.source);
    increment(bySource, candidate.source);

    const family = extBucket.family;
    if (!byFamily[family]) byFamily[family] = { available: 0, selected: 0, unselected: 0 };
    byFamily[family].available += 1;
    if (selected) byFamily[family].selected += 1;
    else byFamily[family].unselected += 1;
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    manifest: path.relative(rootDir, manifestPath).replace(/\\/g, '/'),
    roots: defaultRoots,
    totalCandidates: candidates.length,
    selectedCandidates,
    unselectedCandidates,
    extensionCount: Object.keys(byExt).length,
    allExtensions: options.allExtensions,
    byFamily: Object.fromEntries(Object.entries(byFamily).sort(([a], [b]) => a.localeCompare(b))),
    extensions: sortExtBuckets(byExt),
    byExt: Object.fromEntries(sortExtBuckets(byExt).map((entry) => [entry.ext, entry])),
    bySource: sortCounts(bySource)
  };

  await fs.mkdir(path.dirname(outJsonPath), { recursive: true });
  await fs.writeFile(outJsonPath, JSON.stringify(summary, null, 2), 'utf8');
  await fs.writeFile(outMdPath, writeMarkdown(summary), 'utf8');

  console.log(`Candidate audit JSON: ${path.relative(rootDir, outJsonPath)}`);
  console.log(`Candidate audit Markdown: ${path.relative(rootDir, outMdPath)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
