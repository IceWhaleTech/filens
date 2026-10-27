# Support Matrix

English | [简体中文](support-matrix.zh-CN.md)

filens provides read-only file previews in modern browsers. Format support does not imply full compatibility with its authoring application.

| Find | Go to |
| --- | --- |
| Formats, extensions, and preview paths | [Format overview](#format-overview) |
| Conversion sources, targets, and runtime requirements | [Conversion support](#conversion-support) |
| PPM encodings, bit depth, limits, and verification | [PPM conversion](#ppm-conversion) |
| Camera RAW extensions and decode limits | [Camera RAW conversion](#camera-raw-conversion) |
| Individual features and fidelity limits | [Fidelity and feature details](#fidelity-and-feature-details) |
| APIs, Vue components, fonts, and sidecar files | [Integration support](#integration-support) |
| Formats and workflows without a shipped preview path | [Unsupported formats and workflows](#unsupported-formats-and-workflows) |

Long feature tables can be expanded using their disclosure headings. These tables work in GitHub Markdown; use the page's find command to locate an extension or feature.

## How to read this matrix

<details>
<summary>Expand preview paths, feature statuses, and integration requirements</summary>

| Preview path | Meaning |
| --- | --- |
| **Direct** | A browser preview driver opens the source without the converter adapter. Some drivers load their own WASM dependencies, such as STEP import. |
| **Convert** | A converter adapter first produces a previewable file. The browser WASM client runs locally; an HTTP adapter uses the configured service. |

| Feature status | Meaning |
| --- | --- |
| **Supported** | Common content or operations are implemented within the limits described here. |
| **Partial** | A useful subset is implemented; some content, formatting, or behavior is simplified or omitted. |
| **Experimental** | Support depends on specific files, camera metadata, codecs, or fallback paths. |
| **Unavailable** | The listed feature has no shipped implementation. |

| Applies to | Requirement or boundary |
| --- | --- |
| Format overview below | Describes the routes assembled by the Vue `Preview` host. |
| Core-only integrations | Register the relevant package drivers and routes. |
| Conversion routes | Configure a converter adapter. |
| Rendering and playback | Browser decoding, available fonts, and external resources affect the result. |

</details>

## Format overview

### Office and documents

| Format | Extensions | Path | Preview coverage | Limits |
| --- | --- | --- | --- | --- |
| PowerPoint | `pptx` | Direct | Slides, text, images, tables, and common shapes. | SmartArt and styling are partial; [feature matrix](#pptx). |
| Word | `docx` | Direct | Document rendering through `docx-preview`; repeated images reuse resources, with cancellation and safe file replacement. | Layout and font fidelity vary. |
| Excel / CSV | `xlsx`, `csv` | Direct | Read-only sheets, basic formulas, incremental row loading, cancellation and safe file replacement. | Partial calculation and styling; [workbook matrix](#pdf-docx-and-workbooks). |
| PDF | `pdf` | Direct | PDF.js engine loads when opening a PDF; canvas preview, page navigation, zoom/fit and on-demand rendering. | Text search/selection layers are unavailable. |
| Apple iWork | `key`, `pages`, `numbers` | Direct | Native parsing and slide/page/sheet views. | Partial layout and content fidelity; [iWork matrix](#native-iwork). |
| Other Office, WPS, and OpenDocument | [Conversion extensions](#conversion-support) | Convert | Normalize to `pptx`, `docx`, or `xlsx`. | Fidelity depends on the source; macros are stripped. |

### Images, audio, video, and panoramas

| Format | Extensions | Path | Preview coverage | Limits |
| --- | --- | --- | --- | --- |
| Browser images | `png`, `jpg`, `jpeg`, `gif`, `webp`, `avif`, `apng`, `ico`, `svg`, `bmp` | Direct | Zoom, fit width/height, pan, rotation, fullscreen. | Browser decoding determines availability. |
| Apple icons | `icns` | Convert → `png` | Largest embedded PNG icon. | Raw icon planes and JPEG 2000 chunks are not decoded. |
| Portable pixmaps | `ppm` | Convert → `png` | P3 text and P6 binary; comments, arbitrary maxval, 8/16-bit RGB. | First image in a stream; [decode, runtime, and verification limits](#ppm-conversion). |
| Camera RAW | `dng`, `cr2`, `cr3`, `nef`, and [more](#camera-raw-conversion) | Convert → `jpg` | Embedded JPEG or lightweight sensor preview. | Full RAW development is unavailable. |
| Audio | `mp3`, `wav`, `aac`, `m4a`, `flac`, `ogg`, `oga`, `opus` | Direct | Native browser playback and controls. | Codec support varies. |
| Video | `mp4`, `webm`, `mov`, `m4v`, `ogv`, `mkv`, `avi`, `mpeg`, `mpg`, `3gp` | Direct | Native browser playback and controls. | A recognized extension does not guarantee a decodable codec. |
| Equirectangular panoramas | `pano`, `panorama`, `360`; video: `360v`, `vr360` | Direct | Three.js spherical rendering. | Videos require browser-decodable media. |
| Camera panoramas | `insp`, `insv`, `osv` | Direct; WASM processing where needed | Experimental calibrated lens rendering or a supported fallback. | Camera metadata, codecs, and companion files; [requirements](#panoramas-and-live-photo-samples). |

### CAD, 3D, mind maps, and diagrams

| Format | Extensions | Path | Preview coverage | Limits |
| --- | --- | --- | --- | --- |
| 2D CAD | `dxf` | Direct | SVG geometry, text, layers, blocks, raster references. | Partial entity and text fidelity; [DXF matrix](#dxf-cad). |
| CAD solids | `step`, `stp` | Direct + OpenCascade WASM | Lazy-loaded triangulation for viewing. | CAD editing is unavailable. |
| 3D models and scenes | `stl`, `obj`, `ply`, `gltf`, `glb`, `3mf`, and [more](#3d-models-and-inspection) | Direct | Three.js meshes, materials, and scenes. | Format-specific material and resource limits. |
| Toolpaths, point clouds, voxels, motion, molecules | `gcode`, `gco`, `nc`, `pcd`, `xyz`, `vtk`, `vox`, `bvh`, `pdb`, `nrrd`, `nhdr` | Direct | Supported data subsets. | [Import and inspection matrix](#3d-models-and-inspection). |
| Mind maps | `mm`, `opml`, `xmind`, `mmap` | Direct | FreeMind, OPML, XMind, MindManager topic trees. | Partial layout fidelity; read-only interaction. |
| Diagrams | `drawio`, `dio`, `vdx`, `vsdx` | Direct | diagrams.net and basic Visio pages, shapes, labels, connectors. | Partial Visio fidelity; editing is unavailable. |

### Text, ebooks, and archives

| Format | Extensions | Path | Preview coverage | Limits |
| --- | --- | --- | --- | --- |
| Plain text | `txt`, `text`, `log` | Direct | UTF-8 text display. | Read-only. |
| Code, markup, configuration | Examples: `js`, `ts`, `py`, `go`, `json`, `xml`, `yaml`, `toml`, `ini`, `md`, `tex` | Direct | Language metadata, line numbers, non-wrapping source text, lightweight highlighting up to 200,000 characters. | Markdown, LaTeX, Mermaid, and similar sources are displayed as source. |
| HTML / XHTML | `html`, `htm`, `shtml`, `xhtml`, `xht`, `xhtm` | Direct | Sandboxed iframe; URLs, HTML data URLs and inline fragments. | Scripts are disabled by the iframe sandbox. |
| EPUB | `epub` | Direct | Spine-based XHTML chapters, CSS imports, fonts, background images and SVG image references; local/app-resolved assets. | Advanced ebook navigation and themes are unavailable. |
| Comic books | `cbz` | Direct | ZIP-based image page sequences. | Additional native comic formats are unavailable. |
| ZIP-compatible archives | `zip`, `jar`, `war`, `ear`, `apk` | Direct | Listings, directory/nested browsing, entry preview, extraction helpers. | Read-only; no bulk extraction UI. |
| TAR / GZIP | `tar`, `tgz`, `tar.gz`, `gz` | Direct | TAR/TGZ listings with PAX / GNU long paths; single-file GZIP extraction. | Read-only. |
| Additional readable inputs | Examples: `fb2`, `eml`, `msg`, `ics`, `vcf` | Convert → `docx` | Content extraction for preview. | Exact pairs follow the conversion manifest. |

| Extension lists | Source of truth |
| --- | --- |
| Code and readable-input examples | Illustrative, not exhaustive. Use the [route introspection helpers](#routes-and-source-loading) for formats enabled in an application. |
| Allowed conversion pairs | The [shared manifest](../wasm/converter-core/manifest/conversions.json) and optional [image manifest](../wasm/converter-image/manifest/conversions.json). |

## Conversion support

Listed pairs normalize files for preview; they do not promise to preserve every source feature. Exact pairs come from the manifests linked above.

| Source family | Source extensions | Target |
| --- | --- | --- |
| PowerPoint binary / WPS presentations | `ppt`, `pps`, `pot`, `dps`, `dpt` | `pptx` |
| PowerPoint shows, templates, macro-enabled packages | `pptm`, `ppsx`, `ppsm`, `potx`, `potm` | `pptx` |
| OpenDocument / legacy OpenOffice presentations and drawings | `odp`, `otp`, `fodp`, `sxi`, `sti`, `odg`, `otg`, `fodg`, `sxd`, `std` | `pptx` |
| Word binary / WPS / RTF | `doc`, `dot`, `wps`, `wpt`, `rtf` | `docx` |
| Word templates and macro-enabled packages | `docm`, `dotx`, `dotm` | `docx` |
| OpenDocument / legacy OpenOffice text | `odt`, `ott`, `fodt`, `sxw`, `stw` | `docx` |
| Text, markup, configuration, templates, code, ebooks, messages, and other readable content | Examples: `txt`, `md`, `html`, `xml`, `yaml`, `js`, `py`, `epub`, `fb2`, `eml`, `mbox`, `msg`, `oft`, `mht`, `mhtml` | `docx` |
| Excel binary / WPS spreadsheets | `xls`, `xlt`, `et`, `ett` | `xlsx` |
| Excel templates and macro-enabled packages | `xlsm`, `xltx`, `xltm` | `xlsx` |
| OpenDocument / legacy OpenOffice spreadsheets | `ods`, `ots`, `fods`, `sxc`, `stc` | `xlsx` |
| Table-like inputs | `dbf`, `slk`, `dif`, `csv`, `tsv`, `tab`, `psv`, `json`, `jsonl`, `ndjson`, `jsonlines`, `ldjson` | `xlsx` |
| Camera RAW | [Complete RAW list](#camera-raw-conversion) | `jpg` |
| Apple icons | `icns` | `png` |
| Portable pixmaps | `ppm` | `png` |

### Default routing

| Input | Default preview | Optional conversion target |
| --- | --- | --- |
| `csv` | Direct workbook | `xlsx` |
| `json` | Direct source text | `docx` or `xlsx` |
| `html` | Direct sandboxed iframe | `docx` |
| `epub` | Direct ebook driver | `docx` |
| `ppm` / `image/x-portable-pixmap` | Convert to PNG, then use the image driver | `png` |

| Rule | Behavior |
| --- | --- |
| Default precedence | Direct routes take precedence over conversion routes. |
| Host override | Supply custom routes to select conversion instead. |

### Conversion fidelity

| Source or result | Current boundary |
| --- | --- |
| Macro-enabled OpenXML | Macro parts are removed before normalization. |
| Legacy binary, ODF, and table-like inputs | Layout, styles, media, charts, formulas, and embedded objects may be simplified or omitted. |
| CSV / TSV / TAB / PSV → XLSX | Reads complete input, including CRLF / CR / LF and quoted newlines, up to 1,000,000 cells, 16,384 columns per row and the XLSX row limit. Exceeding a limit raises an explicit error instead of producing a truncated workbook. Direct CSV preview does not use this conversion limit. |
| PPM | Dimensions and RGB samples are retained at 8/16-bit depth; nonstandard maxval values are scaled to the PNG range with rounding. Comments are not copied to PNG metadata. |
| Conversion warnings | Describe the fallback actually used for the input. |
| Valid OpenXML output | Confirms output structure; does not establish visual fidelity. |

### Conversion runtime

| Component | Role | Reference |
| --- | --- | --- |
| Browser WASM client | `createWasmConverterClient({ wasm, imageWasm })`; runs the document/panorama core and optional image module locally. | [Converter client API](../packages/converter-client/src/index.ts) |
| Document / panorama / PPM core | Production conversion WASM built from Rust; includes PPM → PNG without the optional image module. | [Rust core](../wasm/converter-core-rust/README.md) |
| Optional image core | Separate image/RAW WASM module built from Rust. | [Rust image module](../wasm/converter-image-rust/README.md) |
| HTTP adapter | Invokes the configured conversion service. | [Adapter APIs](#routes-and-source-loading) |
| Go/wazero host | Thin shell around the same WASM core: CLI/HTTP, validation, temporary files, result/error mapping, OpenXML output validation. | [Go/wazero example](../examples/go-wazero-converter/README.md) |

<sub>Browser WASI output grows on demand while reads and file sizes expose only valid bytes. Overwrite, append and sparse writes are supported; exclusive creation preserves existing files. Growth retains spare capacity and does not establish lower peak memory. [Checks](../benchmarks/frontend/2026-10-24/converter-io-review.json).</sub>

### PPM conversion

| Capability | Coverage and boundary |
| --- | --- |
| Input recognition | `.ppm` (case-insensitive) or `image/x-portable-pixmap` routes to PNG conversion. Other Netpbm extensions have no default route. |
| P3 / P6 | P3 decimal text and P6 binary RGB; P6 samples above 255 use two bytes in big-endian order. |
| Header and text raster | ASCII whitespace, LF/CRLF headers, header comments, and comments between P3 samples. Binary whitespace and `#` bytes remain pixel data. |
| Sample values | `maxval` 1–255 produces 8-bit PNG; 256–65535 produces 16-bit PNG. Values are normalized to 255/65535 with rounding. |
| Preview operations | Converted PNG uses the image driver's zoom, fit, pan, rotation, and fullscreen controls. Browser display may reduce 16-bit precision. |
| Runtime | Browser `createWasmConverterClient({ wasm })` and Go/wazero use the same `converter-core.wasm` implementation. HTTP integrations must provide a service with this conversion pair. |
| Resource limits | Input ≤256 MiB; decoded RGB ≤128 MiB (3 bytes/pixel at 8-bit, 6 at 16-bit). These are buffer limits, not a total peak-memory guarantee. |
| Stream and metadata | Only the first image is converted. No animation, alpha channel, comment metadata export, or additional color-profile conversion. |
| Decoder verification | [Rust tests](../wasm/converter-core-rust/src/ppm.rs) cover comments, maxval scaling, 16-bit samples, binary delimiter bytes, malformed inputs, and oversized dimensions. |
| Integration verification | [WASM client tests](../packages/converter-client/test/converter-client.spec.ts) cover P3/P6, PNG dimensions/depth, and invalid input; [browser regression](../apps/demo/e2e/ppm.e2e.ts) checks the built-in sample and uploaded P3/P6/16-bit image pixels. The [batch fixture](../examples/go-wazero-converter/fixtures/image/sample.ppm) covers the Go/wazero host. |

### Camera RAW conversion

| RAW family | Source extensions | Target |
| --- | --- | --- |
| Digital Negative | `dng` | `jpg` |
| Canon | `cr2`, `cr3` | `jpg` |
| Nikon | `nef`, `nrw` | `jpg` |
| Sony | `arw`, `sr2`, `srf` | `jpg` |
| Olympus | `orf` | `jpg` |
| Panasonic / Leica | `rw2`, `rwl` | `jpg` |
| Fujifilm / Kodak / Sigma | `raf`, `kdc`, `x3f` | `jpg` |
| Pentax / Samsung | `pef`, `srw` | `jpg` |
| Epson / Mamiya / Minolta | `erf`, `mef`, `mrw` | `jpg` |
| Leaf / Hasselblad / Phase One | `mos`, `3fr`, `iiq` | `jpg` |

| Decode path | Coverage | Limits |
| --- | --- | --- |
| Embedded preview | Core copies the largest standard 8-bit embedded JPEG. | Requires a suitable embedded JPEG. |
| X3F sensor preview | The image module develops legacy mapped-Huffman and TRUE/Merrill sensors when no JPEG is available or its longest side is below 2048 px. Camera identity comes from X3F properties. | Output up to 2048 px without upscaling; daylight WB. Quattro sensor compression and CAMF adjustments are unavailable. |
| Sensor fallback | Optional `converter-image.wasm` performs lightweight sensor decoding and downsampling with camera WB, sRGB color and DNG exposure metadata. No-JPEG DNG, Nikon D3S NEF, Canon 40D sRAW CR2, PEF and ORF samples are [verified](performance-comparison.md). | Up to 2048 px; camera/file variants affect decoding. Invalid color calibration raises an error. |
| Calibrated panorama DNG | One RS and X5 metadata can select static spherical stitching before ordinary conversion. Uses full-sensor development, exposure matching and content-aware seams. | Requires both panorama WASM modules; preview up to 4096 px, experimental calibration and camera-dependent decoding. Unsupported calibration stays flat. |
| Full RAW development | Unavailable. | Full-resolution development, custom picture profiles, and camera edits are not preserved. |

The Vue preview enables calibrated DNG inspection when `converter` and
`panoramaProcessor` are supplied. See [RAW panorama integration](../packages/panorama/README.md).

<sub>Panorama/RAW replacement, cancellation and destruction release owned URLs, canvases and players and ignore late parsing, image and proxy results. Retained old controls cannot affect the next preview. Browser decoding, custom conversion or synchronous WASM already in progress may finish before their output is discarded. [Regression checks](../benchmarks/frontend/2026-10-24/panorama-lifecycle-review.json).</sub>

<sub>The panorama processor keeps cancellation active for subsequent range reads, RAW development and seam/IMU work. Failed companion loading leaves no partial manifest; obsolete requests cannot replace the next source. [Processor checks](../benchmarks/frontend/2026-10-24/panorama-processor-review.json).</sub>

## Fidelity and feature details

### PPTX

<details>
<summary>Expand PPTX content, geometry, styling, and unsupported features</summary>

| Feature | Status | Details |
| --- | --- | --- |
| Text boxes and placeholder inheritance | Supported | Source-font availability and browser layout affect fidelity. |
| Images, groups, and tables | Supported | Table text style matrix coverage is partial. |
| Links and slide navigation actions | Supported | Common link/action cases; rapid page changes retain their destination during smooth scrolling, with manual scrolling able to take over. |
| Basic diagram-backed SmartArt | Partial | Full SmartArt parity is unavailable. |
| Preset shapes and adjustment formulas | Partial | Common `a:avLst` adjustments are supported; long-tail presets and OOXML formulas remain incomplete. |
| Shape text bounds and `bodyPr` behavior | Partial | Custom geometry text rectangles and exact autofit parity remain incomplete. |
| Theme colors and fonts | Supported | Browser font fallback stacks are available. |
| Solid and gradient fills | Supported | Pattern and picture fills are partial. |
| Line caps, joins, and ends | Supported | Common cases. |
| Shadows | Partial | Some source effects are simplified. |
| Unsupported content placeholders | Supported | Unsupported content can be represented by placeholders. |
| Exact source-font parity | Partial | Depends on installed fonts, app-provided webfonts, and format metadata. Embedded Office/iWork font loading is not implemented. |
| Animations and transitions | Unavailable | Not implemented in the PPTX renderer. |
| Charts | Partial | Cached 2D column charts (clustered, stacked and percent-stacked) and pie charts, including titles and legends. Other chart types and advanced formatting are unavailable. |
| Embedded audio/video | Unavailable | Standalone media playback does not imply playback inside slides. |
| OLE objects | Unavailable | Embedded object rendering is not implemented. |
| Comments, notes, and review metadata | Unavailable | Not exposed by the PPTX renderer. |

</details>

### Native iWork

| Runtime | Coverage |
| --- | --- |
| Detection and parsing | Native `.key`, `.pages`, and `.numbers` parsing through a worker. |
| Switching and cancellation | Replacement, cancellation and destruction discard obsolete results and release images. Busy parsing Workers terminate and restart on the next load; idle Workers clear the old archive and remain reusable. Caller input buffers remain intact. |
| Navigation | Keynote slides, Pages continuous pages, Numbers sheets. |
| Diagnostics | Warning and error events. |

<details>
<summary>Expand iWork content and fidelity matrix</summary>

| Feature | Status | Details |
| --- | --- | --- |
| Keynote slide canvases | Supported | Full master/template fidelity is incomplete. |
| Pages multi-page body extraction | Supported | Exact source pagination is incomplete. |
| Pages floating attachments | Partial | Some placement and content are simplified. |
| Pages section/page backgrounds and template headers/footers | Supported | Includes section page-number start values. |
| Numbers sheet canvases and merged cells | Supported | Table fidelity remains partial. |
| Numbers tables | Partial | A full Numbers calculation engine is unavailable. |
| Text runs and paragraphs | Partial | Some formatting is simplified. |
| Images, media asset lookup, basic shapes, and lines | Partial | Unsupported records produce warnings. |
| Charts | Unavailable | Chart rendering is outside current coverage. |
| Collaboration metadata | Unavailable | Not exposed by the native viewers. |

</details>

### PDF, DOCX, and workbooks

| Driver | Implemented | Current limits |
| --- | --- | --- |
| PDF | PDF.js renders visible/nearby pages and releases distant canvas buffers; page navigation, zoom/fit, resize and cancellation. `virtual: false` renders every page eagerly. | Text search/selection layers are unavailable. Unopened page sizes initially use first-page estimates. Default virtual preview does not advertise full-document printing; eager mode retains that capability. |
| DOCX | Rendering through `docx-preview`; repeated image references reuse resources within their document part. Switching, cancellation and destruction release embedded image/font URLs and discard obsolete rendering. | Fidelity depends on renderer coverage, fonts and layout. Parsing/rendering already in progress may finish in a detached container. |
| XLSX | Sheet switching, cell values, cached formula values, and basic arithmetic / `SUM` evaluation when cached values are absent. | Unsupported formulas remain visible as formula text. Charts, merged-cell layout, full style fidelity, and a full calculation engine are unavailable. |
| CSV | Read-only tables for UTF-8/browser-readable sources; CRLF/CR/LF, quoted multiline text, escaped quotes and empty records. | Rich type inference and workbook styling are unavailable. |
| Workbook row loading | Rows are appended in batches on scroll. | Loaded rows remain mounted; large-sheet virtualization is unavailable. |

### DXF CAD

<details>
<summary>Expand DXF SVG rendering, entities, metadata, and known gaps</summary>

| Area | Preview coverage | Limits |
| --- | --- | --- |
| Renderer | Supported entities render as browser SVG. | Geometry, layers, styles, and text are partial. |
| Common geometry | `POINT`, `LINE`, `XLINE`, `RAY`, `LEADER`, `CIRCLE`, `ARC`, `ELLIPSE`, `SPLINE`, `LWPOLYLINE`, classic `POLYLINE`/`VERTEX`, bulge arcs, common polyline widths, `SOLID`, `TRACE`, `3DFACE`. | Full DXF entity coverage is unavailable. |
| Solid hatches | Polyline, line-edge, arc-edge, elliptical-arc-edge, spline-edge boundaries; multi-loop even-odd fill for holes. | Patterned/nested hatches remain incomplete. |
| Blocks and dimensions | Nested `BLOCK`/`INSERT`, `MINSERT` arrays, `DIMENSION` geometry-block expansion; lightweight linear/aligned fallback without geometry blocks. | Advanced block attributes and dimensions remain incomplete. |
| Raster references | `IMAGE`/`IMAGEDEF` references and clipping; app resolvers accept URLs, Blob, ArrayBuffer and typed-array slices. Owned image URLs are released on replacement, cancellation, failure and destruction. | Unresolved local paths produce placeholders and warnings. |
| Loading | Safe file replacement and cancellation; obsolete source/resolver results are discarded. Base64 data URLs decode UTF-8 text. | Already-started synchronous parsing and custom resolver work may finish before its result is discarded. |
| Text entities | Simple `TEXT`, `MTEXT`, `ATTRIB`, `ATTDEF`: height, rotation, width factor, oblique angle, alignment points, MTEXT attachment/direction, inline formatting cleanup, multiline rendering. | Exact text metrics, advanced MTEXT, annotative scaling, and layout-space text behavior remain incomplete. |
| Bounds and units | Entity geometry; `$EXTMIN`/`$EXTMAX` or `$LIMMIN`/`$LIMMAX` bounds hints; `$INSUNITS`, `$MEASUREMENT`, `$LTSCALE` metadata. | Layout and xref coverage remain incomplete. |
| Layers and colors | Names, basic ACI colors, true color, transparency, hidden/off/frozen/locked flags, entity invisibility/color overrides, SVG attributes, Vue layer toggles. | Coverage remains partial. |
| Line styles | `LTYPE` dash patterns, global/entity (`48`) line-type scale, entity/layer `LINEWEIGHT`. | Exact source styling is not guaranteed. |
| Fonts | TrueType/OpenType-style references map to CSS fallbacks. | Exact SHX glyph rendering is unavailable; SHX references warn and use browser fonts. |
| Native DWG / DGN | Unavailable. | No native preview route. |

</details>

### 3D models and inspection

| Runtime area | Coverage | Requirement or limit |
| --- | --- | --- |
| Three.js viewer | Orbit, zoom, fit, fullscreen. | Import coverage varies by format. |
| Loading and cleanup | Safe file replacement and cancellation; discard late model results and release geometries, materials, textures and nested resource URLs. | Already-started parsing may finish before its result is discarded. |
| External materials and data | Sidecar resource loading. | May require `resourceResolver`; some loaders require synchronous resolution. |
| Inspection controls | Model inspection where supported by the driver. | Object-based previews expose richer controls than some direct-geometry previews. |

<details>
<summary>Expand the complete 3D/model format list and import limits</summary>

| Formats | Import coverage | Requirements and limits |
| --- | --- | --- |
| `step`, `stp` | Triangulated CAD solids. | Lazy-loaded front-end OpenCascade WASM importer; viewing only. |
| `stl`, `obj`, `ply` | ASCII/binary STL; OBJ geometry and common inline vertex colors; ASCII/binary-little-endian PLY with common vertex colors. | OBJ MTL libraries/textures can use app-resolved sidecars. |
| `gltf`, `glb` | Embedded/data-URI glTF, URL-loaded buffers/textures, single-file GLB. | External buffers/textures can use app resolution. |
| `3mf`, `amf` | Core 3MF meshes, build/component items, base materials, color-group object/triangle vertex colors; AMF objects. | Unsupported 3MF textures, composite materials, multi-properties, and non-color-palette references emit fallback warnings. |
| `dae`, `kmz`, `fbx`, `3ds`, `usdz` | Collada, KMZ packaged Collada with nested/encoded paths and textures, FBX, 3DS, USDA-backed USDZ. | DAE/FBX/3DS texture sidecars require synchronous app resolution; KMZ uses packaged resources. |
| `wrl`, `vrml`, `ldr`, `mpd` | VRML scenes; LDraw models with packed MPD definitions and nested local parts/primitives. | VRML textures require synchronous app resolution; external LDraw parts require app-provided resources. |
| `md2`, `lwo` | MD2 and LightWave Object meshes. | LWO textures require synchronous app resolution. |
| `gcode`, `gco`, `nc` | Toolpaths. | Supported toolpath subset. |
| `pcd`, `xyz`, `vtk`, `vox` | Point clouds, VTK polydata meshes, VOX voxel scenes. | Supported data subsets. |
| `bvh`, `pdb` | Motion skeletons and molecular structures. | Supported subsets depend on the importer. |
| `nrrd`, `nhdr` | Three-dimensional scalar point volumes; raw, gzip, ASCII, LF/CRLF headers and binary byte order. | Detached NHDR requires one app-resolved data file. File lists, four-dimensional volumes and line/byte skips are unavailable. |

</details>

<details>
<summary>Expand 3D inspection capabilities and Vue UI</summary>

| Capability | Coverage | Scope or limits |
| --- | --- | --- |
| Model metadata | Format, bounds, mesh/line/point/material counts, material names, animation counts, basic triangle/vertex/color metadata. | Available fields depend on the importer. |
| Model tree | Stable node IDs, search/filter, visibility, selection/highlighting, subtree summaries, camera refocus on re-selection. | Object-based previews. |
| Assemblies | Exploded view controls. | Object-based multi-part assemblies. |
| Measurement | Point-to-point surface picks, hover preview, surface/nearest-vertex snapping, free/X/Y/Z axis locks, coordinates, XYZ deltas, preview deltas, total distance. | Available where the driver exposes measurement. |
| Sections | Single-plane and box clipping; X/Y/Z controls and bounds-derived offsets/ranges. | Object-based and direct-geometry previews; arbitrary multi-plane sectioning is unavailable. |
| Materials | Aggregate/per-node summaries: type, color/emissive, opacity, alpha test, depth flags, wireframe, vertex colors, sidedness, roughness/metalness/shininess/size, texture presence. | Material isolation requires an object-based preview. |
| Camera and export | Perspective/orthographic projection, front/right/top/isometric/free-orbit presets, PNG snapshots. | Controls depend on driver capabilities. |
| Diagnostics | Resource warnings in state/events. | glTF/OBJ resources, missing OBJ materials/textures, KMZ textures and LDraw parts, unsupported 3MF materials. |
| Vue inspector | Tree, summaries, explode, measurement, sections, camera controls, snapshots, material isolation, material cards. | Collapsed by default; expand with the button at the top left of the canvas. Models remain still when idle, with manual orbit and zoom. Features depend on driver support. |
| Layer-aware isolation | Unavailable. | Material isolation is supported for object-based previews. |
| Other native formats | Unavailable. | Import coverage is limited to the list above. |

</details>

<sub>glTF sidecar URLs are released after loading, failure or cancellation. Resolvers can return HTTP URLs directly; caller-provided URLs remain caller-owned. STEP can retry after WASM initialization fails. [Resource loading checks](../benchmarks/frontend/2026-10-24/model3d-resources-review.json).</sub>

<sub>Volume previews preserve detached NHDR encoding and fix final-header truncation and byte-order color errors. Cancellation stops waiting for resources; truncated binary data is rejected. [Volume checks](../benchmarks/frontend/2026-10-24/volume-preview-review.json).</sub>

<sub>OBJ preserves UTF-8 material names and resolves texture scale/offset options plus normal, bump and displacement maps. It waits for used images, reports failures and releases owned URLs on completion or cancellation. [OBJ checks](../benchmarks/frontend/2026-10-24/obj-resources-review.json).</sub>

<sub>LDraw preserves packed definitions and containing-file paths, reports missing parts and cycles, and cancels asynchronous dependency loads. Normal smoothing avoids repeated traversal of disconnected surfaces while preserving shading. [LDraw checks](../benchmarks/frontend/2026-10-24/ldraw-resources-review.json).</sub>

<sub>KMZ extracts the selected model and its images, resolves paths relative to KML/DAE, and waits for textures before previewing. Both public APIs release owned image URLs; asynchronous preview supports cancellation and reports missing/broken textures. [KMZ checks](../benchmarks/frontend/2026-10-24/kmz-resources-review.json).</sub>

<sub>3D input reads, GLB parsing, STEP initialization and 3MF archive waits support cancellation. Late scenes are disposed; shared STEP initialization remains usable by other loads. Synchronous parsing itself cannot be interrupted. [Cancellation and rendering checks](../benchmarks/frontend/2026-10-24/model3d-cancel-review.json).</sub>

### Panoramas and live photo samples

| Source | Preview coverage | Requirements and limits |
| --- | --- | --- |
| Equirectangular images | Spherical image preview. | Requires equirectangular source imagery. |
| Equirectangular videos | Spherical video playback. | Requires browser-decodable media. |
| Insta360 `insp` | Experimental calibrated One RS dual-fisheye photos with content-aware feathered seams. | Requires embedded lens calibration and a panorama processor. |
| Insta360 `insv` | Calibrated raw-lens rendering where supported; browser media decoding fallback without WebCodecs. | Calibration, codecs, and projection determine whether a file can open. |
| DJI Osmo `osv` | Calibrated rendering with raw lens sources where available; experimental proxy fallback. | Fallback requires matching camera-generated `.LRF` via `resourceResolver`. Baked-in seams cannot be reconstructed; use a DJI Studio stitched 2:1 export for accurate fallback playback. |
| Unsupported unstitched dual-fisheye video | Rejected. | Not mapped onto a sphere without a supported calibration or fallback path. |
| Apple Live Photo demo | Real iPhone 15 HEIC/MOV pair; Apple's LivePhotosKit JS plays JPEG/H.264 derivatives for Chromium compatibility. Originals remain available. | Demo integration only; no general HEIC/MOV pair decoding. |
| Android Motion Photo demo | Verified Pixel 9 Pro XL and Samsung Galaxy A34 / S20 FE / Tab S9 samples show still images. | Embedded video extraction is not implemented in the WASM conversion core. |

| Integration | Configuration |
| --- | --- |
| Calibrated camera processing | Pass a `panoramaProcessor` to the driver or Vue `Preview`, such as `createWasmPanoramaProcessor({ wasm })` from `@filens/panorama`. |
| Companion lens streams and proxies | Resolve sidecars through `resourceResolver`. |

### Ebooks, archives, mind maps, and diagrams

| Family | Preview coverage | Limits or integration notes |
| --- | --- | --- |
| EPUB / CBZ | EPUB spine-based chapters; relative CSS imports, fonts/backgrounds, inline styles, encoded paths and SVG image references. Repeated resource lookups are cached and import cycles stop. EPUB/CBZ assets use bounded-batch extraction; CBZ keeps natural page order. Replacement/cancellation/destruction clears session resources. | Books are still extracted in full, not on demand. Advanced navigation, themes, and additional native ebook formats are unavailable. Other readable formats may have conversion routes. |
| Archives | Read-only browsing, nested archives, entry preview and extraction helpers; replacement, back navigation and cancellation discard old results and release resources. | Host previewer factories retain preview options and resolve bundled sidecars relative to the entry directory. Built-in fallbacks support common images, audio/video and text, with browser-dependent playback. No bulk extraction UI. [Checks](../benchmarks/frontend/2026-10-24/archive-lifecycle-review.json). |
| Demo ZIP bundles | Primary-file detection with sidecars from the bundle. | Recognized primary files include glTF/GLB/3MF, DXF, mind maps, draw.io/dio, HTML/XHTML, PNG, and common text. |
| Mind maps | XML/ZIP trees, zoom, responsive contain/width/height fitting, SVG node selection, outline/search capability flags; stale file results are discarded, with cancellation and destruction cleanup. | XMind reads `content.json` / `content.xml`; MindManager reads `Document.xml`. Complex editing and full layout fidelity are unavailable. |
| Diagrams | Compressed/uncompressed diagrams.net mxGraph with default-size fallback; basic Visio XML/ZIP pages including legacy VDX `XForm` / `PageProps` geometry, `Shape` connectors and `pages.xml` manifests; common colors, rounded/ellipse/rhombus shapes, dashed lines, arrows, selection, zoom and responsive fitting. Replaced/cancelled/destroyed sessions discard pending results. | Visio mainly reads cached geometry; full master inheritance, layout fidelity and editing are unavailable. |
| Code / text | UTF-8 display, language metadata, aligned line numbers; lightweight code highlighting up to 200,000 characters. Verified with 200,000 lines; replacing, cancelling or destroying a load discards pending results. | Full-file decoding and layout remain; no text virtualization, built-in search or richer editor controls. Larger sources skip highlighting. |
| Browser images / HTML | Replacement, cancellation and destruction release session-owned URLs and ignore old element events. | Image decoding remains browser-dependent; HTML scripts remain sandboxed. |
| Audio / video | Browser-native playback; replacement/cancellation/destruction stops old players. Failed media sources report errors; optional artwork does not block playback. | Browser codecs only; no HLS/DASH streaming or general transcoding. Artwork reads ID3 APIC only, limited to the first 512 KiB for Blob/File input. Standalone playback does not imply embedded Office/iWork media support. |

## Integration support

### Routes and source loading

| Capability | Support |
| --- | --- |
| Input sources | URL `string`, `ArrayBuffer`, `Uint8Array`, `Blob`, and `File`. |
| Generic preview runtime | `createPreviewer()`, package drivers/routes, lifecycle, state, warning/error events, and source switching. |
| Format introspection | `listPreviewFormats()`, `listPreviewFormatGroups()`, `listPreviewExtensions()`, and `createPreviewAcceptAttribute()`. Pass the application's composed routes to reflect enabled packages and overrides. |
| PPTX runtime | `init()` / `createViewer()`, `preview()`, `destroy()`, zoom/fit, slide/keyboard navigation, and a virtualized main viewport. |
| iWork runtime | `detectIworkType()`, `loadIwork()`, `createIworkViewer()`, worker parsing, and page/sheet navigation. |
| Vue wrappers | `PptxPreview`, `IworkPreview`, and generic `Preview`; direct `src`, toolbar, thumbnails where applicable, source switching, and warning/error emits. Controls depend on driver capabilities. |
| Converter adapters | Optional WASM, HTTP, and mock adapters. HTTP non-2xx JSON or `X-Preview-*` responses surface as `HttpConversionError` with stable converter metadata. |

<sub>The shared runtime settles superseded preview calls on replacement or destruction, aborts their load signals and ignores late results/events. Failed loads release their sessions and remain visible in state. Custom drivers own their resources; work that ignores cancellation may still finish. [Regression checks](../benchmarks/frontend/2026-10-24/preview-runtime-review.json).</sub>

<sub>HTTP / WASM conversion accepts HTTP(S), Blob URLs, paths starting with `/`, `./` or `../`, inline text and data URLs; binary percent escapes preserve their bytes. Cancellation settles the caller while shared WASM loading remains available to other calls. Failed module loads can be fetched again on the next call; a fixed consumed Response must be replaced. Synchronous WASM execution cannot be interrupted. [Source checks](../benchmarks/frontend/2026-10-24/converter-source-review.json).</sub>

| Routing reference | Scope |
| --- | --- |
| [Core route definitions](../packages/core/src/preview/formats.ts) | Format definitions and default routing helpers. |
| [Vue route composition](../packages/vue/src/defaults.ts) | Routes assembled for the Vue `Preview` host. |

### Fonts and external resources

| Hook / helper | Current consumers | Limits or integration notes |
| --- | --- | --- |
| `fontResolver` | Currently consumed by DXF. | Available in preview options and Vue `Preview`; not universal font loading across drivers. |
| `resourceResolver` | DXF raster references, glTF buffers/textures, OBJ materials/textures, supported 3D sidecars, missing EPUB assets, camera panorama companions. | Available in preview options and Vue `Preview`; supported resource types depend on the driver. |
| File-set resolver | Core helper for multi-file uploads and sidecar resolution. | Resolves resources from the provided file set. |
| Archive resolvers | `@filens/archive` helpers expose entries as resources. | Includes ZIP-backed compound bundles. |

| Font source | Current behavior |
| --- | --- |
| Browser fonts and app-provided webfonts | Affect layout; exact source-font rendering is not guaranteed. |
| SHX references | Use browser font fallbacks and emit warnings. |
| Embedded Office/iWork fonts | Loading is not implemented. |

## Unsupported formats and workflows

Gaps below apply to shipped preview paths. Hosts can supply custom drivers or converter routes.

| Area | Formats or workflow | Current boundary |
| --- | --- | --- |
| Native CAD | DWG, DGN, FreeCAD projects, IGES/BREP | No native preview route; STEP/STP and DXF are covered above. |
| BIM | Revit, IFC | No native preview route. |
| ECAD / fabrication | Gerber/Excellon, layered KiCad PCB | No native preview route. |
| Other images | TIFF, HEIC/HEIF, PSD | No default standalone route. Demo-derived assets do not establish general support. |
| Other Netpbm extensions | `pbm`, `pgm`, `pnm`, `pam`, `pfm` | No default preview/conversion routes for these extensions. PPM support covers P3/P6 RGB only. |
| Other archives | RAR, 7z | No default standalone route. |
| Office add-ins | Add-ins and embedded application behavior | Outside the default conversion policy. |
| Unlisted conversion pairs | Any pair absent from the manifests | Outside the default conversion policy; macro stripping applies to listed macro-enabled OpenXML sources. |
| Editing | Office/iWork/CAD/diagram authoring | No full editor. |
| Application parity | Exact layout and calculation behavior | Not guaranteed; consult each family's feature table. |

| Further reading | Contents |
| --- | --- |
| [Roadmap](roadmap.md) | Planned work. |
| [Project overview](project-overview.md) | Architecture and integration context. |
