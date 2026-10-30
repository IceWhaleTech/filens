Title: fix: refine trimmed surface interiors and preserve sphere pole parameters

A trimmed cylinder can have a very accurate boundary polyline while its interior triangles span long chords across the surface. For example, a notched half-cylinder with a linear axial parameter has only two axial parameter divisions; constrained triangulation can connect the notch to a distant boundary arc. The boundary passes the requested tolerance, but the resulting mesh cuts through the cylinder.

Refine constrained triangles whose parameter-space centroid deviates from the interpolated 3D centroid by more than the meshing tolerance. Insert points in parameter space and retain boundary constraints. Cache vertex surface evaluations, reuse centroid samples for inserted vertices, and store accepted triangle keys in indexed face slots, validating the vertex key whenever a face slot is reused. Query the trim domain only for triangles requiring refinement; final mesh clipping still classifies all output triangles. Additional refinement is bounded to 64 passes and 100,000 additional vertices per face; on reaching a budget, return the current approximation. This is a bounded improvement, not a certified maximum-error guarantee.

The additional samples also exposed three existing parameter/boundary problems:

- Convert STEP sphere longitude/latitude hints into the kernel sphere's polar-angle/longitude convention.
- Swap incoming parameter/range hints when a `Processor` reverses its surface parameter axes, including nearest-parameter search.
- Keep longitude finite at sphere poles, using a parameter hint when available; when adding the previous pole's alternate UV coordinate to a boundary, retain the previous 3D point rather than assigning the next boundary point.

No public signatures or dependencies change. Nonfinite centroid error fails immediately instead of continuing refinement.

Validation:

- Eight synthetic regression tests cover notched cylindrical curvature, smaller source units, reversed face orientation, both degenerate parameter directions, sphere pole hints, and reversed STEP spheres. Seven fail against the original implementation; all eight pass with the patch.
- The patch applies independently to upstream `1ca3214e537004d466addbd85d6375807147a426`. Executable validation uses the older pinned `78d699b0792b39e27c2bf073b682986701644e91` dependency graph with Rust 1.93 and no dependency overlay. These four modified source files are identical between those two unpatched commits. The current upstream dependency graph and full upstream suite have not been tested.
- In Filens's existing WASM preview harness, the same geometry screen improves from 40/44 to 43/44 nonempty STEP fixtures with no passing fixture regressing. This result also depends on the harness's existing unit, assembly, and curve compatibility handling; the patch alone does not implement those features. `HEAD_BACK.stp` still fails the reference comparison.
- Three rounds over all 44 fixtures verify that the cache optimization preserves every triangle's exact positions, normals, and winding, allowing only triangle/instance emission order to differ. Median total meshing time drops from 3.310 s to 2.924 s (11.7%); the pre-refinement build takes 2.514 s. The optimized WASM is 260,971 bytes with Brotli 11, 610 bytes larger than the initial refinement build. More faithful surfaces still require additional triangles and work; no browser peak-memory claim is made.

Run the upstream tests on a compatible toolchain:

```sh
cargo test -p truck-meshalgo --test trimmed_surface_sampling --test degenerate_boundary_points
cargo test -p truck-stepio --test import_sphere_hints
```

Published as [ricosjp/truck#141](https://github.com/ricosjp/truck/pull/141).
