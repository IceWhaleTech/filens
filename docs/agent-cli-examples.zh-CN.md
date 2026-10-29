# Agent CLI 实测案例与自然语言边界

> 当前源码支持无 LLM 的原文摘录式总结：`summarize` / `prune`。旧版将总结请求拒绝或判为非法操作的结论已失效；原始记录保留在历史 JSON 中，并标记后续能力更新。已发布的 npm 0.2.0 和早先 Windows ZIP 不包含这项新能力，使用 `capacity` 检查当前安装。下方基础实测表属于历史观测；当前多格式与布局能力见[指南](agent-cli-formats-and-layout.zh-CN.md)。

[安装与协议](agent-cli.zh-CN.md) · [机器可读的测试摘要](agent-cli-evaluation.json)

本页基础实测来自 2026-10-29 在 darwin-arm64 上对 **68 条请求**的实际执行，使用报告记录的 CLI 产物、RapidOCR NCNN、最大边长 960、OpenMP=2。包含合成的可核对 OCR 图片、仓库演示文档与公开旧版 Word / iWork 样本。这是功能观察与有限质量检查，不是通用准确率基准，也不是 68 条“全部正确”的声明。

当前自然语言入口支持**读取全文、准备理解证据、发现能力、选择八种输出格式、提取关键内容、搜索本地目录**。总结通过密度/TF-IDF、可选 BM25 主题匹配和余弦多样性选择，保留原文及出处，无需语言模型。改写总结、翻译和问答仍由上层 Agent 完成。生产调用请使用 capacity 给出的 JSON Schema，并自行验证响应。

源码版的 search 支持 BM25、区分大小写的精确文本、文件名搜索和可校验的原文片段；支持中英文意图及八种输出格式。它使用全文，正文缓存按源内容哈希更新，尚未提供 embedding 语义检索。macOS 使用原生 FTS，不嵌入 hdrw；Windows/Linux 仅嵌入私有 hdrw 的编译后 WASI。用法见[搜索指南](agent-cli-search.zh-CN.md)，独立的[当前功能检查](agent-cli-search-evaluation.json)不属于本页历史 68 条观测，也不能证明优于 rg 或 zvec-grep。

## 当前总结能力：中文、英文与 JSON 均可用

检查 `capacity.operations` 是否包含 `summarize` 后，可使用以下请求：

```sh
filens '总结 "report.txt"，以 JSON 输出'
filens 'summarize "report.txt" as json'
filens '提取 "report.txt" 的关键内容，关注预算和风险，保留30%，最多800字，以 JSON 输出'
filens prune report.txt --query '预算 风险' --summary-chars 800 --json
echo '{"operation":"summarize","input":"report.txt","query":"预算 风险","format":"json"}' | filens
```

`summarize` 是合法操作，`prune` 是别名；“总结”返回关键原文片段。检查 `content.summary.sourceComplete`、`omitted`、`sampled` 和每段的 `clipped`；主动裁剪不等于读取被截断。分数只用于排序，不能表示内容可信度。出处同时提供输出文本和完整提取文本的 UTF-8 偏移。

公开合成会议记录的[当前真实 CLI 结果](agent-cli-pruning-evaluation.json)：

| 场景 | 原文字符数 | 摘录字符数 | 单次耗时 |
| --- | ---: | ---: | ---: |
| 自动选取关键原文 | 497 | 146 | 185 ms |
| 聚焦预算和风险 | 497 | 55 | 177 ms |

这些是 darwin-arm64 上的单次观测，包含进程启动和 WASM 执行，不能代表通用摘要质量或稳定性能。完整用法、原文、摘录结果和限制见[无 LLM 关键内容提取](agent-cli-pruning.zh-CN.md)。历史总结失败记录不再列入下方边界表。

## 五分钟上手

安装后先准备一个文件，再复制这些命令。下文表格里的 report.txt、季度 报告.txt、invoice.png 等文件均由评估脚本生成。

```sh
printf '季度报告\n项目：本地文档读取\n预算：12345.67 元\n负责人：张三\nBudget 42\n' > report.txt
filens '你能做什么？以 JSON 输出'
filens '读取 "report.txt"，以纯文本输出'
filens '理解 "report.txt"，以 JSON 输出'
filens 'Please extract all text from "report.txt" in JSON'
echo '{"operation":"understand","input":"report.txt","format":"json"}' | filens
```

