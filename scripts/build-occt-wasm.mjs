import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pruneOcctImporter, pruneMeshProtocols, prunePreviewProtocols, prunePreviewMesher, prunePreviewSessions, prunePreviewEncodings, prunePreviewMessages, prunePreviewIO } from './prune-occt-importer.mjs';
import { compactOcctTables } from './compact-occt-tables.mjs';
import { compactOcctKeywords } from './compact-occt-keywords.mjs';
import { stripWasmDebug } from './occt-wasm-binary.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.resolve(root, process.env.FILENS_OCCT_WORKDIR || 'tmp/occt-wasm');
const source = path.join(work, 'source');
const output = path.join(root, 'packages/model3d/vendor/occt-import-js');
const emcmake = process.env.EMCMAKE || 'emcmake';
const emcc = path.join(path.dirname(emcmake), process.platform === 'win32' ? 'emcc.bat' : 'emcc');
const version = await run(emcc, ['--version'], { capture: true });
if (!/\b3\.1\.61\b/.test(version)) throw new Error('Rebuilding the CAD importer requires Emscripten 3.1.61. See packages/model3d/vendor/occt-import-js/README.md.');

await mkdir(work, { recursive: true });
await mkdir(source, { recursive: true });
await unpack(
  'https://codeload.github.com/kovacsv/occt-import-js/tar.gz/refs/tags/0.0.23',
  '89d1b75def80be77cec271da46cefced9614add5448d3408c705f2f440083dde',
  'importer.tar.gz', source
);
await mkdir(path.join(source, 'occt'), { recursive: true });
await unpack(
  'https://codeload.github.com/Open-Cascade-SAS/OCCT/tar.gz/d2abb6d844231cb8f29be6894440874a4700e4a5',
  '2715d89a1bc44dfd34dab88f729c445ea93f6b57d6539b0c89614a80ae144a6c',
  'occt.tar.gz', path.join(source, 'occt')
);

// Readers register protocols whose virtual tables also retain exporters. LTO
// alone cannot discard these bodies. None of the JS bindings exposes writing;
// replace only the STEP/IGES serializer methods. Geometry, healing, units,
// and assembly placements remain in the preview reader.
let removed = 0;
const occtSource = path.join(source, 'occt/src');
for (const directory of (await readdir(occtSource)).filter(name => /^(?:RWStep|IGES)/.test(name))) {
  for (const name of (await readdir(path.join(occtSource, directory))).filter(name => name.endsWith('.cxx'))) {
    const file = path.join(occtSource, directory, name);
    const original = await readFile(file, 'utf8');
    const masked = original.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, match => match.replace(/[^\n]/g, ' '));
    const ranges = [];
    for (const match of masked.matchAll(/\bvoid\s+(?:RWStep\w+::WriteStep|IGES\w+::WriteOwnParams)\s*\(/g)) {
      const start = masked.indexOf('{', match.index);
      if (start === -1) throw new Error(`Missing writer body in ${file}`);
      let end = start + 1;
      let depth = 1;
      while (depth && end < masked.length) {
        if (masked[end] === '{') depth++;
        else if (masked[end] === '}') depth--;
        end++;
      }
      if (depth) throw new Error(`Unbalanced writer body in ${file}`);
      ranges.push([start + 1, end - 1]);
    }
    let patched = original;
    for (const [start, end] of ranges.reverse()) {
      patched = `${patched.slice(0, start)}\n  // Filens read-only build: export is not exposed.\n  __builtin_trap();\n${patched.slice(end)}`;
    }
    if (ranges.length) await writeFile(file, patched);
    removed += ranges.length;
  }
}
if (removed !== 813) throw new Error(`Expected 813 serializer bodies in the pinned sources, found ${removed}`);
console.log(`Excluded ${removed} STEP/IGES serializer bodies from the read-only importer.`);

// Replace the document adapter with a direct STEP -> placed triangles reader.
// Color, names, properties, face metadata, and hierarchy are not preview APIs.
await cp(path.join(root, 'scripts/occt-preview.cpp'), path.join(source, 'occt-import-js/src/js-interface.cpp'));
await pruneOcctImporter(occtSource);
await pruneMeshProtocols(occtSource);
await prunePreviewProtocols(occtSource);
await prunePreviewMesher(occtSource);
await prunePreviewSessions(occtSource);
await prunePreviewEncodings(occtSource);
await prunePreviewMessages(occtSource);
await prunePreviewIO(occtSource);

// Immutable keyword tables replace startup-built maps and global strings.
// Validate names, aliases and compact complex rules against original C++ bodies.
await compactOcctKeywords(occtSource, work);
await run(process.execPath, [path.join(root, 'scripts/test-occt-keywords.mjs')]);

