import { readFile } from 'node:fs/promises';

/** Keep the optional HEIF decoder separate in library mode. */
export function mediaWasmAsset() {
  return {
    name: 'filens-media-wasm-asset', enforce: 'pre' as const,
    async load(this: { emitFile(asset: { type: 'asset'; name: string; source: Uint8Array }): string }, id: string) {
      if (!id.replaceAll('\\', '/').endsWith('/libheif-js/libheif-wasm/libheif.wasm?url')) return;
      const reference = this.emitFile({ type: 'asset', name: 'libheif.wasm', source: await readFile(id.slice(0, -4)) });
      return `export default import.meta.ROLLUP_FILE_URL_${reference};`;
    }
  };
}
