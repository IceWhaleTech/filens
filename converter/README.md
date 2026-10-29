# FiLens text extraction host

For the runnable Agent CLI, natural-language requests, Lite/Full bundles and
default native RapidOCR NCNN (no Python, max side 960, OpenMP=2), see the [Agent CLI guide](../docs/agent-cli.md). The library
below keeps OCR injectable; its new `IncludeStructure` option returns WASM
evidence spans, and `extractor.Capabilities(ctx)` discovers the running text
core's full input set. The distributed CLI is now the [Rust host](../cli/);
`converter/agent` and `converter/cmd/filens` remain as legacy Go integrations.

This optional Go module hosts `converter-text.wasm`; parsing, document order and
OCR decisions live in the Rust WASM core. It does not require an Office suite,
Photos service, x2t, or Tesseract. `TextCapabilities()` is a separate contract
from the preview conversion matrix.

```go
extractor, err := converter.NewExtractor(ctx, converter.Config{
    WASM: textWASM,
    OCR: myOCRProvider, // Recognize(ctx, localImagePath) (string, error)
})
if err != nil { return err }
defer extractor.Close(context.Background())
result, err := extractor.ExtractText(ctx, input, converter.Options{
    MaxBytes: 8 << 20, MaxOCRPages: 200,
})
```

`Result` distinguishes completed empty content, completed content, truncation,
and failure. An incomplete result retains extracted text and has a non-nil
error. A missing OCR provider is an error when an OCR unit is encountered.
`MaxBytes` counts UTF-8 bytes; truncation never splits a code point. PDFs use the
optional PDFium WASM document engine. The text WASM core first attempts bounded,
font-specific ToUnicode recovery; pages without usable mappings, including
nonempty glyph-ID garbage, can also require OCR (200 DPI, 32 million pixels
maximum). There is no global Chinese substitution table. See
[PDF recovery, limits and public regressions](../docs/pdf-unicode.md).
Each page is released immediately.
Repeated embedded image bytes share an OCR result within a file.

Use one extractor per serialized worker, reuse it, and close it at idle/shutdown.
WASM cancellation is cooperative at the host boundary. A provider that invokes
native code must be isolated in a process with a hard timeout; Go context
cancellation cannot stop an uncooperative native call. Input is copied to a private
256 MiB-limited work directory mounted into WASI; native capabilities cannot
access arbitrary WASI paths. The WASM memory ceiling is 512 MiB.

Build and test from the repository root:

```sh
cargo build --locked --release --manifest-path wasm/converter-core-rust/Cargo.toml \
  --features text-extraction --bin converter-text --target wasm32-wasip1
go -C converter test ./...
```

This is an additional indexing artifact. The preview `converter-core.wasm`
remains independent of text extraction dependencies. No inference implementation
or native OCR library belongs to this module. PDFium's engine is pinned by
`go.mod`; Rust parsers and their versions are pinned by Cargo.lock. CAD parsing
uses acadrust (MPL-2.0); the corresponding source is available through Cargo and
its upstream repository, https://github.com/hakanaktt/acadrust. No acadrust source
files are modified or copied here.

PDFium `v1.17.3` and wazero `v1.11.0` are tested as a pair on Linux amd64/arm64.
The older wazero compiler can fault on real ZIP inputs on amd64; upgrading it
alone is incompatible with older PDFium Emscripten stack exports.

Scientific raster inputs are decoded in WASM before the injected OCR call.
Supported profiles include Netpbm/PFM, HDR/EXR, MAT v5 numeric images, FITS image
HDUs and uncoded numeric VIPS. Decoders limit dimensions, pixel counts and
allocation sizes, and reject unsupported array or colour encodings explicitly.
See `testdata/scientific/README.md` for real encoder output provenance and profiles.

The fixture suite includes controlled format containers and public Office,
iWork and CAD samples. It is a regression baseline, not a guarantee that every
feature of every application is lossless. See testdata/SOURCES.md for provenance.
The additional application corpus covers all 54 document extensions with 55
application-written files; five proprietary WPS templates are supplied from an
external cache. See `testdata/application/README.md` for reproducible preparation
and the populated/empty-template coverage boundaries.
