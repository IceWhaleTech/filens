import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.resolve(root, process.env.FILENS_OCCT_WORKDIR || 'tmp/occt-wasm');
const source = path.join(work, 'source/occt/src/RWStepAP214');
const directory = path.join(work, 'keyword-check');
await mkdir(directory, { recursive: true });
const reference = JSON.parse(await readFile(path.join(work, 'keyword-reference.json'), 'utf8'));
const maps = Object.values(reference.bindings).map(rows => new Map(rows));
const typeNames = new Map(reference.typeCases);
await writeFile(path.join(directory, 'check.cpp'), `#include "filens-step-keywords.pxx"
#include ${JSON.stringify(path.join(work, 'keyword-reference.hpp'))}
static char buffer[4096];
extern "C" void InitializeReference() { FilensReference::Initialize(); }
extern "C" char* BufferPtr() { return buffer; }
extern "C" int OriginalFind(int which, int length) { return FilensReference::Find(which, buffer, length); }
extern "C" const char* OriginalTypeName(int type) { return FilensReference::TypeName(type); }
static FilensReference::Sequence recipe;
extern "C" int PrepareRecipe(int type) {
  recipe.values.clear();
  FilensReference::Reader().ComplexType(type, recipe);
  return recipe.Length();
}
extern "C" const char* RecipeName(int index) { return recipe(index + 1).ToCString(); }
extern "C" int Complex(int original, int count) {
  FilensReference::Sequence sequence;
  int offset = 0;
  for (int i = 0; i < count; ++i) {
    int length;
    std::memcpy(&length, buffer + offset, 4);
    offset += 4;
    sequence.Append(FilensReference::String(buffer + offset, length));
    offset += length;
  }
  return original ? FilensReference::Reader().CaseStep(sequence) : FilensStepRecognizeComplex(sequence);
}
extern "C" int Find(int which, int length) {
  return which ? FilensStepLookup(FilensStep_typeshor, sizeof(FilensStep_typeshor)/sizeof(*FilensStep_typeshor), buffer, length)
    : FilensStepLookup(FilensStep_typenums, sizeof(FilensStep_typenums)/sizeof(*FilensStep_typenums), buffer, length);
}
extern "C" const char* TypeName(int type) {
  const int index = type >= 0 && type < int(sizeof(FilensStepTypeIndices)/sizeof(*FilensStepTypeIndices)) ? FilensStepTypeIndices[type] : 0;
  return FilensStepTypeNames[index];
}
`);
const emcmake = process.env.EMCMAKE || 'emcmake';
const emcc = path.join(path.dirname(emcmake), process.platform === 'win32' ? 'emcc.bat' : 'emcc');
const output = path.join(directory, 'check.wasm');
await new Promise((resolve, reject) => {
  const child = spawn(emcc, [path.join(directory, 'check.cpp'), '-I', source,
    '-Oz', '--no-entry', '-sSTANDALONE_WASM=1', '-sFILESYSTEM=0',
    ...['InitializeReference', 'BufferPtr', 'Find', 'TypeName', 'OriginalFind', 'OriginalTypeName', 'PrepareRecipe', 'RecipeName', 'Complex']
      .map(name => `-Wl,--export=${name}`), '-o', output], { stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`keyword compiler exited with ${code}`)));
});
const { instance } = await WebAssembly.instantiate(await readFile(output), {
  wasi_snapshot_preview1: { proc_exit(code) { throw new Error(`keyword check exited with ${code}`); } }
});
instance.exports._initialize?.();
instance.exports.InitializeReference();
let compared = 0, namesCompared = 0, complexCompared = 0, complexAccepted = 0;
const address = instance.exports.BufferPtr();
function check(key) {
  const bytes = Buffer.from(key, 'utf8');
  assert(bytes.length < 4096);
  const memory = new Uint8Array(instance.exports.memory.buffer);
  memory.set(bytes, address);
  memory[address + bytes.length] = 0;
  for (let which = 0; which < 2; ++which) {
    const expected = instance.exports.OriginalFind(which, bytes.length);
    assert.equal(expected, maps[which].get(key) || 0, `Reference extraction ${JSON.stringify(key)}`);
    assert.equal(instance.exports.Find(which, bytes.length), expected, JSON.stringify(key));
    compared++;
  }
}
for (const key of new Set(Object.values(reference.bindings).flatMap(rows => rows.map(([key]) => key)))) {
  for (const variant of [key, key.toLowerCase(), key.slice(0, -1), `${key}_`, `${key}\0suffix`, ` ${key}`, `${key} `]) check(variant);
}
for (const key of ['', '\0', '?', 'unknown', 'CARTESIAN_POINT\0', 'CMRPIT', 'B_SPLINE_SURFACE_WITH_KNOTS']) check(key);
let seed = 0x1f312a7b;
const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
for (let i = 0; i < 10000; ++i) {
  let text = '';
  const length = random() % 100;
  for (let j = 0; j < length; ++j) text += String.fromCharCode(random() % 128);
  check(text);
}
for (let type = -5; type <= 850; ++type) {
  const memory = new Uint8Array(instance.exports.memory.buffer);
  const stringAt = pointer => Buffer.from(memory.subarray(pointer, memory.indexOf(0, pointer))).toString('utf8');
  const expected = stringAt(instance.exports.OriginalTypeName(type));
  assert.equal(expected, typeNames.get(type) || reference.unknownType, `Reference type ${type}`);
  assert.equal(stringAt(instance.exports.TypeName(type)), expected, String(type));
  namesCompared++;
}
const stringAt = pointer => {
  const memory = new Uint8Array(instance.exports.memory.buffer);
  return Buffer.from(memory.subarray(pointer, memory.indexOf(0, pointer))).toString('utf8');
};
const aliases = new Map();
for (const [key, type] of maps[1]) {
  const name = typeNames.get(type) || reference.unknownType;
  if (!aliases.has(name)) aliases.set(name, key);
}
function checkComplex(names) {
  const chunks = names.map(name => {
    const value = Buffer.from(name);
    const size = Buffer.alloc(4);
    size.writeInt32LE(value.length);
    return Buffer.concat([size, value]);
  });
  const data = Buffer.concat(chunks);
  assert(data.length < 4096);
  new Uint8Array(instance.exports.memory.buffer, address, data.length).set(data);
  const expected = instance.exports.Complex(1, names.length);
  assert.equal(instance.exports.Complex(0, names.length), expected, `Complex type ${JSON.stringify(names)}`);
  complexCompared++;
  if (expected) complexAccepted++;
}
const recipes = [];
recipes.push(...reference.complexRecipes);
for (let type = 0; type <= 850; ++type) {
  const count = instance.exports.PrepareRecipe(type);
  if (count) recipes.push(Array.from({ length: count }, (_, i) => stringAt(instance.exports.RecipeName(i))));
}
// This CATIA combination is explicitly read-only and has no reverse recipe.
recipes.push([157, 165, 310].map(type => typeNames.get(type)));
for (const names of recipes) {
  checkComplex(names);
  checkComplex([...names].reverse());
  checkComplex(names.map(name => aliases.get(name) || name));
  for (let i = 0; i < names.length; ++i) {
    checkComplex(names.map((name, j) => j === i ? 'UNKNOWN_COMPONENT' : name));
    checkComplex(names.filter((_, j) => j !== i));
    checkComplex(names.map((name, j) => j === i ? `${name}\0suffix` : name));
  }
  for (let i = 0; i < 20; ++i) {
    const shuffled = names.map(name => random() % 2 ? aliases.get(name) || name : name);
    for (let j = shuffled.length - 1; j > 0; --j) {
      const k = random() % (j + 1);
      [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
    }
    checkComplex(shuffled);
  }
}
const components = [...reference.complexNames, ...aliases.values(), 'UNKNOWN_COMPONENT', '', '?', 'B_SPLINE_CURVE\0suffix'];
for (let i = 0; i < 10000; ++i) {
  checkComplex(Array.from({ length: random() % 11 }, () => components[random() % components.length]));
}
assert(complexAccepted > 500, 'Valid complex combinations must be exercised');
const result = { compared, namesCompared, complexCompared, complexAccepted, fullNames: maps[0].size, shortNames: maps[1].size,
  lastAliasBinding: maps[1].get('CMRPIT'), exact: true, reference: 'Compiled pinned registration bodies, original StepType switch and original complex recognizer/reverse recipes' };
await writeFile(path.join(directory, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(`OCCT keyword replacement check: ${JSON.stringify(result)}`);
