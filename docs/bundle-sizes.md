# Bundle sizes / 分包体积

Generated from the production demo by `npm run report:bundle-sizes`. Units are KiB (1 KiB = 1024 bytes). JavaScript and its matching CSS are grouped; WASM and workers are separate.

| Module / core | Raw | gzip | Brotli |
| --- | ---: | ---: | ---: |
| Conversion core WASM | 871.2 KiB | 395.2 KiB | **318.0 KiB** |
| Image / RAW core WASM | 1072.2 KiB | 293.0 KiB | **210.7 KiB** |
| Demo entry | 173.1 KiB | 48.9 KiB | **40.9 KiB** |
| Shared vendor dependencies | 1776.4 KiB | 504.2 KiB | **414.7 KiB** |
| PPTX / core runtime | 284.0 KiB | 75.0 KiB | **64.3 KiB** |
| Vue preview host | 68.7 KiB | 15.9 KiB | **14.0 KiB** |
| DOCX / XLSX / PDF | 22.9 KiB | 7.3 KiB | **6.5 KiB** |
| iWork preview | 24.4 KiB | 8.1 KiB | **7.2 KiB** |
| CAD / mind maps / diagrams | 83.5 KiB | 23.7 KiB | **20.2 KiB** |
| 3D preview | 105.7 KiB | 28.2 KiB | **24.5 KiB** |
| Media / panorama preview | 210.4 KiB | 62.2 KiB | **53.0 KiB** |
| Archive preview | 20.1 KiB | 6.4 KiB | **5.7 KiB** |
| Text / ebooks | 18.0 KiB | 6.2 KiB | **5.4 KiB** |
| iWork worker | 899.0 KiB | 188.2 KiB | **157.4 KiB** |
| PDF worker | 1053.3 KiB | 291.1 KiB | **233.1 KiB** |
| Optional STEP WASM | 2625.8 KiB | 1020.2 KiB | **797.0 KiB** |
| STEP loader | 23.0 KiB | 9.5 KiB | **8.7 KiB** |

Initial entry, preload, and CSS: **2549.5 KiB raw / 718.5 KiB gzip / 597.4 KiB Brotli**. This excludes HTML, imagery, video, sample files, and later requests. Shared vendor dependencies are included here and must be considered when reading individual module sizes. Optional STEP uses its separate WASM asset; PDF and iWork have separate workers.

[Exact byte counts and file names](assets/bundle-sizes.json). Compression measurements use the actual build's gzip and Brotli artifacts; server negotiation and caching determine real network transfer. This is a build snapshot, not the size of a published npm tarball.

## Reproduce / 复现

```sh
npm ci
npm run build:vercel
npm run report:bundle-sizes
```

The report updates both README tables and the document core size labels in the READMEs and homepage. The normal NAS build can also be measured with `npm run build:wasm && npm run build:demo`; asset URLs may change the entry size slightly.

本报告对应实际演示站产物，单位为 KiB。JS 与各自 CSS 合并计量，WASM、Worker 和共享第三方依赖独立列出。单个分包体积不等于该格式的全部下载成本；完整首屏还包括 HTML、图片、视频、样例及按需请求。压缩列为构建产物体积，实际网络传输取决于托管配置。
