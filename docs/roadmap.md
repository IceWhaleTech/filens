# Roadmap

This roadmap reflects the current repository state and the next logical delivery steps.

## Track A: PPTX Quality

## P0: Publish Surface

- add root and package README files
- document stable API and known limitations
- verify package metadata and ESM entry points

## P1: Visible Fidelity Gaps

- continue migrating common shape text bounds into declarative preset metadata
- tighten table text style inheritance for header, banded row, and edge cells
- keep `bodyPr` downgrade behavior explicit with warnings instead of silent mismatches
- keep font substitution visible through metadata and warnings, especially for missing desktop fonts and CAD SHX fonts

## P2: Real Sample Regression

- keep the remote `vue-office` `test.pptx` as the default preview baseline
- grow DOM- and style-level e2e assertions around slides 5, 11, and 13
- expand local fixture decks for shape text bounds, table style text, and `bodyPr` behavior

## P3: Geometry Formula Coverage

- support more `a:gd` formulas beyond `val ...`
- unlock more complex preset shapes without custom one-off code

## P4: Long-tail Office Objects

- decide placeholder vs. full render strategy for charts, SmartArt, and media objects
- improve unsupported object diagnostics

## P5: Release Readiness

- dist validation in external sample apps
- broader fixture-based regression coverage
- publish workflow and versioning policy
- document remaining non-goals such as bundling complete font collections, SmartArt parity, and exact autofit measurement without the source fonts

## Track B: Multi-format File Preview Foundation

## M0: Architecture Boundary

- keep the current repo as a monorepo
- introduce generic viewer-driver contracts in `packages/core`
- avoid forcing `docx`, `pdf`, and `xlsx` into the PPTX scene model
- reserve non-document preview families from the beginning: image, video, audio, panorama, ebook, code, text, archive, CAD, 3D/model, mind-map, and diagram
- treat browsers, desktop/mobile applications, CLI tools, edge runtimes, and backend services as hosts of the same WASM core, while keeping host-specific UI and transport outside format parsing and conversion logic

## M1: Native iWork Foundation

- add `packages/iwork` as a separate native parser/viewer package
- vendor protobuf/type-map fixtures from `iwork-converter`
- keep parsing in a Web Worker by default
- reuse DOM/SVG render primitives instead of an HTML conversion fallback

## M2: PPTX Extraction

- create a dedicated `packages/pptx`
- move the current PPTX parser and renderer behind the new driver contracts
- preserve compatibility exports for the existing package surface

## M3: Native Front-end Drivers

- add `pdf` as the first non-PPTX driver: initial browser-embed driver exists
- add `docx` as a flow-document driver: initial `docx-preview` driver exists
- add `xlsx`/`csv` as workbook drivers: initial lightweight read-only workbook driver exists

## M4: Optional Conversion Layer

- add an optional adapter for converter-backed formats
- keep the default conversion scope narrow and manifest-gated: `ppt`/`pps`/`pot`/`ppsx`/`potx`/`dps`/`dpt`/`odp`/`otp`/`fodp` -> `pptx`, `doc`/`docm`/`dot`/`dotx`/`wps`/`wpt`/`rtf`/`odt`/`ott`/`fodt` plus lightweight text/markup/config/template/source-code formats -> `docx`, and `xls`/`xlsm`/`xlt`/`xltx`/`et`/`ett`/`ods`/`ots`/`fods` plus DBF/SYLK/DIF and CSV/TSV/TAB/PSV/JSON/JSON Lines table-like inputs -> `xlsx`; `docm`/`xlsm` macros are stripped for preview, while `xlsb`, other macro-enabled OpenXML, OpenXML add-ins, ODF drawings, legacy OpenOffice XML, CAD/3D/media/iWork/archive/ebook/diagram/mind-map, and standalone image conversions stay outside the default route table
- keep standalone image handling limited to PNG in the shared core route table
- keep the pure WASI conversion core shared by direct front-end WASM execution and backend host shells; production-fidelity Office-compatible layout conversion remains a later validation track
- keep converter integration outside the browser-native rendering core

