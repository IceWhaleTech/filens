# filens

[English](README.md) | 简体中文

**面向 Web、WASM 和 AI Agent 的通用文件检查与渲染运行时。**

filens 是一个开源文件检查与渲染库，为浏览器及其他沙箱环境提供大量现代、传统和专业文件格式支持。

它通过统一接口完成文件的**预览、解析、渲染、提取和转换**，并输出图像、文本、元数据和结构化内容等实用结果。

filens 目前覆盖五大类别：

- **文档** - Office、PDF、纯文本、WPS、iWork 等文档格式
- **媒体** - 图片、视频及其他常见多媒体格式
- **归档** - 压缩包、软件包和可执行文件格式
- **设计** - CAD、STL、3D 打印及其他工程设计格式
- **传统格式** - 现代 Web 原生工具难以处理的旧格式和少见格式

WASM 运行时让 filens 适合**本地优先和隐私敏感型应用**，无需将文件上传到远程服务即可检查和渲染。

filens 还可以暴露外部 **OCR 回调**，把图片文档和扫描内容转换为可搜索文本，同时保持 OCR 引擎与核心运行时解耦。

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

## 从预览到 Agent

filens 不只是文件查看器。

它的目标是在应用程序和底层文件格式之间提供统一的**文件理解层**。

```text
                     filens
                        |
        +---------------+---------------+
        |               |               |
      解析             渲染             提取
        |               |               |
      元数据          图像预览           文本
        |               |               |
        +---------------+---------------+
                        |
                    OCR / 转换
                        |
                  +-----+-----+
                  |           |
                 Web        Agent
                 WASM         CLI
```

这些能力也可以通过 CLI 暴露，让 AI Agent 直接把 filens 作为文件检查工具：

```bash
filens inspect document.docx
filens render drawing.dwg
filens extract archive.zip
filens convert legacy.doc --to text
filens ocr scanned.jpg
```

应用和 Agent 无需分别理解数百种文件格式，只需通过 filens 的统一接口处理它们。

**看见文件，理解文件，使用文件。**

filens 是连接应用与世界文件格式的一枚镜片。
