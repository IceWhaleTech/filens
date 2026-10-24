# Bundle sizes / 分包体积

Generated from the production demo by `npm run report:bundle-sizes`. Units are KiB (1 KiB = 1024 bytes). JavaScript and its matching CSS are grouped; WASM and workers are separate.

| Module / core | Raw | gzip | Brotli |
| --- | ---: | ---: | ---: |
| Conversion core WASM | 872.1 KiB | 395.6 KiB | **318.3 KiB** |
| Image / RAW core WASM | 1072.2 KiB | 293.0 KiB | **210.7 KiB** |
| Demo entry | 173.1 KiB | 48.9 KiB | **40.8 KiB** |
| Shared vendor dependencies | 1319.8 KiB | 369.6 KiB | **305.2 KiB** |
| PPTX / core runtime | 288.6 KiB | 76.1 KiB | **65.4 KiB** |
| Vue preview host | 69.9 KiB | 16.3 KiB | **14.4 KiB** |
| DOCX / XLSX / PDF | 32.5 KiB | 9.8 KiB | **8.8 KiB** |
| On-demand PDF engine | 435.2 KiB | 128.1 KiB | **106.9 KiB** |
| iWork preview | 26.8 KiB | 8.7 KiB | **7.7 KiB** |
| CAD / mind maps / diagrams | 90.2 KiB | 25.2 KiB | **21.6 KiB** |
| 3D preview | 133.4 KiB | 37.9 KiB | **32.9 KiB** |
| Media / panorama preview | 216.9 KiB | 64.1 KiB | **54.7 KiB** |
| Archive preview | 24.7 KiB | 7.9 KiB | **7.0 KiB** |
| Text / ebooks | 22.9 KiB | 8.2 KiB | **7.3 KiB** |
| iWork worker | 894.1 KiB | 186.7 KiB | **156.2 KiB** |
| PDF worker | 1053.3 KiB | 291.1 KiB | **233.1 KiB** |
| Optional STEP WASM | 2625.8 KiB | 1020.2 KiB | **797.0 KiB** |
| STEP loader | 23.0 KiB | 9.5 KiB | **8.7 KiB** |

Initial entry, preload, and CSS: **2131.8 KiB raw / 596.6 KiB gzip / 499.0 KiB Brotli**. This excludes HTML, imagery, video, sample files, and later requests. Shared vendor dependencies are included here and must be considered when reading individual module sizes. Optional STEP uses its separate WASM asset; PDF and iWork have separate workers.

[Exact byte counts and file names](assets/bundle-sizes.json). Compression measurements use the actual build's gzip and Brotli artifacts; server negotiation and caching determine real network transfer. This is a build snapshot, not the size of a published npm tarball.

## Reproduce / 复现

```sh
npm ci
npm run build:vercel
npm run report:bundle-sizes
```

The report updates both README tables and the document core size labels in the READMEs and homepage. The normal NAS build can also be measured with `npm run build:wasm && npm run build:demo`; asset URLs may change the entry size slightly.

本报告对应实际演示站产物，单位为 KiB。JS 与各自 CSS 合并计量，WASM、Worker 和共享第三方依赖独立列出。单个分包体积不等于该格式的全部下载成本；完整首屏还包括 HTML、图片、视频、样例及按需请求。压缩列为构建产物体积，实际网络传输取决于托管配置。
