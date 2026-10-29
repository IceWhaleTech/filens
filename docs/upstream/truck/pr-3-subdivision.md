Title: fix(geotrait): reject nonfinite samples before recursive curve subdivision

When a curve sample or interpolated chord is NaN/Infinity, `dist2 < tol * tol` never terminates subdivision. The existing depth limit of 100 still permits an enormous binary recursion tree. A periodic STEP PCurve evaluated outside its valid NURBS domain triggered this behavior in WASM and exceeded a 20-second preview timeout.

Check that the requested range is finite and that each sampled squared chord error is finite before recursing. Fail immediately with a specific panic message, consistent with this API's existing panic contract for invalid tolerance. Document the added panic conditions.

This is a fail-fast guard. It does not repair invalid PCurve ranges, add a checked Result-returning API, or impose a total work budget on finite pathological curves. With panic=abort, WASM callers still need to map the trap to an input failure.

Validation:

- Six tests cover NaN endpoints, NaN interior samples, infinite samples, nonfinite ranges, and valid forward/reverse finite curves.
- The regression fixture limits evaluations to 64 even against the old code, so CI does not hang while demonstrating the bug. Four tests fail on the old code and all six pass with the patch.
- The patch applies independently to `1ca3214e537004d466addbd85d6375807147a426`.

```sh
cargo test -p truck-geotrait --test curve_division_nonfinite
```

Targeted local tests used Rust 1.93 in the documented compatibility harness; the full upstream suite was not run. No public signature changes or dependency changes are included.
