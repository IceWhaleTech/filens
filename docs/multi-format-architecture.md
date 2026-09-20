# Multi-format File Preview Architecture

This document is the working plan for evolving this repository from a PPTX-first previewer into a broader front-end file preview workspace.

The important decision is to make preview types peers behind a driver boundary. `pptx`, native iWork, `pdf`, `docx`, `xlsx`/`csv`, PNG images, video, audio, panoramic media, ebooks, code, plain text, archives, CAD drawings, 3D/model files, mind maps, and diagrams should share source loading, routing, lifecycle, events, and a Vue host, but they should not share one fake universal document model.

## Reference Findings

The nearby reference projects point to the same split from different directions.

### `IceWhale-Files-UI-Gen2`

- Uses file-extension routing in `filePanelMap`.
- Wraps existing viewers directly:
  - `@vue-office/pdf`
  - `@vue-office/docx`
  - `@vue-office/excel`
- Keeps a shared `BaseViewer` shell around specialized viewers.
- Routes PowerPoint-like files to the PDF viewer, which implies a backend conversion assumption in that product. In this repository, the default conversion assumption is narrower: only manifest-approved document, text/source, and table-like inputs normalize to `pptx`, `docx`, or `xlsx`.

What to reuse here:

- the shared host pattern
- lazy loading by viewer type
- file-type to viewer routing
- the idea that `docx`, `pdf`, `xlsx`, and browser-friendly `csv` can use proven existing renderers first

### `addon-previewer`

- Front-end directly uses:
  - `vue-pdf-embed` for PDF
  - `docx-preview` for DOCX
  - `luckyexcel` / `luckysheet` for XLSX
  - iframe HTML for converted iWork output
- Backend converts hard formats before preview in that stack:
  - default route here: `doc`/`dot`/`wps`/`wpt`/`rtf`/`odt`/`ott`/`fodt` -> `docx`
  - default route here: `xls`/`xlt`/`et`/`ett`/`ods`/`ots`/`fods` -> `xlsx`
  - default route here: `ppt`/`pps`/`pot`/`dps`/`dpt`/`odp`/`otp`/`fodp` -> `pptx`
- lightweight text/markup/config/template/source-code inputs -> `docx`, CSV/TSV/TAB/PSV/JSON/JSON Lines and DBF/SYLK/DIF table-like inputs -> `xlsx`, WPS document/spreadsheet/presentation templates -> their matching OpenXML preview targets, Flat ODF document/spreadsheet/presentation XML -> the matching OpenXML preview target, non-macro OpenXML template/show packages -> their preview OpenXML targets, and macro-stripped `docm`/`xlsm` -> `docx`/`xlsx` are adopted only through the shared WASM manifest; other macro-enabled OpenXML, OpenXML add-ins, legacy OpenOffice XML, ODF drawings, and other broad conversion paths are intentionally not adopted as default routes
  - iWork documents -> HTML in that product, not as a default route here
  - media transcoding -> browser-friendly media in that product, not as a default route here
- Only the shared manifest-backed OpenXML normalization pairs are adopted as default routes here. `docm`/`xlsm` are allowed only through macro-stripping normalization; other macro-enabled OpenXML packages, OpenXML add-ins, ODF drawings, legacy OpenOffice XML, iWork, media, CAD, 3D/model, mind-map, diagram, archive, ebook, non-OpenXML macro-capable formats, and image conversions must stay out of the default table unless a host explicitly adds custom routes. Flat ODF document/spreadsheet/presentation XML is included only for OpenXML preview normalization.
- Thumbnail generation is also converter-backed in that stack, which is useful as a separate sibling pipeline but outside the narrow default route table described for this repository.

What to reuse here:

- conversion as a separate client/host adapter boundary around the shared WASM conversion core
- normalized OpenXML preview targets for legacy/compatible documents
- thumbnail strategy as a sibling pipeline, not part of the core DOM renderer
- password/encoding/font caveats as first-class diagnostics

### `iwork-converter`

- Provides Go packages and CLI entry points for `pages`, `numbers`, and `key`.
- Converts iWork documents to `html` or `txt`; docs also mention JSON.
- `iwork2text` supports OCR injection, which is useful for search/indexing but should not be required for visual preview.

What to reuse here:

- vendor `.proto`, type-map JSON, and fixtures as compatibility references
- treat the converter as a specification source, not a runtime dependency
- text extraction can be a later metadata/search capability

### `cad2x-converter`

- Converts CAD drawings such as DXF/DWG to browser-oriented targets including SVG, PDF, and PNG.
- Fits the same adapter boundary as `addon-previewer`: the front end sends the source to a converter service, then previews the normalized target with an existing driver.
- For interactive browser preview, prefer SVG as the default 2D CAD target because it keeps vector detail and works with a dedicated image-style viewer's zoom, pan, and fullscreen controls.
- Keep PDF or PNG as custom-route alternatives for print-oriented layouts, thumbnails, or backends that cannot produce SVG.

What to reuse here:

- CAD-specific converter service shape
- SVG-first normalized preview target for 2D drawings
- PDF/PNG fallback targets as route overrides rather than separate front-end logic
- Native DXF parsing as the first browser-side CAD implementation, mirroring the converter pipeline's final SVG-like drawing output without requiring a backend for simple open CAD files

## Design Goals

