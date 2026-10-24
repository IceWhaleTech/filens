import JSZip from 'jszip';
import { createEpubResources, resolveArchivePath } from './epub-resources';
import {
  createDefaultPreviewRoutes,
  type EbookPreviewState,
  type FormatDefinition,
  type PreviewDriver,
  type PreviewEventMap,
  type PreviewEventName,
  type PreviewLoadContext,
  type PreviewOptions,
  type PreviewResourceResolver,
  type PreviewSession,
  type PreviewSource
} from '@filens/core';

type PreviewListenerMap = {
  [K in PreviewEventName]: Set<(payload: PreviewEventMap[K]) => void>;
};

export interface ParsedEpubChapter {
  id: string;
  title: string;
  href: string;
  html: string;
}

export interface ParsedEpubBook {
  title?: string;
  chapters: ParsedEpubChapter[];
  warnings: string[];
}

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
}

export const EBOOK_FORMAT_ROUTES: FormatDefinition[] = [
  {
    extensions: ['epub'],
    family: 'ebook',
    driverId: 'ebook',
    targetFormat: 'epub',
    contentTypes: ['application/epub+zip']
  },
  {
    extensions: ['cbz'],
    family: 'ebook',
    driverId: 'ebook',
    targetFormat: 'cbz',
    contentTypes: ['application/vnd.comicbook+zip', 'application/x-cbz']
  }
];

export class EpubPreviewSession implements PreviewSession<EbookPreviewState> {
  private readonly listeners: PreviewListenerMap = {
    loading: new Set(),
    rendered: new Set(),
    error: new Set(),
    statechange: new Set(),
    warnings: new Set()
  };
  private readonly root: HTMLDivElement;
  private readonly tabs: HTMLDivElement;
  private readonly stage: HTMLDivElement;
  private readonly createdUrls: string[] = [];
  private book: ParsedEpubBook | null = null;
  private frame: HTMLIFrameElement | null = null;
  private loadGeneration = 0;
  private loadController?: AbortController;
  private removeAbortListener?: () => void;
  private state: EbookPreviewState = {
    loading: false,
    error: null,
    family: 'ebook',
    warnings: [],
    capabilities: {
      chapters: true,
      search: true,
      fullscreen: true,
      download: true
    },
    location: undefined,
    progress: 0,
    chapterTitle: undefined,
    chapterIndex: 0,
    chapterCount: 0,
    chapters: []
  };

  constructor(private readonly host: HTMLElement, private readonly options: PreviewOptions = {}) {
    this.root = document.createElement('div');
    this.root.className = 'ebookv-preview';
    this.tabs = document.createElement('div');
    this.tabs.className = 'ebookv-chapters';
    this.stage = document.createElement('div');
    this.stage.className = 'ebookv-stage';
    this.root.replaceChildren(this.tabs, this.stage);
    this.host.replaceChildren(this.root);
  }

