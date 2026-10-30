# 重复文件与相似图片扫描

[English](agent-cli-similarity.md) · 简体中文

0.3.0 提供 Czkawka 风格的目录扫描：按组报告重复文件，以及缩放、转格式、重新压缩后的相似图片。使用 `capacity.operations` 检查当前安装是否提供 `similar`；npm 0.2.0 及更早版本不包含这项功能。所有哈希、图片解码和分组都在共享前端 WASM 核心中，CLI 负责目录发现和调用，不需要 OCR 或模型。

## 快速开始

在源码仓库构建轻量版即可使用，无需安装 OCR：

```sh
npm run build:agent:lite
./dist/agent-lite/filens capacity --json
./dist/agent-lite/filens similar-images ./photos --threshold 8 --json
```

以下示例使用 `filens`；源码构建可替换为 `./dist/agent-lite/filens`。安装版应先确认 `capacity.operations` 包含 `similar`，npm `0.2.0` 及更早版本不包含这项能力。

```sh
filens duplicates ./files --json
filens similar-images ./photos --threshold 8 --json
filens similar ./photos --similarity-mode images --format csv
filens '查找 "./photos" 中的相似图片，以 JSON 输出'
filens 'find duplicate files in "./files" as json'
```

结构化请求：

```json
{"operation":"similar","input":"./photos","similarityMode":"images","threshold":8,"format":"json","maxResults":100,"maxFiles":2000,"maxDepth":32}
```

`duplicates` 和 `similar-images` 是命令及 operation 别名，响应中的 operation 统一为 `similar`。`similarityMode` 为 `duplicates` 或 `images`，默认 `images`。这些命令只读取并报告，不执行删除、移动或替换。

| 参数 | 默认值 | 范围与用途 |
| --- | --- | --- |
| `--similarity-mode` | `images` | `images` 或 `duplicates`；两个别名命令直接选择对应模式。 |
| `--threshold` | `8` | `0–24`，仅适用于图片；越小越严格。 |
| `--max-results` | `100` | `1–1000`，返回的组数。 |
| `--max-files` | `2000` | `1–20000`，扫描的候选文件数。 |
| `--max-depth` | `32` | `1–256`，目录遍历深度。 |
| `--include-hidden` | 关闭 | 包含普通隐藏名称，固定排除的子目录仍跳过。 |
| `--timeout` | `2m` | 请求总时限，大目录可增大，例如 `10m`。 |
| `--format` | `text` | text、JSON、Markdown、HTML、YAML、XML、CSV、TSV；JSON 请求默认返回 JSON。 |

## 重复文件

不限扩展名，先按文件大小筛选，再比较前 4096 字节的 SHA-256，最后对候选读取完整文件并比较完整 SHA-256。同样大小、前缀相同的文件仍可能有不同正文，不会仅凭前缀判重。空文件也可组成重复组。Unix 上同一设备/inode 的硬链接仅保留一个路径，不计作额外副本；Windows 暂未排除硬链接别名。

重复扫描使用流式哈希，不受文档解析的单文件 256 MiB 限制；本轮总哈希读取预算为 16 GiB，超过会保留已有结果并标记不完整。读取时检查文件大小和修改时间；扫描不是整个目录的原子快照。结果不估算实际可回收磁盘空间。

## 相似图片

支持 JPEG、PNG、WebP、GIF、BMP、TIFF。应用 EXIF 方向，将透明像素合成到白色背景，缩放为 32×32 后计算低频 DCT 的 63 位感知哈希，用 BK-tree 查找候选。纯色图片额外比较平均颜色，减少不同纯色图片因相同哈希而误匹配。动画及多页图片只比较首帧。

`--threshold` 是汉明距离，默认 8，可设 0–24，越小越严格。距离不是“相似百分比”或可靠性概率；距离为 0 也不代表原文件或全部像素相同。每组有 `reference`，每个成员的 `distanceToReference` 都不超过阈值。按路径顺序形成互不重叠的参考图分组，不做传递扩张，也不枚举所有匹配图片对。

