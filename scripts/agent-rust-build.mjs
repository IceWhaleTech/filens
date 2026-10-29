import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync, constants } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateRustBuildEnv } from './agent-release-privacy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const triples = { 'darwin-arm64':'aarch64-apple-darwin', 'linux-x64':'x86_64-unknown-linux-gnu', 'linux-arm64':'aarch64-unknown-linux-gnu' };
const pdfium = {
  url:'https://raw.githubusercontent.com/klippa-app/go-pdfium/v1.17.3/webassembly/pdfium.wasm',
  sha256:'73417fa7cdcb34fba2a23aa1f7a480cc873a7301c8d74f08a1dea800f782a454'
};

export function run(command, args, { capture = false, env = privateRustBuildEnv(root), cwd = root } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command,args,{cwd,env,stdio:capture?['ignore','pipe','inherit']:'inherit'});
    let output = '';
    child.stdout?.on('data',chunk=>{output+=chunk;});
    child.once('error',reject);
    child.once('exit',code=>code===0?resolve(output):reject(new Error(`${command} exited with ${code ?? 1}`)));
  });
}

export async function buildAgentBinary(destination, { lite = false, platform = `${process.platform}-${process.arch}` } = {}) {
  const target = triples[platform];
  if (!target) throw new Error(`Unsupported Rust CLI target ${platform}`);
  const cross = platform !== `${process.platform}-${process.arch}`;
  const zig = cross || platform.startsWith('linux-');
  const toolchain = /channel\s*=\s*"([^"]+)"/.exec(await readFile(path.join(root,'cli/rust-toolchain.toml'),'utf8'))[1];
  // cargo-zigbuild supplies a Linux glibc 2.17 linker for source-side --all.
  // Use it for native Linux builds too, preserving the advertised glibc floor.
  const args = [`+${toolchain}`,zig?'zigbuild':'build','--locked','--release','--manifest-path','cli/Cargo.toml'];
  if (zig) {
    await run('rustup',['target','add','--toolchain',toolchain,target]);
    args.push('--target',platform.startsWith('linux-')?`${target}.2.17`:target);
  }
  if (lite) args.push('--features','lite');
  const env = { ...privateRustBuildEnv(root), MACOSX_DEPLOYMENT_TARGET:'12.0' };
  await run('cargo',args,{env});
  await mkdir(path.dirname(destination),{recursive:true});
  await copyFile(path.join(root,'cli/target',...(zig?[target]:[]),'release/filens'),destination);
}

export async function preparePDFium(bundle) {
  const cache = path.join(root,'dist','pdfium.wasm');
  let bytes;
  try { bytes = await readFile(cache); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== pdfium.sha256) {
    const response = await fetch(pdfium.url, { signal:AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`PDFium download: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== pdfium.sha256) throw new Error('PDFium WASM integrity check failed');
    await mkdir(path.dirname(cache),{recursive:true});
    await writeFile(cache,bytes);
  }
  if (path.resolve(bundle,'pdfium.wasm') !== cache) await copyFile(cache,path.join(bundle,'pdfium.wasm'));
}

export async function compressAgentWASM(bundle) {
  const report = [];
  for (const name of ['converter-text.wasm','converter-image.wasm','pdfium.wasm']) {
    const bytes = await readFile(path.join(bundle,name));
    const start = performance.now();
    // gzip level 1 minimizes build CPU and remains directly readable by Rust.
    // npm tarballs add transport compression; no executable unpacker is needed.
    const compressed = gzipSync(bytes,{level:constants.Z_BEST_SPEED,mtime:0});
    await writeFile(path.join(bundle,`${name}.gz`),compressed);
    report.push({name,bytes:bytes.length,gzipBytes:compressed.length,compressionMs:Math.round(performance.now()-start)});
  }
  return report;
}