  async load(source: PreviewSource, context: PreviewLoadContext): Promise<void> {
    const generation = ++this.loadGeneration;
    this.loadController?.abort();
    this.removeAbortListener?.();
    this.releaseBook();
    const controller = new AbortController();
    this.loadController = controller;
    const signal = context.signal;
    const abort = () => {
      controller.abort();
      if (generation === this.loadGeneration) {
        this.releaseBook();
        this.state.loading = false;
        this.emit('statechange', this.state);
      }
    };
    signal?.addEventListener('abort', abort, { once: true });
    this.removeAbortListener = () => signal?.removeEventListener('abort', abort);
    this.state = {
      ...this.state,
      loading: true,
      error: null,
      title: context.descriptor.name,
      warnings: [],
      location: undefined,
      progress: 0,
      chapterTitle: undefined,
      chapterIndex: 0,
      chapterCount: 0,
      chapters: []
    };
    this.emit('loading', this.state);
    this.emit('statechange', this.state);

    try {
      if (signal?.aborted) controller.abort();
      checkAborted(controller.signal);
      const format = normalizeFormat(context.route?.sourceFormat ?? context.descriptor.extension);
      if (format !== 'epub' && format !== 'cbz') {
        throw new Error(`Ebook preview currently supports EPUB and CBZ files, got ${format || 'unknown'}.`);
      }

      const loadContext = { ...context, signal: controller.signal };
      const createUrl = (blob: Blob) => {
        checkAborted(controller.signal);
        return this.createObjectUrl(blob);
      };
      const book =
        format === 'cbz'
          ? await loadCbzBook(source, loadContext, createUrl)
          : await loadEpubBook(source, loadContext, createUrl, this.options.resourceResolver);
      if (generation !== this.loadGeneration) return;
      checkAborted(controller.signal);
      this.book = book;
      this.state = {
        ...this.state,
        loading: false,
        error: null,
        title: this.book.title ?? context.descriptor.name,
        warnings: this.book.warnings.slice(),
        chapterCount: this.book.chapters.length,
        chapters: this.book.chapters.map((chapter) => ({
          id: chapter.id,
          title: chapter.title
        }))
      };
      this.render();
      if (this.state.warnings.length) {
        this.emit('warnings', this.state.warnings);
      }
      this.emit('rendered', this.state);
      this.emit('statechange', this.state);
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      this.releaseBook();
      this.state.loading = false;
      if (controller.signal.aborted) {
        checkAborted(controller.signal);
      }
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      this.state.error = normalizedError.message;
      this.emit('error', normalizedError);
      this.emit('statechange', this.state);
      throw normalizedError;
    }
  }

  destroy(): void {
    this.loadGeneration++;
    this.loadController?.abort();
    this.removeAbortListener?.();
    this.releaseBook();
    this.state.loading = false;
    this.root.replaceChildren();
    if (this.root.parentElement === this.host) {
      this.host.replaceChildren();
    }
    for (const listeners of Object.values(this.listeners)) listeners.clear();
  }

  getState(): EbookPreviewState {
    return {
      ...this.state,
      warnings: this.state.warnings.slice(),
      chapters: this.state.chapters?.slice() ?? []
    };
  }

  on<T extends PreviewEventName>(event: T, handler: (payload: PreviewEventMap[T]) => void): () => void {
    this.listeners[event].add(handler as never);
    return () => {
      this.listeners[event].delete(handler as never);
    };
  }

  goToPage(index: number): void {
    this.goToChapter(index);
  }

  next(): void {
    this.goToChapter(Math.min(this.state.chapterIndex + 1, Math.max(this.state.chapterCount - 1, 0)));
  }

  prev(): void {
    this.goToChapter(Math.max(this.state.chapterIndex - 1, 0));
  }

  private goToChapter(index: number): void {
    if (!Number.isInteger(index) || !this.book?.chapters.length) {
      return;
    }
    const nextIndex = Math.max(0, Math.min(index, this.book.chapters.length - 1));
    if (nextIndex === this.state.chapterIndex && this.frame) {
      return;
    }
    const chapter = this.book.chapters[nextIndex]!;
    this.state.chapterIndex = nextIndex;
    this.state.location = chapter.href;
    this.state.chapterTitle = chapter.title;
    this.state.progress = this.book.chapters.length <= 1 ? 1 : nextIndex / (this.book.chapters.length - 1);
    this.renderTabs();
    this.renderChapter(chapter);
    this.emit('statechange', this.state);
  }

  private render(): void {
    this.renderTabs();
    this.goToChapter(0);
  }

  private renderTabs(): void {
    this.tabs.replaceChildren();
    for (const [index, chapter] of this.state.chapters.entries()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ebookv-chapter-tab';
      button.classList.toggle('is-active', index === this.state.chapterIndex);
      button.textContent = chapter.title;
      button.addEventListener('click', () => this.goToChapter(index));
      this.tabs.appendChild(button);
    }
  }

