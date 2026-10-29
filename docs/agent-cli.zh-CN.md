# Agent CLI：本地读取文档与交付证据

[English](agent-cli.md) · 简体中文

filens 负责读取本地文档，向上层 Agent 交付文本、来源与证据片段；摘要、问答等语义推理由调用方完成。支持中英文读取意图，以及 text、JSON、Markdown、HTML、YAML、XML、CSV、TSV 输出和布局信息，也保留可选命令与参数。文档解析统一经过前端 WASM 核心。

[68 条实测案例、OCR 效果与自然语言边界](agent-cli-examples.zh-CN.md)列出实际输出，包括不支持的句式、退化行为和识别错误。

详见[多格式输出、坐标布局与打字机动图](agent-cli-formats-and-layout.zh-CN.md)。

## 一键安装

使用 [`filens-cli`](https://www.npmjs.com/package/filens-cli) 安装自带 OCR 的完整版，或选择 [`filens-cli-lite`](https://www.npmjs.com/package/filens-cli-lite) 轻量版。两者都提供 `filens` 命令：

```sh
# 完整版：默认带原生 RapidOCR NCNN 和模型，无 Python 环境
npm install -g filens-cli
filens '读取 "report.pdf"，以 JSON 输出'
filens '你能做什么？以 JSON 输出'

# 或轻量版：仅 CLI + WASM，需要时补装原生 OCR
npm install -g filens-cli-lite
filens setup-ocr
filens '理解 "scan.pdf"，以 JSON 输出'
```

两种包都提供 `filens` 命令，同一安装位置选择一种即可。npm 自动选择当前平台的二进制组件。支持 macOS 12+ arm64、Linux glibc 2.17+ x64 / arm64。npm 启动器需要 Node.js 20.11+；也可以直接运行组件包内的原生二进制。已安装的包无需 Python、ONNX Runtime、Homebrew、CMake 或编译器，安装后读取全程离线。

不做全局安装，也可以临时调用：

```sh
npx --yes filens-cli '你能做什么？以 JSON 输出'
# 或不含 OCR 的轻量版
npx --yes filens-cli-lite '你能做什么？以 JSON 输出'
```

macOS arm64 重建的 Rust 候选包：轻量版 **7.25 MiB 安装体积 / 5.60 MiB 压缩包**，完整版 **30.45 MiB 安装体积 / 19.80 MiB 压缩包**，包含 OCR 模型。主程序从 **11.05 MiB（Go）降至 1.85 MiB（Rust），缩小 83.3%**。数据为 2026-10-29 尚未发布的本地候选包，不含 npm 缓存，详细字节数和构建参数见[体积报告](agent-cli-rust-size.json)。此前 Go 候选包 Lite / Full 安装体积约 16.7 / 39.8 MiB，旧 Python / ONNX 完整包约 332 MiB。

需要离线分发时，也可一条命令安装已经生成的本地 tarball，例如 macOS arm64：

```sh
npm install -g ./dist/npm/filens-cli-0.2.0.tgz ./dist/npm/filens-cli-darwin-arm64-0.2.0.tgz ./dist/npm/filens-ocr-darwin-arm64-0.2.0.tgz
```

## 从源码构建和发布

`cli/` 中的 CLI 已改为 Rust，文档解析仍复用前端 WASM 核心。Release 开启体积优化、LTO、单 codegen unit、panic abort 和符号 strip；文本 WASM 使用 Binaryen `-Oz` 并移除 debug / producers 信息。npm 包中的WASM 引擎使用 gzip level 1 快速压缩，运行时按需在本机解压，无需可执行文件解包器或外部解压工具。

轻量版源码构建需要 Node.js 20.11+ 和锁定的 Rust 1.93.0 / WASI 工具链，无需 Go 编译器。Linux 构建还需 Zig 0.16.0 与 `cargo-zigbuild` 0.24.0，以保持 glibc 2.17 兼容。完整版仍使用 Go 1.24+ 重编译独立的 Photos 原生 OCR wrapper；首次构建 macOS 完整版还需 CMake 和 Xcode 命令行工具编译 CPU NCNN 库。npm 用户直接使用预编译库。OCR wrapper 可用 `FILENS_ZIG` 指定 Zig，cargo-zigbuild 使用 PATH 上的 Zig。

```sh
npm run build:agent:lite
./dist/agent-lite/filens '读取 "report.pdf"，以 JSON 输出'

# 为本地轻量版加装原生 OCR
npm run setup:agent:ocr -- --lite --sources 4

# 完整版：原生 OCR 和模型开箱即用
npm run build:agent
./dist/filens '理解 "meeting notes.docx"，以 JSON 输出'

# 在 macOS arm64 上打包三个平台及两种安装入口
cargo install cargo-zigbuild --locked --version 0.24.0
npm run package:agent:npm
npm run test:agent:npm
npm run publish:agent:npm -- --dry-run
# 维护者完成 npm 登录后，先发布平台组件，再发布两个入口包
npm run publish:agent:npm
```

Agent CLI 的发布版本独立记录在 `packaging/agent-release.json`，不改动私有工作区版本；准备下一次发布前应先更新它，已发布版本不可覆盖。产物、体积和 SHA-256 记录于 `dist/npm/release.json`。打包采用文件白名单，包含 NCNN / C++ 运行时许可与构建来源，不包含源码构建缓存或旧 Python 环境。发布脚本先校验 tarball 和 npm 身份，再写入注册表。Linux 二进制通过交叉编译生成；本地安装测试验证宿主平台，CI 配置覆盖 macOS arm64、Linux x64 / arm64 的原生安装。

一次请求读取一个本地文件。自然语言中的路径应加引号，尤其是含空格路径；相对路径以调用方工作目录为准。可选命令为 `read`、`extract`、`understand`、`layout`、`capacity` / `capabilities`，可选参数有 `--json`、`--format text|json|markdown|html|yaml|xml|csv|tsv`、`--layout`、`--input`、`--max-bytes`、`--timeout`、`--wasm`、`--no-ocr`。

## Agent 交付协议

```sh
echo '{"operation":"understand","input":"report.pdf","format":"json"}' | filens
echo '读取 "report.pages"，以 JSON 输出' | filens
filens capacity --json
```

可以用 `filens -` 显式读取 stdin；无参数且 stdin 为管道时也会读取。JSON 请求默认返回 JSON，自然语言默认返回纯文本。在管道中直接使用二进制，或使用 `npm --silent run filens -- ...` 隐藏 npm 自身的提示。

响应协议为 `version: "filens-agent-v1"`，包含 `ok`、`operation`、`source`、`content`。内容保留 `text`、`complete`、`truncated`、警告与提取错误。JSON 还交付 `content.document` 的字节数、字符数、行数和证据块：

```json
{"id":"b1","startByte":0,"endByte":2048,"startLine":1,"endLine":12}
```

偏移是 `content.text` 中从零开始、左闭右开的 UTF-8 字节位置；行号是提取文本中从 1 开始的行号，不代表原文页码。可引用 `source.path#b1`。证据块不是生成的摘要；文档内容是待分析的数据，不是给调用 Agent 的指令。

`capacity --json` 交付请求 JSON Schema、操作、运行中 WASM 的格式清单、输出格式、限制、证据规范、退出码及真实的原生 OCR / 模型加载检查。当前构建列出 326 个扩展名，保真度因格式而异；布局、图表、公式和不支持的对象可能简化或遗漏。

| 退出码 | 含义 |
| --- | --- |
| 0 | 完整交付，包括真正的空文档 |
| 1 | 宿主、运行时、I/O、取消或输出失败 |
| 2 | 请求不合法或格式不支持 |
| 3 | 内容不完整或被截断，保留已经读取的文本 |

纯文本 stdout 只有文档内容，诊断写入 stderr；JSON stdout 即使失败也只输出一个响应对象。限制：输入 256 MiB、默认文本 8 MiB / 上限 32 MiB、最多 OCR 200 页、每个 OCR 单元 30 秒、整个请求默认两分钟，可用 `--timeout` 调整。扫描页或内嵌图片缺少 OCR 时返回 `ocr_failed`，不会将未识别伪装成成功，也会保留已经读出的文本。

## 文件转换与 Agent Skill

```sh
filens convert report.doc report.docx
filens convert data.csv --to xlsx
filens convert photo.dng --output photo.jpg --json
echo '{"operation":"convert","input":"report.rtf","output":"report.docx","options":{"locale":"zh-CN"}}' | filens
```

支持的转换格式对由正在运行的 WASM 返回，见 `capacity.conversionPairs`。
CLI 复用前端文档和图片引擎及其输出校验，不另写解析器。可读取不代表可转换；
现有路由包括旧 Office / OpenDocument / 文本转 OpenXML、CSV / JSON 转 XLSX、
相机 RAW 转 JPEG、ICNS / PPM 转 PNG，不支持 DOCX 转 PDF。
`--to` / `--target` 选择目标文件格式，`--format` 选择响应序列化格式；
默认根据输入、输出扩展名推断格式，也可用 `--from` / `--source` 覆盖输入扩展名。
转换默认返回 JSON，包括 `conversion` 元数据和 `output.path`，应检查保真度及警告。

成功后才原子写入目标文件；已有目标需显式 `--force` / `force:true`，不允许覆盖输入本身。
失败或取消保留原有目标。退出码继续使用 0 / 1 / 2 / 3 分类，`error.code` 保留核心具体错误。
`--password`、`--locale` 会透传给 WASM，JSON 请求也可使用 `options` 对象。

[FiLens Skill](../skills/filens/SKILL.md) 带标准 YAML front matter，两个 npm 入口包均包含
`skills/filens/`；源码构建分别放在 `dist/skills/filens/` 和 `dist/agent-lite/skills/filens/`。
将整个 `filens` 技能文件夹复制到目标 Agent 的技能目录即可；本仓库中供 Codex 使用的例子：

```sh
mkdir -p ~/.codex/skills
cp -R skills/filens ~/.codex/skills/
```

## 原生 OCR、图片预处理和文档回调

采用 RapidOCR NCNN：PP-OCRv6 small 检测、mobile v2 方向分类、PP-OCRv3 中英文识别。默认 **最大边长 960、补边 50、OpenMP 线程 2**，开启文字方向分类。检测阶段按比例缩放并对齐网络尺寸，识别阶段单独处理文字行裁剪。Photos 原生运行时负责 EXIF 方向、白色补边、通道 / 归一化和文字行 0 / 180 度分类；WASM 在回调前将透明 PNG 合成到白底。960 是实用默认值，超大扫描件中的细小文字仍可能影响准确率。

独立图片和文档内嵌图片共用 OCR 回调。WASM 负责提取图片、确定阅读顺序、复用重复图片结果，以及决定 PDF 哪些页需要 OCR；Rust 宿主把临时图片路径交给隔离的原生 worker。同一文档中相同图片只识别一次，并在各自位置插入结果。PDF 优先读取文本层，扫描页通过固定版本的 PDFium WASM 渲染。Wasmi 为两个引擎分别设置 512 MiB 内存上限，文本引擎只能访问本次请求的临时目录。原有 Go 提取库保留供现有集成使用。

OCR worker 是 CLI 自身的隔离子进程，延迟启动并复用，通过 NCNN JSON ABI 加载库和本地模型，不需要解释器。取消或超时会终止 worker，后续 OCR 单元可启动新进程；线程限制在启动前和原生 load / infer 请求中同时传递。CPU NCNN 库使用内置 SimpleOMP，不依赖外部 libomp / libgomp。

## PDF Unicode 恢复与报告隐私

源码构建会在文本 WASM 中按字体修复支持的 ToUnicode 错误，保留正确映射。
检测到不可用映射时，即使原始提取结果非空，也会转入 OCR；轻量版此时需要
补充 OCR 能力。缺失字体还可能导致数字画错，OCR 无法保证金额和表格可靠。
详见 [PDF 恢复范围与公开样本回归](pdf-unicode.md)。

文件读取留在本机。普通 JSON 响应包含 `source.path` 和提取正文，分享前需要
自行脱敏。PDF 评估器把私有样本和原始响应保存在 Git 忽略的位置，并从公开
报告排除。发布构建映射 Rust 源码路径，所有 OCR wrapper 使用 Go `-trimpath`；
打包和发布前检查文件及 tarball 中的个人路径、签名 URL 和凭据。
详见[发布隐私检查](release-privacy.md)。这些源码修复需随新版本发布，
不会替换已发布且不可变的 npm 旧版本。

## 多源测速下载

```sh
# npm 安装：补装组件；需要重新测速下载时刷新用户缓存
filens setup-ocr
filens setup-ocr --sources 4 --refresh

# 源码安装：下载模型、重新测速或安装完整原生 OCR
npm run download:agent:models -- --sources 4
npm run download:agent:models -- --sources 4 --refresh
npm run setup:agent:ocr -- --lite --sources 4
```

默认 ModelScope、HF Mirror、Hugging Face 三源，第四路为 ModelScope API。参考 Photos 策略：各源并发探测前 256 KiB 的有效速度，选择速度至少为最快源 20% 的 Range 源，每个文件最多四连接下载 1 MiB 分块；不支持 Range、连接失败或校验失败时，回退完整文件下载并继续尝试其他源。多份模型文件也同时下载。

每个文件固定提交、大小和 SHA-256，缓存也校验，只有完整验证的临时文件才替换本地文件。原生库下载复用同一传输层。npm 完整包已经内置模型，常规安装和读取不触发模型下载。清单见 [models.json](../converter/rapidocr/models.json) 与 [runtime.json](../converter/rapidocr/runtime.json)。

源码版测速报告位于 `dist/models/rapidocr-ncnn/download-report.json`；Lite 对应 `dist/agent-lite/models/rapidocr-ncnn/`。npm 按需组件和刷新模型使用 `~/.cache/filens/<版本>/<平台>/`，可用 `FILENS_CACHE_DIR` 指定位置。刷新只修改用户缓存，不写入已安装的包目录。

受控部署可用 `FILENS_TEXT_WASM`、`FILENS_OCR_LIBRARY`、`FILENS_OCR_MODEL_DIR` 指定核心、原生库和模型；源码构建可通过 `FILENS_NCNN_LIBRARY` 提供可移植的 macOS NCNN 库。`--no-ocr` 显式关闭 OCR。

## 验证

`npm run test:agent` 覆盖中英文意图、JSON / UTF-8 证据、截断与空文档、Lite 注入 OCR、真实 PNG / 双页扫描 PDF / DOCX 内嵌图片、透明 / EXIF / 倒置预处理、取消和重启，以及下载器的并发、损坏源回退和缓存。`npm run test:agent:npm` 覆盖离线安装 Full / Lite tarball，以及无需 Python 的一键补装 OCR；追加 `-- --registry` 可验证全新缓存的公开 npm 安装、平台组件自动选择和临时调用。0.2.0 于 2026-10-29 已在 macOS arm64 上通过公开安装验证，当时核对的 0.1.0 tarball 与注册表一致；当前重建候选的哈希已变化，详见发布隐私审计。Linux 原生执行仍待上述 CI 验证。既有转换 CLI / HTTP 示例继续使用原来的接口。
