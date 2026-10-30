import { spawn } from 'node:child_process';
import { readdir, readFile, mkdir, writeFile, cp, rm } from 'node:fs/promises';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReleaseDirectory } from './agent-release-privacy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'packages/preview');
const measurements = {};
for (const mode of ['split', 'all-in-one']) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'], {
      cwd: directory, env: { ...process.env, FILENS_PREVIEW_BUILD: mode }, stdio: 'inherit'
    });
    child.on('error', reject); child.on('exit', code => code ? reject(new Error(`preview ${mode} build failed`)) : resolve());
  });
  const dist = path.join(directory, 'dist', mode);
  await assertReleaseDirectory(dist);
  const files = await measure(dist);
  const runtime = files.filter(file => /\.(js|mjs|wasm)$/.test(file.file));
  if (mode === 'all-in-one' && (runtime.length !== 1 || runtime[0].file !== 'filens.js')) {
    throw new Error('All-in-one build contains external runtime files');
  }
  measurements[mode] = { files, total: Object.fromEntries(['raw', 'gzip', 'brotli'].map(key => [key, runtime.reduce((n, f) => n + f[key], 0)])) };
  await writeFile(path.join(dist, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>filens preview</title>
<style>html,body,#preview{height:100%;margin:0}body{font-family:system-ui}#picker{position:fixed;z-index:100;top:12px;right:16px;background:white;padding:8px;border:1px solid #ddd;border-radius:6px}#picker input{max-width:220px}</style>
<label id="picker">Open file <input type="file" id="file"></label><div id="preview"></div>
<script type="module">
import { createPreview } from './filens.js';
let preview;
const open = options => { document.body.dataset.state='loading'; delete document.body.dataset.error; preview?.destroy(); preview = createPreview('#preview', {
  ...options, onRendered: () => { document.body.dataset.state='ready'; },
  onError: error => { document.body.dataset.state='error'; document.body.dataset.error=error.message; }
}); };
document.querySelector('#file').onchange = event => { const file=event.target.files[0]; if(file) open({src:file,name:file.name}); };
// The CLI serves metadata and file bytes from its local, token-scoped HTTP server.
if (new URL(location.href).searchParams.has('cli')) {
  const response = await fetch('./source.json');
  if (!response.ok) throw new Error('Cannot open preview source');
  const source = await response.json(); open({src:source.url,name:source.name});
}
</script></html>\n`);
}
await rm(path.join(root, 'dist/preview'), { recursive: true, force: true });
await mkdir(path.join(root, 'dist/preview'), { recursive: true });
await cp(path.join(directory, 'dist/split'), path.join(root, 'dist/preview'), { recursive: true });
await cp(path.join(directory, 'src/public.d.ts'), path.join(directory, 'dist/index.d.ts'));
await cp(path.join(root, 'LICENSE'), path.join(directory, 'LICENSE'));
await writeFile(path.join(root, 'docs/preview-build-sizes.json'), `${JSON.stringify({ date: new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai'}).format(new Date()), unit:'bytes', scope:'Standalone runtime, including Vue, CSS, workers and document/image/STEP WASM; excludes HTML, notices, maps and source files.', builds:measurements }, null, 2)}\n`);

async function measure(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const file = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await measure(directory, file));
    else if (/\.(js|mjs|wasm)$/.test(file)) {
      const bytes = await readFile(path.join(directory, file));
      files.push({ file: file.replaceAll(path.sep, '/'), raw: bytes.length, gzip: gzipSync(bytes, { level:9 }).length,
        brotli: brotliCompressSync(bytes).length });
    }
  }
  return files;
}
