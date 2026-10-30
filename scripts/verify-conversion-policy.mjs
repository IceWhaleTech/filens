import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const expectedConversions = [
  ['docx', 'docx'],
  ['xlsx', 'xlsx'],
  ['pptx', 'pptx'],
  ['ppt', 'pptx'],
  ['pps', 'pptx'],
  ['pot', 'pptx'],
  ['pptm', 'pptx'],
  ['ppsx', 'pptx'],
  ['ppsm', 'pptx'],
  ['potx', 'pptx'],
  ['potm', 'pptx'],
  ['dps', 'pptx'],
  ['dpt', 'pptx'],
  ['odp', 'pptx'],
  ['otp', 'pptx'],
  ['fodp', 'pptx'],
  ['sxi', 'pptx'],
  ['sti', 'pptx'],
  ['odg', 'pptx'],
  ['otg', 'pptx'],
  ['fodg', 'pptx'],
  ['sxd', 'pptx'],
  ['std', 'pptx'],
  ['doc', 'docx'],
  ['docm', 'docx'],
  ['dot', 'docx'],
  ['dotx', 'docx'],
  ['dotm', 'docx'],
  ['wps', 'docx'],
  ['wpt', 'docx'],
  ['rtf', 'docx'],
  ['odt', 'docx'],
  ['ott', 'docx'],
  ['fodt', 'docx'],
  ['sxw', 'docx'],
  ['stw', 'docx'],
  ...[
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
    'srt', 'vtt', 'sbv', 'ass', 'ssa', 'ics', 'vcf', 'eml', 'mbox', 'msg', 'oft', 'mht', 'mhtml',
    'npmrc', 'yarnrc', 'gitattributes', 'gitmodules'
  ].map((sourceFormat) => [sourceFormat, 'docx']),
  ['xls', 'xlsx'],
  ['xlsm', 'xlsx'],
  ['xlt', 'xlsx'],
  ['xltx', 'xlsx'],
  ['xltm', 'xlsx'],
  ['et', 'xlsx'],
  ['ett', 'xlsx'],
  ['ods', 'xlsx'],
  ['ots', 'xlsx'],
  ['fods', 'xlsx'],
  ['sxc', 'xlsx'],
  ['stc', 'xlsx'],
  ['dbf', 'xlsx'],
  ['slk', 'xlsx'],
  ['dif', 'xlsx'],
  ...['csv', 'tsv', 'tab', 'psv', 'json', 'jsonl', 'ndjson', 'jsonlines', 'ldjson'].map((sourceFormat) => [sourceFormat, 'xlsx']),
  ...['dng', 'cr2', 'cr3', 'nef', 'nrw', 'arw', 'sr2', 'srf', 'orf', 'rw2', 'rwl', 'raf', 'kdc', 'x3f', 'pef', 'srw', 'erf', 'mef', 'mos', 'mrw', '3fr', 'iiq']
    .map((sourceFormat) => [sourceFormat, 'jpg']),
  ['icns', 'png'],
  ['ppm', 'png']
];

const expectedErrorCodes = [
  ['ErrorCodeUnsupportedFormat', 'unsupported_format'],
  ['ErrorCodePasswordRequired', 'password_required'],
  ['ErrorCodePasswordInvalid', 'password_invalid'],
  ['ErrorCodeParse', 'parse_error'],
  ['ErrorCodeConversionFailed', 'conversion_failed'],
  ['ErrorCodeIO', 'io_error'],
  ['ErrorCodeEngineUnavailable', 'engine_unavailable']
];

