import {readFile,writeFile}from'node:fs/promises';
import path from'node:path';
import{fileURLToPath}from'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const reportIndex=process.argv.indexOf('--report');
const reportFile=reportIndex<0?path.join(root,'dist/agent-evaluation/report.json'):path.resolve(process.argv[reportIndex+1]);
const report=JSON.parse(await readFile(reportFile,'utf8'));
const pruning=JSON.parse(await readFile(path.join(root,'docs/agent-cli-pruning-evaluation.json'),'utf8'));
const obsoleteSummary=c=>{
 if(c.exit===0)return false;
 if(c.label==='中文摘要'||c.label==='英文摘要')return true;
 try{return Boolean(c.stdin&&JSON.parse(c.stdin).operation==='summarize');}catch{return false;}
};
const byLabel=label=>report.cases.find(c=>c.label===label);
const cell=value=>String(value??'').replaceAll('|','\\|').replaceAll('\n',' ');
const repoPath=value=>value?.replaceAll(root+'/', '');
const command=c=>c.stdin===undefined?`filens ${c.args.map(a=>JSON.stringify(repoPath(a))).join(' ')}`:`stdin: ${c.stdin}`;
const quality=report.cases.filter(c=>c.group==='quality');
const docs=report.cases.filter(c=>c.group==='documents');
const notes={
 '能力问法同义变体':'不认识这个能力问法；改用“你能做什么”。',
 'OCR 能力疑问':'不认识“你会 OCR 吗”；用 capacity 看 OCR 状态。',
 '混合发现与读取':'返回能力清单；没有读取该文件。一次请求只表达一种操作。',
 '不加引号的客套变体':'把“帮我读取”当成文件名的一部分；路径加引号即可。',
 '不加引号的看一下':'把“看一下”当成文件名的一部分；路径加引号即可。',
 '输出 JSON 的另一种英语语序':'没有识别 output JSON；实际为纯文本。改用 as json / in JSON。',
 '自然语言要求 YAML':'YAML 未实现；被忽略，返回纯文本。',
 '自然语言要求 XML':'XML 未实现；被忽略，返回纯文本。',
 '自然语言格式冲突':'匹配到 JSON 后选择 JSON；不要同时指定两种格式。',
 '另一种英文问答':'没有回答问题，回退成全文读取。',
 '筛选金额':'没有筛选金额，返回全文。',
 '格式转换意图':'没有生成 PDF，回退成全文读取。',
 '只读第一页的自然语言':'没有分页筛选；实际包含第二页 BRIGHT2027。',
 'scan-rotated.png':'词语可识别，但两行顺序反转；不是整页版面校正。',
 '文档内嵌透明图片回调':'BEFORE → 透明图片 OCR → AFTER，位置保留。',
 '关闭 OCR 保留已有文本':'明确报 ocr_failed，保留 BEFORE / AFTER。'
};
const outputSummary=c=>{
 if(notes[c.label])return notes[c.label];
 if(c.error)return `${c.error.code}: ${c.error.message}`;
 if(c.exit!==0)return c.stderr.trim();
 if(c.ocr)return `能力清单；${c.formats} 个扩展名；OCR available=${c.ocr.available}`;
 return `${c.operation??'read（纯文本不带操作字段）'}；${c.characters} 字符${c.blocks?`；${c.blocks} 个证据块`:''}`;
};
const table=cases=>`| 案例 | 实际请求 | 实际输出 / 退出码 | 观察 |\n| --- | --- | --- | --- |\n${cases.filter(c=>!obsoleteSummary(c)).map(c=>`| ${cell(c.label)} | \`${cell(command(c))}\` | ${c.format} / ${c.exit} | ${cell(outputSummary(c))} |`).join('\n')}\n`;
const docNotes={
 'filens-aurora-guide.docx':'正文、表格可读；风景图回调混入“一 / 心 / 公”等误识别字符。',
 'filens-observatory.xlsx':'工作表、单元格与数值可读；不负责重新计算公式或解释图表。',
 'filens-cosmic-atlas.pdf':'三页 PDF 的文本层可读；沿用文本优先策略。',
 'filens-field-notes.pptx':'幻灯片文字可读；风景图片产生多组零散误识别字符。',
 'legacy-project-workflow.doc':'旧版 Word 正文可读；复杂排版未做保真度量化。',
 'a.pages':'Pages 正文、Unicode 与列表内容可读。',
 'a.numbers':'读取超过 22 万字符；不是表格摘要或语义分析。',
 'filens-weekend.key':'Keynote 文字可读；图片 OCR 有噪声，备注中存在重复内容。'
};
const qualityNames={'invoice-zh':'清晰，34 px','invoice-blur':'轻度模糊，34 px / blur 2.4 px','invoice-small':'小字号，13 px','invoice-tiny':'极小字号，7 px','invoice-heavy-blur':'重度模糊，34 px / blur 6.4 px'};
const markdown=`# Agent CLI 实测案例与自然语言边界

