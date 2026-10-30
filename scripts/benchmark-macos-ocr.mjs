// Same inputs and worker protocol; no production provider is changed by this experiment.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

assert.equal(process.platform, 'darwin', 'This benchmark requires macOS and Apple Vision.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.join(root, 'dist/macos-ocr');
await mkdir(work, { recursive: true });
const vision = path.join(work, 'vision-ocr');
const compile = spawnSync('swiftc', ['-O', path.join(root, 'scripts/macos-vision-ocr.swift'), '-o', vision], { encoding: 'utf8' });
assert.equal(compile.status, 0, compile.stderr);
const binary = process.env.FILENS_AGENT_BINARY || path.join(root, 'dist/filens');
const env = { ...process.env, OMP_NUM_THREADS: '2', OMP_THREAD_LIMIT: '2',
  FILENS_OCR_LIBRARY: path.join(root, 'dist/native/libzima_ncnn_runtime_v7.dylib'),
  FILENS_OCR_MODEL_DIR: path.join(root, 'dist/models/rapidocr-ncnn') };
const commands = { vision: [vision, []], rapidocr: [binary, ['--ocr-worker']] };
const rounds = Number(process.env.OCR_BENCH_ROUNDS || 7);
assert.ok(Number.isInteger(rounds) && rounds >= 3);
const zh = await readFile(path.join(root, 'docs/assets/agent-cli/invoice-zh.expected.txt'), 'utf8');
const en = 'Invoice ID FILENS2026\nTotal 12345.67';
const cases = [
  ...['zh', 'blur', 'small', 'tiny', 'heavy-blur'].map(name => ({ name: `invoice-${name}`,
    file: `docs/assets/agent-cli/invoice-${name}.png`, expected: zh })),
  ...['scan', 'scan-rotated', 'scan-exif'].map(name => ({ name,
    file: `converter/rapidocr/testdata/${name}.${name === 'scan-exif' ? 'jpg' : 'png'}`, expected: en }))
];
// Canvas composites transparency exactly as the shared core does: onto white.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  for (const variant of [
    { name: 'transparent-prepared', source: 'converter/rapidocr/testdata/scan-transparent.png', expected: en },
    { name: 'zh-90', source: 'docs/assets/agent-cli/invoice-zh.png', angle: 90, expected: zh },
    { name: 'zh-180', source: 'docs/assets/agent-cli/invoice-zh.png', angle: 180, expected: zh },
    { name: 'zh-skew-8', source: 'docs/assets/agent-cli/invoice-zh.png', angle: 8, expected: zh }
  ]) {
    const data = await readFile(path.join(root, variant.source));
    const png = await page.evaluate(async ({ base64, angle }) => {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
      const rad = angle * Math.PI / 180;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(Math.abs(image.width * Math.cos(rad)) + Math.abs(image.height * Math.sin(rad)));
      canvas.height = Math.round(Math.abs(image.width * Math.sin(rad)) + Math.abs(image.height * Math.cos(rad)));
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.translate(canvas.width / 2, canvas.height / 2); ctx.rotate(rad); ctx.drawImage(image, -image.width / 2, -image.height / 2);
      return canvas.toDataURL('image/png').split(',')[1];
    }, { base64: data.toString('base64'), angle: variant.angle || 0 });
    const file = `dist/macos-ocr/${variant.name}.png`;
    await writeFile(path.join(root, file), Buffer.from(png, 'base64'));
    cases.push({ name: variant.name, file, expected: variant.expected });
  }
  const blank = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 800; c.height = 400;
    c.getContext('2d').fillStyle = 'white'; c.getContext('2d').fillRect(0, 0, 800, 400);
    return c.toDataURL().split(',')[1];
  });
  await writeFile(path.join(work, 'blank.png'), Buffer.from(blank, 'base64'));
  cases.push({ name: 'blank', file: 'dist/macos-ocr/blank.png', expected: '' });
} finally { await browser.close(); }

