import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupOCR } from './setup-agent-ocr.mjs';
import { requestedSourceCount } from './download-agent-models.mjs';
import { buildAgentBinary, compressAgentWASM, preparePDFium, run } from './agent-rust-build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lite = process.argv.includes('--lite');
const bundle = path.join(root, 'dist', ...(lite ? ['agent-lite'] : []));
const windows = process.platform === 'win32';
await mkdir(bundle, { recursive: true });
const toolchain = /channel\s*=\s*"([^"]+)"/.exec(await readFile(path.join(root, 'wasm/converter-core-rust/rust-toolchain.toml'), 'utf8'))[1];
await run('cargo', [`+${toolchain}`, 'build', '--locked', '--release', '--manifest-path', 'wasm/converter-core-rust/Cargo.toml', '--features', 'text-extraction', '--bin', 'converter-text', '--target', 'wasm32-wasip1']);
await run(process.execPath,[path.join(root,'node_modules/binaryen/bin/wasm-opt'),path.join(root,'wasm/converter-core-rust/target/wasm32-wasip1/release/converter-text.wasm'),'-Oz','--strip-debug','--strip-producers','--enable-bulk-memory','--enable-nontrapping-float-to-int','-o',path.join(bundle,'converter-text.wasm')]);
await run('cargo',[`+${toolchain}`,'build','--locked','--release','--manifest-path','wasm/converter-image-rust/Cargo.toml','--target','wasm32-wasip1']);
await run(process.execPath,[path.join(root,'node_modules/binaryen/bin/wasm-opt'),path.join(root,'wasm/converter-image-rust/target/wasm32-wasip1/release/converter-image.wasm'),'-O3','--strip-debug','--strip-producers','--enable-bulk-memory','--enable-nontrapping-float-to-int','-o',path.join(bundle,'converter-image.wasm')]);
await preparePDFium(bundle);
if (!lite) await setupOCR(bundle, { sourceCount: requestedSourceCount(process.argv) });
const executable = path.join(bundle, windows ? 'filens.exe' : 'filens');
const binaryCompression = await buildAgentBinary(executable,{lite,upx:!process.argv.includes('--no-upx')});
await cp(path.join(root,'skills/filens'),path.join(bundle,'skills/filens'),{recursive:true});
const resources = await compressAgentWASM(bundle);
await writeFile(path.join(bundle,'cli-size.json'),JSON.stringify({implementation:'rust',platform:`${process.platform}-${process.arch}`,binaryBytes:(await stat(executable)).size,binaryCompression,resources},null,2)+'\n');
const health = JSON.parse(await run(executable, ['capacity', '--json', ...(lite ? ['--no-ocr'] : [])], {capture:true}));
if (!health.ok || (!lite && (!health.capacity?.ocr?.available || health.capacity.ocr.openmpThreads !== 2))) {
  throw new Error(`Agent bundle health check failed: ${JSON.stringify(health.error ?? health.capacity?.ocr)}`);
}
console.log(`Built ${path.relative(root, executable)} (Rust, ${((await stat(executable)).size/1048576).toFixed(2)} MiB): ${health.capacity.formats.length} input formats, ${lite ? 'OCR is optional (no OCR dependencies)' : 'native RapidOCR NCNN ready, OpenMP threads=2, max side=960'}.`);