- Keep PPTX fidelity work intact.
- Keep the native iWork parser separate from the PPTX document model.
- Add `pdf`, `docx`, `xlsx`, and `csv` quickly by wrapping existing browser renderers or lightweight package-local parsers.
- Reserve first-class families for PNG images, videos, explicitly routed panoramic media, audio/music, movie playback, ebooks, code, plain text, archives, CAD, 3D/model previews, mind maps, and diagrams.
- Keep converters optional and replaceable.
- Let the Vue layer host different preview families without assuming slides, pages, sheets, or text flow.
- Preserve current `@filens/core` and `@filens/vue` exports during migration.
- Keep the first implementation browser-friendly and ESM-first.

## Non-goals

- Do not build one universal scene graph for Word, PDF, Excel, and PowerPoint.
- Do not make modern `docx`, `pdf`, `xlsx`, or browser-readable `csv` depend on a converter service.
- Do not move CAD/3D conversion, audio/video transcoding, thumbnails, or backend-specific conversion logic into the front-end rendering core. Legacy/compatible document conversion lives in the shared WASM conversion core and is invoked by browser clients or thin backend hosts.
- Do not force native iWork back through converted HTML now that a browser-native path exists.
- Do not force media, image, code, ebook, CAD, 3D, mind-map, or diagram previews through document-oriented page abstractions.

## Font Strategy

Font fidelity should be treated as shared preview infrastructure, not as a detail hidden inside one renderer.

- Preserve source font metadata whenever the format exposes it: theme fonts and run fonts for Office/iWork, CSS fonts for HTML/ebooks, embedded-font hints for PDF/DOCX, and text styles for CAD/DXF.
- Render with the best available browser font stack first, but surface a warning when an exact font is missing, substituted, or browser-unrenderable.
- Allow applications to provide a font resolver later. The resolver can map source names such as `Calibri`, `Aptos`, `SimSun`, `romans.shx`, or project-specific CAD fonts to CSS `font-family` names or downloadable webfont URLs.
- Keep font files out of the core bundle. Font distribution has licensing, privacy, and CORS implications, so embedded or user-provided font loading should be explicit.
- For CAD, SHX fonts need special handling. Browsers cannot render `.shx` directly as CSS fonts, so direct DXF preview should warn and fall back unless a later SHX-to-path renderer or app-provided conversion layer is installed.
- For documents, layout code should assume text metrics can drift when fonts are substituted. Exact autofit, wrapping, and pagination should remain best-effort unless the actual fonts are available.

## Resource Strategy

Related files should be resolved through shared preview infrastructure rather than hardcoded into individual drivers.

- Allow applications to provide a `resourceResolver` that maps format-local references to `data:`, `blob:`, URL, or byte sources.
- Use the resolver for browser-side direct preview before falling back to conversion. Initial consumers are DXF `IMAGE`/`IMAGEDEF`, where local raster paths can be mapped to app-provided URLs without converting the drawing; glTF sidecar buffers/textures, where uploaded virtual file sets can be rewritten to browser-loadable resources before `GLTFLoader` runs; and EPUB chapter assets, where missing package resources can be supplied by the host.
- Provide a core helper for user-selected file sets. `createFileSetResourceResolver()` maps same-upload files by full path, directory upload path, or unique basename so apps can preview compound files without writing custom resolver code.
- Treat archive packages as an optional virtual file-system layer. `@filens/archive` can build a ZIP-backed resolver so an uploaded `.zip` can supply glTF `.bin`/texture sidecars, CAD raster references, EPUB assets, or other sibling files without backend conversion.
- Keep ZIP bundle promotion in the app layer. The archive driver still owns normal ZIP listing, while hosts can inspect ZIP entries, choose a primary browser-native file, and pass the ZIP-backed resolver to that primary file's driver.
- Keep unresolved resources visible through placeholders and warnings, not silent omissions.

Current hook shape:

```ts
const fontResolver = ({ family, sourceFormat, fontFile, fontFamily, styleName }) => {
  if (family === 'cad' && fontFile?.toLowerCase() === 'romans.shx') {
    return 'Romans CAD';
  }
  if (fontFamily === 'Calibri') {
    return { fontFamily: 'Aptos', warnings: ['Calibri mapped to Aptos fallback.'] };
  }
};
```

The returned font name must already be available to the browser through system fonts or application-managed `@font-face` rules.
- Do not rename public packages until the generic surface is proven.

## Layered Model

The system should be split into five layers.

### 1. Source Layer

Normalizes the input.

```ts
export type PreviewSource = string | ArrayBuffer | Uint8Array | Blob | File;

export interface SourceDescriptor {
  source: PreviewSource;
  name?: string;
  extension?: string;
  contentType?: string;
  size?: number;
}
```

Responsibilities:

- load URL/blob/file/bytes
- infer extension and content type
- expose abort signal support
- keep authentication and app-specific URL building outside core

### 2. Routing Layer

Chooses a driver or conversion path.

```ts
export type PreviewFamily =
  | 'paged'
  | 'flow'
  | 'workbook'
  | 'html'
  | 'image'
  | 'panorama'
  | 'video'
  | 'panorama-video'
  | 'audio'
  | 'ebook'
  | 'code'
  | 'text'
  | 'archive'
  | 'cad'
  | 'model3d'
  | 'mindmap'
  | 'diagram'
  | 'unsupported';

export interface FormatRoute {
  sourceFormat: string;
  targetFormat: string;
  family: PreviewFamily;
  driverId: string;
  conversion?: ConversionRequest;
}
```

