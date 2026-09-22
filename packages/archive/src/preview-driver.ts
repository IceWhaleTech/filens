import JSZip from 'jszip';
import { gunzipSync } from 'fflate';
import {
  createDefaultPreviewRoutes,
  type ArchivePreviewState,
  type FormatDefinition,
  type PreviewDriver,
  type PreviewEventMap,
  type PreviewEventName,
  type PreviewLoadContext,
  type PreviewOptions,
  type PreviewResourceResolver,
  type PreviewSession,
  type PreviewerInstance,
  type PreviewSource
} from '@filens/core';

type PreviewListenerMap = {
  [K in PreviewEventName]: Set<(payload: PreviewEventMap[K]) => void>;
};

export interface ArchiveResourceResolverOptions {
  root?: string;
  contentTypes?: Record<string, string>;
  preferBlob?: boolean;
}

export type ZipResourceResolverOptions = ArchiveResourceResolverOptions;

export interface ArchiveResource {
  name: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: number;
  contentType?: string;
  readAsArrayBuffer(): Promise<ArrayBuffer>;
  readAsBlob(): Promise<Blob>;
  readAsText(): Promise<string>;
}

export type ZipArchiveResource = ArchiveResource;

export interface ArchiveResourceIndex {
  entries: ArchiveResource[];
  files: ArchiveResource[];
  resolve: PreviewResourceResolver;
  read(name: string): ArchiveResource | undefined;
}

export type ZipArchiveResourceIndex = ArchiveResourceIndex;

type ArchiveEntryRecord = {
  name: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: number;
  read(): Promise<Uint8Array>;
};

type ArchiveFrame = {
  label: string;
  entries: ArchiveEntryRecord[];
};

export const ARCHIVE_FORMAT_ROUTES: FormatDefinition[] = [
  {
    extensions: ['zip', 'jar', 'war', 'ear', 'apk'],
    family: 'archive',
    driverId: 'archive',
    targetFormat: 'zip',
    contentTypes: ['application/zip', 'application/x-zip-compressed', 'application/java-archive', 'application/vnd.android.package-archive']
  },
  {
    extensions: ['tar'],
    family: 'archive',
    driverId: 'archive',
    targetFormat: 'tar',
    contentTypes: ['application/x-tar']
  },
  {
    extensions: ['tgz', 'gz'],
    family: 'archive',
    driverId: 'archive',
    targetFormat: 'gz',
    contentTypes: ['application/gzip', 'application/x-gzip']
  }
];

export class ArchivePreviewSession implements PreviewSession<ArchivePreviewState> {
  private readonly listeners: PreviewListenerMap = {
    loading: new Set(),
    rendered: new Set(),
    error: new Set(),
    statechange: new Set(),
    warnings: new Set()
  };
  private readonly root: HTMLDivElement;
  private readonly options: PreviewOptions;
  private archiveStack: ArchiveFrame[] = [];
  private activeEntry: { name: string; source: Uint8Array; contentType?: string } | null = null;
  private entryPreviewHost: HTMLDivElement | null = null;
  private entryPreviewer: PreviewerInstance | null = null;
  private entryPreviewUnsubscribes: Array<() => void> = [];
  private entryObjectUrl: string | null = null;
  private state: ArchivePreviewState = {
    loading: false,
    error: null,
    family: 'archive',
    warnings: [],
    capabilities: {
      archiveBrowse: true,
      search: true,
      download: true
    },
    route: '/',
    entries: []
  };

  constructor(private readonly host: HTMLElement, options: PreviewOptions = {}) {
    this.options = options;
    this.root = document.createElement('div');
    this.root.className = 'archivev-preview';
    this.host.replaceChildren(this.root);
  }

