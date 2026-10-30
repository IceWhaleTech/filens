// Run after capture-homepage-demo.mjs. Requires Playwright Chromium and FFmpeg.
// Add --overview-only to preserve the existing animated preview (no FFmpeg needed).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.join(root, 'apps/demo/public/home');
const output = path.join(root, 'docs/assets/readme');
const overviewOnly = process.argv.includes('--overview-only');
await mkdir(output, { recursive: true });
const previews = [
  ['PPTX', 'presentation', '#db6946', 'P'],
  ['DOCX', 'document', '#4277c6', 'W'],
  ['XLSX', 'spreadsheet', '#328460', 'X'],
  ['PDF', 'pdf', '#b96d60', 'F'],
  ['KEYNOTE', 'iwork', '#478dca', 'K'],
  ['CAD', 'cad', '#9173b8', 'D'],
  ['3D', 'model', '#8572b6', '3'],
  ['360°', 'panorama', '#ba8850', '°'],
  ['VIDEO', 'video', '#438575', '▶'],
  ['MUSIC', 'music', '#b46f89', '♪'],
  ['ARCHIVE', 'archive', '#ab8546', 'Z'],
  ['EBOOK', 'ebook', '#5b7ea7', 'E']
];
const assets = await Promise.all(previews.map(async ([label, file, color, icon]) => ({
  label, color, icon,
  src: `data:image/webp;base64,${(await readFile(path.join(input, `${file}.webp`))).toString('base64')}`
})));

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const overview = await page.evaluate(async (assets) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1680;
    canvas.height = 24 + Math.ceil(assets.length / 4) * 316;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f4f3ed';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const [index, asset] of assets.entries()) {
      const x = 24 + (index % 4) * 414;
      const y = 24 + Math.floor(index / 4) * 316;
      const image = new Image();
      image.src = asset.src;
      await image.decode();
      ctx.save();
      ctx.shadowColor = '#18352b15';
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 4;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.roundRect(x, y, 390, 292, 14);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = asset.color;
      ctx.beginPath();
      ctx.roundRect(x + 18, y + 14, 30, 32, 6);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(asset.icon, x + 33, y + 38);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#2e4538';
      ctx.font = '600 18px system-ui, sans-serif';
      ctx.fillText(asset.label, x + 60, y + 37);
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x + 10, y + 60, 370, 222, 8);
      ctx.clip();
      ctx.drawImage(image, x + 10, y + 60, 370, 222);
      ctx.restore();
    }
    return canvas.toDataURL('image/webp', 0.9).split(',')[1];
  }, assets);
  await writeFile(path.join(output, 'overview.webp'), Buffer.from(overview, 'base64'));
} finally {
  await browser.close();
}

// Speed up the actual recording for a small inline preview. The original MP4
// remains available for full-speed playback and captions.
if (!overviewOnly) {
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', path.join(input, 'filens-demo.mp4'),
    '-filter_complex', '[0:v]setpts=0.45*PTS,fps=5,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
    '-loop', '0', path.join(output, 'demo.gif')
  ], { stdio: 'inherit' });
}
console.log(overviewOnly ? 'Generated README overview.' : 'Generated README overview and animated preview.');
