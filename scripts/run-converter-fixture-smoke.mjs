import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exampleDir = path.join(rootDir, 'examples', 'go-wazero-converter');
const wasmPath = path.join(rootDir, 'wasm', 'converter-core', 'dist', 'converter-core.wasm');
const manifestPath = path.join(exampleDir, 'fixtures', 'manifest.json');
const reportPath = path.join(exampleDir, 'tmp', 'dist-wasm-smoke-report.json');
const relativeWasmPath = path.relative(exampleDir, wasmPath);

await assertFile(wasmPath, 'converter-core.wasm is missing. Run `npm run build:wasm` first.');

console.log(`Running converter-core dist WASM smoke -> ${path.relative(rootDir, reportPath)}`);

const command = process.platform === 'win32' ? 'go.exe' : 'go';
const exitCode = await run(command, [
  'run',
  './cmd/converter-batch',
  '--wasm',
  relativeWasmPath,
  '--manifest',
  './fixtures/manifest.json',
  '--report',
  './tmp/dist-wasm-smoke-report.json'
]);

if (exitCode !== 0) {
  process.exit(exitCode);
}

const [manifest, report] = await Promise.all([readJSON(manifestPath), readJSON(reportPath)]);
const expectedTotal = Array.isArray(manifest.jobs) ? manifest.jobs.length : 0;
const failures = [];
const contentExpectations = new Map([
  [
    './fixtures/ppt/sample.ppt',
    {
      entry: 'ppt/slides/slide1.xml',
      contains: ['Fixture PPT deck title', 'Fixture PPT bullet']
    }
  ],
  [
    './fixtures/ppt/sample.pps',
    {
      entry: 'ppt/slides/slide1.xml',
      contains: ['Fixture PPS deck title', 'Fixture PPS bullet']
    }
  ],
  [
    './fixtures/ppt/sample.pot',
    {
      entry: 'ppt/slides/slide1.xml',
      contains: ['Fixture POT deck title', 'Fixture POT bullet']
    }
  ],
  [
    './fixtures/ppt/sample.ppsx',
    {
      entry: 'ppt/slides/slide1.xml',
      contains: ['Fixture PPSX slideshow slide']
    }
  ],
  [
    './fixtures/ppt/sample.potx',
    {
      entry: 'ppt/slides/slide1.xml',
      contains: ['Fixture POTX template slide']
    }
  ],
  [
    './fixtures/ppt/sample.dps',
    {
      entry: 'ppt/slides/slide1.xml',
      contains: ['Fixture DPS deck title', 'Fixture DPS bullet']
    }
  ],
  [
    './fixtures/ppt/sample.dpt',
    {
      entry: 'ppt/slides/slide1.xml',
      contains: ['Fixture DPT template title', 'Fixture DPT bullet']
    }
  ],
  [
    './fixtures/ppt/sample.odp',
    {
      entry: 'ppt/slides/slide1.xml',
      contains: ['Fixture OpenDocument presentation sample']
    }
  ],
  [
    './fixtures/ppt/sample.otp',
    {
      entry: 'ppt/slides/slide1.xml',
      contains: ['Fixture OpenDocument presentation sample']
    }
  ],
  [
    './fixtures/ppt/sample.fodp',
    {
      entry: 'ppt/slides/slide1.xml',
      contains: ['Fixture Flat OpenDocument presentation sample']
    }
  ],
  [
    './fixtures/doc/sample.doc',
    {
      entry: 'word/document.xml',
      contains: ['Fixture DOC legacy document', 'WASM core extracts DOC text']
    }
  ],
  [
    './fixtures/doc/sample.dot',
    {
      entry: 'word/document.xml',
      contains: ['Fixture DOT legacy template', 'WASM core extracts DOT text']
    }
  ],
  [
    './fixtures/doc/sample.dotx',
    {
      entry: 'word/document.xml',
      contains: ['Fixture DOTX template document']
    }
  ],
  [
    './fixtures/doc/sample.wps',
    {
      entry: 'word/document.xml',
      contains: ['Fixture WPS legacy document', 'WASM core extracts WPS text']
    }
  ],
  [
    './fixtures/doc/sample.wpt',
    {
      entry: 'word/document.xml',
      contains: ['Fixture WPT legacy template', 'WASM core extracts WPT text']
    }
  ],
  [
    './fixtures/doc/sample.rtf',
    {
      entry: 'word/document.xml',
      contains: ['Fixture RTF document for legacy conversion smoke testing.', 'simple number: 42.', 'A\u2013B']
    }
  ],
  [
    './fixtures/doc/sample.txt',
    {
      entry: 'word/document.xml',
      contains: ['Fixture TXT document', 'This controlled UTF-8 fixture exercises txt']
    }
  ],
  [
    './fixtures/doc/sample.md',
    {
      entry: 'word/document.xml',
      contains: ['Fixture Markdown document', 'Fixture Markdown setext heading', 'Markdown list item', 'Markdown completed task item.', 'fixture paper', 'Inline HTML text with fixture inline image alt', 'Name / Value', 'Fixture table / 42'],
      notContains: ['Fixture Markdown metadata', 'draft:', 'fixture-hidden markdown comment', 'https://example.test', 'Hidden fixture footnote', '[fixture-paper]', '[^fixture]', '[x]', 'fixture-inline.png', '&lt;span', '&lt;img', 'class=', '===', '***', '---:', '| Name |']
    }
  ],
  [
    './fixtures/doc/sample.mkd',
    {
      entry: 'word/document.xml',
      contains: ['Fixture Markdown document', 'Fixture Markdown setext heading', 'Markdown list item', 'Markdown completed task item.', 'fixture paper', 'Inline HTML text with fixture inline image alt', 'Name / Value', 'Fixture table / 42'],
      notContains: ['Fixture Markdown metadata', 'draft:', 'fixture-hidden markdown comment', 'https://example.test', 'Hidden fixture footnote', '[fixture-paper]', '[^fixture]', '[x]', 'fixture-inline.png', '&lt;span', '&lt;img', 'class=', '===', '***', '---:', '| Name |']
    }
  ],
  [
    './fixtures/doc/sample.html',
    {
      entry: 'word/document.xml',
      contains: ['Fixture HTML metadata title', 'Fixture HTML document', 'HTML extractor smoke', 'Fixture HTML chart alt text'],
      notContains: ['fixture-hidden', 'fixture-chart.png', 'color: red', 'hidden &gt; fixture comment']
    }
  ],
  [
    './fixtures/doc/sample.xht',
    {
      entry: 'word/document.xml',
      contains: ['Fixture HTML metadata title', 'Fixture HTML document', 'HTML extractor smoke', 'Fixture HTML chart alt text'],
      notContains: ['fixture-hidden', 'fixture-chart.png', 'color: red', 'hidden &gt; fixture comment']
    }
  ],
  [
    './fixtures/doc/sample.epub',
    {
      entry: 'word/document.xml',
      contains: ['Fixture EPUB chapter one', 'First EPUB body paragraph.', 'Fixture EPUB chapter two', 'Second EPUB body paragraph.'],
      notContains: ['content.opf', 'rootfile', 'application/epub+zip']
    }
  ],
  [
    './fixtures/doc/sample.fb2',
    {
      entry: 'word/document.xml',
      contains: ['Fixture FB2 chapter one', 'First FB2 body paragraph.', 'Fixture FB2 chapter two', 'Second FB2 body paragraph.'],
      notContains: ['Fixture FB2 metadata title', '<binary', 'application/x-fictionbook+xml']
    }
  ],
  [
    './fixtures/doc/sample.xml',
    {
      entry: 'word/document.xml',
      contains: ['Fixture XML document', 'XML parser smoke text.']
    }
  ],
  [
    './fixtures/doc/sample.rss',
    {
      entry: 'word/document.xml',
      contains: ['Fixture RSS feed', 'Fixture RSS item', 'RSS parser smoke text.'],
      notContains: ['&lt;rss', '&lt;channel', '&lt;item']
    }
  ],
  [
    './fixtures/doc/sample.atom',
    {
      entry: 'word/document.xml',
      contains: ['Fixture Atom feed', 'Fixture Atom entry', 'Atom parser smoke text.'],
      notContains: ['&lt;feed', '&lt;entry']
    }
  ],
  [
    './fixtures/doc/sample.kml',
    {
      entry: 'word/document.xml',
      contains: ['Fixture KML place', 'KML parser smoke text.'],
      notContains: ['&lt;kml', '&lt;Placemark']
    }
  ],
  [
    './fixtures/doc/sample.gpx',
    {
      entry: 'word/document.xml',
      contains: ['Fixture GPX track', 'Fixture GPX waypoint'],
      notContains: ['&lt;gpx', '&lt;wpt']
    }
  ],
  [
    './fixtures/doc/sample.ttml',
    {
      entry: 'word/document.xml',
      contains: ['Fixture TTML subtitle text.'],
      notContains: ['&lt;tt', '&lt;p', '00:00:01.000']
    }
  ],
  [
    './fixtures/doc/sample.dfxp',
    {
      entry: 'word/document.xml',
      contains: ['Fixture DFXP subtitle text.'],
      notContains: ['&lt;tt', '&lt;p', '00:00:01.000']
    }
  ],
  [
    './fixtures/doc/sample.xsd',
    {
      entry: 'word/document.xml',
      contains: ['Fixture XSD schema documentation.'],
      notContains: ['&lt;xs:schema', '&lt;xs:element']
    }
  ],
  [
    './fixtures/doc/sample.xsl',
    {
      entry: 'word/document.xml',
      contains: ['Fixture XSLT stylesheet output'],
      notContains: ['&lt;xsl:stylesheet', '&lt;xsl:template']
    }
  ],
  [
    './fixtures/doc/sample.xslt',
    {
      entry: 'word/document.xml',
      contains: ['Fixture XSLT stylesheet output'],
      notContains: ['&lt;xsl:stylesheet', '&lt;xsl:template']
    }
  ],
  [
    './fixtures/doc/sample.wsdl',
    {
      entry: 'word/document.xml',
      contains: ['Fixture WSDL service documentation.'],
      notContains: ['&lt;definitions', '&lt;message']
    }
  ],
  [
    './fixtures/doc/sample.plist',
    {
      entry: 'word/document.xml',
      contains: ['FixtureName', 'Fixture plist value'],
      notContains: ['&lt;plist', '&lt;dict']
    }
  ],
  [
    './fixtures/doc/sample.pom',
    {
      entry: 'word/document.xml',
      contains: ['4.0.0', 'test.fixture', 'fixture-pom-artifact'],
      notContains: ['&lt;project', '&lt;artifactId']
    }
  ],
  [
    './fixtures/doc/sample.cfg',
    {
      entry: 'word/document.xml',
      contains: ['Fixture CFG document', 'This controlled UTF-8 fixture exercises cfg']
    }
  ],
  [
    './fixtures/doc/sample.rest',
    {
      entry: 'word/document.xml',
      contains: ['Fixture REST document', 'This controlled UTF-8 fixture exercises rest']
    }
  ],
  [
    './fixtures/doc/sample.cxx',
    {
      entry: 'word/document.xml',
      contains: ['Fixture CXX document', 'This controlled UTF-8 fixture exercises cxx']
    }
  ],
  [
    './fixtures/doc/sample.csproj',
    {
      entry: 'word/document.xml',
      contains: ['Fixture CSPROJ document', 'This controlled UTF-8 fixture exercises csproj']
    }
  ],
  [
    './fixtures/doc/sample.haml',
    {
      entry: 'word/document.xml',
      contains: ['Fixture HAML document', 'This controlled UTF-8 fixture exercises haml']
    }
  ],
  [
    './fixtures/doc/sample.ipynb',
    {
      entry: 'word/document.xml',
      contains: ['Fixture IPYNB notebook', 'Notebook markdown cell for converter smoke.', 'value = 42', 'stdout value 42', 'result value 84', 'output without source', 'HTML only output'],
      notContains: ['cell_type', 'output_type', 'nbformat']
    }
  ],
  [
    './fixtures/doc/sample.eml',
    {
      entry: 'word/document.xml',
      contains: ['Subject: Fixture EML message', 'Fixture EML message body'],
      notContains: ['FixtureEmailBoundary', 'multipart/alternative', 'MIME-Version']
    }
  ],
  [
    './fixtures/doc/sample.mbox',
    {
      entry: 'word/document.xml',
      contains: ['Message 1', 'Subject: Fixture MBOX first message', 'Fixture MBOX first body', 'Message 2', 'Subject: Fixture MBOX second message', 'Fixture MBOX second body'],
      notContains: ['From sender@example.test', 'MIME-Version', '&lt;html', 'Content-Type:']
    }
  ],
  [
    './fixtures/doc/sample.msg',
    {
      entry: 'word/document.xml',
      contains: ['Subject: Fixture MSG subject', 'From: Fixture MSG sender', 'Fixture MSG body for converter smoke.', 'Second MSG body line.'],
      notContains: ['__substg1.0', '001F']
    }
  ],
  [
    './fixtures/doc/sample.oft',
    {
      entry: 'word/document.xml',
      contains: ['Subject: Fixture OFT subject', 'From: Fixture OFT sender', 'Fixture OFT body for converter smoke.', 'Second OFT body line.'],
      notContains: ['__substg1.0', '001F']
    }
  ],
  [
    './fixtures/doc/sample.ics',
    {
      entry: 'word/document.xml',
      contains: ['Summary: Fixture ICS event', 'Start: 2026-06-14 10:00:00 UTC', 'End: 2026-06-14 06:30:00 America/New_York', 'Location: Preview Lab', 'Organizer: Fixture Organizer &lt;organizer@example.test&gt;', 'Attendee: Fixture Attendee &lt;attendee@example.test&gt;', 'Status: CONFIRMED', 'Categories: Research / Preview', 'URL: https://example.test/meeting', 'Recurrence: FREQ=WEEKLY;COUNT=2'],
      notContains: ['DTEND;TZID', 'BEGIN:VCALENDAR', 'mailto:', 'ORGANIZER;', 'ATTENDEE;', 'CATEGORIES:']
    }
  ],
  [
    './fixtures/doc/sample.vcf',
    {
      entry: 'word/document.xml',
      contains: ['Name: Fixture VCF Contact', 'Email (work): fixture@example.test', 'Phone (cell / voice): +1-555-0100', 'Address (work): 1 Preview Way, Preview City, 10000, Testland', 'Title: A\u2013B', 'Nickname: Fix / Preview', 'Birthday: 1980-01-02', 'Role: Reviewer', 'IM: xmpp:fixture@example.test', 'Categories: Team / Preview', '\u8f7b\u91cf\u89e3\u7801'],
      notContains: ['=E8=BD=BB', 'A=96B', 'QUOTED-PRINTABLE', 'BEGIN:VCARD', 'NICKNAME:', 'BDAY:', 'CATEGORIES:', 'TYPE=', 'EMAIL;', 'TEL;', 'ADR;']
    }
  ],
  [
    './fixtures/doc/sample.srt',
    {
      entry: 'word/document.xml',
      contains: ['Fixture SRT subtitle'],
      notContains: ['\\an8', '&lt;i&gt;', '00:00:00']
    }
  ],
  [
    './fixtures/doc/sample.vtt',
    {
      entry: 'word/document.xml',
      contains: ['Fixture VTT subtitle'],
      notContains: ['WEBVTT', 'cue-1', 'Narrator', '&lt;v', '::cue', 'ignored note', '00:00.000']
    }
  ],
  [
    './fixtures/doc/sample.sbv',
    {
      entry: 'word/document.xml',
      contains: ['Fixture SBV subtitle line one. Fixture SBV subtitle line two.', 'Second SBV cue.'],
      notContains: ['0:00:01.000', '0:00:04.000']
    }
  ],
  [
    './fixtures/doc/sample.ass',
    {
      entry: 'word/document.xml',
      contains: ['Fixture ASS subtitle second line, comma kept'],
      notContains: ['Dialogue:', 'Script Info', '\\an8', '\\N', '0:00:01.00']
    }
  ],
  [
    './fixtures/doc/sample.ssa',
    {
      entry: 'word/document.xml',
      contains: ['Fixture SSA subtitle with comma, preserved'],
      notContains: ['Dialogue:', 'Script Info', '\\i1', '0:00:01.00']
    }
  ],
  [
    './fixtures/doc/sample.gitmodules',
    {
      entry: 'word/document.xml',
      contains: ['vendor/fixture', 'https://example.test/vendor/fixture.git']
    }
  ],
  [
    './fixtures/doc/sample.odt',
    {
      entry: 'word/document.xml',
      contains: ['Fixture OpenDocument text sample for conversion smoke testing.', 'Route target: docx.']
    }
  ],
  [
    './fixtures/doc/sample.ott',
    {
      entry: 'word/document.xml',
      contains: ['Fixture OpenDocument text sample for conversion smoke testing.', 'Route target: docx.']
    }
  ],
  [
    './fixtures/doc/sample.fodt',
    {
      entry: 'word/document.xml',
      contains: ['Fixture Flat OpenDocument text sample for conversion smoke testing.', 'Route target: docx.']
    }
  ],
  [
    './fixtures/doc/sample.mht',
    {
      entry: 'word/document.xml',
      contains: ['Fixture MHTML document', 'MHTML extractor smoke for mht.', 'Fixture MHTML chart alt text'],
      notContains: ['FixtureBoundary', 'fixture-mhtml-chart.png', 'multipart/related', 'MIME-Version']
    }
  ],
  [
    './fixtures/doc/sample.mhtml',
    {
      entry: 'word/document.xml',
      contains: ['Fixture MHTML document', 'MHTML extractor smoke for mhtml.', 'Fixture MHTML chart alt text'],
      notContains: ['FixtureBoundary', 'fixture-mhtml-chart.png', 'multipart/related', 'MIME-Version']
    }
  ],
  [
    './fixtures/xls/sample.xls',
    {
      entry: 'xl/worksheets/sheet1.xml',
      contains: ['Fixture XLS spreadsheet', '42.5']
    }
  ],
  [
    './fixtures/xls/sample.xlt',
    {
      entry: 'xl/worksheets/sheet1.xml',
      contains: ['Fixture XLT template', '44.5']
    }
  ],
  [
    './fixtures/xls/sample.xltx',
    {
      entry: 'xl/worksheets/sheet1.xml',
      contains: ['Fixture XLTX template workbook', '65.5']
    }
  ],
  [
    './fixtures/xls/sample.et',
    {
      entry: 'xl/worksheets/sheet1.xml',
      contains: ['Fixture ET spreadsheet', '43.5']
    }
  ],
  [
    './fixtures/xls/sample.ett',
    {
      entry: 'xl/worksheets/sheet1.xml',
      contains: ['Fixture ETT template', '45.5']
    }
  ],
  [
    './fixtures/xls/sample.ods',
    {
      entry: 'xl/worksheets/sheet1.xml',
      contains: ['Name', '42']
    }
  ],
  [
    './fixtures/xls/sample.ots',
    {
      entry: 'xl/worksheets/sheet1.xml',
      contains: ['Name', '42']
    }
  ],
  [
    './fixtures/xls/sample.fods',
    {
      entry: 'xl/worksheets/sheet1.xml',
      contains: ['Flat Name', '72']
    }
  ],
  [
    './fixtures/xls/sample.dbf',
    {
      entry: 'xl/worksheets/sheet1.xml',
      contains: ['Fixture DBF café – row', '70.5', '2026-06-14', 't="b"><v>1</v>']
    }
  ],
  [
    './fixtures/xls/sample.slk',
    {
      entry: 'xl/worksheets/sheet1.xml',
      contains: ['Fixture SYLK row', '68.5']
    }
  ],
  [
    './fixtures/xls/sample.dif',
    {
      entry: 'xl/worksheets/sheet1.xml',
      contains: ['Fixture DIF row', '69.5']
    }
  ],
  [
    './fixtures/xls/sample.csv',
    {
      entry: 'xl/worksheets/sheet1.xml',
      contains: ['Fixture CSV UTF16 semicolon row', '56.5'],
      notContains: ['sep=', 'Name;Value']
    }
  ],
  [
    './fixtures/xls/sample.tsv',
    {
      entry: 'xl/worksheets/sheet1.xml',
      contains: ['Fixture TSV row', '57.5']
    }
  ],
  [
    './fixtures/xls/sample.tab',
    {
      entry: 'xl/worksheets/sheet1.xml',
      contains: ['Fixture TAB row', '57.75']
    }
  ],
  [
    './fixtures/xls/sample.psv',
    {
      entry: 'xl/worksheets/sheet1.xml',
      contains: ['Fixture PSV row', '58.5']
    }
  ],
  [
    './fixtures/xls/sample.json',
    {
      entry: 'xl/worksheets/sheet1.xml',
      contains: ['Fixture JSON row', 'Second JSON row'],
      notContains: ['rows.1.name', 'rows.2.value']
    }
  ],
  [
    './fixtures/xls/sample.jsonl',
    {
      entry: 'xl/worksheets/sheet1.xml',
      contains: ['Fixture JSONL row', 'Second JSONL row']
    }
  ],
  [
    './fixtures/xls/sample.ndjson',
    {
      entry: 'xl/worksheets/sheet1.xml',
      contains: ['Fixture NDJSON row', 'Second NDJSON row']
    }
  ],
  [
    './fixtures/xls/sample.jsonlines',
    {
      entry: 'xl/worksheets/sheet1.xml',
      contains: ['Fixture JSONLINES row', 'Second JSONLINES row']
    }
  ],
  [
    './fixtures/xls/sample.ldjson',
    {
      entry: 'xl/worksheets/sheet1.xml',
      contains: ['Fixture LDJSON row', 'Second LDJSON row']
    }
  ]
]);

