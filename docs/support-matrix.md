# Support Matrix

This file tracks the practical support level of the current implementation across PPTX, native iWork, PDF, DOCX, XLSX/CSV, EPUB/CBZ, ZIP archives, browser-native DXF CAD preview, STEP/STP CAD solids through front-end OpenCascade WASM, STL/OBJ/PLY/glTF/GLB/3MF/AMF/DAE/FBX/3DS/USDZ/G-code/VRML/PCD/XYZ/VTK/VOX/LDraw/KMZ/MD2/LWO/BVH/PDB/NRRD/NHDR model, toolpath, point-cloud, molecule, motion skeleton, volume voxel, and voxel preview, FreeMind/OPML/XMind mind-map preview, draw.io/VDX/VSDX diagram preview, panorama images, generic file preview families, and the intentionally narrow default conversion boundary for manifest-backed OpenXML normalization.

## Sources

- `string` URL: supported
- `ArrayBuffer`: supported
- `Uint8Array`: supported
- `Blob`: supported
- `File`: supported

## PPTX Viewer Runtime

- `init()` / `createViewer()`: supported
- `preview()`: supported
- `destroy()`: supported
- zoom and fit controls: supported
- slide navigation: supported
- keyboard navigation: supported
- virtualized main viewport: supported

## iWork Runtime

- `detectIworkType()`: supported
- `loadIwork()`: supported
- `createIworkViewer()`: supported
- Worker-based parsing: supported
- Keynote page navigation: supported
- Numbers sheet navigation: supported
- Pages continuous page rendering: supported
- iWork warning and error events: supported

## Generic Preview Runtime

