// Real CLI/shared-WASM archive searches. Labels live outside the searched root.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, zipSync, strToU8 } from 'fflate';
import { privacyIssues } from './agent-release-privacy.mjs';
import { executableName } from './agent-platforms.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.FILENS_AGENT_BINARY || path.join(root, 'dist', executableName(`${process.platform}-${process.arch}`));
const work = await mkdtemp(path.join(os.tmpdir(), 'filens-archives-'));
const corpus = path.join(work, 'corpus'), temporary = path.join(work, 'temporary');
await mkdir(corpus); await mkdir(temporary);
const fact = 'ARCHIVE2026 项目预算不得超过12345.67元，新增支出需要审批。 Budget risk requires approval.\n';
const bytes = value => typeof value === 'string' ? strToU8(value) : value;
const zip = files => zipSync(Object.fromEntries(Object.entries(files).map(([name, data]) => [name, bytes(data)])));
function tar(entries) {
  const blocks = [];
  function put(name, data, type = '0', link = '') {
    data = Buffer.from(bytes(data));
    const h = Buffer.alloc(512);
    const field = (offset, length, value) => h.write(value, offset, length, 'utf8');
    const octal = (offset, length, value) => field(offset, length, value.toString(8).padStart(length - 1, '0') + '\0');
    field(0, 100, name); octal(100, 8, 0o644); octal(108, 8, 0); octal(116, 8, 0);
    octal(124, 12, data.length); octal(136, 12, 0); h.fill(32, 148, 156);
    field(156, 1, type); field(157, 100, link); field(257, 6, 'ustar\0'); field(263, 2, '00');
    octal(148, 8, h.reduce((sum, n) => sum + n, 0));
    blocks.push(h, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  for (const entry of entries) {
    if (Buffer.byteLength(entry.name) > 100) put('././@LongLink', entry.name + '\0', 'L');
    put(Buffer.byteLength(entry.name) > 100 ? 'long-name' : entry.name, entry.data ?? '', entry.type, entry.link);
  }
  blocks.push(Buffer.alloc(1024)); return Buffer.concat(blocks);
}
const docx = text => zip({
  '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  'word/document.xml': `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
});
let requests = 0;
const observations = [];
function invoke(label, args, expected = 0, extraEnv = {}) {
  const r = spawnSync(binary, args, { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 64 << 20,
    env: { ...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary, ...extraEnv } });
  requests++; observations.push({ case: label, exit: r.status });
  assert.equal(r.error, undefined, `${label}: ${r.error}`);
  assert.equal(r.status, expected, `${label}\n${r.stderr}\n${r.stdout}`);
  return r.stdout;
}
const json = (label, args, expected, env) => JSON.parse(invoke(label, args, expected, env));
const search = (label, input, query = 'ARCHIVE2026', extra = [], expected = 0, env) => json(label, ['search', input, '--query', query, '--layout', '--json', '--max-results', '100', ...extra], expected, env);
async function file(name, data, directory = corpus) { const p = path.join(directory, name); await writeFile(p, bytes(data)); return p; }

try {
  const ocr = process.argv.includes('--ocr');
  const imageEntries = ocr ? [
    {name:'invoice.png', data:await readFile(path.join(root, 'docs/assets/agent-cli/invoice-zh.png'))},
    {name:'scan.pdf', data:await readFile(path.join(root, 'converter/rapidocr/testdata/scan.pdf'))},
  ] : [{name:'placeholder.txt', data:'No OCR requested.'}];
  const outer = await file('资料 bundle.zip', zip({
    'readme.txt': fact,
    '附件.zip': zip({'nested report.docx':docx(fact),'images.tar.gz':gzipSync(tar(imageEntries)),'unknown.bin':new Uint8Array([0,1,2])}),
    'mixed.tar':tar([{name:'notes.txt.gz',data:gzipSync(strToU8(fact))}]),
    '中文目录/hello.txt':fact, '.secret.txt':fact, 'node_modules/ignored.txt':fact,
  }));
  await file('source.txt', fact);
  await file('flat.tar', tar([{name:'tar-note.txt',data:fact}]));
  await file('flat.tgz', gzipSync(tar([{name:'tgz-note.txt',data:fact}])));
  const targz = await file('flat.tar.gz', gzipSync(tar([{name:'targz-note.txt',data:fact}])));
  await file('notes.txt.gz', gzipSync(strToU8(fact)));
  await file('application.jar', zip({'jar-note.txt':fact}));
  for (let i=0;i<40;i++) await file(`control-${i}.txt`, 'Unrelated control text.');
  const before = (await readdir(corpus)).sort();
  const all = search('mixed directory with nested archives', corpus);
  assert.equal(all.search.matchedFiles, 10);
  assert.equal(all.search.scan.archives.maxDepth, 8);
  assert.ok(all.search.results.some(h => h.path.includes('!/附件.zip!/nested report.docx')));
  assert.ok(all.search.results.some(h => h.path.includes('!/mixed.tar!/notes.txt.gz!/notes.txt')));
  for (const hit of all.search.results) {
    const read = json('read virtual path and verify evidence', ['read', hit.path, '--layout', '--json']);
    for (const e of hit.excerpts) assert.equal(Buffer.from(read.content.text).subarray(e.startByte,e.endByte).toString(),e.text);
    if (hit.archive) assert.deepEqual(hit.archive.members, read.source.archive.members);
  }
  assert.equal(search('standalone ZIP', outer).search.matchedFiles, 4);
  assert.equal(search('standalone TAR.GZ', targz).search.matchedFiles, 1);
  assert.equal(json('Chinese intent with archive input', [`在 "${outer}" 中搜索 "ARCHIVE2026"，以 JSON 输出`]).search.matchedFiles, 4);
  assert.equal(json('English intent with archive input', [`search "${targz}" for "ARCHIVE2026" as json`]).search.matchedFiles, 1);
  const parallel = search('parallel archive/OCR lane parity',corpus,'ARCHIVE2026',[],0,{FILENS_SEARCH_JOBS:'4'});
  assert.equal(parallel.search.scan.execution.workers,4);
  assert.deepEqual(parallel.search.results,all.search.results);
  const named = json('nested filenames without content or OCR',['search',outer,'--query','nested report','--search-mode','files','--no-ocr','--json']);
  assert.ok(named.search.results.some(h=>h.path.endsWith('!/nested report.docx')));
  assert.ok(named.search.results.every(h=>h.excerpts.length===0));
  assert.ok(search('include hidden members',outer,'ARCHIVE2026',['--include-hidden']).search.results.some(h=>h.path.endsWith('!/.secret.txt')));
  assert.ok(!all.search.results.some(h=>h.path.includes('node_modules')||h.path.includes('.secret')));
  const member = `${outer}!/附件.zip!/nested report.docx`;
  const summary = json('summarize nested DOCX',['summarize',member,'--query','预算','--summary-ratio','1','--layout','--json']);
  assert.match(summary.content.text,/12345\.67/);
  assert.equal(summary.content.summary.extractive,true);
  const missing = json('missing member is explicit',['read',`${outer}!/missing.txt`,'--json'],3);
  assert.equal(missing.error.code,'archive_member_not_found');
  const onlyzip = await file('exports.zip',zip({'note.txt':fact}),work);
  assert.match(json('bare virtual member path',[`${onlyzip}!/note.txt`,'--json']).content.text,/ARCHIVE2026/);
  assert.match(json('Chinese virtual member read',[`读取 "${member}"，以 JSON 输出`]).content.text,/12345\.67/);
  for (const format of ['text','json','markdown','html','yaml','xml','csv','tsv']) {
    const out = invoke(`archive search output ${format}`,['search',onlyzip,'--query','ARCHIVE2026','--format',format]);
    assert.ok(out.includes('ARCHIVE2026')&&out.includes('!/note.txt'));
  }
  let deep = zip({'leaf.txt':fact});
  for(let i=0;i<7;i++) deep=zip({'inner.zip':deep});
  const atLimit = await file('eight.zip',deep,work);
  const eight = search('eight nested archive layers',atLimit);
  assert.equal(eight.search.matchedFiles,1);
  assert.equal(eight.search.results[0].archive.members.length,8);
  assert.match(json('read at nesting limit',['read',eight.search.results[0].path,'--json']).content.text,/ARCHIVE2026/);
  const overLimit = await file('nine.zip',zip({'safe.txt':fact,'inner.zip':deep}),work);
  const limited=search('nesting limit preserves partial evidence',overLimit,'ARCHIVE2026',[],3);
  assert.equal(limited.search.matchedFiles,1); assert.equal(limited.search.truncated,true);
  assert.ok(limited.search.scan.extractionErrors.some(e=>e.error.code==='archive_limit'));
  const countLimit = await file('count.zip',zip({'a.txt':fact,'b.txt':fact}),work);
  assert.equal(search('member file count limit',countLimit,'ARCHIVE2026',['--max-files','1'],3).search.indexedFiles,1);
  const broken=await file('broken.zip',zip({'safe.txt':fact,'broken.zip':'not a zip'}),work);
  const partial=search('corrupt nested archive',broken,'ARCHIVE2026',[],3);
  assert.equal(partial.search.matchedFiles,1);assert.equal(partial.search.complete,false);
  assert.ok(partial.search.scan.extractionErrors.some(e=>e.path.endsWith('!/broken.zip')));
  const unsafe=await file('unsafe.zip',zip({'../escape.txt':fact,'C:/outside.txt':fact,'safe.txt':fact}),work);
  const guarded=search('unsafe archive paths are rejected',unsafe,'ARCHIVE2026',[],3);
  assert.equal(guarded.search.matchedFiles,1);assert.equal(guarded.search.scan.extractionErrorCount,2);
  const linktar=await file('links.tar',tar([{name:'link.txt',type:'2',link:'../../outside'},{name:'safe.txt',data:fact}]),work);
  assert.equal(search('TAR symlinks are not followed',linktar).search.matchedFiles,1);
  const duplicates=await file('duplicates.tar',tar([{name:'same.txt',data:fact},{name:'same.txt',data:'different'}]),work);
  const duplicateResult=search('duplicate TAR member paths',duplicates,'ARCHIVE2026',[],3);
  assert.equal(duplicateResult.search.matchedFiles,1);
  assert.ok(duplicateResult.search.scan.extractionErrors.some(e=>e.error.code==='duplicate_archive_path'));
  const aliases=await file('aliases.zip',zip({'a/b.txt':fact,'a/./b.txt':'different'}),work);
  const aliasResult=search('normalized member aliases are duplicates',aliases,'ARCHIVE2026',[],3);
  assert.equal(aliasResult.search.matchedFiles,1);
  assert.ok(aliasResult.search.scan.extractionErrors.some(e=>e.error.code==='duplicate_archive_path'));
  const bangDirectory=path.join(work,'parent!');await mkdir(bangDirectory);
  const escaped=await file('100%.zip',zip({'notes!/report%21!.txt':fact}),bangDirectory);
  const escapedHit=search('literal delimiter and percent path characters',escaped).search.results[0];
  assert.deepEqual(escapedHit.archive.members,['notes!/report%21!.txt']);
  assert.ok(escapedHit.path.includes('parent%21/')&&escapedHit.path.includes('100%25.zip'));
  assert.match(json('escaped virtual member read',['read',escapedHit.path,'--json']).content.text,/ARCHIVE2026/);
  assert.match(json('bare escaped virtual path',[escapedHit.path,'--json']).content.text,/ARCHIVE2026/);
  const collision=await file('collision.zip',zip({'note.txt':fact}),work);
  await mkdir(collision+'!');await writeFile(path.join(collision+'!','note.txt'),'DECOY unrelated physical path.');
  const collisionHit=search('archive path with same-named physical directory',collision).search.results[0];
  assert.match(json('virtual provenance wins over physical decoy',['read',collisionHit.path,'--json']).content.text,/ARCHIVE2026/);
  assert.equal(search('member extraction byte limit',onlyzip,'ARCHIVE2026',['--max-bytes','16'],3).search.results[0].sourceComplete,false);
  const invalidGzip=await file('invalid.txt.gz','not gzip',work);
  assert.equal(search('invalid GZIP header',invalidGzip,'ARCHIVE2026',[],3).search.complete,false);
  const longName='long/'.repeat(25)+'note.txt';
  const longtar=await file('long.tar',tar([{name:longName,data:fact}]),work);
  assert.ok(search('GNU long TAR names',longtar).search.results[0].path.endsWith(longName));
  const encrypted = Buffer.from(zip({'locked.txt':fact,'safe.txt':fact}));
  for(let i=0;i<encrypted.length-30;i++) {
    const sig=encrypted.readUInt32LE(i);
    if(sig===0x04034b50&&encrypted.subarray(i+30,i+40).toString()==='locked.txt') encrypted.writeUInt16LE(encrypted.readUInt16LE(i+6)|1,i+6);
    if(sig===0x02014b50&&encrypted.subarray(i+46,i+56).toString()==='locked.txt') encrypted.writeUInt16LE(encrypted.readUInt16LE(i+8)|1,i+8);
  }
  const locked=await file('locked.zip',encrypted,work);
  const lock=search('encrypted flag produces password error',locked,'ARCHIVE2026',[],3);
  assert.equal(lock.search.matchedFiles,1); assert.ok(lock.search.scan.extractionErrors.some(e=>e.error.code==='password_required'));
  assert.ok(json('encrypted leaf filename remains visible',['search',locked,'--query','locked.txt','--search-mode','files','--json']).search.results.some(h=>h.path.endsWith('!/locked.txt')));
  if(ocr) {
    const found=search('OCR from nested ZIP and TAR.GZ',outer,'FILENS2026');
    assert.equal(found.search.matchedFiles,2);
    for(const hit of found.search.results) {
      const read=json('read nested OCR member and validate offsets',['read',hit.path,'--layout','--json']);
      for(const e of hit.excerpts) assert.equal(Buffer.from(read.content.text).subarray(e.startByte,e.endByte).toString(),e.text);
      const unit=hit.path.endsWith('.pdf')?'pt':'px';
      assert.ok(hit.excerpts.some(e=>e.layout.blocks.some(b=>b.bounds?.unit===unit)));
    }
    const unavailable=search('unavailable OCR retains other members',outer,'ARCHIVE2026',['--no-ocr'],3);
    assert.equal(unavailable.search.matchedFiles,4);
  }
  assert.deepEqual((await readdir(corpus)).sort(),before);
  assert.deepEqual(await readdir(temporary),[],'CLI left temporary extraction files behind');
  const report={observedAt:new Date().toISOString(),platform:`${process.platform}-${process.arch}`,requests,ocr,
    result:'passed',formats:['zip','jar','tar','tgz','tar.gz','gz'],maxVerifiedLayers:8,observations,
    limitations:['Small synthetic functional fixtures; not an archive/retrieval accuracy benchmark.','Encrypted fixture exercises ZIP encryption flags, not successful password decryption.','Single host; Windows/Linux execution needs CI.','RAR and 7z are unsupported.']};
  const output=Buffer.from(JSON.stringify(report,null,2)+'\n');assert.deepEqual(privacyIssues(output),[]);
  await writeFile(path.join(root,'docs/agent-cli-search-archives.json'),output);
  console.log(`${requests} archive CLI checks passed: mixed/nested formats, virtual read/summary, original evidence, 8 outputs, limits, partial errors${ocr?', real OCR and coordinates':''}, cleanup.`);
} finally { await rm(work,{recursive:true,force:true}); }
