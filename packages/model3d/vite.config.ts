import { defineConfig } from 'vitest/config';
import dts from 'vite-plugin-dts';

export default defineConfig({
  base: './',
  resolve: {
    preserveSymlinks: true
  },
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
        '@filens/core',
        'occt-import-js',
        'occt-import-js/dist/occt-import-js.wasm?url',
        'three'
      ]
    }
  },
  test: {
    environment: 'jsdom',
    globals: true
  },
  plugins: [
    dts({
      include: ['src/**/*.ts'],
      outDir: 'dist',
      entryRoot: 'src',
      insertTypesEntry: true
    })
  ]
});
