import { existsSync } from 'node:fs';
import path from 'node:path';

export const supportedPlatforms = ['darwin-arm64','linux-x64','linux-arm64','win32-x64'];
// Public entry points stay unscoped. Windows implementation packages live in
// the publisher's namespace; npm rejected their unscoped names as spam.
export const platformPackageName = (kind, platform) => `${platform.startsWith('win32-') ? '@orca.zhang/' : ''}filens-${kind}-${platform}`;
export const executableName = platform => platform.startsWith('win32-') ? 'filens.exe' : 'filens';
export const ocrLibraryName = platform => platform.startsWith('win32-') ? 'zima_ncnn_runtime_v7.dll' : platform.startsWith('darwin-') ? 'libzima_ncnn_runtime_v7.dylib' : 'libzima_ncnn_runtime_v7.so';

export function releaseTargets(args) {
  const selected = [];
  for (let i=0;i<args.length;i++) if (args[i] === '--platform') {
    if (!args[i+1]) throw new Error('--platform needs a value');
    selected.push(...args[++i].split(','));
  }
  if (args.includes('--all') && selected.length) throw new Error('Choose --all or --platform');
  const targets = args.includes('--all') ? supportedPlatforms : selected.length ? [...new Set(selected)] : [`${process.platform}-${process.arch}`];
  if (targets.some(p=>!supportedPlatforms.includes(p))) throw new Error(`Supported release targets: ${supportedPlatforms.join(', ')}`);
  return targets;
}

// Execute npm's JavaScript entry directly on Windows. Spawning npm.cmd without
// a shell fails; using a shell would reinterpret paths and arguments.
export function npmInvocation(args) {
  if (process.platform !== 'win32') return {command:'npm',args};
  const candidates = [process.env.npm_execpath,...[path.dirname(process.execPath),...(process.env.PATH??'').split(path.delimiter)].map(dir=>path.join(dir,'node_modules/npm/bin/npm-cli.js'))];
  const cli = candidates.find(file=>file?.endsWith('npm-cli.js') && existsSync(file));
  if (!cli) throw new Error('Cannot locate npm-cli.js; use the standard Node.js installation or set npm_execpath');
  return {command:process.execPath,args:[cli,...args]};
}
