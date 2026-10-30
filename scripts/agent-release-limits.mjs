import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { executableName, platformPackageName } from './agent-platforms.mjs';

// Executable bytes only: document WASM and optional OCR/preview resources are
// separately measured. Keep every supported native CLI close to 2 MiB.
export const CLI_BINARY_LIMIT = Math.floor(2.2 * 1048576);
export const PREVIEW_PACKAGE_LIMIT = 40 * 1048576;

export function checkAgentReleaseLimits(release, directory) {
  const binaries = release.targets.map(platform => {
    const pkg = release.packages.find(pkg => pkg.name === platformPackageName('cli', platform));
    assert.ok(pkg, `Missing CLI package for ${platform}`);
    const result = spawnSync('tar', ['-xzOf', path.join(directory, pkg.file), `package/${executableName(platform)}`],
      { maxBuffer: 16 << 20 });
    assert.equal(result.status, 0, `Cannot inspect ${platform} executable`);
    const bytes = result.stdout.length;
    assert.ok(bytes > 0 && bytes <= CLI_BINARY_LIMIT,
      `${platform} CLI exceeds the 2.2 MiB executable budget (${bytes} bytes)`);
    return { platform, bytes };
  });
  const preview = release.packages.find(pkg => pkg.name === 'filens-preview');
  if (preview) {
    assert.ok(preview.unpackedBytes > 0 && preview.unpackedBytes <= PREVIEW_PACKAGE_LIMIT,
      'Preview package exceeds the 40 MiB installed budget');
    const listing = spawnSync('tar', ['-tzf', path.join(directory, preview.file)], { encoding: 'utf8' });
    assert.equal(listing.status, 0, 'Cannot inspect preview assets');
    assert.ok(!/ffmpeg-core/i.test(listing.stdout), 'Default preview must not contain the full FFmpeg core');
  }
  return { cliExecutableLimitBytes: CLI_BINARY_LIMIT, binaries,
    previewInstalledLimitBytes: PREVIEW_PACKAGE_LIMIT, previewInstalledBytes: preview?.unpackedBytes ?? null };
}
