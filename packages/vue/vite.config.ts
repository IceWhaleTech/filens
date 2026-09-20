import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import dts from 'vite-plugin-dts';
import path from 'node:path';

export default defineConfig({
  resolve: {
    preserveSymlinks: true,
    alias: {
      '@filens/archive/style.css': path.resolve(__dirname, '../archive/dist/index.css'),
      '@filens/cad/style.css': path.resolve(__dirname, '../cad/dist/index.css'),
      '@filens/core/style.css': path.resolve(__dirname, '../core/dist/index.css'),
      '@filens/diagram/style.css': path.resolve(__dirname, '../diagram/dist/index.css'),
      '@filens/design': path.resolve(__dirname, '../design/dist/index.js'),
      '@filens/docx/style.css': path.resolve(__dirname, '../docx/dist/index.css'),
      '@filens/ebook/style.css': path.resolve(__dirname, '../ebook/dist/index.css'),
      '@filens/iwork/style.css': path.resolve(__dirname, '../iwork/dist/index.css'),
      '@filens/model3d/style.css': path.resolve(__dirname, '../model3d/dist/index.css'),
      '@filens/media': path.resolve(__dirname, '../media/dist/index.js'),
      '@filens/mindmap/style.css': path.resolve(__dirname, '../mindmap/dist/index.css'),
      '@filens/panorama/style.css': path.resolve(__dirname, '../panorama/dist/index.css'),
      '@filens/office': path.resolve(__dirname, '../office/dist/index.js'),
      '@filens/pdf/style.css': path.resolve(__dirname, '../pdf/dist/index.css'),
      '@filens/text': path.resolve(__dirname, '../text/dist/index.js'),
      '@filens/xlsx/style.css': path.resolve(__dirname, '../xlsx/dist/index.css')
    }
  },
  plugins: [
    vue(),
    dts({
      include: ['src/**/*.ts', 'src/**/*.vue'],
      outDir: 'dist',
      entryRoot: 'src',
      insertTypesEntry: true
    })
  ],
  build: {
    lib: {
      entry: './src/index.ts',
      formats: ['es'],
      fileName: () => 'index.js'
    },
    cssCodeSplit: false,
    sourcemap: true,
    rollupOptions: {
      external: [
        'vue',
        '@filens/archive',
        '@filens/core',
        '@filens/design',
        '@filens/iwork',
        '@filens/media',
        '@filens/office',
        '@filens/text'
      ]
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    alias: [{
      find: /^@filens\/pdf$/,
      replacement: path.resolve(__dirname, './test/filens-pdf.mock.ts')
    }]
  }
});
