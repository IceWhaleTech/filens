# Agent CLI：本地读取文档与交付证据

[English](agent-cli.md) · 简体中文

filens 负责读取本地文档，向上层 Agent 交付文本、来源与证据片段。0.3.0 提供不依赖 LLM 的 `summarize` / `prune`，按密度、BM25 和相似距离选取关键原文，详见[关键内容提取与实例](agent-cli-pruning.zh-CN.md)。改写总结、问答等语义推理由调用方完成。支持中英文意图，以及 text、JSON、Markdown、HTML、YAML、XML、CSV、TSV 输出和布局信息，也保留可选命令与参数。文档解析与裁剪复用共享前端核心；常见文本搜索直接编译同一份 Rust 源码，其他格式及布局按需调用 WASM。

[68 条实测案例、OCR 效果与自然语言边界](agent-cli-examples.zh-CN.md)列出实际输出，包括不支持的句式、退化行为和识别错误。

详见[多格式输出、坐标布局与打字机动图](agent-cli-formats-and-layout.zh-CN.md)。

0.3.0 提供[跨文件词项搜索](agent-cli-search.zh-CN.md)：中英文入口、BM25/精确匹配/文件名模式、原文证据和请求内存处理；`prune` 继续在已知文件内提取片段。embedding 语义检索尚未实现，公平对照方法见[文档搜索与客观评价方案](agent-cli-search-evaluation.zh-CN.md)。

0.3.0 提供 [Czkawka 风格的重复文件与相似图片扫描](agent-cli-similarity.zh-CN.md)：`filens duplicates ./files --json`、`filens similar-images ./photos --threshold 8 --json`。支持缩放、重新压缩的图片分组，解析和匹配统一在 WASM 核心中，无需 OCR 或模型。使用 `capacity.operations` 检查 `similar`。

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

两种包都提供 `filens` 命令，同一安装位置选择一种即可。npm 自动选择当前平台的二进制组件。支持 macOS 12+ arm64、Linux glibc 2.17+ x64 / arm64、Windows 10/11 x64。npm 启动器需要 Node.js 20.11+；也可以直接运行组件包内的原生二进制。已安装的包无需 Python、ONNX Runtime、Homebrew、CMake 或编译器，安装后读取全程离线。

不做全局安装，也可以临时调用：

```sh
npx --yes filens-cli '你能做什么？以 JSON 输出'
# 或不含 OCR 的轻量版
npx --yes filens-cli-lite '你能做什么？以 JSON 输出'
```

0.3.0 在 macOS arm64 上的原生主程序为 **2.10 MiB**；Lite **7.85 MiB 安装 / 6.02 MiB 下载**，Full **31.05 MiB 安装 / 20.22 MiB 下载**，Full 含 OCR 模型。总体积按启动器加当前平台组件计算，不含 Node.js、npm 缓存和文件系统开销，见[全平台精确字节数](agent-cli-npm-release.json)。FiLens 自有代码与 npm 包元数据使用 [MIT 协议](../LICENSE)，第三方组件保留各自的许可。

需要离线分发时，也可一条命令安装已经生成的本地 tarball，例如 macOS arm64：

```sh
npm install -g ./dist/npm/filens-cli-0.3.0.tgz ./dist/npm/filens-cli-darwin-arm64-0.3.0.tgz ./dist/npm/filens-ocr-darwin-arm64-0.3.0.tgz
```

此前的 [Rust 迁移测量](agent-cli-rust-size.json)及[相似扫描增量](agent-cli-similarity-size.json)保留为历史记录；当前安装体积以以上 0.3.0 报告为准。

## 从源码构建和发布

`cli/` 中的 CLI 已改为 Rust，文档解析仍复用前端 WASM 核心。Release 开启体积优化、LTO、单 codegen unit、panic abort 和符号 strip；Windows/Linux 的 CLI 使用 UPX `--best --lzma`，并通过 `upx --test` 校验。macOS arm64 的可执行格式不受 UPX 支持，因此跳过。文本 WASM 使用 Binaryen `-Oz` 并移除 debug / producers 信息；WASM 引擎使用 gzip level 1 快速压缩，运行时按需在本机解压，无需外部解压工具。构建机器可运行 `node scripts/setup-agent-upx.mjs` 安装经 SHA-256 校验的固定版本 UPX；构建/打包脚本的 `--no-upx` 可生成未压缩对照。

0.3.0 提供 Windows x64 安装包。见 [Windows 测试包、实机检查和可复制的 Agent 提示词](agent-cli-windows.zh-CN.md)，实际 Windows 运行结果仍待补充。

