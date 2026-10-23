import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createPreviewer,
  createImagePreviewDriver,
  createHtmlPreviewDriver,
  createMediaPreviewDriver,
  createDefaultPreviewRoutes,
  createPreviewAcceptAttribute,
  createPreviewRegistry,
  CONVERSION_FORMAT_ROUTES,
  classifyPreviewFormat,
  listPreviewExtensions,
  listPreviewFormatGroups,
  listPreviewFormats,
  createPptxPreviewDriver,
  createTextPreviewDriver,
  createFileSetResourceIndex,
  createFileSetResourceResolver,
  inferExtensionFromName,
  normalizeSourceDescriptor,
  resolveFormatRoute,
  type ConverterClient,
  type PreviewDriver,
  type PreviewItemState,
  type PreviewSession
} from '../src/preview';
import { readFixture } from './helpers';
import conversionManifest from '../../../wasm/converter-core/manifest/conversions.json';

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: MockResizeObserver,
    configurable: true
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    value: vi.fn(),
    configurable: true
  });
  Object.defineProperty(globalThis.URL, 'createObjectURL', {
    value: vi.fn(() => 'blob:preview-fixture'),
    configurable: true
  });
  Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
    value: vi.fn(),
    configurable: true
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});

async function resolveFileSetName(resolver: ReturnType<typeof createFileSetResourceResolver>, source: string): Promise<string | undefined> {
  const result = await resolver({ source });
  const resolvedSource = result && typeof result === 'object' && 'source' in result ? result.source : result;
  return resolvedSource instanceof File ? resolvedSource.name : undefined;
}

const SOURCE_CODE_FORMATS = [
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
  'mkd',
  'mkdn',
  'mdown',
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
  'cfg',
  'cnf',
  'rest',
  'latex',
  'ltx',
  'sty',
  'cls',
  'cc',
  'cxx',
  'hh',
  'hxx',
  'fsi',
  'fsx',
  'm',
  'matlab',
  'csproj',
  'vbproj',
  'fsproj',
  'props',
  'targets',
  'sln',
  'cshtml',
  'razor',
  'mustache',
  'hbs',
  'liquid',
  'jinja',
  'twig',
  'ejs',
  'erb',
  'haml',
  'slim',
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
  'npmrc',
  'yarnrc',
  'gitattributes',
  'gitmodules',
  'markdown'
] as const;