const forbiddenDefaultSources = [
  'wbk',
  'dotm',
  'ppsm',
  'potm',
  'pptm',
  'sxi',
  'sti',
  'odg',
  'otg',
  'fodg',
  'sxd',
  'std',
  'xltm',
  'xlam',
  'xlk',
  'xla',
  'sxc',
  'stc',
  'csv',
  'tsv',
  'psv',
  'json',
  'jsonl',
  'ndjson',
  'txt',
  'md',
  'html',
  'htm',
  'fb2',
  'xml',
  'yaml',
  'yml',
  'toml',
  'ini',
  'log',
  'rst',
  'adoc',
  'asciidoc',
  'tex',
  'properties',
  'env',
  'conf',
  'config',
  'sql',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'mts',
  'cts',
  'vue',
  'css',
  'scss',
  'sass',
  'less',
  'c',
  'cpp',
  'h',
  'hpp',
  'cs',
  'go',
  'java',
  'kt',
  'kts',
  'lua',
  'php',
  'py',
  'rb',
  'rs',
  'sh',
  'bat',
  'cmd',
  'ps1',
  'swift',
  'jsonc',
  'json5',
  'ipynb',
  'gql',
  'graphql',
  'proto',
  'diff',
  'patch',
  'gitignore',
  'dockerignore',
  'editorconfig',
  'r',
  'dart',
  'scala',
  'groovy',
  'gradle',
  'pl',
  'ex',
  'erl',
  'fs',
  'vb',
  'clj',
  'hs',
  'jl',
  'zig',
  'svelte',
  'astro',
  'mdx',
  'tf',
  'tfvars',
  'hcl',
  'rego',
  'bicep',
  'prisma',
  'dockerfile',
  'cmake',
  'make',
  'mk',
  'bash',
  'zsh',
  'fish',
  'mustache',
  'hbs',
  'liquid',
  'jinja',
  'twig',
  'ejs',
  'erb',
  'mermaid',
  'mmd',
  'puml',
  'avsc',
  'sol',
  'move',
  'nim',
  'cr',
  'ml',
  'mli',
  'elm',
  'rkt',
  'lisp',
  'scm',
  'asm',
  's',
  'cu',
  'cuh',
  'd',
  'pas',
  'adb',
  'ads',
  'cob',
  'cbl',
  'f90',
  'f95',
  'vhd',
  'vhdl',
  'sv',
  'svh',
  'ino',
  'glsl',
  'vert',
  'frag',
  'wgsl',
  'hlsl',
  'rmd',
  'qmd',
  'bib',
  'nix',
  'cue',
  'dhall',
  'org',
  'wiki',
  'mediawiki',
  'textile',
  'pod',
  'man',
  'roff',
  'nfo',
  'srt',
  'vtt',
  'ics',
  'vcf',
  'eml',
  'mbox',
  'msg',
  'oft',
  'mht',
  'mhtml',
  'npmrc',
  'yarnrc',
  'gitattributes',
  'gitmodules',
  'dwg',
  'step',
  'stp',
  'glb',
  'gltf',
  'xmind',
  'drawio',
  'graffle',
  'pages',
  'key',
  'numbers',
  'heic',
  'jpg',
  'jpeg',
  'webp',
  'svg',
  'bmp',
  'avif',
  'zip',
  'rar',
  '7z',
  'mkv'
];
const expectedConversionSources = new Set(expectedConversions.map(([sourceFormat]) => sourceFormat));
const forbiddenManifestSources = forbiddenDefaultSources.filter((sourceFormat) => !expectedConversionSources.has(sourceFormat));

const allowedTargets = new Set(['pptx', 'docx', 'xlsx', 'jpg', 'png']);
const rawSources = new Set(['dng', 'cr2', 'cr3', 'nef', 'nrw', 'arw', 'sr2', 'srf', 'orf', 'rw2', 'rwl', 'raf', 'kdc', 'x3f', 'pef', 'srw', 'erf', 'mef', 'mos', 'mrw', '3fr', 'iiq']);
const failures = [];
let checkCount = 0;

function check(condition, message) {
  checkCount += 1;
  if (!condition) {
    failures.push(message);
  }
}

function normalizeFormat(format) {
  return String(format ?? '').trim().replace(/^\./, '').toLowerCase();
}

function pairKey(pair) {
  return `${pair.sourceFormat}->${pair.targetFormat}`;
}

async function readText(relativePath) {
  return fs.readFile(path.join(rootDir, relativePath), 'utf8');
}

async function readJson(relativePath) {
  return JSON.parse(await readText(relativePath));
}

function normalizePairs(pairs) {
  return pairs.map((pair) => ({
    sourceFormat: normalizeFormat(pair.sourceFormat),
    targetFormat: normalizeFormat(pair.targetFormat)
  }));
}

