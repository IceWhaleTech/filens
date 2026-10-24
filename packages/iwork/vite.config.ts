import { defineConfig } from 'vitest/config';
import dts from 'vite-plugin-dts';

export default defineConfig({
  base: './',
  build: {
    lib: {
      entry: './src/index.ts',
      formats: ['es'],
      fileName: () => 'index.js'
    },
    cssCodeSplit: false,
    sourcemap: true,
    rollupOptions: {
      external: ['@filens/core', '@filens/core/zip', '@filens/xlsx']
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
