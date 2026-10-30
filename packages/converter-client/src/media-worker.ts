/// <reference lib="webworker" />
import createHeif from 'libheif-js/libheif-wasm/libheif-bundle.mjs';
import createFFmpegCore from '@ffmpeg/core';

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = async ({ data }: MessageEvent<{ input: Uint8Array; format: string; wasmUrl: string }>) => {
  try {
    const source = data.format === 'mov' ? await transcode(data.input, data.wasmUrl) : await decodeHeif(data.input);
    scope.postMessage({ source, format: data.format === 'mov' ? 'mp4' : 'png',
      contentType: data.format === 'mov' ? 'video/mp4' : 'image/png' }, [source.buffer]);
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};

async function decodeHeif(input: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const heif = await createHeif();
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

async function transcode(input: Uint8Array, wasmUrl: string): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`Failed to load the video conversion core: ${response.status}.`);
  const core = await createFFmpegCore({ wasmBinary: new Uint8Array(await response.arrayBuffer()) });
  let detail = '';
  core.setLogger(({ type, message }) => { if (type === 'stderr') detail = message; });
  core.FS.writeFile('/input.mov', input);
  // A bounded preview preserves the complete clip and optional audio, with browser-safe codecs.
  const status = core.exec('-i', '/input.mov', '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-movflags', '+faststart', '/preview.mp4');
  if (status !== 0) throw new Error(`Failed to convert QuickTime video${detail ? `: ${detail}` : '.'}`);
  return new Uint8Array(core.FS.readFile('/preview.mp4'));
}
