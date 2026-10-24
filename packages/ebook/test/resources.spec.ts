import JSZip from 'jszip';
import { Blob as NodeBlob } from 'node:buffer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadEpubBook } from '../src';
import { rewriteCssResources } from '../src/css-resources';
import { createBookFixture, createStyledBookFixture } from './fixtures/books.mjs';

// jsdom's Blob omits the browser text/arrayBuffer methods used by stylesheet decoding.
beforeAll(() => vi.stubGlobal('Blob', NodeBlob));
afterAll(() => vi.unstubAllGlobals());

describe('EPUB resource paths', () => {
  it('rewrites nested CSS, inline styles, encoded paths and SVG references', async () => {
    const blobs: Blob[] = [];
    const book = await loadEpubBook(await createStyledBookFixture(), undefined, blob => {
      blobs.push(blob); return `blob:fixture-${blobs.length}`;
    });
    expect(book.chapters.map(chapter => chapter.title)).toEqual(['First chapter', 'Last chapter']);
    expect(book.warnings).toEqual(['Skipped circular EPUB stylesheet import: OPS/styles/main.css.']);
    const texts = await Promise.all(blobs.map(blob => blob.text()));
    const css = texts.find(text => text.includes('@font-face'))!;
    expect(css).toContain('@import "blob:fixture-'); expect(css).toContain(' screen;');
    expect(css).not.toContain('?version='); expect(css).toContain('#face'); expect(css).toContain('#scene');
    expect(css).toContain('content:"url(../not-a-resource.svg)"');
    expect(css).toContain('/* url(../also-not-a-resource.svg) */');
    expect(css).not.toContain('url(../images/paren');
    expect(texts.some(text => text.includes('@import "data:text/css,";'))).toBe(true);
    expect(blobs.filter(blob => blob.type.startsWith('text/css'))).toHaveLength(3);
    expect(blobs.filter(blob => blob.type === 'font/woff')).toHaveLength(1);
    for (const chapter of book.chapters) {
      const document = new DOMParser().parseFromString(chapter.html, 'text/html');
      expect(document.querySelector('style')?.textContent).toContain('url("blob:fixture-');
      expect(document.querySelector('[style]')?.getAttribute('style')).toContain('url("blob:fixture-');
      expect(document.querySelector('svg image')?.getAttribute('xlink:href')).toMatch(/^blob:fixture-/);
      expect(document.querySelector('img')?.getAttribute('src')).toMatch(/^blob:fixture-\d+$/);
    }
  });

  it('resolves each missing path once across chapters and leaves external URLs untouched', async () => {
    const zip = await JSZip.loadAsync(await createBookFixture(12, 1));
    for (let index = 1; index <= 12; index++) {
      const file = zip.file(`OPS/chapter-${index}.xhtml`)!;
      zip.file(file.name, (await file.async('text')).replace('</body>', '<img src="images/shared.svg"/><img src="images/missing.svg"/><a href="//cdn.example.test/help">Help</a></body>'));
    }
    const resolver = vi.fn(({ source }) => source === 'OPS/images/shared.svg' ? new Blob(['<svg/>'], { type: 'image/svg+xml' }) : undefined);
    const createUrl = vi.fn(() => 'blob:shared');
    const book = await loadEpubBook(await zip.generateAsync({ type: 'uint8array' }), undefined, createUrl, resolver);
    expect(resolver).toHaveBeenCalledTimes(2); expect(createUrl).toHaveBeenCalledTimes(1);
    for (const chapter of book.chapters) {
      expect(chapter.html).toContain('src="blob:shared"');
      expect(chapter.html).toContain('href="//cdn.example.test/help"');
    }
  });

  it.each(['declaration', 'header', 'bom'])('rewrites resolver CSS with %s encoding and resolves imports from its directory', async encoding => {
    const zip = await JSZip.loadAsync(await createStyledBookFixture()); zip.remove('OPS/styles/main.css');
    const before = (encoding === 'declaration' ? '@charset "windows-1252";' : '') + '.cover{content:"caf';
    const after = '";background:url("../images/sky%20blue.svg")}@import "extra.css";';
    const cssBytes = encoding === 'bom' ? new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(before + 'é' + after)])
      : new Uint8Array([...new TextEncoder().encode(before), 0xe9, ...new TextEncoder().encode(after)]);
    const resolver = vi.fn(({ source }) => source === 'OPS/styles/main.css'
      ? { source: new Blob([cssBytes], { type: encoding === 'declaration' ? 'text/css' : 'text/css;charset=windows-1252' }) }
      : source === 'OPS/styles/extra.css' ? new TextEncoder().encode('.extra{color:red}') : undefined);
    const blobs: Blob[] = [];
    await loadEpubBook(await zip.generateAsync({ type: 'uint8array' }), undefined, blob => {
      blobs.push(blob); return `blob:fixture-${blobs.length}`;
    }, resolver);
    const css = await Promise.all(blobs.filter(blob => blob.type.startsWith('text/css')).map(blob => blob.text()));
    expect(css.some(text => text.includes('café') && text.includes('url("blob:fixture-'))).toBe(true);
    expect(css.some(text => text === '.extra{color:red}')).toBe(true);
    expect(resolver.mock.calls.filter(([request]) => request.source === 'OPS/styles/main.css')).toHaveLength(1);
    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({ source: 'OPS/styles/extra.css', relation: 'stylesheet' }));
  });

  it('does not resolve imports from stylesheets that no chapter uses', async () => {
    const zip = await JSZip.loadAsync(await createBookFixture(1, 1));
    const manifest = zip.file('OPS/package.opf')!;
    zip.file(manifest.name, (await manifest.async('text')).replace('</manifest>', '<item id="unused" href="unused.css" media-type="text/css"/></manifest>'));
    zip.file('OPS/unused.css', '@import "missing.css";');
    const resolver = vi.fn(() => { throw new Error('Unused import must not be requested'); }), createUrl = vi.fn();
    const book = await loadEpubBook(await zip.generateAsync({ type: 'uint8array' }), undefined, createUrl, resolver);
    expect(book.chapters).toHaveLength(1); expect(resolver).not.toHaveBeenCalled(); expect(createUrl).not.toHaveBeenCalled();
  });

  it('stops before allocating a late stylesheet when its resolver cancels', async () => {
    const zip = await JSZip.loadAsync(await createStyledBookFixture()); zip.remove('OPS/styles/main.css');
    const source = await zip.generateAsync({ type: 'uint8array' }), controller = new AbortController();
    const createUrl = vi.fn(() => 'blob:fixture'); let allocatedAtAbort = -1;
    await expect(loadEpubBook(source, { descriptor: { source }, signal: controller.signal }, createUrl, () => {
      allocatedAtAbort = createUrl.mock.calls.length; controller.abort(); return new Blob(['.late{}'], { type: 'text/css' });
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(allocatedAtAbort).toBeGreaterThan(0); expect(createUrl).toHaveBeenCalledTimes(allocatedAtAbort);
  });
});

describe('CSS resource references', () => {
  it('preserves comments, strings, import qualifiers and external or fragment URLs', async () => {
    const css = String.raw`/* url(no.svg) */.a{content:'url(fake.svg)';background:URL( "../a\20 b.svg" )}
      @import/**/"nested.css" layer(book) screen;
      @import url('print.css') print;
      .b{mask:url(#icon);background:url(data:image/svg+xml;base64,AAAA);border-image:url(https://example.test/a.svg)}
      .c{background:url(../paren\)\20 blue.svg)}`;
    const requested: Array<[string, boolean]> = [];
    const result = await rewriteCssResources(css, async (value, stylesheet) => {
      requested.push([value, stylesheet]); return /^(?:#|data:|https:)/.test(value) ? undefined : `blob:${requested.length}`;
    });
    expect(requested).toEqual([
      ['../a b.svg', false], ['nested.css', true], ['print.css', true], ['#icon', false],
      ['data:image/svg+xml;base64,AAAA', false], ['https://example.test/a.svg', false], ['../paren) blue.svg', false]
    ]);
    expect(result).toContain("content:'url(fake.svg)'"); expect(result).toContain('/* url(no.svg) */');
    expect(result).toContain('@import/**/"blob:2" layer(book) screen;');
    expect(result).toContain("url(data:image/svg+xml;base64,AAAA)");
  });

  it.each(['.a{content:"url(no.svg)"}', '/* url(no.svg)', '.a{background:url("unterminated.svg)', 'url-prefix(no.svg)'])
    ('does not rewrite literal or incomplete CSS: %s', async css => {
      const resolve = vi.fn(); expect(await rewriteCssResources(css, resolve)).toBe(css); expect(resolve).not.toHaveBeenCalled();
    });
});
