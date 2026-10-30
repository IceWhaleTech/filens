/// <reference lib="webworker" />
import createHeif from 'libheif-js/libheif-wasm/libheif.js';

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async ({ data }: MessageEvent<{ input: Uint8Array; format: string; wasmUrl: string }>) => {
  try {
    if (!['heic', 'heif'].includes(data.format)) throw new Error('Only HEIC/HEIF image decoding is bundled.');
    const source = await decodeHeif(data.input, data.wasmUrl);
    scope.postMessage({ source, format: 'png', contentType: 'image/png' }, [source.buffer]);
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};

async function decodeHeif(input: Uint8Array, wasmUrl: string): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`Failed to load the HEIF decoder: ${response.status}.`);
  const heif = await createHeif({ wasmBinary: new Uint8Array(await response.arrayBuffer()) });
  const images = new heif.HeifDecoder().decode(input);
  try {
    const image = images.find(image => image.is_primary()) ?? images[0];
    if (!image) throw new Error('HEIF file contains no decodable image.');
    const width = image.get_width(), height = image.get_height();
    if (width <= 0 || height <= 0 || width * height > 64_000_000) throw new Error('HEIF image dimensions exceed the preview limit.');
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('HEIF preview requires a 2D canvas.');
    const pixels = context.createImageData(width, height);
    await new Promise<void>((resolve, reject) => image.display(pixels, result => {
      if (result) resolve();
      else reject(new Error('Failed to decode HEIF image.'));
    }));
    context.putImageData(pixels, 0, 0);
    return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  } finally { images.forEach(image => image.free()); }
}
