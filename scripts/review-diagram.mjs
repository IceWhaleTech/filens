// Untimed complete model/SVG checks and explicitly expected compatibility corrections.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';
import { deflateSync, strToU8 } from 'fflate';
import { createDrawioFixture, createVisioPage, legacyVdxFixture } from '../packages/diagram/test/fixtures/diagrams.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const currentPath = 'packages/diagram/dist/index.js';
const baselinePath = option('--baseline', 'tmp/continued-review/diagram-baseline/dist/index.js');
const current = await import(pathToFileURL(path.join(root, currentPath)));
const baseline = await import(pathToFileURL(path.resolve(root, baselinePath)));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const dom = new JSDOM(); globalThis.document = dom.window.document; globalThis.DOMParser = dom.window.DOMParser;
const report = { currentArtifactSha256: hash(fs.readFileSync(path.join(root, currentPath))), baselineArtifactSha256: hash(fs.readFileSync(path.resolve(root, baselinePath))),
  samples: [], generatedCases: [], correctedCases: [], sourceRepresentations: [] };
const fixture = (name, format, text) => ({ name, format, bytes: new TextEncoder().encode(text) });
const zipBytes = async text => {
  const zip = new JSZip(); zip.file('visio/pages/page1.xml', text, { date: new Date('2000-01-01T00:00:00Z') });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
};
const vdx = '<VisioDocument><Pages><Page Name="Flow">' + createVisioPage(60) + '</Page></Pages></VisioDocument>';
const graph = createDrawioFixture(60, true).match(/<mxGraphModel>[\s\S]*<\/mxGraphModel>/)[0];
const compressed = Buffer.from(deflateSync(strToU8(encodeURIComponent(graph).replace(/%20/g, '+')))).toString('base64');
const samples = [
  fixture('plain-drawio', 'drawio', createDrawioFixture(80)),
  fixture('html-drawio', 'drawio', createDrawioFixture(80, true).replace('</mxfile>', '<diagram name="More entities"><mxGraphModel><root><mxCell id="extra" vertex="1" value="&amp;copy; &amp;notin; &amp;#128;"><mxGeometry width="120" height="60"/></mxCell></root></mxGraphModel></diagram></mxfile>')),
  fixture('compressed-dio', 'dio', `<mxfile><diagram name="Compressed">${compressed}</diagram></mxfile>`),
  fixture('cell-vdx', 'vdx', vdx),
  { name: 'cell-vsdx', format: 'vsdx', bytes: await zipBytes(createVisioPage(60)) }
];
const demo = fs.readFileSync(path.join(root, 'apps/demo/src/App.vue'), 'utf8');
for (const [name, format] of [['createDrawioFixture', 'drawio'], ['createVdxFixture', 'vdx']]) {
  const match = demo.match(new RegExp(`function ${name}\\(\\): Uint8Array \\{\\s*return new TextEncoder\\(\\)\\.encode\\(\x60([\\s\\S]*?)\x60\\);`));
  assert(match, `Missing demo fixture ${name}`); samples.push(fixture(name, format, match[1]));
}
const sources = JSON.parse(fs.readFileSync(path.join(root, 'tmp/continued-review/diagram-inputs/sources.json')));
for (const source of sources) {
  const bytes = new Uint8Array(fs.readFileSync(path.resolve(root, source.path))); assert.equal(hash(bytes), source.sha256);
  samples.push({ name: source.name, format: 'vsdx', bytes, url: source.url });
}
const model = (lib, sample) => sample.format === 'vsdx' ? lib.loadVsdxDiagram(sample.bytes.slice().buffer)
  : sample.format === 'vdx' ? lib.loadVdxDiagram(new TextDecoder().decode(sample.bytes))
  : lib.loadDrawioDiagram(new TextDecoder().decode(sample.bytes));
async function render(lib, source, format) {
  const host = document.createElement('div');
  const session = lib.createDiagramPreviewDriver().createSession(host, { initialScale: 1, fit: 'none' });
  try {
    await session.load(source, { descriptor: { source, name: `flow.${format}`, extension: format } });
    const pages = [];
    for (let index = 0; index < session.getState().pageCount; index++) {
      session.goToPage(index); pages.push(host.innerHTML);
    }
    return pages;
  } finally { session.destroy(); }
}
async function compare(sample) {
  const actual = await model(current, sample), previous = await model(baseline, sample);
  assert.deepEqual(actual, previous, sample.name);
  const html = await render(current, sample.bytes, sample.format);
  assert.deepEqual(html, await render(baseline, sample.bytes, sample.format), sample.name);
  return { name: sample.name, format: sample.format, inputSha256: hash(sample.bytes), fullModelSha256: hash(JSON.stringify(actual)),
    pageCount: actual.pages.length, nodeCount: actual.pages.reduce((count, page) => count + page.nodes.length, 0),
    fullPageHtmlSha256: html.map(hash), completeModelsAndSvgMatch: true, ...(sample.url ? { url: sample.url } : {}) };
}
for (const sample of samples) report.samples.push(await compare(sample));
let seed = 20261024;
const random = limit => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % limit);
const escape = text => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const labels = ['', 'plain 中文', '<b>Bold</b>', 'A &amp; B', '&lt;b&gt;text&lt;/b&gt;', '&amp;amp;', '&quot; &apos;', '&copy;',
  '&notin;', '&AMP;', '&notit;', 'A&#0;B', '&#x1F600;', '&#128;', '&#x110000;', '&#xD800;', 'A\r\n B', '&amp;&lt;&gt;', '1 < 2', '&unknown;', 'bare &', '&amp;copy;', '&amp;lt; &amp;gt;'];
