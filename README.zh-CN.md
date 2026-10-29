<div align="center">
  <img src="apps/demo/public/brand/filens-icon.svg" alt="探微标志" width="72" height="72" />
  <h1>探微 · filens</h1>
  <p><strong>文件的精彩，打开就看见。</strong></p>
  <p>探微（filens），纯前端文件预览项目。从 Office、iWork 到 CAD 和全景照片，本地文件无需上传。</p>
  <p><a href="README.md">English</a> · 简体中文</p>
  <p>
    <a href="#演示">观看演示</a> ·
    <a href="#快速开始">本地体验</a> ·
    <a href="docs/support-matrix.zh-CN.md">支持格式</a>
  </p>
</div>

[![filens 的八种实际预览：演示文稿、文档、表格、PDF、Keynote、CAD、3D 和全景照片](docs/assets/readme/overview.webp)](apps/demo/public/home/filens-demo.mp4)

<p align="center"><strong>纯前端预览 · WASM 转换，灵活部署 · 高性能、极致小巧</strong></p>

<p align="center">
  <a href="https://www.zimaspace.com/zh/zimaos?utm_source=github&amp;utm_medium=referral&amp;utm_campaign=filens_zimaos&amp;utm_content=readme_banner_zh"><img src="docs/assets/readme/zimaos-banner.zh-CN.png" alt="ZimaOS，个人云更简单。ZimaOS 深度使用了 FiLens 项目，支持文件管理、RAW / 全景、备份和 800+ 应用。了解更多。" width="640" /></a>
</p>

---

## 浏览器里，也能看见这些

