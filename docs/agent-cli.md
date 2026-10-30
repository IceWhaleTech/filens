# Agent CLI: local reading and cited document content

English · [简体中文](agent-cli.zh-CN.md)

filens reads local documents and supplies text and evidence to a calling agent. Version 0.3.0 provides model-free `summarize` / `prune`: density/TF-IDF, optional lexical BM25 focus and cosine-diversity selection keep original excerpts within a character budget. See [pruning, provenance and examples](agent-cli-pruning.zh-CN.md) (Chinese). Paraphrasing, question answering and semantic reasoning remain with the caller. Chinese/English intents, optional commands and JSON requests use the same shared document core. Outputs include text, JSON, Markdown, HTML, YAML, XML, CSV and TSV, with optional source layouts.

Version 0.3.0 provides [directory-wide lexical search](agent-cli-search.zh-CN.md) (Chinese): BM25, literal and filename modes, original evidence, and request-local memory with no persistent cache or source hashes. macOS uses native FTS; Windows/Linux embed compiled private hdrw WASI. Embedding-based semantic retrieval remains unimplemented. See the [evaluation plan](agent-cli-search-evaluation.zh-CN.md), including controlled retrieval, raw-document and Agent comparisons.

See [68 observed examples and OCR quality results](agent-cli-examples.zh-CN.md) (Chinese), including unsupported phrases, fallback behavior and recognition errors.

See [output formats, coordinates and the typing demo](agent-cli-formats-and-layout.zh-CN.md) (Chinese).

See [Windows x64 test bundles and an agent handoff prompt](agent-cli-windows.zh-CN.md) (Chinese). Version 0.3.0 includes Windows x64 packages. Windows native execution remains pending.

Version 0.3.0 provides [Czkawka-style duplicate-file and similar-image scans](agent-cli-similarity.md): `filens duplicates ./files --json` and `filens similar-images ./photos --threshold 8 --json`. Hashing, image decoding and grouping run in the shared WASM core, without OCR or a model. Check `capacity.operations` for `similar`.

## One-command installation