GIF 调色板转换会改变图像信息；测试样例在默认阈值 8 下有漏检，放宽至 12 后可匹配。可根据素材调整 `--threshold`，并检查新增匹配中的误报。

适合找同一张图的尺寸、压缩和格式变体。大幅裁剪、旋转、镜像、水印可能漏检；构图近似的不同图片也可能误匹配，需要人工核对。没有视觉模型，不提供“不同照片但语义上同类”的检索。单图上限 256 MiB、3200 万像素、单边 32768；比较预算 2000 万次，达到预算会标记不完整。

## 范围、输出与完整性

默认最多扫描 2000 个候选文件、深度 32、返回 100 组。`--max-files` 上限 20000，`--max-depth` 上限 256，`--max-results` 上限 1000。隐藏名称默认排除，`--include-hidden` 可包含普通隐藏名称；`.git`、`node_modules`、`target`、`dist` 子目录始终排除，显式作为扫描根目录时仍可扫描其中其他内容。不跟随符号链接。目录发现复用 macOS FTS 或 Windows/Linux 的 hdrw WASI。

支持 text、JSON、Markdown、HTML、YAML、XML、CSV、TSV。JSON 的 `similarity.groups[].files` 列出相对路径、字节数，重复文件附 SHA-256，相似图片附方向校正后的宽高、感知哈希及与参考图的距离。

| JSON 字段 | 含义 |
| --- | --- |
| `source.path` | 扫描根目录的绝对路径；组内文件路径相对此目录。 |
| `similarity.matchedGroups` / `matchedFiles` | 返回数量截断前已发现的匹配组数 / 文件数；预算或扫描错误仍可能使发现范围不完整。 |
| `similarity.returnedGroups` / `groups` | 实际返回的组数及分组结果。 |
| `groups[].reference` / `files[].distanceToReference` | 图片组参考图及每个成员与它的汉明距离；不表示组内任意两张图都在阈值内。 |
| `files[].sha256` / `files[].hash` | 重复文件的完整 SHA-256 / 图片的感知哈希，两者用途不同。 |
| `similarity.scan` | 目录发现的后端、访问数量、跳过、截断和错误。 |
| `similarity.processing` | 完整哈希 / 解码数量、计算预算、硬链接跳过数量和处理错误。 |

检查 `similarity.complete`、`truncated`、`scan` 与 `processing`。坏图、读取错误、目录遍历错误、数量或计算预算限制会保留可用组并返回退出码 3。无匹配组只代表当前扫描范围及算法下没有匹配。相似扫描目前每次重新计算，不使用正文搜索缓存。

`search` 用于按词项、原文或文件名找文档；`similar` 用于上述两类目录分组。相似扫描不接受 `--query`、`--layout` 或搜索缓存参数；正文相似的 PDF/DOCX 版本比较尚未实现。

## 验证

```sh
npm run build:agent:lite
npm run test:agent:similarity
```

测试通过实际 CLI 和 WASM 验证完整文件判重、同前缀不同正文、缩放/重新压缩图片、纯色与透明度、JPEG/EXIF、硬链接/符号链接、范围限制、坏图、中英文入口、JSON 请求及八种输出。这是一套核心扫描能力，不等同于 Czkawka 的全部清理、视频或音频功能。

2026-10-30 的 macOS arm64 本地构建，对比本轮开始时的现有构建，主程序增加 50272 字节，gzip WASM 资源增加 234173 字节，合计约 **278 KiB**。这是主程序加压缩 WASM 资源的差值，不包含 OCR、许可文本或 npm 打包开销，也不是 npm 压缩包下载体积的差值。[逐项体积记录](agent-cli-similarity-size.json)保留基线与验证范围；本地完整记录位于 `dist/agent-similarity/size-comparison.json`。
