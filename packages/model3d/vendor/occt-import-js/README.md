# STEP exterior-preview importer

This ESM loader and separately loaded WASM are built from
[occt-import-js 0.0.23](https://github.com/kovacsv/occt-import-js/tree/0.0.23)
(commit `c2148e54b456b571238d35cac037d304053d64b2`) and its pinned
[OpenCascade sources](https://github.com/Open-Cascade-SAS/OCCT/tree/d2abb6d844231cb8f29be6894440874a4700e4a5).
Both source archives are verified with SHA-256 before building.

The sole importer API is `ReadStepFile`. A small C++ adapter reads STEP directly
through `STEPControl_Reader`, resolves assembly placements, tessellates the
result, and returns world-space positions, normals, and triangle indices in
flat meshes. Curves/surfaces, shape healing, unit conversion, and all embedded
part instances are retained. The frontend renders a uniform material.

Colors, names, document properties, face metadata, and the assembly tree are
intentionally omitted: this build is for exterior previews, not CAD editing or
inspection. It creates no XCAF document. `ReadFile`, IGES, and BREP bindings are
absent; the frontend's existing STEP/STP routes remain. A file containing only
external references and no embedded triangles is rejected as unpreviewable.
External part-file resolution is not provided.

Measured artifacts (bytes; gzip level 9, Brotli quality 11):

| Build | WASM | gzip | Brotli |
| --- | ---: | ---: | ---: |
| Upstream 0.0.23 | 7,604,031 | 3,110,912 | 2,315,009 |
| Previous Filens preview | 4,466,896 | 2,036,350 | 1,638,367 |
| Exterior preview with lookup table | 3,911,653 | 1,781,978 | 1,471,439 |
| Exterior preview with runtime Bernstein basis | 3,058,441 | 1,251,337 | 1,002,588 |
| Compact numerical tables and shared decimal parser | 2,757,687 | 1,063,137 | 827,075 |
| Memory-stream input without native IO or virtual filesystem | 2,733,713 | 1,050,550 | 818,303 |
| Immutable STEP keywords and compact complex-entity rules | 2,688,776 | 1,044,639 | 816,177 |

The latest round removes another 44,937 WASM bytes, 5,911 gzip bytes, and
2,126 Brotli bytes. Repeated registration/recognition code already compresses
well, so transfer savings are smaller than raw binary savings. The independent
JS loader remains 45,276 raw bytes (13,407 gzip; 12,094 Brotli), following the
previous IO reduction from 95,402 raw bytes. Against upstream, cumulative WASM
reductions are 64.6%, 66.4%, and 64.7%, respectively.
The full upstream STEP corpus (55 files, 165 imports) compares oriented triangles
and normals in world coordinates, including every embedded assembly instance,
in millimeters and inches. Geometry uses a `1e-7` relative numerical tolerance;
triangle count, connectivity, winding, and placed-part multiplicity are checked
independently of mesh grouping. Mixed metadata and invalid-input/reuse checks
are included. External-reference-only documents have no reference triangles.

Build reductions:

- Replace 813 STEP/IGES serializer bodies retained by protocol tables with traps.
  No serializer is exposed to JavaScript.
- Exclude 194 simulation, kinematics, and PMI entity types, plus 184 styling,
  annotation, and administrative types. Geometry, topology, unit, and placement
  entities remain; unrelated records are ignored.
- Exclude document persistence, XCAF, display, IGES and export modules from the
  native source list. This also removes otherwise-retained startup factories.
- Remove export actors, interactive selectors, statistics, and parameter editors.
- Register only the default import `FixShape` operator; exclude 17 other
  operators and ten ShapeAlgo helpers used only by IGES or export.
- Use only OCCT's default Watson mesh factory, retaining mesh healing and
  pre/postprocessing; omit the alternate Delabella implementation.
- Omit legacy Shift-JIS/EUC/GB2312/GBK/Big5/codepage name conversion. Text uses
  UTF-8/ASCII; STEP Unicode escape parsing remains. Names are not displayed.
- Replace the 840,000-byte `VBMatrix` Bernstein basis table with runtime
  de Casteljau recurrence, reusing existing Gaussian quadrature points. All
  degrees 1..25 and rules 1..24 are retained. This adds arithmetic when building
  a fitting matrix, with no additional library or large runtime cache.
- Compute the 49,600-byte Bernstein Gram matrix from exact Pascal coefficients
  and one division per entry, instead of storing it. This does not invert a matrix.
- Store the symmetric, centrosymmetric inverse and tangency-constraint matrices
  in a 22,448-byte wedge instead of 79,960 bytes. Lookups preserve every double.
- Compute Jacobi quadrature weights from the existing Gauss nodes/weights and
  normalized Jacobi recurrence; generate the 23,808-byte change-of-basis matrix
  from polynomial coefficients when used. The latter needs at most about 30 KiB
  of temporary heap memory, released after the call.
- Reuse Emscripten's existing `strtod_l` with OCCT's explicit C locale, removing
  a second bigint decimal parser and its 10,672-byte powers-of-ten table.
- Omit 36,190 bytes of native diagnostic catalogs and their resource loaders.
  The adapter returns geometry and a success flag. Parser checks, exceptions,
  healing status flags and frontend error reporting remain.
- Omit the native messenger printer and stream-based log formatting. Diagnostic
  argument expressions still execute; legacy ostream consumers get a lazy
  compatibility buffer rather than allocating one for every log message.
- Accept STEP only through the adapter's memory stream. Keep resource maps and
  programmatic configuration/defaults, but omit native path imports and external
  resource-file lookup/parsing. No external resource files are distributed.
- Disable Emscripten's virtual filesystem with `-sFILESYSTEM=0`, shrinking the
  loader as well as WASM. No additional download decompression step is needed.
- Replace 684 spelled global strings and two startup-built keyword maps with
  immutable sorted tables: 320 full names and 273 unique short aliases. Preserve
  case sensitivity, exact lengths and the original last-binding-wins behavior
  (`CMRPIT` maps to 483). Type-name references keep a stable lifetime through
  321 cache slots, constructed on first use and filled with spellings on demand;
  OCCT's empty string constructors still perform small allocations.
- Replace 347 repeated complex-entity string comparisons and temporary string
  sequences with 45 complete rules over sorted spelling ranks. Generate rules
  from the original Boolean conditions, preserving first-match/rejection
  priority; alias normalization, unknown input rejection and all recognized
  complex entities remain unchanged. At most eight integers are sorted.

The build compiles the actual recurrence helper to WASM and compares all
105,000 coefficients against the pinned original table before replacing it.
Maximum absolute error is `5.219e-15` and relative error is `1.779e-12` (rounded
up); endpoints and partition of unity also pass.

Additional build-time WASM checks compare all 6,200 Gram entries (exact), 9,995
packed inverse/constraint entries (exact), 13,653 Jacobi quadrature entries
(maximum absolute error `1.511e-14`), and 2,976 transform coefficients (maximum
relative error `9.215e-16`). The quadrature check uses a `2e-14` absolute bound
because coefficients can lie close to polynomial roots. All supported C0/C1/C2
constraints and Gaussian rules remain. The decimal parser is checked against
the pinned OCCT parser and JavaScript nearest-double conversion on 20,043 cases,
including signed zero, subnormals, rounding boundaries, long numbers, invalid
input and end pointers. Values and end pointers match exactly.

Keyword checks compile the generated tables and the pinned original C++
registration bodies, type-name switch, complex recognizer and reverse recipes
to WASM. All 28,316 name lookups, 856 type-name IDs and 16,579 complex-entity
checks match exactly, including shuffled components, mixed aliases, missing or
unknown components, embedded NULs, duplicate aliases and randomized input.

The build uses Emscripten 3.1.61, `-Oz`, full LTO, hidden visibility,
whole-program vtables, virtual-function elimination, `emmalloc`, WASM exceptions,
and Binaryen 131.0.0. Optimized function names and a linker map remain only in
the build cache for analysis. Release stripping removes metadata without
rewriting executable sections, allowing byte-exact profile/release comparison.
No geometry approximation flags or exception removal are used.

A reproducible breakdown is in `docs/occt-wasm-breakdown.md` and
`docs/assets/occt-wasm-breakdown.json` in the Filens source tree. It measures
final function bodies and data bytes, not source lines or pre-LTO object sizes.
The inventory now also recognizes the original endpoint-constraint table's
additive C++ constant expressions, packed tables, PLib maxima, and shared Gauss
nodes/weights; their emitted bytes total approximately 76.5 KiB. The endpoint
constraint table is retained without recomputing ill-conditioned inverses.
FreeType, FreeImage, OpenGL, TBB, and zlib are not linked into this WASM.

Generated JS and WASM are checked in, so normal installs, package builds, and
deployments need neither Emscripten nor a download of kernel sources. The
package and demo emit WASM separately and load it only for STEP preview.

To rebuild with Emscripten **3.1.61** and CMake:

```sh
npm ci
npm run build:occt-wasm
npm run report:occt-wasm
npm run test:occt-wasm
npm run build:model3d
npm run build:demo
npm run report:bundle-sizes
```

`EMCMAKE=/absolute/path/to/emsdk/upstream/emscripten/emcmake` selects an SDK.
The default cache is `tmp/occt-wasm/`; `FILENS_OCCT_WORKDIR=/path/to/cache`
selects another directory for building and profiling.
`FILENS_OCCT_FIXTURES=/path/to/upstream/test/testfiles npm run test:occt-wasm`
compares the entire upstream corpus. `FILENS_OCCT_BUILD=/path/to/artifacts`
tests or profiles a candidate JS/WASM pair before replacing the vendor files.

Licenses: `license.occt-import-js.txt` and `license.occt.txt`. All source changes
and build flags live in `scripts/build-occt-wasm.mjs`,
`scripts/prune-occt-importer.mjs`, `scripts/occt-preview.cpp`,
`scripts/occt-preview.cmake`, `scripts/occt-bernstein.cpp`,
`scripts/occt-bernstein.hpp`, `scripts/compact-occt-tables.mjs`,
`scripts/occt-numeric.hpp`, `scripts/occt-strtod.cpp`,
`scripts/compact-occt-keywords.mjs`, `scripts/occt-step-lookup.hpp`,
`scripts/test-occt-bernstein.mjs`, `scripts/test-occt-numeric.mjs`,
`scripts/test-occt-strtod.mjs`, `scripts/test-occt-keywords.mjs`,
and `scripts/occt-wasm-binary.mjs` in the
Filens source tree.
Distributions include this notice and both licenses in
`occt-import-js-NOTICE.txt`.
