# Apache POI real Office samples

These files are copied unchanged from Apache POI test data at commit
`f613a72d8c591751caca83b45637a1b653cea833`:

- `test-data/document/hyperlink.doc`
- `test-data/document/table-merges.doc`
- `test-data/document/SimpleMacro.docm`
- `test-data/document/45690.docm`
- `test-data/spreadsheet/Simple.xls`
- `test-data/spreadsheet/SimpleWithFormula.xls`
- `test-data/spreadsheet/chinese-provinces.xls`
- `test-data/spreadsheet/SimpleMacro.xlsm`
- `test-data/spreadsheet/testNames.xlsm`

Upstream: https://github.com/apache/poi

License: Apache License 2.0. The upstream `LICENSE` and `NOTICE` files are copied
into this directory.

The macro-enabled samples are regression inputs only. The preview converter strips
macro parts and never executes or preserves VBA.

Formula coverage:

- `SimpleWithFormula.xls` exercises BIFF formula cached-result extraction.
- `testNames.xlsm` contains seven worksheet formulas that remain in the normalized XLSX package.
