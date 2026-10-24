// Engineering A/B check; these runs do not qualify for external SOTA rankings.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repo, 'package.json'));
const { build } = require('esbuild');
const { chromium } = require('playwright');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const baselineModule = option('--baseline-module', 'tmp/continued-review/iwork-baseline/dist/index.js');
const baselineTable = option('--baseline-table', 'tmp/continued-review/iwork-baseline/table.ts');
const out = option('--output', 'tmp/continued-review/iwork-sparse');
const iterations = Number(option('--iterations', '7'));
if (!Number.isSafeInteger(iterations) || iterations < 1) throw new Error('Invalid iterations.');
const relative = value => {
  const result = path.relative(repo, path.resolve(repo, value));
  if (!result || result.startsWith('..') || path.isAbsolute(result)) throw new Error('Paths must be inside the repository.');
  return result.split(path.sep).join('/');
};
const output = relative(out);
const baseline = relative(baselineModule);
fs.mkdirSync(path.join(repo, output), { recursive: true });
const source = 'packages/iwork/src/parser/table.ts';
for (const [engine, file] of [['baseline', baselineTable], ['current', source]]) {
  await build({
    stdin: { contents: fs.readFileSync(path.resolve(repo, file), 'utf8'), loader: 'ts',
      resolveDir: path.join(repo, 'packages/iwork/src/parser'), sourcefile: 'table.ts' },
    bundle: true, format: 'esm', platform: 'browser', minify: true,
    external: ['@filens/core', '@filens/xlsx'],
    outfile: path.join(repo, output, `table-${engine}.js`), logLevel: 'silent'
  });
}
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const artifact = file => ({ path: relative(file), sha256: sha(fs.readFileSync(path.resolve(repo, file))) });
const models = [
  ...['a.numbers', 'a.pages', 'filens-weekend.key'].map(name => `apps/demo/public/samples/${name}`),
  ...['a.numbers', 'a.pages', 'a.key'].map(name => `packages/iwork/vendor/iwork-converter/testdata/${name}`)
];
const cases = [...models.map(file => ({ kind: 'model', file })),
  { kind: 'table', name: 'sparse-1024x1024', rows: 1024, columns: 1024, sparse: true },
  { kind: 'table', name: 'dense-128x128', rows: 128, columns: 128, sparse: false }];
