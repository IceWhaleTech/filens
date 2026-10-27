# filens changes to rawloader 0.37.2

Source: crates.io `rawloader` 0.37.2, LGPL-2.1; upstream copyright and LICENSE are preserved. Sensor decompression algorithms remain upstream's except for the X3F implementation described below. `data/cameras.toml` joins all 507 upstream camera files in sorted path order, with the original content preserved.

The original loader parsed every camera profile and allocated every CFA on the first decode. The local build script resolves camera modes/aliases into sorted static descriptors; the runtime parses and allocates only the selected profile. File-size identification remains available. A differential test checks every generated profile against the original eager loader, including file-size collisions.

The separate Nikon D3S profile adds 12/14-bit sensor decoding. Its D65 matrix, black/white levels and crop margins come from [dnglab/rawler's Nikon D3S profile](https://github.com/dnglab/dnglab/blob/main/rawler/data/cameras/nikon/d3s.toml), also LGPL-2.1. Their left/top/right/bottom crop margins are reordered to rawloader's top/right/bottom/left field; the crop already lies inside the active area. This changes metadata coverage, not NEF decompression.

No backend converter is added. This library is built into the shared frontend image WASM core.

The previously unimplemented X3F decoder now reads camera identity from UTF-16
`PROP` sections and develops the full three-channel Foveon sensor. Legacy
format 6 (mapped Huffman and packed differences) and TRUE/Merrill format 30 are
supported. The compression layout and predictor behavior follow Roland
Karlsson's BSD-licensed `x3f_tools`, maintained in
[LibRaw's X3F utilities](https://github.com/LibRaw/LibRaw/blob/0.22.0/src/x3f/x3f_utils_patched.cpp);
the notice is preserved in [X3F-LICENSE.txt](X3F-LICENSE.txt).
`data/sigma.toml` supplies 15 camera models and 43 sensor modes, with matrices
and black levels from LibRaw 0.22.0's
[`colordata.cpp`](https://github.com/LibRaw/LibRaw/blob/0.22.0/src/tables/colordata.cpp)
and white levels/active rectangles from
[`open.cpp`](https://github.com/LibRaw/LibRaw/blob/0.22.0/src/utils/open.cpp),
under LGPL-2.1. X3F white balance currently uses the shared daylight fallback;
CAMF white balance and vendor rendering are not implemented. Quattro sensor
compression is not supported. Offsets, lengths, prefix codes, row offsets and
dimensions are checked before indexing. Synthetic tests cover signed deltas,
row resets, TRUE parity prediction, truncation and invalid code trees.

Full sensor rasters were compared byte-for-byte with rawpy 0.27.1 / LibRaw on
the SD9 sample in rawpy's test corpus and CC0 SD14, DP1 and SD1 Merrill samples
from raw.pixls.us (IDs 4462, 1116 and 4918). All four matched exactly; this is
a decompression check, not a claim of matching vendor-developed color.

The DNG metadata adapter additionally exposes signed `BaselineExposure` on `RawImage` (zero for other decoders) and rejects missing or incorrectly sized color matrices instead of guessing a color basis. The shared image core applies the bounded EV, validates calibration, and uses the Photos color contract described in the parent README. These are metadata/color handling changes; they do not add a second sensor decoder.
