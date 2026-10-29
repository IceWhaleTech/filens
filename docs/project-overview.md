# filens: architecture and comparisons

English | [简体中文](project-overview.zh-CN.md)

**File Lens for people. File Native Services for applications and Agents.**

`filens` has two complementary meanings:

- **File Lens**: see, inspect, and understand a file without first sending it to a server.
- **File Native Services**: reusable, format-native capabilities for previews, extraction, conversion, search, and Agent workflows.

filens is an open-source, local-first file understanding runtime built around WebAssembly. It brings modern, legacy, and specialized formats into browsers, desktop and mobile clients, CLI tools, edge runtimes, backend services, and AI Agent workflows. Any host that can integrate a compatible WASM/WASI runtime can reuse the same core capabilities.

## Three Product Goals

### 1. Client-native preview

Parse and render files directly on the user's device whenever possible. This keeps preview latency low, makes features deployable as small on-demand modules, supports serverless products, protects private files, and avoids consuming server-side compute for supported native routes. Client-native execution is the preferred preview path, not a runtime restriction: desktop applications, mobile applications, CLI tools, edge nodes, and backend services can host the same WASM core when their product architecture requires it.

The current preview families include:

- **Documents**: PPTX, DOCX, XLSX/CSV, PDF, Keynote, Pages, Numbers, WPS, and legacy Office inputs through optional normalization
- **Media**: common images, audio/video, Live Photos, 360-degree panoramas, camera RAW, and icon formats
- **Archives and books**: ZIP/TAR/GZIP packages, EPUB, and CBZ
- **Design and structured files**: DXF, STEP/STP, many 3D/model formats, mind maps, and diagrams
- **Text and code**: plain text, source code, markup, configuration, logs, and other extractable content

See the [support matrix](support-matrix.md) for the practical coverage and known fidelity limits of each family.

### 2. Focused conversion through WASM

The same conversion core can run in a browser, desktop or mobile client, CLI, edge worker, or backend service through a compatible WASM/WASI host. filens is not intended to become a general-purpose office-format conversion suite:

- outside internal preview normalization, the general conversion surface deliberately supports only **text** and **image/icon** targets for previews, thumbnails, and full-text indexing;
- OCR is an optional application-provided component, so scanned files can become searchable without coupling the core to one OCR vendor;
- legacy Office/WPS to OpenXML exists as a narrow, preview-oriented normalization path, not as a promise of full-fidelity office reconstruction.

All parsing and conversion algorithms live in the front-end WebAssembly conversion core. Go wrappers only provide CLI/HTTP plumbing, validation, temporary-file handling, result mapping, output validation, and WASM invocation. Browser, desktop/mobile, CLI, edge, and backend hosts therefore reuse the same conversion implementation instead of maintaining separate format-specific engines.

### 3. An Agent-facing CLI

The Agent CLI now reads documents, discovers capabilities and supplies structured evidence to a calling Agent. Chinese/English intents support plain text or JSON output, with commands and flags as optional entry points. Lite ships the CLI and WASM; Full includes native RapidOCR NCNN (no Python, max side 960, OpenMP threads = 2) and model downloads with concurrent mirror speed probes:

```bash
filens 'what can you do as json'
filens 'read "document.docx" as text'
filens 'understand "report.pages" as json'
```

Parsing, reading order and evidence spans live in the shared WASM core; summarization and question answering belong to the calling Agent. Rendering, thumbnails and archive reading remain future CLI work. [Setup and protocol](agent-cli.md).

## What Makes filens Different

