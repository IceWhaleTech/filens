import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function classify(item) {
  if (item.ok) return 'ok';
  const msg = String(item.error || '').toLowerCase();
  if (msg.includes('unsupported')) return 'unsupported';
  if (msg.includes('converter') && msg.includes('configured')) return 'no_converter';
  if (msg.includes('password')) return 'password';
  if (msg.includes('parse')) return 'parse_error';
  return 'error';
}

async function main() {
  const reportRel = process.argv[2] || 'tmp/real-samples/preview-report.json';
  const outRel = process.argv[3] || 'tmp/real-samples/preview-report-summary.json';

  const reportPath = path.resolve(rootDir, reportRel);
  const outPath = path.resolve(rootDir, outRel);

  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  const items = Array.isArray(report.items) ? report.items : [];

  const byExt = {};
  const byClass = {};
  const failures = [];

  for (const item of items) {
    const ext = item.ext || 'unknown';
    byExt[ext] = byExt[ext] || { total: 0, ok: 0, failed: 0, classes: {} };
    byExt[ext].total += 1;

    const cls = classify(item);
    byClass[cls] = (byClass[cls] || 0) + 1;
    byExt[ext].classes[cls] = (byExt[ext].classes[cls] || 0) + 1;

    if (item.ok) {
      byExt[ext].ok += 1;
    } else {
      byExt[ext].failed += 1;
      failures.push(item);
    }
  }

  const summary = {
    ok: Boolean(report.ok),
    total: report.total,
    passed: report.passed,
    failed: report.failed,
    byClass,
    byExt,
    failures: failures.slice(0, 50)
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(summary, null, 2), 'utf8');

  console.log(`Wrote ${path.relative(rootDir, outPath)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
