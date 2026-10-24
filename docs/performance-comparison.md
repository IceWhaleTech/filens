# Browser frontend performance comparison

October 23–24, 2026 · Apple M4 Pro · Chromium 147 · **2,324 comparison measurements, 7 per configuration; all 945 filens runs in those comparisons succeeded.** Another 28 pruned-CR3 diagnostic runs are retained separately.

PPTX, panorama, RAW without embedded JPEGs, STEP, XLSX and document preview conversion have stable leading cases. Tasks under 10 ms are omitted from the comparison tables. The target is readable previews; converted files need not preserve identical editable internal structures.

| Measured task | filens | Peer | Peer / filens (95% interval) | Result |
| --- | --- | --- | --- | --- |
| 11.1 MB / 13-slide PPTX parse | **28.5 ms** | pptx-preview 1.0.7: 56.6 ms | 1.99× (1.94–2.12) | **SOTA\*** |
| 11.1 MB / 13-slide PPTX first preview | **48.8 ms** | pptx-preview 1.0.7: 71.8 ms | 1.47× (1.41–1.51) | **SOTA\*** |
| 3840×1920 panorama JPEG preview | **154.9 ms** | Photo Sphere Viewer 5.15.1: 205.2 ms | 1.32× (1.29–1.37) | **SOTA\*** |
| NEF without embedded JPEG → preview canvas | **152.7 ms** | LibRaw half-size: 326.7 ms | 2.14× (2.10–2.17) | **SOTA\*** |
| DNG without embedded JPEG → preview canvas | **167.7 ms** | LibRaw fast half-size: 314.4 ms | 1.87× (1.78–1.91) | **SOTA\*** |
| STEP geometry import: cube | **46.5 ms** | occt-import-js: 67.6 ms | 1.45× (1.43–1.63) | **SOTA\*** |
| XLSX data read (80,000 cells) | **42.3 ms** | sheetjs: 109.6 ms | 2.59× (2.38–2.71) | **SOTA\*** |
| XLS → XLSX preview conversion (6 sheets) | **12.3 ms** | x2t: 49.1 ms | 4.00× (3.91–4.13) | **SOTA\*** |
| 20,000×8 numeric CSV → XLSX | **137.6 ms** | x2t: 198.8 ms | 1.44× (1.41–1.46) | **SOTA\*** |

<sub>\* SOTA is limited to this machine, measured inputs, listed peers and task: the paired bootstrap 95% ratio interval stays above 1. XLSX data reading does not cover complete style parsing; XLS conversion compares displayed results in the same viewer. **Panoramas use SwiftShader software rendering.** Downloads and library cold loading are excluded. Full records retain slower cases and failures.</sub>

## RAW: a fast preview without an embedded JPEG