// Replace the 840,000-byte Bernstein basis table with its stable recurrence.
// Check the actual C++/WASM implementation against every pinned coefficient.
const bernstein = path.join(occtSource, 'AppCont/AppCont_ContMatrices_4.cxx');
await cp(bernstein, path.join(work, 'bernstein-original.cxx'));
await run(process.execPath, [path.join(root, 'scripts/test-occt-bernstein.mjs')]);
await cp(path.join(root, 'scripts/occt-bernstein.cpp'), bernstein);
await cp(path.join(root, 'scripts/occt-bernstein.hpp'), path.join(occtSource, 'AppCont/filens-bernstein.hpp'));

// Generate exact symmetric storage and replace other quadrature lookup tables.
// Reference constants are compiled by the same SDK for coefficient validation.
await compactOcctTables(occtSource, work);
await run(process.execPath, [path.join(root, 'scripts/test-occt-numeric.mjs')]);

// The C runtime already links a correctly rounded decimal parser. Reuse it
// instead of retaining a second implementation and powers-of-ten tables.
await cp(path.join(occtSource, 'Standard/Standard_Strtod.cxx'), path.join(work, 'numeric-original/Standard_Strtod.cxx'));
await run(process.execPath, [path.join(root, 'scripts/test-occt-strtod.mjs')]);
await cp(path.join(root, 'scripts/occt-strtod.cpp'), path.join(occtSource, 'Standard/Standard_Strtod.cxx'));

// Only these three translation units retain __FILE__ in release assertions.
// Stable source names avoid publishing paths from the build machine.
for (const file of ['OSD/OSD_FileSystem.cxx', 'OSD/OSD_LocalFileSystem.cxx', 'Adaptor3d/Adaptor3d_CurveOnSurface.cxx']) {
  const absolute = path.join(occtSource, file);
  await writeFile(absolute, `#line 1 "occt/src/${file}"\n${await readFile(absolute, 'utf8')}`);
}

const cmake = path.join(source, 'CMakeLists.txt');
await cp(path.join(root, 'scripts/occt-preview.cmake'), path.join(source, 'filens-preview.cmake'));
const upstreamCmake = (await readFile(cmake, 'utf8')).replace(
  'source_group ("Sources" FILES ${OcctImportJSSourceFiles})',
  'include(filens-preview.cmake)\nsource_group ("Sources" FILES ${OcctImportJSSourceFiles})'
);
await writeFile(cmake, `${upstreamCmake}\nif (EMSCRIPTEN)
  # All native callers live in this WASM; unused virtual methods can be removed.
  target_compile_options(OcctImportJS PRIVATE -flto -fwhole-program-vtables -fvirtual-function-elimination -fvisibility=hidden)
  # Input is an in-memory stream; no JS virtual filesystem is needed.
  target_link_options(OcctImportJS PRIVATE -Oz -flto -Wl,-u,htons --profiling-funcs "-Wl,-Map,\${CMAKE_BINARY_DIR}/occt-import-js.map" -sEXPORT_ES6=1 -sENVIRONMENT=web,worker -sMALLOC=emmalloc -sUSE_ES6_IMPORT_META=0 -sFILESYSTEM=0)
endif()
`);
const build = path.join(work, 'build');
await run(emcmake, ['cmake', '-S', source, '-B', build, '-DCMAKE_BUILD_TYPE=Release', '-DEMSCRIPTEN=1']);
await run('cmake', ['--build', build, '--parallel', String(Math.min(10, availableParallelism()))]);
await mkdir(output, { recursive: true });
await cp(path.join(build, 'Release/occt-import-js.js'), path.join(output, 'occt-import-js.js'));
const profile = path.join(work, 'profile/occt-import-js.wasm');
await mkdir(path.dirname(profile), { recursive: true });
await run(process.execPath, [
  path.join(root, 'node_modules/binaryen/bin/wasm-opt'),
  path.join(build, 'Release/occt-import-js.wasm'),
  '-Oz', '--enable-exception-handling', '--enable-bulk-memory', '-g', '--strip-producers',
  '-o', profile
]);
await writeFile(path.join(output, 'occt-import-js.wasm'), stripWasmDebug(await readFile(profile)));
for (const license of ['license.occt-import-js.txt', 'license.occt.txt']) {
  await cp(path.join(source, 'dist', license), path.join(output, license));
}
console.log(`Rebuilt read-only CAD importer -> ${path.relative(root, output)}`);

async function unpack(url, expectedHash, name, destination) {
  const archive = path.join(work, name);
  let bytes;
  try { bytes = await readFile(archive); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (createHash('sha256').update(bytes).digest('hex') !== expectedHash) throw new Error(`Checksum mismatch for ${url}`);
  await writeFile(archive, bytes);
  await run('tar', ['-xzf', archive, '-C', destination, '--strip-components=1']);
}

function run(command, args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
    let stdout = '';
    if (capture) child.stdout.on('data', chunk => { stdout += chunk; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(stdout) : reject(new Error(`${command} exited with ${code}`)));
  });
}