Routing should be a data table, not a long switch in the host component.

The same table should drive user-facing discovery APIs:

```ts
listPreviewFormats({ includeConversion: true });
listPreviewExtensions({ families: ['image', 'video'] });
createPreviewAcceptAttribute();
```

This keeps upload controls, file-manager filters, converter service configuration, and docs aligned with the runtime router.

Initial direct document routes:

| Source | Target | Family | Driver |
| --- | --- | --- | --- |
| `pptx` | `pptx` | `paged` | in-house PPTX driver |
| `key` | `key` | `paged` | native iWork keynote driver |
| `pages` | `pages` | `flow` or `paged` | native iWork pages driver |
| `numbers` | `numbers` | `workbook` | native iWork numbers driver |
| `pdf` | `pdf` | `paged` | PDF wrapper |
| `docx` | `docx` | `flow` | DOCX wrapper |
| `xlsx` | `xlsx` | `workbook` | XLSX wrapper |
| `csv` | `csv` | `workbook` | CSV table through XLSX package |

Reserved direct file routes:

| Source | Target | Family | Driver |
| --- | --- | --- | --- |
| `png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`, `bmp` | source image | `image` | browser-native image viewer |
| explicit `pano`/`panorama`/`360` routes | source image | `panorama` | panorama image viewer |
| `mp4`, `webm`, `mov`, `m4v`, `ogv`, `mkv`, `avi`, `mpeg`, `mpg`, `3gp` | source video | `video` | browser-native video player; codec support varies by browser |
| `360 mp4/webm` | source or browser-friendly video | `panorama-video` | panorama video player |
| `mp3`, `wav`, `aac`, `m4a`, `flac`, `ogg` | source or browser-friendly audio | `audio` | audio player |
| `epub` | `epub` | `ebook` | ebook reader |
| `txt`, `log`, `md`, `json`, `jsonc`, `json5`, `ipynb`, `xml`, `yaml`, `toml`, `ini`, `rst`, `adoc`, `asciidoc`, `tex`, `properties`, `env`, `conf`, `config`, `editorconfig`, `gitignore`, `dockerignore`, `gql`, `graphql`, `proto`, `diff`, `patch`, `sql`, `psv` | source text | `text` or `code` | text/code viewer |
| `js`, `jsx`, `mjs`, `cjs`, `ts`, `tsx`, `mts`, `cts`, `vue`, `css`, `scss`, `sass`, `less`, `c`, `cpp`, `h`, `hpp`, `cs`, `go`, `java`, `kt`, `kts`, `lua`, `php`, `py`, `rb`, `rs`, `sh`, `bat`, `cmd`, `ps1`, `swift`, `r`, `dart`, `scala`, `groovy`, `gradle`, `pl`, `ex`, `erl`, `fs`, `vb`, `clj`, `hs`, `jl`, `zig` | source text | `code` | code viewer |
| `zip` | file list | `archive` | archive browser |
| `dxf` | source drawing | `cad` | browser-native CAD viewer |
| future native CAD formats | source drawing or optimized tiles | `cad` | CAD viewer |
| `step`, `stp`, `stl`, `obj`, `ply`, `gltf`, `glb`, `3mf`, `amf`, `dae`, `kmz`, `fbx`, `3ds`, `usdz`, `gcode`, `gco`, `nc`, `wrl`, `vrml`, `pcd`, `xyz`, `vtk`, `vox`, `ldr`, `mpd`, `md2`, `lwo`, `bvh`, `pdb`, `nrrd`, `nhdr` | source CAD solid/mesh/model/toolpath/point cloud/voxel scene/LDraw/LightWave/motion/molecule/volume model | `model3d` | front-end WASM/browser-native 3D model/toolpath/point-cloud viewer |
| future browser-native 3D/model formats | source mesh/model assets | `model3d` | 3D model viewer |
| `mm`, `opml`, `xmind` | normalized tree graph | `mindmap` | browser-native mind-map viewer |
| future native mind-map formats | normalized graph data | `mindmap` | mind-map viewer |
| `drawio`, `dio`, `vdx`, `vsdx` | mxGraph or normalized diagram data | `diagram` | browser-native diagram viewer |
| future native diagram formats | normalized diagram data | `diagram` | diagram viewer |

Initial conversion-backed routes:

| Source | Target | Family | Driver |
| --- | --- | --- | --- |
| `ppt`, `pps`, `pot`, `dps`, `dpt`, `odp`, `otp`, `fodp` | `pptx` | `paged` | PPTX driver |
| `ppsx`, `potx` | `pptx` | `paged` | PPTX driver |
| `doc`, `dot`, `wps`, `wpt`, `rtf`, `odt`, `ott`, `fodt` | `docx` | `flow` | DOCX driver |
| `dotx` | `docx` | `flow` | DOCX driver |
| lightweight text, markup, config, log, template, and source-code formats | `docx` | `flow` | DOCX driver |
| `xls`, `xlt`, `et`, `ett`, `ods`, `ots`, `fods` | `xlsx` | `workbook` | XLSX driver |
| `xltx` | `xlsx` | `workbook` | XLSX driver |
| `dbf`, `slk`, `dif`, `csv`, `tsv`, `tab`, `psv`, `json`, `jsonl`, `ndjson`, `jsonlines`, `ldjson` | `xlsx` | `workbook` | XLSX driver |