> 当前源码支持无 LLM 的原文摘录式总结：\`summarize\` / \`prune\`。旧版将总结请求拒绝或判为非法操作的结论已失效；原始记录保留在历史 JSON 中，并标记后续能力更新。已发布的 npm 0.2.0 和早先 Windows ZIP 不包含这项新能力，使用 \`capacity\` 检查当前安装。下方基础实测表属于历史观测；当前多格式与布局能力见[指南](agent-cli-formats-and-layout.zh-CN.md)。

[安装与协议](agent-cli.zh-CN.md) · [机器可读的测试摘要](agent-cli-evaluation.json)

本页基础实测来自 ${report.date} 在 ${report.platform} 上对 **${report.cases.length} 条请求**的实际执行，使用报告记录的 CLI 产物、RapidOCR NCNN、最大边长 960、OpenMP=2。包含合成的可核对 OCR 图片、仓库演示文档与公开旧版 Word / iWork 样本。这是功能观察与有限质量检查，不是通用准确率基准，也不是 ${report.cases.length} 条“全部正确”的声明。

当前自然语言入口支持**读取全文、准备理解证据、发现能力、选择八种输出格式、提取关键内容、搜索本地目录**。总结通过密度/TF-IDF、可选 BM25 主题匹配和余弦多样性选择，保留原文及出处，无需语言模型。改写总结、翻译和问答仍由上层 Agent 完成。生产调用请使用 capacity 给出的 JSON Schema，并自行验证响应。

源码版的 search 支持 BM25、区分大小写的精确文本、文件名搜索和可校验的原文片段；支持中英文意图及八种输出格式。它使用全文，正文缓存按源内容哈希更新，尚未提供 embedding 语义检索。macOS 使用原生 FTS，不嵌入 hdrw；Windows/Linux 仅嵌入私有 hdrw 的编译后 WASI。用法见[搜索指南](agent-cli-search.zh-CN.md)，独立的[当前功能检查](agent-cli-search-evaluation.json)不属于本页历史 ${report.cases.length} 条观测，也不能证明优于 rg 或 zvec-grep。

## 当前总结能力：中文、英文与 JSON 均可用

检查 \`capacity.operations\` 是否包含 \`summarize\` 后，可使用以下请求：

\`\`\`sh
filens '总结 "report.txt"，以 JSON 输出'
filens 'summarize "report.txt" as json'
filens '提取 "report.txt" 的关键内容，关注预算和风险，保留30%，最多800字，以 JSON 输出'
filens prune report.txt --query '预算 风险' --summary-chars 800 --json
echo '{"operation":"summarize","input":"report.txt","query":"预算 风险","format":"json"}' | filens
\`\`\`

\`summarize\` 是合法操作，\`prune\` 是别名；“总结”返回关键原文片段。检查 \`content.summary.sourceComplete\`、\`omitted\`、\`sampled\` 和每段的 \`clipped\`；主动裁剪不等于读取被截断。分数只用于排序，不能表示内容可信度。出处同时提供输出文本和完整提取文本的 UTF-8 偏移。

公开合成会议记录的[当前真实 CLI 结果](agent-cli-pruning-evaluation.json)：

| 场景 | 原文字符数 | 摘录字符数 | 单次耗时 |
| --- | ---: | ---: | ---: |
${pruning.cases.map(c=>`| ${cell(c.name)} | ${c.summary.sourceCharacters} | ${c.summary.characters} | ${c.elapsedMs} ms |`).join('\n')}

这些是 ${pruning.platform} 上的单次观测，包含进程启动和 WASM 执行，不能代表通用摘要质量或稳定性能。完整用法、原文、摘录结果和限制见[无 LLM 关键内容提取](agent-cli-pruning.zh-CN.md)。历史总结失败记录不再列入下方边界表。

## 五分钟上手

安装后先准备一个文件，再复制这些命令。下文表格里的 report.txt、季度 报告.txt、invoice.png 等文件均由评估脚本生成。

\`\`\`sh
printf '季度报告\\n项目：本地文档读取\\n预算：12345.67 元\\n负责人：张三\\nBudget 42\\n' > report.txt
filens '你能做什么？以 JSON 输出'
filens '读取 "report.txt"，以纯文本输出'
filens '理解 "report.txt"，以 JSON 输出'
filens 'Please extract all text from "report.txt" in JSON'
echo '{"operation":"understand","input":"report.txt","format":"json"}' | filens
\`\`\`

图片、PDF 和内嵌图片示例使用你自己的文件路径，或先运行文末的评估脚本生成样本：

\`\`\`sh
filens '识别 "invoice.png" 中的文字，以 JSON 输出'
filens '读取 "scan.pdf"，以 JSON 输出'
filens '理解 "embedded.docx"，以 JSON 输出'
\`\`\`

“理解”返回来源、原文、UTF-8 字节证据块；它不会替调用 Agent 给出结论。“识别图片”也走 read，输出普通文本或同一份 JSON 内容协议。

## OCR 实际效果

五张图片是同一份虚构中文采购单，均为 1440 × 1000 PNG；原文与图片都在仓库中，可逐字核对。每次耗时包含新进程、WASM 编译和模型加载，各测一次，不能视为稳定性能指标。

| 图片条件 / 输入 | 归一化字符错误率 | 订单号 / 金额精确命中 | 本次耗时 |
| --- | --- | --- | --- |
${quality.map(c=>`| [${qualityNames[c.label]}](assets/agent-cli/${c.label}.png) | ${(c.normalizedCER*100).toFixed(1)}% | ${c.invoiceNumberCorrect?'是':'否'} / ${c.amountCorrect?'是':'否'} | ${(c.elapsedMs/1000).toFixed(2)} s |`).join('\n')}

这里的字符错误率使用 NFKC，去掉空白和标点，再计算字符编辑距离 / 原文长度；所以 0% 不代表原样保留空格与标点。订单号 FILENS2026、金额 12345.67 另外做精确匹配。单张干净合成图的成绩不能推断任意扫描件、手写体或语言的效果。

清晰图实际返回：

\`\`\`text
${byLabel('invoice-zh').text.trim()}
\`\`\`

两页扫描 PDF 实际返回：

\`\`\`text
${byLabel('扫描 PDF 完整读取').text.trim()}
\`\`\`

DOCX 内嵌透明图片的实际返回，显示 OCR 文字插入在前后正文之间：

\`\`\`text
${byLabel('文档内嵌透明图片回调').text.trim()}
\`\`\`

实际发现的限制：

- 180 度倒置测试识别出了文字，但两行顺序反转；EXIF 方向样本顺序正常。文字行方向识别不等同于整页版面重建。
- DOCX、PPTX、Keynote 中的风景照片会触发图片 OCR，可能输出“一 / 心 / 公”等零散字符；当前没有足够可靠的“这张图没有文字”判定。
- ok=true / complete=true 表示提取过程完成，不是识别置信度、内容准确率或语义正确性保证。
- 提示“只读第一页”不会改变扫描 PDF 的范围；本次仍返回了第二页 BRIGHT2027。

## 文档读取实测

| 输入文件 | 提取字符数 | 本次耗时 | 实际观察 |
| --- | ---: | ---: | --- |
${docs.map(c=>`| [${c.label}](../apps/demo/public/samples/${c.label}) | ${c.characters.toLocaleString('en-US')} | ${(c.elapsedMs/1000).toFixed(2)} s | ${docNotes[c.label]} |`).join('\n')}

这些文档均返回 ok=true、complete=true。上表记录能否读取和实际局限，没有对原始排版、每一个图像识别结果或全部字符做准确率宣称。完整提取文本留在本地 dist/agent-evaluation/report.json；提交的摘要只保留短片段。

## 能力发现：哪些问法实际可用

${table(report.cases.filter(c=>c.group==='discovery'))}
## 读取与路径：引号很重要

${table(report.cases.filter(c=>c.group==='reading'))}
自然语言中的路径应使用双引号或中文弯引号。单独的 shell 参数也能保留文件名中的空格，例如 filens understand '季度 报告.txt' --json。程序不会让上层 Agent 自动记住“刚才那个文件”，每次都需要给出路径。

## 输出格式：能识别的表达与严格入口

${table(report.cases.filter(c=>c.group==='format'))}
上表保留旧版的格式观察。当前源码支持 text、JSON、Markdown、HTML、YAML、XML、CSV、TSV；需要严格验证格式时，使用 --format 或 JSON format 字段，详见[当前多格式指南](agent-cli-formats-and-layout.zh-CN.md)。

## JSON 与 stdin：给 Agent 的可验证协议

${table(report.cases.filter(c=>c.group==='structured'))}
推荐调用链：读取 capacity → 根据 Schema 发送 search、understand/read 或 summarize 请求 → 检查 ok、complete、truncated、error 及摘录标记 → 根据需要将原文或关键摘录交给上层 Agent 改写总结、问答或字段提取。证据位置是提取文本的 UTF-8 字节偏移；物理页码和坐标需检查布局信息。

\`\`\`json
{"operation":"understand","input":"report.txt","format":"json"}
\`\`\`

## 历史边界记录：改写、问答与其他操作

${table(report.cases.filter(c=>c.group==='boundary'))}
“只列金额”“what is the budget”“转成 PDF”目前都不能作为已完成对应操作的证据。这些请求可能只返回全文，甚至仍为退出码 0。Agent 要对照返回的 operation / content 验证任务，不能把自然语言被接受等同于任务已执行。

## OCR 调用、扫描页和文档回调案例

${table(report.cases.filter(c=>c.group==='ocr'))}
--no-ocr 的失败案例返回退出码 3、ocr_failed，并保留已经读出的 BEFORE / AFTER；它不会把遗漏内嵌图片的结果伪装成完整提取。

## 复现与原始结果

\`\`\`sh
npm run build:agent
npm run evaluate:agent
# 或验证某个已安装版本；参数应指向真实可执行文件
node scripts/evaluate-agent-cli.mjs --binary /path/to/filens
\`\`\`

报告位于 dist/agent-evaluation/report.json；每条保存原始参数、退出码、文本、错误、耗时与质量指标。图片输入和期望原文已提交；通常不需要重新生成。要更新图片可运行 node scripts/generate-agent-ocr-fixtures.mjs，需要 Playwright Chromium，字体渲染会随系统变化。可用 node scripts/write-agent-evaluation-docs.mjs 从最近的报告重建本页。

历史失败行只描述当时的被测产物，不能用于判断当前源码是否支持总结。当前摘录能力由 agent-cli-pruning-evaluation.json 单独记录。npm 注册表的安装验证由 node scripts/test-agent-npm.mjs --registry 单独执行，不把本地构建成功当成注册表发布成功。
`;
await writeFile(path.join(root,'docs/agent-cli-examples.zh-CN.md'),markdown);
const summary={...report,binary:report.binary?.startsWith('dist/')?report.binary:path.basename(report.binary??'filens'),measurementScope:'Point-in-time observations of the tested binary; failed summarize requests below are historical and superseded by current source capabilities.',capabilityUpdates:{extractiveSummary:{supported:true,availability:'Source builds advertising summarize in capacity.operations; published npm 0.2.0 and earlier Windows ZIPs do not include it.',documentation:'agent-cli-pruning.zh-CN.md',evaluation:'agent-cli-pruning-evaluation.json'}},cases:report.cases.map(c=>({...c,args:c.args.map(repoPath),text:c.text?.slice(0,c.group==='documents'?600:5000),...(c.group==='documents'?{textExcerpt:true}:{}),...(obsoleteSummary(c)?{supersededBy:'agent-cli-pruning-evaluation.json',historicalOnly:true}:{} )}))};
await writeFile(path.join(root,'docs/agent-cli-evaluation.json'),JSON.stringify(summary,null,2)+'\n');
console.log(`Wrote ${report.cases.length} observed cases and OCR quality measurements to docs.`);
