// Portable release candidates and public fixtures for native Windows testing.
import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import { buildAgentBinary } from './agent-rust-build.mjs';
import { assertReleaseDirectory, privacyIssues } from './agent-release-privacy.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const version=JSON.parse(await readFile(path.join(root,'packaging/agent-release.json'),'utf8')).version;
const core=path.join(root,'dist/npm/filens-cli-win32-x64');
const ocr=path.join(root,'dist/npm/filens-ocr-win32-x64');
for(const directory of [core,ocr])if(JSON.parse(await readFile(path.join(directory,'package.json'),'utf8')).version!==version)throw new Error('Build Windows npm candidates first: node scripts/package-agent-npm.mjs --platform win32-x64');
const outputs=[];
for(const flavor of ['full','lite']){
  const name=`filens-${version}-win32-x64-${flavor}`;
  const directory=path.join(root,'dist/windows',name);await rm(directory,{recursive:true,force:true});await mkdir(directory,{recursive:true});
  for(const file of ['converter-text.wasm.gz','converter-image.wasm.gz','pdfium.wasm.gz','THIRD-PARTY-NOTICES.md'])await copyFile(path.join(core,file),path.join(directory,file));
  await cp(path.join(core,'licenses'),path.join(directory,'licenses'),{recursive:true});
  await cp(path.join(root,'skills/filens'),path.join(directory,'skills/filens'),{recursive:true});
  const binaryCompression=await buildAgentBinary(path.join(directory,'filens.exe'),{platform:'win32-x64',lite:flavor==='lite',upx:!process.argv.includes('--no-upx')});
  if(flavor==='full')for(const file of ['native','models'])await cp(path.join(ocr,file),path.join(directory,file),{recursive:true});
  await assertReleaseDirectory(directory);
  await copyFile(path.join(root,'scripts/test-agent-windows.mjs'),path.join(directory,'test-windows.mjs'));
  await copyFile(path.join(root,'docs/agent-cli-windows.zh-CN.md'),path.join(directory,'README-Windows.md'));
  const fixtures=path.join(directory,'test-fixtures');await mkdir(fixtures,{recursive:true});
  for(const file of ['scan.png','scan-transparent.png','scan-exif.jpg','scan-rotated.png','scan.pdf'])await copyFile(path.join(root,'converter/rapidocr/testdata',file),path.join(fixtures,file));
  await copyFile(path.join(root,'docs/assets/agent-cli/invoice-zh.png'),path.join(fixtures,'invoice-zh.png'));
  await copyFile(path.join(root,'examples/go-wazero-converter/fixtures/raw/sample.dng'),path.join(fixtures,'sample.dng'));
  const w='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  await writeFile(path.join(fixtures,'embedded.docx'),zipSync({
    '[Content_Types].xml':strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels':strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="${rel}/officeDocument" Target="word/document.xml"/></Relationships>`),
    'word/document.xml':strToU8(`<w:document xmlns:w="${w}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${rel}"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Windows document test</w:t></w:r></w:p><w:p><w:r><w:t>BEFORE 中文</w:t><w:drawing><a:blip r:embed="image1"/></w:drawing><w:t>AFTER</w:t></w:r></w:p></w:body></w:document>`),
    'word/_rels/document.xml.rels':strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="image1" Type="${rel}/image" Target="media/scan.png"/></Relationships>`),
    'word/media/scan.png':await readFile(path.join(fixtures,'scan-transparent.png'))
  }));
  const files={};
  async function visit(base){for(const entry of await readdir(base,{withFileTypes:true})){
    const file=path.join(base,entry.name);if(entry.isDirectory())await visit(file);else{
      const bytes=await readFile(file);const issues=privacyIssues(bytes);if(issues.length)throw new Error(`Portable test-kit privacy check: ${issues.join(', ')}`);
      files[path.relative(directory,file).split(path.sep).join('/')]=bytes;
    }
  }}
  await visit(directory);
  const zip=zipSync(files,{level:6});const archive=path.join(root,'dist/windows',`${name}.zip`);await writeFile(archive,zip);
  const info={flavor,file:path.basename(archive),bytes:zip.length,unpackedBytes:Object.values(files).reduce((sum,b)=>sum+b.length,0),sha256:createHash('sha256').update(zip).digest('hex'),binaryCompression,nativeWindowsExecution:false};
  outputs.push(info);console.log(`${info.file}: ${(info.bytes/1048576).toFixed(2)} MiB zipped`);
}
await writeFile(path.join(root,'dist/windows/release.json'),JSON.stringify({version,platform:'win32-x64',status:'cross-built candidate; native Windows testing pending',outputs},null,2)+'\n');