  private renderChapter(chapter: ParsedEpubChapter): void {
    const frame = document.createElement('iframe');
    frame.className = 'ebookv-frame';
    frame.title = chapter.title;
    frame.setAttribute('sandbox', 'allow-same-origin allow-popups');
    frame.referrerPolicy = 'no-referrer';
    frame.srcdoc = chapter.html;
    this.frame = frame;
    this.stage.replaceChildren(frame);
  }

  private createObjectUrl(blob: Blob): string {
    const url = URL.createObjectURL(blob);
    this.createdUrls.push(url);
    return url;
  }

  private releaseBook(): void {
    this.revokeCreatedUrls();
    this.book = null;
    this.frame = null;
    this.tabs.replaceChildren();
    this.stage.replaceChildren();
    this.state.chapterCount = 0;
    this.state.chapterIndex = 0;
    this.state.chapters = [];
    this.state.chapterTitle = undefined;
    this.state.location = undefined;
    this.state.progress = 0;
  }

  private revokeCreatedUrls(): void {
    while (this.createdUrls.length) {
      const url = this.createdUrls.pop();
      if (url) {
        URL.revokeObjectURL(url);
      }
    }
  }

  private emit<T extends PreviewEventName>(event: T, payload: PreviewEventMap[T]): void {
    for (const handler of this.listeners[event]) {
      handler(payload as never);
    }
  }
}

export function createEbookPreviewDriver(): PreviewDriver<EbookPreviewState> {
  return {
    id: 'ebook',
    family: 'ebook',
    supports: (format) => ['epub', 'cbz'].includes(normalizeFormat(format)),
    createSession: (host, options) => new EpubPreviewSession(host, options)
  };
}

export function createEbookPreviewRoutes(baseRoutes = createDefaultPreviewRoutes()): FormatDefinition[] {
  return [
    ...EBOOK_FORMAT_ROUTES,
    ...baseRoutes.filter((route) => !route.extensions.some((extension) => extension === 'epub' || extension === 'cbz'))
  ];
}

export async function loadEpubBook(
  source: PreviewSource,
  context: PreviewLoadContext = {
    descriptor: {
      source
    }
  },
  createUrl: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
  resourceResolver?: PreviewResourceResolver
): Promise<ParsedEpubBook> {
  const bytes = await sourceToArrayBuffer(source, context);
  checkAborted(context.signal);
  const zip = await JSZip.loadAsync(bytes);
  checkAborted(context.signal);
  const warnings: string[] = [];
  const container = await readZipText(zip, 'META-INF/container.xml', context.signal);
  if (!container) {
    throw new Error('Invalid EPUB: missing META-INF/container.xml.');
  }

  const rootfile = findRootfilePath(container);
  const packagePath = rootfile ? resolveArchivePath('', rootfile) : null;
  if (!packagePath) {
    throw new Error('Invalid EPUB: missing rootfile path.');
  }

  const packageXml = await readZipText(zip, packagePath, context.signal);
  if (!packageXml) {
    throw new Error(`Invalid EPUB: missing package document ${packagePath}.`);
  }

  const packageDir = dirname(packagePath);
  const document = parseXml(packageXml, packagePath);
  const manifest = readManifest(document);
  const spineIds = readSpine(document);
  const title = firstText(document, 'title');
  const resources = await createEpubResources(zip, manifest.values(), packageDir, createUrl, context.signal, resourceResolver, warnings);
  const chapters: ParsedEpubChapter[] = [];

  for (const idref of spineIds) {
    checkAborted(context.signal);
    const item = manifest.get(idref);
    if (!item) {
      warnings.push(`Missing manifest item for spine id ${idref}.`);
      continue;
    }
    if (!isHtmlMediaType(item.mediaType)) {
      warnings.push(`Skipped non-HTML spine item ${item.href}.`);
      continue;
    }

    const path = resolveArchivePath(packageDir, item.href);
    const html = await readZipText(zip, path, context.signal);
    if (!html) {
      warnings.push(`Missing chapter file ${path}.`);
      continue;
    }

    const chapter = await rewriteChapterHtml(html, item.href, packageDir, resources, context.signal);
    chapters.push({
      id: item.id,
      href: item.href,
      title: chapter.title ?? item.href,
      html: chapter.html
    });
  }

  if (!chapters.length) {
    throw new Error('Invalid EPUB: no readable HTML chapters found.');
  }

  return {
    title: title || undefined,
    chapters,
    warnings
  };
}

