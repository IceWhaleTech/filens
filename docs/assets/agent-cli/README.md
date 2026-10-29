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
1280 × 820, 12 fps, 48-second deterministic replays of actual CLI requests
and responses, with localized commands, interface text and synthetic documents.
The matching PNG files are static posters. The eight scenes open with OCR geometry,
then demonstrate Markdown, model-free excerpts, lexical document search,
full-file duplicates, perceptual image groups, YAML and capability discovery.
The image scene uses a deterministic canvas landscape, a resized JPEG and a
recompressed WebP; its distances come from the real WASM scan.
`prune-meeting.en.txt` and `prune-meeting.txt` are fictional
meeting notes used by the excerpt scene.
The side panel visualizes returned OCR geometry over the actual fictional
invoice input. JSON/YAML responses are excerpts, search paths are shortened,
and typing/response timings are edited. Retrieval uses BM25, without an embedding
model. No hosted language model or generated reasoning is depicted.
These are source-build capabilities; the build command in the animation is
intentional. Published stable npm 0.2.0 does not include pruning, search or similarity scans.

Run `npm run build:agent`, then `npm run demo:agent` to rebuild both languages.
Use `--lang en` or `--lang zh-CN` for one version, and `--poster-only` to validate
the scenes and capture posters without encoding GIFs.
Authoring source: `scripts/agent-cli-demo.html` and
`scripts/capture-agent-cli-demo.mjs`. Complete native outputs, input files,
timings and the GIF hash are recorded under `dist/agent-demo/en/` and
`dist/agent-demo/zh-CN/`. Playwright and
FFmpeg are authoring dependencies only, with system sans/monospace fonts.
