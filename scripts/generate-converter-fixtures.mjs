import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturesDir = path.join(rootDir, 'examples', 'go-wazero-converter', 'fixtures');
const conversionManifestPath = path.join(rootDir, 'wasm', 'converter-core', 'manifest', 'conversions.json');
const checkOnly = process.argv.includes('--check');

const compoundFreeSector = 0xffffffff;
const compoundEndOfChain = 0xfffffffe;
const compoundFATSector = 0xfffffffd;
const compoundDirectoryStream = 2;
const compoundDirectoryRoot = 5;

const WORD_FIXTURES = [
  ['doc/sample.doc', 'Fixture DOC legacy document\rWASM core extracts DOC text\rSecond paragraph: café, 中文, and symbols <>&.\rChecklist: parsing, spacing, and line breaks.'],
  ['doc/sample.dot', 'Fixture DOT legacy template\rWASM core extracts DOT text\rTemplate fields: Customer, Date, Total.\rFooter text exercises repeated paragraphs.'],
  ['doc/sample.wps', 'Fixture WPS legacy document\rWASM core extracts WPS text\rMixed content: 2026-08-03, 42.50%, and 中文.\rFinal paragraph after a blank line.'],
  ['doc/sample.wpt', 'Fixture WPT legacy template\rWASM core extracts WPT text\rSections: Summary, Details, Approval.\rOwner: Preview Team.']
];

const BIFF_FIXTURES = [
  ['xls/sample.xls', 'Fixture XLS spreadsheet', 42.5],
  ['xls/sample.et', 'Fixture ET spreadsheet', 43.5],
  ['xls/sample.xlt', 'Fixture XLT template', 44.5],
  ['xls/sample.ett', 'Fixture ETT template', 45.5]
];

const DOC_TEXT_SOURCE_FORMATS = [
  'txt', 'text', 'md', 'markdown', 'mkd', 'mkdn', 'mdown', 'html', 'htm', 'shtml', 'xhtml', 'xht', 'xhtm', 'epub', 'fb2', 'xml', 'rss', 'atom', 'kml', 'gpx', 'ttml', 'dfxp', 'xsd', 'xsl', 'xslt', 'wsdl', 'plist', 'pom',
  'yaml', 'yml', 'toml', 'ini', 'log', 'rst', 'rest', 'adoc', 'asciidoc', 'asc', 'tex', 'latex', 'ltx', 'sty', 'cls',
  'properties', 'env', 'conf', 'config', 'cfg', 'cnf', 'sql',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts', 'vue',
  'css', 'scss', 'sass', 'less',
  'c', 'cpp', 'cc', 'cxx', 'h', 'hpp', 'hh', 'hxx', 'cs', 'go', 'java', 'kt', 'kts', 'lua', 'php', 'py', 'rb', 'rs',
  'sh', 'bash', 'bat', 'cmd', 'ps1', 'swift',
  'jsonc', 'json5', 'ipynb', 'gql', 'graphql', 'proto', 'diff', 'patch',
  'gitignore', 'dockerignore', 'editorconfig',
  'r', 'dart', 'scala', 'groovy', 'gradle', 'pl', 'ex', 'erl', 'fs', 'fsi', 'fsx', 'vb', 'clj', 'hs', 'jl', 'zig', 'm', 'matlab',
  'svelte', 'astro', 'mdx', 'tf', 'tfvars', 'hcl', 'rego', 'bicep', 'prisma',
  'dockerfile', 'cmake', 'make', 'mk', 'zsh', 'fish',
  'csproj', 'vbproj', 'fsproj', 'props', 'targets', 'sln', 'cshtml', 'razor',
  'mustache', 'hbs', 'liquid', 'jinja', 'twig', 'ejs', 'erb', 'haml', 'slim',
  'mermaid', 'mmd', 'puml', 'avsc', 'sol', 'move', 'nim', 'cr', 'ml', 'mli', 'elm', 'rkt', 'lisp', 'scm',
  'asm', 's', 'cu', 'cuh', 'd', 'pas', 'adb', 'ads', 'cob', 'cbl', 'f90', 'f95',
  'vhd', 'vhdl', 'sv', 'svh', 'ino', 'glsl', 'vert', 'frag', 'wgsl', 'hlsl', 'rmd', 'qmd', 'bib', 'nix', 'cue', 'dhall',
  'org', 'wiki', 'mediawiki', 'textile', 'pod', 'man', 'roff', 'nfo',
  'srt', 'vtt', 'sbv', 'ass', 'ssa', 'ics', 'vcf', 'eml', 'mbox', 'mht', 'mhtml',
  'npmrc', 'yarnrc', 'gitattributes', 'gitmodules'
];
const DOC_TEXT_SOURCE_FORMAT_SET = new Set(DOC_TEXT_SOURCE_FORMATS);
const TABULAR_TEXT_SOURCE_FORMATS = ['csv', 'tsv', 'tab', 'psv', 'json', 'jsonl', 'ndjson', 'jsonlines', 'ldjson'];
const TABULAR_TEXT_SOURCE_FORMAT_SET = new Set(TABULAR_TEXT_SOURCE_FORMATS);
const RAW_SOURCE_FORMATS = ['dng', 'cr2', 'cr3', 'nef', 'nrw', 'arw', 'sr2', 'srf', 'orf', 'rw2', 'rwl', 'raf', 'kdc', 'x3f', 'pef', 'srw', 'erf', 'mef', 'mos', 'mrw', '3fr', 'iiq'];
const RAW_SOURCE_FORMAT_SET = new Set(RAW_SOURCE_FORMATS);
const ICNS_FIXTURES = [
  ['image/sample.icns', icnsFixtureBytes()]
];

const TEXT_FIXTURES = [
  ['doc/sample.rtf', rtfFixtureBytes()],
  ...DOC_TEXT_SOURCE_FORMATS.map((sourceFormat) => [`doc/sample.${sourceFormat}`, textFixtureBytesForFormat(sourceFormat)])
];

const TABULAR_TEXT_FIXTURES = [
  ...TABULAR_TEXT_SOURCE_FORMATS.map((sourceFormat) => [`xls/sample.${sourceFormat}`, tabularTextFixtureBytesForFormat(sourceFormat)])
];

const TABULAR_BACKEND_FIXTURES = [
  ['xls/sample.dbf', buildDBFFileFixture()],
  ['xls/sample.slk', utf8Bytes('ID;P\nC;X1;Y1;K"Name"\nC;X2;Y1;K"Value"\nC;X3;Y1;K"Active"\nC;X1;Y2;K"Fixture SYLK row"\nC;X2;Y2;K68.5\nC;X3;Y2;KTRUE\nC;X1;Y3;K"Unicode café"\nC;X2;Y3;K-7.25\nC;X3;Y3;KFALSE\nE\n')],
  ['xls/sample.dif', utf8Bytes('TABLE\n0,1\n"EXCEL"\nVECTORS\n0,3\n""\nTUPLES\n0,3\n""\nDATA\n0,0\n""\n-1,0\n"BOT"\n1,0\n"Name"\n1,0\n"Value"\n1,0\n"Active"\n-1,0\n"BOT"\n1,0\n"Fixture DIF row"\n0,69.5\n"V"\n1,0\n"true"\n-1,0\n"BOT"\n1,0\n"Second DIF row"\n0,-3.25\n"V"\n1,0\n"false"\n-1,0\n"EOD"\n')]
];

