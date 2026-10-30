import type { FormatRoute, PreviewFamily, SourceDescriptor } from './types';
import conversionManifest from '../../../../wasm/converter-core/manifest/conversions.json';

export type PreviewFormatGroup =
  | 'office-modern'
  | 'office-legacy'
  | 'office-wps'
  | 'office-opendocument'
  | 'office-openoffice-legacy'
  | 'office-iwork'
  | 'document'
  | 'pdf'
  | 'cad-drawing'
  | 'cad-parametric'
  | 'cad-exchange'
  | 'bim'
  | 'model3d'
  | 'diagram'
  | 'mindmap'
  | 'image'
  | 'panorama'
  | 'media'
  | 'archive'
  | 'content'
  | 'structured-data'
  | 'other';

export interface FormatDefinition {
  extensions: string[];
  family: PreviewFamily;
  driverId: string;
  targetFormat?: string;
  contentTypes?: string[];
  conversion?: FormatRoute['conversion'];
  group?: PreviewFormatGroup;
  applications?: string[];
}

export interface ResolveFormatRouteOptions {
  routes?: FormatDefinition[];
}

export interface PreviewFormatSupport {
  extension: string;
  targetFormat: string;
  family: PreviewFamily;
  driverId: string;
  contentTypes: string[];
  conversionRequired: boolean;
  conversionReason?: string;
  group: PreviewFormatGroup;
  groupLabel: string;
  applications: string[];
}

export interface PreviewFormatGroupSupport {
  id: PreviewFormatGroup;
  label: string;
  applications: string[];
  formats: PreviewFormatSupport[];
}

export interface ListPreviewFormatsOptions {
  routes?: FormatDefinition[];
  includeDirect?: boolean;
  includeConversion?: boolean;
  families?: PreviewFamily[];
  groups?: PreviewFormatGroup[];
}

const FORMAT_GROUP_LABELS: Record<PreviewFormatGroup, string> = {
  'office-modern': 'Modern Office',
  'office-legacy': 'Legacy Office',
  'office-wps': 'WPS Office',
  'office-opendocument': 'OpenDocument',
  'office-openoffice-legacy': 'Legacy OpenOffice',
  'office-iwork': 'iWork',
  document: 'Documents',
  pdf: 'PDF',
  'cad-drawing': '2D CAD',
  'cad-parametric': 'Parametric CAD',
  'cad-exchange': 'CAD Exchange',
  bim: 'BIM',
  model3d: '3D Models',
  diagram: 'Diagrams',
  mindmap: 'Mind Maps',
  image: 'Images',
  panorama: 'Panoramas',
  media: 'Audio & Video',
  archive: 'Archives',
  content: 'Text & Reading',
  'structured-data': 'Structured Data',
  other: 'Other'
};

const MODERN_OFFICE_FORMATS = new Set(['docx', 'docm', 'dotx', 'dotm', 'xlsx', 'xlsm', 'xltx', 'xltm', 'pptx', 'pptm', 'ppsx', 'ppsm', 'potx', 'potm']);
const LEGACY_OFFICE_FORMATS = new Set(['doc', 'dot', 'rtf', 'xls', 'xlt', 'ppt', 'pps', 'pot']);
const WPS_FORMATS = new Set(['wps', 'wpt', 'et', 'ett', 'dps', 'dpt']);
const OPENDOCUMENT_FORMATS = new Set(['odt', 'ott', 'fodt', 'ods', 'ots', 'fods', 'odp', 'otp', 'fodp', 'odg', 'otg', 'fodg', 'odf']);
const LEGACY_OPENOFFICE_FORMATS = new Set(['sxw', 'stw', 'sxc', 'stc', 'sxi', 'sti', 'sxd', 'std']);
const IWORK_FORMATS = new Set(['pages', 'numbers', 'key']);
const CAD_DRAWING_FORMATS = new Set(['dxf', 'dwg', 'dgn']);
const CAD_PARAMETRIC_FORMATS = new Set(['fcstd']);
const CAD_EXCHANGE_FORMATS = new Set(['step', 'stp', 'iges', 'igs', 'brep', 'brp']);
const BIM_FORMATS = new Set(['ifc']);
const STRUCTURED_DATA_FORMATS = new Set(['csv', 'tsv', 'tab', 'psv', 'json', 'jsonl', 'jsonlines', 'ndjson', 'ldjson', 'xml', 'yaml', 'yml', 'toml', 'ini']);
const PANORAMA_FORMATS = new Set(['pano', 'panorama', '360', 'insv', 'insp', 'osv']);
const ARCHIVE_FORMATS = new Set(['zip', 'zipx', 'rar', '7z', 'tar', 'gz', 'bz', 'bz2', 'xz', 'z', 'zst', 'tgz', 'tbz', 'tbz2', 'txz', 'lz', 'lzma', 'cab', 'iso', 'ar', 'cpio', 'ace', 'lha', 'lzh', 'zoo', 'xar', 'sit', 'sitx', 'apk', 'jar', 'war', 'ear', 'xpi', 'crx', 'deb', 'rpm', 'dmg', 'img', 'wim', 'swm', 'esd', 'pak', '001', 'cbz', 'cbr', 'cb7', 'cbt']);

