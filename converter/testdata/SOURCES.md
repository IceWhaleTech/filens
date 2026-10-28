- `Simple.xlsb`: Apache POI `test-data/spreadsheet/Simple.xlsb`, copied unchanged
  from the `trunk` branch on 2026-10-28. It is an Excel 2007 Beta 2 workbook with
  the sentence “This is an example spreadsheet created with Microsoft Excel 2007
  Beta 2.” Apache-2.0; see the LICENSE/NOTICE in the existing Apache POI fixture set.
- `sample_AC1015.dwg`: ACadSharp `samples/sample_AC1015.dwg`, copied unchanged
  from `master` on 2026-10-28. MIT; see ACadSharp-LICENSE.txt. Includes TEXT, MTEXT,
  block attributes, tables, and multileaders.
- `testDWG2000.dwg`: Apache Tika CAD module's test-documents/testDWG2000.dwg,
  copied unchanged from `main` on 2026-10-28. Apache-2.0. This drawing has no
  extracted entity text; use it to check successful empty content.
- `text-layer.djvu`: controlled, valid single-page DjVu IFF container with an
  INFO chunk and uncompressed TXTa layer. The text is `DJVU_TEXT_LAYER 中文`.
  Generated for this project; no external content.

Sources: https://github.com/apache/poi, https://github.com/DomCR/ACadSharp,
https://github.com/apache/tika. SHA256 checksums are in SHA256SUMS.

`password_test123.pdf` is copied from go-pdfium v1.12.3 shared_tests/testdata;
see go-pdfium-LICENSE. It must return password_required without OCR.
