// Produces independently installable platform packages, then the full/lite
// launchers. No registry writes happen here; publish-agent-npm handles that.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, copyFile, cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupOCR } from './setup-agent-ocr.mjs';
import { requestedSourceCount } from './download-agent-models.mjs';
import { assertReleaseArchive, assertReleaseDirectory } from './agent-release-privacy.mjs';
import { buildAgentBinary, compressAgentWASM, preparePDFium } from './agent-rust-build.mjs';
import { writeRustLicenses } from './agent-rust-licenses.mjs';
import { executableName, releaseTargets, platformPackageName, npmInvocation } from './agent-platforms.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const version = JSON.parse(await readFile(path.join(root, 'packaging/agent-release.json'), 'utf8')).version;
const previewVersion = JSON.parse(await readFile(path.join(root, 'packages/preview/package.json'), 'utf8')).version;
const targets = releaseTargets(args);
const output = path.join(root, 'dist/npm');
await mkdir(output, { recursive: true });
const packages = [];
const binaryCompression = [];
const rustLicenses = path.join(root,'dist/agent-rust-licenses');
await writeRustLicenses(rustLicenses);
const common = { version, license:'MIT', repository:{ type:'git', url:'git+https://github.com/IceWhaleTech/filens.git' }, homepage:'https://github.com/IceWhaleTech/filens#readme' };
const withPreview = args.includes('--with-preview');
const previewPackage = args.includes('--preview-package');
if (withPreview || previewPackage) {
  await run(process.execPath, [path.join(root, 'scripts/build-converter-wasm.mjs')]);
  await run(process.execPath, [path.join(root, 'scripts/build-preview.mjs')]);
}
if (previewPackage) {
  await run(process.execPath, [path.join(root, 'scripts/package-preview-npm.mjs'), '--no-build']);
  const preview = JSON.parse(await readFile(path.join(root,'dist/preview-npm/release.json'),'utf8'));
  await copyFile(path.join(root,'dist/preview-npm',preview.file),path.join(output,preview.file));
  packages.push({name:preview.name,version:preview.version,file:preview.file,bytes:preview.bytes,unpackedBytes:preview.unpackedBytes,sha256:preview.sha256});
}
const wasm = path.join(root, 'dist/converter-text.wasm');
await readFile(wasm); // Build the WASM core first; never publish a placeholder.
await preparePDFium(path.join(root,'dist'));
await compressAgentWASM(path.join(root,'dist'));
for (const platform of targets) {
  const [os, arch] = platform.split('-');
  const coreName = platformPackageName('cli', platform);
  const binary = executableName(platform);
  const core = await prepare(coreName, { os:[os], cpu:[arch], ...(os === 'linux' ? { libc:['glibc'] } : {}), description:'Rust filens document reading and conversion CLI with shared WASM engines', files:[binary,'converter-text.wasm.gz','converter-image.wasm.gz','pdfium.wasm.gz','README.md','licenses','THIRD-PARTY-NOTICES.md',...(withPreview ? ['preview'] : [])] });
  if (withPreview) await cp(path.join(root, 'dist/preview'), path.join(core, 'preview'), {recursive:true});
  for (const name of ['converter-text.wasm.gz','converter-image.wasm.gz','pdfium.wasm.gz']) await copyFile(path.join(root,'dist',name),path.join(core,name));
  binaryCompression.push(await buildAgentBinary(path.join(core,binary),{lite:true,platform,upx:!args.includes('--no-upx')}));
  await chmod(path.join(core,binary), 0o755);
  await cp(path.join(root,'packaging/ncnn-licenses'),path.join(core,'licenses'),{recursive:true});
  await cp(rustLicenses,path.join(core,'licenses'),{recursive:true});
  await copyFile(path.join(root,'packaging/agent-third-party.md'),path.join(core,'THIRD-PARTY-NOTICES.md'));
  await pack(core);
  const ocrName = platformPackageName('ocr', platform);
  const ocr = await prepare(ocrName, { os:[os], cpu:[arch], ...(os === 'linux' ? { libc:['glibc'] } : {}), description:'Portable native RapidOCR NCNN, with Chinese/English models; no Python', files:['native','models','README.md','THIRD-PARTY-NOTICES.md'] });
  // Models are platform independent. Reuse only the verified source-build cache.
  await cp(path.join(root,'dist/models/rapidocr-ncnn'), path.join(ocr,'models/rapidocr-ncnn'), { recursive:true });
  if (platform === `${process.platform}-${process.arch}`) await cp(path.join(root,'dist/native'),path.join(ocr,'native'),{recursive:true});
  else if (platform === 'win32-x64') {
    // setupOCR rechecks both build fingerprints and library hashes before reuse.
    try { await cp(path.join(root,'dist/windows/native'),path.join(ocr,'native'),{recursive:true}); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  await setupOCR(ocr, { platform, sourceCount:requestedSourceCount(args) });
  // Bundle pinned notices for the Linux companion's C++/OpenMP runtime.
  await cp(path.join(root,'packaging/ncnn-licenses'),path.join(ocr,'native/licenses'),{recursive:true});
  await copyFile(path.join(root,'packaging/agent-third-party.md'),path.join(ocr,'THIRD-PARTY-NOTICES.md'));
  // Download timing and local machine paths are not part of the runtime package.
  const provenanceFile=path.join(ocr,'native/runtime.json');
  const provenance=JSON.parse(await readFile(provenanceFile,'utf8'));
  for (const artifact of provenance.artifacts??[]) delete artifact.events;
  await writeFile(provenanceFile,JSON.stringify(provenance,null,2)+'\n');
  await rm(path.join(ocr,'models/rapidocr-ncnn/download-report.json'),{force:true});
  await pack(ocr);
}
for (const name of ['filens-cli','filens-cli-lite']) {
  const lite = name.endsWith('-lite');
  const optionalDependencies = {};
  for (const platform of targets) {
    optionalDependencies[platformPackageName('cli', platform)] = version;
    if (!lite) optionalDependencies[platformPackageName('ocr', platform)] = version;
  }
  const directory = await prepare(name, { type:'module', engines:{node:'>=20.11'}, bin:{filens:'cli.mjs'}, filensPreviewVersion:previewVersion, description:`Local document reading for agents (${!lite ? 'native RapidOCR included' : 'lite; OCR optional'})`, optionalDependencies, files:['cli.mjs','scripts','converter','skills','README.md'] });
  await cp(path.join(root,'skills/filens'),path.join(directory,'skills/filens'),{recursive:true});
  await copyFile(path.join(root,'packaging/npm/cli.mjs'),path.join(directory,'cli.mjs'));
  await chmod(path.join(directory,'cli.mjs'),0o755);
  await mkdir(path.join(directory,'scripts'),{recursive:true});
  for (const file of ['download-agent-models.mjs','model-download.mjs','agent-platforms.mjs']) await copyFile(path.join(root,'scripts',file),path.join(directory,'scripts',file));
  await mkdir(path.join(directory,'converter/rapidocr'),{recursive:true});
  await copyFile(path.join(root,'converter/rapidocr/models.json'),path.join(directory,'converter/rapidocr/models.json'));
  await pack(directory);
}
// Old tarballs must not be picked up by an upload-artifact *.tgz glob.
const current = new Set(packages.map(pkg => pkg.file));
const obsolete = (await readdir(output)).filter(name => name.endsWith('.tgz') && !current.has(name));
if (obsolete.length) {
  const quarantine = path.join(root,'tmp','agent-release-quarantine',String(Date.now()));
  await mkdir(quarantine,{recursive:true});
  for (const name of obsolete) await rename(path.join(output,name),path.join(quarantine,name));
  console.log(`Moved ${obsolete.length} obsolete tarballs into the ignored local quarantine.`);
}
await writeFile(path.join(output,'release.json'),JSON.stringify({version,targets,privacyChecked:true,previewIncluded:withPreview,binaryCompression,packages},null,2)+'\n');
console.log(`Prepared ${packages.length} npm tarballs in dist/npm. No registry publication performed.`);

async function prepare(name, metadata) {
  const directory = path.join(output,name);
  await rm(directory,{recursive:true,force:true});
  await mkdir(directory,{recursive:true});
  await writeFile(path.join(directory,'package.json'),JSON.stringify({name,...common,...metadata,files:[...new Set([...metadata.files,'LICENSE'])]},null,2)+'\n');
  await copyFile(path.join(root,'packaging/npm/README.md'),path.join(directory,'README.md'));
  await copyFile(path.join(root,'LICENSE'),path.join(directory,'LICENSE'));
  return directory;
}
async function pack(directory) {
  await assertReleaseDirectory(directory);
  const result = JSON.parse(await run('npm',['pack','--json','--ignore-scripts','--pack-destination',output],process.env,directory))[0];
  const file = path.join(output,result.filename);
  assertReleaseArchive(file);
  packages.push({ name:result.name, version:result.version, file:result.filename, bytes:result.size, unpackedBytes:result.unpackedSize, sha256:createHash('sha256').update(await readFile(file)).digest('hex') });
  console.log(`${result.filename}: ${(result.size/1048576).toFixed(2)} MiB compressed, ${(result.unpackedSize/1048576).toFixed(2)} MiB installed`);
}
function run(command, argv, env = process.env, cwd = root) {
  if (command === 'npm') ({command,args:argv}=npmInvocation(argv));
  return new Promise((resolve,reject) => {
    const child=spawn(command,argv,{env,cwd,stdio:['ignore','pipe','inherit']}); let stdout='';
    child.stdout.on('data',chunk=>{stdout+=chunk;});
    child.on('error',reject);child.on('exit',code=>code===0?resolve(stdout):reject(new Error(`${command} exited with ${code}`)));
  });
}
