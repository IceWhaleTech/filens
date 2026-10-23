import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRealtimePanoramaRenderer, createRealtimeStitchCalibration } from '../src/realtime-renderer';
import { applyRadtanPro, projectLensCpu } from '../src/calibrated-renderer';
import type { PanoramaAssetManifest, PanoramaProcessor, PanoramaVideoTrack } from '../src/wasm-processor';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const gpu = vi.hoisted(() => ({ presentFrames: vi.fn(), reset: vi.fn(), start: vi.fn(), destroy: vi.fn(), setView: vi.fn(), requestFrame: vi.fn() }));
vi.mock('../src/realtime/stitch-renderer.js', () => ({ createPanoramaFrameRenderer: () => gpu }));

function manifest(packed = false, dji = false): PanoramaAssetManifest {
  const track = (id: number): PanoramaVideoTrack => ({
    id, codec: 'avc1', decoderConfig: '01640033', width: 256, height: 256, timescale: 10,
    samples: Array.from({ length: 8 }, (_, index) => ({ offset: index, size: 1, pts: index, duration: 1, key: true }))
  });
  return {
    vendor: dji ? 'dji' : 'insta360', format: dji ? 'osv' : 'insv',
    projection: dji ? { kind: 'dji-fisheye-lut', linearExtensionDeg: 85, validHalfFovDeg: 96 } : { kind: 'mei-extended', xi: 1.5 },
    calibrationSource: 'embedded', confidence: 'experimental', textureOrigin: 'top-left', warnings: [],
    tracks: packed ? [{ ...track(1), width: 512 }] : [track(1), track(2)],
    lenses: [0, 1].map((index) => ({
      sourceTrackId: packed ? 1 : index + 1,
      sourceRect: packed ? { x: index * 0.5, y: 0, width: 0.5, height: 1 } : undefined,
      width: 256, height: 256, fx: 80, fy: 80, cx: 128, cy: 128,
      xi: 1.5, radial: [0.001, 0, 0, 0], distortion: [0.001, 0, 0, 0],
      radialLut1: Array(14).fill(128), radialLut2: Array(14).fill(128 + 80 * Math.PI / 2),
      tangential: [0.001, -0.002], thinPrism: [0, 0, 0, 0], sensorTilt: [0.01, -0.02],
      extrinsicQuaternion: dji ? [Math.SQRT1_2, index ? -Math.SQRT1_2 : Math.SQRT1_2, 0, 0]
        : index ? [0, 0, 1, 0] : [1, 0, 0, 0]
    }))
  };
}

describe('Photos calibration adapter', () => {
  const source = readFileSync('src/realtime/stitch-renderer.js', 'utf8');
  const context: any = {};
  runInNewContext(`${source.replace(/^export /gm, '')}\nthis.project = projectDualFisheyeLensCpu;`, context);

  it.each([false, true])('retains calibrated pixels and camera axes for DJI=%s', (dji) => {
    const input = manifest(false, dji);
    const calibration = createRealtimeStitchCalibration(input)!;
    expect(calibration.imageSize).toEqual([512, 256]);
    const body = dji ? [0.2, 1, 0.3] : [0.2, -0.3, 1];
    const ray = body.map((value) => value / Math.hypot(...body)) as [number, number, number];
    const expected = projectLensCpu(ray, input.lenses[0], input.projection.kind)!;
    const rendererRay = dji ? [ray[0], -ray[2], ray[1]] : ray;
    const projected = context.project(rendererRay, calibration.front, Math.PI, !dji, dji, calibration.front.radialScale);
    expect(projected.uv[0]).toBeCloseTo(expected[0] / 2, 10);
    expect(projected.uv[1]).toBeCloseTo(expected[1], 10);
  });

  it('preserves packed physical lens placement when calibration order is reversed', () => {
    const input = manifest(true);
    input.lenses.reverse();
    const calibration = createRealtimeStitchCalibration(input)!;
    expect(calibration.front.center[0]).toBeGreaterThan(0.5);
    expect(calibration.back.center[0]).toBeLessThan(0.5);
  });

  it('preserves the ONE RS bottom-left texture origin', () => {
    const input = manifest();
    input.textureOrigin = 'bottom-left';
    expect(createRealtimeStitchCalibration(input)?.textureOrigin).toBe('bottom-left');
  });

  it('passes all X5 RadtanPro coefficients to the migrated projection', () => {
    const input = manifest();
    input.cameraModel = 'Insta360 X5';
    input.lenses[0].distortionModel = 'radtan_pro';
    input.lenses[0].distortionCoeffs = Array.from({ length: 13 }, (_, index) => (index + 1) / 1000);
    input.lenses[0].thinPrism = undefined;
    input.lenses[0].sensorTilt = undefined;
    const calibration = createRealtimeStitchCalibration(input)!;
    expect(calibration.front.distortionCoeffs).toEqual(input.lenses[0].distortionCoeffs);
    const length = Math.hypot(0.2, -0.15, 1);
    const projected = context.project([0.2 / length, -0.15 / length, 1 / length], {
      ...calibration.front, xi: 0, center: [0.25, 0.5], focal: [0.2, 0.4]
    }, Math.PI, true, false, 1);
    expect(projected.uv[0]).toBeCloseTo(0.2902317194290161, 10);
    expect(projected.uv[1]).toBeCloseTo(0.4404602333564758, 10);
    const fallback = applyRadtanPro([0.2, -0.15], input.lenses[0].distortionCoeffs!);
    expect(0.25 + 0.2 * fallback[0]).toBeCloseTo(projected.uv[0], 10);
    expect(0.5 + 0.4 * fallback[1]).toBeCloseTo(projected.uv[1], 10);
  });

  it('retains the existing renderer for unsupported crops, dimensions and uncalibrated media', () => {
    const cropped = manifest();
    cropped.lenses[0].sourceRect = { x: 0.1, y: 0, width: 0.9, height: 1 };
    expect(createRealtimeStitchCalibration(cropped)).toBeUndefined();
    const mismatched = manifest();
    mismatched.tracks[1].height = 128;
    expect(createRealtimeStitchCalibration(mismatched)).toBeUndefined();
    const missing = manifest();
    missing.lenses[0].extrinsicQuaternion = undefined;
    expect(createRealtimeStitchCalibration(missing)).toBeUndefined();
  });
});