  async load(source: PreviewSource, context: PreviewLoadContext): Promise<void> {
    this.closeEntryPreview(false);
    this.state = {
      ...this.state,
      loading: true,
      error: null,
      title: context.descriptor.name,
      warnings: [],
      route: '/',
      entries: []
    };
    this.archiveStack = [];
    this.emit('loading', this.state);
    this.emit('statechange', this.state);

    try {
      const bytes = new Uint8Array(await sourceToArrayBuffer(source, context));
      const label = context.descriptor.name ?? 'archive';
      const format = detectArchiveFormat(label, context.route?.sourceFormat ?? context.descriptor.extension);
      this.archiveStack = [await readArchive(bytes, format, label)];

      this.state = {
        ...this.state,
        loading: false,
        error: null
      };
      this.setRoute('/');
      this.render();
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
    this.closeEntryPreview(false);
    this.archiveStack = [];
    this.root.replaceChildren();
    if (this.root.parentElement === this.host) {
      this.host.replaceChildren();
    }
  }

  getState(): ArchivePreviewState {
    return {
      ...this.state,
      warnings: this.state.warnings.slice(),
      entries: this.state.entries.slice()
    };
  }

  on<T extends PreviewEventName>(event: T, handler: (payload: PreviewEventMap[T]) => void): () => void {
    this.listeners[event].add(handler as never);
    return () => {
      this.listeners[event].delete(handler as never);
    };
  }

  private render(): void {
    const stackLabel = this.archiveStack.map((item) => item.label).join(' › ');
    const routeLabel = this.state.route || '/';
    const summaryLabel = stackLabel ? `${stackLabel} • ${routeLabel}` : routeLabel;
    const summary = document.createElement('div');
    summary.className = 'archivev-summary';
    summary.textContent = `${summaryLabel} • ${this.state.entries.length} item${this.state.entries.length === 1 ? '' : 's'}`;
    summary.appendChild(this.createBreadcrumbs());

    const toolbar = document.createElement('div');
    toolbar.className = 'archivev-toolbar';

    const upButton = document.createElement('button');
    upButton.type = 'button';
    upButton.className = 'archivev-button';
    upButton.textContent = 'Up';
    upButton.disabled = !canNavigateUp(this.state.route);
    upButton.addEventListener('click', () => this.navigateUp());

    const rootButton = document.createElement('button');
    rootButton.type = 'button';
    rootButton.className = 'archivev-button';
    rootButton.textContent = 'Root';
    rootButton.disabled = this.state.route === '/';
    rootButton.addEventListener('click', () => this.setRoute('/'));

    const closeNestedButton = document.createElement('button');
    closeNestedButton.type = 'button';
    closeNestedButton.className = 'archivev-button';
    closeNestedButton.textContent = this.activeEntry ? 'Back to archive' : 'Back';
    closeNestedButton.disabled = this.activeEntry ? false : this.archiveStack.length <= 1;
    closeNestedButton.addEventListener('click', () => this.activeEntry ? this.closeEntryPreview() : this.popArchive());

    toolbar.append(closeNestedButton, upButton, rootButton);

    if (this.activeEntry && this.entryPreviewHost) {
      this.root.replaceChildren(summary, toolbar, this.entryPreviewHost);
      return;
    }

    const table = document.createElement('table');
    table.className = 'archivev-table';
    table.appendChild(createTableHead());
    const body = document.createElement('tbody');
    for (const entry of this.state.entries) {
      const row = document.createElement('tr');
      row.className = 'archivev-row';
      row.tabIndex = 0;
      row.dataset.type = entry.type;

      const name = document.createElement('td');
      name.className = 'archivev-name';
      name.textContent = entry.name;
      name.dataset.type = entry.type;
      row.appendChild(name);

      const type = document.createElement('td');
      type.className = 'archivev-type';
      type.textContent = entry.type;
      row.appendChild(type);

      const size = document.createElement('td');
      size.className = 'archivev-size';
      size.textContent = entry.type === 'directory' ? '' : formatBytes(entry.size ?? 0);
      row.appendChild(size);

      const modified = document.createElement('td');
      modified.className = 'archivev-modified';
      modified.textContent = entry.modified ? new Date(entry.modified).toLocaleString() : '';
      row.appendChild(modified);

      row.addEventListener('click', () => this.activateEntry(entry));
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.activateEntry(entry);
        }
      });

