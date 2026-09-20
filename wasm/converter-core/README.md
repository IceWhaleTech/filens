# Conversion manifest

This directory retains the public conversion manifest and a thin Go policy adapter used by the wazero host.

All parsing, conversion, and OpenXML generation live in `../converter-core-rust`.

- `manifest/conversions.json`: shared source-to-target policy
- `manifest/manifest.go`: Go host adapter for validation and capability reporting
- `go.mod`: module boundary required by the Go host replacement

Build and test the production WASI core from the repository root:

```sh
npm run build:wasm
npm run test:wasm
npm run test:wasm-smoke
```
