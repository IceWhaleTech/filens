import { createWasmCoreRunner, type WasmModuleSource } from '@filens/converter-client';

const MAX_ITERATIONS = 8;
const MAX_RANGE_BYTES = 64 << 20;
const MAX_TOTAL_BYTES = 128 << 20;
const MAX_METADATA_SAMPLES = 120;
const MAX_METADATA_BYTES = 8 << 20;

export type PanoramaProjection =
  | { kind: 'equirectangular' }
  | { kind: 'dji-fisheye-lut'; linearExtensionDeg: number; validHalfFovDeg: number }
  | { kind: 'mei-extended'; xi: number }
  | { kind: 'unknown' };

export interface PanoramaLens {
  sourceTrackId?: number;
  sourceRect?: { x: number; y: number; width: number; height: number };
  width?: number;
  height?: number;
  fx?: number;
  fy?: number;
  cx?: number;
  cy?: number;
  distortion?: Array<number | null>;
  yawDeg?: number;
  pitchDeg?: number;
  extrinsicQuaternion?: number[];
  radialLut1?: number[];
  radialLut2?: number[];
  xi?: number;
  radial?: number[];
  tangential?: number[];
  thinPrism?: number[];
  sensorTilt?: number[];
  translation?: number[];
  projection?: PanoramaProjection;
}

export interface PanoramaCalibration {
  source: 'embedded' | 'sidecar' | 'profile' | 'not-required' | 'unavailable';
  lenses: PanoramaLens[];
}

export interface PanoramaVideoSample {
  offset: number;
  size: number;
  pts: number;
  duration: number;
  key: boolean;
}

export interface PanoramaVideoTrack {
  id: number;
  codec: string;
  decoderConfig: string;
  width: number;
  height: number;
  timescale: number;
  samples: PanoramaVideoSample[];
}

export interface PanoramaAssetManifest {
  vendor: 'dji' | 'insta360' | 'unknown';
  cameraModel?: string | null;
  firmware?: string | null;
  format: 'osv' | 'insv' | 'insp';
  textureOrigin?: 'top-left' | 'bottom-left' | null;
  projection: PanoramaProjection;
  calibrationSource: PanoramaCalibration['source'];
  confidence: 'high' | 'experimental' | 'low';
  width?: number;
  height?: number;
  tracks: PanoramaVideoTrack[];
  metadataTrack?: PanoramaVideoTrack | null;
  fileGroup?: { type?: number | null; index?: number | null; identify?: string | null } | null;
  proxyPreview?: boolean;
  imu?: {
    coordinateSystem: string;
    timestamp?: number | null;
    cameraRotation?: Array<number | null> | null;
    imuToCameraConfirmed: boolean;
    stabilizationDefault: 'off' | 'horizon-lock' | 'camera';
  } | null;
  lenses: PanoramaLens[];
  warnings: string[];
}

export type PanoramaProcessorErrorCode =
  | 'calibration_missing'
  | 'sidecar_missing'
  | 'codec_unsupported'
  | 'range_unavailable'
  | 'track_unsynchronized'
  | 'firmware_unknown'
  | 'resource_limit'
  | 'invalid_manifest';

export class PanoramaProcessorError extends Error {
  constructor(readonly code: PanoramaProcessorErrorCode, message: string) {
    super(message);
    this.name = 'PanoramaProcessorError';
  }
}

export type PanoramaInput = Blob | ArrayBuffer | ArrayBufferView | string | URL;

export interface PanoramaOpenOptions {
  format: 'osv' | 'insv' | 'insp';
  sidecar?: PanoramaInput;
  companion?: PanoramaInput;
  signal?: AbortSignal;
}

export interface PanoramaEncodedSample extends PanoramaVideoSample {
  trackId: number;
  timescale: number;
  data: Uint8Array;
}

export interface PanoramaImuSample {
  pts: number;
  timescale: number;
  timestamp?: number | null;
  cameraRotation?: Array<number | null> | null;
}

