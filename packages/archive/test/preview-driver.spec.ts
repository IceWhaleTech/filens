import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  createArchiveResourceIndex,
  createArchivePreviewDriver,
  createArchivePreviewRoutes,
  createZipArchiveResourceIndex,
  createZipResourceResolver
} from '../src';

describe('Archive preview driver', () => {
  it.each(['pax', 'gnu'])('reads a %s archive written by Python tarfile', async format => {
    const bytes = await readFile(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', `${format}-long-path.tar`));
    const index = await createArchiveResourceIndex(bytes, createLoadContext(`${format}.tar`));
    const path = `目录/${'long-file-name-'.repeat(12)}预览.txt`;
    expect(index.files.map(entry => entry.name)).toEqual(expect.arrayContaining([path, 'next.txt']));
    expect(index.files).toHaveLength(2);
    await expect(index.read(path)?.readAsText()).resolves.toBe('Long path preview: 中文内容\n');
    await expect(index.read('next.txt')?.readAsText()).resolves.toBe('Next entry\n');
  });

  it('exposes supported read-only archive routes', () => {
    const routes = createArchivePreviewRoutes();
    const zipRoute = routes.find((route) => route.extensions.includes('zip'));
    const driver = createArchivePreviewDriver();

    expect(zipRoute).toMatchObject({
      targetFormat: 'zip',
      family: 'archive',
      driverId: 'archive'
    });
    expect(zipRoute?.conversion).toBeUndefined();
    expect(driver.supports('zip')).toBe(true);
    expect(driver.supports('.ZIP')).toBe(true);
    expect(driver.supports('tar')).toBe(true);
    expect(driver.supports('tgz')).toBe(true);
    expect(driver.supports('gz')).toBe(true);
    expect(driver.supports('jar')).toBe(true);
    expect(driver.supports('rar')).toBe(false);
  });

  it('lists and extracts TAR, TGZ, and single-file GZIP entries', async () => {
    const tar = createTarFixture({
      'docs/readme.txt': 'Archive preview',
      'data/value.json': '{"ok":true}'
    });
    const tarIndex = await createArchiveResourceIndex(tar, createLoadContext('sample.tar'));
    const tgzIndex = await createArchiveResourceIndex(gzipSync(tar), createLoadContext('sample.tar.gz'));
    const gzipIndex = await createArchiveResourceIndex(gzipSync(new TextEncoder().encode('plain text')), createLoadContext('note.txt.gz'));

    expect(tarIndex.files.map((entry) => entry.name)).toEqual(['data/value.json', 'docs/readme.txt']);
    await expect(tarIndex.read('readme.txt')?.readAsText()).resolves.toBe('Archive preview');
    await expect(tgzIndex.read('data/value.json')?.readAsText()).resolves.toBe('{"ok":true}');
    expect(gzipIndex.files.map((entry) => entry.name)).toEqual(['note.txt']);
    await expect(gzipIndex.files[0]?.readAsText()).resolves.toBe('plain text');
  });

  it.each(['pax', 'gnu'])('reads long Unicode %s paths without leaking metadata to the next file', async format => {
    const path = `目录/${'long-segment/'.repeat(20)}预览.txt`;
    const extension = format === 'pax'
      ? { name: 'PaxHeaders/file', type: 'x', content: paxRecord('path', path) + paxRecord('mtime', '1700000000.125') }
      : { name: '././@LongLink', type: 'L', content: `${path}\0` };
    const tar = createTarRecords([extension,
      { name: 'truncated.txt', content: 'Long path preview' },
      { name: 'next.txt', content: 'Next file' }
    ]);
    for (const gzip of [false, true]) {
      const index = await createArchiveResourceIndex(gzip ? gzipSync(tar) : tar, createLoadContext(gzip ? 'long.tgz' : 'long.tar'));
      expect(index.files.map(entry => entry.name)).toEqual(expect.arrayContaining([path, 'next.txt']));
      expect(index.files).toHaveLength(2);
      await expect(index.read(path)?.readAsText()).resolves.toBe('Long path preview');
      await expect(index.read('next.txt')?.readAsText()).resolves.toBe('Next file');
      expect(index.read(path)?.size).toBe(17);
      expect(index.read(path)?.modified).toBe(format === 'pax' ? 1_700_000_000_125 : 1_700_000_000_000);
      expect(index.read('next.txt')?.modified).toBe(1_700_000_000_000);
    }
  });

  it('applies and clears global/local PAX values while respecting extended file sizes', async () => {
    const tar = createTarRecords([
      { name: 'Global', type: 'g', content: paxRecord('mtime', '123.5') + paxRecord('comment', 'unknown field') },
      { name: 'Local', type: 'x', content: paxRecord('path', 'actual.txt') + paxRecord('size', '4') },
      { name: 'short.txt', content: 'data', headerSize: 1 },
      { name: 'inherited.txt', content: 'Inherited' },
      { name: 'Local', type: 'x', content: paxRecord('mtime', '') },
      { name: 'local-default.txt', content: 'Local reset' },
      { name: 'Global', type: 'g', content: paxRecord('mtime', '') },
      { name: 'global-default.txt', content: 'Global reset' }
    ]);
    const index = await createArchiveResourceIndex(tar, createLoadContext('pax.tar'));
    expect(index.files).toHaveLength(4);
    await expect(index.read('actual.txt')?.readAsText()).resolves.toBe('data');
    expect(index.read('actual.txt')?.size).toBe(4);
    expect(index.read('actual.txt')?.modified).toBe(123_500);
    expect(index.read('inherited.txt')?.modified).toBe(123_500);
    expect(index.read('local-default.txt')?.modified).toBe(1_700_000_000_000);
    expect(index.read('global-default.txt')?.modified).toBe(1_700_000_000_000);
  });

  it('consumes local PAX metadata even for an unsupported symbolic-link entry', async () => {
    const tar = createTarRecords([
      { name: 'Local', type: 'x', content: paxRecord('path', 'link.txt') },
      { name: 'link', type: '2', content: '' },
      { name: 'actual.txt', content: 'Actual file' }
    ]);
    const index = await createArchiveResourceIndex(tar, createLoadContext('link.tar'));
    expect(index.files.map(entry => entry.name)).toEqual(['actual.txt']);
  });

  it.each(['99 path=a\n', '0 path=a\n', '-1 path=a\n', '12 invalid!\n',
    paxRecord('size', '-1'), paxRecord('size', '1.5'), paxRecord('mtime', 'NaN')
  ])('rejects malformed or truncated PAX metadata: %j', async content => {
    const tar = createTarRecords([{ name: 'PaxHeader', type: 'x', content }, { name: 'data.txt', content: 'data' }]);
    await expect(createArchiveResourceIndex(tar, createLoadContext('bad-pax.tar'))).rejects.toThrow('TAR');
  });

  it('renders ZIP entries into an archive table', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const session = createArchivePreviewDriver().createSession(host);
    const renderedStates: unknown[] = [];

    session.on('rendered', (state) => {
      renderedStates.push(state);
    });

    await session.load(await createZipFixture(), {
      descriptor: {
        source: new Uint8Array(),
        name: 'sample.zip',
        extension: 'zip',
        contentType: 'application/zip'
      },
      route: {
        sourceFormat: 'zip',
        targetFormat: 'zip',
        family: 'archive',
        driverId: 'archive'
      }
    });

    expect(session.getState()).toMatchObject({
      family: 'archive',
      loading: false,
      entries: [
        {
          name: 'docs/',
          type: 'directory'
        },
        {
          name: 'image.png',
          type: 'file'
        }
      ]
    });
    expect(host.querySelector('.archivev-summary')?.textContent).toContain('2 items');
    expect(host.querySelector('.archivev-table')?.textContent).toContain('docs/');
    expect(renderedStates).toHaveLength(1);

    const docsRow = Array.from(host.querySelectorAll<HTMLTableRowElement>('tr.archivev-row')).find((row) =>
      row.textContent?.includes('docs/')
    );
    docsRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(session.getState()).toMatchObject({
      route: '/docs/',
      entries: [
        {
          name: 'readme.txt',
          type: 'file'
        }
      ]
    });
    expect(host.querySelector('.archivev-summary')?.textContent).toContain('sample.zip›docs');
    expect(host.querySelector('.archivev-summary')?.textContent).not.toContain('/docs/');
    expect(host.querySelector('.archivev-table')?.textContent).toContain('readme.txt');

    const readmeRow = Array.from(host.querySelectorAll<HTMLTableRowElement>('tr.archivev-row')).find((row) =>
      row.textContent?.includes('readme.txt')
    );
    readmeRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(host.querySelector('.archivev-entry-text')?.textContent).toContain('Archive preview');
    expect(host.querySelector('.archivev-breadcrumbs')?.textContent).toContain('docs');
    const docsBreadcrumb = Array.from(host.querySelectorAll<HTMLButtonElement>('.archivev-breadcrumb')).find((button) =>
      button.textContent === 'docs'
    );
    expect(docsBreadcrumb?.disabled).toBe(false);
    docsBreadcrumb?.click();
    expect(host.querySelector('.archivev-table')?.textContent).toContain('readme.txt');

    const archiveBreadcrumb = Array.from(host.querySelectorAll<HTMLButtonElement>('.archivev-breadcrumb')).find((button) =>
      button.textContent === 'sample.zip'
    );
    expect(archiveBreadcrumb?.disabled).toBe(false);
    archiveBreadcrumb?.click();
    expect(session.getState()).toMatchObject({ route: '/' });
    expect(host.querySelector<HTMLButtonElement>('.archivev-breadcrumb')?.disabled).toBe(true);

    session.destroy();
    host.remove();
  });

  it('browses deep TAR directories while preserving duplicate files and directory metadata', async () => {
    const host = document.createElement('div');
    const session = createArchivePreviewDriver().createSession(host);
    const tar = createTarRecords([
      { name: 'docs/deep/child/z.txt', content: 'z' },
      { name: 'docs/deep/child/a.txt', content: 'a' },
      { name: 'docs/deep/report.txt', content: 'first' },
      { name: 'docs/deep/report.txt', content: 'second with a different size' },
      { name: 'docs/deep/child/', type: '5', content: '' },
      { name: 'docs/other/文档.txt', content: 'other' },
      { name: 'docs/deepish/unrelated.txt', content: 'unrelated' },
      { name: 'empty/', type: '5', content: '' }
    ]);
    try {
      await session.load(tar, createLoadContext('deep.tar'));
      const visit = (name: string) => {
        const row = [...host.querySelectorAll('tr.archivev-row')].find(row => row.querySelector('td')?.textContent === name);
        expect(row, name).toBeDefined();
        row!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      };
      visit('docs/');
      expect(session.getState().entries.map(entry => entry.name)).toEqual(['deep/', 'deepish/', 'other/']);
      visit('deep/');
      expect(session.getState().entries).toEqual([
        { name: 'child/', type: 'directory', modified: 1_700_000_000_000 },
        { name: 'report.txt', type: 'file', size: 5, modified: 1_700_000_000_000 }
      ]);
      visit('child/');
      expect(session.getState().entries.map(entry => entry.name)).toEqual(['a.txt', 'z.txt']);
      const docs = [...host.querySelectorAll('button.archivev-breadcrumb')].find(button => button.textContent === 'docs');
      docs!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      visit('other/');
      expect(session.getState().entries.map(entry => entry.name)).toEqual(['文档.txt']);
      const root = host.querySelector('button.archivev-breadcrumb')!;
      root.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      visit('empty/');
      expect(session.getState().entries).toEqual([]);
    } finally { session.destroy(); }
  });

  it('creates a ZIP-backed resource resolver for compound preview sidecars', async () => {
    const zip = new JSZip();
    zip.file('scene/scene.gltf', '{}');
    zip.file('scene/buffers/model.bin', new Uint8Array([1, 2, 3]));
    zip.file('scene/textures/diffuse.png', new Uint8Array([137, 80, 78, 71]));
    const resolver = await createZipResourceResolver(await zip.generateAsync({ type: 'uint8array' }), createLoadContext(), {
      root: 'scene'
    });

    await expect(resolveBytes(resolver, 'buffers/model.bin')).resolves.toEqual([1, 2, 3]);
    await expect(resolveBytes(resolver, 'scene/textures/diffuse.png?v=1#preview')).resolves.toEqual([137, 80, 78, 71]);
    await expect(resolveBytes(resolver, 'C:\\uploads\\diffuse.png')).resolves.toEqual([137, 80, 78, 71]);
  });

  it('does not resolve ambiguous basename matches', async () => {
    const zip = new JSZip();
    zip.file('a/shared.png', new Uint8Array([1]));
    zip.file('b/shared.png', new Uint8Array([2]));
    const index = await createZipArchiveResourceIndex(await zip.generateAsync({ type: 'uint8array' }), createLoadContext());

    expect(index.read('shared.png')).toBeUndefined();
    await expect(resolveBytes(index.resolve, 'a/shared.png')).resolves.toEqual([1]);
  });

  it('preserves rooted, encoded, Unicode and Windows resource paths in a shared index', async () => {
    const zip = new JSZip();
    zip.file('scene/目录/空 格.txt', '中文');
    zip.file('scene/encoded%20asset.json', '{}');
    zip.file('scene/textures/shared.png', new Uint8Array([1]));
    zip.file('other/shared.png', new Uint8Array([2]));
    zip.file('scene\\buffers\\model.bin', new Uint8Array([3, 4]), { createFolders: false });
    const index = await createArchiveResourceIndex(await zip.generateAsync({ type: 'uint8array' }), createLoadContext(), {
      root: './scene/', contentTypes: { 'scene/目录/空 格.txt': 'text/custom', json: 'application/custom+json' }
    });
    await expect(index.read('https://example.test/scene/目录/空%20格.txt?v=1#preview')?.readAsText()).resolves.toBe('中文');
    await expect(index.read('目录/空 格.txt')?.readAsText()).resolves.toBe('中文');
    await expect(index.read('encoded%20asset.json')?.readAsText()).resolves.toBe('{}');
    await expect(index.read('buffers/model.bin')?.readAsArrayBuffer()).resolves.toEqual(new Uint8Array([3, 4]).buffer);
    expect(index.read('空 格.txt')?.contentType).toBe('text/custom');
    expect(index.read('encoded asset.json')?.contentType).toBe('application/custom+json');
    expect(index.read('shared.png')).toBeUndefined();
    await expect(resolveBytes(index.resolve, 'textures/shared.png')).resolves.toEqual([1]);
    await expect(resolveBytes(index.resolve, 'other/shared.png')).resolves.toEqual([2]);
    expect(index.entries.map(entry => entry.type).slice(0, 4)).toEqual(Array(4).fill('directory'));
  });

  it('keeps extracted buffers independent from cached archive contents', async () => {
    const index = await createArchiveResourceIndex(await createZipFixture(), createLoadContext());
    const entry = index.read('docs/readme.txt')!;
    const bytes = new Uint8Array(await entry.readAsArrayBuffer());
    bytes.fill(0);
    await expect(entry.readAsText()).resolves.toBe('Archive preview');
    expect(new Uint8Array(await entry.readAsArrayBuffer())[0]).toBe('A'.charCodeAt(0));
  });

  it('can return blobs with inferred content types', async () => {
    const zip = new JSZip();
    zip.file('textures/diffuse.png', new Uint8Array([1, 2, 3]));
    const resolver = await createZipResourceResolver(await zip.generateAsync({ type: 'uint8array' }), createLoadContext(), {
      preferBlob: true
    });

    const result = await resolver({ source: 'textures/diffuse.png' });
    const blob = result && typeof result === 'object' && 'source' in result ? result.source : result;
    expect(blob).toBeInstanceOf(Blob);
    expect((blob as Blob).type).toBe('image/png');
  });

  it('can browse nested ZIP entries', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const session = createArchivePreviewDriver().createSession(host);
    let renderedCount = 0;
    let resolveNestedRendered: (() => void) | undefined;
    const nestedRendered = new Promise<void>((resolve) => {
      resolveNestedRendered = resolve;
    });

    session.on('rendered', () => {
      renderedCount += 1;
      if (renderedCount === 2) {
        resolveNestedRendered?.();
      }
    });

    await session.load(await createNestedZipFixture(), {
      descriptor: {
        source: new Uint8Array(),
        name: 'outer.zip',
        extension: 'zip',
        contentType: 'application/zip'
      },
      route: {
        sourceFormat: 'zip',
        targetFormat: 'zip',
        family: 'archive',
        driverId: 'archive'
      }
    });

    expect(session.getState()).toMatchObject({
      route: '/',
      entries: [
        {
          name: 'inner.zip',
          type: 'file'
        }
      ]
    });

    const innerRow = Array.from(host.querySelectorAll<HTMLTableRowElement>('tr.archivev-row')).find((row) =>
      row.textContent?.includes('inner.zip')
    );
    innerRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await nestedRendered;

    expect(session.getState()).toMatchObject({
      route: '/',
      entries: [
        {
          name: 'inside.txt',
          type: 'file'
        }
      ]
    });
    expect(host.querySelector('.archivev-summary')?.textContent).toContain('inner.zip');

    session.destroy();
    host.remove();
  });
});

