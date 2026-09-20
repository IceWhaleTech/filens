import fs from 'node:fs/promises';
import path from 'node:path';

const [, , directory, fromName, toName] = process.argv;

if (!directory || !fromName || !toName) {
  process.exit(0);
}

const fromPath = path.join(directory, fromName);
const toPath = path.join(directory, toName);

try {
  await fs.access(fromPath);
  await fs.rename(fromPath, toPath);
} catch {
  process.exit(0);
}
