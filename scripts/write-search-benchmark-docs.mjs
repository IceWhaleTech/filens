import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = JSON.parse(await readFile(path.join(root, 'docs/agent-cli-search-benchmark.json')));
const pct = n => n == null ? '—' : `${(n * 100).toFixed(1)}%`;
const ms = n => n == null ? '—' : n.toFixed(1);
const kib = n => (n / 1024).toFixed(1);
const cell = s => String(s).replaceAll('|', '\\|').replaceAll('\n', ' ');
const names = { 'filens-bm25': 'FiLens BM25', 'filens-exact': 'FiLens literal', 'rg-phrase': 'rg literal', 'rg-terms': 'rg 词项 OR', 'git-grep-terms': 'git grep 词项 OR' };
const categories = { identifier: '精确标识符', number: '精确数字', 'Chinese-terms': '中文多词', 'English-terms': '英文多词', 'literal-phrase': '完整原文短语', paraphrase: '同语言改写', 'cross-language': '跨语言问题', 'absent-identifier': '不存在的标识符', 'absent-fact': '主题存在、所问事实缺失' };
const ordered = Object.keys(names);
const nAnswer = r.manifest.queries.filter(q => q.relevant.length).length;
const formatFiles = ids => ids.slice(0, 5).join(', ') || '空';
const failures = [];
for (const category of ['paraphrase', 'cross-language', 'absent-fact', 'number']) {
  const item = r.observations.find(o => o.tool === 'filens-bm25' && o.category === category && (o.metrics.hit5 === 0 || o.metrics.falsePositive));
  if (item) failures.push({ ...item, q: r.manifest.queries.find(q => q.id === item.queryId) });
}
const md = `# 文档搜索实测：FiLens、ripgrep 与 git grep

这是 ${r.metadata.date.slice(0, 10)} 在 ${r.metadata.cpu} / ${r.metadata.platform} 上的**合成语料观测**。包含 ${r.metadata.corpusFiles} 个文件、${r.metadata.queries} 条预先固定的查询，其中 ${nAnswer} 条有答案、${r.metadata.queries - nAnswer} 条无答案；按 12 个主题家族组织。原文与相关文件标签由开发者按构造规则指定，没有外部人工评审、留出集或 Agent 最终任务成绩。

FiLens 目前提供词项检索。下面同时公开精确命中、改写/跨语言失败、无答案误报和耗时，不能据此宣称优于语义搜索产品。原始配置、逐查询结果、哈希和指标见[完整 JSON](agent-cli-search-benchmark.json)，语料定义见[topics.json](../benchmarks/agent-search/topics.json)。

## 运行配置与公平性

- FiLens：源码构建的 BM25 默认模式、literal 模式，返回最多 10 个文件，使用完整提取文本；每次校验源文件 SHA-256。正文缓存不是常驻倒排或向量索引。
- ripgrep：${r.metadata.ripgrep.split('\n')[0]}。literal 使用区分大小写的完整查询；词项 OR 使用忽略大小写的查询词，中文转相邻双字特征，英文去一小组停用词。词项规则固定在脚本中，没有按参考答案改写查询。
- git grep：${r.metadata.git}，使用 \`--no-index\` 和同一组 OR 词项。
- 所有工具读同一份 UTF-8 文本。文件名是中性编号，不泄露主题；问题、标签、报告均在被搜目录外。源码及原始文档流程另列，不能用 rg 直接搜索 Office 二进制来制造优势。
- rg/git grep 没有相关性排序，候选按相对路径排序后取前 k 个，模拟有限上下文视图；它们的 MRR/nDCG 留空，完整候选的召回/精确率另报。路径顺序不等于语义排名。
- 每个查询轮换五种配置的运行顺序，每次启动新进程。准确性语料先完成一次正文缓存准备：${ms(r.prep.elapsedMs)} ms，写入 ${r.prep.cacheWrites} 份正文。查询时延包含 CLI 启动、遍历、哈希/缓存验证、排序和序列化。

## 文件命中与误报

Hit@k 表示前 k 个文件中至少命中一个相关文件；Recall@5 使用全部相关文件作分母。候选召回/精确率使用各工具实际交付的完整列表：FiLens 上限 10 个，rg/git 返回所有匹配文件，预算并不相同，必须结合返回量解释。无答案误报率为无答案查询仍返回任何候选的比例；它不代表 CLI 已生成错误答案。

| 配置 | Hit@1 | Hit@5 | Recall@5 | 候选召回 | 候选精确率 | MRR@10 | nDCG@10 | 无答案误报 | 查询 p50 / p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${ordered.map(tool => { const q = r.quality[tool]; return `| ${names[tool]} | ${pct(q.hit1)} | ${pct(q.hit5)} | ${pct(q.recall5)} | ${pct(q.candidateRecall)} | ${pct(q.candidatePrecision)} | ${q.mrr10 == null ? '—' : q.mrr10.toFixed(3)} | ${q.ndcg10 == null ? '—' : q.ndcg10.toFixed(3)} | ${pct(q.falsePositive)} | ${ms(q.latency.p50Ms)} / ${ms(q.latency.p95Ms)} ms |`; }).join('\n')}

这些时延每种配置包含 ${r.metadata.queries} 个不同查询各一次，反映此查询混合，不能代替相同查询的稳定性能重复；下节另做 15 次规模重复。

完整重跑的非完整查询数：${ordered.map(tool => `${names[tool]} ${r.quality[tool].failures}/${r.quality[tool].queries}`).join('；')}。失败请求计入命中指标，不作为成功结果丢弃。

| 查询类别 | 数量 | FiLens BM25 Hit@5 | FiLens literal Hit@5 | rg literal Hit@5 | rg OR Hit@5 | git grep OR Hit@5 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${Object.entries(categories).filter(([category]) => !category.startsWith('absent')).map(([category, label]) => `| ${label} | ${r.manifest.queries.filter(q => q.category === category).length} | ${ordered.map(tool => pct(r.quality[tool].categories[category].hit5)).join(' | ')} |`).join('\n')}

无答案的两种难度：

| 无答案类型 | FiLens BM25 误报 | FiLens literal 误报 | rg literal 误报 | rg OR 误报 | git grep OR 误报 |
| --- | ---: | ---: | ---: | ---: | ---: |
${['absent-identifier', 'absent-fact'].map(category => `| ${categories[category]} | ${ordered.map(tool => pct(r.quality[tool].categories[category].falsePositive)).join(' | ')} |`).join('\n')}

按主题家族配对重采样 2000 次（固定种子 ${r.pairedHit5.seed}），FiLens BM25 相对 rg OR 的 Hit@5 差值为 ${(r.pairedHit5.difference * 100).toFixed(1)} 个百分点，bootstrap 95% 区间 [${(r.pairedHit5.lower95 * 100).toFixed(1)}, ${(r.pairedHit5.upper95 * 100).toFixed(1)}]。这比较的是当前路径截取规则与当前语料，不是算法独立效果；只有 12 个合成家族，也没有人工标注不确定性。

## 证据、数字与失败例

FiLens 返回非空结果的请求中，原文片段按 UTF-8 偏移逐一对回生成原文，并校验来源 SHA-256：

| 配置 | 非空请求数 | 偏移/来源哈希全部正确的请求 | 指定业务句在前五结果的命中率 |
| --- | ---: | ---: | ---: |
${['filens-bm25', 'filens-exact'].map(tool => { const nonempty = r.observations.filter(o => o.tool === tool && o.files.length); return `| ${names[tool]} | ${nonempty.length} | ${nonempty.filter(o => o.metrics.offsetsValid).length} | ${pct(r.quality[tool].evidenceHit)} |`; }).join('\n')}

指定业务句在运行前写入标签。仅返回编号附近的文字也可能缺少该业务句，因此证据命中率与文件命中率不同；它不衡量推理正确性。数字查询混入只差一位或次序的归档数值，精确数字项单列在上表。

以下保留 BM25 的实际失败，完整返回文件列表可查 JSON：

| 查询 | 期望相关文件 | 实际前五文件 | 观察 |
| --- | --- | --- | --- |
${failures.map(o => `| ${cell(o.q.query)} | ${formatFiles(o.q.relevant)} | ${formatFiles(o.files)} | ${o.q.relevant.length ? '正确文件未进前五' : '没有所问事实，仍返回词面候选'} |`).join('\n')}

语料有中英文、当前/归档版本、近似金额、词项干扰和超过普通分块的长文尾部。此处没有多模型调参，也没有用改写或跨语言成绩代表生成式理解。

## 文件规模、首次使用和缓存

另生成 100、500、2000 个约 0.4 KiB 的短文本，查找唯一的 \`SPEED2026\`。每个规模先运行一次空正文缓存查询，再对每种配置重复 15 次并轮换顺序。这里“首次”仅清空 FiLens 缓存，**没有清空操作系统页缓存**。p95 使用 nearest-rank，15 个样本的尾部分位数仍很有限。

| 文件数 / 文本量 | FiLens 首次提取+查询（n=1） | FiLens 缓存 p50 / p95 | rg literal p50 / p95 | git grep OR p50 / p95 | 正文缓存 | FiLens 最大进程 RSS（单次） |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${r.scales.map(s => `| ${s.files} / ${kib(s.sourceBytes)} KiB | ${ms(s.firstExtractionMs)} ms | ${ms(s.cached['filens-bm25'].p50Ms)} / ${ms(s.cached['filens-bm25'].p95Ms)} ms | ${ms(s.cached['rg-phrase'].p50Ms)} / ${ms(s.cached['rg-phrase'].p95Ms)} ms | ${ms(s.cached['git-grep-terms'].p50Ms)} / ${ms(s.cached['git-grep-terms'].p95Ms)} ms | ${kib(s.cacheBytes)} KiB | ${s.maxProcessResidentBytes ? (s.maxProcessResidentBytes / 1048576).toFixed(1) + ' MiB' : '未测'} |`).join('\n')}

macOS \`time -l\` 的最大进程 RSS 不是 supervisor 与 worker 并发内存之和。规模曲线主要反映短文本的遍历、文件哈希和缓存读写；大量 PDF、扫描件、慢盘和网络目录需要另测。FiLens 当前每次重新分块排名，尚未有常驻倒排索引，不能预期它具有 rg 的纯文本扫描速度。

规模重复的失败数：${r.scales.map(s => `${s.files} 文件：${Object.entries(s.failedCachedQueries).map(([tool, n]) => `${names[tool]} ${n}/${s.attemptsPerTool}`).join('、')}`).join('；')}。上表缓存时延仅计算成功样本，实际 n 保留在 JSON 中。另有一次先导试跑在 2000 文件缓存查询时返回退出码 1，旧仪器没有保留错误响应，单独重放成功，原因尚未确认；该先导试跑没有并入完整重跑的分位数，也没有被当成成功。完整重跑保留操作错误，不自动重试。

## 修改与删除

一次修改后立刻查询旧值和新值，再删除并立即查询。各次都使用原有正文缓存：

| 操作 | 查询 | 命中文件数 | 耗时 |
| --- | --- | ---: | ---: |
${r.updates.map(u => `| ${u.action} | ${u.query} | ${u.matchedFiles} | ${ms(u.elapsedMs)} ms |`).join('\n')}

这些结果验证下一次请求不继续返回旧内容；不代表实时监听或并发修改下的原子快照。

## DOCX、扫描 PDF 与图片

使用公开合成 DOCX、采购单 PNG，以及仓库两页扫描 PDF。rg 使用 **FiLens 同一提取器得到的完整文本**；提取成本 ${ms(r.documents.sharedExtractionMs)} ms（逐文件 CLI 启动，包含 OCR）单列，不能把下面 rg 的纯查询耗时当成从原始文档开始的总耗时。

| 原始文件 | 提取耗时 | 完整 | 字符数 |
| --- | ---: | --- | ---: |
${r.documents.extraction.map(e => `| ${e.file} | ${ms(e.elapsedMs)} ms | ${e.complete ? '是' : '否'} | ${e.characters} |`).join('\n')}

| 查询 | 期望文件 | FiLens 命中 / 耗时 | rg 共享提取后命中 / 查询耗时 | FiLens 页码/坐标 |
| --- | --- | --- | --- | --- |
${r.documents.queries.map(q => `| ${q.query} | ${q.relevant.join(', ')} | ${q.filens.files.join(', ') || '空'} / ${ms(q.filens.elapsedMs)} ms | ${q.rgWithSharedExtraction.files.join(', ') || '空'} / ${ms(q.rgWithSharedExtraction.elapsedMs)} ms | ${q.filens.pageOrBounds ? '有' : '无'} |`).join('\n')}

FiLens 第一条搜索从空正文缓存开始，后两条复用正文。OCR 最大边长 960、OpenMP=2。仅检查已知编号/金额、完整性及定位字段，未在此量化 OCR 通用准确率或矩形精度；已有[OCR 质量样例](agent-cli-examples.zh-CN.md)另报错误。

## 如何复现与扩展

\`\`\`sh
npm run build:agent
node --test scripts/search-benchmark-metrics.test.mjs
node scripts/benchmark-agent-search.mjs
node scripts/write-search-benchmark-docs.mjs
\`\`\`

需要 Node、rg、git；原文文档演示输入由 \`npm run demo:agent -- --poster-only --lang en\` 生成。也可用 \`--binary /path/to/filens\` 选择带 OCR 的源码构建。执行时避免同时编码 GIF、编译或运行其他基准。完整生成语料和缓存留在忽略的 \`dist/agent-search-benchmark/\`，报告和标签位于搜索根目录外。

zvec-grep 的固定参考提交为 \`891497fa87d3e03d0c9273fed0ba3e75af62f179\`，本轮**没有运行**。它具有 ripgrep、BM25、向量的混合路径，不能把这里的 rg 对照当成它的表现。下一步应在有许可的外部文档与人工留出问题上，按[评价方案](agent-cli-search-evaluation.zh-CN.md)补充持久索引、embedding 与完整 Agent 任务；先固定安装版本、模型和资源预算，再报告结果。
`;
await writeFile(path.join(root, 'docs/agent-cli-search-benchmark.zh-CN.md'), md);
console.log('Wrote search benchmark tables, scope and failure examples.');