图片、PDF 和内嵌图片示例使用你自己的文件路径，或先运行文末的评估脚本生成样本：

```sh
filens '识别 "invoice.png" 中的文字，以 JSON 输出'
filens '读取 "scan.pdf"，以 JSON 输出'
filens '理解 "embedded.docx"，以 JSON 输出'
```

“理解”返回来源、原文、UTF-8 字节证据块；它不会替调用 Agent 给出结论。“识别图片”也走 read，输出普通文本或同一份 JSON 内容协议。

## OCR 实际效果

五张图片是同一份虚构中文采购单，均为 1440 × 1000 PNG；原文与图片都在仓库中，可逐字核对。每次耗时包含新进程、WASM 编译和模型加载，各测一次，不能视为稳定性能指标。

| 图片条件 / 输入 | 归一化字符错误率 | 订单号 / 金额精确命中 | 本次耗时 |
| --- | --- | --- | --- |
| [清晰，34 px](assets/agent-cli/invoice-zh.png) | 0.0% | 是 / 是 | 1.45 s |
| [轻度模糊，34 px / blur 2.4 px](assets/agent-cli/invoice-blur.png) | 0.0% | 是 / 是 | 1.40 s |
| [小字号，13 px](assets/agent-cli/invoice-small.png) | 0.0% | 是 / 是 | 1.39 s |
| [极小字号，7 px](assets/agent-cli/invoice-tiny.png) | 26.3% | 否 / 是 | 1.42 s |
| [重度模糊，34 px / blur 6.4 px](assets/agent-cli/invoice-heavy-blur.png) | 93.7% | 否 / 否 | 1.58 s |

这里的字符错误率使用 NFKC，去掉空白和标点，再计算字符编辑距离 / 原文长度；所以 0% 不代表原样保留空格与标点。订单号 FILENS2026、金额 12345.67 另外做精确匹配。单张干净合成图的成绩不能推断任意扫描件、手写体或语言的效果。

清晰图实际返回：

```text
星河科技采购单
订单编号 FILENS2026
客户名称：上海示例公司
项目名称：本地文档读取与识别
应付金额：12345.67元
交付日期：2026年10月29日
备注：无需 Python，离线识别中文和 English。
```

两页扫描 PDF 实际返回：

```text
Invoice ID FILENS2026
Total 12345.67
Second page BRIGHT2027
Local OCR test
```

DOCX 内嵌透明图片的实际返回，显示 OCR 文字插入在前后正文之间：

```text
BEFORE 中文Invoice ID FILENS2026
Total 12345.67
AFTER
```

实际发现的限制：

- 180 度倒置测试识别出了文字，但两行顺序反转；EXIF 方向样本顺序正常。文字行方向识别不等同于整页版面重建。
- DOCX、PPTX、Keynote 中的风景照片会触发图片 OCR，可能输出“一 / 心 / 公”等零散字符；当前没有足够可靠的“这张图没有文字”判定。
- ok=true / complete=true 表示提取过程完成，不是识别置信度、内容准确率或语义正确性保证。
- 提示“只读第一页”不会改变扫描 PDF 的范围；本次仍返回了第二页 BRIGHT2027。

## 文档读取实测

| 输入文件 | 提取字符数 | 本次耗时 | 实际观察 |
| --- | ---: | ---: | --- |
| [filens-aurora-guide.docx](../apps/demo/public/samples/filens-aurora-guide.docx) | 1,458 | 1.95 s | 正文、表格可读；风景图回调混入“一 / 心 / 公”等误识别字符。 |
| [filens-observatory.xlsx](../apps/demo/public/samples/filens-observatory.xlsx) | 2,923 | 1.17 s | 工作表、单元格与数值可读；不负责重新计算公式或解释图表。 |
| [filens-cosmic-atlas.pdf](../apps/demo/public/samples/filens-cosmic-atlas.pdf) | 559 | 1.85 s | 三页 PDF 的文本层可读；沿用文本优先策略。 |
| [filens-field-notes.pptx](../apps/demo/public/samples/filens-field-notes.pptx) | 503 | 2.88 s | 幻灯片文字可读；风景图片产生多组零散误识别字符。 |
| [legacy-project-workflow.doc](../apps/demo/public/samples/legacy-project-workflow.doc) | 16,145 | 1.75 s | 旧版 Word 正文可读；复杂排版未做保真度量化。 |
| [a.pages](../apps/demo/public/samples/a.pages) | 2,782 | 1.43 s | Pages 正文、Unicode 与列表内容可读。 |
| [a.numbers](../apps/demo/public/samples/a.numbers) | 221,997 | 1.25 s | 读取超过 22 万字符；不是表格摘要或语义分析。 |
| [filens-weekend.key](../apps/demo/public/samples/filens-weekend.key) | 1,022 | 3.18 s | Keynote 文字可读；图片 OCR 有噪声，备注中存在重复内容。 |

