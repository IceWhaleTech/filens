// Run from the repository root after reconstructing the baseline as described in pptx-lazy-review.json.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
const repo = process.cwd();
const { loadPptx: current } = await import(pathToFileURL(path.join(repo, 'packages/core/dist/index.js')).href);
const { loadPptx: previous } = await import(pathToFileURL(path.join(repo, 'tmp/performance-sota/oct24-lazy-baseline/core-dist/index.js')).href);
const files = ['vue-office-test.pptx', 'filens-field-notes.pptx', 'rich-pptx-shapes.pptx', 'rich-pptx-pictures.pptx', 'sample-deck.pptx']
  .map(name => `apps/demo/public/samples/${name}`)
  .concat(['SampleShow.pptx', 'pie-chart.pptx', '2411-Performance_Up.pptx'].map(name => `tmp/performance-sota/samples/${name}`));
const checks = [];
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
for (const file of files) {
  const input = fs.readFileSync(path.join(repo, file));
  const actual = await current(input), expected = await previous(input);
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  const check = { file, same: a === b, bytes: Buffer.byteLength(a), currentSha256: sha256(a), previousSha256: sha256(b),
    media: Object.keys(actual.media).length, slides: actual.slides.length };
  checks.push(check);
  console.log(JSON.stringify(check));
  if (!check.same) throw new Error(`Complete model changed: ${file}`);
}
fs.mkdirSync(path.join(repo, 'tmp/performance-sota'), { recursive: true });
fs.writeFileSync(path.join(repo, 'tmp/performance-sota/pptx-lazy-full-model-review.json'), JSON.stringify(checks, null, 2) + '\n');
