# Rust STEP 浏览器接入与发布候选

2026-10-30。Rust STEP 已接入浏览器默认预览，独立包为
`filens-step@0.1.0-rc.1`。**按用户要求等待其他改动，尚未发布 npm。**
本次不扩展或发布 CLI；后续统一发布前应重新构建、打包和核对体积。

## 接入范围

`packages/step` 提供 `readStep`、`createStepReader`，无运行时 npm 依赖。
STEP 解析、单位换算、装配位置和三角化均在
`wasm/converter-step-rust` 的 Rust/WASM 核心完成。TypeScript 只提供
共享的内存 WASI 宿主、调用和结果检查，返回以毫米计的非索引 Float32
顶点、法线、三角形数量、元数据和警告；没有添加 Go 转换算法。

`@filens/model3d` 默认使用该库，首次打开 STEP 才下载 WASM，后续复用
编译模块，每次调用独立分配实例和虚拟文件。保留显式核对入口：

```ts
await loadStepObject(buffer); // Rust
await loadStepObject(buffer, { stepEngine: 'occt' }); // 显式使用旧 OCCT
```

默认路径不会自动下载 OCCT。取消信号覆盖异步加载；同步网格生成不能在
同一个 JS 线程内中断，大模型可由调用方放入 Worker。默认容差为 0.1 mm，
输入上限为 64 MiB。源码颜色、名称、装配树及多文件外部装配加载尚未实现。

## 体积

以下为实际候选文件测量，1 KiB = 1024 B；gzip 为级别 9，Brotli 为级别 11。

| 产物 | 原始 | gzip | Brotli |
| --- | ---: | ---: | ---: |
| Rust STEP WASM | 925.02 KiB | 326.26 KiB | **254.53 KiB** |
| 独立 JS 加载器与 WASI 宿主 | 16.19 KiB | 5.00 KiB | **4.48 KiB** |
| 旧 OCCT WASM，保留为显式可选项 | 2625.76 KiB | 1020.16 KiB | 797.05 KiB |

Rust 的独立 JS + WASM 两文件分别压缩后，Brotli 合计 **259.01 KiB**，
不含 Three.js、预览界面、HTTP 开销及宿主已有共享依赖。
Rust WASM 本身比旧 OCCT 的 Brotli WASM 小约 **68.1%**。

实际 npm tarball 为 **363,157 B / 354.65 KiB**，解包文件合计
**1,280,967 B / 1,250.94 KiB**。它还包含类型声明、README、来源清单和
依赖许可文本；不等于 WASM 单体体积，也不含 npm 缓存或文件系统分配开销。
精确字节、文件列表、哈希和安装检查见[候选记录](rust-step-browser-release.json)。

## 集成时修复的法线问题

`cax-if/s1-tu-203/headback.stp` 有 43,746 个输出顶点，其中 12 个原始法线
含非有限值，旧评测只检查了顶点位置。新浏览器读取器拒绝了该结果。
现在 Rust 输出层以三角形几何法线替代无效或零长度法线，异常数降至 0；
该样例的全部三角形位置与朝向经精确哈希核对保持不变。
见[前后回归证据](assets/rust-engines/browser-normal-regression.json)。

此修复在前端 Rust 适配层，独立于已提交的
[truck PR #141](https://github.com/ricosjp/truck/pull/141)。修复前实验 WASM
的 254.85 KiB 数据保留在[曲面细化报告](rust-step-refined.zh-CN.md)，
当前候选的 254.53 KiB 来自重新构建，未混用旧二进制。

## 验证与限制

- 浏览器 WASI 宿主执行完整 55 文件语料：44/44 含实体文件输出有限的顶点
  与法线、无缺面，三角形/面/实例数量和 Float32 包围盒与原评测一致；
  另外 11 个仅含外部引用的文件明确报错。[逐文件记录](assets/rust-engines/browser-integration.json)。
- 真实 Chromium 演示站测试确认首次 STEP 下载一次 Rust WASM，第二次打开复用，
  OCCT 下载数为 0。
- npm tarball 离线安装、独立 TypeScript 消费端、真实 Chromium 读取、延迟下载
  与无效输入后的恢复均通过，测试使用安装后的 ESM 和随包 WASM。
- 库的 6 项真实 WASM 测试、共享转换客户端的 60 项测试、3D 预览的 312 项测试通过。

**几何筛查仍为 43/44。** `cax-if/s1-c5-214/HEAD_BACK.stp` 的球面区域与
朝向差异仍未解决，它与本次修复法线的 `s1-tu-203/headback.stp` 是不同文件。
本次完整语料接入检查未重新执行 OCCT 双向距离筛查，也不把“有网格”解释为
几何等价。此库用于近似预览，不能承诺任意曲面的最大误差或精密 CAD 转换。

## 复现

```sh
npm run build:step:wasm # 仅重建 Rust 核心时需要，使用固定工具链与锁文件
npm run build:step
npm run test --workspace filens-step
node scripts/test-step-corpus.mjs # 需要已准备的公开 STEP 语料
npm run package:step:npm
npm run test:step:npm
npm run report:step:npm
```

候选 tarball 位于 `dist/step-npm/`。发布仍暂停；待其他改动齐备后统一验证，
再按 `next` 标签发布。普通库构建核对随仓库保存的源码/锁/补丁/WASM 哈希，
不要求安装 Rust；重建步骤和二进制来源见[核心说明](../wasm/converter-step-rust/README.md)。
