<div align="center">
  <img src="apps/demo/public/brand/filens-icon.svg" alt="filens 标志" width="72" height="72" />
  <h1>filens</h1>
  <p><strong>文件的精彩，打开就看见。</strong></p>
  <p>从 Office、iWork 到 CAD 和全景照片，在浏览器里轻松预览。</p>
  <p><a href="README.md">English</a> · 简体中文</p>
  <p>
    <a href="#演示">观看演示</a> ·
    <a href="#快速开始">本地体验</a> ·
    <a href="docs/support-matrix.md">支持格式</a>
  </p>
</div>

[![filens 的六种实际预览：演示文稿、文档、表格、Keynote、CAD 和全景照片](docs/assets/readme/overview.webp)](apps/demo/public/home/filens-demo.mp4)

<p align="center"><strong>本地优先 · 开源 · WebAssembly 驱动</strong></p>

## 换个角度，看见文件

- **文件就地打开。** 本地文件直接在浏览器中预览，无需先上传到转换服务。
- **从办公文件到专业格式。** 原生预览 PPTX 与 iWork，也能查看文档、表格、CAD、3D、RAW、全景、压缩包和电子书。
- **把同一套能力带进应用。** 用 Vue 组件接入界面，也能在 CLI、桌面应用或后端中托管同一个 WASM 转换核心。

不同格式的支持范围与保真程度有所区别，详见[格式支持矩阵](docs/support-matrix.md)。

## 小核心，按格式分包

<!-- bundle-sizes:zh:start -->
| 分包 / 核心 | 原始 | gzip | Brotli |
| --- | ---: | ---: | ---: |
| 转换核心 WASM | 828.4 KiB | 376.8 KiB | **305.8 KiB** |
| 图像 / RAW 核心 WASM | 655.4 KiB | 204.6 KiB | **163.1 KiB** |
| 媒体 / 全景预览 | 94.8 KiB | 26.3 KiB | **23.0 KiB** |

两个 WASM 核心独立加载；媒体预览模块与图像转换核心分别计量。JS 分包已包含对应 CSS，共享依赖和 Worker 单列。

<details>
<summary>展开查看全部分包及首屏成本</summary>

| 分包 / 核心 | 原始 | gzip | Brotli |
| --- | ---: | ---: | ---: |
| 演示站入口 | 159.9 KiB | 44.8 KiB | **37.6 KiB** |
| 共享第三方依赖 | 1837.6 KiB | 523.8 KiB | **433.4 KiB** |
| PPTX / 核心运行时 | 275.0 KiB | 71.3 KiB | **61.2 KiB** |
| Vue 预览容器 | 68.6 KiB | 15.8 KiB | **14.0 KiB** |
| DOCX / XLSX / PDF | 20.9 KiB | 6.5 KiB | **5.8 KiB** |
| iWork 预览 | 23.8 KiB | 7.9 KiB | **7.0 KiB** |
| CAD / 思维导图 / 流程图 | 83.1 KiB | 23.4 KiB | **19.9 KiB** |
| 3D 预览 | 105.8 KiB | 28.2 KiB | **24.6 KiB** |
| 压缩包预览 | 20.2 KiB | 6.5 KiB | **5.7 KiB** |
| 文本 / 电子书 | 18.0 KiB | 6.2 KiB | **5.4 KiB** |
| iWork Worker | 882.2 KiB | 181.5 KiB | **151.9 KiB** |
| PDF Worker | 1053.3 KiB | 291.1 KiB | **233.1 KiB** |
| STEP / IGES 可选 WASM | 7425.8 KiB | 3038.0 KiB | **2260.8 KiB** |

本次构建的入口、预加载 JS 与 CSS 合计 **579.8 KiB Brotli**（原始 2473.1 KiB / gzip 694.5 KiB），另计图片、视频和示例文件。模块会共享依赖；上述体积不代表每种格式的独立总下载量。

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
| 格式覆盖与限制 | [格式支持矩阵](docs/support-matrix.md) |
| 架构、方案对比和性能说明 | [项目详细介绍](docs/project-overview.zh-CN.md) |
| CLI / 后端接入 | [Go + wazero 示例](examples/go-wazero-converter/README.md) |
| 部署 | [Vercel 部署指南](docs/deploy-vercel.md) |

欢迎用日常工作文件试一试，[反馈可复现的问题](https://github.com/IceWhaleTech/filens/issues/new/choose)。后续计划见[路线图](docs/roadmap.md)。

<sub>预览截图均来自 filens。照片：Ricardo Gomez Angel / Unsplash、SimonWaldherr / CC BY-SA 4.0；全景衍生图、演示视频和动图采用 CC BY-SA 4.0。<a href="docs/assets/readme/SOURCES.md">素材来源与署名</a>。iWork 研究基础：<a href="https://github.com/dunhamsteve/iwork">dunhamsteve/iwork</a>；CAD 技术来源：<a href="https://github.com/orcastor/cad2x-converter">orcastor/cad2x-converter</a>。</sub>
