# FiLens text extraction host

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
optional PDFium WASM document engine; only pages without meaningful text are
rendered (200 DPI, 32 million pixels maximum). Each page is released immediately.
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

The fixture suite includes controlled format containers and public Office,
iWork and CAD samples. It is a regression baseline, not a guarantee that every
feature of every application is lossless. See testdata/SOURCES.md for provenance.
