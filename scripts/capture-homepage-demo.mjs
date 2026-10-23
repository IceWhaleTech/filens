// Run with the demo server running: node scripts/capture-homepage-demo.mjs
// Uses the actual filens previewers; no third-party product screenshots are copied.
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'apps/demo/public');
const output = path.join(publicDir, 'home');
const temp = await mkdtemp(path.join(os.tmpdir(), 'filens-home-'));
const origin = process.env.FILENS_DEMO_URL ?? 'http://127.0.0.1:4173/modules/filens/';
await mkdir(output, { recursive: true });

const emu = (n) => Math.round(n * 7620);
const xml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
let shapeId = 1;
function rect(x, y, width, height, color) {
  const id = ++shapeId;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(width)}" cy="${emu(height)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
}
function text(value, x, y, width, height, size, color, bold = false) {
  const id = ++shapeId;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(width)}" cy="${emu(height)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0"/><a:lstStyle/><a:p><a:pPr><a:lnSpc><a:spcPct val="100000"/></a:lnSpc></a:pPr><a:r><a:rPr lang="en-US" sz="${Math.round(size * 75)}" b="${bold ? 1 : 0}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>${xml(value)}</a:t></a:r><a:endParaRPr/></a:p></p:txBody></p:sp>`;
}
function photo(x, y, width, height) {
  const id = ++shapeId;
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Alpine lake photograph"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdPhoto"/><a:srcRect l="14000" r="14000"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(width)}" cy="${emu(height)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}
function slide(content, background) {
  return `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${background}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${content}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}
const deck = await JSZip.loadAsync(await readFile(path.join(publicDir, 'samples/sample-deck.pptx')));
const emptyShapeTree =
  '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>';
for (const name of ['ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml']) {
  const original = await deck.file(name).async('string');
  deck.file(name, original.replace(/<p:spTree>[\s\S]*?<\/p:spTree>/, emptyShapeTree));
}
deck.file('ppt/media/alpine-lake.jpg', await readFile(path.join(publicDir, 'samples/photo-alpine-lake.jpg')));
deck.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>Field Notes — fictional public sample</dc:title>
  <dc:creator>filens samples</dc:creator>
  <dc:description>A fictional outdoor journal. No company, personnel, or business data.</dc:description>
</cp:coreProperties>`);
const contentTypes = await deck.file('[Content_Types].xml').async('string');
deck.file(
  '[Content_Types].xml',
  contentTypes.replace('</Types>', '<Default Extension="jpg" ContentType="image/jpeg"/></Types>')
);
const relationship = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rIdPhoto" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/alpine-lake.jpg"/></Relationships>`;
const slides = [
  slide(
    photo(454, 0, 746, 675) +
      text('THE EVERYDAY EXPLORER / VOL. 01', 48, 47, 370, 24, 13, 'C8E7A1') +
      text('FIELD', 43, 170, 420, 100, 88, 'F4F5E9', true) +
      text('NOTES.', 43, 265, 420, 110, 88, 'F4F5E9', true) +
      rect(48, 400, 50, 3, 'C8E7A1') +
      text('A little closer to the outside.', 48, 427, 370, 35, 18, 'C6D1BB') +
      text('FIND A DIFFERENT PERSPECTIVE.', 48, 595, 370, 25, 11, 'C8E7A1') +
      text('filens / 01', 48, 625, 370, 20, 11, '95AD87'),
    '2F4634'
  ),
  slide(
    text('A little perspective.', 50, 45, 1080, 75, 56, '304A32', true) +
      photo(50, 150, 610, 460) +
      text('SLOW DOWN.', 720, 190, 430, 25, 14, '8B9D75') +
      text('Look a little closer.', 720, 235, 430, 45, 31, '304A32', true) +
      text('Good things are waiting outside.', 720, 310, 430, 40, 18, '78826C') +
      text('A trail. A lake. A new point of view.', 720, 350, 430, 40, 18, '78826C') +
      rect(720, 450, 350, 2, 'D9E0CE') +
      text('MORE TO SEE. MORE TO DISCOVER.', 720, 480, 430, 25, 12, '8B9D75') +
      text('FIELD NOTES / 02', 50, 636, 500, 20, 11, '8B9D75'),
    'F5F6ED'
  ),
  slide(
    text('Room to explore.', 50, 45, 1100, 80, 56, '304A32', true) +
      text('A SAMPLE JOURNEY / SMALL MOMENTS, DIFFERENT VIEWS', 50, 140, 1100, 30, 14, '879873') +
      rect(60, 240, 320, 330, 'E3EBD7') +
      rect(440, 240, 320, 330, 'EBDCCB') +
      rect(820, 240, 320, 330, 'DFE6D9') +
      text('03', 85, 270, 270, 110, 85, '496A40', true) +
      text('routes to wander', 85, 440, 270, 40, 22, '496A40') +
      text('12', 465, 270, 270, 110, 85, 'A9744F', true) +
      text('moments to keep', 465, 440, 270, 40, 22, 'A9744F') +
      text('01', 845, 270, 270, 110, 85, '496A40', true) +
      text('fresh perspective', 845, 440, 270, 40, 22, '496A40') +
      text('FIELD NOTES / 03', 50, 636, 500, 20, 11, '8B9D75'),
    'F5F6ED'
  )
];
for (const [index, content] of slides.entries()) {
  deck.file(`ppt/slides/slide${index + 1}.xml`, content);
  deck.file(`ppt/slides/_rels/slide${index + 1}.xml.rels`, relationship);
}
await writeFile(
  path.join(publicDir, 'samples/filens-field-notes.pptx'),
  await deck.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
);
console.log('Generated Field Notes sample deck.');