- `createPreviewer()`: supported
- package-provided drivers and routes: supported
- route-backed format introspection helpers: supported
- upload `accept` attribute generation from the route table: supported
- font resolver hook: supported as preview options and Vue `Preview` prop; currently consumed by the CAD/DXF driver
- resource resolver hook: supported as preview options and Vue `Preview` prop; currently consumed by the CAD/DXF driver for unresolved `IMAGE`/`IMAGEDEF` raster paths, the model3d/glTF driver for uploaded sidecar buffers/textures, and the EPUB driver for missing chapter assets; core includes a file-set resolver helper for multi-file uploads, and ZIP-backed resolver helpers are available from `@filens/archive` for uploaded compound bundles
- optional converter adapter boundary: supported
- HTTP converter client adapter: supported; non-2xx JSON or `X-Preview-*` header responses are surfaced as `HttpConversionError` with stable converter metadata
- mock converter client adapter: supported
- image preview: supported for PNG, JPEG, GIF, WebP, AVIF, APNG, ICO, SVG, and BMP with zoom, fit width/height, pan, rotation, and fullscreen controls; the demo photo catalog omits SVG because it is vector artwork rather than a photo sample
- text preview: supported for UTF-8 text sources
- code preview: supported as plain text with language detection metadata, line numbers, and non-wrapping code layout
- audio preview: supported through native browser audio controls
- video preview: supported through native browser video controls
- HTML preview: supported through a sandboxed iframe
- PDF preview: supported through browser PDF embedding
- DOCX preview: supported through `docx-preview`
- XLSX preview: supported for lightweight read-only workbook tables
- CSV preview: supported as lightweight read-only workbook tables for UTF-8/browser-readable sources
- EPUB preview: supported for spine-based XHTML chapters with package-local asset rewriting and app-resolved missing chapter assets
- CBZ preview: supported for ZIP-based image page sequences
- ZIP/JAR/WAR/EAR/APK, TAR, TGZ/TAR.GZ, and single-file GZIP archive preview: supported for read-only listings and file extraction; package helpers can expose entries as `resourceResolver` sources, with ZIP-compatible helper aliases retained
- ZIP bundle preview in the demo: supported for uploaded ZIPs with an identifiable browser-native primary file such as glTF/GLB/3MF, DXF, XMind/MM/OPML, draw.io/dio, HTML/XHTML, PNG, or common text files
- manifest-backed OpenXML conversion: supported through the optional converter boundary for `ppt`/`pps`/`pot`/`ppsx`/`potx`/`dps`/`dpt`/`odp`/`otp`/`fodp` -> `pptx`, `doc`/`docm`/`dot`/`dotx`/`wps`/`wpt`/`rtf`/`odt`/`ott`/`fodt` plus lightweight text/markup/config/template/source-code formats -> `docx`, and `xls`/`xlsm`/`xlt`/`xltx`/`et`/`ett`/`ods`/`ots`/`fods` plus DBF/SYLK/DIF and CSV/TSV/TAB/PSV/JSON/JSON Lines table-like inputs -> `xlsx`; `docm`/`xlsm` macros are stripped for preview, while other macro-enabled OpenXML, OpenXML add-ins, ODF drawings, legacy OpenOffice XML, CAD/3D/media/iWork/archive/ebook/diagram/mind-map, and standalone image conversions are not default routes
- RAW image conversion: supported for `dng`/`cr2`/`cr3`/`nef`/`nrw`/`arw`/`sr2`/`srf`/`orf`/`rw2`/`rwl`/`raf`/`kdc`/`x3f`/`pef`/`srw`/`erf`/`mef`/`mos`/`mrw`/`3fr`/`iiq` -> `jpg`; it copies the largest standard 8-bit camera-embedded JPEG and fails explicitly when none exists, without image decoding, sensor demosaic, or color development
- pure WASI conversion core: supported through `wasm/converter-core`, with direct browser/front-end execution via `createWasmConverterClient()` and a Go/wazero host shell in `examples/go-wazero-converter`; the current build emits valid lightweight structured OpenXML for bundled allowed document, text/source, and table-like samples, while production layout fidelity remains future work
- DXF CAD preview: supported for browser-native SVG rendering of common `POINT`, `LINE`, `XLINE`, `RAY`, `LEADER`, `CIRCLE`, `ARC`, `ELLIPSE`, `SPLINE`, `LWPOLYLINE`, classic `POLYLINE`/`VERTEX`, polyline bulge arcs and common polyline widths, `SOLID`, `TRACE`, `3DFACE`, solid `HATCH` polyline, line-edge, arc-edge, elliptical-arc-edge, and spline-edge boundaries including multi-loop even-odd fill for holes, `IMAGE`/`IMAGEDEF` raster references with clipping boundaries for browser-loadable or app-resolved sources and placeholders/warnings for unresolved local paths, `TEXT`, `MTEXT`, `ATTRIB`, and `ATTDEF` entities, with nested `BLOCK`/`INSERT` expansion, `MINSERT` block arrays, `DIMENSION` geometry-block expansion for reusable geometry built from those primitives, and a lightweight linear/aligned dimension fallback when geometry blocks are unavailable
- DXF drawing bounds/header metadata: partial; uses entity geometry plus `HEADER` `$EXTMIN`/`$EXTMAX` or `$LIMMIN`/`$LIMMAX` as bounds hints for sparse drawings and construction geometry, and exposes `$INSUNITS`/`$MEASUREMENT` unit metadata plus `$LTSCALE` line-type scaling in the drawing model
- DXF layer/color/line-style metadata: partial; parses `LAYER` table names, basic ACI colors, true color, transparency, hidden/off/frozen/locked layer flags, entity invisible flags, entity color overrides, `LTYPE` dash patterns, global and entity (`48`) line-type scale, entity and layer `LINEWEIGHT`, writes SVG layer/color/style attributes, and exposes generic Vue layer toggles
- DXF text layout: partial; supports text style, height, rotation, width factor, oblique angle, `TEXT` alignment points, MTEXT attachment/direction metadata, inline formatting cleanup, and multiline rendering for simple `TEXT`/`MTEXT`/`ATTRIB`/`ATTDEF`
- DXF text style metadata: partial; TrueType/OpenType-style font references are mapped to CSS font-family fallbacks, while SHX font references emit warnings and fall back to browser fonts
- panorama image and video preview: supported through Three.js for equirectangular `pano`/`panorama`/`360` images, embedded-calibration Insta360 One RS dual-fisheye `.INSP` photos, and browser-decodable `360v`/`vr360` videos; calibrated `.INSP`/`.INSV` and `.OSV` rendering uses content-aware feathered seams when raw lens sources are available. DJI Osmo `.OSV` can still fall back to the matching camera-generated `.LRF` as an experimental low-resolution proxy; seams baked into that proxy cannot be reconstructed, so accurate fallback playback requires a DJI Studio stitched 2:1 export. Unsupported unstitched dual-fisheye video is rejected instead of being incorrectly mapped onto the sphere
- live photo catalog samples: the demo bundles only verified real-device files: an Apple iPhone 15 HEIC/MOV pair, a Google Pixel 9 Pro XL Motion Photo, and Samsung Galaxy A34, S20 FE, and Tab S9 Motion Photos; Apple's official LivePhotosKit JS uses JPEG/H.264 derivatives generated from the original pair for Chromium compatibility while keeping the original HEIC/MOV available, and Android files currently show their still image because embedded video extraction is not yet implemented in the WASM conversion core
- STEP/STP/STL/OBJ/PLY/glTF/GLB/3MF/AMF/DAE/FBX/3DS/USDZ/G-code/VRML/PCD/XYZ/VTK/VOX/LDraw/KMZ/MD2/LWO/BVH/PDB/NRRD/NHDR model preview: supported for STEP/STP CAD solids triangulated by a lazily loaded front-end OpenCascade WASM importer, browser-native ASCII/binary STL, OBJ geometry with common inline vertex colors plus app-resolved MTL libraries and texture maps when `resourceResolver` is available, ASCII/binary-little-endian PLY with common vertex colors, embedded/data-URI glTF, URL-loaded or app-resolved glTF sidecar resources, single-file GLB, core 3MF mesh/build/component items with basic base-material and color-group object/triangle vertex colors, AMF objects, Collada DAE scenes with synchronous app-resolved texture sidecars, KMZ zipped Collada scenes, FBX objects with synchronous app-resolved texture sidecars, 3DS objects with synchronous app-resolved texture sidecars, USDA-backed USDZ objects, G-code/GCO/NC toolpaths, VRML/WRL scenes with synchronous app-resolved texture sidecars, PCD/XYZ point clouds, VTK polydata meshes, VOX voxel scenes, LDraw `.ldr`/`.mpd` models with uploaded sidecar part resolution, MD2 meshes, LWO LightWave Object meshes with synchronous app-resolved texture sidecars, BVH motion skeletons, PDB molecular structures, NRRD voxel volumes, and NHDR detached headers with app-resolved single external raw data files through the Three.js-backed model3d driver with orbit, zoom, fit, and fullscreen controls
- model3d resource warnings: supported; `resourceResolver` warnings for glTF/OBJ sidecars are exposed through preview state and warning events
- model3d metadata state: supported; preview state can expose format, bounds, mesh/line/point/material counts, material names, animation counts, and basic triangle/vertex/color metadata for direct front-end inspection UIs
- model3d model tree state: supported; object-based previews expose a front-end model tree with stable node ids, selection state, and node-selection highlighting hooks for inspection UIs
- model3d node inspection metadata: supported; model-tree nodes expose subtree mesh/line/point/material/triangle/vertex/color and bounds metadata so front-end inspectors can summarize the selected branch without re-traversing the Three.js scene
- model3d node focus controls: supported; re-selecting a model-tree node can refocus the camera on the selected subtree while preserving a front-end-driven inspection workflow
- model3d exploded view control: supported; object-based previews can expose front-end explode amount controls for multi-part assemblies
- model3d point-to-point measurement control: supported; object-based previews can enter a front-end measurement mode, hover preview the next pick, pick two surface points, switch between surface and nearest-vertex snapping, apply free/X/Y/Z axis locks for the second pick, and expose start/end coordinates, XYZ deltas, preview deltas, and total distance through preview state
- model3d section control: supported; object-based and direct-geometry previews can expose a front-end clipping section with single-plane and box modes, X/Y/Z axis switching, offset and per-axis range limits derived from model bounds, and preview state for active mode/axis/offset/ranges
- model3d material inspection metadata: supported; aggregate and per-node state include structured material summaries such as type, color/emissive swatches, opacity/alpha-test flags, depth/write-test flags, wireframe/vertex-color flags, sidedness, roughness/metalness/shininess/size values, and texture-map presence
- model3d material isolation control: supported; object-based previews can isolate a single material key across the visible scene while preserving node-selection overlays and recoverable base material state
- model3d camera controls: supported; preview state can expose perspective/orthographic projection mode plus front/right/top/isometric and free-orbit camera presets for front-end inspection UIs
- model3d snapshot export: supported; object-based and direct-geometry previews can export the current rendered view as a front-end PNG snapshot
- Vue model3d inspector UI: supported; the default `Preview` host includes model-tree search/filtering, per-node visibility toggles, subtree summaries, explode control, point-to-point measurement with hover/snap/axis controls, plane/box section controls, projection and view-preset controls, PNG snapshot export, material isolation, and material cards for model-wide or selected-node inspection
- OBJ material/texture fallback diagnostics: supported; unresolved `.mtl` libraries or texture maps emit explicit warnings instead of silently dropping material context
- 3MF material fallback diagnostics: supported for unsupported texture2d/texture2dgroup resources, composite materials, multi-properties, and referenced non-color-palette resources; these emit warnings while the mesh falls back to supported/default vertex colors
- FreeMind MM, OPML, and XMind mind-map preview: supported for browser-native XML/ZIP tree rendering through the mindmap driver with zoom, fit, SVG node selection, and outline/search capability flags; XMind reads common `content.json` and `content.xml` topic trees
- draw.io and Visio VDX/VSDX diagram preview: supported for browser-native XML/mxGraph rendering of compressed and uncompressed diagrams.net pages plus XML/ZIP parsing of basic Visio pages, `pages.xml` page manifests, shapes, labels, and connectors; includes common fill/stroke/text colors, rounded/ellipse/rhombus shapes, dashed lines, arrow markers, selection, and zoom controls

