# filens Agent CLI

Read local documents and provide text and cited evidence for agents. Supports
Chinese/English reading intents, text, JSON, Markdown, HTML, YAML, XML, CSV and
TSV. Source layouts include PDF/OCR coordinates and logical document structure.
Semantic reasoning is
performed by the calling agent. All document parsing uses the shared WASM core.

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
WASM resources use fast gzip compression and are decoded locally as needed.
The package includes `skills/filens/SKILL.md`, with standard YAML front matter
and agent guidance for evidence, partial results, OCR and coordinate units.
Copy `skills/filens/` to your agent's skills directory to enable discovery.

## More examples

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

Natural language recognizes a bounded set of reading intents. `understand`
returns source text and evidence for the calling agent; it does not generate
an answer. One local file per request. Summarization,
translation, questions, field extraction, page selection and URL fetching
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

Packages support macOS 12+ arm64 and Linux glibc 2.17+ x64/arm64. Only the current
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
`npm install -g /path/to/filens-cli-0.2.0.tgz /path/to/filens-cli-PLATFORM-0.2.0.tgz /path/to/filens-ocr-PLATFORM-0.2.0.tgz`.