export interface PanoramaSeamRequest {
  width: number;
  height: number;
  costs: ArrayLike<number>;
  previous?: ArrayLike<number>;
  temporalWeight?: number;
  maxStep?: number;
}

export interface PanoramaSeamResult {
  seam: number[];
  cost: number;
}

export interface PanoramaProcessor {
  open(source: PanoramaInput, options: PanoramaOpenOptions): Promise<PanoramaAssetManifest>;
  readSample(trackId: number, sampleIndex: number, signal?: AbortSignal): Promise<PanoramaEncodedSample>;
  readImuWindow(start: number, count: number, signal?: AbortSignal): Promise<PanoramaImuSample[]>;
  seek(seconds: number): Record<number, number>;
  computeSeam(request: PanoramaSeamRequest, signal?: AbortSignal): Promise<PanoramaSeamResult>;
  close(): void;
  abort(): void;
  getManifest(): PanoramaAssetManifest | undefined;
}

export interface WasmPanoramaProcessorOptions {
  wasm: WasmModuleSource;
  fetch?: typeof fetch;
}

interface RequiredRange { offset: number; length: number }
interface CoreInspectResult {
  ok: boolean;
  payload?: Omit<PanoramaAssetManifest, 'projection'> & { projection: string };
  requiredRanges?: RequiredRange[];
  errorCode?: string;
  errorMessage?: string;
}

