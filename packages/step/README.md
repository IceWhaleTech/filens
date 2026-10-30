# filens-step

Read STEP/STP geometry locally in a browser with a Rust WebAssembly core. The
package has no runtime dependencies, CLI, Python, server or CAD installation.
Parsing, units, assembly placement and tessellation run inside WASM. The
TypeScript adapter supplies an isolated in-memory WASI host and typed mesh data.

Release candidates use the npm `next` tag after publication:

```sh
npm install filens-step@next
```

```ts
import { readStep, createStepReader } from 'filens-step';

const mesh = await readStep(await file.arrayBuffer(), { tolerance: 0.1 });
// Non-indexed triangles, in millimetres; three Float32 coordinates per vertex.
console.log(mesh.positions, mesh.normals, mesh.triangleCount, mesh.warnings);

// Optional URL/bytes/precompiled-module override for a custom asset host or CSP.
const reader = createStepReader({ wasm: '/assets/filens-step.wasm' });
const another = await reader.read(await file.arrayBuffer(), { signal });
```

The default WASM URL resolves relative to the installed ESM module. Serve the
WASM asset emitted by your bundler with the JavaScript. The module is fetched
and compiled only on the first read, then reused. Every read creates a separate
WASM instance and virtual filesystem. Failed fetches can be retried. The
default tolerance is 0.1 mm; input is limited to 64 MiB. `AbortSignal` cancels
asynchronous loading, but synchronous tessellation itself cannot be interrupted
on the same JavaScript thread. Large files can be loaded in a caller-owned worker.

With Three.js, use the returned arrays directly:

```ts
geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
// No index buffer is needed.
```

This is an approximate preview, not a certified CAD geometry conversion. The
tested 44 files with embedded solids all produce meshes without missing faces;
43 pass the recorded geometry screen. `HEAD_BACK.stp` retains a trimmed-sphere
region/orientation disagreement with OCCT. Tightening tolerance is not a known
fix for it. Source colors, names and the assembly tree are omitted. External
assembly references need their part files; multi-file assembly loading is not
implemented. Empty geometry and incomplete faces are reported as errors rather
than silently accepted as a complete model.

The bundled WASM is **947,225 bytes** raw, **334,093 bytes** with gzip level 9,
or **260,639 bytes (254.53 KiB)** with Brotli 11. Those are WASM-only sizes, not
the npm tarball or complete download. JavaScript, TypeScript declarations,
provenance and dependency notices are also included. See
[the size and geometry evidence](https://github.com/IceWhaleTech/filens/blob/main/docs/rust-step-browser.zh-CN.md).

Build inputs, the pinned upstream commit and exact WASM hash are shipped in
`dist/filens-step-manifest.json`; dependency license texts are in
`dist/filens-step-THIRD-PARTY-NOTICES.txt`. The patched truck core is Apache-2.0;
see [upstream PR #141](https://github.com/ricosjp/truck/pull/141). In the FiLens
workspace, `npm run build:step` builds the browser package without a Rust
toolchain; `npm run build:step:wasm` rebuilds the pinned Rust core.
