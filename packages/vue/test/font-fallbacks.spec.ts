import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(process.cwd(), '../..');
const uiSources = [
  'apps/demo/src/App.vue',
  'packages/archive/src/styles/index.css',
  'packages/cad/src/preview-driver.ts',
  'packages/core/src/styles/index.css',
  'packages/diagram/src/styles/index.css',
  'packages/ebook/src/preview-driver.ts',
  'packages/ebook/src/styles/index.css',
  'packages/iwork/src/styles/index.css',
  'packages/mindmap/src/styles/index.css',
  'packages/model3d/src/styles/index.css',
  'packages/panorama/src/styles/index.css',
  'packages/vue/src/style.css',
  'packages/xlsx/src/styles/index.css'
] as const;

describe('browser UI font fallbacks', () => {
  it.each(uiSources)('%s uses the cross-platform system font stack', (relativePath) => {
    const source = readFileSync(resolve(repoRoot, relativePath), 'utf8');

    expect(source).toContain('system-ui');
    expect(source).not.toMatch(/Segoe UI\s*,\s*(?:Helvetica\s*,\s*)?Arial/);
  });
});
