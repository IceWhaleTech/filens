import { defineConfig } from 'vitest/config';
import dts from 'vite-plugin-dts';

export default defineConfig({
  test: { environment: 'jsdom', globals: true },
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
      external: ['@filens/core', '@filens/panorama', '@filens/converter-client']
    }
  }
});