      body.appendChild(row);
    }
    table.appendChild(body);
    this.root.replaceChildren(summary, toolbar, table);
  }

  private createBreadcrumbs(): HTMLElement {
    const breadcrumbs = document.createElement('nav');
    breadcrumbs.className = 'archivev-breadcrumbs';
    breadcrumbs.setAttribute('aria-label', 'Archive path');

    this.archiveStack.forEach((frame, index) => {
      if (index > 0) breadcrumbs.appendChild(createBreadcrumbSeparator());
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'archivev-breadcrumb';
      button.textContent = frame.label;
      button.disabled = index === this.archiveStack.length - 1;
      button.addEventListener('click', () => this.popToArchive(index));
      breadcrumbs.appendChild(button);
    });

    const route = normalizeArchiveRoute(this.state.route);
    const parts = route === '/' ? [] : route.slice(1, -1).split('/').filter(Boolean);
    const rootButton = document.createElement('button');
    rootButton.type = 'button';
    rootButton.className = 'archivev-breadcrumb';
    rootButton.textContent = '/';
    rootButton.disabled = route === '/';
    rootButton.addEventListener('click', () => this.setRoute('/'));
    breadcrumbs.appendChild(createBreadcrumbSeparator());
    breadcrumbs.appendChild(rootButton);

    let nextRoute = '/';
    for (const part of parts) {
      nextRoute = joinArchiveRoute(nextRoute, `${part}/`);
      breadcrumbs.appendChild(createBreadcrumbSeparator());
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'archivev-breadcrumb';
      button.textContent = part;
      button.disabled = nextRoute === route;
      const targetRoute = nextRoute;
      button.addEventListener('click', () => this.setRoute(targetRoute));
      breadcrumbs.appendChild(button);
    }
    if (this.activeEntry) {
      breadcrumbs.appendChild(createBreadcrumbSeparator());
      const current = document.createElement('span');
      current.className = 'archivev-breadcrumb-current';
      current.textContent = this.activeEntry.name.split('/').pop() ?? this.activeEntry.name;
      breadcrumbs.appendChild(current);
    }
    return breadcrumbs;
  }

  private activateEntry(entry: ArchivePreviewState['entries'][number]): void {
    if (entry.type === 'directory') {
      this.setRoute(joinArchiveRoute(this.state.route, entry.name));
      return;
    }

    if (isSupportedArchiveFile(entry.name)) {
      void this.openNestedArchive(entry.name);
      return;
    }

    void this.openEntryPreview(entry.name);
  }

  private async openEntryPreview(name: string): Promise<void> {
    const entry = this.findCurrentEntry(name);
    if (!entry) {
      return;
    }

    this.state = { ...this.state, loading: true, error: null };
    this.emit('loading', this.state);
    this.emit('statechange', this.state);

    try {
      const source = await entry.read();
      this.activeEntry = {
        name,
        source,
        contentType: resolveZipContentType(name, undefined)
      };
      this.entryPreviewHost = document.createElement('div');
      this.entryPreviewHost.className = 'archivev-entry-preview';
      this.render();

      const previewerFactory = this.options.previewerFactory;
      if (previewerFactory) {
        this.entryPreviewer = previewerFactory(this.entryPreviewHost, {
          resourceResolver: this.createEntryResourceResolver()
        });
        this.entryPreviewUnsubscribes = [
          this.entryPreviewer.on('error', (error) => this.setEntryPreviewError(error)),
          this.entryPreviewer.on('warnings', (warnings) => {
            this.state = { ...this.state, warnings };
            this.emit('warnings', warnings);
            this.emit('statechange', this.state);
          })
        ];
        await this.entryPreviewer.preview(source, {
          name,
          extension: extensionFromName(name),
          contentType: this.activeEntry.contentType
        });
      } else {
        this.renderFallbackEntryPreview(this.entryPreviewHost, source, name, this.activeEntry.contentType);
      }

      this.state = {
        ...this.state,
        loading: false,
        error: this.entryPreviewer?.getState().error ?? null
      };
      this.emit('statechange', this.state);
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      this.state = { ...this.state, loading: false, error: normalizedError.message };
      this.emit('error', normalizedError);
      this.emit('statechange', this.state);
    }
  }

  private setEntryPreviewError(error: Error): void {
    this.state = { ...this.state, loading: false, error: error.message };
    this.emit('error', error);
    this.emit('statechange', this.state);
  }

  private closeEntryPreview(shouldRender = true): void {
    this.entryPreviewUnsubscribes.splice(0).forEach((unsubscribe) => unsubscribe());
    this.entryPreviewer?.destroy();
    this.entryPreviewer = null;
    this.entryPreviewHost = null;
    this.activeEntry = null;
    if (this.entryObjectUrl) {
      URL.revokeObjectURL(this.entryObjectUrl);
      this.entryObjectUrl = null;
    }
    if (shouldRender) {
      this.state = { ...this.state, loading: false, error: null, warnings: [] };
      this.render();
      this.emit('statechange', this.state);
    }
  }

  private popToArchive(index: number): void {
    if (index < 0 || index >= this.archiveStack.length - 1) {
      return;
    }
    this.closeEntryPreview(false);
    this.archiveStack.splice(index + 1);
    this.setRoute('/');
  }

  private navigateUp(): void {
    const nextRoute = parentArchiveRoute(this.state.route);
    if (nextRoute !== this.state.route) {
      this.setRoute(nextRoute);
    }
  }

  private setRoute(route: string): void {
    if (this.activeEntry) {
      this.closeEntryPreview(false);
    }
    const current = this.archiveStack[this.archiveStack.length - 1];
    if (!current) {
      return;
    }

    const normalized = normalizeArchiveRoute(route);
    const entries = listEntriesForRoute(current.entries, normalized);
    this.state = {
      ...this.state,
      route: normalized,
      entries
    };
    this.render();
    this.emit('statechange', this.state);
  }

  private findCurrentEntry(name: string): ArchiveEntryRecord | undefined {
    const current = this.archiveStack[this.archiveStack.length - 1];
    if (!current) {
      return undefined;
    }
    const routePrefix = this.state.route === '/' ? '' : this.state.route.slice(1);
    return current.entries.find((entry) => entry.type === 'file' && entry.name === `${routePrefix}${name}`);
  }

  private createEntryResourceResolver(): PreviewResourceResolver {
    const externalResolver = this.options.resourceResolver;
    return async (request) => {
      const source = request.source ?? request.name;
      if (source) {
        const entry = this.findCurrentEntry(source.replace(/^\/+/, ''));
        if (entry) {
          return {
            source: await entry.read(),
            warnings: []
          };
        }
      }
      return externalResolver ? externalResolver(request) : undefined;
    };
  }

  private renderFallbackEntryPreview(host: HTMLElement, source: Uint8Array, name: string, contentType?: string): void {
    const extension = extensionFromName(name);
    const type = contentType ?? '';
    if (type.startsWith('image/')) {
      this.entryObjectUrl = URL.createObjectURL(new Blob([copyBytesToArrayBuffer(source)], { type }));
      const image = document.createElement('img');
      image.className = 'archivev-entry-image';
      image.alt = name;
      image.src = this.entryObjectUrl;
      host.replaceChildren(image);
      return;
    }
    if (type === 'application/pdf' || extension === 'pdf') {
      this.entryObjectUrl = URL.createObjectURL(new Blob([copyBytesToArrayBuffer(source)], { type: 'application/pdf' }));
      const frame = document.createElement('iframe');
      frame.className = 'archivev-entry-frame';
      frame.title = name;
      frame.src = this.entryObjectUrl;
      host.replaceChildren(frame);
      return;
    }
    if (type.startsWith('audio/') || type.startsWith('video/')) {
      this.entryObjectUrl = URL.createObjectURL(new Blob([copyBytesToArrayBuffer(source)], { type }));
      const media = document.createElement(type.startsWith('audio/') ? 'audio' : 'video');
      media.className = 'archivev-entry-media';
      media.controls = true;
      media.src = this.entryObjectUrl;
      host.replaceChildren(media);
      return;
    }

    const pre = document.createElement('pre');
    pre.className = 'archivev-entry-text';
    pre.textContent = new TextDecoder().decode(source);
    host.replaceChildren(pre);
  }

  private async openNestedArchive(name: string): Promise<void> {
    const current = this.archiveStack[this.archiveStack.length - 1];
    if (!current) {
      return;
    }

    const routePrefix = this.state.route === '/' ? '' : this.state.route.replace(/^\//, '');
    const archiveEntry = current.entries.find((entry) => entry.type === 'file' && entry.name === `${routePrefix}${name}`);
    if (!archiveEntry) {
      return;
    }

    this.state = {
      ...this.state,
      loading: true,
      error: null
    };
    this.emit('loading', this.state);
    this.emit('statechange', this.state);

    try {
      const label = name.split('/').pop() ?? name;
      this.archiveStack.push(await readArchive(await archiveEntry.read(), detectArchiveFormat(label), label));
      this.state = {
        ...this.state,
        loading: false,
        error: null
      };
      this.setRoute('/');
      this.emit('rendered', this.state);
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      this.state.loading = false;
      this.state.error = normalizedError.message;
      this.emit('error', normalizedError);
      this.emit('statechange', this.state);
    }
  }

  private popArchive(): void {
    if (this.archiveStack.length <= 1) {
      return;
    }
    this.archiveStack.pop();
    this.setRoute('/');
  }

  private emit<T extends PreviewEventName>(event: T, payload: PreviewEventMap[T]): void {
    for (const handler of this.listeners[event]) {
      handler(payload as never);
    }
  }
}