## M5: General File Preview Families

- add image preview with zoom, pan, rotate, fit, and fullscreen controls: initial browser-native image driver has zoom, fit width/height, pan, rotation, and fullscreen
- add native video/audio preview before optional HLS/DASH or advanced media plugins
- add text/code preview with encoding safeguards, syntax highlighting, search, and wrap controls: initial plain-text/code driver with language metadata and line numbers exists
- add panorama photo/video preview as a separate WebGL-backed family: initial panorama image driver exists
- add archive preview as an optional package: initial ZIP listing driver exists, plus ZIP-backed resource resolver helpers for compound direct preview sidecars
- add ebook preview as an optional package: initial EPUB chapter reader and CBZ comic reader exist
- add CAD as an optional package: initial browser-native DXF parser and SVG renderer exists for common 2D entities including points, construction lines/rays, leaders, ellipses, polyline bulge arcs and common widths, spline approximation, simple filled faces, raster IMAGE/IMAGEDEF references with clipping boundaries, solid hatches with multi-loop polyline/line/arc/ellipse/spline boundaries, dimension fallback geometry, and block attribute text, classic POLYLINE/VERTEX data, nested BLOCK/INSERT/MINSERT and DIMENSION geometry-block expansion, header extents/limits/unit metadata, layer/color/true-color/transparency/visibility metadata, `LTYPE` dash patterns with global/entity scale, lineweights, and Vue layer toggles
- keep per-format font metadata and fallback warnings available to the generic host before pursuing exact font rendering
- expose an application-provided font resolver through core preview options and Vue props: initial hook exists and is used by the DXF CAD driver
- expose an application-provided resource resolver through core preview options and Vue props: initial hook exists and is used by the DXF CAD driver to resolve local `IMAGE`/`IMAGEDEF` raster paths, by the model3d/glTF driver to resolve uploaded sidecar buffers/textures, and by the EPUB driver to resolve missing chapter assets without backend conversion; core can build a resolver from a user-selected file set, and archive helpers can provide a ZIP-backed resolver for bundled file sets
- allow hosts to promote uploaded ZIP bundles into direct preview when the archive contains an identifiable primary browser-native file: demo implementation exists
- add model3d as an optional package: initial STEP/STP CAD-solid loading through front-end OpenCascade WASM, browser-native ASCII/binary STL, OBJ geometry with inline vertex colors and resource-resolved MTL/texture sidecars, ASCII/binary-little-endian PLY with common vertex colors, embedded/data-URI glTF, URL-loaded or app-resolved glTF sidecar resources, single-file GLB, core 3MF mesh/build/component item viewer with basic base-material/color-group object/triangle colors and unsupported 3MF material warnings, plus AMF, Collada DAE/KMZ, FBX, 3DS, USDA-backed USDZ, G-code, VRML/WRL, PCD/XYZ, VTK, VOX, LDraw, MD2, LWO, BVH, PDB, NRRD, and NHDR object/toolpath/point-cloud/voxel/molecule/skeleton/volume loading exists with orbit, zoom, fit, and fullscreen
- add CAD/ECAD layered previews for Gerber/Excellon and KiCad PCB files after selecting a proven front-end WASM parser; do not register extensions before they render
- add mindmap as an optional package: initial browser-native FreeMind MM, OPML, and common XMind content.json/content.xml tree viewer exists with SVG node rendering, zoom, fit, and selection
- add diagram as an optional package: initial browser-native draw.io/dio mxGraph viewer and basic Visio VDX/VSDX XML/ZIP viewer exists with SVG nodes, edges, page navigation, zoom, fit, and selection
- add broader 3D/model loaders later only after the generic host can expose orbit, fullscreen, layer, and metadata controls without leaking them into document viewers

## Track C: Native iWork Fidelity

## I0: Ship the MVP

- fixture-based smoke tests for `.key`, `.pages`, and `.numbers`
- stable ESM exports and CSS entry
- Vue wrapper and demo integration