export function createWasmPanoramaProcessor(options: WasmPanoramaProcessorOptions): PanoramaProcessor {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const runCore = createWasmCoreRunner({ wasm: options.wasm, fetch: fetchImpl });
  let reader: RangeReader | undefined;
  let manifest: PanoramaAssetManifest | undefined;
  let controller: AbortController | undefined;
  let companionProcessor: PanoramaProcessor | undefined;
  const companionTrackIds = new Map<number, number>();

  const close = () => {
    controller?.abort();
    controller = undefined;
    reader?.close();
    reader = undefined;
    companionProcessor?.close();
    companionProcessor = undefined;
    companionTrackIds.clear();
    manifest = undefined;
  };

  return {
    async open(source, openOptions) {
      close();
      controller = new AbortController();
      const signal = combineSignals(controller.signal, openOptions.signal);
      reader = await RangeReader.open(source, fetchImpl, signal);
      const ranges = new Map<string, { offset: number; bytes: Uint8Array }>();
      const initial = [
        { offset: 0, length: Math.min(64 << 10, reader.size) },
        { offset: Math.max(0, reader.size - (1 << 20)), length: Math.min(1 << 20, reader.size) }
      ];
      await addRanges(reader, ranges, initial, signal);
      let sidecarBytes: Uint8Array | undefined;
      if (openOptions.sidecar) {
        const sidecar = await RangeReader.open(openOptions.sidecar, fetchImpl, signal);
        if (sidecar.size > 8 << 20) throw new PanoramaProcessorError('resource_limit', 'Panorama sidecar exceeds 8 MiB.');
        sidecarBytes = await sidecar.read(0, sidecar.size, signal);
        sidecar.close();
      }

      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
        throwIfAborted(signal);
        const optionRanges = [...ranges.values()].map((range, index) => ({
          offset: range.offset,
          path: `/work/range-${index}.bin`
        }));
        const files: Record<string, Uint8Array> = {
          '/work/options.json': new TextEncoder().encode(JSON.stringify({
            logicalSize: reader.size,
            ranges: optionRanges,
            ...(sidecarBytes ? { sidecarPath: '/work/sidecar.pb' } : {})
          }))
        };
        if (sidecarBytes) files['/work/sidecar.pb'] = sidecarBytes;
        [...ranges.values()].forEach((range, index) => { files[`/work/range-${index}.bin`] = range.bytes; });
        const resultPath = '/work/result.json';
        const invocation = await runCore({
          args: ['converter-core', '--operation', 'inspect-panorama', '--source', openOptions.format, '--options', '/work/options.json', '--result', resultPath],
          files,
          readFiles: [resultPath]
        });
        const resultBytes = invocation.files[resultPath];
        if (!resultBytes) throw new PanoramaProcessorError('invalid_manifest', 'Panorama inspector did not return a result.');
        const result = JSON.parse(new TextDecoder().decode(resultBytes)) as CoreInspectResult;
        if (result.ok && result.payload) {
          manifest = normalizeManifest(result.payload);
          if (openOptions.companion) {
            companionProcessor = createWasmPanoramaProcessor(options);
            const companionManifest = await companionProcessor.open(openOptions.companion, {
              format: openOptions.format,
              sidecar: openOptions.sidecar,
              signal
            });
            const usedIds = new Set(manifest.tracks.map((track) => track.id));
            const remappedTrackIds = new Map<number, number>();
            const companionTracks = companionManifest.tracks.map((track) => {
              let id = track.id;
              while (usedIds.has(id)) id += 1_000_000;
              usedIds.add(id);
              companionTrackIds.set(id, track.id);
              remappedTrackIds.set(track.id, id);
              return { ...track, id };
            });
            const companionLenses = companionManifest.lenses.map((lens) => ({
              ...lens,
              sourceTrackId: lens.sourceTrackId === undefined ? undefined : remappedTrackIds.get(lens.sourceTrackId)
            }));
            const tracks = [...manifest.tracks, ...companionTracks];
            const lenses = bindPanoramaLensTracks(mergeCompanionLenses(manifest.lenses, companionLenses), tracks);
            const warnings = [...manifest.warnings, ...companionManifest.warnings];
            manifest = {
              ...manifest,
              cameraModel: manifest.cameraModel || companionManifest.cameraModel,
              firmware: manifest.firmware || companionManifest.firmware,
              textureOrigin: manifest.textureOrigin || companionManifest.textureOrigin,
              projection: manifest.projection.kind === 'unknown' ? companionManifest.projection : manifest.projection,
              calibrationSource: manifest.calibrationSource === 'unavailable' ? companionManifest.calibrationSource : manifest.calibrationSource,
              confidence: manifest.confidence === 'low' ? companionManifest.confidence : manifest.confidence,
              tracks,
              lenses,
              warnings: lenses.length >= 2
                ? warnings.filter((warning) => !warning.includes('matching companion file') && !warning.startsWith('INSV calibration was not found'))
                : warnings
            };
          }
          return manifest;
        }
        if (result.errorCode !== 'need_ranges' || !result.requiredRanges?.length) {
          throw mapCoreError(result.errorCode, result.errorMessage);
        }
        await addRanges(reader, ranges, result.requiredRanges, signal);
      }
      throw new PanoramaProcessorError('resource_limit', `Panorama inspection exceeded ${MAX_ITERATIONS} range iterations.`);
    },

    async readSample(trackId, sampleIndex, signal) {
      const companionTrackId = companionTrackIds.get(trackId);
      if (companionTrackId !== undefined && companionProcessor) {
        const sample = await companionProcessor.readSample(companionTrackId, sampleIndex, signal);
        return { ...sample, trackId };
      }
      if (!reader || !manifest) throw new PanoramaProcessorError('invalid_manifest', 'Open a panorama source before reading samples.');
      const track = manifest.tracks.find((item) => item.id === trackId) ?? (manifest.metadataTrack?.id === trackId ? manifest.metadataTrack : undefined);
      const sample = track?.samples[sampleIndex];
      if (!track || !sample) throw new RangeError(`Unknown panorama sample ${trackId}:${sampleIndex}.`);
      const data = await reader.read(sample.offset, sample.size, combineSignals(controller?.signal, signal));
      return { ...sample, trackId, timescale: track.timescale, data };
    },

    async readImuWindow(start, count, signal) {
      if (!manifest?.metadataTrack) return [];
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count) || start < 0 || count < 0 || count > MAX_METADATA_SAMPLES) {
        throw new PanoramaProcessorError('resource_limit', `Panorama metadata windows are limited to ${MAX_METADATA_SAMPLES} samples.`);
      }
      const track = manifest.metadataTrack;
      const selected = track.samples.slice(start, start + count);
      const total = selected.reduce((sum, sample) => sum + sample.size, 0);
      if (total > MAX_METADATA_BYTES) throw new PanoramaProcessorError('resource_limit', 'Panorama metadata window exceeds 8 MiB.');
      const files: Record<string, Uint8Array> = {};
      const samples = [];
      for (let index = 0; index < selected.length; index += 1) {
        const encoded = await this.readSample(track.id, start + index, signal);
        const path = `/work/metadata-${index}.bin`;
        files[path] = encoded.data;
        samples.push({ path, pts: encoded.pts, timescale: encoded.timescale });
      }
      const resultPath = '/work/result.json';
      throwIfAborted(combineSignals(controller?.signal, signal));
      files['/work/options.json'] = new TextEncoder().encode(JSON.stringify({ vendor: manifest.vendor, samples }));
      const invocation = await runCore({
        args: ['converter-core', '--operation', 'decode-panorama-metadata', '--options', '/work/options.json', '--result', resultPath],
        files,
        readFiles: [resultPath]
      });
      const bytes = invocation.files[resultPath];
      if (!bytes) throw new PanoramaProcessorError('invalid_manifest', 'Panorama metadata decoder did not return a result.');
      const result = JSON.parse(new TextDecoder().decode(bytes)) as { ok: boolean; payload?: { samples?: PanoramaImuSample[] }; errorCode?: string; errorMessage?: string };
      if (!result.ok || !Array.isArray(result.payload?.samples)) throw mapCoreError(result.errorCode, result.errorMessage);
      return result.payload.samples;
    },

    seek(seconds) {
      if (!manifest) return {};
      return Object.fromEntries(manifest.tracks.map((track) => [track.id, findKeySample(track, seconds)]));
    },

    async computeSeam(request, signal) {
      throwIfAborted(combineSignals(controller?.signal, signal));
      const resultPath = '/work/result.json';
      const invocation = await runCore({
        args: ['converter-core', '--operation', 'panorama-seam', '--options', '/work/options.json', '--result', resultPath],
        files: {
          '/work/options.json': new TextEncoder().encode(JSON.stringify({
            width: request.width,
            height: request.height,
            costs: Array.from(request.costs),
            previous: request.previous ? Array.from(request.previous) : [],
            temporalWeight: request.temporalWeight ?? 2,
            maxStep: request.maxStep ?? 1
          }))
        },
        readFiles: [resultPath]
      });
      const bytes = invocation.files[resultPath];
      if (!bytes) throw new PanoramaProcessorError('invalid_manifest', 'Panorama seam solver did not return a result.');
      const result = JSON.parse(new TextDecoder().decode(bytes)) as CoreInspectResult;
      if (!result.ok || !result.payload) throw mapCoreError(result.errorCode, result.errorMessage);
      const payload = result.payload as unknown as PanoramaSeamResult;
      if (!Array.isArray(payload.seam) || !Number.isFinite(payload.cost)) throw new PanoramaProcessorError('invalid_manifest', 'Panorama seam solver returned an invalid path.');
      return payload;
    },

    close,
    abort: () => controller?.abort(),
    getManifest: () => manifest
  };
}

