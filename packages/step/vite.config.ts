import { defineConfig } from 'vitest/config';
import dts from 'vite-plugin-dts';
import { stepWasmAsset } from '../../scripts/step-wasm-plugin';

export default defineConfig({
  base: './',
  build: {
    lib: { entry: './src/index.ts', formats: ['es'], fileName: () => 'index.js' },
    sourcemap: false
  },
  test: { environment: 'node' },
  plugins: [stepWasmAsset(), dts({ include: ['src/**/*.ts'], entryRoot: 'src', rollupTypes: true })]
});
