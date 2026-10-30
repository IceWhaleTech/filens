# Standalone browser previews / 独立前端预览

Build the same preview engines as a single JavaScript file or split modules. Both
include Vue, styles, PDF/iWork workers and the document, image/RAW and STEP WASM
engines. No conversion server or host Vue installation is needed.

Version 0.1.3 uses native HEIC/HEIF decoding first, with a small dedicated WASM
decoder as fallback. MOV plays through browser codecs; full FFmpeg is excluded.
Applications can supply an optional `mediaConverter` for unsupported MOV codecs.
Both builds preserve the same image and video support boundaries.

```sh
npm install filens-preview
```

```js
import { createPreview } from 'filens-preview';
// Or: import { createPreview } from 'filens-preview/all-in-one';
```

The npm package includes both runtime directories, TypeScript declarations and third-party notices.
Deploy `node_modules/filens-preview/dist/split/` or `dist/all-in-one/` for direct browser use.

## Build and use

```sh
npm ci
npm run build:wasm
npm run build:preview
```

| Build | Deploy | Approximate runtime size |
| --- | --- | --- |
| Split | Entire `packages/preview/dist/split/` directory | 13.5 MB raw / 4.2 MB gzip / 3.3 MB Brotli, across all runtime files |
| All in one | `packages/preview/dist/all-in-one/filens.js` | 16.3 MB raw / 5.2 MB gzip / 3.9 MB Brotli |

Both directories contain an `index.html` with a local file picker. Serve either
directory over HTTP(S). To integrate into another page:

```html
<div id="preview" style="height: 80vh"></div>
<script type="module">
  import { createPreview } from './split/filens.js';
  // Or: import { createPreview } from './all-in-one/filens.js';

  const viewer = createPreview('#preview', {
    src: './report.pdf',
    name: 'report.pdf',
    onError: error => console.error(error)
  });
  // File / Blob / Uint8Array sources also work; supply a name or extension.
  // viewer.update({ src: anotherFile, name: anotherFile.name });
  // viewer.destroy();
</script>
```

`createPreview()` mounts the shared `Preview` component and returns `update()` and
`destroy()`. Options include `src`, `name`, `extension`, `toolbar`, `converter`, `panoramaProcessor`,
`resourceResolver`, `fontResolver`, `onRendered` and `onError`. The default converter
uses the bundled frontend WASM engines. Use [`@filens/vue`](https://github.com/IceWhaleTech/filens/tree/main/packages/vue) for
direct Vue component integration.

Split chunks can range from a few KB to hundreds of KB after compression. Those
figures exclude shared dependencies and engines; a chunk is not a complete
per-format download. The all-in-one file embeds CSS, base64 WASM and workers; it
needs no additional runtime files. Its larger initial download includes optional
OCCT as well as the default Rust STEP engine. A separate notices file accompanies
both builds and should be distributed with them. [Exact measurements](https://github.com/IceWhaleTech/filens/blob/main/docs/preview-build-sizes.json).

Single-file embedding still requires browser support for WebAssembly and workers.
Pages with a Content Security Policy must permit the generated inline styles,
`blob:` workers and `data:` WASM. Use an HTTP(S) server for module imports, rather
than opening `index.html` as a `file:` URL. The supported formats and fidelity
limits are shared with the [demo](https://github.com/IceWhaleTech/filens/blob/main/docs/support-matrix.md).

## CLI preview

CLI 0.4.0 includes `preview`. The first preview downloads the optional frontend
package into the writable versioned cache; subsequent previews work offline.
You can install it ahead of time:

```sh
npm install -g filens-cli
filens setup-preview
filens preview report.pdf
filens preview report.pdf --no-open --json
```

`filens-cli-lite` supports the same preview command without OCR models. Frontend
resources are separate from the base CLI installation. For a source build:

```sh
npm run build:wasm
npm run build:agent:preview
npm run filens -- preview report.pdf

# Or run the freshly built binary directly
./dist/filens preview drawing.step
./dist/filens preview report.pdf --no-open --json
```

Preview serves the selected file and built assets on `127.0.0.1`, chooses a free
port, and opens the browser. Parsing, conversion and rendering happen in the
browser. Ctrl-C stops the server. `--no-open --json` prints a URL for an Agent or a
terminal without a browser; the command keeps running until stopped.

```sh
# Choose a port or another built runtime (including the all-in-one build)
filens preview report.pdf --port 8080 --assets /path/to/preview/dist/all-in-one
```

`FILENS_PREVIEW_DIR` overrides the default `<binary-directory>/preview` asset
directory. Source npm packaging can include the assets with
`node scripts/package-agent-npm.mjs --with-preview`; they are optional and add
about 13.5 MB on disk, measured separately from the document-reading CLI.

The server exposes one selected file, not its parent directory. Models or media
with external sidecars need a supported ZIP bundle or a host-provided resource
resolver; arbitrary adjacent files are not served. Binary media responses support
byte ranges. The listener checks the Host and Origin, scopes routes to a random
session path, and rejects directory traversal. CLI preview has been exercised on
macOS; Windows/Linux browser launching still needs native validation.

## 中文说明

两种产物使用相同 API：分包版部署整个 `split/` 目录，WASM 与重型引擎按需加载；
单文件版仅需部署 `all-in-one/filens.js`，其中包含 Vue、样式、Worker 和 WASM，
另附第三方许可文件。单文件部署更简单，初次下载也更大。

`filens preview 文件路径` 会启动本地浏览器预览，由前端完成格式解析与渲染。
CLI 0.4.1 首次预览时自动安装 filens-preview 0.1.3，也可先运行 `filens setup-preview`；
源码版先运行 `npm run build:agent:preview`。
独立前端包同时包含单文件和分包产物，完整安装约 31 MB，包含专用 HEIC/HEIF 解码器，不含完整 FFmpeg，不混入 CLI 的
约 2 MB / Lite 8 MB / Full 30 多 MB 安装体积。源码仅附带分包时约 13.5 MB。图片先尝试原生显示，分包版仅在失败时加载 HEIF 解码器；视频使用浏览器编解码器，不支持的编码可通过可选 mediaConverter 接入转换器。`--no-open --json` 返回本地地址，`--assets` 可切换单文件或分包版，
Ctrl-C 退出。仅提供选中的文件，不开放整个父目录；伴随文件需要打成受支持的 ZIP
或由宿主配置解析器。
