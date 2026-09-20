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
    sourcemap: true,
    rollupOptions: {
      external: ['@filens/core']
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
