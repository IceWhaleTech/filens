# FiLens CLI for ZimaOS

Install from the official [Mod Store](https://github.com/IceWhaleTech/Mod-Store):

```sh
sudo zpkg install filens
filens capacity --json
filens read report.pdf --json
```

If the module is not found, run `sudo zpkg update` and retry. To update an
installed version, run `sudo zpkg update` followed by `sudo zpkg upgrade filens`.

The raw package installs `/usr/bin/filens` and Linux x64/arm64 native binaries
with their shared WASM conversion engines under `/usr/lib/filens/`. It needs no
Node.js, npm, Python or background service. The module has no desktop UI.

OCR uses Photos' existing NCNN v7 runtime and RapidOCR models. The launcher
looks for `libzima_ncnn_runtime_v7.so` and its sibling `libncnn.so` in the
system library directories and Photos' `models/ncnn/runtime` cache, and finds
the model bundle at `models/ncnn/rapidocr-ncnn`. The default Photos cache is
`/media/ZimaOS-HD/AppData/photos/models`; `/DATA/AppData/photos/models`, the
legacy `/media/ZimaOS-HD/AppData/.models` location and `ZIMAOS_MODEL_CACHE_DIR`
are also supported. Explicit `FILENS_OCR_LIBRARY` and `FILENS_OCR_MODEL_DIR`
settings take precedence. Photos files are never modified.

Use `filens capacity --json` to check `capacity.ocr.available` on the device.
The NCNN v7 library must expose the JSON v2 OCR interface and have compatible
models. When Photos' OCR components are absent or incompatible, OCR reports
unavailable; the other CLI capabilities remain usable. Sharing the libraries
and model files does not share Photos' in-memory worker or model instance.

If Photos provides an older ABI or OCR is unavailable, run:

```sh
filens setup-ocr
filens capacity --json
```

Setup checks the existing OCR worker first. If it cannot load, it downloads a
pinned compatible runtime and models from npm Mirror, with the official npm
registry as fallback. SHA-256 verification and a native health check must pass
before installation. The private files live under
`$FILENS_CACHE_DIR/zimaos-ocr/<CLI_VERSION>/<PLATFORM>` (default:
`${XDG_CACHE_HOME:-$HOME/.cache}/filens/zimaos-ocr/...`) and take precedence over
Photos' components on subsequent runs. `filens setup-ocr --refresh` replaces
only this private copy. Reading files never starts downloads automatically.

Build the raw package with Node.js 20+, `mksquashfs` and `tar`. From the
repository root, download the published CLI platform packages for the version
in `packaging/zimaos/release.json`, then package them:

```sh
mkdir -p dist/npm
cd dist/npm
npm pack filens-cli-linux-x64@0.4.0 filens-cli-linux-arm64@0.4.0 filens-ocr-linux-x64@0.4.0 filens-ocr-linux-arm64@0.4.0 --registry=https://registry.npmjs.org/
cd ../..
npm run package:zimaos:filens
```

Alternatively, source builds can prepare these tarballs with
`npm run package:agent:npm -- --all` after building the CLI and WASM core.
`scripts/package-zimaos-filens.sh` also accepts a tarball directory and output
path as its first and second arguments. It validates the package versions and
ELF architectures, and writes `dist/filens.raw` as a `systemd-sysext` SquashFS
image. Runtime/model files and browser preview assets are excluded. Both
architectures share identical WASM data through SquashFS deduplication.
The OCR tarballs supply pinned checksums for optional setup and are excluded
from the raw image. `packaging/zimaos/release.json` tracks the system-extension
version separately from its CLI version, so packaging fixes do not replace an
already published raw image. `npm run test:zimaos:filens` checks the built image
and exercises launcher/setup behavior with isolated local fixtures.

Mod-Store stores the image at `builtin/filens/<VERSION>/filens.raw`, served via
jsDelivr. The package script enforces a 15 MB distribution budget. The store's
`mod-v2.json` and legacy `mod.json` map `filens` to the versioned image;
`builtin/filens/filens.meta.json` and `SHA256SUMS` record its size and checksum.
Publish and verify the image URL before updating the store index. AppManagement
downloads raw modules from a single URL; Docker image mirror fallback does not
apply to raw modules.