## Vue Wrapper

- direct `src` prop preview: supported
- built-in toolbar: supported
- built-in thumbnails: supported
- source switching: supported
- warning and error emits: supported
- `PptxPreview`: supported
- `IworkPreview`: supported
- `Preview`: supported for generic driver-backed formats

## PPTX Presentation Content

- text boxes: supported
- placeholder text inheritance: supported
- images: supported
- grouped shapes: supported
- basic diagram-backed SmartArt shapes: partial
- tables: supported
- links and slide navigation actions: supported
- common OOXML shape adjustment formulas in preset `a:avLst`: supported
- common preset shapes: partially supported to good
- shape text bounds: partial to good
- table text style matrix: partial
- `bodyPr` behavior: partial
- long-tail preset shapes: partial
- unsupported content placeholders: supported

## PPTX Styling

- theme colors: supported
- theme fonts: supported
- solid fills: supported
- gradients: supported
- pattern fills: partial
- picture fills: partial
- line caps / joins / ends: supported for common cases
- shadows: partial
- browser font fallback stacks: supported
- exact source-font parity: partial; depends on browser availability, embedded font support, app-provided webfonts, and format-specific font metadata

## Native iWork Content

- `.key` detection and parsing: supported
- `.pages` detection and parsing: supported
- `.numbers` detection and parsing: supported
- Keynote slide canvases: supported
- Pages multi-page body extraction: supported
- Pages floating attachments: partial
- Pages section/page template background: supported
- Pages template header/footer text: supported
- Pages section page-number start: supported
- Numbers sheet canvases: supported
- Numbers tables: partial to good
- Numbers merged cells: supported
- iWork text runs and paragraph extraction: partial
- iWork images and media asset lookup: partial
- iWork basic shapes and lines: partial
- iWork warnings for unsupported records: supported

