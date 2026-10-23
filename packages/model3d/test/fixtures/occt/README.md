These unmodified fixtures come from `test/testfiles` in
[occt-import-js 0.0.23](https://github.com/kovacsv/occt-import-js/tree/0.0.23/test/testfiles):

- `cube.stp`: `simple-basic-cube/cube.stp`
- `rounded-cube.step`: `rounded-cube/rounded-cube.step`
- `assembly.stp`: `cax-if/as1_pe_203.stp` (colored, nested assembly)

See the upstream importer license in `../../../vendor/occt-import-js/`.
`npm run test:occt-wasm` compares the read-only build against the upstream npm
WASM, including oriented world-space triangles, normals, all placed assembly instances,
and millimeter/inch units. Mesh grouping, names, colors, document attributes,
face metadata, and the assembly tree are deliberately omitted from the preview.
