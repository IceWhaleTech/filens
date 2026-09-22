# Rust image converter

Optional WASI image conversion module for Filens. The production artifact is
`../converter-image/dist/converter-image.wasm`.

The module currently converts camera RAW formats to JPEG and ICNS to PNG. RAW
conversion uses an embedded 8-bit JPEG when available, then falls back to a
small sensor preview through `rawloader`. It is intentionally separate from
`converter-core.wasm` so document conversions do not download camera data and
RAW decoding code.

Current optimized size (`wasm-opt -Oz`, Brotli quality 11):

| Artifact | Raw | Gzip | Brotli |
| --- | ---: | ---: | ---: |
| `converter-image.wasm` | 671,128 | 209,529 | 167,021 |
