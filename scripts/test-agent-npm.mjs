// Exercise tarballs offline, or public npm installs with --registry. Installed
// packages must not need source checkout paths or a Python runtime.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executableName, ocrLibraryName, platformPackageName, npmInvocation } from './agent-platforms.mjs';
import { zipSync } from 'fflate';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'dist/npm');
const release=JSON.parse(await readFile(path.join(output,'release.json'),'utf8'));
const platform=`${process.platform}-${process.arch}`;
const coreName=platformPackageName('cli',platform),ocrName=platformPackageName('ocr',platform);
const fullName='filens-cli';
const liteName='filens-cli-lite';
const hasPreview=release.packages.some(pkg=>pkg.name==='filens-preview');
const registry=process.argv.includes('--registry');
const installFlags=['--ignore-scripts','--no-audit','--no-fund',...(registry?['--registry=https://registry.npmjs.org/']:['--offline'])];
const archive=name=>{const pkg=release.packages.find(p=>p.name===name);assert.ok(pkg,`Missing package ${name}`);return path.join(output,pkg.file);};
const work=await mkdtemp(path.join(os.tmpdir(),'filens-npm-install-'));
const env={...process.env,FILENS_CACHE_DIR:path.join(work,'cache'),npm_config_userconfig:path.join(work,'.npmrc'),npm_config_offline:registry?'false':'true',npm_config_registry:'https://registry.npmjs.org/',...(registry?{npm_config_cache:path.join(work,'npm-cache')}: {})};
try {
  const full=path.join(work,'full');
  run('npm',['install',...installFlags,'--prefix',full,...(registry?[`${fullName}@${release.version}`]:[archive(fullName),archive(coreName),archive(ocrName)])]);
  let executable=path.join(full,'node_modules',fullName,'cli.mjs');
  const capacity=JSON.parse(run(executable,['capacity','--json']).stdout);
  const installedSkill=await readFile(path.join(full,'node_modules',fullName,'skills/filens/SKILL.md'),'utf8');
  assert.ok(installedSkill.startsWith('---\nname: filens\ndescription:'));
  assert.equal(capacity.capacity.profile,'full');
  assert.equal(capacity.capacity.ocr.available,true);
  assert.equal(capacity.capacity.ocr.provider,'rapidocr-ncnn');
  assert.equal(capacity.capacity.search.archives.maxDepth,8);
  for(const name of [fullName,coreName,ocrName]) {
    const base=path.join(full,'node_modules',name);
    assert.equal(JSON.parse(await readFile(path.join(base,'package.json'))).license,'MIT');
    assert.match(await readFile(path.join(base,'LICENSE'),'utf8'),/^MIT License/);
  }
  const image=path.join(root,'converter/rapidocr/testdata/scan-transparent.png');
  assert.match(JSON.parse(run(executable,[`读取 "${image}"，以 JSON 输出`]).stdout).content.text,/FILENS2026/);
  const text=path.join(work,'test.txt');await writeFile(text,'文档证据 42\n');
  assert.equal(JSON.parse(run(executable,[],JSON.stringify({input:text,operation:'understand'})).stdout).content.text.trim(),'文档证据 42');
  const converted=path.join(work,'converted.docx');
  assert.equal(JSON.parse(run(executable,['convert',text,converted]).stdout).ok,true);
  assert.match(JSON.parse(run(executable,[converted,'--json']).stdout).content.text,/文档证据 42/);
  const nested=path.join(work,'nested.zip');
  await writeFile(nested,zipSync({'inner.zip':zipSync({'note.docx':await readFile(converted),'scan.png':await readFile(image)})}));
  const found=JSON.parse(run(executable,['search',nested,'--query','文档证据','--layout','--json']).stdout);
  assert.equal(found.search.matchedFiles,1);
  assert.deepEqual(found.search.results[0].archive.members,['inner.zip','note.docx']);
  assert.match(JSON.parse(run(executable,['read',found.search.results[0].path,'--json']).stdout).content.text,/文档证据 42/);
  assert.match(JSON.parse(run(executable,['read',`${nested}!/inner.zip!/scan.png`,'--json']).stdout).content.text,/FILENS2026/);
  assert.equal(JSON.parse(run('npm',['exec','--offline','--prefix',full,'--','filens','convert',text,path.join(work,'npx-output.docx')]).stdout).ok,true);
  assert.match(JSON.parse(run(executable,[path.join(root,'apps/demo/public/samples/filens-cosmic-atlas.pdf'),'--json','--no-ocr']).stdout).content.text,/COSMIC CLIFFS/);
  assert.match(JSON.parse(run(executable,[path.join(root,'converter/rapidocr/testdata/scan.pdf'),'--json']).stdout).content.text,/BRIGHT2027/);
  assert.ok(capacity.capacity.outputFormats.includes('markdown'));
  assert.match(run(executable,[text,'--format','markdown']).stdout,/文档证据 42/);
  assert.match(run(executable,['layout',image,'--format','yaml']).stdout,/coordinateSpace: image:1/);
  const imageLayout=JSON.parse(run(executable,['layout',image,'--json']).stdout).content.layout;
  assert.ok(imageLayout.blocks.some(block=>block.bounds?.unit==='px'));
  // The native package also runs directly with no Node/Python on PATH.
  const core=path.join(full,`node_modules/${coreName}`);
  const ocr=path.join(full,`node_modules/${ocrName}`);
  const direct=spawnSync(path.join(core,executableName(platform)),[image,'--json'],{encoding:'utf8',env:{...env,PATH:process.platform==='win32'?path.join(process.env.SystemRoot??'C:\\Windows','System32'):'/usr/bin:/bin',FILENS_OCR_LIBRARY:path.join(ocr,'native',ocrLibraryName(platform)),FILENS_OCR_MODEL_DIR:path.join(ocr,'models/rapidocr-ncnn')},timeout:120000});
  assert.equal(direct.status,0,direct.stderr);
  assert.match(JSON.parse(direct.stdout).content.text,/FILENS2026/);
  const lite=path.join(work,'lite');
  run('npm',['install',...installFlags,'--prefix',lite,...(registry?[`${liteName}@${release.version}`]:[archive(liteName),archive(coreName)])]);
  executable=path.join(lite,'node_modules',liteName,'cli.mjs');
  assert.equal(JSON.parse(run(executable,['capacity','--json']).stdout).capacity.ocr.enabled,false);
  assert.equal(run(executable,[text]).stdout.trim(),'文档证据 42');
  if(hasPreview){
    if(!registry)env.FILENS_PREVIEW_PACKAGE=archive('filens-preview');
    // First preview must install the frontend automatically, keeping npm output
    // on stderr so the first stdout line remains machine-readable JSON.
    const {spawn}=await import('node:child_process');
    const {createInterface}=await import('node:readline');
    const child=spawn(process.execPath,[executable,'preview',text,'--no-open','--json'],{cwd:work,env});
    let stderr='';child.stderr.on('data',bytes=>{stderr+=bytes;});
    const ready=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{child.kill('SIGTERM');reject(new Error('Installed preview startup timeout'));},120000);
      child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Installed preview exited ${code}: ${stderr}`));});
      createInterface({input:child.stdout}).once('line',line=>{clearTimeout(timer);resolve(JSON.parse(line));});
    });
    try{
      assert.equal(ready.operation,'preview');
      const response=await fetch(ready.url);assert.equal(response.status,200);
      assert.match(await response.text(),/createPreview/);
      const source=await (await fetch(new URL('./source.json',ready.url))).json();
      assert.match(await (await fetch(new URL(source.url,ready.url))).text(),/文档证据 42/);
    }finally{const closed=new Promise(resolve=>child.once('close',resolve));child.kill('SIGTERM');await closed;}
    run(executable,['setup-preview']);
    const previewCapacity=JSON.parse(run(executable,['capacity','--json']).stdout).capacity.preview;
    assert.equal(previewCapacity.available,true);
  }
  if(!registry) env.FILENS_OCR_PACKAGE=archive(ocrName);
  run(executable,['setup-ocr','--sources','4']);
  const enabled=JSON.parse(run(executable,['capacity','--json']).stdout);
  assert.equal(enabled.capacity.profile,'lite');
  assert.equal(enabled.capacity.ocr.available,true);
  assert.match(JSON.parse(run(executable,[image,'--json']).stdout).content.text,/FILENS2026/);
  if(registry){
    const temporary=JSON.parse(run('npm',['exec','--yes','--registry=https://registry.npmjs.org/','--',`${fullName}@${release.version}`,'你能做什么？以 JSON 输出']).stdout);
    assert.equal(temporary.capacity.profile,'full');
    assert.equal(temporary.capacity.ocr.available,true);
  }
  const validationFile=path.join(root,'docs/agent-cli-npm-validation.json');
  let validation={version:release.version,tests:{}};
  try {
    const previous=JSON.parse(await readFile(validationFile,'utf8'));
    if(previous.version===release.version)validation=previous;
  } catch(error) {if(error.code!=='ENOENT')throw error;}
  validation.tests[registry?'registry':'offline']={command:`node scripts/test-agent-npm.mjs${registry?' --registry':''}`,
    platform,passed:true,observedAt:new Date().toISOString(),freshNpmCache:registry,preview:hasPreview};
  await writeFile(validationFile,JSON.stringify(validation,null,2)+'\n');
  console.log(`npm packages: ${registry?'public registry (fresh npm cache)':'offline tarball'} Full/Lite installs${registry?', automatic platform selection':''}, stdin JSON, native execution without Python, first-use preview installation/JSON server, and one-command OCR component installation passed.`);
} finally {await rm(work,{recursive:true,force:true});}
function run(command,args,input) {
  if(command==='npm') ({command,args}=npmInvocation(args));
  else if(command.endsWith('.mjs')) {args=[command,...args];command=process.execPath;}
  const result=spawnSync(command,args,{cwd:work,env,input:input??'',encoding:'utf8',timeout:120000,maxBuffer:8<<20});
  assert.equal(result.error,undefined,result.error?.message);
  assert.equal(result.status,0,`${command} ${args.join(' ')}\n${result.stderr}\n${result.stdout}`);
  return result;
}