describe('preview format routing', () => {
  it('infers normalized extensions from names and URLs', () => {
    expect(inferExtensionFromName('Quarterly Report.PPTX')).toBe('pptx');
    expect(inferExtensionFromName('/files/archive.tar.gz?token=abc')).toBe('gz');
    expect(inferExtensionFromName('README')).toBeUndefined();
    expect(inferExtensionFromName('.env')).toBe('env');
    expect(inferExtensionFromName('Dockerfile')).toBe('dockerfile');
    expect(inferExtensionFromName('Dockerfile.prod')).toBe('dockerfile');
    expect(inferExtensionFromName('Makefile')).toBe('make');
    expect(inferExtensionFromName('GNUmakefile')).toBe('make');
    expect(inferExtensionFromName('CMakeLists.txt')).toBe('cmake');
  });

  it('routes native Office and file preview formats without conversion', () => {
    expect(resolveFormatRoute({ name: 'deck.pptx' })).toMatchObject({
      sourceFormat: 'pptx',
      targetFormat: 'pptx',
      family: 'paged',
      driverId: 'pptx'
    });
    expect(resolveFormatRoute({ name: 'photo.png' })).toMatchObject({
      sourceFormat: 'png',
      targetFormat: 'png',
      family: 'image',
      driverId: 'image'
    });
    for (const extension of ['jpg', 'jpeg', 'gif', 'webp', 'avif', 'apng', 'ico', 'svg', 'bmp']) {
      expect(resolveFormatRoute({ name: `photo.${extension}` })).toMatchObject({
        sourceFormat: extension,
        family: 'image',
        driverId: 'image'
      });
    }
    expect(resolveFormatRoute({ name: 'photo.PPM' })).toMatchObject({
      sourceFormat: 'ppm', targetFormat: 'png', family: 'image', driverId: 'image',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ name: 'photo.icns' })).toMatchObject({
      sourceFormat: 'icns',
      targetFormat: 'png',
      family: 'image',
      driverId: 'image',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ name: 'track.flac' })).toMatchObject({
      sourceFormat: 'flac',
      family: 'audio',
      driverId: 'media'
    });
    for (const extension of ['ogv', 'mkv', 'avi', 'mpeg', 'mpg', '3gp']) {
      expect(resolveFormatRoute({ name: `movie.${extension}` })).toMatchObject({
        sourceFormat: extension,
        family: 'video',
        driverId: 'media'
      });
    }
    expect(resolveFormatRoute({ name: 'component.tsx' })).toMatchObject({
      sourceFormat: 'tsx',
      family: 'code',
      driverId: 'text'
    });
    expect(resolveFormatRoute({ name: 'bundle.zip' })).toMatchObject({
      sourceFormat: 'zip',
      targetFormat: 'zip',
      family: 'archive',
      driverId: 'archive'
    });
    expect(resolveFormatRoute({ name: 'book.epub' })).toMatchObject({
      sourceFormat: 'epub',
      targetFormat: 'epub',
      family: 'ebook',
      driverId: 'ebook'
    });
    expect(resolveFormatRoute({ name: 'book.epub' }, { routes: CONVERSION_FORMAT_ROUTES })).toMatchObject({
      sourceFormat: 'epub',
      targetFormat: 'docx',
      family: 'flow',
      driverId: 'docx',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ name: 'book.fb2' }, { routes: CONVERSION_FORMAT_ROUTES })).toMatchObject({
      sourceFormat: 'fb2',
      targetFormat: 'docx',
      family: 'flow',
      driverId: 'docx',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ name: 'sales.csv' })).toMatchObject({
      sourceFormat: 'csv',
      targetFormat: 'csv',
      family: 'workbook',
      driverId: 'xlsx'
    });
    expect(resolveFormatRoute({ name: 'comic.cbz' })).toMatchObject({
      sourceFormat: 'cbz',
      targetFormat: 'cbz',
      family: 'ebook',
      driverId: 'ebook'
    });
    expect(resolveFormatRoute({ name: 'page.html' })).toMatchObject({
      sourceFormat: 'html',
      targetFormat: 'html',
      family: 'html',
      driverId: 'html'
    });
    expect(resolveFormatRoute({ name: 'page.htm' })).toMatchObject({
      sourceFormat: 'htm',
      targetFormat: 'html',
      family: 'html',
      driverId: 'html'
    });
    expect(resolveFormatRoute({ name: 'page.xhtml' })).toMatchObject({
      sourceFormat: 'xhtml',
      targetFormat: 'html',
      family: 'html',
      driverId: 'html'
    });
    expect(resolveFormatRoute({ name: 'page.xht' })).toMatchObject({
      sourceFormat: 'xht',
      targetFormat: 'html',
      family: 'html',
      driverId: 'html'
    });
    expect(resolveFormatRoute({ name: 'data.json' })).toMatchObject({
      sourceFormat: 'json',
      targetFormat: 'json',
      family: 'code',
      driverId: 'text'
    });
    expect(resolveFormatRoute({ name: 'data.jsonl' })).toMatchObject({
      sourceFormat: 'jsonl',
      targetFormat: 'xlsx',
      family: 'workbook',
      driverId: 'xlsx',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ name: 'data.ndjson' })).toMatchObject({
      sourceFormat: 'ndjson',
      targetFormat: 'xlsx',
      family: 'workbook',
      driverId: 'xlsx',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ name: 'data.xml' })).toMatchObject({
      sourceFormat: 'xml',
      targetFormat: 'xml',
      family: 'code',
      driverId: 'text'
    });
    expect(resolveFormatRoute({ name: 'config.yaml' })).toMatchObject({
      sourceFormat: 'yaml',
      targetFormat: 'yaml',
      family: 'code',
      driverId: 'text'
    });
    expect(resolveFormatRoute({ name: 'config.yml' })).toMatchObject({
      sourceFormat: 'yml',
      targetFormat: 'yml',
      family: 'code',
      driverId: 'text'
    });
    expect(resolveFormatRoute({ name: 'config.toml' })).toMatchObject({
      sourceFormat: 'toml',
      targetFormat: 'toml',
      family: 'code',
      driverId: 'text'
    });
    expect(resolveFormatRoute({ name: 'config.ini' })).toMatchObject({
      sourceFormat: 'ini',
      targetFormat: 'ini',
      family: 'code',
      driverId: 'text'
    });
    expect(resolveFormatRoute({ name: 'notes.rst' })).toMatchObject({
      sourceFormat: 'rst',
      targetFormat: 'rst',
      family: 'code',
      driverId: 'text'
    });
    expect(resolveFormatRoute({ name: 'notes.adoc' })).toMatchObject({
      sourceFormat: 'adoc',
      targetFormat: 'adoc',
      family: 'code',
      driverId: 'text'
    });
    expect(resolveFormatRoute({ name: 'notes.asciidoc' })).toMatchObject({
      sourceFormat: 'asciidoc',
      targetFormat: 'asciidoc',
      family: 'code',
      driverId: 'text'
    });
    expect(resolveFormatRoute({ name: 'key.asc' })).toMatchObject({
      sourceFormat: 'asc',
      targetFormat: 'asc',
      family: 'code',
      driverId: 'text'
    });
    expect(resolveFormatRoute({ name: 'paper.tex' })).toMatchObject({
      sourceFormat: 'tex',
      targetFormat: 'tex',
      family: 'code',
      driverId: 'text'
    });
    expect(resolveFormatRoute({ name: 'app.properties' })).toMatchObject({
      sourceFormat: 'properties',
      targetFormat: 'properties',
      family: 'code',
      driverId: 'text'
    });
    expect(resolveFormatRoute({ name: '.env' })).toMatchObject({
      sourceFormat: 'env',
      targetFormat: 'env',
      family: 'code',
      driverId: 'text'
    });
    expect(resolveFormatRoute({ name: 'server.conf' })).toMatchObject({
      sourceFormat: 'conf',
      targetFormat: 'conf',
      family: 'code',
      driverId: 'text'
    });
    expect(resolveFormatRoute({ name: 'server.config' })).toMatchObject({
      sourceFormat: 'config',
      targetFormat: 'config',
      family: 'code',
      driverId: 'text'
    });
    expect(resolveFormatRoute({ name: 'query.sql' })).toMatchObject({
      sourceFormat: 'sql',
      targetFormat: 'sql',
      family: 'code',
      driverId: 'text'
    });
    for (const extension of SOURCE_CODE_FORMATS) {
      expect(resolveFormatRoute({ name: `sample.${extension}` })).toMatchObject({
        sourceFormat: extension,
        targetFormat: extension,
        family: 'code',
        driverId: 'text'
      });
    }
  });

  it('routes manifest-listed formats through their conversion preview drivers', () => {
    const expectedFamilies = {
      pptx: 'paged',
      docx: 'flow',
      xlsx: 'workbook',
      jpg: 'image',
      png: 'image'
    } as const;

    const defaultPairs = conversionManifest.filter((pair, index) =>
      conversionManifest.findIndex((candidate) => candidate.sourceFormat === pair.sourceFormat) === index
    );
    for (const pair of defaultPairs) {
      expect(resolveFormatRoute({ name: `sample.${pair.sourceFormat}` }, { routes: CONVERSION_FORMAT_ROUTES })).toMatchObject({
        sourceFormat: pair.sourceFormat,
        targetFormat: pair.targetFormat,
        family: expectedFamilies[pair.targetFormat as keyof typeof expectedFamilies],
        driverId: ['jpg', 'png'].includes(pair.targetFormat) ? 'image' : pair.targetFormat,
        conversion: { required: true }
      });
    }

    for (const name of [
      'draft.pages',
      'deck.key',
      'sheet.numbers',
      'movie.mkv',
      'bundle.rar',
      'comic.cbr',
      'floorplan.dwg',
      'part.step',
      'brainstorm.xmind',
      'flow.graffle',
      'photo.heic',
      'addin.xlam',
      'addin.xla',
      'master.odm',
      'web-template.oth',
      'legacy-global.sxg'
    ]) {
      const route = resolveFormatRoute({ name });
      expect(route?.conversion?.required).not.toBe(true);
    }

    for (const [name, targetFormat, family] of [
      ['legacy.doc', 'docx', 'flow'],
      ['macro.docm', 'docx', 'flow'],
      ['template.dotm', 'docx', 'flow'],
      ['legacy.sxw', 'docx', 'flow'],
      ['legacy.xls', 'xlsx', 'workbook'],
      ['macro.xlsm', 'xlsx', 'workbook'],
      ['template.xltm', 'xlsx', 'workbook'],
      ['legacy.sxc', 'xlsx', 'workbook'],
      ['writer.wps', 'docx', 'flow'],
      ['sheet.et', 'xlsx', 'workbook'],
      ['slides.dps', 'pptx', 'paged'],
      ['macro.pptm', 'pptx', 'paged'],
      ['macro.ppsm', 'pptx', 'paged'],
      ['macro.potm', 'pptx', 'paged'],
      ['deck.sxi', 'pptx', 'paged'],
      ['drawing.odg', 'pptx', 'paged'],
      ['drawing.sxd', 'pptx', 'paged']
    ] as const) {
      expect(resolveFormatRoute({ name })).toMatchObject({
        sourceFormat: inferExtensionFromName(name),
        targetFormat,
        family,
        conversion: { required: true }
      });
    }

    for (const [name, family] of [
      ['plain.txt', 'text'],
      ['plain.text', 'text'],
      ['notes.md', 'code'],
      ['notes.markdown', 'code'],
      ['page.html', 'html'],
      ['page.xhtml', 'html'],
      ['page.xht', 'html'],
      ['data.json', 'code'],
      ['data.xml', 'code'],
      ['config.yaml', 'code'],
      ['config.toml', 'code'],
      ['config.ini', 'code'],
      ['notes.rst', 'code'],
      ['notes.adoc', 'code'],
      ['key.asc', 'code'],
      ['paper.tex', 'code'],
      ['app.properties', 'code'],
      ['.env', 'code'],
      ['server.conf', 'code'],
      ['server.config', 'code'],
      ['query.sql', 'code'],
      ['table.csv', 'workbook'],
      ['table.psv', 'workbook']
    ] as const) {
      expect(resolveFormatRoute({ name })).toMatchObject({
        sourceFormat: inferExtensionFromName(name),
        family,
        ...(name.endsWith('.psv') ? { targetFormat: 'xlsx', conversion: { required: true } } : { conversion: undefined })
      });
    }

    for (const name of ['notebook.ipynb', 'captions.srt', 'captions.vtt', 'captions.sbv', 'captions.ass', 'captions.ssa', 'captions.ttml', 'captions.dfxp', 'event.ics', 'contact.vcf', 'message.eml', 'mailbox.mbox', 'message.msg', 'template.oft', 'archive.mht', 'archive.mhtml']) {
      expect(resolveFormatRoute({ name })).toMatchObject({
        sourceFormat: inferExtensionFromName(name),
        targetFormat: 'docx',
        family: 'flow',
        driverId: 'docx',
        conversion: { required: true }
      });
    }

    for (const name of ['data.jsonl', 'data.ndjson']) {
      expect(resolveFormatRoute({ name })).toMatchObject({
        sourceFormat: inferExtensionFromName(name),
        targetFormat: 'xlsx',
        family: 'workbook',
        driverId: 'xlsx',
        conversion: { required: true }
      });
    }
  });

  it('derives default conversion routes from the shared converter manifest', () => {
    const conversionFormats = listPreviewFormats({ includeDirect: false });
    expect(conversionFormats.map((format) => `${format.extension}->${format.targetFormat}`)).toEqual(
      conversionManifest
        .filter((pair, index) => conversionManifest.findIndex((candidate) => candidate.sourceFormat === pair.sourceFormat) === index)
        .map((pair) => `${pair.sourceFormat}->${pair.targetFormat}`)
    );
  });

  it('falls back to content type when no extension is available', () => {
    expect(resolveFormatRoute({ contentType: 'application/pdf; charset=binary' })).toMatchObject({
      sourceFormat: 'pdf',
      targetFormat: 'pdf',
      family: 'paged',
      driverId: 'pdf'
    });
    expect(resolveFormatRoute({ contentType: 'image/png' })).toMatchObject({
      sourceFormat: 'png',
      targetFormat: 'png',
      family: 'image',
      driverId: 'image'
    });
    expect(resolveFormatRoute({ contentType: 'image/jpeg' })).toMatchObject({ sourceFormat: 'jpg', family: 'image' });
    expect(resolveFormatRoute({ contentType: 'image/svg+xml' })).toMatchObject({ sourceFormat: 'svg', family: 'image' });
    expect(resolveFormatRoute({ contentType: 'image/webp' })).toMatchObject({ sourceFormat: 'webp', family: 'image' });
    expect(resolveFormatRoute({ contentType: 'image/avif' })).toMatchObject({ sourceFormat: 'avif', family: 'image' });
    expect(resolveFormatRoute({ contentType: 'image/apng' })).toMatchObject({ sourceFormat: 'apng', family: 'image' });
    expect(resolveFormatRoute({ contentType: 'image/x-icon' })).toMatchObject({ sourceFormat: 'ico', family: 'image' });
    expect(resolveFormatRoute({ contentType: 'image/x-portable-pixmap' })).toMatchObject({
      sourceFormat: 'ppm', targetFormat: 'png', family: 'image', driverId: 'image',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ contentType: 'application/x-icns' })).toMatchObject({
      sourceFormat: 'icns',
      targetFormat: 'png',
      family: 'image',
      driverId: 'image',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ contentType: 'application/msword' })).toMatchObject({
      sourceFormat: 'doc',
      targetFormat: 'docx',
      family: 'flow',
      driverId: 'docx',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ contentType: 'application/vnd.ms-word.document.macroenabled.12' })).toMatchObject({
      sourceFormat: 'docm',
      targetFormat: 'docx',
      family: 'flow',
      driverId: 'docx',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ contentType: 'application/vnd.ms-word.template.macroenabled.12' })).toMatchObject({
      sourceFormat: 'dotm',
      targetFormat: 'docx',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ contentType: 'application/rtf' })).toMatchObject({
      sourceFormat: 'rtf',
      targetFormat: 'docx',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ contentType: 'application/vnd.oasis.opendocument.text' })).toMatchObject({
      sourceFormat: 'odt',
      targetFormat: 'docx',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ contentType: 'application/vnd.oasis.opendocument.text-flat-xml' })).toMatchObject({
      sourceFormat: 'fodt',
      targetFormat: 'docx',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ contentType: 'application/wps-office.wpt' })).toMatchObject({
      sourceFormat: 'wpt',
      targetFormat: 'docx',
      conversion: { required: true }
    });
    for (const [contentType, sourceFormat] of [
      ['application/rss+xml', 'rss'],
      ['application/atom+xml', 'atom'],
      ['application/vnd.google-earth.kml+xml', 'kml'],
      ['application/gpx+xml', 'gpx'],
      ['application/ttml+xml', 'ttml'],
      ['application/x-fictionbook+xml', 'fb2']
    ] as const) {
      expect(resolveFormatRoute({ contentType })).toMatchObject({
        sourceFormat,
        targetFormat: 'docx',
        conversion: { required: true }
      });
    }
    for (const [contentType, sourceFormat] of [
      ['application/xsd+xml', 'xsd'],
      ['application/xslt+xml', 'xsl'],
      ['application/wsdl+xml', 'wsdl'],
      ['application/x-plist', 'plist']
    ] as const) {
      expect(resolveFormatRoute({ contentType })).toMatchObject({
        sourceFormat,
        targetFormat: 'docx',
        conversion: { required: true }
      });
    }
    expect(resolveFormatRoute({ contentType: 'application/vnd.oasis.opendocument.text-master' })).toBeNull();
    expect(resolveFormatRoute({ contentType: 'application/vnd.oasis.opendocument.text-web' })).toBeNull();
    expect(resolveFormatRoute({ contentType: 'application/vnd.sun.xml.writer' })).toMatchObject({
      sourceFormat: 'sxw',
      targetFormat: 'docx',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ contentType: 'application/vnd.sun.xml.writer.global' })).toBeNull();
    expect(resolveFormatRoute({ contentType: 'application/vnd.ms-excel' })).toMatchObject({
      sourceFormat: 'xls',
      targetFormat: 'xlsx',
      family: 'workbook',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ contentType: 'application/vnd.ms-excel.sheet.macroenabled.12' })).toMatchObject({
      sourceFormat: 'xlsm',
      targetFormat: 'xlsx',
      family: 'workbook',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ contentType: 'application/vnd.ms-excel.template.macroenabled.12' })).toMatchObject({
      sourceFormat: 'xltm',
      targetFormat: 'xlsx',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ contentType: 'application/vnd.ms-excel.addin.macroenabled.12' })).toBeNull();
    expect(resolveFormatRoute({ contentType: 'application/vnd.oasis.opendocument.spreadsheet' })).toMatchObject({
      sourceFormat: 'ods',
      targetFormat: 'xlsx',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ contentType: 'application/vnd.oasis.opendocument.spreadsheet-flat-xml' })).toMatchObject({
      sourceFormat: 'fods',
      targetFormat: 'xlsx',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ contentType: 'application/wps-office.ett' })).toMatchObject({
      sourceFormat: 'ett',
      targetFormat: 'xlsx',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ contentType: 'application/vnd.sun.xml.calc' })).toMatchObject({
      sourceFormat: 'sxc',
      targetFormat: 'xlsx',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ contentType: 'application/x-dbf' })).toMatchObject({
      sourceFormat: 'dbf',
      targetFormat: 'xlsx',
      family: 'workbook',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ contentType: 'text/spreadsheet' })).toMatchObject({
      sourceFormat: 'slk',
      targetFormat: 'xlsx',
      family: 'workbook',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ contentType: 'application/x-dif' })).toMatchObject({
      sourceFormat: 'dif',
      targetFormat: 'xlsx',
      family: 'workbook',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ contentType: 'text/tab-separated-values' })).toMatchObject({
      sourceFormat: 'tsv',
      targetFormat: 'xlsx',
      family: 'workbook',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ contentType: 'application/vnd.ms-powerpoint' })).toMatchObject({
      sourceFormat: 'ppt',
      targetFormat: 'pptx',
      family: 'paged',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ contentType: 'application/vnd.oasis.opendocument.presentation' })).toMatchObject({
      sourceFormat: 'odp',
      targetFormat: 'pptx',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ contentType: 'application/vnd.oasis.opendocument.presentation-flat-xml' })).toMatchObject({
      sourceFormat: 'fodp',
      targetFormat: 'pptx',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ contentType: 'application/wps-office.dpt' })).toMatchObject({
      sourceFormat: 'dpt',
      targetFormat: 'pptx',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ contentType: 'application/vnd.sun.xml.impress' })).toMatchObject({
      sourceFormat: 'sxi',
      targetFormat: 'pptx',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ contentType: 'application/vnd.oasis.opendocument.graphics' })).toMatchObject({
      sourceFormat: 'odg',
      targetFormat: 'pptx',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ contentType: 'application/vnd.sun.xml.draw' })).toMatchObject({
      sourceFormat: 'sxd',
      targetFormat: 'pptx',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ contentType: 'application/vnd.ms-powerpoint.presentation.macroenabled.12' })).toMatchObject({
      sourceFormat: 'pptm',
      targetFormat: 'pptx',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ contentType: 'text/plain' })).toMatchObject({
      sourceFormat: 'txt',
      family: 'text',
      driverId: 'text'
    });
    expect(resolveFormatRoute({ contentType: 'text/html' })).toMatchObject({
      sourceFormat: 'html',
      targetFormat: 'html',
      family: 'html',
      driverId: 'html'
    });
    expect(resolveFormatRoute({ contentType: 'application/xhtml+xml' })).toMatchObject({
      sourceFormat: 'xhtml',
      targetFormat: 'html',
      family: 'html',
      driverId: 'html'
    });
    expect(resolveFormatRoute({ contentType: 'application/json' })).toMatchObject({
      sourceFormat: 'json',
      targetFormat: 'json',
      family: 'code',
      driverId: 'text'
    });
    expect(resolveFormatRoute({ contentType: 'application/x-ndjson' })).toMatchObject({
      sourceFormat: 'jsonl',
      targetFormat: 'xlsx',
      family: 'workbook',
      driverId: 'xlsx',
      conversion: { required: true }
    });
    expect(resolveFormatRoute({ contentType: 'application/xml' })).toMatchObject({
      sourceFormat: 'xml',
      targetFormat: 'xml',
      family: 'code',
      driverId: 'text'
    });
    expect(resolveFormatRoute({ contentType: 'application/yaml' })).toMatchObject({
      sourceFormat: 'yaml',
      targetFormat: 'yaml',
      family: 'code',
      driverId: 'text'
    });
    expect(resolveFormatRoute({ contentType: 'application/toml' })).toMatchObject({
      sourceFormat: 'toml',
      targetFormat: 'toml',
      family: 'code',
      driverId: 'text'
    });
    expect(resolveFormatRoute({ contentType: 'text/x-ini' })).toMatchObject({
      sourceFormat: 'ini',
      targetFormat: 'ini',
      family: 'code',
      driverId: 'text'
    });
    expect(resolveFormatRoute({ contentType: 'text/x-rst' })).toMatchObject({
      sourceFormat: 'rst',
      targetFormat: 'rst',
      family: 'code',
      driverId: 'text'
    });
    expect(resolveFormatRoute({ contentType: 'text/asciidoc' })).toMatchObject({
      sourceFormat: 'adoc',
      targetFormat: 'adoc',
      family: 'code',
      driverId: 'text'
    });
    expect(resolveFormatRoute({ contentType: 'application/x-tex' })).toMatchObject({
      sourceFormat: 'tex',
      targetFormat: 'tex',
      family: 'code',
      driverId: 'text'
    });
    expect(resolveFormatRoute({ contentType: 'text/x-java-properties' })).toMatchObject({
      sourceFormat: 'properties',
      targetFormat: 'properties',
      family: 'code',
      driverId: 'text'
    });
    expect(resolveFormatRoute({ contentType: 'application/x-env' })).toMatchObject({
      sourceFormat: 'env',
      targetFormat: 'env',
      family: 'code',
      driverId: 'text'
    });
    expect(resolveFormatRoute({ contentType: 'text/x-config' })).toMatchObject({
      sourceFormat: 'conf',
      targetFormat: 'conf',
      family: 'code',
      driverId: 'text'
    });
    expect(resolveFormatRoute({ contentType: 'application/sql' })).toMatchObject({
      sourceFormat: 'sql',
      targetFormat: 'sql',
      family: 'code',
      driverId: 'text'
    });
    expect(resolveFormatRoute({ contentType: 'text/x-pipe-separated-values' })).toMatchObject({
      sourceFormat: 'psv',
      targetFormat: 'xlsx',
      family: 'workbook',
      driverId: 'xlsx',
      conversion: { required: true }
    });
    for (const [contentType, sourceFormat] of [
      ['application/x-ipynb+json', 'ipynb'],
      ['application/x-subrip', 'srt'],
      ['text/vtt', 'vtt'],
      ['text/x-sbv', 'sbv'],
      ['text/x-ass', 'ass'],
      ['text/x-ssa', 'ssa'],
      ['text/calendar', 'ics'],
      ['text/vcard', 'vcf'],
      ['message/rfc822', 'eml'],
      ['application/mbox', 'mbox'],
      ['application/vnd.ms-outlook', 'msg'],
      ['application/x-ms-outlook', 'oft'],
      ['application/x-mimearchive', 'mht']
    ] as const) {
      expect(resolveFormatRoute({ contentType })).toMatchObject({
        sourceFormat,
        targetFormat: 'docx',
        family: 'flow',
        driverId: 'docx',
        conversion: { required: true }
      });
    }
    for (const [contentType, sourceFormat] of [
      ['text/javascript', 'js'],
      ['text/typescript', 'ts'],
      ['text/x-vue', 'vue'],
      ['text/css', 'css'],
      ['text/x-scss', 'scss'],
      ['text/x-less', 'less'],
      ['text/x-csrc', 'c'],
      ['text/x-c++src', 'cpp'],
      ['text/x-csharp', 'cs'],
      ['text/x-go', 'go'],
      ['text/x-java-source', 'java'],
      ['text/x-kotlin', 'kt'],
      ['text/x-lua', 'lua'],
      ['application/x-httpd-php', 'php'],
      ['text/x-python', 'py'],
      ['text/x-ruby', 'rb'],
      ['text/rust', 'rs'],
      ['application/x-sh', 'sh'],
      ['application/x-msdos-program', 'bat'],
      ['text/x-powershell', 'ps1'],
      ['text/x-swift', 'swift'],
      ['application/jsonc', 'jsonc'],
      ['application/json5', 'json5'],
      ['application/graphql', 'gql'],
      ['application/x-protobuf', 'proto'],
      ['text/x-diff', 'diff'],
      ['text/x-patch', 'patch'],
      ['text/x-gitignore', 'gitignore'],
      ['text/x-dockerignore', 'dockerignore'],
      ['text/x-editorconfig', 'editorconfig'],
      ['text/x-r', 'r'],
      ['text/x-dart', 'dart'],
      ['text/x-scala', 'scala'],
      ['text/x-groovy', 'groovy'],
      ['text/x-perl', 'pl'],
      ['text/x-elixir', 'ex'],
      ['text/x-erlang', 'erl'],
      ['text/x-fsharp', 'fs'],
      ['text/x-vb', 'vb'],
      ['text/x-clojure', 'clj'],
      ['text/x-haskell', 'hs'],
      ['text/x-julia', 'jl'],
      ['text/x-zig', 'zig'],
      ['text/x-svelte', 'svelte'],
      ['text/x-astro', 'astro'],
      ['text/mdx', 'mdx'],
      ['text/x-hcl', 'tf'],
      ['text/x-rego', 'rego'],
      ['text/x-bicep', 'bicep'],
      ['text/x-prisma', 'prisma'],
      ['text/x-dockerfile', 'dockerfile'],
      ['text/x-cmake', 'cmake'],
      ['text/x-makefile', 'make'],
      ['text/x-shellscript', 'sh'],
      ['text/x-handlebars-template', 'mustache'],
      ['text/x-liquid', 'liquid'],
      ['text/x-jinja', 'jinja'],
      ['text/x-twig', 'twig'],
      ['text/x-ejs', 'ejs'],
      ['text/x-erb', 'erb'],
      ['text/vnd.mermaid', 'mermaid'],
      ['text/x-plantuml', 'puml'],
      ['application/vnd.apache.avro+json', 'avsc'],
      ['text/x-solidity', 'sol'],
      ['text/x-move', 'move'],
      ['text/x-nim', 'nim'],
      ['text/x-crystal', 'cr'],
      ['text/x-ocaml', 'ml'],
      ['text/x-elm', 'elm'],
      ['text/x-racket', 'rkt'],
      ['text/x-lisp', 'lisp'],
      ['text/x-scheme', 'scm'],
      ['text/x-asm', 'asm'],
      ['text/x-cuda', 'cu'],
      ['text/x-d', 'd'],
      ['text/x-pascal', 'pas'],
      ['text/x-ada', 'adb'],
      ['text/x-cobol', 'cob'],
      ['text/x-fortran', 'f90'],
      ['text/x-vhdl', 'vhd'],
      ['text/x-systemverilog', 'sv'],
      ['text/x-arduino', 'ino'],
      ['text/x-glsl', 'glsl'],
      ['text/wgsl', 'wgsl'],
      ['text/x-hlsl', 'hlsl'],
      ['text/x-r-markdown', 'rmd'],
      ['text/x-quarto', 'qmd'],
      ['application/x-bibtex', 'bib'],
      ['text/x-nix', 'nix'],
      ['text/x-cue', 'cue'],
      ['text/x-dhall', 'dhall'],
      ['text/org', 'org'],
      ['text/x-wiki', 'wiki'],
      ['text/x-mediawiki', 'wiki'],
      ['text/x-textile', 'textile'],
      ['text/x-pod', 'pod'],
      ['text/troff', 'man'],
      ['text/x-nfo', 'nfo'],
      ['text/x-npmrc', 'npmrc'],
      ['text/x-yarnrc', 'yarnrc'],
      ['text/x-gitattributes', 'gitattributes'],
      ['text/x-gitmodules', 'gitmodules']
    ] as const) {
      expect(resolveFormatRoute({ contentType })).toMatchObject({
        sourceFormat,
        targetFormat: sourceFormat,
        family: 'code',
        driverId: 'text'
      });
    }
  });

  it('returns null for unknown formats', () => {
    expect(resolveFormatRoute({ name: 'unknown.zzz' })).toBeNull();
  });

  it('lists route-backed formats for UI accept attributes and converter setup', () => {
    const directFormats = listPreviewFormats({ includeConversion: false });
    const conversionFormats = listPreviewFormats({ includeDirect: false });
    const conversionPairs = conversionFormats.map((format) => `${format.extension}->${format.targetFormat}`);
    const accept = createPreviewAcceptAttribute();

    expect(directFormats.find((format) => format.extension === 'pptx')).toMatchObject({
      targetFormat: 'pptx',
      family: 'paged',
      conversionRequired: false
    });
    expect(directFormats.find((format) => format.extension === 'png')).toMatchObject({
      targetFormat: 'png',
      family: 'image',
      driverId: 'image',
      conversionRequired: false
    });
    for (const extension of ['jpg', 'jpeg', 'gif', 'webp', 'avif', 'apng', 'ico', 'svg', 'bmp']) {
      expect(directFormats.find((format) => format.extension === extension)).toMatchObject({
        family: 'image',
        driverId: 'image',
        conversionRequired: false
      });
    }

    expect(conversionPairs).toEqual(
      conversionManifest
        .filter((pair, index) => conversionManifest.findIndex((candidate) => candidate.sourceFormat === pair.sourceFormat) === index)
        .map((pair) => `${pair.sourceFormat}->${pair.targetFormat}`)
    );
    expect(conversionFormats.find((format) => format.extension === 'ppt')).toMatchObject({
      targetFormat: 'pptx',
      family: 'paged',
      driverId: 'pptx',
      conversionRequired: true
    });
    expect(conversionFormats.find((format) => format.extension === 'dpt')).toMatchObject({
      targetFormat: 'pptx',
      family: 'paged',
      driverId: 'pptx',
      conversionRequired: true
    });
    expect(conversionFormats.find((format) => format.extension === 'doc')).toMatchObject({
      targetFormat: 'docx',
      family: 'flow',
      driverId: 'docx',
      conversionRequired: true
    });
    expect(conversionFormats.find((format) => format.extension === 'wpt')).toMatchObject({
      targetFormat: 'docx',
      family: 'flow',
      driverId: 'docx',
      conversionRequired: true
    });
    expect(conversionFormats.find((format) => format.extension === 'xls')).toMatchObject({
      targetFormat: 'xlsx',
      family: 'workbook',
      driverId: 'xlsx',
      conversionRequired: true
    });
    expect(conversionFormats.find((format) => format.extension === 'ett')).toMatchObject({
      targetFormat: 'xlsx',
      family: 'workbook',
      driverId: 'xlsx',
      conversionRequired: true
    });
    expect(conversionFormats.find((format) => format.extension === 'txt')).toMatchObject({
      targetFormat: 'docx',
      family: 'flow',
      driverId: 'docx',
      conversionRequired: true
    });
    expect(conversionFormats.find((format) => format.extension === 'markdown')).toMatchObject({
      targetFormat: 'docx',
      family: 'flow',
      driverId: 'docx',
      conversionRequired: true
    });
    for (const extension of [
      'mkd', 'mkdn', 'mdown', 'xht', 'xhtm',
      'cfg', 'cnf', 'rest', 'asc', 'latex', 'ltx', 'sty', 'cls',
      'cc', 'cxx', 'hh', 'hxx', 'fsi', 'fsx', 'm', 'matlab',
      'csproj', 'vbproj', 'fsproj', 'props', 'targets', 'sln', 'cshtml', 'razor', 'haml', 'slim'
    ]) {
      expect(conversionFormats.find((format) => format.extension === extension)).toMatchObject({
        targetFormat: 'docx',
        family: 'flow',
        driverId: 'docx',
        conversionRequired: true
      });
    }
    expect(conversionFormats.find((format) => format.extension === 'csv')).toMatchObject({
      targetFormat: 'xlsx',
      family: 'workbook',
      driverId: 'xlsx',
      conversionRequired: true
    });
    expect(conversionFormats.find((format) => format.extension === 'json')).toMatchObject({
      targetFormat: 'xlsx',
      family: 'workbook',
      driverId: 'xlsx',
      conversionRequired: true
    });
    for (const extension of ['tab', 'jsonlines', 'ldjson']) {
      expect(conversionFormats.find((format) => format.extension === extension)).toMatchObject({
        targetFormat: 'xlsx',
        family: 'workbook',
        driverId: 'xlsx',
        conversionRequired: true
      });
    }
    for (const extension of ['dbf', 'slk', 'dif']) {
      expect(conversionFormats.find((format) => format.extension === extension)).toMatchObject({
        targetFormat: 'xlsx',
        family: 'workbook',
        driverId: 'xlsx',
        conversionRequired: true
      });
    }

    for (const extension of [
      'dwg',
      'step',
      'wbk',
      'xlk',
      'xla',
      'xlam',
      'odm',
      'oth',
      'sxg'
    ]) {
      expect(conversionFormats.find((format) => format.extension === extension)).toBeUndefined();
    }

    for (const allowed of [
      'application/msword',
      'application/rtf',
      'text/rtf',
      'application/vnd.ms-powerpoint',
      'application/vnd.ms-excel',
      'application/vnd.ms-excel.sheet.macroenabled.12',
      'application/vnd.ms-excel.template.macroenabled.12',
      'application/vnd.ms-word.document.macroenabled.12',
      'application/vnd.ms-word.template.macroenabled.12',
      'application/vnd.ms-powerpoint.presentation.macroenabled.12',
      'application/vnd.ms-powerpoint.slideshow.macroenabled.12',
      'application/vnd.ms-powerpoint.template.macroenabled.12',
      'application/vnd.sun.xml.writer',
      'application/vnd.sun.xml.writer.template',
      'application/vnd.sun.xml.calc',
      'application/vnd.sun.xml.calc.template',
      'application/vnd.sun.xml.impress',
      'application/vnd.sun.xml.impress.template',
      'application/vnd.ms-works',
      'application/wps-office.dpt',
      'application/wps-office.wpt',
      'application/wps-office.ett',
      'application/vnd.oasis.opendocument.text',
      'application/vnd.oasis.opendocument.text-template',
      'application/vnd.oasis.opendocument.text-flat-xml',
      'application/vnd.oasis.opendocument.spreadsheet',
      'application/vnd.oasis.opendocument.spreadsheet-template',
      'application/vnd.oasis.opendocument.spreadsheet-flat-xml',
      'application/x-dbf',
      'text/spreadsheet',
      'application/x-dif',
      'application/vnd.oasis.opendocument.presentation',
      'application/vnd.oasis.opendocument.presentation-template',
      'application/vnd.oasis.opendocument.presentation-flat-xml',
      'application/vnd.oasis.opendocument.graphics',
      'application/vnd.oasis.opendocument.graphics-template',
      'application/vnd.oasis.opendocument.graphics-flat-xml',
      'application/vnd.sun.xml.draw',
      'application/vnd.sun.xml.draw.template',
      'text/plain',
      'text/markdown',
      'text/html',
      'application/xhtml+xml',
      'application/json',
      'text/csv',
      'text/tab-separated-values',
      'text/x-shellscript',
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'image/avif',
      'image/apng',
      'image/x-icon',
      'image/svg+xml',
      'image/bmp'
    ]) {
      expect(accept).toContain(allowed);
    }

    for (const forbidden of [
      'application/vnd.oasis.opendocument.text-master',
      'application/vnd.sun.xml.writer.global'
    ]) {
      expect(accept).not.toContain(forbidden);
    }
    expect(listPreviewExtensions({ families: ['ebook'] })).toEqual(expect.arrayContaining(['epub', 'cbz']));
    expect(listPreviewExtensions({ families: ['ebook'] })).not.toEqual(expect.arrayContaining(['mobi', 'azw3']));

    const customAccept = createPreviewAcceptAttribute({
      routes: [
        {
          extensions: ['pdf'],
          family: 'paged',
          driverId: 'pdf',
          contentTypes: ['application/pdf']
        },
        {
          extensions: ['dwg'],
          family: 'paged',
          driverId: 'pdf',
          targetFormat: 'pdf',
          conversion: { required: true }
        }
      ]
    });
    expect(customAccept).toBe('.dwg,.pdf,application/pdf');
  });

  it('lists each extension once and prefers direct preview routes', () => {
    const formats = listPreviewFormats();

    for (const extension of ['txt', 'csv', 'html']) {
      expect(formats.filter((format) => format.extension === extension)).toHaveLength(1);
      expect(formats.find((format) => format.extension === extension)?.conversionRequired).toBe(false);
    }
  });

  it('groups formats by standard while keeping software as compatibility metadata', () => {
    const routes = [
      { extensions: ['docx'], family: 'flow', driverId: 'docx' },
      { extensions: ['doc', 'dot', 'rtf', 'xls', 'xlt', 'ppt', 'pps', 'pot'], family: 'flow', driverId: 'docx' },
      { extensions: ['wps', 'wpt', 'et', 'ett', 'dps', 'dpt'], family: 'flow', driverId: 'docx' },
      { extensions: ['odt'], family: 'flow', driverId: 'docx' },
      { extensions: ['numbers'], family: 'workbook', driverId: 'iwork' },
      { extensions: ['dxf'], family: 'cad', driverId: 'cad' },
      { extensions: ['fcstd'], family: 'model3d', driverId: 'model3d' },
      { extensions: ['step'], family: 'model3d', driverId: 'model3d' },
      { extensions: ['txt'], family: 'text', driverId: 'text' },
      { extensions: ['csv'], family: 'workbook', driverId: 'xlsx' },
      { extensions: ['html'], family: 'html', driverId: 'html' },
      { extensions: ['epub'], family: 'ebook', driverId: 'ebook' },
      { extensions: ['cbz'], family: 'ebook', driverId: 'ebook' }
    ] as const;
    const normalizedRoutes = routes.map((route) => ({ ...route, extensions: [...route.extensions] }));
    const formats = listPreviewFormats({ routes: normalizedRoutes });

    expect(formats.find((format) => format.extension === 'docx')).toMatchObject({
      group: 'office-modern',
      groupLabel: 'Modern Office',
      applications: expect.arrayContaining(['Microsoft Office', 'ONLYOFFICE'])
    });
    expect(formats.find((format) => format.extension === 'odt')).toMatchObject({
      group: 'office-opendocument',
      applications: expect.arrayContaining(['LibreOffice', 'Apache OpenOffice'])
    });
    expect(formats.find((format) => format.extension === 'numbers')).toMatchObject({
      group: 'office-iwork',
      applications: ['Apple iWork']
    });
    expect(formats.filter((format) => ['doc', 'dot', 'rtf', 'xls', 'xlt', 'ppt', 'pps', 'pot'].includes(format.extension)))
      .toHaveLength(8);
    expect(formats.filter((format) => ['wps', 'wpt', 'et', 'ett', 'dps', 'dpt'].includes(format.extension)))
      .toHaveLength(6);
    expect(classifyPreviewFormat('csv', 'workbook')).toBe('content');
    expect(listPreviewFormatGroups().find((group) => group.id === 'office-legacy')?.formats.map((format) => format.extension))
      .toEqual(expect.arrayContaining(['doc', 'dot', 'rtf', 'xls', 'xlt', 'ppt', 'pps', 'pot']));
    expect(listPreviewFormatGroups().find((group) => group.id === 'office-wps')?.formats.map((format) => format.extension))
      .toEqual(expect.arrayContaining(['wps', 'wpt', 'et', 'ett', 'dps', 'dpt']));
    expect(classifyPreviewFormat('dxf', 'cad')).toBe('cad-drawing');
    expect(classifyPreviewFormat('fcstd', 'model3d')).toBe('cad-parametric');
    expect(classifyPreviewFormat('step', 'model3d')).toBe('cad-exchange');
    expect(classifyPreviewFormat('insv', 'panorama-video')).toBe('panorama');
    expect(classifyPreviewFormat('insp', 'panorama')).toBe('panorama');
    expect(classifyPreviewFormat('cbr', 'ebook')).toBe('archive');
    expect(formats.filter((format) => ['txt', 'html', 'epub'].includes(format.extension)).map((format) => format.group))
      .toEqual(['content', 'content', 'content']);
    expect(formats.find((format) => format.extension === 'cbz')?.group).toBe('archive');
    expect(listPreviewFormatGroups({ routes: normalizedRoutes, groups: ['cad-exchange'] }))
      .toMatchObject([{ id: 'cad-exchange', label: 'CAD Exchange', formats: [{ extension: 'step' }] }]);
  });

  it('supports common browser-native image formats', () => {
    const driver = createImagePreviewDriver();
    for (const extension of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'apng', 'ico', 'svg', 'bmp']) {
      expect(driver.supports(extension)).toBe(true);
    }
  });
});