function worker(engine) {
  const [command, args] = commands[engine];
  const child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = createInterface({ input: child.stdout });
  let pending, stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  lines.on('line', line => {
    if (!pending) return;
    const { resolve, reject, timer, start } = pending; pending = undefined; clearTimeout(timer);
    try { resolve({ ms: performance.now() - start, response: JSON.parse(line) }); } catch (error) { reject(error); }
  });
  child.on('error', error => { pending?.reject(error); });
  child.on('exit', code => { pending?.reject(new Error(`${engine} exited ${code}: ${stderr}`)); });
  return {
    call(request) {
      assert.equal(pending, undefined);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${engine} timed out`)); }, 30000);
        pending = { resolve, reject, timer, start: performance.now() };
        child.stdin.write(`${JSON.stringify(request)}\n`);
      });
    },
    async close() {
      const closed = new Promise(resolve => child.once('close', resolve));
      child.kill(); await closed;
    }
  };
}
function cer(expected, actual) {
  const normalize = text => [...text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')];
  const a = normalize(expected), b = normalize(actual);
  if (!a.length) return b.length ? 1 : 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = next;
  }
  return previous[b.length] / a.length;
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const cold = { vision: [], rapidocr: [] }, health = {};
for (let round = 0; round < 5; round++) {
  for (const engine of round % 2 ? ['rapidocr', 'vision'] : ['vision', 'rapidocr']) {
    const start = performance.now(), w = worker(engine);
    try {
      const result = await w.call({ path: path.join(root, cases[0].file), layout: true });
      assert.equal(result.response.error, undefined, JSON.stringify(result.response));
      cold[engine].push(performance.now() - start);
    } finally { await w.close(); }
  }
}
const workers = { vision: worker('vision'), rapidocr: worker('rapidocr') }, results = [], diagnostics = {};
try {
  for (const engine of Object.keys(workers)) health[engine] = (await workers[engine].call({ operation: 'health' })).response;
  for (const test of cases) {
    const observations = { vision: [], rapidocr: [] }, responses = {};
    for (let round = -1; round < rounds; round++) {
      for (const engine of round % 2 ? ['vision', 'rapidocr'] : ['rapidocr', 'vision']) {
        const result = await workers[engine].call({ path: path.join(root, test.file), layout: true });
        assert.equal(result.response.error, undefined, JSON.stringify(result.response));
        if (round >= 0) observations[engine].push(result.ms);
        responses[engine] = result.response;
      }
    }
    const row = { name: test.name, input: test.file, sha256: createHash('sha256').update(await readFile(path.join(root, test.file))).digest('hex'), expected: test.expected };
    for (const engine of Object.keys(workers)) {
      const response = responses[engine], text = response.text || '';
      row[engine] = { medianMs: median(observations[engine]), samplesMs: observations[engine], cer: cer(test.expected, text),
        invoiceNumberCorrect: test.expected ? text.includes('FILENS2026') : null,
        amountCorrect: test.expected ? text.includes('12345.67') : null, response };
      if (engine === 'vision') for (const block of response.blocks) {
        assert.ok(block.confidence >= 0 && block.confidence <= 1);
        assert.ok(block.polygon.every(([x, y]) => x >= -1 && x <= response.width + 1 && y >= -1 && y <= response.height + 1));
      }
    }
    results.push(row);
    console.log(`${test.name}: Vision ${row.vision.medianMs.toFixed(1)}ms CER ${(100 * row.vision.cer).toFixed(1)}%; RapidOCR ${row.rapidocr.medianMs.toFixed(1)}ms CER ${(100 * row.rapidocr.cer).toFixed(1)}%`);
  }
  for (const name of ['zh-90', 'zh-180', 'scan-rotated']) {
    const test = cases.find(test => test.name === name);
    diagnostics[name] = [];
    for (const orientation of [1, 3, 6, 8]) {
      const result = await workers.vision.call({ path: path.join(root, test.file), orientation });
      diagnostics[name].push({ orientation, ms: result.ms, cer: cer(test.expected, result.response.text || ''), text: result.response.text });
    }
  }
  diagnostics.errors = {};
  for (const engine of Object.keys(workers)) {
    const response = (await workers[engine].call({ path: path.join(work, 'does-not-exist.png') })).response;
    assert.ok(response.error); diagnostics.errors[engine] = response;
    assert.equal((await workers[engine].call({ operation: 'health' })).response.error, undefined);
  }
} finally { for (const w of Object.values(workers)) await w.close(); }
const sha = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const report = { date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()),
  machine: { chip: spawnSync('sysctl', ['-n', 'machdep.cpu.brand_string'], { encoding: 'utf8' }).stdout.trim(),
    macOS: spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).stdout.trim(), arch: process.arch },
  method: { rounds, coldRounds: 5, cold: 'Fresh process, first recognition; OS/framework file caches are not flushed.',
    warm: 'One excluded warmup per fixture; alternating engine order, persistent workers. Wall time includes image decoding, inference, JSON and IPC; excludes Swift compilation and document parsing.',
    quality: 'NFKC, case-folded, whitespace/punctuation/symbol-stripped Levenshtein CER. Synthetic fixtures only; punctuation and case errors are hidden by this metric.',
    transparency: 'Prepared variant uses the same white-compositing rule as the WASM core; generation is outside timing.' },
  binaries: { vision: { bytes: (await stat(vision)).size, sha256: await sha(vision) }, rapidocr: { sha256: await sha(binary) } },
  health, cold, results, diagnostics };
// Native errors can echo the absolute test input. Keep local paths out of the
// checked-in evidence without changing observed timings or recognized text.
const serialized = JSON.stringify(report, null, 2).split(root).join('<repo>');
await writeFile(path.join(root, 'docs/macos-ocr-benchmark.json'), `${serialized}\n`);
console.log('Saved docs/macos-ocr-benchmark.json');