## I1: Pages Semantics

- continue improving page metrics and body flow fidelity beyond the current multi-page body model
- improve floating drawable placement and body attachments
- refine section/template inheritance, page-number semantics, and header/footer behavior
- keep unsupported objects as warnings instead of silent drops

## I2: Numbers Semantics

- expand merged-cell fixture coverage and edge-case handling
- refine row/column sizing, headers, and style inheritance
- improve plain value, rich text, and number format fidelity

## I3: Keynote Fidelity

- improve placeholder and template inheritance
- improve shape/media specialization
- close the gap on common real-world Keynote decks before broadening long-tail coverage

## Track D: Encrypted Document Support

## E0: Detection, Errors, and Safe Password Input

- preserve the existing `password_required` and `password_invalid` error contract across browser WASM, CLI, and HTTP host shells
- distinguish password encryption from corruption, unsupported encryption schemes, signatures, DRM, and enterprise rights management
- expose a host-controlled password request flow through core preview options and Vue events instead of coupling the runtime to one dialog implementation
- provide hidden CLI prompts, stdin, or host secret-provider hooks so passwords do not have to appear in process arguments, URLs, logs, analytics, or result payloads
- never persist passwords by default, and clear password and decrypted-data buffers on a best-effort basis after preview or extraction ends

## E1: Office and WPS Decryption

- implement actual decryption in the front-end WASM conversion core for common password-protected legacy Office/WPS containers and encrypted OpenXML packages
- keep backend Go code as a thin host that passes credentials to the same WASM core without adding format-specific cryptography or parsing
- resume the existing preview-normalization route only after successful local decryption, with explicit errors for wrong passwords and unsupported encryption variants
- add fixtures for correct passwords, wrong passwords, empty passwords, damaged encryption metadata, large encrypted files, and repeated open/close cycles

## E2: PDF and Additional Containers

- support common password-protected PDF variants through the front-end PDF path, including clear handling of user-password and permission-only cases
- evaluate password-protected iWork and encrypted archive containers only after their encryption schemes, licensing, and browser-memory costs are understood
- keep DRM, certificate-bound access, hardware-key workflows, and enterprise rights-managed documents out of the password-decryption promise unless a separate host integration is explicitly provided
- ensure decrypted files remain local and ephemeral for preview, thumbnail generation, text extraction, OCR, search indexing, and Agent workflows

## Track E: On-demand Font Coverage

## F0: Font Discovery and Diagnostics

- detect fonts referenced by Office, iWork, PDF, CAD, and other structured formats, and report whether each font was found, substituted, or cannot be rendered by the browser
- normalize font metadata across preview drivers so hosts can expose missing-font warnings and likely layout drift consistently
- distinguish document-embedded fonts, operating-system fonts, application-provided fonts, and fallback families without silently claiming exact fidelity

## F1: Optional Font Packs

- provide optional, independently loaded packs for common Latin, CJK, Emoji, and mathematical-symbol coverage instead of placing complete font collections in the core WASM or JavaScript artifacts
- subset webfonts to the glyphs needed by a document where licensing allows, prefer WOFF2 delivery, and cache packs by version and character coverage
- support region-, language-, and document-driven loading so applications pay the download and memory cost only when required
- document font licenses, CORS requirements, cache behavior, and privacy implications for self-hosted and remote font sources

## F2: Embedded and Host-provided Fonts

- extend the existing `fontResolver` contract for application-managed font files, URLs, aliases, authorization, and explicit fallback decisions
- parse supported embedded-font metadata from Office, iWork, and PDF inputs, while keeping actual font extraction and use subject to format rules and licensing
- remeasure text, line wrapping, pagination, and autofit after a required font becomes available, without blocking the first preview indefinitely

## F3: CAD Fonts

- add explicit SHX font discovery and mapping through the application font resolver
- evaluate a front-end SHX parser that can convert supported glyphs to paths when direct browser font loading is impossible
- preserve visible missing-glyph and fallback warnings whenever an exact CAD font cannot be resolved