### 3. Driver Layer

A driver owns one real rendering strategy. It receives a normalized source and a host element, then exposes only the controls it actually supports. The driver can be document-oriented, media-oriented, source-code-oriented, or archive-oriented.

```ts
export interface PreviewDriver<TState extends PreviewItemState = PreviewItemState> {
  id: string;
  family: PreviewFamily;
  supports(format: string): boolean;
  createSession(host: HTMLElement, options: PreviewOptions): PreviewSession<TState>;
}

export interface PreviewSession<TState extends PreviewItemState = PreviewItemState> {
  load(source: PreviewSource, context: PreviewLoadContext): Promise<void>;
  destroy(): void;
  getState(): TState;
  on<T extends PreviewEventName>(event: T, handler: (payload: PreviewEventMap[T]) => void): () => void;
}
```

Shared state:

```ts
export interface PreviewItemState {
  loading: boolean;
  error: string | null;
  title?: string;
  family: PreviewFamily;
  warnings: string[];
  capabilities: PreviewCapabilities;
}

export interface PreviewCapabilities {
  search?: boolean;
  zoom?: boolean;
  fit?: boolean;
  paged?: boolean;
  thumbnails?: boolean;
  workbook?: boolean;
  pan?: boolean;
  rotate?: boolean;
  fullscreen?: boolean;
  playback?: boolean;
  playlist?: boolean;
  timeline?: boolean;
  volume?: boolean;
  subtitles?: boolean;
  chapters?: boolean;
  sheets?: boolean;
  outline?: boolean;
  codeHighlight?: boolean;
  lineNumbers?: boolean;
  wordWrap?: boolean;
  minimap?: boolean;
  archiveBrowse?: boolean;
  layers?: boolean;
  measure?: boolean;
  orbit?: boolean;
  explode?: boolean;
  modelTree?: boolean;
  metadata?: boolean;
  print?: boolean;
  download?: boolean;
}
```

Family-specific state:

```ts
export interface PagedDocumentState extends PreviewItemState {
  family: 'paged';
  pageIndex: number;
  pageCount: number;
  scale: number;
  fit: 'contain' | 'width' | 'none';
}

export interface FlowDocumentState extends PreviewItemState {
  family: 'flow';
  scale?: number;
  scrollTop?: number;
}

export interface WorkbookDocumentState extends PreviewItemState {
  family: 'workbook';
  activeSheetIndex: number;
  sheets: Array<{ id: string; name: string }>;
  scale?: number;
}

export interface ImagePreviewState extends PreviewItemState {
  family: 'image' | 'panorama';
  scale: number;
  rotation: number;
  naturalWidth?: number;
  naturalHeight?: number;
}

export interface MediaPreviewState extends PreviewItemState {
  family: 'video' | 'panorama-video' | 'audio';
  duration?: number;
  currentTime: number;
  paused: boolean;
  muted: boolean;
  volume: number;
}

export interface EbookPreviewState extends PreviewItemState {
  family: 'ebook';
  location?: string;
  progress?: number;
  chapterTitle?: string;
}

export interface TextPreviewState extends PreviewItemState {
  family: 'text' | 'code';
  language?: string;
  encoding?: string;
  lineCount?: number;
  wrap: boolean;
}

export interface ArchivePreviewState extends PreviewItemState {
  family: 'archive';
  route: string;
  entries: Array<{ name: string; type: 'file' | 'directory'; size?: number; modified?: number }>;
}

export interface CadPreviewState extends PreviewItemState {
  family: 'cad';
  scale: number;
  pageIndex?: number;
  pageCount?: number;
  layers?: Array<{ id: string; name: string; color?: string; visible: boolean }>;
  activeLayerIds?: string[];
}

export interface Model3dPreviewState extends PreviewItemState {
  family: 'model3d';
  scale: number;
  selectedNodeId?: string;
  layers?: Array<{ id: string; name: string; color?: string; visible: boolean }>;
  activeLayerIds?: string[];
  camera?: {
    position: [number, number, number];
    target: [number, number, number];
  };
}

export interface MindmapPreviewState extends PreviewItemState {
  family: 'mindmap';
  scale: number;
  selectedNodeId?: string;
}

export interface DiagramPreviewState extends PreviewItemState {
  family: 'diagram';
  scale: number;
  pageIndex?: number;
  pageCount?: number;
  selectedElementId?: string;
}
```

The current `ViewerState.currentSlide`, `slideCount`, and `presentation` fields should become PPTX compatibility fields, not the generic core state.

### 4. Host Layer

The host is responsible for layout, loading/error overlays, toolbar composition, keyboard shortcuts, and state synchronization.

It should render controls based on driver capabilities:

