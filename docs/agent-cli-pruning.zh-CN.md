# 无 LLM 的关键内容提取

源码版新增 `summarize`（别名 `prune`），可在 Full / Lite 中使用。它按密度、词项相关性与相似距离选择原文片段，无需语言模型、向量模型或网络服务。扫描件先经过已有 RapidOCR，文本文件无需 OCR。此前已发布的 npm 0.2.0 和早先 Windows 候选 ZIP 不包含这项新能力；先用最新源码构建，或检查运行版本的 `capacity.operations` 是否包含 `summarize`。

```sh
npm run build:agent:lite
./dist/agent-lite/filens '总结 "report.txt"，以 JSON 输出'
./dist/agent-lite/filens '提取 "report.txt" 的关键内容，关注预算和风险，保留30%，最多800字，以 Markdown 输出'
./dist/agent-lite/filens 'summarize "report.txt" focusing on "budget risk" as json'
```

Windows 使用对应构建目录中的 `filens.exe`。包含公开合成会议记录的演示：

```sh
./dist/agent-lite/filens summarize docs/assets/agent-cli/prune-meeting.txt --query '预算 风险' --summary-chars 240 --summary-ratio 0.4 --json
```

标准输入也接受 JSON 请求：

```json
{"operation":"summarize","input":"report.pdf","query":"预算 风险","summaryChars":800,"summaryRatio":0.3,"format":"json","layout":true}
```

`query` 可省略；`summaryChars` 默认 2000、范围 1–20000；`summaryRatio` 默认 0.3、范围大于 0 且不超过 1。比例先换算成向上取整的字符预算，再由 `summaryChars` 限制上限，按 Unicode 字符计数，包含片段间的换行。可选参数为 `--query`、`--summary-chars`、`--summary-ratio`；自然语言支持“关注/聚焦”“保留30%”“最多800字”，英文支持 `focusing on "budget risk"`、`keep 30%`、`at most 800 characters`。涉及空格或多个关注词时，给文件路径和关注词分别加引号。

| 场景 | 处理方法 |
| --- | --- |
| 未指定关注主题 | 结合 TF-IDF 与全文词项中心的相似度、有效文字密度、标题、位置、数字/否定标记和决议/风险等提示词评分。 |
| 指定关注主题 | BM25 词项匹配优先，再结合基础评分；中文使用字符和相邻双字特征，英文按词处理。 |
| 多个片段重复 | 余弦相似度与 MMR 风格的增量选择降低重复，近似重复中数字或否定标记不同的片段不会直接去重。 |
| 控制输出长度 | 在字符预算内优先保留完整片段，再按原文顺序输出；预算过小时允许截短，并明确标记。 |

这借鉴了 Blue 的分段、BM25/结构评分、预算裁剪流程。算法在共享前端 WASM 核心中实现，CLI 和 Go 集成只传递请求与结果，未复制 Blue 的 Go 算法。

公开合成会议记录的[真实 CLI 观测结果](agent-cli-pruning-evaluation.json)：原文 497 字，默认摘录 146 字，保留技术决议、预算上限、发布日期和风险；聚焦“预算、风险”后为 55 字。macOS arm64 上分别耗时 185 / 177 ms，包含启动和 WASM 执行，属于顺序单次观测。默认摘录为：

```text
决定采用本地 RapidOCR NCNN，统一设置最大边长960、OpenMP线程2，不引入私有Python环境。
预算不得超过12345.67元；
截止日期为2026年11月6日，Windows实机验证完成后才允许正式发布。
风险：极小字体和严重模糊的扫描件可能漏字，关键金额必须核对原图。
```

这是一个可复现的样例，不代表通用文档的摘要准确率。金额、日期和否定条件都直接来自原文，没有由模型重写。

`content.text` 是选中的原文，支持 text、JSON、Markdown、HTML、YAML、XML、CSV、TSV 八种输出。结构化结果额外包含 `content.summary`：

- `method` / `extractive`：说明采用本地摘录算法，没有改写或生成事实。
- `sourceBytes` / `sourceCharacters` / `characters` / `retainedRatio`：原始提取文本与选中文本的体积。
- `sourceComplete`：原始读取是否完整；OCR 失败与 `maxBytes` 截断仍会返回原有错误及退出码 3。
- `omitted`：是否主动省略原文，与读取失败或 `content.truncated` 分开记录。
- `excerpts`：每段的输出偏移、原始提取文本偏移、原始文本行号、排名分数和 `clipped` 标记。
- `sampled`：是否因长文上限而采样；最多对覆盖全文的 4096 个片段评分，候选前 512 个参与多样性选择，最多输出 64 段。
- `queryMatched`：指定主题时是否存在词面匹配；未匹配会返回空摘录与提示，不能据此判断原文没有相关主题。

`startByte/endByte` 是 `content.text` 中的 UTF-8 字节偏移；`sourceStartByte/sourceEndByte` 对应使用 `read` 提取的完整文本，均为左闭右开区间。行号属于提取文本，物理页码与坐标仅在布局提供时使用。`layout:true` 的输出偏移会同步重映射；坐标仍来自原始块，`boundsScope` 提示该矩形可能包含被省略的文字。表格片段保留为原文摘录，不把选中的零散单元格重建成完整表格。

这种方法适合压缩 Agent 上下文、查找相关条款、预览重点和去除重复导航。它无法识别所有同义表达、推导跨段结论或保证关键事实全部保留。分数是排序权重；不是置信度。需要解释原因、翻译、回答问题或改写总结时，将摘录和出处交给上层 Agent，必要时再读取完整原文。

摘录以已知文件为输入；需要跨文件查找时使用源码版新增的[词项搜索](agent-cli-search.zh-CN.md)。搜索使用完整提取文本，避免只索引摘录而丢失事实；embedding 语义检索仍待接入，对照方法见[文档搜索与客观评价方案](agent-cli-search-evaluation.zh-CN.md)。

运行 `npm run test:agent:prune` 可验证真实 CLI/WASM 的中英文入口、词面筛选、预算、原文偏移、八种输出、布局与不完整输入处理。