- **Tiny legacy Office/WPS normalization**: DOC/WPS and related legacy inputs can be normalized to OpenXML by a preview-focused WASM core. The current `converter-core.wasm` is **871.0 KiB raw and 317.6 KiB Brotli**.
- **Native PPTX preview**: presentations are parsed directly and rendered with HTML/SVG, including text, images, shapes, tables, and supported 2D column and pie charts. Local decks need no upload or conversion service; the same viewer also opens iWork, CAD, RAW, and panorama originals.
- **Native iWork parsing and preview**: Keynote, Pages, and Numbers are decoded on the client, including current iWork protocol structures. Earlier protocol research and code are credited to [`dunhamsteve/iwork`](https://github.com/dunhamsteve/iwork), on which part of this work builds.
- **Browser-native CAD with an open-source lineage**: the CAD conversion work is derived from [`orcastor/cad2x-converter`](https://github.com/orcastor/cad2x-converter), a compact DXF/DWG-to-DXF/PDF/PNG/SVG tool. filens adds a direct pure-browser DXF parsing and SVG rendering path for supported drawings, so common previews need no native process or conversion server.
- **Long-tail visual formats**: the same preview host covers calibrated panorama formats, a broad camera RAW set, STEP/STP, and many mesh, scene, point-cloud, voxel, molecule, motion, and volume formats.
- **One portable, local-first architecture**: direct renderers and on-demand WASM modules share a common runtime. They can stay entirely on the user's device or run inside a controlled CLI, edge, or backend host without introducing another conversion engine.

## Architecture

```text
                              filens
                                 |
              +------------------+------------------+
              |                                     |
       Native preview                       WASM conversion core
       adapters/renderers                normalize / extract / render
              |                                     |
              +------------------+------------------+
                                 |
                 text / image / metadata / scene
                                 |
          +--------------+-------------+-------------+
          |              |             |             |
     Web/desktop      Mobile/CLI    Server/edge    AI Agent
```

Modules are loaded only when their format family needs them. For example, the separate `converter-image.wasm` is used for RAW/ICNS conversion and is not part of the Office path.

Interactive preview adapters use the UI capabilities of their host where available, while portable parsing and conversion stay in the shared WASM/WASI core. A backend host does not need a browser; it can request text, images, icons, metadata, or normalized preview output directly from the same core.

## Document Preview Context

> This comparison is limited to the **document preview and preview-oriented document normalization** part of filens. It does not compare the project's panorama, RAW, archive, CAD, 3D/model, diagram, or Agent capabilities.

No document engine simultaneously provides the smallest footprint, the highest Office fidelity, direct browser execution, and complete format coverage. Real deployments choose different paths based on fidelity, startup cost, privacy, and operating environment.

### Architecture and operational trade-offs

Memory and latency entries below describe the typical architecture, not a vendor benchmark. Exact usage depends on document complexity, fonts, worker-pool configuration, caching, browser, and hardware. For SaaS products, provider-side memory is not publicly observable; “time” therefore describes the work on the first-preview path. Only the later local snapshot contains directly measured numbers.

| Route | Execution and data path | Privacy | Server / client memory | First-preview efficiency and time path | Typical fit |
| --- | --- | --- | --- | --- | --- |
| **filens local/client WASM** | A browser, desktop app, mobile app, WebView, or local CLI reads, parses, normalizes, and renders on the device | File stays on device by default; no preview upload is required | Server **near zero**; the client loads only the required parser/WASM and document model | Local read -> parse -> render; no upload, remote queue, or result download. Usually the shortest fixed path, with time determined mainly by file complexity and the user's device | Privacy-sensitive previews, desktop/mobile products, NAS, offline-capable and serverless products |
| **filens hosted/edge WASM** | A backend, edge node, function, or private service invokes the same WASM core through a thin host | Depends on deployment: files enter the chosen service boundary, but no third-party conversion provider is required | Server **low to moderate and workload-dependent**; no resident Office suite is required, and modules can load on demand | Upload/request -> WASM execution -> result delivery. Network remains on the path, but the conversion worker is compact and can fit CLI, function, edge, or conventional service deployments | Centralized APIs, batch extraction, indexing, thumbnails, Agents, and clients that cannot run WASM locally |
| [LibreOffice](https://www.libreoffice.org/) headless | Application server uploads the file to a `soffice --headless` worker and commonly converts it to PDF/HTML/images | Can remain inside self-hosted infrastructure, but the file still leaves the browser/device | Server **medium to high**: resident Office process plus per-document memory; concurrency normally adds isolated workers. Client memory is low | Upload -> queue -> start/reuse worker -> convert -> download preview. Cold starts, fonts, large documents, and process recycling add latency; warm pools and result caches improve repeat access | General self-hosted Office/PDF conversion with broad format support |
| [Apache OpenOffice](https://www.openoffice.org/) headless/UNO | Similar server-side Office process, commonly controlled through CLI or a long-running UNO listener | Self-hosted, but requires server-side access to the source file | Server **medium to high** per process; parallel jobs need queueing or worker isolation. Client memory is low | Same multi-stage network and conversion path as LibreOffice; long-lived listeners reduce startup time but increase resident memory and operational complexity | Existing legacy deployments and controlled document sets |
| Native ONLYOFFICE x2t / trimmed service | File is uploaded to a native converter service and returned as a normalized document or rendered result | Self-hosting keeps data within the operator's infrastructure; not client-local | Server **medium to high**: converter, fonts, resources, and concurrent jobs. Client memory is low | Upload -> queue -> native conversion -> result download. Warm services can be efficient, but network, queueing, and conversion remain on the critical path | Higher-fidelity Office conversion, centralized batch processing |
| [`onlyoffice-x2t-wasm`](https://github.com/cryptpad/onlyoffice-x2t-wasm) | Browser downloads and initializes a larger Emscripten WASM runtime, then converts locally | File can stay on device | Server **near zero**; client memory is relatively high. The local snapshot below measured about **121-124 MiB** RSS growth after initialization | No upload queue, but the runtime download and cold initialization are material; caching helps later conversions | Local Office conversion when higher fidelity matters more than footprint |
| [Microsoft 365 for the web](https://www.microsoft.com/en-us/microsoft-365/free-office-online-for-the-web) | Documents are stored/shared through OneDrive or SharePoint and rendered by Microsoft's cloud service | Data enters the Microsoft 365 tenant/cloud boundary and requires account, policy, and network review | Local server **zero**; provider memory is opaque; browser memory is moderate | Authentication + network + cloud-file access/upload + service rendering. Often convenient and high fidelity, but first preview depends on connectivity and cloud response time | Microsoft ecosystem, collaboration, and Office fidelity |
| [Yozo Office / DCS](https://www.yozodcs.com/) online preview | Public-cloud API converts remotely to HTML/images; private editions run the same class of service on enterprise servers | Public cloud sends the file to the provider; private deployment keeps it inside enterprise infrastructure, but still uses server conversion | Public-cloud server memory is opaque; private deployment requires converter capacity, clustering, and per-job memory. Client memory is low | Public cloud adds upload/API/conversion/download time; private deployment removes the public-network hop but retains queue and conversion time | Chinese Office/WPS ecosystems, domestic deployment, HTML/image preview integration |

The practical privacy distinction is not simply “cloud” versus “open source”: LibreOffice, OpenOffice, x2t, hosted filens, and a private Yozo DCS deployment can keep files inside infrastructure you control, but they still introduce a server boundary. The filens local/client route and x2t-wasm can keep the complete preview/conversion path on the end user's device. filens can use either model because its WASM core is portable across hosts.

References for the architecture descriptions: [LibreOffice command-line parameters](https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html) document headless conversion; [Gotenberg's LibreOffice configuration](https://gotenberg.dev/docs/configuration#libreoffice) documents the single-instance lock and request queue; Microsoft states that Microsoft 365 web files are saved and shared from OneDrive; Yozo DCS documents both public-cloud and private editions and HTML/image output.

### Estimated first-preview time for a 10 MB PPTX

The latest [frontend performance comparison](performance-comparison.md) measures the optimized build against current specialist browser projects: 45.3 ms to parse this PPTX and 69.3 ms to its first preview. It includes the full corpus, confidence intervals, failures and reproducible raw data. The capacity-planning figures below retain an earlier build's measurements; they are historical, not the current frontend ranking.

The table below is a capacity-planning model, not a universal benchmark. The workload is represented by the repository's `vue-office-test.pptx`: **11,122,759 bytes, 13 slides, and 8 media files**. “First preview” means the viewer is already open and timing starts when the file is selected; filens stops when slide 1 is visible, while server converters usually must finish producing a normalized document, PDF, HTML, or image result first.

| Route | Estimated time to first visible page/slide | Memory planning signal | Basis and confidence |
| --- | ---: | --- | --- |
| **filens native PPTX** | **91.7 ms measured median** on Apple M4 Pro; **347.9 ms** with 4x CPU throttling; use **0.1-0.8 s** as a modern-desktop planning range | **~25 MiB measured JS heap increase** for this file; total browser RSS is higher and browser-dependent | 7 fresh Chromium 147 contexts: 90.3-99.3 ms. CPU-throttled medians: 173.4 ms at 2x, 347.9 ms at 4x, 510.4 ms at 6x. High confidence for this sample, not all PPTX files |
| **LibreOffice headless** | Budget **2-8 s warm** or **5-15 s cold** on a typical server; queueing can add unbounded wait under load | Engineering budget **200-600 MiB per active worker**, then verify with production fonts and files | Public architecture is clear, but no standardized 10 MB PPTX benchmark exists. [Gotenberg](https://gotenberg.dev/docs/configuration#libreoffice) confirms one stateful LibreOffice instance cannot run conversions in parallel and queues requests. Low-to-medium confidence |
| **Apache OpenOffice headless/UNO** | Budget **3-10 s warm** or **6-20 s cold** | Engineering budget **200-600 MiB per active worker** | Similar full Office-process path to LibreOffice, usually deployed as a long-running UNO listener. Low confidence; measure if this remains a candidate |
| **x2t-wasm** | Budget **1-5 s** after the module is available; add download time on first use | **~121-124 MiB measured RSS growth after initialization**, plus input/output and document state | Repository small-file measurements show 292.3 ms median initialization and 51.8-145.7 ms conversion; the 10 MB range is an extrapolation, not a direct result. Medium-low confidence |
| **Microsoft 365 for the web** | If already in OneDrive/SharePoint: budget **1-5 s**. For a new local 10 MB file: about **2-7 s at 100 Mbps**, **7-20 s at 20 Mbps**, or **12-30 s at 10 Mbps** | Provider-side memory is opaque; browser memory is moderate | Network/authentication/cloud-render planning estimate. The **10-20 Mbps** cases are the more relevant baseline for many Chinese residential uplinks. Microsoft documents that web files are saved/shared from OneDrive. Low confidence because service load and tenant location are outside application control |
| **Yozo DCS public cloud** | Budget **3-10 s at 100 Mbps**, **7-22 s at 20 Mbps**, or **12-32 s at 10 Mbps** | Provider-side memory is opaque | Upload + API + conversion + result-fetch estimate based on the documented public-cloud architecture. The lower uplink rates are the practical planning case for many Chinese residential users. Low confidence until tested against the same fixture |
| **Yozo DCS private deployment** | Budget **2-8 s** on a warm LAN without queueing | Treat as a server conversion worker; use **200-600 MiB per active worker** only as an initial capacity placeholder | Removes the public Internet hop but retains upload, queue, full conversion, and result delivery. Low confidence until measured on the purchased deployment |

For a newly selected 10 MiB local file, upload time alone is approximately `84 / effective uplink Mbps` seconds: about **1.0-1.3 s at 100 Mbps**, **5-6 s at 20 Mbps**, or **10-12 s at 10 Mbps** after normal protocol and throughput overhead. Chinese residential broadband is commonly advertised by download speed while providing only about **10-20 Mbps upload**, so **5-12 seconds of upload time alone** is the more realistic consumer planning baseline. This upload term applies to any hosted route, including hosted filens, x2t, LibreOffice/OpenOffice, Microsoft 365, and public-cloud DCS, unless the file is already inside the service boundary. If a cloud file is already stored and cached, remove the upload term; if a server-generated preview is cached, repeat views may be well below one second regardless of the original converter.

The filens figures were measured locally on macOS/Darwin arm64, Apple M4 Pro, 24 GiB RAM, Node.js 20.20, and headless Chromium 147. The other ranges combine documented execution architecture, public operational guidance, network-transfer math. They should be replaced with same-file measurements before making procurement or capacity commitments.

### Representative deployment sizes

The following sizes compare representative converter artifacts and packages. They do not include an equivalent format/fidelity promise.

| Solution | Delivery size | Approach | Best fit |
| --- | ---: | --- | --- |
| Full native ONLYOFFICE x2t with fonts | About **560+ MB** compressed | Native process with broad Office conversion coverage and higher layout fidelity; also the highest font, resource, and deployment cost | High-fidelity server conversion and batch processing |
| [`onlyoffice-x2t-wasm`](https://github.com/cryptpad/onlyoffice-x2t-wasm/releases/tag/v9.3.0%2B0) `v9.3.0+0` | Release ZIP **15.79 MiB**; `x2t.wasm` **34.32 MiB**, Brotli **6.49 MiB** | A higher-fidelity browser candidate using Emscripten glue, with higher initialization and memory costs than a lightweight WASI core | In-browser Office conversion without a server |
| **filens converter-core** | `converter-core.wasm` **871.0 KiB**; gzip **395.0 KiB**; Brotli **317.6 KiB** | Pure WASI for browser or wazero execution; optimized for preview normalization, structured extraction, and safe fallback | Local previews, indexing, Agent file understanding, and edge devices |
| **filens converter-image** | Optional `converter-image.wasm` **909.3 KiB**; gzip **281.9 KiB**; Brotli **204.1 KiB** | Loaded only for RAW/ICNS image conversion | Camera RAW thumbnails and ICNS previews |

The x2t-wasm artifact is about **40×** the size of the current filens core, or **21×** with Brotli. These figures describe deployment cost, not equivalent capability: filens deliberately targets a lighter preview and extraction job, while x2t targets broader Office reconstruction fidelity.

iWork is a separate gap in the document ecosystem. Traditionally, applications have had to rely on native macOS/iOS document components or iCloud-based online conversion. ONLYOFFICE has more recently added iWork conversion, but compatibility with current iWork files and rendering fidelity remain limited. filens instead follows a direct, client-native parser and renderer path for modern Keynote, Pages, and Numbers files.

### Local performance snapshot

The following results were measured over five runs on the same Windows 10 / Xeon E5-2696 v4 / Node.js 20.20 / Go 1.24 machine, using the same small DOC, XLS, and PPT samples from this repository. The x2t-wasm run did not load additional fonts. These figures show startup and execution scale only; they are not universal benchmarks for complex documents or other hardware.

| Metric | filens WASI core | x2t-wasm `v9.3.0+0` |
| --- | ---: | ---: |
| DOC -> DOCX core conversion | **1 ms** | Median **145.7 ms** |
| XLS -> XLSX core conversion | **1 ms** | Median **51.8 ms** |
| PPT -> PPTX core conversion | **1 ms** | Median **103.9 ms** |
| Cold initialization | Not isolated; wazero caches the compiled module | Median **292.3 ms** |
| RSS increase after initialization | Not measured separately | About **121-124 MiB** |

filens does not promise complete reconstruction of Office layout, charts, animations, embedded objects, or formula calculation. Use it as the lightweight local path for preview, indexing, and extraction; load or deploy a heavier engine when production-grade Office conversion fidelity is the primary requirement.

Reproduce the size data with `npm run report:wasm-sizes`; current production sizes are in the [bundle report](bundle-sizes.md). This historical snapshot recorded **295/295** WASM smoke jobs and **1,637** conversion policy assertions. See the [x2t-wasm evaluation](x2t-wasm-evaluation.md) for the audit procedure and integration boundary.

## Roadmap

- **Search-to-source positioning**: take a text or semantic search result back to the exact page, slide, sheet, scene node, or document element.
- **Advanced video preview**: add HLS and other streaming inputs, optional transcoding, richer timeline metadata, and stronger panorama-video handling.
- **Encrypted documents**: detect and decrypt password-protected Office/WPS and PDF files in the shared WASM core, whether it is embedded in a local client, CLI, edge runtime, or controlled backend. Credentials must come from a safe host UI, hidden prompt, or secret provider and must not leak into arguments, URLs, logs, analytics, or results. Local deployments can keep both passwords and source files on device; hosted deployments keep them inside the selected service boundary. DRM and enterprise rights-managed files remain a separate problem.
- **On-demand fonts**: add broader Latin, CJK, Emoji, mathematical-symbol, and CAD SHX coverage with font detection, substitution diagnostics, subsetting, caching, and application-provided font resolution, without bundling complete font collections into the core artifacts.
- **Agent CLI**: stabilize inspection, extraction, rendering, thumbnail, OCR-hook, and structured file-understanding commands.
- **Preview fidelity**: continue improving PPTX and current-generation iWork compatibility while keeping unsupported content explicit through warnings.

See the detailed [roadmap](roadmap.md) for implementation-level work.

## Try It and Help Test

Real-world files are the most valuable compatibility tests. Please try documents, presentations, iWork files, CAD drawings, panoramas, RAW photos, archives, and 3D models from your own workflows, then record anything that is missing, misplaced, slow, or impossible to open.

- Read the [plain-language introduction and testing guide](filens-introduction.zh-CN.md).
- Report reproducible problems through [GitHub Issues](https://github.com/IceWhaleTech/filens/issues/new/choose).
- Remove sensitive content before attaching files; if a sample cannot be shared, provide its format, producing application/version, screenshots, warnings, and the smallest reproducible description.

## Development

```bash
npm install
npm run build
npm run dev --workspace @filens/demo
```

Useful references:

- [Deploy to Vercel](deploy-vercel.md)
- [Support matrix](support-matrix.md)
- [Core PPTX runtime](../packages/core/README.md)
- [Native iWork runtime](../packages/iwork/README.md)
- [Browser-native CAD runtime and attribution](../packages/cad/README.md)
- [Go/wazero WASM host example](../examples/go-wazero-converter/README.md)
- [Architecture roadmap](roadmap.md)

**See the file. Understand the file. Work with the file.**
