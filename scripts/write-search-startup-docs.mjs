import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = JSON.parse(await readFile(path.join(root, 'docs/agent-cli-search-startup.json')));
const ms = n => n == null ? '—' : n.toFixed(1);
const stamp = new Date(r.metadata.observedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
const md = `# 搜索启动优化与 rg 冷启动对照

这是仅延迟加载 WASM 阶段的历史记录，时间数据不代表后续原生路径。当前功能定位见[多格式搜索实测](agent-cli-search-formats.zh-CN.md)，后续[原生 Rust 启动成本](agent-cli-search-native.zh-CN.md)单独记录。

${stamp}（Asia/Shanghai），${r.metadata.cpu} / ${r.metadata.platform}。当前搜索只保留本次请求的数据，**不持久保存索引或提取正文，不计算或校验来源、WASM、OCR 库/模型的内容哈希**。默认信任读取到的来源，兼容字段 \`sha256\` 为 null；实际读取/解析错误与截断仍返回。

## 本轮变化

- WASM 函数按调用加载、校验和编译，搜索不预先编译未使用的文档转换、CAD、表格或图片编码函数。排名、解析和导出仍使用共享前端核心。
- 普通搜索直接使用同一个前端核心的格式目录，无须为查询能力先启动一次 WASM；显式自定义 WASM 仍向所选模块读取能力。文件名搜索跳过格式目录与正文提取。
- 删除正文缓存与哈希路径，避免额外读取 WASM、OCR 动态库和模型。PDFium 与 RapidOCR 仅在实际回调时初始化；纯文本/文件名搜索不加载这些引擎。
- \`--no-cache\` / \`cache:false\` 兼容保留；\`cache:true\` 返回请求错误。WASI 仍使用请求结束后清理的临时文件，既有旧缓存不会被读取或自动删除。

## “冷”的范围

每个样本都启动全新 CLI/rg 进程，进程内没有预热或复用，FiLens 两侧均无应用缓存；优化前显式传入 \`--no-cache\`，优化后始终不持久保存。所有重复都保留，没有丢弃预热样本。\`firstMs\` 是本轮首次观测，不能保证可执行文件页尚未被系统缓存。

${r.diskCache.available ? 'macOS `purge` 在每个样本前成功执行，清理时间不计入查询时间；这不等于硬件缓存全部清空。' : '尝试 macOS `purge` 清理系统磁盘缓存时被权限拒绝。**物理冷盘未测得**，系统文件页缓存不受控，可能已热；本文仅称新进程冷启动和无应用缓存。不能把新进程或空 FiLens 缓存冒充冷磁盘。'}

按每轮轮换优化前、优化后、rg 的顺序执行，不自动重试。耗时包含进程启动、遍历、提取、排名和输出序列化。两侧加载同一份 WASM；文件哈希仅由基准工具在计时区间外记录产物身份，不参与实际搜索。

## 耗时

| 场景 | 样本数/工具 | 优化前 p50 / p95 | 优化后 p50 / p95 | rg p50 / p95 | FiLens 中位耗时下降 |
| --- | ---: | ---: | ---: | ---: | ---: |
${r.summary.map(s => `| ${s.label} | ${s.samplesPerTool} | ${ms(s.tools.before.p50Ms)} / ${ms(s.tools.before.p95Ms)} ms | ${ms(s.tools.after.p50Ms)} / ${ms(s.tools.after.p95Ms)} ms | ${ms(s.tools.rg.p50Ms)} / ${ms(s.tools.rg.p95Ms)} ms | ${((1 - s.tools.after.p50Ms / s.tools.before.p50Ms) * 100).toFixed(1)}% |`).join('\n')}

| 场景 | 优化前首次 | 优化后首次 | rg 首次 |
| --- | ---: | ---: | ---: |
${r.summary.map(s => `| ${s.label} | ${ms(s.tools.before.firstMs)} ms | ${ms(s.tools.after.firstMs)} ms | ${ms(s.tools.rg.firstMs)} ms |`).join('\n')}

\`--help\` 只是进程与参数入口的开销参照。文件名对照使用 \`rg --files\`，该单文件场景只有一个候选，不代表 rg 做了相关性排名。正文对照使用 \`rg -l -0 -F --no-ignore\`；BM25 与 literal 的算法不同，共同编号只用于检查这个受控样本的命中文件一致。2000 文件场景沿用前次基准的约 0.9 MiB 合成短文本，三次重复的 p95 就是最大值，不能据此推断稳定尾延迟。

${r.equalOutputPairsIgnoringSourceHash} 对成功请求比较了排序、分数、原文、偏移及布局，全部一致；仅排除有意取消的来源哈希和运行诊断字段。共记录 ${r.failures.length} 次失败，逐次数据、工具版本与产物身份见[完整 JSON](agent-cli-search-startup.json)。单机小样本不是全面超过 rg 的证明；这轮优先减少启动工作，没有增加持久倒排索引或后台服务。

## 复现

先保存优化前的源码构建可执行文件，再构建当前 CLI。将 \`--before\` / \`--after\` 指向它们，\`--wasm\` 指向二者共用的正文模块。两个可执行文件旁的 \`converter-text.wasm\` 必须是同一模块；脚本可创建缺失的符号链接。2000 文件语料由 \`scripts/benchmark-agent-search.mjs\` 生成。

\`\`\`sh
node scripts/benchmark-search-startup.mjs --before ./before/filens --after ./after/filens --wasm ./dist/converter-text.wasm --purge
node scripts/write-search-startup-docs.mjs
npm run test:agent:search
\`\`\`

\`--purge\` 只在 macOS 尝试清理缓存，失败会明确记录，不会请求 sudo 或密码；不传此选项则只测新进程。旧的[多维度评测](agent-cli-search-benchmark.zh-CN.md)保留此前开启缓存/哈希版本的历史观测，不代表当前默认存储策略。
`;
await writeFile(path.join(root, 'docs/agent-cli-search-startup.zh-CN.md'), md);
