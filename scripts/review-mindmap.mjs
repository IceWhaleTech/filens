// Untimed complete model/SVG checks against the previous mind-map build.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';
import { createPackagedMapFixtures, createWideMmFixture, mixedMmFixture } from '../packages/mindmap/test/fixtures/maps.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const currentPath = 'packages/mindmap/dist/index.js';
const baselinePath = option('--baseline', 'tmp/continued-review/mindmap-baseline/dist/index.js');
const current = await import(pathToFileURL(path.join(root, currentPath)));
const baseline = await import(pathToFileURL(path.resolve(root, baselinePath)));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const dom = new JSDOM();
globalThis.document = dom.window.document; globalThis.DOMParser = dom.window.DOMParser;
const report = { currentArtifactSha256: hash(fs.readFileSync(path.join(root, currentPath))), baselineArtifactSha256: hash(fs.readFileSync(path.resolve(root, baselinePath))),
  samples: [], generatedTrees: [], sourceRepresentations: [] };
const xmlFixture = (name, format, text) => ({ name, format, bytes: new TextEncoder().encode(text) });
const samples = [
  xmlFixture('mixed-mm', 'mm', mixedMmFixture),
  xmlFixture('bare-root-mm', 'mm', '<node TEXT="Root"><node TEXT="Child"/><node ID="known" TEXT="Second"><node TEXT="Third"/></node></node>'),
  xmlFixture('wide-no-ids', 'mm', createWideMmFixture(120)),
  xmlFixture('wide-explicit-ids', 'mm', createWideMmFixture(120, true)),
  xmlFixture('outline', 'opml', '<opml><head><title>Plan 中文</title></head><body><outline text="First"><outline text="A &amp; B"/></outline><outline text="Second"/></body></opml>'),
  ...await createPackagedMapFixtures(JSZip)
];
const demo = fs.readFileSync(path.join(root, 'apps/demo/src/App.vue'), 'utf8');
for (const name of ['createMmFixture', 'createMoonshotMmFixture']) {
  const match = demo.match(new RegExp(`function ${name}\\(\\): Uint8Array \\{\\s*return new TextEncoder\\(\\)\\.encode\\(\x60([\\s\\S]*?)\x60\\);`));
  assert(match, `Missing demo fixture ${name}`);
  samples.push(xmlFixture(name, 'mm', match[1]));
}
const model = (lib, sample) => sample.format === 'xmind' ? lib.loadXmindDocument(sample.bytes.slice().buffer)
  : sample.format === 'mmap' ? lib.loadMindmanagerDocument(sample.bytes.slice().buffer)
  : lib.loadMindmapDocument(new TextDecoder().decode(sample.bytes), sample.format);
async function render(lib, source, format) {
  const host = document.createElement('div');
  const session = lib.createMindmapPreviewDriver().createSession(host, { initialScale: 1, fit: 'none' });
  try {
    await session.load(source, { descriptor: { source, name: `plan.${format}`, extension: format } });
    return { html: host.innerHTML, state: session.getState() };
  } finally { session.destroy(); }
}
for (const sample of samples) {
  const actual = await model(current, sample), previous = await model(baseline, sample);
  assert.deepEqual(actual, previous);
  const a = await render(current, sample.bytes, sample.format), b = await render(baseline, sample.bytes, sample.format);
  assert.deepEqual(a, b);
  report.samples.push({ name: sample.name, format: sample.format, nodeCount: actual.nodeCount, inputSha256: hash(sample.bytes),
    fullModelSha256: hash(JSON.stringify(actual)), fullHtmlSha256: hash(a.html), completeModelAndSvgMatch: true });
}
let seed = 20261024;
const random = limit => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % limit);
for (let index = 0; index < 64; index++) {
  const count = 10 + random(100), nodes = Array.from({ length: count }, (_, id) => ({ id, children: [] }));
  for (let child = 1; child < count; child++) nodes[random(child)].children.push(nodes[child]);
  const xml = node => {
    const tag = random(2) ? 'm:NODE' : 'node';
    return `<${tag}${random(3) === 0 ? ` ID="known-${node.id}"` : ''} TEXT=" Task ${node.id} &amp; 中文 &#10; "><icon BUILTIN="idea"/>${node.children.map(xml).join('')}</${tag}>`;
  };
  const tree = xml(nodes[0]);
  const text = index % 4 === 0 ? tree.replace(/m:/g, '') : `<wrapper xmlns:m="urn:mindmap"><map/><MAP><metadata/>${tree}</MAP></wrapper>`;
  const sample = xmlFixture(`generated-${index}`, 'mm', text);
  const actual = await model(current, sample);
  assert.deepEqual(actual, await model(baseline, sample));
  const a = await render(current, sample.bytes, 'mm'), b = await render(baseline, sample.bytes, 'mm');
  assert.deepEqual(a, b);
  assert.equal(actual.nodeCount, count);
  report.generatedTrees.push({ index, nodeCount: count, inputSha256: hash(sample.bytes), fullModelSha256: hash(JSON.stringify(actual)), fullHtmlSha256: hash(a.html) });
}
for (const sample of samples.filter(sample => ['mixed-mm', 'outline', 'xmind-json', 'xmind-xml', 'mindmanager'].includes(sample.name))) {
  const bytes = sample.bytes, padded = new Uint8Array(bytes.length + 8); padded.set(bytes, 4);
  const variants = { bytes, arrayBuffer: bytes.slice().buffer, offsetView: new DataView(padded.buffer, 4, bytes.length), blob: new Blob([bytes]),
    base64Url: `data:application/octet-stream;base64,${Buffer.from(bytes).toString('base64')}` };
  if (['mm', 'opml'].includes(sample.format)) variants.dataUrl = `data:application/xml,${encodeURIComponent(new TextDecoder().decode(bytes))}`;
  const expected = await render(baseline, bytes, sample.format);
  for (const [name, source] of Object.entries(variants)) {
    assert.deepEqual(await render(current, source, sample.format), expected);
    assert.deepEqual(await render(baseline, source, sample.format), expected);
    report.sourceRepresentations.push({ sample: sample.name, name, fullHtmlSha256: hash(expected.html) });
  }
}
dom.window.close();
const output = path.resolve(root, option('--output', 'tmp/continued-review/mindmap-content-review.json'));
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log({ samples: report.samples.length, generatedTrees: report.generatedTrees.length, sourceRepresentations: report.sourceRepresentations.length });
