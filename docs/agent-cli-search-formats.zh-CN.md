# 多格式搜索：从原始文件到可定位原文

FiLens 的主要价值是用同一个入口处理多种文件：先读出文档、表格、扫描页和图片，再交付可核对的原文、逻辑结构与可用坐标。评测优先检查读到什么、能否搜到、出处是否可还原；启动时间和内存另作使用成本记录。

2026/10/30 02:20:29（Asia/Shanghai），在 darwin-arm64 源码构建上完成 **12 种扩展名、13 个样例、15 次真实 CLI 请求**。本轮全部样例读取和搜索通过，证据偏移均可从同一文件的完整提取文本还原。

## 实际覆盖

每个样例先执行 `read --layout --json`，再从混合格式目录用中文意图发起搜索。以下结构来自命中片段相交的来源块；没有坐标的流式文档只展示实际存在的逻辑结构。

| 输入 | 读取 | 搜索 | UTF-8 原文偏移 | 命中片段的结构与定位 |
| --- | --- | --- | --- | --- |
| TXT | 通过 | 通过 | 通过 | 段落 |
| MD | 通过 | 通过 | 通过 | 段落 |
| HTML | 通过 | 通过 | 通过 | 段落 |
| CSV | 通过 | 通过 | 通过 | 表格、单元格 |
| JSON | 通过 | 通过 | 通过 | 表格、单元格 |
| DOCX | 通过 | 通过 | 通过 | 标题、段落 |
| PPTX | 通过 | 通过 | 通过 | 段落；页 1 |
| XLSX | 通过 | 通过 | 通过 | 表格、单元格 |
| ODT | 通过 | 通过 | 通过 | 标题、段落 |
| RTF | 通过 | 通过 | 通过 | 段落 |
| PDF（文本） | 通过 | 通过 | 通过 | 文字块；页 1；pt 坐标 |
| PNG | 通过 | 通过 | 通过 | 文字块；页 1；px 坐标 |
| PDF（扫描） | 通过 | 通过 | 通过 | 文字块；页 1、2；pt 坐标 |

DOCX 和 ODT 命中标题与段落，XLSX 命中表格与单元格，PPTX 带幻灯片页号。文本 PDF 提供 pt 坐标。扫描 PDF 也提供 pt 坐标，PNG 的 OCR 提供 px 坐标。结构化结果可直接给上层 Agent 引用，或由应用回到原文显示。

搜索示例：

```sh
filens '在 "./documents" 中搜索 "预算 风险"，以 JSON 输出' --layout
filens 'search "./documents" for "budget risk" as markdown'
filens search ./documents --query BUDGET2026 --search-mode exact --json
filens read report.docx --layout --format yaml
```

当前检索使用 BM25、精确文本或文件名模式。中英文意图负责选择本地操作，查询本身仍按词项匹配，同义改写、跨语言推理和问答由上层 Agent 完成。输出还支持 text、HTML、XML、CSV、TSV；各格式适合携带的元数据范围见[输出与布局](agent-cli-formats-and-layout.zh-CN.md)。

## 如何检查

11 份小型合成文档包含同一编号 `BUDGET2026`；其中 RTF 和文本 PDF 为英文，其余样例包含中文预算事实。另加仓库公开的采购单 PNG 和两页扫描 PDF，使用 `FILENS2026` 检索。标签和用于核对的提取文本位于搜索根目录之外。

脚本核对每个编号应命中的文件集合，并将每个片段的 `startByte/endByte` 应用于独立 `read` 操作返回的完整 UTF-8 文本，要求逐字节还原原文。这些偏移属于**提取后的文本**，不是 DOCX/PDF 等原始容器文件的字节位置。文档解析、OCR 回调和布局都来自共享前端核心。

`rg` 使用完全相同的提取文本执行 `-l -0 -F --no-ignore`，全部候选集合一致。这个对照检查相同文字的命中，不给 `rg` 直接输入二进制文件来制造优势，也不据此宣称 FiLens 排名或语义理解更好。

本轮还发现并修复了共享 Markdown 解析器的 UTF-8 切片越界：普通段落以中文、带重音字母或 emoji 开头时可能崩溃。已加入回归测试，并用修复后的 WASM 重跑本页全部样例。

## 覆盖边界

这是功能覆盖检查，不能把 13/13 通过率写成通用检索准确率或 OCR 准确率。Office 等合成容器只覆盖最小内容，未做完整 OOXML schema 合规性校验；复杂排版、公式、附件、损坏文件和各格式子集需要更多样本。

坐标检查覆盖字段、单位及页面存在性，未测量矩形与人工标注的 IoU，也未测 OCR 字符错误率。原文偏移可还原，并不意味着 OCR 文字完全正确；图片文字误识别仍可能影响检索。此轮只在 macOS 实机运行，不能代表 Windows/Linux 运行结果。不同子格式的支持范围请以 `capacity` 为准；浏览器预览支持不等于 CLI 正文提取已支持。

搜索不持久保存正文、索引或文件指纹，不计算/校验来源内容哈希；请求协议的临时文件在结束后清理。[词项检索质量与已知边界](agent-cli-search-benchmark.zh-CN.md)、[原生启动成本](agent-cli-search-native.zh-CN.md)和[后续客观评价方案](agent-cli-search-evaluation.zh-CN.md)分别记录，不由这组格式检查推导速度或相关性优越性。

## 复现

使用当前源码构建的完整包，确保相邻的共享正文 WASM、PDFium 与 RapidOCR NCNN 资源齐全。`FILENS_AGENT_BINARY` 请传绝对路径；未设置时脚本默认读取独立验证目录 `dist/agent-search-parallel/filens`。

```sh
npm run build:agent
FILENS_AGENT_BINARY="$PWD/dist/filens" node scripts/test-agent-search-formats.mjs --ocr
node scripts/write-search-formats-docs.mjs
```

不带 `--ocr` 时只运行 11 份文本/文档样例，并按实际结果重新生成 JSON；OCR 覆盖不会被记为通过。完整机器可读结果见[JSON](agent-cli-search-formats.json)。
