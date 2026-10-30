# @filens/core

ESM PPTX parsing and preview core for browser applications.

## What It Exposes

- `init(container, options)`
- `createViewer(container, options)`
- `loadPptx(source)`
- `renderSlideToElement(slide, presentation, options)`

The package also exports the core runtime types.

Workers can import `openZipArchive` and the `ZipEntry` type from
`@filens/core/zip`. This entry loads ZIP parsing without viewer code or CSS.

## Install

```bash
npm install @filens/core
```

## Usage

```ts
import { init } from '@filens/core';
import '@filens/core/style.css';

const mount = document.getElementById('mount');
if (!mount) {
  throw new Error('Missing mount element.');
}

const viewer = init(mount, {
  fit: 'contain',
  initialScale: 1,
  minScale: 0.4,
  maxScale: 4,
  virtual: true
});

await viewer.preview('/samples/sample-deck.pptx');
```

## Source Types

`preview()` and `loadPptx()` support:

- `string`
- `ArrayBuffer`
- `Uint8Array`
- `Blob`
- `File`

For multi-format previews, `createPreviewer()` coordinates registered drivers and
converters. Opening another file or calling `destroy()` settles superseded
`preview()` calls, aborts their load signals, and ignores late results and events.
The signal remains active after the initial load for background resource work.
Custom drivers must release their own DOM and resources on destruction; work that
ignores cancellation may still finish. Rejected loads release their sessions and
expose the error through `getState()` and the `error` event.

Password-protected PDF and Office documents can be opened through `createPreviewer()`.
Register the Office drivers and configure the WASM converter for encrypted Office
packages. Set `requestPassword` to an async callback that receives `{ name, reason,
attempt, signal }` and returns a password or `null` to cancel. `reason` is
`password_required` or `password_invalid`; respect the signal when a file is replaced.
A known password can be supplied per load with
`previewer.preview(source, { name: 'document.docx', password })`.
Passwords retain spaces and Unicode, are not included in preview state, and are
not reused for subsequent documents. Stable `password_cancelled`, `password_required`
and `password_invalid` errors can be recognized with `previewPasswordErrorCode()`.

PPTX and participating optional drivers also expose `PreviewItemState.fonts`
through the generic runtime. This includes discovered font references,
best-effort availability, application mappings, and layout-drift warnings.
Set `fontLoading: true` on `createPreviewer()` to load optional Latin/CJK webfonts
in the background and refresh layouts after loading. Custom packs and
`fontResolver` URL/byte assets support self-hosting and authorization; adaptive
mirrors and bounded backoff retain local fallback when loading fails.
See [font diagnostics and loading](../../docs/fonts.md) for supported formats,
configuration, helper APIs, provenance semantics, and detection limits.

## Viewer Options

```ts
interface ViewerOptions {
  width?: number;
  height?: number;
  fit?: 'contain' | 'width' | 'none';
  initialScale?: number;
  minScale?: number;
  maxScale?: number;
  virtual?: boolean;
}
```

## Viewer API

```ts
interface ViewerInstance {
  preview(source: PptxSource): Promise<void>;
  destroy(): void;
  setScale(scale: number): void;
  fit(mode?: FitMode): void;
  goToSlide(index: number): void;
  next(): void;
  prev(): void;
  getState(): ViewerState;
  on(event, handler): () => void;
}
```

## Events

- `rendered`
- `error`
- `slidechange`
- `scalechange`
- `warnings`

## Rendering Strategy

The current implementation uses HTML + SVG:

- text, images, and tables render through DOM/CSS
- preset shapes, lines, and connectors render through SVG
- thumbnails reuse the same rendering pipeline as the main viewer

## Current Coverage

Good coverage today:

- common text boxes and placeholders
- images
- grouped shapes
- tables
- theme colors and fonts
- master/layout inheritance
- common preset arrows and polygon shapes
- slide links and external hyperlinks
- cached 2D column and pie charts, with titles and legends

Still limited:

- animations
- other chart types and advanced chart formatting
- SmartArt
- media playback objects
- embedded fonts
- some long-tail shape formulas

## Dist Output

Build output:

- `dist/index.js`
- `dist/index.css`
- `dist/index.d.ts`

Import CSS with:

```ts
import '@filens/core/style.css';
```
