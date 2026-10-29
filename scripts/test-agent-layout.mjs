// Real WASM/native CLI checks. The same small source document is used by the
// terminal demo, so visual claims have an executable source of truth.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const binary=process.env.FILENS_AGENT_BINARY||path.join(root,'dist/filens');
const work=path.join(root,'dist/agent-layout');await mkdir(work,{recursive:true});
const source='<w:document xmlns:w="word"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Aurora launch brief</w:t></w:r></w:p><w:p><w:r><w:t>Read locally. Keep the evidence.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Milestone</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Status</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Native OCR</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Ready</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>Budget: ¥12,345.67</w:t></w:r></w:p></w:body></w:document>';
const doc=path.join(work,'launch-brief.docx');
await writeFile(doc,zipSync({
 '[Content_Types].xml':strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'),
 '_rels/.rels':strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
 'word/document.xml':strToU8(source.replace('xmlns:w="word"','xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"')),
 'word/_rels/document.xml.rels':strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
 'word/styles.xml':strToU8('<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>')
}));
const observations=[];
function run(args,expected=0){
 const start=performance.now();const result=spawnSync(binary,args,{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:24<<20});
 assert.equal(result.error,undefined);assert.equal(result.status,expected,`${args.join(' ')}\n${result.stderr}\n${result.stdout}`);
 observations.push({args,exit:result.status,ms:Math.round(performance.now()-start)});return result.stdout;
}
function json(args,expected=0){return JSON.parse(run(args,expected));}
const cap=json(['capacity','--json']);
assert.deepEqual(cap.capacity.outputFormats,['text','json','markdown','html','yaml','xml','csv','tsv']);
const document=json([`获取 "${doc}" 的布局，以 JSON 输出`]);
const layout=document.content.layout;
assert.equal(layout.version,'filens-layout-v1');assert.equal(layout.pages.length,0);
assert.ok(layout.blocks.some(b=>b.kind==='heading'&&b.level===1));
assert.equal(layout.blocks.filter(b=>b.kind==='cell').length,4);
assert.ok(layout.blocks.every(b=>!b.bounds));
const md=run([`read "${doc}" as markdown`]);
assert.match(md,/# Aurora launch brief/);assert.match(md,/\| Native OCR \| Ready \|/);
const html=run([doc,'--format','html']);assert.match(html,/<h1>Aurora launch brief<\/h1>/);assert.match(html,/<td>Ready<\/td>/);
await writeFile(path.join(work,'launch-brief.md'),md);await writeFile(path.join(work,'launch-brief.html'),html);
const yaml=run(['layout',doc,'--format','yaml']);assert.match(yaml,/coverage: logical/);assert.match(yaml,/kind: cell/);
const xml=run(['layout',doc,'--format','xml']);assert.match(xml,/<filens>/);assert.match(xml,/<field name="layout">/);
assert.match(run(['layout',doc,'--format','csv']),/^id,kind,page,table,row,column,text,x,y,width,height,unit,coordinateSpace/);
const csv=path.join(work,'quoted.csv');await writeFile(csv,'Name,Note\r\n中文,"comma, quote "" and newline\nsecond line"\r\n');
const exported=run([csv,'--format','csv']);assert.match(exported,/"comma, quote "" and newline\nsecond line"/);assert.match(exported,/中文/);
assert.match(run([csv,'--format','tsv']),/Name\tNote/);
const image=path.join(root,'docs/assets/agent-cli/invoice-zh.png');
const recognized=json(['layout',image,'--json']);
const il=recognized.content.layout;assert.equal(il.pages[0].unit,'px');assert.equal(il.pages[0].width,1440);
assert.ok(il.blocks.length>=7);assert.match(recognized.content.text,/FILENS2026/);
for(const b of il.blocks){assert.equal(b.polygon.length,4);assert.ok(b.bounds.x>=0&&b.bounds.x+b.bounds.width<=1440);assert.equal(b.bounds.unit,'px');assert.ok(b.detectionScore>=0&&b.detectionScore<=1);}
const scan=json(['layout',path.join(root,'converter/rapidocr/testdata/scan.pdf'),'--json']);
assert.equal(scan.content.layout.pages.length,2);assert.ok(scan.content.layout.blocks.some(b=>b.page===2));
assert.ok(scan.content.layout.blocks.every(b=>b.bounds.unit==='pt'&&b.coordinateSpace===`page:${b.page}`));
const pdf=json(['layout',path.join(root,'apps/demo/public/samples/filens-cosmic-atlas.pdf'),'--json']);
assert.equal(pdf.content.layout.pages.length,3);assert.ok(pdf.content.layout.blocks.some(b=>b.source==='pdf-text'&&b.font.Size>0));
for(const response of [document,recognized,scan,pdf]){
 const bytes=Buffer.from(response.content.text);
 for(const block of response.content.layout.blocks){if(block.startByte!=null){assert.ok(block.startByte<=block.endByte&&block.endByte<=bytes.length);assert.equal(Buffer.from(bytes.subarray(block.startByte,block.endByte).toString()).length,block.endByte-block.startByte);}}
}
// Known text placed at (60,200) in a cropped source page. Check the displayed
// region independently of the source coordinate system for all four rotations.
for(const [rotation,xrange,yrange] of [[0,[20,40],[35,60]],[90,[140,170],[20,40]],[180,[180,220],[140,170]],[270,[35,60],[180,220]]]){
 const stream='BT /F1 14 Tf 60 200 Td (Rotation test) Tj ET';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 300] /CropBox [30 50 330 250] /Rotate ${rotation} /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
 let bytes='%PDF-1.4\n';const offsets=[0];objects.forEach((o,i)=>{offsets.push(bytes.length);bytes+=`${i+1} 0 obj\n${o}\nendobj\n`;});const xref=bytes.length;
 bytes+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 const file=path.join(work,`rotated-${rotation}.pdf`);await writeFile(file,bytes);
 const result=json(['layout',file,'--json']);const box=result.content.layout.blocks.find(b=>b.bounds)?.bounds;assert.ok(box,`missing ${rotation} geometry`);
 assert.ok(box.x>=xrange[0]&&box.x<=xrange[1]&&box.y>=yrange[0]&&box.y<=yrange[1],`${rotation}: ${JSON.stringify(box)}`);
}
const short=json(['layout',image,'--json','--max-bytes','5'],3);assert.ok(Buffer.byteLength(short.content.text)<=5);assert.ok(short.content.layout.blocks.every(b=>b.endByte<=5));
const hostile=path.join(work,'unsafe.txt');await writeFile(hostile,'<script>globalThis.pwned=true</script> & "quoted"');
const escaped=run([hostile,'--format','html']);assert.ok(!escaped.includes('<script>'));assert.match(escaped,/&lt;script&gt;/);
const withMetadata=run(['layout',image,'--format','html']);assert.match(withMetadata,/id="filens-layout"/);assert.match(withMetadata,/coordinateSpace/);
await writeFile(path.join(work,'invoice-layout.json'),JSON.stringify(recognized,null,2)+'\n');
await writeFile(path.join(work,'report.json'),JSON.stringify({observations,outputs:cap.capacity.outputFormats,realPDFPages:3,scannedPDFPages:2,ocrBlocks:il.blocks.length,logicalCells:4},null,2)+'\n');
console.log(`${observations.length} actual CLI checks passed: eight outputs, logical headings/tables, PDF/OCR coordinates, UTF-8 bounds, truncation and HTML escaping.`);
