import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { npmInvocation } from './agent-platforms.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = JSON.parse(await readFile(path.join(root, 'dist/step-npm/release.json'), 'utf8'));
const work = await mkdtemp(path.join(os.tmpdir(), 'filens-step-install-'));
let server, browser;
try {
  const npm = npmInvocation(['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', work, path.join(root, 'dist/step-npm', release.file)]);
  const installed = spawnSync(npm.command, npm.args, { encoding: 'utf8' });
  assert.equal(installed.status, 0, installed.stderr);
  const moduleRoot = path.join(work, 'node_modules/filens-step');
  const metadata = JSON.parse(await readFile(path.join(moduleRoot, 'package.json'), 'utf8'));
  assert.deepEqual(metadata.dependencies ?? {}, {});
  const lib = await import(pathToFileURL(path.join(moduleRoot, 'dist/index.js')).href);
  const wasm = new Uint8Array(await readFile(fileURLToPath(lib.stepWasmUrl)));
  const build = JSON.parse(await readFile(path.join(moduleRoot, 'dist/filens-step-manifest.json'), 'utf8'));
  assert.equal(createHash('sha256').update(wasm).digest('hex'), build.wasm.sha256);
  const input = await readFile(path.join(root, 'packages/model3d/test/fixtures/occt/cube.stp'));
  assert.ok((await lib.createStepReader({ wasm }).read(input)).triangleCount > 0);
  await writeFile(path.join(work, 'consumer.ts'), "import { readStep, createStepReader, type StepMesh } from 'filens-step';\nconst reader = createStepReader();\nconst data: Promise<StepMesh> = readStep(new Uint8Array(0));\nvoid reader; void data;\n");
  const typed = spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--moduleResolution', 'Bundler', '--module', 'ESNext', '--target', 'ES2020', '--lib', 'ES2020,DOM', path.join(work, 'consumer.ts')], { encoding: 'utf8' });
  assert.equal(typed.status, 0, typed.stdout + typed.stderr);
  server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/') {
        response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>STEP package smoke</title>'); return;
      }
      const name = path.basename(url.pathname);
      const source = url.pathname.startsWith('/package/') ? path.join(moduleRoot, 'dist', name)
        : url.pathname.startsWith('/fixtures/') && ['cube.stp', 'assembly.stp'].includes(name) ? path.join(root, 'packages/model3d/test/fixtures/occt', name) : null;
      if (!source) { response.statusCode = 404; response.end(); return; }
      response.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : name.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
      response.end(await readFile(source));
    } catch { response.statusCode = 404; response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage(), errors = [], wasmRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.url().endsWith('.wasm')) wasmRequests.push(response.url()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async () => { window.stepLibrary = await import('/package/index.js'); });
  assert.equal(wasmRequests.length, 0, 'Importing the package must not fetch WASM');
  const observed = await page.evaluate(async () => {
    const results = [];
    for (const name of ['cube.stp', 'assembly.stp']) {
      const mesh = await window.stepLibrary.readStep(await (await fetch(`/fixtures/${name}`)).arrayBuffer());
      results.push({ name, triangles: mesh.triangleCount, faces: mesh.metadata.faces, missingFaces: mesh.metadata.missingFaces, finite: mesh.positions.every(Number.isFinite) && mesh.normals.every(Number.isFinite) });
    }
    try { await window.stepLibrary.readStep('invalid'); throw new Error('Invalid STEP was accepted'); }
    catch (error) { if (error.code !== 'invalid_step') throw error; }
    const recovered = await window.stepLibrary.readStep(await (await fetch('/fixtures/cube.stp')).arrayBuffer());
    return { results, recoveredTriangles: recovered.triangleCount };
  });
  assert.equal(wasmRequests.length, 1);
  assert.deepEqual(errors, []);
  for (const row of observed.results) { assert.ok(row.triangles > 0 && row.faces > 0 && row.finite); assert.equal(row.missingFaces, 0); }
  assert.equal(observed.recoveredTriangles, observed.results[0].triangles);
  const report = { name: release.name, version: release.version, tarballSha256: release.sha256, wasmSha256: build.wasm.sha256, offlineInstall: true, zeroRuntimeDependencies: true, standaloneTypeScriptConsumer: true, realBrowserWasm: true, lazyWasmRequests: wasmRequests.length, invalidFileRecovery: true, ...observed };
  await writeFile(path.join(root, 'dist/step-npm/install-check.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('STEP tarball: offline install, standalone TypeScript, real Chromium reads, one lazy WASM download and invalid-file recovery passed.');
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(work, { recursive: true, force: true });
}
