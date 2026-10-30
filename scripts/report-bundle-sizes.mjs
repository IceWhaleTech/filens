import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'apps/demo/dist');
const labels = {
  'converter-core': ['转换核心 WASM', 'Conversion core WASM'],
  'converter-image': ['图像 / RAW 核心 WASM', 'Image / RAW core WASM'],
  index: ['演示站入口', 'Demo entry'],
  vendor: ['共享第三方依赖', 'Shared vendor dependencies'],
  core: ['PPTX / 核心运行时', 'PPTX / core runtime'],
  preview: ['Vue 预览容器', 'Vue preview host'],
  office: ['DOCX / XLSX / PDF', 'DOCX / XLSX / PDF'],
  'pdf-runtime': ['PDF 按需引擎', 'On-demand PDF engine'],
  iwork: ['iWork 预览', 'iWork preview'],
  design: ['CAD / 思维导图 / 流程图', 'CAD / mind maps / diagrams'],
  model3d: ['3D 预览', '3D preview'],
  media: ['媒体 / 全景预览', 'Media / panorama preview'],
  archive: ['压缩包预览', 'Archive preview'],
  text: ['文本 / 电子书', 'Text / ebooks'],
  'iwork-worker': ['iWork Worker', 'iWork worker'],
  'pdf.worker.min': ['PDF Worker', 'PDF worker'],
  'filens-step': ['STEP Rust WASM（默认）', 'Rust STEP WASM (default)'],
  'step-runtime': ['STEP Rust 加载器', 'Rust STEP loader'],
  'occt-import-js': ['STEP OCCT WASM（显式可选）', 'OCCT STEP WASM (explicit option)'],
  'occt-runtime': ['STEP OCCT 加载器', 'OCCT STEP loader']
};
const order = Object.keys(labels);
const groups = new Map();
const assets = (await readdir(path.join(dist, 'assets'))).filter(file => /\.(?:js|mjs|css|wasm)$/.test(file));
for (const file of [...assets.map(file => `assets/${file}`), 'externals/converter-core.wasm', 'externals/converter-image.wasm']) {
  const name = path.basename(file).replace(/-[\w-]{8}(?=\.)/, '').replace(/\.(?:js|mjs|css|wasm)$/, '');
  const row = groups.get(name) ?? { name, files: [], raw: 0, gzip: 0, brotli: 0 };
  row.files.push(file);
  row.raw += (await stat(path.join(dist, file))).size;
  row.gzip += (await stat(path.join(dist, `${file}.gz`))).size;
  row.brotli += (await stat(path.join(dist, `${file}.br`))).size;
  groups.set(name, row);
}
const rows = [...groups.values()].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
const size = bytes => `${(bytes / 1024).toFixed(1)} KiB`;
function updateSizeLabels(source) {
  return source.replace(/<!-- bundle-size:([\w-]+) -->[\s\S]*?<!-- \/bundle-size -->/g, (_match, name) => {
    const row = groups.get(name);
    if (!row) throw new Error(`Missing bundle group for size label: ${name}`);
    return `<!-- bundle-size:${name} -->${(row.brotli / 1024).toFixed(1)}<!-- /bundle-size -->`;
  });
}
const table = (selection, lang) => [
  lang === 'zh' ? '| 分包 / 核心 | 原始 | gzip | Brotli |' : '| Module / core | Raw | gzip | Brotli |',
  '| --- | ---: | ---: | ---: |',
  ...selection.map(row => `| ${labels[row.name]?.[lang === 'zh' ? 0 : 1] ?? row.name} | ${size(row.raw)} | ${size(row.gzip)} | **${size(row.brotli)}** |`)
].join('\n');
const html = await readFile(path.join(dist, 'index.html'), 'utf8');
const initialFiles = [...new Set([...html.matchAll(/(?:src|href)="[^"]*?(assets\/[^"?]+\.(?:js|mjs|css))"/g)].map(match => match[1]))];
const initial = { raw: 0, gzip: 0, brotli: 0 };
for (const file of initialFiles) {
  initial.raw += (await stat(path.join(dist, file))).size;
  initial.gzip += (await stat(path.join(dist, `${file}.gz`))).size;
  initial.brotli += (await stat(path.join(dist, `${file}.br`))).size;
}
await mkdir(path.join(root, 'docs/assets'), { recursive: true });
await writeFile(path.join(root, 'docs/assets/bundle-sizes.json'), `${JSON.stringify({ unit: 'bytes', rows, initial: { ...initial, files: initialFiles } }, null, 2)}\n`);

for (const lang of ['en', 'zh']) {
  const file = path.join(root, lang === 'en' ? 'README.md' : 'README.zh-CN.md');
  const source = updateSizeLabels(await readFile(file, 'utf8'));
  const highlights = rows.filter(row => ['converter-core', 'converter-image', 'media', 'filens-step'].includes(row.name));
  const rest = rows.filter(row => !highlights.includes(row));
  const section = lang === 'zh'
    ? `${table(highlights, lang)}\n\n文档、图像 / RAW 与 STEP 的 WASM 模块独立按需加载；媒体预览模块与图像转换核心分别计量。JS 分包已包含对应 CSS，共享依赖和 Worker 单列。\n\n<details>\n<summary>展开查看全部分包及首屏成本</summary>\n\n${table(rest, lang)}\n\n本次构建的入口、预加载 JS 与 CSS 合计 **${size(initial.brotli)} Brotli**（原始 ${size(initial.raw)} / gzip ${size(initial.gzip)}），另计图片、视频和示例文件。模块会共享依赖；上述体积不代表每种格式的独立总下载量。\n\n</details>\n\n数据来自实际演示站构建。压缩列是产物体积，实际传输取决于托管配置。[完整报告与复现方式](docs/bundle-sizes.md)。`
    : `${table(highlights, lang)}\n\nDocument, image / RAW, and STEP WASM modules load independently on demand. Media preview and image conversion are measured separately. JS rows include their CSS; shared dependencies and workers are listed separately.\n\n<details>\n<summary>All modules and initial loading cost</summary>\n\n${table(rest, lang)}\n\nEntry, preloaded JS, and CSS total **${size(initial.brotli)} Brotli** (${size(initial.raw)} raw / ${size(initial.gzip)} gzip), plus images, video, and samples. Modules share dependencies; these rows are not standalone per-format download totals.\n\n</details>\n\nMeasured from the demo build. Compression columns describe artifacts; actual transfer depends on hosting. [Full report and reproduction](docs/bundle-sizes.md).`;
  const marker = new RegExp(`<!-- bundle-sizes:${lang}:start -->[\\s\\S]*?<!-- bundle-sizes:${lang}:end -->`);
  if (!marker.test(source)) throw new Error(`Missing size markers in ${file}`);
  await writeFile(file, source.replace(marker, `<!-- bundle-sizes:${lang}:start -->\n${section}\n<!-- bundle-sizes:${lang}:end -->`));
}
const landingPage = path.join(root, 'apps/demo/src/components/LandingPage.vue');
await writeFile(landingPage, updateSizeLabels(await readFile(landingPage, 'utf8')));
const report = `# Bundle sizes / 分包体积\n\nGenerated from the production demo by \`npm run report:bundle-sizes\`. Units are KiB (1 KiB = 1024 bytes). JavaScript and its matching CSS are grouped; WASM and workers are separate.\n\n${table(rows, 'en')}\n\nInitial entry, preload, and CSS: **${size(initial.raw)} raw / ${size(initial.gzip)} gzip / ${size(initial.brotli)} Brotli**. This excludes HTML, imagery, video, sample files, and later requests. Shared vendor dependencies are included here and must be considered when reading individual module sizes. Optional STEP uses its separate WASM asset; PDF and iWork have separate workers.\n\n[Exact byte counts and file names](assets/bundle-sizes.json). Compression measurements use the actual build's gzip and Brotli artifacts; server negotiation and caching determine real network transfer. This is a build snapshot, not the size of a published npm tarball.\n\n## Reproduce / 复现\n\n\`\`\`sh\nnpm ci\nnpm run build:vercel\nnpm run report:bundle-sizes\n\`\`\`\n\nThe report updates both README tables and the document core size labels in the READMEs and homepage. The normal NAS build can also be measured with \`npm run build:wasm && npm run build:demo\`; asset URLs may change the entry size slightly.\n\n本报告对应实际演示站产物，单位为 KiB。JS 与各自 CSS 合并计量，WASM、Worker 和共享第三方依赖独立列出。单个分包体积不等于该格式的全部下载成本；完整首屏还包括 HTML、图片、视频、样例及按需请求。压缩列为构建产物体积，实际网络传输取决于托管配置。\n`;
await writeFile(path.join(root, 'docs/bundle-sizes.md'), report);
console.log(table(rows, 'en'));
