// Build-time tool only; deployed binaries contain their own UPX decompressor.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const artifacts = {
  'win32-x64': ['upx-5.1.0-win64.zip','41c7492edeed0f7e67d347ca9e8d2131e2af7ca7a7695f92283a8e655c251c13','upx-5.1.0-win64/upx.exe'],
  'linux-x64': ['upx-5.1.0-amd64_linux.tar.xz','946b7269d0f7fcc1c5da0f771ea7fe9c0fed3534cf41d285980830019b4bc95e','upx-5.1.0-amd64_linux/upx'],
  'linux-arm64': ['upx-5.1.0-arm64_linux.tar.xz','222dde34dfa3244a31b06c97820ee651515270e524736f532ac8456783afe76e','upx-5.1.0-arm64_linux/upx']
};
const platform=`${process.platform}-${process.arch}`;
if(platform==='darwin-arm64') console.log('UPX skips Mach-O arm64; no build tool is needed.');
else {
  const artifact=artifacts[platform];if(!artifact)throw new Error(`No pinned UPX build tool for ${platform}`);
  const work=await mkdtemp(path.join(os.tmpdir(),'filens-upx-'));
  try {
    const response=await fetch(`https://github.com/upx/upx/releases/download/v5.1.0/${artifact[0]}`,{signal:AbortSignal.timeout(120000)});
    if(!response.ok)throw new Error(`UPX download HTTP ${response.status}`);
    const bytes=Buffer.from(await response.arrayBuffer());
    if(createHash('sha256').update(bytes).digest('hex')!==artifact[1])throw new Error('UPX SHA-256 mismatch');
    const archive=path.join(work,artifact[0]);await writeFile(archive,bytes);
    await new Promise((resolve,reject)=>{const child=spawn('tar',['-xf',archive,'-C',work],{stdio:'inherit'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`Extract UPX exited with ${code}`)));});
    const destination=path.join(root,'dist/tools/upx');await mkdir(destination,{recursive:true});
    const binary=path.join(destination,platform.startsWith('win32')?'upx.exe':'upx');
    await copyFile(path.join(work,artifact[2]),binary);await chmod(binary,0o755);
    console.log(`Installed hash-verified UPX 5.1.0: ${path.relative(root,binary)}`);
  } finally {await rm(work,{recursive:true,force:true});}
}
