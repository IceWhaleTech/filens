# Frontend benchmark

The October 23–24, 2026 comparison uses pinned browser libraries, local repository samples and three Apache POI presentation fixtures identified by immutable Git blob hashes. See the [Chinese report](../../docs/performance-comparison.zh-CN.md) and [English report](../../docs/performance-comparison.md).

From the repository root, with the repository's Node and Rust/WASI toolchains available:

```sh
npm ci
npx playwright install chromium
node scripts/prepare-frontend-benchmark.mjs
npm run build:wasm
npm run build:core
npm run build:converter-client
npm run build:xlsx
npm run build:iwork
npm run build:panorama
node scripts/benchmark-frontends.mjs --iterations 7 --output tmp/performance-sota/reproduced
node scripts/summarize-frontend-benchmark.mjs --input tmp/performance-sota/reproduced/results.json --output tmp/performance-sota/reproduced/analysis.json
```

Run timing checks without other builds or tests in progress. The preparer installs this directory's dependency lock into ignored `tmp/performance-sota`, downloads the official SheetJS 0.20.3 tarball with SHA-256 verification, and fetches POI fixtures using verified Git blobs. The npm `xlsx` dependency is not used for measurement: the official SheetJS 0.20.3 browser build is used. `vue-office` is bundled against the repository's Vue 3 runtime.

The harness supports `--family`, `--sample`, `--engine`, `--iterations`, `--cpu-rate`, `--profile` and `--review-content`. Families are `pptx-model`, `pptx-view`, `numbers-model`, `iwork-view`, `raw-view` and `panorama-view`. Profiles and first-run screenshots are saved alongside `results.json`. Pixel hashes and interaction checks run after the timer. `--review-content` additionally saves every Numbers cell, checks visible PPTX pages after zooming, scrolling and navigation, and verifies iWork archive values and every lazily loaded Numbers sheet against a direct full parse.

```sh
node scripts/benchmark-frontends.mjs --family pptx-model --sample vue-office-test.pptx --iterations 7 --profile --output tmp/performance-sota/pptx-profile
gzip -dc benchmarks/frontend/2026-10-23/final.json.gz > tmp/final-results.json
```

The dated directory retains full, unfiltered measurements, the historical baseline harness and machine-readable summaries. Historical panorama timings in `baseline.json.gz` used a different constructor boundary; use `panorama-baseline.json.gz` for panorama before/after comparisons. Historical baselines were not fully isolated from incidental machine load. Headless Chromium used **SwiftShader**, not the Apple GPU. No result establishes global superiority or a fidelity ranking.