async function createZipFixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.folder('docs');
  zip.file('docs/readme.txt', 'Archive preview');
  zip.file('image.png', new Uint8Array([137, 80, 78, 71]));
  return zip.generateAsync({ type: 'uint8array' });
}

async function createNestedZipFixture(): Promise<Uint8Array> {
  const inner = new JSZip();
  inner.file('inside.txt', 'Nested archive');
  const innerBytes = await inner.generateAsync({ type: 'uint8array' });

  const outer = new JSZip();
  outer.file('inner.zip', innerBytes);
  return outer.generateAsync({ type: 'uint8array' });
}

function createLoadContext(name = 'bundle.zip') {
  const extension = name.toLowerCase().endsWith('.tar.gz') ? 'gz' : name.split('.').pop() ?? '';
  return {
    descriptor: {
      source: new Uint8Array(),
      name,
      extension,
      contentType: extension === 'zip' ? 'application/zip' : undefined
    },
    route: {
      sourceFormat: extension,
      targetFormat: extension,
      family: 'archive' as const,
      driverId: 'archive'
    }
  };
}

function createTarFixture(files: Record<string, string>): Uint8Array {
  return createTarRecords(Object.entries(files).map(([name, content]) => ({ name, content })));
}

function paxRecord(key: string, value: string): string {
  const content = ` ${key}=${value}\n`;
  let length = new TextEncoder().encode(content).length + 1;
  while (String(length).length + new TextEncoder().encode(content).length !== length) {
    length = String(length).length + new TextEncoder().encode(content).length;
  }
  return `${length}${content}`;
}