export async function loadCbzBook(
  source: PreviewSource,
  context: PreviewLoadContext = {
    descriptor: {
      source
    }
  },
  createUrl: (blob: Blob) => string = (blob) => URL.createObjectURL(blob)
): Promise<ParsedEpubBook> {
  const bytes = await sourceToArrayBuffer(source, context);
  checkAborted(context.signal);
  const zip = await JSZip.loadAsync(bytes);
  checkAborted(context.signal);
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const entries = Object.values(zip.files)
    .filter((file) => !file.dir && isComicImage(file.name))
    .sort((left, right) => collator.compare(left.name, right.name));

  if (!entries.length) {
    throw new Error('Invalid CBZ: no readable image pages found.');
  }

  const chapters: ParsedEpubChapter[] = [];
  // Share JSZip's scheduling overhead while bounding in-flight decompression.
  for (let start = 0; start < entries.length; start += 8) {
    checkAborted(context.signal);
    const batch = entries.slice(start, start + 8);
    const pages = await Promise.all(batch.map(entry => entry.async('arraybuffer')));
    checkAborted(context.signal);
    for (const [offset, entry] of batch.entries()) {
      checkAborted(context.signal);
      const index = start + offset;
      const contentType = imageContentType(entry.name);
      const url = createUrl(new Blob([pages[offset]!], { type: contentType }));
      const title = `Page ${index + 1}`;
      chapters.push({
        id: `page-${index + 1}`,
        title,
        href: entry.name,
        html: createComicPageHtml(title, url)
      });
    }
  }

  return {
    title: context.descriptor.name,
    chapters,
    warnings: []
  };
}

async function sourceToArrayBuffer(source: PreviewSource, context: PreviewLoadContext): Promise<ArrayBuffer> {
  checkAborted(context.signal);
  if (typeof source === 'string') {
    const response = await fetch(source, { signal: context.signal });
    if (!response.ok) {
      throw new Error(`Failed to load EPUB source: ${response.status} ${response.statusText}`.trim());
    }
    const bytes = await response.arrayBuffer();
    checkAborted(context.signal);
    return bytes;
  }
  if (ArrayBuffer.isView(source)) {
    const bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer as ArrayBuffer;
  }
  if (source instanceof ArrayBuffer) {
    return source;
  }
  if (source instanceof Blob) {
    const bytes = await source.arrayBuffer();
    checkAborted(context.signal);
    return bytes;
  }
  return new TextEncoder().encode(String(source)).buffer as ArrayBuffer;
}

async function readZipText(zip: JSZip, path: string, signal?: AbortSignal): Promise<string | null> {
  checkAborted(signal);
  const file = zip.file(path);
  if (!file) {
    return null;
  }
  const text = await file.async('text');
  checkAborted(signal);
  return text;
}

function findRootfilePath(containerXml: string): string | null {
  const document = parseXml(containerXml, 'container.xml');
  const rootfile = Array.from(document.getElementsByTagName('*')).find((element) => element.localName === 'rootfile');
  return rootfile?.getAttribute('full-path') ?? null;
}

