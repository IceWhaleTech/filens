// Run with the demo server running: node scripts/capture-homepage-demo.mjs
// Uses the actual filens previewers; no third-party product screenshots are copied.
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'apps/demo/public');
const output = path.join(publicDir, 'home');
const temp = await mkdtemp(path.join(os.tmpdir(), 'filens-home-'));
const origin = process.env.FILENS_DEMO_URL ?? 'http://127.0.0.1:4173/modules/filens/';
await mkdir(output, { recursive: true });

// Keep the captured previews and downloadable showcase files in sync.
await import('./generate-showcase-documents.mjs');

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
  await webp(path.join(publicDir, 'samples/showcase/aurora.jpg'), path.join(output, 'landscape.webp'), 900);
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
    ['pdf', 'pdf'],
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
  await videoPage.locator('.wb-preview-stage').getByText('Chasing the light', { exact: false }).first().waitFor();
  await chapter('文档，留在同一个预览台', 'Documents, in the same workspace');
  await videoPage.getByRole('button', { name: 'XLSX', exact: true }).click();
  await chapter('表格与工作表，轻松切换', 'Explore spreadsheets and worksheets');
  await videoPage.getByRole('button', { name: 'KEY', exact: true }).click();
  await videoPage.locator('.wb-preview-stage').getByText('BEYOND', { exact: false }).first().waitFor();
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
