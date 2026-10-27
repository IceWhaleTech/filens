# ZIP 目录浏览：处理更快，显示延迟未稳定下降

2026-10-27。最终生产构建与子目录索引优化前版本各 7 次，对 200 / 10,000 / 100,000 文件的生成 ZIP 共测 42 次。**目录切换的同步处理明显减少，但包含布局与两帧显示等待的整体浏览没有稳定提速；没有同等外部 ZIP 浏览器对照，不能标为 ZIP 浏览 SOTA。** 完整提取全部文件的排名属于另一项任务。

| 浏览任务 | 优化前 | 最终版本 | 判定 |
| --- | ---: | ---: | --- |
| 200 文件 / 20 目录：本地加载、初始化到首屏 | 46.2 ms | 46.2 ms | 无稳定改善 |
| 1 万文件 / 100 目录：本地加载、初始化到首屏 | 49.8 ms | 50.8 ms | 无稳定改善 |
| 10 万文件 / 1,000 目录：本地加载、初始化到首屏 | 309.4 ms | 309.4 ms | 无稳定改善 |
| 1 万文件：首次进入 50 个目录，同步点击/DOM 处理累计 | 48.9 ms | 28.2 ms | 快 1.73×，95% 区间 1.72–1.76 |
| 10 万文件：首次进入 50 个目录，同步点击/DOM 处理累计 | 350.5 ms | 90.7 ms | 快 3.86×，95% 区间 3.82–3.91 |
| 10 万文件：上述 50 次点击，各含布局与两帧显示等待 | 1,653.6 ms | 1,652.8 ms | 比值 1.0005，95% 区间 0.998–1.006，无稳定改善 |
| 10 万文件：重复进入已缓存目录到两帧显示 | 33.3 ms | 33.3 ms | 无稳定改善 |

10 万文件的第一个目录显示为 31.3 → 28.0 ms（本轮区间 1.01–1.54），但没有延伸为所有目录显示或完整浏览流程的稳定收益。首次进入目录的显示中位数为 33.1 → 33.2 ms；本机两个动画帧的等待掩盖了多数同步处理的差异。不能据此推断低帧率、低性能设备或更大目录的结果。

此前 **312.1 → 24.5 ms / 12.74×** 的数据仍是有效的同步工程对照：直接连续调用路由函数，计到 DOM 构建，不加载生产 CSS，不等待布局/显示，也不在每个新目录之间返回根目录。本轮加入生产 CSS、真实目录行的 DOM 点击处理器、每次从根目录进入，以及逐次显示等待；两个倍率的测量边界不同，不能混合计算或写成用户可见浏览快 12.74 倍。

## 测量边界

- Apple M4 Pro，Chromium 147.0.7727.15，1024×768、DPR 1、en-US/UTC。每次新 context，共享浏览器，轮换实现顺序。三个 STORE ZIP 使用已存在的确定性测试生成器，原始字节哈希保留。
- 本地加载从输入 HTTP 获取与模块加载前开始，两者并行，包含 File 创建、session 构造、完整 ZIP 索引、根列表 DOM、布局观察、字体及两个动画帧。HTML/CSS 页面壳、浏览器启动、远程 NAS/后端与冷磁盘不包含在内。
- 导航通过目录行及 Root 控件的 `.click()` 触发真实事件处理器；每次新目录由根目录进入。同步点击/DOM 和“布局观察、字体、两个动画帧”分别记录。Root 返回单独记录；不会把多次进入路径直接连续调用当成实际显示。
- 点击是合成 DOM 事件，不包含操作系统输入队列。两帧提供显示机会，不是物理输入到屏幕像素的测量。页面中按需观察布局，截图在计时外执行。
- 目录列表对独立生成的完整名称、类型、大小、修改时间模型逐项核对；全部 ZIP 元数据和浏览列表 HTML 哈希一致。两版根目录/子目录的 6 对视口 PNG 全部匹配。42/42 成功。
- 没有解压所有未打开的文件，没有外部浏览器 UI 对照，没有测峰值内存。输入生成、验证、截图、测试和构建不与计时并行。
- 配对中位数比 bootstrap，10,000 次重采样，种子 12345。统计单位是每次全新 context 的一组操作；不是把 50 次点击当成 50 个独立样本。根返回和验证之间的驱动间隔不计入总数，报告中的完整浏览合计是测量阶段之和，非整段会话墙钟时间。

本轮只增加测量脚本和报告，没有修改产品实现。既有完整内容回归继续由前一轮验证覆盖。本轮 42 次是项目内工程测量，不计入 2,709 次外部同行比较，也不影响其他历史任务的限定排名。

## 证据与复现

[原始 42 次运行](archive-browser.json.gz) · [统计摘要](archive-browser-summary.json) · [验证、源码和运行产物绑定](archive-browser-review.json) · [基线运行代码及源码快照](archive-browser-diagnostic.json.gz)。截图保留在本地 `tmp/zip-browser-e2e-2026-10-27/final/`；公开记录包含哈希。

先完成 `npm run build:core` 和 `npm run build:archive`，然后恢复基线运行代码到隔离的临时目录，再串行运行：

```sh
python3 - <<'PY'
import gzip, json
from pathlib import Path
data = json.loads(gzip.decompress(Path('benchmarks/frontend/2026-10-27/archive-browser-diagnostic.json.gz').read_bytes()))
target = Path('tmp/zip-browser-baseline/index.js')
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(data['baselineRuntime']['content'])
PY
node scripts/benchmark-archive-browser.mjs --iterations 7 \
  --baseline tmp/zip-browser-baseline/index.js --output tmp/zip-browser-reproduced
node scripts/summarize-archive-browser-benchmark.mjs \
  --input tmp/zip-browser-reproduced/results.json --output tmp/zip-browser-reproduced/summary.json
```
