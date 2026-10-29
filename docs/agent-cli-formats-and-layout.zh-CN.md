# 多格式输出与文档布局

从 Agent CLI 0.2.0 开始支持以下 8 种输出。文档解析、结构提取、坐标归一化和文档导出均在共享 WASM 核心中完成。

![真实 CLI 输入、Markdown 导出与 OCR 坐标演示](assets/agent-cli/terminal-demo.gif)

动图使用真实 CLI 结果，剪辑了打字和响应时间；右侧将返回的布局框叠加到输入图片上。JSON / YAML 展示输出节选，语义推理由调用 Agent 完成。

| 输出 | 内容 | 示例 |
| --- | --- | --- |
| text / txt | 原始提取文本 | `filens '读取 "report.pdf"，以纯文本输出'` |
| json | 完整响应、文本、证据与可选布局 | `filens '理解 "report.docx"，以 JSON 输出'` |
| markdown / md | 根据已有结构导出标题、段落和表格 | `filens 'read "report.docx" as markdown'` |
| html / htm | 可独立打开的 HTML；转义原文中的 HTML 字符 | `filens read report.docx --format html > report.html` |
| yaml / yml | 完整响应，适合阅读与配置型处理 | `filens '获取 "scan.pdf" 的布局，以 YAML 输出'` |
| xml | 完整响应，根节点为 filens；字段用 field 的 name 属性表示，数组用 item 表示 | `filens layout report.pdf --format xml` |
| csv | 单个表格导出为二维数据；布局请求导出块记录 | `filens read data.xlsx --format csv > data.csv` |
| tsv | 与 CSV 相同，使用制表符分隔 | `filens read data.xlsx --format tsv > data.tsv` |

CSV / TSV 会保留字段中的逗号、引号与换行。存在多个表格、超大稀疏网格或没有表格时，改用块记录，包含 table、row、column、text 和可用坐标；不把多个工作表强行拼成一个表。Markdown 将每个表格的首行作为展示表头，不代表自动理解了表头语义。导出面向内容，不承诺重建原始版式、合并单元格或样式。

布局可通过自然语言、`layout` 操作、`--layout` 或 JSON 请求获取：

```sh
filens '获取 "report.pdf" 的版面信息，以 JSON 输出'
filens layout invoice.png --format yaml
filens read report.docx --layout --format json
echo '{"operation":"layout","input":"report.pdf","format":"json"}' | filens
echo '{"operation":"understand","input":"report.docx","layout":true,"format":"yaml"}' | filens
```

布局请求默认输出 JSON。纯文本无法表达布局元数据，会明确拒绝 `layout --format text`。Markdown / HTML 的布局请求在正文后附加布局元数据；CSV / TSV 的布局请求始终返回块记录。

| 来源 | 当前可交付的信息 | 边界 |
| --- | --- | --- |
| PDF 文本层 | 从 1 开始的页码、页尺寸、文字矩形、可用的字体属性；pt 坐标 | 不是语义版面分类器；多栏顺序沿用提取引擎，不能保证恢复复杂排版。 |
| 扫描 PDF | 每页 OCR 文字框、四边形、检测分数；图像坐标映射为页面 pt | 检测分数不代表转写准确率，OCR 仍可能误识别。 |
| 独立图片 | 应用 EXIF 后的尺寸、px 坐标、OCR 四边形与检测分数 | 不保证整页阅读顺序；0 / 180 度文字行分类不是整页排版恢复。 |
| Word OpenXML | 段落、直接声明的标题级别、表格和单元格行列、来源 XML part | 不运行 Word 排版引擎；不伪造页码或物理坐标，样式继承可能无法识别为标题。 |
| Excel / Numbers | 表格名称、单元格行列与值 | 提供逻辑网格，不提供打印分页或屏幕像素坐标。 |
| PowerPoint OpenXML | 实际幻灯片序号、段落及表格结构 | 本版不重建所有形状的放置坐标。 |
| 文档内嵌图片 | 独立图像坐标空间中的 OCR 框 | 流式文档中图片的页面位置不可用，不把图内 px 混作页面坐标。 |
| 其他格式 | 尽可能交付逻辑结构，否则退回提取文本段落并说明限制 | 不是所有支持读取的格式都拥有专用布局适配。 |

布局位于 `content.layout`，协议为 `filens-layout-v1`。`coverage` 表示 physical-and-logical、logical 或 text；`warnings` 说明缺失信息。一个真实独立图片文字块的节选：

```json
{
  "id": "l1",
  "kind": "text",
  "page": 1,
  "startByte": 0,
  "endByte": 21,
  "coordinateSpace": "image:1",
  "bounds": {"x": 78, "y": 91, "width": 823, "height": 87, "unit": "px"},
  "polygon": [[78,91],[901,91],[901,178],[78,178]],
  "detectionScore": 0.945929,
  "source": "ocr"
}
```

所有归一化坐标以左上角为原点，向右为 x 正方向、向下为 y 正方向。PDF 文字矩形通过 PDFium 的页面变换归一化，包含页面裁剪与旋转。`coordinateSpace` 区分 `page:1` 和 `image:1`；图片坐标空间的尺寸位于 images 中。缺少 bounds 代表不可用，不代表零坐标。

`startByte` / `endByte` 是 `content.text` 中左闭右开的 UTF-8 字节位置，可直接取回原文；不可可靠对齐的 PDF 矩形保留空偏移，不伪造引用。表格单元格的 row / column 从 1 开始，table 引用其表格块的 id。布局最多 20,000 个块，达到限制时标记 truncated，正文仍按独立的 maxBytes 限制交付。

复现验证与动图：

```sh
npm run build:agent
npm run test:agent:layout
npm run demo:agent
```

生成输入、完整实测输出和计时保存在 `dist/agent-layout/`、`dist/agent-demo/`。动图为 1280 × 820、12 fps、28.5 秒，使用 Playwright 和 FFmpeg 制作，安装后的 CLI 不需要这些工具。[0.1.0 的 68 条历史观察](agent-cli-examples.zh-CN.md)仍保留，其中 YAML / XML 等格式的旧行为已被 0.2.0 扩展。