- paged: previous/next page, page counter, zoom, fit, optional thumbnails
- flow: zoom if supported, search later, no page counter unless the driver exposes one
- workbook: sheet tabs, zoom, grid viewport, active sheet state
- html: iframe or sanitized HTML mount, minimal toolbar
- image: zoom, fit, pan, rotate, fullscreen, metadata, optional thumbnails
- panorama: full-bleed 360 viewer, drag/gyro controls, zoom/FOV, fullscreen
- video/movie: playback, timeline, volume, subtitles, fullscreen, theater mode, optional chapters
- panorama-video: 360 video playback plus panorama controls
- audio/music: playback, timeline, volume, cover art, playlist/queue hooks
- ebook: chapter navigation, reading progress, themes, font size, search later
- code: syntax highlighting, line numbers, search, copy, wrap toggle, large-file fallback
- text: encoding-aware plain text view, search, copy, wrap toggle
- archive: file list, path breadcrumbs, nested preview delegation, extract/download hooks
- cad: page/sheet switch if exported as drawing sheets, layer toggles, zoom/pan, measurement, print/download hooks
- model3d: orbit/pan/zoom, part tree, layer/material visibility, exploded view, measurement, metadata panel, fullscreen
- mindmap: zoom/pan, outline/tree navigation, node selection, search, export/download hooks
- diagram: page navigation, zoom/pan, layer/object selection, search, print/download hooks

This is where `packages/vue` should move from `PptxPreview.vue` to a generic `Preview.vue`, while keeping `PptxPreview.vue` as a compatibility wrapper.

### 5. Conversion Layer

Conversion should be an adapter interface. For this repository's default path, parsing and OpenXML generation live in the shared front-end/WASI conversion core; browser clients may call that core directly, and backend hosts may only wrap it with thin HTTP/CLI/temp-file plumbing. Host applications can still provide custom converter clients, but those routes must be explicit rather than silently expanding the default table.

```ts
export interface ConversionRequest {
  sourceFormat: string;
  targetFormat: string;
  source: PreviewSource;
  name?: string;
  password?: string;
  locale?: string;
}

export interface ConversionResult {
  source: PreviewSource;
  format: string;
  contentType?: string;
  warnings?: string[];
  cacheKey?: string;
}

export interface ConverterClient {
  convert(request: ConversionRequest, context: PreviewLoadContext): Promise<ConversionResult>;
}
```

The converter adapter is optional. If no converter exists, direct formats still work and unsupported formats fail with a clear diagnostic. The default HTTP adapter preserves stable error metadata from non-2xx JSON or `X-Preview-*` header responses through `HttpConversionError`, including `unsupported_format`, `password_required`, `password_invalid`, `parse_error`, `conversion_failed`, `io_error`, and `engine_unavailable`.

## Package Plan

### Public Category Packages

- `packages/office`: PPTX, PDF, DOCX, XLSX, and iWork drivers
- `packages/design`: CAD, diagrams, mind maps, and 3D models
- `packages/media`: images, native audio/video, and panoramas
- `packages/archive`: compressed-file listing and ZIP-backed resources
- `packages/text`: text, code, HTML, and ebooks

These are thin composition packages. Format-specific parsers stay in their existing packages so applications can dynamically import one category without merging unrelated conversion or rendering code.

### Short Term

- `packages/core`
  - generic contracts
  - source loading helpers
  - format routing
  - event and lifecycle primitives
  - compatibility exports for the current PPTX API
- `packages/iwork`
  - native `.key`, `.pages`, `.numbers` parsing in a Worker
  - vendored protobuf/type-map assets
  - semantic extraction for keynote/pages/numbers
  - dedicated viewer runtime reusing shared render primitives
- `packages/pptx`
  - current PPTX parser, scene model, renderer, and paged driver
- `packages/vue`
  - generic `Preview` component
  - `PptxPreview` and `IworkPreview` compatibility wrappers
  - shared toolbar/layout
- `apps/demo`
  - one demo that shows PPTX, native iWork, and later additional drivers

### Driver Packages

- `packages/iwork`
  - native iWork viewer package for Keynote, Pages, and Numbers
  - family: `paged`, `flow`, and `workbook` depending on document kind
- `packages/pdf`
  - wrapper around `@vue-office/pdf` or a PDF.js-based DOM driver
  - family: `paged`
- `packages/docx`
  - wrapper around `@vue-office/docx` or `docx-preview`
  - family: `flow`
- `packages/xlsx`
  - wrapper around `@vue-office/excel` first; evaluate Luckysheet/Univer later if richer grid behavior is needed
  - family: `workbook`
- `packages/html`
  - iframe or sanitized HTML driver for generic HTML and converted fallbacks
  - family: `html`
- `packages/image`
  - image viewer with zoom, pan, rotate, fit, animated image handling where possible
  - family: `image`
- `packages/panorama`
  - 360 photo and 360 video viewer, likely backed by a WebGL/Three.js scene
  - family: `panorama` and `panorama-video`
- `packages/media`
  - video/audio wrapper around native media elements first, with room for HLS/DASH and subtitle plugins
  - family: `video` and `audio`
- `packages/ebook`
  - EPUB-first reader, with converted ebook fallback targets later
  - family: `ebook`
- `packages/text`
  - plain text and code viewer, encoding-aware source loading, syntax highlighting hooks
  - family: `text` and `code`
- `packages/archive`
  - archive listing, ZIP-backed resource resolver helpers, and nested preview delegation
  - family: `archive`
- `packages/cad`
  - browser-native DXF parser/viewer first; later CAD drawing viewer for converter-normalized sheets, SVG/PDF/image tiles, or native drawing extraction
  - family: `cad`
