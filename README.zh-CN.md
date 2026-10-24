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

[![filens 的八种实际预览：演示文稿、文档、表格、PDF、Keynote、CAD、3D 和全景照片](docs/assets/readme/overview.webp)](apps/demo/public/home/filens-demo.mp4)

<p align="center"><strong>纯前端预览 · WASM 转换，灵活部署 · 高性能、极致小巧</strong></p>

## 换个角度，看见文件

- **纯前端预览。** 文件在浏览器中解析与渲染，本地预览无需上传，也无需部署转换服务。
- **WASM 转换，灵活部署。** 转换模块可在浏览器中直接运行，也可通过 [CLI / HTTP 工具](examples/go-wazero-converter)独立使用；文件解析与转换由 WASM 完成，服务端负责请求和文件管理。
- **按格式加载，减少等待。** 按格式分包、按需加载，配合 Worker 解析与页面虚拟化，减少下载与渲染负担。文档转换 WASM 为 **<!-- bundle-size:converter-core -->318.0<!-- /bundle-size --> KiB Brotli**，预览界面、共享依赖与其他模块另计，详见[体积实测报告](docs/bundle-sizes.md)。

原生预览 PPTX 与 iWork，也能查看文档、表格、CAD、3D、RAW、全景、压缩包和电子书。不同格式的支持范围与保真程度有所区别，详见[格式支持矩阵](docs/support-matrix.zh-CN.md)。

## 浏览器里，也能看见这些

**直接打开 iWork 三件套，环顾相机全景原片，快速看见 RAW。** 从演示文稿到镜头背后的原始数据，都在同一个文件工作台。

以下按方向选取可在浏览器本地运行的代表项目。

