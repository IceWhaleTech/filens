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

`terminal-demo.gif` is a 1280 × 820, 12 fps, 28.5-second deterministic replay of
actual CLI requests and responses. `terminal-demo.png` is its static poster.
The side panel visualizes returned OCR geometry over the actual fictional
invoice input. JSON/YAML responses are excerpts; typing and response timings
are edited. No hosted language model or semantic reasoning is depicted.

Run `npm run build:agent`, `npm run test:agent:layout`, then `npm run demo:agent`.
Authoring source: `scripts/agent-cli-demo.html` and
`scripts/capture-agent-cli-demo.mjs`. Complete native outputs, input files,
timings and the GIF hash are recorded under `dist/agent-demo/`. Playwright and
FFmpeg are authoring dependencies only, with system sans/monospace fonts.
