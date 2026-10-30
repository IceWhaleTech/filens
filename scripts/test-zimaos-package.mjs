import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = path.join(root, 'dist/filens.raw');
const work = await mkdtemp(path.join(os.tmpdir(), 'filens-zimaos-test-'));
const { version, cliVersion } = JSON.parse(await readFile(path.join(root, 'packaging/zimaos/release.json'), 'utf8'));
try {
  assert.ok((await stat(raw)).size <= 15_000_000, 'raw package exceeds CDN budget');
  const extracted = path.join(work, 'extracted');
  const unpack = spawnSync('unsquashfs', ['-no-progress', '-d', extracted, raw], { encoding: 'utf8' });
  assert.equal(unpack.status, 0, unpack.stderr);
  assert.equal(await readFile(path.join(extracted, 'usr/lib/extension-release.d/extension-release.filens'), 'utf8'), 'ID=_any\n');
  const manifest = JSON.parse(await readFile(path.join(extracted, 'usr/share/casaos/modules/filens.json'), 'utf8'));
  assert.equal(manifest.name, 'filens');
  assert.equal(manifest.version, version);
  assert.equal(manifest.ui, undefined);
  assert.deepEqual(manifest.services, []);
  await assert.rejects(stat(path.join(extracted, 'usr/share/casaos/www')));
  for (const [platform, machine] of [['linux-x64', 62], ['linux-arm64', 183]]) {
    const bundle = path.join(extracted, 'usr/lib/filens', platform);
    const binary = await readFile(path.join(bundle, 'filens'));
    assert.equal(binary.subarray(0, 4).toString(), '\x7fELF');
    assert.equal(binary.readUInt16LE(18), machine);
    assert.ok((await stat(path.join(bundle, 'filens'))).mode & 0o111);
    for (const wasm of ['converter-text.wasm.gz', 'converter-image.wasm.gz', 'pdfium.wasm.gz']) {
      assert.equal(gunzipSync(await readFile(path.join(bundle, wasm))).subarray(0, 4).toString(), '\0asm');
    }
    await assert.rejects(stat(path.join(bundle, 'native')));
    await assert.rejects(stat(path.join(bundle, 'models')));
  }

  const prefix = path.join(work, 'fixture/usr');
  const commands = path.join(work, 'commands');
  const cache = path.join(work, 'Photos cache');
  await mkdir(path.join(prefix, 'bin'), { recursive: true });
  await mkdir(commands);
  await copyFile(path.join(extracted, 'usr/bin/filens'), path.join(prefix, 'bin/filens'));
  await chmod(path.join(prefix, 'bin/filens'), 0o755);
  await writeFile(path.join(commands, 'uname'), '#!/bin/sh\nprintf "%s\\n" "$FILENS_TEST_ARCH"\n', { mode: 0o755 });
  for (const platform of ['linux-x64', 'linux-arm64']) {
    await mkdir(path.join(prefix, 'lib/filens', platform), { recursive: true });
    await writeFile(path.join(prefix, 'lib/filens', platform, 'filens'), '#!/bin/sh\nif [ "${1:-}" = --ocr-worker ] && [ "${FILENS_TEST_FAIL_HEALTH:-}" = yes ]; then exit 1; fi\nprintf "%s\\n" "$FILENS_PROFILE" "${FILENS_OCR_LIBRARY-}" "${FILENS_OCR_MODEL_DIR-}" "$@"\n', { mode: 0o755 });
  }
  const fixtureBundle = path.join(prefix, 'lib/filens');
  for (const file of ['setup-ocr', 'cli-version', 'ocr-packages.sha256']) {
    await copyFile(path.join(extracted, 'usr/lib/filens', file), path.join(fixtureBundle, file));
  }
  await chmod(path.join(fixtureBundle, 'setup-ocr'), 0o755);
  assert.equal((await readFile(path.join(fixtureBundle, 'cli-version'), 'utf8')).trim(), cliVersion);
  const env = { ...process.env, PATH: `${commands}${path.delimiter}${process.env.PATH}`, ZIMAOS_MODEL_CACHE_DIR: cache, FILENS_CACHE_DIR: path.join(work, 'private-cache') };
  for (const key of ['FILENS_OCR_LIBRARY', 'FILENS_OCR_MODEL_DIR', 'FILENS_PROFILE']) delete env[key];
  const launch = (arch, overrides = {}) => spawnSync(path.join(prefix, 'bin/filens'), ['read', 'a file.pdf', '--json'], {
    env: { ...env, FILENS_TEST_ARCH: arch, ...overrides }, encoding: 'utf8'
  });
  for (const arch of ['x86_64', 'aarch64']) {
    const result = launch(arch);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trimEnd().split('\n'), ['lite', '', '', 'read', 'a file.pdf', '--json']);
  }
  const runtime = path.join(cache, 'ncnn/runtime');
  const models = path.join(cache, 'ncnn/rapidocr-ncnn');
  await mkdir(runtime, { recursive: true });
  await mkdir(models, { recursive: true });
  await writeFile(path.join(runtime, 'libzima_ncnn_runtime_v7.so'), 'fixture');
  await writeFile(path.join(models, 'metadata.json'), '{}');
  assert.equal(launch('x86_64').stdout.split('\n')[0], 'lite', 'runtime without its companion must not be selected');
  await writeFile(path.join(runtime, 'libncnn.so'), 'fixture');
  for (const arch of ['x86_64', 'aarch64']) {
    const result = launch(arch);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trimEnd().split('\n'), ['full', path.join(runtime, 'libzima_ncnn_runtime_v7.so'), models, 'read', 'a file.pdf', '--json']);
  }
  const explicit = launch('x86_64', { FILENS_OCR_LIBRARY: '/custom/runtime.so', FILENS_OCR_MODEL_DIR: '/custom/models', FILENS_PROFILE: 'lite' });
  assert.deepEqual(explicit.stdout.trimEnd().split('\n').slice(0, 3), ['lite', '/custom/runtime.so', '/custom/models']);
  assert.equal(launch('riscv64').status, 1);

  // Exercise setup without network access: reject a corrupt first mirror,
  // accept the pinned second mirror, and preserve an install on later failure.
  const payload = path.join(work, 'payload');
  await mkdir(path.join(payload, 'package/native'), { recursive: true });
  await mkdir(path.join(payload, 'package/models/rapidocr-ncnn'), { recursive: true });
  for (const file of ['native/libzima_ncnn_runtime_v7.so', 'native/libncnn.so', 'models/rapidocr-ncnn/metadata.json', 'LICENSE', 'THIRD-PARTY-NOTICES.md']) {
    await writeFile(path.join(payload, 'package', file), 'fixture');
  }
  const fixtureArchive = path.join(work, 'ocr.tgz');
  assert.equal(spawnSync('tar', ['-czf', fixtureArchive, '-C', payload, 'package']).status, 0);
  const checksum = createHash('sha256').update(await readFile(fixtureArchive)).digest('hex');
  await writeFile(path.join(fixtureBundle, 'ocr-packages.sha256'), `linux-x64 ${checksum} fixture.tgz\n`);
  await writeFile(path.join(commands, 'curl'), `#!/bin/sh
previous=
for arg in "$@"; do
  if [ "$previous" = --output ]; then output=$arg; fi
  previous=$arg
done
printf '%s\\n' "$arg" >> "$FILENS_TEST_CURL_LOG"
case "$arg" in
  *npmmirror*) printf corrupt > "$output" ;;
  *) if [ "\${FILENS_TEST_FAIL_DOWNLOAD:-}" = yes ]; then printf corrupt > "$output"; else cp "$FILENS_TEST_OCR_ARCHIVE" "$output"; fi ;;
esac
`, { mode: 0o755 });
  const curlLog = path.join(work, 'curl.log');
  const setup = (overrides = {}) => spawnSync(path.join(prefix, 'bin/filens'), ['setup-ocr', '--refresh'], {
    env: { ...env, FILENS_TEST_ARCH: 'x86_64', FILENS_TEST_OCR_ARCHIVE: fixtureArchive, FILENS_TEST_CURL_LOG: curlLog, ...overrides }, encoding: 'utf8'
  });
  const installed = setup();
  assert.equal(installed.status, 0, installed.stderr);
  const privateOCR = path.join(env.FILENS_CACHE_DIR, 'zimaos-ocr', cliVersion, 'linux-x64');
  assert.equal(await readFile(path.join(privateOCR, 'native/libncnn.so'), 'utf8'), 'fixture');
  const attempts = (await readFile(curlLog, 'utf8')).trim().split('\n');
  assert.equal(attempts.length, 2);
  assert.match(attempts[0], /registry.npmmirror.com/);
  assert.match(attempts[1], /registry.npmjs.org/);
  assert.equal(launch('x86_64').stdout.split('\n')[1], path.join(privateOCR, 'native/libzima_ncnn_runtime_v7.so'));
  const rejected = setup({ FILENS_TEST_FAIL_DOWNLOAD: 'yes' });
  assert.equal(rejected.status, 1);
  assert.equal(await readFile(path.join(privateOCR, 'native/libncnn.so'), 'utf8'), 'fixture');
  const unhealthy = setup({ FILENS_TEST_FAIL_HEALTH: 'yes' });
  assert.equal(unhealthy.status, 1);
  assert.match(unhealthy.stderr, /health check/);
  assert.equal(await readFile(path.join(privateOCR, 'native/libncnn.so'), 'utf8'), 'fixture');
  console.log('ZimaOS package verified: ELF/WASM payloads, CDN size, architecture dispatch, Photos OCR reuse, private fallback, mirror switching, checksum rejection and failed-update preservation.');
} finally {
  await rm(work, { recursive: true, force: true });
}
