#!/usr/bin/env python3
"""Rebuild the tiny original test font (requires fonttools, no system fonts)."""
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

root = Path(__file__).resolve().parents[1]
destination = root / 'wasm/converter-core-rust/testdata/pdf-unicode-font.ttf'
characters = '多大很不与发变子'
names = ['.notdef'] + [f'uni{ord(c):04X}' for c in characters]
builder = FontBuilder(1000, isTTF=True)
builder.setupGlyphOrder(names)
builder.setupCharacterMap({ord(c): names[i + 1] for i, c in enumerate(characters)})
glyphs = {}
for index, name in enumerate(names):
    pen = TTGlyphPen(None)
    # Original geometric test glyphs: no third-party font data is included.
    if index:
        width = 200 + index * 50
        pen.moveTo((50, 0))
        pen.lineTo((50 + width, 0))
        pen.lineTo((50 + width, 600))
        pen.lineTo((50, 600))
        pen.closePath()
    glyphs[name] = pen.glyph()
builder.setupGlyf(glyphs)
builder.setupHorizontalMetrics({name: (1000, 0) for name in names})
builder.setupHorizontalHeader(ascent=800, descent=-200)
builder.setupNameTable({'familyName': 'FiLens Unicode Fixture', 'styleName': 'Regular',
                       'uniqueFontIdentifier': 'FiLensUnicodeFixture',
                       'fullName': 'FiLens Unicode Fixture', 'psName': 'FiLensUnicodeFixture'})
builder.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
builder.setupPost()
builder.setupMaxp()
builder.font['head'].created = builder.font['head'].modified = 3_600_000_000
builder.font.recalcTimestamp = False
destination.parent.mkdir(parents=True, exist_ok=True)
builder.save(destination)
print(destination)