export function createArchivePreviewDriver(): PreviewDriver<ArchivePreviewState> {
  return {
    id: 'archive',
    family: 'archive',
    supports: (format) => isSupportedArchiveFormat(normalizeFormat(format)),
    createSession: (host, options) => new ArchivePreviewSession(host, options)
  };
}

export function createArchivePreviewRoutes(baseRoutes = createDefaultPreviewRoutes()): FormatDefinition[] {
  const archiveFormats = new Set(ARCHIVE_FORMAT_ROUTES.flatMap((route) => route.extensions));
  return [
    ...ARCHIVE_FORMAT_ROUTES,
    ...baseRoutes.filter((route) => !route.extensions.some((extension) => archiveFormats.has(extension)))
  ];
}

export function createArchiveCategoryPreviewRoutes(baseRoutes: FormatDefinition[] = []): FormatDefinition[] {
  return createArchivePreviewRoutes(baseRoutes);
}

export async function createArchiveResourceIndex(
  source: PreviewSource,
  context: PreviewLoadContext,
  options: ArchiveResourceResolverOptions = {}
): Promise<ArchiveResourceIndex> {
  const label = context.descriptor.name ?? 'archive';
  const format = detectArchiveFormat(label, context.route?.sourceFormat ?? context.descriptor.extension);
  const archive = await readArchive(new Uint8Array(await sourceToArrayBuffer(source, context)), format, label);
  const root = normalizeZipEntryName(options.root ?? '');
  const entries = archive.entries.map((entry) => createArchiveResource(entry, options.contentTypes)).sort(compareArchiveEntries);
  const files = entries.filter((entry) => entry.type === 'file');
  const exact = new Map(files.map((entry) => [normalizeZipEntryName(entry.name), entry]));
  const rooted = new Map(
    files
      .filter((entry) => root && normalizeZipEntryName(entry.name).startsWith(`${root}/`))
      .map((entry) => [normalizeZipEntryName(entry.name).slice(root.length + 1), entry])
  );
  const basename = createUniqueBasenameMap(files);

  return {
    entries,
    files,
    resolve: async (request) => {
      if (context.signal?.aborted) {
        throw new DOMException('Archive resource resolution aborted.', 'AbortError');
      }
      const entry = findZipResourceEntry(request.source ?? request.name ?? '', exact, rooted, basename);
      if (!entry || entry.type !== 'file') {
        return undefined;
      }
      return { source: options.preferBlob ? await entry.readAsBlob() : await entry.readAsArrayBuffer() };
    },
    read: (name) => findZipResourceEntry(name, exact, rooted, basename)
  };
}

