/// <reference types="vite/client" />

declare module 'libheif-js/libheif-wasm/libheif.js' {
  interface HeifImage {
    get_width(): number;
    get_height(): number;
    is_primary(): boolean;
    display(pixels: ImageData, callback: (result: ImageData | null) => void): void;
    free(): void;
  }
  export default function createHeif(options: { wasmBinary: Uint8Array }): Promise<{ HeifDecoder: new () => { decode(input: Uint8Array): HeifImage[] } }>;
}