async function verifyManifest() {
  const manifest = await readJson('wasm/converter-core/manifest/conversions.json');
  const imageManifest = await readJson('wasm/converter-image/manifest/conversions.json');
  const fixtureManifest = await readJson('examples/go-wazero-converter/fixtures/manifest.json');
  const normalized = normalizePairs(manifest);
  const normalizedImage = normalizePairs(imageManifest);
  const fixturePairs = normalizePairs(fixtureManifest.jobs ?? []);
  const expected = expectedConversions.map(([sourceFormat, targetFormat]) => ({ sourceFormat, targetFormat }));
  const expectedImage = expected.filter(({ sourceFormat, targetFormat }) =>
    targetFormat === 'jpg' || (targetFormat === 'png' && sourceFormat === 'icns')
  );

  check(
    JSON.stringify(normalized) === JSON.stringify(expected),
    `converter manifest drifted from the shared conversion matrix: ${normalized.map(pairKey).join(', ')}`
  );
  check(
    JSON.stringify(fixturePairs) === JSON.stringify(expected),
    `converter fixture manifest drifted from the shared conversion matrix: ${fixturePairs.map(pairKey).join(', ')}`
  );
  check(
    JSON.stringify(normalizedImage) === JSON.stringify(expectedImage),
    `image converter manifest drifted from the image conversion matrix: ${normalizedImage.map(pairKey).join(', ')}`
  );

  const sources = new Set();
  const pairKeys = new Set();
  for (const pair of normalized) {
    check(Boolean(pair.sourceFormat && pair.targetFormat), `empty conversion pair is not allowed: ${JSON.stringify(pair)}`);
    check(allowedTargets.has(pair.targetFormat), `unsupported conversion target: ${pairKey(pair)}`);
    check(pair.targetFormat !== 'jpg' || rawSources.has(pair.sourceFormat), `only RAW sources may target JPG previews: ${pairKey(pair)}`);
    check(!pairKeys.has(pairKey(pair)), `duplicate conversion pair: ${pairKey(pair)}`);
    pairKeys.add(pairKey(pair));
    sources.add(pair.sourceFormat);
  }

  for (const source of forbiddenManifestSources) {
    check(!sources.has(source), `forbidden source leaked into default conversion manifest: ${source}`);
  }
}

async function verifyFrontendRoutes() {
  const formatsSource = await readText('packages/core/src/preview/formats.ts');
  const nativeDriversSource = await readText('packages/core/src/preview/native-drivers.ts');

  check(
    formatsSource.includes("export const CONVERSION_FORMAT_ROUTES: FormatDefinition[] = createConversionRoutes(conversionManifest);"),
    'packages/core default conversion routes must be generated from the shared manifest'
  );
  check(
    ["['png']", "['jpg', 'jpeg']", "['gif']", "['webp']", "['avif']", "['apng']", "['ico']", "['svg']", "['bmp']"]
      .every((extensions) => formatsSource.includes(`defineRoute(${extensions}, 'image', 'image'`)),
    'packages/core direct image route must expose the browser-native image set'
  );
  check(
    /const IMAGE_FORMATS = new Set\(\[\s*'png',\s*'jpg',\s*'jpeg',\s*'gif',\s*'webp',\s*'avif',\s*'apng',\s*'ico',\s*'svg',\s*'bmp'\s*\]\);/.test(nativeDriversSource),
    'native image driver must expose the browser-native image set'
  );

  for (const forbidden of [
    'application/vnd.oasis.opendocument.text-master',
    'application/vnd.oasis.opendocument.text-web',
    'application/vnd.sun.xml.writer.global',
    'application/vnd.ms-excel.addin.macroenabled.12'
  ]) {
    check(!formatsSource.includes(forbidden), `packages/core conversion routes must not advertise ${forbidden}`);
  }
}

async function verifyConverterClientMimeFallbacks() {
  const source = await readText('packages/converter-client/src/index.ts');
  const inferContentTypeSource = source.slice(
    source.indexOf('function inferContentType('),
    source.indexOf('\nfunction inferExtensionFromName(', source.indexOf('function inferContentType('))
  );

  for (const [sourceFormat] of expectedConversions) {
    check(
      inferContentTypeSource.includes(`case '${sourceFormat}':`),
      `HTTP converter MIME fallback is missing case '${sourceFormat}'`
    );
  }

  for (const forbidden of [
    'application/vnd.ms-excel.addin.macroenabled.12',
    'image/jpeg',
    'image/webp',
    'image/svg+xml'
  ]) {
    check(!inferContentTypeSource.includes(forbidden), `HTTP converter MIME fallback must not advertise ${forbidden}`);
  }
}

