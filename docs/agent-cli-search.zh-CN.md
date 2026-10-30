# 本地文档搜索

0.3.0 提供 `search`：从混合格式目录中读取文档、表格、扫描页和图片，找到相关文件及可定位的原文片段。主要价值是共享多格式解析、OCR 与出处信息；支持 BM25、精确文本和文件名搜索。使用 `capacity.operations` 检查当前安装是否包含 `search`；npm 0.2.0 及更早版本没有这项能力。检索排名无需模型，OCR 使用 RapidOCR 模型；`search.semantic` 为 `false`，尚未提供 embedding 同义改写或跨语言语义检索。

[多格式覆盖与证据实测](agent-cli-search-formats.zh-CN.md)记录 12 种扩展名、13 个样例的真实读取、目录搜索与定位检查。优先评价内容是否读出、关键事实是否命中、原文是否可还原；速度和内存作为调用成本单独记录。

```sh
npm run build:agent:lite
./dist/agent-lite/filens '在 "./documents" 中搜索 "预算 风险"，以 JSON 输出'
./dist/agent-lite/filens 'search "./documents" for "budget risk" as json'
./dist/agent-lite/filens search ./documents --query '12345.67' --json
```

标准输入协议：

```json
{"operation":"search","input":"./documents","query":"预算 风险","format":"json","layout":true,"maxResults":10,"maxFiles":2000,"maxDepth":32,"cache":false}
```

| 模式 | 用途与边界 |
| --- | --- |
| `bm25`，默认 | 全文分块后按词项相关性排序，精确短语增加权重。中文使用字和相邻双字特征，英文按词；数字和型号作为完整词项匹配，含数字的查询词要求全部匹配，比较多个型号时宜分别检索。并不理解所有同义词或推导问题答案。 |
| `exact` | 区分大小写的原文字符串匹配，也匹配相对路径；不解释正则表达式。全文查找，匹配可跨越普通分块边界。 |
| `files` | 仅对相对文件路径做 BM25 排序，包含不支持读取的扩展名；不读取正文，不调用 OCR，不提供正文证据或内容哈希。 |

```sh
filens search ./documents --query FILENS2026 --search-mode exact --format markdown
filens search ./documents --query invoice --search-mode files --format csv
filens search ./documents --query '预算' --layout --no-cache --json
```

搜索始终索引完整提取文本，不使用 `prune` 摘录充当唯一索引。文件解析、全文分块、BM25 与证据/导出都在共享前端 WASM 核心中；宿主负责目录和临时文件、运行时及错误映射。扫描页和文档内嵌图片复用已有 RapidOCR 回调；Lite 遇到需要 OCR 的文件时需安装 OCR，否则记录不完整内容与错误。

## 原文与布局

压缩包会自动展开并搜索嵌套成员，支持 ZIP、TAR、TGZ/TAR.GZ、GZ 及常见 ZIP 容器扩展名。结果保留 `资料.zip!/附件.zip!/合同.pdf` 和结构化成员链；可直接用此路径再次读取、获取布局或摘录。[用法、限制和实测](agent-cli-search-archives.zh-CN.md)。

JSON 的 `search.results` 按文件去重排序，每个文件最多返回三个不重叠的原文片段。主要字段为：

- `path`：源文件路径。搜索默认信任读到的内容，不计算或校验来源哈希；兼容字段 `sha256` 为 null。
- `score`：排序权重，不是置信度。`sourceComplete` 表示此文件正文是否完整提取。
- `excerpts[].text`：原文，`startByte/endByte` 对应 `read` 所得完整提取文本中的 UTF-8 字节偏移，左闭右开。
- `startLine/endLine`：提取文本的行号，不能代替原文物理页码。
- `layout`：启用 `--layout` 时返回与片段相交的来源块，以及页面和图像坐标空间信息。`boundsScope: "source-block"` 表示矩形属于原始块，可能覆盖片段以外的文字；不凭空生成流式文档的页码。

支持 text、JSON、Markdown、HTML、YAML、XML、CSV、TSV。表格导出每行一个片段；文件名模式每行一个文件。纯文本和 Markdown 提供路径、行号、偏移与原文；需要完整机器元数据时用 JSON、YAML 或 XML。命中文件名时，返回的正文片段也可能只是文件开头，应核对原文是否回答问题。

## 遍历与范围

macOS 调用系统 FTS，使用 SDK 常量 `FTS_PHYSICAL | FTS_NOCHDIR`，既不跟随目录符号链接，也不修改进程工作目录；不编译或嵌入 hdrw。Windows/Linux 嵌入私有 hdrw 的编译后 WASI 组件，只暴露普通已挂载目录的枚举，当前未开启裸盘/文件系统驱动加速。私有 Go 源码不进入本仓库或发布包。

默认范围为最多 2000 个支持的文件、深度 32、最多返回 10 个文件；可用 `--max-files`（最大 20000）、`--max-depth`（最大 256）、`--max-results`（最大 100）调整。普通隐藏名称默认排除，可用 `--include-hidden`；`.git`、`node_modules`、`target`、`dist` 始终排除，显式作为搜索根目录时可以读取根下其他内容。当前不解释 `.gitignore`。

