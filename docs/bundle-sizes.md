# Bundle sizes / 分包体积

Generated from the production demo by `npm run report:bundle-sizes`. Units are KiB (1 KiB = 1024 bytes). JavaScript and its matching CSS are grouped; WASM and workers are separate.

| Module / core | Raw | gzip | Brotli |
| --- | ---: | ---: | ---: |
| Conversion core WASM | 828.4 KiB | 376.8 KiB | **305.8 KiB** |
| Image / RAW core WASM | 655.4 KiB | 204.6 KiB | **163.1 KiB** |
| Demo entry | 159.9 KiB | 44.8 KiB | **37.6 KiB** |
| Shared vendor dependencies | 1837.6 KiB | 523.8 KiB | **433.4 KiB** |
| PPTX / core runtime | 275.0 KiB | 71.3 KiB | **61.2 KiB** |
| Vue preview host | 68.6 KiB | 15.8 KiB | **14.0 KiB** |
| DOCX / XLSX / PDF | 20.9 KiB | 6.5 KiB | **5.8 KiB** |
| iWork preview | 23.8 KiB | 7.9 KiB | **7.0 KiB** |
| CAD / mind maps / diagrams | 83.1 KiB | 23.4 KiB | **19.9 KiB** |
| 3D preview | 105.8 KiB | 28.2 KiB | **24.6 KiB** |
| Media / panorama preview | 94.8 KiB | 26.3 KiB | **23.0 KiB** |
| Archive preview | 20.2 KiB | 6.5 KiB | **5.7 KiB** |
| Text / ebooks | 18.0 KiB | 6.2 KiB | **5.4 KiB** |
| iWork worker | 882.2 KiB | 181.5 KiB | **151.9 KiB** |
| PDF worker | 1053.3 KiB | 291.1 KiB | **233.1 KiB** |
| Optional STEP / IGES WASM | 7425.8 KiB | 3038.0 KiB | **2260.8 KiB** |

Initial entry, preload, and CSS: **2473.1 KiB raw / 694.5 KiB gzip / 579.8 KiB Brotli**. This excludes HTML, imagery, video, sample files, and later requests. Shared vendor dependencies are included here and must be considered when reading individual module sizes. Optional STEP/IGES uses its separate WASM asset; PDF and iWork have separate workers.

[Exact byte counts and file names](assets/bundle-sizes.json). Compression measurements use the actual build's gzip and Brotli artifacts; server negotiation and caching determine real network transfer. This is a build snapshot, not the size of a published npm tarball.

## Reproduce / 复现

```sh
npm ci
npm run build:vercel
npm run report:bundle-sizes
```

The report updates the tables in both README files. The normal NAS build can also be measured with `npm run build:wasm && npm run build:demo`; asset URLs may change the entry size slightly.

本报告对应实际演示站产物，单位为 KiB。JS 与各自 CSS 合并计量，WASM、Worker 和共享第三方依赖独立列出。单个分包体积不等于该格式的全部下载成本；完整首屏还包括 HTML、图片、视频、样例及按需请求。压缩列为构建产物体积，实际网络传输取决于托管配置。