async function verifyBrowserWasmClientBoundary() {
  const source = await readText('packages/converter-client/src/wasm-client.ts');
  const convertStart = source.indexOf('async convert(request, context)');
  const convertEnd = source.indexOf('\n      const inputPath =', convertStart);
  const preflightSource = convertStart >= 0 && convertEnd > convertStart ? source.slice(convertStart, convertEnd) : '';

  check(
    source.includes("import conversionManifest from '../../../wasm/converter-core/manifest/conversions.json';"),
    'browser WASM converter client must import the shared converter manifest'
  );
  check(
    source.includes('const supportedConversionPairs = new Set('),
    'browser WASM converter client must derive supported source/target pairs from the shared manifest'
  );
  check(
    /function validateSupportedConversionPair\(sourceFormat: string, targetFormat: string\): (?:void|string)/.test(source),
    'browser WASM converter client must keep a manifest-based unsupported_format preflight'
  );
  check(
    source.includes("errorCode: 'unsupported_format'"),
    'browser WASM converter client must return stable unsupported_format errors for rejected pairs'
  );
  check(Boolean(preflightSource), 'browser WASM converter client convert() preflight block must be present');
  check(
    preflightSource.includes('validateSupportedConversionPair(sourceFormat, targetFormat)'),
    'browser WASM converter client must validate conversion pairs before WASM module loading'
  );
  for (const duplicatedList of [
    "'ppt', 'pps', 'pot', 'dps', 'odp', 'otp'",
    "'doc', 'dot', 'wps', 'rtf', 'odt', 'ott'",
    "'xls', 'xlt', 'et', 'ods', 'ots'"
  ]) {
    check(!source.includes(duplicatedList), 'browser WASM converter client must not duplicate conversion list ' + duplicatedList);
  }
}

async function verifyDemoEntrypoints() {
  const appSource = await readText('apps/demo/src/App.vue');
  const detectKindStart = appSource.indexOf('function detectKind(');
  const detectKindEnd = appSource.indexOf('\nfunction chooseUploadPrimaryFile', detectKindStart);
  const detectKindSource = detectKindStart >= 0 && detectKindEnd > detectKindStart
    ? appSource.slice(detectKindStart, detectKindEnd)
    : '';

  check(Boolean(detectKindSource), 'demo detectKind() must be present for upload/URL routing checks');
  check(
    appSource.includes("import conversionManifest from '../../../wasm/converter-core/manifest/conversions.json';"),
    'demo upload/URL conversion routing must import the shared converter manifest'
  );
  check(
    appSource.includes('const conversionKindBySource = new Map<string, DemoKind>('),
    'demo upload/URL conversion routing must derive source formats from the shared converter manifest'
  );
  check(
    detectKindSource.includes('conversionKindBySource.get(extensionFromNormalizedName(normalized))'),
    'demo detectKind() must use the manifest-derived conversion map for conversion routes'
  );
  check(
    appSource.includes('conversionKindBySource.has(extensionFromNormalizedName(normalized))')
      || appSource.includes('conversionKindBySource.has(extension)'),
    'demo bundle primary scoring must use the manifest-derived conversion map for conversion routes'
  );
  check(
    !/ppt\|pps\|pot\|dps\|odp\|otp|doc\|dot\|wps\|rtf\|odt\|ott|xls\|xlt\|et\|ods\|ots/.test(appSource),
    'demo must not duplicate the manifest as hard-coded conversion regexes'
  );
  check(
    detectKindSource.includes("if (/\\.(png|jpg|jpeg|gif|webp|avif|apng|ico|svg|bmp)$/.test(normalized)) return 'image';"),
    'demo detectKind() must route the browser-native image set directly'
  );

  for (const source of [
    'pptm',
    'ppsm',
    'potm',
    'dotm',
    'xlsb',
    'xltm',
    'xlam',
    'dwg',
    'graffle',
    'rar'
  ]) {
    check(
      !new RegExp(`\\b${source}\\b`, 'i').test(detectKindSource),
      `demo detectKind() must not route ${source} through default conversion or standalone image preview`
    );
  }

  check(
    /kind:\s*'ppt'[\s\S]{0,200}name:\s*'[^']+\.ppt'/.test(appSource),
    'demo legacy conversion sample must keep using a .ppt fixture'
  );
  check(!/Graffle\s*->\s*HTML/i.test(appSource) && !/\.graffle\b/i.test(appSource), 'demo must not reintroduce Graffle -> HTML conversion samples');
}
async function verifyRealSampleScriptEntrypoints() {
  const familyMapSource = await readText('scripts/_preview-family-map.mjs');
  const previewSource = await readText('scripts/run-real-sample-preview.mjs');

  check(
    familyMapSource.includes("wasm/converter-core/manifest/conversions.json"),
    'real-sample preview family map must derive conversion sources from the shared converter manifest'
  );
  check(
    familyMapSource.includes('const conversionSourceExts = [...conversionPagedExts, ...conversionFlowExts, ...conversionWorkbookExts, ...conversionImageExts];')
      && familyMapSource.includes("const conversionImageExts = conversionExtsByTarget.get('png') ?? [];")
      && familyMapSource.includes('export { conversionSourceExts, expectedFamilyForExt };'),
    'real-sample preview family map must export manifest-derived conversion source extensions'
  );
  check(
    previewSource.includes("import { conversionSourceExts } from './_preview-family-map.mjs';")
      && previewSource.includes("'pptx', ...conversionSourceExts,"),
    'real-sample preview runner must use manifest-derived conversion source extensions'
  );

  for (const duplicatedList of [
    "'ppt', 'pps', 'pot', 'dps', 'odp', 'otp'",
    "'doc', 'dot', 'wps', 'rtf', 'odt', 'ott'",
    "'xls', 'xlt', 'et', 'ods', 'ots'"
  ]) {
    check(!previewSource.includes(duplicatedList), 'real-sample preview runner must not duplicate conversion list ' + duplicatedList);
  }
}

