import { spawnSync } from 'node:child_process';
import { lstat, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Cargo's encoded form preserves paths containing spaces and existing flags.
export function privateRustBuildEnv(root, env = process.env) {
  const prior = env.CARGO_ENCODED_RUSTFLAGS?.split('\x1f') ?? env.RUSTFLAGS?.trim().split(/\s+/) ?? [];
  const prefixes = [
    [os.homedir(), '/toolchain-cache'],
    [os.tmpdir(), '/build-tmp'],
    ...(env.CARGO_HOME ? [[env.CARGO_HOME, '/cargo-cache']] : []),
    ...(env.RUSTUP_HOME ? [[env.RUSTUP_HOME, '/rust-toolchain']] : []),
    [root, '/filens-source']
  ];
  return { ...env, CARGO_ENCODED_RUSTFLAGS: [...prior.filter(Boolean), ...prefixes.map(([from, to]) => `--remap-path-prefix=${from}=${to}`)].join('\x1f') };
}

export function privacyIssues(bytes) {
  const value = bytes.toString('latin1');
  const issues = [];
  if (/\/Users\/[^/\s\0]+\/|\/home\/(?!web_user(?:\/|\0|$))[^/\s\0]+\/|[A-Za-z]:[\\/]Users[\\/][^\\/\s\0]+[\\/]/.test(value)) issues.push('personal build path');
  if (/X-Amz-(?:Credential|Signature)=|X-Goog-(?:Credential|Signature)=|[?&](?:access_token|api_key|token)=[A-Za-z0-9._~%+/-]{16,}/.test(value)) issues.push('signed URL or access credential');
  if (/-----BEGIN (?:(?:RSA|EC|DSA|OPENSSH|ENCRYPTED) )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{30,}|npm_[A-Za-z0-9]{30,}|hf_[A-Za-z0-9]{30,}|AKIA[A-Z0-9]{16}|sk-(?:proj-)?[A-Za-z0-9_-]{32,})\b/.test(value)) issues.push('secret material');
  return issues;
}

function assertBytes(bytes, name) {
  const issues = privacyIssues(bytes);
  // Never echo the matched path, token, or source contents.
  if (issues.length) throw new Error(`Release privacy check rejected ${name}: ${issues.join(', ')}`);
}

function assertFileName(name) {
  if (/(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.pypirc|\.DS_Store|download-report\.json|private-report\.json)$|\.(?:pdf|docx?|xlsx?|pptx?|log)$/i.test(name)) {
    throw new Error('Release privacy check rejected a document, private report, or local cache file');
  }
}

export async function assertReleaseDirectory(directory) {
  async function visit(current) {
    for (const name of await readdir(current)) {
      const target = path.join(current, name);
      const info = await lstat(target);
      if (info.isDirectory()) await visit(target);
      else if (info.isFile()) {
        const relative = path.relative(directory, target);
        assertFileName(relative);
        assertBytes(await readFile(target), relative);
      }
    }
  }
  await visit(directory);
}

export function assertReleaseArchive(archive) {
  const options = { encoding: null, maxBuffer: 256 << 20 };
  const listing = spawnSync('tar', ['-tzf', archive], options);
  if (listing.status !== 0) throw new Error('Unable to inspect release archive');
  const names = listing.stdout.toString('utf8').trim().split('\n');
  for (const name of names) {
    if (!name.startsWith('package/') || name.split('/').includes('..')) throw new Error('Unexpected release archive entry');
    assertFileName(name);
  }
  const contents = spawnSync('tar', ['-xzOf', archive], options);
  if (contents.status !== 0) throw new Error('Unable to inspect release archive contents');
  assertBytes(contents.stdout, path.basename(archive));
}
