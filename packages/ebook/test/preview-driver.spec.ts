import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createEbookPreviewDriver, createEbookPreviewRoutes, loadCbzBook, loadEpubBook } from '../src';

beforeAll(() => {
  Object.defineProperty(globalThis.URL, 'createObjectURL', {
    value: vi.fn(() => 'blob:epub-fixture'),
    configurable: true
  });
  Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
    value: vi.fn(),
    configurable: true
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('EPUB preview driver', () => {
  it('exposes direct EPUB routes and driver support', () => {
    const routes = createEbookPreviewRoutes();
    const epubRoute = routes.find((route) => route.extensions.includes('epub'));
    const driver = createEbookPreviewDriver();

    expect(epubRoute).toMatchObject({
      targetFormat: 'epub',
      family: 'ebook',
      driverId: 'ebook'
    });
    expect(epubRoute?.conversion).toBeUndefined();
    expect(driver.supports('epub')).toBe(true);
    expect(driver.supports('cbz')).toBe(true);
    expect(driver.supports('.EPUB')).toBe(true);
    expect(driver.supports('mobi')).toBe(false);
  });

  it('parses EPUB metadata and spine chapters', async () => {
    const book = await loadEpubBook(await createEpubFixture());

    expect(book).toMatchObject({
      title: 'Fixture Book',
      chapters: [
        {
          id: 'chapter-1',
          title: 'Chapter One',
          href: 'chapter1.xhtml'
        },
        {
          id: 'chapter-2',
          title: 'Chapter Two',
          href: 'chapter2.xhtml'
        }
      ],
      warnings: []
    });
  });

  it('resolves missing EPUB chapter resources through the resource resolver', async () => {
    const resourceResolver = vi.fn(({ source, relation }) =>
      source === 'OPS/images/cover.png' && relation === 'resource' ? new Uint8Array([137, 80, 78, 71]) : undefined
    );
    const book = await loadEpubBook(
      await createExternalAssetEpubFixture(),
      {
        descriptor: {
          source: new Uint8Array(),
          name: 'external.epub',
          extension: 'epub'
        }
      },
      (blob) => `blob:${blob.type}`,
      resourceResolver
    );

    expect(resourceResolver).toHaveBeenCalledWith(expect.objectContaining({
      family: 'ebook',
      sourceFormat: 'epub',
      source: 'OPS/images/cover.png',
      relation: 'resource',
      name: 'cover.png'
    }));
    expect(book.chapters[0]?.html).toContain('src="data:image/png;base64,iVBORw=="');
  });

  it('renders EPUB chapters into a sandboxed iframe session', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const session = createEbookPreviewDriver().createSession(host);
    const renderedStates: unknown[] = [];

    session.on('rendered', (state) => {
      renderedStates.push(state);
    });

    await session.load(await createEpubFixture(), {
      descriptor: {
        source: new Uint8Array(),
        name: 'book.epub',
        extension: 'epub',
        contentType: 'application/epub+zip'
      },
      route: {
        sourceFormat: 'epub',
        targetFormat: 'epub',
        family: 'ebook',
        driverId: 'ebook'
      }
    });

    expect(session.getState()).toMatchObject({
      family: 'ebook',
      loading: false,
      title: 'Fixture Book',
      chapterIndex: 0,
      chapterCount: 2,
      chapterTitle: 'Chapter One'
    });
    expect(host.querySelectorAll('.ebookv-chapter-tab')).toHaveLength(2);
    const frame = host.querySelector('iframe.ebookv-frame') as HTMLIFrameElement | null;
    expect(frame?.getAttribute('sandbox')).toContain('allow-same-origin');
    expect(frame?.srcdoc).toContain('Chapter One');
    expect(renderedStates).toHaveLength(1);

    session.next?.();
    expect(session.getState()).toMatchObject({
      chapterIndex: 1,
      chapterTitle: 'Chapter Two'
    });
    expect((host.querySelector('iframe.ebookv-frame') as HTMLIFrameElement | null)?.srcdoc).toContain('Chapter Two');

    session.destroy();
    host.remove();
  });

  it('passes resource resolver options through the EPUB session', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const session = createEbookPreviewDriver().createSession(host, {
      resourceResolver: ({ source, relation }) =>
        source === 'OPS/images/cover.png' && relation === 'resource' ? new Uint8Array([137, 80, 78, 71]) : undefined
    });

    await session.load(await createExternalAssetEpubFixture(), {
      descriptor: {
        source: new Uint8Array(),
        name: 'external.epub',
        extension: 'epub',
        contentType: 'application/epub+zip'
      },
      route: {
        sourceFormat: 'epub',
        targetFormat: 'epub',
        family: 'ebook',
        driverId: 'ebook'
      }
    });

    expect((host.querySelector('iframe.ebookv-frame') as HTMLIFrameElement | null)?.srcdoc).toContain(
      'src="data:image/png;base64,iVBORw=="'
    );

    session.destroy();
    host.remove();
  });

  it('parses CBZ image pages in natural filename order', async () => {
    const book = await loadCbzBook(await createCbzFixture(), {
      descriptor: {
        source: new Uint8Array(),
        name: 'comic.cbz',
        extension: 'cbz'
      }
    });

    expect(book).toMatchObject({
      title: 'comic.cbz',
      chapters: [
        {
          id: 'page-1',
          title: 'Page 1',
          href: 'page-1.png'
        },
        {
          id: 'page-2',
          title: 'Page 2',
          href: 'page-2.png'
        },
        {
          id: 'page-3',
          title: 'Page 3',
          href: 'page-10.png'
        }
      ]
    });
  });

  it('renders CBZ image pages through the ebook session', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const session = createEbookPreviewDriver().createSession(host);

    await session.load(await createCbzFixture(), {
      descriptor: {
        source: new Uint8Array(),
        name: 'comic.cbz',
        extension: 'cbz',
        contentType: 'application/vnd.comicbook+zip'
      },
      route: {
        sourceFormat: 'cbz',
        targetFormat: 'cbz',
        family: 'ebook',
        driverId: 'ebook'
      }
    });

    expect(session.getState()).toMatchObject({
      family: 'ebook',
      loading: false,
      title: 'comic.cbz',
      chapterIndex: 0,
      chapterCount: 3,
      chapterTitle: 'Page 1'
    });
    expect(host.querySelectorAll('.ebookv-chapter-tab')).toHaveLength(3);
    expect((host.querySelector('iframe.ebookv-frame') as HTMLIFrameElement | null)?.srcdoc).toContain('blob:epub-fixture');

    session.next?.();
    expect(session.getState()).toMatchObject({
      chapterIndex: 1,
      chapterTitle: 'Page 2'
    });

    session.destroy();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:epub-fixture');
    host.remove();
  });
});

