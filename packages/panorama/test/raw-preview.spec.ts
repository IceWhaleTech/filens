import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { createWasmPanoramaProcessor } from '../src/wasm-processor';
import { createImageStitchCalibration } from '../src/static-renderer';
import { createRawImagePreviewDriver } from '../src/raw-preview-driver';
import { dngFixture } from './fixtures/dng';

const wasm = readFileSync(resolve('../../wasm/converter-core/dist/converter-core.wasm'));
const imageWasm = readFileSync(resolve('../../wasm/converter-image/dist/converter-image.wasm'));

describe('RAW preview', () => {
  it.each(['one-rs', 'x5'] as const)('inspects and develops %s with the production WASM modules', async (kind) => {
    const processor = createWasmPanoramaProcessor({ wasm, imageWasm });
    const manifest = await processor.open(dngFixture(kind, 6), { format: 'dng' });
    expect(manifest).toMatchObject({ format: 'dng', calibrationSource: 'embedded', textureOrigin: 'top-left' });
    expect(manifest.projection.kind).toBe(kind === 'x5' ? 'mei-extended' : 'equidistant');
    const calibration = createImageStitchCalibration(manifest)!;
    expect(calibration.imageSize).toEqual(kind === 'x5' ? [1024, 512] : [512, 1024]);
    const jpeg = await processor.decodeImage!();
    expect([...jpeg.slice(0, 2)]).toEqual([255, 216]);
    // A 90-degree EXIF orientation must not rotate the calibrated sensor raster.
    const sof = jpeg.findIndex((byte, index) => byte === 0xff && jpeg[index + 1] === 0xc0);
    const view = new DataView(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength);
    expect(view.getUint16(sof + 5)).toBe(manifest.height);
    expect(view.getUint16(sof + 7)).toBe(manifest.width);
    if (kind === 'x5') {
      expect(calibration.front.center).toEqual([0.25, 0.5]);
      expect(calibration.front.focal).toEqual([368 / 1024, 368 / 512]);
      expect(calibration.back.translationM).toEqual([0, 0, -0.03]);
    } else {
      expect(calibration.front.up[1]).toBeCloseTo(1);
      expect(calibration.back.up[1]).toBeCloseTo(1);
    }
    processor.close();
  });

  it('does not classify an ordinary 2:1 RAW as a panorama', async () => {
    const processor = createWasmPanoramaProcessor({ wasm });
    const manifest = await processor.open(dngFixture('ordinary'), { format: 'dng' });
    expect(manifest.projection.kind).toBe('unknown');
    expect(createImageStitchCalibration(manifest)).toBeUndefined();
    processor.close();
  });

  it('keeps a usable static seam when focal refinement would remove mask-grid overlap', async () => {
    const processor = createWasmPanoramaProcessor({ wasm });
    const manifest = await processor.open(dngFixture('one-rs'), { format: 'dng' });
    const calibration = createImageStitchCalibration(manifest);
    const source = readFileSync('src/realtime/stitch-renderer.js', 'utf8').replace(/^export /gm, '');
    class Surface {
      constructor(private width: number, private height: number) {}
      getContext() { return { drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(this.width * this.height * 4).fill(128) }) }; }
    }
    const context = { calibration, OffscreenCanvas: Surface, HTMLVideoElement: class {}, HTMLImageElement: class {} } as Record<string, any>;
    runInNewContext(`${source}
      estimateDualFisheyeImageFocalScale = () => 1.02;
      const options = normalizeOptions({ dualFisheyeRefineFocal: true, dualFisheyeCalibration: calibration, dualFisheyeFlipX: false });
      this.result = acceptStaticDualFisheyeImage({width:512,height:1024}, options, calibration, null, calibration.front, calibration.back, 196*Math.PI/360);
    `, context);
    expect(context.result.focalScale).toBe(1);
    expect(context.result.mask?.length).toBe(128 * 64);
    processor.close();
  });

  it('keeps the latest DNG source when an aborted remote probe completes late', async () => {
    let finishProbe: ((response: Response) => void) | undefined;
    const newest = dngFixture('x5');
    const response = (bytes: Uint8Array) => new Response(new Uint8Array(bytes).buffer, { headers: { 'Content-Length': String(bytes.length) } });
    const fetch = vi.fn((url: string) => url.includes('slow')
      ? new Promise<Response>((resolve) => { finishProbe = resolve; })
      : Promise.resolve(response(newest))) as unknown as typeof globalThis.fetch;
    const processor = createWasmPanoramaProcessor({ wasm, imageWasm, fetch });
    const stale = processor.open('https://example.com/slow.dng', { format: 'dng' });
    const rejected = expect(stale).rejects.toMatchObject({ name: 'AbortError' });
    await processor.open('https://example.com/new.dng', { format: 'dng' });
    finishProbe!(response(dngFixture('one-rs')));
    await rejected;
    expect(processor.getManifest()?.cameraModel).toBe('Insta360 X5');
    const jpeg = await processor.decodeImage!();
    const sof = jpeg.findIndex((byte, index) => byte === 0xff && jpeg[index + 1] === 0xc0);
    const view = new DataView(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength);
    expect(view.getUint16(sof + 7)).toBe(1024);
    processor.close();
  });

  it('explains the missing sensor decoder instead of using a cropped embedded thumbnail', async () => {
    const processor = createWasmPanoramaProcessor({ wasm });
    await processor.open(dngFixture('x5'), { format: 'dng' });
    await expect(processor.decodeImage!()).rejects.toThrow('imageWasm');
    processor.close();
  });

  it('routes ordinary DNG through the configured converter and forwards its warnings', async () => {
    const processor = createWasmPanoramaProcessor({ wasm });
    const converted = new Uint8Array([255, 216, 255, 217]);
    const converter = { convert: vi.fn().mockResolvedValue({ source: converted, format: 'jpg', contentType: 'image/jpeg', warnings: ['Lightweight RAW preview'] }) };
    const host = document.createElement('div');
    const session = createRawImagePreviewDriver({ processor, converter }).createSession(host);
    const source = dngFixture('ordinary');
    const createUrl = vi.fn(() => 'blob:raw-preview');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() }));
    try {
      await session.load(source, { descriptor: { source, name: 'normal.dng', extension: 'dng' } });
      const image = host.querySelector('img')!;
      image.dispatchEvent(new Event('load'));
      expect(converter.convert).toHaveBeenCalledWith(expect.objectContaining({ source, sourceFormat: 'dng', targetFormat: 'jpg' }), expect.anything());
      expect(session.getState()).toMatchObject({ family: 'image', loading: false, warnings: ['Lightweight RAW preview'] });
      expect(host.querySelector('canvas')).toBeNull();
    } finally { session.destroy(); vi.unstubAllGlobals(); }
  });

  it('does not render or close a replacement source when stale decoding finishes', async () => {
    let finish: (() => void) | undefined;
    const processor = createWasmPanoramaProcessor({ wasm, imageWasm });
    const open = processor.open.bind(processor);
    const close = vi.spyOn(processor, 'close');
    processor.open = async (...args) => {
      const manifest = await open(...args);
      await new Promise<void>((resolve) => { finish = resolve; });
      return manifest;
    };
    const converter = { convert: vi.fn() };
    const host = document.createElement('div');
    const session = createRawImagePreviewDriver({ processor, converter }).createSession(host);
    const source = dngFixture('x5');
    const loading = session.load(source, { descriptor: { source, extension: 'dng' } });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    session.destroy();
    const closes = close.mock.calls.length;
    finish!();
    await expect(loading).rejects.toMatchObject({ name: 'AbortError' });
    expect(close).toHaveBeenCalledTimes(closes);
    expect(converter.convert).not.toHaveBeenCalled();
    expect(host.children.length).toBe(0);
  });
});
