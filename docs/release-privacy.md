# 发布隐私检查

本次检查覆盖 Git 工作区与暂存区、PDF 公开报告、当前 CLI/WASM、三个平台的
8 个 npm 候选 tarball。检查针对本机私有样本的标识和正文片段、个人目录、签名下载
URL、常见凭据和私钥特征，并核对文件白名单。结果见
[机器可读审计摘要](release-privacy-audit.json)。这是一组有明确范围的检查，
不构成对任意文件、历史版本或未知秘密格式的保证。

## 私有样本与公开报告

- 本机私有 PDF 的文件名、路径、文件/正文哈希和正文检查词已从仓库文档、
  公开 JSON 与评估脚本中移除；更早的本机评估数据仅留在 Git 忽略缓存。
- `scripts/evaluate-pdf-unicode.py` 的 `--local-pdf` 与 `--local-checks`
  不会把私有样本加入 `--report`。私有报告和原始响应只能写到仓库外或被 Git 忽略的位置。
- 公开 PDF 报告仅包含公开问题附件、公开指南样本及项目自己创作的对照 PDF。
  错误只保留错误码，完整响应留在本机缓存。下载清单仅保留稳定来源地址，不保存签名重定向地址。
- `tmp/`、`dist/` 和编译缓存被 Git 忽略。npm 使用文件白名单，拒绝混入
  PDF/Office 文件、原始评估报告、环境文件和模型下载测速报告。
- Finder 的 `.DS_Store` 已从暂存区移除，并加入 Git 忽略规则。

工作区与暂存区还命中一个既有 DWG 测试样本中的 Windows 作者路径。
已逐字节核对该文件与 ACadSharp 的公开原件一致，来源见
[`converter/testdata/SOURCES.md`](../converter/testdata/SOURCES.md)。这是上游公开样本的
原有元数据，保留原件用于回归；不属于本机私有 PDF，也不进入 npm 包。
审计摘要单独记录该命中，未将其当作误报或声称仓库完全没有个人路径。

普通 CLI JSON 响应会返回调用方的 `source.path` 和文档正文。这是本地读取协议，
不是匿名报告格式，分享前应移除不希望公开的信息。读取与 OCR 本身不上传文件；
安装、模型下载及公开样本下载会访问各自的公开来源。

## 二进制构建与发布检查

1. `build-agent-cli.mjs` 用 Rust `--remap-path-prefix` 去除构建机的用户目录、
   Cargo/Rustup 路径和项目绝对路径。Go CLI 使用 `-trimpath`。
2. 三个平台的 OCR wrapper 都从同一个 SHA-256 固定的源码快照重新构建，并使用
   Go `-trimpath`。macOS 最低目标为 12.0；Linux 使用 Zig 0.16.0，目标 glibc 2.17。
   已安装的用户仍使用预编译包，无需编译器。`wrapper-build.json` 记录源码与产物哈希。
3. `agent-release-privacy.mjs` 检查目录与真实 tarball 内容，发现个人构建路径、
   签名 URL、凭据或私钥特征时拒绝打包/发布，错误消息不打印匹配内容。
   发布脚本在 npm 身份查询、注册表检查和任何发布操作前完成本地检查。
4. 过期 tarball 移到 Git 忽略的本机隔离目录，避免 CI 的 `*.tgz` 上传规则带上旧包。
   `release.json` 只列本次候选包及其哈希。

本机已完成 macOS 候选包的离线 Full/Lite 安装、原生 OCR 与一键补装验证。
Linux 候选包完成交叉构建、内容检查和 glibc 符号版本检查，未在本机执行 Linux 二进制；
CI 的 Linux 原生安装测试仍需单独运行。

## 已发布版本的边界

只读核对确认：已发布的 **0.1.0** macOS 核心包和 Linux OCR 包与检查到的旧 tarball
一致，其中包含开发机构建路径。没有在这些产物中发现本次私有 PDF 的标识或正文，
也没有发现所检查的凭据/私钥特征。旧版本已经公开，不能声称本次本地清理撤回了它们。

本轮只重建候选包，没有执行对外发布、撤包或历史重写。当前候选与旧版本不是相同
字节，须作为新版本发布；发布脚本仍校验不可变版本，拒绝把不同 tarball 当作已有版本跳过。

## 复测

```sh
npm run test:agent:privacy
npm run build:agent
node scripts/package-agent-npm.mjs --all
npm run test:agent:npm
```

源码打包 Linux 还需要 Zig（可用 `FILENS_ZIG` 指定）；macOS NCNN 首次构建需要
CMake 与 Xcode 命令行工具。上述命令不执行注册表发布。
