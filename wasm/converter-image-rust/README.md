# Rust image converter

Optional WASI image conversion module for Filens. The production artifact is
`../converter-image/dist/converter-image.wasm`.

The module currently converts camera RAW formats to JPEG and ICNS to PNG. RAW
conversion uses an embedded 8-bit JPEG when available, then falls back to a
small sensor preview through `rawloader`. It is intentionally separate from
`converter-core.wasm` so document conversions do not download camera data and
RAW decoding code.

X3F files with no JPEG or an embedded JPEG below 2048 pixels on its longest
side are developed from the original Foveon sensor, rather than enlarging a
small preview. Legacy mapped-Huffman and TRUE/Merrill sensors are supported;
Quattro sensor compression is not. Camera identity comes from X3F properties,
so an EXIF-bearing JPEG is not required. Ordinary X3F output fits within
2048 pixels without upscaling. X3F uses daylight white balance and the shared
lightweight color pipeline, without vendor rendering or CAMF adjustments.

The image options JSON accepts `preserveSensorGeometry: true` for calibrated RAW
panorama previews. This bypasses embedded JPEGs, retains the complete sensor
raster without EXIF rotation, and downsamples to a longest side of at most 4096
pixels. Ordinary sensor fallback remains bounded to 2048 pixels, applies active
area cropping and EXIF orientation, and shares white balance, camera-to-sRGB
matrix conversion, and sRGB encoding. Neither path provides full RAW development
or vendor picture-profile parity. Input is limited to 256 MiB.

The color contract follows Photos' `internal/rawthumbnail/native_impl.inc` and
`native_color_test.go` at revision `5967f350d9b169211379b91a3a097ee1883373e6`:
camera white balance with a daylight fallback, sensor black/white levels,
camera-basis normalization before matrix inversion, clipping white-balanced
camera channels before color conversion, fixed sRGB transfer without histogram
auto-brightening, and signed DNG `BaselineExposure` bounded to ±4 EV. Missing
exposure or an invalid sentinel uses 0 EV; invalid levels or color matrices
return an error. Synthetic no-JPEG DNG tests check 18% gray near 118/255 and
−1 / +1 EV near 85 / 162.

Sensor previews use cached CFA sampling kernels, integer normalization tables,
preallocated output rows and a build-generated 16-bit linear-to-sRGB table.
The last step differs from the exact transfer function by at most one 8-bit
code value, including shadows. These changes keep the ordinary 2048-pixel limit.
Camera profiles are parsed lazily, including the added Nikon D3S profile; see
[rawloader provenance and local changes](vendor/rawloader/FILENS-CHANGES.md).

Five no-embedded-JPEG camera samples lead both measured LibRaw-Wasm 1.6.0
half-size configurations by 1.11–2.14× for sensor development and preview-canvas
drawing. This scope allows different intermediate sizes and tone; display
waiting is reported separately. See the
[browser comparison and actual previews](../../docs/performance-comparison.md)
and [reproduction instructions](../../benchmarks/frontend/README.md).

Current optimized size (Rust release optimization 3, LTO, `wasm-opt -O3`;
gzip level 6 and Brotli quality 11):

| Artifact | Raw | Gzip | Brotli |
| --- | ---: | ---: | ---: |
| `converter-image.wasm` | 1,126,174 | 307,362 | 221,235 |