const PPT_FIXTURES = [
  ['ppt/sample.ppt', 'Fixture PPT deck title', 'Fixture PPT bullet'],
  ['ppt/sample.dps', 'Fixture DPS deck title', 'Fixture DPS bullet'],
  ['ppt/sample.dpt', 'Fixture DPT template title', 'Fixture DPT bullet'],
  ['ppt/sample.pps', 'Fixture PPS deck title', 'Fixture PPS bullet'],
  ['ppt/sample.pot', 'Fixture POT deck title', 'Fixture POT bullet']
];

const ODF_PACKAGE_FIXTURES = [
  {
    relativePath: 'doc/sample.odt',
    mimetype: 'application/vnd.oasis.opendocument.text',
    content: buildPackagedODFTextXML('Fixture OpenDocument text sample for conversion smoke testing.', 'Route target: docx.')
  },
  {
    relativePath: 'doc/sample.ott',
    mimetype: 'application/vnd.oasis.opendocument.text-template',
    content: buildPackagedODFTextXML('Fixture OpenDocument text sample for conversion smoke testing.', 'Route target: docx.')
  },
  {
    relativePath: 'doc/sample.sxw',
    mimetype: 'application/vnd.sun.xml.writer',
    content: buildPackagedODFTextXML('Fixture OpenOffice Writer document for conversion smoke testing.', 'Route target: docx.')
  },
  {
    relativePath: 'doc/sample.stw',
    mimetype: 'application/vnd.sun.xml.writer.template',
    content: buildPackagedODFTextXML('Fixture OpenOffice Writer template for conversion smoke testing.', 'Route target: docx.')
  },
  {
    relativePath: 'xls/sample.ods',
    mimetype: 'application/vnd.oasis.opendocument.spreadsheet',
    content: buildPackagedODFSpreadsheetXML('Name', '42')
  },
  {
    relativePath: 'xls/sample.ots',
    mimetype: 'application/vnd.oasis.opendocument.spreadsheet-template',
    content: buildPackagedODFSpreadsheetXML('Name', '42')
  },
  {
    relativePath: 'xls/sample.sxc',
    mimetype: 'application/vnd.sun.xml.calc',
    content: buildPackagedODFSpreadsheetXML('OpenOffice Calc', '84')
  },
  {
    relativePath: 'xls/sample.stc',
    mimetype: 'application/vnd.sun.xml.calc.template',
    content: buildPackagedODFSpreadsheetXML('OpenOffice Calc Template', '96')
  },
  {
    relativePath: 'ppt/sample.odp',
    mimetype: 'application/vnd.oasis.opendocument.presentation',
    content: buildPackagedODFPresentationXML('Fixture OpenDocument presentation sample', 'Route target: pptx.')
  },
  {
    relativePath: 'ppt/sample.otp',
    mimetype: 'application/vnd.oasis.opendocument.presentation-template',
    content: buildPackagedODFPresentationXML('Fixture OpenDocument presentation sample', 'Route target: pptx.')
  },
  {
    relativePath: 'ppt/sample.sxi',
    mimetype: 'application/vnd.sun.xml.impress',
    content: buildPackagedODFPresentationXML('Fixture OpenOffice Impress presentation', 'Route target: pptx.')
  },
  {
    relativePath: 'ppt/sample.sti',
    mimetype: 'application/vnd.sun.xml.impress.template',
    content: buildPackagedODFPresentationXML('Fixture OpenOffice Impress template', 'Route target: pptx.')
  },
  {
    relativePath: 'ppt/sample.odg',
    mimetype: 'application/vnd.oasis.opendocument.graphics',
    content: buildPackagedODFPresentationXML('Fixture OpenDocument drawing', 'Each drawing page becomes a PPTX slide.')
  },
  {
    relativePath: 'ppt/sample.otg',
    mimetype: 'application/vnd.oasis.opendocument.graphics-template',
    content: buildPackagedODFPresentationXML('Fixture OpenDocument drawing template', 'Each drawing page becomes a PPTX slide.')
  },
  {
    relativePath: 'ppt/sample.sxd',
    mimetype: 'application/vnd.sun.xml.draw',
    content: buildPackagedODFPresentationXML('Fixture OpenOffice Draw document', 'Each drawing page becomes a PPTX slide.')
  },
  {
    relativePath: 'ppt/sample.std',
    mimetype: 'application/vnd.sun.xml.draw.template',
    content: buildPackagedODFPresentationXML('Fixture OpenOffice Draw template', 'Each drawing page becomes a PPTX slide.')
  }
];

const ODF_FLAT_FIXTURES = [
  {
    relativePath: 'doc/sample.fodt',
    content: buildPackagedODFTextXML('Fixture Flat OpenDocument text sample for conversion smoke testing.', 'Route target: docx.')
  },
  {
    relativePath: 'xls/sample.fods',
    content: buildPackagedODFSpreadsheetXML('Flat Name', '72')
  },
  {
    relativePath: 'ppt/sample.fodp',
    content: buildPackagedODFPresentationXML('Fixture Flat OpenDocument presentation sample', 'Route target: pptx.')
  },
  {
    relativePath: 'ppt/sample.fodg',
    content: buildPackagedODFPresentationXML('Fixture Flat OpenDocument drawing', 'Each drawing page becomes a PPTX slide.')
  }
];

const OPENXML_PACKAGE_FIXTURES = [
  {
    relativePath: 'doc/sample.docm',
    targetFormat: 'docx',
    mainContentType: 'application/vnd.ms-word.document.macroEnabled.main+xml',
    entries: buildOpenXMLDocxFixtureEntries('Fixture DOCM document')
  },
  {
    relativePath: 'doc/sample.dotx',
    targetFormat: 'docx',
    mainContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml',
    entries: buildOpenXMLDocxFixtureEntries('Fixture DOTX template document')
  },
  {
    relativePath: 'doc/sample.dotm',
    targetFormat: 'docx',
    mainContentType: 'application/vnd.ms-word.template.macroEnabledTemplate.main+xml',
    entries: buildOpenXMLDocxFixtureEntries('Fixture DOTM macro template document')
  },
  {
    relativePath: 'xls/sample.xlsm',
    targetFormat: 'xlsx',
    mainContentType: 'application/vnd.ms-excel.sheet.macroEnabled.main+xml',
    entries: buildOpenXMLXlsxFixtureEntries('Fixture XLSM workbook', '64.5')
  },
  {
    relativePath: 'xls/sample.xltx',
    targetFormat: 'xlsx',
    mainContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml',
    entries: buildOpenXMLXlsxFixtureEntries('Fixture XLTX template workbook', '65.5')
  },
  {
    relativePath: 'xls/sample.xltm',
    targetFormat: 'xlsx',
    mainContentType: 'application/vnd.ms-excel.template.macroEnabled.main+xml',
    entries: buildOpenXMLXlsxFixtureEntries('Fixture XLTM macro template workbook', '66.5')
  },
  {
    relativePath: 'ppt/sample.pptm',
    targetFormat: 'pptx',
    mainContentType: 'application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml',
    entries: buildOpenXMLPptxFixtureEntries('Fixture PPTM macro presentation slide')
  },
  {
    relativePath: 'ppt/sample.potx',
    targetFormat: 'pptx',
    mainContentType: 'application/vnd.openxmlformats-officedocument.presentationml.template.main+xml',
    entries: buildOpenXMLPptxFixtureEntries('Fixture POTX template slide')
  },
  {
    relativePath: 'ppt/sample.ppsx',
    targetFormat: 'pptx',
    mainContentType: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml',
    entries: buildOpenXMLPptxFixtureEntries('Fixture PPSX slideshow slide')
  },
  {
    relativePath: 'ppt/sample.ppsm',
    targetFormat: 'pptx',
    mainContentType: 'application/vnd.ms-powerpoint.slideshow.macroEnabled.main+xml',
    entries: buildOpenXMLPptxFixtureEntries('Fixture PPSM macro slideshow slide')
  },
  {
    relativePath: 'ppt/sample.potm',
    targetFormat: 'pptx',
    mainContentType: 'application/vnd.ms-powerpoint.template.macroEnabled.main+xml',
    entries: buildOpenXMLPptxFixtureEntries('Fixture POTM macro template slide')
  }
];

