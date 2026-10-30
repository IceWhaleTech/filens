# @filens/vue

Vue 3 components for the shared preview engines: `Preview` is the all-format entry;
`PptxPreview` and `IworkPreview` provide specialized viewers. For a ready-to-deploy
single JS file or split modules including Vue, see the [standalone builds](../preview/README.md).

## All-format entry

```vue
<script setup lang="ts">
import { Preview } from '@filens/vue';
import '@filens/vue/style.css';
</script>

<template>
  <Preview src="/report.pdf" name="report.pdf" />
</template>
```

`src` also accepts a `File`, `Blob` or byte array; provide `name` or `extension`
when the source has no filename. Legacy Office and RAW previews need a
`converter` configured with `createWasmConverterClient({ wasm, imageWasm })`
from `@filens/converter-client`. See the demo for complete WASM asset wiring.

## Install

```bash
npm install @filens/vue @filens/core @filens/iwork
```

`vue` is a peer dependency and must be provided by the host app.

## Password-protected documents

The generic `Preview` component prompts for passwords when opening encrypted PDFs
and Office documents. Configure its `converter` with `createWasmConverterClient()`
for Office decryption in the browser. Supported Office encryption includes Agile,
Office 2007 Standard, legacy RC4 CryptoAPI and XLS XOR obfuscation; rights-managed
documents and other unsupported encryption methods report a format error.

The password form supports incorrect-password retries, cancellation and reopening.
It clears the entered password after submission, cancellation or changing files.
The optional `password` prop supplies a known password; `requestPassword` replaces
the built-in form with a host callback using `PreviewOptions['requestPassword']`.

## Usage

```vue
<script setup lang="ts">
import { IworkPreview, PptxPreview } from '@filens/vue';
import '@filens/vue/style.css';

const src = '/samples/sample-deck.pptx';
const keySrc = '/samples/a.key';
</script>

<template>
  <PptxPreview :src="src" fit="contain" :toolbar="true" :thumbnails="true" />
  <IworkPreview :src="keySrc" type="key" :toolbar="true" :thumbnails="true" />
</template>
```

## `PptxPreview` Props

```ts
interface PptxPreviewProps {
  src: string | ArrayBuffer | Uint8Array | Blob | File;
  fit?: 'contain' | 'width' | 'none';
  initialScale?: number;
  minScale?: number;
  maxScale?: number;
  toolbar?: boolean;
  thumbnails?: boolean;
}
```

## `PptxPreview` Emits

- `rendered`
- `error`
- `slide-change`
- `scale-change`
- `warnings`

## `IworkPreview` Props

```ts
interface IworkPreviewProps {
  src: string | ArrayBuffer | Uint8Array | Blob | File;
  type?: 'auto' | 'key' | 'pages' | 'numbers';
  initialScale?: number;
  minScale?: number;
  maxScale?: number;
  toolbar?: boolean;
  thumbnails?: boolean;
}
```

## `IworkPreview` Emits

- `rendered`
- `error`
- `warnings`
- `page-change`
- `sheet-change`
- `scale-change`

## Behavior

The components are designed to feel close to the `vue-office` direct-`src` usage pattern:

- pass `src` directly as a URL or binary source
- source changes trigger a fresh preview automatically
- the old preview task is discarded by the viewer lifecycle
- toolbar and thumbnails are built in
- `IworkPreview` automatically switches between paged and sheet-oriented behavior depending on document kind

## Included UI

- top toolbar
- left thumbnail rail
- main preview area
- zoom in / out
- fit to page
- fit to width
- previous / next slide
- previous / next iWork page or sheet where applicable
- keyboard navigation when the shell is focused

## Dist Output

Build output:

- `dist/index.js`
- `dist/style.css`
- `dist/index.d.ts`

Import CSS with:

```ts
import '@filens/vue/style.css';
```

## Scope

This package is for client-side Vue 3 apps in modern browsers. It is not currently positioned as an SSR-first or full Office/iWork-compatibility renderer.
