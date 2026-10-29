# PDF Unicode 映射恢复与真实样本回归

修复在 `wasm/converter-core-rust/src/text/pdf_unicode.rs` 中实现，由共享文本
WASM 核心在调用 PDFium 前执行。Go 仍只负责调用引擎、临时文件和 OCR 能力。
原始 PDF 不会被覆盖；有修改时生成请求工作目录内的临时 PDF。

## 为什么不直接合并 Search 的替换表

Search 历史样本 `samples/Google_C++_Guide.pdf` 来自提交
`a86fcff59779ec44389b78e934a30add7c17a247`。旧逻辑按提取后的单字做全局替换，
没有区分字体。样本中有真实反例：

| 页面 | 可见原文 | 旧替换规则的结果 |
| --- | --- | --- |
| 3 | 大多使用 | 大大使用 |
| 3 | 很多强大 | 很大强大 |
| 57 | 现有不统一代码 | 现有与统一代码 |

对嵌入字体中可唯一还原的 22,110 个汉字逐字核对，旧表修复 1,823 个、
误改 111 个，其中 75 个是“多”。因此没有引入 `多 → 大`，也没有引入其他
文档级汉字替换。用户提出“应统一替换”对**同一字体内同一字符编码**成立，
但提取成同一个 Unicode 字符的内容可以来自不同字体、不同字形，不能跨字体替换。

## 当前处理

1. 对 Type0、Identity-H/Identity-V、CIDFontType2 字体，将字符编码经
   CIDToGIDMap 对应到嵌入 TrueType 的字形，再使用其 Unicode cmap 中唯一的
   BMP 映射恢复错误 ToUnicode。多个 Unicode 指向同一字形时跳过歧义项。
   保留多字符连字及代理对，不进行递归文字替换。
2. 修复实际样本中的 CMap 语法错误：`endbfchar100`、
   `endbfcharendcmap` 等缺少分隔符的操作符，以及缺少 `/` 的 CIDSystemInfo。
   为每个字体生成独立 CMap，避免修改其他字体共用的原始映射。
3. 仅折叠单字形映射中的 Kangxi 部首兼容重复，如 `⼦子 → 子`、`⼤大 → 大`。
   正常的 `子子`、`大大`、`人人` 保留。
4. 对实际绘制文字、没有 ToUnicode 且字形名称全是数字的 Type3 字体，转入
   逐页 OCR。仅出现在资源字典、没有被用于文字绘制的字体不会触发 OCR。
   非空提取结果若含至少 3 个非排版控制字符、且比例超过 2%，也转入 OCR。
   缺少 OCR 时保留 `ocr_failed` 错误，不把这些乱码返回为完整成功结果。

恢复尝试限于 32 MiB 内的 PDF，最多 100,000 个对象、256 个 Type0 字体；
单流解压限 16 MiB，ToUnicode 流限 2 MiB，并限制 CMap token 数及范围展开。
TrueType Unicode 子表最多检查 8 个，始终仅查询 BMP，不按字体声明的超大范围展开。
超限、加密、解析失败、没有可靠嵌入映射及其他不支持的字体继续走现有 PDFium 路径；
这不意味着所有无映射 PDF 都能自动检出。Type3 检测目前覆盖页面直接使用的字体，
不递归分析 Form XObject。OCR 可能存在错字，关键词回归也不等于全文准确率评测。

## 样本与复测

公开样本的稳定下载地址、问题来源、SHA-256 和检查项见
[pdf-unicode-corpus.json](pdf-unicode-corpus.json)。PDF 下载到被忽略的
`tmp/pdf-unicode-corpus/`，不把第三方 PDF 放入仓库。

| 样本 | 页数 | 基线问题 | 当前处理 |
| --- | ---: | --- | --- |
| [PDF.js #11066](https://github.com/mozilla/pdf.js/issues/11066) | 1 | 电⼦子科技⼤大学 | 直接恢复为“电子科技大学”，保留文内真正的重复字 |
| [PDF.js #19747](https://github.com/mozilla/pdf.js/issues/19747) | 1 | CMap 语法损坏，另一个字体缺少映射；中英文和数字乱码 | 修复 2 个字体的 CMap；剩余乱码触发 OCR；表格数字仍不可靠 |
| [PyMuPDF #3538](https://github.com/pymupdf/PyMuPDF/issues/3538) | 88 | 上游报告 MuPDF 提取乱码 | 本项目 PDFium 已能读取；输出与基线逐字一致 |
| [PyMuPDF #3945](https://github.com/pymupdf/PyMuPDF/issues/3945) | 18 | Type3 无语义映射，提取出控制字符和伪文字 | 18 页转入真实 NCNN OCR |
| Search Google C++ 指南 | 58 | 徆、不、丌等错误字 | 按 1 个嵌入字体直接恢复；“多”和正确的“不”保留 |
| 项目 Cosmic Atlas 正常 PDF | 3 | 对照组 | 输出与基线逐字一致 |

额外的本机私有样本仅在本机验证。原文件名、路径、文件与正文哈希、正文检查词和
完整输出不进入本文或公开报告，保存在被 Git 忽略的缓存中。

报价单 #19747 只能视为部分恢复：中文标题、工程名称等通过检查，但缺失数字字体
还影响 PDFium 的渲染，OCR 无法从画错的数字恢复原值。没有尝试通过字体名称猜测
另一字体的字形编号；不能用这份输出核对工程金额。报告的 `passed` 表示所列检查通过，
不表示这份文件的全文、数字或表格已正确。

构建并评估公开样本与正常 PDF：

```sh
cargo build --locked --release --manifest-path wasm/converter-core-rust/Cargo.toml \
  --features text-extraction --bin converter-text --target wasm32-wasip1
python3 scripts/evaluate-pdf-unicode.py
```

需要现有 `dist/filens`、NCNN OCR 运行库和模型；可先运行 `npm run build:agent`。
评估器只依赖 Python 标准库。可使用 `--cli`、`--wasm` 指定产物，
`--download-only` 只下载并校验；`--baseline-wasm OLD.wasm` 增加前后对比。
`--search-sample PATH` 可加入历史指南样本并核对固定 SHA-256。
`--local-pdf PATH` 可额外验证私有 PDF，`--local-checks PATH` 可加载本机检查项；
这些检查项文件也必须放在被 Git 忽略的位置。私有样本不进入 `--report`，
其报告写入缓存中的 `private-report.json`，不上传文件。

报告默认写入缓存；本次完整结果见
[pdf-unicode-evaluation.json](pdf-unicode-evaluation.json)。报告仅包含公开与项目样本的退出码、完整性、关键词、字体恢复提示、源文件未改、
输出哈希及耗时；完整文字留在被忽略的本机缓存。错误只保留错误码，避免错误信息夹带本机路径。
OCR 样本还测试了 `--no-ocr` 确实返回失败。

单元测试使用原创几何字形的微型 TrueType 测试字体，不依赖系统字体或第三方字体。
可用 `scripts/generate-pdf-unicode-fixture.py` 重新生成（需要 fontTools）。

```sh
cargo test --locked --manifest-path wasm/converter-core-rust/Cargo.toml \
  --features text-extraction --bin converter-text
go -C converter test ./...
```

新增 Rust 依赖及许可随包附带于 `packaging/ncnn-licenses/pdf-unicode-rust.txt`。

本次验证：108 项 Rust 测试通过，`go -C converter test -count=1 ./...`
全量通过；6 份公开与项目样本的预设检查通过，包含对正常输出未改、源文件未改及缺少 OCR
应返回失败的检查。公开样本的下载器也在全新缓存目录中实际下载并校验通过。