function readManifest(document: Document): Map<string, ManifestItem> {
  const manifest = new Map<string, ManifestItem>();
  for (const element of Array.from(document.getElementsByTagName('*'))) {
    if (element.localName !== 'item') {
      continue;
    }
    const id = element.getAttribute('id');
    const href = element.getAttribute('href');
    const mediaType = element.getAttribute('media-type') ?? '';
    if (id && href) {
      manifest.set(id, {
        id,
        href,
        mediaType
      });
    }
  }
  return manifest;
}

function readSpine(document: Document): string[] {
  return Array.from(document.getElementsByTagName('*'))
    .filter((element) => element.localName === 'itemref')
    .map((element) => element.getAttribute('idref') ?? '')
    .filter(Boolean);
}

async function rewriteChapterHtml(
  html: string,
  chapterHref: string,
  packageDir: string,
  resources: Awaited<ReturnType<typeof createEpubResources>>,
  signal?: AbortSignal
): Promise<{ title?: string; html: string }> {
  checkAborted(signal);
  const document = new DOMParser().parseFromString(html, 'text/html');
  const chapterDir = dirname(resolveArchivePath(packageDir, chapterHref));
  // Plain chapters need no resource traversal; the pattern also catches namespaced hrefs.
  if (/\b(?:src|href|poster|style)\b/i.test(html)) {
    for (const element of Array.from(document.querySelectorAll('[src], [*|href], [poster], [style], style'))) {
      for (const attr of ['src', 'href', 'xlink:href', 'poster']) {
        const value = element.getAttribute(attr);
        if (!value) continue;
        const stylesheet = element.localName.toLowerCase() === 'link' && /(?:^|\s)stylesheet(?:\s|$)/i.test(element.getAttribute('rel') ?? '');
        const url = await resources.resolve(value, chapterDir, stylesheet);
        if (url) element.setAttribute(attr, url);
      }
      if (element.localName.toLowerCase() === 'style') {
        element.textContent = await resources.rewriteCss(element.textContent ?? '', chapterDir);
      }
      const inlineStyle = element.getAttribute('style');
      if (inlineStyle !== null) element.setAttribute('style', await resources.rewriteCss(inlineStyle, chapterDir));
    }
  }
  checkAborted(signal);
  return {
    title: document.querySelector('title')?.textContent?.trim() || document.querySelector('h1,h2,h3')?.textContent?.trim() || undefined,
    html: `<!doctype html>${document.documentElement.outerHTML}`
  };
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Ebook preview aborted.', 'AbortError');
}

function parseXml(xml: string, label: string): Document {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const error = document.getElementsByTagName('parsererror')[0];
  if (error) {
    throw new Error(`Invalid XML in ${label}.`);
  }
  return document;
}

function firstText(document: Document, localName: string): string {
  const element = Array.from(document.getElementsByTagName('*')).find((node) => node.localName === localName);
  return element?.textContent?.trim() ?? '';
}

function isHtmlMediaType(mediaType: string): boolean {
  return mediaType === 'application/xhtml+xml' || mediaType === 'text/html';
}

function isComicImage(name: string): boolean {
  return /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(name);
}

function imageContentType(name: string): string {
  const extension = normalizeFormat(name.split('.').pop());
  const types: Record<string, string> = {
    avif: 'image/avif',
    bmp: 'image/bmp',
    gif: 'image/gif',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    svg: 'image/svg+xml',
    webp: 'image/webp'
  };
  return types[extension] ?? 'application/octet-stream';
}

function createComicPageHtml(title: string, imageUrl: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
html,body{margin:0;min-height:100%;background:#111827;color:#f8fafc;font-family:system-ui,sans-serif;}
body{display:flex;align-items:center;justify-content:center;}
img{display:block;max-width:100%;max-height:100vh;width:auto;height:auto;object-fit:contain;}
</style></head><body><img src="${escapeAttribute(imageUrl)}" alt="${escapeAttribute(title)}"></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char] ?? char);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

function dirname(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : '';
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

function normalizeFormat(format: string | undefined): string {
  return String(format ?? '').trim().replace(/^\./, '').toLowerCase();
}
