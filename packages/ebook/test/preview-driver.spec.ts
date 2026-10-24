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
    for (const index of [NaN, Infinity, 0.5]) {
      expect(() => session.goToPage?.(index)).not.toThrow();
      expect(session.getState().chapterIndex).toBe(0);
    }

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

  it('replaces the first chapter when the same session loads another book', async () => {
    const host = document.createElement('div');
    const session = createEbookPreviewDriver().createSession(host);
    const source = await createEpubFixture();
    await session.load(source, { descriptor: { source, extension: 'epub' } });
    const firstFrame = host.querySelector('iframe');
    const comic = await createCbzFixture();
    await session.load(comic, { descriptor: { source: comic, extension: 'cbz' } });

    expect(host.querySelector('iframe')).not.toBe(firstFrame);
    expect(host.querySelector('iframe')?.srcdoc).toContain('alt="Page 1"');
    expect(session.getState().chapterTitle).toBe('Page 1');
    session.destroy();
  });

  it.each(['destroy', 'replace', 'abort'] as const)('discards a pending source read on %s', async (action) => {
    const host = document.createElement('div');
    const session = createEbookPreviewDriver().createSession(host);
    const bytes = await createCbzFixture();
    let finish!: (value: ArrayBuffer) => void;
    const source = new Blob([bytes]);
    source.arrayBuffer = () => new Promise(resolve => { finish = resolve; });
    const controller = new AbortController();
    const rendered = vi.fn();
    session.on('rendered', rendered);
    const pending = session.load(source, { descriptor: { source, extension: 'cbz' }, signal: controller.signal });
    // Attach rejection handling before cancellation.
    const outcome = pending.then(() => undefined, error => error);
    if (action === 'destroy') session.destroy();
    if (action === 'abort') controller.abort();
    if (action === 'replace') {
      const epub = await createEpubFixture();
      await session.load(epub, { descriptor: { source: epub, extension: 'epub' } });
    }
    const createCount = vi.mocked(URL.createObjectURL).mock.calls.length;
    finish(bytes.buffer as ArrayBuffer);
    const error = await outcome;
    if (action === 'abort') expect(error?.name).toBe('AbortError');
    else expect(error).toBeUndefined();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(createCount);
    expect(rendered).toHaveBeenCalledTimes(action === 'replace' ? 1 : 0);
    if (action === 'replace') expect(host.querySelector('iframe')?.srcdoc).toContain('Chapter One');
    else expect(host.querySelector('iframe')).toBeNull();
    session.destroy();
  });

  it('stops after an aborted asynchronous resource resolver without allocating its URL', async () => {
    const source = await createExternalAssetEpubFixture();
    const controller = new AbortController();
    const createUrl = vi.fn(() => 'blob:late-resource');
    await expect(loadEpubBook(source, { descriptor: { source }, signal: controller.signal }, createUrl, async () => {
      controller.abort();
      return new Blob(['late'], { type: 'image/png' });
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(createUrl).not.toHaveBeenCalled();
  });

  it('reports an idle state immediately when a pending resource lookup is cancelled', async () => {
    const source = await createExternalAssetEpubFixture(), host = document.createElement('div');
    let release!: (value: undefined) => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const session = createEbookPreviewDriver().createSession(host, { resourceResolver: () => {
      entered(); return new Promise(resolve => { release = resolve; });
    } });
    const controller = new AbortController(), states: boolean[] = [];
    session.on('statechange', state => states.push(state.loading));
    const pending = session.load(source, { descriptor: { source, extension: 'epub' }, signal: controller.signal })
      .then(() => 'done', error => error.name);
    await started; controller.abort();
    expect(states.at(-1)).toBe(false); expect(host.querySelector('iframe')).toBeNull();
    release(undefined); expect(await pending).toBe('AbortError'); session.destroy();
  });

  it.each([loadEpubBook, loadCbzBook])('rejects an already cancelled source before reading it', async load => {
    const source = new Blob([]);
    source.arrayBuffer = vi.fn();
    const controller = new AbortController(); controller.abort();
    await expect(load(source, { descriptor: { source }, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(source.arrayBuffer).not.toHaveBeenCalled();
  });

  it('stops allocating CBZ pages when its URL callback cancels the load', async () => {
    const source = await createCbzFixture();
    const controller = new AbortController();
    const createUrl = vi.fn(() => { controller.abort(); return 'blob:first-page'; });
    await expect(loadCbzBook(source, { descriptor: { source }, signal: controller.signal }, createUrl)).rejects.toMatchObject({ name: 'AbortError' });
    expect(createUrl).toHaveBeenCalledTimes(1);
  });

  it('releases partial resources when a chapter resource fails', async () => {
    const zip = await JSZip.loadAsync(await createExternalAssetEpubFixture());
    const html = await zip.file('OPS/chapter1.xhtml')!.async('text');
    zip.file('OPS/chapter1.xhtml', html.replace('</body>', '<img src="missing.png"/></body>'));
    const source = await zip.generateAsync({ type: 'uint8array' });
    const host = document.createElement('div');
    const session = createEbookPreviewDriver().createSession(host, {
      resourceResolver: ({ source }) => {
        if (source.endsWith('missing.png')) throw new Error('Resource failed');
        return new Blob(['image'], { type: 'image/png' });
      }
    });
    const revokeCount = vi.mocked(URL.revokeObjectURL).mock.calls.length;
    await expect(session.load(source, { descriptor: { source, extension: 'epub' } })).rejects.toThrow('Resource failed');
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(revokeCount + 1);
    expect(session.getState()).toMatchObject({ loading: false, error: 'Resource failed', chapterCount: 0 });
    expect(host.querySelector('iframe')).toBeNull();
    session.destroy();
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
