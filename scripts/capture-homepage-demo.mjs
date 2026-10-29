// Run with the demo server running: node scripts/capture-homepage-demo.mjs
// Add --model-only to refresh the model capture and full walkthrough while
// preserving the other preview captures and their authored sample documents.
// Add --reuse-samples to refresh all captures without regenerating sample files.
// Uses the actual filens previewers; no third-party product screenshots are copied.
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'apps/demo/public');
const output = path.join(publicDir, 'home');
const temp = await mkdtemp(path.join(os.tmpdir(), 'filens-home-'));
const origin = process.env.FILENS_DEMO_URL ?? 'http://127.0.0.1:4173/modules/filens/';
const modelOnly = process.argv.includes('--model-only');
const reuseSamples = process.argv.includes('--reuse-samples');
await mkdir(output, { recursive: true });

// Keep the captured previews and downloadable showcase files in sync.
if (!reuseSamples) {
  await import('./generate-showcase-helmet.mjs');
  if (!modelOnly) await import('./generate-showcase-documents.mjs');
}

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
  if (!modelOnly) await webp(path.join(publicDir, 'samples/showcase/aurora.jpg'), path.join(output, 'landscape.webp'), 900);
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
    if (modelOnly && name !== 'model') continue;
    await page.goto(`${origin}?view=preview&format=${format}`);
    await page.locator('.pptxv-shell').first().waitFor();
    await page.locator('.wb-runtime-timings').waitFor({ timeout: 30000 });
    if (name === 'iwork' || name === 'cad') {
      await page.locator('.pptxv-shell').first().press('0');
      await page.locator('.pptxv-shell').first().evaluate(element => element.blur());
    }
    if (name === 'model') {
      const model = page.locator('canvas.model3dv-canvas');
      await model.waitFor();
      await model.hover();
      for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -100);
      await page.mouse.move(20, 20);
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
  const rawRecordingStart = Date.now();
  let recordingStart = rawRecordingStart;
  async function chapter(zh, en, duration = 3300, action) {
    chapters.push({ start: (Date.now() - recordingStart) / 1000, zh, en });
    const startedAt = Date.now();
    if (action) await action();
    await videoPage.waitForTimeout(Math.max(0, duration - (Date.now() - startedAt)));
  }
  await videoPage.goto(`${origin}?view=preview&format=showcase`);
  await videoPage.locator('.pptxv-slide-stage').first().waitFor();
  await videoPage.locator('.wb-runtime-timings').waitFor();
  recordingStart = Date.now();
  const trimStart = (recordingStart - rawRecordingStart) / 1000;
  await chapter('全新预览台，让文件内容成为主角', 'A fresh workspace. Your files take center stage.');
  await videoPage.getByRole('button', { name: '显示工具栏', exact: true }).click();
  await videoPage.locator('.pptxv-shell').first().press('PageDown');
  await chapter('展开工具栏，翻页、缩放，探索细节', 'Open the toolbar. Turn a page. Explore the details.');
  await videoPage.getByRole('button', { name: '隐藏工具栏', exact: true }).click();
  const search = videoPage.getByRole('searchbox', { name: '搜索文件格式' });
  await search.pressSequentially('docx', { delay: 140 });
  await videoPage.waitForTimeout(700);
  await videoPage.getByRole('button', { name: 'DOCX', exact: true }).click();
  await videoPage.locator('.wb-preview-stage').getByText('Chasing the light', { exact: false }).first().waitFor();
  await chapter('搜索格式，快速找到想看的文档', 'Search a format. Find your next document.');
  await videoPage.getByRole('button', { name: '收起格式面板', exact: true }).click();
  await chapter('收起侧栏，给阅读更多空间', 'Hide the sidebar. Make room for reading.', 2800);
  await videoPage.getByRole('button', { name: '展开格式面板', exact: true }).click();
  await videoPage.getByRole('button', { name: 'XLSX', exact: true }).click();
  await videoPage.locator('.wb-preview-stage').getByText('AURORA LAB', { exact: false }).first().waitFor();
  await videoPage.getByRole('button', { name: 'Night log', exact: true }).click();
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
  await videoPage.getByRole('button', { name: 'OBJ', exact: true }).click();
  const model = videoPage.locator('canvas.model3dv-canvas');
  await model.waitFor();
  await videoPage.locator('.wb-runtime-timings').waitFor();
  const modelPosterTime = (Date.now() - recordingStart) / 1000 + 4.3;
  await chapter('维京牛角头盔，旋转查看每一处细节', 'Orbit a Viking helmet. Explore every detail.', 5800, async () => {
    await model.hover();
    for (let i = 0; i < 4; i++) await videoPage.mouse.wheel(0, -100);
    await videoPage.waitForTimeout(500);
    const bounds = await model.boundingBox();
    if (!bounds) throw new Error('The helmet canvas is unavailable for recording.');
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    await videoPage.mouse.move(x - 90, y);
    await videoPage.mouse.down();
    await videoPage.mouse.move(x + 90, y - 16, { steps: 70 });
    await videoPage.mouse.up();
    await videoPage.waitForTimeout(350);
    await videoPage.mouse.down();
    await videoPage.mouse.move(x - 10, y - 8, { steps: 50 });
    await videoPage.mouse.up();
    await videoPage.mouse.move(20, 20);
  });
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
  await videoPage.getByLabel('导入文件', { exact: true }).setInputFiles(path.join(publicDir, 'samples/filens-aurora-guide.docx'));
  await videoPage.locator('.wb-preview-stage').getByText('Chasing the light', { exact: false }).first().waitFor();
  await chapter('导入自己的文件，在浏览器里安心打开', 'Bring your own files. Open them locally in your browser.', 3800);
  const duration = (Date.now() - recordingStart) / 1000;
  const recording = videoPage.video();
  await videoContext.close();
  ffmpeg([
    '-ss',
    trimStart.toFixed(3),
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
  ffmpeg(['-ss', modelPosterTime.toFixed(3), '-i', path.join(output, 'filens-demo.mp4'), '-frames:v', '1', poster]);
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
  // A fresh recording must get fresh media URLs, even when its filename stays
  // the same. Keep the video, poster, and chapter captions on one version.
  const version = createHash('sha256').update(await readFile(path.join(output, 'filens-demo.mp4'))).digest('hex').slice(0, 12);
  await writeFile(path.join(root, 'apps/demo/src/home-media.json'), `${JSON.stringify({ version }, null, 2)}\n`);
  console.log(`Recording version: ${version}`);
  console.log(`Recorded ${duration.toFixed(1)} seconds. Assets: ${output}`);
} finally {
  await browser.close();
}