export function panoramaDecoderConfig(track: PanoramaVideoTrack): VideoDecoderConfig {
  return {
    codec: codecString(track),
    codedWidth: track.width,
    codedHeight: track.height,
    description: hexBytes(track.decoderConfig),
    optimizeForLatency: true
  };
}

export function panoramaEncodedVideoChunk(sample: PanoramaEncodedSample): EncodedVideoChunk {
  return new EncodedVideoChunk({
    type: sample.key ? 'key' : 'delta',
    timestamp: Math.round(sample.pts * 1_000_000 / sample.timescale),
    duration: Math.round(sample.duration * 1_000_000 / sample.timescale),
    data: sample.data
  });
}

function normalizeManifest(payload: CoreInspectResult['payload']): PanoramaAssetManifest {
  if (!payload || !Array.isArray(payload.tracks) || !Array.isArray(payload.lenses)) {
    throw new PanoramaProcessorError('invalid_manifest', 'Panorama inspector returned an invalid manifest.');
  }
  const firstLensProjection = payload.lenses[0]?.projection;
  const projection = typeof payload.projection === 'string'
    ? (firstLensProjection && typeof firstLensProjection === 'object' ? firstLensProjection : { kind: payload.projection }) as PanoramaProjection
    : { kind: 'unknown' } as PanoramaProjection;
  const lenses = payload.lenses.map((lens) => ({
    ...lens,
    projection: lens.projection && typeof lens.projection === 'object'
      ? lens.projection
      : projection
  }));
  return { ...payload, projection, lenses } as PanoramaAssetManifest;
}

