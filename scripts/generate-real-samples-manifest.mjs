import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function statSafe(p) {
  try {
    return await fs.stat(p);
  } catch {
    return null;
  }
}

async function listFiles(dir, exts, options = {}) {
  const { maxPerExt = 0, includePatterns = [], excludePatterns = [] } = options;
  const results = [];

  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(next);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!exts.includes(ext)) continue;
        const rel = path.relative(rootDir, next).replace(/\\/g, '/');
        if (includePatterns.length && !includePatterns.some((re) => re.test(rel))) continue;
        if (excludePatterns.length && excludePatterns.some((re) => re.test(rel))) continue;
        const st = await statSafe(next);
        if (!st) continue;
        results.push({ rel, size: st.size });
      }
    }
  }

  await walk(dir);

  // group by ext, pick diverse: top few largest + a few medium + a few small
  const byExt = new Map();
  for (const item of results) {
    const ext = path.extname(item.rel).toLowerCase();
    const list = byExt.get(ext) ?? [];
    list.push(item);
    byExt.set(ext, list);
  }

  const selected = [];
  for (const ext of exts) {
    const list = (byExt.get(ext) ?? []).sort((a, b) => b.size - a.size);
    if (!list.length) continue;
    if (!maxPerExt || maxPerExt <= 0) {
      selected.push(...list);
      continue;
    }

    const picks = new Map();
    const take = (idx) => {
      if (idx < 0 || idx >= list.length) return;
      picks.set(list[idx].rel, list[idx]);
    };

    // Always include: largest 3
    for (let i = 0; i < Math.min(3, list.length); i++) take(i);

    // Include a few from the middle
    const mid = Math.floor(list.length / 2);
    for (const offset of [-5, -2, 0, 2, 5]) take(mid + offset);

    // Include a few from the end (small files)
    for (let i = list.length - 1; i >= Math.max(0, list.length - 3); i--) take(i);

    const ordered = Array.from(picks.values()).sort((a, b) => b.size - a.size);
    selected.push(...ordered.slice(0, maxPerExt));
  }

  return selected;
}

function sampleEntry({ id, kind, tags, relPath, extra = {} }) {
  return { id, kind, tags, path: relPath, ...extra };
}

function makeId(prefix, relPath) {
  const base = relPath.split('/').pop() ?? relPath;
  const noExt = base.replace(path.extname(base), '');
  return `${prefix}_${noExt}`.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function uniqueId(desiredId, taken) {
  if (!taken.has(desiredId)) {
    taken.add(desiredId);
    return desiredId;
  }

  let counter = 2;
  while (taken.has(`${desiredId}_${counter}`)) {
    counter += 1;
  }
  const next = `${desiredId}_${counter}`;
  taken.add(next);
  return next;
}

async function loadExpectations(expectationsRel) {
  const expectationsPath = path.resolve(rootDir, expectationsRel);
  try {
    let raw = await fs.readFile(expectationsPath, 'utf8');
    raw = raw.replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed.expectations) ? parsed.expectations : [];
    const byPath = new Map();
    for (const entry of list) {
      if (!entry || !entry.path || !entry.expect) continue;
      byPath.set(String(entry.path), entry.expect);
    }
    return { byPath, expectationsPath };
  } catch {
    return { byPath: new Map(), expectationsPath };
  }
}

