# Bundle sizes / 分包体积

Generated from the production demo by `npm run report:bundle-sizes`. Units are KiB (1 KiB = 1024 bytes). JavaScript and its matching CSS are grouped; WASM and workers are separate.

| Module / core | Raw | gzip | Brotli |
| --- | ---: | ---: | ---: |
| Conversion core WASM | 871.0 KiB | 395.0 KiB | **317.6 KiB** |
| Image / RAW core WASM | 678.5 KiB | 217.5 KiB | **172.0 KiB** |
| Demo entry | 173.4 KiB | 49.0 KiB | **41.0 KiB** |
| Shared vendor dependencies | 1775.2 KiB | 502.1 KiB | **414.8 KiB** |
| PPTX / core runtime | 275.2 KiB | 71.4 KiB | **61.3 KiB** |
| Vue preview host | 68.7 KiB | 15.8 KiB | **14.0 KiB** |
| DOCX / XLSX / PDF | 20.9 KiB | 6.5 KiB | **5.8 KiB** |
| iWork preview | 23.8 KiB | 7.9 KiB | **7.0 KiB** |
| CAD / mind maps / diagrams | 83.1 KiB | 23.4 KiB | **19.9 KiB** |
| 3D preview | 105.7 KiB | 28.1 KiB | **24.5 KiB** |
| Media / panorama preview | 208.7 KiB | 61.7 KiB | **52.6 KiB** |
| Archive preview | 20.2 KiB | 6.5 KiB | **5.7 KiB** |
| Text / ebooks | 18.0 KiB | 6.2 KiB | **5.4 KiB** |
| iWork worker | 882.2 KiB | 181.5 KiB | **151.9 KiB** |
| PDF worker | 1053.3 KiB | 291.1 KiB | **233.1 KiB** |
| Optional STEP WASM | 2625.8 KiB | 1020.2 KiB | **797.0 KiB** |
| STEP loader | 23.0 KiB | 9.5 KiB | **8.7 KiB** |

Initial entry, preload, and CSS: **2538.1 KiB raw / 712.4 KiB gzip / 594.2 KiB Brotli**. This excludes HTML, imagery, video, sample files, and later requests. Shared vendor dependencies are included here and must be considered when reading individual module sizes. Optional STEP uses its separate WASM asset; PDF and iWork have separate workers.

[Exact byte counts and file names](assets/bundle-sizes.json). Compression measurements use the actual build's gzip and Brotli artifacts; server negotiation and caching determine real network transfer. This is a build snapshot, not the size of a published npm tarball.

## Reproduce / 复现

```sh
npm ci
npm run build:vercel
npm run report:bundle-sizes
```

The report updates both README tables and the document core size labels in the READMEs and homepage. The normal NAS build can also be measured with `npm run build:wasm && npm run build:demo`; asset URLs may change the entry size slightly.

本报告对应实际演示站产物，单位为 KiB。JS 与各自 CSS 合并计量，WASM、Worker 和共享第三方依赖独立列出。单个分包体积不等于该格式的全部下载成本；完整首屏还包括 HTML、图片、视频、样例及按需请求。压缩列为构建产物体积，实际网络传输取决于托管配置。
