import { gunzipSync } from 'fflate';
import {
  createDefaultPreviewRoutes,
  openZipArchive,
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
  resources?: Map<string, ArchiveEntryRecord>;
  listings?: Map<string, ArchivePreviewState['entries']>;
  directories?: Map<string, ArchiveEntryRecord[]>;
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
  private loadController: AbortController | null = null;
  private entryController: AbortController | null = null;
  private renderVersion = 0;
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
    this.stopLoad();
    const controller = new AbortController(), signal = controller.signal;
    this.loadController = controller;
    const abort = () => controller.abort();
    context.signal?.addEventListener('abort', abort, { once: true });
    signal.addEventListener('abort', () => {
      context.signal?.removeEventListener('abort', abort);
      if (this.loadController !== controller) return;
      this.stopLoad();
      this.state = { ...this.state, loading: false, error: null, warnings: [], route: '/', entries: [] };
      this.emit('statechange', this.state);
    }, { once: true });
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
      if (context.signal?.aborted) controller.abort();
      checkArchiveLoadAborted(signal);
      const bytes = new Uint8Array(await sourceToArrayBuffer(source, { ...context, signal }));
      checkArchiveLoadAborted(signal);
      const label = context.descriptor.name ?? 'archive';
      const format = detectArchiveFormat(label, context.route?.sourceFormat ?? context.descriptor.extension);
      const archive = await readArchive(bytes, format, label, signal);
      checkArchiveLoadAborted(signal);
      this.archiveStack = [archive];

      this.state = {
        ...this.state,
        loading: false,
        error: null
      };
      this.setRoute('/');
      this.emit('rendered', this.state);
      this.emit('statechange', this.state);
    } catch (error) {
      if (signal.aborted) {
        if (context.signal?.aborted) checkArchiveLoadAborted(signal);
        return;
      }
      this.stopLoad();
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      this.state.loading = false;
      this.state.error = normalizedError.message;
      this.emit('error', normalizedError);
      this.emit('statechange', this.state);
      throw normalizedError;
    }
  }

  destroy(): void {
    this.stopLoad();
    this.state = { ...this.state, loading: false, error: null, warnings: [], route: '/', entries: [] };
    if (this.root.parentElement === this.host) this.host.replaceChildren();
    for (const handlers of Object.values(this.listeners)) handlers.clear();
  }

  private stopLoad(): void {
    const controller = this.loadController;
    this.loadController = null;
    controller?.abort();
    this.closeEntryPreview(false);
    this.archiveStack = [];
    this.renderVersion++;
    this.root.replaceChildren();
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
    const version = ++this.renderVersion;
    const isCurrent = () => version === this.renderVersion && Boolean(this.loadController && !this.loadController.signal.aborted);
    const summary = document.createElement('div');
    summary.className = 'archivev-summary';
    summary.appendChild(this.createBreadcrumbs(isCurrent));
    const itemCount = document.createElement('span');
    itemCount.className = 'archivev-item-count';
    itemCount.textContent = `${this.state.entries.length} item${this.state.entries.length === 1 ? '' : 's'}`;
    summary.appendChild(itemCount);

    const toolbar = document.createElement('div');
    toolbar.className = 'archivev-toolbar';

    const upButton = document.createElement('button');
    upButton.type = 'button';
    upButton.className = 'archivev-button';
    upButton.textContent = 'Up';
    upButton.disabled = !canNavigateUp(this.state.route);
    upButton.addEventListener('click', () => { if (isCurrent()) this.navigateUp(); });

    const rootButton = document.createElement('button');
    rootButton.type = 'button';
    rootButton.className = 'archivev-button';
    rootButton.textContent = 'Root';
    rootButton.disabled = this.state.route === '/';
    rootButton.addEventListener('click', () => { if (isCurrent()) this.setRoute('/'); });

    const closeNestedButton = document.createElement('button');
    closeNestedButton.type = 'button';
    closeNestedButton.className = 'archivev-button';
    closeNestedButton.textContent = this.entryController ? 'Back to archive' : 'Back';
    closeNestedButton.disabled = !this.entryController && this.archiveStack.length <= 1;
    closeNestedButton.addEventListener('click', () => {
      if (isCurrent()) this.entryController ? this.closeEntryPreview() : this.popArchive();
    });

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

      row.addEventListener('click', () => { if (isCurrent()) this.activateEntry(entry); });
      row.addEventListener('keydown', (event) => {
        if (isCurrent() && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          this.activateEntry(entry);
        }
      });

      body.appendChild(row);
    }
    table.appendChild(body);
    this.root.replaceChildren(summary, toolbar, table);
  }

  private createBreadcrumbs(isCurrentRender: () => boolean): HTMLElement {
    const breadcrumbs = document.createElement('nav');
    breadcrumbs.className = 'archivev-breadcrumbs';
    breadcrumbs.setAttribute('aria-label', 'Archive path');

    const route = normalizeArchiveRoute(this.state.route);
    const hasCurrentEntry = this.entryController !== null;

    this.archiveStack.forEach((frame, index) => {
      if (index > 0) breadcrumbs.appendChild(createBreadcrumbSeparator());
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'archivev-breadcrumb';
      button.textContent = frame.label;
      const isCurrentArchive = index === this.archiveStack.length - 1;
      button.disabled = isCurrentArchive && route === '/' && !hasCurrentEntry;
      button.addEventListener('click', () => {
        if (!isCurrentRender()) return;
        if (isCurrentArchive) {
          this.setRoute('/');
        } else {
          this.popToArchive(index);
        }
      });
      breadcrumbs.appendChild(button);
    });

    const parts = route === '/' ? [] : route.slice(1, -1).split('/').filter(Boolean);

    let nextRoute = '/';
    for (const part of parts) {
      nextRoute = joinArchiveRoute(nextRoute, `${part}/`);
      breadcrumbs.appendChild(createBreadcrumbSeparator());
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'archivev-breadcrumb';
      button.textContent = part;
      button.disabled = nextRoute === route && !hasCurrentEntry;
      const targetRoute = nextRoute;
      button.addEventListener('click', () => { if (isCurrentRender()) this.setRoute(targetRoute); });
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
    const frame = this.archiveStack[this.archiveStack.length - 1];
    if (!entry || !frame) {
      return;
    }
    const controller = this.startEntryOperation();
    if (!controller) return;
    const signal = controller.signal;
    const isCurrent = () => this.entryController === controller && !signal.aborted;

    this.state = { ...this.state, loading: true, error: null };
    this.emit('loading', this.state);
    this.emit('statechange', this.state);
    this.render();

    try {
      const source = await waitForArchiveLoad(entry.read(), signal);
      checkArchiveLoadAborted(signal);
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
        const previewer = previewerFactory(this.entryPreviewHost, {
          ...this.options,
          resourceResolver: this.createEntryResourceResolver(frame, entry.name, signal)
        });
        this.entryPreviewer = previewer;
        this.entryPreviewUnsubscribes = [
          previewer.on('error', (error) => { if (isCurrent()) this.setEntryPreviewError(error); }),
          previewer.on('warnings', (warnings) => {
            if (!isCurrent()) return;
            this.state = { ...this.state, warnings };
            this.emit('warnings', warnings);
            this.emit('statechange', this.state);
          })
        ];
        await waitForArchiveLoad(previewer.preview(source, {
          name,
          extension: extensionFromName(name),
          contentType: this.activeEntry.contentType
        }), signal);
        checkArchiveLoadAborted(signal);
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
      if (!isCurrent()) return;
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
    const controller = this.entryController;
    this.entryController = null;
    controller?.abort();
    this.entryPreviewUnsubscribes.splice(0).forEach((unsubscribe) => unsubscribe());
    this.entryPreviewer?.destroy();
    this.entryPreviewer = null;
    for (const media of this.entryPreviewHost?.querySelectorAll('audio, video') ?? []) {
      const element = media as HTMLMediaElement;
      element.pause();
      element.removeAttribute('src');
      element.load();
    }
    this.entryPreviewHost?.replaceChildren();
    this.entryPreviewHost = null;
    this.activeEntry = null;
    if (this.entryObjectUrl) {
      URL.revokeObjectURL(this.entryObjectUrl);
      this.entryObjectUrl = null;
    }
    if (shouldRender && this.loadController && !this.loadController.signal.aborted) {
      this.state = { ...this.state, loading: false, error: null, warnings: [] };
      this.render();
      this.emit('statechange', this.state);
    }
  }

  private startEntryOperation(): AbortController | null {
    this.closeEntryPreview(false);
    const parent = this.loadController?.signal;
    if (!parent || parent.aborted) return null;
    const controller = new AbortController(), abort = () => controller.abort();
    this.entryController = controller;
    parent.addEventListener('abort', abort, { once: true });
    controller.signal.addEventListener('abort', () => parent.removeEventListener('abort', abort), { once: true });
    return controller;
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
    if (this.entryController) {
      this.closeEntryPreview(false);
    }
    const current = this.archiveStack[this.archiveStack.length - 1];
    if (!current) {
      return;
    }

    const normalized = normalizeArchiveRoute(route);
    current.listings ??= new Map();
    let entries = current.listings.get(normalized);
    if (!entries) {
      const candidates = normalized === '/' ? current.entries
        : (current.directories ??= indexArchiveDirectories(current.entries)).get(normalized.slice(1)) ?? [];
      entries = listEntriesForRoute(candidates, normalized);
      current.listings.set(normalized, entries);
    }
    this.state = {
      ...this.state,
      loading: false,
      error: null,
      warnings: [],
      route: normalized,
      entries: entries.map(entry => ({ ...entry }))
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

  private createEntryResourceResolver(frame: ArchiveFrame, name: string, signal: AbortSignal): PreviewResourceResolver {
    const externalResolver = this.options.resourceResolver;
    const directory = name.slice(0, name.lastIndexOf('/') + 1);
    const entries = frame.resources ??= new Map(frame.entries.filter(entry => entry.type === 'file').map(entry => [normalizeZipEntryName(entry.name), entry]));
    return async (request) => {
      checkArchiveLoadAborted(signal);
      const source = request.source ?? request.name;
      if (source && !/^[a-z][a-z\d+.-]*:/i.test(source)) {
        const rooted = /^[\\/]/.test(source);
        const entry = (!rooted ? entries.get(normalizeZipEntryName(directory + source)) : undefined)
          ?? entries.get(normalizeZipEntryName(source));
        if (entry) {
          const bytes = await waitForArchiveLoad(entry.read(), signal);
          checkArchiveLoadAborted(signal);
          return {
            source: bytes,
            warnings: []
          };
        }
      }
      return externalResolver ? waitForArchiveLoad(Promise.resolve(externalResolver(request)), signal) : undefined;
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
    const controller = this.startEntryOperation();
    if (!controller) return;
    const signal = controller.signal;

    this.state = {
      ...this.state,
      loading: true,
      error: null
    };
    this.emit('loading', this.state);
    this.emit('statechange', this.state);
    this.render();

    try {
      const label = name.split('/').pop() ?? name;
      const bytes = await waitForArchiveLoad(archiveEntry.read(), signal);
      checkArchiveLoadAborted(signal);
      const archive = await readArchive(bytes, detectArchiveFormat(label), label, signal);
      checkArchiveLoadAborted(signal);
      this.closeEntryPreview(false);
      this.archiveStack.push(archive);
      this.state = {
        ...this.state,
        loading: false,
        error: null
      };
      this.setRoute('/');
      this.emit('rendered', this.state);
    } catch (error) {
      if (signal.aborted) return;
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
  const archive = await readArchive(new Uint8Array(await sourceToArrayBuffer(source, context)), format, label, context.signal);
  checkArchiveLoadAborted(context.signal);
  const root = normalizeZipEntryName(options.root ?? '');
  // readArchive already sorts entries. Build every lookup from the same
  // normalized path instead of repeating path/URI parsing for each map.
  const entries: ArchiveResource[] = [];
  const files: ArchiveResource[] = [];
  const exact = new Map<string, ArchiveResource>();
  const rooted = new Map<string, ArchiveResource>();
  const basename = new Map<string, ArchiveResource | null>();
  const rootPrefix = root ? `${root}/` : '';
  for (const record of archive.entries) {
    const name = normalizeZipEntryName(record.name);
    const entry = createArchiveResource(record, options.contentTypes, name, context.signal);
    entries.push(entry);
    if (entry.type !== 'file') continue;
    files.push(entry);
    exact.set(name, entry);
    if (rootPrefix && name.startsWith(rootPrefix)) rooted.set(name.slice(rootPrefix.length), entry);
    const base = name.slice(name.lastIndexOf('/') + 1);
    if (base) basename.set(base, basename.has(base) ? null : entry);
  }

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

async function readArchive(bytes: Uint8Array, format: string, label: string, signal?: AbortSignal): Promise<ArchiveFrame> {
  checkArchiveLoadAborted(signal);
  if (isZipFormat(format)) {
    const zip = await waitForArchiveLoad(openZipArchive(bytes), signal);
    checkArchiveLoadAborted(signal);
    return {
      label,
      entries: [...zip.values()].map((entry) => ({
        name: entry.name,
        type: entry.directory ? 'directory' as const : 'file' as const,
        size: entry.directory ? undefined : entry.size,
        modified: entry.modified,
        read: () => entry.bytes()
      })).sort(compareArchiveEntries)
    };
  }

  if (format === 'tar') {
    return { label, entries: readTarEntries(bytes) };
  }

  if (format === 'gz' || format === 'tgz') {
    // ponytail: gzip is expanded in memory; switch to streaming if huge archives become an explicit requirement.
    const expanded = await waitForArchiveLoad(decompressGzip(bytes), signal);
    checkArchiveLoadAborted(signal);
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
  const globalAttributes = new Map<string, string>();
  let localAttributes = new Map<string, string>();
  let longName: string | undefined;
  for (let offset = 0; offset + 512 <= bytes.byteLength;) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    if (!hasValidTarChecksum(header)) throw new Error('Invalid TAR header checksum.');

    const typeFlag = String.fromCharCode(header[156] ?? 0);
    const extension = ['x', 'g', 'L', 'K'].includes(typeFlag);
    const attribute = (key: string) => localAttributes.get(key) ?? globalAttributes.get(key);
    const extendedSize = extension ? undefined : attribute('size');
    const size = extendedSize ? readPaxNumber(extendedSize, true) : readTarNumber(header, 124, 12);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid TAR entry size.');
    const dataOffset = offset + 512;
    const nextOffset = dataOffset + Math.ceil(size / 512) * 512;
    if (!Number.isSafeInteger(nextOffset) || nextOffset > bytes.byteLength) throw new Error('Truncated TAR entry.');

    if (extension) {
      const data = bytes.subarray(dataOffset, dataOffset + size);
      if (typeFlag === 'L') {
        const end = data.indexOf(0);
        longName = new TextDecoder().decode(end < 0 ? data : data.subarray(0, end));
      } else if (typeFlag !== 'K') {
        const attributes = readPaxAttributes(data);
        for (const [key, value] of attributes) {
          if (typeFlag === 'g') {
            if (value) globalAttributes.set(key, value);
            else globalAttributes.delete(key);
          } else localAttributes.set(key, value);
        }
      }
      offset = nextOffset;
      continue;
    }

    const prefix = readTarString(header, 345, 155);
    const rawName = readTarString(header, 0, 100);
    const normalizedName = normalizeZipEntryName(attribute('path') || longName || (prefix ? `${prefix}/${rawName}` : rawName));
    const extendedModified = attribute('mtime');
    const modifiedSeconds = extendedModified ? readPaxNumber(extendedModified, false) : readTarNumber(header, 136, 12);
    localAttributes = new Map();
    longName = undefined;

    if (normalizedName && (typeFlag === '\0' || typeFlag === '0' || typeFlag === '5')) {
      const directory = typeFlag === '5';
      const name = directory ? `${normalizedName.replace(/\/+$/, '')}/` : normalizedName;
      entries.push({
        name,
        type: directory ? 'directory' : 'file',
        size: directory ? undefined : size,
        modified: extendedModified || modifiedSeconds > 0 ? modifiedSeconds * 1000 : undefined,
        read: async () => directory ? new Uint8Array() : bytes.slice(dataOffset, dataOffset + size)
      });
    }
    offset = nextOffset;
  }
  return entries.sort(compareArchiveEntries);
}

function readPaxAttributes(bytes: Uint8Array): Map<string, string> {
  const attributes = new Map<string, string>();
  const decoder = new TextDecoder();
  for (let offset = 0; offset < bytes.length;) {
    const space = bytes.indexOf(32, offset);
    if (space < 0) throw new Error('Invalid TAR extended header length.');
    const length = readPaxNumber(decoder.decode(bytes.subarray(offset, space)), true);
    const end = offset + length;
    if (end <= space + 1 || end > bytes.length || bytes[end - 1] !== 10) throw new Error('Truncated TAR extended header.');
    const field = decoder.decode(bytes.subarray(space + 1, end - 1));
    const equals = field.indexOf('=');
    if (equals <= 0) throw new Error('Invalid TAR extended header field.');
    attributes.set(field.slice(0, equals), field.slice(equals + 1));
    offset = end;
  }
  return attributes;
}

function readPaxNumber(value: string, integer: boolean): number {
  const result = Number(value);
  if (!(integer ? /^\d+$/ : /^-?\d+(?:\.\d+)?$/).test(value) ||
      !Number.isFinite(result) || (integer && !Number.isSafeInteger(result))) {
    throw new Error('Invalid TAR extended header number.');
  }
  return result;
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

// Build this only when a non-root directory is opened. Keep archive order and
// explicit directory records so duplicate metadata and locale sorting stay the
// same. Store direct children and one representative per implicit directory,
// rather than keeping every descendant under every ancestor.
function indexArchiveDirectories(entries: ArchiveEntryRecord[]): Map<string, ArchiveEntryRecord[]> {
  const directories = new Map<string, ArchiveEntryRecord[]>();
  for (const entry of entries) {
    let parent = '';
    for (let slash = entry.name.indexOf('/'); slash >= 0; slash = entry.name.indexOf('/', slash + 1)) {
      const prefix = entry.name.slice(0, slash + 1);
      const known = directories.has(prefix);
      if (!known) directories.set(prefix, []);
      if (parent && (!known || slash === entry.name.length - 1)) {
        directories.get(parent)!.push(entry);
      }
      parent = prefix;
    }
    if (parent && !entry.name.endsWith('/')) directories.get(parent)!.push(entry);
  }
  return directories;
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
  const signal = context.signal;
  checkArchiveLoadAborted(signal);
  if (typeof source === 'string') {
    const release = (response: Response): void => { void response.body?.cancel().catch(() => {}); };
    const response = await waitForArchiveLoad(fetch(source, { signal }), signal, release);
    try {
      checkArchiveLoadAborted(signal);
      if (!response.ok) {
        throw new Error(`Failed to load archive source: ${response.status} ${response.statusText}`.trim());
      }
      return await waitForArchiveLoad(response.arrayBuffer(), signal);
    } catch (error) {
      release(response);
      throw error;
    }
  }
  if (ArrayBuffer.isView(source)) {
    const bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer as ArrayBuffer;
  }
  if (source instanceof ArrayBuffer) {
    return source.slice(0);
  }
  if (source instanceof Blob) {
    return waitForArchiveLoad(source.arrayBuffer(), signal);
  }
  return new TextEncoder().encode(String(source)).buffer as ArrayBuffer;
}

function checkArchiveLoadAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Archive preview aborted.', 'AbortError');
}

function waitForArchiveLoad<T>(pending: Promise<T>, signal?: AbortSignal, discard?: (value: T) => void): Promise<T> {
  if (!signal) return pending;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const abort = (): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      reject(new DOMException('Archive preview aborted.', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    void pending.then(value => {
      if (settled) { discard?.(value); return; }
      settled = true;
      signal.removeEventListener('abort', abort);
      resolve(value);
    }, error => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      reject(error);
    }).catch(() => { /* Observe failures from discarding a late response. */ });
  });
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

function normalizeFormat(format: string | undefined): string {
  return String(format ?? '').trim().replace(/^\./, '').toLowerCase();
}

function createArchiveResource(
  entry: ArchiveEntryRecord,
  contentTypes: Record<string, string> | undefined,
  normalizedName: string,
  signal?: AbortSignal
): ArchiveResource {
  const contentType = entry.type === 'directory' ? undefined : resolveZipContentType(normalizedName, contentTypes, true);
  return {
    name: entry.name,
    type: entry.type,
    size: entry.size,
    modified: entry.modified,
    contentType,
    readAsArrayBuffer: async () => {
      checkArchiveLoadAborted(signal);
      const bytes = await waitForArchiveLoad(entry.read(), signal);
      checkArchiveLoadAborted(signal);
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      return copy.buffer;
    },
    readAsBlob: async () => {
      checkArchiveLoadAborted(signal);
      const bytes = await waitForArchiveLoad(entry.read(), signal);
      checkArchiveLoadAborted(signal);
      return new Blob([copyBytesToArrayBuffer(bytes)], contentType ? { type: contentType } : undefined);
    },
    readAsText: async () => {
      checkArchiveLoadAborted(signal);
      const bytes = await waitForArchiveLoad(entry.read(), signal);
      checkArchiveLoadAborted(signal);
      return new TextDecoder().decode(bytes);
    }
  };
}

function findZipResourceEntry(
  name: string,
  exact: Map<string, ArchiveResource>,
  rooted: Map<string, ArchiveResource>,
  basename: Map<string, ArchiveResource | null>
): ArchiveResource | undefined {
  const normalized = normalizeZipEntryName(name);
  if (!normalized) {
    return undefined;
  }
  return exact.get(normalized) ?? rooted.get(normalized) ?? basename.get(normalized.slice(normalized.lastIndexOf('/') + 1)) ?? undefined;
}

function normalizeZipEntryName(name: string): string {
  const source = String(name ?? '');
  // Ordinary relative paths need neither URI decoding nor segment cleanup.
  if (!/[\\%?#:]|(?:^|\/)\.\.?(?:\/|$)|\/\/|^\/|\/$|^\s|\s$/.test(source)) return source;
  const trimmed = source
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

function resolveZipContentType(name: string, contentTypes: Record<string, string> | undefined, alreadyNormalized = false): string | undefined {
  const normalized = alreadyNormalized ? name : normalizeZipEntryName(name);
  const extension = normalizeFormat(normalized.split('?')[0]?.split('.').pop());
  return contentTypes?.[normalized] ?? contentTypes?.[extension] ?? defaultContentTypeForExtension(extension);
}

function defaultContentTypeForExtension(extension: string): string | undefined {
  const types: Record<string, string> = {
    aac: 'audio/aac',
    avif: 'image/avif',
    bin: 'application/octet-stream',
    bmp: 'image/bmp',
    css: 'text/css',
    gif: 'image/gif',
    flac: 'audio/flac',
    gltf: 'model/gltf+json',
    html: 'text/html',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    json: 'application/json',
    ktx2: 'image/ktx2',
    m4a: 'audio/mp4',
    m4v: 'video/mp4',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    obj: 'model/obj',
    oga: 'audio/ogg',
    ogg: 'audio/ogg',
    ogv: 'video/ogg',
    opus: 'audio/ogg',
    pdf: 'application/pdf',
    png: 'image/png',
    svg: 'image/svg+xml',
    txt: 'text/plain',
    wav: 'audio/wav',
    webm: 'video/webm',
    webp: 'image/webp',
    xhtml: 'application/xhtml+xml'
  };
  return types[extension];
}
