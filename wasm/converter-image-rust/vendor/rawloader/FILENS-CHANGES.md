# filens changes to rawloader 0.37.2

Source: crates.io `rawloader` 0.37.2, LGPL-2.1; upstream copyright and LICENSE are preserved. Sensor decompression algorithms remain upstream's. `data/cameras.toml` joins all 507 upstream camera files in sorted path order, with the original content preserved.

The original loader parsed every camera profile and allocated every CFA on the first decode. The local build script resolves camera modes/aliases into sorted static descriptors; the runtime parses and allocates only the selected profile. File-size identification remains available. A differential test checks every generated profile against the original eager loader, including file-size collisions.

The separate Nikon D3S profile adds 12/14-bit sensor decoding. Its D65 matrix, black/white levels and crop margins come from [dnglab/rawler's Nikon D3S profile](https://github.com/dnglab/dnglab/blob/main/rawler/data/cameras/nikon/d3s.toml), also LGPL-2.1. Their left/top/right/bottom crop margins are reordered to rawloader's top/right/bottom/left field; the crop already lies inside the active area. This changes metadata coverage, not NEF decompression.

No backend converter is added. This library is built into the shared frontend image WASM core.

The DNG metadata adapter additionally exposes signed `BaselineExposure` on `RawImage` (zero for other decoders) and rejects missing or incorrectly sized color matrices instead of guessing a color basis. The shared image core applies the bounded EV, validates calibration, and uses the Photos color contract described in the parent README. These are metadata/color handling changes; they do not add a second sensor decoder.
