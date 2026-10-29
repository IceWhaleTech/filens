# truck 上游 PR 交付包

目标仓库：https://github.com/ricosjp/truck 。基于 2026-10-30 检查的 HEAD：`1ca3214e537004d466addbd85d6375807147a426`。三份 PR 已发布，均为非草稿，目标分支为 `master`。

已拆成三份独立 PR。每份补丁均包含独立的合成回归测试，不需要分发第三方 STEP 文件；均检查过可单独应用到上述 HEAD，也检查了组合应用。

| PR | 补丁 | 可直接使用的英文描述 | 目标回归测试 |
| --- | --- | --- | ---: |
| [#138 方向比例和坐标系](https://github.com/ricosjp/truck/pull/138) | [0001](0001-normalize-step-placement-directions.patch) | [PR 1](pr-1-directions.md) | 9 |
| [#139 可省略的装配描述](https://github.com/ricosjp/truck/pull/139) | [0002](0002-honor-optional-assembly-descriptions.patch) | [PR 2](pr-2-descriptions.md) | 5 |
| [#140 非有限曲线细分保护](https://github.com/ricosjp/truck/pull/140) | [0003](0003-stop-nonfinite-curve-subdivision.patch) | [PR 3](pr-3-subdivision.md) | 6 |

发布后已核对三个 PR 的目标分支、提交、改动文件和正文；均处于 OPEN 状态且没有合并冲突。检查时 GitHub 未报告 CI 检查结果，不能视为 CI 已通过。发布记录见 [pull-requests.json](pull-requests.json)。

原代码在三组测试中分别失败 8、2、4 项；补丁后这 20 项全部通过。另有 Filens 实验核心的 10 项单位与表示关系测试通过，共 30 项。机器可读记录与补丁 SHA-256 在 [validation.json](validation.json)。

验证使用 Rust 1.93。当前 HEAD 的 parking_lot 0.13 要求 Rust 1.95，因此本地测试副本仅将 truck-topology 的 parking_lot / rclite 依赖范围恢复到前一提交的 0.12.5 / 0.4.1。测试的 Rust 算法源码来自上述 HEAD 加补丁，交付补丁不包含这个依赖调整。**尚未验证 HEAD 的原始完整依赖图，也未运行整个上游测试集。** 完整测试集还需要其 resources 子模块；新增测试均使用内联数据。

PR 2 把公开解析结构的 description 字段改为 Option<String>，符合 STEP 可省略语义，但使用结构体字面量的调用方需要迁移。此项必须在上游 PR 中说明；PartAttrs 的 description 继续输出 String。

在 truck 的干净分支中可分别执行：

```sh
git switch -c fix/step-direction-ratios
git apply /path/to/0001-normalize-step-placement-directions.patch
cargo test -p truck-stepio --test import_direction_ratios
```

另外两份分别使用独立分支，应用对应补丁，然后运行：

```sh
cargo test -p truck-stepio --test import_optional_descriptions
cargo test -p truck-geotrait --test curve_division_nonfinite
```

使用能构建当前 HEAD 的 Rust 工具链执行这些上游命令。在 Filens 工作区重跑本地验证：

```sh
node benchmarks/rust-engines/check-upstream-prs.mjs
```

该脚本检查独立及组合应用，在临时副本应用兼容依赖，先运行原代码证明测试可捕捉问题，再运行补丁和实验核心测试；不会推送分支或创建远程 PR。需要已准备好评测的 Cargo 依赖缓存，测试使用 --offline。

Filens 的完整 WASM 复测目前为 44/44 含实体文件有网格、40/44 通过几何筛查。这个成绩还依赖实验适配层的单位/容差换算、表示关系遍历、标注/线框筛选和 PCurve 兼容处理，**不代表只合入这三份 PR 就能达到 40/44**。这些适配代码尚未作为通用上游修复提交。

后续问题及复现证据见 [remaining-issues.md](remaining-issues.md)；完整实验结果见 [复查报告](../../rust-step-pr-review.zh-CN.md)。
