# go-wazero-converter

This example is the Go host shell for `wasm/converter-core/dist/converter-core.wasm`.
It uses wazero to run the WASI CLI entry point with path-based IO:

```sh
converter-core --input /work/in.doc --output /work/out.docx --source doc --target docx --options /work/options.json --result /work/result.json
```

The Go code is intentionally thin. It handles CLI/HTTP plumbing, temporary files, request validation, stable error/result mapping, OpenXML output validation, and invoking WASM. File parsing and conversion logic live in `converter-core.wasm`; do not add format-specific conversion algorithms to this Go wrapper.

## Build And Test

From the repository root:

```sh
npm run build:wasm
npm run test:go-wazero
npm run test:wasm-smoke
```

`npm run test:go-wazero` runs only real Go packages and skips fixture directories. `npm run test:wasm-smoke` rebuilds/checks controlled fixtures, runs the manifest through wazero, validates OpenXML outputs, and inspects generated XML for expected fixture content.

## Supported Matrix

The supported matrix is imported from `wasm/converter-core/manifest/conversions.json`; the Go host does not keep its own policy list.

| Source | Target |
| --- | --- |
| `ppt`, `pps`, `pot`, `dps`, `dpt`, `odp`, `otp`, `fodp` | `pptx` |
| `ppsx`, `potx` | `pptx` |
| `doc`, `docm`, `dot`, `wps`, `wpt`, `rtf`, `odt`, `ott`, `fodt` | `docx` |
| `dotx` | `docx` |
| lightweight text, markup, config, log, template, and source-code formats | `docx` |
| `xls`, `xlsm`, `xlt`, `et`, `ett`, `ods`, `ots`, `fods` | `xlsx` |
| `xltx` | `xlsx` |
| `dbf`, `slk`, `dif`, `csv`, `tsv`, `tab`, `psv`, `json`, `jsonl`, `ndjson`, `jsonlines`, `ldjson` | `xlsx` |

Unsupported pairs are rejected before WASM execution with `unsupported_format`. `docm`/`xlsm` are normalized after stripping macro parts; other macro-enabled OpenXML, OpenXML add-ins, ODF drawings, legacy OpenOffice XML, CAD/3D/media/iWork/archive/ebook/diagram/mind-map, and standalone image conversions are not default routes.

## CLI

Run one conversion:

```sh
go run ./cmd/converter-cli \
  --wasm ../../wasm/converter-core/dist/converter-core.wasm \
  --input ./fixtures/doc/sample.wps \
  --output ./tmp/sample.wps.docx \
  --source wps \
  --target docx \
  --result -
```

`--source` and `--target` can be omitted when input/output file extensions infer the same supported pair. `--options` can point to JSON with `password` and `locale`; direct `--password` and `--locale` flags override the file.

Inspect capabilities without converting:

```sh
go run ./cmd/converter-cli --capabilities --wasm ../../wasm/converter-core/dist/converter-core.wasm
```

## Batch

Run the checked-in fixture manifest:

```sh
go run ./cmd/converter-batch \
  --wasm ../../wasm/converter-core/dist/converter-core.wasm \
  --manifest ./fixtures/manifest.json \
  --report ./tmp/wasm-batch-report.json
```

Per-job fields override `defaults`. Use `--report -` to print the aggregated JSON report to stdout. Batch reports include total/success/failure counts plus `byBackend`, `byFidelity`, and `byErrorCode` maps.

## HTTP

Run the sample endpoint:

```sh
go run ./cmd/converter-server \
  --wasm ../../wasm/converter-core/dist/converter-core.wasm \
  --addr 127.0.0.1:8080 \
  --path /convert
```

The server requires `--wasm` or `CONVERTER_CORE_WASM`. It exposes `/healthz` by default; use `--health-path /capabilities` to rename it or `--health-path ""` to disable it.

The multipart converter endpoint is compatible with `createHttpConverterClient()` and accepts `sourceFormat`, `targetFormat`, optional `name`, `password`, `locale`, and a `file` field. Successful responses include the converted OpenXML as base64 plus format metadata; errors include stable `errorCode` and `errorMessage` fields.

```ts
createHttpConverterClient({ endpoint: 'http://127.0.0.1:8080/convert' })
```

## Error Codes

Process exit codes map to WASI/core error codes: `unsupported_format=2`, `password_required=3`, `password_invalid=4`, `parse_error=5`, `conversion_failed=6`, `io_error=7`, and `engine_unavailable=8`.

HTTP status mapping is shared with the TypeScript client expectations: `unsupported_format=415`, password errors `401`, `parse_error=422`, `conversion_failed=502`, `engine_unavailable=503`, and IO errors `500`.

Every JSON response also includes lightweight `X-Preview-*` headers for non-JSON clients: `X-Preview-OK`, `X-Preview-Format`, `X-Preview-Source-Format`, `X-Preview-Target-Format`, `X-Preview-Backend`, `X-Preview-Fidelity`, `X-Preview-Error-Code`, and `X-Preview-Error-Message`.

## Fidelity

`converter-core.wasm` currently provides lightweight structured parsing and OpenXML output for the bundled allowed document, text/source, and table-like samples. It is suitable for previews, indexing, smoke tests, and graceful fallback. It is not a production-fidelity replacement for Office layout conversion, formula recalculation, charts/media reconstruction, animations, macros, or full style fidelity.
