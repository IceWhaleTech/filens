// Author the public showcase files from local, credited photography.
// Run: node scripts/generate-showcase-documents.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import JSZip from 'jszip';

const root = fileURLToPath(new URL('../', import.meta.url));
const samples = path.join(root, 'apps/demo/public/samples');
const assets = path.join(samples, 'showcase');
const xml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const navy = '07162E';
const blue = '128DFF';
const ice = 'D6EEFF';
const ns = 'http://schemas.openxmlformats.org';
const rel = `${ns}/officeDocument/2006/relationships`;
const pack = `${ns}/package/2006/relationships`;
const zipBytes = (zip) => zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
const aurora = await readFile(path.join(assets, 'aurora.jpg'));
const nebula = await readFile(path.join(assets, 'cosmic-cliffs.jpg'));

// Editable slide text and shapes, with actual photographic image parts.
const deck = await JSZip.loadAsync(await readFile(path.join(samples, 'sample-deck.pptx')));
const emptyTree = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>';
for (const file of ['ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml']) {
  deck.file(file, (await deck.file(file).async('string')).replace(/<p:spTree>[\s\S]*?<\/p:spTree>/, emptyTree));
}
const emu = (v) => Math.round(v * 7620);
let id = 1;
const transform = (x, y, w, h) => `<a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm>`;
function shape(x, y, w, h, color, preset = 'rect') {
  const n = ++id;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${n}" name="Shape ${n}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${transform(x,y,w,h)}<a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
}
function text(value, x, y, w, h, size, color = 'FFFFFF', bold = false) {
  const n = ++id;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${n}" name="Text ${n}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${transform(x,y,w,h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0"/><a:lstStyle/><a:p><a:pPr><a:lnSpc><a:spcPct val="100000"/></a:lnSpc></a:pPr><a:r><a:rPr lang="en-US" sz="${Math.round(size*75)}" b="${bold?1:0}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>${xml(value)}</a:t></a:r></a:p></p:txBody></p:sp>`;
}
function picture(name, x, y, w, h) {
  const n = ++id;
  return `<p:pic><p:nvPicPr><p:cNvPr id="${n}" name="${name} photograph"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId${name}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${transform(x,y,w,h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}
function slide(content) {
  return `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="${ns}/drawingml/2006/main" xmlns:r="${rel}" xmlns:p="${ns}/presentationml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${navy}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>${emptyTree.replace('</p:spTree>', content+'</p:spTree>')}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}
const slides = [
  slide(picture('AuroraPortrait',480,0,720,675)+shape(0,0,480,675,navy)+
    text('FIELD NOTES / THE NIGHT ISSUE',48,46,600,28,13,blue,true)+
    text('BEYOND',43,174,700,110,91,'FFFFFF',true)+text('THE VISIBLE.',45,282,760,100,68,'FFFFFF',true)+
    shape(50,426,64,4,blue)+text('Follow the light.',50,456,390,40,25,ice)+
    text('A journey into the extraordinary.',50,502,420,32,17,'7FADDA')+
    text('POLAR SKIES / DEEP SPACE / NEW PERSPECTIVES',50,603,700,22,11,'8DB6DC')+
    text('filens / 01',50,641,400,20,11,'6487AE')),
  slide(picture('Aurora',0,0,1200,675)+shape(0,478,1200,197,navy)+
    text('02 / AT THE EDGE OF NIGHT',48,40,850,25,13,ice,true)+
    text('CHASE THE LIGHT.',48,507,1100,75,54,'FFFFFF',true)+
    text('A winter horizon. A sky in motion. An entirely new point of view.',50,596,1100,28,19,'9EC4E8')+
    text('Photograph: Carsten / CC BY 2.0 / blue color grade',50,647,1000,18,10,'6487AE')),
  slide(picture('Nebula',540,0,660,675)+shape(0,0,560,675,navy)+
    text('03 / THE COSMIC ATLAS',48,46,600,25,13,blue,true)+
    text('A universe',45,139,700,80,61,'FFFFFF',true)+text('of detail.',45,218,600,80,61,'FFFFFF',true)+
    shape(50,344,430,2,'244564')+text('01',50,379,100,64,45,blue,true)+text('LOOK CLOSER',160,387,360,38,20,ice,true)+
    text('Discover a new perspective in every file.',50,475,510,55,20,'9EC4E8')+
    text('CARINA NEBULA / NASA, ESA, CSA, STScI',50,605,1000,22,11,'8DB6DC')+text('filens / 03',50,641,400,20,11,'6487AE'))
];
deck.file('ppt/media/aurora.jpg',aurora);
deck.file('ppt/media/aurora-portrait.jpg',await readFile(path.join(assets,'aurora-portrait.jpg')));
deck.file('ppt/media/nebula.jpg',await readFile(path.join(assets,'cosmic-cliffs-square.jpg')));
const types = await deck.file('[Content_Types].xml').async('string');
if (!types.includes('Extension="jpg"')) deck.file('[Content_Types].xml',types.replace('</Types>','<Default Extension="jpg" ContentType="image/jpeg"/></Types>'));
const slideRels=`<Relationships xmlns="${pack}"><Relationship Id="rId1" Type="${rel}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rIdAurora" Type="${rel}/image" Target="../media/aurora.jpg"/><Relationship Id="rIdAuroraPortrait" Type="${rel}/image" Target="../media/aurora-portrait.jpg"/><Relationship Id="rIdNebula" Type="${rel}/image" Target="../media/nebula.jpg"/></Relationships>`;
for (const [i,content] of slides.entries()) {
  deck.file(`ppt/slides/slide${i+1}.xml`,content);
  deck.file(`ppt/slides/_rels/slide${i+1}.xml.rels`,slideRels);
}
deck.file('docProps/core.xml',`<cp:coreProperties xmlns:cp="${ns}/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Beyond the Visible</dc:title><dc:creator>filens public samples</dc:creator><dc:description>Original editable sample; photographs credited in samples/SOURCES.md.</dc:description></cp:coreProperties>`);
await writeFile(path.join(samples,'filens-field-notes.pptx'),await zipBytes(deck));

// A magazine-style DOCX: real paragraphs, tables, image parts, and page breaks.
const doc = new JSZip();
doc.file('[Content_Types].xml',`<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
doc.file('_rels/.rels',`<Relationships xmlns="${pack}"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="word/document.xml"/></Relationships>`);
doc.file('word/_rels/document.xml.rels',`<Relationships xmlns="${pack}"><Relationship Id="rIdStyles" Type="${rel}/styles" Target="styles.xml"/><Relationship Id="rIdAurora" Type="${rel}/image" Target="media/aurora.jpg"/><Relationship Id="rIdNebula" Type="${rel}/image" Target="media/nebula.jpg"/></Relationships>`);
doc.file('word/media/aurora.jpg',await readFile(path.join(assets,'aurora-banner.jpg')));
doc.file('word/media/nebula.jpg',nebula);
const p = (value, style='Normal') => `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${xml(value)}</w:t></w:r></w:p>`;
const image = (rid,width,height,n) => `<w:p><w:pPr><w:spacing w:before="160" w:after="160"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${width*9525}" cy="${height*9525}"/><wp:docPr id="${n}" name="Photograph ${n}"/><a:graphic xmlns:a="${ns}/drawingml/2006/main"><a:graphicData uri="${ns}/drawingml/2006/picture"><pic:pic xmlns:pic="${ns}/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${n}" name="${rid}.jpg"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width*9525}" cy="${height*9525}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
function table(rows) {
  return `<w:tbl><w:tblPr><w:tblW w:w="10000" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="140" w:type="dxa"/><w:left w:w="160" w:type="dxa"/><w:bottom w:w="140" w:type="dxa"/><w:right w:w="160" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${rows[0].map(()=>'<w:gridCol w:w="2500"/>').join('')}</w:tblGrid>${rows.map((row,i)=>`<w:tr>${row.map(value=>`<w:tc><w:tcPr><w:shd w:fill="${i===0?navy:i%2?'EAF4FF':'F5F9FF'}"/></w:tcPr><w:p><w:r><w:rPr><w:color w:val="${i===0?'FFFFFF':navy}"/>${i===0?'<w:b/>':''}<w:sz w:val="20"/></w:rPr><w:t>${xml(value)}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
}
const pageBreak='<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
doc.file('word/styles.xml',`<w:styles xmlns:w="${ns}/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:color w:val="243D59"/><w:sz w:val="21"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="130" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:spacing w:before="160" w:after="160"/></w:pPr><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:b/><w:color w:val="${navy}"/><w:sz w:val="76"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Kicker"><w:name w:val="Kicker"/><w:rPr><w:b/><w:color w:val="0574CF"/><w:sz w:val="18"/><w:spacing w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:rPr><w:color w:val="58728F"/><w:sz w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="150"/></w:pPr><w:rPr><w:b/><w:color w:val="075AAB"/><w:sz w:val="31"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="Caption"/><w:rPr><w:color w:val="6E87A3"/><w:sz w:val="15"/></w:rPr></w:style></w:styles>`);
const body=p('FIELD NOTES / THE NIGHT ISSUE','Kicker')+p('Chasing the light','Title')+p('A field guide to the edge of night.','Subtitle')+
  image('rIdAurora',624,281,1)+p('Photograph: Carsten / CC BY 2.0. Cropped and color-graded in pale blue.','Caption')+
  p('Trip overview','Heading1')+p('Past the last village, the horizon opens into a quiet world of snow, sea and stars. Follow a fictional three-night expedition in search of a different perspective.')+
  table([['03 NIGHTS','66° NORTH','01 SHARED SKY'],['A slower journey','Fictional polar route','A little more wonder']])+
  p('All places, groups, dates, and figures in this guide are fictional.','Caption')+
  pageBreak+p('01 / PLAN THE NIGHT','Kicker')+p('Route and activities','Title')+
  table([['NIGHT','LOCATION','MOMENT','DETAIL'],['01','Lyra fjord','Blue hour','Scout the shoreline'],['02','Northlight ridge','After dark','Watch the horizon'],['03','Orion camp','Before dawn','Keep a field journal']])+
  p('Packing checklist','Heading1')+p('Warm layers · insulated boots · a headlamp with a red-light mode · spare batteries · a tripod · a reusable flask.')+
  p('Make room for the unexpected.','Heading1')+p('Arrive before dark, let your eyes adjust and give the sky time. The itinerary is a story for this public sample, not a live weather forecast or a real expedition plan.')+
  image('rIdAurora',624,281,2)+pageBreak+p('02 / LOOK BEYOND','Kicker')+p('A universe of detail','Title')+
  image('rIdNebula',624,351,3)+p('The Cosmic Cliffs, NGC 3324. Image: NASA, ESA, CSA, STScI.','Caption')+
  p('The sky is only the beginning.','Heading1')+p('Webb’s infrared view reveals the sculpted edge of a star-forming region in the Carina Nebula. Photography brings the distant into view; a good document gives every detail room to breathe.')+
  p('END OF FIELD GUIDE / FILENS PUBLIC SAMPLE','Kicker');
doc.file('word/document.xml',`<w:document xmlns:w="${ns}/wordprocessingml/2006/main" xmlns:r="${rel}" xmlns:wp="${ns}/drawingml/2006/wordprocessingDrawing"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="840" w:right="1440" w:bottom="840" w:left="1440" w:header="420" w:footer="420"/></w:sectPr></w:body></w:document>`);
await writeFile(path.join(samples,'filens-aurora-guide.docx'),await zipBytes(doc));

// A genuine workbook with compact visual data, formulas and three useful sheets.
const book=new JSZip();
const cell=(ref,value,style=0)=>typeof value==='number'?`<c r="${ref}" s="${style}"><v>${value}</v></c>`:`<c r="${ref}" t="inlineStr" s="${style}"><is><t>${xml(value)}</t></is></c>`;
const col=(i)=>String.fromCharCode(65+i);
const stations=[['Lyra Fjord','66.2° N','CLEAR',4.8,'▁▂▄▆█▆▄',92,'22:40','BLUE ARC'],['Orion Camp','68.1° N','CLEAR',5.2,'▂▃▅▇█▅▃',96,'23:10','CORONA'],['Vega Ridge','67.4° N','THIN CLOUD',4.1,'▁▂▃▅▆▄▂',78,'21:55','CURTAIN'],['Polaris Bay','69.0° N','CLEAR',5.6,'▂▄▅▆█▇▄',98,'00:20','RAYS'],['Altair Point','65.8° N','CLEAR',3.7,'▁▂▃▄▅▃▂',71,'22:05','LOW ARC'],['Nova Station','70.2° N','THIN CLOUD',4.9,'▂▃▄▇█▆▄',86,'23:35','FOLD']];
const dashboard=[['AURORA LAB','NIGHT / 03','OBSERVATORY','','','','',''],['PUBLIC SAMPLE','6 stations','FICTIONAL DATA','','','','',''],[],['STATION','LATITUDE','SKY', 'Kp INDEX','ACTIVITY','SCORE / 100','BEST WINDOW','FORMATION'],...stations,[],['SKY WATCH','▁▂▃▅▆█▇▄','21:00 → 01:00'],['STATUS','ALL SYSTEMS GO','NEXT / 00:45'],[],['METRIC','VALUE','UNIT'],['Observation time',240,'minutes'],['Exposure count',1260,'frames'],['Battery reserve',84,'percent'],['Cloud cover',12,'percent'],['Data captured',48.6,'GB'],[],['NOTE','Invented stations and observations. Not a live forecast.']];
const logs=[['TIME / UTC','STATION','EXPOSURE / s','FRAMES','TOTAL / s','SKY','NOTES'],...Array.from({length:36},(_,i)=>[`${String(20+Math.floor(i/12)).padStart(2,'0')}:${String((i%12)*5).padStart(2,'0')}`,stations[i%6][0],4+(i%5)*2,18+(i%6)*3,0,i%7?'CLEAR':'THIN CLOUD',i%4?'TRACKING':'PEAK ARC'])];
const planner=[['EXPOSURE PLAN','LENS / mm','APERTURE','ISO','SHUTTER / s','FRAMES','TOTAL / s'],['Wide horizon',14,'f/2.8',1600,8,45,360],['Curtain detail',24,'f/1.8',800,4,60,240],['Star field',20,'f/2.0',3200,12,40,480],['Blue hour',35,'f/4.0',200,1,30,30],[],['TOTAL TIME',0,'seconds'],[],['SCENARIO','EXPECTED RESULT'],['Fast movement','Shorter exposure'],['Faint structure','Higher sensitivity'],['Steady sky','Longer exposure'],[],['PUBLIC SAMPLE','Fictional planning data']];
const sheetNames=['Observatory','Night log','Exposure planner'];
const grids=[dashboard,logs,planner];
book.file('[Content_Types].xml',`<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${grids.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
book.file('_rels/.rels',`<Relationships xmlns="${pack}"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
book.file('xl/workbook.xml',`<workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${rel}"><sheets>${sheetNames.map((name,i)=>`<sheet name="${name}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`);
book.file('xl/_rels/workbook.xml.rels',`<Relationships xmlns="${pack}">${grids.map((_,i)=>`<Relationship Id="rId${i+1}" Type="${rel}/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rIdStyles" Type="${rel}/styles" Target="styles.xml"/></Relationships>`);
book.file('xl/styles.xml',`<styleSheet xmlns="${ns}/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Aptos"/><color rgb="FF17324D"/></font><font><b/><sz val="11"/><name val="Aptos"/><color rgb="FFFFFFFF"/></font><font><b/><sz val="18"/><name val="Aptos"/><color rgb="FF0574CF"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF07162E"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF4FF"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/></cellXfs></styleSheet>`);
for(const [s,rows] of grids.entries()){
 const data=rows.map((values,r)=>`<row r="${r+1}">${values.map((v,c)=>{
   const ref=`${col(c)}${r+1}`;
   if(s===1&&r>0&&c===4)return `<c r="${ref}"><f>C${r+1}*D${r+1}</f><v>${values[2]*values[3]}</v></c>`;
   if(s===2&&r===6&&c===1)return `<c r="${ref}"><f>SUM(G2:G5)</f><v>1110</v></c>`;
   return cell(ref,v,r===0?2:r===(s===0?3:0)?1:r%2?3:0);
 }).join('')}</row>`).join('');
 book.file(`xl/worksheets/sheet${s+1}.xml`,`<worksheet xmlns="${ns}/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="${s===0?4:1}" topLeftCell="A${s===0?5:2}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="23" customWidth="1"/><col min="2" max="8" width="19" customWidth="1"/></cols><sheetData>${data}</sheetData></worksheet>`);
}
await writeFile(path.join(samples,'filens-observatory.xlsx'),await zipBytes(book));

// Three native PDF pages with vector text and embedded JPEG XObjects.
const objects=[];
const add=(value)=>{objects.push(Buffer.isBuffer(value)?value:Buffer.from(value,'binary'));return objects.length;};
const stream=(data,extra='')=>Buffer.concat([Buffer.from(`<< /Length ${data.length} ${extra} >>\nstream\n`),data,Buffer.from('\nendstream')]);
const catalog=add('');const pages=add('');
const font=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
const bold=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
const image1=add(stream(aurora,'/Type /XObject /Subtype /Image /Width 1600 /Height 900 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode'));
const image2=add(stream(nebula,'/Type /XObject /Subtype /Image /Width 1600 /Height 900 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode'));
const pdfText=(s,x,y,size=16,color='1 1 1',b=false)=>`BT /${b?'F2':'F1'} ${size} Tf ${color} rg 1 0 0 1 ${x} ${y} Tm (${s.replace(/[()\\]/g,'\\$&')}) Tj ET\n`;
const pdfRect=(x,y,w,h,color)=>`q ${color} rg ${x} ${y} ${w} ${h} re f Q\n`;
const pdfImage=(name,x,y,w,h)=>`q ${w} 0 0 ${h} ${x} ${y} cm /${name} Do Q\n`;
const dark='0.027 0.086 0.18';const cyan='0.071 0.55 1';
const contents=[
 pdfImage('Aurora',0,0,960,540)+pdfRect(0,0,405,540,dark)+pdfText('THE NIGHT ISSUE / 01',40,491,11,cyan,true)+pdfText('BEYOND',36,337,68,'1 1 1',true)+pdfText('THE VISIBLE.',38,263,48,'1 1 1',true)+pdfRect(40,214,52,3,cyan)+pdfText('An atlas of extraordinary perspectives.',40,178,14,'0.65 0.8 0.96')+pdfText('POLAR SKIES / DEEP SPACE',40,57,10,'0.45 0.64 0.85')+pdfText('filens / public sample',40,28,9,'0.45 0.64 0.85'),
 pdfImage('Nebula',0,0,960,540)+pdfRect(0,0,960,140,dark)+pdfText('THE COSMIC CLIFFS',40,92,34,'1 1 1',true)+pdfText('An infrared view of a stellar nursery in the Carina Nebula.',42,53,15,'0.65 0.8 0.96')+pdfText('Image: NASA, ESA, CSA, STScI / 02',42,23,9,'0.45 0.64 0.85'),
 pdfRect(0,0,960,540,dark)+pdfText('FIELD NOTES / THE OBSERVATORY',40,491,11,cyan,true)+pdfText('Follow your curiosity.',38,397,45,'1 1 1',true)+pdfText('A fictional observation plan, made for a closer look.',40,352,17,'0.65 0.8 0.96')+
 [0,1,2].map((i)=>pdfRect(40+i*310,125,285,158,'0.045 0.14 0.28')+pdfText(['03','06','360'][i],60+i*310,208,49,cyan,true)+pdfText(['NIGHTS TO EXPLORE','FICTIONAL STATIONS','DEGREES OF WONDER'][i],60+i*310,159,12,'0.65 0.8 0.96',true)).join('')+pdfText('Photography: Carsten / CC BY 2.0 / cropped, pale-blue color grade',40,51,9,'0.45 0.64 0.85')+pdfText('All observation data and itinerary details are fictional. / 03',40,29,9,'0.45 0.64 0.85')
];
const pageIds=contents.map(content=>{
 const contentId=add(stream(Buffer.from(content,'binary')));
 return add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 960 540] /Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >> /XObject << /Aurora ${image1} 0 R /Nebula ${image2} 0 R >> >> /Contents ${contentId} 0 R >>`);
});
objects[catalog-1]=Buffer.from(`<< /Type /Catalog /Pages ${pages} 0 R >>`);
objects[pages-1]=Buffer.from(`<< /Type /Pages /Count 3 /Kids [${pageIds.map(id=>`${id} 0 R`).join(' ')}] >>`);
const chunks=[Buffer.from('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n','binary')];const offsets=[0];let offset=chunks[0].length;
for(const [i,object] of objects.entries()){
 const chunk=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),object,Buffer.from('\nendobj\n')]);offsets.push(offset);chunks.push(chunk);offset+=chunk.length;
}
chunks.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(v=>`${String(v).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root ${catalog} 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
await writeFile(path.join(samples,'filens-cosmic-atlas.pdf'),Buffer.concat(chunks));
console.log('Generated Beyond the Visible PPTX, Aurora DOCX, Observatory XLSX, and Cosmic Atlas PDF.');