const ffmpeg = (args) =>
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const browser = await chromium.launch();
try {
  const imagePage = await browser.newPage();
  async function webp(input, target, width, height) {
    const data = await imagePage.evaluate(
      async ({ source, width, height }) => {
        const image = new Image();
        image.src = source;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height ?? Math.round((width * image.height) / image.width);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#e8ece3';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const ratio = Math.min(canvas.width / image.width, canvas.height / image.height);
        ctx.drawImage(
          image,
          (canvas.width - image.width * ratio) / 2,
          (canvas.height - image.height * ratio) / 2,
          image.width * ratio,
          image.height * ratio
        );
        return canvas.toDataURL('image/webp', 0.86).split(',')[1];
      },
      {
        source: `data:image/${input.endsWith('.jpg') ? 'jpeg' : 'png'};base64,${(await readFile(input)).toString('base64')}`,
        width,
        height
      }
    );
    await writeFile(target, Buffer.from(data, 'base64'));
  }
  await webp(path.join(publicDir, 'samples/photo-alpine-lake.jpg'), path.join(output, 'landscape.webp'), 900);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
    deviceScaleFactor: 1
  });
  const page = await context.newPage();
  const captures = [
    ['presentation', 'showcase'],
    ['document', 'docx'],
    ['spreadsheet', 'xlsx'],
    ['iwork', 'key'],
    ['cad', 'dxf'],
    ['panorama', 'pano'],
    ['model', 'obj']
  ];
  for (const [name, format] of captures) {
    await page.goto(`${origin}?view=preview&format=${format}`);
    await page.locator('.pptxv-shell').first().waitFor();
    await page.locator('.wb-runtime-timings').waitFor({ timeout: 30000 });
    if (name === 'iwork' || name === 'cad') {
      await page.locator('.pptxv-shell').first().press('0');
      await page.locator('.pptxv-shell').first().evaluate(element => element.blur());
    }
    await page.waitForTimeout(name === 'panorama' || name === 'model' ? 1500 : 700);
    const imagePath = path.join(temp, `${name}.png`);
    await page.locator('.wb-preview-stage').screenshot({ path: imagePath });
    await webp(imagePath, path.join(output, `${name}.webp`), 1120, 680);
    console.log(`Captured ${name}.`);
  }
  await context.close();

  const videoContext = await browser.newContext({
    viewport: { width: 1440, height: 810 },
    reducedMotion: 'reduce',
    recordVideo: { dir: temp, size: { width: 1440, height: 810 } }
  });
  const videoPage = await videoContext.newPage();
  const chapters = [];
  const recordingStart = Date.now();
  async function chapter(zh, en, duration = 3300) {
    chapters.push({ start: (Date.now() - recordingStart) / 1000, zh, en });
    await videoPage.waitForTimeout(duration);
  }
  await videoPage.goto(`${origin}?view=preview&format=showcase`);
  await videoPage.locator('.pptxv-slide-stage').first().waitFor();
  await chapter('直接预览演示文稿', 'Open a presentation directly');
  await videoPage.locator('.pptxv-shell').first().press('PageDown');
  await chapter('翻页、缩放，探索每一页', 'Turn the page. Explore the details.');
  await videoPage.getByRole('button', { name: 'DOCX', exact: true }).click();
  await videoPage.locator('.wb-preview-stage').getByText('Trip overview', { exact: false }).first().waitFor();
  await chapter('文档，留在同一个预览台', 'Documents, in the same workspace');
  await videoPage.getByRole('button', { name: 'XLSX', exact: true }).click();
  await chapter('表格与工作表，轻松切换', 'Explore spreadsheets and worksheets');
  await videoPage.getByRole('button', { name: 'KEY', exact: true }).click();
  await videoPage.locator('.wb-preview-stage').getByText('A weekend', { exact: false }).first().waitFor();
  await videoPage.locator('.pptxv-shell').first().press('0');
  await chapter('Keynote，也可以在浏览器打开', 'Keynote, right in your browser');
  await videoPage.getByRole('button', { name: 'Design', exact: true }).click();
  await videoPage.getByRole('button', { name: 'DXF', exact: true }).click();
  await videoPage.locator('.cadv-canvas').waitFor();
  await videoPage.locator('.pptxv-shell').first().press('0');
  await chapter('从办公文档，到 CAD 图纸', 'From everyday documents to CAD drawings');
  await videoPage.getByRole('button', { name: 'Media', exact: true }).click();
  await videoPage.getByRole('button', { name: 'PANO', exact: true }).click();
  await videoPage.waitForTimeout(1000);
  const canvas = videoPage.locator('.wb-preview-stage canvas').first();
  const box = await canvas.boundingBox();
  if (box) {
    await videoPage.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5);
    await videoPage.mouse.down();
    await videoPage.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.5, { steps: 45 });
    await videoPage.mouse.up();
  }
  await chapter('360° 全景，换个角度看世界', 'Look around. Discover a 360° view.', 4000);
  const duration = (Date.now() - recordingStart) / 1000;
  const recording = videoPage.video();
  await videoContext.close();
  ffmpeg([
    '-i',
    await recording.path(),
    '-vf',
    'scale=1280:720',
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '26',
    '-pix_fmt',
    'yuv420p',
    '-an',
    '-movflags',
    '+faststart',
    path.join(output, 'filens-demo.mp4')
  ]);
  const poster = path.join(temp, 'poster.png');
  ffmpeg(['-ss', '2', '-i', path.join(output, 'filens-demo.mp4'), '-frames:v', '1', poster]);
  await webp(poster, path.join(output, 'demo-poster.webp'), 1280, 720);
  const timestamp = (seconds) => new Date(seconds * 1000).toISOString().slice(11, 23);
  for (const lang of ['zh', 'en']) {
    await writeFile(
      path.join(output, `demo-${lang}.vtt`),
      'WEBVTT\n\n' +
        chapters
          .map(
            (item, index) =>
              `${timestamp(item.start)} --> ${timestamp(chapters[index + 1]?.start ?? duration)}\n${item[lang]}\n`
          )
          .join('\n')
    );
  }
  console.log(`Recorded ${duration.toFixed(1)} seconds. Assets: ${output}`);
} finally {
  await browser.close();
}