describe('file set resource resolver', () => {
  it('resolves related uploaded resources by path and unique basename', async () => {
    const image = new File([new Uint8Array([1, 2, 3])], 'textures/diffuse.png', { type: 'image/png' });
    const buffer = new File([new Uint8Array([4, 5])], 'model.bin');
    const resolver = createFileSetResourceResolver([image, buffer]);

    await expect(resolveFileSetName(resolver, 'textures/diffuse.png?v=1#preview')).resolves.toBe('textures/diffuse.png');
    await expect(resolveFileSetName(resolver, 'C:\\uploads\\model.bin')).resolves.toBe('model.bin');
  });

  it('supports rooted resource indexes and avoids ambiguous basename matches', () => {
    const left = new File(['left'], 'a/shared.png');
    const right = new File(['right'], 'b/shared.png');
    const exact = new File(['model'], 'scene/model.bin');
    const index = createFileSetResourceIndex([left, right, exact], { root: 'scene' });

    expect(index.read('model.bin')?.name).toBe('scene/model.bin');
    expect(index.read('shared.png')).toBeUndefined();
    expect(index.read('a/shared.png')?.name).toBe('a/shared.png');
  });
});

describe('PreviewRegistry', () => {
  it('resolves routes and registered drivers independently', () => {
    const driver = createDriver('image', 'image');
    const registry = createPreviewRegistry({ drivers: [driver] });

    const imageRoute = registry.resolve({ name: 'photo.png' });
    const pptRoute = registry.resolve({ name: 'deck.pptx' });

    expect(imageRoute?.route).toMatchObject({
      sourceFormat: 'png',
      family: 'image',
      driverId: 'image'
    });
    expect(imageRoute?.driver).toBe(driver);
    expect(pptRoute?.route.driverId).toBe('pptx');
    expect(pptRoute?.driver).toBeUndefined();

    registry.unregister('image');
    expect(registry.getDriver('image')).toBeUndefined();
  });

  it('accepts package-provided routes before the default conversion table', () => {
    const driver = createDriver('iwork', 'paged');
    const registry = createPreviewRegistry({
      drivers: [driver],
      routes: createDefaultPreviewRoutes([
        {
          extensions: ['key'],
          targetFormat: 'key',
          family: 'paged',
          driverId: 'iwork'
        }
      ])
    });

    const resolved = registry.resolve({ name: 'deck.key' });
    expect(resolved?.driver).toBe(driver);
    expect(resolved?.route).toMatchObject({
      sourceFormat: 'key',
      targetFormat: 'key',
      driverId: 'iwork',
      family: 'paged'
    });
    expect(resolved?.route.conversion).toBeUndefined();
  });
});