if (!report.ok) {
  failures.push('batch report ok=false');
}
if (report.summary?.total !== expectedTotal) {
  failures.push(`summary.total=${report.summary?.total ?? 'missing'} expected ${expectedTotal}`);
}
if (report.summary?.ok !== expectedTotal || report.summary?.failed !== 0) {
  failures.push(`summary ok/failed mismatch: ${JSON.stringify(report.summary)}`);
}
if (report.summary?.byBackend?.wasi !== expectedTotal) {
  failures.push(`expected all ${expectedTotal} jobs to run through backend "wasi"`);
}

for (const item of report.results ?? []) {
  const outputPath = path.resolve(exampleDir, item.job?.outputPath ?? '');
  try {
    const outputStat = await stat(outputPath);
    if (outputStat.size <= 0) {
      failures.push(`empty output: ${item.job?.outputPath}`);
    }
  } catch {
    failures.push(`missing output: ${item.job?.outputPath}`);
  }
  if (item.result?.ok !== true) {
    failures.push(`failed job: ${item.job?.sourceFormat} -> ${item.job?.targetFormat}`);
  }
  if (item.result?.backend !== 'wasi') {
    failures.push(`unexpected backend for ${item.job?.inputPath}: ${item.result?.backend ?? 'missing'}`);
  }
  if (!item.result?.contentType) {
    failures.push(`missing contentType for ${item.job?.inputPath}`);
  }
  const inputKey = fixtureKey(item.job?.inputPath);
  const expectation = contentExpectations.get(inputKey);
  if (expectation) {
    const warnings = Array.isArray(item.result?.warnings) ? item.result.warnings.join('\n') : '';
    if (warnings.includes('No readable')) {
      failures.push(`unexpected empty-content warning for content-bearing fixture: ${item.job?.inputPath}`);
    }
    try {
      const xml = await readZipTextEntry(outputPath, expectation.entry);
      for (const expectedText of expectation.contains) {
        if (!xml.includes(expectedText)) {
          failures.push(`missing "${expectedText}" in ${item.job?.outputPath}:${expectation.entry}`);
        }
      }
      for (const unexpectedText of expectation.notContains ?? []) {
        if (xml.includes(unexpectedText)) {
          failures.push(`unexpected "${unexpectedText}" in ${item.job?.outputPath}:${expectation.entry}`);
        }
      }
      const outputArchive = await JSZip.loadAsync(await readFile(outputPath));
      const macroEntries = Object.keys(outputArchive.files).filter((name) => /(^|\/)vbaProject\.bin$/i.test(name));
      if (macroEntries.length > 0) {
        failures.push(`macro parts were not stripped from ${item.job?.outputPath}: ${macroEntries.join(', ')}`);
      }
      const contentTypes = await outputArchive.file('[Content_Types].xml')?.async('string');
      if (contentTypes && /macroenabled|vbaproject/i.test(contentTypes)) {
        failures.push(`macro content types were not stripped from ${item.job?.outputPath}`);
      }
    } catch (error) {
      failures.push(`cannot inspect ${item.job?.outputPath}:${expectation.entry}: ${error.message}`);
    }
  }
}

if (failures.length > 0) {
  console.error('converter-core dist WASM smoke failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`converter-core dist WASM smoke passed (${expectedTotal}/${expectedTotal} jobs).`);

async function assertFile(filePath, message) {
  try {
    const fileStat = await stat(filePath);
    if (fileStat.isFile() && fileStat.size > 0) {
      return;
    }
  } catch {
    // Fall through to the shared error message.
  }
  console.error(message);
  process.exit(1);
}

async function readJSON(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function readZipTextEntry(filePath, entryName) {
  const archive = await JSZip.loadAsync(await readFile(filePath));
  const entry = archive.file(entryName);
  if (!entry) {
    throw new Error(`missing ZIP entry ${entryName}`);
  }
  return entry.async('string');
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: exampleDir,
      env: process.env,
      stdio: 'inherit'
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

function fixtureKey(inputPath) {
  const normalized = String(inputPath ?? '').replace(/\\/g, '/');
  const fixtureIndex = normalized.lastIndexOf('fixtures/');
  if (fixtureIndex >= 0) {
    return `./${normalized.slice(fixtureIndex)}`;
  }
  if (normalized.startsWith('./')) {
    return normalized;
  }
  return `./${normalized.replace(/^\/+/, '')}`;
}
