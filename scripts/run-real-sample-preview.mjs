import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { conversionSourceExts } from './_preview-family-map.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultBaseUrl = 'http://127.0.0.1:4173';

async function startStaticServer() {
  const child = spawn(process.platform === 'win32' ? 'node.exe' : 'node', ['./scripts/serve-static.mjs', 'apps/demo/dist', '4173'], {
    cwd: rootDir,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  await waitForServerLine(child, /Serving .* at http:\/\/127\.0\.0\.1:4173/);
  return child;
}

function waitForServerLine(child, pattern, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Static server did not start in time'));
    }, timeoutMs);
    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      if (pattern.test(buf)) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code) => {
      if (code && code !== 0) {
        clearTimeout(timer);
        reject(new Error(`Static server exited with code ${code}`));
      }
    });
  });
}

async function main() {
  const manifestRel = process.argv[2] || 'tmp/real-samples/real-samples-manifest.json';
  const stagingDirRel = process.argv[3] || 'tmp/real-samples/selected-auto2';
  const outRel = process.argv[4] || 'tmp/real-samples/preview-report.json';

  const manifestPath = path.resolve(rootDir, manifestRel);
  const stagingDir = path.resolve(rootDir, stagingDirRel);
  const outPath = path.resolve(rootDir, outRel);

  let raw = await fs.readFile(manifestPath, 'utf8');
  raw = raw.replace(/^\uFEFF/, '');
  const manifest = JSON.parse(raw);
  const samples = Array.isArray(manifest.samples) ? manifest.samples : [];

  // Only preview formats supported by upload mode.
  // Keep this aligned with demo detectKind() and the registered preview routes.
  const allowedExt = new Set([
    'pptx', ...conversionSourceExts,
    'key', 'pages', 'numbers',
    'pdf', 'docx',
    'txt', 'text', 'md', 'markdown', 'html', 'htm', 'shtml', 'xhtml', 'xml', 'yaml', 'yml', 'toml', 'ini', 'log', 'rst', 'adoc', 'asciidoc', 'tex', 'properties', 'env', 'conf', 'config', 'sql',
    'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts', 'vue', 'css', 'scss', 'sass', 'less', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'java', 'kt', 'kts', 'lua', 'php', 'py', 'rb', 'rs', 'sh', 'bash', 'bat', 'cmd', 'ps1', 'swift', 'json', 'jsonc', 'json5', 'jsonl', 'ndjson', 'ipynb', 'gql', 'graphql', 'proto', 'diff', 'patch', 'gitignore', 'dockerignore', 'editorconfig',
    'org', 'wiki', 'mediawiki', 'textile', 'pod', 'man', 'roff', 'nfo', 'srt', 'vtt', 'ics', 'vcf', 'eml', 'mht', 'mhtml', 'npmrc', 'yarnrc', 'gitattributes', 'gitmodules',
    'csv', 'tsv', 'psv', 'xlsx',
    'dxf',
    'stl', 'obj', 'ply', 'gltf', 'glb', '3mf', 'amf', 'dae', 'fbx', '3ds', 'usdz', 'gcode', 'gco', 'nc', 'wrl', 'vrml', 'pcd', 'xyz', 'vtk', 'vox', 'ldr', 'mpd', 'kmz', 'md2', 'lwo', 'bvh', 'pdb', 'nrrd', 'nhdr',
    'xmind', 'mm', 'opml',
    'drawio', 'dio', 'vdx', 'vsdx',
    'zip', 'epub', 'cbz',
    'png'
  ]);

  const staged = [];
  for (const s of samples) {
    const src = String(s.path || '');
    const ext = path.extname(src).slice(1).toLowerCase();
    if (!allowedExt.has(ext)) continue;

    // Map to staged path by our staging convention: <stagingDir>/<ext>/<id>.<ext>
    const id = String(s.id || path.basename(src, path.extname(src)));
    const stagedPath = path.join(stagingDir, ext || 'bin', `${id}${path.extname(src)}`);
    try {
      const st = await fs.stat(stagedPath);
      if (st.isFile() && st.size > 0) {
        staged.push({ id, ext, kind: s.kind, stagedPath });
      }
    } catch {
      // ignore missing (different staging dir used)
    }
  }

  if (!staged.length) {
    console.log('No staged samples found. Did you run stage-real-samples?');
    process.exit(1);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();

  const report = {
    ok: true,
    total: staged.length,
    passed: 0,
    failed: 0,
    items: []
  };

  const distIndex = path.join(rootDir, 'apps/demo/dist/index.html');
  const distOk = await fs
    .stat(distIndex)
    .then((st) => st.isFile() && st.size > 0)
    .catch(() => false);
  if (!distOk) {
    console.log('Demo dist not available. Build demo first (npm run build:demo).');
    await browser.close();
    process.exit(1);
  }

  const server = await startStaticServer();
  await page.goto(defaultBaseUrl + '/');

  for (const item of staged) {
    const name = path.basename(item.stagedPath);
    try {
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(item.stagedPath);

      // Wait either for error note or a rendered state update.
      const errorNote = page.locator('.wb-note.is-error');
      const viewer = page.locator('.pptxv-shell, .iworkv-shell, .docxv-shell, .xlsxv-shell');

      const result = await Promise.race([
        errorNote.waitFor({ state: 'visible', timeout: 20000 }).then(async () => ({ ok: false, error: await errorNote.textContent() })),
        viewer.waitFor({ state: 'visible', timeout: 20000 }).then(() => ({ ok: true }))
      ]);

      if (!result.ok) {
        report.ok = false;
        report.failed += 1;
        report.items.push({ id: item.id, ext: item.ext, name, ok: false, error: (result.error || '').trim() });
        continue;
      }

      report.passed += 1;
      report.items.push({ id: item.id, ext: item.ext, name, ok: true });
    } catch (err) {
      report.ok = false;
      report.failed += 1;
      report.items.push({ id: item.id, ext: item.ext, name, ok: false, error: String(err) });
    }
  }

  await browser.close();
  server.kill();
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(`Preview report: ${path.relative(rootDir, outPath)} (ok=${report.ok}, passed=${report.passed}/${report.total})`);
  if (!report.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
