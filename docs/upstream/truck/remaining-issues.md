# Follow-up issues and reproductions

These items are not fixed by the three supplied PRs. Fixture paths refer to [occt-import-js 0.0.23 testfiles](https://github.com/kovacsv/occt-import-js/tree/0.0.23/test/testfiles); input hashes and numeric results are in `docs/assets/rust-engines/results-step-reviewed.json` in Filens.

## Periodic PCurve trimming and branch selection

Fixture: `rounded-cube/rounded-cube.step`.

1. Import the original file through Table::from_step / step_assy.
2. Discretize its shell edges at tolerance 0.1.
3. Without the compatibility adapter, the eighth edge evaluates to NaN at both endpoints and subdivision does not finish promptly.

SURFACE_CURVE #222 prefers PCurve #228, whose periodic rational B-spline #230 has degree 2, multiplicities `(1,2,2,2,2,1)`, and knots from -2.094395 to 8.377580. The base domain is [0, 6.283185], while the edge is only an arc. The bounded PCurve path ignores EDGE_CURVE trimming and uses the entire knot range. A second circular edge (#275 on cylinder #126) uses the wrong angular branch, traversing 270° instead of 90°.

Filens currently uses the corresponding supplied analytic 3D curves for these narrow cases; its result has 7 meshed faces and passes the preview screen. This is a preview workaround. An upstream geometric fix should respect the selected master representation, valid B-spline domain, edge vertices, orientation, periodicity, and winding. PR 3 only makes nonfinite evaluation fail fast.

## Related representations and auxiliary geometry

Fixtures: `cax-if/as1_pe_203.stp`, `cax-if/io1-tu-203.stp`, and `cax-if/s1_pe_214/foot_front_prt.stp`.

Product representations can contain only coordinate systems, with the solid reachable through an untransformed SHAPE_REPRESENTATION_RELATIONSHIP. product_node_entity currently examines only its immediate items. For example, `foot_front_prt.stp` uses SHAPE_REPRESENTATION #331 and relates it to ADVANCED_BREP_SHAPE_REPRESENTATION #321. The assembly can contain nodes but no solid geometry.

Mixed representations can also include GEOMETRIC_CURVE_SET or annotations. `io1-tu-203.stp` includes GEOMETRIC_CURVE_SET #1203 in SHAPE_REPRESENTATION #1210; `io1-cm-214.stp` mixes text/callouts with solids. Treating every item as ProductShape rejects the representation. An upstream design should retain or explicitly report unsupported geometry; blindly filtering every failed item would hide missing solids or malformed references.

The local solid-preview adapter traverses only untransformed relationships, tracks visited nodes and duplicate solid IDs, and separately counts intentionally omitted annotations/wires. Transformed assembly edges remain on the assembly DAG. This policy is not included in the upstream patches.

## Four remaining geometric mismatches

After the preview adapter's unit, tolerance, placement, and compatibility fixes, these still fail the same screen:

| Fixture | Current evidence |
| --- | --- |
| `cax-if/s1-c5-214/HEAD_BACK.stp` | Boundary error about 28% of reference diagonal; area error about 33%; volume error about 97%. Serious geometry loss remains despite every face returning a mesh. |
| `cax-if/s1-c5-214/TAIL_TURBINE.stp` | Bidirectional sampled surface P95 about 3.90 mm; volume error about 25%. |
| `cax-if/s1_pe_214/foot_front_prt.stp` | Surface P95 about 0.143 mm and small area error, but signed-volume error about 47%. Requires investigation of face orientation, trimming, and solid validity; visual similarity is insufficient. |
| `cax-if/s1_pe_214/tail_turbine_prt.stp` | Surface P95 about 7.98 mm; volume error about 17%. |

These are evidence and investigation leads, not established root causes. The evaluation compares triangle meshes against the current OCCT output; it is not an exact CAD equivalence proof. Do not loosen thresholds to call these repaired.

## Units, malformed topology, and external references

The local adapter resolves millimetres, centimetres, metres, and conversion-based length units from active shape contexts, converts tolerance to source units before meshing, and returns millimetres. It rejects missing, cyclic, invalid, and mixed context units. Full upstream support should convert per representation, including angular units and mixed-unit assemblies.

The importer's shell vertex/edge maps currently insert indices before some conversions succeed and use filter_map on failed references. A follow-up should propagate structured errors instead of producing partial, potentially inconsistent topology. No general malformed-topology fix is included here.

Eleven fixture assembly files contain external STEP references and no embedded solid shells. They require associated files and reference resolution, or a CAD export with embedded geometry. No external-file loader is implemented by these patches or the preview adapter.
