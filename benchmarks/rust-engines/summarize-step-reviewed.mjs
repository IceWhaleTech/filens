import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const work=path.join(root,'tmp/rust-engines');
const report=JSON.parse(await readFile(path.join(work,'results-step-reviewed.json')));
const previous=JSON.parse(await readFile(path.join(root,'docs/assets/rust-engines/results-step-fixed.json')));
const validation=JSON.parse(await readFile(path.join(root,'docs/upstream/truck/validation.json')));
const old=new Map(previous.step.map(x=>[x.id,x]));
const rows=report.step.filter(x=>x.engines.occt.success);
const nonempty=rows.filter(x=>x.engines.truck.success), passing=rows.filter(x=>x.engines.truck.geometryScreenPass);
const failures=rows.filter(x=>!x.engines.truck.geometryScreenPass);
const regressions=rows.filter(x=>old.get(x.id).engines.truck.geometryScreenPass&&!x.engines.truck.geometryScreenPass).map(x=>x.id);
assert.equal(report.step.length,55);assert.equal(rows.length,44);assert.equal(nonempty.length,44);
assert(passing.length>=40);assert.equal(regressions.length,0);
for(const row of report.step) assert.equal(row.sha256,old.get(row.id).sha256,row.id);
const size=report.sizes.find(x=>x.name==='truck-reviewed'),reference=report.sizes.find(x=>x.name==='occt');
const wasm=await readFile(path.join(work,'wasm/truck-reviewed.wasm'));
assert(WebAssembly.validate(wasm));assert.equal(createHash('sha256').update(wasm).digest('hex'),size.sha256);
assert.equal(validation.patchedRegressionTests,30);
for(const patch of validation.patches) assert.equal(createHash('sha256').update(await readFile(path.join(root,'docs/upstream/truck',patch.file))).digest('hex'),patch.sha256);
report.summary={ files:55,referenceNonempty:44,candidateNonempty:nonempty.length,geometryScreenPasses:passing.length,geometryScreenBeforeReview:21,regressions,remaining:failures.map(x=>x.id),shellFallbackFiles:rows.filter(x=>x.engines.truck.shellFallback).length,upstreamBase:validation.base,targetedRegressionTests:30 };
const kib=n=>(n/1024).toFixed(1),pct=n=>(n*100).toFixed(2);
const failedTable=failures.map(x=>{const c=x.engines.truck.comparison;return `| ${x.id} | ${pct(c.boundsRelativeError)}% | ${pct(c.areaRelativeError)}% | ${pct(c.volumeRelativeError)}% | ${Math.max(c.referenceToCandidate.p95,c.candidateToReference.p95).toFixed(3)} |`;}).join('\n');
const markdown=`# Rust STEP 复查与上游 PR 准备

2026-10-30。在 [首次评测](rust-engine-evaluation.zh-CN.md) 和 [不显示修复](step-display-diagnosis.zh-CN.md) 后继续检查。所有解析、单位处理、装配与三角化仍在 Rust WASM 中执行，产品引擎尚未替换。

**44/44 含实体文件输出网格，几何筛查由最初 19/44、上一轮 21/44 提升到本轮 ${passing.length}/44，上一轮通过项没有回退。三份上游 PR 补丁、英文描述和回归测试已准备；仍有 ${failures.length} 个几何差异，另 11 个仅引用外部 STEP 的装配仍需要关联文件加载。**

## 本轮修复与优化

- 长度单位从文件中形状表示的上下文解析，覆盖毫米、厘米、米和转换单位；不把转换因子引用的毫米误当成整个文件单位。输入缺少单位、单位循环或无效、上下文混用单位时返回明确错误。
- 三角化容差先由 0.1 mm 换成源单位，装配完成后统一输出毫米。这样不会把 0.1 英寸当成 0.1 毫米；大部分残余差异由这一步解决。
- 正确接受可省略的装配描述。as1-tu-203.stp 从丢失装配、逐 shell 输出恢复到 18 个实例；边界与 OCCT 一致，面积误差 0.011%、体积误差 0.016%。
- 追踪无变换的形状表示关系以找到实体，去重并防止关系环；带变换的装配关系保留在装配图上。当前含实体样例中还有 ${report.summary.shellFallbackFiles} 个使用逐 shell 后备路径。
- 实体预览显式记录跳过的已知标注与线框；不把未知实体转换失败一律忽略。曲线兼容扫描改用借用参数，减少整份参数列表的复制。
- 拒绝非正/非有限容差及非有限输出坐标。上游补丁另补充了非有限曲线细分的快速失败保护。

![装配位置修复前后](assets/rust-engines/step-reviewed-assembly.png)

![曲面与物理容差修复前后](assets/rust-engines/step-reviewed-head.png)

## 可以交给上游的三份 PR

见 [PR 交付说明](upstream/truck/README.zh-CN.md)，也可直接使用 [压缩包](upstream/truck-pr-ready.zip)。目标为 ricosjp/truck 的提交 ${validation.base}，尚未向 GitHub 发布。

| PR | 范围 | 回归测试 | 原代码失败数 |
| --- | --- | ---: | ---: |
| 1 | 方向比例、VECTOR 长度、二维/三维坐标系、近乎平行的参考方向 | 9 | 8 |
| 2 | 可省略的产品/装配 description 及 PartAttrs 映射 | 5 | 2 |
| 3 | 非有限参数/采样误差触发的递归细分保护 | 6 | 4 |

三份补丁均检查了独立应用和组合应用，20 个上游回归测试全部通过；实验核心另有 7 个单位和 3 个表示关系测试通过，共 30 个。先在原代码执行，确认这些测试能捕捉问题，再在补丁代码执行。

本地 Rust 1.93 无法构建 HEAD 的 parking_lot 0.13（要求 Rust 1.95），验证副本仅将 truck-topology 的 parking_lot / rclite 约束恢复到前一提交。**完整 HEAD 依赖图和整个上游测试集尚未验证。** 交付补丁没有依赖改动；[验证记录](upstream/truck/validation.json) 明确记录了该限制。PR 2 还有 String → Option<String> 的公开字段类型变化，需要维护者评估迁移。

${passing.length}/44 的成绩还包含 Filens 实验适配层的单位、容差、表示关系遍历、预览筛选与 PCurve 兼容策略；三份上游补丁并不包含这些全部改动，不能把本轮语料成绩归给三份 PR 本身。

## 仍需修复

沿用前轮几何筛查阈值，没有放宽标准。每个 face 返回非空网格仍不足以证明实体完整。

| 文件 | 边界偏差 / 对角线 | 面积误差 | 有符号体积误差 | 双向表面 P95 最大值 mm |
| --- | ---: | ---: | ---: | ---: |
${failedTable}

HEAD_BACK 的几何损失明显；两个涡轮样例仍有数毫米曲面差异。foot_front_prt 看起来接近、面积误差也小，但体积仍明显不同，不能当作已修复。具体根因尚未证明，需要进一步逐面核对裁剪、方向和实体有效性。

完整后续清单见 [remaining-issues.md](upstream/truck/remaining-issues.md)：还包括周期 PCurve 的有效参数区间/端点裁剪/绕回分支、缺失引用导致的不一致拓扑、混合单位装配、角度单位、外部关联 STEP 加载。预览中使用解析三维曲线的兼容策略不能直接当作通用上游几何修复。

## 体积与复现

| 引擎 | WASM KiB | gzip KiB | Brotli KiB |
| --- | ---: | ---: | ---: |
| 现有 OCCT | ${kib(reference.raw)} | ${kib(reference.gzip)} | ${kib(reference.brotli)} |
| 本轮 Rust 实验适配器 | ${kib(size.raw)} | ${kib(size.gzip)} | ${kib(size.brotli)} |

同样使用 gzip 9、Brotli 11。Rust 候选的 Brotli 小 ${pct(1-size.brotli/reference.brotli)}%，但功能与几何能力仍未等价。该 WASM 使用原评测固定的 truck 版本和实验适配层；上游补丁在独立验证副本测试。没有把 JS 加载器/WASI 宿主体积计入引擎大小，也没有重新测量吞吐量或峰值内存。

\`\`\`sh
node benchmarks/rust-engines/check-upstream-prs.mjs
node benchmarks/rust-engines/build.mjs --step-reviewed
node benchmarks/rust-engines/run.mjs --step-reviewed
node benchmarks/rust-engines/visualize.mjs --step-reviewed
node benchmarks/rust-engines/summarize-step-reviewed.mjs
\`\`\`

新的 WASM、网格和 JSON 使用独立文件名，不覆盖前两轮结果。[完整语料、哈希与逐文件指标](assets/rust-engines/results-step-reviewed.json)。本轮仍是预览筛查，不是精确 CAD 等价验证。
`;
const json=JSON.stringify(report,null,2)+'\n';assert(!json.includes(root));
await writeFile(path.join(root,'docs/assets/rust-engines/results-step-reviewed.json'),json);
await writeFile(path.join(root,'docs/rust-step-pr-review.zh-CN.md'),markdown);
console.log(JSON.stringify(report.summary));