const fixtureEntries = await buildFixtureEntries();
if (checkOnly) {
  await checkFixtures(fixtureEntries);
} else {
  await writeFixtures(fixtureEntries);
}

async function buildFixtureEntries() {
  const entries = new Map();
  for (const [relativePath, bytes] of [
    ...WORD_FIXTURES.map(([relativePath, text]) => [relativePath, buildWordBinaryCompoundFile(text)]),
    ...BIFF_FIXTURES.map(([relativePath, label, value]) => [relativePath, buildBIFFCompoundFile(label, value)]),
    ['doc/sample.msg', buildOutlookMessageCompoundFile('MSG')],
    ['doc/sample.oft', buildOutlookMessageCompoundFile('OFT')],
    ...TEXT_FIXTURES,
    ...TABULAR_TEXT_FIXTURES,
    ...TABULAR_BACKEND_FIXTURES,
    ...RAW_SOURCE_FORMATS.map((sourceFormat) => [`raw/sample.${sourceFormat}`, rawFixtureBytes()]),
    ...ICNS_FIXTURES,
    ...PPT_FIXTURES.map(([relativePath, title, bullet]) => [relativePath, buildPPTBinaryCompoundFile(title, bullet)])
  ]) {
    entries.set(relativePath, bytes);
  }
  for (const fixture of ODF_PACKAGE_FIXTURES) {
    entries.set(fixture.relativePath, buildODFPackageFixture(fixture.mimetype, fixture.content));
  }
  for (const fixture of ODF_FLAT_FIXTURES) {
    entries.set(fixture.relativePath, utf8Bytes(fixture.content));
  }
  for (const fixture of OPENXML_PACKAGE_FIXTURES) {
    entries.set(fixture.relativePath, buildOpenXMLPackageFixture(fixture.targetFormat, fixture.mainContentType, fixture.entries));
  }
  entries.set('manifest.json', utf8Bytes(`${JSON.stringify(await buildBatchManifest(), null, 2)}\n`));
  return [...entries.entries()];
}

async function buildBatchManifest() {
  const conversions = JSON.parse(await readFile(conversionManifestPath, 'utf8'));
  return {
    defaults: {
      locale: 'zh-CN'
    },
    jobs: conversions.map((pair) => {
      const sourceFormat = normalizeFormat(pair.sourceFormat);
      const targetFormat = normalizeFormat(pair.targetFormat);
      return {
        inputPath: `./fixtures/${fixturePathForSource(sourceFormat)}`,
        outputPath: `./tmp/${fixtureBaseNameForSource(sourceFormat)}.${targetFormat}`,
        sourceFormat,
        targetFormat
      };
    })
  };
}

function fixturePathForSource(sourceFormat) {
  if (DOC_TEXT_SOURCE_FORMAT_SET.has(sourceFormat)) {
    return `doc/sample.${sourceFormat}`;
  }
  if (TABULAR_TEXT_SOURCE_FORMAT_SET.has(sourceFormat)) {
    return `xls/sample.${sourceFormat}`;
  }
  if (RAW_SOURCE_FORMAT_SET.has(sourceFormat)) {
    return `raw/sample.${sourceFormat}`;
  }
  switch (sourceFormat) {
    case 'doc':
    case 'docm':
    case 'dot':
    case 'dotx':
    case 'dotm':
    case 'msg':
    case 'oft':
    case 'wps':
    case 'wpt':
    case 'rtf':
    case 'odt':
    case 'ott':
    case 'fodt':
    case 'sxw':
    case 'stw':
      return `doc/sample.${sourceFormat}`;
    case 'xls':
    case 'xlsm':
    case 'xlt':
    case 'xltx':
    case 'xltm':
    case 'et':
    case 'ett':
    case 'ods':
    case 'ots':
    case 'fods':
    case 'sxc':
    case 'stc':
    case 'dbf':
    case 'slk':
    case 'dif':
      return `xls/sample.${sourceFormat}`;
    case 'ppt':
    case 'pps':
    case 'pot':
    case 'pptm':
    case 'ppsx':
    case 'ppsm':
    case 'potx':
    case 'potm':
    case 'dps':
    case 'dpt':
    case 'odp':
    case 'otp':
    case 'fodp':
    case 'sxi':
    case 'sti':
    case 'odg':
    case 'otg':
    case 'fodg':
    case 'sxd':
    case 'std':
      return `ppt/sample.${sourceFormat}`;
    case 'icns':
      return 'image/sample.icns';
    default:
      throw new Error(`no controlled converter fixture for ${sourceFormat}`);
  }
}

function fixtureBaseNameForSource(sourceFormat) {
  return `sample.${sourceFormat}`;
}

function normalizeFormat(format) {
  return String(format ?? '').trim().replace(/^\./, '').toLowerCase();
}

function rawFixtureBytes() {
  // ponytail: controlled fixtures wrap one JPEG; real camera files live in the demo samples.
  return concatBytes([utf8Bytes('CONTROLLED RAW FIXTURE\n'), jpegFixtureBytes(), utf8Bytes('\nEND RAW FIXTURE')]);
}

function jpegFixtureBytes() {
  return Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD1Dwj4c0O58F6FPPo2nSzS6dbvJJJaozOxjUkkkZJJ70UUVwVfjfqeXW/iS9Wf/9k=', 'base64');
}

function icnsFixtureBytes() {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const chunkLength = 8 + png.byteLength;
  return concatBytes([
    Buffer.from('icns'),
    uint32BE(8 + chunkLength),
    Buffer.from('icp5'),
    uint32BE(chunkLength),
    png
  ]);
}

function uint32BE(value) {
  return Uint8Array.from([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff
  ]);
}