describe('PptxPreviewDriver', () => {
  it('loads PPTX through the generic preview session contract', async () => {
    const bytes = await readFixture('fixtures-text-theme.pptx');
    const container = document.createElement('div');
    document.body.appendChild(container);

    const driver = createPptxPreviewDriver();
    const session = driver.createSession(container, {
      fit: 'none',
      initialScale: 1
    });
    const renderedStates: PreviewItemState[] = [];
    const stateChanges: PreviewItemState[] = [];

    session.on('rendered', (state) => {
      renderedStates.push(state);
    });
    session.on('statechange', (state) => {
      stateChanges.push(state);
    });

    await session.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), {
      descriptor: {
        source: bytes,
        name: 'fixture.pptx',
        extension: 'pptx'
      }
    });

    expect(driver.supports('pptx')).toBe(true);
    expect(driver.supports('.PPTX')).toBe(true);
    expect(session.getState()).toMatchObject({
      family: 'paged',
      pageIndex: 0,
      pageCount: 1,
      scale: 1,
      capabilities: {
        paged: true,
        thumbnails: true,
        zoom: true
      }
    });
    expect(renderedStates).toHaveLength(1);
    expect(stateChanges.length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('.pptxv-slide')).toBeTruthy();

    session.destroy();
    container.remove();
  });
});