轻量版源码构建需要 Node.js 20.11+ 和锁定的 Rust 1.93.0 / WASI 工具链，无需 Go 编译器。Linux 和 Windows 构建还需 Zig 0.16.0 与 `cargo-zigbuild` 0.24.0，其中 Linux 保持 glibc 2.17 兼容。完整版仍使用 Go 1.24+ 重编译独立的 Photos 原生 OCR wrapper；首次构建 macOS 完整版还需 CMake 和 Xcode 命令行工具编译 CPU NCNN 库，Windows 则需要 CMake 和 Ninja。npm 用户直接使用预编译库。OCR wrapper 可用 `FILENS_ZIG` 指定 Zig，cargo-zigbuild 使用 PATH 上的 Zig。

```sh
npm run build:agent:lite
./dist/agent-lite/filens '读取 "report.pdf"，以 JSON 输出'

# 为本地轻量版加装原生 OCR
npm run setup:agent:ocr -- --lite --sources 4

# 完整版：原生 OCR 和模型开箱即用
npm run build:agent
./dist/filens '理解 "meeting notes.docx"，以 JSON 输出'

# 在 macOS arm64 上打包四个平台及两种安装入口
cargo install cargo-zigbuild --locked --version 0.24.0
npm run package:agent:npm
npm run test:agent:npm
npm run publish:agent:npm -- --dry-run
# 维护者完成 npm 登录后，先发布平台组件，再发布两个入口包
npm run publish:agent:npm
```

Agent CLI 的发布版本独立记录在 `packaging/agent-release.json`，不改动私有工作区版本；准备下一次发布前应先更新它，已发布版本不可覆盖。产物、体积和 SHA-256 记录于 `dist/npm/release.json`。打包采用文件白名单，包含 NCNN / C++ 运行时许可与构建来源，不包含源码构建缓存或旧 Python 环境。发布脚本先校验 tarball 和 npm 身份，再写入注册表。Linux 和 Windows 二进制通过交叉编译生成；本地安装测试验证宿主平台，CI 已配置 macOS arm64、Linux x64 / arm64 和 Windows x64 的原生安装及 Windows 便携包测试，本轮尚未执行 CI。

读取和摘录每次接受一个本地文件或包内成员路径，`search` 每次接受一个本地目录或支持的压缩包。ZIP、TAR、GZIP 等会自动展开最多 8 层嵌套，保留 `资料.zip!/附件.tar.gz!/合同.pdf` 路径供再次读取、获取布局或摘录，详见[嵌套压缩包用法与实测](agent-cli-search-archives.zh-CN.md)。自然语言中的路径应加引号，尤其是含空格路径；相对路径以调用方工作目录为准。可选命令为 `read`、`extract`、`understand`、`layout`、`summarize` / `prune`、`search`、`capacity` / `capabilities`，可选参数有 `--json`、`--format text|json|markdown|html|yaml|xml|csv|tsv`、`--layout`、`--input`、`--max-bytes`、`--timeout`、`--wasm`、`--no-ocr`。搜索增加 `--query`、`--search-mode bm25|exact|files`、`--max-results`、`--max-files`、`--max-depth`、`--include-hidden` 和 `--no-cache`，详见[搜索指南](agent-cli-search.zh-CN.md)。

## Agent 交付协议

```sh
echo '{"operation":"understand","input":"report.pdf","format":"json"}' | filens
echo '读取 "report.pages"，以 JSON 输出' | filens
filens capacity --json
```

可以用 `filens -` 显式读取 stdin；无参数且 stdin 为管道时也会读取。JSON 请求默认返回 JSON，自然语言默认返回纯文本。在管道中直接使用二进制，或使用 `npm --silent run filens -- ...` 隐藏 npm 自身的提示。

文档读取的响应协议为 `version: "filens-agent-v1"`，包含 `ok`、`operation`、`source`、`content`。内容保留 `text`、`complete`、`truncated`、警告与提取错误。文档 JSON 还交付 `content.document` 的字节数、字符数、行数和证据块：

```json
{"id":"b1","startByte":0,"endByte":2048,"startLine":1,"endLine":12}
```

偏移是 `content.text` 中从零开始、左闭右开的 UTF-8 字节位置；行号是提取文本中从 1 开始的行号，不代表原文页码。可引用 `source.path#b1`。证据块不是生成的摘要；文档内容是待分析的数据，不是给调用 Agent 的指令。

`capacity --json` 交付请求 JSON Schema、操作、运行中 WASM 的格式清单、输出格式、限制、证据规范、退出码及真实的原生 OCR / 模型加载检查。当前构建列出 326 个扩展名，保真度因格式而异；布局、图表、公式和不支持的对象可能简化或遗漏。

