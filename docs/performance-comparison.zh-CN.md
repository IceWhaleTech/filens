# 浏览器前端性能对比

2026-10-23 / 24 历史比较，2026-10-27 最终构建复核 · Apple M4 Pro · Chromium 147 · **累计 2,709 次比较测量，每项至少 7 次，X5 原片每项 21 次；其中 filens 1,106 / 1,106 次成功。** 另保留 28 次裁剪 CR3 诊断和 28 次全景探索测量，均不计入上述总数或当前排名。

PPTX、全景、无内嵌 JPEG 的 RAW、STEP、XLSX 和文档预览转换均有稳定领先项。对比表忽略 10 ms 以内的任务。以用户实际阅读预览为目标；不要求转换结果保留相同的可编辑内部结构。

| 实测任务 | filens | 对照 | 对手 / filens（95% 区间） | 判定 |
| --- | --- | --- | --- | --- |
| 11.1 MB / 13 页 PPTX 解析 | **28.5 ms** | pptx-preview 1.0.7: 56.6 ms | 1.99× (1.94–2.12) | **SOTA\*** |
| 11.1 MB / 13 页 PPTX 首屏 | **48.8 ms** | pptx-preview 1.0.7: 71.8 ms | 1.47× (1.41–1.51) | **SOTA\*** |
| 3840×1920 全景 JPEG 首屏 | **154.9 ms** | Photo Sphere Viewer 5.15.1: 205.2 ms | 1.32× (1.29–1.37) | **SOTA\*** |
| X5 INSP 首屏（输入、模块与 WASM 已就绪，10-27） | **354.5 ms** | Photo Sphere Viewer 5.15.1 双鱼眼: 383.0 ms | 1.08× (1.05–1.10) | **限定首屏 SOTA\*** |
| 无内嵌 JPEG 的 NEF → 预览画布 | **152.7 ms** | LibRaw 半尺寸：326.7 ms | 2.14× (2.10–2.17) | **SOTA\*** |
| 无内嵌 JPEG 的 DNG → 预览画布 | **167.7 ms** | LibRaw 快速半尺寸：314.4 ms | 1.87× (1.78–1.91) | **SOTA\*** |
| STEP 几何导入：cube | **46.5 ms** | occt-import-js: 67.6 ms | 1.45× (1.43–1.63) | **SOTA\*** |
| XLSX 数据读取（80,000 单元格） | **42.3 ms** | sheetjs: 109.6 ms | 2.59× (2.38–2.71) | **SOTA\*** |
| XLS → XLSX 预览转换（6 工作表） | **12.3 ms** | x2t: 49.1 ms | 4.00× (3.91–4.13) | **SOTA\*** |
| 20,000×8 数值 CSV → XLSX | **137.6 ms** | x2t: 198.8 ms | 1.44× (1.41–1.46) | **SOTA\*** |

<sub>\* SOTA 仅指本机、所测样例、表列对手及对应任务的稳定领先：配对 bootstrap 95% 区间下界大于 1。XLSX 数据读取不代表完整样式解析；XLS 转换按相同预览器中的显示结果比较。**全景使用 SwiftShader 软件渲染。** 不含下载与库冷加载；完整数据保留落后项和失败项。</sub>

**最终端到端结论（2026-10-27）：不能标为 SOTA。** 同一份 X5 原片加入本地 HTTP 取文件、JS 加载及 WASM 获取/编译后，filens 为 **426.8 ms**，PSV 为 **424.1 ms**；对手 / filens 为 **0.994×，95% 区间 0.938–1.019**，没有稳定领先。两个口径来自同一组 42 次运行，不重复计数；其余未复测条目保留 10-23 / 24 的限定结论。该本地口径仍不含页面壳导航、浏览器启动、远程 NAS 或 Photos 后端/数据库，不能代表全应用端到端。[最终判定与全部证据](../benchmarks/frontend/2026-10-27/end-to-end-sota-verdict.json)。

## X5 原片：解析厂商标定，接缝更自然

