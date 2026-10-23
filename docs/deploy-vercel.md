# Deploy to Vercel / 部署到 Vercel

## 中文

1. 将代码推送到 GitHub，在 Vercel 中选择 **Add New → Project** 并导入仓库。
2. **Root Directory 保持仓库根目录**，不要改成 `apps/demo`。
3. 点击 **Deploy**。仓库的 `vercel.json` 已配置安装命令、构建命令和输出目录，无需设置环境变量。绑定 GitHub 后，推送代码会自动部署，PR 会生成预览地址，不需要额外 workflow。

部署后的 `/` 是产品首页；`/?lang=zh` 和 `/?lang=en` 可分别分享中文和英文版本。`/?view=preview` 打开预览工作台。将 Vercel 分配的正式域名填入 GitHub 仓库的 **About → Website** 即可。

构建会先用仓库锁定的 Rust 工具链生成两个 WASM 转换模块，再构建前端。首次构建需要下载工具链和依赖。文件预览和转换在浏览器内运行，不需要额外部署服务端。

首页的八种示例、本地文件上传和演示视频可独立使用。工作台中从 ZimaOS 主机存储读取的扩展示例需要对应的 NAS 环境，在 Vercel 上可改用本地文件。原有 NAS 构建仍默认使用 `/modules/filens/`。

本地验证 Vercel 构建：

```sh
npm ci
npm run build:vercel
npm run preview --workspace @filens/demo -- --base=/ --host 127.0.0.1 --port 4175
```

在另一个终端运行首页检查：

```sh
FILENS_E2E_BASE_URL=http://127.0.0.1:4175/ npx playwright test apps/demo/e2e/landing.e2e.ts
```

## English

1. Push the code to GitHub, then select **Add New → Project** in Vercel and import the repository.
2. Keep **Root Directory at the repository root**, rather than `apps/demo`.
3. Select **Deploy**. `vercel.json` supplies the install command, build command, and output directory. No environment variables are required. Vercel's Git integration automatically deploys pushes and creates PR previews; a separate workflow is unnecessary.

The product homepage lives at `/`. Share `/?lang=zh` for Chinese or `/?lang=en` for English; `/?view=preview` opens the workbench. Add the production domain assigned by Vercel to the repository's **About → Website** field.

The build generates both WASM converters from source using the repository's pinned Rust toolchain, then builds the frontend. The first build downloads the toolchain and dependencies. Preview and conversion run in the browser, so a separate application server is unnecessary.

All eight homepage examples, local uploads, and the walkthrough work independently. Additional workbench samples that read ZimaOS host storage require the corresponding NAS environment; use local files on Vercel. Existing NAS builds continue to default to `/modules/filens/`.

Use the commands above to validate the Vercel build locally and run the homepage checks against the production output.

## Output directory error / 找不到输出目录

如果出现 `No Output Directory named "dist" found`，先确认 Vercel 部署的分支和提交已包含根目录的 `vercel.json`、`scripts/build-vercel.mjs` 及对应的 `package.json` 改动。本地尚未提交或推送的配置不会被 Git 集成部署读取。

在 **Project Settings → Build and Deployment** 核对以下设置，然后部署包含配置的新提交：

| Setting | Value |
| --- | --- |
| Root Directory | 仓库根目录 / repository root (`.`) |
| Build Command | `npm run build:vercel` |
| Output Directory | `apps/demo/dist` |
| Install Command | `npm ci` |

输出目录相对于 Root Directory。不要将仓库根目录的默认 `dist` 当作演示站输出，也不要将 Root Directory 改为 `apps/demo` 后继续填写 `apps/demo/dist`。

For `No Output Directory named "dist" found`, verify that the deployed branch and commit include the root `vercel.json`, `scripts/build-vercel.mjs`, and matching `package.json` changes. Git deployments cannot read local uncommitted or unpushed files. Check the settings above, then deploy the new commit containing the configuration. Output Directory is relative to Root Directory; the demo emits `apps/demo/dist` from the repository root.

## Optional GitHub Actions / 可选的 GitHub Actions

只有需要从 GitHub Actions 控制正式发布时，才使用 [Deploy to Vercel](../.github/workflows/deploy-vercel.yml)。该流程仅支持 `main` 分支，采用手动触发，避免与 Vercel Git 集成重复发布。

先在 Vercel 创建或导入项目，Root Directory 保持仓库根目录。在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 配置：

| Secret | 来源 / Where to find it |
| --- | --- |
| `VERCEL_TOKEN` | Vercel Account Settings → Tokens |
| `VERCEL_ORG_ID` | Vercel team/account ID; also `orgId` in the local `.vercel/project.json` after `vercel link` |
| `VERCEL_PROJECT_ID` | Vercel Project Settings → General → Project ID |

随后在 **Actions → Deploy to Vercel → Run workflow** 选择 `main`。流程会生成 WASM、构建前端并发布正式站点，完成后在运行摘要显示部署地址。密钥缺失时会在构建前明确报错。

Use this workflow only when you want to control production releases from GitHub Actions. Create/import the Vercel project first, keep its root directory at the repository root, and add the three repository secrets above. Run **Actions → Deploy to Vercel → Run workflow** on `main`. It builds the WASM modules and frontend, deploys production, and prints the deployment URL in the run summary. It is manual to avoid duplicate deployments alongside Vercel's Git integration.
