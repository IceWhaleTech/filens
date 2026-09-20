import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { expectedFamilyForExt } from './_preview-family-map.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultBaseUrl = 'http://127.0.0.1:4173';

function locatorVisible(locator) {
  return locator.first().isVisible().catch(() => false);
}

async function waitForTruthy(check, timeoutMs, intervalMs = 100) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await check();
      if (value) return value;
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

async function waitForAnyVisible(page, selectors, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const sel of selectors) {
      if (await locatorVisible(page.locator(sel))) {
        return sel;
      }
    }
    await page.waitForTimeout(100);
  }
  return null;
}

async function assertByFamily(page, family) {
  switch (family) {
    case 'html': {
      const ok = await waitForTruthy(async () => {
        const rootOk = await locatorVisible(page.locator('.pptxv-native-preview--html'));
        if (!rootOk) return false;
        return locatorVisible(page.locator('iframe.pptxv-native-html-frame'));
      }, 15000);
      return ok ? { ok: true } : { ok: false, error: 'Missing native HTML iframe' };
    }
    case 'text':
    case 'code': {
      const ok = await waitForTruthy(async () => {
        const rootOk = await locatorVisible(page.locator('.pptxv-native-preview--text'));
        if (!rootOk) return false;
        const pre = page.locator(`pre.pptxv-native-text[data-family="${family}"]`).first();
        if (!(await locatorVisible(pre))) return false;
        const content = await pre.textContent().catch(() => '');
        return Boolean(content && content.length > 0);
      }, 15000);
      return ok ? { ok: true } : { ok: false, error: `Missing native ${family} text` };
    }
    case 'audio':
    case 'video': {
      const ok = await waitForTruthy(async () => {
        const rootOk = await locatorVisible(page.locator(`.pptxv-native-preview--${family}`));
        if (!rootOk) return false;
        return locatorVisible(page.locator(`${family}.pptxv-native-media`));
      }, 15000);
      return ok ? { ok: true } : { ok: false, error: `Missing native ${family} media element` };
    }
    case 'flow': {
      const ok = await waitForTruthy(async () => {
        const rootOk = await locatorVisible(page.locator('.docxv-preview'));
        if (!rootOk) return false;
        const docCount = await page.locator('.docxv-document .docx').count().catch(() => 0);
        return docCount > 0;
      }, 15000);
      return ok ? { ok: true } : { ok: false, error: 'Missing .docxv-document .docx' };
    }
    case 'workbook': {
      const ok = await waitForTruthy(async () => {
        const rootOk = await locatorVisible(page.locator('.xlsxv-preview'));
        if (!rootOk) return false;
        const tabs = await page.locator('.xlsxv-sheet-tab').count().catch(() => 0);
        const cells = await page.locator('.xlsxv-cell').count().catch(() => 0);
        return tabs > 0 && cells > 0;
      }, 15000);
      return ok ? { ok: true } : { ok: false, error: 'Missing .xlsxv-sheet-tab/.xlsxv-cell' };
    }
    case 'cad': {
      const ok = await waitForTruthy(async () => {
        const rootOk = await locatorVisible(page.locator('.cadv-preview'));
        if (!rootOk) return false;
        const svgOk = await locatorVisible(page.locator('svg.cadv-canvas'));
        if (!svgOk) return false;
        const shapes = await page.locator('svg.cadv-canvas line, svg.cadv-canvas path, svg.cadv-canvas circle, svg.cadv-canvas rect, svg.cadv-canvas text').count().catch(() => 0);
        return shapes > 0;
      }, 15000);
      return ok ? { ok: true } : { ok: false, error: 'Missing cad canvas content' };
    }
    case 'mindmap': {
      const ok = await waitForTruthy(async () => {
        const rootOk = await locatorVisible(page.locator('.mindmapv-preview'));
        if (!rootOk) return false;
        const svgOk = await locatorVisible(page.locator('svg.mindmapv-canvas'));
        if (!svgOk) return false;
        const nodes = await page.locator('.mindmapv-node').count().catch(() => 0);
        return nodes > 0;
      }, 15000);
      return ok ? { ok: true } : { ok: false, error: 'Missing mindmap nodes' };
    }
    case 'diagram': {
      const ok = await waitForTruthy(async () => {
        const rootOk = await locatorVisible(page.locator('.diagramv-preview'));
        if (!rootOk) return false;
        const canvasOk = await locatorVisible(page.locator('.diagramv-canvas'));
        if (!canvasOk) return false;
        const nodes = await page.locator('.diagramv-node').count().catch(() => 0);
        return nodes > 0;
      }, 15000);
      return ok ? { ok: true } : { ok: false, error: 'Missing diagram nodes' };
    }
    case 'archive': {
      const ok = await waitForTruthy(async () => {
        const rootOk = await locatorVisible(page.locator('.archivev-preview'));
        if (!rootOk) return false;
        const rows = await page.locator('.archivev-row').count().catch(() => 0);
        return rows > 0;
      }, 15000);
      return ok ? { ok: true } : { ok: false, error: 'Missing archive rows' };
    }
    case 'ebook': {
      const ok = await waitForTruthy(async () => {
        const rootOk = await locatorVisible(page.locator('.ebookv-preview'));
        if (!rootOk) return false;
        const frameOk = await locatorVisible(page.locator('iframe.ebookv-frame'));
        return frameOk;
      }, 15000);
      return ok ? { ok: true } : { ok: false, error: 'Missing ebook iframe' };
    }
    case 'image': {
      const ok = await waitForTruthy(async () => {
        const rootOk = await locatorVisible(page.locator('.pptxv-native-preview'));
        if (!rootOk) return false;
        const imgOk = await locatorVisible(page.locator('img.pptxv-native-image'));
        return imgOk;
      }, 15000);
      return ok ? { ok: true } : { ok: false, error: 'Missing native image' };
    }
    case 'model3d': {
      const ok = await waitForTruthy(async () => {
        const rootOk = await locatorVisible(page.locator('.model3dv-preview'));
        if (!rootOk) return false;
        const canvasOk = await locatorVisible(page.locator('canvas.model3dv-canvas'));
        return canvasOk;
      }, 15000);
      return ok ? { ok: true } : { ok: false, error: 'Missing model3d canvas' };
    }
    case 'paged': {
      const variant = await waitForTruthy(async () => {
        if (await locatorVisible(page.locator('.pdfv-preview'))) return 'pdf';
        if (await locatorVisible(page.locator('.iworkv-root'))) return 'iwork';
        if (await locatorVisible(page.locator('.pptxv-shell'))) return 'pptx';
        return null;
      }, 15000);
      if (!variant) return { ok: false, error: 'Missing paged root' };

      if (variant === 'pdf') {
        const ok = await waitForTruthy(async () => locatorVisible(page.locator('iframe.pdfv-frame')), 15000);
        return ok ? { ok: true } : { ok: false, error: 'Missing pdf iframe' };
      }
      if (variant === 'iwork') {
        const ok = await waitForTruthy(async () => {
          const shells = await page.locator('.iworkv-page-shell').count().catch(() => 0);
          return shells > 0;
        }, 15000);
        return ok ? { ok: true } : { ok: false, error: 'Missing iwork pages' };
      }

      const overlay = page.locator('.pptxv-overlay.is-error');
      if (await locatorVisible(overlay)) {
        const msg = (await overlay.textContent().catch(() => null)) || 'PPTX viewer error';
        return { ok: false, error: msg.trim() };
      }

      const ok = await waitForTruthy(async () => {
        const emptyOk = await locatorVisible(page.locator('.pptxv-loading--empty'));
        if (emptyOk) return true;
        const slides = await page.locator('.pptxv-slide').count().catch(() => 0);
        if (slides > 0) return true;
        const thumbs = await page.locator('.pptxv-thumb-button').count().catch(() => 0);
        return thumbs > 0;
      }, 20000);
      return ok ? { ok: true } : { ok: false, error: 'Missing pptx slides/thumbs/empty state' };
    }
    default:
      return { ok: true };
  }
}

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
    const timer = setTimeout(() => reject(new Error('Static server did not start in time')), timeoutMs);
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
  const outRel = process.argv[4] || 'tmp/real-samples/preview-report-strict.json';

  const manifestPath = path.resolve(rootDir, manifestRel);
  const stagingDir = path.resolve(rootDir, stagingDirRel);
  const outPath = path.resolve(rootDir, outRel);

  const distIndex = path.join(rootDir, 'apps/demo/dist/index.html');
  const distOk = await fs.stat(distIndex).then((st) => st.isFile() && st.size > 0).catch(() => false);
  if (!distOk) {
    console.log('Demo dist not available. Build demo first (npm run build:demo).');
    process.exit(1);
  }

  let raw = await fs.readFile(manifestPath, 'utf8');
  raw = raw.replace(/^\uFEFF/, '');
  const manifest = JSON.parse(raw);
  const samples = Array.isArray(manifest.samples) ? manifest.samples : [];
  const sampleById = new Map(samples.map((s) => [String(s.id), s]));

  const staged = [];
  for (const s of samples) {
    const src = String(s.path || '');
    const ext = path.extname(src).slice(1).toLowerCase();
    const id = String(s.id || path.basename(src, path.extname(src)));
    const stagedPath = path.join(stagingDir, ext || 'bin', `${id}${path.extname(src)}`);
    try {
      const st = await fs.stat(stagedPath);
      if (st.isFile() && st.size > 0) staged.push({ id, ext, kind: s.kind, stagedPath });
    } catch {
      // ignore
    }
  }

  if (!staged.length) {
    console.log('No staged samples found.');
    process.exit(1);
  }

  const server = await startStaticServer();
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const report = { ok: true, total: staged.length, passed: 0, failed: 0, xfailed: 0, xpassed: 0, items: [] };

  await page.goto(defaultBaseUrl + '/');

  // Any-viewer markers (coarse "something rendered" signal; family-specific checks happen later)
  const anyViewer = [
    '.docxv-preview',
    '.xlsxv-preview',
    '.cadv-preview',
    '.mindmapv-preview',
    '.diagramv-preview',
    '.archivev-preview',
    '.ebookv-preview',
    '.model3dv-preview',
    '.pptxv-shell',
    '.iworkv-root',
    '.pdfv-preview',
    '.pptxv-native-preview'
  ];

  for (const item of staged) {
    const name = path.basename(item.stagedPath);
    const expectedFamily = expectedFamilyForExt(item.ext);
    const sample = sampleById.get(item.id);
    const expectedOutcome = sample?.expect?.outcome === 'xfail' ? 'xfail' : 'ok';
    const expectedReason = sample?.expect?.reason;

    try {
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(item.stagedPath);

      const errorNote = page.locator('.wb-note.is-error');

      // Wait either for error or some viewer marker
      const winner = await Promise.race([
        errorNote.waitFor({ state: 'visible', timeout: 25000 }).then(() => 'error'),
        waitForAnyVisible(page, anyViewer, 25000).then((sel) => (sel ? 'viewer' : 'timeout'))
      ]);

      if (winner === 'error') {
        const msg = (await errorNote.textContent()) || '';
        if (expectedOutcome === 'xfail') {
          report.xfailed += 1;
        } else {
          report.ok = false;
          report.failed += 1;
        }
        report.items.push({ id: item.id, ext: item.ext, name, ok: false, error: msg.trim(), expectedOutcome, expectedReason });
        continue;
      }
      if (winner === 'timeout') {
        if (expectedOutcome === 'xfail') {
          report.xfailed += 1;
        } else {
          report.ok = false;
          report.failed += 1;
        }
        report.items.push({
          id: item.id,
          ext: item.ext,
          name,
          ok: false,
          error: 'Timed out waiting for viewer',
          expectedOutcome,
          expectedReason
        });
        continue;
      }

      // Family assertion: verify root + minimal content markers.
      if (expectedFamily) {
        const assertion = await assertByFamily(page, expectedFamily);
        if (!assertion.ok) {
          if (expectedOutcome === 'xfail') {
            report.xfailed += 1;
          } else {
            report.ok = false;
            report.failed += 1;
          }
          report.items.push({
            id: item.id,
            ext: item.ext,
            name,
            ok: false,
            error: assertion.error || `Expected family ${expectedFamily} did not render`,
            expectedFamily,
            expectedOutcome,
            expectedReason
          });
          continue;
        }
      }

      if (expectedOutcome === 'xfail') {
        report.xpassed += 1;
        report.items.push({ id: item.id, ext: item.ext, name, ok: true, expectedFamily, expectedOutcome, expectedReason, xpass: true });
        continue;
      }

      report.passed += 1;
      report.items.push({ id: item.id, ext: item.ext, name, ok: true, expectedFamily, expectedOutcome });
    } catch (err) {
      if (expectedOutcome === 'xfail') {
        report.xfailed += 1;
      } else {
        report.ok = false;
        report.failed += 1;
      }
      report.items.push({ id: item.id, ext: item.ext, name, ok: false, error: String(err), expectedFamily, expectedOutcome, expectedReason });
    }
  }

  await browser.close();
  server.kill();

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');

  report.ok = report.failed === 0;
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(`Strict preview report: ${path.relative(rootDir, outPath)} (ok=${report.ok}, passed=${report.passed}/${report.total}, xfailed=${report.xfailed}, xpassed=${report.xpassed})`);
  if (report.failed !== 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
