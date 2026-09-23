import JSZip from 'jszip';
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
  const chunks: Uint8Array[] = [];
  for (const [name, content] of Object.entries(files)) {
    const data = new TextEncoder().encode(content);
    const header = new Uint8Array(512);
    writeTarString(header, 0, 100, name);
    writeTarOctal(header, 100, 8, 0o644);
    writeTarOctal(header, 108, 8, 0);
    writeTarOctal(header, 116, 8, 0);
    writeTarOctal(header, 124, 12, data.byteLength);
    writeTarOctal(header, 136, 12, 1_700_000_000);
    header.fill(32, 148, 156);
    header[156] = '0'.charCodeAt(0);
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
