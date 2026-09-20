import { defineConfig } from 'vite';
import path from 'node:path';
import vue from '@vitejs/plugin-vue';

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
  }
};

export default defineConfig({
  plugins: [vue()],
  server: { proxy: externalSampleProxy },
  preview: { proxy: externalSampleProxy },
  resolve: {
    preserveSymlinks: true,
    alias: {
      '@filens/archive/style.css': path.resolve(__dirname, '../../packages/archive/src/styles/index.css'),
      '@filens/archive': path.resolve(__dirname, '../../packages/archive/src/index.ts'),
      '@filens/cad/style.css': path.resolve(__dirname, '../../packages/cad/src/styles/index.css'),
      '@filens/cad': path.resolve(__dirname, '../../packages/cad/src/index.ts'),
      '@filens/core/style.css': path.resolve(__dirname, '../../packages/core/src/styles/index.css'),
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
});
