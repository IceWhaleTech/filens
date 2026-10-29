# Bundled OCR components

- Photos NCNN JSON runtime, artifact ABI v7 / JSON ABI v2, release 2026.10.28.2.
  Source snapshot and build provenance:
  https://huggingface.co/orca-zhang/ncnn/tree/8ffa14f2024c6fe4fbb2b4a0ea88e8f2ab069f96/runtime/releases/ncnn/2026.10.28.2
  The runtime provides image decoding, preprocessing and native OCR. filens
  invokes it as an isolated optional capability; document parsing stays in WASM.
- Tencent NCNN, source d0d50631179e380e587fb188338f5683d2c93275, BSD 3-Clause.
  License: native/licenses/NCNN.txt. OpenMP uses bundled SimpleOMP.
- Linux/Windows companions include Zig and LLVM libc++ runtime components; Linux also includes libc++abi and libunwind runtime
  components. Their notices are in native/licenses/{Zig,libcxx,libcxxabi,libunwind}.txt.
  The macOS companion uses the operating system C++ library.
- RapidAI RapidOcrNcnn 1.2.0 OCR pipeline; PaddleOCR models: PP-OCRv6 small
  detection, mobile v2 orientation classification, PP-OCRv3 Chinese/English
  recognition and character dictionary. Apache License 2.0, included in
  native/licenses/Apache-2.0.txt. Model provenance, upstream commit and hashes
  are recorded in models/rapidocr-ncnn/metadata.json and the filens model manifest.
  https://github.com/RapidAI/RapidOcrNcnn
  https://github.com/PaddlePaddle/PaddleOCR

The Rust CLI uses Wasmi / wasmi_wasi 0.46.0 (MIT OR Apache-2.0),
wasi-common (Apache-2.0 WITH LLVM-exception), libloading, serde / serde_json /
serde_yaml, regex, flate2, png, tempfile and ctrlc. The locked dependencies'
license texts and version metadata are collected into licenses/rust-cli.txt.
PDFium remains the WASM artifact from go-pdfium v1.17.3, verified by SHA-256;
its upstream license notice is included as go-pdfium@v1.17.3-LICENSE.txt.
The optional image WASM engine uses jpeg-encoder and the repository's modified
rawloader 0.37.2 (LGPL-2.1). RAW source and local changes are maintained at
wasm/converter-image-rust/vendor/rawloader in the filens source repository;
the package includes its LGPL and X3F notices in licenses/rust-cli.txt.

The optional native OCR wrapper also contains Go, purego, imaging,
gotokenizers, regexp2, protobuf and Go x/image/x/text components. Their notices
are included in the package license directory. All wrappers are rebuilt from the
pinned published source snapshot with Go -trimpath. The macOS target is 12.0;
Linux wrappers use Zig's glibc 2.17 target. wrapper-build.json records the
source and rebuilt artifact hashes without workstation paths.
Windows x64 uses Zig's GNU target, system-only DLL dependencies and bundled
SimpleOMP. The NCNN source snapshot uses std::call_once for its Windows
initialization; the wrapper uses LoadLibrary and NCNN's UTF-16 model-path APIs.
These compatibility patches are maintained in scripts/build-agent-ncnn-windows.mjs
and packaging/ncnn-windows/native_loader_windows.go.

UPX 5.1.0 compresses Windows/Linux CLI executables. Its license explicitly
permits distribution of packed programs without imposing its license on them:
https://github.com/upx/upx/blob/v5.1.0/LICENSE
The external UPX tool is needed only for source builds, not at runtime.

The shared text WASM core uses lopdf 0.46.0 (MIT), ttf-parser 0.25.1
(MIT OR Apache-2.0), and unicode-normalization 0.1.26
((MIT OR Apache-2.0) AND Unicode-3.0) for PDF font mapping recovery.
Their notices and those of the added transitive Rust components are included
in the package license directory as pdf-unicode-rust.txt.

Legacy Go library hosts retain their existing dependency notices, including
wazero and go.yaml.in/yaml/v3; the distributed CLI itself is Rust.

This notice describes third-party components and does not grant a new license
for filens or the Photos application code.

## Private directory discovery component

Windows and Linux CLI binaries embed compiled hdrw WASI, a proprietary component used through the FiLens directory adapter. hdrw source is not included or licensed as part of FiLens. macOS release binaries use native system FTS and do not embed this component. Maintainer provenance and artifact hashes are recorded in `cli/assets/hdrw.json`; the adapter exposes mounted-directory enumeration, without raw device access.

The embedded WASI module also includes Go standard library/runtime components;
their license is included in the package license directory as Go.txt.
