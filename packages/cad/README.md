# @filens/cad

Browser-native CAD preview driver for the filens multi-format preview runtime.

## Current Scope

The package currently parses supported DXF drawings directly in the browser and renders them as SVG. It covers common geometry, text, blocks, dimensions, fills, raster references, drawing bounds, layers, colors, line types, and line weights, with explicit warnings for unsupported or unresolved content.

This direct path does not require a desktop CAD application, native conversion process, or remote conversion server. DWG and other closed or more complex CAD formats are not registered as native routes today.

See the root [support matrix](../../docs/support-matrix.md) for detailed coverage and limits.

## CAD Conversion Lineage

The CAD conversion work and SVG-first preview direction are derived from [`orcastor/cad2x-converter`](https://github.com/orcastor/cad2x-converter), an LGPL-2.1-licensed, compact DXF/DWG converter derived from LibreCAD. cad2x supports DXF/DWG input and DXF/PDF/PNG/SVG output, including practical handling for fonts, code pages, paper sizing, fitting, and scale.

filens builds on that experience with a separate pure-browser DXF parser and SVG renderer for supported drawings. A host can still add a cad2x-style conversion route when it needs DWG input, print-oriented PDF output, PNG thumbnails, or broader native CAD compatibility.

## Architecture Boundary

- CAD parsing and rendering stay in the front-end package or front-end WASM modules.
- Backend wrappers may host the same conversion core, but must not introduce a separate format-specific conversion implementation.
- Unsupported content produces warnings or an explicit host fallback instead of silently pretending to render correctly.
