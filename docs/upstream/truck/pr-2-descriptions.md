Title: fix(stepio): preserve assemblies with omitted optional descriptions

Valid STEP products and assembly relationships may omit their description using `$`. Several input structures currently require String, so Table::push_instance rejects those records. The collecting Table API logs the errors and drops the records; step_assy can then return an empty or incomplete assembly. A shell-only fallback loses instance placement and multiplicity.

Represent the optional descriptions as Option<String> across products, formations, definitions, product-definition shapes, representation relationships, next-assembly usage occurrences, and item-defined transformations. Preserve supplied descriptions and map absent descriptions to an empty String only when producing PartAttrs.

**Public API change:** callers constructing these parsed entity structs must use Some(description) or None. The representation now distinguishes an omitted description from an empty one. PartAttrs::description remains String.

Validation:

- Five inline tests cover omitted descriptions through a two-node assembly and transform, present descriptions, the specified-source formation variant, and rejection of invalid mandatory names / non-string descriptions.
- The original implementation fails the two omitted-description regressions; the patch passes all five tests.
- The patch applies independently to `1ca3214e537004d466addbd85d6375807147a426`.

```sh
cargo test -p truck-stepio --test import_optional_descriptions
```

Local tests used Rust 1.93 with a test-only dependency compatibility overlay restoring truck-topology's previous parking_lot 0.12.5 / rclite 0.4.1 constraints. No dependency changes are included. The original HEAD dependency graph and full upstream suite were not tested locally. Unit conversion, annotation rendering, and traversal of untransformed representation relationships are separate work.
