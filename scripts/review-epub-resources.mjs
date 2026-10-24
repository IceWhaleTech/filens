// Untimed complete-book/resource comparisons; corrected styling is checked in browser tests.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { createBookFixture, createComicFixture, createAssetBookFixture, createStyledBookFixture } from '../packages/ebook/test/fixtures/books.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const baselinePath = option('--baseline', 'tmp/continued-review/epub-resources-baseline/dist/index.js');
const currentPath = 'packages/ebook/dist/index.js';
const baseline = await import(pathToFileURL(path.resolve(root, baselinePath)));
const current = await import(pathToFileURL(path.join(root, currentPath)));
const dom = new JSDOM(); globalThis.document = dom.window.document; globalThis.DOMParser = dom.window.DOMParser;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const report = { currentArtifactSha256: hash(fs.readFileSync(path.join(root, currentPath))),
  baselineArtifactSha256: hash(fs.readFileSync(path.resolve(root, baselinePath))), samples: [], representations: [] };

async function capture(lib, source, format = 'epub') {
  const blobs = [];
  const book = await lib[format === 'cbz' ? 'loadCbzBook' : 'loadEpubBook'](source, { descriptor: { source, extension: format } }, blob => {
    blobs.push(blob); return `blob:review-${blobs.length}`;
  });
  const resources = [];
  for (const blob of blobs) resources.push({ type: blob.type, size: blob.size, sha256: hash(new Uint8Array(await blob.arrayBuffer())) });
  return { book, resources };
}
const samples = [
  { name: 'sample.epub', bytes: new Uint8Array(fs.readFileSync(path.join(root, 'examples/go-wazero-converter/fixtures/doc/sample.epub'))) },
  { name: '40-chapters.epub', bytes: await createBookFixture() },
  { name: '200-assets.epub', bytes: await createAssetBookFixture(200) },
  { name: '1000-assets.epub', bytes: await createAssetBookFixture(1000) },
  { name: '200-pages.cbz', bytes: await createComicFixture(200), format: 'cbz' }
];
for (const sample of samples) {
  const actual = await capture(current, sample.bytes, sample.format);
  assert.deepEqual(actual, await capture(baseline, sample.bytes, sample.format), sample.name);
  report.samples.push({ name: sample.name, inputSha256: hash(sample.bytes), fullModelSha256: hash(JSON.stringify(actual.book)),
    resourceSignaturesSha256: hash(JSON.stringify(actual.resources)), chapterCount: actual.book.chapters.length,
    resourceCount: actual.resources.length, completeModelsAndResourceBytesMatch: true });
}
const small = await createAssetBookFixture(2), padded = new Uint8Array(small.length + 8); padded.set(small, 4);
const variants = { bytes: small, arrayBuffer: small.slice().buffer, offsetView: new DataView(padded.buffer, 4, small.length),
  blob: new Blob([small]), dataUrl: `data:application/epub+zip;base64,${Buffer.from(small).toString('base64')}` };
const expected = await capture(baseline, small);
for (const [name, source] of Object.entries(variants)) {
  assert.deepEqual(await capture(current, source), expected);
  assert.deepEqual(await capture(baseline, source), expected);
  report.representations.push({ name, fullModelSha256: hash(JSON.stringify(expected.book)) });
}
const styled = await createStyledBookFixture(), actual = await capture(current, styled), previous = await capture(baseline, styled);
assert.equal(previous.book.chapters.length, 1); assert.equal(actual.book.chapters.length, 2);
assert.equal(actual.resources.filter(resource => resource.type.startsWith('text/css')).length, 3);
assert.equal(actual.resources.filter(resource => resource.type === 'font/woff').length, 1);
report.correctedStyledBook = { inputSha256: hash(styled), previousChapterCount: previous.book.chapters.length,
  currentChapterCount: actual.book.chapters.length, fullModelSha256: hash(JSON.stringify(actual.book)),
  resources: actual.resources, warnings: actual.book.warnings,
  browserCoverage: 'Both chapters: imported colors, bounded cyclic imports, real WOFF load, four decoded CSS backgrounds, inline styles, SVG xlink resources, queried image URLs and complete session URL cleanup.' };
dom.window.close();
const output = path.resolve(root, option('--output', 'tmp/continued-review/epub-resources-content-review.json'));
fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log({ samples: report.samples.length, representations: report.representations.length,
  chapterPairs: report.samples.reduce((count, sample) => count + sample.chapterCount, 0),
  resourcePairs: report.samples.reduce((count, sample) => count + sample.resourceCount, 0) });
