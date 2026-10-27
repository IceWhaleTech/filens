# 最终端到端 SOTA 复核

**2026-10-27 的最终构建复测，不支持“最终端到端性能是 SOTA”的标记。** X5 原片在输入和模块已就绪的首屏任务中保持限定领先；加入本地取文件和初始化后，没有稳定领先。Photos 的微基准收益也不能外推为完整应用 SOTA。

| 同一份 X5 原片 / 同一组 42 次运行 | filens | PSV 5.15.1 双鱼眼 | 对手 / filens，95% 区间 | 判定 |
| --- | ---: | ---: | --- | --- |
| `readyMs`：文件、JS、WASM 已准备好到首屏 | 354.5 ms | 383.0 ms | 1.080×，1.048–1.104 | 本样例、机器、已测对手的限定首屏领先 |
| `localEndToEndMs`：本地取文件、初始化到首屏 | 426.8 ms | 424.1 ms | 0.994×，0.938–1.019 | 区间跨 1，不满足 SOTA |

两个指标来自同一组运行，只计 42 次。未根据结果追加重复次数或挑选子集。局部解析和目录导航的工程收益见 [bbtree-followup-review.json](bbtree-followup-review.json)，不计入端到端判定。

## 口径与检查

- Apple M4 Pro / macOS arm64，Chromium 147.0.7727.15，SwiftShader，1280×800，DPR 1，75° 垂直视场。双方上传 8192×4096 纹理。
- 11904×5952、18,362,602 字节的同一份 X5 INSP，SHA-256 `6676287954780dd95bb1f23db0ca9c19fe21faef22102a12454d3451a23b30c2`。
- 每个实现事先确定 21 次；每次新 context，共享浏览器，轮换实现顺序。先完成最终构建，计时期间未运行本次构建、测试或其他基准；系统后台任务未禁用。
- `readyMs` 包含查看器构造、filens 内嵌标定检查、JPEG 解码、纹理上传、接缝计算和两个动画帧。
- `localEndToEndMs` 从浏览器读取本地 HTTP 原片前开始，再计入 File 创建、动态 JS 加载、filens WASM 获取/编译、一次中间 Playwright 调度，以及完整 `readyMs` 阶段。HTML/CSS 页面壳导航、浏览器启动、远程网络/NAS、Photos 后端及数据库均不在此口径内；新 context 不代表冷浏览器进程或冷磁盘。
- 42/42 成功。全部 filens 输出仍是两镜头各 13 参数的嵌入 X5 RadtanPro 标定；完整 manifest 与优化前一致，读取量均为 8,458,240 字节。
- 双方 16 张稳定视角 PNG 全部匹配 10-24 已评审画面的 SHA-256，filens 21 张首屏 PNG 一致。双方静止零 GL 绘制，拖动、缩放和 768×900 窗口调整检查通过。PSV 使用通用双鱼眼映射，因此只比较可读预览，不比较同等标定算法或通用拼接质量。
- 配对中位数比 bootstrap：10,000 次重采样，种子 12345，百分位 95% 区间。初始化阶段中位数 filens 40.9 ms、PSV 11.7 ms；较大的初始化开销解释了为何不能沿用预加载首屏领先结论。不同阶段中位数不直接相加。

## 其他链路

[ZIP 浏览专项复核](archive-browser.md)另测 42 次项目内对照：10 万文件中 50 个新目录的同步点击处理为 350.5 → 90.7 ms，但计入逐次布局和两帧显示后为 1,653.6 → 1,652.8 ms，无稳定整体浏览收益。本地加载到首屏均为 309.4 ms；没有外部浏览器对照，不能标为 ZIP 浏览 SOTA。这些工程测量不计入同行比较总数。

最终构建还用三份 ZIP、三个实现各 7 次做了 63 次完整提取比较，完整内容签名均相同。1,000 小文件时 filens **11.775 ms**、fflate **4.950 ms**，没有归档整体 SOTA。生成的 16 MiB 单条目 ZIP，filens 阶段耗时为 8.63 ms，低于报告的 10 ms 标注门槛；局部内核领先不作为端到端标记。这些计时不包含归档 UI、绘制和库初始化。

Photos 目前只有元数据阶段的前后对照，没有同等完整应用链路的外部对照；本次没有运行 Photos 全应用端到端测量。不能将 4.25× 单帧解析、1.84× TIFF 物化或 12.74× filens 子目录导航写成 Photos/filens 全应用提速或 SOTA。

本轮新增 105 次同行比较，其中 filens 42/42 成功。历史累计 2,604 次加本轮为 2,709 次；成功 filens 累计为 1,106 次。其他类别保留其历史、限定任务的结论，本轮未确认其最终端到端排名。

## 证据与复现

[最终机器可读判定](end-to-end-sota-verdict.json) · [42 次原始记录](native-panorama-final.json.gz) · [预加载首屏摘要](native-panorama-final-ready-summary.json) · [含初始化端到端摘要](native-panorama-final-e2e-summary.json) · [画面与交互检查](native-panorama-final-review.json) · [完整 manifest 对照](native-panorama-final-metadata-review.json) · [ZIP 原始记录](zip-final.json.gz) · [ZIP 摘要](zip-final-summary.json)。原片和截图保留在本地，不提交仓库。

当前生产解析源码、运行产物和测试与上一轮 bbtree 工程记录的最终哈希一致。本轮只调整基准的计时记录、统计指标选项及报告；没有修改产品实现。脚本语法校验通过；默认 `readyMs` 对历史原始数据生成完全相同的 timing/scope；无效指标会明确报错。新指标的两份摘要均绑定同一原始数据 SHA-256 和画面评审，不允许复用不匹配的数据。详见 `end-to-end-sota-verdict.json` 的验证绑定。

先按[基准说明](../README.md)准备依赖，然后在仓库根目录先完成构建，再串行测量：

```sh
npm run build:wasm
npm run build:core
npm run build:converter-client
npm run build:panorama
npm run build:archive
node scripts/benchmark-native-panorama.mjs --input /path/to/original.insp \
  --iterations 21 --output tmp/e2e-sota-reproduced/native
node scripts/summarize-native-panorama-benchmark.mjs \
  --input tmp/e2e-sota-reproduced/native/results.json \
  --metric localEndToEndMs --output tmp/e2e-sota-reproduced/native/e2e.json
node scripts/benchmark-other-formats.mjs --family zip --iterations 7 \
  --output tmp/e2e-sota-reproduced/zip
```

新运行默认没有 SOTA 标记。需要对新数据执行画面检查并提供绑定其原始数据哈希的 `--review`；不能直接套用本轮 review。旧的 10-24 范围复用结果继续保留，最终构建确认以本页数据为准。
