# filens

English | [简体中文](README.zh-CN.md)

**Universal file inspection and rendering runtime for Web, WASM and AI Agents.**

filens is an open-source file inspection and rendering library that brings support for a wide range of modern, legacy, and specialized file formats to the browser and other sandboxed environments.

It provides a unified interface for **previewing, parsing, rendering, extracting, and converting files** into practical representations such as images, text, metadata, and structured content.

filens currently covers five major categories:

- **Documents** - Office, PDF, plain text, WPS, iWork and other document formats
- **Media** - Images, video and other common multimedia formats
- **Archives** - Compressed archives, packages and executable formats
- **Design** - CAD, STL, 3D-printing and other engineering/design formats
- **Legacy** - Older and less-common formats that are difficult to handle with modern web-native tools

The WASM runtime makes filens suitable for **local-first and privacy-sensitive applications**, allowing files to be inspected and rendered without necessarily uploading them to a remote service.

filens can also expose an external **OCR callback**, allowing image-based documents and scanned content to be converted into searchable text while keeping the OCR engine independent from the core runtime.

## Current Global File Processing Landscape

No file conversion engine simultaneously provides the smallest footprint, the highest Office fidelity, direct browser execution, and complete format coverage. Real deployments usually choose between native x2t, a trimmed native service, x2t WebAssembly, and a lightweight local-first runtime such as filens.

| Solution | Delivery size | Execution and capability focus | Best fit |
| --- | ---: | --- | --- |
| Full native ONLYOFFICE x2t with fonts | About **560+ MB** compressed | Native execution and broader Office conversion fidelity; the highest font, resource, and process deployment cost | High-fidelity server conversion and batch processing |
| Trimmed ZimaOS x2t | About **138 MB** | Retains the native x2t path while removing fonts and components that are unnecessary for its controlled workload | NAS appliances, private deployments, and controlled format sets |
| [`onlyoffice-x2t-wasm`](https://github.com/cryptpad/onlyoffice-x2t-wasm/releases/tag/v9.3.0%2B0) `v9.3.0+0` | Release ZIP **15.79 MiB**; `x2t.wasm` **34.32 MiB**, Brotli **6.49 MiB** | A higher-fidelity browser candidate using Emscripten JS glue, with noticeably higher initialization and memory costs than a lightweight WASI core | In-browser Office conversion without a server |
| **filens converter-core** | `converter-core.wasm` **0.685 MiB**; gzip **0.313 MiB**; Brotli **0.252 MiB** | Pure WASI for browser or wazero execution, optimized for fast parsing, structured extraction, previewing, and safe fallback | Web previews, indexing, Agent file understanding, and edge devices |

Using the current artifacts, the raw filens WASM is about **50x smaller** than x2t-wasm, and its Brotli transfer size is about **25.7x smaller**. Compared with the 138 MB ZimaOS package and the 560+ MB full native package, the filens core is about **202x** and **818x** smaller respectively. These numbers describe deployment cost rather than equivalent capability: native packages commonly include fonts and other resources, while neither filens nor x2t-wasm includes a complete font bundle.

### Local Performance Snapshot

The following results were measured over five runs on the same Windows 10 / Xeon E5-2696 v4 / Node.js 20.20 / Go 1.24 machine using the same small DOC, XLS, and PPT samples from this repository. The x2t-wasm run did not load additional fonts. These figures show startup and execution scale only; they are not universal benchmarks for complex documents or other hardware.

| Metric | filens WASI core | x2t-wasm `v9.3.0+0` |
| --- | ---: | ---: |
| DOC -> DOCX core conversion | **1 ms** | Median **145.7 ms** |
| XLS -> XLSX core conversion | **1 ms** | Median **51.8 ms** |
| PPT -> PPTX core conversion | **1 ms** | Median **103.9 ms** |
| Cold initialization | Not isolated; wazero caches the compiled module | Median **292.3 ms** |
| RSS increase after initialization | Not measured separately | About **121-124 MiB** |

filens is faster because it targets a lighter job: its current conversion core is designed for previews, indexing, and content extraction, and does not promise complete reconstruction of Office layout, charts, animations, embedded objects, or formula calculation. x2t and x2t-wasm are heavier because they target higher Office conversion fidelity. Therefore, **use filens as the default lightweight path and load or deploy x2t only when high-fidelity Office conversion is actually required**.

Reproduce the size data with `npm run report:wasm-sizes`. The current WASM smoke suite passes **294/294** jobs, and the conversion policy check covers **1,631** assertions. See [`docs/x2t-wasm-evaluation.md`](docs/x2t-wasm-evaluation.md) for the x2t-wasm integration boundary and audit procedure.

## From Preview to Agent

filens is designed as more than a file viewer.

Its goal is to provide a common **file understanding layer** between applications and the underlying collection of file formats.

```text
                     filens
                        |
        +---------------+---------------+
        |               |               |
      Parse           Render          Extract
        |               |               |
     Metadata       Image Preview      Text
        |               |               |
        +---------------+---------------+
                        |
                    OCR / Convert
                        |
                  +-----+-----+
                  |           |
                 Web         Agent
                 WASM         CLI
```

The same capabilities can eventually be exposed through a CLI, making filens directly usable as a **file inspection tool for AI Agents**:

```bash
filens inspect document.docx
filens render drawing.dwg
filens extract archive.zip
filens convert legacy.doc --to text
filens ocr scanned.jpg
```

Instead of requiring every application or Agent to understand hundreds of individual file formats, filens provides a single, consistent interface for interacting with them.

**See the file. Understand the file. Work with the file.**

filens is the lens between applications and the world's files.