function createTarRecords(files: Array<{ name: string; content: string; type?: string; headerSize?: number }>): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const { name, content, type = '0', headerSize } of files) {
    const data = new TextEncoder().encode(content);
    const header = new Uint8Array(512);
    writeTarString(header, 0, 100, name);
    writeTarOctal(header, 100, 8, 0o644);
    writeTarOctal(header, 108, 8, 0);
    writeTarOctal(header, 116, 8, 0);
    writeTarOctal(header, 124, 12, headerSize ?? data.byteLength);
    writeTarOctal(header, 136, 12, 1_700_000_000);
    header.fill(32, 148, 156);
    header[156] = type.charCodeAt(0);
    writeTarString(header, 257, 6, 'ustar');
    writeTarString(header, 263, 2, '00');
    writeTarOctal(header, 148, 8, header.reduce((sum, value) => sum + value, 0));
    chunks.push(header, data, new Uint8Array((512 - data.byteLength % 512) % 512));
  }
  chunks.push(new Uint8Array(1024));
  const result = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function writeTarString(target: Uint8Array, offset: number, length: number, value: string): void {
  target.set(new TextEncoder().encode(value).subarray(0, length), offset);
}

function writeTarOctal(target: Uint8Array, offset: number, length: number, value: number): void {
  writeTarString(target, offset, length, `${value.toString(8).padStart(length - 2, '0')}\0 `);
}

async function resolveBytes(
  resolver: Awaited<ReturnType<typeof createZipResourceResolver>>,
  source: string
): Promise<number[] | undefined> {
  const result = await resolver({ source, name: source.split(/[\\/]/).pop() });
  const resolvedSource = result && typeof result === 'object' && 'source' in result ? result.source : result;
  if (resolvedSource instanceof ArrayBuffer) {
    return [...new Uint8Array(resolvedSource)];
  }
  if (ArrayBuffer.isView(resolvedSource)) {
    return [...new Uint8Array(resolvedSource.buffer, resolvedSource.byteOffset, resolvedSource.byteLength)];
  }
  return undefined;
}
