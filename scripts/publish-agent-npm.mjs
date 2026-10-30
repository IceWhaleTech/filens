import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
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
const versionOf=pkg=>pkg.version??release.version;
const tagOf=pkg=>versionOf(pkg).includes('-')?'next':'latest';
const entryNames=['filens-cli','filens-cli-lite'];
const existing=new Set();
const receiptFile=path.join(directory,`publication-state-${release.version}.json`);
let receipt={version:release.version,accepted:[]};
try{receipt=JSON.parse(await readFile(receiptFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
if(receipt.version!==release.version)throw new Error('Publication receipt version mismatch');
const accepted=new Map(receipt.accepted.map(pkg=>[pkg.name,pkg]));
for(const pkg of receipt.accepted){
 if(integrities.get(pkg.name)!==pkg.integrity)throw new Error(`Previously accepted ${pkg.name}@${versionOf(pkg)} differs from the local tarball`);
}
let receiptWrites=Promise.resolve();
if(!dry){
 await run(['whoami','--registry=https://registry.npmjs.org/']);
 // A retry must never attempt to overwrite an immutable version or silently
 // skip somebody else's different tarball.
 const results=await Promise.allSettled(release.packages.map(async pkg=>{
  const response=await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${versionOf(pkg)}`,{signal:AbortSignal.timeout(20000)});
  if(response.status===404){
   if(accepted.has(pkg.name))return;
   // npm may accept a new package but expose only a temporary stub while its
   // first release is reviewed. Do not mistake that state for an unpublished
   // package and submit the same immutable version again.
   const metadataResponse=await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg.name)}`,{signal:AbortSignal.timeout(20000)});
   if(metadataResponse.status===404)return;
   if(!metadataResponse.ok)throw new Error(`Registry metadata ${pkg.name}: HTTP ${metadataResponse.status}`);
   const metadata=await metadataResponse.json();
   if(metadata.versions?.[metadata['dist-tags']?.latest]?.stub===true){
    throw new Error(`${pkg.name}: npm has staged this package for review; ${versionOf(pkg)} is not publicly available yet. Wait for the registry release rather than republishing.`);
   }
   return;
  }
  if(!response.ok)throw new Error(`Registry preflight ${pkg.name}: HTTP ${response.status}`);
  const published=await response.json();
  if(published.dist?.integrity!==integrities.get(pkg.name))throw new Error(`Published ${pkg.name}@${versionOf(pkg)} differs from the local tarball`);
  existing.add(pkg.name);
 }));
 const errors=results.filter(r=>r.status==='rejected');
 if(errors.length)throw new AggregateError(errors.map(r=>r.reason),'Registry preflight failed');
}
// Platform components are independent. Keep three uploads active, replacing
// completed uploads without waiting for the largest archive in a batch.
// Public entry packages are published only when every component succeeded.
const components=release.packages.filter(p=>!entryNames.includes(p.name));
let componentIndex=0,componentFailed=false;
const uploads=await Promise.allSettled(Array.from({length:Math.min(3,components.length)},async()=>{
 while(!componentFailed){
  const pkg=components[componentIndex++];
  if(!pkg)return;
  try{await publish(pkg);}catch(error){componentFailed=true;throw error;}
 }
}));
const uploadErrors=uploads.filter(r=>r.status==='rejected');
if(uploadErrors.length)throw new AggregateError(uploadErrors.map(r=>r.reason),'Component publication failed; rerun to resume verified packages');
// A successful upload can still be staged for npm review, especially for a new
// platform package. Keep public entry points unchanged until every dependency
// is visible with the exact integrity that the entry points will install.
if(!dry){
 const results=await Promise.allSettled(components.map(verifyPublic));
 const errors=results.filter(r=>r.status==='rejected');
 if(errors.length)throw new AggregateError(errors.map(r=>r.reason),'Platform packages are not publicly available; entry packages were not published');
}
for(const pkg of release.packages.filter(p=>entryNames.includes(p.name))){
 await publish(pkg);
 if(!dry)await verifyPublic(pkg);
}
async function publish(pkg){
 if(existing.has(pkg.name)){console.log(`Verified existing ${pkg.name}@${versionOf(pkg)}`);return;}
 if(accepted.has(pkg.name)){console.log(`Previously accepted ${pkg.name}@${versionOf(pkg)}; awaiting public verification`);return;}
 console.log(`${dry?'Dry run':'Publishing'} ${pkg.name}@${versionOf(pkg)}`);
 await run(['publish',path.join(directory,pkg.file),'--access','public','--tag',tagOf(pkg),'--registry=https://registry.npmjs.org/',...(dry?['--dry-run']:[])]);
 if(!dry){
  // HTTP 202 is a successful npm upload, but the immutable version may still be
  // under review. Persist the receipt so a retry never submits it again.
  accepted.set(pkg.name,{name:pkg.name,version:versionOf(pkg),integrity:integrities.get(pkg.name),acceptedAt:new Date().toISOString()});
  const data=JSON.stringify({version:release.version,accepted:[...accepted.values()]},null,2)+'\n';
  receiptWrites=receiptWrites.then(()=>writeFile(receiptFile,data));
  await receiptWrites;
 }
}
async function verifyPublic(pkg){
 let lastStatus='not available';
 for(let attempt=0;attempt<30;attempt++){
  let response;
  try{response=await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${versionOf(pkg)}`,{signal:AbortSignal.timeout(20000)});}
  catch(error){lastStatus=error.message;}
  if(response?.ok){
   const published=await response.json();
   if(published.dist?.integrity!==integrities.get(pkg.name))throw new Error(`Public ${pkg.name}@${versionOf(pkg)} differs from the local tarball`);
   if(published.license!=='MIT')throw new Error(`Public ${pkg.name}@${versionOf(pkg)} has an unexpected license`);
   console.log(`Publicly available ${pkg.name}@${versionOf(pkg)} (MIT, integrity verified)`);
   return;
  }
  if(response){
   lastStatus=`HTTP ${response.status}`;
   if(response.status!==404&&response.status!==429&&response.status<500)throw new Error(`Registry verification ${pkg.name}: ${lastStatus}`);
  }
  if(attempt<29)await new Promise(resolve=>setTimeout(resolve,Math.min(10000,2000*(attempt+1))));
 }
 throw new Error(`${pkg.name}@${versionOf(pkg)} is not publicly available after upload (${lastStatus}); npm may have staged it for review. Wait for the registry release rather than republishing.`);
}
function run(args){return new Promise((resolve,reject)=>{
 const npm=npmInvocation(args);
 // OCR archives can exceed npm's five-minute default on slower upload links.
 const child=spawn(npm.command,npm.args,{cwd:root,stdio:'inherit',
  env:{...process.env,npm_config_fetch_timeout:process.env.npm_config_fetch_timeout||'900000'}});
 child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`npm ${args[0]} exited with ${code}`)));
});}
