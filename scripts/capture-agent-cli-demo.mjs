// Actual CLI results, deterministic typing replay. Authoring tools only.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
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
const previewAssets = path.resolve(flag('--preview-assets') ?? process.env.FILENS_PREVIEW_DIR ?? path.join(root, 'dist/preview'));
const fps = 12, width = 1280, height = 820;
await mkdir(work, { recursive: true });
await mkdir(output, { recursive: true });
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, env: { ...process.env, FILENS_PREVIEW_DIR: previewAssets }, encoding: 'utf8', timeout: 120000, maxBuffer: 32 << 20 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr + result.stdout.slice(0, 1000));
  return result.stdout;
}
function docx(zh, contract = false) {
  const p = (text, heading = false) => `<w:p>${heading ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
  const words = contract
    ? zh ? ['极光项目采购合同', '预算上限：12345.67 元。风险：交付延期需审批。', '条款', '要求', '新增支出', '事先审批'] : ['Aurora purchase agreement', 'Budget limit: 12345.67 CNY. Risk: late delivery needs approval.', 'Clause', 'Requirement', 'Extra spending', 'Prior approval']
    : zh ? ['极光项目发布简报', '本地读取，保留原文证据。', '里程碑', '状态', '原生 OCR', '已就绪'] : ['Aurora launch brief', 'Read locally. Keep the evidence.', 'Milestone', 'Status', 'Native OCR', 'Ready'];
  return zipSync({
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    'word/document.xml': strToU8(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${p(words[0], true)}${p(words[1])}<w:tbl>${[words.slice(2, 4), words.slice(4, 6)].map(row => `<w:tr>${row.map(cell => `<w:tc>${p(cell)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>${p(zh ? '预算：¥12,345.67' : 'Budget: ¥12,345.67')}</w:body></w:document>`),
  });
}
const browser = await chromium.launch({ headless: true });
async function capturePreview(args, directory, stem, runs, { orbit = false, expectedCells } = {}) {
  const started = performance.now();
  const child = spawn(binary, args, { cwd: directory, env: { ...process.env, FILENS_PREVIEW_DIR: previewAssets } });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const closed = new Promise(resolve => child.once('close', resolve));
  const page = await browser.newPage({ viewport: { width: orbit ? 800 : 520, height: 600 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const stdout = await new Promise((resolve, reject) => {
      const lines = createInterface({ input: child.stdout });
      const timer = setTimeout(() => { child.kill(); reject(new Error(`Preview startup timed out: ${stderr}`)); }, 10000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Preview exited ${code}: ${stderr}`)); });
      lines.once('line', line => { clearTimeout(timer); lines.close(); resolve(line); });
    });
    const response = JSON.parse(stdout);
    assert.equal(response.ok, true);
    runs.push({ intent: args.join(' '), args, stdout, ms: Math.round(performance.now() - started) });
    const origin = new URL(response.url).origin;
    await page.route('**/*', route => {
      const url = route.request().url();
      if (!url.startsWith(`${origin}/`) && !url.startsWith('blob:') && !url.startsWith('data:')) {
        errors.push(`External preview request: ${url}`);
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(response.url);
    await page.waitForFunction(() => ['ready', 'error'].includes(document.body.dataset.state), null, { timeout: 30000 });
    assert.equal(await page.evaluate(() => document.body.dataset.state), 'ready', await page.locator('body').innerText());
    if (expectedCells) assert.deepEqual(await page.locator('.xlsxv-cell').allTextContents(), expectedCells);
    const target = page.locator(orbit ? '.model3dv-preview' : '.xlsxv-preview');
    await target.waitFor();
    const frames = [], captures = [];
    const count = orbit ? 60 : 1;
    if (orbit) {
      const box = await target.boundingBox();
      assert.ok(box);
      await page.mouse.move(box.x + box.width * .36, box.y + box.height * .5);
      await page.mouse.down();
    }
    for (let index = 0; index < count; index++) {
      if (orbit) {
        const box = await target.boundingBox();
        await page.mouse.move(box.x + box.width * (.36 + .55 * index / (count - 1)), box.y + box.height * (.5 - .06 * Math.sin(index / count * Math.PI)));
      }
      await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      const file = `${stem}-${String(index).padStart(3, '0')}.png`;
      const box = await target.boundingBox();
      const table = orbit ? null : await page.locator('.xlsxv-table').boundingBox();
      const image = table
        ? await page.screenshot({ path: path.join(directory, file), clip: { x: box.x, y: box.y, width: box.width, height: table.y + table.height - box.y } })
        : await target.screenshot({ path: path.join(directory, file) });
      frames.push(`data:image/png;base64,${image.toString('base64')}`);
      captures.push({ file, sha256: createHash('sha256').update(image).digest('hex') });
    }
    if (orbit) {
      await page.mouse.up();
      assert.ok(new Set(captures.map(capture => capture.sha256)).size > 10, 'The model must actually rotate.');
    }
    assert.deepEqual(errors, []);
    return { command: `filens ${args.join(' ')}`, name: response.source.name, origin, output: JSON.stringify({ ...response, url: response.url.replace(/\/[0-9a-f]{32}\//, '/…/') }, null, 2), frames, captures };
  } finally {
    await page.close();
    child.kill('SIGTERM');
    await closed;
  }
}
try {
  for (const locale of language === 'all' ? ['en', 'zh-CN'] : [language]) {
    const zh = locale === 'zh-CN';
    const directory = path.join(work, locale);
    await mkdir(path.join(directory, 'files'), { recursive: true });
    await mkdir(path.join(directory, 'photos'), { recursive: true });
    await writeFile(path.join(directory, 'launch-brief.docx'), docx(zh));
    await copyFile(path.join(directory, 'launch-brief.docx'), path.join(directory, 'files/brief.docx'));
    await copyFile(path.join(directory, 'launch-brief.docx'), path.join(directory, 'files/brief-copy.docx'));
    await writeFile(path.join(directory, 'files/budget.txt'), 'A different document, not a duplicate.');
    await copyFile(path.join(output, zh ? 'prune-meeting.txt' : 'prune-meeting.en.txt'), path.join(directory, 'meeting-notes.txt'));
    await writeFile(path.join(directory, 'documents.zip'), zipSync({
      'attachments.zip': zipSync({ 'contract.docx': docx(zh, true) }),
      'readme.txt': strToU8(zh ? '示例采购资料；所有内容均为虚构。' : 'Fictional purchase documents for this demo.')
    }));
    const budgetRows = zh
      ? ['项目,数量,单价,小计', '相机租赁,3,1200,3600', '交通,4,600,2400', '住宿,3,900,2700', '电池,6,120,720', '存储卡,4,180,720', '餐饮,3,350,1050', '保险,1,1155.67,1155.67', '总预算,,,12345.67']
      : ['Item,Quantity,Unit cost,Subtotal', 'Camera rental,3,1200,3600', 'Travel,4,600,2400', 'Lodging,3,900,2700', 'Batteries,6,120,720', 'Memory cards,4,180,720', 'Meals,3,350,1050', 'Insurance,1,1155.67,1155.67', 'Total budget,,,12345.67'];
    await writeFile(path.join(directory, 'budget.csv'), budgetRows.join('\n') + '\n');
    await copyFile(path.join(root, 'packages/model3d/test/fixtures/occt/assembly.stp'), path.join(directory, 'drawing.step'));
    const runs = [];
    function cli(intent) { const args = Array.isArray(intent) ? intent : [intent]; const start = performance.now(); const stdout = run(binary, args, directory); runs.push({ intent: Array.isArray(intent) ? args.join(' ') : intent, args, stdout, ms: Math.round(performance.now() - start) }); return stdout; }
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
    const intents = zh ? ['你能做什么？以 JSON 输出', '读取 "launch-brief.docx"，以 Markdown 输出', '总结 "meeting-notes.txt"，以纯文本输出', '总结 "meeting-notes.txt"，以 JSON 输出', '在 "documents.zip" 中搜索 "预算 风险"，以 JSON 输出', '获取 "invoice.png" 的布局，以 JSON 输出', '获取 "invoice.png" 的布局，以 YAML 输出', '查找 "files" 中的重复文件，以 JSON 输出', '查找 "photos" 中的相似图片，以 JSON 输出'] : ['What can you do? as json', 'read "launch-brief.docx" as markdown', 'summarize "meeting-notes.txt" as text', 'summarize "meeting-notes.txt" as json', 'search "documents.zip" for "budget risk" as json', 'get layout of "invoice.png" as json', 'get layout of "invoice.png" as yaml', 'find duplicate files in "files" as json', 'find similar images in "photos" as json'];
    const capacity = JSON.parse(cli(intents[0]));
    for (const operation of ['summarize', 'search', 'similar', 'convert']) assert.ok(capacity.capacity.operations.some(o => o.name === operation), `Rebuild the CLI: missing ${operation}`);
    assert.equal(capacity.capacity.preview.available, true, 'Build preview assets with npm run build:preview or pass --preview-assets DIR.');
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
    assert.deepEqual(hit.archive.members, ['attachments.zip', 'contract.docx']);
    const member = path.relative(directory, hit.path);
    const memberDocument = JSON.parse(cli(['read', member, '--json']));
    for (const evidence of hit.excerpts) assert.equal(Buffer.from(memberDocument.content.text).subarray(evidence.startByte, evidence.endByte).toString(), evidence.text);
    const memberIntent = zh ? `读取 "${member}"，以 Markdown 输出` : `read "${member}" as markdown`;
    const memberMarkdown = cli(memberIntent);
    assert.match(memberMarkdown, zh ? /# 极光项目采购合同/ : /# Aurora purchase agreement/);
    await rm(path.join(directory, 'budget.xlsx'), { force: true });
    const converted = JSON.parse(cli(['convert', 'budget.csv', 'budget.xlsx', '--json']));
    assert.equal(converted.ok, true);
    assert.equal(converted.conversion.sourceFormat, 'csv');
    assert.equal(converted.conversion.targetFormat, 'xlsx');
    assert.equal((await readFile(path.join(directory, 'budget.xlsx'))).length, converted.output.bytes);
    const workbookRead = JSON.parse(cli(['read', 'budget.xlsx', '--json']));
    assert.match(workbookRead.content.text, /12345\.67/);
    const workbookPreview = await capturePreview(['preview', 'budget.xlsx', '--no-open', '--json'], directory, 'workbook-preview', runs, { expectedCells: budgetRows.flatMap(row => row.split(',')) });
    const modelPreview = await capturePreview(['preview', 'drawing.step', '--no-open', '--json'], directory, 'model-preview', runs, { orbit: true });
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
    assert.ok(yaml.includes('  layout:\n'));
    const command = index => `filens '${intents[index]}'`;
    const searchExcerpt = `{\n  "method": ${JSON.stringify(searched.search.method)},\n  "matchedFiles": ${searched.search.matchedFiles},\n  "results": [{\n    "path": ${JSON.stringify(member)},\n    "excerpts": [${JSON.stringify({ startLine: hit.excerpts[0].startLine, text: hit.excerpts[0].text.trimEnd() })}]\n  }]\n}`;
    const data = { locale, inputCount: capacity.capacity.formats.length, imageWidth: 630, imageHeight: 720,
      image: 'data:image/png;base64,' + (await readFile(invoice)).toString('base64'), boxes, focusIndex,
      summary: summarized.content.summary, search: searched.search, member, duplicates, similar, csv: budgetRows.join('\n'),
      photos: similar.groups[0].files.map(f => ({ ...f, image: photos[f.path] })),
      capacity: { command: command(0), excerpt: `{\n  "outputFormats": [\n    "text", "json", "markdown", "html",\n    "yaml", "xml", "csv", "tsv"\n  ],\n  "conversionPairs": [\n${capacity.capacity.conversionPairs.filter(pair => ['doc', 'csv', 'dng'].includes(pair.sourceFormat)).map(pair => `    ${JSON.stringify(pair)}`).join(',\n')}\n  ],\n  "preview": ${JSON.stringify({ available: capacity.capacity.preview.available, engine: capacity.capacity.preview.engine })}\n}` },
      markdown: { command: command(1), output: markdown },
      pruning: { command: command(2), output: summaryText },
      retrieval: { command: command(4), output: searchExcerpt },
      archiveRead: { command: `filens '${memberIntent}'`, output: memberMarkdown },
      conversion: { command: 'filens convert budget.csv budget.xlsx --json', output: JSON.stringify({ ok: converted.ok, conversion: { sourceFormat: converted.conversion.sourceFormat, targetFormat: converted.conversion.targetFormat, fidelity: converted.conversion.fidelity }, output: { path: path.relative(directory, converted.output.path), bytes: converted.output.bytes } }, null, 2) },
      workbookPreview, modelPreview,
      layout: { command: command(5), excerpt, version: layout.version, pages: layout.pages },
      duplicateScan: { command: command(7), output: JSON.stringify({ method: duplicates.method, matchedGroups: duplicates.matchedGroups, sha256: duplicates.groups[0].sha256, files: duplicates.groups[0].files.map(f => f.path) }, null, 2) },
      imageScan: { command: command(8), output: `{\n  "method": "${similar.method}",\n  "threshold": ${similar.threshold},\n  "matchedGroups": ${similar.matchedGroups},\n  "files": [\n${similar.groups[0].files.map(f => `    ${JSON.stringify({ path: f.path, distanceToReference: f.distanceToReference })}`).join(',\n')}\n  ]\n}` },
    };
    await writeFile(path.join(directory, 'responses.json'), JSON.stringify({ runs, data: { ...data, image: undefined, workbookPreview: { ...workbookPreview, frames: undefined }, modelPreview: { ...modelPreview, frames: undefined } } }, null, 2) + '\n');
    await page.setViewportSize({ width, height });
    await page.addInitScript(value => { window.DEMO = value; }, data);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('file://' + path.join(root, 'scripts/agent-cli-demo.html'));
    await page.evaluate(() => document.fonts.ready);
    const duration = await page.evaluate(() => window.demoStages.at(-1).end / 1000);
    assert.equal(duration, 60);
    assert.ok(await page.evaluate(() => window.demoStages.every((stage, index, stages) => stage.start === (stages[index - 1]?.end ?? 0) && stage.end > stage.start)));
    const sceneEnds = await page.evaluate(() => window.demoStages.map(s => s.end - 100));
    for (const timestamp of sceneEnds) {
      await page.evaluate(t => window.renderAt(t), timestamp);
      const fits = await page.evaluate(() => { const o = document.querySelector('#output'); return o.scrollHeight <= o.clientHeight; });
      assert.ok(fits, `${locale}: output clipped at ${timestamp}`);
      const sideFits = await page.evaluate(() => {
        const card = document.querySelector('.summary-card,.search-card,.cap-visual,.preview-doc,.duplicate-card,.images-card,.archive-card,.conversion-card,.browser-card');
        return !card || card.getBoundingClientRect().bottom <= document.querySelector('#right').getBoundingClientRect().bottom;
      });
      assert.ok(sideFits, `${locale}: side panel clipped at ${timestamp}`);
      assert.ok(await page.evaluate(() => document.querySelector('#command').textContent === window.demoStages.find(stage => stage.end - 100 === window.demoTime).command));
      const complete = await page.evaluate(() => document.querySelector('#output').textContent === window.demoStages.find(stage => stage.end - 100 === window.demoTime).output);
      if (timestamp >= 7000) assert.ok(complete, `${locale}: output did not finish typing at ${timestamp}`);
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
        await writeFile(path.join(directory, 'receipt.json'), JSON.stringify({ createdAt: new Date().toISOString(), locale, width, height, duration, fps, frames: count, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), requests: runs.map(({ intent, ms }) => ({ intent, ms })), previewCaptures: { workbook: workbookPreview.captures, model: modelPreview.captures }, notes: 'Actual CLI responses and browser previews served by the CLI; excerpts shown, paths and URL tokens shortened. Typing, response timing and orbit capture playback edited. Nested ZIP search evidence verified against member text. CSV converted by WASM and the resulting XLSX rendered by the shared viewer. STEP orbit uses actual renderer captures. No embedding or generated reasoning. Image distances are not confidence percentages.' }, null, 2) + '\n');
        console.log(`Created ${stem}.gif (${(bytes.length / 1048576).toFixed(2)} MiB, ${duration}s).`);
      } finally { await rm(frames, { recursive: true, force: true }); }
    }
    await page.close();
  }
} finally { await browser.close(); }
