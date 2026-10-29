// Real CLI + WASM checks for duplicate detection and perceptual image grouping.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, link, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executableName } from './agent-platforms.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.FILENS_AGENT_BINARY || path.join(root, 'dist/agent-lite', executableName(`${process.platform}-${process.arch}`));
const work = path.join(root, 'dist/agent-similarity-tests' + (process.env.FILENS_WALKER === 'hdrw-wasi' ? '-hdrw' : ''));
await rm(work, { recursive:true, force:true });
await mkdir(work, { recursive:true });
const observations = [];
function run(args, expected=0, input) {
  const started = performance.now();
  const result = spawnSync(binary, args, { cwd:root, input, encoding:'utf8', timeout:120000, maxBuffer:16<<20 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, expected, `${args.join(' ')}\n${result.stderr}\n${result.stdout}`);
  observations.push({args,exit:result.status,ms:Math.round(performance.now()-started)});
  return result.stdout;
}
const json = (args, expected=0, input) => JSON.parse(run(args,expected,input));
const duplicates = path.join(work,'duplicate files');
const photos = path.join(work,'photos');
await mkdir(duplicates);
await mkdir(photos);
await writeFile(path.join(duplicates,'a.bin'), Buffer.alloc(20000,45));
await copyFile(path.join(duplicates,'a.bin'),path.join(duplicates,'b.dat'));
const changed = Buffer.alloc(20000,45); changed[19000]=46;
await writeFile(path.join(duplicates,'same-prefix.bin'),changed);
await writeFile(path.join(duplicates,'unique'), 'unique size');
await writeFile(path.join(duplicates,'empty-a'), '');
await writeFile(path.join(duplicates,'empty-b'), '');
await writeFile(path.join(duplicates,'.hidden'), Buffer.alloc(20000,45));
await mkdir(path.join(duplicates,'nested'));
await copyFile(path.join(duplicates,'a.bin'),path.join(duplicates,'nested/c.bin'));
await mkdir(path.join(duplicates,'node_modules'));
await copyFile(path.join(duplicates,'a.bin'),path.join(duplicates,'node_modules/excluded.bin'));
let hardLinks = false;
let hardLinkCreated = false;
try {
  await link(path.join(duplicates,'a.bin'),path.join(duplicates,'hard-link.bin'));
  hardLinkCreated = true;
  hardLinks = process.platform !== 'win32';
  await symlink(path.join(duplicates,'a.bin'),path.join(duplicates,'symbolic-link.bin'));
  await symlink(duplicates,path.join(duplicates,'cycle'),'dir');
} catch (error) { if (!['EPERM','EACCES','ENOTSUP'].includes(error.code)) throw error; }
const found = json(['duplicates',duplicates,'--json']);
assert.equal(found.similarity.complete,true);
assert.equal(found.similarity.matchedGroups,2);
const binaryGroup = found.similarity.groups.find(g=>g.files.some(f=>f.path==='a.bin'));
assert.equal(binaryGroup.files.length,3+(hardLinkCreated&&!hardLinks?1:0));
assert.ok(binaryGroup.files.every(f=>!f.path.includes('same-prefix')&&!f.path.startsWith('.')));
assert.match(binaryGroup.sha256,/^[a-f0-9]{64}$/);
if (hardLinks) assert.equal(found.similarity.processing.skippedHardLinks,1);
assert.ok(json(['duplicates',duplicates,'--include-hidden','--json']).similarity.matchedFiles>found.similarity.matchedFiles);
assert.ok(json(['duplicates',duplicates,'--max-depth','1','--json']).similarity.matchedFiles<found.similarity.matchedFiles);
assert.equal(json(['duplicates',duplicates,'--max-results','1','--json'],3).similarity.truncated,true);
assert.equal(json(['duplicates',duplicates,'--max-files','1','--json'],3).similarity.complete,false);

function crc(bytes) {
  let c=0xffffffff;
  for (const b of bytes) { c^=b; for(let i=0;i<8;i++) c=(c>>>1)^((c&1)?0xedb88320:0); }
  return (c^0xffffffff)>>>0;
}
function png(width,height,pixel,level=6) {
  const chunk=(kind,data)=>{const head=Buffer.alloc(8);head.writeUInt32BE(data.length);head.write(kind,4);const tail=Buffer.alloc(4);tail.writeUInt32BE(crc(Buffer.concat([Buffer.from(kind),data])));return Buffer.concat([head,data,tail]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  const raw=Buffer.alloc(height*(1+width*4));
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) raw.set(pixel(x/width,y/height),y*(1+width*4)+1+x*4);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw,{level})),chunk('IEND',Buffer.alloc(0))]);
}
const scene=(x,y)=> x>.2&&x<.6&&y>.3&&y<.8 ? [200,60,40,255] : [Math.round(x*140),Math.round(y*180),100,255];
await writeFile(path.join(photos,'scene-original.png'),png(256,192,scene));
await writeFile(path.join(photos,'scene-small.png'),png(64,48,scene));
await writeFile(path.join(photos,'scene-recompressed.png'),png(256,192,scene,1));
await writeFile(path.join(photos,'unrelated.png'),png(128,96,(x,y)=>[(x+y)%.4<.2?255:0,x>.7?255:0,y<.3?0:255,255]));
await writeFile(path.join(photos,'black.png'),png(32,32,()=>[0,0,0,255]));
await writeFile(path.join(photos,'white.png'),png(32,32,()=>[255,255,255,255]));
await writeFile(path.join(photos,'transparent.png'),png(32,32,()=>[0,0,0,0]));
const images=json(['similar-images',photos,'--json','--no-ocr']);
assert.equal(images.similarity.complete,true);
assert.equal(images.similarity.processing.decodedImages,7);
const sceneGroup=images.similarity.groups.find(g=>g.files.some(f=>f.path==='scene-original.png'));
assert.ok(sceneGroup);
assert.equal(sceneGroup.files.length,3);
assert.ok(sceneGroup.files.some(f=>f.width===64&&f.height===48));
assert.ok(sceneGroup.files.every(f=>f.distanceToReference<=8));
assert.ok(!images.similarity.groups.some(g=>g.files.some(f=>f.path==='black.png')));
assert.equal(images.similarity.groups.find(g=>g.files.some(f=>f.path==='white.png')).files.length,2);
const strict=json(['similar',photos,'--threshold','0','--json']);
assert.ok(strict.similarity.groups.every(g=>g.files.every(f=>f.distanceToReference===0)));
for(const intent of [ `查找 "${photos}" 中的相似图片，以 JSON 输出`, `find duplicate files in "${duplicates}" as json` ]) {
  assert.equal(json([intent]).operation,'similar');
}
assert.equal(json(['-'],0,JSON.stringify({operation:'similar',input:photos,similarityMode:'images',threshold:8})).similarity.matchedGroups,images.similarity.matchedGroups);
for(const format of ['text','json','markdown','html','yaml','xml','csv','tsv']) {
  assert.ok(run(['similar-images',photos,'--format',format]).includes('scene-original.png'));
}
for(const request of [
  {operation:'similar',input:photos,threshold:25},
  {operation:'similar',input:photos,similarityMode:'semantic'},
  {operation:'duplicates',input:duplicates,threshold:1},
  {operation:'similar',input:photos,layout:true},
  {operation:'similar',input:photos,maxResults:0},
  {operation:'search',input:photos,query:'scene',threshold:8},
]) assert.equal(json(['-'],2,JSON.stringify(request)).ok,false);
await writeFile(path.join(photos,'broken.jpg'),'not a JPEG');
const partial=json(['similar-images',photos,'--json'],3);
assert.equal(partial.similarity.complete,false);
assert.equal(partial.similarity.processing.errorCount,1);
assert.equal(partial.similarity.matchedGroups,images.similarity.matchedGroups);
// Exercise real JPEG decoding and its EXIF orientation without requiring OCR.
await copyFile(path.join(root,'converter/rapidocr/testdata/scan-exif.jpg'),path.join(photos,'scan.jpg'));
await copyFile(path.join(photos,'scan.jpg'),path.join(photos,'scan-copy.jpg'));
await rm(path.join(photos,'broken.jpg'));
const jpeg=json(['similar-images',photos,'--json']);
assert.ok(jpeg.similarity.groups.some(g=>g.files.filter(f=>f.path.startsWith('scan')).length===2));
assert.ok(jpeg.similarity.groups.flatMap(g=>g.files).filter(f=>f.path.startsWith('scan')).every(f=>f.width===2000&&f.height===520));
assert.equal((await readFile(path.join(duplicates,'same-prefix.bin')))[19000],46);
const capacity=json(['capacity','--json','--no-ocr']).capacity;
assert.ok(capacity.operations.some(o=>o.name==='similar'));
assert.equal(capacity.similarity.requiresModel,false);
await writeFile(path.join(work,'report.json'),JSON.stringify({binary,hardLinks,observations},null,2)+'\n');
console.log(`${observations.length} real CLI similarity checks passed: size/prefix/full hashes, image resizing, recompression, flat colors, transparency, JPEG/EXIF, limits, errors and eight outputs.`);
