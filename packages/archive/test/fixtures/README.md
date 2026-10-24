The two TAR fixtures were written by Python's standard-library `tarfile`, independently of the reader and test helpers. They exercise UTF-8 names longer than the USTAR name field using POSIX PAX and GNU long-name records.

Regenerate from the repository root:

```python
import io, tarfile
from pathlib import Path

folder = Path('packages/archive/test/fixtures')
long_name = '目录/' + 'long-file-name-' * 12 + '预览.txt'
for format, label in [(tarfile.PAX_FORMAT, 'pax'), (tarfile.GNU_FORMAT, 'gnu')]:
    with tarfile.open(folder / f'{label}-long-path.tar', 'w', format=format) as archive:
        for name, text, modified in [
            (long_name, 'Long path preview: 中文内容\n', 1700000000.125),
            ('next.txt', 'Next entry\n', 1700000001),
        ]:
            data = text.encode()
            entry = tarfile.TarInfo(name)
            entry.size, entry.mtime = len(data), modified
            archive.addfile(entry, io.BytesIO(data))
```
