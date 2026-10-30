import { createWasmCoreRunner } from '../../converter-client/src/wasi-runner';
import wasmUrl from '../vendor/filens-step.wasm?url';

export type StepWasmSource = BufferSource | WebAssembly.Module | Response | string | URL
  | (() => BufferSource | WebAssembly.Module | Response | string | URL | Promise<BufferSource | WebAssembly.Module | Response | string | URL>);
export interface StepReaderOptions { wasm?: StepWasmSource; fetch?: typeof fetch; }
export type StepSource = ArrayBuffer | ArrayBufferView | string;
export interface StepReadOptions { tolerance?: number; signal?: AbortSignal; }
export interface StepMetadata {
  instances: number;
  faces: number;
  missingFaces: number;
  shellFallback: boolean;
  parseMs: number;
  meshMs: number;
  preparation: Record<string, unknown>;
}
export interface StepMesh {
  /** Non-indexed triangles in millimetres, three coordinates per vertex. */
  positions: Float32Array;
  normals: Float32Array;
  triangleCount: number;
  metadata: StepMetadata;
  warnings: string[];
}
export interface StepReader {
  read(source: StepSource, options?: StepReadOptions): Promise<StepMesh>;
}
export class StepReadError extends Error {
  constructor(readonly code: 'invalid_step' | 'empty_geometry' | 'incomplete_mesh' | 'invalid_mesh', message: string) {
    super(message);
    this.name = 'StepReadError';
  }
}

/** Bundled asset URL; no WASM fetch occurs until read() is called. */
export const stepWasmUrl = wasmUrl;

export function createStepReader(options: StepReaderOptions = {}): StepReader {
  const run = createWasmCoreRunner({ wasm: options.wasm ?? wasmUrl, fetch: options.fetch });
  return {
    async read(source, { tolerance = 0.1, signal } = {}) {
      if (signal?.aborted) throw Object.assign(new Error('STEP loading was aborted.'), { name: 'AbortError' });
      if (!Number.isFinite(tolerance) || tolerance <= 0) throw new RangeError('STEP tolerance must be positive and finite (millimetres).');
      const input = typeof source === 'string' ? new TextEncoder().encode(source)
        : ArrayBuffer.isView(source) ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength) : new Uint8Array(source);
      if (input.byteLength > 64 << 20) throw new RangeError('STEP input exceeds 64 MiB.');
      const result = await run({
        args: ['filens-step', '/work/input.step', '/work/mesh.json', String(tolerance), '--reviewed'],
        files: { '/work/input.step': input }, readFiles: ['/work/mesh.json'], signal, captureStdio: true
      });
      const lines = (result.stdout ?? '').trim().split('\n');
      let metadata: StepMetadata & { success?: boolean; error?: string };
      try { metadata = JSON.parse(lines[lines.length - 1]); }
      catch { throw new StepReadError('invalid_step', 'Rust STEP could not read this file.'); }
      if (result.exitCode || metadata.error) throw new StepReadError('invalid_step', metadata.error || 'Rust STEP could not read this file.');
      if (!metadata.success) throw new StepReadError('empty_geometry', 'STEP contains no displayable geometry; external assemblies require their referenced part files.');
      if (metadata.missingFaces > 0) throw new StepReadError('incomplete_mesh', `STEP tessellation left ${metadata.missingFaces} faces without geometry.`);
      const bytes = result.files['/work/mesh.json'];
      if (!bytes) throw new StepReadError('invalid_mesh', 'Rust STEP did not produce a mesh.');
      const raw = JSON.parse(new TextDecoder().decode(bytes)) as { positions: unknown; normals: unknown };
      const positions = coordinates(raw.positions), normals = coordinates(raw.normals);
      if (!positions.length || positions.length % 9 || normals.length !== positions.length) throw new StepReadError('invalid_mesh', 'Invalid STEP triangle or normal count.');
      const warnings = ['STEP preview omits source colors, names and the assembly tree.'];
      if (metadata.shellFallback) warnings.push('Shells were imported without a resolved assembly hierarchy; instance placement may be incomplete.');
      return { positions, normals, triangleCount: positions.length / 9, metadata, warnings };
    }
  };
}

function coordinates(value: unknown): Float32Array {
  if (!Array.isArray(value)) throw new StepReadError('invalid_mesh', 'Invalid STEP mesh coordinates.');
  const result = new Float32Array(value.length * 3);
  for (let row = 0; row < value.length; row++) {
    const point = value[row];
    if (!Array.isArray(point) || point.length !== 3) throw new StepReadError('invalid_mesh', 'Invalid STEP vertex.');
    for (let axis = 0; axis < 3; axis++) {
      const number = point[axis];
      if (typeof number !== 'number' || !Number.isFinite(number)) throw new StepReadError('invalid_mesh', 'Nonfinite STEP coordinate.');
      result[row * 3 + axis] = number;
      if (!Number.isFinite(result[row * 3 + axis])) throw new StepReadError('invalid_mesh', 'STEP coordinate exceeds Float32 range.');
    }
  }
  return result;
}

const defaultReader = createStepReader();
/** Reuses compiled WASM; each call has an isolated instance and virtual files. */
export function readStep(source: StepSource, options?: StepReadOptions): Promise<StepMesh> {
  return defaultReader.read(source, options);
}