Embedded JPEGs are removed from camera samples so every preview comes from sensor data. All five intact inputs lead both measured half-size configurations of [LibRaw-Wasm 1.6.0](https://github.com/ybouane/LibRaw-Wasm), at **1.11–2.14×** the speed of the faster peer.

| Input | filens (ms) | LibRaw half-size (ms) | LibRaw fast half-size (ms) | Faster peer / filens (95% interval) | Result |
| --- | ---: | ---: | ---: | --- | --- |
| Pentax K-r DNG | **167.7** | 320.6 | 314.4 | **1.87×** (1.78–1.91) | **SOTA\*** |
| Nikon D3S NEF | **152.7** | 326.7 | 328.2 | **2.14×** (2.10–2.17) | **SOTA\*** |
| Canon 40D sRAW CR2 | **132.0** | 148.1 | 146.6 | **1.11×** (1.06–1.15) | **SOTA\*** |
| Pentax K-r PEF | **187.6** | 289.2 | 288.6 | **1.54×** (1.52–1.58) | **SOTA\*** |
| Olympus Stylus ORF | **352.3** | 408.1 | 409.9 | **1.16×** (1.14–1.27) | **SOTA\*** |

<sub>Timing ends after preview-canvas drawing and includes sensor decode, color processing, filens JPEG encode/decode or LibRaw RGB transfer, and fitting to a common 1280×800 canvas. Intermediate resolution, crop and tone differ; this measures readable previews. Both LibRaw configurations use camera WB and half-size; the fast mode also disables auto-brightening, requests a fixed sRGB curve and applies DNG exposure metadata. Inputs and libraries initialize before timing. All 105 eligible runs succeeded; preview pixels are stable across seven repeats per configuration.</sub>

<sub>The color contract follows Photos: camera WB, the correct camera-to-sRGB matrix, highlight clipping, fixed sRGB transfer and signed DNG BaselineExposure. Invalid calibration raises an error. Gray/exposure tests check 18% gray at about 118 and −1 / +1 EV at about 85 / 162. Tone differences remain; camera picture-style parity is outside this preview task.</sub>

<details>
<summary>Preview comparisons, output sizes and display waiting</summary>

<sub>Columns: filens, LibRaw half-size, LibRaw fast half-size; rows follow the table above. Scenes and orientation are readable; blown sky no longer turns magenta. Only standard 8-bit display JPEGs are removed, preserving high-bit-depth sensor compression. Unpacked sensor hashes match; Canon sRAW uses complete processed-RGB hashes instead.</sub>

![Five RAW inputs without embedded JPEGs: actual filens and LibRaw previews](assets/performance/raw-sensor-preview.webp)

| Input | filens intermediate size | LibRaw half / fast intermediate size | filens with display wait (ms) | LibRaw half / fast with display wait (ms) |
| --- | --- | --- | ---: | --- |
| DNG | 1451×956 | 2154×1434 | 188.4 | 342.6 / 336.9 |
| NEF | 1419×944 | 2142×1422 | 173.1 | 346.0 / 345.7 |
| CR2 | 1944×1296 | 1944×1296 | 156.0 | 153.9 / 152.6 |
| PEF | 1436×956 | 2154×1434 | 206.4 | 309.6 / 307.3 |
| ORF | 1993×1496 | 1992×1496 | 380.6 | 426.0 / 428.4 |

<sub>Display waiting adds two animation frames and is separate from the sensor-to-canvas ranking; CR2 does not lead this metric. The ordinary filens preview limit remains 2048 pixels. The canon-r6.cr3 sample is Exiv2's Canon-R6-pruned.CR3 metadata fixture: without its JPEG it contains no usable complete scene. filens and LibRaw half-size return no image; explicit full LibRaw unpack produces black. Its 28 diagnostic runs are retained but excluded from the sensor ranking and do not determine support for intact CR3 originals.</sub>

</details>

## Document preview conversion versus ONLYOFFICE x2t WASM

The peer is [x2t v9.3.2+3](https://github.com/cryptpad/onlyoffice-x2t-wasm/releases/tag/v9.3.2+3). Both outputs use the same filens viewers. Every sheet's displayed cells match on basic XLS samples; the larger XLS has a similar preview. Storing formulas differently does not disqualify a preview comparison.

| Input | filens conversion (ms) | x2t conversion (ms) | x2t init + conversion (ms) | Preview result |
| --- | ---: | ---: | ---: | --- |
| legacy-project-workflow.doc | 23.6 | 43.2 | 74.1 | Readable text; page breaks and spacing differ |
| hyperlink.doc | 11.2 | 22.1 | 50.8 | Hyperlink text displays completely |
| table-merges.doc | 11.6 | 23.1 | 54.2 | Table text orientation differs |
| Simple.xls | 10.2 | 27.7 | 58.7 | Matching displayed cells · **SOTA\*** |
| SimpleWithFormula.xls | 10.3 | 29.8 | 59.4 | Matching displayed cells · **SOTA\*** |
| SOLVSAMP.XLS | 12.3 | 49.1 | 80.6 | Similar preview; minor decimal and blank-grid differences · **SOTA\*** |
| legacy-sample-show.ppt | 10.2 | 46.5 | 77.0 | Text and layout differ |
| rich-text.rtf | 11.0 | 24.6 | 54.7 | Tables and pagination differ |
| sample.odt | 10.5 | — | — | x2t returns an empty ZIP; validation fails |
| convert-numeric.csv | 137.6 | 198.8 | 227.1 | All 160,000 cells match · **SOTA\*** |
| convert-numeric-8000.csv | 64.8 | 96.6 | 128.2 | All 64,000 cells match · **SOTA\*** |
| generated-notes.txt | 15.6 | 24.0 | 52.9 | Complete text matches; default font/page width differ |

<sub>Conversion includes input writes and output reads. WASM is precompiled; x2t initialization is separate, while filens WASI instance creation is inside conversion. No extra fonts are installed. DOC/PPT/RTF timings remain visible; cases with obvious visual differences receive no SOTA mark. Different editable formulas or paragraph structures alone do not disqualify a preview. XLS preview signatures accept trailing decimal differences at 12 significant digits and blank grid space, while checking every nonempty cell address and text.</sub>

| Document conversion WASM | filens | x2t |
| --- | ---: | ---: |
| Raw bytes | **892,101** | 38,768,424 |
| Brotli 11 | **325,537** | 7,124,169 |

<sub>WASM only, recompressed with identical settings; JS adapters, viewers, fonts and other modules are separate. The filens conversion core is about **1/21.9** the Brotli size of x2t, with scope documented in the [support matrix](support-matrix.md). The complete 20,000-row CSV now converts; inputs above 1,000,000 cells or 16,384 columns per row raise an explicit error instead of being silently truncated. The minimal ODT fixture's failure does not establish general x2t ODT support.</sub>

<details>
<summary>Actual preview comparisons</summary>

<sub>filens left, x2t right; identical viewer, 1280×900, DPR 1. Text, boolean values and cached DOC field results pass the actual preview checks. These show the first sheet of a basic formula XLS and a more complex XLS; all-sheet checks are retained in the evidence.</sub>

![Basic formula XLS: matching displayed cells](assets/performance/xls-formula-preview.webp)

![SOLVSAMP XLS: similar content, minor decimal-display differences](assets/performance/xls-solver-preview.webp)

</details>

## STEP: a smaller geometry preview core

All six geometry imports lead [occt-import-js 0.0.23](https://github.com/kovacsv/occt-import-js), the core used by Online 3D Viewer.

| File | Triangles | filens (ms) | Upstream (ms) | Upstream / filens |
| --- | ---: | ---: | ---: | ---: |
| cube.stp | 12 | 46.5 | 67.6 | 1.45× |
| rounded-cube.step | 84 | 52.2 | 79.2 | 1.52× |
| as1_pe_203.stp | 3,848 | 147.7 | 180.5 | 1.22× |
| as1-oc-214.stp | 5,040 | 266.7 | 289.5 | 1.09× |
| dm1-oc-214.stp | 1,904 | 171.9 | 196.8 | 1.15× |
| tailturbine.stp | 3,622 | 148.9 | 175.1 | 1.18× |

<sub>World-space triangle/normal signatures match, backed by a separate 55-fixture / 165-import numerical regression. filens targets geometry preview and omits original colors, names and assembly trees. Brotli WASM falls from 2,315,009 upstream to **816,177 bytes, 64.7% smaller**. This is not a complete CAD metadata-import ranking.</sub>

## Other categories and slower cases

| Task | filens (ms) | Faster peer (ms) |
| --- | ---: | --- |
| DXF: 20,000 lines | 29.8 | dxf-parser: 19.5 |
| CSV: 20,000×8 numeric fields | 11.7 | papaparse: 7.9 |
| ZIP: extract all 1,000 small files | 11.4 | fflate: 4.2 |

<sub>CSV measures PapaParse 5.7.0 and SheetJS CE 0.20.3; ZIP measures fflate 0.8.2 and zip.js 2.24.0, showing the faster peer. DXF uses dxf-parser 1.1.2. Beating one slower implementation cannot qualify when another measured peer wins. PDF, DOCX and most 3D loaders reuse existing engines; their wrappers receive no independent algorithmic SOTA claim.</sub>

<details>
<summary>XLSX: complete corpus</summary>

| Input | Nonempty cells | filens (ms) | SheetJS CE 0.20.3 (ms) | Result |
| --- | ---: | ---: | ---: | --- |
| generated-80000-cells.xlsx | 80,000 | 42.3 | 109.6 | **SOTA\*** |

<sub>Signatures align sheet names, addresses, cached values and formulas. Styles, charts and complete workbook features are not scored. Millisecond gains on small inputs do not establish large-workbook leadership.</sub>

</details>

<details>
<summary>PPTX: complete parsing and preview results</summary>

| File | MB | filens parse | PPTist parser | pptx-preview parse | filens preview | pptx-preview single | vue-office preview |
| --- | --- | --- | --- | --- | --- | --- | --- |
| vue-office-test.pptx | 11.12 | 28.5 | 70.3 | 56.6 | 48.8 | 71.8 | 108.8 |
| filens-field-notes.pptx | 0.66 | 11.5 | 23.5 | Failed | 45.1 | Failed | Failed |
| rich-pptx-shapes.pptx | 0.13 | 10.9 | 23.2 | 12.7 | 48.7 | 42.3 | 50.8 |
| rich-pptx-pictures.pptx | 0.09 | — | 11.1 | — | 27.5 | 30.9 | 39.4 |
| sample-deck.pptx | 0.07 | 10.4 | Failed | Failed | 37.3 | Failed | Failed |
| poi-SampleShow.pptx | 0.04 | — | 14.1 | 13.4 | 28.7 | 18.2 | 19.7 |
| poi-pie-chart.pptx | 0.06 | — | 11.8 | 13.4 | 25.4 | 40.5 | 40.1 |
| poi-2411-Performance_Up.pptx | 0.65 | 24.5 | Failed | 33.6 | 61.5 | 52.2 | 97.0 |

<sub>Milliseconds; parse values at or below 10 ms are omitted. filens mounts all visible pages, including at low zoom; pptx-preview uses single-slide mode and vue-office its default full DOM. Some small inputs still have faster peers; the picture deck's lead is unstable in an independent recheck, so it receives no SOTA label. Both pie-chart peers omit the pie, and Performance_Up shows a different first page in the peer; those preview timings are diagnostic. Failures never count as zero. The vue-office [PPTX core is not open source](https://github.com/501351981/pptx-preview#关于授权).</sub>

![11.1 MB PPTX first preview: filens, pptx-preview, vue-office](assets/performance/pptx-first-preview.webp)

</details>

<details>
<summary>iWork, panorama and before/after results</summary>

| Input | Task | filens (ms) | Peer (ms) |
| --- | --- | --- | --- |
| a.numbers | Native canvas preview | 83.7 | — |
| a.numbers | Full model / data extraction | 35.4 | SheetJS CE 0.20.3: 26.0 |
| a.pages | Native canvas preview | 66.3 | — |
| filens-weekend.key | Native canvas preview | 61.3 | — |
| insta360-oners-tallinn.jpg | Panorama JPEG preview | 273.2 | Photo Sphere Viewer: 363.3 |
| osmo-360-leipzig.jpg | Panorama JPEG preview | 154.9 | Photo Sphere Viewer: 205.2 |

<sub>The filens Numbers model includes 6 sheets, 14 tables, canvases and styles; SheetJS extracts 14 workbook entries and remains faster at data extraction. Row-tile placement and sparse trailing-cell omissions are fixed: all 5,772 nonempty cell addresses and string values match SheetJS, while numeric display follows document formatting. Pages/Keynote lack an equivalent measured native-canvas peer here. Vendor distortion/calibration parsing, original-track synchronization and stitching likewise lack equivalent measured frontend peers; ordinary panorama JPEG speed does not imply stitching superiority.</sub>

| Task | Before (ms) | After (ms) | Before / after |
| --- | --- | --- | --- |
| 11.1 MB PPTX parse | 45.3 | 28.5 | 1.59× |
| 11.1 MB PPTX preview | 69.3 | 48.8 | 1.42× |
| Numbers full model | 125.5 | 35.4 | 3.54× |
| Numbers native preview | 187.3 | 83.7 | 2.24× |
| SampleShow PPTX preview | 30.7 | 28.7 | 1.07× |
| shapes PPTX preview | 62.5 | 48.7 | 1.28× |
| sample-deck PPTX preview | 52.0 | 37.3 | 1.40× |
| 6528×3264 panorama preview | 568.4 | 273.2 | 2.08× |
| 3840×1920 panorama preview | 276.1 | 154.9 | 1.78× |
| DXF: parse 20,000 lines | 39.2 | 29.8 | 1.32× |
| XLSX: read 80,000 cells | 145.6 | 42.3 | 3.44× |
| ZIP: extract 1,000 small files | 54.8 | 11.4 | 4.82× |
| CSV: read 20,000×8 fields | 18.2 | 11.7 | 1.56× |

<sub>Historical baselines were not fully isolated from machine load; before/after ratios are engineering references. Both panorama viewers make 0 GL draws in a two-second unchanged view; filens previously made about 99–101. Optimizations cover PPTX archive/XML/scrolling, iWork lookup caches, panorama redraw scheduling and RAW extraction/development. Format processing stays in frontend TS/WASM.</sub>

</details>

## Data and reproduction

[Original 525-run summary](../benchmarks/frontend/2026-10-23/summary.json) · [Raw records](../benchmarks/frontend/2026-10-23/final.json.gz) · [Additional 497-run summary](../benchmarks/frontend/2026-10-23/other-formats-optimized-summary.json) · [Raw records](../benchmarks/frontend/2026-10-23/other-formats-optimized.json.gz) · [Preview checks](../benchmarks/frontend/2026-10-23/preview-review-optimized.json) · [Pinned dependencies and reproduction](../benchmarks/frontend/README.md).

RAW without embedded JPEGs: [105 comparison runs and 28 diagnostics](../benchmarks/frontend/2026-10-24/raw-sensor-summary.json) · [Complete raw records](../benchmarks/frontend/2026-10-24/raw-sensor.json.gz) · [Visual review bound to the results hash](../benchmarks/frontend/2026-10-24/raw-sensor-review.json).

371-run optimization recheck: [PPTX preview](../benchmarks/frontend/2026-10-24/pptx-preview-optimized-summary.json) · [PPTX parsing](../benchmarks/frontend/2026-10-24/pptx-model-optimized-summary.json) · [Numbers](../benchmarks/frontend/2026-10-24/numbers-optimized-summary.json) · [iWork preview](../benchmarks/frontend/2026-10-24/iwork-preview-optimized-summary.json) · [Content and interaction review](../benchmarks/frontend/2026-10-24/frontend-optimized-review.json).

Additional 35-run iWork recheck: [Numbers full model](../benchmarks/frontend/2026-10-24/numbers-refined-summary.json) · [iWork preview](../benchmarks/frontend/2026-10-24/iwork-preview-refined-summary.json) · [Full-model, pixel and sheet-navigation checks](../benchmarks/frontend/2026-10-24/iwork-refined-review.json). <sub>The full styled Numbers model and all three iWork first-preview images are unchanged; Pages is slightly slower in this recheck and is not counted as an optimization gain.</sub>

Additional 392-run recheck: [PPTX parsing](../benchmarks/frontend/2026-10-24/pptx-model-fastxml-summary.json) · [PPTX preview](../benchmarks/frontend/2026-10-24/pptx-preview-fastxml-summary.json) · [Numbers](../benchmarks/frontend/2026-10-24/numbers-buffered-summary.json) · [iWork preview](../benchmarks/frontend/2026-10-24/iwork-preview-buffered-summary.json) · [Independent recheck and full-content review](../benchmarks/frontend/2026-10-24/frontend-fastxml-review.json).

<sub>All eight PPTX models, every Numbers cell and eleven first-preview images match the previous implementation. Another 28 rotating new/old engineering runs show about 5% lower Numbers full-model time, with no stable native-preview benefit. iWork preview times are higher in this recheck and remain in the report.</sub>

Additional 35-run iWork recheck: [Numbers full model](../benchmarks/frontend/2026-10-24/numbers-indexed-summary.json) · [iWork preview](../benchmarks/frontend/2026-10-24/iwork-preview-indexed-summary.json) · [Full-content and rotating engineering comparisons](../benchmarks/frontend/2026-10-24/iwork-indexed-review.json).

<sub>Six complete iWork archives/models and all three preview images match the previous implementation. Another 56 rotating new/old runs show about 14% lower Numbers full-model time; native-preview gains are not stable. No new SOTA label is added.</sub>

Additional 21-run native-preview recheck: [iWork preview](../benchmarks/frontend/2026-10-24/iwork-preview-resize-summary.json) · [Rotating engineering comparison](../benchmarks/frontend/2026-10-24/iwork-preview-resize-ab-summary.json) · [Pixel, content and browser resize checks](../benchmarks/frontend/2026-10-24/iwork-resize-review.json).

<sub>Across 42 rotating new/old runs, Numbers first-preview time falls about 20%; Pages and Keynote show no stable gain. All three preview images, every sheet and archive values are unchanged. Resizing preserves progressively loaded rows and the selected page. No equivalent native frontend peer was measured, so no new SOTA label is added.</sub>

Additional 7-run Numbers preview recheck: [Preview results](../benchmarks/frontend/2026-10-24/numbers-preview-visibility-summary.json) · [Rotating engineering comparison](../benchmarks/frontend/2026-10-24/numbers-preview-visibility-ab-summary.json) · [Complete-content and table-scroll checks](../benchmarks/frontend/2026-10-24/numbers-visibility-review.json).

<sub>Median preview time is 83.7 ms. Fourteen rotating new/old measurements confirm about 12% less time, with a pixel-identical first preview and all 14 tables readable after scrolling. Full parsing and SOTA conclusions are unchanged.</sub>

Additional 336-run PPTX recheck: [Complete parsing](../benchmarks/frontend/2026-10-24/pptx-model-lazy-summary.json) · [Preview](../benchmarks/frontend/2026-10-24/pptx-preview-lazy-summary.json) · [Rotating engineering and complete-content checks](../benchmarks/frontend/2026-10-24/pptx-lazy-review.json).

<sub>Rotating comparisons show about 16% less complete-model time and 11% less first-preview time for the 11.1 MB PPTX. All eight complete models and first-preview images are unchanged. Small-preview gains are not stable; slower results and peer failures remain recorded.</sub>

<sub>Apple M4 Pro / 24 GiB / macOS arm64; Chromium 147.0.7727.15, 1280×800, DPR 1, no CPU throttling. Fresh context per run, shared browser process, rotating peer order. Libraries, input bytes and WASM compilation finish before timing. Preview waits for content decoding, fonts and two animation frames; both panorama constructors are timed. Intervals use 10,000 paired resamples, seed 12345. Retained main-thread JS heap excludes WASM, workers and GPU memory. [Historical baseline](../benchmarks/frontend/2026-10-23/baseline.json.gz) · [Corrected panorama baseline](../benchmarks/frontend/2026-10-23/panorama-baseline.json.gz).</sub>
