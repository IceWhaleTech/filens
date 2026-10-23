import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.resolve(root, process.env.FILENS_OCCT_WORKDIR || 'tmp/occt-wasm');
const standard = path.join(work, 'source/occt/src/Standard');
const directory = path.join(work, 'strtod-check');
await mkdir(directory, { recursive: true });
const original = await readFile(path.join(work, 'numeric-original/Standard_Strtod.cxx'), 'utf8');
await writeFile(path.join(directory, 'original.cpp'), `extern "C" double OriginalStrtod(const char*, char**);\n${original.replace(/\bStrtod\b/g, 'OriginalStrtod')}`);
await writeFile(path.join(directory, 'check.cpp'), `#include <Standard_CString.hxx>
#include <cerrno>
extern "C" double OriginalStrtod(const char*, char**);
static char buffer[8192];
static int endOffset;
extern "C" char* BufferPtr() { return buffer; }
extern "C" int EndOffset() { return endOffset; }
extern "C" double Parse(int original) {
  char* end; errno = 0;
  const double result = original ? OriginalStrtod(buffer, &end) : Strtod(buffer, &end);
  endOffset = int(end-buffer); return result;
}
`);
const emcmake = process.env.EMCMAKE || 'emcmake';
const emcc = path.join(path.dirname(emcmake), process.platform === 'win32' ? 'emcc.bat' : 'emcc');
const output = path.join(directory, 'check.wasm');
await new Promise((resolve, reject) => {
  const child = spawn(emcc, [path.join(directory, 'check.cpp'), path.join(directory, 'original.cpp'),
    path.join(root, 'scripts/occt-strtod.cpp'), path.join(standard, 'Standard_CLocaleSentry.cxx'),
    '-I', standard, '-Oz', '--no-entry', '-sSTANDALONE_WASM=1', '-sFILESYSTEM=0',
    ...['BufferPtr', 'EndOffset', 'Parse'].map(name => `-Wl,--export=${name}`), '-o', output], { stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`strtod compiler exited with ${code}`)));
});
const { instance } = await WebAssembly.instantiate(await readFile(output), {
  wasi_snapshot_preview1: {
    proc_exit(code) { throw new Error(`strtod check exited with ${code}`); },
    environ_sizes_get(count, size) {
      const memory = new DataView(instance.exports.memory.buffer);
      memory.setUint32(count, 0, true); memory.setUint32(size, 0, true); return 0;
    },
    environ_get() { return 0; }
  }
});
instance.exports._initialize?.();
const address = instance.exports.BufferPtr();
let compared = 0;
function check(text, expected) {
  const input = Buffer.from(`${text}\0`);
  assert(input.length <= 8192);
  new Uint8Array(instance.exports.memory.buffer, address, input.length).set(input);
  const old = instance.exports.Parse(1), oldEnd = instance.exports.EndOffset();
  const value = instance.exports.Parse(0), end = instance.exports.EndOffset();
  assert(Object.is(value, old), `strtod value ${JSON.stringify(text)}: ${value} != ${old}`);
  assert.equal(end, oldEnd, `strtod end pointer ${JSON.stringify(text)}`);
  if (expected !== undefined) assert(Object.is(value, expected), `Nearest double for ${text}`);
  compared++;
}
for (const text of ['0','-0','+0.','1','-.5','1e309','-1e309','1e-400','-1e-400',
  '2.2250738585072014e-308','2.2250738585072011e-308','4.9406564584124654e-324',
  '2.4703282292062327e-324','2.4703282292062328e-324','1.7976931348623157e308',
  '1.7976931348623159e308','9007199254740993','9007199254740995',
  '1.00000000000000011102230246251565404236316680908203125',
  '1.00000000000000011102230246251565404236316680908203126']) {
  check(` \t${text},suffix`, Number(text));
}
for (const text of ['',' ','.','+','-.','1e','1e+','1e-','12.3.4','1,2','inf','-infinity','nan','nan(payload)','0x1.8p+2','-0x0.8p-1022']) check(text);
let seed = 0x7f31ac29;
const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
for (let i = 0; i < 20000; ++i) {
  let digits = '';
  const length = 1 + random()%100;
  for (let j = 0; j < length; ++j) digits += String(random()%10);
  const point = random()%(length+1);
  const text = `${random()%2 ? '-' : '+'}${digits.slice(0,point)}.${digits.slice(point)}e${Number(random()%1301)-650}`;
  check(`${text})`, Number(text));
}
for (const exponent of [-4000,-1000,-308,0,308,1000,4000]) {
  const text = `0.${'0123456789'.repeat(400)}1e${exponent}`;
  check(text, Number(text));
}
const result = { compared, bitExact: true, endPointersExact: true, reference: 'Pinned OCCT Strtod plus JavaScript nearest-double conversion for decimal inputs' };
await writeFile(path.join(directory, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(`OCCT strtod replacement check: ${JSON.stringify(result)}`);