export async function createArchiveResourceResolver(
  source: PreviewSource,
  context: PreviewLoadContext,
  options: ArchiveResourceResolverOptions = {}
): Promise<PreviewResourceResolver> {
  return (await createArchiveResourceIndex(source, context, options)).resolve;
}

export async function createZipArchiveResourceIndex(
  source: PreviewSource,
  context: PreviewLoadContext,
  options: ZipResourceResolverOptions = {}
): Promise<ZipArchiveResourceIndex> {
  return createArchiveResourceIndex(source, context, options);
}

export async function createZipResourceResolver(
  source: PreviewSource,
  context: PreviewLoadContext,
  options: ZipResourceResolverOptions = {}
): Promise<PreviewResourceResolver> {
  const index = await createZipArchiveResourceIndex(source, context, options);
  return index.resolve;
}

async function readArchive(bytes: Uint8Array, format: string, label: string): Promise<ArchiveFrame> {
  if (isZipFormat(format)) {
    const zip = await JSZip.loadAsync(bytes);
    return {
      label,
      entries: Object.values(zip.files).map((entry) => ({
        name: entry.name,
        type: entry.dir ? 'directory' as const : 'file' as const,
        size: entry.dir ? undefined : getEntrySize(entry),
        modified: entry.date?.getTime(),
        read: () => entry.async('uint8array')
      })).sort(compareArchiveEntries)
    };
  }

  if (format === 'tar') {
    return { label, entries: readTarEntries(bytes) };
  }

  if (format === 'gz' || format === 'tgz') {
    // ponytail: gzip is expanded in memory; switch to streaming if huge archives become an explicit requirement.
    const expanded = await decompressGzip(bytes);
    if (format === 'tgz' || looksLikeTar(expanded)) {
      return { label, entries: readTarEntries(expanded) };
    }
    const name = label.replace(/\.gz$/i, '') || 'file';
    return {
      label,
      entries: [{ name, type: 'file', size: expanded.byteLength, read: async () => expanded.slice() }]
    };
  }

  throw new Error(`Archive preview does not support ${format || 'unknown'} files.`);
}

