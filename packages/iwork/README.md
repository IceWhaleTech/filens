# @filens/iwork

Native front-end iWork preview core for `.key`, `.pages`, and `.numbers`.

## What It Exposes

- `detectIworkType(source, options?)`
- `loadIwork(source, options?)`
- `createIworkViewer(container, options?)`

The package also exports the iWork document and viewer runtime types.

## Install

```bash
npm install @filens/iwork @filens/core
```

`@filens/core` is a runtime dependency because the iWork viewer reuses the shared DOM/SVG render primitives and media registry.

## Usage

```ts
import { createIworkViewer, loadIwork } from '@filens/iwork';
import '@filens/iwork/style.css';

const mount = document.getElementById('mount');
if (!mount) {
  throw new Error('Missing mount element.');
}

const viewer = createIworkViewer(mount, {
  type: 'auto',
  fit: 'contain',
  initialScale: 1,
  minScale: 0.4,
  maxScale: 4
});

await viewer.preview('/samples/a.key');

const numbers = await loadIwork('/samples/a.numbers');
```

## Source Types

`preview()`, `detectIworkType()`, and `loadIwork()` support:

- `string`
- `ArrayBuffer`
- `Uint8Array`
- `Blob`
- `File`

## Viewer Options

```ts
interface IworkViewerOptions {
  type?: 'auto' | 'key' | 'pages' | 'numbers';
  width?: number;
  height?: number;
  fit?: 'contain' | 'width' | 'none';
  initialScale?: number;
  minScale?: number;
  maxScale?: number;
}
```

## Viewer API

```ts
interface IworkViewerInstance {
  preview(source: IworkSource): Promise<void>;
  destroy(): void;
  setScale(scale: number): void;
  fit(mode?: IworkFitMode): void;
  goToPage(index: number): void;
  goToSheet(index: number): void;
  next(): void;
  prev(): void;
  getState(): IworkViewerState;
  on(event, handler): () => void;
}
```

## Events

- `rendered`
- `error`
- `warnings`
- `pagechange`
- `sheetchange`
- `scalechange`

## Rendering Model

The package uses a split architecture:

- parsing runs in a `Web Worker`
- `.iwa` archive decode uses vendored protobuf/type-map assets derived from `iwork-converter`
- semantic extraction builds dedicated Keynote, Pages, and Numbers document models
- rendering reuses shared DOM + SVG primitives from `@filens/core`

## Current Coverage

Good coverage today:

- Keynote slide order and basic slide canvas rendering
- text boxes and paragraph extraction
- images and media asset lookup
- basic shapes and lines
- tables
- Numbers sheet navigation and positioned tables
- warning-based downgrade behavior for unsupported records

Still limited:

- exact Pages body flow and pagination parity
- richer Numbers merged-cell/style/format semantics
- full Keynote placeholder/template fidelity
- charts, comments, collaboration metadata, and animation behavior

## Dist Output

Build output:

- `dist/index.js`
- `dist/index.css`
- `dist/index.d.ts`

Import CSS with:

```ts
import '@filens/iwork/style.css';
```

## Notes

This package targets modern browsers with `Web Worker` support. It does not use Go, WASM, or converted HTML fallbacks.
