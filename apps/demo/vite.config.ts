import { defineConfig } from 'vite';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import path from 'node:path';
import vue from '@vitejs/plugin-vue';
import { occtWasmAsset } from '../../scripts/occt-wasm-plugin';
import { stepWasmAsset } from '../../scripts/step-wasm-plugin';
import { mediaWorkerAssets } from '../../scripts/media-wasm-plugin';
import { agentSkillAsset } from './agent-assets';

const compressibleAssets = /\.(?:css|html|js|json|mjs|wasm)$/;

function precompressAssets() {
  let outputDir: string | undefined;
  return {
    name: 'filens-precompress-assets',
    apply: 'build' as const,
    enforce: 'post' as const,
    configResolved(config: { root: string; build: { outDir: string } }) {
      outputDir = path.resolve(config.root, config.build.outDir);
    },
    generateBundle(_options: unknown, bundle: Record<string, { type: string; code?: string; source?: string | Uint8Array }>) {
      for (const [fileName, output] of Object.entries(bundle)) {
        if (!compressibleAssets.test(fileName)) continue;
        const source = output.type === 'chunk' ? output.code : output.source;
        if (source === undefined) continue;
        const bytes = typeof source === 'string' ? Buffer.from(source) : Buffer.from(source);
        this.emitFile({
          type: 'asset',
          fileName: `${fileName}.gz`,
          source: gzipSync(bytes, { level: 9 })
        });
        this.emitFile({
          type: 'asset',
          fileName: `${fileName}.br`,
          source: brotliCompressSync(bytes, {
            params: { [constants.BROTLI_PARAM_QUALITY]: 11 }
          })
        });
      }
    },
    async closeBundle() {
      if (outputDir) await writeBuildInfo(outputDir);
    }
  };
}

const converterCoreWasmSource = path.resolve(__dirname, '../../wasm/converter-core/dist/converter-core.wasm');
const converterCoreWasmOutput = 'externals/converter-core.wasm';
const converterImageWasmSource = path.resolve(__dirname, '../../wasm/converter-image/dist/converter-image.wasm');
const converterImageWasmOutput = 'externals/converter-image.wasm';
const externalConverterAssets = [
  { source: converterCoreWasmSource, output: converterCoreWasmOutput },
  { source: converterImageWasmSource, output: converterImageWasmOutput }
];

function externalConverterWasms() {
  let basePath = '/';
  return {
    name: 'filens-external-converter-core',
    configResolved(config: { base: string }) {
      basePath = config.base.endsWith('/') ? config.base : `${config.base}/`;
    },
    configureServer(server: { middlewares: { use: (handler: (request: { url?: string }, response: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body: Buffer) => void }, next: (error?: unknown) => void) => void) => void } }) {
      server.middlewares.use(async (request, response, next) => {
        const requestPath = (request.url ?? '').split('?', 1)[0];
        const asset = externalConverterAssets.find(({ output }) =>
          requestPath === `${basePath}${output}` || requestPath === `/${output}`
        );
        if (!asset) {
          next();
          return;
        }
        try {
          const bytes = await readFile(asset.source);
          response.statusCode = 200;
          response.setHeader('Content-Type', 'application/wasm');
          response.setHeader('Cache-Control', 'no-cache');
          response.end(bytes);
        } catch (error) {
          next(error);
        }
      });
    },
    async generateBundle() {
      for (const asset of externalConverterAssets) {
        this.emitFile({
          type: 'asset',
          fileName: asset.output,
          source: await readFile(asset.source)
        });
      }
    }
  };
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(filePath));
    } else if (entry.isFile()) {
      files.push(filePath);
    }
  }
  return files;
}

function sumBytes(files: Array<{ bytes: number }>): number {
  return files.reduce((total, file) => total + file.bytes, 0);
}