function readTarEntries(bytes: Uint8Array): ArchiveEntryRecord[] {
  const entries: ArchiveEntryRecord[] = [];
  for (let offset = 0; offset + 512 <= bytes.byteLength;) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    if (!hasValidTarChecksum(header)) throw new Error('Invalid TAR header checksum.');

    const size = readTarNumber(header, 124, 12);
    const typeFlag = String.fromCharCode(header[156] ?? 0);
    const prefix = readTarString(header, 345, 155);
    const rawName = readTarString(header, 0, 100);
    const normalizedName = normalizeZipEntryName(prefix ? `${prefix}/${rawName}` : rawName);
    const dataOffset = offset + 512;
    const nextOffset = dataOffset + Math.ceil(size / 512) * 512;
    if (nextOffset > bytes.byteLength) throw new Error('Truncated TAR entry.');

    if (normalizedName && (typeFlag === '\0' || typeFlag === '0' || typeFlag === '5')) {
      const directory = typeFlag === '5';
      const name = directory ? `${normalizedName.replace(/\/+$/, '')}/` : normalizedName;
      const modifiedSeconds = readTarNumber(header, 136, 12);
      entries.push({
        name,
        type: directory ? 'directory' : 'file',
        size: directory ? undefined : size,
        modified: modifiedSeconds > 0 ? modifiedSeconds * 1000 : undefined,
        read: async () => directory ? new Uint8Array() : bytes.slice(dataOffset, dataOffset + size)
      });
    }
    offset = nextOffset;
  }
  return entries.sort(compareArchiveEntries);
}

async function decompressGzip(bytes: Uint8Array): Promise<Uint8Array> {
  return gunzipSync(bytes);
}

function looksLikeTar(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 512 && !bytes.subarray(0, 512).every((value) => value === 0) && hasValidTarChecksum(bytes.subarray(0, 512));
}

function hasValidTarChecksum(header: Uint8Array): boolean {
  const expected = readTarNumber(header, 148, 8);
  let actual = 0;
  for (let index = 0; index < 512; index += 1) {
    actual += index >= 148 && index < 156 ? 32 : header[index] ?? 0;
  }
  return expected === actual;
}

function readTarString(bytes: Uint8Array, offset: number, length: number): string {
  const field = bytes.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return new TextDecoder().decode(end >= 0 ? field.subarray(0, end) : field).trim();
}

function readTarNumber(bytes: Uint8Array, offset: number, length: number): number {
  const value = readTarString(bytes, offset, length).replace(/^0+/, '').trim();
  return value ? Number.parseInt(value, 8) : 0;
}

