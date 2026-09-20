import { defineConfig } from 'vitest/config';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    lib: {
      entry: './src/index.ts',
      formats: ['es'],
      fileName: () => 'index.js'
    },
    cssCodeSplit: false,
    sourcemap: true
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: []
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
