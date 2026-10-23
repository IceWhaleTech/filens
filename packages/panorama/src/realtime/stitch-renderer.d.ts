import type { PanoramaFrameRenderer, PanoramaFrameRendererOptions } from './stitch-types';
export function createPanoramaFrameRenderer(
  canvas: HTMLCanvasElement,
  options: PanoramaFrameRendererOptions,
  nativeVideo?: HTMLVideoElement | null
): PanoramaFrameRenderer;
export function createPanoramaImageRenderer(
  canvas: HTMLCanvasElement,
  source: HTMLImageElement | ImageBitmap | HTMLCanvasElement,
  options: PanoramaFrameRendererOptions
): PanoramaFrameRenderer;
