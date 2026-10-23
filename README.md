<div align="center">
  <img src="apps/demo/public/brand/filens-icon.svg" alt="filens logo" width="72" height="72" />
  <h1>filens</h1>
  <p><strong>Every file has a story. Open it.</strong></p>
  <p>Office, iWork, CAD, panoramas, and more — preview files right in your browser.</p>
  <p>English · <a href="README.zh-CN.md">简体中文</a></p>
  <p>
    <a href="#demo">Watch the demo</a> ·
    <a href="#quick-start">Try it locally</a> ·
    <a href="docs/support-matrix.md">Supported formats</a>
  </p>
</div>

[![Six actual filens previews: presentations, documents, spreadsheets, Keynote, CAD, and panoramas](docs/assets/readme/overview.webp)](apps/demo/public/home/filens-demo.mp4)

<p align="center"><strong>Local first · Open source · Powered by WebAssembly</strong></p>

## A closer look at your files

- **Open files on your device.** Local-file previews run in the browser, without uploading the file to a conversion service.
- **Go beyond Office.** Native PPTX and iWork previews sit alongside documents, spreadsheets, CAD, 3D, RAW, panoramas, archives, and ebooks.
- **Bring the same core to your app.** Use Vue components for the UI, or host the WASM conversion core in a CLI, desktop app, or backend.

Coverage and fidelity vary by format. See the [support matrix](docs/support-matrix.md) for current capabilities and limitations.

## Small pieces, shared capabilities

<!-- bundle-sizes:en:start -->
| Module / core | Raw | gzip | Brotli |
| --- | ---: | ---: | ---: |
| Conversion core WASM | 828.4 KiB | 376.8 KiB | **305.8 KiB** |
| Image / RAW core WASM | 655.4 KiB | 204.6 KiB | **163.1 KiB** |
| Media / panorama preview | 94.8 KiB | 26.3 KiB | **23.0 KiB** |

The two WASM cores load independently. Media preview and image conversion are measured separately. JS rows include their CSS; shared dependencies and workers are listed separately.

<details>
<summary>All modules and initial loading cost</summary>

| Module / core | Raw | gzip | Brotli |
| --- | ---: | ---: | ---: |
| Demo entry | 159.9 KiB | 44.8 KiB | **37.6 KiB** |
| Shared vendor dependencies | 1837.6 KiB | 523.8 KiB | **433.4 KiB** |
| PPTX / core runtime | 275.0 KiB | 71.3 KiB | **61.2 KiB** |
| Vue preview host | 68.6 KiB | 15.8 KiB | **14.0 KiB** |
| DOCX / XLSX / PDF | 20.9 KiB | 6.5 KiB | **5.8 KiB** |
| iWork preview | 23.8 KiB | 7.9 KiB | **7.0 KiB** |
| CAD / mind maps / diagrams | 83.1 KiB | 23.4 KiB | **19.9 KiB** |
| 3D preview | 105.8 KiB | 28.2 KiB | **24.6 KiB** |
| Archive preview | 20.2 KiB | 6.5 KiB | **5.7 KiB** |
| Text / ebooks | 18.0 KiB | 6.2 KiB | **5.4 KiB** |
| iWork worker | 882.2 KiB | 181.5 KiB | **151.9 KiB** |
| PDF worker | 1053.3 KiB | 291.1 KiB | **233.1 KiB** |
| Optional STEP / IGES WASM | 7425.8 KiB | 3038.0 KiB | **2260.8 KiB** |

Entry, preloaded JS, and CSS total **579.8 KiB Brotli** (2473.1 KiB raw / 694.5 KiB gzip), plus images, video, and samples. Modules share dependencies; these rows are not standalone per-format download totals.

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

<sub>Preview images come from filens itself. Photos: Ricardo Gomez Angel / Unsplash and SimonWaldherr / CC BY-SA 4.0. The panorama derivative, walkthrough, and animated preview are CC BY-SA 4.0. <a href="docs/assets/readme/SOURCES.md">Visual sources and credits</a>. iWork research: <a href="https://github.com/dunhamsteve/iwork">dunhamsteve/iwork</a>; CAD lineage: <a href="https://github.com/orcastor/cad2x-converter">orcastor/cad2x-converter</a>.</sub>
