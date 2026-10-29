import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertReleaseArchive, assertReleaseDirectory, privacyIssues, privateRustBuildEnv } from './agent-release-privacy.mjs';

test('remap compiler paths without losing existing flags or paths containing spaces', () => {
  const env = privateRustBuildEnv('/example/work tree', { RUSTFLAGS: '-C opt-level=z' });
  assert.deepEqual(env.CARGO_ENCODED_RUSTFLAGS.split('\x1f').slice(0, 2), ['-C', 'opt-level=z']);
  assert.ok(env.CARGO_ENCODED_RUSTFLAGS.split('\x1f').includes('--remap-path-prefix=/example/work tree=/filens-source'));
  assert.ok(env.CARGO_ENCODED_RUSTFLAGS.includes('--remap-path-prefix=' + os.homedir() + '=/toolchain-cache'));
});

test('detect personal paths and credentials without treating normal URLs or virtual paths as personal', () => {
  const personal = ['', 'Users', 'fixture-user', 'registry', 'parser.rs'].join('/');
  assert.deepEqual(privacyIssues(Buffer.from('panic at ' + personal)), ['personal build path']);
  const signed = 'https://example.com/file?X-Amz-' + 'Signature=' + 'a'.repeat(64);
  assert.deepEqual(privacyIssues(Buffer.from(signed)), ['signed URL or access credential']);
  assert.deepEqual(privacyIssues(Buffer.from('ghp' + '_' + 'a'.repeat(36))), ['secret material']);
  for (const prefix of ['npm', 'hf']) assert.deepEqual(privacyIssues(Buffer.from(prefix + '_' + 'a'.repeat(36))), ['secret material']);
  assert.deepEqual(privacyIssues(Buffer.from(['-----BEGIN', 'ENCRYPTED PRIVATE KEY-----'].join(' '))), ['secret material']);
  assert.deepEqual(privacyIssues(Buffer.from('https://github.com/project/parser /filens-source/src/text.rs /home/web_user/runtime')), []);
});

test('release directory and tarball checks reject a binary containing private build paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'filens-privacy-test-'));
  try {
    const directory = path.join(root, 'package');
    await mkdir(directory);
    const binary = path.join(directory, 'converter-text.wasm');
    await writeFile(binary, Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
    await assertReleaseDirectory(directory);
    const archive = path.join(root, 'package.tgz');
    assert.equal(spawnSync('tar', ['-czf', archive, '-C', root, 'package']).status, 0);
    assertReleaseArchive(archive);
    const personal = ['', 'Users', 'fixture-user', 'registry', 'parser.rs'].join('/');
    await writeFile(binary, '\0asm\0' + personal);
    await assert.rejects(assertReleaseDirectory(directory), error => error.message.includes('personal build path') && !error.message.includes('fixture-user'));
    assert.equal(spawnSync('tar', ['-czf', archive, '-C', root, 'package']).status, 0);
    assert.throws(() => assertReleaseArchive(archive), /personal build path/);
    await rm(binary);
    await writeFile(path.join(directory, 'sample.pdf'), 'synthetic private document');
    await assert.rejects(assertReleaseDirectory(directory), /document, private report/);
    await rm(path.join(directory, 'sample.pdf'));
    await writeFile(path.join(directory, '.npmrc'), 'registry=https://registry.npmjs.org/');
    await assert.rejects(assertReleaseDirectory(directory), /local cache file/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
