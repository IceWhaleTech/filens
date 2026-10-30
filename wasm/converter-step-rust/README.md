# Rust STEP core

The production browser STEP parser, unit preparation and tessellation adapter live
in `src/`. They are promoted from the tested refined adapter, with a finite
face-normal fallback for invalid/zero surface normals at degenerate points. No STEP
parsing or meshing is implemented by the TypeScript host or backend.

`npm run build:step:wasm` generates an isolated Cargo manifest, uses the committed
`Cargo.lock`, fetches truck at `78d699b0792b39e27c2bf073b682986701644e91`, checks and
applies `docs/upstream/truck/0004-refine-trimmed-surfaces-and-poles.patch`, and builds
with Rust 1.93.0 / `wasm32-wasip1`. Binaryen `-Oz` strips debug/producers metadata.
The generated manifest and third-party checkout are under `tmp/rust-engines/`;
no third-party source edits are accepted beyond the recorded patch.

The resulting WASM, input hashes, dependency notices and exact compressed sizes
are recorded under `packages/step/vendor/`. Normal browser-library builds verify
those committed inputs and need no Rust toolchain. The initial promotion uses
`node scripts/build-step-wasm.mjs --from-validated`, which accepts only the
already evaluated adapter/lock/patch hashes.

This remains an approximate preview core. See
[the geometry checks and remaining sphere discrepancy](../../docs/rust-step-refined.zh-CN.md).