export const DIRECT_FORMAT_ROUTES: FormatDefinition[] = [
  defineRoute(['pptx'], 'paged', 'pptx'),
  defineRoute(['pdf'], 'paged', 'pdf', {
    contentTypes: ['application/pdf']
  }),
  defineRoute(['docx'], 'flow', 'docx'),
  defineRoute(['xlsx'], 'workbook', 'xlsx'),
  defineRoute(['csv'], 'workbook', 'xlsx', {
    contentTypes: ['text/csv', 'application/csv']
  }),
  defineRoute(['html', 'htm', 'shtml'], 'html', 'html', {
    targetFormat: 'html',
    contentTypes: ['text/html']
  }),
  defineRoute(['xhtml', 'xht', 'xhtm'], 'html', 'html', {
    targetFormat: 'html',
    contentTypes: ['application/xhtml+xml']
  }),
  defineRoute(['json'], 'code', 'text', {
    contentTypes: ['application/json']
  }),
  defineRoute(['xml'], 'code', 'text', {
    contentTypes: ['application/xml', 'text/xml']
  }),
  defineRoute(['yaml', 'yml'], 'code', 'text', {
    contentTypes: ['application/yaml', 'application/x-yaml', 'text/yaml', 'text/x-yaml']
  }),
  defineRoute(['toml'], 'code', 'text', {
    contentTypes: ['application/toml', 'text/toml', 'text/x-toml']
  }),
  defineRoute(['ini'], 'code', 'text', {
    contentTypes: ['text/x-ini']
  }),
  defineRoute(['rst', 'rest'], 'code', 'text', {
    contentTypes: ['text/x-rst', 'text/prs.fallenstein.rst']
  }),
  defineRoute(['adoc', 'asciidoc', 'asc'], 'code', 'text', {
    contentTypes: ['text/asciidoc', 'text/x-asciidoc']
  }),
  defineRoute(['tex', 'latex', 'ltx', 'sty', 'cls'], 'code', 'text', {
    contentTypes: ['application/x-tex', 'text/x-tex']
  }),
  defineRoute(['properties'], 'code', 'text', {
    contentTypes: ['text/x-java-properties']
  }),
  defineRoute(['env'], 'code', 'text', {
    contentTypes: ['application/x-env', 'text/x-env']
  }),
  defineRoute(['conf', 'config', 'cfg', 'cnf'], 'code', 'text', {
    contentTypes: ['text/x-config']
  }),
  defineRoute(['sql'], 'code', 'text', {
    contentTypes: ['application/sql', 'application/x-sql', 'text/x-sql']
  }),
  defineRoute(['png'], 'image', 'image', { contentTypes: ['image/png'] }),
  defineRoute(['jpg', 'jpeg'], 'image', 'image', { contentTypes: ['image/jpeg'] }),
  defineRoute(['gif'], 'image', 'image', { contentTypes: ['image/gif'] }),
  defineRoute(['webp'], 'image', 'image', { contentTypes: ['image/webp'] }),
  defineRoute(['avif'], 'image', 'image', { contentTypes: ['image/avif'] }),
  defineRoute(['apng'], 'image', 'image', { contentTypes: ['image/apng'] }),
  defineRoute(['ico'], 'image', 'image', { contentTypes: ['image/x-icon', 'image/vnd.microsoft.icon'] }),
  defineRoute(['svg'], 'image', 'image', { contentTypes: ['image/svg+xml'] }),
  defineRoute(['bmp'], 'image', 'image', { contentTypes: ['image/bmp', 'image/x-ms-bmp'] }),
  defineRoute(['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv', 'avi', 'mpeg', 'mpg', '3gp'], 'video', 'media'),
  defineRoute(['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'oga', 'opus'], 'audio', 'media'),
  defineRoute(['epub'], 'ebook', 'ebook', {
    contentTypes: ['application/epub+zip']
  }),
  defineRoute(['cbz'], 'ebook', 'ebook', {
    contentTypes: ['application/vnd.comicbook+zip', 'application/x-cbz']
  }),
  defineRoute(['js', 'jsx', 'mjs', 'cjs'], 'code', 'text', {
    contentTypes: ['text/javascript', 'application/javascript']
  }),
  defineRoute(['ts', 'tsx', 'mts', 'cts'], 'code', 'text', {
    contentTypes: ['text/typescript', 'application/typescript']
  }),
  defineRoute(['vue'], 'code', 'text', {
    contentTypes: ['text/x-vue']
  }),
  defineRoute(['css'], 'code', 'text', {
    contentTypes: ['text/css']
  }),
  defineRoute(['scss', 'sass'], 'code', 'text', {
    contentTypes: ['text/x-scss', 'text/x-sass']
  }),
  defineRoute(['less'], 'code', 'text', {
    contentTypes: ['text/x-less']
  }),
  defineRoute(['c', 'h'], 'code', 'text', {
    contentTypes: ['text/x-csrc']
  }),
  defineRoute(['cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx'], 'code', 'text', {
    contentTypes: ['text/x-c++src']
  }),
  defineRoute(['cs'], 'code', 'text', {
    contentTypes: ['text/x-csharp']
  }),
  defineRoute(['go'], 'code', 'text', {
    contentTypes: ['text/x-go']
  }),
  defineRoute(['java'], 'code', 'text', {
    contentTypes: ['text/x-java-source']
  }),
  defineRoute(['kt', 'kts'], 'code', 'text', {
    contentTypes: ['text/x-kotlin']
  }),
  defineRoute(['lua'], 'code', 'text', {
    contentTypes: ['text/x-lua']
  }),
  defineRoute(['php'], 'code', 'text', {
    contentTypes: ['application/x-httpd-php', 'text/x-php']
  }),
  defineRoute(['py'], 'code', 'text', {
    contentTypes: ['text/x-python']
  }),
  defineRoute(['rb'], 'code', 'text', {
    contentTypes: ['text/x-ruby']
  }),
  defineRoute(['rs'], 'code', 'text', {
    contentTypes: ['text/rust', 'text/x-rustsrc']
  }),
  defineRoute(['sh'], 'code', 'text', {
    contentTypes: ['application/x-sh', 'text/x-shellscript']
  }),
  defineRoute(['bat', 'cmd'], 'code', 'text', {
    contentTypes: ['application/x-msdos-program', 'text/x-msdos-batch']
  }),
  defineRoute(['ps1'], 'code', 'text', {
    contentTypes: ['text/x-powershell']
  }),
  defineRoute(['swift'], 'code', 'text', {
    contentTypes: ['text/x-swift']
  }),
  defineRoute(['jsonc'], 'code', 'text', {
    contentTypes: ['application/jsonc', 'text/jsonc']
  }),
  defineRoute(['json5'], 'code', 'text', {
    contentTypes: ['application/json5', 'text/json5']
  }),
  defineRoute(['gql', 'graphql'], 'code', 'text', {
    contentTypes: ['application/graphql', 'text/graphql']
  }),
  defineRoute(['proto'], 'code', 'text', {
    contentTypes: ['application/x-protobuf', 'text/x-protobuf', 'text/proto']
  }),
  defineRoute(['diff'], 'code', 'text', {
    contentTypes: ['text/x-diff']
  }),
  defineRoute(['patch'], 'code', 'text', {
    contentTypes: ['text/x-patch']
  }),
  defineRoute(['gitignore'], 'code', 'text', {
    contentTypes: ['text/x-gitignore']
  }),
  defineRoute(['dockerignore'], 'code', 'text', {
    contentTypes: ['text/x-dockerignore']
  }),
  defineRoute(['editorconfig'], 'code', 'text', {
    contentTypes: ['text/x-editorconfig']
  }),
  defineRoute(['r'], 'code', 'text', {
    contentTypes: ['text/x-r', 'text/r']
  }),
  defineRoute(['dart'], 'code', 'text', {
    contentTypes: ['text/x-dart']
  }),
  defineRoute(['scala'], 'code', 'text', {
    contentTypes: ['text/x-scala']
  }),
  defineRoute(['groovy', 'gradle'], 'code', 'text', {
    contentTypes: ['text/x-groovy']
  }),
  defineRoute(['pl'], 'code', 'text', {
    contentTypes: ['text/x-perl']
  }),
  defineRoute(['ex'], 'code', 'text', {
    contentTypes: ['text/x-elixir']
  }),
  defineRoute(['erl'], 'code', 'text', {
    contentTypes: ['text/x-erlang']
  }),
  defineRoute(['fs', 'fsi', 'fsx'], 'code', 'text', {
    contentTypes: ['text/x-fsharp']
  }),
  defineRoute(['vb'], 'code', 'text', {
    contentTypes: ['text/x-vb']
  }),
  defineRoute(['clj'], 'code', 'text', {
    contentTypes: ['text/x-clojure']
  }),
  defineRoute(['hs'], 'code', 'text', {
    contentTypes: ['text/x-haskell']
  }),
  defineRoute(['jl'], 'code', 'text', {
    contentTypes: ['text/x-julia']
  }),
  defineRoute(['zig'], 'code', 'text', {
    contentTypes: ['text/x-zig']
  }),
  defineRoute(['m', 'matlab'], 'code', 'text', {
    contentTypes: ['text/x-matlab']
  }),
  defineRoute(['svelte'], 'code', 'text', {
    contentTypes: ['text/x-svelte']
  }),
  defineRoute(['astro'], 'code', 'text', {
    contentTypes: ['text/x-astro']
  }),
  defineRoute(['mdx'], 'code', 'text', {
    contentTypes: ['text/mdx', 'text/x-mdx']
  }),
  defineRoute(['tf', 'tfvars', 'hcl'], 'code', 'text', {
    contentTypes: ['text/x-hcl']
  }),
  defineRoute(['rego'], 'code', 'text', {
    contentTypes: ['text/x-rego']
  }),
  defineRoute(['bicep'], 'code', 'text', {
    contentTypes: ['text/x-bicep']
  }),
  defineRoute(['prisma'], 'code', 'text', {
    contentTypes: ['text/x-prisma']
  }),
  defineRoute(['dockerfile'], 'code', 'text', {
    contentTypes: ['text/x-dockerfile']
  }),
  defineRoute(['cmake'], 'code', 'text', {
    contentTypes: ['text/x-cmake']
  }),
  defineRoute(['make', 'mk'], 'code', 'text', {
    contentTypes: ['text/x-makefile']
  }),
  defineRoute(['bash', 'zsh', 'fish'], 'code', 'text', {
    contentTypes: ['text/x-shellscript']
  }),
  defineRoute(['csproj', 'vbproj', 'fsproj', 'props', 'targets'], 'code', 'text', {
    contentTypes: ['application/x-msbuild']
  }),
  defineRoute(['sln'], 'code', 'text', {
    contentTypes: ['text/x-ms-sln']
  }),
  defineRoute(['cshtml', 'razor'], 'code', 'text', {
    contentTypes: ['text/x-cshtml']
  }),
  defineRoute(['mustache', 'hbs'], 'code', 'text', {
    contentTypes: ['text/x-handlebars-template']
  }),
  defineRoute(['liquid'], 'code', 'text', {
    contentTypes: ['text/x-liquid']
  }),
  defineRoute(['jinja'], 'code', 'text', {
    contentTypes: ['text/x-jinja']
  }),
  defineRoute(['twig'], 'code', 'text', {
    contentTypes: ['text/x-twig']
  }),
  defineRoute(['ejs'], 'code', 'text', {
    contentTypes: ['text/x-ejs']
  }),
  defineRoute(['erb'], 'code', 'text', {
    contentTypes: ['text/x-erb']
  }),
  defineRoute(['haml'], 'code', 'text', {
    contentTypes: ['text/x-haml']
  }),
  defineRoute(['slim'], 'code', 'text', {
    contentTypes: ['text/x-slim']
  }),
  defineRoute(['mermaid', 'mmd'], 'code', 'text', {
    contentTypes: ['text/vnd.mermaid']
  }),
  defineRoute(['puml'], 'code', 'text', {
    contentTypes: ['text/x-plantuml']
  }),
  defineRoute(['avsc'], 'code', 'text', {
    contentTypes: ['application/vnd.apache.avro+json']
  }),
  defineRoute(['sol'], 'code', 'text', {
    contentTypes: ['text/x-solidity']
  }),
  defineRoute(['move'], 'code', 'text', {
    contentTypes: ['text/x-move']
  }),
  defineRoute(['nim'], 'code', 'text', {
    contentTypes: ['text/x-nim']
  }),
  defineRoute(['cr'], 'code', 'text', {
    contentTypes: ['text/x-crystal']
  }),
  defineRoute(['ml', 'mli'], 'code', 'text', {
    contentTypes: ['text/x-ocaml']
  }),
  defineRoute(['elm'], 'code', 'text', {
    contentTypes: ['text/x-elm']
  }),
  defineRoute(['rkt'], 'code', 'text', {
    contentTypes: ['text/x-racket']
  }),
  defineRoute(['lisp'], 'code', 'text', {
    contentTypes: ['text/x-lisp']
  }),
  defineRoute(['scm'], 'code', 'text', {
    contentTypes: ['text/x-scheme']
  }),
  defineRoute(['asm', 's'], 'code', 'text', {
    contentTypes: ['text/x-asm']
  }),
  defineRoute(['cu', 'cuh'], 'code', 'text', {
    contentTypes: ['text/x-cuda']
  }),
  defineRoute(['d'], 'code', 'text', {
    contentTypes: ['text/x-d']
  }),
  defineRoute(['pas'], 'code', 'text', {
    contentTypes: ['text/x-pascal']
  }),
  defineRoute(['adb', 'ads'], 'code', 'text', {
    contentTypes: ['text/x-ada']
  }),
  defineRoute(['cob', 'cbl'], 'code', 'text', {
    contentTypes: ['text/x-cobol']
  }),
  defineRoute(['f90', 'f95'], 'code', 'text', {
    contentTypes: ['text/x-fortran']
  }),
  defineRoute(['vhd', 'vhdl'], 'code', 'text', {
    contentTypes: ['text/x-vhdl']
  }),
  defineRoute(['sv', 'svh'], 'code', 'text', {
    contentTypes: ['text/x-systemverilog']
  }),
  defineRoute(['ino'], 'code', 'text', {
    contentTypes: ['text/x-arduino']
  }),
  defineRoute(['glsl', 'vert', 'frag'], 'code', 'text', {
    contentTypes: ['text/x-glsl']
  }),
  defineRoute(['wgsl'], 'code', 'text', {
    contentTypes: ['text/wgsl', 'text/x-wgsl']
  }),
  defineRoute(['hlsl'], 'code', 'text', {
    contentTypes: ['text/x-hlsl']
  }),
  defineRoute(['rmd'], 'code', 'text', {
    contentTypes: ['text/x-r-markdown']
  }),
  defineRoute(['qmd'], 'code', 'text', {
    contentTypes: ['text/x-quarto']
  }),
  defineRoute(['bib'], 'code', 'text', {
    contentTypes: ['application/x-bibtex', 'text/x-bibtex']
  }),
  defineRoute(['nix'], 'code', 'text', {
    contentTypes: ['text/x-nix']
  }),
  defineRoute(['cue'], 'code', 'text', {
    contentTypes: ['text/x-cue']
  }),
  defineRoute(['dhall'], 'code', 'text', {
    contentTypes: ['text/x-dhall']
  }),
  defineRoute(['org'], 'code', 'text', {
    contentTypes: ['text/org', 'text/x-org']
  }),
  defineRoute(['wiki', 'mediawiki'], 'code', 'text', {
    contentTypes: ['text/x-wiki', 'text/x-mediawiki']
  }),
  defineRoute(['textile'], 'code', 'text', {
    contentTypes: ['text/x-textile']
  }),
  defineRoute(['pod'], 'code', 'text', {
    contentTypes: ['text/x-pod']
  }),
  defineRoute(['man', 'roff'], 'code', 'text', {
    contentTypes: ['text/troff', 'application/x-troff', 'application/x-troff-man']
  }),
  defineRoute(['nfo'], 'code', 'text', {
    contentTypes: ['text/x-nfo']
  }),
  defineRoute(['npmrc'], 'code', 'text', {
    contentTypes: ['text/x-npmrc']
  }),
  defineRoute(['yarnrc'], 'code', 'text', {
    contentTypes: ['text/x-yarnrc']
  }),
  defineRoute(['gitattributes'], 'code', 'text', {
    contentTypes: ['text/x-gitattributes']
  }),
  defineRoute(['gitmodules'], 'code', 'text', {
    contentTypes: ['text/x-gitmodules']
  }),
  defineRoute(['md', 'markdown', 'mkd', 'mkdn', 'mdown'], 'code', 'text', {
    contentTypes: ['text/markdown', 'text/x-markdown']
  }),
  defineRoute(['txt', 'log', 'text'], 'text', 'text', {
    contentTypes: ['text/plain']
  }),
  defineRoute(['zip'], 'archive', 'archive', {
    contentTypes: ['application/zip', 'application/x-zip-compressed']
  })
];

export const CONVERSION_FORMAT_ROUTES: FormatDefinition[] = createConversionRoutes(conversionManifest);

export const DEFAULT_FORMAT_ROUTES: FormatDefinition[] = [...DIRECT_FORMAT_ROUTES, ...CONVERSION_FORMAT_ROUTES];

export function listPreviewFormats(options: ListPreviewFormatsOptions = {}): PreviewFormatSupport[] {
  const includeDirect = options.includeDirect ?? true;
  const includeConversion = options.includeConversion ?? true;
  const allowedFamilies = new Set(options.families ?? []);
  const allowedGroups = new Set(options.groups ?? []);
  const routes = options.routes ?? DEFAULT_FORMAT_ROUTES;
  const seenExtensions = new Set<string>();

  return routes
    .filter((route) => {
      const conversionRequired = Boolean(route.conversion?.required);
      if (conversionRequired && !includeConversion) return false;
      if (!conversionRequired && !includeDirect) return false;
      if (allowedFamilies.size > 0 && !allowedFamilies.has(route.family)) return false;
      return true;
    })
    .flatMap((route) => route.extensions.map((extension) => {
      const group = route.group ?? classifyPreviewFormat(extension, route.family);
      return {
        extension,
        targetFormat: route.targetFormat ?? extension,
        family: route.family,
        driverId: route.driverId,
        contentTypes: [...(route.contentTypes ?? [])],
        conversionRequired: Boolean(route.conversion?.required),
        conversionReason: route.conversion?.reason,
        group,
        groupLabel: FORMAT_GROUP_LABELS[group],
        applications: [...(route.applications ?? applicationsForFormatGroup(group))]
      };
    }))
    .filter((format) => allowedGroups.size === 0 || allowedGroups.has(format.group))
    .filter((format) => {
      if (seenExtensions.has(format.extension)) return false;
      seenExtensions.add(format.extension);
      return true;
    });
}

export function listPreviewFormatGroups(options: ListPreviewFormatsOptions = {}): PreviewFormatGroupSupport[] {
  const groups = new Map<PreviewFormatGroup, PreviewFormatGroupSupport>();
  for (const format of listPreviewFormats(options)) {
    const group = groups.get(format.group) ?? {
      id: format.group,
      label: format.groupLabel,
      applications: [],
      formats: []
    };
    group.formats.push(format);
    group.applications = uniqueSorted([...group.applications, ...format.applications]);
    groups.set(format.group, group);
  }
  return [...groups.values()];
}

export function getPreviewFormatGroupLabel(group: PreviewFormatGroup): string {
  return FORMAT_GROUP_LABELS[group];
}

export function classifyPreviewFormat(extension: string, family: PreviewFamily): PreviewFormatGroup {
  const format = normalizeExtension(extension);
  if (MODERN_OFFICE_FORMATS.has(format)) return 'office-modern';
  if (LEGACY_OFFICE_FORMATS.has(format)) return 'office-legacy';
  if (WPS_FORMATS.has(format)) return 'office-wps';
  if (OPENDOCUMENT_FORMATS.has(format)) return 'office-opendocument';
  if (LEGACY_OPENOFFICE_FORMATS.has(format)) return 'office-openoffice-legacy';
  if (IWORK_FORMATS.has(format)) return 'office-iwork';
  if (format === 'pdf') return 'pdf';
  if (CAD_DRAWING_FORMATS.has(format)) return 'cad-drawing';
  if (CAD_PARAMETRIC_FORMATS.has(format)) return 'cad-parametric';
  if (CAD_EXCHANGE_FORMATS.has(format)) return 'cad-exchange';
  if (BIM_FORMATS.has(format)) return 'bim';
  if (PANORAMA_FORMATS.has(format)) return 'panorama';
  if (ARCHIVE_FORMATS.has(format)) return 'archive';
  if (format === 'epub') return 'content';
  if (format === 'csv') return 'content';
  if (STRUCTURED_DATA_FORMATS.has(format)) return 'structured-data';
  switch (family) {
    case 'paged':
    case 'flow':
    case 'workbook': return 'document';
    case 'model3d': return 'model3d';
    case 'diagram': return 'diagram';
    case 'mindmap': return 'mindmap';
    case 'ebook': return 'content';
    case 'image': return 'image';
    case 'panorama':
    case 'panorama-video': return 'panorama';
    case 'audio':
    case 'video': return 'media';
    case 'archive': return 'archive';
    case 'html':
    case 'code':
    case 'text': return 'content';
    default: return 'other';
  }
}

function applicationsForFormatGroup(group: PreviewFormatGroup): string[] {
  switch (group) {
    case 'office-modern': return ['Microsoft Office', 'ONLYOFFICE', 'LibreOffice', 'WPS Office'];
    case 'office-legacy': return ['Microsoft Office', 'LibreOffice', 'WPS Office'];
    case 'office-wps': return ['WPS Office'];
    case 'office-opendocument': return ['LibreOffice', 'Apache OpenOffice', 'ONLYOFFICE'];
    case 'office-openoffice-legacy': return ['Apache OpenOffice', 'LibreOffice'];
    case 'office-iwork': return ['Apple iWork'];
    case 'cad-drawing': return ['AutoCAD', 'QCAD', 'LibreCAD', 'FreeCAD'];
    case 'cad-parametric': return ['FreeCAD'];
    case 'cad-exchange': return ['FreeCAD', 'OpenCascade'];
    case 'bim': return ['FreeCAD'];
    default: return [];
  }
}

export function listPreviewExtensions(options: ListPreviewFormatsOptions = {}): string[] {
  return uniqueSorted(listPreviewFormats(options).map((format) => format.extension));
}

export function createPreviewAcceptAttribute(options: ListPreviewFormatsOptions = {}): string {
  const formats = listPreviewFormats(options);
  const extensions = formats.map((format) => `.${format.extension}`);
  const contentTypes = formats.flatMap((format) => format.contentTypes);
  return uniqueSorted([...extensions, ...contentTypes]).join(',');
}

export function resolveFormatRoute(
  descriptor: Pick<SourceDescriptor, 'extension' | 'name' | 'contentType'>,
  options: ResolveFormatRouteOptions = {}
): FormatRoute | null {
  const extension = normalizeExtension(descriptor.extension ?? inferExtensionFromName(descriptor.name));
  const contentType = normalizeContentType(descriptor.contentType);
  const routes = options.routes ?? DEFAULT_FORMAT_ROUTES;

  const matchedRoute = extension
    ? routes.find((route) => route.extensions.includes(extension))
    : routes.find((route) => contentType && route.contentTypes?.includes(contentType));

  if (!matchedRoute) {
    return null;
  }

  const sourceFormat = extension || matchedRoute.extensions[0];
  return {
    sourceFormat,
    targetFormat: matchedRoute.targetFormat ?? sourceFormat,
    family: matchedRoute.family,
    driverId: matchedRoute.driverId,
    conversion: matchedRoute.conversion
  };
}

export function inferExtensionFromName(name: string | undefined): string | undefined {
  if (!name) {
    return undefined;
  }

  const trimmedName = name.split(/[?#]/, 1)[0]?.trim() ?? '';
  const lastSegment = trimmedName.split(/[\\/]/).pop() ?? '';
  const specialFormat = inferSpecialFileFormat(lastSegment);
  if (specialFormat) {
    return specialFormat;
  }
  const dotIndex = lastSegment.lastIndexOf('.');
  if (dotIndex < 0 || dotIndex === lastSegment.length - 1) {
    return undefined;
  }
  if (dotIndex === 0 && lastSegment.indexOf('.', 1) < 0) {
    return normalizeExtension(lastSegment.slice(1));
  }

  return normalizeExtension(lastSegment.slice(dotIndex + 1));
}

function inferSpecialFileFormat(name: string): string | undefined {
  const normalized = name.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === 'dockerfile' || normalized.startsWith('dockerfile.')) {
    return 'dockerfile';
  }
  if (normalized === 'makefile' || normalized === 'gnumakefile' || normalized === 'bsdmakefile') {
    return 'make';
  }
  if (normalized === 'cmakelists.txt') {
    return 'cmake';
  }
  return undefined;
}

export function normalizeExtension(extension: string | undefined): string {
  return String(extension ?? '')
    .trim()
    .replace(/^\./, '')
    .toLowerCase();
}

function defineRoute(
  extensions: string[],
  family: PreviewFamily,
  driverId: string,
  options: {
    targetFormat?: string;
    contentTypes?: string[];
    conversion?: FormatRoute['conversion'];
  } = {}
): FormatDefinition {
  return {
    extensions: extensions.map(normalizeExtension).filter(Boolean),
    family,
    driverId,
    targetFormat: options.targetFormat ? normalizeExtension(options.targetFormat) : undefined,
    contentTypes: options.contentTypes?.map(normalizeContentType).filter(Boolean),
    conversion: options.conversion
  };
}

function normalizeContentType(contentType: string | undefined): string {
  return String(contentType ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function createConversionRoutes(
  manifest: Array<{ sourceFormat: string; targetFormat: string }>
): FormatDefinition[] {
  const routedSources = new Set<string>();
  return manifest.flatMap((pair) => {
    const sourceFormat = normalizeExtension(pair.sourceFormat);
    const targetFormat = normalizeExtension(pair.targetFormat);
    // Same-format operations are available for decryption; plain documents use
    // the native reader and only encrypted envelopes invoke the converter.
    if (!sourceFormat || !targetFormat || sourceFormat === targetFormat || routedSources.has(sourceFormat)) return [];
    routedSources.add(sourceFormat);
    if (targetFormat === 'jpg' || targetFormat === 'jpeg' || targetFormat === 'png') {
      return defineRoute([sourceFormat], 'image', 'image', {
        targetFormat,
        contentTypes: legacyContentTypesForSource(sourceFormat),
        conversion: {
          required: true,
          reason: sourceFormat === 'ppm'
            ? 'PPM images are decoded to PNG in the WASM conversion core'
            : targetFormat === 'png'
            ? 'ICNS files use their embedded PNG icon preview'
            : 'camera RAW files use their embedded JPEG preview'
        }
      });
    }
    return defineRoute([sourceFormat], openXMLPreviewFamily(targetFormat), openXMLDriverId(targetFormat), {
      targetFormat,
      contentTypes: legacyContentTypesForSource(sourceFormat),
      conversion: { required: true, reason: openXMLConversionReason(targetFormat) }
    });
  });
}

function openXMLPreviewFamily(targetFormat: string): PreviewFamily {
  switch (targetFormat) {
    case 'docx':
      return 'flow';
    case 'xlsx':
      return 'workbook';
    default:
      return 'paged';
  }
}

function openXMLDriverId(targetFormat: string): string {
  return targetFormat;
}

function openXMLConversionReason(targetFormat: string): string {
  switch (targetFormat) {
    case 'docx':
      return 'legacy or compatible text documents are normalized to DOCX';
    case 'xlsx':
      return 'legacy or compatible spreadsheets are normalized to XLSX';
    default:
      return 'legacy or compatible presentations are normalized to PPTX';
  }
}

function legacyContentTypesForSource(sourceFormat: string): string[] {
  switch (sourceFormat) {
    case 'ppm':
      return ['image/x-portable-pixmap'];
    case 'icns':
      return ['image/icns', 'image/x-icns', 'application/x-icns'];
    case 'ppt':
    case 'pps':
    case 'pot':
      return ['application/vnd.ms-powerpoint'];
    case 'dps':
      return ['application/vnd.ms-powerpoint', 'application/wps-office.dps'];
    case 'dpt':
      return ['application/wps-office.dpt'];
    case 'ppsx':
      return ['application/vnd.openxmlformats-officedocument.presentationml.slideshow'];
    case 'pptm':
      return ['application/vnd.ms-powerpoint.presentation.macroenabled.12'];
    case 'ppsm':
      return ['application/vnd.ms-powerpoint.slideshow.macroenabled.12'];
    case 'potx':
      return ['application/vnd.openxmlformats-officedocument.presentationml.template'];
    case 'potm':
      return ['application/vnd.ms-powerpoint.template.macroenabled.12'];
    case 'odp':
      return ['application/vnd.oasis.opendocument.presentation'];
    case 'otp':
      return ['application/vnd.oasis.opendocument.presentation-template'];
    case 'fodp':
      return ['application/vnd.oasis.opendocument.presentation-flat-xml'];
    case 'sxi':
      return ['application/vnd.sun.xml.impress'];
    case 'sti':
      return ['application/vnd.sun.xml.impress.template'];
    case 'odg':
      return ['application/vnd.oasis.opendocument.graphics'];
    case 'otg':
      return ['application/vnd.oasis.opendocument.graphics-template'];
    case 'fodg':
      return ['application/vnd.oasis.opendocument.graphics-flat-xml'];
    case 'sxd':
      return ['application/vnd.sun.xml.draw'];
    case 'std':
      return ['application/vnd.sun.xml.draw.template'];
    case 'doc':
    case 'dot':
      return ['application/msword'];
    case 'docm':
      return ['application/vnd.ms-word.document.macroenabled.12'];
    case 'dotm':
      return ['application/vnd.ms-word.template.macroenabled.12'];
    case 'dotx':
      return ['application/vnd.openxmlformats-officedocument.wordprocessingml.template'];
    case 'wps':
      return ['application/vnd.ms-works', 'application/wps-office.wps'];
    case 'wpt':
      return ['application/wps-office.wpt'];
    case 'rtf':
      return ['application/rtf', 'text/rtf'];
    case 'odt':
      return ['application/vnd.oasis.opendocument.text'];
    case 'ott':
      return ['application/vnd.oasis.opendocument.text-template'];
    case 'fodt':
      return ['application/vnd.oasis.opendocument.text-flat-xml'];
    case 'sxw':
      return ['application/vnd.sun.xml.writer'];
    case 'stw':
      return ['application/vnd.sun.xml.writer.template'];
    case 'txt':
    case 'text':
    case 'log':
      return ['text/plain'];
    case 'md':
    case 'markdown':
    case 'mkd':
    case 'mkdn':
    case 'mdown':
      return ['text/markdown', 'text/x-markdown'];
    case 'html':
    case 'htm':
    case 'shtml':
      return ['text/html'];
    case 'xhtml':
    case 'xht':
    case 'xhtm':
      return ['application/xhtml+xml', 'text/html'];
    case 'epub':
      return ['application/epub+zip'];
    case 'fb2':
      return ['application/x-fictionbook+xml'];
    case 'xml':
      return ['application/xml', 'text/xml'];
    case 'rss':
      return ['application/rss+xml', 'application/xml', 'text/xml'];
    case 'atom':
      return ['application/atom+xml', 'application/xml', 'text/xml'];
    case 'kml':
      return ['application/vnd.google-earth.kml+xml', 'application/kml+xml', 'application/xml', 'text/xml'];
    case 'gpx':
      return ['application/gpx+xml', 'application/xml', 'text/xml'];
    case 'ttml':
    case 'dfxp':
      return ['application/ttml+xml', 'application/xml', 'text/xml'];
    case 'xsd':
      return ['application/xsd+xml', 'application/xml', 'text/xml'];
    case 'xsl':
    case 'xslt':
      return ['application/xslt+xml', 'text/xsl', 'application/xml', 'text/xml'];
    case 'wsdl':
      return ['application/wsdl+xml', 'application/xml', 'text/xml'];
    case 'plist':
      return ['application/x-plist', 'application/xml', 'text/xml'];
    case 'pom':
      return ['application/xml', 'text/xml'];
    case 'yaml':
    case 'yml':
      return ['application/yaml', 'application/x-yaml', 'text/yaml', 'text/x-yaml'];
    case 'toml':
      return ['application/toml', 'text/toml', 'text/x-toml'];
    case 'ini':
      return ['text/x-ini'];
    case 'rst':
    case 'rest':
      return ['text/x-rst', 'text/prs.fallenstein.rst'];
    case 'adoc':
    case 'asciidoc':
    case 'asc':
      return ['text/asciidoc', 'text/x-asciidoc'];
    case 'tex':
    case 'latex':
    case 'ltx':
    case 'sty':
    case 'cls':
      return ['application/x-tex', 'text/x-tex'];
    case 'properties':
      return ['text/x-java-properties'];
    case 'env':
      return ['application/x-env', 'text/x-env'];
    case 'conf':
    case 'config':
    case 'cfg':
    case 'cnf':
      return ['text/x-config'];
    case 'sql':
      return ['application/sql', 'application/x-sql', 'text/x-sql'];
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return ['text/javascript', 'application/javascript'];
    case 'ts':
    case 'tsx':
    case 'mts':
    case 'cts':
      return ['text/typescript', 'application/typescript'];
    case 'vue':
      return ['text/x-vue'];
    case 'css':
      return ['text/css'];
    case 'scss':
    case 'sass':
      return ['text/x-scss', 'text/x-sass'];
    case 'less':
      return ['text/x-less'];
    case 'c':
    case 'h':
      return ['text/x-csrc'];
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'hpp':
    case 'hh':
    case 'hxx':
      return ['text/x-c++src'];
    case 'cs':
      return ['text/x-csharp'];
    case 'go':
      return ['text/x-go'];
    case 'java':
      return ['text/x-java-source'];
    case 'kt':
    case 'kts':
      return ['text/x-kotlin'];
    case 'lua':
      return ['text/x-lua'];
    case 'php':
      return ['application/x-httpd-php', 'text/x-php'];
    case 'py':
      return ['text/x-python'];
    case 'rb':
      return ['text/x-ruby'];
    case 'rs':
      return ['text/rust', 'text/x-rustsrc'];
    case 'sh':
    case 'bash':
      return ['application/x-sh', 'text/x-shellscript'];
    case 'bat':
    case 'cmd':
      return ['application/x-msdos-program', 'text/x-msdos-batch'];
    case 'ps1':
      return ['text/x-powershell'];
    case 'swift':
      return ['text/x-swift'];
    case 'jsonc':
      return ['application/jsonc', 'text/jsonc'];
    case 'json5':
      return ['application/json5', 'text/json5'];
    case 'ipynb':
      return ['application/x-ipynb+json'];
    case 'gql':
    case 'graphql':
      return ['application/graphql', 'text/graphql'];
    case 'proto':
      return ['application/x-protobuf', 'text/x-protobuf', 'text/proto'];
    case 'diff':
      return ['text/x-diff'];
    case 'patch':
      return ['text/x-patch'];
    case 'gitignore':
      return ['text/x-gitignore'];
    case 'dockerignore':
      return ['text/x-dockerignore'];
    case 'editorconfig':
      return ['text/x-editorconfig'];
    case 'r':
      return ['text/x-r', 'text/r'];
    case 'dart':
      return ['text/x-dart'];
    case 'scala':
      return ['text/x-scala'];
    case 'groovy':
    case 'gradle':
      return ['text/x-groovy'];
    case 'pl':
      return ['text/x-perl'];
    case 'ex':
      return ['text/x-elixir'];
    case 'erl':
      return ['text/x-erlang'];
    case 'fs':
    case 'fsi':
    case 'fsx':
      return ['text/x-fsharp'];
    case 'vb':
      return ['text/x-vb'];
    case 'clj':
      return ['text/x-clojure'];
    case 'hs':
      return ['text/x-haskell'];
    case 'jl':
      return ['text/x-julia'];
    case 'zig':
      return ['text/x-zig'];
    case 'm':
    case 'matlab':
      return ['text/x-matlab'];
    case 'svelte':
      return ['text/x-svelte'];
    case 'astro':
      return ['text/x-astro'];
    case 'mdx':
      return ['text/mdx', 'text/x-mdx'];
    case 'tf':
    case 'tfvars':
    case 'hcl':
      return ['text/x-hcl'];
    case 'rego':
      return ['text/x-rego'];
    case 'bicep':
      return ['text/x-bicep'];
    case 'prisma':
      return ['text/x-prisma'];
    case 'dockerfile':
      return ['text/x-dockerfile'];
    case 'cmake':
      return ['text/x-cmake'];
    case 'make':
    case 'mk':
      return ['text/x-makefile'];
    case 'zsh':
    case 'fish':
      return ['text/x-shellscript'];
    case 'csproj':
    case 'vbproj':
    case 'fsproj':
    case 'props':
    case 'targets':
      return ['application/x-msbuild'];
    case 'sln':
      return ['text/x-ms-sln'];
    case 'cshtml':
    case 'razor':
      return ['text/x-cshtml'];
    case 'mustache':
    case 'hbs':
      return ['text/x-handlebars-template'];
    case 'liquid':
      return ['text/x-liquid'];
    case 'jinja':
      return ['text/x-jinja'];
    case 'twig':
      return ['text/x-twig'];
    case 'ejs':
      return ['text/x-ejs'];
    case 'erb':
      return ['text/x-erb'];
    case 'haml':
      return ['text/x-haml'];
    case 'slim':
      return ['text/x-slim'];
    case 'mermaid':
    case 'mmd':
      return ['text/vnd.mermaid'];
    case 'puml':
      return ['text/x-plantuml'];
    case 'avsc':
      return ['application/vnd.apache.avro+json'];
    case 'sol':
      return ['text/x-solidity'];
    case 'move':
      return ['text/x-move'];
    case 'nim':
      return ['text/x-nim'];
    case 'cr':
      return ['text/x-crystal'];
    case 'ml':
    case 'mli':
      return ['text/x-ocaml'];
    case 'elm':
      return ['text/x-elm'];
    case 'rkt':
      return ['text/x-racket'];
    case 'lisp':
      return ['text/x-lisp'];
    case 'scm':
      return ['text/x-scheme'];
    case 'asm':
    case 's':
      return ['text/x-asm'];
    case 'cu':
    case 'cuh':
      return ['text/x-cuda'];
    case 'd':
      return ['text/x-d'];
    case 'pas':
      return ['text/x-pascal'];
    case 'adb':
    case 'ads':
      return ['text/x-ada'];
    case 'cob':
    case 'cbl':
      return ['text/x-cobol'];
    case 'f90':
    case 'f95':
      return ['text/x-fortran'];
    case 'vhd':
    case 'vhdl':
      return ['text/x-vhdl'];
    case 'sv':
    case 'svh':
      return ['text/x-systemverilog'];
    case 'ino':
      return ['text/x-arduino'];
    case 'glsl':
    case 'vert':
    case 'frag':
      return ['text/x-glsl'];
    case 'wgsl':
      return ['text/wgsl', 'text/x-wgsl'];
    case 'hlsl':
      return ['text/x-hlsl'];
    case 'rmd':
      return ['text/x-r-markdown'];
    case 'qmd':
      return ['text/x-quarto'];
    case 'bib':
      return ['application/x-bibtex', 'text/x-bibtex'];
    case 'nix':
      return ['text/x-nix'];
    case 'cue':
      return ['text/x-cue'];
    case 'dhall':
      return ['text/x-dhall'];
    case 'org':
      return ['text/org', 'text/x-org'];
    case 'wiki':
    case 'mediawiki':
      return ['text/x-wiki', 'text/x-mediawiki'];
    case 'textile':
      return ['text/x-textile'];
    case 'pod':
      return ['text/x-pod'];
    case 'man':
    case 'roff':
      return ['text/troff', 'application/x-troff', 'application/x-troff-man'];
    case 'nfo':
      return ['text/x-nfo'];
    case 'srt':
      return ['application/x-subrip', 'text/srt'];
    case 'vtt':
      return ['text/vtt'];
    case 'sbv':
      return ['text/x-sbv'];
    case 'ass':
      return ['text/x-ass', 'application/x-ass'];
    case 'ssa':
      return ['text/x-ssa', 'application/x-ssa'];
    case 'ics':
      return ['text/calendar'];
    case 'vcf':
      return ['text/vcard', 'text/x-vcard'];
    case 'eml':
      return ['message/rfc822'];
    case 'mbox':
      return ['application/mbox', 'application/x-mbox'];
    case 'msg':
      return ['application/vnd.ms-outlook', 'application/x-msg'];
    case 'oft':
      return ['application/vnd.ms-outlook', 'application/x-ms-outlook'];
    case 'mht':
    case 'mhtml':
      return ['message/rfc822', 'multipart/related', 'application/x-mimearchive'];
    case 'npmrc':
      return ['text/x-npmrc'];
    case 'yarnrc':
      return ['text/x-yarnrc'];
    case 'gitattributes':
      return ['text/x-gitattributes'];
    case 'gitmodules':
      return ['text/x-gitmodules'];
    case 'xls':
    case 'xlt':
      return ['application/vnd.ms-excel'];
    case 'xlsm':
      return ['application/vnd.ms-excel.sheet.macroenabled.12'];
    case 'xltm':
      return ['application/vnd.ms-excel.template.macroenabled.12'];
    case 'et':
      return ['application/vnd.ms-excel', 'application/wps-office.et'];
    case 'ett':
      return ['application/wps-office.ett'];
    case 'xltx':
      return ['application/vnd.openxmlformats-officedocument.spreadsheetml.template'];
    case 'ods':
      return ['application/vnd.oasis.opendocument.spreadsheet'];
    case 'ots':
      return ['application/vnd.oasis.opendocument.spreadsheet-template'];
    case 'fods':
      return ['application/vnd.oasis.opendocument.spreadsheet-flat-xml'];
    case 'sxc':
      return ['application/vnd.sun.xml.calc'];
    case 'stc':
      return ['application/vnd.sun.xml.calc.template'];
    case 'dbf':
      return ['application/x-dbf', 'application/dbf', 'application/vnd.dbf'];
    case 'slk':
      return ['text/spreadsheet', 'text/x-sylk', 'application/x-sylk'];
    case 'dif':
      return ['application/x-dif', 'text/x-dif'];
    case 'csv':
      return ['text/csv', 'application/csv'];
    case 'tsv':
    case 'tab':
      return ['text/tab-separated-values'];
    case 'psv':
      return ['text/x-pipe-separated-values', 'text/pipe-separated-values'];
    case 'json':
      return ['application/json'];
    case 'jsonl':
    case 'ndjson':
    case 'jsonlines':
    case 'ldjson':
      return ['application/x-ndjson', 'application/jsonl', 'application/jsonlines'];
    default:
      return [];
  }
}
