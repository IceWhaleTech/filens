import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function readFixture(fileName: string): Promise<Uint8Array> {
  const buffer = await fs.readFile(path.join(ROOT, fileName));
  return new Uint8Array(buffer);
}

export function fixtureExists(fileName: string): boolean {
  return existsSync(path.join(ROOT, fileName));
}
