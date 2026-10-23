<div align="center">
  <img src="apps/demo/public/brand/filens-icon.svg" alt="filens 标志" width="72" height="72" />
  <h1>filens</h1>
  <p><strong>文件的精彩，打开就看见。</strong></p>
  <p>纯前端文件预览项目。从 Office、iWork 到 CAD 和全景照片，本地文件无需上传。</p>
  <p><a href="README.md">English</a> · 简体中文</p>
  <p>
    <a href="#演示">观看演示</a> ·
    <a href="#快速开始">本地体验</a> ·
    <a href="docs/support-matrix.zh-CN.md">支持格式</a>
  </p>
</div>

[![filens 的六种实际预览：演示文稿、文档、表格、Keynote、CAD 和全景照片](docs/assets/readme/overview.webp)](apps/demo/public/home/filens-demo.mp4)

<p align="center"><strong>纯前端预览 · 前后端共用 WASM 转换核心 · 高性能、极致小巧</strong></p>

## 换个角度，看见文件

- **纯前端预览。** 文件在浏览器中解析与渲染，本地预览无需上传，也无需部署转换服务。
- **前后端共用一个 WASM 转换核心。** 浏览器与[后端 CLI / HTTP 转换工具](examples/go-wazero-converter)复用同一个核心；后端只负责调用与服务接入，转换逻辑集中在 WASM 中。
- **高性能、极致小巧。** 按格式分包、按需加载，配合 Worker 解析与页面虚拟化，减少下载与渲染负担。文档转换 WASM 约 **306 KiB Brotli**，预览界面、共享依赖与其他模块另计，详见[体积实测报告](docs/bundle-sizes.md)。

原生预览 PPTX 与 iWork，也能查看文档、表格、CAD、3D、RAW、全景、压缩包和电子书。不同格式的支持范围与保真程度有所区别，详见[格式支持矩阵](docs/support-matrix.zh-CN.md)。

## 小核心，按格式分包

<!-- bundle-sizes:zh:start -->
| 分包 / 核心 | 原始 | gzip | Brotli |
| --- | ---: | ---: | ---: |
| 转换核心 WASM | 870.9 KiB | 395.0 KiB | **317.9 KiB** |
| 图像 / RAW 核心 WASM | 678.5 KiB | 217.5 KiB | **172.2 KiB** |
| 媒体 / 全景预览 | 208.2 KiB | 61.6 KiB | **52.4 KiB** |

两个 WASM 核心独立加载；媒体预览模块与图像转换核心分别计量。JS 分包已包含对应 CSS，共享依赖和 Worker 单列。

<details>
<summary>展开查看全部分包及首屏成本</summary>

| 分包 / 核心 | 原始 | gzip | Brotli |
| --- | ---: | ---: | ---: |
| 演示站入口 | 171.7 KiB | 48.4 KiB | **40.5 KiB** |
| 共享第三方依赖 | 1775.2 KiB | 502.1 KiB | **414.8 KiB** |
| PPTX / 核心运行时 | 275.2 KiB | 71.4 KiB | **61.3 KiB** |
| Vue 预览容器 | 68.7 KiB | 15.8 KiB | **14.0 KiB** |
| DOCX / XLSX / PDF | 20.9 KiB | 6.5 KiB | **5.8 KiB** |
| iWork 预览 | 23.8 KiB | 7.9 KiB | **7.0 KiB** |
| CAD / 思维导图 / 流程图 | 83.1 KiB | 23.4 KiB | **19.9 KiB** |
| 3D 预览 | 105.7 KiB | 28.1 KiB | **24.5 KiB** |
| 压缩包预览 | 20.2 KiB | 6.5 KiB | **5.7 KiB** |
| 文本 / 电子书 | 18.0 KiB | 6.2 KiB | **5.4 KiB** |
| iWork Worker | 882.2 KiB | 181.5 KiB | **151.9 KiB** |
| PDF Worker | 1053.3 KiB | 291.1 KiB | **233.1 KiB** |
| STEP 可选 WASM | 2625.8 KiB | 1020.2 KiB | **797.0 KiB** |
| STEP 加载器 | 23.0 KiB | 9.5 KiB | **8.7 KiB** |

本次构建的入口、预加载 JS 与 CSS 合计 **593.5 KiB Brotli**（原始 2535.9 KiB / gzip 711.6 KiB），另计图片、视频和示例文件。模块会共享依赖；上述体积不代表每种格式的独立总下载量。

</details>

数据来自实际演示站构建。压缩列是产物体积，实际传输取决于托管配置。[完整报告与复现方式](docs/bundle-sizes.md)。
<!-- bundle-sizes:zh:end -->

## 演示

**[▶ 观看 30 秒实录](apps/demo/public/home/filens-demo.mp4)**：演示文稿、文档、表格、Keynote、CAD 与 360° 全景，在同一个工作台轻松切换。

<details>
<summary>展开查看动图预览</summary>

![filens 切换不同文件格式的真实预览录屏](docs/assets/readme/demo.gif)

完整视频见上方链接。[中文字幕](apps/demo/public/home/demo-zh.vtt) · [English captions](apps/demo/public/home/demo-en.vtt)

</details>

## 快速开始

需要 Node.js 20+ 和通过 [rustup](https://rustup.rs/) 安装的 Rust。仓库已锁定编译器与 WASI 目标版本。

```sh
npm ci
npm run build:wasm
npm run dev --workspace @filens/demo
```

打开[本地演示](http://localhost:5173/modules/filens/?lang=zh)，选择示例或拖入自己的文件。网站首页支持中英文切换。

发布演示站可直接[将仓库导入 Vercel](docs/deploy-vercel.md)，绑定后推送代码会自动部署；仓库也提供可选的 GitHub Actions 手动发布流程。

## 接入你的应用

| 想了解… | 从这里开始 |
| --- | --- |
| Vue 预览组件 | [Vue 接入说明](packages/vue/README.md) |
| 格式覆盖与限制 | [格式支持矩阵](docs/support-matrix.zh-CN.md) |
| 架构、方案对比和性能说明 | [项目详细介绍](docs/project-overview.zh-CN.md) |
| CLI / 后端接入 | [Go + wazero 示例](examples/go-wazero-converter/README.md) |
| 部署 | [Vercel 部署指南](docs/deploy-vercel.md) |

欢迎用日常工作文件试一试，[反馈可复现的问题](https://github.com/IceWhaleTech/filens/issues/new/choose)。后续计划见[路线图](docs/roadmap.md)。

<sub>预览截图均来自 filens。照片：Carsten / CC BY 2.0（裁剪及淡蓝调色）、Greg Zaal / Poly Haven / CC0；预览拼图、演示视频和动图采用 CC BY-SA 4.0。<a href="docs/assets/readme/SOURCES.md">素材来源与署名</a>。iWork 研究基础：<a href="https://github.com/dunhamsteve/iwork">dunhamsteve/iwork</a>；CAD 技术来源：<a href="https://github.com/orcastor/cad2x-converter">orcastor/cad2x-converter</a>。</sub>