## Not Yet Implemented

- animations
- transitions
- charts
- full SmartArt parity
- audio / video
- OLE objects
- embedded fonts
- exact CAD SHX font rendering without fallback
- comments / notes / review metadata
- full custom geometry text rect coverage
- browser-side exact autofit parity
- long-tail OOXML shape formula coverage
- exact Pages pagination parity
- exact Numbers calculation engine semantics
- full Keynote master/template parity
- iWork chart support
- iWork comment/collaboration metadata
- rich PDF navigation and page-count extraction
- rich XLSX/CSV workbook preview with formulas, charts, merged cells, style fidelity, type inference, and large-sheet virtualization
- syntax highlighting, search, and richer editor-style controls for code preview
- advanced video streaming such as HLS/DASH
- panorama video preview
- advanced ebook navigation, themes, and non-EPUB/non-CBZ ebook formats without conversion
- extraction UI and archive formats beyond ZIP-compatible containers, TAR, and GZIP
- native DWG/DGN/Revit-style CAD drawing preview without conversion
- native Gerber/Excellon and KiCad PCB layered ECAD preview
- high-fidelity DXF coverage for every entity type, advanced block attributes, patterned/nested hatches, advanced dimension semantics, xrefs, and layouts
- exact DXF text metrics, SHX glyph shapes, advanced MTEXT formatting, annotative text scaling, and layout-space text behavior
- native 3D/model preview beyond STEP/STP/STL/OBJ/PLY/glTF/GLB/3MF/AMF/DAE/FBX/3DS/USDZ/G-code/VRML/PCD/XYZ/VTK/VOX/LDraw/KMZ/MD2/LWO/BVH/PDB/NRRD/NHDR, plus advanced controls such as multi-plane sectioning and true layer-aware isolation
- native complex mind-map and diagram editing-style interactions beyond direct MM/OPML/XMind/draw.io/basic VDX/VSDX preview

## Notes

The goal for the first release line is common business presentation and document usability in modern browsers, not complete PowerPoint, Keynote, Pages, or Numbers feature parity.