for (let index = 0; index < 64; index++) {
  let sample;
  if (index % 2) {
    const count = 5 + random(40);
    const text = '<mxGraphModel><root>' + Array.from({ length: count }, (_, i) =>
      `<mxCell id="n${i}" vertex="1" value="${escape(labels[random(labels.length)])}"><mxGeometry x="${random(1000) - 500}" y="${random(1000) - 500}" width="${random(200)}" height="${random(100)}"/></mxCell>`).join('') + '</root></mxGraphModel>';
    sample = fixture(`generated-labels-${index}`, 'drawio', text);
  } else {
    let text = createVisioPage(5 + random(25));
    text = text.replace(/<Cell N="Width" V="1.2"\/>/g, () => `<Cell N="Width" V="${random(3)}"/><Cell N="Width" V="9"/>`);
    text = text.replace(/<Cell N="Height" V="0.6"\/>/g, () => random(2) ? '<Cell N="Height"/>' : '<Cell N="Height" V="0.6"/>');
    sample = fixture(`generated-cells-${index}`, 'vdx', text);
  }
  report.generatedCases.push(await compare(sample));
}
const cellLegacy = legacyVdxFixture.replace(/<(XForm|XForm1D|PageProps|Fill|Line)>([\s\S]*?)<\/\1>/g,
  (_match, _section, body) => body.replace(/<([A-Za-z]+)>([^<]*)<\/\1>/g, (_match, name, value) => `<Cell N="${name}" V="${value}"/>`));
const canonical = cellLegacy.replace('<Shape ID="3" Type="Shape">', '<Shape ID="3" Type="OneD">');
const defaultSize = '<mxGraphModel><root><mxCell id="default" vertex="1" value="Visible"><mxGeometry/></mxCell></root></mxGraphModel>';
for (const [name, format, correctedText, reference] of [
  ['legacy-vdx-geometry', 'vdx', legacyVdxFixture, canonical],
  ['shape-connector', 'vdx', cellLegacy, canonical],
  ['missing-drawio-dimensions', 'drawio', defaultSize, defaultSize.replace('<mxGeometry/>', '<mxGeometry width="120" height="60"/>')]
]) {
  const sample = fixture(name, format, correctedText), expected = fixture(name, format, reference);
  const actual = await model(current, sample), previous = await model(baseline, sample);
  assert.notDeepEqual(actual, previous);
  assert.deepEqual(actual, await model(baseline, expected));
  const html = await render(current, sample.bytes, format);
  assert.deepEqual(html, await render(baseline, expected.bytes, format));
  report.correctedCases.push({ name, inputSha256: hash(sample.bytes), referenceInputSha256: hash(expected.bytes),
    expectedCompleteModelSha256: hash(JSON.stringify(actual)), expectedFullPageHtmlSha256: html.map(hash),
    matchesPreviouslySupportedEquivalent: true, baselineOnOriginalInputWasIncorrect: true });
}
for (const sample of samples.filter(sample => ['html-drawio', 'compressed-dio', 'cell-vdx', 'cell-vsdx'].includes(sample.name))) {
  const bytes = sample.bytes, padded = new Uint8Array(bytes.length + 8); padded.set(bytes, 4);
  const variants = { bytes, arrayBuffer: bytes.slice().buffer, offsetView: new DataView(padded.buffer, 4, bytes.length), blob: new Blob([bytes]),
    base64Url: `data:application/octet-stream;base64,${Buffer.from(bytes).toString('base64')}` };
  if (sample.format !== 'vsdx') variants.dataUrl = `data:application/xml,${encodeURIComponent(new TextDecoder().decode(bytes))}`;
  const expected = await render(baseline, bytes, sample.format);
  for (const [name, source] of Object.entries(variants)) {
    assert.deepEqual(await render(current, source, sample.format), expected);
    assert.deepEqual(await render(baseline, source, sample.format), expected);
    report.sourceRepresentations.push({ sample: sample.name, name, fullPageHtmlSha256: expected.map(hash) });
  }
}
dom.window.close();
const output = path.resolve(root, option('--output', 'tmp/continued-review/diagram-content-review.json'));
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log({ samples: report.samples.length, generatedCases: report.generatedCases.length, correctedCases: report.correctedCases.length, sourceRepresentations: report.sourceRepresentations.length });