describe('native preview drivers', () => {
  it('renders image sources with zoomable image state', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const session = createImagePreviewDriver().createSession(container, {
      initialScale: 1,
      fit: 'contain'
    });
    const renderedStates: PreviewItemState[] = [];

    session.on('rendered', (state) => {
      renderedStates.push(state);
    });

    await session.load(new Uint8Array([137, 80, 78, 71]), {
      descriptor: {
        source: new Uint8Array([137, 80, 78, 71]),
        name: 'photo.png',
        extension: 'png',
        contentType: 'image/png'
      },
      route: resolveFormatRoute({ name: 'photo.png' }) ?? undefined
    });

    const image = container.querySelector('img.pptxv-native-image') as HTMLImageElement | null;
    expect(image).toBeTruthy();
    image?.dispatchEvent(new Event('load'));

    expect(session.getState()).toMatchObject({
      family: 'image',
      loading: false,
      scale: 1,
      capabilities: {
        zoom: true,
        fit: true,
        pan: true,
        rotate: true
      },
      rotation: 0,
      panX: 0,
      panY: 0
    });
    expect(renderedStates).toHaveLength(1);

    session.setScale?.(1.5);
    expect(session.getState()).toMatchObject({
      scale: 1.5
    });
    expect(image?.style.transform).toBe('translate(0px, 0px) rotate(0deg) scale(1.5)');

    session.rotate?.();
    expect(session.getState()).toMatchObject({
      rotation: 90
    });
    expect(image?.style.transform).toBe('translate(0px, 0px) rotate(90deg) scale(1.5)');

    session.rotate?.(-180);
    expect(session.getState()).toMatchObject({
      rotation: 270
    });
    expect(image?.style.transform).toBe('translate(0px, 0px) rotate(270deg) scale(1.5)');

    session.pan?.(24, -12);
    expect(session.getState()).toMatchObject({
      panX: 24,
      panY: -12
    });
    expect(image?.style.transform).toBe('translate(24px, -12px) rotate(270deg) scale(1.5)');

    session.fit?.('height');
    expect(image?.style.maxWidth).toBe('none');
    expect(image?.style.maxHeight).toBe('100%');
    expect(session.getState()).toMatchObject({
      scale: 1,
      panX: 0,
      panY: 0
    });

    session.fit?.('contain');
    expect(session.getState()).toMatchObject({
      scale: 1,
      panX: 0,
      panY: 0
    });

    const root = container.querySelector('.pptxv-native-preview') as HTMLElement | null;
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(root, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen
    });
    await session.fullscreen?.();
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalled();

    session.destroy();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-fixture');
    container.remove();
  });

  it('renders text and code sources through the text driver', async () => {
    const textContainer = document.createElement('div');
    const codeContainer = document.createElement('div');
    document.body.append(textContainer, codeContainer);

    const textSession = createTextPreviewDriver().createSession(textContainer);
    await textSession.load(new TextEncoder().encode('hello\nworld'), {
      descriptor: {
        source: new Uint8Array(),
        name: 'notes.txt',
        extension: 'txt',
        contentType: 'text/plain'
      },
      route: resolveFormatRoute({ name: 'notes.txt' }) ?? undefined
    });

    expect(textSession.getState()).toMatchObject({
      family: 'text',
      loading: false,
      lineCount: 2,
      wrap: true,
      capabilities: {
        lineNumbers: true
      }
    });
    expect(textContainer.querySelector('pre')?.textContent).toBe('hello\nworld');
    expect(Array.from(textContainer.querySelectorAll('.pptxv-native-text-gutter span')).map((line) => line.textContent)).toEqual([
      '1',
      '2'
    ]);

    const codeSession = createTextPreviewDriver().createSession(codeContainer);
    await codeSession.load(new TextEncoder().encode('const answer: number = 42;'), {
      descriptor: {
        source: new Uint8Array(),
        name: 'component.tsx',
        extension: 'tsx'
      },
      route: resolveFormatRoute({ name: 'component.tsx' }) ?? undefined
    });

    expect(codeSession.getState()).toMatchObject({
      family: 'code',
      language: 'tsx',
      loading: false,
      lineCount: 1,
      wrap: false,
      capabilities: {
        codeHighlight: true
      }
    });
    const codePre = codeContainer.querySelector('pre');
    expect(codePre?.dataset.family).toBe('code');
    expect(codePre?.dataset.language).toBe('tsx');
    expect(codePre?.dataset.wrap).toBe('false');
    expect(codePre?.dataset.highlighted).toBe('true');
    expect(codePre?.textContent).toBe('const answer: number = 42;');
    expect(codePre?.querySelector('.pptxv-token--keyword')?.textContent).toBe('const');
    expect(codePre?.querySelector('.pptxv-token--number')?.textContent).toBe('42');

    const markdownSession = createTextPreviewDriver().createSession(textContainer);
    await markdownSession.load(new TextEncoder().encode('# Markdown'), {
      descriptor: {
        source: new Uint8Array(),
        name: 'notes.markdown',
        extension: 'markdown',
        contentType: 'text/markdown'
      },
      route: resolveFormatRoute({ name: 'notes.markdown' }) ?? undefined
    });
    expect(markdownSession.getState()).toMatchObject({
      family: 'code',
      language: 'markdown',
      loading: false,
      wrap: false
    });
    markdownSession.destroy();

    textSession.destroy();
    codeSession.destroy();
    textContainer.remove();
    codeContainer.remove();
  });

  it('renders audio and video media elements with playback capabilities', async () => {
    const audioContainer = document.createElement('div');
    const videoContainer = document.createElement('div');
    document.body.append(audioContainer, videoContainer);

    const audioSession = createMediaPreviewDriver().createSession(audioContainer);
    await audioSession.load(new Uint8Array([1, 2, 3]), {
      descriptor: {
        source: new Uint8Array([1, 2, 3]),
        name: 'track.mp3',
        extension: 'mp3',
        contentType: 'audio/mpeg'
      },
      route: resolveFormatRoute({ name: 'track.mp3' }) ?? undefined
    });

    const audio = audioContainer.querySelector('audio.pptxv-native-media');
    expect(audio).toBeTruthy();
    audio?.dispatchEvent(new Event('loadedmetadata'));
    expect(audioSession.getState()).toMatchObject({
      family: 'audio',
      loading: false,
      paused: true,
      capabilities: {
        playback: true,
        fullscreen: false
      }
    });

    const videoSession = createMediaPreviewDriver().createSession(videoContainer);
    await videoSession.load('/media/movie.mp4', {
      descriptor: {
        source: '/media/movie.mp4',
        name: 'movie.mp4',
        extension: 'mp4',
        contentType: 'video/mp4'
      },
      route: resolveFormatRoute({ name: 'movie.mp4' }) ?? undefined
    });

    const video = videoContainer.querySelector('video.pptxv-native-media');
    expect(video).toBeTruthy();
    video?.dispatchEvent(new Event('loadedmetadata'));
    expect(videoSession.getState()).toMatchObject({
      family: 'video',
      loading: false,
      paused: true,
      capabilities: {
        playback: true,
        fullscreen: true
      }
    });

    audioSession.destroy();
    videoSession.destroy();
    audioContainer.remove();
    videoContainer.remove();
  });

  it('renders HTML sources in a sandboxed iframe', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createHtmlPreviewDriver().createSession(container);
    const renderedStates: PreviewItemState[] = [];

    session.on('rendered', (state) => {
      renderedStates.push(state);
    });

    await session.load('<!doctype html><html><body>Converted HTML</body></html>', {
      descriptor: {
        source: '<!doctype html><html><body>Converted HTML</body></html>',
        name: 'converted.html',
        extension: 'html',
        contentType: 'text/html'
      },
      route: resolveFormatRoute({ name: 'converted.html' }) ?? undefined
    });

    const frame = container.querySelector('iframe.pptxv-native-html-frame') as HTMLIFrameElement | null;
    expect(frame).toBeTruthy();
    expect(frame?.getAttribute('sandbox')).toContain('allow-same-origin');
    expect(frame?.src).toContain('blob:preview-fixture');
    frame?.dispatchEvent(new Event('load'));

    expect(session.getState()).toMatchObject({
      family: 'html',
      loading: false,
      capabilities: {
        print: true,
        fullscreen: true
      }
    });
    expect(renderedStates).toHaveLength(1);

    session.destroy();
    container.remove();
  });

  it('renders XHTML sources in a sandboxed iframe', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createHtmlPreviewDriver().createSession(container);

    await session.load('<!doctype html><html><body>XHTML preview</body></html>', {
      descriptor: {
        source: '<!doctype html><html><body>XHTML preview</body></html>',
        name: 'converted.xhtml',
        extension: 'xhtml',
        contentType: 'application/xhtml+xml'
      },
      route: resolveFormatRoute({ name: 'converted.xhtml' }) ?? undefined
    });

    const frame = container.querySelector('iframe.pptxv-native-html-frame') as HTMLIFrameElement | null;
    expect(frame).toBeTruthy();
    frame?.dispatchEvent(new Event('load'));

    expect(session.getState()).toMatchObject({
      family: 'html',
      loading: false
    });

    session.destroy();
    container.remove();
  });
});