function findKeySample(track: PanoramaVideoTrack, seconds: number): number {
  const target = Math.max(0, seconds) * track.timescale;
  let candidate = 0;
  for (let index = 0; index < track.samples.length; index += 1) {
    const sample = track.samples[index];
    if (sample.pts > target) break;
    if (sample.key) candidate = index;
  }
  return candidate;
}

export function mergeCompanionLenses(primary: PanoramaLens[], companion: PanoramaLens[]): PanoramaLens[] {
  const merged = primary.slice(0, 2);
  const keys = new Set(merged.map(lensCalibrationKey));
  for (const lens of companion) {
    if (merged.length === 2) break;
    const key = lensCalibrationKey(lens);
    if (keys.has(key)) continue;
    merged.push(lens);
    keys.add(key);
  }
  return merged;
}

export function bindPanoramaLensTracks(lenses: PanoramaLens[], tracks: PanoramaVideoTrack[]): PanoramaLens[] {
  if (tracks.length < lenses.length) return lenses;
  return lenses.map((lens, index) => lens.sourceTrackId === undefined ? { ...lens, sourceTrackId: tracks[index].id } : lens);
}

function lensCalibrationKey(lens: PanoramaLens): string {
  const calibration = { ...lens };
  delete calibration.sourceTrackId;
  delete calibration.sourceRect;
  return JSON.stringify(calibration);
}