The benchmark downloads no proprietary source code. The PPTX package license restriction is documented in the reports. Apache POI samples are fetched from the upstream [test-data/slideshow directory](https://github.com/apache/poi/tree/trunk/test-data/slideshow); names, source URLs and Git blob hashes are in [external-samples.json](external-samples.json). Input binaries and third-party library bundles are not committed here.

## Current native iWork preview

The [7-run Numbers preview recheck](2026-10-24/numbers-visibility-review.json) measures **83.7 ms**, with all runs successful. Pages and Keynote retain their previous 66.3 ms / 61.3 ms measurements. The cumulative external comparison contains **1,988 measurements**, with all **833 filens runs** successful. Full Numbers parsing remains 35.4 ms versus 26.0 ms SheetJS cached-data extraction; no new SOTA claim.

[Preview summary](2026-10-24/numbers-preview-visibility-summary.json) / [raw](2026-10-24/numbers-preview-visibility.json.gz). Reproduce with `node scripts/benchmark-frontends.mjs --family iwork-view --sample a.numbers --iterations 7 --review-content --output tmp/performance-sota/numbers-visibility-reproduced`.

A separate **14-run rotating engineering comparison** measures **86.8 ms versus 98.3 ms**, about **12% less time**, with a 95% speed-ratio interval of **1.09–1.20**. [Engineering summary](2026-10-24/numbers-preview-visibility-ab-summary.json) / [raw](2026-10-24/numbers-preview-visibility-ab.json.gz), [derived A/B harness](2026-10-24/benchmark-iwork-visibility-ab.mjs), [implementation patch](2026-10-24/numbers-visibility.patch). No parsing, archive fields or mounted rows were removed: the browser defers offscreen table layout through CSS `content-visibility`, with estimated initial block sizing. Browsers without support render normally.

The initial preview is pixel-identical. Every transferred archive value and all six sheets match a full parse. The [functional review](2026-10-24/numbers-visibility-browser-review.json.gz) scrolls to all 14 tables and checks every mounted cell against its complete model; [reproduce it](2026-10-24/benchmark-iwork-visibility-review.mjs) from the repository root with `--family iwork-view --sample a.numbers --engine filens --iterations 1 --review-content`. Eight auto/visible screenshot pairs are pixel-identical; six show small alignment or column-width changes while retaining readable content. [Resize checks](2026-10-24/iwork-visibility-resize-review.json.gz) pass for all three iWork formats. All **299 iWork tests**, package/demo builds and the bundle report pass. The worker is unchanged.

Engineering and functional checks are excluded from external totals. Two rejected parser experiments are retained in [28 diagnostic measurements](2026-10-24/numbers-visibility-parser-diagnostic.json.gz); neither had a stable benefit and both were reverted.

## Previous native iWork preview recheck

The [21-run native-preview recheck](2026-10-24/iwork-resize-review.json) measures Numbers at **105.9 ms**, Pages at **66.3 ms** and Keynote at **61.3 ms**. All 21 runs pass. The cumulative external comparison contains **1,981 measurements**, with all **826 filens runs** successful. Full-model parsing is unchanged from the prior 35.4 ms Numbers / 26.0 ms SheetJS data-extraction measurement; no new SOTA label is added.

[Preview summary](2026-10-24/iwork-preview-resize-summary.json) / [complete records](2026-10-24/iwork-preview-resize.json.gz). Reproduce with `node scripts/benchmark-frontends.mjs --family iwork-view --iterations 7 --review-content --output tmp/performance-sota/iwork-preview-reproduced`.

A separate **42-run rotating engineering comparison** measures Numbers at **100.7 ms versus 125.9 ms** for the previous viewer, about **20% less time**, with a 95% speed-ratio interval of **1.21–1.29**. Pages and Keynote intervals overlap 1 and receive no improvement claim. [Engineering summary](2026-10-24/iwork-preview-resize-ab-summary.json) / [raw](2026-10-24/iwork-preview-resize-ab.json.gz), [derived A/B harness](2026-10-24/benchmark-iwork-resize-ab.mjs), [viewer patch](2026-10-24/iwork-resize.patch). The review binds the baseline build, source hashes and reconstruction procedure. An earlier Numbers-only [14-run check](2026-10-24/numbers-preview-resize-initial-ab.json.gz) is retained separately. Engineering runs are excluded from external-comparison totals.

All three first-preview images are pixel-identical; every Numbers sheet and transferred archive value matches the full parse. The [browser resize review](2026-10-24/iwork-resize-browser-review.json.gz) checks retained table/page nodes, scroll position, selection and floating-canvas scaling. Reproduce with the [functional review harness](2026-10-24/benchmark-iwork-resize-review.mjs) from the repository root using `--family iwork-view --engine filens --iterations 1 --review-content --output tmp/performance-sota/iwork-resize-review-reproduced`. Real sample tables have fewer than 100 rows; a separate 200-row unit regression verifies progressively loaded rows survive resizing. Three [initial browser diagnostics](2026-10-24/iwork-resize-browser-diagnostic.json.gz) retain invalid post-timer assertions about short tables and normal virtualization; corrected checks pass. These functional/diagnostic runs do not rank timings. All **299 iWork tests**, the package/demo builds and bundle report pass. The iWork preview bundle is 7.1 KiB Brotli; its worker size is unchanged.

## iWork parsing recheck

The [35-run recheck](2026-10-24/iwork-indexed-review.json) measures the full Numbers model at **35.4 ms**, versus SheetJS cached-data extraction at **26.0 ms**. Native previews are 126.0 ms for Numbers, 68.7 ms for Pages and 58.6 ms for Keynote. All 28 filens external-comparison runs pass. That cumulative external comparison has 1,960 measurements, including 805 successful filens runs. No new SOTA label is added.

Published summaries and complete records: [Numbers](2026-10-24/numbers-indexed-summary.json) / [raw](2026-10-24/numbers-indexed.json.gz), [iWork preview](2026-10-24/iwork-preview-indexed-summary.json) / [raw](2026-10-24/iwork-preview-indexed.json.gz). Use the existing `--family numbers-model` and `--family iwork-view` commands with `--iterations 7 --review-content` to reproduce.

Another 56 rotating new/old engineering runs measure about **14% less full-model time**, from 41.1 to 35.4 ms, with a 95% speed ratio interval of 1.12–1.24. Native-preview intervals overlap 1. These runs are excluded from external totals: [model summary](2026-10-24/numbers-indexed-ab-summary.json) / [raw](2026-10-24/numbers-indexed-ab.json.gz), [preview summary](2026-10-24/iwork-preview-indexed-ab-summary.json) / [raw](2026-10-24/iwork-preview-indexed-ab.json.gz). The [derived A/B harness](2026-10-24/benchmark-iwork-indexed-ab.mjs), [implementation patch](2026-10-24/iwork-indexed.patch) and review bind the previous build and reproduction procedure. Fourteen exploratory runs, including a post-timer baseline export failure, remain in [diagnostic records](2026-10-24/numbers-varint-diagnostic.json.gz) and are excluded from the final comparisons.

Six complete iWork archives/models, all 5,772 nonempty Numbers cells, the full styled Numbers model and three preview screenshots are unchanged. Worker archive access, every sheet, page navigation and zoom checks pass. [Complete cell snapshots](2026-10-24/numbers-content-indexed.json.gz) and the existing [full styled model](2026-10-24/numbers-styled-model-refined.json.gz) retain the content evidence. All 297 iWork tests and the package/demo builds pass; the iWork preview bundle remains 7.0 KiB Brotli. Small PPTX profiling did not establish a stable preview gain; its implementation and published comparisons remain unchanged.

## PPTX and iWork recheck

The [392-run recheck](2026-10-24/frontend-fastxml-review.json) includes seven repeats of every PPTX parsing/preview and iWork configuration, plus an independent seven-repeat check of the small picture deck. All 147 filens comparison runs succeed. The large deck parses in 34.3 ms and previews in 53.6 ms, versus pptx-preview at 57.7 and 75.4 ms. Its scoped SOTA qualification remains valid. The small picture deck does not stably beat vue-office in the independent check and receives no new SOTA label.

Published summaries and records: [PPTX parsing](2026-10-24/pptx-model-fastxml-summary.json) / [raw](2026-10-24/pptx-model-fastxml.json.gz), [PPTX preview](2026-10-24/pptx-preview-fastxml-summary.json) / [raw](2026-10-24/pptx-preview-fastxml.json.gz), [Numbers](2026-10-24/numbers-buffered-summary.json) / [raw](2026-10-24/numbers-buffered.json.gz), [iWork preview](2026-10-24/iwork-preview-buffered-summary.json) / [raw](2026-10-24/iwork-preview-buffered.json.gz), and [picture-deck confirmation](2026-10-24/pptx-pictures-confirm-summary.json) / [raw](2026-10-24/pptx-pictures-confirm.json.gz). Reproduce with the family commands below, adding `--review-content` for previews and Numbers. The independent picture check uses `--family pptx-view --sample rich-pptx-pictures.pptx --iterations 7 --review-content`.

All eight full PPTX models and all eleven filens preview images match the previous implementation. The [complete Numbers cell snapshot](2026-10-24/numbers-content-buffered.json.gz) and [full styled model](2026-10-24/numbers-styled-model-refined.json.gz) are unchanged. That Numbers recheck measures 40.9 ms, versus SheetJS cached-data extraction at 26.3 ms. Native iWork previews are higher in this recheck; those measurements remain in the report.

A separate 28-run engineering comparison rotates the new and previous iWork implementations: [full model](2026-10-24/numbers-buffered-ab-summary.json) / [raw](2026-10-24/numbers-buffered-ab.json.gz), [native preview](2026-10-24/numbers-preview-buffered-ab-summary.json) / [raw](2026-10-24/numbers-preview-buffered-ab.json.gz). Full-model time improves about 5%; native preview has no stable benefit. These runs are excluded from external-comparison totals and cannot qualify for SOTA. The [derived harness](2026-10-24/benchmark-iwork-ab.mjs) expects the previous iWork build in `tmp/performance-sota/oct24-iwork-baseline-dist`; its hash and baseline source/build hashes are bound in the review.

## Numbers and PPTX optimization recheck

The [October 24 recheck](2026-10-24/frontend-optimized-review.json) adds 371 measurements, with all 140 filens runs successful. Each configuration has seven fresh-context repeats. It retains every failed peer and remaining slower case.

```sh
node scripts/benchmark-frontends.mjs --family pptx-view --iterations 7 --review-content --output tmp/performance-sota/pptx-optimized-final
node scripts/benchmark-frontends.mjs --family pptx-model --iterations 7 --output tmp/performance-sota/pptx-model-optimized-final
node scripts/benchmark-frontends.mjs --family numbers-model --iterations 7 --review-content --output tmp/performance-sota/numbers-optimized-final
node scripts/benchmark-frontends.mjs --family iwork-view --iterations 7 --output tmp/performance-sota/iwork-optimized-final
node scripts/summarize-frontend-benchmark.mjs --input tmp/performance-sota/pptx-optimized-final/results.json --output tmp/performance-sota/pptx-optimized-final/summary.json
```

The summarizer also accepts the other filtered results; it rejects profiled inputs, computes intervals for every complete peer and requires seven repeats for a stable timing lead. Timing alone never grants SOTA: the [bound content/interaction review](2026-10-24/frontend-optimized-review.json) qualifies only the large deck's first preview. Pie-chart peers omit the chart, and Performance_Up shows a different first page, so their preview timings remain diagnostic. The full Numbers model retains six sheets, fourteen tables, canvases and styles; SheetJS extracts cached data. All 5,772 nonempty addresses and string values match in the [complete cell snapshots](2026-10-24/numbers-content-optimized.json.gz); numeric display follows document formatting. Numbers remains slower than SheetJS and is not labelled SOTA.

Published summaries and raw records: [PPTX preview summary](2026-10-24/pptx-preview-optimized-summary.json) / [records](2026-10-24/pptx-preview-optimized.json.gz), [PPTX parsing summary](2026-10-24/pptx-model-optimized-summary.json) / [records](2026-10-24/pptx-model-optimized.json.gz), [Numbers summary](2026-10-24/numbers-optimized-summary.json) / [records](2026-10-24/numbers-optimized.json.gz), and [iWork preview summary](2026-10-24/iwork-preview-optimized-summary.json) / [records](2026-10-24/iwork-preview-optimized.json.gz). The review retains before/after PPTX pixel checks and post-timer scrolling, zooming and page navigation results.

## iWork follow-up

The [35-run follow-up](2026-10-24/iwork-refined-review.json) adds seven repeats per configuration, with all 28 filens runs successful. Numbers full-model construction falls from 54.2 to 40.4 ms; its native preview falls from 127.8 to 121.4 ms. Pages and Keynote previews are 69.6 and 58.3 ms. SheetJS cached-data extraction remains faster at 24.2 ms; no new SOTA claim is made.

```sh
node scripts/benchmark-frontends.mjs --family numbers-model --iterations 7 --review-content --output tmp/performance-sota/numbers-retained-final
node scripts/benchmark-frontends.mjs --family iwork-view --iterations 7 --review-content --output tmp/performance-sota/iwork-retained-final
```

The [complete cell snapshots](2026-10-24/numbers-content-refined.json.gz) and [full styled model](2026-10-24/numbers-styled-model-refined.json.gz) are unchanged from the previous implementation. All three first-preview screenshots are pixel-identical. Post-timer checks exercise the real worker transfer, public archive values, every Numbers sheet, and Pages/Keynote navigation and zoom. Published [Numbers summary](2026-10-24/numbers-refined-summary.json) / [records](2026-10-24/numbers-refined.json.gz) and [iWork preview summary](2026-10-24/iwork-preview-refined-summary.json) / [records](2026-10-24/iwork-preview-refined.json.gz) retain input and built-artifact hashes.

## RAW sensor previews without embedded JPEGs

The [October 24 snapshot](2026-10-24/raw-sensor-summary.json) adds 105 comparison runs on five intact RAW samples and 28 diagnostic runs on a pruned CR3 fixture. It compares filens with pinned LibRaw-Wasm 1.6.0: conventional camera-WB half-size and fast half-size with no auto-brightening, a requested fixed sRGB curve and signed DNG exposure metadata.

```sh
node scripts/prepare-frontend-benchmark.mjs
npm run build:wasm
npm run build:converter-client
node scripts/benchmark-raw-preview.mjs --iterations 7 --output tmp/performance-raw-preview/reproduced
node scripts/summarize-raw-preview-benchmark.mjs --input tmp/performance-raw-preview/reproduced/results.json --output tmp/performance-raw-preview/reproduced/summary.json
```

The harness derives inputs by zeroing every parseable standard 8-bit display JPEG while retaining offsets, file lengths and high-bit-depth sensor compression. Before timing, LibRaw verifies unchanged unpacked sensor hashes; Canon sRAW uses complete processed-RGB hashes. It also reads DNG exposure metadata for the fast peer outside the timer. Source/derived hashes and removed byte ranges are recorded in [the complete results](2026-10-24/raw-sensor.json.gz).

Each fresh browser context prepares input bytes, compiled WASM and the LibRaw worker before timing. `operationMs` includes sensor decode/color, JPEG encode/decode for filens or RGB transfer for LibRaw, and fitting/drawing to a common 1280×800 canvas. `readyMs` adds two animation frames. Intermediate resolutions are recorded and differ; neither metric measures a full-quality RAW developer or cold library loading. The harness supports `--sample`, `--engine`, `--iterations`, `--profile`, `--image-wasm`, `--output` and optional `--save-full` native PNGs. Profiles cannot qualify for ranking.

The summarizer emits timings without a SOTA label until an explicit visual review is supplied with `--review path/to/review.json`. A review follows [the published schema](2026-10-24/raw-sensor-review.json), must bind to the new results SHA-256, and must document comparable readable scenes. Qualification additionally requires seven complete repeats, stable display pixels, unchanged sensor data and a paired-bootstrap 95% ratio interval above 1 against every measured peer. The [published composite](../../docs/assets/performance/raw-sensor-preview.webp) covers all five eligible samples and all three configurations. Individual PNG basenames in the review refer to local reproduction outputs; their hashes are retained. Colors follow the Photos contract documented in the [image core](../../wasm/converter-image-rust/README.md).

The Exiv2 `Canon-R6-pruned.CR3` metadata fixture is not an intact sensor RAW. Without its embedded JPEG, half-size paths fail and explicit full-size LibRaw unpack returns a black image. Its diagnostics remain in the results but are excluded from sensor rankings; they do not establish coverage for intact CR3 files. The old Node-only `benchmark-raw-sensor.mjs` check remains a historical engineering aid, not the published browser comparison.

## DXF, workbooks, CSV, ZIP, STEP and document conversion

The extended comparison adds 33 inputs, 71 configurations and 497 timed runs (7 each). It pins dxf-parser 1.1.2, official SheetJS CE 0.20.3, PapaParse 5.7.0, zip.js 2.24.0, fflate 0.8.2, occt-import-js 0.0.23 and [ONLYOFFICE x2t WASM v9.3.2+3](https://github.com/cryptpad/onlyoffice-x2t-wasm/releases/tag/v9.3.2+3).

```sh
node scripts/prepare-other-format-benchmark.mjs
npm run build:core
npm run build:cad
npm run build:xlsx
npm run build:archive
npm run build:converter-client
npm run build:docx
npm run build:wasm
node scripts/benchmark-other-formats.mjs --iterations 7 --output tmp/performance-other/reproduced
node scripts/compare-conversion-previews.mjs --input tmp/performance-other/reproduced
node scripts/summarize-other-format-benchmark.mjs --input tmp/performance-other/reproduced/results.json --output tmp/performance-other/reproduced/summary.json
```

The extended harness supports `--family` (`dxf`, `xlsx`, `csv`, `zip`, `step`, `conversion`), `--sample`, `--iterations` and `--output`. Optional `--profile` writes diagnostic CPU profiles; profiled runs are rejected by the ranking summarizer. Its preparer installs [the additional dependency lock](other-formats/package-lock.json) into ignored `tmp/performance-other`, verifies source-archive checksums, and records each local/generated/upstream input's SHA-256 and provenance. Generated inputs cover 20,000 DXF lines, 80,000 XLSX numeric cells, UTF-8/quoted/multiline CSV, 1,000 ZIP entries and a 16 MiB entry. ZIP timestamps are fixed to January 1, 2020.

The x2t release archive SHA-256 is `9fee31b60964d8145396bf1fb992f38ea3bf099a1c64e949fa4976c5c4fdd290`. The published SHA-512 was independently checked. Inputs and libraries are ready before timing. STEP/x2t WASM compilation is excluded; runtime initialization is recorded separately from the operation, and `firstOperationMs` sums both. filens conversion includes its fresh WASI instance. x2t receives UTF-8/comma settings and empty font/theme directories; no extra fonts are installed. Archive extraction includes listing and reading every entry; zip.js uses no workers or CRC checking. fflate first lists entries with a rejecting filter, then inflates them, so its total includes a second directory scan.

Validation runs after timing. CSV compares complete row/field matrices, ZIP compares every decoded file hash, XLSX compares normalized cached values/formulas, and STEP compares oriented world-space triangle/normal signatures. STEP deliberately omits source colors, names and assembly trees; the claim concerns geometry preview. The independent 55-fixture / 165-import geometry regression uses a tighter numerical tolerance than benchmark hashes:

```sh
FILENS_OCCT_FIXTURES=tmp/occt-size/source/test/testfiles node scripts/test-occt-wasm.mjs
```

If that local upstream tree is absent, extract the verified `tmp/performance-other/occt-importer.tar.gz` archive first and point `FILENS_OCCT_FIXTURES` at its `test/testfiles` directory. The optimized production STEP WASM is tracked in the repository; rebuilding it is optional and described in the [OCCT build instructions](../../packages/model3d/vendor/occt-import-js/README.md).

Conversion outputs from iteration 0 are saved and checked for required OpenXML entries and parseable primary XML. `compare-conversion-previews.mjs` renders both outputs through the same production DOCX/XLSX/PPTX drivers, saves each sheet/slide plus first/last document views, and hashes every resolved workbook display cell. Its review is bound to the exact benchmark JSON hash. The DOC hyperlink fixture must also display its cached field text after fonts and layout settle. XLS previews may qualify even when formulas are stored differently: this evaluates reading, not editable round trips. Exact display signatures are retained alongside a preview-content signature that accepts trailing empty grid space and decimal differences at 12 significant digits, while checking every nonempty cell address and text. Native output cached-value signatures must still match; the relaxed preview signature alone cannot qualify an incomplete conversion. Other Office cases remain timed, with visible differences documented instead of requiring identical internal structure. Both the 20,000-row and 8,000-row CSV conversions are now complete. Delimited conversion rejects inputs exceeding 1,000,000 cells, 16,384 columns per row or the XLSX row limit, rather than silently truncating. Direct CSV preview has no such conversion cap.

The dated `other-formats-optimized.json.gz`, `other-formats-optimized-summary.json` and `preview-review-optimized.json` retain the current full extended evidence. The earlier `other-formats.json.gz`, `other-formats-summary.json` and `preview-review.json` remain as historical evidence, including the old truncated CSV output and missing DOC field text. Slower cases and the minimal ODT fixture's empty x2t package remain in the data. Leading a slower peer alone cannot qualify if another measured peer wins or lacks a complete validated run set. Main-thread JS heap excludes WASM, workers and GPU memory. PDF, DOCX and most 3D loaders reuse third-party engines; this report does not claim independent algorithmic superiority for those wrappers.
