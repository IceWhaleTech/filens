import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(toFsPath(new URL(import.meta.url).pathname)), '..');

function toFsPath(p) {
  // Node URL pathname on Windows begins with /g:/... sometimes. Normalize.
  if (process.platform === 'win32' && p.startsWith('/') && /^[A-Za-z]:/.test(p.slice(1))) {
    return p.slice(1);
  }
  return p;
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function fileExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function safeName(name) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

async function safeRealpath(dirPath) {
  try {
    return await fs.realpath(dirPath);
  } catch {
    return dirPath;
  }
}

function mdEscape(text) {
  return String(text ?? '').replaceAll('|', '\\|');
}

async function main() {
  const manifestRel = process.argv[2] || 'tmp/real-samples/real-samples-manifest.json';
  const outRel = process.argv[3] || 'tmp/real-samples/selected';

  const manifestPath = path.resolve(rootDir, manifestRel);
  const outDir = path.resolve(rootDir, outRel);

  let raw = await fs.readFile(manifestPath, 'utf8');
  raw = raw.replace(/^\uFEFF/, '');
  const manifest = JSON.parse(raw);
  const samples = Array.isArray(manifest.samples) ? manifest.samples : [];

  const outDirReal = await safeRealpath(outDir);
  await ensureDir(outDirReal);
  await ensureDir(path.join(outDirReal, '_meta'));

  const report = {
    manifest: path.relative(rootDir, manifestPath),
    outDir: path.relative(rootDir, outDirReal),
    total: samples.length,
    copied: 0,
    missing: [],
    items: []
  };

  for (const sample of samples) {
    const relPath = sample.path;
    if (typeof relPath !== 'string') continue;

    const srcPath = path.resolve(rootDir, relPath);
    const ok = await fileExists(srcPath);
    if (!ok) {
      report.missing.push(relPath);
      continue;
    }

    const ext = path.extname(relPath).replace('.', '').toLowerCase() || 'bin';
    const id = typeof sample.id === 'string' ? sample.id : path.basename(relPath, path.extname(relPath));

    const dstName = safeName(`${id}${path.extname(relPath)}`);
    const dstDir = path.join(outDirReal, ext);
    await ensureDir(dstDir);

    const dstPath = path.join(dstDir, dstName);
    await fs.copyFile(srcPath, dstPath);

    report.copied += 1;
    report.items.push({
      id,
      kind: sample.kind,
      tags: sample.tags,
      src: relPath,
      dst: path.relative(rootDir, dstPath)
    });
  }

  const reportPath = path.join(outDirReal, '_meta', 'stage-report.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

  const readmePath = path.join(outDirReal, 'README.md');
  const rows = report.items
    .slice()
    .sort((a, b) => String(a.dst).localeCompare(String(b.dst)))
    .map((item) => {
      const tags = Array.isArray(item.tags) ? item.tags.join(', ') : '';
      return (
        '| ' +
        mdEscape(item.kind) +
        ' | `' +
        mdEscape(item.dst) +
        '` | `' +
        mdEscape(item.src) +
        '` | ' +
        mdEscape(tags) +
        ' |'
      );
    });

  const readme = [
    '# Staged real samples',
    '',
    '- Manifest: `' + mdEscape(report.manifest) + '`',
    '- Total: ' + report.total,
    '- Copied: ' + report.copied,
    '',
    '## Files',
    '',
    '| Kind | Staged path | Source path | Tags |',
    '| --- | --- | --- | --- |',
    ...rows,
    ''
  ].join('\n');

  await fs.writeFile(readmePath, readme, 'utf8');

  console.log(`Staged ${report.copied}/${report.total} files -> ${path.relative(rootDir, outDirReal)}`);
  if (report.missing.length) {
    console.log('Missing:');
    for (const m of report.missing) console.log(`- ${m}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
