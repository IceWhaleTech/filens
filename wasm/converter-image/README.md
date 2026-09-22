# Image converter WASM

`dist/converter-image.wasm` is the optional image conversion artifact built by
`npm run build:wasm`. It is loaded only for image conversion routes.

The browser client accepts it through `createWasmConverterClient({ imageWasm })`.
The Go/wazero example can also host this artifact directly for image-only
conversion requests.
