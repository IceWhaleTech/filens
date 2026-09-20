import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [dts({ insertTypesEntry: true })],
  build: {
    cssCodeSplit: false,
    lib: {
      entry: './src/index.ts',
      formats: ['es'],
      fileName: () => 'index.js'
    },
    sourcemap: true,
    rollupOptions: {
      external: [
        '@filens/cad',
        '@filens/core',
        '@filens/diagram',
        '@filens/mindmap',
        '@filens/model3d'
      ]
    }
  }
});