同一份 **11904×5952、18.36 MB 的 Insta360 X5 INSP 双鱼眼原片**，直接在浏览器中预览。filens 使用文件内的双镜头 RadtanPro 标定；[Photo Sphere Viewer 双鱼眼适配器](https://photo-sphere-viewer.js.org/guide/adapters/dual-fisheye.html)使用通用投影，不解析 X5 厂商标定。

| 实测能力 / 结果 | filens | Photo Sphere Viewer 5.15.1 + DualFisheyeAdapter |
| --- | --- | --- |
| 双鱼眼原片预览 | ✅ | ✅ 通用投影 |
| 内嵌 X5 畸变 / 标定解析 | ✅ 双镜头，各 13 个 RadtanPro 系数 | — |
| 本样例接缝观感 | **局部融合重影，画面连续性更好，瑕疵更轻** | **明显画面重复与硬接缝** |
| 输入、模块已就绪到首屏，含两帧等待 | **354.5 ms** | 383.0 ms |
| 对手 / filens，95% 区间 | **1.08×（1.05–1.10），限定首屏 SOTA\*** | — |
| 含本地取文件、模块及 WASM 初始化到首屏 | 426.8 ms | **424.1 ms** |
| 上述本地端到端的对手 / filens，95% 区间 | **0.994×（0.938–1.019），不满足 SOTA** | — |
| 静止画面 GL 绘制 | **0** | **0** |

<sub>各 21 次，共 42 次；全部成功。双方同为 1280×800、DPR 1、75° 垂直视场和 SwiftShader，受最大纹理限制均上传 8192×4096。计时含构造、filens 原生标定解析、JPEG 解码、纹理上传、一次接缝分析及两个动画帧；输入、JS 与 WASM 编译已准备好。filens 标定检查中位数 19.2 ms；对手没有同等解析步骤，不计算解析速度倍数。</sub>

<sub>四个水平方向及两侧接缝 ±50° 俯仰共八个视角检查中，PSV 在人物 / 衣物及前景手部附近重复场景内容，并有硬切；filens 在这些位置主要为局部融合重影，观感明显更好。拖动、缩放与窗口调整均正常。结论限于这份样例；速度 SOTA 不外推为通用拼接质量或厂商标定算法 SOTA。PSV 官方仅注明在 Ricoh Theta Z1 上测试；[该版本实现](https://github.com/mistic100/Photo-Sphere-Viewer/blob/5.15.1/packages/dual-fisheye-adapter/src/DualFisheyeAdapter.ts)使用固定 C = 0.946。</sub>

<sub>[10-27 最终构建 42 次记录](../benchmarks/frontend/2026-10-27/native-panorama-final.json.gz) · [已就绪首屏摘要](../benchmarks/frontend/2026-10-27/native-panorama-final-ready-summary.json) · [含初始化端到端摘要](../benchmarks/frontend/2026-10-27/native-panorama-final-e2e-summary.json) · [八视角检查与哈希](../benchmarks/frontend/2026-10-27/native-panorama-final-review.json) · [完整标定一致性](../benchmarks/frontend/2026-10-27/native-panorama-final-metadata-review.json)。双方 16 张稳定视角 PNG 均与此前已评审画面字节一致。原片及截图留在本地。</sub>

<sub>复用相邻稀疏范围后，检查原片的读取量由 15.80 MB 降到 **8.46 MB，减少 46.5%**；完整标定、首屏与八视角画面均与前版一致。HTTP 范围错位、总大小变化和截断内容均明确报错。</sub>

<sub>另修复全景／RAW 切换、取消后旧结果覆盖及资源清理。56 次新旧工程测量中，生成的 24 MiB 位图以字节数组加载由 41.8 降至 **38.0 ms**，完整字节与画布像素一致；其他输入未见稳定提速。不含后续纹理上传和绘制，未重测对手，不新增 SOTA。[检查与完整结果](../benchmarks/frontend/2026-10-24/panorama-lifecycle-review.json)。</sub>

## RAW：没有内嵌 JPEG，也能快速看到原片

移除相机样例的内嵌 JPEG 后，从传感器数据生成预览。五份完整样例均稳定领先 [LibRaw-Wasm 1.6.0](https://github.com/ybouane/LibRaw-Wasm) 的两种半尺寸配置，速度为较快对手的 **1.11–2.14×**。

| 输入 | filens（ms） | LibRaw 半尺寸（ms） | LibRaw 快速半尺寸（ms） | 较快对手 / filens（95% 区间） | 判定 |
| --- | ---: | ---: | ---: | --- | --- |
| Pentax K-r DNG | **167.7** | 320.6 | 314.4 | **1.87×** (1.78–1.91) | **SOTA\*** |
| Nikon D3S NEF | **152.7** | 326.7 | 328.2 | **2.14×** (2.10–2.17) | **SOTA\*** |
| Canon 40D sRAW CR2 | **132.0** | 148.1 | 146.6 | **1.11×** (1.06–1.15) | **SOTA\*** |
| Pentax K-r PEF | **187.6** | 289.2 | 288.6 | **1.54×** (1.52–1.58) | **SOTA\*** |
| Olympus Stylus ORF | **352.3** | 408.1 | 409.9 | **1.16×** (1.14–1.27) | **SOTA\*** |

<sub>计时到预览画布绘制完成，包含传感器解码、色彩处理、filens 的 JPEG 编解码或 LibRaw 的 RGB 传输，以及统一 1280×800 画布的缩放绘制。双方中间输出分辨率、裁切与色调不同；这是可读预览任务的比较。LibRaw 两组均用相机白平衡和半尺寸，快速组另关闭自动增亮、请求固定 sRGB 曲线并应用 DNG 曝光元数据。输入与库初始化在计时前完成，每组 7 次；全部 105 次有效运行成功，预览像素在重复运行间稳定。</sub>

<sub>颜色参照 Photos 的处理约定：相机白平衡、正确的相机到 sRGB 矩阵、高光裁剪、固定 sRGB 曲线和有符号 DNG BaselineExposure；无效标定明确报错。灰阶 / 曝光测试验证 18% 灰约为 118，−1 / +1 EV 约为 85 / 162。预览保留色调差异，不宣称还原相机图片风格。</sub>

<details>
<summary>画面对照、输出尺寸与显示等待</summary>

<sub>每行依次为 filens、LibRaw 半尺寸、LibRaw 快速半尺寸；五行对应上表。相同场景与方向可读，高光天空不再偏紫。移除的仅是标准 8 位显示 JPEG，保留高位深传感器压缩；解包后的传感器数据哈希一致，Canon sRAW 则核对完整处理 RGB。</sub>

![无内嵌 JPEG 的五份 RAW：filens 与两种 LibRaw 配置的实际预览](assets/performance/raw-sensor-preview.webp)

| 输入 | filens 中间尺寸 | LibRaw 半尺寸 / 快速组中间尺寸 | filens 加显示等待（ms） | LibRaw 半尺寸 / 快速组加显示等待（ms） |
| --- | --- | --- | ---: | --- |
| DNG | 1451×956 | 2154×1434 | 188.4 | 342.6 / 336.9 |
| NEF | 1419×944 | 2142×1422 | 173.1 | 346.0 / 345.7 |
| CR2 | 1944×1296 | 1944×1296 | 156.0 | 153.9 / 152.6 |
| PEF | 1436×956 | 2154×1434 | 206.4 | 309.6 / 307.3 |
| ORF | 1993×1496 | 1992×1496 | 380.6 | 426.0 / 428.4 |

<sub>显示等待另加两个动画帧，不作为上表显影 / 绘制的排名指标；CR2 在这项中没有领先。filens 普通预览上限仍为 2048 像素。样例 canon-r6.cr3 来自 Exiv2 的 Canon-R6-pruned.CR3 元数据夹具：移除 JPEG 后不含可用的完整场景，filens 与 LibRaw 半尺寸无图，LibRaw 完整解包输出黑图。因此其 28 次诊断保留但排除传感器排名，不据此判断完整 CR3 原片的支持情况。</sub>

</details>

## 文档预览转换：对比 ONLYOFFICE x2t WASM

对照 [x2t v9.3.2+3](https://github.com/cryptpad/onlyoffice-x2t-wasm/releases/tag/v9.3.2+3)。两边转换结果均交给同一套 filens 预览器；基础 XLS 的全部工作表显示单元格一致，较复杂 XLS 的主体预览接近；公式的存储方式不影响这项预览判定。

| 输入 | filens 转换（ms） | x2t 转换（ms） | x2t 初始化 + 转换（ms） | 预览结果 |
| --- | ---: | ---: | ---: | --- |
| legacy-project-workflow.doc | 23.6 | 43.2 | 74.1 | 正文可读，分页和间距有差异 |
| hyperlink.doc | 11.2 | 22.1 | 50.8 | 超链接文字完整显示 |
| table-merges.doc | 11.6 | 23.1 | 54.2 | 表格文字方向有差异 |
| Simple.xls | 10.2 | 27.7 | 58.7 | 预览单元格一致 · **SOTA\*** |
| SimpleWithFormula.xls | 10.3 | 29.8 | 59.4 | 预览单元格一致 · **SOTA\*** |
| SOLVSAMP.XLS | 12.3 | 49.1 | 80.6 | 主体预览接近，小数位与空白网格有细微差异 · **SOTA\*** |
| legacy-sample-show.ppt | 10.2 | 46.5 | 77.0 | 文字与布局有差异 |
| rich-text.rtf | 11.0 | 24.6 | 54.7 | 表格与分页有差异 |
| sample.odt | 10.5 | — | — | x2t 输出空 ZIP，校验失败 |
| convert-numeric.csv | 137.6 | 198.8 | 227.1 | 160,000 单元格完整且一致 · **SOTA\*** |
| convert-numeric-8000.csv | 64.8 | 96.6 | 128.2 | 64,000 单元格完整且一致 · **SOTA\*** |
| generated-notes.txt | 15.6 | 24.0 | 52.9 | 全文一致，默认字体与页宽不同 |

<sub>转换时间包含输入写入和输出读取。WASM 已编译，x2t 初始化单列；filens 的 WASI 实例创建已计入转换。未额外安装字体。DOC / PPT / RTF 保留实测速度，画面有明显差异的样例不标 SOTA；不因可编辑公式或段落结构不同而直接排除。XLS 预览允许末尾小数位和空白网格差异；签名按 12 位有效数字比较显示数值，同时校验全部非空单元格地址与文字。</sub>

| 文档转换实测时的 WASM 快照 | filens | x2t |
| --- | ---: | ---: |
| 原始字节 | **892,101** | 38,768,424 |
| Brotli 11 | **325,537** | 7,124,169 |

<sub>仅比较 WASM，按相同压缩参数重算；JS 适配层、预览器、字体与其他模块另计。filens 的转换核心 Brotli 体积约为 x2t 的 **1/21.9**，能力范围见[支持矩阵](support-matrix.zh-CN.md)。20,000 行 CSV 已完整转换；超出 1,000,000 个单元格或每行 16,384 列时明确报错，不再静默截断。ODT 是最小测试夹具，其失败不代表 x2t 的通用 ODT 支持情况。</sub>

<sub>另做 84 次新旧实现工程对照：优化 WASI 输出缓冲后，4／16 图 DOCM → DOCX 由 122.5／687.4 ms 降至 **98.2／363.9 ms**，完整输出字节一致，图片均可解码。生成文档，不含预览绘制；RTF 无稳定提速。此次未重测 x2t，不新增 SOTA。[实测与检查](../benchmarks/frontend/2026-10-24/converter-io-review.json)。</sub>

<details>
<summary>查看实际预览对照</summary>

<sub>左 filens，右 x2t；两边使用相同预览器、1280×900、DPR 1。文字、布尔值和 DOC 域结果均通过实际预览检查。以下展示基础公式 XLS 与较复杂 XLS 的首个工作表，全部工作表的检查记录见原始证据。</sub>

![基础公式 XLS：两边的单元格显示一致](assets/performance/xls-formula-preview.webp)

![SOLVSAMP XLS：主体内容相近，小数显示略有差异](assets/performance/xls-solver-preview.webp)

</details>

## STEP：更小的几何预览核心

与 Online 3D Viewer 使用的 [occt-import-js 0.0.23](https://github.com/kovacsv/occt-import-js) 对照，六份文件的几何导入均稳定领先。

| 文件 | 三角形 | filens（ms） | 上游（ms） | 上游 / filens |
| --- | ---: | ---: | ---: | ---: |
| cube.stp | 12 | 46.5 | 67.6 | 1.45× |
| rounded-cube.step | 84 | 52.2 | 79.2 | 1.52× |
| as1_pe_203.stp | 3,848 | 147.7 | 180.5 | 1.22× |
| as1-oc-214.stp | 5,040 | 266.7 | 289.5 | 1.09× |
| dm1-oc-214.stp | 1,904 | 171.9 | 196.8 | 1.15× |
| tailturbine.stp | 3,622 | 148.9 | 175.1 | 1.18× |

<sub>世界坐标三角形与法线签名一致；另外通过 55 份真实文件、165 次导入的数值回归。filens 面向几何预览，省去原始颜色、名称和装配树。WASM Brotli 从上游的 2,315,009 降到 **816,177 字节，减少 64.7%**；这不是完整 CAD 元数据导入的排名。</sub>

## 其他类别与落后项

| 任务 | filens（ms） | 更快的对照（ms） |
| --- | ---: | --- |
| DXF：20,000 条线 | 23.4 | dxf-parser: 21.7 |
| CSV：20,000×8 数值字段 | 11.1 | papaparse: 8.9 |
| ZIP：1,000 个小文件，解包全部（10-27） | 11.8 | fflate: 5.0 |

<sub>CSV 同时测 PapaParse 5.7.0 和 SheetJS CE 0.20.3；ZIP 同时测 fflate 0.8.2 和 zip.js 2.24.0，按更快的对手呈现。DXF 对照 dxf-parser 1.1.2。不能仅因胜过其中一个较慢实现就标 SOTA。PDF、DOCX 和多数 3D 加载器复用现有引擎，不额外宣称独立算法领先。</sub>

<sub>CSV 新旧实现同场复测：5.47 MB 长备注文本由 70.0 ms 降至 **5.5 ms**，数值表由 13.0 ms 降至 **11.2 ms**；完整模型与旧版一致。另修复末尾空引号记录漏行；数值表仍落后于 PapaParse，不新增 SOTA 标注。[测量与内容检查](../benchmarks/frontend/2026-10-24/csv-review.json)。</sub>

<sub>DXF 新旧实现同场复测：2 万条线由 32.0 ms 降至 **23.5 ms，耗时减少约 27%**；五份输入的完整模型、SVG 和首屏画面一致。另修复大块、嵌套块和尺寸块展开时的参数数量上限错误，13 万图元用例完整通过。真实混合图纸暂无稳定提速，且与对手的块展开阶段不同，不标 SOTA。[实测摘要](../benchmarks/frontend/2026-10-24/dxf-summary.json) · [内容与回归检查](../benchmarks/frontend/2026-10-24/dxf-review.json)。</sub>

<sub>ZIP 新旧实现同场复测：1,000 文件完整读取由 11.8 ms 降至 **10.2 ms，耗时减少约 13%**，完整元数据、内容与资源解析结果一致。另补齐 TAR/TGZ 的 PAX / GNU 长路径读取；fflate 仍更快，不新增 SOTA 标注。[实测与回归检查](../benchmarks/frontend/2026-10-24/archive-index-review.json)。</sub>

<sub>压缩包预览同场复测：1 万文件的 ZIP 索引与首屏列表构建由 64.6 降至 **40.3 ms，耗时减少约 38%**，完整内容、元数据、列表与首屏截图一致；不含绘制耗时。10 万文件无稳定提速，10 ms 内对照不计提速；这是项目内优化，不新增 SOTA。[实测与检查](../benchmarks/frontend/2026-10-24/archive-lifecycle-review.json)。</sub>

<sub>2026-10-27 目录导航优化：10 万文件 / 1,000 个目录的生成 ZIP，依次首次打开 50 个不同目录由 312.1 降至 **24.5 ms（12.74×）**，包含延迟创建子项索引及完整 DOM 构建，不含布局与绘制；完整列表、元数据和文件内容一致。初始加载与已缓存导航无稳定收益。另有 WASM 元数据局部解析优化，均为项目内工程对照，尚不足以新增 SOTA。[测量边界、原始数据与 SOTA 评估](../benchmarks/frontend/2026-10-27/bbtree-followup-review.json)。</sub>

<sub>ZIP 浏览补测（42 次项目内对照）：10 万文件中，50 个新目录经真实 DOM 点击处理的同步耗时为 **350.5 → 90.7 ms**；加入生产 CSS、布局和每次两帧显示等待后为 **1,653.6 → 1,652.8 ms**，无稳定改善。本地输入/模块加载到首屏为 **309.4 → 309.4 ms**，已缓存目录两版均为 33.3 ms；目录 CPU 优化有效，尚不能标为浏览端到端 SOTA。与此前直接连续调用路由的 12.74× 计时边界不同。[浏览指标、原始数据与完整检查](../benchmarks/frontend/2026-10-27/archive-browser.md)。</sub>

<sub>PDF 改为按可见区域渲染：百页同尺寸样例结束加载由约 1.75 秒降至 **104 ms**，初始画布由 100 张降至 **2 张，画布像素减少 98%**。203 页逐页像素与前版一致；首次可见时间无稳定变化，不标 SOTA。页码跳转、缩放与取消加载已补齐。[测量与检查](../benchmarks/frontend/2026-10-24/pdf-preview-review.json)。</sub>

<sub>电子书完整提取同场复测：200 / 1,000 页 CBZ 由 34.9 / 142.6 ms 降至 **25.1 / 93.6 ms**，耗时减少约 28% / 34%；40 章 EPUB 由 19.3 降至 **16.4 ms**。完整章节与图片字节签名一致，并修复重复加载仍显示旧章节及取消后的资源泄漏。页数样例为生成内容，未计入图片解码和绘制；不是同类项目排名，不标 SOTA。[测量与检查](../benchmarks/frontend/2026-10-24/ebook-review.json)。</sub>

<sub>含 200 / 1,000 项资源的 EPUB 完整提取由 30.3 / 132.1 ms 降至 **22.5 / 88.2 ms**，耗时减少约 26% / 33%；另修复 CSS 导入、字体、背景图与 SVG 引用。生成样例，未计入解码和显示；纯文字对照为 14.7 → 15.4 ms，无稳定提速，不新增 SOTA。[实测与检查](../benchmarks/frontend/2026-10-24/epub-resources-review.json)。</sub>

<sub>原生文本预览复测：10 万行代码加载加布局由 391.0 降至 **229.8 ms，耗时减少约 41%**；20 万行由 7 次全部失败变为全部打开，完整内容与行号保留。另修复切换、取消与行号错位。生成样例，不含绘制，不新增 SOTA。[实测与检查](../benchmarks/frontend/2026-10-24/text-preview-review.json)。</sub>

<sub>原生音频初始化复测：生成的 64 MiB WAV 字节数组由 17.5 降至 **8.7 ms**，切片输入由 15.3 降至 **5.6 ms**；完整字节与浏览器读取的时长一致。不含就绪播放与绘制；低于 10 ms 的对照不作提速宣传，不新增 SOTA。[实测与切换检查](../benchmarks/frontend/2026-10-24/native-lifecycle-review.json)。</sub>

<sub>DOCX 复用图片资源后，400 次重复图片引用的加载至 DOM / 资源任务完成由 208.6 降至 **25.1 ms（8.31×）**；三页真实文档由 21.2 降至 **18.4 ms**。完整 DOM、图片字节与首尾画面一致。重复图片为生成样例，不含图片解码就绪与绘制，不新增 SOTA。[实测与检查](../benchmarks/frontend/2026-10-24/docx-preview-review.json)。</sub>

<sub>20 万 / 50 万三角面的生成二进制 STL，解析由 15.6 / 34.1 ms 降至 **5.1 / 11.0 ms，约快 3.1×**，完整顶点、法线与边界一致。仅计解析，不含场景构建和绘制，不新增 SOTA；另修复模型切换、取消与资源清理。[实测与检查](../benchmarks/frontend/2026-10-24/model3d-review.json)。</sub>

<sub>7.2 / 21.6 MB 生成 glTF 的伴随文件处理与模型加载由 264.2 / 910.1 ms 降至 **11.0 / 15.8 ms，快 24.0× / 57.6×**；完整几何、材质与纹理渲染结果一致。不含 GPU 绘制，10 ms 内控制样本不计提速；同项目新旧实现对照，不新增 SOTA。[实测与检查](../benchmarks/frontend/2026-10-24/model3d-resources-review.json)。</sub>

<sub>2 / 16 MiB NHDR 体数据准备由 104.4 / 1042.5 ms 降至 **0.8 / 3.4 ms**，完整数据一致；另修复 gzip / 文本编码、头信息和字节序造成的错误显示。只计资源读取与封装，不含解码、点云构建和绘制，不新增 SOTA。[实测与检查](../benchmarks/frontend/2026-10-24/volume-preview-review.json)。</sub>

<sub>3.59 / 14.35 MB 生成贴图的 OBJ 加载至解码就绪由 122.2 / 476.5 ms 降至 **10.8 / 37.4 ms**，完整几何、材质与解码后像素一致；新旧版本均显式等待图片解码。不含输入传输与 GPU 绘制，10 ms 内对照不计提速；同项目对照，不新增 SOTA。[实测与检查](../benchmarks/frontend/2026-10-24/obj-resources-review.json)。</sub>

<sub>LDraw 分离曲面压力样本的 2,000 / 10,000 个三角面完整加载由 289.0 / 8909.4 ms 降至 **9.3 / 29.1 ms**，包含依赖准备、模型构建与法线平滑。完整属性和材质一致，曲面、硬边与多色渲染逐像素一致。七轮交替测量，旧实现包含三次本地 404 查找；不含 GPU 绘制，10 ms 内控制样本不计提速。这是针对法线平滑平方级遍历的同项目优化，不新增 SOTA。[实测与检查](../benchmarks/frontend/2026-10-24/ldraw-resources-review.json)。</sub>

<sub>含 32 张未使用 PNG 的 114.9 MB 生成 KMZ，选中模型加载由 25.1 ms 降至 **5.0 ms，快 5.02×**。七轮交替测量包含压缩包处理、模型构建和显式图片解码，完整几何、材质与解码后像素一致。这是小模型跳过未使用资源的同项目对照，不含输入传输与 GPU 绘制，10 ms 内控制样本不计提速；不新增 SOTA。[实测与检查](../benchmarks/frontend/2026-10-24/kmz-resources-review.json)。</sub>

<sub>10 万线、16 图层的生成 DXF，隐藏 / 恢复单层由 29.4 / 21.3 ms 降至 **5.1 / 1.6 ms**，完整模型、SVG 状态及首屏画面一致。仅计同步可见性更新，不含布局和绘制，不新增 SOTA；另修复二进制配图显示、文件切换与资源清理。[实测与检查](../benchmarks/frontend/2026-10-24/cad-resources-review.json)。</sub>

<sub>工作表渲染阶段复测：20 万行模型首批 100 行 DOM 构建由 12.0 降至 **2.0 ms**，稀疏模型由 12.3 降至 **2.1 ms**；表格 HTML 与前版一致。仅测已准备好的模型，不含文件解析、布局与绘制，不标 SOTA。另修复取消、切换文件与销毁后旧结果覆盖的问题。[测量与检查](../benchmarks/frontend/2026-10-24/workbook-rows-review.json)。</sub>

<sub>FreeMind 无 ID 宽树复测：3,000 节点解析由 777.3 降至 **4.0 ms**；加载至 SVG 构建完成由 788.7 降至 **17.3 ms（45.6×）**，完整模型与 SVG 一致。生成样例，不含布局与绘制；带 ID 文件无稳定提速，不新增 SOTA 标注。另修复四种思维导图格式的切换与取消问题。[测量与检查](../benchmarks/frontend/2026-10-24/mindmap-review.json)。</sub>

<sub>流程图解析复测：生成的 3,000 形状 VSDX 由 141.5 降至 **79.8 ms**，加载至 SVG 构建完成由 154.5 降至 **86.7 ms**；带 HTML 标签的 3,000 节点 draw.io 解析由 21.7 降至 **12.8 ms**。完整模型与 SVG 一致，不含布局与绘制；真实小文件均在 10 ms 内，不作提速宣传。另补齐旧 VDX 几何、Visio 连接线和 draw.io 缺省尺寸，不新增 SOTA 标注。[测量与检查](../benchmarks/frontend/2026-10-24/diagram-review.json)。</sub>

<details>
<summary>XLSX：大工作簿</summary>

| 输入 | 非空单元格 | filens（ms） | SheetJS CE 0.20.3（ms） | 判定 |
| --- | ---: | ---: | ---: | --- |
| generated-80000-cells.xlsx | 80,000 | 42.3 | 109.6 | **SOTA\*** |

<sub>对齐工作表、单元格地址、缓存值及公式字段；未评分样式、图表和完整工作簿功能。小文件的毫秒级优势不外推到大工作簿。</sub>

</details>

<details>
<summary>PPTX：完整解析与首屏结果</summary>

| 文件 | MB | filens 解析 | PPTist 解析器 | pptx-preview 解析 | filens 首屏 | pptx-preview 单页 | vue-office 首屏 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| vue-office-test.pptx | 11.12 | 28.5 | 70.3 | 56.6 | 48.8 | 71.8 | 108.8 |
| filens-field-notes.pptx | 0.66 | 11.5 | 23.5 | 失败 | 45.1 | 失败 | 失败 |
| rich-pptx-shapes.pptx | 0.13 | 10.9 | 23.2 | 12.7 | 48.7 | 42.3 | 50.8 |
| rich-pptx-pictures.pptx | 0.09 | — | 11.1 | — | 27.5 | 30.9 | 39.4 |
| sample-deck.pptx | 0.07 | 10.4 | 失败 | 失败 | 37.3 | 失败 | 失败 |
| poi-SampleShow.pptx | 0.04 | — | 14.1 | 13.4 | 28.7 | 18.2 | 19.7 |
| poi-pie-chart.pptx | 0.06 | — | 11.8 | 13.4 | 25.4 | 40.5 | 40.1 |
| poi-2411-Performance_Up.pptx | 0.65 | 24.5 | 失败 | 33.6 | 61.5 | 52.2 | 97.0 |

<sub>单位 ms，10 ms 以内的解析值省略。filens 只挂载可见页面，低缩放时仍完整挂载全部可见页；pptx-preview 为单页，vue-office 为默认整份 DOM。小文件尚未全面领先，小图片首屏的独立复测优势不稳定，不标 SOTA；pie-chart 两个对照均未显示饼图，Performance_Up 对照首屏显示不同页；这些速度仅供参考。失败不计为 0。vue-office 的 [PPTX 核心未开源](https://github.com/501351981/pptx-preview#关于授权)。</sub>

<sub>快速切换文件时，已取消的 PPTX 不再继续解包和解析；11.1 MB 样例在文件读取结束后的无效等待由 29.8 ms 降至 **0.5 ms**。另修复字体动态加载后再次渲染仍沿用旧字重的问题。224 次新旧同场工程测量中，8 份完整模型和首屏画面一致，正常首屏无稳定变化；不新增 SOTA 标注。[检查与复现](../benchmarks/frontend/2026-10-24/pptx-cancel-review.json)。</sub>

![11.1 MB PPTX 首屏，依次为 filens、pptx-preview、vue-office](assets/performance/pptx-first-preview.webp)

</details>

<details>
<summary>iWork、全景与优化前后</summary>

| 输入 | 任务 | filens（ms） | 对照（ms） |
| --- | --- | --- | --- |
| a.numbers | 原生画布首屏 | 83.7 | — |
| a.numbers | 完整模型 / 数据提取 | 35.4 | SheetJS CE 0.20.3: 26.0 |
| a.pages | 原生画布首屏 | 66.3 | — |
| filens-weekend.key | 原生画布首屏 | 61.3 | — |
| insta360-oners-tallinn.jpg | 全景 JPEG 首屏 | 273.2 | Photo Sphere Viewer: 363.3 |
| osmo-360-leipzig.jpg | 全景 JPEG 首屏 | 154.9 | Photo Sphere Viewer: 205.2 |

<sub>Numbers 的 filens 模型含 6 张工作表、14 个表格及画布、样式；SheetJS 提取为 14 个工作簿条目，数据提取仍更快。已修复行分块顺序和稀疏尾列漏读；全部 5,772 个非空单元格地址及字符串值与 SheetJS 一致，数字按原文档格式显示。Pages / Keynote 尚无纳入实测的同等原生画布对照。X5 原片已与 PSV 通用双鱼眼预览实测；厂商标定解析、多轨同步仍无同等前端实测对手，普通全景 JPEG 的速度不用于推断原片拼接排名。</sub>

<sub>稀疏 Numbers 构造案例（1024×1024 网格、2,048 个非空单元格）的表格模型构建由 183.9 ms 降至 **11.1 ms，快 16.57×**，完整结果一致；另修复稀疏表头漏读导致日期显示为数字的问题。这是已有归档到模型的工程测量，不代表完整文件解析或对手排名；真实 Numbers 完整解析暂无稳定变化。[测量与内容检查](../benchmarks/frontend/2026-10-24/numbers-sparse-review.json) · [统计摘要](../benchmarks/frontend/2026-10-24/numbers-sparse-ab-summary.json)。</sub>

<sub>另做 84 次原生 iWork 工程对照：独立 ZIP 入口修复开发模式下 Worker 无法打开文件的问题，并减少启动负担；Numbers / Pages / Keynote 从输入就绪到预览 DOM 完成（含 Worker 启动）由 150.6 / 121.4 / 109.7 ms 降至 **133.1 / 107.6 / 96.8 ms**，完整模型、DOM 与图片资源一致。取消后等待由约 132 / 110 / 98 ms 降至约 **0.2 ms**；这是终止过期任务，不是解析倍速。不含源文件与主模块下载及后续绘制，不新增 SOTA 标注。[记录与复现](../benchmarks/frontend/2026-10-24/iwork-lifecycle-review.json)。</sub>

| 任务 | 优化前（ms） | 优化后（ms） | 前 / 后 |
| --- | --- | --- | --- |
| 11.1 MB PPTX 解析 | 45.3 | 28.5 | 1.59× |
| 11.1 MB PPTX 首屏 | 69.3 | 48.8 | 1.42× |
| Numbers 完整模型 | 125.5 | 35.4 | 3.54× |
| Numbers 原生首屏 | 187.3 | 83.7 | 2.24× |
| SampleShow PPTX 首屏 | 30.7 | 28.7 | 1.07× |
| shapes PPTX 首屏 | 62.5 | 48.7 | 1.28× |
| sample-deck PPTX 首屏 | 52.0 | 37.3 | 1.40× |
| 6528×3264 全景首屏 | 568.4 | 273.2 | 2.08× |
| 3840×1920 全景首屏 | 276.1 | 154.9 | 1.78× |
| DXF：20,000 条线解析 | 39.2 | 23.4 | 1.68× |
| XLSX：80,000 单元格读取 | 145.6 | 42.3 | 3.44× |
| ZIP：1,000 个小文件解压 | 54.8 | 10.4 | 5.28× |
| CSV：20,000×8 数据读取 | 18.2 | 11.1 | 1.64× |

<sub>历史基线未完全隔离机器负载，前后倍数只作工程参考。两秒静止窗口中，filens 与 Photo Sphere Viewer 都是 0 次 GL 绘制；filens 优化前约 99–101 次。优化覆盖 PPTX 解包 / XML / 滚动、iWork 查找缓存、全景按需绘制与 RAW 快速预览 / 显影；格式处理继续集中于前端 TS / WASM。</sub>

</details>

## 数据与复现

2026-10-27 最终构建追加 **105 次同行测量 / 42 次 filens 成功运行**：X5 原片 42 次，三份 ZIP 各 7 轮 × 三个实现共 63 次。[端到端最终判定](../benchmarks/frontend/2026-10-27/end-to-end-sota-verdict.json) · [ZIP 完整提取摘要](../benchmarks/frontend/2026-10-27/zip-final-summary.json) · [ZIP 原始记录](../benchmarks/frontend/2026-10-27/zip-final.json.gz)。1,000 小文件的 fflate 仍更快；16 MiB 单文件生成 ZIP 的 filens 为 8.6 ms，低于本文 10 ms 标注门槛，不新增 SOTA，也不代表目录导航或预览首屏。

此前 X5 原片的 42 次比较仍保留并计入累计总数：[原始记录](../benchmarks/frontend/2026-10-24/native-panorama.json.gz) · [摘要](../benchmarks/frontend/2026-10-24/native-panorama-summary.json)。当前 X5 首屏限定排名使用 10-27 最终构建的 42 次结果；包含初始化的端到端口径不满足 SOTA。

[首次 525 次实测摘要](../benchmarks/frontend/2026-10-23/summary.json) · [原始记录](../benchmarks/frontend/2026-10-23/final.json.gz) · [新增 497 次实测摘要](../benchmarks/frontend/2026-10-23/other-formats-optimized-summary.json) · [原始记录](../benchmarks/frontend/2026-10-23/other-formats-optimized.json.gz) · [预览检查](../benchmarks/frontend/2026-10-23/preview-review-optimized.json) · [依赖锁与复现](../benchmarks/frontend/README.md)。

无内嵌 JPEG 的 RAW：[105 次有效比较与 28 次诊断摘要](../benchmarks/frontend/2026-10-24/raw-sensor-summary.json) · [完整原始记录](../benchmarks/frontend/2026-10-24/raw-sensor.json.gz) · [绑定数据哈希的画面检查](../benchmarks/frontend/2026-10-24/raw-sensor-review.json)。

追加 42 次 X5 原片比较：[原始记录](../benchmarks/frontend/2026-10-24/native-panorama-range-cache.json.gz) · [统计摘要](../benchmarks/frontend/2026-10-24/native-panorama-range-cache-summary.json) · [画面与交互检查](../benchmarks/frontend/2026-10-24/native-panorama-range-cache-review.json)。此前两组各 14 次探索记录保留，排除当前排名与累计总数：[首次](../benchmarks/frontend/2026-10-24/native-panorama-initial.json.gz) · [稀疏解析优化前](../benchmarks/frontend/2026-10-24/native-panorama-before-sparse.json.gz)。

此前 371 次复测：[PPTX 首屏](../benchmarks/frontend/2026-10-24/pptx-preview-optimized-summary.json) · [PPTX 解析](../benchmarks/frontend/2026-10-24/pptx-model-optimized-summary.json) · [Numbers](../benchmarks/frontend/2026-10-24/numbers-optimized-summary.json) · [iWork 首屏](../benchmarks/frontend/2026-10-24/iwork-preview-optimized-summary.json) · [内容与交互校验](../benchmarks/frontend/2026-10-24/frontend-optimized-review.json)。

追加 35 次 iWork 复测：[Numbers 完整模型](../benchmarks/frontend/2026-10-24/numbers-refined-summary.json) · [iWork 首屏](../benchmarks/frontend/2026-10-24/iwork-preview-refined-summary.json) · [完整模型、画面与切表校验](../benchmarks/frontend/2026-10-24/iwork-refined-review.json)。<sub>完整 Numbers 样式模型及三种 iWork 首屏像素与前版一致；Pages 本次耗时略高，未计作优化收益。</sub>

追加 392 次复测：[PPTX 解析](../benchmarks/frontend/2026-10-24/pptx-model-fastxml-summary.json) · [PPTX 首屏](../benchmarks/frontend/2026-10-24/pptx-preview-fastxml-summary.json) · [Numbers](../benchmarks/frontend/2026-10-24/numbers-buffered-summary.json) · [iWork 首屏](../benchmarks/frontend/2026-10-24/iwork-preview-buffered-summary.json) · [独立复测与完整内容检查](../benchmarks/frontend/2026-10-24/frontend-fastxml-review.json)。

<sub>8 份 PPTX 完整模型、Numbers 全部单元格及 11 张首屏画面与前版一致。另做 28 次新旧实现同场工程复测：Numbers 完整模型耗时降低约 5%，原生首屏没有稳定收益；本次 iWork 首屏耗时较前组更高，保留实测值。</sub>

追加 35 次 iWork 复测：[Numbers 完整模型](../benchmarks/frontend/2026-10-24/numbers-indexed-summary.json) · [iWork 首屏](../benchmarks/frontend/2026-10-24/iwork-preview-indexed-summary.json) · [完整内容与同场对照](../benchmarks/frontend/2026-10-24/iwork-indexed-review.json)。

<sub>六份 iWork 完整归档与模型、三张首屏画面均与前版一致。另做 56 次新旧实现同场测量：Numbers 完整模型耗时降低约 14%，原生首屏收益尚不稳定；不新增 SOTA 标注。</sub>

追加 21 次原生首屏复测：[iWork 首屏](../benchmarks/frontend/2026-10-24/iwork-preview-resize-summary.json) · [同场对照](../benchmarks/frontend/2026-10-24/iwork-preview-resize-ab-summary.json) · [画面、内容与窗口缩放检查](../benchmarks/frontend/2026-10-24/iwork-resize-review.json)。

<sub>42 次新旧实现同场测量中，Numbers 首屏耗时降低约 20%；Pages / Keynote 没有稳定收益。三张首屏画面、全部工作表和归档内容一致。窗口缩放保留已加载行与当前页；尚无同等原生前端对手，不新增 SOTA 标注。</sub>

追加 7 次 Numbers 首屏复测：[首屏结果](../benchmarks/frontend/2026-10-24/numbers-preview-visibility-summary.json) · [同场对照](../benchmarks/frontend/2026-10-24/numbers-preview-visibility-ab-summary.json) · [完整内容与逐表滚动检查](../benchmarks/frontend/2026-10-24/numbers-visibility-review.json)。

<sub>首屏中位数 83.7 ms；14 次新旧同场测量确认耗时降低约 12%，首屏像素一致，全部 14 个表格滚动可读。完整解析与 SOTA 判定不变。</sub>

追加 336 次 PPTX 复测：[完整解析](../benchmarks/frontend/2026-10-24/pptx-model-lazy-summary.json) · [首屏](../benchmarks/frontend/2026-10-24/pptx-preview-lazy-summary.json) · [同场对照与完整内容检查](../benchmarks/frontend/2026-10-24/pptx-lazy-review.json)。

<sub>11.1 MB PPTX 的完整解析和首屏同场耗时分别降低约 16% / 11%；8 份完整模型和首屏画面一致。小文件首屏收益不稳定，本轮较慢的结果和对照失败均保留。</sub>

<sub>Apple M4 Pro / 24 GiB / macOS arm64；Chromium 147.0.7727.15，1280×800、DPR 1，无 CPU 降速。每次用新 context，共享浏览器进程，轮换对手顺序；库、字节和 WASM 编译在计时前完成。首屏等待内容解码、字体和两个动画帧；全景双方均计入构造。95% 区间使用 10,000 次配对重采样、固定种子 12345。记录的主线程 JS 堆不含 WASM、Worker 和 GPU 内存。[优化前快照](../benchmarks/frontend/2026-10-23/baseline.json.gz) · [修正后的全景基线](../benchmarks/frontend/2026-10-23/panorama-baseline.json.gz)。</sub>

<sub>HTTP 上传准备的同场工程对照：8 MiB Base64 输入 262.1 → 19.4 ms（13.51×），完整上传字节一致。70 次测量中，其余输入基线均低于 10 ms，不计提速。计时不含网络、服务端转换或渲染，不新增 SOTA。[结果](../benchmarks/frontend/2026-10-24/converter-source-summary.json) · [检查记录](../benchmarks/frontend/2026-10-24/converter-source-review.json)。</sub>
