# Rust converter core

Rust WASI implementation of `converter-core`. It covers every pair in `../converter-core/manifest/conversions.json` and now produces the production artifact.

The public conversion policy is read directly from `../converter-core/manifest/conversions.json`; there is no second Rust-only format list.

Build with `npm run build:wasm`; test with `npm run test:wasm` and `npm run test:wasm-smoke`.

## Current milestone

- Covered: all 256 source formats, including the final BIFF spreadsheet and PowerPoint binary families.
- Production: `../converter-core/dist/converter-core.wasm` is Rust.

Size snapshot from `npm run report:wasm-sizes` (Binaryen 131, Brotli quality 11):

| Artifact | Raw | Gzip | Brotli |
| --- | ---: | ---: | ---: |
| `converter-core.wasm` | 837,335 | 381,175 | 308,888 |
| `converter-image.wasm` (optional) | 671,128 | 209,529 | 167,021 |

RAW conversion in the core only copies the largest standard 8-bit embedded
JPEG. Full sensor decoding lives in the optional `converter-image.wasm` module,
so document and panorama users do not download the RAW decoder and camera data.

PPM conversion runs entirely in this core and produces PNG. Both P3 text and P6
binary RGB are supported, including header comments, arbitrary maximum sample
values (1–65535), and 8/16-bit samples. PNG retains the source sample depth;
values are scaled to the PNG range. Only the first image in a stream is used.
Input is limited to 256 MiB and decoded RGB data to 128 MiB.

The retired Go core was 82.8% larger by Brotli size at equivalent fixture coverage.