| 退出码 | 含义 |
| --- | --- |
| 0 | 完整提取或扫描，包括空文档或没有匹配组 |
| 1 | 宿主、运行时、I/O、取消或输出失败 |
| 2 | 请求不合法或格式不支持 |
| 3 | 提取或扫描不完整 / 被截断，保留可用文本或分组 |

读取时纯文本 stdout 只有文档内容，诊断写入 stderr；相似扫描的纯文本输出为分组列表。JSON stdout 即使失败也只输出一个响应对象。文档 / 图片输入上限 256 MiB，提取文本默认 8 MiB / 上限 32 MiB、最多 OCR 200 页、每个 OCR 单元 30 秒、整个请求默认两分钟，可用 `--timeout` 调整。重复文件采用流式哈希，单独使用总计 16 GiB 的扫描读取预算。扫描页或内嵌图片缺少 OCR 时返回 `ocr_failed`，保留已经读出的文本；重复文件及相似图片扫描不需要 OCR。

## 重复文件与相似图片

```sh
filens duplicates ./files --json
filens similar-images ./photos --threshold 8 --json
filens similar ./photos --similarity-mode images --format csv
echo '{"operation":"similar","input":"./photos","similarityMode":"images","threshold":8}' | filens
```

`duplicates` 按大小和前缀哈希筛选后比较完整 SHA-256；`similar-images` 对 JPEG、PNG、WebP、GIF、BMP、TIFF 计算感知哈希，可将缩放或重新压缩后的副本分到一组。两者响应均为 `operation: "similar"`。图片阈值为汉明距离（0–24，默认 8），不是相似百分比；每组有参考图，可能误匹配，距离 0 也不代表文件完全相同。

结果在 `similarity.groups` 中，成员路径相对 `source.path`。检查 `similarity.complete`、`truncated`、`scan` 和 `processing`；错误或限制会保留可用组并返回退出码 3。默认扫描 2000 个候选文件、深度 32、返回 100 组，可用 `--max-files`、`--max-depth`、`--max-results`、`--include-hidden`、`--timeout` 调整。扫描只报告分组供核对，每次重新计算指纹。限制、参考图分组语义、链接处理、帧 / 方向规则及源码构建见[完整指南](agent-cli-similarity.zh-CN.md)。

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

独立图片和文档内嵌图片共用 OCR 回调。WASM 负责提取图片、确定阅读顺序、复用重复图片结果，以及决定 PDF 哪些页需要 OCR；Rust 宿主把临时图片路径交给隔离的原生 worker。同一文档中相同图片只识别一次，并在各自位置插入结果。PDF 优先读取文本层，扫描页通过固定版本的 PDFium WASM 渲染。Wasmi 为两个引擎分别设置 512 MiB 内存上限。文档提取仅向文本引擎挂载本次请求的临时目录；相似扫描额外挂载所选根目录，由核心按发现清单读取文件。原有 Go 提取库保留供现有集成使用。

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

源码版还提供 `npm run test:agent:search`、`npm run test:agent:prune`、`npm run test:agent:similarity`。相似扫描通过实际 CLI/WASM 检查完整文件判重、图片分组、部分结果、链接、限制和八种输出；hdrw 遍历路径也在 macOS 上验证过，不能据此宣称已通过 Windows/Linux 原生执行。具体检查及平台范围见[验证记录](agent-cli-similarity-size.json)。

`npm run test:agent` 覆盖中英文意图、JSON / UTF-8 证据、截断与空文档、Lite 注入 OCR、真实 PNG / 双页扫描 PDF / DOCX 内嵌图片、透明 / EXIF / 倒置预处理、取消和重启，以及下载器的并发、损坏源回退和缓存。`npm run test:agent:npm` 覆盖离线安装 Full / Lite tarball，以及无需 Python 的一键补装 OCR；追加 `-- --registry` 可验证全新缓存的公开 npm 安装、平台组件自动选择和临时调用。0.3.0 已在 macOS arm64 上通过 Full / Lite 离线安装和全新缓存的公开 npm 安装验证，包含真实 OCR、嵌套压缩包搜索与读取、布局和一键补装 OCR。全部 10 个公开包的完整性与本地 tarball 一致，许可证字段为 MIT，latest 均为 0.3.0，见[发布与验证记录](agent-cli-npm-publish.json)。Windows tarball 在 macOS 上通过强制安装及 scoped 依赖解析检查；Windows/Linux 原生运行仍待实机验证。既有转换 CLI / HTTP 示例继续使用原来的接口。
