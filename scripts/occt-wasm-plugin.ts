import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const vendor = new URL('../packages/model3d/vendor/occt-import-js/', import.meta.url);

// Vite library builds otherwise inline WASM imported with ?url, even when
// assetsInlineLimit is zero. Emit a separate, hashed asset in both builds.
export function occtWasmAsset(): Plugin {
  const id = '\0filens:occt-wasm-url';
  return {
    name: 'filens-occt-wasm-asset',
    apply: 'build',
    enforce: 'pre',
    resolveId(source) {
      if (source.endsWith('/occt-import-js.wasm?url')) return id;
    },
    async load(source) {
      if (source !== id) return;
      const reference = this.emitFile({
        type: 'asset',
        name: 'occt-import-js.wasm',
        source: await readFile(new URL('occt-import-js.wasm', vendor))
      });
      return `export default import.meta.ROLLUP_FILE_URL_${reference};`;
    },
    async generateBundle() {
      const files = ['README.md', 'license.occt-import-js.txt', 'license.occt.txt'];
      const notices = await Promise.all(files.map(file => readFile(fileURLToPath(new URL(file, vendor)), 'utf8')));
      this.emitFile({ type: 'asset', fileName: 'occt-import-js-NOTICE.txt', source: notices.join('\n\n') });
    }
  };
}
