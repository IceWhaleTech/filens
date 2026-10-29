<div align="center">
  <img src="apps/demo/public/brand/filens-icon.svg" alt="filens logo" width="72" height="72" />
  <h1>filens</h1>
  <p><strong>Files shine bright. Dreams take flight.</strong></p>
  <p>A pure frontend file viewer for Office, iWork, CAD, panoramas, and more. Local files stay on your device.</p>
  <p>Chinese name: 探微 · English · <a href="README.zh-CN.md">简体中文</a></p>
  <p>
    <a href="#demo">Watch the demo</a> ·
    <a href="#quick-start">Try it locally</a> ·
    <a href="docs/support-matrix.md">Supported formats</a>
  </p>
</div>

[![Eight actual filens previews: presentations, documents, spreadsheets, PDF, Keynote, CAD, 3D, and panoramas](docs/assets/readme/overview.webp)](apps/demo/public/home/filens-demo.mp4)

<p align="center"><strong>Pure frontend · WASM conversion, flexible deployment · Fast and tiny</strong></p>

---

## See more, right in your browser

| Frontend project | iWork | 360° photos / video | RAW preview | Native PPTX | CAD / 3D |
| --- | --- | --- | --- | --- | --- |
| **filens** | **✅ All three** | **✅** | **◐** | **✅** | **✅** |
| [SheetJS CE](https://docs.sheetjs.com/docs/miscellany/formats/) | ◐ Numbers | — | — | — | — |
| [Photo Sphere Viewer](https://github.com/mistic100/Photo-Sphere-Viewer) | — | ✅ | — | — | — |
| [LibRaw-Wasm](https://github.com/ybouane/LibRaw-Wasm) | — | — | ✅ | — | — |
| [vue-office](https://github.com/501351981/vue-office) | — | — | — | ✅ | — |
| [PPTist](https://github.com/pipipi-pikachu/PPTist) | — | — | — | ✅ | — |
| [Online 3D Viewer](https://github.com/kovacsv/Online3DViewer) | — | — | — | — | ✅ |

<sub>✅ Available path · ◐ Partial or conditional support · — No built-in path documented. [Format coverage and limits](docs/support-matrix.md).</sub>

**iWork, panoramas, RAW, Office, and CAD / 3D in one browser-local workspace.** The projects above specialize in different areas; filens brings these previews together.

<details>
<summary>Comparison notes and support boundaries</summary>

- Entries follow public documentation and browser-local processing paths, rather than overall project rankings. Support and fidelity vary by file.
- **iWork / PPTX:** filens previews Keynote, Pages, and Numbers natively. SheetJS extracts Numbers table data and needs an application UI. PPTist imports PPTX into its presentation model; vue-office's [PPTX core is not open source](https://github.com/501351981/pptx-preview#关于授权).
- **Panoramas:** both filens and Photo Sphere Viewer display photos and video. filens also handles supported X5 INSP originals, Insta360 / DJI calibration and distortion, original-track synchronization, and calibrated DNG stitching. Camera-original stitching is experimental and depends on metadata, companion files, and browser codecs. PSV's [generic dual-fisheye adapter](https://photo-sphere-viewer.js.org/guide/adapters/dual-fisheye.html) does not parse X5 calibration.
- **RAW:** filens prioritizes embedded JPEGs, then lightweight sensor development. LibRaw-Wasm offers full / half-size decoding and development through an API that needs an application UI. These paths have different image-quality goals.
- **CAD / 3D:** filens covers DXF, STEP, and mesh previews. Online 3D Viewer specializes in model viewing, inspection, and export, including STEP / IGES / IFC. filens STEP previews retain geometry and instance placement, but omit source colors, names, and the assembly tree.

</details>

## iWork, panoramas, and RAW

- **iWork, with a view for each format.** Open Keynote, Pages, and Numbers directly on slide, page, and sheet canvases. Layout and object fidelity vary by file. [See an actual preview](apps/demo/public/home/iwork.webp).
- **Camera-original panoramas.** Look around 360° photos and video; supported originals use lens calibration, track synchronization, and stitching to reconstruct the view. Original stitching is experimental. [Implementation and camera validation](docs/panorama-rendering-implementation.md).
- **RAW, with a faster path to a preview.** Load the image WASM on demand, extract an embedded JPEG first, and use lightweight sensor development when no preview is available. [RAW coverage](docs/support-matrix.md#camera-raw-conversion).

## Demo

**[▶ Watch the 30-second walkthrough](apps/demo/public/home/filens-demo.mp4)** — presentations, documents, spreadsheets, Keynote, CAD, a Viking helmet in 3D, and a 360° view, in one workspace.

<details>
<summary>Show an animated preview</summary>

![A short recording of filens switching between real file previews](docs/assets/readme/demo.gif)

The full recording is linked above. [Chinese captions](apps/demo/public/home/demo-zh.vtt) · [English captions](apps/demo/public/home/demo-en.vtt)

</details>

## Read documents with an Agent

Describe what to read in Chinese or English, then receive text, JSON, Markdown, HTML, YAML, XML, CSV or TSV. Get source structure and PDF/OCR coordinates for the calling Agent. Parsing, layout and document export share the WASM core; the caller performs semantic reasoning.

![Real filens CLI typing, Markdown output and source-aligned OCR geometry](docs/assets/agent-cli/terminal-demo.gif)

[Output formats, layouts and reproducible demo](docs/agent-cli-formats-and-layout.zh-CN.md) · Actual CLI excerpts; typing/response timing edited.

Explore [68 observed examples and natural-language limits](docs/agent-cli-examples.zh-CN.md) (Chinese), including OCR quality, working requests and unsupported page selection or questions.

```sh
# Full: CLI, WASM and native OCR
npm install -g filens-cli
filens 'read "report.pdf" as json'
filens 'what can you do as json'
filens 'read "report.docx" as markdown'
filens '获取 "invoice.png" 的布局，以 YAML 输出'
filens convert report.doc report.docx
filens convert data.csv --to xlsx

# Lite alternative; native OCR can be added with filens setup-ocr
npm install -g filens-cli-lite
# Temporary invocation
npx --yes filens-cli-lite capacity --json
```

The source CLI is Rust, with strip, LTO and fast gzip-compressed WASM resources.
`convert` uses the frontend conversion engines; inspect `capacity.conversionPairs`
for supported targets. A distributable [agent skill](skills/filens/SKILL.md)
covers reading, OCR, layout, evidence and conversion, with standard YAML front matter.

The npm entry packages are [`filens-cli`](https://www.npmjs.com/package/filens-cli) and [`filens-cli-lite`](https://www.npmjs.com/package/filens-cli-lite); both expose the `filens` command. Full includes native RapidOCR NCNN and models, with **no Python environment**; defaults are max side **960**, OpenMP threads **2**, orientation classification and image preprocessing. WASM supports OCR callbacks for scanned pages and embedded document images. Rebuilt Rust candidates on macOS arm64 are about **7.25 MiB** (Lite) and **30.45 MiB** (Full) installed. Model downloads support concurrent speed probes across HF / ModelScope / HF Mirror and an optional fourth route, with hash verification. See [installation, packaging and protocol](docs/agent-cli.md).

## Quick start

Requires Node.js 20+ and [Rust via rustup](https://rustup.rs/). The repository pins the Rust compiler and WASI target.

```sh
npm ci
npm run build:wasm
npm run dev --workspace @filens/demo
```

Open [the local demo](http://localhost:5173/modules/filens/?lang=en), then choose a sample or drop in your own file. The website has Chinese and English homepages.

To publish the demo, [import the repository into Vercel](docs/deploy-vercel.md). Git integration deploys pushes automatically; an optional manual GitHub Actions workflow is also included.

## What you can open today

| Files | What you can do | Current limits |
| --- | --- | --- |
| PPTX, Keynote / Pages / Numbers | Browse slides, pages, and worksheets directly. | Native parsing; layout and object fidelity vary by file. |
| DOCX, XLSX / CSV, PDF | Read documents, switch worksheets, and browse PDF pages. | Read-only previews; fonts and advanced styles may differ. |
| DOC / XLS / PPT, WPS / ET / DPS | Normalize legacy documents locally for preview. | Preview-focused conversion strips macros and does not promise full reconstruction. |
| DXF, STEP / STP, 3D models | Explore drawings, orbit solids, and zoom into meshes. | STEP loads separately on demand; geometry and instance placement are retained, while source colors, names, and the assembly tree are omitted. |
| RAW, PPM, images, and icons | View camera originals and P3 / P6, 8 / 16-bit PPM files. | RAW uses embedded JPEGs or lightweight sensor development; camera support varies. |
| 360° photos and video | Look around; stitch supported Insta360 / DJI videos in real time and calibrated DNG photos at load. | Camera stitching is experimental and depends on calibration metadata, companion files, and browser codecs. |
| Archives, ebooks, code, mind maps, and diagrams | Browse folders and chapters, read source, and explore node relationships. | See the support matrix for each format's supported subset. |

The homepage has eight actual preview captures and directly accessible STEP, RAW, PPM, and legacy Office samples. See the [panorama package](packages/panorama/README.md) for RAW and panorama integration.

## A closer look at your files

- **Pure frontend preview.** Parse and render files in the browser. Local previews require neither uploads nor a conversion server.
- **WASM conversion, flexible deployment.** Run the conversion module directly in the browser or use it independently through [CLI / HTTP tools](examples/go-wazero-converter). WASM handles file parsing and conversion; the server manages requests and files.
- **Load by format, spend less time waiting.** Format-based bundles, lazy loading, worker parsing, and page virtualization reduce download and rendering work. The document conversion WASM is **<!-- bundle-size:converter-core -->318.3<!-- /bundle-size --> KiB Brotli**; UI, shared dependencies, and other modules are measured separately in the [bundle report](docs/bundle-sizes.md).

Native PPTX and iWork previews sit alongside documents, spreadsheets, CAD, 3D, RAW, panoramas, archives, and ebooks. Coverage and fidelity vary by format. See the [support matrix](docs/support-matrix.md) for current capabilities and limitations.

## Small pieces, shared capabilities

<!-- bundle-sizes:en:start -->
| Module / core | Raw | gzip | Brotli |
| --- | ---: | ---: | ---: |
| Conversion core WASM | 872.1 KiB | 395.6 KiB | **318.3 KiB** |
| Image / RAW core WASM | 1072.2 KiB | 293.0 KiB | **210.7 KiB** |
| Media / panorama preview | 216.9 KiB | 64.1 KiB | **54.7 KiB** |
| Optional STEP WASM | 2625.8 KiB | 1020.2 KiB | **797.0 KiB** |

Document, image / RAW, and STEP WASM modules load independently on demand. Media preview and image conversion are measured separately. JS rows include their CSS; shared dependencies and workers are listed separately.

<details>
<summary>All modules and initial loading cost</summary>

| Module / core | Raw | gzip | Brotli |
| --- | ---: | ---: | ---: |
| Demo entry | 173.1 KiB | 48.9 KiB | **40.8 KiB** |
| Shared vendor dependencies | 1319.8 KiB | 369.6 KiB | **305.2 KiB** |
| PPTX / core runtime | 288.6 KiB | 76.1 KiB | **65.4 KiB** |
| Vue preview host | 69.9 KiB | 16.3 KiB | **14.4 KiB** |
| DOCX / XLSX / PDF | 32.5 KiB | 9.8 KiB | **8.8 KiB** |
| On-demand PDF engine | 435.2 KiB | 128.1 KiB | **106.9 KiB** |
| iWork preview | 26.8 KiB | 8.7 KiB | **7.7 KiB** |
| CAD / mind maps / diagrams | 90.2 KiB | 25.2 KiB | **21.6 KiB** |
| 3D preview | 133.4 KiB | 37.9 KiB | **32.9 KiB** |
| Archive preview | 24.7 KiB | 7.9 KiB | **7.0 KiB** |
| Text / ebooks | 22.9 KiB | 8.2 KiB | **7.3 KiB** |
| iWork worker | 894.1 KiB | 186.7 KiB | **156.2 KiB** |
| PDF worker | 1053.3 KiB | 291.1 KiB | **233.1 KiB** |
| STEP loader | 23.0 KiB | 9.5 KiB | **8.7 KiB** |

Entry, preloaded JS, and CSS total **499.0 KiB Brotli** (2131.8 KiB raw / 596.6 KiB gzip), plus images, video, and samples. Modules share dependencies; these rows are not standalone per-format download totals.

</details>

Measured from the demo build. Compression columns describe artifacts; actual transfer depends on hosting. [Full report and reproduction](docs/bundle-sizes.md).
<!-- bundle-sizes:en:end -->

## Measured performance

<details>
<summary>Show SOTA benchmark results</summary>

| Measured task | filens | Current peer | Speedup\* |
| --- | ---: | --- | ---: |
| 11.1 MB, 13-slide PPTX parse | **28.5 ms** | pptx-preview 1.0.7: 56.6 ms | **1.99×** |
| 11.1 MB, 13-slide PPTX first preview | **48.8 ms** | pptx-preview 1.0.7: 71.8 ms | **1.47×** |
| 3840×1920 panorama JPEG preview | **154.9 ms** | Photo Sphere Viewer 5.15.1: 205.2 ms | **1.32×** |
| 11904×5952 original X5 INSP panorama preview | **369.4 ms** | Photo Sphere Viewer 5.15.1 dual fisheye: 414.5 ms | **1.12×** |
| NEF without embedded JPEG → preview canvas | **152.7 ms** | LibRaw-Wasm 1.6.0 half-size: 326.7 ms | **2.14×** |
| DNG without embedded JPEG → preview canvas | **167.7 ms** | LibRaw-Wasm 1.6.0 fast half-size: 314.4 ms | **1.87×** |
| STEP geometry import: cube | **46.5 ms** | occt-import-js 0.0.23: 67.6 ms | 1.45× |
| XLSX data read (80,000 cells) | **42.3 ms** | SheetJS CE 0.20.3: 109.6 ms | 2.59× |
| XLS → XLSX preview conversion (6 sheets) | **12.3 ms** | x2t WASM v9.3.2+3: 49.1 ms | 4.00× |
| 20,000×8 numeric CSV → XLSX | **137.6 ms** | x2t WASM v9.3.2+3: 198.8 ms | 1.44× |

**Stable leads against specialized frontend libraries.** At least seven runs per configuration, with 21 for the X5 original; sensor development and preview drawing on five RAW inputs without embedded JPEGs are **1.11–2.14×** faster than the measured LibRaw paths.

<sub>\* Limited to this machine, measured inputs and listed peers, supported by paired bootstrap 95% intervals; downloads and library cold loading excluded. Apple M4 Pro / Chromium 147; **panoramas use SwiftShader software rendering**. On the X5 original, PSV's generic dual-fisheye projection visibly repeats scene content across hard seams; filens has lighter, localized ghosting. The speed label covers readable previews of this original. RAW measures development and drawing to a common canvas with different intermediate sizes; STEP targets geometry previews; XLSX compares data reading; XLS compares the main displayed content in the same viewer. [Full results, scope and reproduction](docs/performance-comparison.md).</sub>

</details>

<details>
<summary>Measurement scope</summary>

<sub>RAW inputs have embedded JPEGs removed and unchanged sensor data. Both LibRaw half-size configurations draw to the same 1280×800 canvas; intermediate resolution, tone and crop differ slightly. Timing includes development, output decode/transfer and drawing. The full Numbers model and several small PPTX first previews still have room to improve; see the [full results and preview comparisons](docs/performance-comparison.md).</sub>

</details>

## Build with filens

| Looking for… | Start here |
| --- | --- |
| Vue preview components | [Vue integration](packages/vue/README.md) |
| Format coverage and limits | [Support matrix](docs/support-matrix.md) |
| Architecture, comparisons, and performance notes | [Project overview](docs/project-overview.md) |
| Frontend timings, scoped leads, and raw data | [Frontend performance comparison](docs/performance-comparison.md) |
| Full-text extraction / injectable OCR | [Optional Go host and text WASM](converter/README.md) |
| Agent document reading / capacity / local OCR | [Agent CLI](docs/agent-cli.md) |
| CLI / backend integration | [Go + wazero example](examples/go-wazero-converter/README.md) |
| Deployment | [Vercel guide](docs/deploy-vercel.md) |

Try your everyday files and [report a reproducible issue](https://github.com/IceWhaleTech/filens/issues/new/choose). Upcoming work is tracked in the [roadmap](docs/roadmap.md).

<sub>Preview images come from filens itself. Photos: Carsten / CC BY 2.0 (cropped and pale-blue graded) and Greg Zaal / Poly Haven / CC0. The overview, walkthrough, and animated preview are CC BY-SA 4.0. <a href="docs/assets/readme/SOURCES.md">Visual sources and credits</a>. iWork research: <a href="https://github.com/dunhamsteve/iwork">dunhamsteve/iwork</a>; CAD lineage: <a href="https://github.com/orcastor/cad2x-converter">orcastor/cad2x-converter</a>.</sub>

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=IceWhaleTech/filens&type=Date)](https://star-history.com/#IceWhaleTech/filens&Date)

<p align="center">
  <a href="https://www.zimaspace.com/en/zimaos?utm_source=github&amp;utm_medium=referral&amp;utm_campaign=filens_zimaos&amp;utm_content=readme_banner_en"><img src="docs/assets/readme/zimaos-banner.en.png" alt="ZimaOS. Your personal cloud, made simple. Deep FiLens integration, file management, RAW / 360° viewing, backup, and 800+ apps. Explore ZimaOS." width="640" /></a>
</p>