async function verifyGoWrapperBoundary() {
  const supportedFormats = await readText('examples/go-wazero-converter/supported_formats.go');
  check(
    supportedFormats.includes('manifest.SupportedConversions()'),
    'Go wrapper SupportedConversions must delegate to the WASM core manifest'
  );
  check(
    supportedFormats.includes('manifest.IsSupportedConversionPair(sourceFormat, targetFormat)'),
    'Go wrapper conversion preflight must delegate to the WASM core manifest'
  );

  const goFiles = await listGoFiles('examples/go-wazero-converter');
  for (const filePath of goFiles) {
    const source = await fs.readFile(filePath, 'utf8');
    const displayPath = path.relative(rootDir, filePath).replace(/\\/g, '/');
    check(!source.includes('"os/exec"'), `${displayPath} must not import os/exec`);
    check(!/\bexec\.Command\b/.test(source), `${displayPath} must not spawn external converters`);
    check(!/\b(soffice|libreoffice|onlyoffice|x2t|poi)\b/i.test(source), `${displayPath} must not shell out or bind to external converter engines`);
  }
}

async function listGoFiles(relativeDir) {
  const start = path.join(rootDir, relativeDir);
  const files = [];
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.go') && !entry.name.endsWith('_test.go')) {
        files.push(fullPath);
      }
    }
  }
  await walk(start);
  return files;
}

function extractGoErrorCodeConstants(source) {
  const constants = [];
  const pattern = /\b(ErrorCode[A-Za-z]+)\s*=\s*"([^"]+)"/g;
  for (const match of source.matchAll(pattern)) {
    constants.push([match[1], match[2]]);
  }
  return constants;
}

function formatPairs(pairs) {
  return pairs.map(([name, value]) => `${name}=${value}`).join(', ');
}

async function verifyStableErrorCodes() {
  const rustSource = await readText('wasm/converter-core-rust/src/main.rs');
  const goSource = await readText('examples/go-wazero-converter/error_codes.go');
  const goCodes = extractGoErrorCodeConstants(goSource);
  const expectedJson = JSON.stringify(expectedErrorCodes);

  for (const [, code] of expectedErrorCodes) {
    check(rustSource.includes(`"${code}"`), `Rust WASI core must preserve stable error code: ${code}`);
  }
  check(
    JSON.stringify(goCodes) === expectedJson,
    `Go/wazero wrapper error codes drifted from the fixed ABI set: got ${formatPairs(goCodes)}, want ${formatPairs(expectedErrorCodes)}`
  );

  const goReadme = await readText('examples/go-wazero-converter/README.md');
  const x2tDoc = await readText('docs/x2t-wasm-evaluation.md');
  const architectureDoc = await readText('docs/multi-format-architecture.md');
  for (const [, code] of expectedErrorCodes) {
    check(goReadme.includes(code), `Go/wazero README must document stable error code: ${code}`);
    check(x2tDoc.includes(code), `x2t evaluation doc must preserve stable error code gate: ${code}`);
    check(architectureDoc.includes(code), `multi-format architecture doc must mention stable converter error metadata: ${code}`);
  }
}

async function verifyX2TGuardrails() {
  const doc = await readText('docs/x2t-wasm-evaluation.md');
  for (const required of [
    'without widening this repository',
    'optional high-fidelity browser-side candidate',
    'pure WASI without JavaScript glue',
    'Go backend paths remain thin shells around pure WASI only',
    'examples/go-wazero-converter` must remain WASI-only'
  ]) {
    check(doc.includes(required), `x2t evaluation doc is missing guardrail text: ${required}`);
  }
}

async function main() {
  await verifyManifest();
  await verifyFrontendRoutes();
  await verifyConverterClientMimeFallbacks();
  await verifyBrowserWasmClientBoundary();
  await verifyDemoEntrypoints();
  await verifyRealSampleScriptEntrypoints();
  await verifyGoWrapperBoundary();
  await verifyStableErrorCodes();
  await verifyX2TGuardrails();

  if (failures.length) {
    console.error('conversion policy verification failed:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log(`conversion policy verification ok (${checkCount} checks)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
