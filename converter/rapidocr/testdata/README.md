# OCR integration fixtures

Synthetic invoice text; no personal or production data. The PNG source is
2000 × 520 pixels so the 960-side detector path is exercised. Variants cover
transparent black pixels, a 180-degree rotation, JPEG EXIF orientation 6, and
a two-page image-only PDF. Fixtures were generated once using Pillow; running
the tests or distributed CLI does not require Pillow or Python.
