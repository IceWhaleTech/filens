Title: fix(stepio): respect direction ratios in vectors and axis placements

STEP DIRECTION stores ratios, which need not have unit length. Importing a VECTOR currently multiplies the raw ratios by its magnitude, while AXIS2_PLACEMENT_2D/3D can introduce unintended scale. AXIS2_PLACEMENT_3D also defaults to X even when its normal is parallel to X, producing a singular frame and causing circle conversion to fail.

Normalize directions where vector magnitude and placement basis construction require unit vectors. Use Y for the omitted reference direction when the normal is parallel to X. Build the perpendicular basis with cross products to retain orthogonality for nearly parallel directions without changing the projected-X branch.

For example, an axis `DIRECTION('',(-0.0393700787402,0.,0.))` with an omitted reference direction should produce a right-handed orthonormal frame. Previously it produced a singular frame. This occurs in public CAX-IF STEP fixtures and led to failed circle conversions and downstream tessellation traps.

Validation:

- Nine inline regression tests cover scaled 2D/3D directions, positive/negative X normals, default axes, vector magnitudes, and nearly parallel axes.
- The original implementation fails eight of these tests; the patch passes all nine.
- The patch applies independently to `1ca3214e537004d466addbd85d6375807147a426`.

```sh
cargo test -p truck-stepio --test import_direction_ratios
```

Local tests used Rust 1.93 with a test-only dependency compatibility overlay restoring truck-topology's previous parking_lot 0.12.5 / rclite 0.4.1 constraints. No dependency manifest changes are included in this patch. The original HEAD dependency graph and full upstream suite were not tested locally. Invalid zero or explicitly parallel reference directions remain outside this patch's handling.
