# Windows x64 测试与构建

Windows 10/11 x64 使用 RapidOCR NCNN，无需 Python 环境；最大边长 960、补边 50、OpenMP 2 线程。CLI 是 Rust，文档解析、转换、布局归一化仍在共享 WASM 核心。Windows ARM64 暂不提供原生构建。

0.3.0 提供 Windows npm 包。当前 macOS 主机只能完成交叉编译、PE/DLL 检查和 UPX 校验；Windows 原生运行结果需要补充。npm `0.2.0` 不含 Windows 包。

## 安装当前版本

```powershell
npm install -g filens-cli@0.3.0
filens capacity --json
filens '读取 "report.pdf"，以 JSON 输出'

# 或选择轻量版，需要时补装 OCR
npm install -g filens-cli-lite@0.3.0
filens setup-ocr
```

两种入口选择一种安装。Windows 内部组件使用 `@orca.zhang/filens-cli-win32-x64` 与 `@orca.zhang/filens-ocr-win32-x64`，由 npm 自动选择；用户入口仍为无 scope 的 `filens-cli` / `filens-cli-lite`。安装包包含当前搜索、嵌套压缩包及原文摘录功能；下文旧候选 ZIP 的测试结果不能代替 0.3.0 的实机验证。

## 早期候选 ZIP 测试，无需编译

解压 `filens-0.3.0-rc.1-win32-x64-full.zip`，在该目录打开 PowerShell：

```powershell
.\filens.exe capacity --json
.\filens.exe '识别 "test-fixtures\invoice-zh.png" 中的文字，以 JSON 输出'
.\filens.exe layout test-fixtures\scan.pdf --format yaml

# 自动测试脚本需要 Node.js 20.11+；filens.exe 本身不需要 Node.js
node .\test-windows.mjs --report .\filens-windows-test.json
```

脚本检查中英文意图、JSON stdin、八种输出、文档/RAW 转换、覆盖保护、图片预处理、扫描 PDF、内嵌图片回调、布局坐标、中文安装目录、无 Node/Python 的子进程 PATH 和请求超时。测试使用随包附带的公开合成样例，不能代表通用 OCR 准确率。报告留在本地。

Lite ZIP 不包含模型和 DLL，直接读取文本、转换文档；扫描件应返回 `ocr_failed`。Lite ZIP 的自动测试会验证这项行为。npm Lite 提供 `filens setup-ocr` 按需补装。

## 交给 Windows 上的 Agent 的提示词

复制下面整段即可，先把 ZIP 放到 Windows 机器上：

```text
请在这台 Windows x64 机器上实测 FiLens CLI 的 0.3.0-rc.1 候选版。

优先使用我提供的 Full/Lite ZIP，不必先编译。找到两个解压目录，确认
filens.exe、三个 .wasm.gz 资源，以及 Full 的 native DLL 和 models 都在。
先记录 Windows、CPU、Node 的版本，分别运行 capacity --json 和随包的
node test-windows.mjs --report <不同文件名>.json，保留完整测试报告。

重点核对：RapidOCR 确实加载，最大边长 960、padding 50、线程 2；订单号
FILENS2026 与金额 12345.67；透明、EXIF 和倒置图片；两页扫描 PDF；Word
内嵌图片的 OCR 回调；PDF 的 pt 坐标与图片的 px 坐标；中文目录及带空格
路径；八种输出格式；文档与 RAW 转换；覆盖保护；请求超时和临时文件清理。
确认 Lite 未安装 OCR 时扫描件返回明确的不完整错误。再用 npm 离线 tarball
安装 Full/Lite，测试 filens 命令入口，以及 Lite 的 setup-ocr 安装过程。

如果有源码工作区，先读 AGENTS.md，保持文档解析和转换在前端 WASM 核心中。
系统 OCR 不在这次范围内，不引入 Python 私有环境。二进制使用 UPX 压缩；
不要将 npx 当作压缩工具。若本机有 UPX，额外运行 upx --test filens.exe。

若发现故障，定位并修复，重新执行失败项及相关回归。只有 ZIP 缺失或需要
修复源码时再按本文的源码构建流程安装工具和构建。不要修改 npm 0.2.0，
也不要自动发布包。最后用中文给出通过/失败项、错误码、实际 OCR 输出、
耗时和文件体积，并提供可分享的报告；隐藏用户名、主目录、私有文档正文
和凭据。编译成功与 Windows 运行通过必须分别记录。
```

## 在 Windows 本机构建

源码构建需要 Git、Node.js 20.11+、rustup、Go 1.25.6、CMake、Ninja、Zig 0.16.0，并把这些命令加入 PATH。使用工作区的最新改动，Rust/WASI 工具链由仓库固定。

```powershell
npm ci
rustup target add --toolchain 1.93.0 wasm32-wasip1 x86_64-pc-windows-gnu
cargo install cargo-zigbuild --locked --version 0.24.0
node scripts/setup-agent-upx.mjs

npm run build:agent
npm run build:agent:lite
npm run test:agent
npm run test:agent:layout
node scripts/package-agent-npm.mjs --platform win32-x64
npm run test:agent:npm
node scripts/package-agent-windows.mjs
```

NCNN 与 OCR wrapper 从固定哈希的源码构建。Windows 适配只处理 DLL 加载、UTF-16 模型文件路径和 SimpleOMP 的一次性初始化，不引入文档解析算法。资源使用 gzip；Windows 和 Linux 的 CLI 使用 UPX `--best --lzma` 并执行 `--test`，macOS arm64 因 UPX 不支持而跳过。需要比较未压缩构建时，为构建/打包脚本加 `--no-upx`。

0.3.0 完整包离线安装示例（在 tarball 所在目录运行）：

```powershell
npm install -g .\filens-cli-0.3.0.tgz .\orca.zhang-filens-cli-win32-x64-0.3.0.tgz .\orca.zhang-filens-ocr-win32-x64-0.3.0.tgz
filens capacity --json
```

0.3.0 正式版使用 `latest` 标签；后续候选版本使用 `next`。该文档本身不表示 Windows 实机测试已通过，注册表发布记录与本机安装结果见 [npm 发布验证](agent-cli-npm-publish.json)。
