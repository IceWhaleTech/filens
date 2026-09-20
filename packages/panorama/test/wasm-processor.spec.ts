import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bindPanoramaLensTracks, createWasmPanoramaProcessor, mergeCompanionLenses, panoramaDecoderConfig } from '../src/wasm-processor';
import { acceptDynamicSeams, applySensorTilt, buildCircularSeamMask, buildSeamMask, djiOverlapWeight, hasAccuratePanoramaCalibration, lensOpticalAxis, limitTemporalSeam, meiLensPreference, overlapCoveragePenalty, panoramaDirection, panoramaFrameSampleV, panoramaLensSourceUv, panoramaLensTextureRect, panoramaTextureFlipY, panoramaTrackDuration, panoramaUvFromDirection, projectLensCpu, resolvePanoramaLensSources, rotatePanoramaRows, sampleFrameBilinear, seamHasFullOverlap, slerpQuaternion, stabilizePolarSeam, supportsDynamicPanoramaSeam, symmetricColorGains, symmetricExposureGains, unrotatePanoramaSeam } from '../src/calibrated-renderer';

describe('WASM panorama processor', () => {
  it('inspects a sparse 2:1 INSP without loading a vendor profile', async () => {
    const wasmFile = readFileSync(resolve(process.cwd(), '../../wasm/converter-core/dist/converter-core.wasm'));
    const wasm = wasmFile.buffer.slice(wasmFile.byteOffset, wasmFile.byteOffset + wasmFile.byteLength);
    const processor = createWasmPanoramaProcessor({ wasm });
    const source = jpeg(4000, 2000);
    const manifest = await processor.open(source.buffer, { format: 'insp' });

    expect(manifest).toMatchObject({
      vendor: 'insta360',
      projection: { kind: 'equirectangular' },
      calibrationSource: 'not-required',
      width: 4000,
      height: 2000
    });
    processor.close();
  });

  it('computes a temporally stable minimum-cost seam in WASM', async () => {
    const wasmFile = readFileSync(resolve(process.cwd(), '../../wasm/converter-core/dist/converter-core.wasm'));
    const wasm = wasmFile.buffer.slice(wasmFile.byteOffset, wasmFile.byteOffset + wasmFile.byteLength);
    const processor = createWasmPanoramaProcessor({ wasm });
    const costs = new Uint8Array(24).fill(40);
    for (let row = 0; row < 4; row += 1) costs[row * 6 + 3] = 1;

    await expect(processor.computeSeam({
      width: 6,
      height: 4,
      costs,
      previous: [2, 2, 2, 2],
      temporalWeight: 1
    })).resolves.toMatchObject({ seam: [3, 3, 3, 3] });
  });

  it('interpolates camera rotations on the shortest normalized path', () => {
    const halfway = slerpQuaternion([1, 0, 0, 0], [0, 0, 0, 1], 0.5);
    expect(halfway[0]).toBeCloseTo(Math.SQRT1_2);
    expect(halfway[3]).toBeCloseTo(Math.SQRT1_2);
    expect(Math.hypot(...halfway)).toBeCloseTo(1);
  });

  it('derives calibrated playback duration from the final sample', () => {
    expect(panoramaTrackDuration({
      id: 1,
      codec: 'hvc1',
      decoderConfig: '',
      width: 1920,
      height: 1920,
      timescale: 30,
      samples: [{ offset: 0, size: 1, pts: 60, duration: 1, key: true }]
    })).toBeCloseTo(61 / 30);
  });

  it('derives the AVC WebCodecs profile from avcC', () => {
    expect(panoramaDecoderConfig({
      id: 1,
      codec: 'avc1',
      decoderConfig: '01640033',
      width: 3072,
      height: 3072,
      timescale: 30,
      samples: []
    })).toMatchObject({ codec: 'avc1.640033', optimizeForLatency: true });
  });

  it('derives the HEVC WebCodecs profile from hvcC', () => {
    expect(panoramaDecoderConfig({
      id: 1,
      codec: 'hvc1',
      decoderConfig: '01216000000080000000000099',
      width: 2880,
      height: 2880,
      timescale: 60000,
      samples: []
    })).toMatchObject({ codec: 'hvc1.1.6.H153.80', optimizeForLatency: true });
  });

  it('uses the MEI camera axes and inverse lens extrinsic', () => {
    const meiCenter = panoramaDirection(0.5, 0.5, 'mei-extended');
    expect(meiCenter[0]).toBeCloseTo(0);
    expect(meiCenter[1]).toBeCloseTo(0);
    expect(meiCenter[2]).toBeCloseTo(1);
    const rootHalf = Math.SQRT1_2;
    const projected = projectLensCpu([1, 0, 0], {
      width: 200,
      height: 200,
      fx: 100,
      fy: 100,
      cx: 100,
      cy: 100,
      xi: 1,
      radial: [0, 0, 0, 0],
      extrinsicQuaternion: [rootHalf, 0, rootHalf, 0]
    }, 'mei-extended');
    expect(projected?.[0]).toBeCloseTo(100.5 / 200);
    expect(projected?.[1]).toBeCloseTo(100.5 / 200);
    const djiCenter = panoramaDirection(0.5, 0.5, 'dji-fisheye-lut');
    expect(djiCenter[0]).toBeCloseTo(1);
    expect(djiCenter[1]).toBeCloseTo(0);
  });

  it('keeps seam UV attached to the stabilized camera direction', () => {
    for (const projection of ['mei-extended', 'dji-fisheye-lut'] as const) {
      const direction = panoramaDirection(0.2, 0.7, projection);
      const uv = panoramaUvFromDirection(direction, projection);
      expect(uv[0]).toBeCloseTo(0.2);
      expect(uv[1]).toBeCloseTo(0.7);
    }
  });

  it('applies the OpenCV tilted-sensor projection at the fisheye edge', () => {
    const point = applySensorTilt([0.5, 0.25], [0.1, -0.05]);
    expect(point[0]).toBeCloseTo(0.5271020676);
    expect(point[1]).toBeCloseTo(0.2671865071);
    expect(applySensorTilt([-1.0000001, 0], [0, Math.PI / 4])[0]).toBeGreaterThan(0);
  });

  it('rejects unstable MEI rays before high-order distortion overflows', () => {
    const lens = {
      width: 3840, height: 3840, fx: 1200, fy: 1200, cx: 1920, cy: 1920, xi: 0.8,
      radial: [0.1, 0.01, 0.001, 0], tangential: [0, 0], extrinsicQuaternion: [1, 0, 0, 0]
    };

    expect(projectLensCpu([0.6, 0, -0.799999], lens, 'mei-extended')).toBeUndefined();
    expect(projectLensCpu([0, 0, 1], lens, 'mei-extended')).toEqual([1920.5 / 3840, 1920.5 / 3840, 1824]);
  });

  it('maps calibrated pixel centers to texture centers without edge clamping', () => {
    const lens = {
      width: 4, height: 4, fx: 1, fy: 1, cx: 0, cy: 0, xi: 1,
      radial: [0, 0, 0, 0], tangential: [0, 0], extrinsicQuaternion: [1, 0, 0, 0]
    };

    expect(projectLensCpu([0, 0, 1], lens, 'mei-extended')?.slice(0, 2)).toEqual([0.125, 0.125]);
    expect(projectLensCpu([-1, 0, 1], lens, 'mei-extended')).toBeUndefined();
  });

  it('samples seam-analysis frames with the same linear filtering as WebGL', () => {
    const pixels = new Uint8ClampedArray([
      0, 10, 20, 255, 100, 110, 120, 255,
      200, 210, 220, 255, 255, 250, 240, 255
    ]);

    expect(sampleFrameBilinear(pixels, 2, 0.5, 0.5)).toEqual(new Uint8Array([139, 145, 150]));
    expect(sampleFrameBilinear(pixels, 2, 0.25, 0.25)).toEqual(new Uint8Array([0, 10, 20]));
  });

  it('keeps GPU and seam-analysis orientation aligned for each Insta calibration family', () => {
    expect(panoramaTextureFlipY('top-left')).toBe(false);
    expect(panoramaFrameSampleV(0.2, 'top-left')).toBe(0.2);
    expect(panoramaTextureFlipY('bottom-left')).toBe(true);
    expect(panoramaFrameSampleV(0.2, 'bottom-left')).toBe(0.8);
  });

  it('binds separate, side-by-side, and top-bottom dual-fisheye sources', () => {
    const track = (id: number, width = 200, height = 100) => ({ id, codec: 'hvc1', decoderConfig: '', width, height, timescale: 30, samples: [] });
    const manifest = (tracks: ReturnType<typeof track>[], lenses: object[]) => ({ tracks, lenses } as any);

    const separate = resolvePanoramaLensSources(manifest([track(1), track(2)], [{}, {}]));
    expect(separate?.map((source) => source.track.id)).toEqual([1, 2]);

    const sideBySide = resolvePanoramaLensSources(manifest([track(7)], [
      { sourceTrackId: 7, sourceRect: { x: 0, y: 0, width: 0.5, height: 1 } },
      { sourceTrackId: 7, sourceRect: { x: 0.5, y: 0, width: 0.5, height: 1 } }
    ]));
    expect(panoramaLensSourceUv(0.25, 0.75, sideBySide![1], 'top-left')).toEqual([0.625, 0.75]);

    const topBottom = resolvePanoramaLensSources(manifest([track(8)], [
      { sourceTrackId: 8, sourceRect: { x: 0, y: 0, width: 1, height: 0.5 } },
      { sourceTrackId: 8, sourceRect: { x: 0, y: 0.5, width: 1, height: 0.5 } }
    ]));
    expect(panoramaLensSourceUv(0.25, 0.75, topBottom![1], 'top-left')).toEqual([0.25, 0.875]);
    expect(panoramaLensSourceUv(0.25, 0.75, topBottom![1], 'bottom-left')).toEqual([0.25, 0.625]);
    expect(panoramaLensTextureRect(topBottom![0], 'bottom-left')).toEqual([0, 0.5, 1, 0.5]);
    expect(panoramaLensTextureRect(topBottom![1], 'bottom-left')).toEqual([0, 0, 1, 0.5]);
    expect(resolvePanoramaLensSources(manifest([track(9)], [{}, {}]))).toBeUndefined();
  });

  it('uses the same linear DJI overlap weight as the reference remap', () => {
    expect(djiOverlapWeight(85 * Math.PI / 180)).toBe(1);
    expect(djiOverlapWeight(87.5 * Math.PI / 180)).toBeCloseTo(0.75);
    expect(djiOverlapWeight(90 * Math.PI / 180)).toBeCloseTo(0.5);
    expect(djiOverlapWeight(95 * Math.PI / 180)).toBe(0);
  });

  it('matches lens brightness symmetrically before scoring a seam', () => {
    const gains = symmetricExposureGains(100, 144);
    expect(100 * gains[0]).toBeCloseTo(144 * gains[1]);
    expect(gains[0] * gains[1]).toBeCloseTo(1);
    expect(symmetricExposureGains(0, 144)).toEqual([1, 1]);
  });

  it('matches white balance independently for each color channel', () => {
    const source0 = [100, 120, 150];
    const source1 = [144, 120, 100];
    const [first, second] = symmetricColorGains(source0, source1);
    for (let channel = 0; channel < 3; channel += 1) {
      expect(source0[channel] * first[channel]).toBeCloseTo(source1[channel] * second[channel]);
      expect(first[channel] * second[channel]).toBeCloseTo(1);
    }
  });

  it('keeps dynamic seams away from a distorted lens rim', () => {
    expect(overlapCoveragePenalty(1, 1)).toBe(0);
    expect(overlapCoveragePenalty(1, 0.5)).toBe(43);
    expect(overlapCoveragePenalty(1, 0.01)).toBeGreaterThan(120);
    expect(overlapCoveragePenalty(1, 0)).toBe(128);
  });

  it('prevents equirectangular seams from wandering at the poles', () => {
    expect(stabilizePolarSeam([0, 1, 5, 6, 7, 8, 2, 1])).toEqual([5, 5, 5, 6, 7, 8, 8, 8]);
    expect(stabilizePolarSeam([1, 2, 3], 2)).toEqual([1, 2, 3]);
  });

  it('limits frame-to-frame seam jumps without freezing motion', () => {
    expect(limitTemporalSeam([2, 20, 8], [4, 10, 8])).toEqual([2, 14, 8]);
    expect(limitTemporalSeam([2, 20], undefined)).toEqual([2, 20]);
  });

  it('rejects dynamic seams that cross uncovered lens pixels', () => {
    const costs = new Uint16Array([1, 2, 3, 4, 5, 65535, 7, 8]);
    expect(seamHasFullOverlap(costs, [0, 2], 0, 4)).toBe(true);
    expect(seamHasFullOverlap(costs, [1, 1], 0, 4)).toBe(false);
    expect(seamHasFullOverlap(costs, [0, 4], 0, 4)).toBe(false);
    expect(seamHasFullOverlap(costs, limitTemporalSeam([0, 0], [2, 2], 1), 0, 4)).toBe(false);
  });

  it('keeps X5 lens ownership away from the distorted outer rim', () => {
    expect(meiLensPreference(0.5, 0)).toBe(1);
    expect(meiLensPreference(0.5, 1)).toBe(0);
    expect(meiLensPreference(0.25, 0)).toBeCloseTo(0.5);
    expect(meiLensPreference(0.25, 1)).toBeCloseTo(0.5);
    expect(meiLensPreference(0, 1)).toBe(1);
  });

  it('keeps dynamic seams narrow enough to avoid wide parallax ghosting', () => {
    const first = new Float32Array(128 * 64).fill(1);
    const second = new Float32Array(128 * 64);
    const mask = buildSeamMask([first, second], new Array(64).fill(10), new Array(64).fill(70));

    expect(new Set(mask)).toEqual(new Set([0, 255]));
    expect(mask[9]).toBe(0);
    expect(mask[10]).toBe(255);
    expect(mask[69]).toBe(255);
    expect(mask[70]).toBe(0);
  });

  it('supports dynamic seams for both calibrated projection families', () => {
    expect(supportsDynamicPanoramaSeam('dji-fisheye-lut')).toBe(true);
    expect(supportsDynamicPanoramaSeam('mei-extended')).toBe(true);
  });

  it('falls back to calibrated blending when either seam has high mean error', () => {
    expect(acceptDynamicSeams([{ cost: 6_000 }, { cost: 7_000 }], 64)).toBe(true);
    expect(acceptDynamicSeams([{ cost: 6_000 }, { cost: 9_000 }], 64)).toBe(false);
    expect(acceptDynamicSeams([{ cost: Number.NaN }], 64)).toBe(false);
  });

  it('rotates wrapped DJI overlap bands into separate seam-search halves', () => {
    const costs = Uint16Array.from({ length: 16 }, (_, index) => index);
    expect([...rotatePanoramaRows(costs, 8, 2, 2)]).toEqual([6, 7, 0, 1, 2, 3, 4, 5, 14, 15, 8, 9, 10, 11, 12, 13]);
    expect(unrotatePanoramaSeam([2, 10], 16, 4)).toEqual([14, 6]);
  });

  it('builds a circular two-seam mask without changing ownership at the wrap boundary', () => {
    const first = new Float32Array(128 * 64);
    const second = new Float32Array(128 * 64);
    for (let y = 0; y < 64; y += 1) second[y*128 + 32] = 1;
    const mask = buildCircularSeamMask([first, second], new Array(64).fill(126), new Array(64).fill(64));

    const middle = 32 * 128;
    expect(mask[middle]).toBe(255);
    expect(mask[middle + 63]).toBe(255);
    expect(mask[middle + 64]).toBe(0);
    expect(mask[middle + 125]).toBe(0);
    expect(mask[middle + 126]).toBe(255);
    expect(mask[0]).toBe(128);
  });

  it('rejects incomplete or repeated lens calibration before rendering', () => {
    const lens = {
      width: 3840, height: 3840, fx: 1000, fy: 1000, cx: 1920, cy: 1920, xi: 2,
      radial: [0.1, 0.01, 0.001, 0], tangential: [0, 0], extrinsicQuaternion: [1, 0, 0, 0]
    };
    const manifest = {
      projection: { kind: 'mei-extended' as const, xi: 2 },
      lenses: [lens, { ...lens, extrinsicQuaternion: [0, 0, 1, 0] }]
    } as Parameters<typeof hasAccuratePanoramaCalibration>[0];

    expect(hasAccuratePanoramaCalibration(manifest)).toBe(true);
    expect(hasAccuratePanoramaCalibration({ ...manifest, lenses: [lens, lens] })).toBe(false);
    expect(hasAccuratePanoramaCalibration({ ...manifest, lenses: [{ ...lens, cx: 3840 }, manifest.lenses[1]] })).toBe(false);
    expect(hasAccuratePanoramaCalibration({ ...manifest, lenses: [lens, { ...lens, extrinsicQuaternion: undefined }] })).toBe(false);
    expect(hasAccuratePanoramaCalibration({ ...manifest, lenses: [lens, { ...lens, extrinsicQuaternion: [Math.SQRT1_2, 0, Math.SQRT1_2, 0] }] })).toBe(false);
    const x5Lenses = manifest.lenses.map((item) => ({ ...item, thinPrism: [0, 0, 0, 0], sensorTilt: [0, 0] }));
    expect(hasAccuratePanoramaCalibration({ ...manifest, cameraModel: 'Insta360 X5', calibrationSource: 'sidecar', lenses: x5Lenses })).toBe(true);
    expect(hasAccuratePanoramaCalibration({ ...manifest, cameraModel: 'X5', calibrationSource: 'embedded', lenses: x5Lenses })).toBe(true);
    expect(hasAccuratePanoramaCalibration({ ...manifest, cameraModel: 'X5', calibrationSource: 'embedded' })).toBe(false);
    expect(hasAccuratePanoramaCalibration({ ...manifest, cameraModel: 'X5', calibrationSource: 'sidecar' })).toBe(false);
    expect(lensOpticalAxis(manifest.lenses[1], 'mei-extended')[2]).toBeCloseTo(-1);
  });

  it('combines one calibration lens from each ONE RS companion file', () => {
    const first = { fx: 1000 };
    const second = { fx: 1001 };
    expect(mergeCompanionLenses([first], [second])).toEqual([first, second]);
  });

  it('binds unresolved companion lenses to the merged track order', () => {
    const tracks = [1, 1_000_001].map((id) => ({ id, codec: 'avc1', decoderConfig: '', width: 3072, height: 3072, timescale: 30, samples: [] }));
    expect(bindPanoramaLensTracks([{ fx: 900 }, { fx: 901 }], tracks).map((lens) => lens.sourceTrackId)).toEqual([1, 1_000_001]);
  });

  it('does not assign repeated companion calibration to both tracks', () => {
    const front = { fx: 900, extrinsicQuaternion: [1, 0, 0, 0] };
    const back = { fx: 910, extrinsicQuaternion: [0, 0, 1, 0] };

    expect(mergeCompanionLenses([front], [front, back])).toEqual([front, back]);
    expect(mergeCompanionLenses([front], [front])).toEqual([front]);
    expect(mergeCompanionLenses([front, back], [{ fx: 920 }])).toEqual([front, back]);
    expect(mergeCompanionLenses(
      [{ ...front, sourceTrackId: 1 }],
      [{ ...front, sourceTrackId: 1_000_001 }, { ...back, sourceTrackId: 1_000_001 }]
    )).toEqual([{ ...front, sourceTrackId: 1 }, { ...back, sourceTrackId: 1_000_001 }]);
  });
});

function jpeg(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    height >> 8, height & 0xff,
    width >> 8, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9
  ]);
}