describe('Previewer runtime', () => {
  it('loads PPTX through the default registered driver', async () => {
    const bytes = await readFixture('fixtures-text-theme.pptx');
    const container = document.createElement('div');
    document.body.appendChild(container);

    const previewer = createPreviewer(container, {
      fit: 'none',
      initialScale: 1
    });
    const renderedStates: PreviewItemState[] = [];

    previewer.on('rendered', (state) => {
      renderedStates.push(state);
    });

    await previewer.preview(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), {
      name: 'fixture.pptx'
    });

    expect(previewer.getState()).toMatchObject({
      family: 'paged',
      pageCount: 1,
      pageIndex: 0
    });
    expect(renderedStates).toHaveLength(1);
    expect(container.querySelector('.pptxv-slide')).toBeTruthy();

    previewer.destroy();
    container.remove();
  });

  it('loads native image and text formats through default registered drivers', async () => {
    const imageHost = document.createElement('div');
    const textHost = document.createElement('div');
    document.body.append(imageHost, textHost);

    const imagePreviewer = createPreviewer(imageHost);
    await imagePreviewer.preview(new Uint8Array([1, 2, 3]), {
      name: 'photo.png',
      contentType: 'image/png'
    });
    const image = imageHost.querySelector('img.pptxv-native-image');
    expect(image).toBeTruthy();
    image?.dispatchEvent(new Event('load'));
    expect(imagePreviewer.getState()).toMatchObject({
      family: 'image',
      loading: false
    });
    imagePreviewer.setScale(1.4);
    imagePreviewer.rotate();
    imagePreviewer.pan(8, 6);
    const imageRoot = imageHost.querySelector('.pptxv-native-preview') as HTMLElement | null;
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(imageRoot, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen
    });
    await imagePreviewer.fullscreen();
    expect(imagePreviewer.getState()).toMatchObject({
      scale: 1.4,
      rotation: 90,
      panX: 8,
      panY: 6
    });
    expect(requestFullscreen).toHaveBeenCalledTimes(1);

    const textPreviewer = createPreviewer(textHost);
    await textPreviewer.preview(new TextEncoder().encode('const value = true;'), {
      name: 'example.ts'
    });
    expect(textPreviewer.getState()).toMatchObject({
      family: 'code',
      loading: false,
      lineCount: 1
    });
    expect(textHost.querySelector('pre')?.textContent).toBe('const value = true;');

    imagePreviewer.destroy();
    textPreviewer.destroy();
    imageHost.remove();
    textHost.remove();
  });

  it('converts legacy documents before loading the OpenXML target driver', async () => {
    const source = new Uint8Array([1, 2, 3]);
    const converted = new Uint8Array([4, 5, 6]);
    const driver = createRecordingDriver('pptx', 'paged');
    const converter: ConverterClient = {
      convert: async (request) => {
        expect(request).toMatchObject({
          sourceFormat: 'ppt',
          targetFormat: 'pptx',
          name: 'legacy.ppt'
        });
        return {
          source: converted,
          format: 'pptx',
          contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          warnings: ['Converted to PPTX.']
        };
      }
    };
    const previewer = createPreviewer(document.createElement('div'), {
      drivers: [driver],
      converter
    });
    const warnings: string[][] = [];

    previewer.on('warnings', (items) => {
      warnings.push(items);
    });

    await previewer.preview(source, {
      name: 'legacy.ppt'
    });

    expect(driver.lastLoadedSource).toBe(converted);
    expect(driver.lastContext?.descriptor).toMatchObject({
      extension: 'pptx',
      contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    });
    expect(previewer.getState()).toMatchObject({
      family: 'paged',
      loading: false,
      error: null
    });
    expect(warnings).toEqual([['Converted to PPTX.']]);

    previewer.destroy();
  });

  it('leaves non-document conversion candidates unsupported by default', async () => {
    const converter: ConverterClient = {
      convert: vi.fn()
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const previewer = createPreviewer(host, {
      converter
    });
    const errors: Error[] = [];
    previewer.on('error', (error) => {
      errors.push(error);
    });

    await previewer.preview(new Uint8Array([1, 2, 3]), {
      name: 'draft.pages'
    });

    expect(converter.convert).not.toHaveBeenCalled();
    expect(errors[0]?.message).toContain('Unsupported preview format');
    expect(previewer.getState().error).toContain('Unsupported preview format');

    previewer.destroy();
    host.remove();
  });

  it('surfaces clear errors for missing converter or driver', async () => {
    const missingConverter = createPreviewer(document.createElement('div'));
    const errors: Error[] = [];
    missingConverter.on('error', (error) => {
      errors.push(error);
    });

    await missingConverter.preview(new Uint8Array([1]), {
      name: 'legacy.ppt'
    });

    expect(errors[0]?.message).toContain('No converter is configured');
    expect(errors[0]?.message).toContain('ppt -> pptx');
    expect(errors[0]?.message).toContain('presentations are normalized to PPTX');
    expect(missingConverter.getState().error).toContain('No converter is configured');

    const missingDriver = createPreviewer(document.createElement('div'), {
      drivers: []
    });
    const missingDriverErrors: Error[] = [];
    missingDriver.on('error', (error) => {
      missingDriverErrors.push(error);
    });

    await missingDriver.preview(new Uint8Array([1]), {
      name: 'photo.png'
    });

    expect(missingDriverErrors[0]?.message).toContain('No preview driver registered for image');
    expect(missingDriverErrors[0]?.message).toContain('png -> png');
  });

  it('surfaces target route context when converted output has no registered driver', async () => {
    const converter: ConverterClient = {
      convert: async () => ({
        source: new Uint8Array([37, 80, 68, 70]),
        format: 'pdf',
        contentType: 'application/pdf'
      })
    };
    const previewer = createPreviewer(document.createElement('div'), {
      drivers: [],
      converter
    });
    const errors: Error[] = [];
    previewer.on('error', (error) => {
      errors.push(error);
    });

    await previewer.preview(new Uint8Array([1]), {
      name: 'legacy.ppt'
    });

    expect(errors[0]?.message).toContain('No preview driver registered for converted pdf output');
    expect(errors[0]?.message).toContain('ppt -> pptx');
    expect(errors[0]?.message).toContain('expected driver pptx');
  });

  it('normalizes source descriptors from files, bytes, and descriptor overrides', () => {
    expect(normalizeSourceDescriptor('/files/report.PDF?token=1')).toMatchObject({
      source: '/files/report.PDF?token=1',
      name: '/files/report.PDF?token=1',
      extension: 'pdf'
    });
    expect(normalizeSourceDescriptor(new Uint8Array([1, 2]), { name: 'code.ts' })).toMatchObject({
      extension: 'ts',
      size: 2
    });
    expect(
      normalizeSourceDescriptor(
        {
          source: new Uint8Array([1]),
          name: 'original.txt',
          extension: 'txt'
        },
        {
          name: 'override.md'
        }
      )
    ).toMatchObject({
      name: 'override.md',
      extension: 'txt'
    });
  });
});

function createDriver(id: string, family: PreviewDriver['family']): PreviewDriver {
  return {
    id,
    family,
    supports: (format) => format === id,
    createSession: () => {
      const state: PreviewItemState = {
        loading: false,
        error: null,
        family,
        warnings: [],
        capabilities: {}
      };

      return {
        load: async () => undefined,
        destroy: () => undefined,
        getState: () => state,
        on: () => () => undefined
      };
    }
  };
}

function createRecordingDriver(id: string, family: PreviewDriver['family']): PreviewDriver & {
  lastLoadedSource?: unknown;
  lastContext?: unknown;
} {
  const driver = createDriver(id, family) as PreviewDriver & {
    lastLoadedSource?: unknown;
    lastContext?: unknown;
  };
  driver.createSession = () => {
    const state: PreviewItemState = {
      loading: false,
      error: null,
      family,
      warnings: [],
      capabilities: {}
    };
    const session: PreviewSession = {
      load: async (source, context) => {
        driver.lastLoadedSource = source;
        driver.lastContext = context;
      },
      destroy: () => undefined,
      getState: () => state,
      on: () => () => undefined
    };
    return session;
  };
  return driver;
}
