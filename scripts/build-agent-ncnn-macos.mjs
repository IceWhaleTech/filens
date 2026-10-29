// Release-builder utility. Installed npm packages contain this companion and
// never need CMake, a compiler, Homebrew, or a Python interpreter.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReleaseDirectory } from './agent-release-privacy.mjs';

const commit = 'd0d50631179e380e587fb188338f5683d2c93275';
const sha256 = '8dd8f7458865b54f8a2dda49dd3247ed75b6216f6b0c1158bec82bfc37393482';

export async function buildMacNCNN(destination, { signal } = {}) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('The macOS companion must be built on macOS arm64');
  const work = await mkdtemp(path.join(os.tmpdir(), 'filens-ncnn-build-'));
  try {
    console.error('Building the portable macOS NCNN companion (CMake and Xcode command-line tools required for source builds).');
    const response = await fetch(`https://codeload.github.com/Tencent/ncnn/tar.gz/${commit}`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`NCNN source HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error('NCNN source SHA-256 mismatch');
    await writeFile(path.join(work, 'source.tar.gz'), bytes);
    await run('tar', ['-xzf', path.join(work, 'source.tar.gz'), '-C', work], signal);
    const source = path.join(work, `ncnn-${commit}`);
    const build = path.join(work, 'build');
    const cmake = { CMAKE_BUILD_TYPE:'Release', CMAKE_OSX_DEPLOYMENT_TARGET:'12.0', NCNN_VERSION:'20260430', NCNN_SHARED_LIB:'ON', NCNN_OPENMP:'ON', NCNN_SIMPLEOMP:'ON', NCNN_VULKAN:'OFF', NCNN_BUILD_TOOLS:'OFF', NCNN_BUILD_EXAMPLES:'OFF', NCNN_BUILD_BENCHMARK:'OFF', NCNN_BUILD_TESTS:'OFF' };
    await run('cmake', ['-S', source, '-B', build, ...Object.entries(cmake).map(([k,v]) => `-D${k}=${v}`)], signal);
    await run('cmake', ['--build', build, '--parallel', '4'], signal);
    await mkdir(destination, { recursive: true });
    const library = path.join(destination, 'libncnn.dylib');
    await copyFile(path.join(build, 'src/libncnn.dylib'), library);
    await run('install_name_tool', ['-id', '@rpath/libncnn.dylib', library], signal);
    await run('strip', ['-x', library], signal);
    await run('codesign', ['--force', '--sign', '-', library], signal);
    await copyFile(path.join(source, 'LICENSE.txt'), path.join(destination, 'NCNN-LICENSE.txt'));
    const hash = createHash('sha256').update(await readFile(library)).digest('hex');
    await writeFile(path.join(destination, 'native-build.json'), JSON.stringify({ commit, sourceSHA256:sha256, cmake, sha256:hash }, null, 2) + '\n');
  } finally { await rm(work, { recursive:true, force:true }); }
}

function run(command, args, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio:'inherit', signal });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildMacNCNN(path.resolve('dist/native'));
}

// Rebuild the published wrapper snapshot with the same minimum macOS as the
// CLI. The upstream prebuilt library currently targets the publisher's macOS 26.
export async function buildMacWrapper(destination, { signal, sourceCount = 3 } = {}) {
  return buildOCRWrapper(destination, { signal, sourceCount, platform: 'darwin-arm64' });
}

// Rebuild every wrapper from the same hash-pinned snapshot. Upstream Linux
// prebuilts contain personal source paths; -trimpath keeps them out of releases.
export async function buildOCRWrapper(destination, { signal, sourceCount = 3, platform = `${process.platform}-${process.arch}` } = {}) {
  if (!['darwin-arm64', 'linux-x64', 'linux-arm64'].includes(platform)) throw new Error('Unsupported OCR wrapper target');
  if (platform === 'darwin-arm64' && (process.platform !== 'darwin' || process.arch !== 'arm64')) throw new Error('The macOS wrapper must be built on macOS arm64');
  const { downloadArtifact } = await import('./model-download.mjs');
  const { modelSources } = await import('./download-agent-models.mjs');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const manifest = JSON.parse(await readFile(path.join(root, 'converter/rapidocr/runtime.json'), 'utf8'));
  const artifact = manifest.wrapperSource;
  const darwin = platform === 'darwin-arm64';
  const library = path.join(destination, darwin ? 'libzima_ncnn_runtime_v7.dylib' : 'libzima_ncnn_runtime_v7.so');
  const architecture = platform.endsWith('-x64') ? 'amd64' : 'arm64';
  try {
    const prior = JSON.parse(await readFile(path.join(destination, 'wrapper-build.json'), 'utf8'));
    if (prior.sourceSHA256 === artifact.sha256 && prior.platform === platform && prior.trimpath === true
        && createHash('sha256').update(await readFile(library)).digest('hex') === prior.sha256) {
      await assertReleaseDirectory(destination);
      return;
    }
  } catch { /* Rebuild an absent or altered wrapper. */ }
  const work = await mkdtemp(path.join(os.tmpdir(), 'filens-ocr-wrapper-'));
  try {
    const archive = path.join(work, 'source.tar.gz');
    await downloadArtifact({ ...artifact, path:archive, sources:modelSources(artifact, sourceCount, manifest) }, { signal });
    await run('tar', ['-xzf', archive, '-C', work], signal);
    await new Promise((resolve, reject) => {
      const child = spawn('go', ['build','-trimpath','-buildmode=c-shared','-ldflags',`-s -w -X main.ncnnRuntimeVersion=${manifest.version}`,'-o',library,'./tools/ncnn_runtime_wrapper'], {
        cwd:work, stdio:'inherit', signal,
        env:{...process.env,CGO_ENABLED:'1',GOOS:darwin?'darwin':'linux',GOARCH:architecture,
          ...(darwin ? {MACOSX_DEPLOYMENT_TARGET:'12.0',CGO_CFLAGS:'-mmacosx-version-min=12.0',CGO_LDFLAGS:'-mmacosx-version-min=12.0'}
            : {CC:`${process.env.FILENS_ZIG ?? 'zig'} cc -target ${architecture === 'amd64' ? 'x86_64' : 'aarch64'}-linux-gnu.2.17`})}
      });
      child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Build OCR wrapper exited with ${code}`)));
    });
    if (darwin) await run('codesign',['--force','--sign','-',library],signal);
    await rm(path.join(destination,'libzima_ncnn_runtime_v7.h'),{force:true});
    await writeFile(path.join(destination,'wrapper-build.json'),JSON.stringify({release:manifest.version,sourceSHA256:artifact.sha256,platform,trimpath:true,
      ...(darwin ? {minimumMacOS:'12.0'} : {minimumGlibc:'2.17',compiler:'zig cc'}),
      sha256:createHash('sha256').update(await readFile(library)).digest('hex')},null,2)+'\n');
    await assertReleaseDirectory(destination);
  } finally { await rm(work,{recursive:true,force:true}); }
}