这些文档均返回 ok=true、complete=true。上表记录能否读取和实际局限，没有对原始排版、每一个图像识别结果或全部字符做准确率宣称。完整提取文本留在本地 dist/agent-evaluation/report.json；提交的摘要只保留短片段。

## 能力发现：哪些问法实际可用

| 案例 | 实际请求 | 实际输出 / 退出码 | 观察 |
| --- | --- | --- | --- |
| 中文能力发现 | `filens "你能做什么？以 JSON 输出"` | json / 0 | 能力清单；326 个扩展名；OCR available=true |
| 格式发现 | `filens "支持哪些格式？用 JSON 返回"` | json / 0 | 能力清单；326 个扩展名；OCR available=true |
| English discovery | `filens "what can you do as json"` | json / 0 | 能力清单；326 个扩展名；OCR available=true |
| English capability sentence | `filens "what are your capabilities in json"` | json / 0 | 能力清单；326 个扩展名；OCR available=true |
| 可选 capacity 命令 | `filens "capacity" "--json"` | json / 0 | 能力清单；326 个扩展名；OCR available=true |
| 能力问法同义变体 | `filens "你能做哪些事情？"` | text / 2 | 不认识这个能力问法；改用“你能做什么”。 |
| OCR 能力疑问 | `filens "你会 OCR 吗？"` | text / 2 | 不认识“你会 OCR 吗”；用 capacity 看 OCR 状态。 |
| 混合发现与读取 | `filens "你能做什么？顺便读取 \"report.txt\"，以 JSON 输出"` | json / 0 | 返回能力清单；没有读取该文件。一次请求只表达一种操作。 |

## 读取与路径：引号很重要

| 案例 | 实际请求 | 实际输出 / 退出码 | 观察 |
| --- | --- | --- | --- |
| 中文读取含空格路径 | `filens "请读取 \"季度 报告.txt\"，以纯文本输出"` | text / 0 | read（纯文本不带操作字段）；45 字符 |
| 中文理解弯引号 | `filens "帮我理解“季度 报告.txt”，用 JSON 返回"` | json / 0 | understand；45 字符；1 个证据块 |
| English read | `filens "read \"report.txt\" as json"` | json / 0 | read；45 字符；1 个证据块 |
| English polite request | `filens "Please extract all text from \"report.txt\" in JSON"` | json / 0 | read；45 字符；1 个证据块 |
| English contents | `filens "show me the contents of \"report.txt\""` | text / 0 | read（纯文本不带操作字段）；45 字符 |
| 路径独立 shell 参数 | `filens "understand" "季度 报告.txt" "--json"` | json / 0 | understand；45 字符；1 个证据块 |
| 只传路径 | `filens "report.txt" "--json"` | json / 0 | read；45 字符；1 个证据块 |
| 不加引号的紧邻读取 | `filens "读取report.txt，以JSON输出"` | json / 0 | read；45 字符；1 个证据块 |
| 不加引号的客套变体 | `filens "帮我读取report.txt，以JSON输出"` | json / 1 | 把“帮我读取”当成文件名的一部分；路径加引号即可。 |
| 不加引号的看一下 | `filens "看一下report.txt"` | text / 1 | 把“看一下”当成文件名的一部分；路径加引号即可。 |
| 加引号的看一下 | `filens "看一下 \"report.txt\""` | text / 0 | read（纯文本不带操作字段）；45 字符 |
| 文件名中的 why | `filens "read" "why notes.txt" "--json"` | json / 0 | read；45 字符；1 个证据块 |