async function writeBuildInfo(outputDir: string): Promise<void> {
  const absoluteFiles = await listFiles(outputDir);
  const files = await Promise.all(absoluteFiles.map(async (filePath) => ({
    path: path.relative(outputDir, filePath).replaceAll(path.sep, '/'),
    bytes: (await stat(filePath)).size
  })));
  const rawFiles = files.filter(({ path: filePath }) => !filePath.endsWith('.gz') && !filePath.endsWith('.br'));
  const runtimeFiles = rawFiles.filter(({ path: filePath }) => !filePath.startsWith('samples/'));
  const wasm = rawFiles.find(({ path: filePath }) => filePath === converterCoreWasmOutput);
  const imageWasm = rawFiles.find(({ path: filePath }) => filePath === converterImageWasmOutput);
  const entryReference = (await readFile(path.join(outputDir, 'index.html'), 'utf8')).match(/src="([^"]+\.js)"/)?.[1]?.match(/assets\/[^/]+\.js$/)?.[0];
  const entry = entryReference ? rawFiles.find(({ path: filePath }) => filePath === entryReference) : undefined;
  const compressedSize = (filePath: string | undefined, suffix: '.gz' | '.br'): number | undefined => {
    if (!filePath) return undefined;
    return files.find(({ path: candidate }) => candidate === `${filePath}${suffix}`)?.bytes;
  };

  const info = {
    schemaVersion: 1,
    distBytes: sumBytes(rawFiles),
    runtimeBytes: sumBytes(runtimeFiles),
    entry: entry ? {
      file: entry.path,
      bytes: entry.bytes,
      gzipBytes: compressedSize(entry.path, '.gz'),
      brotliBytes: compressedSize(entry.path, '.br')
    } : undefined,
    converterCoreWasm: wasm ? {
      file: wasm.path,
      external: true,
      loading: 'on-demand',
      bytes: wasm.bytes,
      gzipBytes: compressedSize(wasm.path, '.gz'),
      brotliBytes: compressedSize(wasm.path, '.br')
    } : undefined,
    converterImageWasm: imageWasm ? {
      file: imageWasm.path,
      external: true,
      loading: 'on-demand',
      bytes: imageWasm.bytes,
      gzipBytes: compressedSize(imageWasm.path, '.gz'),
      brotliBytes: compressedSize(imageWasm.path, '.br')
    } : undefined,
    typicalPerformance: {
      source: 'docs/project-overview.zh-CN.md 本机小样例性能快照',
      smallDocToDocxMs: 1,
      smallXlsToXlsxMs: 1,
      smallPptToPptxMs: 1,
      note: '小样例量级，不代表复杂文件或浏览器跨设备基准。'
    }
  };
  const payload = `${JSON.stringify(info, null, 2)}\n`;
  await writeFile(path.join(outputDir, 'build-info.json'), payload);
  await writeFile(path.join(outputDir, 'build-info.json.gz'), gzipSync(Buffer.from(payload), { level: 9 }));
  await writeFile(path.join(outputDir, 'build-info.json.br'), brotliCompressSync(Buffer.from(payload), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 }
  }));
}

function manualChunkForModule(id: string): string | undefined {
  const normalized = id.replaceAll(path.sep, '/');
  if (normalized === '\0filens:occt-wasm-url' || normalized.includes('/packages/model3d/vendor/occt-import-js/')) return 'occt-runtime';
  if (normalized === '\0filens:step-wasm-url' || normalized.includes('/packages/step/') || normalized.endsWith('/packages/model3d/src/rust-step-importer.ts')) return 'step-runtime';
  if (normalized.includes('/node_modules/pdfjs-dist/')) return 'pdf-runtime';
  if (normalized.includes('/node_modules/')) return 'vendor';
  if (normalized.includes('/packages/iwork/')) return 'iwork';
  if (normalized.includes('/packages/model3d/')) return 'model3d';
  if (normalized.includes('/packages/core/')) return 'core';
  if (normalized.includes('/packages/cad/') || normalized.includes('/packages/diagram/') || normalized.includes('/packages/mindmap/')) return 'design';
  if (normalized.includes('/packages/panorama/') || normalized.includes('/packages/media/')) return 'media';
  if (normalized.includes('/packages/archive/')) return 'archive';
  if (normalized.includes('/packages/docx/') || normalized.includes('/packages/pdf/') || normalized.includes('/packages/xlsx/')) return 'office';
  if (normalized.includes('/packages/ebook/') || normalized.includes('/packages/text/')) return 'text';
  if (normalized.includes('/packages/vue/')) return 'preview';
  return undefined;
}

