<div align="center">
  <img src="apps/demo/public/brand/filens-icon.svg" alt="filens logo" width="72" height="72" />
  <h1>filens</h1>
  <p><strong>Files shine bright. Dreams take flight.</strong></p>
  <p>A pure frontend file viewer for Office, iWork, CAD, panoramas, and more. Local files stay on your device.</p>
  <p>English · <a href="README.zh-CN.md">简体中文</a></p>
  <p>
    <a href="#demo">Watch the demo</a> ·
    <a href="#quick-start">Try it locally</a> ·
    <a href="docs/support-matrix.md">Supported formats</a>
  </p>
</div>

[![Eight actual filens previews: presentations, documents, spreadsheets, PDF, Keynote, CAD, 3D, and panoramas](docs/assets/readme/overview.webp)](apps/demo/public/home/filens-demo.mp4)

<p align="center"><strong>Pure frontend · Shared WASM conversion core · Fast and tiny</strong></p>

## A closer look at your files

- **Pure frontend preview.** Parse and render files in the browser. Local previews require neither uploads nor a conversion server.
- **One WASM conversion core, browser and backend.** The browser and [backend CLI / HTTP tools](examples/go-wazero-converter) reuse the same conversion core. The backend handles hosting and requests; conversion logic stays in WASM.
- **Load by format, spend less time waiting.** Format-based bundles, lazy loading, worker parsing, and page virtualization reduce download and rendering work. The document conversion WASM is **<!-- bundle-size:converter-core -->317.6<!-- /bundle-size --> KiB Brotli**; UI, shared dependencies, and other modules are measured separately in the [bundle report](docs/bundle-sizes.md).

Native PPTX and iWork previews sit alongside documents, spreadsheets, CAD, 3D, RAW, panoramas, archives, and ebooks. Coverage and fidelity vary by format. See the [support matrix](docs/support-matrix.md) for current capabilities and limitations.

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

## Small pieces, shared capabilities

<!-- bundle-sizes:en:start -->
| Module / core | Raw | gzip | Brotli |
| --- | ---: | ---: | ---: |
| Conversion core WASM | 871.0 KiB | 395.0 KiB | **317.6 KiB** |
| Image / RAW core WASM | 678.5 KiB | 217.5 KiB | **172.0 KiB** |
| Media / panorama preview | 208.7 KiB | 61.7 KiB | **52.6 KiB** |
| Optional STEP WASM | 2625.8 KiB | 1020.2 KiB | **797.0 KiB** |

Document, image / RAW, and STEP WASM modules load independently on demand. Media preview and image conversion are measured separately. JS rows include their CSS; shared dependencies and workers are listed separately.

<details>
<summary>All modules and initial loading cost</summary>

| Module / core | Raw | gzip | Brotli |
| --- | ---: | ---: | ---: |
| Demo entry | 173.4 KiB | 49.0 KiB | **41.0 KiB** |
| Shared vendor dependencies | 1775.2 KiB | 502.1 KiB | **414.8 KiB** |
| PPTX / core runtime | 275.2 KiB | 71.4 KiB | **61.3 KiB** |
| Vue preview host | 68.7 KiB | 15.8 KiB | **14.0 KiB** |
| DOCX / XLSX / PDF | 20.9 KiB | 6.5 KiB | **5.8 KiB** |
| iWork preview | 23.8 KiB | 7.9 KiB | **7.0 KiB** |
| CAD / mind maps / diagrams | 83.1 KiB | 23.4 KiB | **19.9 KiB** |
| 3D preview | 105.7 KiB | 28.1 KiB | **24.5 KiB** |
| Archive preview | 20.2 KiB | 6.5 KiB | **5.7 KiB** |
| Text / ebooks | 18.0 KiB | 6.2 KiB | **5.4 KiB** |
| iWork worker | 882.2 KiB | 181.5 KiB | **151.9 KiB** |
| PDF worker | 1053.3 KiB | 291.1 KiB | **233.1 KiB** |
| STEP loader | 23.0 KiB | 9.5 KiB | **8.7 KiB** |

Entry, preloaded JS, and CSS total **594.2 KiB Brotli** (2538.1 KiB raw / 712.4 KiB gzip), plus images, video, and samples. Modules share dependencies; these rows are not standalone per-format download totals.

</details>

Measured from the demo build. Compression columns describe artifacts; actual transfer depends on hosting. [Full report and reproduction](docs/bundle-sizes.md).
<!-- bundle-sizes:en:end -->

## Demo

**[▶ Watch the 30-second walkthrough](apps/demo/public/home/filens-demo.mp4)** — presentations, documents, spreadsheets, Keynote, CAD, and a 360° view, in one workspace.

<details>
<summary>Show an animated preview</summary>

![A short recording of filens switching between real file previews](docs/assets/readme/demo.gif)

The full recording is linked above. [Chinese captions](apps/demo/public/home/demo-zh.vtt) · [English captions](apps/demo/public/home/demo-en.vtt)

</details>

## Quick start

Requires Node.js 20+ and [Rust via rustup](https://rustup.rs/). The repository pins the Rust compiler and WASI target.

```sh
npm ci
npm run build:wasm
npm run dev --workspace @filens/demo
```

Open [the local demo](http://localhost:5173/modules/filens/?lang=en), then choose a sample or drop in your own file. The website has Chinese and English homepages.

To publish the demo, [import the repository into Vercel](docs/deploy-vercel.md). Git integration deploys pushes automatically; an optional manual GitHub Actions workflow is also included.

## Build with filens

| Looking for… | Start here |
| --- | --- |
| Vue preview components | [Vue integration](packages/vue/README.md) |
| Format coverage and limits | [Support matrix](docs/support-matrix.md) |
| Architecture, comparisons, and performance notes | [Project overview](docs/project-overview.md) |
| CLI / backend integration | [Go + wazero example](examples/go-wazero-converter/README.md) |
| Deployment | [Vercel guide](docs/deploy-vercel.md) |

Try your everyday files and [report a reproducible issue](https://github.com/IceWhaleTech/filens/issues/new/choose). Upcoming work is tracked in the [roadmap](docs/roadmap.md).

<sub>Preview images come from filens itself. Photos: Carsten / CC BY 2.0 (cropped and pale-blue graded) and Greg Zaal / Poly Haven / CC0. The overview, walkthrough, and animated preview are CC BY-SA 4.0. <a href="docs/assets/readme/SOURCES.md">Visual sources and credits</a>. iWork research: <a href="https://github.com/dunhamsteve/iwork">dunhamsteve/iwork</a>; CAD lineage: <a href="https://github.com/orcastor/cad2x-converter">orcastor/cad2x-converter</a>.</sub>