function textFixtureBytesForFormat(sourceFormat) {
  const label = `Fixture ${sourceFormat.toUpperCase()} document`;
  switch (sourceFormat) {
    case 'md':
    case 'markdown':
    case 'mkd':
    case 'mkdn':
    case 'mdown':
      return utf8Bytes(`---
title: Fixture Markdown metadata
draft: true
---

<!-- fixture-hidden markdown comment -->
# Fixture Markdown document

Fixture Markdown setext heading
===============================

- Markdown list item for converter smoke.
- [x] Markdown completed task item.
- Source format: ${sourceFormat}.

This references a [fixture paper][fixture-paper] and a footnote[^fixture].

Inline <span class="fixture-inline">HTML text</span><br>with <img src="fixture-inline.png" alt="fixture inline image alt">.

***

| Name | Value |
| --- | ---: |
| Fixture table | 42 |

[fixture-paper]: https://example.test/fixture-paper
[^fixture]: Hidden fixture footnote.
`);
    case 'html':
    case 'htm':
    case 'shtml':
    case 'xhtml':
    case 'xht':
    case 'xhtm':
      return utf8Bytes(`<!doctype html>
<html>
  <head>
    <title>Fixture HTML metadata title</title>
    <style>.fixture-hidden { color: red; }</style>
  </head>
  <body>
    <!-- hidden > fixture comment -->
    <h1>Fixture HTML document</h1>
    <p>HTML extractor smoke for ${sourceFormat}.</p>
    <img src="fixture-chart.png" alt="Fixture HTML chart alt text">
  </body>
</html>
`);
    case 'mht':
    case 'mhtml':
      return utf8Bytes(buildMHTMLFixture(sourceFormat));
    case 'epub':
      return buildEPUBFixture();
    case 'fb2':
      return utf8Bytes(`<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
  <description>
    <title-info>
      <book-title>Fixture FB2 metadata title</book-title>
      <author><first-name>Fixture</first-name><last-name>Author</last-name></author>
    </title-info>
  </description>
  <body>
    <section>
      <title><p>Fixture FB2 chapter one</p></title>
      <p>First FB2 body paragraph.</p>
      <binary id="cover" content-type="image/png">ignored</binary>
    </section>
    <section>
      <title><p>Fixture FB2 chapter two</p></title>
      <p>Second FB2 body paragraph.</p>
    </section>
  </body>
</FictionBook>
`);
    case 'xml':
      return utf8Bytes(`<?xml version="1.0" encoding="UTF-8"?>
<fixture>
  <title>Fixture XML document</title>
  <body>XML parser smoke text.</body>
</fixture>
`);
    case 'rss':
      return utf8Bytes(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Fixture RSS feed</title>
    <item><title>Fixture RSS item</title><description>RSS parser smoke text.</description></item>
  </channel>
</rss>
`);
    case 'atom':
      return utf8Bytes(`<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Fixture Atom feed</title>
  <entry><title>Fixture Atom entry</title><summary>Atom parser smoke text.</summary></entry>
</feed>
`);
    case 'kml':
      return utf8Bytes(`<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document><Placemark><name>Fixture KML place</name><description>KML parser smoke text.</description></Placemark></Document>
</kml>
`);
    case 'gpx':
      return utf8Bytes(`<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="filens">
  <metadata><name>Fixture GPX track</name></metadata>
  <wpt lat="39.0" lon="116.0"><name>Fixture GPX waypoint</name></wpt>
</gpx>
`);
    case 'ttml':
    case 'dfxp':
      return utf8Bytes(`<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml">
  <body><div><p begin="00:00:01.000" end="00:00:03.000">Fixture ${sourceFormat.toUpperCase()} subtitle text.</p></div></body>
</tt>
`);
    case 'xsd':
      return utf8Bytes(`<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="https://example.test/fixture">
  <xs:element name="fixture" type="xs:string"/>
  <xs:documentation>Fixture XSD schema documentation.</xs:documentation>
</xs:schema>
`);
    case 'xsl':
    case 'xslt':
      return utf8Bytes(`<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="1.0">
  <xsl:template match="/">Fixture XSLT stylesheet output</xsl:template>
</xsl:stylesheet>
`);
    case 'wsdl':
      return utf8Bytes(`<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://schemas.xmlsoap.org/wsdl/" name="FixtureService">
  <documentation>Fixture WSDL service documentation.</documentation>
  <message name="FixtureRequest"/>
</definitions>
`);
    case 'plist':
      return utf8Bytes(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>FixtureName</key><string>Fixture plist value</string></dict></plist>
`);
    case 'pom':
      return utf8Bytes(`<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>test.fixture</groupId>
  <artifactId>fixture-pom-artifact</artifactId>
</project>
`);
    case 'ipynb':
      return utf8Bytes(`${JSON.stringify({
        cells: [
          {
            cell_type: 'markdown',
            metadata: {},
            source: ['# Fixture IPYNB notebook\n', '\n', 'Notebook markdown cell for converter smoke.\n']
          },
          {
            cell_type: 'code',
            execution_count: 1,
            metadata: {},
            outputs: [
              { output_type: 'stream', name: 'stdout', text: ['stdout value 42\n'] },
              { output_type: 'execute_result', execution_count: 1, data: { 'text/plain': ['result value 84'] }, metadata: {} }
            ],
            source: ['value = 42\n', 'print(value)\n']
          },
          {
            cell_type: 'code',
            execution_count: 2,
            metadata: {},
            outputs: [{ output_type: 'stream', name: 'stdout', text: 'output without source' }],
            source: []
          },
          {
            cell_type: 'code',
            execution_count: 3,
            metadata: {},
            outputs: [{ output_type: 'display_data', data: { 'text/html': ['<table><tr><td>HTML only output</td></tr></table>'] }, metadata: {} }],
            source: []
          }
        ],
        metadata: {},
        nbformat: 4,
        nbformat_minor: 5
      }, null, 2)}\n`);
    case 'eml':
      return utf8Bytes(`From: fixtures@example.test
To: preview@example.test
Subject: Fixture EML message
MIME-Version: 1.0
Content-Type: multipart/alternative; boundary="----=_FixtureEmailBoundary"

------=_FixtureEmailBoundary
Content-Type: text/plain; charset="utf-8"

Fixture EML plain body for converter smoke.
------=_FixtureEmailBoundary
Content-Type: text/html; charset="utf-8"

<!doctype html>
<html><body><p>Fixture EML message body for converter smoke.</p></body></html>
------=_FixtureEmailBoundary--
`);
    case 'mbox':
      return utf8Bytes(`From sender@example.test Sun Jun 14 10:00:00 2026
From: fixtures@example.test
To: preview@example.test
Subject: Fixture MBOX first message
MIME-Version: 1.0
Content-Type: text/plain; charset="utf-8"

Fixture MBOX first body for converter smoke.

From sender@example.test Sun Jun 14 10:05:00 2026
From: second@example.test
To: preview@example.test
Subject: Fixture MBOX second message
MIME-Version: 1.0
Content-Type: text/html; charset="utf-8"

<!doctype html>
<html><body><p>Fixture MBOX second body for converter smoke.</p></body></html>
`);
    case 'gitmodules':
      return utf8Bytes(`[submodule "vendor/fixture"]
  path = vendor/fixture
  url = https://example.test/vendor/fixture.git
`);
    case 'gitignore':
      return utf8Bytes(`# Fixture GITIGNORE document
dist/
tmp/
`);
    case 'dockerignore':
      return utf8Bytes(`# Fixture DOCKERIGNORE document
node_modules/
tmp/
`);
    case 'editorconfig':
      return utf8Bytes(`root = true

[*]
charset = utf-8
`);
    case 'env':
      return utf8Bytes(`FIXTURE_ENV=enabled
CONVERTER_ROUTE=docx
`);
    case 'ics':
      return utf8Bytes(`BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
SUMMARY:Fixture ICS event
DTSTART:20260614T100000Z
DTEND;TZID=America/New_York:20260614T063000
LOCATION:Preview Lab
DESCRIPTION:Fixture ICS description\\nSecond line
ORGANIZER;CN=Fixture Organizer:mailto:organizer@example.test
ATTENDEE;CN=Fixture Attendee:mailto:attendee@example.test
STATUS:CONFIRMED
CATEGORIES:Research,Preview
URL:https://example.test/meeting
RRULE:FREQ=WEEKLY;COUNT=2
END:VEVENT
END:VCALENDAR
`);
    case 'vcf':
      return utf8Bytes(`BEGIN:VCARD
VERSION:4.0
FN:Fixture VCF Contact
ORG:Preview Fixtures
TITLE;CHARSET=windows-1252;ENCODING=QUOTED-PRINTABLE:A=96B
NICKNAME:Fix,Preview
BDAY:19800102
ROLE:Reviewer
IMPP:xmpp:fixture@example.test
CATEGORIES:Team,Preview
EMAIL;TYPE=work:fixture@example.test
TEL;CELL;VOICE:+1-555-0100
ADR;TYPE=work:;;1 Preview Way;Preview City;;10000;Testland
NOTE;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=E8=BD=BB=E9=87=8F=
 =E8=A7=A3=E7=A0=81
END:VCARD
`);
    case 'srt':
      return utf8Bytes(`1
00:00:00,000 --> 00:00:02,000
{\\an8}<i>Fixture SRT subtitle</i>
`);
    case 'vtt':
      return utf8Bytes(`WEBVTT - Fixture transcript

STYLE
::cue { color: lime }

cue-1
00:00.000 --> 00:02.000 align:start
<v Narrator>Fixture VTT subtitle</v>

NOTE ignored note
This should not be emitted.
`);
    case 'ass':
      return utf8Bytes(`[Script Info]
Title: Fixture ASS subtitles

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{\\an8}Fixture ASS subtitle\\Nsecond line, comma kept
`);
    case 'ssa':
      return utf8Bytes(`[Script Info]
Title: Fixture SSA subtitles

[Events]
Format: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: Marked=0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{\\i1}Fixture SSA subtitle with comma, preserved
`);
    case 'sbv':
      return utf8Bytes(`0:00:01.000,0:00:03.000
Fixture SBV subtitle line one.
Fixture SBV subtitle line two.

0:00:04.000,0:00:06.000
Second SBV cue.
`);
    default:
      return utf8Bytes(`${label}

This controlled UTF-8 fixture exercises ${sourceFormat} -> docx in the WASM text backend.

Content matrix:
- Unicode: café, 中文, العربية, and emoji 😀.
- Numbers: -42, 0, 3.14159, 6.02e23, 50%, and 2026-08-03T14:30:00+08:00.
- Punctuation: <tag attr="A&B"> 'single' "double" \\ slash / pipe |.
- Whitespace: tab\tseparated, trailing spaces follow  , and a blank line follows.

The final line is intentionally long to exercise wrapping without being pathological: alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega.
`);
  }
}