const configureGoogleDrive = (proxy: { on(event: 'proxyReq', listener: (request: { removeHeader(name: string): void }) => void): void }) => {
  proxy.on('proxyReq', (request) => {
    // Browser fetch metadata makes Drive return its virus-scan HTML instead of the requested byte range.
    for (const header of ['cookie', 'origin', 'referer', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-user']) request.removeHeader(header);
  });
};

const externalSampleProxy = {
  '/external-samples/insta360/insp': {
    target: 'https://drive.usercontent.google.com',
    changeOrigin: true,
    headers: { 'user-agent': 'filens-demo/0.1' },
    configure: configureGoogleDrive,
    rewrite: () => '/download?id=1H_7MHubgvRnRbBwT5gn2dCBwghqEqaDZ&export=download&confirm=t'
  },
  '/external-samples/insta360/lrv': {
    target: 'https://drive.usercontent.google.com',
    changeOrigin: true,
    headers: { 'user-agent': 'filens-demo/0.1' },
    configure: configureGoogleDrive,
    rewrite: () => '/download?id=1hEJgzjwJE0UA47V2mT7VXyPcwz9Bit33&export=download&confirm=t'
  },
  '/external-samples/insta360/insv-00': {
    target: 'https://drive.usercontent.google.com',
    changeOrigin: true,
    headers: { 'user-agent': 'filens-demo/0.1' },
    configure: configureGoogleDrive,
    rewrite: () => '/download?id=10YnAzLoNuzJX0fNIatlo0tlJ4XagJqgs&export=download&confirm=t'
  },
  '/external-samples/insta360/insv-10': {
    target: 'https://drive.usercontent.google.com',
    changeOrigin: true,
    headers: { 'user-agent': 'filens-demo/0.1' },
    configure: configureGoogleDrive,
    rewrite: () => '/download?id=1B9h_a1nKSl5Zm1k5sRRN2phqU-ma8ZBf&export=download&confirm=t'
  },
  '/external-samples/osmo': {
    target: 'https://huggingface.co',
    changeOrigin: true,
    rewrite: (path: string) => path.replace('/external-samples/osmo', '/datasets/SamuelLDX/osmo360-lidar-preview/resolve/main')
  },
  '/external-samples/filesamples': {
    target: 'https://filesamples.com',
    changeOrigin: true,
    rewrite: (path: string) => path.replace('/external-samples/filesamples', '/samples')
  },
  '/external-samples/mdn-audio': {
    target: 'https://interactive-examples.mdn.mozilla.net',
    changeOrigin: true,
    rewrite: (path: string) => path.replace('/external-samples/mdn-audio', '/media/cc0-audio')
  },
  '/external-samples/mdn-video': {
    target: 'https://interactive-examples.mdn.mozilla.net',
    changeOrigin: true,
    rewrite: (path: string) => path.replace('/external-samples/mdn-video', '/media/cc0-videos')
  },
  '/external-samples/wikimedia': {
    target: 'https://upload.wikimedia.org',
    changeOrigin: true,
    rewrite: (path: string) => path.replace('/external-samples/wikimedia', '/wikipedia/commons')
  }
};

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/modules/filens/',
  plugins: [vue(), occtWasmAsset(), stepWasmAsset(), externalConverterWasms(), agentSkillAsset(), precompressAssets()],
  // Discover lazy worker dependencies at startup so first use does not reload an uploaded file.
  optimizeDeps: { include: ['@ffmpeg/core', 'libheif-js/libheif-wasm/libheif-bundle.mjs'] },
  worker: { plugins: () => [mediaWorkerAssets()] },
  server: { proxy: externalSampleProxy },
  preview: { proxy: externalSampleProxy },
  resolve: {
    preserveSymlinks: true,
    alias: {
      'filens-step': path.resolve(__dirname, '../../packages/step/src/index.ts'),
      '@filens/archive/style.css': path.resolve(__dirname, '../../packages/archive/src/styles/index.css'),
      '@filens/archive': path.resolve(__dirname, '../../packages/archive/src/index.ts'),
      '@filens/cad/style.css': path.resolve(__dirname, '../../packages/cad/src/styles/index.css'),
      '@filens/cad': path.resolve(__dirname, '../../packages/cad/src/index.ts'),
      '@filens/core/style.css': path.resolve(__dirname, '../../packages/core/src/styles/index.css'),
      '@filens/core/zip': path.resolve(__dirname, '../../packages/core/src/zip.ts'),
      '@filens/core': path.resolve(__dirname, '../../packages/core/src/index.ts'),
      '@filens/converter-client': path.resolve(__dirname, '../../packages/converter-client/src/index.ts'),
      '@filens/diagram/style.css': path.resolve(__dirname, '../../packages/diagram/src/styles/index.css'),
      '@filens/diagram': path.resolve(__dirname, '../../packages/diagram/src/index.ts'),
      '@filens/design': path.resolve(__dirname, '../../packages/design/src/index.ts'),
      '@filens/docx/style.css': path.resolve(__dirname, '../../packages/docx/src/styles/index.css'),
      '@filens/docx': path.resolve(__dirname, '../../packages/docx/src/index.ts'),
      '@filens/ebook/style.css': path.resolve(__dirname, '../../packages/ebook/src/styles/index.css'),
      '@filens/ebook': path.resolve(__dirname, '../../packages/ebook/src/index.ts'),
      '@filens/iwork/style.css': path.resolve(__dirname, '../../packages/iwork/src/styles/index.css'),
      '@filens/iwork': path.resolve(__dirname, '../../packages/iwork/src/index.ts'),
      '@filens/mindmap/style.css': path.resolve(__dirname, '../../packages/mindmap/src/styles/index.css'),
      '@filens/mindmap': path.resolve(__dirname, '../../packages/mindmap/src/index.ts'),
      '@filens/model3d/style.css': path.resolve(__dirname, '../../packages/model3d/src/styles/index.css'),
      '@filens/model3d': path.resolve(__dirname, '../../packages/model3d/src/index.ts'),
      '@filens/media': path.resolve(__dirname, '../../packages/media/src/index.ts'),
      '@filens/panorama/style.css': path.resolve(__dirname, '../../packages/panorama/src/styles/index.css'),
      '@filens/panorama': path.resolve(__dirname, '../../packages/panorama/src/index.ts'),
      '@filens/office': path.resolve(__dirname, '../../packages/office/src/index.ts'),
      '@filens/pdf/style.css': path.resolve(__dirname, '../../packages/pdf/src/styles/index.css'),
      '@filens/pdf': path.resolve(__dirname, '../../packages/pdf/src/index.ts'),
      '@filens/xlsx/style.css': path.resolve(__dirname, '../../packages/xlsx/src/styles/index.css'),
      '@filens/xlsx': path.resolve(__dirname, '../../packages/xlsx/src/index.ts'),
      '@filens/text': path.resolve(__dirname, '../../packages/text/src/index.ts'),
      '@filens/vue': path.resolve(__dirname, '../../packages/vue/src/index.ts')
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: manualChunkForModule
      }
    }
  }
});
