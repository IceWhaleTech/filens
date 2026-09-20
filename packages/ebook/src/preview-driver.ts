import JSZip from 'jszip';
import {
  createDefaultPreviewRoutes,
  type EbookPreviewState,
  type FormatDefinition,
  type PreviewDriver,
  type PreviewEventMap,
  type PreviewEventName,
  type PreviewLoadContext,
  type PreviewOptions,
  type PreviewResourceResolveResult,
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
    this.revokeCreatedUrls();
    this.book = null;
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
      const format = normalizeFormat(context.route?.sourceFormat ?? context.descriptor.extension);
      if (format !== 'epub' && format !== 'cbz') {
        throw new Error(`Ebook preview currently supports EPUB and CBZ files, got ${format || 'unknown'}.`);
      }

      this.book =
        format === 'cbz'
          ? await loadCbzBook(source, context, (blob) => this.createObjectUrl(blob))
          : await loadEpubBook(source, context, (blob) => this.createObjectUrl(blob), this.options.resourceResolver);
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
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      this.state.loading = false;
      this.state.error = normalizedError.message;
      this.emit('error', normalizedError);
      this.emit('statechange', this.state);
      throw normalizedError;
    }
  }

  destroy(): void {
    this.revokeCreatedUrls();
    this.tabs.replaceChildren();
    this.stage.replaceChildren();
    this.root.replaceChildren();
    if (this.root.parentElement === this.host) {
      this.host.replaceChildren();
    }
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
    if (!this.book?.chapters.length) {
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
  const zip = await JSZip.loadAsync(await sourceToArrayBuffer(source, context));
  const warnings: string[] = [];
  const container = await readZipText(zip, 'META-INF/container.xml');
  if (!container) {
    throw new Error('Invalid EPUB: missing META-INF/container.xml.');
  }

  const packagePath = findRootfilePath(container);
  if (!packagePath) {
    throw new Error('Invalid EPUB: missing rootfile path.');
  }

  const packageXml = await readZipText(zip, packagePath);
  if (!packageXml) {
    throw new Error(`Invalid EPUB: missing package document ${packagePath}.`);
  }

  const packageDir = dirname(packagePath);
  const document = parseXml(packageXml, packagePath);
  const manifest = readManifest(document);
  const spineIds = readSpine(document);
  const title = firstText(document, 'title');
  const assetUrls = await createAssetUrls(zip, manifest, packageDir, createUrl);
  const chapters: ParsedEpubChapter[] = [];

  for (const idref of spineIds) {
    const item = manifest.get(idref);
    if (!item) {
      warnings.push(`Missing manifest item for spine id ${idref}.`);
      continue;
    }
    if (!isHtmlMediaType(item.mediaType)) {
      warnings.push(`Skipped non-HTML spine item ${item.href}.`);
      continue;
    }

    const path = joinPath(packageDir, item.href);
    const html = await readZipText(zip, path);
    if (!html) {
      warnings.push(`Missing chapter file ${path}.`);
      continue;
    }

    chapters.push({
      id: item.id,
      href: item.href,
      title: chapterTitle(html) ?? item.href,
      html: await rewriteChapterHtml(html, item.href, packageDir, assetUrls, createUrl, resourceResolver, context.signal)
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
  const zip = await JSZip.loadAsync(await sourceToArrayBuffer(source, context));
  const entries = Object.values(zip.files)
    .filter((file) => !file.dir && isComicImage(file.name))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }));

  if (!entries.length) {
    throw new Error('Invalid CBZ: no readable image pages found.');
  }

  const chapters: ParsedEpubChapter[] = [];
  for (const [index, entry] of entries.entries()) {
    const blob = await entry.async('blob');
    const contentType = imageContentType(entry.name);
    const url = createUrl(blob.type ? blob : new Blob([blob], { type: contentType }));
    const title = `Page ${index + 1}`;
    chapters.push({
      id: `page-${index + 1}`,
      title,
      href: entry.name,
      html: createComicPageHtml(title, url)
    });
  }

  return {
    title: context.descriptor.name,
    chapters,
    warnings: []
  };
}

async function sourceToArrayBuffer(source: PreviewSource, context: PreviewLoadContext): Promise<ArrayBuffer> {
  if (typeof source === 'string') {
    const response = await fetch(source, { signal: context.signal });
    if (!response.ok) {
      throw new Error(`Failed to load EPUB source: ${response.status} ${response.statusText}`.trim());
    }
    return response.arrayBuffer();
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
    return source.arrayBuffer();
  }
  return new TextEncoder().encode(String(source)).buffer as ArrayBuffer;
}

async function readZipText(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path);
  if (!file) {
    return null;
  }
  return file.async('text');
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

async function createAssetUrls(
  zip: JSZip,
  manifest: Map<string, ManifestItem>,
  packageDir: string,
  createUrl: (blob: Blob) => string
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  for (const item of manifest.values()) {
    if (isHtmlMediaType(item.mediaType)) {
      continue;
    }
    const path = joinPath(packageDir, item.href);
    const file = zip.file(path);
    if (!file) {
      continue;
    }
    const blob = await file.async('blob');
    const url = createUrl(blob.type ? blob : new Blob([blob], { type: item.mediaType || blob.type }));
    urls.set(normalizePath(path), url);
    urls.set(normalizePath(item.href), url);
  }
  return urls;
}

async function rewriteChapterHtml(
  html: string,
  chapterHref: string,
  packageDir: string,
  assetUrls: Map<string, string>,
  createUrl: (blob: Blob) => string,
  resourceResolver: PreviewResourceResolver | undefined,
  signal?: AbortSignal
): Promise<string> {
  const parser = new DOMParser();
  const document = parser.parseFromString(html, 'text/html');
  const chapterDir = dirname(joinPath(packageDir, chapterHref));
  for (const element of Array.from(document.querySelectorAll('[src], [href]'))) {
    const attr = element.hasAttribute('src') ? 'src' : 'href';
    const value = element.getAttribute(attr);
    if (!value || isExternalUrl(value)) {
      continue;
    }
    const [path, suffix = ''] = splitUrlSuffix(value);
    const resolved = normalizePath(joinPath(chapterDir, path));
    const url = assetUrls.get(resolved)
      ?? assetUrls.get(normalizePath(path))
      ?? await resolveEpubResource(resourceResolver, {
        path: resolved,
        source: value,
        relation: element.localName.toLowerCase() === 'link' ? 'stylesheet' : 'resource',
        createUrl,
        signal
      });
    if (url) {
      element.setAttribute(attr, `${url}${suffix}`);
    }
  }
  return `<!doctype html>${document.documentElement.outerHTML}`;
}

async function resolveEpubResource(
  resourceResolver: PreviewResourceResolver | undefined,
  request: {
    path: string;
    source: string;
    relation: string;
    createUrl: (blob: Blob) => string;
    signal?: AbortSignal;
  }
): Promise<string | undefined> {
  if (!resourceResolver) {
    return undefined;
  }
  if (request.signal?.aborted) {
    throw new DOMException('Ebook preview aborted.', 'AbortError');
  }
  const resolved = normalizeResourceResolverResult(
    await resourceResolver({
      family: 'ebook',
      sourceFormat: 'epub',
      source: request.path,
      relation: request.relation,
      name: request.path.split('/').pop() ?? request.path
    }),
    request.path,
    request.createUrl
  );
  return resolved.source;
}

function chapterTitle(html: string): string | undefined {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const title = document.querySelector('title')?.textContent?.trim();
  if (title) {
    return title;
  }
  return document.querySelector('h1,h2,h3')?.textContent?.trim() || undefined;
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

function resourceContentType(name: string): string {
  const extension = normalizeFormat(name.split('?')[0]?.split('.').pop());
  const types: Record<string, string> = {
    css: 'text/css',
    otf: 'font/otf',
    ttf: 'font/ttf',
    woff: 'font/woff',
    woff2: 'font/woff2',
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

function normalizeResourceResolverResult(
  result: Awaited<ReturnType<PreviewResourceResolver>>,
  name: string,
  createUrl: (blob: Blob) => string
): { source?: string; warnings: string[] } {
  if (!result) {
    return { warnings: [] };
  }
  if (typeof result === 'string') {
    return {
      source: result,
      warnings: []
    };
  }
  if (result instanceof Blob) {
    return {
      source: createUrl(result.type ? result : new Blob([result], { type: resourceContentType(name) })),
      warnings: []
    };
  }
  if (ArrayBuffer.isView(result) || result instanceof ArrayBuffer) {
    const bytes = ArrayBuffer.isView(result)
      ? new Uint8Array(result.buffer, result.byteOffset, result.byteLength)
      : new Uint8Array(result);
    return {
      source: bytesToDataUrl(bytes, resourceContentType(name)),
      warnings: []
    };
  }
  return normalizeResourceResolveResult(result, name, createUrl);
}

function normalizeResourceResolveResult(
  result: PreviewResourceResolveResult,
  name: string,
  createUrl: (blob: Blob) => string
): { source?: string; warnings: string[] } {
  return {
    source: normalizeResolvedPreviewSource(result.source, name, createUrl),
    warnings: result.warnings ?? []
  };
}

function normalizeResolvedPreviewSource(
  source: PreviewSource | undefined,
  name: string,
  createUrl: (blob: Blob) => string
): string | undefined {
  if (!source) {
    return undefined;
  }
  if (typeof source === 'string') {
    return source;
  }
  if (source instanceof Blob) {
    return createUrl(source.type ? source : new Blob([source], { type: resourceContentType(name) }));
  }
  if (ArrayBuffer.isView(source)) {
    return bytesToDataUrl(new Uint8Array(source.buffer, source.byteOffset, source.byteLength), resourceContentType(name));
  }
  if (source instanceof ArrayBuffer) {
    return bytesToDataUrl(new Uint8Array(source), resourceContentType(name));
  }
  return undefined;
}

function bytesToDataUrl(bytes: Uint8Array, contentType: string): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `data:${contentType};base64,${btoa(binary)}`;
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

function isExternalUrl(value: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|#)/i.test(value);
}

function splitUrlSuffix(value: string): [string, string?] {
  const match = value.match(/^([^?#]*)([?#].*)?$/);
  return [match?.[1] ?? value, match?.[2]];
}

function dirname(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : '';
}

function joinPath(base: string, path: string): string {
  if (!base || path.startsWith('/')) {
    return normalizePath(path);
  }
  return normalizePath(`${base}/${path}`);
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
