import { readFile } from 'node:fs/promises';

/** The caller supplies the WASM URL; do not let Vite embed FFmpeg's unused default. */
export function mediaWorkerAssets() {
  return {
    name: 'filens-media-worker-assets',
    transform(code: string, id: string) {
      if (id.replaceAll('\\', '/').endsWith('/@ffmpeg/core/dist/esm/ffmpeg-core.js')) {
        return { code: code.replace('new URL("ffmpeg-core.wasm",import.meta.url).href', '"ffmpeg-core.wasm"'), map: null };
      }
    }
  };
}

/** Library mode otherwise inlines even this optional 32 MB core. */
export function mediaWasmAsset() {
  return {
    name: 'filens-media-wasm-asset', enforce: 'pre' as const,
    async load(this: { emitFile(asset: { type: 'asset'; name: string; source: Uint8Array }): string }, id: string) {
      if (!id.replaceAll('\\', '/').endsWith('/@ffmpeg/core/dist/esm/ffmpeg-core.wasm?url')) return;
      const reference = this.emitFile({ type: 'asset', name: 'ffmpeg-core.wasm', source: await readFile(id.slice(0, -4)) });
      return `export default import.meta.ROLLUP_FILE_URL_${reference};`;
    }
  };
}
