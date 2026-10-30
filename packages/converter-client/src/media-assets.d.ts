/// <reference types="vite/client" />

declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  interface HeifImage {
    get_width(): number;
    get_height(): number;
    is_primary(): boolean;
    display(pixels: ImageData, callback: (result: ImageData | null) => void): void;
    free(): void;
  }
  export default function createHeif(): Promise<{ HeifDecoder: new () => { decode(input: Uint8Array): HeifImage[] } }>;
}

declare module '@ffmpeg/core' {
  interface FFmpegCore {
    exec(...args: string[]): number;
    setLogger(callback: (event: { type: string; message: string }) => void): void;
    FS: {
      writeFile(path: string, input: Uint8Array): void;
      readFile(path: string): Uint8Array;
    };
  }
  export default function createFFmpegCore(options: { wasmBinary: Uint8Array }): Promise<FFmpegCore>;
}