describe('clocked frame delivery', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });

  async function open(packed = false) {
    let time = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => time);
    const frames: { timestamp: number; close: ReturnType<typeof vi.fn> }[] = [];
    const decoders: Decoder[] = [];
    class Decoder {
      static isConfigSupported = async () => ({ supported: true });
      decodeQueueSize = 0;
      close = vi.fn();
      reset = vi.fn();
      configure = vi.fn();
      constructor(private readonly callbacks: VideoDecoderInit) { decoders.push(this); }
      decode(chunk: EncodedVideoChunk) {
        const frame = { timestamp: chunk.timestamp, duration: 100_000, close: vi.fn() };
        frames.push(frame);
        this.callbacks.output(frame as unknown as VideoFrame);
      }
    }
    vi.stubGlobal('VideoDecoder', Decoder);
    vi.stubGlobal('EncodedVideoChunk', class { constructor(options: EncodedVideoChunkInit) { Object.assign(this, options); } });
    const processor = {
      readSample: vi.fn(async (trackId, sampleIndex) => ({ trackId, pts: sampleIndex, timescale: 10, duration: 1, key: true, data: new Uint8Array([0]) })),
      seek: vi.fn((seconds: number) => ({ 1: Math.floor(seconds * 10), 2: Math.floor(seconds * 10) }))
    } as unknown as PanoramaProcessor;
    const renderer = await createRealtimePanoramaRenderer(processor, manifest(packed));
    const settle = async () => { for (let index = 0; index < 10; index++) await Promise.resolve(); };
    await settle();
    return { renderer, frames, decoders, processor, settle, advance: (ms: number) => { time = ms; renderer.update(); } };
  }

  it('holds decoded lookahead frames until the playback clock reaches their timestamps', async () => {
    const { renderer, advance, settle } = await open();
    expect(gpu.presentFrames).toHaveBeenCalledTimes(1);
    advance(0);
    await settle();
    expect(gpu.presentFrames).toHaveBeenCalledTimes(1);
    advance(90);
    expect(gpu.presentFrames).toHaveBeenCalledTimes(1);
    advance(100);
    expect(gpu.presentFrames).toHaveBeenCalledTimes(2);
    expect(gpu.presentFrames.mock.calls[1][1]).toBe(0.1);
    renderer.close();
  });

  it('uploads a shared packed track once and redraws a retained frame only when view changes', async () => {
    const { renderer } = await open(true);
    expect(gpu.presentFrames.mock.calls[0][0]).toHaveLength(1);
    renderer.setView!(0, 0, 0, 75);
    renderer.setView!(0, 0, 0, 75);
    expect(gpu.setView).toHaveBeenCalledTimes(1);
    renderer.setView!(90, 0, 0, 75);
    expect(gpu.setView).toHaveBeenCalledTimes(2);
    renderer.close();
  });

  it('seeks while paused, resets stale ownership, and closes every frame and decoder', async () => {
    const { renderer, frames, decoders, settle } = await open();
    renderer.pause();
    renderer.seek(0.4);
    await settle();
    renderer.update();
    await settle();
    expect(gpu.reset).toHaveBeenCalledOnce();
    expect(gpu.presentFrames.mock.calls.at(-1)![1]).toBe(0.4);
    expect(renderer.paused).toBe(true);
    renderer.close();
    renderer.close();
    expect(gpu.destroy).toHaveBeenCalledOnce();
    for (const frame of frames) expect(frame.close).toHaveBeenCalledOnce();
    for (const decoder of decoders) expect(decoder.close).toHaveBeenCalledOnce();
  });

  it('reports upload failure and releases decoded frames instead of throwing from the decoder callback', async () => {
    gpu.presentFrames.mockImplementationOnce(() => { throw new Error('Panorama frame upload failed'); });
    const { renderer, frames, decoders } = await open();
    expect(renderer.error?.message).toBe('Panorama frame upload failed');
    for (const frame of frames) expect(frame.close).toHaveBeenCalledOnce();
    for (const decoder of decoders) expect(decoder.close).toHaveBeenCalledOnce();
    renderer.close();
  });
});
