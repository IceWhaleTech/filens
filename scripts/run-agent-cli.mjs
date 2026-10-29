import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const lite = args[0] === '--lite';
if (lite) args.shift();
const command = path.join(root, 'dist', ...(lite ? ['agent-lite'] : []), process.platform === 'win32' ? 'filens.exe' : 'filens');
const child = spawn(command, args, { stdio: 'inherit', env: process.env });
child.on('error', error => {
  console.error(error.code === 'ENOENT' ? `Build the local agent bundle first: npm run build:agent${lite ? ':lite' : ''}` : error.message);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