每个文件上限 256 MiB，提取文本默认上限 8 MiB，可用既有 `--max-bytes` 调整。单次全文语料上限 32 MiB、分块上限 65536；达到上限时明确标为不完整。目录条目上限为 `min(maxFiles × 100, 1000000)`，统计所有已访问条目，避免在大量不支持的文件中无限遍历。默认请求超时两分钟，首次处理大量 PDF/扫描件时可用 `--timeout 10m` 调整。

检查 `search.complete`、`truncated`、`scan`、每个文件的 `sourceComplete` 和退出码。扫描错误、解析/OCR 错误、范围截断都会保留可用结果并返回退出码 3。`scan.errors` 和 `extractionErrors` 各保留最多 64 条，另有总数。没有词面匹配不等于没有相关文档；排序结果不回答问题，也没有可靠的语义无答案检测。

## 内存与启动

搜索只保留本次请求的正文和排名数据，不持久保存索引、提取正文或文件指纹。每次重新遍历并读取当前文件，默认认为来源完整，不计算或校验源文件、WASM、OCR 库/模型的内容哈希；实际读取/解析错误和明确截断仍会返回。修改与删除会在下一次请求体现。

`scan.cache` 保留兼容统计，`enabled:false`、`storage:"none"`、`hits/writes:0`；`scan.integrity` 为 `"assumed"`。`--no-cache` / `cache:false` 仍可使用；`cache:true` 返回请求错误。旧版本已写入的缓存不会被新搜索读取或自动删除。

文件名、常见纯文本/代码文件解码和 BM25/精确排名直接编译共享前端核心的 Rust 源码，这些普通搜索不加载正文 WASM；Windows/Linux 的私有 hdrw 枚举模块仍保留。其他文档格式或 `--layout` 按需使用共享 WASM 解析器，每批最多 256 个文件；多个工作线程共享已加载模块。所有解析与排名算法仍留在 `wasm/converter-core-rust/src/text/`，CLI 只调度调用，不增加格式解析器。显式 `--wasm` / `FILENS_TEXT_WASM` 时按指定模块提取和排名。

默认对元数据总大小不超过 8 MiB 或少于 32 个文件使用单线程，较大工作量最多四个工作线程；高级调优可用 `FILENS_SEARCH_JOBS=1..8`，少于 32 个文件仍串行。OCR 保留一个通道，OpenMP=2；PDFium 和 RapidOCR 仅在实际回调时初始化。WASI 协议使用请求结束后清理的临时目录，不是可复用的磁盘索引。`scan.execution` 报告实际工作线程数、原生文件数、加载的正文 WASM 模块数和批次数。

当前原生 Rust 与不同线程数 rg 的对照见[原生搜索实测](agent-cli-search-native.zh-CN.md)，此前仅延迟加载 WASM 的阶段见[启动实测](agent-cli-search-startup.zh-CN.md)。所有采样都使用新进程、无应用缓存；macOS 清理磁盘缓存被权限拒绝，因此不声称测得物理冷盘。

## 构建和验证

[词项检索质量与边界](agent-cli-search-benchmark.zh-CN.md)对比 FiLens、ripgrep 和 git grep，覆盖文件命中、同义/跨语言边界、无答案误报、原文偏移、100–2000 文件规模、历史缓存更新和原始文档处理成本。多格式支持优先看[本轮功能实测](agent-cli-search-formats.zh-CN.md)；合成语料成绩不能替代真实用户任务或向量产品的对照。

普通源码构建使用随仓库提供的编译后 hdrw 资源，不要求获取私有源码。维护者重编译资源：

```sh
FILENS_HDRW_SOURCE=/path/to/private/hdrw npm run build:agent:hdrw
```

适配通过 Go overlay 完成，不修改私有工作树；中间文件留在忽略的 `dist/hdrw-build/`。`cli/assets/hdrw.json` 记录来源提交、工作树变更状态和产物 SHA-256。Windows/Linux 构建嵌入压缩 WASM，macOS 默认完全排除。维护者可在 macOS 上用 `hdrw-wasi` Cargo feature 与 `FILENS_WALKER=hdrw-wasi` 验证相同 WASI 模块；这不代表 Windows/Linux 的原生实机结果。

```sh
npm run test:agent:search
```

测试覆盖真实 CLI 的中英文入口、中文金额/型号、长文尾部、八种输出、原文偏移与布局、隐藏目录/链接/深度、修改/删除立即生效和不完整来源。[功能检查记录](agent-cli-search-evaluation.json)新增当前原生/共享 WASM 路径的 46 条请求回归（含扫描 PDF OCR），并保留此前 macOS FTS 与 hdrw WASI 的历史观测；另有[13 个多格式样例、15 次请求](agent-cli-search-formats.zh-CN.md)检查混合目录命中与证据定位。Windows x64、Linux x64/arm64 通过此前的 `cargo check --release`，尚未做这两类系统的实机运行验证。质量对比、人工标注及 Agent 完整任务的后续计划见[客观评价方案](agent-cli-search-evaluation.zh-CN.md)。这些功能检查不能证明优于 rg 或 zvec-grep。