| 前端项目 | iWork | 全景照片 / 视频 | RAW 预览 | 原生 PPTX | CAD / 3D |
| --- | --- | --- | --- | --- | --- |
| **filens** | **✅ 三件套** | **✅** | **◐** | **✅** | **✅** |
| [SheetJS CE](https://docs.sheetjs.com/docs/miscellany/formats/) | ◐ Numbers | — | — | — | — |
| [Photo Sphere Viewer](https://github.com/mistic100/Photo-Sphere-Viewer) | — | ✅ | — | — | — |
| [LibRaw-Wasm](https://github.com/ybouane/LibRaw-Wasm) | — | — | ✅ | — | — |
| [vue-office](https://github.com/501351981/vue-office) | — | — | — | ✅ | — |
| [PPTist](https://github.com/pipipi-pikachu/PPTist) | — | — | — | ✅ | — |
| [Online 3D Viewer](https://github.com/kovacsv/Online3DViewer) | — | — | — | — | ✅ |

<sub>✅ 已提供该路径 · ◐ 部分或有条件支持 · — 未见文档记载内置路径。[格式覆盖与边界](docs/support-matrix.zh-CN.md)。</sub>

**iWork、全景、RAW、Office 与 CAD / 3D，在同一个浏览器本地工作台打开。** 上述项目各有所长，filens 将这些预览能力放在一起。

<details>
<summary>对比注记与支持边界</summary>

- 依据各项目公开文档，比较浏览器本地处理路径，不作项目综合排名。具体支持范围与保真程度因文件而异。
- **iWork / PPTX：** filens 原生预览 Keynote、Pages 和 Numbers。SheetJS 提取 Numbers 表格数据，需应用接入界面。PPTist 将 PPTX 导入为演示模型；vue-office 的 [PPTX 核心未开源](https://github.com/501351981/pptx-preview#关于授权)。
- **全景：** filens 与 Photo Sphere Viewer 均可显示照片和视频。filens 还处理受支持的 X5 INSP 原片、Insta360 / DJI 标定与畸变、原片多轨同步及标定 DNG 拼接。相机原片拼接为实验性能力，依赖元数据、配套文件和浏览器编解码器。PSV 的[通用双鱼眼适配器](https://photo-sphere-viewer.js.org/guide/adapters/dual-fisheye.html)不解析 X5 标定。
- **RAW：** filens 优先提取内嵌 JPEG，再走轻量传感器显影；LibRaw-Wasm 通过 API 提供全尺寸 / 半尺寸解码与显影，需应用接入界面。两者的画质目标不同。
- **CAD / 3D：** filens 提供 DXF、STEP 与网格预览。Online 3D Viewer 专注模型浏览、检查与导出，包括 STEP / IGES / IFC。filens 的 STEP 预览保留几何与实例位置，不输出原始颜色、名称和装配树。

</details>

## iWork、全景与 RAW

- **iWork，看见文件的样子。** 直接打开 Keynote、Pages 和 Numbers，用幻灯片、页面与工作表画布呈现；版式和对象保真度因文件而异。[看实际预览](apps/demo/public/home/iwork.webp)。
- **全景，直接探索相机原片。** 拖动环顾 360° 照片与视频；对受支持原片衔接镜头标定、多轨同步与拼接，还原视野。原片拼接为实验性能力。[看实现与相机验证](docs/panorama-rendering-implementation.md)。
- **RAW，走更快的预览路径。** 按需加载图像 WASM，优先提取内嵌 JPEG，没有预览时轻量显影。[看 RAW 支持](docs/support-matrix.zh-CN.md#相机-raw-转换)。

## 演示

**[▶ 观看 30 秒实录](apps/demo/public/home/filens-demo.mp4)**：演示文稿、文档、表格、Keynote、CAD、维京牛角头盔 3D 与 360° 全景，在同一个工作台轻松切换。

<details>
<summary>展开查看动图预览</summary>

![filens 切换不同文件格式的真实预览录屏](docs/assets/readme/demo.gif)

完整视频见上方链接。[中文字幕](apps/demo/public/home/demo-zh.vtt) · [English captions](apps/demo/public/home/demo-en.vtt)

</details>

## 让 Agent 读取和理解文档

用中英文描述读取意图，交付 text、JSON、Markdown、HTML、YAML、XML、CSV 或 TSV，并获取文档结构及 PDF / OCR 坐标。解析、布局与文档导出共用 WASM 核心，上层 Agent 负责摘要、问答等语义推理。

![真实 CLI 逐字输入、Markdown 导出与 OCR 坐标演示](docs/assets/agent-cli/terminal-demo.gif)

[输出格式、布局信息与动图复现](docs/agent-cli-formats-and-layout.zh-CN.md) · 使用真实 CLI 输出节选，剪辑了打字与响应时间。

先看[68 条实测案例与自然语言边界](docs/agent-cli-examples.zh-CN.md)：包括图片识别效果、成功问法，以及分页、问答等请求的实际限制。

```sh
# 完整版：CLI、WASM 和原生 OCR
npm install -g filens-cli
filens '理解 "report.pdf"，以 JSON 输出'
filens '你能做什么？以 JSON 输出'
filens 'read "report.docx" as markdown'
filens '获取 "invoice.png" 的布局，以 YAML 输出'
filens convert report.doc report.docx
filens convert data.csv --to xlsx

# 轻量版；需要 OCR 时再运行 filens setup-ocr
npm install -g filens-cli-lite
# 临时调用
npx --yes filens-cli-lite capacity --json
```

源码 CLI 已改为 Rust，启用 strip、LTO 和 WASM 快速 gzip 压缩。
`convert` 复用前端转换核心，支持的格式对见 `capacity.conversionPairs`。
可分发的 [Agent Skill](skills/filens/SKILL.md) 带标准 YAML front matter，
覆盖读取、OCR、布局、证据引用和文件转换。

npm 安装入口为 [`filens-cli`](https://www.npmjs.com/package/filens-cli) 和 [`filens-cli-lite`](https://www.npmjs.com/package/filens-cli-lite)，都提供 `filens` 命令。完整包内置原生 RapidOCR NCNN 与模型，**无需 Python 环境**；默认最大边长 **960**、OpenMP 线程 **2**，开启文字方向分类和图片预处理。WASM 支持扫描页及文档内嵌图片的 OCR 回调。macOS arm64 重建的 Rust 候选包安装体积：Lite 约 **7.25 MiB**，Full 约 **30.45 MiB**。模型支持 HF / ModelScope / HF Mirror 三源或四路并发测速下载和哈希校验，详见[安装、打包与输出协议](docs/agent-cli.zh-CN.md)。

## 快速开始

需要 Node.js 20+ 和通过 [rustup](https://rustup.rs/) 安装的 Rust。仓库已锁定编译器与 WASI 目标版本。

```sh
npm ci
npm run build:wasm
npm run dev --workspace @filens/demo
```

打开[本地演示](http://localhost:5173/modules/filens/?lang=zh)，选择示例或拖入自己的文件。网站首页支持中英文切换。

发布演示站可直接[将仓库导入 Vercel](docs/deploy-vercel.md)，绑定后推送代码会自动部署；仓库也提供可选的 GitHub Actions 手动发布流程。

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

## 换个角度，看见文件

- **纯前端预览。** 文件在浏览器中解析与渲染，本地预览无需上传，也无需部署转换服务。
- **WASM 转换，灵活部署。** 转换模块可在浏览器中直接运行，也可通过 [CLI / HTTP 工具](examples/go-wazero-converter)独立使用；文件解析与转换由 WASM 完成，服务端负责请求和文件管理。
- **按格式加载，减少等待。** 按格式分包、按需加载，配合 Worker 解析与页面虚拟化，减少下载与渲染负担。文档转换 WASM 为 **<!-- bundle-size:converter-core -->318.3<!-- /bundle-size --> KiB Brotli**，预览界面、共享依赖与其他模块另计，详见[体积实测报告](docs/bundle-sizes.md)。

原生预览 PPTX 与 iWork，也能查看文档、表格、CAD、3D、RAW、全景、压缩包和电子书。不同格式的支持范围与保真程度有所区别，详见[格式支持矩阵](docs/support-matrix.zh-CN.md)。

## 小核心，按格式分包

<!-- bundle-sizes:zh:start -->
| 分包 / 核心 | 原始 | gzip | Brotli |
| --- | ---: | ---: | ---: |
| 转换核心 WASM | 872.1 KiB | 395.6 KiB | **318.3 KiB** |
| 图像 / RAW 核心 WASM | 1072.2 KiB | 293.0 KiB | **210.7 KiB** |
| 媒体 / 全景预览 | 216.9 KiB | 64.1 KiB | **54.7 KiB** |
| STEP 可选 WASM | 2625.8 KiB | 1020.2 KiB | **797.0 KiB** |

文档、图像 / RAW 与 STEP 的 WASM 模块独立按需加载；媒体预览模块与图像转换核心分别计量。JS 分包已包含对应 CSS，共享依赖和 Worker 单列。

<details>
<summary>展开查看全部分包及首屏成本</summary>

| 分包 / 核心 | 原始 | gzip | Brotli |
| --- | ---: | ---: | ---: |
| 演示站入口 | 173.1 KiB | 48.9 KiB | **40.8 KiB** |
| 共享第三方依赖 | 1319.8 KiB | 369.6 KiB | **305.2 KiB** |
| PPTX / 核心运行时 | 288.6 KiB | 76.1 KiB | **65.4 KiB** |
| Vue 预览容器 | 69.9 KiB | 16.3 KiB | **14.4 KiB** |
| DOCX / XLSX / PDF | 32.5 KiB | 9.8 KiB | **8.8 KiB** |
| PDF 按需引擎 | 435.2 KiB | 128.1 KiB | **106.9 KiB** |
| iWork 预览 | 26.8 KiB | 8.7 KiB | **7.7 KiB** |
| CAD / 思维导图 / 流程图 | 90.2 KiB | 25.2 KiB | **21.6 KiB** |
| 3D 预览 | 133.4 KiB | 37.9 KiB | **32.9 KiB** |
| 压缩包预览 | 24.7 KiB | 7.9 KiB | **7.0 KiB** |
| 文本 / 电子书 | 22.9 KiB | 8.2 KiB | **7.3 KiB** |
| iWork Worker | 894.1 KiB | 186.7 KiB | **156.2 KiB** |
| PDF Worker | 1053.3 KiB | 291.1 KiB | **233.1 KiB** |
| STEP 加载器 | 23.0 KiB | 9.5 KiB | **8.7 KiB** |

本次构建的入口、预加载 JS 与 CSS 合计 **499.0 KiB Brotli**（原始 2131.8 KiB / gzip 596.6 KiB），另计图片、视频和示例文件。模块会共享依赖；上述体积不代表每种格式的独立总下载量。

</details>

数据来自实际演示站构建。压缩列是产物体积，实际传输取决于托管配置。[完整报告与复现方式](docs/bundle-sizes.md)。
<!-- bundle-sizes:zh:end -->

## 性能实测

<details>
<summary>展开查看 SOTA 实测对比</summary>

| 实测任务 | filens | 当前对照 | 加速比\* |
| --- | ---: | --- | ---: |
| 11.1 MB、13 页 PPTX 解析 | **28.5 ms** | pptx-preview 1.0.7：56.6 ms | **1.99×** |
| 11.1 MB、13 页 PPTX 首屏 | **48.8 ms** | pptx-preview 1.0.7：71.8 ms | **1.47×** |
| 3840×1920 全景 JPEG 首屏 | **154.9 ms** | Photo Sphere Viewer 5.15.1：205.2 ms | **1.32×** |
| 11904×5952 X5 INSP 原片全景首屏 | **369.4 ms** | Photo Sphere Viewer 5.15.1 双鱼眼：414.5 ms | **1.12×** |
| 无内嵌 JPEG 的 NEF → 预览画布 | **152.7 ms** | LibRaw-Wasm 1.6.0 半尺寸：326.7 ms | **2.14×** |
| 无内嵌 JPEG 的 DNG → 预览画布 | **167.7 ms** | LibRaw-Wasm 1.6.0 快速半尺寸：314.4 ms | **1.87×** |
| STEP 几何导入：cube | **46.5 ms** | occt-import-js 0.0.23: 67.6 ms | 1.45× |
| XLSX 数据读取（80,000 单元格） | **42.3 ms** | SheetJS CE 0.20.3: 109.6 ms | 2.59× |
| XLS → XLSX 预览转换（6 工作表） | **12.3 ms** | x2t WASM v9.3.2+3: 49.1 ms | 4.00× |
| 20,000×8 数值 CSV → XLSX | **137.6 ms** | x2t WASM v9.3.2+3: 198.8 ms | 1.44× |

**与专业前端方案同场实测，多条路径稳定领先。** 每组重复至少 7 次；X5 原片重复 21 次。无内嵌 JPEG 的 5 份 RAW 样例，显影并绘制预览比所测 LibRaw 方案快 **1.11–2.14×**。

<sub>\* 仅指本机、已测样例及表列对手，配对 bootstrap 95% 区间支持的领先；不含下载和库冷加载。Apple M4 Pro / Chromium 147；**全景使用 SwiftShader 软件渲染**。X5 原片中，PSV 通用双鱼眼投影有明显画面重复与硬接缝，filens 的局部重影更轻；速度标注限于这份原片的可读预览。RAW 比较统一画布上的显影与绘制，中间输出尺寸不同；STEP 面向几何预览；XLSX 仅比较数据读取；XLS 以相同预览器中的主要显示内容为准。[完整结果、边界与复现](docs/performance-comparison.zh-CN.md)。</sub>

</details>

<details>
<summary>实测口径</summary>

<sub>RAW 使用移除内嵌 JPEG、传感器数据未变的输入；对比 LibRaw 两种半尺寸配置，统一绘制到 1280×800 画布。中间输出分辨率、色调和裁切略有不同；计时包含显影、输出解码 / 传输与绘制。Numbers 完整模型和部分小 PPTX 首屏仍有优化空间，详见[完整实测与画面对照](docs/performance-comparison.zh-CN.md)。</sub>

</details>

## 接入你的应用

| 想了解… | 从这里开始 |
| --- | --- |
| Vue 预览组件 | [Vue 接入说明](packages/vue/README.md) |
| 格式覆盖与限制 | [格式支持矩阵](docs/support-matrix.zh-CN.md) |
| 架构、方案对比和性能说明 | [项目详细介绍](docs/project-overview.zh-CN.md) |
| 前端性能、领先项与完整原始数据 | [同类项目性能实测](docs/performance-comparison.zh-CN.md) |
| Agent 文档读取 / capacity / 本地 OCR | [Agent CLI](docs/agent-cli.zh-CN.md) |
| CLI / 后端接入 | [Go + wazero 示例](examples/go-wazero-converter/README.md) |
| 部署 | [Vercel 部署指南](docs/deploy-vercel.md) |

欢迎用日常工作文件试一试，[反馈可复现的问题](https://github.com/IceWhaleTech/filens/issues/new/choose)。后续计划见[路线图](docs/roadmap.md)。

<sub>预览截图均来自 filens。照片：Carsten / CC BY 2.0（裁剪及淡蓝调色）、Greg Zaal / Poly Haven / CC0；预览拼图、演示视频和动图采用 CC BY-SA 4.0。<a href="docs/assets/readme/SOURCES.md">素材来源与署名</a>。iWork 研究基础：<a href="https://github.com/dunhamsteve/iwork">dunhamsteve/iwork</a>；CAD 技术来源：<a href="https://github.com/orcastor/cad2x-converter">orcastor/cad2x-converter</a>。</sub>

## Star 历史

[![Star 历史图表](https://api.star-history.com/svg?repos=IceWhaleTech/filens&type=Date)](https://star-history.com/#IceWhaleTech/filens&Date)