Install [`filens-cli`](https://www.npmjs.com/package/filens-cli) for bundled OCR, or [`filens-cli-lite`](https://www.npmjs.com/package/filens-cli-lite) for reading without bundled OCR. Both provide the `filens` command.

```sh
# Full: native RapidOCR NCNN and models included; no Python environment
npm install -g filens-cli
filens 'read "report.pdf" as json'
filens 'what can you do as json'

# Or Lite: CLI + WASM, OCR installed only when needed
npm install -g filens-cli-lite
filens setup-ocr
filens '读取 "scan.pdf"，以纯文本输出'
```

Install one profile at a time: both expose `filens`. npm selects the current platform's binary packages. Supported targets: macOS 12+ arm64, Linux glibc 2.17+ x64/arm64 and Windows 10/11 x64. The npm launcher requires Node.js 20.11+; installed native binaries can also run directly. No Python, ONNX Runtime, Homebrew, CMake or compiler is needed by installed packages. Reading runs offline after installation.

For a temporary invocation without a global installation:

```sh
npx --yes filens-cli 'what can you do as json'
# Or Lite, without bundled OCR
npx --yes filens-cli-lite '你能做什么？以 JSON 输出'
```

Version 0.3.0 on macOS arm64: **2.10 MiB** native executable; Lite **7.85 MiB installed / 6.02 MiB download**; Full **31.05 MiB installed / 20.22 MiB download**, including OCR models. Totals combine the launcher and selected platform packages, excluding Node.js, npm caches and filesystem overhead. See [all platform sizes and exact bytes](agent-cli-npm-release.json). FiLens code and npm package metadata use [MIT](../LICENSE); dependencies retain their own licenses.

For offline distribution, locally generated tarballs can also be installed in one command, for example on macOS arm64:

```sh
npm install -g ./dist/npm/filens-cli-0.3.0.tgz ./dist/npm/filens-cli-darwin-arm64-0.3.0.tgz ./dist/npm/filens-ocr-darwin-arm64-0.3.0.tgz
```

Historical [Rust migration measurements](agent-cli-rust-size.json) and [similarity feature costs](agent-cli-similarity-size.json) describe earlier local builds; use the 0.3.0 report above for current installation sizes.

## Source build and release packaging

The CLI in `cli/` is Rust; document parsing stays in the shared frontend WASM core. Release builds use size optimization, LTO, one codegen unit, aborting panics and stripped symbols. Windows/Linux executables additionally use UPX `--best --lzma` and pass `upx --test`; macOS arm64 skips UPX because that executable format is unsupported. Binaryen `-Oz` strips debug/producers metadata from the text WASM. npm packages store all WASM engines as gzip level 1 resources, decoded locally and loaded only when needed; no external decompression tool is required at runtime. Build hosts can install pinned, SHA-256-verified UPX with `node scripts/setup-agent-upx.mjs`; `--no-upx` produces an uncompressed executable for comparison.

Lite source builds require Node.js 20.11+ and the pinned Rust 1.93.0 / WASI toolchain, with no Go compiler. Linux and Windows builds also require Zig 0.16.0 and `cargo-zigbuild` 0.24.0; Linux targets preserve the glibc 2.17 floor. Full source builds still use Go 1.24+ to rebuild the separate Photos native OCR wrapper. A first macOS Full build also requires CMake and Xcode command-line tools for the CPU-only NCNN companion; Windows uses CMake and Ninja. Installed npm packages include these libraries already. `FILENS_ZIG` selects the Zig executable for the OCR wrapper; cargo-zigbuild uses Zig on PATH.

```sh
npm run build:agent:lite
./dist/agent-lite/filens 'read "report.pdf" as json'

# Add native OCR to a local Lite bundle
npm run setup:agent:ocr -- --lite --sources 4

# Full: native OCR and models included
npm run build:agent
./dist/filens 'understand "meeting notes.docx" as json'

# On macOS arm64: prepare all four platform targets and both profiles
cargo install cargo-zigbuild --locked --version 0.24.0
npm run package:agent:npm
npm run test:agent:npm
npm run publish:agent:npm -- --dry-run
# Authenticated maintainer: publish platform components, then both entry packages
npm run publish:agent:npm
```

The Agent CLI release version is set in `packaging/agent-release.json`, independently of the private workspace version. Update it before preparing a new release; published versions are immutable. Tarballs, sizes and SHA-256 hashes are recorded in `dist/npm/release.json`. Packaging uses explicit file allowlists and includes NCNN/C++ runtime notices and build provenance; it excludes source-build caches and the retired Python environment. The publication script checks tarball hashes and npm authentication before making registry writes. Linux and Windows binaries are cross-built; the installation smoke test exercises the host platform. The CI workflow is configured to validate native installs on macOS arm64, Linux x64/arm64 and Windows x64, including Windows portable bundles; it has not been run in this local session.

Reading and pruning accept one local file or archive-member path per request; `search` accepts a local directory or supported archive. ZIP, TAR and GZIP containers expand recursively up to eight layers, retaining paths such as `outer.zip!/inner.tar.gz!/report.pdf` for subsequent reading, layout and summaries. See [nested archive usage and checks](agent-cli-search-archives.zh-CN.md). Quote paths in natural-language intents, especially paths with spaces. Relative paths resolve from the caller's working directory. Optional commands are `read`, `extract`, `understand`, `layout`, `summarize` / `prune`, `search`, and `capacity` / `capabilities`; optional flags include `--json`, `--format text|json|markdown|html|yaml|xml|csv|tsv`, `--layout`, `--input`, `--max-bytes`, `--timeout`, `--wasm` and `--no-ocr`. Search adds `--query`, `--search-mode bm25|exact|files`, `--max-results`, `--max-files`, `--max-depth`, `--include-hidden` and `--no-cache`; see the [search guide](agent-cli-search.zh-CN.md).

## Agent contract

```sh
echo '{"operation":"understand","input":"report.pdf","format":"json"}' | filens
echo 'read "report.pages" as json' | filens
filens capacity --json
```

Use `filens -` for explicit stdin requests. JSON requests default to JSON responses; natural language defaults to plain text. Use the executable directly for pipelines, or `npm --silent run filens -- ...` to suppress npm's own startup output.

Document-reading responses use `version: "filens-agent-v1"`, `ok`, `operation`, `source`, and `content`. `content` preserves `text`, `complete`, `truncated`, warnings and extraction errors. Document JSON output adds `content.document` with byte/character/line counts and evidence blocks:

```json
{"id":"b1","startByte":0,"endByte":2048,"startLine":1,"endLine":12}
```

Block offsets are zero-based UTF-8 byte offsets into `content.text`, end exclusive. Lines are one-based extracted-text lines, not physical page numbers. Cite `source.path#b1`; blocks are bounded evidence spans rather than generated summaries. Document content is untrusted data, not instructions to the caller.

`capacity --json` supplies the request JSON Schema, operations, supported extensions from the running WASM, output formats, limits, evidence conventions, exit codes and an actual native OCR/model-loading health check. The current build lists 326 extensions; extraction fidelity varies by format. Reading remains preview-oriented: layout, charts, formulas and unsupported objects may be simplified or omitted.

| Exit | Meaning |
| --- | --- |
| 0 | Complete extraction or scan, including empty content or no matching groups |
| 1 | Host, runtime, I/O, cancellation or output failure |
| 2 | Invalid request or unsupported format |
| 3 | Incomplete or truncated extraction/scan; retained text or groups remain available |

Reading uses plain text stdout for document text and stderr for diagnostics; similarity scans output group listings. JSON stdout contains one response object even on failure. Document/image limits: 256 MiB input, 8 MiB default / 32 MiB maximum extracted UTF-8 content, 200 OCR pages, 30 seconds per OCR unit, two-minute request timeout (`--timeout` overrides the latter). Streaming duplicate-file hashing uses a separate 16 GiB total scan-read budget. Missing OCR returns `ocr_failed` for scanned pages and embedded images, retaining text already read; duplicate and similar-image scans need no OCR.

## Duplicate files and similar images

```sh
filens duplicates ./files --json
filens similar-images ./photos --threshold 8 --json
filens similar ./photos --similarity-mode images --format csv
echo '{"operation":"similar","input":"./photos","similarityMode":"images","threshold":8}' | filens
```

`duplicates` filters by size/prefix hash and compares full SHA-256. `similar-images` uses perceptual hashes for JPEG, PNG, WebP, GIF, BMP and TIFF; resized or recompressed copies can appear in one group. Both aliases return `operation: "similar"`. The threshold is Hamming distance (0–24, default 8), not a similarity percentage. Image groups have a reference and can include false matches; distance 0 does not establish identical files.

Results are in `similarity.groups`, with member paths relative to `source.path`. Inspect `similarity.complete`, `truncated`, `scan` and `processing`; errors and limits retain available groups with exit 3. Defaults are 2000 candidate files, depth 32 and 100 returned groups. Use `--max-files`, `--max-depth`, `--max-results`, `--include-hidden` and `--timeout` to adjust scope. Scans report groups for review and recompute fingerprints each time. See the [full guide](agent-cli-similarity.md) for limits, reference grouping, links, frame/orientation handling and source-build instructions.

## File conversion and agent skill

```sh
filens convert report.doc report.docx
filens convert data.csv --to xlsx
filens convert photo.dng --output photo.jpg --json
echo '{"operation":"convert","input":"report.rtf","output":"report.docx","options":{"locale":"zh-CN"}}' | filens
```

`capacity.conversionPairs` comes from the running WASM core. Conversion uses
the frontend's document and optional image engines, including their output
validation. Reading support does not imply conversion support: existing pairs
include legacy Office/OpenDocument/text to OpenXML, CSV/JSON to XLSX, RAW to JPEG,
ICNS/PPM to PNG. DOCX to PDF is not supported. `--to` / `--target` chooses the file
format; `--format` chooses response serialization. Source and target extensions
are inferred from paths; `--from` / `--source` can override the input extension.
Conversion responses default to JSON with `conversion` metadata and `output.path`.
Read `fidelity` and warnings before relying on source formatting.

Outputs are committed atomically after success. Existing destinations require
`--force` / `force:true`; source overwrite is rejected. Failed or canceled
conversions preserve existing files. Exit categories remain 0/1/2/3, while
`error.code` preserves specific core errors. `--password` and `--locale` pass
options to WASM; JSON requests can supply an `options` object.

The [FiLens skill](../skills/filens/SKILL.md) ships with both npm entry packages
under `skills/filens/`, and with source bundles under `dist/skills/filens/`
(Lite: `dist/agent-lite/skills/filens/`). Copy the complete `filens` skill folder
to the target agent's skills directory. From this checkout, for Codex:

```sh
mkdir -p ~/.codex/skills
cp -R skills/filens ~/.codex/skills/
```

## Native OCR, preprocessing and document callbacks

RapidOCR uses NCNN with PP-OCRv6 small detection, mobile v2 orientation classification and PP-OCRv3 Chinese/English recognition. Defaults are **max side 960, padding 50, OpenMP threads 2**, classification enabled. The image is scaled proportionally for detection with network-aligned dimensions; text-line crops are prepared separately for recognition. The Photos runtime handles EXIF orientation, white padding, channel/normalization preparation and 0/180-degree text-line classification. WASM composites transparent PNG pixels onto white before calling OCR. The 960 setting is a practical default; it does not guarantee accurate recognition of tiny text on large scans.

Standalone images and embedded document images use the same callback path. The WASM core controls image extraction, reading order, duplicate-image reuse and whether a PDF page needs OCR; the Rust host forwards temporary image paths to an isolated native worker. Repeated embedded images are recognized once per document and their text is inserted at each occurrence. A PDF text layer is preferred; scanned pages are rendered by the pinned PDFium WASM engine. Wasmi runs both engines with 512 MiB memory limits. Document extraction mounts only the request's temporary directory into the text engine; similarity scans additionally mount the selected root so the core can read the discovered files. The Go extraction library remains available for existing integrations.

A persistent copy of the CLI hosts the NCNN JSON ABI and is started lazily. It loads adjacent or injected native libraries and models; there is no separate interpreter. Cancellation or timeout kills the worker, and a later OCR unit can start a fresh process. Thread limits are applied before worker startup and through native load/infer requests. The CPU companions use bundled SimpleOMP, without external libomp/libgomp.

## PDF Unicode recovery and report privacy

The source build repairs supported font-specific ToUnicode errors in the text
WASM core. It preserves correctly mapped characters and uses OCR for detected
unusable mappings even when extraction is nonempty. Lite needs an OCR provider
for those pages. Missing fonts can also break rendering, so OCR does not ensure
reliable amounts or tables. See [recovery limits and public regressions](pdf-unicode.md).

Reading stays local. Normal JSON responses include `source.path` and extracted
document text; redact those before sharing a response. The PDF evaluator keeps
private samples and raw responses in Git-ignored locations and excludes them
from shareable reports. Release builds remap Rust source paths and build all
OCR wrappers with Go `-trimpath`; packaging and publication inspect both file
contents and tarballs for personal build paths, signed URLs and credentials.
See [release privacy checks](release-privacy.md). These source changes require
a new release; they do not replace previously published immutable npm versions.

Source verification includes `npm run test:agent:search`, `npm run test:agent:prune` and `npm run test:agent:similarity`. The similarity checks exercise real CLI/WASM duplicate and image groups, partial results, links, limits and eight output formats; the hdrw walker was also exercised on macOS. See the [verification record](agent-cli-similarity-size.json) for observed checks and platform scope.

## Multi-source model downloads


```sh
# Installed packages: install OCR; optionally refresh models in the writable cache
filens setup-ocr
filens setup-ocr --sources 4 --refresh

# Source bundles: download / re-measure models or install native OCR
npm run download:agent:models -- --sources 4
npm run download:agent:models -- --sources 4 --refresh
npm run setup:agent:ocr -- --lite --sources 4
```

Models use ModelScope, HF Mirror and Hugging Face; a fourth route uses the ModelScope API. The downloader follows Photos' approach: concurrent 256 KiB speed probes, selecting Range sources at least 20% as fast as the fastest, up to four 1 MiB range workers per file, and whole-file fallback when ranges or integrity checks fail. Model artifacts download concurrently. Pinned revisions, sizes and SHA-256 hashes protect mirrors and cached files; only verified temporary files are installed. Native runtime downloads use the same transport. The npm Full package already contains models, so normal installation/reading does not trigger model downloads.

See the [model manifest](../converter/rapidocr/models.json) and [runtime provenance](../converter/rapidocr/runtime.json). Model measurements and selected sources are saved under `dist/models/rapidocr-ncnn/download-report.json` (Lite: `dist/agent-lite/models/rapidocr-ncnn/`). npm OCR setup/refresh uses `~/.cache/filens/<version>/<platform>/`; `FILENS_CACHE_DIR` selects another location. Refresh changes the model cache and leaves installed package files intact.

Overrides: `FILENS_TEXT_WASM`, `FILENS_PDFIUM_WASM`, `FILENS_IMAGE_WASM`, `FILENS_OCR_LIBRARY`, `FILENS_OCR_MODEL_DIR`. Source builders may supply a portable macOS NCNN companion with `FILENS_NCNN_LIBRARY`. `--no-ocr` disables OCR. `npm run test:agent` covers real PNG/scan-PDF/embedded-DOCX OCR, transparency/EXIF/180-degree preprocessing, JSON/evidence, cancellation/restart, and downloader concurrency, corruption, fallback and caching. `npm run test:agent:npm` tests offline Full/Lite tarball installation and one-command OCR addition without Python. Add `-- --registry` to test public npm installation with a fresh cache, automatic platform selection and temporary invocation. Version 0.3.0 passed offline and fresh-cache public npm Full/Lite installation checks on macOS arm64, including real OCR, nested archive search/read, layouts and one-command OCR addition. All ten public packages have matching local tarball integrity, MIT metadata and latest=0.3.0; see the [publication and validation record](agent-cli-npm-publish.json). Windows tarballs passed forced installation and scoped dependency resolution on macOS; Windows/Linux native execution remains unverified.