async function createEpubFixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );
  zip.file(
    'OPS/package.opf',
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Fixture Book</dc:title>
  </metadata>
  <manifest>
    <item id="chapter-1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter-2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter-1"/>
    <itemref idref="chapter-2"/>
  </spine>
</package>`
  );
  zip.file('OPS/chapter1.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter One</title></head><body><h1>Chapter One</h1></body></html>');
  zip.file('OPS/chapter2.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter Two</title></head><body><h1>Chapter Two</h1></body></html>');
  return zip.generateAsync({ type: 'uint8array' });
}

async function createExternalAssetEpubFixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );
  zip.file(
    'OPS/package.opf',
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>External Asset Book</dc:title>
  </metadata>
  <manifest>
    <item id="chapter-1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter-1"/>
  </spine>
</package>`
  );
  zip.file(
    'OPS/chapter1.xhtml',
    '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>External Asset</title></head><body><h1>External Asset</h1><img src="images/cover.png"/></body></html>'
  );
  return zip.generateAsync({ type: 'uint8array' });
}

async function createCbzFixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('page-10.png', new Uint8Array([137, 80, 78, 71, 10]));
  zip.file('page-2.png', new Uint8Array([137, 80, 78, 71, 2]));
  zip.file('page-1.png', new Uint8Array([137, 80, 78, 71, 1]));
  zip.file('notes.txt', 'not a comic page');
  return zip.generateAsync({ type: 'uint8array' });
}