function codecString(track: PanoramaVideoTrack): string {
  const bytes = hexBytes(track.decoderConfig);
  if ((track.codec === 'avc1' || track.codec === 'avc3') && bytes.length >= 4) {
    return `${track.codec}.${[...bytes.slice(1, 4)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  if ((track.codec === 'hvc1' || track.codec === 'hev1') && bytes.length >= 13) {
    const profileSpace = ['', 'A', 'B', 'C'][bytes[1] >> 6];
    const tier = bytes[1] & 0x20 ? 'H' : 'L';
    const profile = bytes[1] & 0x1f;
    let flags = new DataView(bytes.buffer, bytes.byteOffset + 2, 4).getUint32(0);
    let reversed = 0;
    for (let bit = 0; bit < 32; bit += 1) {
      reversed = (reversed << 1) | (flags & 1);
      flags >>>= 1;
    }
    const compatibility = (reversed >>> 0).toString(16);
    const constraints = [...bytes.slice(6, 12)];
    while (constraints.at(-1) === 0) constraints.pop();
    const constraintSuffix = constraints.length ? `.${constraints.map((byte) => byte.toString(16)).join('.')}` : '';
    return `${track.codec}.${profileSpace}${profile}.${compatibility}.${tier}${bytes[12]}${constraintSuffix}`;
  }
  return track.codec;
}

function hexBytes(value: string): Uint8Array {
  if (!value) return new Uint8Array();
  return Uint8Array.from(value.match(/.{1,2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
}

async function addRanges(reader: RangeReader, cache: Map<string, { offset: number; bytes: Uint8Array }>, requested: RequiredRange[], signal?: AbortSignal): Promise<void> {
  for (const range of requested) {
    if (!Number.isSafeInteger(range.offset) || !Number.isSafeInteger(range.length) || range.offset < 0 || range.length <= 0 || range.length > MAX_RANGE_BYTES || range.offset + range.length > reader.size) {
      throw new PanoramaProcessorError('resource_limit', 'Panorama inspector requested an invalid source range.');
    }
    const key = `${range.offset}:${range.length}`;
    if (!cache.has(key)) cache.set(key, { offset: range.offset, bytes: await reader.read(range.offset, range.length, signal) });
    const total = [...cache.values()].reduce((sum, item) => sum + item.bytes.byteLength, 0);
    if (total > MAX_TOTAL_BYTES) throw new PanoramaProcessorError('resource_limit', 'Panorama inspection exceeded its 128 MiB range budget.');
  }
}

class RangeReader {
  private constructor(readonly size: number, private readonly readRange: (offset: number, length: number, signal?: AbortSignal) => Promise<Uint8Array>, private readonly cleanup?: () => void) {}

  static async open(source: PanoramaInput, fetchImpl: typeof fetch | undefined, signal?: AbortSignal): Promise<RangeReader> {
    if (source instanceof Blob) return new RangeReader(source.size, async (offset, length) => new Uint8Array(await source.slice(offset, offset + length).arrayBuffer()));
    if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
      const bytes = source instanceof ArrayBuffer ? new Uint8Array(source) : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
      return new RangeReader(bytes.byteLength, async (offset, length) => bytes.slice(offset, offset + length));
    }
    if (!fetchImpl) throw new PanoramaProcessorError('range_unavailable', 'A fetch implementation is required for remote panorama sources.');
    const url = String(source);
    const probe = await fetchImpl(url, { headers: { Range: 'bytes=0-0' }, signal });
    const contentRange = probe.headers.get('content-range');
    if (probe.status === 206 && contentRange) {
      const size = Number(contentRange.match(/\/(\d+)$/)?.[1]);
      await probe.body?.cancel();
      if (!Number.isSafeInteger(size) || size <= 0) throw new PanoramaProcessorError('range_unavailable', 'Remote panorama size is unavailable.');
      return new RangeReader(size, async (offset, length, readSignal) => {
        const response = await fetchImpl(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` }, signal: readSignal });
        if (response.status !== 206) throw new PanoramaProcessorError('range_unavailable', 'Remote server stopped honoring byte ranges.');
        return new Uint8Array(await response.arrayBuffer());
      });
    }
    const size = Number(probe.headers.get('content-length'));
    if (!probe.ok || !Number.isSafeInteger(size) || size <= 0 || size > MAX_RANGE_BYTES) {
      await probe.body?.cancel();
      throw new PanoramaProcessorError('range_unavailable', 'Remote server must support HTTP byte ranges for large panorama files.');
    }
    const bytes = new Uint8Array(await probe.arrayBuffer());
    return new RangeReader(bytes.byteLength, async (offset, length) => bytes.slice(offset, offset + length));
  }

  read(offset: number, length: number, signal?: AbortSignal) {
    throwIfAborted(signal);
    return this.readRange(offset, length, signal);
  }

  close() { this.cleanup?.(); }
}

function mapCoreError(code?: string, message?: string): PanoramaProcessorError {
  const mapped: Partial<Record<string, PanoramaProcessorErrorCode>> = {
    range_unavailable: 'range_unavailable', resource_limit: 'resource_limit',
    sidecar_missing: 'sidecar_missing',
    firmware_unknown: 'firmware_unknown',
    invalid_panorama_options: 'invalid_manifest', invalid_panorama_metadata: 'invalid_manifest', unsupported_container: 'invalid_manifest',
    unsupported_projection: 'calibration_missing'
  };
  return new PanoramaProcessorError(mapped[code ?? ''] ?? 'calibration_missing', message || code || 'Panorama inspection failed.');
}

function combineSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const active = signals.filter(Boolean) as AbortSignal[];
  if (!active.length) return undefined;
  if (active.length === 1) return active[0];
  return AbortSignal.any(active);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new DOMException('The panorama operation was aborted.', 'AbortError');
}
