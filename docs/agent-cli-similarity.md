# Duplicate files and similar images

English · [简体中文](agent-cli-similarity.zh-CN.md)

Source builds provide Czkawka-style directory scans that report groups of duplicate files and similar resized, reformatted or recompressed images. Hashing, image decoding and grouping run in the shared frontend WASM core; the CLI handles directory discovery and invocation. Neither OCR nor a model is required. Check `capacity.operations` for `similar`; published npm `0.2.0` does not include this capability.

## Quick start

Build Lite from the source checkout:

```sh
npm run build:agent:lite
./dist/agent-lite/filens capacity --json
./dist/agent-lite/filens similar-images ./photos --threshold 8 --json
```

The examples below use `filens`; replace it with `./dist/agent-lite/filens` for a source bundle. For an installed build, first confirm that its capabilities include `similar`.

```sh
filens duplicates ./files --json
filens similar-images ./photos --threshold 8 --json
filens similar ./photos --similarity-mode images --format csv
filens 'find duplicate files in "./files" as json'
filens 'find similar images in "./photos" as json'
```

A JSON request:

```json
{"operation":"similar","input":"./photos","similarityMode":"images","threshold":8,"format":"json","maxResults":100,"maxFiles":2000,"maxDepth":32}
```

`duplicates` and `similar-images` are command and operation aliases. Responses normalize `operation` to `similar`. `similarityMode` is `duplicates` or `images`, defaulting to `images`. Scans read files and report groups; they do not delete, move or replace files.

| Flag | Default | Range and purpose |
| --- | --- | --- |
| `--similarity-mode` | `images` | `images` or `duplicates`; the two alias commands select their corresponding mode. |
| `--threshold` | `8` | `0–24`, images only; lower is stricter. |
| `--max-results` | `100` | `1–1000` returned groups. |
| `--max-files` | `2000` | `1–20000` candidate files to discover. |
| `--max-depth` | `32` | `1–256` directory traversal depth. |
| `--include-hidden` | Off | Include ordinary hidden names; fixed directory exclusions still apply. |
| `--timeout` | `2m` | Total request deadline; increase it for a large directory, for example `10m`. |
| `--format` | `text` | text, JSON, Markdown, HTML, YAML, XML, CSV or TSV; JSON requests default to JSON responses. |

## Duplicate files

All file extensions are eligible. The core groups candidates by size, hashes the first 4096 bytes with SHA-256, then reads matching candidates in full and compares their full SHA-256 hashes. Equal sizes or prefixes alone do not establish duplicates. Empty files can also form a duplicate group.

On Unix, hard-link aliases with the same device/inode retain one path rather than counting as extra copies. Windows currently retains hard-link aliases. Results do not estimate reclaimable disk space.

Hashing streams file data, so duplicate scanning is not subject to the 256 MiB document-parsing input limit. A scan has a total hash-read budget of 16 GiB; reaching it retains available groups and marks the result incomplete. Size and modification times are checked during reads, but a directory scan is not an atomic snapshot.

## Similar images

Supported formats are JPEG, PNG, WebP, GIF, BMP and TIFF. The core applies EXIF orientation, composites transparent pixels onto white, resizes to 32×32 and computes a 63-bit low-frequency DCT perceptual hash. A BK-tree finds candidates by Hamming distance. Flat images also compare average color to reduce collisions between different solid colors. Animated and multipage images use the first frame.

`--threshold` is a Hamming distance, default 8, with a range of 0–24. It is not a similarity percentage or confidence score. Distance 0 does not prove identical source files or identical pixels. Each group has a `reference`; every member's `distanceToReference` is within the threshold. Groups follow path order and are disjoint. They do not expand through transitive matches or enumerate every matching image pair, and two members can be farther apart than the threshold.

GIF palette conversion changes image information. One test sample is missed at the default distance 8 and matches at 12. Adjust `--threshold` for the collection and review additional matches for false positives.

This is useful for variants of the same image. Heavy cropping, rotation, mirroring and watermarks can cause misses; different images with similar compositions can produce false matches. It does not provide semantic retrieval of different photos of the same subject. Each image is limited to 256 MiB, 32 million pixels and 32768 pixels per side. Candidate lookup has a 20-million-comparison budget; reaching it marks the result incomplete.

## Scope, output and completeness

Defaults are 2000 candidate files, depth 32 and 100 returned groups. Hidden names are excluded unless `--include-hidden` is set. `.git`, `node_modules`, `target` and `dist` subdirectories remain excluded; explicitly choosing one as the scan root still allows scanning its other contents. Symbolic links are not followed. Directory discovery uses macOS native FTS or the embedded hdrw WASI walker on Windows/Linux.

Outputs include text, JSON, Markdown, HTML, YAML, XML, CSV and TSV. Group members contain paths relative to `source.path`, byte sizes, and either full SHA-256 hashes for duplicates or orientation-corrected dimensions, perceptual hashes and distances for images.

| JSON field | Meaning |
| --- | --- |
| `source.path` | Absolute scan root; group-member paths are relative to it. |
| `similarity.matchedGroups` / `matchedFiles` | Matches discovered before applying the returned-group limit; discovery may still be incomplete because of errors or budgets. |
| `similarity.returnedGroups` / `groups` | Number of returned groups and their members. |
| `groups[].reference` / `files[].distanceToReference` | Image reference and each member's Hamming distance to it. |
| `files[].sha256` / `files[].hash` | Full-file SHA-256 / perceptual image hash; these have different purposes. |
| `similarity.scan` | Directory backend, visited/skipped counts, truncation and errors. |
| `similarity.processing` | Full-hash/decoded-image counts, calculation budgets, skipped hard links and processing errors. |

Inspect `similarity.complete`, `truncated`, `scan` and `processing`. Corrupt images, read failures, discovery errors and limits retain useful groups and return exit code 3. Zero groups only describes the scanned scope under the selected method and threshold. Similarity scans recompute fingerprints and do not use the document search cache.

Use `search` for lexical, literal or filename retrieval and `similar` for these two grouping modes. Similarity scans do not accept `--query`, `--layout` or search-cache flags. Near-duplicate document text comparison, such as related PDF/DOCX revisions, is not implemented.

## Verification and size

```sh
npm run build:agent:lite
npm run test:agent:similarity
```

Real CLI/WASM checks cover full-file duplicates, matching prefixes with different contents, resizing/recompression, flat colors, transparency, JPEG/EXIF, links, limits, corrupt images, Chinese/English intents, JSON requests and eight output formats. Core tests exercise image codecs and reference-based grouping. This covers the two core scan modes rather than Czkawka's complete cleanup, video or audio feature set. The hdrw path was exercised on macOS; that does not establish native Windows/Linux execution results.

In the 2026-10-30 macOS arm64 local build comparison, the native executable grew by 50272 bytes and gzip WASM resources by 234173 bytes, totaling about **278 KiB**. The baseline is the existing build recorded at the start of the implementation. This measures the executable plus compressed WASM resources, excludes OCR, license text and npm packaging, and is not an npm download-tarball delta. See the [size and verification record](agent-cli-similarity-size.json); the full local record is `dist/agent-similarity/size-comparison.json`.
