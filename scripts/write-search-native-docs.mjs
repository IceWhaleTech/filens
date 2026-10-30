import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = JSON.parse(await readFile(path.join(root, 'docs/agent-cli-search-native.json')));
const tools = ['native-1', 'native-4', 'rg-default', 'rg-1', 'rg-4'];
const labels = { 'native-1': 'FiLens 单线程', 'native-4': 'FiLens 请求四线程', 'rg-default': 'rg 默认', 'rg-1': 'rg --threads 1', 'rg-4': 'rg --threads 4' };
const ms = n => n.toFixed(2);
const table = rows => `| 文件 / 模式 | ${tools.map(t => labels[t]).join(' | ')} |\n| --- | ${tools.map(() => '---:').join(' | ')} |\n` + rows.map(s => `| ${s.files} / ${s.mode} | ${tools.map(t => `${ms(s.tools[t].p50Ms)} / ${ms(s.tools[t].p95Ms)}`).join(' | ')} |`).join('\n');
const stamp = new Date(r.metadata.observedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
const md = `# 原生 Rust 搜索与 rg 的线程对照

这是降低搜索调用成本的阶段记录。产品价值与功能覆盖优先看[多格式搜索实测](agent-cli-search-formats.zh-CN.md)；本页不以纯文本速度作为跨格式能力的替代指标。记录对应下述时间与 JSON 中的阶段产物，后续阈值调整和解析修复不追写为已测量产物。

${stamp}（Asia/Shanghai），${r.metadata.cpu} / ${r.metadata.platform}，${r.metadata.ripgrep.split('\n')[0]}。本轮将共享前端核心的检索、导出与常见纯文本解码直接编译到 CLI。浏览器仍编译同一份源码为 WASM；CLI 没有另写排名或解码算法。

## 当前路径

文件名和常见纯文本/代码文件的普通搜索加载 **0 个正文 WASM 模块**。这些查询不依赖正文 WASM 文件存在。macOS 使用原生 FTS；Windows/Linux 的目录枚举仍使用私有 hdrw WASM，零模块仅指正文提取/排名。复杂文档及 \`--layout\` 仍按需使用共享 WASM 解析器；每次调用批量处理最多 256 个文件，工作线程共享一个已加载的正文模块。PDFium 与 RapidOCR 只在实际回调时初始化，OCR 保留单独通道与 OpenMP=2。

搜索没有持久索引或正文缓存，不对来源、WASM 或 OCR 模型做内容哈希/完整性校验，默认信任读取结果；真实的读取/解析错误和明确截断仍返回。常见文本留在请求内存中；复杂文档的 WASI 协议使用请求结束后清理的临时目录。

元数据总大小不超过 8 MiB 或少于 32 个文件时默认单线程，较大工作量最多四个工作线程。\`FILENS_SEARCH_JOBS=1..8\` 可调优；少于 32 个文件仍串行，因此表中“请求四线程”的单文件场景实际也是一个工作线程。这个阈值是避免小任务调度开销的启发式，不代表已覆盖所有存储设备或大文件。

## 计时范围

每个配置、每个场景各 15 次，每次启动新进程，无进程内预热、无应用缓存；每轮轮换五种配置顺序，不自动重试，保留首个样本。包括启动、遍历、读取、解码、匹配/排名、证据与 JSON 序列化。操作系统文件页缓存不受控，可能已热；此前 macOS \`purge\` 被权限拒绝，**没有物理冷盘结果**。源码和产物哈希只在测量区间外记录。

同一合成 UTF-8 语料，查唯一编号；100/2000 文件各约 44 KiB / 0.9 MiB。FiLens 与 rg literal 均返回唯一命中文件。FiLens 还生成偏移证据，rg 使用 \`-l -0 -F --no-ignore\`；表中同时公开 rg 默认线程数以及 1/4 线程调优，不能只选较慢配置作结论。${r.summary.some(s => s.mode === 'files') ? '文件名场景用 `rg --files`，只有一个候选，未比较相关性排名。' : '本次原始数据未包含文件名场景。'}

## p50 / p95，毫秒

${table(r.summary.filter(s => s.mode !== 'bm25'))}

BM25 比 literal 多做分词、相关性统计与排序，以下 rg 仍是编号 literal 对照，不能当成 rg 也实现了 BM25：

${table(r.summary.filter(s => s.mode === 'bm25'))}

本机这些短文本上，FiLens 原生精确搜索可快于默认 rg，但经过线程调优的 rg 仍更快；FiLens 四线程也未稳定快于单线程。不能据此宣称普遍超过 rg。首次样本、所有重复和失败均在[完整 JSON](agent-cli-search-native.json)，没有删除首次的较高时延。

## 结果一致性和内存

${r.equalNativeWorkerPairs} 对单/多线程请求的结果完全一致。对原先 108 文件、96 条固定中英文查询，BM25 与 literal 共 ${r.parity.comparisons} 组原生/WASM 对照没有排序或证据差异；浮点数最大相对差为 ${r.parity.maxRelativeScoreDifference.toExponential(3)}，比较容差 ${r.parity.tolerance}，路径、字符串、阅读顺序和偏移保持一致。这只验证改为原生没有改变这批词项检索结果，没有改善既有跨语言、无答案检测等边界。

macOS \`time -l\` 对 2000 文件 exact 场景各单独运行一次，最大进程 RSS：

| 配置 | 最大进程 RSS |
| --- | ---: |
${r.resources.map(s => `| ${labels[s.tool]} | ${(s.maxProcessResidentBytes / 1048576).toFixed(1)} MiB |`).join('\n')}

这是单次最大进程值，不是稳定分布。全部 ${r.observations.length} 个计时请求记录 ${r.failures.length} 次失败。数据仍是单机、少量合成短文本，不能外推到 Windows/Linux、冷盘、网络目录、海量 PDF 或真实语义检索产品。

## 复现

先构建当前源码 CLI 和正文 WASM，并生成 \`dist/agent-search-benchmark/\` 中的固定语料。脚本使用 \`dist/agent-search-parallel/filens\` 及同目录的 \`converter-text.wasm\`，原生和显式 WASM 使用同一提取/排名源码。

\`\`\`sh
node scripts/benchmark-search-native.mjs
node scripts/write-search-native-docs.mjs
npm run test:agent:search
\`\`\`

此前[WASM 启动优化](agent-cli-search-startup.zh-CN.md)与[多维度准确性评测](agent-cli-search-benchmark.zh-CN.md)保留历史阶段及其局限；本页数据仅适用于记录的阶段产物。
`;
await writeFile(path.join(root, 'docs/agent-cli-search-native.zh-CN.md'), md);
