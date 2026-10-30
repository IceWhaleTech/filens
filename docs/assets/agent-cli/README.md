# Synthetic OCR evaluation inputs

These images contain fictional invoice text, with no production or personal data.
The same seven lines in `invoice-zh.expected.txt` appear in every 1440 × 1000
image. Generated with Playwright Chromium on macOS arm64, PingFang SC / Arial:

- `invoice-zh.png`: 34 px text.
- `invoice-blur.png`: 34 px text, CSS blur 2.4 px.
- `invoice-small.png`: 13 px text.
- `invoice-tiny.png`: 7 px text.
- `invoice-heavy-blur.png`: 34 px text, CSS blur 6.4 px.

Regenerate with `node scripts/generate-agent-ocr-fixtures.mjs`. Different fonts
or browser versions can change the rendered pixels; the checked-in PNGs are the
inputs to the recorded evaluation. Runtime CLI users do not need Playwright.
These five controlled inputs are functional/quality observations, not a general
OCR benchmark corpus. See ../../agent-cli-examples.zh-CN.md for actual errors.

## Agent CLI terminal demo

`terminal-demo.gif` (English) and `terminal-demo.zh-CN.gif` (Chinese) are
1280 × 820, 12 fps, 60-second deterministic replays of actual CLI requests
and responses, with localized commands, interface text and synthetic documents.
The matching PNG files are static posters. The eleven scenes open with OCR geometry,
then demonstrate Markdown, model-free excerpts, nested ZIP search and direct member
reading, full-file duplicates, perceptual image groups, CSV-to-XLSX conversion,
previewing that converted workbook, orbiting a STEP assembly, and capability discovery.
YAML remains in the capability list and is checked against actual CLI output.
The image scene uses a deterministic canvas landscape, a resized JPEG and a
recompressed WebP; its distances come from the real WASM scan.
`prune-meeting.en.txt` and `prune-meeting.txt` are fictional
meeting notes used by the excerpt scene.
The side panel visualizes returned OCR geometry over the actual fictional
invoice input. JSON responses are excerpts, search paths and preview URL tokens are shortened,
and typing/response timings are edited. Retrieval uses BM25, without an embedding
model. No hosted language model or generated reasoning is depicted.
The ZIP contains a second ZIP with a fictional DOCX agreement. Returned UTF-8
evidence offsets are verified against a fresh read of that exact archive member.
The CSV budget is fictional; the CLI converts it through the shared WASM core.
The resulting XLSX is read back and opened using the actual CLI loopback server.
The workbook and STEP panels replay real captures from that server's shared
frontend viewer, with external network requests blocked. Model rotation is a real
pointer drag sampled into 60 frames; its playback timing is edited. The STEP
assembly is the unmodified `cax-if/as1_pe_203.stp` fixture from
[occt-import-js 0.0.23](../../../packages/model3d/test/fixtures/occt/README.md),
under the upstream MIT license. It is copied into the demo directory as `drawing.step`.

The captures use the local source build and prepared optional preview assets.
The footer shows the end-user installation command, `npm install -g filens-cli`;
it is not an installation recording or a registry-release verification. Installed
builds can report their capabilities with `filens capacity --json`. Browser preview
requires the separate frontend assets (`filens setup-preview` in the npm launcher).

Run `npm run build:agent` and `npm run build:preview`, then `npm run demo:agent`
to rebuild both languages. `--preview-assets DIR` or `FILENS_PREVIEW_DIR` can
select an existing standalone build instead of `dist/preview`.
Use `--lang en` or `--lang zh-CN` for one version, and `--poster-only` to validate
the scenes and capture posters without encoding GIFs.
Authoring source: `scripts/agent-cli-demo.html` and
`scripts/capture-agent-cli-demo.mjs`. Complete native outputs, input files,
timings, source preview screenshots, their hashes and the GIF hash are recorded under `dist/agent-demo/en/` and
`dist/agent-demo/zh-CN/`. Playwright and
FFmpeg are authoring dependencies only, with system sans/monospace fonts.
