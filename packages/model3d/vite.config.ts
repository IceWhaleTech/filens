import { defineConfig } from 'vitest/config';
import dts from 'vite-plugin-dts';
import { occtWasmAsset } from '../../scripts/occt-wasm-plugin';

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
        'filens-step',
        'three'
      ]
    }
  },
  test: {
    environment: 'jsdom',
    globals: true
  },
  plugins: [
    occtWasmAsset(),
    dts({
      include: ['src/**/*.ts'],
      outDir: 'dist',
      entryRoot: 'src',
      insertTypesEntry: true
    })
  ]
});
