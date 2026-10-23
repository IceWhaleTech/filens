# Rust image converter

Optional WASI image conversion module for Filens. The production artifact is
`../converter-image/dist/converter-image.wasm`.

The module currently converts camera RAW formats to JPEG and ICNS to PNG. RAW
conversion uses an embedded 8-bit JPEG when available, then falls back to a
small sensor preview through `rawloader`. It is intentionally separate from
`converter-core.wasm` so document conversions do not download camera data and
RAW decoding code.

The image options JSON accepts `preserveSensorGeometry: true` for calibrated RAW
panorama previews. This bypasses embedded JPEGs, retains the complete sensor
raster without EXIF rotation, and downsamples to a longest side of at most 4096
pixels. Ordinary sensor fallback remains bounded to 2048 pixels, applies active
area cropping and EXIF orientation, and shares white balance, camera-to-sRGB
matrix conversion, and sRGB encoding. Neither path provides full RAW development
or vendor picture-profile parity. Input is limited to 256 MiB.

Current optimized size (`wasm-opt -Oz`, Brotli quality 11):

| Artifact | Raw | Gzip | Brotli |
| --- | ---: | ---: | ---: |
| `converter-image.wasm` | 694,781 | 222,754 | 176,144 |
