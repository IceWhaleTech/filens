# 压缩包与嵌套文件搜索

0.3.0 的 `search` 会自动展开 ZIP、JAR、WAR、EAR、APK、TAR、TGZ、TAR.GZ 和 GZ，并继续搜索嵌套包中的文件。混合目录与单个压缩包都可作为输入，包内文档和图片复用共享文档核心的读取、OCR、原文片段和布局能力。

```sh
filens '在 "资料.zip" 中搜索 "预算 风险"，以 JSON 输出' --layout
filens 'search "./documents" for "budget risk" as markdown'
filens search ./documents --query FILENS2026 --search-mode exact --json
filens search 资料.zip --query contract --search-mode files --json
```

安装 `filens-cli@0.3.0` 或 `filens-cli-lite@0.3.0` 即可使用，也可从源码构建。请通过 `capacity.search.archives` 检查当前安装的能力；0.2.0 及更早发布包不包含此功能。RAR、7z 和分卷包当前不支持；需要密码的条目会明确报告错误，尚未开放压缩包密码解密接口。

## 搜索后继续读取

每个成员作为独立文件参与排名，避免整个压缩包只返回一段拼接文本。展示路径使用 `!/` 表示容器边界：

```text
/documents/资料.zip!/附件.zip!/images.tar.gz!/合同.pdf
```

JSON 同时包含结构化出处，调用方可以根据数组区分每一层，避免仅靠字符串拆分推测来源：

```json
{
  "path": "/documents/资料.zip!/附件.zip!/images.tar.gz!/合同.pdf",
  "archive": {
    "path": "/documents/资料.zip",
    "members": ["附件.zip", "images.tar.gz", "合同.pdf"]
  },
  "sourceComplete": true,
  "excerpts": []
}
```

以上仅展示字段结构。实际命中的 `excerpts` 包含原文、UTF-8 偏移，以及 `--layout` 请求得到的逻辑结构或物理坐标。偏移属于该**成员的完整提取文本**，可通过相同虚拟路径再次读取核对：

路径本身的 `!` 和 `%` 会转义为 `%21` 和 `%25`，以免与容器边界混淆；`archive.path` 和 `archive.members` 保留原始名称。直接使用结果返回的 `path` 即可。

成员读取响应中的 `source.bytes` 是外层容器的存储大小；文本偏移和文本字节数以该成员的 `content.text` UTF-8 编码为准。

```sh
filens read '资料.zip!/附件.zip!/report.docx' --layout --json
filens '读取 "资料.zip!/附件.zip!/report.docx"，以 Markdown 输出'
filens summarize '资料.zip!/附件.zip!/report.docx' --query '预算 风险' --json
filens read '资料.zip!/images.tar.gz!/invoice.png' --layout --format yaml
```

直接读取指定成员时只解析目标路径上的嵌套容器和目标文档，允许读取明确指定的隐藏成员。文件名搜索也会查看包内名称，包括不支持正文提取的文件；它不解析成员正文、不调用 OCR，但枚举嵌套包仍需要解压容器，TAR/GZIP 需要顺序读取。

## 范围、临时文件和部分结果

目录发现继续使用 macOS FTS 或 Windows/Linux 的 hdrw WASI。所有 ZIP/TAR/GZIP 解析和嵌套策略均在共享前端核心，CLI 只负责调度和结果映射。Office 等复合文档继续按自身格式读取，不能把 DOCX 内部的 XML 当成普通 ZIP 成员返回。

搜索不建立持久索引或解压目录，不新增来源哈希。需要正文或继续展开的成员写入请求临时目录中生成的平坦文件名，用完立即移除；嵌套时只保留尚在使用的父容器。请求结束后清理剩余协议文件。解包过程不使用条目路径创建文件夹，不跟随符号链接或硬链接；绝对路径、`..` 路径和重复成员名等问题会记录错误。

| 限制 | 行为 |
| --- | --- |
| 最多 8 层压缩容器，包含最外层 | 超出时保留其他成员结果，返回 `archive_limit` 并标记不完整。TAR.GZ/TGZ 作为一层压缩 TAR。 |
| `--max-files` 默认 2000，最大 20000 | 包内成员计入最终文件上限；文件名模式还包含容器本身。 |
| 每批展开字节最多 256 MiB | 包括需要读取的嵌套容器与成员，不为压缩率高的内容无限展开。 |
| 每批成员访问上限 `min(maxFiles × 100, 100000)` | 超出时明确截断。 |
| 整次请求提取文本最多 32 MiB | 沿用普通搜索限制；单文件还受 `--max-bytes` 限制。 |
| 隐藏名称、排除目录和 `--max-depth` | 包内搜索沿用目录范围规则；`--include-hidden` 可开启隐藏成员。 |

损坏、加密或 OCR 不可用的成员不影响其他可读成员返回。检查 `search.complete`、`search.truncated`、`scan.extractionErrors` 和退出码；部分结果返回退出码 3。`scan.archives` 记录成员数、访问数、实际展开字节和层数上限。错误路径同样保留容器链，便于判断哪里未能覆盖。

## 实测与复现

本机 macOS arm64 的 [53 条真实 CLI 检查](agent-cli-search-archives.json)全部通过，覆盖混合目录、ZIP → ZIP → TAR.GZ → 图片／扫描 PDF、TAR → GZIP → 文本、8 层嵌套、虚拟路径读取与原文偏移、无 LLM 摘录、八种输出，以及损坏包、加密标记、隐藏成员、链接、长路径、归一化重名、分隔符转义、物理同名路径干扰、资源上限和临时文件清理。实际运行了采购单图片与双页扫描 PDF 的 OCR，并检查 px/pt 坐标字段。共享核心的流式字节预算另有单元测试；未以大规模压缩炸弹作为性能或覆盖证明。

原有搜索 46 条请求与摘录 18 组回归通过；CLI 13 个单元测试和核心 2 个压缩包单元测试通过。Windows x64 交叉检查通过，未声称做过 Windows 实机运行。完整功能检查已接入 `test:agent`。

```sh
npm run build:agent
npm run test:agent:archives
```

可通过绝对路径 `FILENS_AGENT_BINARY` 指向独立验证 bundle。脚本不带 `--ocr` 时运行非 OCR 用例；报告明确记录是否实际运行 OCR。样本是小型合成功能测试和仓库公开 OCR 样例，不代表通用压缩包、检索或 OCR 准确率，也不代表其他操作系统已完成实机验证。
