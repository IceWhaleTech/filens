#!/usr/bin/env python3
"""Prepare pinned WPS fixtures from an official .deb, without installing WPS.

The proprietary templates stay in a caller-owned cache, outside the repository.
See converter/testdata/application/README.md for the public download source.
"""
import argparse
import hashlib
import json
from pathlib import Path
import tarfile

ROOT = Path(__file__).resolve().parents[1]


def prepare(archive, output):
    entries = [c for c in json.loads((ROOT / 'converter/testdata/application/manifest.json').read_text())
               if c.get('external')]
    digests = {c['origin']['archiveSHA256'] for c in entries}
    with archive.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    if digests != {digest}:
        raise ValueError('official WPS archive does not match the pinned SHA256')
    wanted = {c['origin']['member'].removeprefix('./'): c for c in entries}
    output.mkdir(parents=True, exist_ok=True)
    with archive.open('rb') as stream:
        if stream.read(8) != b'!<arch>\n':
            raise ValueError('not a Debian ar archive')
        while header := stream.read(60):
            if len(header) != 60 or header[-2:] != b'`\n':
                raise ValueError('invalid Debian archive header')
            name = header[:16].decode('ascii').strip().rstrip('/')
            size = int(header[48:58])
            start = stream.tell()
            if name.startswith('data.tar.'):
                with tarfile.open(fileobj=stream, mode='r|*') as tar:
                    for member in tar:
                        entry = wanted.get(member.name.removeprefix('./'))
                        if entry is None:
                            continue
                        if not member.isfile() or member.size > 8 << 20:
                            raise ValueError('unexpected WPS fixture type or size')
                        data = tar.extractfile(member).read()
                        if hashlib.sha256(data).hexdigest() != entry['sha256']:
                            raise ValueError('official WPS fixture checksum mismatch')
                        destination = output / entry['input']
                        if destination.parent != output:
                            raise ValueError('fixture name must be a basename')
                        destination.write_bytes(data)
                        del wanted[member.name.removeprefix('./')]
                break
            stream.seek(start + size + size % 2)
    if wanted:
        raise ValueError('official archive is missing fixtures: ' + ', '.join(wanted))
    print(f'Prepared {len(entries)} authentic WPS fixtures in {output}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    prepare(args.archive.resolve(), args.output.resolve())