- `packages/model3d`
- Three.js-backed STEP/STP via front-end OpenCascade WASM plus STL/OBJ/PLY/glTF/GLB/3MF/AMF/DAE/KMZ/FBX/3DS/USDZ/G-code/VRML/PCD/XYZ/VTK/VOX/LDraw/MD2/LWO/BVH/PDB/NRRD/NHDR model, toolpath, point-cloud, molecule, motion skeleton, volume voxel, and voxel viewer first; later BIM/3D/printing model viewer with optional loader plugins
  - family: `model3d`
- `packages/mindmap`
  - native FreeMind MM and OPML tree viewer first; later richer mind-map bundles and normalized graph data
  - family: `mindmap`
- `packages/diagram`
  - native draw.io/diagrams.net mxGraph viewer and basic Visio VDX/VSDX XML/ZIP viewer first; later converted SVG/HTML/PDF or normalized diagram data
  - family: `diagram`
- `packages/converter-client`
  - optional adapter for remote conversion APIs
  - no hard dependency from direct preview packages

## Recommended Library Choices

Use `@vue-office/docx`, `@vue-office/pdf`, and `@vue-office/excel` first for the Vue package because `IceWhale-Files-UI-Gen2` already proves that integration shape.

Keep `docx-preview`, `vue-pdf-embed`, and `luckyexcel` as fallback or lower-level options:

- `docx-preview` is useful if we want a framework-neutral DOM driver in `packages/docx`.
- `vue-pdf-embed` is simple and supports password prompts, but a direct PDF.js wrapper may expose better generic controls later.
- `luckyexcel` / Luckysheet provides a richer spreadsheet surface, but it brings global CSS/scripts and a heavier runtime.

The first milestone should optimize for clean architecture and quick coverage, not maximum spreadsheet editing features.

For non-document families, prefer native browser capabilities first:

- image: `<img>`, canvas only when transforms or huge-image tiling require it
- video/audio: native `<video>` and `<audio>` first; add HLS/DASH only behind optional integrations
- panorama: WebGL/Three.js only for 360 photo/video, not for normal image preview
- ebook: EPUB direct reader first; other ebook formats through conversion
- code/text: use a lightweight highlighter first and leave Monaco-style editing features out of the default preview path
- CAD: start with browser-native DXF parsing and SVG rendering in `packages/cad`; preserve header extents/limits/unit metadata, layer names, basic ACI colors, true color, transparency, hidden/off/frozen/locked layer flags, entity invisible flags, `LTYPE` dash patterns with `$LTSCALE` and entity scale, lineweights, common point/line/xline/ray/leader/arc/ellipse/spline geometry, polyline bulge arcs and common widths, raster IMAGE/IMAGEDEF references and clipping boundaries where the source is browser-loadable or app-resolved, simple filled faces and solid hatches with multi-loop polyline/line/arc/ellipse/spline boundaries, classic POLYLINE/VERTEX geometry, reusable nested BLOCK/INSERT/MINSERT and DIMENSION geometry blocks where they expand into supported primitives, lightweight dimension fallback geometry, block attribute text, text style, rotation, width, oblique, alignment points, MTEXT attachment/direction, and MTEXT formatting metadata where possible; expose generic layer toggles in the Vue host; if a host later adds broader CAD conversion routes, formats such as DWG/DGN can be normalized through a cad2x-style pipeline with SVG or PDF/PNG fallbacks
- 3D/model: use Three.js for browser-friendly model viewers; `packages/model3d` now handles STEP/STP CAD solids through a lazily loaded front-end OpenCascade WASM importer, ASCII/binary STL, OBJ geometry with inline vertex colors and resource-resolved MTL libraries and texture maps, ASCII/binary-little-endian PLY with common vertex colors, embedded/data-URI glTF, URL-loaded, app-resolved, or ZIP-resolved glTF sidecar resources, single-file GLB, core 3MF mesh/build/component items with basic base-material/color-group object/triangle colors and unsupported material diagnostics, AMF objects, Collada DAE/KMZ scenes, FBX objects, 3DS objects, USDA-backed USDZ objects, G-code/GCO/NC toolpaths, VRML/WRL scenes, PCD/XYZ point clouds, VTK polydata meshes, VOX voxel scenes, LDraw `.ldr`/`.mpd` models with app-resolved sidecar parts, MD2 meshes, LWO LightWave Object meshes, BVH motion skeletons, PDB molecular structures, NRRD voxel volumes, and NHDR detached headers with app-resolved single external raw data files directly, while glTF/OBJ/DAE/FBX/3DS/USDZ/VRML/LDraw/LWO with unresolved sidecars or unsupported binary USD payloads, IGES, Revit, SKP, Gerber/Excellon, and KiCad PCB stay behind a proven front-end WASM loader path
- mind maps: `packages/mindmap` now handles FreeMind MM, OPML, and common XMind content.json/content.xml packages directly as normalized trees; if a host later chooses to add broader conversion routes, MindManager and MindNode are candidates only after their package formats can expose useful structure such as outline, notes, boundaries, and attachments
- diagrams: `packages/diagram` now handles compressed and uncompressed draw.io/dio mxGraph XML directly plus basic Visio VDX/VSDX pages, `pages.xml` page manifests, shapes, labels, and connectors; if a host later chooses to add broader conversion routes, OmniGraffle, Google Drawings exports, and advanced Visio content are candidates only after useful page/layer/object structure can be exposed