const imports = { '@filens/core': '/repo/packages/core/dist/index.js', '@filens/xlsx': '/repo/packages/xlsx/dist/index.js' };
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<script type="importmap">${JSON.stringify({ imports })}</script>`);
    return;
  }
  const file = path.resolve(repo, decodeURIComponent(pathname.slice('/repo/'.length)));
  if (!pathname.startsWith('/repo/') || !file.startsWith(repo + path.sep)) { res.writeHead(404).end(); return; }
  try {
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    res.end(fs.readFileSync(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
const result = { date: new Date().toISOString(), cpu: os.cpus()[0].model,
  platform: `${os.platform()} ${os.release()} ${os.arch()}`, browser: browser.version(), iterations,
  method: 'Fresh browser context for each run, rotating current/baseline order. Modules and input ready before timer. Full model/table construction only; serialization/content checks after timing. Engineering runs, no peer ranking.',
  artifacts: [relative(fileURLToPath(import.meta.url)), source, baselineTable, baseline,
    'packages/iwork/dist/index.js', 'packages/core/dist/index.js', 'packages/xlsx/dist/index.js',
    `${output}/table-baseline.js`, `${output}/table-current.js`, ...models].map(artifact), runs: [] };
try {
  for (const task of cases) for (let iteration = 0; iteration < iterations; iteration++) {
    const order = iteration % 2 ? ['baseline', 'current'] : ['current', 'baseline'];
    for (const engine of order) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const run = { sample: task.name ?? task.file, engine, iteration, errors };
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.evaluate(async ({ task, engine, output, baseline }) => {
          if (task.kind === 'model') {
            const lib = await import(`/repo/${engine === 'current' ? 'packages/iwork/dist/index.js' : baseline}`);
            const file = new File([await (await fetch(`/repo/${task.file}`)).arrayBuffer()], task.file.split('/').at(-1));
            window.buildModel = () => lib.loadIwork(file);
            return;
          }
          const { buildTableItem } = await import(`/repo/${output}/table-${engine}.js`);
          const record = (id, typeName, value) => ({ id, archiveId: id, messageIndex: 0, typeId: 1,
            typeName, value, objectReferences: [], dataReferences: [] });
          const textBuffer = count => {
            const bytes = new Uint8Array(count * 16), view = new DataView(bytes.buffer);
            for (let i = 0; i < count; i++) { bytes[i * 16] = 5; bytes[i * 16 + 1] = 3; view.setUint32(i * 16 + 12, 1, true); }
            return bytes;
          };
          const rowInfos = Array.from({ length: task.rows }, (_, row) => {
            const offsets = new Uint8Array(task.columns * 2), view = new DataView(offsets.buffer);
            offsets.fill(255);
            if (task.sparse) view.setUint16((row % 512) * 2, 0, true);
            else for (let column = 0; column < task.columns; column++) view.setUint16(column * 2, column * 16, true);
            const fallback = new Uint8Array(task.columns * 2); fallback.fill(255);
            new DataView(fallback.buffer).setUint16((task.columns - 1) * 2, 0, true);
            return { tileRowIndex: row, cellCount: task.sparse ? 2 : task.columns,
              cellOffsets: offsets, cellStorageBuffer: textBuffer(task.sparse ? 1 : task.columns),
              ...(task.sparse ? { cellOffsetsPreBnc: fallback, cellStorageBufferPreBnc: textBuffer(1) } : {}) };
          });
          const archive = { type: 'numbers', records: {
            1: record(1, 'TST.TableModelArchive', { numberOfRows: task.rows, numberOfColumns: task.columns,
              defaultRowHeight: 22, defaultColumnWidth: 72,
              baseDataStore: { tiles: { tiles: [{ tile: { identifier: 2 } }] }, stringTable: { identifier: 3 }, mergeRegionMap: { identifier: 4 } } }),
            2: record(2, 'TST.Tile', { numrows: task.rows, rowInfos }),
            3: record(3, 'TST.TableDataList', { entries: [{ key: 1, string: 'Preview' }] }),
            4: record(4, 'TST.MergeRegionMapArchive', { cellRange: task.sparse ? [
              { origin: { row: 2, column: 700 }, size: { numRows: 2, numColumns: 2 } }
            ] : [] })
          }, references: { incoming: {}, outgoing: {} }, dataEntries: {}, warnings: [] };
          window.buildModel = () => buildTableItem(archive, { tableModel: { identifier: 1 } },
            { x: 0, y: 0, width: task.columns * 72, height: task.rows * 22, rotation: 0, flipH: false, flipV: false }, 0);
        }, { task, engine, output, baseline });
        const data = await page.evaluate(async () => {
          const start = performance.now();
          const model = await window.buildModel();
          const ms = performance.now() - start;
          const tables = model.kind === 'numbers' ? model.sheets.flatMap(sheet => sheet.tables.map(table => table.item)) : model.kind === 'table' ? [model] : [];
          return { ms, json: JSON.stringify(model), cells: tables.reduce((sum, table) => sum + table.cells.length, 0),
            tables: tables.length, nonempty: tables.reduce((sum, table) => sum + table.cells.filter(cell => cell.textFrame.paragraphs.some(p => p.runs.some(r => r.text.trim()))).length, 0) };
        });
        Object.assign(run, { ms: data.ms, cells: data.cells, nonempty: data.nonempty, tables: data.tables,
          modelSha256: sha(data.json), serializedBytes: Buffer.byteLength(data.json), ok: errors.length === 0 });
      } catch (error) { run.ok = false; run.error = String(error); }
      result.runs.push(run);
      console.log(JSON.stringify(run));
      fs.writeFileSync(path.join(repo, output, 'results.json'), JSON.stringify(result, null, 2) + '\n');
      await context.close();
    }
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
if (result.runs.some(run => !run.ok)) process.exitCode = 1;
