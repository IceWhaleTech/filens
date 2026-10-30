// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createWasmCoreRunner } from '../src';
import { call, createWasiProgram, createWasiWriteFixture, get32, iov, open, write } from './fixtures/wasi.mjs';

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
async function execute(commands: number[][], data: Array<[number, string | Uint8Array]> = [], files: Record<string, Uint8Array> = {}) {
  const wasm = await WebAssembly.compile(createWasiProgram({
    data: [[1024, 'output.bin'], [1088, 'trace.bin'], ...data],
    commands: [...commands, open(1088, 'trace.bin', 144), iov(2048, 1024), write(144)]
  }));
  const result = await createWasmCoreRunner({ wasm })({ args: ['io-check'], files, readFiles: ['/work/output.bin', '/work/trace.bin'] });
  expect(result.exitCode).toBe(0);
  return { output: result.files['/work/output.bin'], trace: new DataView(result.files['/work/trace.bin'].buffer) };
}

describe('WASI file writes through actual WebAssembly imports', () => {
  it('captures split UTF-8 stdout/stderr only when requested and resets them per invocation', async () => {
    const bytes = new TextEncoder().encode('几何已完成');
    const wasm = await WebAssembly.compile(createWasiProgram({ data: [[4096, bytes], [4200, 'diagnostic']], commands: [
      iov(4096, 2), call('fd_write', [1, 64, 1, 200]),
      iov(4098, bytes.length - 2), call('fd_write', [1, 64, 1, 200]),
      iov(4200, 10), call('fd_write', [2, 64, 1, 200])
    ] }));
    const run = createWasmCoreRunner({ wasm });
    expect(await run({ args: [], files: {} })).not.toHaveProperty('stdout');
    for (let i = 0; i < 2; i++) expect(await run({ args: [], files: {}, captureStdio: true })).toMatchObject({ stdout: '几何已完成', stderr: 'diagnostic' });
  });
  it('matches every byte across many growth boundaries', async () => {
    const { wasm, pattern } = createWasiWriteFixture(3 * 1024 * 1024, 3072);
    const result = await createWasmCoreRunner({ wasm })({ args: ['io-check'], files: {}, readFiles: ['/work/output.bin'] });
    const output = result.files['/work/output.bin']; expect(output.length).toBe(3 * 1024 * 1024);
    expect(output.every((byte, index) => byte === pattern[index % pattern.length])).toBe(true);
  });
  it('keeps short writes, multi-iov writes, stat and EOF reads at logical length', async () => {
    const { output, trace } = await execute([
      open(1024, 'output.bin'), iov(4096, 3), iov(4104, 3, 72), write(128, 2),
      iov(4112, 1), write(), call('fd_filestat_get', [get32(128), 2048]),
      call('path_filestat_get', [3, 0, 1024, 10, 2112]), call('fd_seek', [get32(128), 5n, 0, 2176]),
      iov(2200, 20), call('fd_read', [get32(128), 64, 1, 2192]), call('fd_tell', [get32(128), 2224])
    ], [[4096, 'abc'], [4104, 'def'], [4112, '!']]);
    expect(text(output)).toBe('abcdef!'); expect(trace.getBigUint64(32, true)).toBe(7n); expect(trace.getBigUint64(96, true)).toBe(7n);
    expect(trace.getUint32(144, true)).toBe(2); expect(text(new Uint8Array(trace.buffer, 152, 2))).toBe('f!'); expect(trace.getBigUint64(176, true)).toBe(7n);
  });
  it('overwrites in place and zero-fills a seek gap without exposing capacity', async () => {
    const { output } = await execute([
      open(1024, 'output.bin'), iov(4096, 6), write(), call('fd_seek', [get32(128), 2n, 0, 2048]),
      iov(4104, 2), write(), call('fd_seek', [get32(128), 9n, 0, 2048]), iov(4112, 1), write()
    ], [[4096, 'abcdef'], [4104, 'XY'], [4112, '!']]);
    expect([...output]).toEqual([...new TextEncoder().encode('abXYef'), 0, 0, 0, 33]);
  });
  it('uses current logical EOF for append even after seeking and another descriptor writes', async () => {
    const { output } = await execute([
      open(1024, 'output.bin'), iov(4096, 3), write(), open(1024, 'output.bin', 132, 0, 1),
      call('fd_seek', [get32(132), 0n, 0, 2048]), iov(4104, 1), write(132),
      call('fd_seek', [get32(128), 0n, 2, 2048]), iov(4112, 1), write(), iov(4120, 1), write(132)
    ], [[4096, 'abc'], [4104, '!'], [4112, 'X'], [4120, 'Y']]);
    expect(text(output)).toBe('abc!XY');
  });
  it('does not extend or allocate a file for zero-length writes beyond EOF', async () => {
    const { output, trace } = await execute([
      open(1024, 'output.bin'), iov(4096, 3), write(), call('fd_seek', [get32(128), 5000n, 0, 2048]),
      iov(4096, 0), write(), call('fd_filestat_get', [get32(128), 2112]), call('fd_tell', [get32(128), 2200])
    ], [[4096, 'abc']]);
    expect(text(output)).toBe('abc'); expect(trace.getBigUint64(96, true)).toBe(3n); expect(trace.getBigUint64(152, true)).toBe(5000n);
  });
  it('truncates existing capacity and leaves old descriptors at their existing positions', async () => {
    const { output } = await execute([
      open(1024, 'output.bin'), iov(4096, 6), write(), open(1024, 'output.bin', 132, 8),
      iov(4104, 1), write(132), iov(4112, 1), write(128)
    ], [[4096, 'abcdef'], [4104, '!'], [4112, 'X']]);
    expect([...output]).toEqual([33, 0, 0, 0, 0, 0, 88]);
  });
  it('keeps initial and returned files isolated across runner invocations', async () => {
    const input = new TextEncoder().encode('original');
    const wasm = await WebAssembly.compile(createWasiProgram({ data: [[1024, 'output.bin'], [4096, '!']], commands: [open(1024, 'output.bin', 128, 0), iov(4096, 1), write()] }));
    const runner = createWasmCoreRunner({ wasm }), invocation = { args: ['io'], files: { '/work/output.bin': input }, readFiles: ['/work/output.bin'] };
    const first = await runner(invocation); first.files['/work/output.bin'].fill(0);
    const next = await runner(invocation); expect(text(next.files['/work/output.bin'])).toBe('!riginal'); expect(text(input)).toBe('original');
  });
  it('keeps pread independent of descriptor position after growth', async () => {
    const { output, trace } = await execute([
      open(1024, 'output.bin'), iov(4096, 3), write(), iov(4104, 3), write(),
      iov(2200, 10), call('fd_pread', [get32(128), 64, 1, 2n, 2192]), call('fd_tell', [get32(128), 2224])
    ], [[4096, 'abc'], [4104, 'def']]);
    expect(text(output)).toBe('abcdef'); expect(trace.getUint32(144, true)).toBe(4); expect(text(new Uint8Array(trace.buffer, 152, 4))).toBe('cdef'); expect(trace.getBigUint64(176, true)).toBe(6n);
  });
  it('rejects an invalid seek origin without moving the descriptor', async () => {
    const { trace } = await execute([
      open(1024, 'output.bin'), iov(4096, 3), write(), call('fd_seek', [get32(128), 5n, 99, 2080], 2048), call('fd_tell', [get32(128), 2112])
    ], [[4096, 'abc']]);
    expect(trace.getUint32(0, true)).toBe(28); expect(trace.getBigUint64(64, true)).toBe(3n);
  });
  it('returns EEXIST for exclusive creation and keeps the old file intact', async () => {
    const { output, trace } = await execute([
      open(1024, 'output.bin'), iov(4096, 3), write(), open(1024, 'output.bin', 132, 1 | 4 | 8, 0, 2048)
    ], [[4096, 'abc']]);
    expect(trace.getUint32(0, true)).toBe(20); expect(text(output)).toBe('abc');
  });
});