自然语言中的路径应使用双引号或中文弯引号。单独的 shell 参数也能保留文件名中的空格，例如 filens understand '季度 报告.txt' --json。程序不会让上层 Agent 自动记住“刚才那个文件”，每次都需要给出路径。

## 输出格式：能识别的表达与严格入口

| 案例 | 实际请求 | 实际输出 / 退出码 | 观察 |
| --- | --- | --- | --- |
| 中文 JSON 格式 | `filens "请用 JSON 格式读取 \"report.txt\""` | json / 0 | read；45 字符；1 个证据块 |
| 大写 JSON | `filens "Read \"report.txt\" as JSON"` | json / 0 | read；45 字符；1 个证据块 |
| 输出 JSON 的另一种英语语序 | `filens "read \"report.txt\" and output JSON"` | text / 0 | 没有识别 output JSON；实际为纯文本。改用 as json / in JSON。 |
| 自然语言要求 YAML | `filens "read \"report.txt\" as yaml"` | text / 0 | YAML 未实现；被忽略，返回纯文本。 |
| 自然语言要求 XML | `filens "读取 \"report.txt\"，以 XML 输出"` | text / 0 | XML 未实现；被忽略，返回纯文本。 |
| 显式格式拒绝 YAML | `filens "report.txt" "--format" "yaml"` | text / 2 | invalid_request: unsupported output format "yaml"; choose text or json |
| 显式 flag 覆盖自然语言 | `filens "读取 \"report.txt\"，以纯文本输出" "--json"` | json / 0 | read；45 字符；1 个证据块 |
| 自然语言格式冲突 | `filens "read \"report.txt\" as json and as plain text"` | json / 0 | 匹配到 JSON 后选择 JSON；不要同时指定两种格式。 |

上表保留旧版的格式观察。当前源码支持 text、JSON、Markdown、HTML、YAML、XML、CSV、TSV；需要严格验证格式时，使用 --format 或 JSON format 字段，详见[当前多格式指南](agent-cli-formats-and-layout.zh-CN.md)。

## JSON 与 stdin：给 Agent 的可验证协议

| 案例 | 实际请求 | 实际输出 / 退出码 | 观察 |
| --- | --- | --- | --- |
| JSON stdin | `stdin: {"operation":"understand","input":"report.txt"}` | json / 0 | understand；45 字符；1 个证据块 |
| JSON 请求纯文本 | `stdin: {"operation":"read","input":"report.txt","format":"text"}` | text / 0 | read（纯文本不带操作字段）；45 字符 |
| 自然语言 stdin | `stdin: 读取 "report.txt"，以 JSON 输出` | json / 0 | read；45 字符；1 个证据块 |
| JSON 未知字段 | `stdin: {"input":"report.txt","pages":"1-2"}` | json / 2 | invalid_request: invalid JSON request: json: unknown field "pages" |
| JSON 非法 format | `stdin: {"input":"report.txt","format":"xml"}` | json / 2 | invalid_request: unsupported output format "xml"; choose text or json |

推荐调用链：读取 capacity → 根据 Schema 发送 search、understand/read 或 summarize 请求 → 检查 ok、complete、truncated、error 及摘录标记 → 根据需要将原文或关键摘录交给上层 Agent 改写总结、问答或字段提取。证据位置是提取文本的 UTF-8 字节偏移；物理页码和坐标需检查布局信息。

```json
{"operation":"understand","input":"report.txt","format":"json"}
```

## 历史边界记录：改写、问答与其他操作

