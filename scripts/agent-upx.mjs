import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { privacyIssues } from './agent-release-privacy.mjs';

export async function compressAgentBinary(file, {platform, enabled = true} = {}) {
  const before = await readFile(file);
  const issues = privacyIssues(before);
  if (issues.length) throw new Error(`Uncompressed CLI privacy check failed: ${issues.join(', ')}`);
  const report = {platform,originalBytes:before.length,originalSHA256:createHash('sha256').update(before).digest('hex'),applied:false};
  if (!enabled || platform === 'darwin-arm64') return {...report,bytes:before.length,reason:!enabled?'disabled':'UPX does not support Mach-O arm64'};
  const installed = fileURLToPath(new URL(`../dist/tools/upx/${process.platform === 'win32'?'upx.exe':'upx'}`,import.meta.url));
  const upx = process.env.FILENS_UPX ?? (existsSync(installed)?installed:'upx');
  const run = args => new Promise((resolve,reject)=>{
    const child=spawn(upx,args,{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
    child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
    child.once('error',error=>reject(new Error(`UPX is required for ${platform}; run node scripts/setup-agent-upx.mjs, install UPX 5.1+, or select --no-upx: ${error.code}`)));
    child.once('exit',code=>code===0?resolve(stdout):reject(new Error(`UPX failed (${code}): ${stderr.trim()}`)));
  });
  const version=(await run(['--version'])).split('\n')[0].trim();
  await run(['--best','--lzma',file]);
  await run(['--test',file]);
  return {...report,applied:true,tool:version,arguments:['--best','--lzma'],integrityTest:true,bytes:(await stat(file)).size,sha256:createHash('sha256').update(await readFile(file)).digest('hex')};
}
