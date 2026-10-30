// Verify immutable public artifacts and record the installation checks.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { privacyIssues } from './agent-release-privacy.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const release=JSON.parse(await readFile(path.join(root,'dist/npm/release.json'),'utf8'));
const validation=JSON.parse(await readFile(path.join(root,'docs/agent-cli-npm-validation.json'),'utf8'));
const previewValidation=JSON.parse(await readFile(path.join(root,'docs/preview-npm-validation.json'),'utf8'));
assert.equal(validation.version,release.version);
assert.equal(validation.tests.offline?.passed,true);
assert.equal(validation.tests.registry?.passed,true);
assert.equal(previewValidation.passed,true);
assert.equal(previewValidation.source,'public registry with fresh npm cache');
assert.equal(previewValidation.version,release.packages.find(p=>p.name==='filens-preview')?.version);
const registry='https://registry.npmjs.org/';
async function json(url){
  const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,200,`${url}: HTTP ${response.status}`);
  return response.json();
}
const packages=[];
for(const pkg of release.packages){
  const metadata=await json(`${registry}${encodeURIComponent(pkg.name)}`);
  const version=pkg.version??release.version;
  const published=metadata.versions?.[version];
  assert.ok(published,`${pkg.name}@${version} missing from public registry`);
  assert.equal(metadata['dist-tags'].latest,version);
  assert.equal(published.license,'MIT');
  const local=await readFile(path.join(root,'dist/npm',pkg.file));
  const integrity=`sha512-${createHash('sha512').update(local).digest('base64')}`;
  assert.equal(published.dist.integrity,integrity,`${pkg.name} metadata integrity differs`);
  const response=await fetch(published.dist.tarball,{signal:AbortSignal.timeout(120000)});
  assert.equal(response.status,200,`${pkg.name} tarball unavailable`);
  const downloaded=Buffer.from(await response.arrayBuffer());
  const sha256=createHash('sha256').update(downloaded).digest('hex');
  assert.equal(sha256,pkg.sha256,`${pkg.name} downloaded tarball differs`);
  packages.push({name:pkg.name,version,latest:metadata['dist-tags'].latest,license:published.license,
    publishedAt:metadata.time?.[version],tarball:published.dist.tarball,integrity,sha256,
    bytes:downloaded.length,unpackedBytes:pkg.unpackedBytes,integrityMatches:true});
  console.log(`${pkg.name}@${version}: latest, MIT metadata and public tarball checksum verified.`);
}
const report={observedAt:new Date().toISOString(),registry,version:release.version,tag:'latest',license:'MIT',
  packages,status:'published-and-verified',validatedAt:validation.tests.registry.observedAt,
  licenseScope:'FiLens first-party code and npm package metadata are MIT; bundled components retain their own licenses, including proprietary hdrw on Windows/Linux.',
  sizeReport:'agent-cli-npm-release.json',sizeLimits:release.sizeLimits,entryPackages:['filens-cli','filens-cli-lite','filens-preview'],
  installation:{full:`npm install -g filens-cli@${release.version}`,lite:`npm install -g filens-cli-lite@${release.version}`,
    preview:`npm install filens-preview@${previewValidation.version}`},
  windowsComponents:{cli:'@orca.zhang/filens-cli-win32-x64',ocr:'@orca.zhang/filens-ocr-win32-x64',
    selection:'Automatically selected by the unscoped public entry packages.'},
  tests:{...validation.tests,preview:previewValidation},
  exercised:['Full/Lite installation','Automatic host platform selection','Chinese and English intents','stdin JSON',
    'Native execution without Python','PNG and scanned-PDF OCR','DOCX conversion and reading',
    'Nested ZIP search, virtual-member reading and OCR','Layout coordinates and multiple output formats',
    'Lite one-command OCR installation','Temporary npm invocation','First-use preview installation and JSON startup',
    'Standalone split and all-in-one browser runtimes','TypeScript exports','Production Vite consumer builds'],
  nativeRuntime:Object.fromEntries(release.targets.map(platform=>[platform,
    platform===validation.tests.registry.platform?'passed':
    platform==='win32-x64'&&validation.tests.windowsPackaging?.passed
      ?'not executed; cross-built, forced npm installation and scoped dependency resolution checked on macOS'
      :'not executed; cross-built']))};
const data=Buffer.from(JSON.stringify(report,null,2)+'\n');
assert.deepEqual(privacyIssues(data),[]);
await writeFile(path.join(root,'docs/agent-cli-npm-publish.json'),data);
console.log('Saved docs/agent-cli-npm-publish.json');