| 前端项目 | PPTX 原生预览 | iWork | 全景照片 / 视频 | RAW 端侧预览 | CAD / 3D | 性能路径与侧重点 |
| --- | --- | --- | --- | --- | --- | --- |
| **filens** | **✅** | **✅ Keynote / Pages / Numbers** | **✅ 照片 / 视频**<br><sub>◐ Insta360 / DJI 畸变与标定解析、原片多轨同步、标定 DNG 拼接</sub> | **◐ 内嵌 JPEG / 轻量显影** | **✅ DXF / STEP / 3D** | **按格式加载；RAW 快速预览；全景按需重绘** |
| [vue-office](https://github.com/501351981/vue-office) | ✅ [PPTX 核心未开源](https://github.com/501351981/pptx-preview#关于授权) | — | — | — | — | Office 文档预览 |
| [PPTist](https://github.com/pipipi-pikachu/PPTist) | ✅ 导入为演示模型 | — | — | — | — | PPT 编辑与演示 |
| [SheetJS CE](https://docs.sheetjs.com/docs/miscellany/formats/) | — | ◐ Numbers 表格数据提取 | — | — | — | 工作簿解析；需接入显示界面 |
| [Photo Sphere Viewer](https://github.com/mistic100/Photo-Sphere-Viewer) | — | — | ✅ 照片 / 视频<br><sub>◐ 预合并的双鱼眼源</sub> | — | — | WebGL 全景、瓦片、热点与漫游 |
| [LibRaw-Wasm](https://github.com/ybouane/LibRaw-Wasm) | — | — | — | ✅ WASM 解码与显影 | — | 全尺寸 / 半尺寸显影；Worker 图像处理 API |
| [Online 3D Viewer](https://github.com/kovacsv/Online3DViewer) | — | — | — | — | ✅ STEP / IGES / IFC / 3D | 专业模型浏览、检查与导出 |

<sub>✅ 已提供该路径；◐ 部分或有条件支持；— 未见项目内置路径。具体保真范围见[支持矩阵](docs/support-matrix.zh-CN.md)，相机原片拼接为实验性能力。</sub>

- **iWork，看见文件的样子。** 原生解析 Keynote、Pages 和 Numbers，用各自的幻灯片、页面与工作表画布呈现文字、图片、形状和表格。[看实际预览](apps/demo/public/home/iwork.webp)。
- **全景，先读懂镜头，再还原视野。** 对受支持原片解析镜头内参、畸变与外参，衔接多轨同步、投影、曝光匹配和拼缝；静态拼接结果复用，视频按分析成本调整接缝分析频率。[看实现与相机验证](docs/panorama-rendering-implementation.md)。
- **RAW，走更快的预览路径。** 按需加载图像 WASM，优先提取内嵌 JPEG，没有预览时轻量显影。[看 RAW 支持](docs/support-matrix.zh-CN.md#相机-raw-转换)。

## 现在可以打开什么

| 文件 | 你可以做什么 | 当前边界 |
| --- | --- | --- |
| PPTX、Keynote / Pages / Numbers | 直接查看幻灯片、页面与工作表。 | 原生解析，版式与对象保真度因文件而异。 |
| DOCX、XLSX / CSV、PDF | 阅读文档、切换工作表、逐页查看 PDF。 | 只读预览，字体与高级样式可能有差异。 |
| DOC / XLS / PPT、WPS / ET / DPS | 在本地标准化后预览传统文档。 | 面向预览的转换，宏会移除，不保证完整重建。 |
| DXF、STEP / STP、3D 模型 | 查看图纸，旋转与缩放实体或网格。 | STEP 独立按需加载；保留几何与实例位置，不输出原始颜色、名称和装配树。 |
| RAW、PPM、图片与图标 | 查看相机原片、P3 / P6 与 8 / 16 位 PPM。 | RAW 提供内嵌 JPEG 或轻量显影预览，支持情况因相机而异。 |
| 360° 照片、全景视频 | 拖动环顾；支持部分 Insta360 / DJI 视频实时拼接与标定 DNG 静态拼接。 | 相机拼接为实验性能力，依赖标定元数据、配套文件和浏览器编解码器。 |
| 压缩包、电子书、代码、思维导图与流程图 | 浏览目录与章节、查看源码和节点关系。 | 各格式的支持子集见支持矩阵。 |

首页提供八种实际预览截图，以及可直接打开的 STEP、RAW、PPM 和传统 Office 样例。RAW / 全景接入方式见 [panorama 包说明](packages/panorama/README.md)。

## 小核心，按格式分包

<!-- bundle-sizes:zh:start -->
| 分包 / 核心 | 原始 | gzip | Brotli |
| --- | ---: | ---: | ---: |
| 转换核心 WASM | 871.2 KiB | 395.2 KiB | **318.0 KiB** |
| 图像 / RAW 核心 WASM | 1072.2 KiB | 293.0 KiB | **210.7 KiB** |
| 媒体 / 全景预览 | 210.4 KiB | 62.2 KiB | **53.1 KiB** |
| STEP 可选 WASM | 2625.8 KiB | 1020.2 KiB | **797.0 KiB** |

文档、图像 / RAW 与 STEP 的 WASM 模块独立按需加载；媒体预览模块与图像转换核心分别计量。JS 分包已包含对应 CSS，共享依赖和 Worker 单列。

<details>
<summary>展开查看全部分包及首屏成本</summary>

| 分包 / 核心 | 原始 | gzip | Brotli |
| --- | ---: | ---: | ---: |
| 演示站入口 | 173.1 KiB | 48.9 KiB | **40.9 KiB** |
| 共享第三方依赖 | 1776.4 KiB | 504.2 KiB | **414.7 KiB** |
| PPTX / 核心运行时 | 284.1 KiB | 75.1 KiB | **64.3 KiB** |
| Vue 预览容器 | 68.7 KiB | 15.9 KiB | **14.0 KiB** |
| DOCX / XLSX / PDF | 22.9 KiB | 7.3 KiB | **6.5 KiB** |
| iWork 预览 | 24.4 KiB | 8.1 KiB | **7.1 KiB** |
| CAD / 思维导图 / 流程图 | 83.5 KiB | 23.7 KiB | **20.2 KiB** |
| 3D 预览 | 105.7 KiB | 28.2 KiB | **24.5 KiB** |
| 压缩包预览 | 20.1 KiB | 6.4 KiB | **5.7 KiB** |
| 文本 / 电子书 | 18.0 KiB | 6.2 KiB | **5.4 KiB** |
| iWork Worker | 899.0 KiB | 188.2 KiB | **157.4 KiB** |
| PDF Worker | 1053.3 KiB | 291.1 KiB | **233.1 KiB** |
| STEP 加载器 | 23.0 KiB | 9.5 KiB | **8.7 KiB** |

本次构建的入口、预加载 JS 与 CSS 合计 **597.4 KiB Brotli**（原始 2549.6 KiB / gzip 718.6 KiB），另计图片、视频和示例文件。模块会共享依赖；上述体积不代表每种格式的独立总下载量。

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

## 性能实测

**与专业前端方案同场实测，多条路径稳定领先。** 每组重复 7 次；无内嵌 JPEG 的 5 份 RAW 样例，显影并绘制预览比所测 LibRaw 方案快 **1.11–2.14×**。

| 实测任务 | filens | 当前对照 | 对手耗时 / filens | 判定 |
| --- | ---: | --- | ---: | --- |
| 11.1 MB、13 页 PPTX 解析 | **34.3 ms** | pptx-preview 1.0.7：57.7 ms | **1.68×** | **SOTA\*** |
| 11.1 MB、13 页 PPTX 首屏 | **53.6 ms** | pptx-preview 1.0.7：75.4 ms | **1.41×** | **SOTA\*** |
| 3840×1920 全景 JPEG 首屏 | **154.9 ms** | Photo Sphere Viewer 5.15.1：205.2 ms | **1.32×** | **SOTA\*** |
| 无内嵌 JPEG 的 NEF → 预览画布 | **152.7 ms** | LibRaw-Wasm 1.6.0 半尺寸：326.7 ms | **2.14×** | **SOTA\*** |
| 无内嵌 JPEG 的 DNG → 预览画布 | **167.7 ms** | LibRaw-Wasm 1.6.0 快速半尺寸：314.4 ms | **1.87×** | **SOTA\*** |
| STEP 几何导入：cube | **46.5 ms** | occt-import-js 0.0.23: 67.6 ms | 1.45× | **SOTA\*** |
| XLSX 数据读取（80,000 单元格） | **42.3 ms** | SheetJS CE 0.20.3: 109.6 ms | 2.59× | **SOTA\*** |
| XLS → XLSX 预览转换（6 工作表） | **12.3 ms** | x2t WASM v9.3.2+3: 49.1 ms | 4.00× | **SOTA\*** |
| 20,000×8 数值 CSV → XLSX | **137.6 ms** | x2t WASM v9.3.2+3: 198.8 ms | 1.44× | **SOTA\*** |

<sub>\* 仅指本机、已测样例及表列对手，配对 bootstrap 95% 区间支持的领先；不含下载和库冷加载。Apple M4 Pro / Chromium 147；**全景使用 SwiftShader 软件渲染**。RAW 比较统一画布上的显影与绘制，中间输出尺寸不同；STEP 面向几何预览；XLSX 仅比较数据读取；XLS 以相同预览器中的主要显示内容为准。[完整结果、边界与复现](docs/performance-comparison.zh-CN.md)。</sub>

<details>
<summary>选型与实测口径</summary>

<sub>表格依据各项目公开文档，比较浏览器本地处理能力。SheetJS、LibRaw-Wasm 提供 API，需应用接入界面；普通全景显示与厂商原片拼接的支持范围不同。详见[支持矩阵](docs/support-matrix.zh-CN.md)及 [Photo Sphere Viewer 双鱼眼说明](https://photo-sphere-viewer.js.org/guide/adapters/dual-fisheye.html)。</sub>

<sub>RAW 使用移除内嵌 JPEG、传感器数据未变的输入；对比 LibRaw 两种半尺寸配置，统一绘制到 1280×800 画布。中间输出分辨率、色调和裁切略有不同；计时包含显影、输出解码 / 传输与绘制。Numbers 完整模型和部分小 PPTX 首屏仍有优化空间，详见[完整实测与画面对照](docs/performance-comparison.zh-CN.md)。</sub>

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
| 前端性能、领先项与完整原始数据 | [同类项目性能实测](docs/performance-comparison.zh-CN.md) |
| CLI / 后端接入 | [Go + wazero 示例](examples/go-wazero-converter/README.md) |
| 部署 | [Vercel 部署指南](docs/deploy-vercel.md) |

欢迎用日常工作文件试一试，[反馈可复现的问题](https://github.com/IceWhaleTech/filens/issues/new/choose)。后续计划见[路线图](docs/roadmap.md)。

<sub>预览截图均来自 filens。照片：Carsten / CC BY 2.0（裁剪及淡蓝调色）、Greg Zaal / Poly Haven / CC0；预览拼图、演示视频和动图采用 CC BY-SA 4.0。<a href="docs/assets/readme/SOURCES.md">素材来源与署名</a>。iWork 研究基础：<a href="https://github.com/dunhamsteve/iwork">dunhamsteve/iwork</a>；CAD 技术来源：<a href="https://github.com/orcastor/cad2x-converter">orcastor/cad2x-converter</a>。</sub>
