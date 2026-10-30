# filens Agent CLI

<!-- agent-cli-size:npm:start -->
**v0.4.1 · MIT · CLI 2.15 MiB · Lite 8.04 MiB · Full 31.25 MiB** (macOS arm64, installed; Full includes OCR models).

| Platform | CLI executable | Lite installed / download | Full installed / download |
| --- | ---: | ---: | ---: |
| darwin-arm64 | 2.15 MiB | 8.04 / 6.14 MiB | 31.25 / 20.34 MiB |
| linux-x64 | 1.89 MiB | 7.78 / 6.86 MiB | 36.74 / 22.84 MiB |
| linux-arm64 | 1.78 MiB | 7.68 / 6.75 MiB | 31.10 / 20.54 MiB |
| win32-x64 | 1.81 MiB | 7.71 / 6.78 MiB | 36.48 / 23.01 MiB |

Totals add the launcher and selected platform packages from npm pack. Node.js, npm caches, filesystem overhead and the optional frontend preview package are excluded. Bundled dependencies retain their own licenses; see THIRD-PARTY-NOTICES.md in the platform packages.
<!-- agent-cli-size:npm:end -->

Read local documents and provide text and cited evidence for agents. Supports
Chinese/English reading intents, text, JSON, Markdown, HTML, YAML, XML, CSV and
TSV. Source layouts include PDF/OCR coordinates and logical document structure.
Version 0.3.0 also provides model-free extractive summaries through
`summarize` / `prune`, with optional lexical focus and original-text provenance.
Check `capacity.operations` when using an older installation.
Paraphrasing, translation and question
answering belong to the calling agent. Parsing and pruning use the shared WASM core.

```sh
# Full: native RapidOCR NCNN and models included; no Python
npm install -g filens-cli
filens '读取 "report.pdf"，以 JSON 输出'
filens 'what can you do as json'

# Lite: CLI + WASM; add native OCR when needed
npm install -g filens-cli-lite
filens setup-ocr
filens 'read "scan.pdf" as json'
filens convert report.doc report.docx
filens convert data.csv --to xlsx

# Temporary invocation; no global installation
npx --yes filens-cli-lite read report.pdf --json
```

The CLI is Rust, built with stripped symbols, LTO and size optimization.
Windows/Linux executables use UPX `--best --lzma`, followed by `--test`.
Mach-O arm64 is unsupported by UPX and remains uncompressed.
WASM resources use fast gzip compression and are decoded locally as needed.
The package includes `skills/filens/SKILL.md`, with standard YAML front matter
and agent guidance for evidence, partial results, OCR and coordinate units.
Copy `skills/filens/` to your agent's skills directory to enable discovery.

## More examples

