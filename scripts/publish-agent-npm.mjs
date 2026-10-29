import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReleaseArchive } from './agent-release-privacy.mjs';
import { supportedPlatforms, npmInvocation } from './agent-platforms.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.join(root,'dist/npm');
const release=JSON.parse(await readFile(path.join(directory,'release.json'),'utf8'));
if(supportedPlatforms.some(p=>!release.targets.includes(p)))throw new Error('Build all supported targets with npm run package:agent:npm first');
const integrities=new Map();
for(const pkg of release.packages){
 const bytes=await readFile(path.join(directory,pkg.file));
 if(createHash('sha256').update(bytes).digest('hex')!==pkg.sha256)throw new Error(`Tarball checksum mismatch: ${pkg.file}`);
 assertReleaseArchive(path.join(directory,pkg.file));
 integrities.set(pkg.name,`sha512-${createHash('sha512').update(bytes).digest('base64')}`);
}
const dry=process.argv.includes('--dry-run');
const tag=release.version.includes('-')?'next':'latest';
const entryNames=['filens-cli','filens-cli-lite'];
const existing=new Set();
if(!dry){
 await run(['whoami','--registry=https://registry.npmjs.org/']);
 // A retry must never attempt to overwrite an immutable version or silently
 // skip somebody else's different tarball.
 const results=await Promise.allSettled(release.packages.map(async pkg=>{
  const response=await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${release.version}`,{signal:AbortSignal.timeout(20000)});
  if(response.status===404){
   // npm may accept a new package but expose only a temporary stub while its
   // first release is reviewed. Do not mistake that state for an unpublished
   // package and submit the same immutable version again.
   const metadataResponse=await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg.name)}`,{signal:AbortSignal.timeout(20000)});
   if(metadataResponse.status===404)return;
   if(!metadataResponse.ok)throw new Error(`Registry metadata ${pkg.name}: HTTP ${metadataResponse.status}`);
   const metadata=await metadataResponse.json();
   if(metadata.versions?.[metadata['dist-tags']?.latest]?.stub===true){
    throw new Error(`${pkg.name}: npm has staged this package for review; ${release.version} is not publicly available yet. Wait for the registry release rather than republishing.`);
   }
   return;
  }
  if(!response.ok)throw new Error(`Registry preflight ${pkg.name}: HTTP ${response.status}`);
  const published=await response.json();
  if(published.dist?.integrity!==integrities.get(pkg.name))throw new Error(`Published ${pkg.name}@${release.version} differs from the local tarball`);
  existing.add(pkg.name);
 }));
 const errors=results.filter(r=>r.status==='rejected');
 if(errors.length)throw new AggregateError(errors.map(r=>r.reason),'Registry preflight failed');
}
// Platform components are independent. Limit uploads to three connections;
// public entry packages are published only when every component succeeded.
const components=release.packages.filter(p=>!entryNames.includes(p.name));
for(let i=0;i<components.length;i+=3){
 const results=await Promise.allSettled(components.slice(i,i+3).map(publish));
 const errors=results.filter(r=>r.status==='rejected');
 if(errors.length)throw new AggregateError(errors.map(r=>r.reason),'Platform package publication failed; rerun to resume verified packages');
}
for(const pkg of release.packages.filter(p=>entryNames.includes(p.name)))await publish(pkg);
async function publish(pkg){
 if(existing.has(pkg.name)){console.log(`Verified existing ${pkg.name}@${release.version}`);return;}
 console.log(`${dry?'Dry run':'Publishing'} ${pkg.name}@${release.version}`);
 await run(['publish',path.join(directory,pkg.file),'--access','public','--tag',tag,'--registry=https://registry.npmjs.org/',...(dry?['--dry-run']:[])]);
}
function run(args){return new Promise((resolve,reject)=>{
 const npm=npmInvocation(args);
 const child=spawn(npm.command,npm.args,{cwd:root,stdio:'inherit'});
 child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`npm ${args[0]} exited with ${code}`)));
});}