function buildMHTMLFixture(sourceFormat) {
  return `From: <Saved by filens fixtures>
Subject: Fixture MHTML document
MIME-Version: 1.0
Content-Type: multipart/related; boundary="----=_FixtureBoundary_${sourceFormat.toUpperCase()}"; type="text/html"

------=_FixtureBoundary_${sourceFormat.toUpperCase()}
Content-Type: text/html; charset="utf-8"
Content-Transfer-Encoding: quoted-printable

<!doctype html>
<html>
  <body>
    <h1>Fixture MHTML document</h1>
    <p>MHTML extractor smoke for ${sourceFormat}.</p>
    <img src="fixture-mhtml-chart.png" alt="Fixture MHTML chart alt text">
  </body>
</html>
------=_FixtureBoundary_${sourceFormat.toUpperCase()}--
`;
}

function buildEPUBFixture() {
  return buildStoreZip([
    ['mimetype', utf8Bytes('application/epub+zip')],
    ['META-INF/container.xml', utf8Bytes(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`)],
    ['OPS/content.opf', utf8Bytes(`<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="fixture-id">
  <manifest>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
    <itemref idref="chapter2"/>
  </spine>
</package>
`)],
    ['OPS/chapter1.xhtml', utf8Bytes(`<!doctype html>
<html xmlns="http://www.w3.org/1999/xhtml"><body>
  <h1>Fixture EPUB chapter one</h1>
  <p>First EPUB body paragraph.</p>
</body></html>
`)],
    ['OPS/chapter2.xhtml', utf8Bytes(`<!doctype html>
<html xmlns="http://www.w3.org/1999/xhtml"><body>
  <h2>Fixture EPUB chapter two</h2>
  <p>Second EPUB body paragraph.</p>
</body></html>
`)]
  ]);
}

function tabularTextFixtureBytesForFormat(sourceFormat) {
  switch (sourceFormat) {
    case 'csv':
      return concatBytes([new Uint8Array([0xff, 0xfe]), utf16LEBytes('sep=;\nName;Value;Active;Note\nFixture CSV UTF16 semicolon row;56.5;true;"quoted; delimiter"\nCafé row;-7.25;false;"line one\nline two"\nEmpty value;;true;中文\n')]);
    case 'tsv':
      return utf8Bytes('Name\tValue\tActive\tNote\nFixture TSV row\t57.5\ttrue\ttabular text\nNegative TSV row\t-7.25\tfalse\t中文\nEmpty value\t\ttrue\n');
    case 'tab':
      return utf8Bytes('Name\tValue\tActive\tNote\nFixture TAB row\t57.75\ttrue\ttab alias\nNegative TAB row\t-7.25\tfalse\t中文\nEmpty value\t\ttrue\n');
    case 'psv':
      return utf8Bytes('Name|Value|Active|Note\nFixture PSV row|58.5|true|pipe separated\nNegative PSV row|-7.25|false|中文\nEmpty value||true|\n');
    case 'json':
      return utf8Bytes('{"rows":[{"name":"Fixture JSON row","value":59.5,"active":true},{"name":"Second JSON row","value":60.5,"active":false,"note":"中文"},{"name":"Empty JSON row","value":null,"active":true}]}\n');
    case 'jsonl':
      return utf8Bytes('{"name":"Fixture JSONL row","value":61.5,"active":true}\n{"name":"Second JSONL row","value":62.5,"active":false,"note":"中文"}\n{"name":"Empty JSONL row","value":null,"active":true}\n');
    case 'ndjson':
      return utf8Bytes('{"name":"Fixture NDJSON row","value":63.5,"active":true}\n{"name":"Second NDJSON row","value":64.5,"active":false,"note":"中文"}\n{"name":"Empty NDJSON row","value":null,"active":true}\n');
    case 'jsonlines':
      return utf8Bytes('{"name":"Fixture JSONLINES row","value":65.5,"active":true}\n{"name":"Second JSONLINES row","value":66.5,"active":false,"note":"中文"}\n{"name":"Empty JSONLINES row","value":null,"active":true}\n');
    case 'ldjson':
      return utf8Bytes('{"name":"Fixture LDJSON row","value":67.5,"active":true}\n{"name":"Second LDJSON row","value":68.5,"active":false,"note":"中文"}\n{"name":"Empty LDJSON row","value":null,"active":true}\n');
    default:
      throw new Error(`unsupported tabular text fixture format ${sourceFormat}`);
  }
}


function buildDBFFileFixture() {
  const fields = [
    { name: 'NAME', type: 'C', length: 24, decimals: 0 },
    { name: 'AMOUNT', type: 'N', length: 8, decimals: 2 },
    { name: 'STARTED', type: 'D', length: 8, decimals: 0 },
    { name: 'ACTIVE', type: 'L', length: 1, decimals: 0 }
  ];
  const rows = [
    ['Fixture DBF café – row', '70.5', '20260614', 'T'],
    ['Negative amount', '-12.25', '19991231', 'F'],
    ['Blank values', '', '', '?']
  ];
  const headerLength = 32 + fields.length * 32 + 1;
  const recordLength = 1 + fields.reduce((total, field) => total + field.length, 0);
  const output = new Uint8Array(headerLength + rows.length * recordLength + 1);
  const view = new DataView(output.buffer);
  output[0] = 0x03;
  output[29] = 0x03;
  view.setUint32(4, rows.length, true);
  view.setUint16(8, headerLength, true);
  view.setUint16(10, recordLength, true);

  fields.forEach((field, index) => {
    const offset = 32 + index * 32;
    output.set(new TextEncoder().encode(field.name).subarray(0, 11), offset);
    output[offset + 11] = field.type.charCodeAt(0);
    output[offset + 16] = field.length;
    output[offset + 17] = field.decimals;
  });
  output[32 + fields.length * 32] = 0x0d;

  rows.forEach((row, rowIndex) => {
    let offset = headerLength + rowIndex * recordLength;
    output[offset] = 0x20;
    offset += 1;
    fields.forEach((field, fieldIndex) => {
      const raw = row[fieldIndex] ?? '';
      const value = raw.slice(0, field.length);
      const padding = ' '.repeat(Math.max(0, field.length - value.length));
      const padded = field.type === 'N' || field.type === 'F' ? `${padding}${value}` : `${value}${padding}`;
      output.set(windows1252FixtureBytes(padded).subarray(0, field.length), offset);
      offset += field.length;
    });
  });
  output[output.length - 1] = 0x1a;
  return output;
}

function windows1252FixtureBytes(value) {
  return Uint8Array.from([...value].map((char) => {
    switch (char) {
      case 'é': return 0xe9;
      case '–': return 0x96;
      default: return char.charCodeAt(0) & 0xff;
    }
  }));
}

function buildPackagedODFTextXML(title, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
  <office:body>
    <office:text>
      <text:h text:outline-level="1">${xmlEscape(title)}</text:h>
      <text:p>${xmlEscape(body)}</text:p>
      <text:h text:outline-level="2">Formatting coverage</text:h>
      <text:p>Unicode: café, 中文, العربية. Values: -42, 3.14159, 50%.</text:p>
      <text:list><text:list-item><text:p>First list item</text:p></text:list-item><text:list-item><text:p>Second list item</text:p></text:list-item></text:list>
      <text:p>Final paragraph after structured content.</text:p>
    </office:text>
  </office:body>
</office:document-content>
`;
}


function buildPackagedODFSpreadsheetXML(label, value) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
  <office:body>
    <office:spreadsheet>
      <table:table table:name="Legacy OOo Sheet">
        <table:table-row><table:table-cell office:value-type="string"><text:p>Name</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Value</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Active</text:p></table:table-cell></table:table-row>
        <table:table-row><table:table-cell office:value-type="string"><text:p>${xmlEscape(label)}</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="${xmlEscape(value)}"><text:p>${xmlEscape(value)}</text:p></table:table-cell><table:table-cell office:value-type="boolean" office:boolean-value="true"><text:p>TRUE</text:p></table:table-cell></table:table-row>
        <table:table-row><table:table-cell office:value-type="string"><text:p>Negative 中文</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="-7.25"><text:p>-7.25</text:p></table:table-cell><table:table-cell office:value-type="boolean" office:boolean-value="false"><text:p>FALSE</text:p></table:table-cell></table:table-row>
        <table:table-row><table:table-cell office:value-type="string"><text:p>Blank value</text:p></table:table-cell><table:table-cell/><table:table-cell office:value-type="string"><text:p>trailing row</text:p></table:table-cell></table:table-row>
      </table:table>
    </office:spreadsheet>
  </office:body>
</office:document-content>
`;
}

function buildPackagedODFPresentationXML(title, subtitle) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
  <office:body>
    <office:presentation>
      <draw:page draw:name="Fixture Slide">
        <text:p>${xmlEscape(title)}</text:p>
        <text:p>${xmlEscape(subtitle)}</text:p>
        <text:p>Bullet 1: Unicode 中文 and 50%.</text:p>
        <text:p>Bullet 2: long wrapping text for presentation conversion coverage.</text:p>
      </draw:page>
      <draw:page draw:name="Fixture Slide 2"><text:p>Second slide</text:p><text:p>Closing summary with -42 and 3.14159.</text:p></draw:page>
    </office:presentation>
  </office:body>
</office:document-content>
`;
}


function buildODFPackageFixture(mimetype, contentXML) {
  return buildStoreZip([
    ['mimetype', utf8Bytes(mimetype)],
    ['content.xml', utf8Bytes(contentXML)],
    ['META-INF/manifest.xml', utf8Bytes(buildODFManifestXML(mimetype))]
  ]);
}

function buildODFManifestXML(mimetype) {
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">` +
    `<manifest:file-entry manifest:full-path="/" manifest:media-type="${xmlEscape(mimetype)}"/>` +
    `<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>` +
    `</manifest:manifest>`;
}


function buildOpenXMLPackageFixture(targetFormat, mainContentType, entries) {
  const mainPart = openXMLMainPartForTarget(targetFormat);
  const packageEntries = new Map(entries);
  packageEntries.set('[Content_Types].xml', buildOpenXMLContentTypesXML(mainPart, mainContentType, packageEntries));
  packageEntries.set('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${xmlEscape(mainPart)}"/>
</Relationships>
`);
  return buildStoreZip([...packageEntries.entries()].map(([name, content]) => [name, utf8Bytes(content)]));
}

function buildOpenXMLContentTypesXML(mainPart, mainContentType, entries) {
  const overrides = [`  <Override PartName="/${xmlEscape(mainPart)}" ContentType="${xmlEscape(mainContentType)}"/>`];
  for (const name of entries.keys()) {
    if (name === mainPart || name === '[Content_Types].xml' || name.endsWith('.rels')) {
      continue;
    }
    const contentType = openXMLPartContentType(name);
    if (contentType) {
      overrides.push(`  <Override PartName="/${xmlEscape(name)}" ContentType="${contentType}"/>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
${overrides.join('\n')}
</Types>
`;
}

function openXMLMainPartForTarget(targetFormat) {
  switch (targetFormat) {
    case 'docx':
      return 'word/document.xml';
    case 'xlsx':
      return 'xl/workbook.xml';
    case 'pptx':
      return 'ppt/presentation.xml';
    default:
      throw new Error(`unsupported OpenXML target fixture ${targetFormat}`);
  }
}

function openXMLPartContentType(name) {
  if (/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
  }
  if (/^ppt\/slides\/slide\d+\.xml$/.test(name)) {
    return 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';
  }
  return '';
}

function buildOpenXMLDocxFixtureEntries(text) {
  return [
    ['word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>${xmlEscape(text)}</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold lead-in</w:t></w:r><w:r><w:t xml:space="preserve"> with Unicode 中文, 50%, and &lt;&gt;&amp;.</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Name</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Value</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Fixture row</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>-42.5</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:r><w:br w:type="page"/></w:r></w:p>
    <w:p><w:r><w:t>Second page closing paragraph.</w:t></w:r></w:p>
  </w:body>
</w:document>
`]
  ];
}

function buildOpenXMLXlsxFixtureEntries(label, value) {
  return [
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Data 中文" sheetId="2" r:id="rId2"/></sheets>
</workbook>
`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>
`],
    ['xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1" t="inlineStr"><is><t>Value</t></is></c><c r="C1" t="inlineStr"><is><t>Active</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>${xmlEscape(label)}</t></is></c><c r="B2"><v>${xmlEscape(value)}</v></c><c r="C2" t="b"><v>1</v></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>Negative 中文</t></is></c><c r="B3"><v>-7.25</v></c><c r="C3" t="b"><v>0</v></c></row>
    <row r="4"><c r="A4" t="inlineStr"><is><t>Formula</t></is></c><c r="B4"><f>SUM(B2:B3)</f><v>58.25</v></c></row>
  </sheetData>
</worksheet>
`],
    ['xl/worksheets/sheet2.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Blank</t></is></c><c r="C1" t="inlineStr"><is><t>Trailing cell</t></is></c></row></sheetData>
</worksheet>
`]
  ];
}

function buildOpenXMLPptxFixtureEntries(text) {
  return [
    ['ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
</p:presentation>
`],
    ['ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>
`],
    ['ppt/slides/slide1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr b="1"/><a:t>${xmlEscape(text)}</a:t></a:r></a:p><a:p><a:r><a:t>Unicode 中文, 50%, and &lt;&gt;&amp;.</a:t></a:r></a:p><a:p><a:r><a:t>Second bullet with enough text to exercise wrapping.</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Footer: 2026-08-03</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>
`]
  ];
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function utf8Bytes(value) {
  return new TextEncoder().encode(value);
}

function rtfFixtureBytes() {
  return concatBytes([
    utf8Bytes('{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\fs24 Fixture RTF document for legacy conversion smoke testing.\\par This file exercises the rtf -> docx route with a simple number: 42. More values: -42, 3.14159, and 50%.\\par \\b Bold text\\b0 , \\i italic text\\i0 , a tab\\tab separated value, and ANSI dash: A'),
    new Uint8Array([0x96]),
    utf8Bytes('B.\\par \\bullet First list-like item.\\par \\bullet Second item after a line break.\\page Second page closing paragraph.\\par}\\n')
  ]);
}

function buildStoreZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameBytes = encoder.encode(name);
    const crc = crc32(content);
    const local = new Uint8Array(30 + nameBytes.byteLength + content.byteLength);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0x21, true);
    localView.setUint16(14, 0x5021, true);
    localView.setUint32(16, crc, true);
    localView.setUint32(18, content.byteLength, true);
    localView.setUint32(22, content.byteLength, true);
    localView.setUint16(26, nameBytes.byteLength, true);
    local.set(nameBytes, 30);
    local.set(content, 30 + nameBytes.byteLength);
    localParts.push(local);

    const central = new Uint8Array(46 + nameBytes.byteLength);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(12, 0x21, true);
    centralView.setUint16(14, 0x5021, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, content.byteLength, true);
    centralView.setUint32(24, content.byteLength, true);
    centralView.setUint16(28, nameBytes.byteLength, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += local.byteLength;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((total, part) => total + part.byteLength, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);
  return concatBytes([...localParts, ...centralParts, end]);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function checkFixtures(entries) {
  const failures = [];
  for (const [relativePath, expectedBytes] of entries) {
    const outputPath = path.join(fixturesDir, relativePath);
    try {
      const actualBytes = await readFile(outputPath);
      if (!Buffer.from(expectedBytes).equals(actualBytes)) {
        failures.push(`${relativePath} differs from scripts/generate-converter-fixtures.mjs output`);
      }
    } catch (error) {
      failures.push(`${relativePath} is missing or unreadable: ${error.message}`);
    }
  }
  if (failures.length > 0) {
    console.error('Controlled converter fixture check failed:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    console.error('Run `npm run fixtures:converter` to regenerate these fixtures.');
    process.exit(1);
  }
  console.log(`Checked ${entries.length} controlled converter fixtures.`);
}

async function writeFixtures(entries) {
  for (const [relativePath, bytes] of entries) {
    await writeFixture(relativePath, bytes);
  }
  console.log(`Generated ${entries.length} controlled converter fixtures.`);
}

async function writeFixture(relativePath, bytes) {
  const outputPath = path.join(fixturesDir, relativePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, bytes);
}

function buildWordBinaryCompoundFile(text) {
  const textOffset = 0x01c0;
  const encoded = utf16LEBytes(text);
  const wordDocumentSize = Math.max(512, textOffset + encoded.byteLength + 16);
  const wordDocument = new Uint8Array(wordDocumentSize);
  const wordView = new DataView(wordDocument.buffer);

  wordView.setUint16(0, 0xa5ec, true);
  wordView.setUint16(0x0a, 0x0200, true);
  wordDocument.set(encoded, textOffset);

  const tableStream = new Uint8Array(128);
  const tableView = new DataView(tableStream.buffer);
  const plc = new Uint8Array(16);
  const plcView = new DataView(plc.buffer);
  plcView.setUint32(0, 0, true);
  plcView.setUint32(4, text.length, true);
  plcView.setUint32(10, textOffset, true);
  tableStream[0] = 0x02;
  tableView.setUint32(1, plc.byteLength, true);
  tableStream.set(plc, 5);
  wordView.setUint32(0x01a2, 0, true);
  wordView.setUint32(0x01a6, 5 + plc.byteLength, true);

  return buildCompoundFileWithStreams({
    WordDocument: wordDocument,
    '1Table': tableStream
  });
}

function buildBIFFCompoundFile(label, value) {
  const workbook = concatBytes([
    buildBIFFRecord(0x0809, new Uint8Array([0, 0, 0, 0])),
    buildBIFFRecord(0x0204, buildBIFFLabelRecord(0, 0, 'Name')),
    buildBIFFRecord(0x0204, buildBIFFLabelRecord(0, 1, 'Value')),
    buildBIFFRecord(0x0204, buildBIFFLabelRecord(0, 2, 'Active')),
    buildBIFFRecord(0x0204, buildBIFFLabelRecord(1, 0, label)),
    buildBIFFRecord(0x0203, buildBIFFNumberRecord(1, 1, value)),
    buildBIFFRecord(0x0204, buildBIFFLabelRecord(1, 2, 'TRUE')),
    buildBIFFRecord(0x0204, buildBIFFLabelRecord(2, 0, 'Negative row')),
    buildBIFFRecord(0x0203, buildBIFFNumberRecord(2, 1, -7.25)),
    buildBIFFRecord(0x0204, buildBIFFLabelRecord(2, 2, 'FALSE')),
    buildBIFFRecord(0x000a, new Uint8Array())
  ]);
  return buildCompoundFileWithStreams({ Workbook: workbook });
}

function buildPPTBinaryCompoundFile(title, bullet) {
  const presentation = buildPPTRecord(
    1000,
    true,
    buildPPTRecord(4000, false, utf16LEBytes(title)),
    buildPPTRecord(4008, false, new TextEncoder().encode(bullet)),
    buildPPTRecord(4000, false, utf16LEBytes('Unicode 中文 and 50%')),
    buildPPTRecord(4008, false, new TextEncoder().encode('Second bullet with wrapping coverage'))
  );
  return buildCompoundFileWithStreams({ 'PowerPoint Document': presentation });
}

function buildOutlookMessageCompoundFile(label) {
  return buildCompoundFileWithStreams({
    '__substg1.0_0037001F': utf16LEBytes(`Fixture ${label} subject`),
    '__substg1.0_0C1A001F': utf16LEBytes(`Fixture ${label} sender`),
    '__substg1.0_1000001F': utf16LEBytes(`Fixture ${label} body for converter smoke.\r\nSecond ${label} body line. Unicode 中文 and 50%.\r\n\r\nChecklist:\r\n- preserve blank lines\r\n- preserve punctuation <>&\r\n- preserve the closing line`)
  });
}


function buildCompoundFileWithStreams(streams) {
  const sectorSize = 512;
  const directorySector = 0;
  const fatSector = 1;
  const firstStreamSector = 2;
  const streamNames = Object.keys(streams).sort();
  if (streamNames.length > 3) {
    throw new Error(`Compound helper supports at most 3 streams, got ${streamNames.length}.`);
  }

  const layouts = new Map();
  let sectorCount = firstStreamSector;
  for (const streamName of streamNames) {
    const stream = streams[streamName] ?? new Uint8Array();
    const streamSectorCount = Math.max(1, Math.ceil(stream.byteLength / sectorSize));
    layouts.set(streamName, {
      startSector: sectorCount,
      sectorCount: streamSectorCount
    });
    sectorCount += streamSectorCount;
  }

  const bytes = new Uint8Array(512 + sectorCount * sectorSize);
  const view = new DataView(bytes.buffer);

  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  view.setUint16(0x18, 0x003e, true);
  view.setUint16(0x1a, 3, true);
  view.setUint16(0x1c, 0xfffe, true);
  view.setUint16(0x1e, 9, true);
  view.setUint16(0x20, 6, true);
  view.setUint32(0x2c, 1, true);
  view.setUint32(0x30, directorySector, true);
  view.setUint32(0x38, 4096, true);
  view.setUint32(0x3c, compoundEndOfChain, true);
  view.setUint32(0x44, compoundEndOfChain, true);
  view.setUint32(0x4c, fatSector, true);
  for (let headerOffset = 0x50; headerOffset + 4 <= 0x200; headerOffset += 4) {
    view.setUint32(headerOffset, compoundFreeSector, true);
  }

  const directoryOffset = 512 + directorySector * sectorSize;
  writeCompoundDirectoryEntry(bytes, directoryOffset, 0, 'Root Entry', compoundDirectoryRoot, compoundEndOfChain, 0);
  streamNames.forEach((streamName, streamIndex) => {
    const layout = layouts.get(streamName);
    writeCompoundDirectoryEntry(
      bytes,
      directoryOffset,
      streamIndex + 1,
      streamName,
      compoundDirectoryStream,
      layout?.startSector ?? compoundEndOfChain,
      streams[streamName]?.byteLength ?? 0
    );
    bytes.set(streams[streamName] ?? new Uint8Array(), 512 + (layout?.startSector ?? 0) * sectorSize);
  });

  const fatOffset = 512 + fatSector * sectorSize;
  for (let fatEntryOffset = 0; fatEntryOffset < sectorSize; fatEntryOffset += 4) {
    view.setUint32(fatOffset + fatEntryOffset, compoundFreeSector, true);
  }
  view.setUint32(fatOffset + directorySector * 4, compoundEndOfChain, true);
  view.setUint32(fatOffset + fatSector * 4, compoundFATSector, true);
  streamNames.forEach((streamName) => {
    const layout = layouts.get(streamName);
    if (!layout) {
      return;
    }
    for (let index = 0; index < layout.sectorCount; index += 1) {
      const sector = layout.startSector + index;
      const next = index + 1 < layout.sectorCount ? sector + 1 : compoundEndOfChain;
      view.setUint32(fatOffset + sector * 4, next, true);
    }
  });

  return bytes;
}

function utf16LEBytes(text) {
  const bytes = new Uint8Array(text.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < text.length; index += 1) {
    view.setUint16(index * 2, text.charCodeAt(index), true);
  }
  return bytes;
}

function buildBIFFRecord(id, data) {
  const record = new Uint8Array(4 + data.byteLength);
  const view = new DataView(record.buffer);
  view.setUint16(0, id, true);
  view.setUint16(2, data.byteLength, true);
  record.set(data, 4);
  return record;
}

function buildBIFFLabelRecord(row, col, value) {
  const encoded = new TextEncoder().encode(value);
  const data = new Uint8Array(6 + 3 + encoded.byteLength);
  const view = new DataView(data.buffer);
  view.setUint16(0, row, true);
  view.setUint16(2, col, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, value.length, true);
  data[8] = 0;
  data.set(encoded, 9);
  return data;
}

function buildBIFFNumberRecord(row, col, value) {
  const data = new Uint8Array(14);
  const view = new DataView(data.buffer);
  view.setUint16(0, row, true);
  view.setUint16(2, col, true);
  view.setUint16(4, 0, true);
  view.setFloat64(6, value, true);
  return data;
}

function buildPPTRecord(recordType, container, ...payloads) {
  const size = payloads.reduce((total, payload) => total + payload.byteLength, 0);
  const output = new Uint8Array(8 + size);
  const view = new DataView(output.buffer);
  view.setUint16(0, container ? 0x000f : 0, true);
  view.setUint16(2, recordType, true);
  view.setUint32(4, size, true);
  let offset = 8;
  for (const payload of payloads) {
    output.set(payload, offset);
    offset += payload.byteLength;
  }
  return output;
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function writeCompoundDirectoryEntry(bytes, directoryOffset, index, name, entryType, startSector, size) {
  const view = new DataView(bytes.buffer);
  const recordOffset = directoryOffset + index * 128;
  for (let charIndex = 0; charIndex < name.length; charIndex += 1) {
    view.setUint16(recordOffset + charIndex * 2, name.charCodeAt(charIndex), true);
  }
  view.setUint16(recordOffset + name.length * 2, 0, true);
  view.setUint16(recordOffset + 0x40, (name.length + 1) * 2, true);
  bytes[recordOffset + 0x42] = entryType;
  bytes[recordOffset + 0x43] = 1;
  view.setUint32(recordOffset + 0x44, compoundFreeSector, true);
  view.setUint32(recordOffset + 0x48, compoundFreeSector, true);
  view.setUint32(recordOffset + 0x4c, compoundFreeSector, true);
  view.setUint32(recordOffset + 0x74, startSector, true);
  view.setUint32(recordOffset + 0x78, size, true);
}
