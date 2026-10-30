import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { mediaWorkerAssets } from '../../scripts/media-wasm-plugin';

const root = path.resolve(__dirname, '../..');
const single = process.env.FILENS_PREVIEW_BUILD === 'all-in-one';
const packages = ['archive', 'cad', 'core', 'converter-client', 'design', 'diagram', 'docx',
  'ebook', 'iwork', 'media', 'mindmap', 'model3d', 'office', 'panorama', 'pdf', 'text', 'vue', 'xlsx'];
const alias = packages.flatMap(name => [
  { find: `@filens/${name}/style.css`, replacement: path.join(root, `packages/${name}/src/${['design', 'media', 'office', 'text', 'vue'].includes(name) ? 'style.css' : 'styles/index.css'}`) },
  ...(name === 'core' ? [{ find: '@filens/core/zip', replacement: path.join(root, 'packages/core/src/zip.ts') }] : []),
  { find: `@filens/${name}`, replacement: path.join(root, `packages/${name}/src/index.ts`) }
]);
alias.push({ find: 'filens-step', replacement: path.join(root, 'packages/step/src/index.ts') });

function embeddedAssets() {
  return {
    name: 'filens-preview-assets', enforce: 'pre' as const,
    async load(id: string) {
      if (!id.endsWith('?url')) return;
      const file = id.slice(0, -4);
      if (!/\.(wasm|mjs)$/.test(file)) return;
      const bytes = await readFile(file);
      if (single) {
        const mime = file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript';
        // Blob workers work offline and need no relative imports. WASM stays a data URL
        // so the core's existing lazy loader controls compilation and lifetime.
        return file.endsWith('.wasm')
          ? `export default ${JSON.stringify(`data:${mime};base64,${bytes.toString('base64')}`)};`
          : `export default URL.createObjectURL(new Blob([${JSON.stringify(bytes.toString())}], {type:${JSON.stringify(mime)}}));`;
      }
      const reference = this.emitFile({ type: 'asset', name: path.basename(file), source: bytes });
      return `export default import.meta.ROLLUP_FILE_URL_${reference};`;
    },
    transform(code: string, id: string) {
      if (single && id.endsWith('/iwork/src/worker/client.ts')) {
        return `import EmbeddedIworkWorker from './iwork-worker.ts?worker&inline';\n${code.replace(
          /new Worker\(new URL\('\.\/iwork-worker\.ts', import\.meta\.url\),\s*\{\s*type: 'module'\s*\}\)/,
          'new EmbeddedIworkWorker()'
        )}`;
      }
    },
    async generateBundle() {
      const notices = ['LICENSE', 'packages/step/vendor/THIRD-PARTY-NOTICES.txt',
        'packages/model3d/vendor/occt-import-js/license.occt.txt',
        'packages/model3d/vendor/occt-import-js/license.occt-import-js.txt'];
      const texts = await Promise.all(notices.map(file => readFile(path.join(root, file), 'utf8')));
      // Worker-only dependencies are absent from the main Rollup module graph.
      const dependencyRoots = new Set<string>(['@ffmpeg/core', 'libheif-js'].map(name => path.join(root, 'node_modules', name)));
      for (const id of this.getModuleIds()) {
        const offset = id.lastIndexOf('/node_modules/');
        if (offset < 0 || id.startsWith('\0')) continue;
        const segments = id.slice(offset + 14).split('/');
        dependencyRoots.add(id.slice(0, offset + 14) + segments.slice(0, segments[0].startsWith('@') ? 2 : 1).join('/'));
      }
      for (const dependency of [...dependencyRoots].sort()) {
        const metadata = JSON.parse(await readFile(path.join(dependency, 'package.json'), 'utf8'));
        const licenses = (await readdir(dependency)).filter(file => /^(licen[cs]e|notice)([.-]|$)/i.test(file));
        texts.push(`${metadata.name}@${metadata.version} (${metadata.license ?? 'see upstream'})\n\n` +
          (await Promise.all(licenses.map(file => readFile(path.join(dependency, file), 'utf8')))).join('\n\n'));
      }
      this.emitFile({ type: 'asset', fileName: 'THIRD-PARTY-NOTICES.txt', source: texts.join('\n\n') });
    }
  };
}

function embeddedStyles() {
  return {
    name: 'filens-preview-styles', enforce: 'post' as const,
    generateBundle(_options: unknown, bundle: Record<string, any>) {
      const css = Object.values(bundle).filter((item: any) => item.type === 'asset' && item.fileName.endsWith('.css'));
      const entry: any = Object.values(bundle).find((item: any) => item.type === 'chunk' && item.isEntry);
      if (entry && css.length) {
        entry.code = `if(typeof document!=="undefined"){const s=document.createElement("style");s.textContent=${JSON.stringify(css.map((item: any) => String(item.source)).join('\n'))};document.head.append(s);}\n${entry.code}`;
        for (const item of css) delete bundle[item.fileName];
      }
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [embeddedAssets(), vue(), embeddedStyles()],
  worker: { plugins: () => [mediaWorkerAssets()] },
  resolve: { alias, preserveSymlinks: true },
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: `dist/${single ? 'all-in-one' : 'split'}`,
    lib: { entry: './src/index.ts', formats: ['es'], fileName: () => 'filens.js' },
    minify: 'esbuild', cssCodeSplit: false,
    rollupOptions: { output: single ? { inlineDynamicImports: true } : {
      chunkFileNames: 'chunks/[name]-[hash].js',
      manualChunks(id) {
        if (id.includes('/node_modules/pdfjs-dist/')) return 'pdf';
        if (id.includes('/node_modules/')) return 'vendor';
        for (const name of ['iwork', 'model3d', 'core', 'panorama', 'archive', 'docx', 'xlsx', 'ebook', 'cad', 'mindmap', 'diagram']) {
          if (id.includes(`/packages/${name}/`)) return name;
        }
      }
    } }
  }
});