function normalizeArchiveRoute(route: string): string {
  const normalized = String(route || '/').trim().replace(/\\/g, '/');
  if (!normalized || normalized === '/') {
    return '/';
  }
  const cleaned = normalized.replace(/^\/+/, '').replace(/\/+$/, '');
  return cleaned ? `/${cleaned}/` : '/';
}

function canNavigateUp(route: string): boolean {
  const normalized = normalizeArchiveRoute(route);
  return normalized !== '/';
}

function parentArchiveRoute(route: string): string {
  const normalized = normalizeArchiveRoute(route);
  if (normalized === '/') {
    return '/';
  }
  const trimmed = normalized.replace(/^\/|\/$/g, '');
  const parts = trimmed.split('/').filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join('/')}/` : '/';
}

function joinArchiveRoute(baseRoute: string, entryName: string): string {
  const normalizedBase = normalizeArchiveRoute(baseRoute);
  const base = normalizedBase === '/' ? '' : normalizedBase.replace(/^\/|\/$/g, '');
  const cleanEntry = String(entryName).replace(/\\/g, '/').replace(/\/+$/g, '').replace(/^\/+/, '');
  const joined = [base, cleanEntry].filter(Boolean).join('/');
  return joined ? `/${joined}/` : '/';
}

function listEntriesForRoute(
  entries: Array<{ name: string; type: 'file' | 'directory'; size?: number; modified?: number }>,
  route: string
): ArchivePreviewState['entries'] {
  const normalizedRoute = normalizeArchiveRoute(route);
  const prefix = normalizedRoute === '/' ? '' : normalizedRoute.slice(1);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const listing = new Map<string, ArchivePreviewState['entries'][number]>();

  for (const entry of entries) {
    if (prefix && !entry.name.startsWith(prefix)) {
      continue;
    }
    const remainder = prefix ? entry.name.slice(prefix.length) : entry.name;
    if (!remainder) {
      continue;
    }
    const segment = remainder.split('/', 1)[0] ?? remainder;
    if (!segment) {
      continue;
    }
    const hasMore = remainder.length > segment.length;
    const name = hasMore ? `${segment}/` : segment;
    if (listing.has(name)) {
      continue;
    }

    if (hasMore) {
      const explicitDir = byName.get(`${prefix}${name}`);
      listing.set(name, {
        name,
        type: 'directory',
        modified: explicitDir?.modified
      });
      continue;
    }

    listing.set(name, {
      name,
      type: 'file',
      size: entry.size,
      modified: entry.modified
    });
  }

  return [...listing.values()].sort(compareArchiveEntries);
}

function detectArchiveFormat(name: string, format?: string): string {
  const normalizedName = String(name).trim().toLowerCase().split(/[?#]/, 1)[0] ?? '';
  if (normalizedName.endsWith('.tar.gz') || normalizedName.endsWith('.tgz')) return 'tgz';
  return normalizeFormat(format || normalizedName.split('.').pop());
}

function isSupportedArchiveFile(name: string): boolean {
  return isSupportedArchiveFormat(detectArchiveFormat(name));
}

function isSupportedArchiveFormat(format: string): boolean {
  return isZipFormat(format) || format === 'tar' || format === 'tgz' || format === 'gz';
}

function isZipFormat(format: string): boolean {
  return ['zip', 'jar', 'war', 'ear', 'apk'].includes(format);
}

async function sourceToArrayBuffer(source: PreviewSource, context: PreviewLoadContext): Promise<ArrayBuffer> {
  if (typeof source === 'string') {
    const response = await fetch(source, { signal: context.signal });
    if (!response.ok) {
      throw new Error(`Failed to load archive source: ${response.status} ${response.statusText}`.trim());
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

function createTableHead(): HTMLTableSectionElement {
  const head = document.createElement('thead');
  const row = document.createElement('tr');
  for (const label of ['Name', 'Type', 'Size', 'Modified']) {
    const header = document.createElement('th');
    header.textContent = label;
    row.appendChild(header);
  }
  head.appendChild(row);
  return head;
}

function createBreadcrumbSeparator(): HTMLSpanElement {
  const separator = document.createElement('span');
  separator.className = 'archivev-breadcrumb-separator';
  separator.textContent = '›';
  separator.setAttribute('aria-hidden', 'true');
  return separator;
}

function extensionFromName(name: string): string {
  const normalized = name.toLowerCase().split(/[?#]/, 1)[0] ?? '';
  const segment = normalized.split(/[\\/]/).pop() ?? '';
  const dot = segment.lastIndexOf('.');
  return dot >= 0 ? segment.slice(dot + 1) : '';
}

function compareArchiveEntries(
  left: ArchivePreviewState['entries'][number],
  right: ArchivePreviewState['entries'][number]
): number {
  if (left.type !== right.type) {
    return left.type === 'directory' ? -1 : 1;
  }
  return left.name.localeCompare(right.name);
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = size / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function getEntrySize(entry: JSZip.JSZipObject): number | undefined {
  const metadata = entry as JSZip.JSZipObject & {
    _data?: {
      uncompressedSize?: number;
    };
  };
  return metadata._data?.uncompressedSize;
}

function normalizeFormat(format: string | undefined): string {
  return String(format ?? '').trim().replace(/^\./, '').toLowerCase();
}

function createArchiveResource(
  entry: ArchiveEntryRecord,
  contentTypes: Record<string, string> | undefined
): ArchiveResource {
  const contentType = entry.type === 'directory' ? undefined : resolveZipContentType(entry.name, contentTypes);
  return {
    name: entry.name,
    type: entry.type,
    size: entry.size,
    modified: entry.modified,
    contentType,
    readAsArrayBuffer: async () => {
      const bytes = await entry.read();
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      return copy.buffer;
    },
    readAsBlob: async () => {
      const bytes = await entry.read();
      return new Blob([copyBytesToArrayBuffer(bytes)], contentType ? { type: contentType } : undefined);
    },
    readAsText: async () => new TextDecoder().decode(await entry.read())
  };
}

function createUniqueBasenameMap(entries: ArchiveResource[]): Map<string, ArchiveResource> {
  const candidates = new Map<string, ArchiveResource | null>();
  for (const entry of entries) {
    const basename = normalizeZipEntryName(entry.name).split('/').pop();
    if (!basename) {
      continue;
    }
    candidates.set(basename, candidates.has(basename) ? null : entry);
  }
  return new Map([...candidates.entries()].filter((entry): entry is [string, ArchiveResource] => entry[1] != null));
}

function findZipResourceEntry(
  name: string,
  exact: Map<string, ArchiveResource>,
  rooted: Map<string, ArchiveResource>,
  basename: Map<string, ArchiveResource>
): ArchiveResource | undefined {
  const normalized = normalizeZipEntryName(name);
  if (!normalized) {
    return undefined;
  }
  return exact.get(normalized) ?? rooted.get(normalized) ?? basename.get(normalized.split('/').pop() ?? '');
}

function normalizeZipEntryName(name: string): string {
  const trimmed = String(name ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^[a-z]+:\/\/[^/]+\//i, '')
    .replace(/^[a-z]:\//i, '')
    .replace(/^\/+/, '')
    .split(/[?#]/)[0] ?? '';
  const parts: string[] = [];
  for (const part of trimmed.split('/')) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(decodeUriPart(part));
  }
  return parts.join('/');
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function decodeUriPart(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

function resolveZipContentType(name: string, contentTypes: Record<string, string> | undefined): string | undefined {
  const normalized = normalizeZipEntryName(name);
  const extension = normalizeFormat(normalized.split('?')[0]?.split('.').pop());
  return contentTypes?.[normalized] ?? contentTypes?.[extension] ?? defaultContentTypeForExtension(extension);
}

function defaultContentTypeForExtension(extension: string): string | undefined {
  const types: Record<string, string> = {
    bin: 'application/octet-stream',
    css: 'text/css',
    gif: 'image/gif',
    gltf: 'model/gltf+json',
    html: 'text/html',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    json: 'application/json',
    ktx2: 'image/ktx2',
    obj: 'model/obj',
    png: 'image/png',
    svg: 'image/svg+xml',
    txt: 'text/plain',
    webp: 'image/webp',
    xhtml: 'application/xhtml+xml'
  };
  return types[extension];
}
