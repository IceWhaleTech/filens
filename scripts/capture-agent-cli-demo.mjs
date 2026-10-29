// Actual CLI results, deterministic typing replay. Authoring tools only.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executableName } from './agent-platforms.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'docs/assets/agent-cli');
const work = path.join(root, 'dist/agent-demo');
const flag = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const language = flag('--lang') ?? 'all';
assert.ok(['all', 'en', 'zh-CN'].includes(language), '--lang must be all, en or zh-CN');
const binary = path.resolve(flag('--binary') ?? process.env.FILENS_AGENT_BINARY ?? path.join(root, 'dist', executableName(`${process.platform}-${process.arch}`)));
const posterOnly = process.argv.includes('--poster-only');
const fps = 12, duration = 48, width = 1280, height = 820;
await mkdir(work, { recursive: true });
await mkdir(output, { recursive: true });
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 32 << 20 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr + result.stdout.slice(0, 1000));
  return result.stdout;
}
function docx(zh) {
  const p = (text, heading = false) => `<w:p>${heading ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
  const words = zh ? ['极光项目发布简报', '本地读取，保留原文证据。', '里程碑', '状态', '原生 OCR', '已就绪'] : ['Aurora launch brief', 'Read locally. Keep the evidence.', 'Milestone', 'Status', 'Native OCR', 'Ready'];
  return zipSync({
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    'word/document.xml': strToU8(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${p(words[0], true)}${p(words[1])}<w:tbl>${[words.slice(2, 4), words.slice(4, 6)].map(row => `<w:tr>${row.map(cell => `<w:tc>${p(cell)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>${p(zh ? '预算：¥12,345.67' : 'Budget: ¥12,345.67')}</w:body></w:document>`),
  });
}
const browser = await chromium.launch({ headless: true });
try {
  for (const locale of language === 'all' ? ['en', 'zh-CN'] : [language]) {
    const zh = locale === 'zh-CN';
    const directory = path.join(work, locale);
    await mkdir(path.join(directory, 'notes'), { recursive: true });
    await mkdir(path.join(directory, 'files'), { recursive: true });
    await mkdir(path.join(directory, 'photos'), { recursive: true });
    await writeFile(path.join(directory, 'launch-brief.docx'), docx(zh));
    await copyFile(path.join(directory, 'launch-brief.docx'), path.join(directory, 'files/brief.docx'));
    await copyFile(path.join(directory, 'launch-brief.docx'), path.join(directory, 'files/brief-copy.docx'));
    await writeFile(path.join(directory, 'files/budget.txt'), 'A different document, not a duplicate.');
    await copyFile(path.join(output, zh ? 'prune-meeting.txt' : 'prune-meeting.en.txt'), path.join(directory, 'meeting-notes.txt'));
    await writeFile(path.join(directory, 'notes/budget.txt'), zh ? '预算不得超过12345.67元。\n风险：极小字体和严重模糊的扫描件可能漏字。\n' : 'The budget must not exceed 12345.67 CNY.\nRisk: tiny fonts and blurred scans may lose characters.\n');
    await writeFile(path.join(directory, 'notes/release.txt'), zh ? 'Windows 实机验证完成后才允许正式发布。' : 'A stable release requires testing on an actual Windows machine.');
    await writeFile(path.join(directory, 'notes/office.txt'), zh ? '茶水间每周三补充咖啡豆。' : 'Coffee beans are restocked every Wednesday.');
    const runs = [];
    function cli(intent) { const start = performance.now(); const stdout = run(binary, [intent], directory); runs.push({ intent, stdout, ms: Math.round(performance.now() - start) }); return stdout; }
    const page = await browser.newPage({ viewport: { width: 630, height: 720 }, deviceScaleFactor: 1 });
    const invoice = path.join(directory, 'invoice.png');
    const lines = zh ? ['星河科技采购单', '采购单 / 2026', '订单编号 FILENS2026', '客户：上海示例公司', '项目：本地文档读取与识别', '应付金额：12345.67 元', '交付日期：2026年10月29日', '无需 Python · 本地离线读取'] : ['AURORA PURCHASE ORDER', 'PURCHASE ORDER / 2026', 'Order ID: FILENS2026', 'Customer: Example Studio', 'Project: local document reading', 'Amount due: 12345.67 CNY', 'Delivery: October 29, 2026', 'No Python · Read locally, offline'];
    await page.setContent(`<meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;background:#fff;color:#192b37;font-family:"PingFang SC",Arial,sans-serif}article{padding:40px 43px}header{border-bottom:2px solid #142b3d;padding-bottom:23px;margin-bottom:24px}h1{margin:0;font-size:${zh ? 34 : 29}px;font-weight:600}small{display:block;color:#608783;font-size:13px;letter-spacing:2px;margin-top:10px}p{font-size:25px;margin:22px 0;line-height:1.5}.amount{border-top:1px solid #dce4df;border-bottom:1px solid #dce4df;padding:25px 0;margin:27px 0;font-size:29px;font-weight:600}.date{font-size:22px}.foot{font-size:16px;color:#648178;margin-top:31px}</style><article><header><h1>${lines[0]}</h1><small>${lines[1]}</small></header>${lines.slice(2).map((line, i) => `<p class="${i === 3 ? 'amount' : i === 4 ? 'date' : i === 5 ? 'foot' : ''}">${line}</p>`).join('')}</article>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: invoice });
    const photos = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 480;
      const c = canvas.getContext('2d');
      const sky = c.createLinearGradient(0, 0, 0, 480); sky.addColorStop(0, '#12354c'); sky.addColorStop(.57, '#7bb9ba'); sky.addColorStop(1, '#e7d2ac'); c.fillStyle = sky; c.fillRect(0, 0, 768, 480);
      c.fillStyle = '#f7edc9'; c.beginPath(); c.arc(556, 112, 39, 0, Math.PI * 2); c.fill();
      for (const [color, points] of [['#518b98', [[0, 317], [190, 128], [358, 297], [467, 215], [768, 345]]], ['#2a6579', [[0, 365], [174, 258], [320, 355], [595, 172], [768, 333]]], ['#153c52', [[0, 378], [220, 322], [394, 377], [628, 297], [768, 370]]]]) {
        c.fillStyle = color; c.beginPath(); c.moveTo(0, 480); for (const point of points) c.lineTo(...point); c.lineTo(768, 480); c.closePath(); c.fill();
      }
      c.fillStyle = '#92cac0'; c.beginPath(); c.moveTo(399, 360); c.bezierCurveTo(445, 405, 275, 400, 369, 480); c.lineTo(499, 480); c.bezierCurveTo(352, 405, 464, 420, 415, 360); c.fill();
      const small = document.createElement('canvas'); small.width = 384; small.height = 240; small.getContext('2d').drawImage(canvas, 0, 0, 384, 240);
      const other = document.createElement('canvas'); other.width = 384; other.height = 240;
      const o = other.getContext('2d'); o.fillStyle = '#f8e9d4'; o.fillRect(0, 0, 384, 240); o.fillStyle = '#cf6d35'; o.fillRect(35, 25, 120, 185); o.fillStyle = '#59412e'; o.beginPath(); o.arc(280, 155, 70, 0, Math.PI * 2); o.fill();
      return { 'aurora.png': canvas.toDataURL('image/png'), 'aurora-small.jpg': small.toDataURL('image/jpeg', .82), 'aurora.webp': canvas.toDataURL('image/webp', .8), 'different.png': other.toDataURL('image/png') };
    });
    for (const [name, url] of Object.entries(photos)) await writeFile(path.join(directory, 'photos', name), Buffer.from(url.split(',')[1], 'base64'));
    const intents = zh ? ['你能做什么？以 JSON 输出', '读取 "launch-brief.docx"，以 Markdown 输出', '总结 "meeting-notes.txt"，以纯文本输出', '总结 "meeting-notes.txt"，以 JSON 输出', '在 "notes" 中搜索 "预算 风险"，以 JSON 输出', '获取 "invoice.png" 的布局，以 JSON 输出', '获取 "invoice.png" 的布局，以 YAML 输出', '查找 "files" 中的重复文件，以 JSON 输出', '查找 "photos" 中的相似图片，以 JSON 输出'] : ['What can you do? as json', 'read "launch-brief.docx" as markdown', 'summarize "meeting-notes.txt" as text', 'summarize "meeting-notes.txt" as json', 'search "notes" for "budget risk" as json', 'get layout of "invoice.png" as json', 'get layout of "invoice.png" as yaml', 'find duplicate files in "files" as json', 'find similar images in "photos" as json'];
    const capacity = JSON.parse(cli(intents[0]));
    for (const operation of ['summarize', 'search', 'similar']) assert.ok(capacity.capacity.operations.some(o => o.name === operation), `Rebuild the CLI: missing ${operation}`);
    const markdown = cli(intents[1]);
    assert.match(markdown, zh ? /# 极光项目发布简报/ : /# Aurora launch brief/);
    const summaryText = cli(intents[2]);
    const summarized = JSON.parse(cli(intents[3]));
    assert.equal(summaryText.trimEnd(), summarized.content.text.trimEnd());
    assert.equal(summarized.content.summary.extractive, true);
    assert.equal(summarized.content.summary.sourceComplete, true);
    assert.match(summaryText, /12345.67/);
    const searched = JSON.parse(cli(intents[4]));
    assert.equal(searched.search.complete, true);
    assert.equal(searched.search.semantic, false);
    assert.equal(searched.search.matchedFiles, 1);
    const hit = searched.search.results[0];
    const document = JSON.parse(cli(intents[5]));
    const yaml = cli(intents[6]);
    const duplicates = JSON.parse(cli(intents[7])).similarity;
    const similar = JSON.parse(cli(intents[8])).similarity;
    assert.equal(duplicates.complete, true); assert.equal(duplicates.matchedGroups, 1);
    assert.equal(duplicates.groups[0].files.length, 2);
    assert.match(duplicates.groups[0].sha256, /^[0-9a-f]{64}$/);
    assert.equal(similar.complete, true); assert.equal(similar.matchedGroups, 1);
    assert.equal(similar.groups[0].files.length, 3);
    assert.ok(similar.groups[0].files.every(f => f.distanceToReference <= similar.threshold && f.path !== 'different.png'));
    assert.match(document.content.text, /FILENS2026/);
    assert.match(document.content.text, /12345.67/);
    const layout = document.content.layout;
    const boxes = layout.blocks.filter(b => b.bounds);
    const focusIndex = boxes.findIndex(b => Buffer.from(document.content.text).subarray(b.startByte, b.endByte).toString().includes('12345.67'));
    assert.ok(focusIndex >= 0);
    const b = boxes[0];
    const excerpt = `{\n  "version": "${layout.version}",\n  "pages": [${JSON.stringify(layout.pages[0])}],\n  "blocks": [{\n    "id": "${b.id}", "kind": "${b.kind}",\n    "bounds": ${JSON.stringify(b.bounds)},\n    "coordinateSpace": "${b.coordinateSpace}",\n    "detectionScore": ${b.detectionScore}\n  }]\n}`;
    const yamlStart = yaml.indexOf('  layout:\n'); assert.ok(yamlStart >= 0);
    const command = index => `filens '${intents[index]}'`;
    const searchExcerpt = JSON.stringify({ method: searched.search.method, matchedFiles: searched.search.matchedFiles, results: [{ path: path.relative(directory, hit.path), excerpts: [{ startLine: hit.excerpts[0].startLine, text: hit.excerpts[0].text.trimEnd() }] }] }, null, 2);
    const data = { locale, inputCount: capacity.capacity.formats.length, imageWidth: 630, imageHeight: 720,
      image: 'data:image/png;base64,' + (await readFile(invoice)).toString('base64'), boxes, focusIndex,
      summary: summarized.content.summary, search: searched.search, duplicates, similar,
      photos: similar.groups[0].files.map(f => ({ ...f, image: photos[f.path] })),
      capacity: { command: command(0), excerpt: `{\n  "outputFormats": [\n    "text", "json", "markdown", "html",\n    "yaml", "xml", "csv", "tsv"\n  ],\n  "ocr": {\n    "provider": "${capacity.capacity.ocr.provider}",\n    "available": ${capacity.capacity.ocr.available},\n    "maxSideLen": ${capacity.capacity.ocr.maxSideLen},\n    "openmpThreads": ${capacity.capacity.ocr.openmpThreads}\n  }\n}` },
      markdown: { command: command(1), output: markdown },
      pruning: { command: command(2), output: summaryText },
      retrieval: { command: command(4), output: searchExcerpt },
      layout: { command: command(5), excerpt, version: layout.version, pages: layout.pages },
      yaml: { command: command(6), excerpt: yaml.slice(yamlStart).split('\n').slice(0, 15).map(s => s.startsWith('  ') ? s.slice(2) : s).join('\n') },
      duplicateScan: { command: command(7), output: JSON.stringify({ method: duplicates.method, matchedGroups: duplicates.matchedGroups, sha256: duplicates.groups[0].sha256, files: duplicates.groups[0].files.map(f => f.path) }, null, 2) },
      imageScan: { command: command(8), output: `{\n  "method": "${similar.method}",\n  "threshold": ${similar.threshold},\n  "matchedGroups": ${similar.matchedGroups},\n  "files": [\n${similar.groups[0].files.map(f => `    ${JSON.stringify({ path: f.path, distanceToReference: f.distanceToReference })}`).join(',\n')}\n  ]\n}` },
    };
    await writeFile(path.join(directory, 'responses.json'), JSON.stringify({ runs, data: { ...data, image: undefined } }, null, 2) + '\n');
    await page.setViewportSize({ width, height });
    await page.addInitScript(value => { window.DEMO = value; }, data);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('file://' + path.join(root, 'scripts/agent-cli-demo.html'));
    await page.evaluate(() => document.fonts.ready);
    const sceneEnds = await page.evaluate(() => window.demoStages.map(s => s.end - 100));
    for (const timestamp of sceneEnds) {
      await page.evaluate(t => window.renderAt(t), timestamp);
      const fits = await page.evaluate(() => { const o = document.querySelector('#output'); return o.scrollHeight <= o.clientHeight; });
      assert.ok(fits, `${locale}: output clipped at ${timestamp}`);
      const sideFits = await page.evaluate(() => {
        const card = document.querySelector('.summary-card,.search-card,.cap-visual,.preview-doc,.duplicate-card,.images-card');
        return !card || card.getBoundingClientRect().bottom <= document.querySelector('#right').getBoundingClientRect().bottom;
      });
      assert.ok(sideFits, `${locale}: side panel clipped at ${timestamp}`);
      await page.screenshot({ path: path.join(directory, `scene-${timestamp}.png`) });
    }
    assert.deepEqual(errors, []);
    const stem = zh ? 'terminal-demo.zh-CN' : 'terminal-demo';
    await page.evaluate(() => window.renderAt(6500));
    await page.screenshot({ path: path.join(output, `${stem}.png`) });
    if (!posterOnly) {
      const frames = await mkdtemp(path.join(os.tmpdir(), 'filens-cli-demo-'));
      try {
        const count = Math.ceil(fps * duration);
        for (let i = 0; i < count; i++) {
          await page.evaluate(t => window.renderAt(t), i / fps * 1000);
          await page.screenshot({ path: path.join(frames, `frame-${String(i).padStart(4, '0')}.png`) });
          if (i % 84 === 0) console.log(`${locale}: captured ${i}/${count} frames`);
        }
        const pattern = path.join(frames, 'frame-%04d.png'), palette = path.join(frames, 'palette.png');
        run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(fps), '-i', pattern, '-vf', 'palettegen=max_colors=128:stats_mode=diff', palette]);
        const gif = path.join(output, `${stem}.gif`);
        run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(fps), '-i', pattern, '-i', palette, '-lavfi', 'paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle', '-gifflags', '+transdiff', '-loop', '0', gif]);
        const bytes = await readFile(gif);
        await writeFile(path.join(directory, 'receipt.json'), JSON.stringify({ createdAt: new Date().toISOString(), locale, width, height, duration, fps, frames: count, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), requests: runs.map(({ intent, ms }) => ({ intent, ms })), notes: 'Actual CLI responses; excerpts shown, search paths shortened. Typing/response timing edited. Original text pruning, lexical retrieval, source-aligned OCR, SHA-256 duplicates and perceptual image grouping; no embedding or generated reasoning. Image distances are not confidence percentages.' }, null, 2) + '\n');
        console.log(`Created ${stem}.gif (${(bytes.length / 1048576).toFixed(2)} MiB, ${duration}s).`);
      } finally { await rm(frames, { recursive: true, force: true }); }
    }
    await page.close();
  }
} finally { await browser.close(); }
