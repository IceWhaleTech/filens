# macOS 原生 OCR 与 RapidOCR 实测

2026-10-30，在 Apple M4 Pro / 24 GB / macOS 26.6.2 / arm64 上比较 Apple Vision
与当前 filens 随包提供的 RapidOCR NCNN。**不能认定原生 OCR 全面覆盖或质量全面更好：
Vision 的热调用更快，但极小字完全漏检，轻度模糊也出现错误；首次调用更慢。**
因此本次仅保留可复现实验，不修改生产 OCR 默认后端。

## 方法与范围

- 13 份有参考文本的合成输入：清晰中英文、轻度/重度模糊、13px / 7px 中文、
  180°/90°旋转、EXIF 方向、透明背景白底预处理、8°倾斜、空白图片。
- Vision：`VNRecognizeTextRequest`，accurate，revision 3，简体/繁体中文与英文，
  开启自动语言判断及语言纠正，`minimumTextHeight = 0`；坐标转成方向修正后的左上角像素。
- RapidOCR：现有真实 Rust `--ocr-worker`，PP-OCRv6 small 检测、mobile v2 方向分类、
  PP-OCRv3 中英文识别，CPU 两线程、最大边长 960、padding 50，开启方向分类。
- 两者使用相同图片；透明背景以与 WASM 核心相同的白底合成规则准备，不计入计时。
  Vision 使用原始分辨率，RapidOCR 保留现有最大边长 960 的生产配置；这是可用处理路径的
  比较，不是同分辨率、同硬件加速后端的模型对照。Vision 的设备调度由系统决定。
  先各预热一次，然后逐项交替调用，各测 7 次，报告中位数。包括图片解码、推理、
  JSON 和进程通信，不含 Swift 编译、文档解析和 PDF 渲染。
- 新进程首次识别另测 5 次；未清除系统文件/框架缓存，不能把它当成系统冷启动。
- 质量使用归一化字符错误率 CER：NFKC、忽略大小写、空白、标点和符号后做编辑距离。
  CER 越低越好，**会把阅读顺序错误计入，也会隐藏标点及大小写错误**。这不是实景精度语料库。

## 热调用耗时与质量

| 输入 | Vision ms | RapidOCR ms | Vision CER | RapidOCR CER |
| --- | ---: | ---: | ---: | ---: |
| `invoice-zh` | 124.5 | 215.2 | 0.0% | 0.0% |
| `invoice-blur` | 130.3 | 205.1 | 1.1% | 0.0% |
| `invoice-small` | 115.2 | 191.7 | 0.0% | 0.0% |
| `invoice-tiny` | 36.5 | 180.2 | 100.0% | 26.3% |
| `invoice-heavy-blur` | 25.6 | 362.8 | 100.0% | 93.7% |
| `scan` | 59.9 | 77.9 | 0.0% | 0.0% |
| `scan-rotated` | 57.1 | 77.0 | 0.0% | 77.4% |
| `scan-exif` | 63.3 | 77.5 | 0.0% | 0.0% |
| `transparent-prepared` | 65.0 | 75.2 | 0.0% | 0.0% |
| `zh-90` | 116.1 | 209.5 | 0.0% | 92.6% |
| `zh-180` | 123.9 | 208.3 | 0.0% | 92.6% |
| `zh-skew-8` | 135.6 | 215.5 | 0.0% | 0.0% |
| `blank` | 15.8 | 64.2 | 0.0% | 0.0% |

Vision 的热调用在这 13 个输入上都更快，但空结果不能作为同等质量下的提速：
`invoice-tiny`（7px）的 Vision 返回空文本，RapidOCR CER 为 26.3%；两者均未识别出
该图的订单编号，RapidOCR 识别出了金额。重度模糊中 Vision 同样返回空文本，RapidOCR
也已严重失真。轻度模糊时 Vision 把“离线”识别为“高线”，RapidOCR 无归一化字符错误。

