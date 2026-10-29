// Thin API bindings only: all PDF/STEP parsing stays in the WASM engines.
import { WASI } from 'node:wasi';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [kind, input, output, pageArg = '0', dpiArg = '96'] = process.argv.slice(2);
if (kind === 'pdf') {
  const module = await WebAssembly.compile(await readFile(path.join(root, 'tmp/rust-engines/pdfium.wasm')));
  let e;
  const env = {};
  for (const item of WebAssembly.Module.imports(module).filter(i => i.module === 'env')) {
    env[item.name] = item.name === 'emscripten_notify_memory_growth' ? () => {} :
      item.name === '_emscripten_throw_longjmp' ? () => { throw 'pdfium-longjmp'; } :
      item.name.startsWith('invoke_') ? (index, ...args) => {
        const stack = e.emscripten_stack_get_current();
        try { return e.__indirect_function_table.get(index)(...args); }
        catch (error) {
          e._emscripten_stack_restore(stack);
          if (error !== 'pdfium-longjmp') throw error;
          e.setThrew(1, 0);
          return 0;
        }
      } : () => { throw new Error(`Unsupported PDFium callback: ${item.name}`); };
  }
  const wasi = new WASI({ version: 'preview1', args: [], env: {}, preopens: {}, returnOnExit: true });
  const instance = await WebAssembly.instantiate(module, { ...wasi.getImportObject(), env });
  e = instance.exports;
  wasi.initialize(instance);
  e.FPDF_InitLibrary();
  const start = performance.now();
  const data = await readFile(input);
  const ptr = e.malloc(data.length);
  new Uint8Array(e.memory.buffer, ptr, data.length).set(data);
  const doc = e.FPDF_LoadMemDocument64(ptr, data.length, 0);
  if (!doc) {
    console.log(JSON.stringify({ success: false, error: `PDFium error ${e.FPDF_GetLastError()}` }));
  } else {
    const pages = e.FPDF_GetPageCount(doc);
    const page = e.FPDF_LoadPage(doc, Number(pageArg));
    const width = Math.floor(e.FPDF_GetPageWidth(page) * Number(dpiArg) / 72);
    const height = Math.floor(e.FPDF_GetPageHeight(page) * Number(dpiArg) / 72);
    const parseMs = performance.now() - start;
    const bitmap = e.FPDFBitmap_Create(width, height, 0);
    e.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, -1);
    const renderStart = performance.now();
    e.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, 1);
    const renderMs = performance.now() - renderStart;
    const bgra = new Uint8Array(e.memory.buffer, e.FPDFBitmap_GetBuffer(bitmap), height * e.FPDFBitmap_GetStride(bitmap));
    const rgba = Buffer.alloc(width * height * 4);
    const stride = e.FPDFBitmap_GetStride(bitmap);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const a = y * stride + x * 4, b = (y * width + x) * 4;
      rgba[b] = bgra[a + 2]; rgba[b + 1] = bgra[a + 1]; rgba[b + 2] = bgra[a]; rgba[b + 3] = 255;
    }
    await writeFile(output, rgba);
    const tp = e.FPDFText_LoadPage(page);
    const count = e.FPDFText_CountChars(tp);
    let text = '';
    for (let i = 0; i < count; i++) {
      const c = e.FPDFText_GetUnicode(tp, i);
      if (c > 0 && c <= 0x10ffff) text += String.fromCodePoint(c);
    }
    console.log(JSON.stringify({ success: true, width, height, pages, parseMs, renderMs, text }));
    e.FPDFText_ClosePage(tp); e.FPDFBitmap_Destroy(bitmap); e.FPDF_ClosePage(page); e.FPDF_CloseDocument(doc);
  }
  e.free(ptr); e.FPDF_DestroyLibrary();
} else if (kind === 'step') {
  const dir = path.join(root, 'packages/model3d/vendor/occt-import-js');
  const { default: createImporter } = await import(pathToFileURL(path.join(dir, 'occt-import-js.js')));
  const importer = await createImporter({ wasmBinary: await readFile(path.join(dir, 'occt-import-js.wasm')), print() {}, printErr() {} });
  const data = await readFile(input);
  const start = performance.now();
  const result = importer.ReadStepFile(data, { linearUnit: 'millimeter', linearDeflectionType: 'absolute_value', linearDeflection: 0.1, angularDeflection: 0.5 });
  const meshMs = performance.now() - start;
  const positions = [], normals = [];
  for (const mesh of result.meshes ?? []) {
    const p = mesh.attributes.position.array, n = mesh.attributes.normal?.array;
    for (const index of mesh.index.array) {
      positions.push(p.slice(index * 3, index * 3 + 3));
      normals.push(n?.slice(index * 3, index * 3 + 3) ?? [0, 0, 0]);
    }
  }
  await writeFile(output, JSON.stringify({ positions, normals }));
  console.log(JSON.stringify({ success: result.success && positions.length > 0, meshes: result.meshes?.length ?? 0, triangles: positions.length / 3, meshMs }));
} else throw new Error(`Unknown reference engine: ${kind}`);
