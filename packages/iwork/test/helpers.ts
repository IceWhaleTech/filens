import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function readFixture(fileName: string): Promise<Uint8Array> {
  const buffer = await fs.readFile(path.join(ROOT, fileName));
  return new Uint8Array(buffer);
}
