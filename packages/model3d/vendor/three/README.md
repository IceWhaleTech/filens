# Three.js LDraw loader

`LDrawLoader.js` is copied from `three@0.176.0/examples/jsm/loaders/LDrawLoader.js` under the adjacent MIT license.

The only algorithm change replaces the half-edge dictionary in normal smoothing with a `Map` and one live iterator. The previous loop enumerates the remaining dictionary for each disconnected component and becomes quadratic. Insertion order, edge lookup/deletion, hard-edge rules and normal accumulation remain the same. Keep this patch when updating the upstream copy and rerun `test/ldraw-resources.spec.ts` and `test/ldraw-smoothing.spec.ts`.

The declaration re-exports the upstream public API. Runtime parsing and smoothing are provided by this tracked copy; no `node_modules` patch is needed.