## Compatibility Strategy

Current code:

```ts
import { init, createViewer, loadPptx } from '@filens/core';
import { PptxPreview } from '@filens/vue';
```

Should keep working.

New code:

```ts
import { createPreviewer, registerDriver } from '@filens/core';
import { Preview } from '@filens/vue';
```

`PptxPreview` can become:

```vue
<Preview :src="src" format="pptx" family="paged" />
```

The old `PptxViewer` class can be wrapped by a `PptxDriver` while compatibility exports remain in place.

## Migration Plan

### Phase 1: Contracts Without Behavior Change

- Add generic types beside existing PPTX types.
- Add `PreviewDriver`, `PreviewSession`, `PreviewItemState`, and `PreviewCapabilities`.
- Implement a `PptxDriver` adapter around the current `PptxViewer`.
- Keep all tests passing with only PPTX enabled.

### Phase 2: Generic Vue Host

- Create `Preview.vue`.
- Move toolbar and shell logic from `PptxPreview.vue` into capability-driven controls.
- Keep slide thumbnails only for paged drivers that expose thumbnails.
- Rebuild `PptxPreview.vue` as a thin wrapper.

### Phase 3: PDF Driver

- Add the first non-PPTX driver.
- Use the same paged controls as PPTX where possible.
- Validate URL, Blob, File, and password-protected PDF behavior.

Status: an initial `packages/pdf` driver exists and uses browser PDF embedding. A richer PDF.js-backed driver can replace the session internals later without changing the route/driver contract.

### Phase 4: DOCX Driver

- Add flow-document mode.
- Remove assumptions that every preview has page count, slide index, or thumbnails.
- Add basic load/render/error events and warnings.

Status: an initial `packages/docx` driver exists and wraps `docx-preview` behind the generic `flow` preview state.

### Phase 5: XLSX/CSV Driver

- Add workbook mode.
- Surface sheet names and active sheet changes.
- Keep grid-specific UI separate from paged navigation.

Status: an initial `packages/xlsx` driver exists. It parses the basic XLSX package structure, workbook sheets, shared strings, and sheet cell values into a read-only table grid. It also routes UTF-8/browser-readable CSV directly into the same workbook table UI. Formula calculation, charts, merged cells, rich formatting, type inference, and large-sheet virtualization remain future work.

### Phase 6: Conversion Adapter

- Add optional `ConverterClient`.
- Keep the default route table narrow and manifest-gated: allowed presentation, document, text/source, and table-like inputs normalize only to `pptx`, `docx`, or `xlsx`.
- Demo conversion through the same front-end WASM conversion core used by backend hosts.
- Add a pure WASI conversion-core boundary for direct browser use and path-based host integration; keep production-fidelity layout conversion as a separate future capability.

Status: `packages/converter-client` now provides a direct WASM converter client for browser/front-end use, a mock converter for tests, and an HTTP multipart converter adapter for backend conversion services. The demo includes a `.ppt` to `.pptx` path that loads `converter-core.wasm` in the browser. `wasm/converter-core-rust` owns the production lightweight parsing and OpenXML generation logic, `wasm/converter-core` retains only the shared manifest and thin Go policy adapter, and `examples/go-wazero-converter` remains a path-based Go/wazero host shell. `manifest/conversions.json` is shared by WASM, Go preflight validation, and TypeScript preview routes so they do not maintain separate conversion policies. The current WASI build emits valid lightweight structured OpenXML for bundled allowed samples; production layout fidelity remains future work. DXF is handled by the browser-native CAD driver when `packages/cad` routes are registered, STL/OBJ/PLY/glTF/GLB/3MF/AMF/DAE/KMZ/FBX/3DS/USDZ/G-code/VRML/PCD/XYZ/VTK/VOX/LDraw/MD2/LWO/BVH/PDB/NRRD/NHDR are handled by the browser-native model3d driver when `packages/model3d` routes are registered, MM/OPML/XMind are handled by the browser-native mindmap driver when `packages/mindmap` routes are registered, and draw.io/dio/VDX/VSDX are handled by the browser-native diagram driver when `packages/diagram` routes are registered.

### Phase 7: File Preview Families

- Add image and media drivers.
- Add code/text drivers with large-file and encoding safeguards.
- Add panorama drivers only after normal image/video preview is stable.
- Add ebook and archive drivers as optional packages.
- Add CAD, model3d, mindmap, and diagram drivers only after the route shape is stable; DXF is the first CAD format to graduate into a native front-end driver.