async function main() {
  const outRel = process.argv[2] || 'tmp/real-samples/real-samples-manifest.json';
  const expectationsRel = process.argv[3] || 'tmp/real-samples/real-samples-expectations.json';
  const outPath = path.resolve(rootDir, outRel);

  const samples = [];
  const ids = new Set();
  const expectations = await loadExpectations(expectationsRel);

  // Demo real samples
  const demoDir = path.resolve(rootDir, 'apps/demo/public/samples');
  for (const name of ['vue-office-test.pptx', 'sample-deck.pptx', 'a.key', 'a.pages', 'a.numbers']) {
    const relPath = `apps/demo/public/samples/${name}`;
    samples.push(sampleEntry({
      id: uniqueId(makeId('demo', relPath), ids),
      kind: path.extname(name).slice(1),
      tags: ['demo', 'real'],
      relPath
    }));
  }

  // Converter fixtures - include exactly what's in the official manifest
  const converterManifestPath = path.resolve(rootDir, 'examples/go-wazero-converter/fixtures/manifest.json');
  const converterManifestRaw = await fs.readFile(converterManifestPath, 'utf8');
  const converterManifest = JSON.parse(converterManifestRaw);
  for (const job of converterManifest.jobs ?? []) {
    const inputPath = String(job.inputPath || '').replace(/^\.\//, 'examples/go-wazero-converter/');
    if (!inputPath) continue;
    samples.push(sampleEntry({
      id: uniqueId(`convert_${job.sourceFormat}_${path.basename(inputPath).replace(/\W+/g, '_')}`, ids),
      kind: 'convert',
      tags: ['fixture', 'wasm-convert'],
      relPath: inputPath,
      extra: {
        sourceExt: job.sourceFormat,
        targetExt: job.targetFormat
      }
    }));
  }

  for (const [name, sourceExt, targetExt] of [
    ['hyperlink.doc', 'doc', 'docx'],
    ['table-merges.doc', 'doc', 'docx'],
    ['SimpleMacro.docm', 'docm', 'docx'],
    ['45690.docm', 'docm', 'docx'],
    ['Simple.xls', 'xls', 'xlsx'],
    ['SimpleWithFormula.xls', 'xls', 'xlsx'],
    ['chinese-provinces.xls', 'xls', 'xlsx'],
    ['SimpleMacro.xlsm', 'xlsm', 'xlsx'],
    ['testNames.xlsm', 'xlsm', 'xlsx']
  ]) {
    const relPath = `examples/go-wazero-converter/fixtures/real/apache-poi/${name}`;
    samples.push(sampleEntry({
      id: uniqueId(makeId('apache-poi', relPath), ids),
      kind: 'convert',
      tags: ['real', 'apache-poi', 'wasm-convert'],
      relPath,
      extra: { sourceExt, targetExt }
    }));
  }

  // Real docx/pptx/xlsx/vsd(x)/xmind/dxf
  const pickSets = [
    {
      base: 'tmp/real-samples/_sources/python-docx',
      exts: ['.docx'],
      kind: 'docx',
      tags: ['real', 'python-docx'],
      include: [/tmp\/real-samples\/_sources\/python-docx\/(features\/steps\/test_files|tests\/test_files)\//],
      maxPerExt: 18
    },
    {
      base: 'tmp/real-samples/_sources/python-pptx',
      exts: ['.pptx'],
      kind: 'pptx',
      tags: ['real', 'python-pptx'],
      include: [/tmp\/real-samples\/_sources\/python-pptx\/(features\/steps\/test_files|tests\/test_files)\//],
      maxPerExt: 18
    },
    {
      base: 'tmp/real-samples/_sources/exceljs',
      exts: ['.xlsx'],
      kind: 'xlsx',
      tags: ['real', 'exceljs'],
      include: [/tmp\/real-samples\/_sources\/exceljs\/(spec\/integration\/data|test\/data)\//],
      maxPerExt: 18
    },
    {
      base: 'tmp/real-samples/_sources/libvisio',
      exts: ['.vsd', '.vsdx'],
      kind: 'visio',
      tags: ['real', 'libvisio'],
      include: [/tmp\/real-samples\/_sources\/libvisio\/src\/test\/data\//],
      maxPerExt: 10
    },
    {
      base: 'tmp/real-samples/_sources/idef3vssx',
      exts: ['.vsdx', '.vssx'],
      kind: 'visio',
      tags: ['real', 'idef3vssx'],
      include: [],
      maxPerExt: 4
    },
    {
      base: 'tmp/real-samples/_sources/xmindparser',
      exts: ['.xmind'],
      kind: 'xmind',
      tags: ['real', 'xmindparser'],
      include: [/tmp\/real-samples\/_sources\/xmindparser\/tests\//],
      maxPerExt: 10
    },
    {
      base: 'tmp/real-samples/_sources/LibreCAD',
      exts: ['.dxf'],
      kind: 'dxf',
      tags: ['real', 'LibreCAD'],
      include: [],
      maxPerExt: 18
    },
    {
      base: 'tmp/real-samples/_sources/assimp',
      exts: ['.glb', '.gltf', '.obj', '.stl', '.ply', '.dae', '.fbx', '.3ds', '.wrl', '.bvh', '.md2', '.lwo', '.pdb', '.nrrd', '.nhdr'],
      kind: 'model',
      tags: ['real', 'assimp'],
      include: [/tmp\/real-samples\/_sources\/assimp\/test\/models\//],
      exclude: [/models-nonbsd\//i],
      maxPerExt: 6
    }
  ];

  for (const set of pickSets) {
    const baseDir = path.resolve(rootDir, set.base);
    const items = await listFiles(baseDir, set.exts, {
      maxPerExt: set.maxPerExt,
      includePatterns: set.include ?? [],
      excludePatterns: set.exclude ?? []
    });

    for (const item of items) {
      const relPath = item.rel;
      samples.push(sampleEntry({
        id: uniqueId(makeId(set.kind, relPath), ids),
        kind: set.kind,
        tags: set.tags,
        relPath,
        extra: { size: item.size }
      }));
    }
  }

  // Apply expectations by path.
  for (const sample of samples) {
    const expect = expectations.byPath.get(sample.path);
    if (expect) {
      sample.expect = expect;
    }
  }

  // De-dupe by path
  const seen = new Set();
  const deduped = [];
  for (const s of samples) {
    if (seen.has(s.path)) continue;
    seen.add(s.path);
    deduped.push(s);
  }

  const manifest = {
    version: 2,
    generatedAt: new Date().toISOString(),
    description: 'Auto-generated curated real-world and fixture samples for regression testing.',
    samples: deduped,
    expectations: expectations.byPath.size ? path.relative(rootDir, expectations.expectationsPath).replace(/\\/g, '/') : undefined
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(manifest, null, 2), 'utf8');

  console.log(`Wrote ${path.relative(rootDir, outPath)} with ${deduped.length} samples.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