Version 0.4.0 adds `filens preview FILE` using the same browser-local engines.
The first preview installs the separate `filens-preview` package; run
`filens setup-preview` to prepare it in advance. Subsequent previews work offline.
Frontend assets are measured separately from the CLI installation. See the [preview guide](https://github.com/IceWhaleTech/filens/blob/main/packages/preview/README.md#cli-preview)
for building the single-file/split runtime and packaging it with `--with-preview`.

```sh
filens '支持哪些格式？用 JSON 返回'
filens '请读取 "季度 报告.txt"，以纯文本输出'
filens '帮我理解“会议纪要.docx”，用 JSON 返回'
filens 'Please extract all text from "report.pdf" in JSON'
filens '识别 "invoice.png" 中的文字，以 JSON 输出'
filens '理解 "embedded-images.docx"，以 JSON 输出'
filens 'read "report.docx" as markdown'
filens '获取 "scan.pdf" 的布局，以 YAML 输出'
filens layout invoice.png --format json
filens read data.xlsx --format csv
echo '{"operation":"understand","input":"report.pdf"}' | filens
```

Natural language recognizes a bounded set of document intents. `understand`
returns source text and evidence for the calling agent; it does not generate
an answer. Reading and pruning accept one local file per request. Builds advertising `summarize` select
key original excerpts without an LLM, using density/TF-IDF, optional BM25 focus
and cosine-diversity pruning. For example:

```sh
filens summarize report.pdf --query 'budget risk' --summary-chars 1000 --json
filens '提取 "report.pdf" 的关键内容，关注预算和风险，以 JSON 输出'
```

Inspect `content.summary` for original offsets, `sourceComplete`, `omitted`,
`sampled` and per-excerpt `clipped` markers. The default budget is 30% of source
characters, rounded up and capped at 2000 characters. Scores are ranking weights,
not confidence, and an empty lexical match does not prove the topic is absent.

Version 0.3.0 includes directory-wide `search` with BM25, case-sensitive literal
and filename modes, original excerpts and optional layout. Check
`capacity.operations` for `search` when using an older version.

```sh
filens '在 "./documents" 中搜索 "预算 风险"，以 JSON 输出'
filens 'search "./documents" for "budget risk" as markdown'
filens search ./documents --query FILENS2026 --search-mode exact --json
filens 'search "documents.zip" for "budget risk" as json'
filens read 'documents.zip!/attachments.tar.gz!/report.pdf' --layout --json
```

macOS uses native FTS and does not embed hdrw. Windows/Linux embed compiled
private hdrw WASI for mounted-directory enumeration; no private source or raw
device access is needed. Search keeps its catalog and extracted text in request-local
memory, with no persistent index/body cache or source hashing. Common text decoding and
ranking reuse the frontend Rust core directly; document extraction uses WASM.
Embedding-based semantic retrieval is not implemented. See the
[search guide](https://github.com/IceWhaleTech/filens/blob/main/docs/agent-cli-search.zh-CN.md)
for scope, limits, provenance and partial results.

Builds advertising `capacity.search.archives` automatically traverse ZIP,
TAR and GZIP containers, including nested archives up to eight layers. Search
results retain virtual member paths and structured container chains; the same
paths support reading, layouts and summaries, including OCR. Expansion uses
bounded request-local temporary files. RAR/7z and archive password decryption
are not currently supported.

## Duplicate files and similar images

Version 0.3.0 provides Czkawka-style directory scans. Check `capacity.operations`
for `similar` when using an older installation.

```sh
filens duplicates ./files --json
filens similar-images ./photos --threshold 8 --json
filens similar ./photos --similarity-mode images --format csv
echo '{"operation":"similar","input":"./photos","similarityMode":"images","threshold":8}' | filens
```

Duplicate scans filter by size and prefix hash, then compare full-file SHA-256.
Image scans use perceptual hashes for JPEG, PNG, WebP, GIF, BMP and TIFF, including
resized and recompressed variants. No OCR or model is required. Threshold is a
Hamming distance from 0 to 24 (default 8), not a confidence percentage.

Defaults are 2000 candidate files, depth 32 and 100 returned groups; adjust
`--max-files`, `--max-depth`, `--max-results` and `--timeout` as needed. Inspect
`similarity.complete`, `truncated`, `scan` and `processing`; partial scans retain
groups and return exit 3. Paths are relative to `source.path`. Scans report groups
for review; perceptual matches can miss altered images or match different images.
Similarity fingerprints are recomputed each time. The document search cache and
`--no-cache` flag do not apply. See the
[similarity guide](https://github.com/IceWhaleTech/filens/blob/main/docs/agent-cli-similarity.md)
for source builds, limits, grouping semantics and the measured resource-size delta.

## Limits and conversion

Paraphrasing, translation, questions, field extraction, page selection and URL fetching
are not implemented by this CLI. Some unsupported phrasings fall
back to reading the whole file: “only the first page” still reads all pages,
“only list amounts” still returns all text.
Use the JSON request schema or explicit `--format` when strict validation is
required. Quote file paths inside natural-language sentences.

`convert` uses the same WASM conversion engines as the frontend. Inspect
`capacity.conversionPairs` before choosing a target; text extraction support
does not imply conversion support. Examples include DOC/RTF/ODF/text to
OpenXML, CSV/JSON to XLSX, camera RAW to JPEG and ICNS to PNG. DOCX to PDF is
not a supported pair. Target extensions are inferred from the output path or
selected with `--to`; `--format` selects response serialization. Conversion
responses default to JSON and include `output.path`, `conversion.fidelity`
and warnings. Existing outputs require `--force`. Failed and canceled
conversions leave destinations intact.

JSON/YAML/XML preserve the full response protocol. Markdown/HTML export document
content with headings and tables; `--layout` adds a metadata appendix. CSV/TSV
export a single table as rows, or layout blocks as records when `--layout` is
requested. `layout` defaults to JSON. PDF coordinates use points and a top-left
origin; image OCR uses orientation-corrected pixels. Embedded-image coordinates
are local to each image. Flow documents expose logical structure, without
invented page positions. Detection scores do not measure transcription accuracy.

OCR output may contain errors, including stray text detected in landscape
photos. `ok=true` means extraction completed; it does not measure OCR accuracy.

Supported PDF ToUnicode errors are repaired per font in the shared WASM core;
unusable text mappings can require OCR even with a nonempty text layer. Missing
fonts and incorrect rendering may still make numeric tables unreliable.
JSON responses contain local source paths and document text; redact them before
sharing. Private evaluation inputs and raw reports are excluded from packages.
EXIF orientation is applied, while a physically inverted image may still have
its text lines returned in reversed order.

Version 0.3.0 provides Windows 10/11 x64, macOS 12+ arm64 and Linux glibc 2.17+ x64/arm64 packages. Windows/Linux native execution remains pending validation. Only the current
platform is installed. Node.js 20.11+ is required for the npm launcher; native
binaries also work directly. No Python, Homebrew or compiler is needed at runtime.
RapidOCR defaults: max side 960, padding 50, orientation classification enabled,
OpenMP threads 2. Reads run offline after installation.

`filens setup-ocr --sources 4 --refresh` re-downloads pinned models through
Hugging Face, HF Mirror, ModelScope and the ModelScope API route. Sources are
probed concurrently for speed, Range downloads run in parallel, and every
artifact is verified by size and SHA-256. Cache: `~/.cache/filens`, configurable
with `FILENS_CACHE_DIR`. No automatic network access occurs while reading.

The full and lite packages provide the same `filens` executable name; install
one profile at a time. Platform packages are implementation components.

[Protocol, limitations and source build](https://github.com/IceWhaleTech/filens/blob/main/docs/agent-cli.md)

Locally built release tarballs can also be installed with
`npm install -g /path/to/filens-cli-0.4.1.tgz /path/to/filens-cli-PLATFORM-0.4.1.tgz /path/to/filens-ocr-PLATFORM-0.4.1.tgz`.