`scan-rotated` 的 RapidOCR 文本实际识别正确，但输出顺序由“编号→金额”变为“金额→编号”，
所以顺序敏感 CER 为 77.4%；不能把它解释为四分之三字符未识别。中文 90°/180°样本中
RapidOCR 也主要表现为行顺序反转；Vision 在这些输入上保持了参考阅读顺序。

## 新进程首次识别

清晰中文发票，包含进程启动与第一张图片识别：

- Vision：中位数 **328.5 ms**，五次范围 300.9–916.1 ms。
- RapidOCR：中位数 **237.4 ms**，五次范围 235.8–293.9 ms。

第一轮 Vision 约 916 ms，后续约 301–334 ms；RapidOCR 约 236–294 ms。因此“原生 OCR
速度更好”只适用于本次复用进程的图片调用，不能直接推广到一条 CLI 命令的完整耗时。

## 能否覆盖当前功能

| 当前功能 | Vision 实测/适配情况 | 结论 |
| --- | --- | --- |
| 中英文文本识别，离线运行 | 本地 Vision 成功识别，不下载第三方模型；框架与模型由 macOS 管理 | 可以作为 macOS 候选后端 |
| 小字与模糊文本 | 7px 返回空结果；轻度模糊比 RapidOCR 多一个字错误 | 不能全面替代 |
| 旋转、倾斜、EXIF | 测试输入识别成功，180°/90°阅读顺序更好 | 本轮通过，不代表任意照片 |
| 透明背景 | 经过共享核心白底合成后识别成功 | 必须保留预处理；未宣称原始透明图可直接替换 |
| 文本几何与置信度 | 返回四边形和识别候选置信度，像素范围检查通过 | 需要映射现有布局协议；候选置信度不等于 RapidOCR 检测分数 |
| 扫描 PDF、内嵌 DOCX 图片、搜索 OCR 回调 | 图像识别本身可承接；本实验未接入现有 WASM 回调链 | 尚未完成端到端验证 |
| 错误恢复 | 文件不存在时明确报错，随后 health 成功 | 本轮通过 |
| 截止时间、强制取消、worker 重启 | 现有 RapidOCR 主机有隔离/终止机制；Vision 实验未做完整取消接入 | 尚未验证等价 |
| Windows / Linux | Apple Vision 仅适用于 Apple 系统 | 必须保留跨平台后端 |
| 可复现版本、模型选择 | RapidOCR 固定模型与哈希；Vision 依赖系统版本与系统模型 | 结果稳定性需要跨 macOS 版本验证 |

Vision 实验适配程序约 **96 KB**，不含系统框架/模型，这说明它有减少 macOS 分发体积的
潜力；不能把该值当成完整 CLI 安装体积。当前 Full 包约 23 MB 的额外原生运行时与模型
仍保留，未发布任何替换包。

可考虑后续增加 `auto / vision / rapidocr`：macOS 优先尝试 Vision，允许显式指定 RapidOCR，
并在空结果或有小字风险时回退。仅用结果非空或高置信度不能保证质量，本轮轻度模糊就是
反例；需要更广的真实扫描件、发票和多语言语料，以及实际文档链路验证后再决定默认值。

## 复现与原始记录

```sh
npm ci
npm run build:agent
npm run benchmark:ocr:macos
```

需要 macOS、Xcode Command Line Tools（`swiftc`）和已安装的 Playwright Chromium。
`OCR_BENCH_ROUNDS` 可设置热调用次数（至少 3 次）；默认 7 次。

- [完整结果、逐次计时、参考文本与识别原文](macos-ocr-benchmark.json)
- [比较脚本](../scripts/benchmark-macos-ocr.mjs)
- [Vision 实验适配](../scripts/macos-vision-ocr.swift)

运行不修改生产 OCR 后端，也不上传测试图片。本次样本为合成数据，结论限于所测机器、
配置与输入，不是“所有文档质量更好”的证据。