| 案例 | 实际请求 | 实际输出 / 退出码 | 观察 |
| --- | --- | --- | --- |
| 翻译 | `filens "翻译 \"report.txt\" 成英文"` | text / 2 | invalid_request: semantic reasoning belongs to the calling agent; request read/understand, then use the returned text and evidence blocks to answer |
| 中文金额问答 | `filens "\"report.txt\" 中预算是多少？"` | text / 2 | invalid_request: semantic reasoning belongs to the calling agent; request read/understand, then use the returned text and evidence blocks to answer |
| 英文明确问答 | `filens "how many projects are in \"report.txt\"?"` | text / 2 | invalid_request: semantic reasoning belongs to the calling agent; request read/understand, then use the returned text and evidence blocks to answer |
| 另一种英文问答 | `filens "what is the budget in \"report.txt\"?"` | text / 0 | 没有回答问题，回退成全文读取。 |
| 筛选金额 | `filens "只列出 \"report.txt\" 中的金额，以 JSON 输出"` | json / 0 | 没有筛选金额，返回全文。 |
| 格式转换意图 | `filens "把 \"report.txt\" 转成 PDF"` | text / 0 | 没有生成 PDF，回退成全文读取。 |
| 多个文件 | `filens "read \"report.txt\" and \"季度 报告.txt\" as json"` | json / 2 | invalid_request: one file per request; multiple input paths found |
| 目录遍历意图 | `filens "--input" "." "--json"` | json / 2 | invalid_input: input must be a regular file no larger than 256 MiB |
| URL 输入 | `filens "读取 \"https://example.com/report.pdf\"，以 JSON 输出"` | json / 2 | invalid_request: input must be a local file path |
| 没有文件路径 | `filens "帮我读取文档，以 JSON 输出"` | json / 2 | invalid_request: name the local file to read, for example: filens '读取 "report.pdf"，以 JSON 输出' |
| 不存在的文件 | `filens "读取 \"missing.pdf\"，以 JSON 输出"` | json / 1 | io_error: stat missing.pdf: no such file or directory |

“只列金额”“what is the budget”“转成 PDF”目前都不能作为已完成对应操作的证据。这些请求可能只返回全文，甚至仍为退出码 0。Agent 要对照返回的 operation / content 验证任务，不能把自然语言被接受等同于任务已执行。

## OCR 调用、扫描页和文档回调案例

| 案例 | 实际请求 | 实际输出 / 退出码 | 观察 |
| --- | --- | --- | --- |
| 自然语言调用 OCR | `filens "识别 \"invoice.png\" 中的文字，以 JSON 输出"` | json / 0 | read；37 字符；1 个证据块 |
| 只读第一页的自然语言 | `filens "只读取 \"scan.pdf\" 的第一页，以 JSON 输出"` | json / 0 | 没有分页筛选；实际包含第二页 BRIGHT2027。 |
| 扫描 PDF 完整读取 | `filens "读取 \"scan.pdf\"，以 JSON 输出"` | json / 0 | read；75 字符；1 个证据块 |
| 文档内嵌透明图片回调 | `filens "理解 \"embedded.docx\"，以 JSON 输出"` | json / 0 | BEFORE → 透明图片 OCR → AFTER，位置保留。 |
| 关闭 OCR 保留已有文本 | `filens "understand" "embedded.docx" "--no-ocr" "--json"` | json / 3 | 明确报 ocr_failed，保留 BEFORE / AFTER。 |
| scan-rotated.png | `filens "converter/rapidocr/testdata/scan-rotated.png" "--json"` | json / 0 | 词语可识别，但两行顺序反转；不是整页版面校正。 |
| scan-exif.jpg | `filens "converter/rapidocr/testdata/scan-exif.jpg" "--json"` | json / 0 | read；37 字符；1 个证据块 |
| scan-transparent.png | `filens "converter/rapidocr/testdata/scan-transparent.png" "--json"` | json / 0 | read；37 字符；1 个证据块 |

--no-ocr 的失败案例返回退出码 3、ocr_failed，并保留已经读出的 BEFORE / AFTER；它不会把遗漏内嵌图片的结果伪装成完整提取。

## 复现与原始结果

```sh
npm run build:agent
npm run evaluate:agent
# 或验证某个已安装版本；参数应指向真实可执行文件
node scripts/evaluate-agent-cli.mjs --binary /path/to/filens
```

报告位于 dist/agent-evaluation/report.json；每条保存原始参数、退出码、文本、错误、耗时与质量指标。图片输入和期望原文已提交；通常不需要重新生成。要更新图片可运行 node scripts/generate-agent-ocr-fixtures.mjs，需要 Playwright Chromium，字体渲染会随系统变化。可用 node scripts/write-agent-evaluation-docs.mjs 从最近的报告重建本页。

历史失败行只描述当时的被测产物，不能用于判断当前源码是否支持总结。当前摘录能力由 agent-cli-pruning-evaluation.json 单独记录。npm 注册表的安装验证由 node scripts/test-agent-npm.mjs --registry 单独执行，不把本地构建成功当成注册表发布成功。
