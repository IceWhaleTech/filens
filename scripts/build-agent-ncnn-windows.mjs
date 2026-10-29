// Source builds only. End users receive both DLLs and need no compiler.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReleaseDirectory } from './agent-release-privacy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const commit = 'd0d50631179e380e587fb188338f5683d2c93275';
const sourceSHA256 = '8dd8f7458865b54f8a2dda49dd3247ed75b6216f6b0c1158bec82bfc37393482';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const windowsPatch = 'simpleomp-std-call-once-v1';

export async function buildWindowsNCNN(destination, { signal } = {}) {
  const library = path.join(destination, 'ncnn.dll');
  try {
    const prior = JSON.parse(await readFile(path.join(destination, 'native-build.json'), 'utf8'));
    if (prior.platform === 'win32-x64' && prior.windowsPatch === windowsPatch && prior.sourceSHA256 === sourceSHA256 && sha(await readFile(library)) === prior.sha256) return;
  } catch { /* Build missing or altered artifacts. */ }
  const work = await mkdtemp(path.join(os.tmpdir(), 'filens-ncnn-win-'));
  try {
    const cached = path.join(root,'dist/build-cache',`ncnn-${commit}.tar.gz`);
    let bytes;
    try { bytes = await readFile(cached); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (!bytes || sha(bytes) !== sourceSHA256) {
      const response = await fetch(`https://codeload.github.com/Tencent/ncnn/tar.gz/${commit}`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error(`NCNN source HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
      if (sha(bytes) !== sourceSHA256) throw new Error('NCNN source SHA-256 mismatch');
      await mkdir(path.dirname(cached),{recursive:true});await writeFile(cached,bytes);
    }
    if (sha(bytes) !== sourceSHA256) throw new Error('NCNN source SHA-256 mismatch');
    const archive = path.join(work, 'source.tar.gz');
    await writeFile(archive, bytes);
    await run('tar', ['-xzf', archive, '-C', work], signal);
    const source = path.join(work, `ncnn-${commit}`);
    // This upstream snapshot uses pthread_once even in its Windows branch.
    // std::call_once preserves the one-time initialization with Win32 threads.
    const omp = path.join(source,'src/simpleomp.cpp');
    let ompText = await readFile(omp,'utf8');
    for (const [from,to] of [
      ['#include <stdarg.h>','#include <stdarg.h>\n#include <mutex>'],
      ['pthread_once(&is_initialized, init_g_kmp_global);','std::call_once(is_initialized, init_g_kmp_global);'],
      ['static pthread_once_t is_initialized;','static std::once_flag is_initialized;'],
      ['pthread_once_t ncnn::KMPGlobal::is_initialized = PTHREAD_ONCE_INIT;','std::once_flag ncnn::KMPGlobal::is_initialized;']
    ]) {
      if (ompText.split(from).length !== 2) throw new Error('Pinned NCNN Windows patch no longer matches');
      ompText = ompText.replace(from,to);
    }
    await writeFile(omp,ompText);
    const build = path.join(work, 'build');
    const zig = process.env.FILENS_ZIG ?? 'zig';
    const tools = {};
    for (const name of ['ar','ranlib','rc']) {
      const file = path.join(work,`zig-${name}${process.platform === 'win32' ? '.cmd' : ''}`);
      const quoted = "'"+zig.replaceAll("'", "'\\''")+"'";
      await writeFile(file,process.platform === 'win32' ? `@"${zig}" ${name} %*\r\n` : `#!/bin/sh\nexec ${quoted} ${name} "$@"\n`);
      await chmod(file,0o755);
      tools[name] = file;
    }
    const flags = `-Os -DNDEBUG -Wno-nullability-completeness -ffile-prefix-map=${source}=/ncnn-source -ffile-prefix-map=${build}=/ncnn-build -ffile-prefix-map=${os.homedir()}=/toolchain-cache`;
    const cmake = {
      CMAKE_SYSTEM_NAME:'Windows', CMAKE_SYSTEM_PROCESSOR:'AMD64', CMAKE_BUILD_TYPE:'Release',
      CMAKE_CXX_STANDARD:'11',
      CMAKE_C_COMPILER:`${zig};cc;-target;x86_64-windows-gnu`,
      CMAKE_CXX_COMPILER:`${zig};c++;-target;x86_64-windows-gnu`,
      CMAKE_AR:tools.ar, CMAKE_RANLIB:tools.ranlib, CMAKE_RC_COMPILER:tools.rc,
      CMAKE_C_FLAGS_RELEASE:flags, CMAKE_CXX_FLAGS_RELEASE:flags,
      NCNN_VERSION:'20260430', NCNN_SHARED_LIB:'ON', NCNN_C_API:'ON',
      NCNN_OPENMP:'ON', NCNN_SIMPLEOMP:'ON', NCNN_VULKAN:'OFF',
      NCNN_BUILD_TOOLS:'OFF', NCNN_BUILD_EXAMPLES:'OFF', NCNN_BUILD_BENCHMARK:'OFF', NCNN_BUILD_TESTS:'OFF'
    };
    await run('cmake', ['-S',source,'-B',build,'-G',process.platform === 'win32' ? 'Ninja' : 'Unix Makefiles',...Object.entries(cmake).map(([k,v])=>`-D${k}=${v}`)], signal);
    await run('cmake', ['--build',build,'--parallel','4'], signal);
    await mkdir(destination,{recursive:true});
    const produced = (await readdir(path.join(build,'src'))).find(name=>/^(?:lib)?ncnn\.dll$/i.test(name));
    if (!produced) throw new Error('NCNN build did not produce a Windows DLL');
    await copyFile(path.join(build,'src',produced),library);
    await copyFile(path.join(source,'LICENSE.txt'),path.join(destination,'NCNN-LICENSE.txt'));
    await writeFile(path.join(destination,'native-build.json'),JSON.stringify({commit,sourceSHA256,windowsPatch,platform:'win32-x64',compiler:'zig c++',simpleOMP:true,sha256:sha(await readFile(library))},null,2)+'\n');
    await assertReleaseDirectory(destination);
  } finally { await rm(work,{recursive:true,force:true}); }
}

function run(command,args,signal) {
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{stdio:'inherit',signal});
    child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`${command} exited with ${code}`)));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildWindowsNCNN(path.join(root,'dist/windows/native'));