Status: core now includes native image, media, text/code, and sandboxed HTML drivers plus shared font and resource resolver hooks. `packages/cad` provides an initial browser-native DXF parser and SVG renderer for common CAD entities including points, construction lines/rays, leaders, ellipses, polyline bulge arcs and common widths, spline approximation, raster IMAGE/IMAGEDEF references with clipping boundaries for browser-loadable or app-resolved sources and placeholders for unresolved local resources, simple filled faces, solid hatches with multi-loop polyline/line/arc/ellipse/spline boundaries, dimension fallback geometry, and block attribute text, classic POLYLINE/VERTEX geometry, nested BLOCK/INSERT/MINSERT expansion, DIMENSION geometry-block expansion, header extents/limits/unit metadata, layer/color/true-color/transparency/visibility metadata, `LTYPE` dash patterns with global/entity scale, lineweights, and host-driven layer toggles. `packages/model3d` provides an initial Three.js-backed STL/OBJ/PLY/glTF/GLB/3MF/AMF/DAE/KMZ/FBX/3DS/USDZ/G-code/VRML/PCD/XYZ/VTK/VOX/LDraw/MD2/LWO/BVH/PDB/NRRD/NHDR viewer for ASCII/binary STL, OBJ meshes with inline vertex colors and resource-resolved MTL libraries and texture maps, ASCII/binary-little-endian PLY meshes with common vertex colors, embedded/data-URI glTF scenes, URL-loaded, app-resolved, or ZIP-resolved glTF sidecar resources, single-file GLB scenes, core 3MF mesh/build/component items with basic base-material/color-group object/triangle colors plus unsupported 3MF material diagnostics, AMF objects, Collada DAE/KMZ scenes, FBX objects, 3DS objects, USDA-backed USDZ objects, G-code/GCO/NC toolpaths, VRML/WRL scenes, PCD/XYZ point clouds, VTK polydata meshes, VOX voxel scenes, LDraw `.ldr`/`.mpd` models with app-resolved sidecar parts, MD2 meshes, LWO LightWave Object meshes, BVH motion skeletons, PDB molecular structures, NRRD voxel volumes, and NHDR detached headers with app-resolved single external raw data files. `packages/mindmap` provides an initial browser-native FreeMind MM, OPML, and XMind SVG tree viewer. `packages/diagram` provides an initial browser-native draw.io/dio/VDX/VSDX SVG diagram viewer for compressed and uncompressed mxGraph pages, basic Visio pages and page manifests, vertices/shapes, edges/connectors, labels, and common style attributes. `packages/archive` provides an initial ZIP listing driver plus ZIP-backed resolver helpers for compound direct preview sidecars; nested preview UI, extraction, and non-ZIP archive support remain future work. `packages/ebook` provides an initial EPUB spine/chapter reader with package-local and app-resolved chapter assets plus a CBZ image-page reader; reading themes, search, bookmarks, and non-EPUB/non-CBZ ebook formats remain future work. `packages/panorama` provides an initial Three.js-backed panorama image driver for explicitly routed 360 images; metadata-based 360 detection and panorama video remain future work. The default conversion scope remains limited to manifest-backed OpenXML normalization; any broader CAD, mind-map, or diagram conversion routes must be added explicitly by the host.

### Phase 8: Thumbnails and Metadata

- Add a thumbnail interface independent of visual preview.
- Allow drivers or converters to provide thumbnails.
- Later add text extraction metadata for search/indexing.

## API Sketch

Core:

```ts
const previewer = createPreviewer(host, {
  drivers: [
    pptxDriver(),
    pdfDriver(),
    docxDriver(),
    xlsxDriver(),
    imageDriver(),
    mediaDriver(),
    textDriver()
  ],
  converter,
  fontResolver,
  fit: 'contain'
});

await previewer.preview(file, {
  name: file.name
});
```

Vue:

```vue
<Preview
  :src="file"
  :name="file.name"
  :converter="converter"
  :font-resolver="fontResolver"
  toolbar
/>
```

PPTX compatibility:

```vue
<PptxPreview :src="file" fit="contain" thumbnails />
```

## Main Risks

- Third-party viewer CSS may leak globally. Driver packages should import CSS locally and document required styles.
- PDF/DOCX/XLSX/CSV libraries expose different event models. The driver session should normalize only lifecycle and basic navigation, not every library-specific detail.
- XLSX viewers are often heavy. CSV can stay lightweight, but package-level async imports should still avoid bundling all drivers into the default PPTX path.
- Media and panorama drivers can pull in heavy optional dependencies. Keep them lazy-loaded and package-scoped.
- Huge files need defensive limits: large text files, large images, long videos, and deep archives should degrade gracefully.
- Browser codec and loader support varies. Unsupported audio/video/ebook/CAD/3D/mind-map/diagram formats need explicit host-level handling; they are no longer part of the default conversion plan.
- Real document conversion engines are operationally risky. Pure WASI production-fidelity conversion may simply be unavailable; the architecture must allow an honest `engine_unavailable` result instead of pretending the route works.
- Converted files need cache keys, abort behavior, and clear error messages.
- Password-protected files need a shared prompt/callback design.
- Font fidelity remains a common limitation across x2t, docx, native iWork, and browser renderers.

## Immediate Next Steps

1. Add generic contracts to `packages/core/src/preview`.
2. Wrap current `PptxViewer` as a `PreviewDriver`.
3. Introduce generic `Preview.vue` while preserving `PptxPreview`.
4. Add `packages/pdf` using `@vue-office/pdf` as the first external driver.
5. Add `packages/docx` and `packages/xlsx`/CSV after the host proves it no longer assumes slides.
6. Add image, media, and text/code families as reserved route definitions before implementing all of them.
7. Add a converter adapter only after direct `pdf`, `docx`, `xlsx`, and CSV are stable.
8. Keep the default converter scope limited to manifest-backed OpenXML normalization, and add any broader conversion routes only through explicit host-defined route tables.
