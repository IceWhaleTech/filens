import { readFile } from 'node:fs/promises';
import type { Plugin } from 'vite';

const vendor = new URL('../packages/step/vendor/', import.meta.url);
export function stepWasmAsset(): Plugin {
  const id = '\0filens:step-wasm-url';
  let used = false;
  return {
    name: 'filens-step-wasm-asset', apply: 'build', enforce: 'pre',
    resolveId(source) { if (source.endsWith('/filens-step.wasm?url')) return id; },
    async load(source) {
      if (source !== id) return;
      used = true;
      const reference = this.emitFile({ type: 'asset', name: 'filens-step.wasm', source: await readFile(new URL('filens-step.wasm', vendor)) });
      return `export default import.meta.ROLLUP_FILE_URL_${reference};`;
    },
    async generateBundle() {
      if (!used) return;
      for (const file of ['manifest.json', 'THIRD-PARTY-NOTICES.txt']) {
        this.emitFile({ type: 'asset', fileName: `filens-step-${file}`, source: await readFile(new URL(file, vendor)) });
      }
    }
  };
}
