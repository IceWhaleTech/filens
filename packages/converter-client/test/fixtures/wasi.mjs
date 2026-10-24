// Minimal deterministic WASM producer for exercising the public WASI runner.
// Encoding the small instruction subset avoids a compiler/toolchain dependency.
const utf8 = value => [...new TextEncoder().encode(value)];
const unsigned = value => { const bytes = []; do { const byte = value & 127; value >>>= 7; bytes.push(byte | (value ? 128 : 0)); } while (value); return bytes; };
const signed = input => { let value = BigInt(input); const bytes = []; for (;;) { const byte = Number(value & 127n); value >>= 7n; const done = (value === 0n && !(byte & 64)) || (value === -1n && !!(byte & 64)); bytes.push(byte | (done ? 0 : 128)); if (done) return bytes; } };
const vector = items => [...unsigned(items.length), ...items.flat()];
const string = value => vector(utf8(value));
const section = (id, bytes) => [id, ...unsigned(bytes.length), ...bytes];
const imports = [
  ['path_open', ['i32','i32','i32','i32','i32','i64','i64','i32','i32']],
  ['fd_write', ['i32','i32','i32','i32']], ['fd_read', ['i32','i32','i32','i32']],
  ['fd_pread', ['i32','i32','i32','i64','i32']], ['fd_seek', ['i32','i64','i32','i32']],
  ['fd_tell', ['i32','i32']], ['fd_filestat_get', ['i32','i32']], ['path_filestat_get', ['i32','i32','i32','i32','i32']],
  ['fd_close', ['i32']], ['path_unlink_file', ['i32','i32','i32']]
];
export const i32 = value => [0x41, ...signed(value)];
export const i64 = value => [0x42, ...signed(value)];
export const get32 = pointer => [...i32(pointer), 0x28, 2, 0];
export const set32 = (pointer, value) => [...i32(pointer), ...(Array.isArray(value) ? value : i32(value)), 0x36, 2, 0];
export function call(name, args, storeAt) {
  const index = imports.findIndex(([candidate]) => candidate === name); if (index < 0) throw new Error(name);
  const expressions = args.flatMap((value, offset) => Array.isArray(value) ? value : imports[index][1][offset] === 'i64' ? i64(value) : i32(value));
  const code = [...expressions, 0x10, ...unsigned(index)];
  return storeAt === undefined ? [...code, 0x1a] : [...i32(storeAt), ...code, 0x36, 2, 0];
}
export const open = (pointer, name, fdPointer = 128, flags = 1, append = 0, errnoPointer) => call('path_open', [3, 0, pointer, utf8(name).length, flags, 0n, 0n, append, fdPointer], errnoPointer);
export const iov = (pointer, length, at = 64) => [...set32(at, pointer), ...set32(at + 4, length)];
export const write = (fdPointer = 128, count = 1, iovs = 64, writtenAt = 256) => call('fd_write', [get32(fdPointer), iovs, count, writtenAt]);
// One local counter at index 0; _start itself has no parameters.
export const repeat = (count, commands) => [...i32(0), 0x21, 0, 0x02, 0x40, 0x03, 0x40,
  0x20, 0, ...i32(count), 0x4f, 0x0d, 1, ...commands.flat(),
  0x20, 0, ...i32(1), 0x6a, 0x21, 0, 0x0c, 0, 0x0b, 0x0b];
export function createWasiProgram({ commands = [], data = [], pages = 2 } = {}) {
  const valueType = name => name === 'i64' ? 0x7e : 0x7f;
  const types = imports.map(([, args]) => [0x60, ...vector(args.map(valueType)), 1, 0x7f]); types.push([0x60, 0, 0]);
  const body = [1, 1, 0x7f, ...commands.flat(), 0x0b];
  const module = [0,97,115,109,1,0,0,0,
    ...section(1, vector(types)),
    ...section(2, vector(imports.map(([name], index) => [...string('wasi_snapshot_preview1'), ...string(name), 0, ...unsigned(index)]))),
    ...section(3, [1, ...unsigned(imports.length)]),
    ...section(5, [1, 0, ...unsigned(pages)]),
    ...section(7, vector([[...string('memory'), 2, 0], [...string('_start'), 0, ...unsigned(imports.length)]])),
    ...section(10, [1, ...unsigned(body.length), ...body]),
    ...section(11, vector(data.map(([offset, bytes]) => [0, ...i32(offset), 0x0b, ...vector(typeof bytes === 'string' ? utf8(bytes) : [...bytes])])))] ;
  return new Uint8Array(module);
}
export function createWasiWriteFixture(totalBytes, blockBytes) {
  if (totalBytes % blockBytes || blockBytes < 1) throw new Error('Use full blocks.');
  const pattern = Uint8Array.from({ length: blockBytes }, (_, index) => (index * 31 + 17) & 255);
  return { pattern, wasm: createWasiProgram({ pages: Math.ceil((4096 + blockBytes) / 65536), data: [[1024, 'output.bin'], [4096, pattern]],
    commands: [open(1024, 'output.bin'), iov(4096, blockBytes), repeat(totalBytes / blockBytes, [write()])] }) };
}
