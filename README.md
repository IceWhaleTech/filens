# filens

**Universal file inspection and rendering runtime for Web, WASM and AI Agents.**

filens is an open-source file inspection and rendering library that brings support for a wide range of modern, legacy, and specialized file formats to the browser and other sandboxed environments.

It provides a unified interface for **previewing, parsing, rendering, extracting, and converting files** into practical representations such as images, text, metadata, and structured content.

filens currently covers five major categories:

- **Documents** - Office, PDF, plain text, WPS, iWork and other document formats
- **Media** - Images, video and other common multimedia formats
- **Archives** - Compressed archives, packages and executable formats
- **Design** - CAD, STL, 3D-printing and other engineering/design formats
- **Legacy** - Older and less-common formats that are difficult to handle with modern web-native tools

The WASM runtime makes filens suitable for **local-first and privacy-sensitive applications**, allowing files to be inspected and rendered without necessarily uploading them to a remote service.

filens can also expose an external **OCR callback**, allowing image-based documents and scanned content to be converted into searchable text while keeping the OCR engine independent from the core runtime.

## 当前全球文件处理方案格局

文件转换目前没有一个方案能同时做到最小体积、最高 Office 保真、浏览器直跑和完整格式覆盖。实际部署通常在原生 x2t、裁剪后的原生服务、x2t WebAssembly，以及 filens 这类轻量本地优先运行时之间取舍。

| 方案 | 交付体积 | 执行与能力侧重 | 更适合 |
| --- | ---: | --- | --- |
| ONLYOFFICE x2t 原生完整版（含字体） | 约 **560+ MB** 压缩包 | 原生执行，Office 转换面和排版保真更完整；字体、资源和进程部署成本最高 | 服务端高保真转换、批处理 |
| ZimaOS x2t 裁剪版 | 约 **138 MB** | 保留原生 x2t 路径，通过裁剪字体和非必要组件降低存储与分发成本 | NAS、私有化设备和受控格式集 |
| [`onlyoffice-x2t-wasm`](https://github.com/cryptpad/onlyoffice-x2t-wasm/releases/tag/v9.3.0%2B0) `v9.3.0+0` | 发布 ZIP **15.79 MiB**；`x2t.wasm` **34.32 MiB**，Brotli **6.49 MiB** | 浏览器侧高保真候选；依赖 Emscripten JS glue，初始化和内存成本明显高于轻量 WASI core | 浏览器内 Office 转换、无需服务端的高保真场景 |
| **filens converter-core** | `converter-core.wasm` **0.685 MiB**；gzip **0.313 MiB**；Brotli **0.252 MiB** | 纯 WASI、可由浏览器或 wazero 执行；优先快速解析、结构化提取、预览和安全降级 | Web 预览、索引、Agent 文件理解、边缘设备 |

以当前发布产物计算，filens 的原始 WASM 比 x2t-wasm 小约 **50 倍**，Brotli 传输体积小约 **25.7 倍**。相对 138 MB 的 ZimaOS 裁剪包和 560+ MB 的完整原生包，filens 核心分别小约 **202 倍**和 **818 倍**。这些数字用于说明部署成本，不是完全等价的功能比较：原生包通常包含字体和额外资源，而 filens 与 x2t-wasm 均不内置完整字体包。

### 本机性能快照

以下结果来自同一台 Windows 10 / Xeon E5-2696 v4 / Node.js 20.20 / Go 1.24 机器，对仓库内同一组小型 DOC、XLS、PPT 样例运行 5 次。x2t-wasm 测试未加载额外字体；数字只用于观察启动和执行量级，不代表复杂文档或跨设备的通用成绩。

| 指标 | filens WASI core | x2t-wasm `v9.3.0+0` |
| --- | ---: | ---: |
| DOC -> DOCX 核心转换 | **1 ms** | 中位数 **145.7 ms** |
| XLS -> XLSX 核心转换 | **1 ms** | 中位数 **51.8 ms** |
| PPT -> PPTX 核心转换 | **1 ms** | 中位数 **103.9 ms** |
| 冷初始化 | 未单独隔离；由 wazero 缓存编译模块 | 中位数 **292.3 ms** |
| 初始化后 RSS 增量 | 未单独测量 | 约 **121-124 MiB** |

filens 的速度来自更轻的目标：当前转换核心面向预览、索引和内容提取，不承诺重建完整 Office 排版、图表、动画、嵌入对象或公式计算。x2t/x2t-wasm 更重，但目标是更高的 Office 转换保真。因此，**轻量路径默认使用 filens；确实需要高保真 Office 转换时，再按需加载或部署 x2t**。

体积数据可通过 `npm run report:wasm-sizes` 复现；当前 WASM smoke suite 为 **294/294**，转换策略检查为 **1,631** 项。x2t-wasm 的接入边界和审计方法见 [`docs/x2t-wasm-evaluation.md`](docs/x2t-wasm-evaluation.md)。

## From Preview to Agent

filens is designed as more than a file viewer.

Its goal is to provide a common **file understanding layer** between applications and the underlying collection of file formats.

```text
                     filens
                        |
        +---------------+---------------+
        |               |               |
      Parse           Render          Extract
        |               |               |
     Metadata       Image Preview      Text
        |               |               |
        +---------------+---------------+
                        |
                    OCR / Convert
                        |
                  +-----+-----+
                  |           |
                 Web         Agent
                 WASM         CLI
```

The same capabilities can eventually be exposed through a CLI, making filens directly usable as a **file inspection tool for AI Agents**:

```bash
filens inspect document.docx
filens render drawing.dwg
filens extract archive.zip
filens convert legacy.doc --to text
filens ocr scanned.jpg
```

Instead of requiring every application or Agent to understand hundreds of individual file formats, filens provides a single, consistent interface for interacting with them.

**See the file. Understand the file. Work with the file.**

filens is the lens between applications and the world's files.
