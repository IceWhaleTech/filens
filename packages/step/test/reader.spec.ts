import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { createStepReader } from '../src';

const wasm = new Uint8Array(await readFile(new URL('../vendor/filens-step.wasm', import.meta.url)));
const fixture = async (name: string) => new Uint8Array(await readFile(new URL(`../../model3d/test/fixtures/occt/${name}`, import.meta.url)));

describe('real production Rust STEP WASM in the browser WASI host', () => {
  it.each(['cube.stp', 'rounded-cube.step', 'assembly.stp'])('loads finite placed triangles from %s', async name => {
    const reader = createStepReader({ wasm });
    const result = await reader.read(await fixture(name));
    expect(result.triangleCount).toBeGreaterThan(0);
    expect(result.positions.length).toBe(result.triangleCount * 9);
    expect(result.normals.length).toBe(result.positions.length);
    expect(result.positions.every(Number.isFinite)).toBe(true);
    expect(result.normals.every(Number.isFinite)).toBe(true);
    expect(result.metadata.missingFaces).toBe(0);
    expect(result.metadata.faces).toBeGreaterThan(0);
    expect(result.metadata.preparation.millimetresPerUnit).toBeGreaterThan(0);
    if (name === 'assembly.stp') expect(result.metadata.instances).toBeGreaterThan(1);
  });

  it('isolates concurrent files and recovers after an invalid file', async () => {
    const load = vi.fn(async () => wasm), reader = createStepReader({ wasm: load });
    const cube = await fixture('cube.stp'), rounded = await fixture('rounded-cube.step');
    const [a, b] = await Promise.all([reader.read(cube), reader.read(rounded)]);
    expect(a.triangleCount).not.toBe(b.triangleCount);
    await expect(reader.read('not a STEP file')).rejects.toMatchObject({ name: 'StepReadError', code: 'invalid_step' });
    expect((await reader.read(cube)).positions).toEqual(a.positions);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid tolerance before loading a module', async () => {
    const load = vi.fn(async () => wasm), reader = createStepReader({ wasm: load });
    for (const tolerance of [0, -1, NaN, Infinity]) await expect(reader.read('', { tolerance })).rejects.toThrow('tolerance');
    expect(load).not.toHaveBeenCalled();
  });

  it('cancels one waiter while preserving a shared module load', async () => {
    let resolve!: (bytes: Uint8Array) => void;
    const pending = new Promise<Uint8Array>(done => { resolve = done; });
    const load = vi.fn(() => pending), reader = createStepReader({ wasm: load });
    const source = await fixture('cube.stp'), controller = new AbortController();
    const old = expect(reader.read(source, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    const current = reader.read(source);
    controller.abort(); await old;
    resolve(wasm);
    expect((await current).triangleCount).toBeGreaterThan(0);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
