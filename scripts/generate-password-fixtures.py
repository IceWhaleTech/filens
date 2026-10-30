"""Generate synthetic password fixtures with independent Python implementations.

Run generate-converter-fixtures.mjs first, then run in a Python environment with
msoffcrypto-tool and pypdf installed. Production code does not require Python.
"""
from pathlib import Path
from shutil import copyfile
from io import BytesIO
from zipfile import ZipFile, ZIP_STORED

import msoffcrypto
import olefile
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "packages/converter-client/test/fixtures/password"
DEST.mkdir(parents=True, exist_ok=True)
for folder, extension in [("doc", "docx"), ("xls", "xlsx"), ("ppt", "pptx")]:
    plain = ROOT / f"examples/go-wazero-converter/fixtures/{folder}/sample.{extension}"
    source = BytesIO(plain.read_bytes())
    # msoffcrypto's CFB writer requires the encrypted payload to use regular
    # sectors (>= 4096 bytes), so pad these intentionally tiny test packages.
    with ZipFile(source, "a") as archive:
        archive.writestr("filens-test-padding.txt", b"Synthetic test padding.\n" * 400, compress_type=ZIP_STORED)
    source.seek(0)
    with (DEST / f"agile.{extension}").open("wb") as output:
        msoffcrypto.OfficeFile(source).encrypt(" filens 密码🔐 ", output)

copyfile(DEST / "agile.docx", DEST / "tampered.docx")
with olefile.OleFileIO(DEST / "tampered.docx", write_mode=True) as file:
    encrypted = bytearray(file.openstream("EncryptedPackage").read())
    encrypted[-1] ^= 1
    file.write_stream("EncryptedPackage", bytes(encrypted))

writer = PdfWriter()
page = writer.add_blank_page(width=400, height=300)
font = DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")})
page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})})
stream = DecodedStreamObject()
stream.set_data(b"BT /F1 20 Tf 40 200 Td (Password protected PDF) Tj ET")
page[NameObject("/Contents")] = writer._add_object(stream)
writer.encrypt("test123", algorithm="AES-256")
writer.write(DEST / "encrypted.pdf")
