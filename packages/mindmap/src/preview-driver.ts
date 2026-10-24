import {
  createDefaultPreviewRoutes,
  type FormatDefinition,
  type MindmapPreviewState,
  type PreviewDriver,
  type PreviewEventMap,
  type PreviewEventName,
  type PreviewFitMode,
  type PreviewLoadContext,
  type PreviewOptions,
  type PreviewSession,
  type PreviewSource
} from '@filens/core';
import JSZip from 'jszip';

type PreviewListenerMap = {
  [K in PreviewEventName]: Set<(payload: PreviewEventMap[K]) => void>;
};

export interface MindmapNode {
  id: string;
  text: string;
  children: MindmapNode[];
}

export interface MindmapDocument {
  title?: string;
  root: MindmapNode;
  nodeCount: number;
}

interface PositionedMindmapNode extends MindmapNode {
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  children: PositionedMindmapNode[];
}

export const MINDMAP_FORMAT_ROUTES: FormatDefinition[] = [
  {
    extensions: ['mm', 'opml', 'xmind', 'mmap'],
    family: 'mindmap',
    driverId: 'mindmap',
    targetFormat: 'mindmap',
    contentTypes: [
      'text/x-opml',
      'application/x-freemind',
      'application/x-xmind',
      'application/vnd.xmind.workbook',
      'application/x-mindmanager',
      'application/vnd.mindjet.mindmanager'
    ]
  }
];

const MINDMAP_DIRECT_FORMATS = new Set(['mm', 'opml', 'xmind', 'mmap']);

const SVG_NS = 'http://www.w3.org/2000/svg';
const NODE_HEIGHT = 34;
const NODE_MIN_WIDTH = 110;
const NODE_MAX_WIDTH = 260;
const LEVEL_GAP = 90;
const SIBLING_GAP = 20;
const MARGIN = 36;

export class MindmapPreviewSession implements PreviewSession<MindmapPreviewState> {
  private readonly listeners: PreviewListenerMap = {
    loading: new Set(),
    rendered: new Set(),
    error: new Set(),
    statechange: new Set(),
    warnings: new Set()
  };
  private readonly root: HTMLDivElement;
  private scale: number;
  private fitMode: PreviewFitMode;
  private canvasSize?: { width: number; height: number };
  private readonly resizeObserver?: ResizeObserver;
  private document: MindmapDocument | null = null;
  private loadGeneration = 0;
  private loadController?: AbortController;
  private removeAbortListener?: () => void;
  private selectedNodeId: string | undefined;
  private state: MindmapPreviewState;

  constructor(private readonly host: HTMLElement, options: PreviewOptions = {}) {
    this.scale = options.initialScale ?? 1;
    this.fitMode = options.fit ?? 'contain';
    this.root = document.createElement('div');
    this.root.className = 'mindmapv-preview';
    this.host.replaceChildren(this.root);
    this.state = {
      loading: false,
      error: null,
      family: 'mindmap',
      warnings: [],
      capabilities: {
        zoom: true,
        fit: true,
        pan: true,
        outline: true,
        search: true,
        fullscreen: true,
        metadata: true,
        download: true
      },
      scale: this.scale
    };
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.fitMode === 'none') return;
        const previousScale = this.scale;
        this.applyScale();
        if (this.scale !== previousScale) this.emit('statechange', this.state);
      });
    }
  }

  async load(source: PreviewSource, context: PreviewLoadContext): Promise<void> {
    const generation = ++this.loadGeneration;
    this.loadController?.abort();
    this.removeAbortListener?.();
    this.releaseDocument();
    const controller = new AbortController();
    this.loadController = controller;
    const signal = context.signal;
    const abort = () => {
      controller.abort();
      if (generation === this.loadGeneration) {
        this.releaseDocument();
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
      selectedNodeId: undefined
    };
    this.emit('loading', this.state);
    this.emit('statechange', this.state);

    try {
      if (signal?.aborted) controller.abort();
      checkAborted(controller.signal);
      const format = normalizeFormat(context.route?.sourceFormat ?? context.descriptor.extension);
      if (!MINDMAP_DIRECT_FORMATS.has(format)) {
        throw new Error(
          `Mind-map preview currently supports FreeMind MM, OPML, XMind, and MindManager MMAP files, got ${format || 'unknown'}.`
        );
      }
      const loadContext = { ...context, signal: controller.signal };
      let model: MindmapDocument;
      if (format === 'xmind' || format === 'mmap') {
        const bytes = await sourceToArrayBuffer(source, loadContext);
        checkAborted(controller.signal);
        model = await (format === 'xmind' ? loadXmindDocument(bytes, loadContext) : loadMindmanagerDocument(bytes, loadContext));
      } else {
        const text = await sourceToText(source, loadContext);
        checkAborted(controller.signal);
        model = loadMindmapDocument(text, format);
      }
      if (generation !== this.loadGeneration) return;
      checkAborted(controller.signal);
      this.document = model;
      this.selectedNodeId = this.document.root.id;
      this.state = {
        ...this.state,
        loading: false,
        error: null,
        title: this.document.title ?? context.descriptor.name,
        selectedNodeId: this.selectedNodeId,
        scale: this.scale
      };
      this.render();
      this.emit('rendered', this.state);
      this.emit('statechange', this.state);
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      this.releaseDocument();
      this.state.loading = false;
      checkAborted(controller.signal);
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
    this.releaseDocument();
    this.state.loading = false;
    if (this.root.parentElement === this.host) {
      this.host.replaceChildren();
    }
    for (const listeners of Object.values(this.listeners)) listeners.clear();
  }

  getState(): MindmapPreviewState {
    return {
      ...this.state,
      warnings: [...this.state.warnings],
      selectedNodeId: this.selectedNodeId
    };
  }

  on<T extends PreviewEventName>(event: T, handler: (payload: PreviewEventMap[T]) => void): () => void {
    this.listeners[event].add(handler as never);
    return () => {
      this.listeners[event].delete(handler as never);
    };
  }

  setScale(scale: number): void {
    if (!Number.isFinite(scale)) return;
    this.scale = Math.max(0.25, Math.min(scale, 3));
    this.fitMode = 'none';
    this.state.scale = this.scale;
    this.applyScale();
    this.emit('statechange', this.state);
  }

  fit(mode: PreviewFitMode = 'contain'): void {
    this.fitMode = mode;
    if (mode === 'none') this.scale = 1;
    this.applyScale();
    this.state.scale = this.scale;
    this.root.scrollLeft = 0;
    this.root.scrollTop = 0;
    this.emit('statechange', this.state);
  }

  pan(deltaX: number, deltaY: number): void {
    this.root.scrollLeft += deltaX;
    this.root.scrollTop += deltaY;
  }

  async fullscreen(): Promise<void> {
    await this.root.requestFullscreen?.();
  }

  private render(): void {
    if (!this.document) {
      this.root.replaceChildren();
      return;
    }

    const positioned = layoutMindmap(this.document.root);
    const bounds = computeLayoutBounds(positioned);
    this.canvasSize = bounds;
    const shell = document.createElement('div');
    shell.className = 'mindmapv-canvas-wrap';
    shell.style.width = `${bounds.width}px`;
    shell.style.height = `${bounds.height}px`;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.classList.add('mindmapv-canvas');
    svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', this.document.title ?? 'Mind map preview');
    svg.appendChild(renderLinks(positioned));
    svg.appendChild(renderNodes(positioned, this.selectedNodeId, (id) => this.selectNode(id)));
    shell.appendChild(svg);

    const summary = document.createElement('div');
    summary.className = 'mindmapv-summary';
    summary.textContent = `${this.document.nodeCount} node${this.document.nodeCount === 1 ? '' : 's'}`;
    this.resizeObserver?.disconnect();
    this.root.replaceChildren(summary, shell);
    this.applyScale();
    this.resizeObserver?.observe(this.root);
    this.resizeObserver?.observe(summary);
  }

  selectNode(id?: string): void {
    if (!id) {
      this.selectedNodeId = undefined;
      this.state.selectedNodeId = undefined;
      this.root.querySelectorAll('.mindmapv-node').forEach((node) => {
        node.classList.remove('is-selected');
      });
      this.emit('statechange', this.state);
      return;
    }
    this.selectedNodeId = id;
    this.state.selectedNodeId = id;
    this.root.querySelectorAll('.mindmapv-node').forEach((node) => {
      node.classList.toggle('is-selected', node.getAttribute('data-node-id') === id);
    });
    this.emit('statechange', this.state);
  }

  private applyScale(): void {
    const wrapper = this.root.querySelector<HTMLElement>('.mindmapv-canvas-wrap');
    if (!wrapper || !this.canvasSize) {
      return;
    }
    if (this.fitMode !== 'none') {
      const width = this.root.clientWidth;
      const height = this.root.clientHeight - (this.root.firstElementChild as HTMLElement).offsetHeight;
      // Hidden or detached hosts retain their scale until they have a viewport.
      if (width > 0 && height > 0) {
        const widthScale = width / this.canvasSize.width;
        const heightScale = height / this.canvasSize.height;
        this.scale = this.fitMode === 'width' ? widthScale : this.fitMode === 'height'
          ? heightScale : Math.min(widthScale, heightScale);
      }
    }
    this.state.scale = this.scale;
    // Size the SVG viewport itself so the scroll area follows the rendered size.
    wrapper.style.width = `${this.canvasSize.width * this.scale}px`;
    wrapper.style.height = `${this.canvasSize.height * this.scale}px`;
  }

  private releaseDocument(): void {
    this.resizeObserver?.disconnect();
    this.canvasSize = undefined;
    this.document = null;
    this.selectedNodeId = undefined;
    this.state.selectedNodeId = undefined;
    this.root.replaceChildren();
  }

  private emit<T extends PreviewEventName>(event: T, payload: PreviewEventMap[T]): void {
    for (const handler of this.listeners[event]) {
      handler(payload as never);
    }
  }
}

export function createMindmapPreviewDriver(): PreviewDriver<MindmapPreviewState> {
  return {
    id: 'mindmap',
    family: 'mindmap',
    supports: (format) => MINDMAP_DIRECT_FORMATS.has(normalizeFormat(format)),
    createSession: (host, options) => new MindmapPreviewSession(host, options)
  };
}

export function createMindmapPreviewRoutes(baseRoutes = createDefaultPreviewRoutes()): FormatDefinition[] {
  return [
    ...MINDMAP_FORMAT_ROUTES,
    ...baseRoutes.filter((route) => !route.extensions.some((extension) => MINDMAP_DIRECT_FORMATS.has(extension)))
  ];
}

export function loadMindmapDocument(source: string, format?: string): MindmapDocument {
  const document = new DOMParser().parseFromString(source, 'application/xml');
  if (document.getElementsByTagName('parsererror')[0]) {
    throw new Error('Mind-map XML is invalid.');
  }
  const normalizedFormat = normalizeFormat(format);
  const root = normalizedFormat === 'opml' || localName(document.documentElement) === 'opml'
    ? parseOpmlDocument(document)
    : parseFreemindDocument(document);
  return {
    title: root.text,
    root,
    nodeCount: countNodes(root)
  };
}

export async function loadXmindDocument(source: ArrayBuffer, options: { signal?: AbortSignal } = {}): Promise<MindmapDocument> {
  checkAborted(options.signal);
  const archive = await JSZip.loadAsync(source);
  checkAborted(options.signal);
  const contentJson = archive.file('content.json');
  if (contentJson) {
    const text = await contentJson.async('text');
    checkAborted(options.signal);
    return parseXmindJsonDocument(text);
  }

  const contentXml = archive.file('content.xml');
  if (contentXml) {
    const text = await contentXml.async('text');
    checkAborted(options.signal);
    return parseXmindXmlDocument(text);
  }

  throw new Error('XMind package is missing content.json or content.xml.');
}

export async function loadMindmanagerDocument(source: ArrayBuffer, options: { signal?: AbortSignal } = {}): Promise<MindmapDocument> {
  checkAborted(options.signal);
  const archive = await JSZip.loadAsync(source);
  checkAborted(options.signal);
  const documentFile =
    archive.file('Document.xml') ??
    archive.file('document.xml') ??
    archive.file(/(^|\/)document\.xml$/i)[0];
  if (!documentFile) {
    throw new Error('MindManager package is missing Document.xml.');
  }
  const text = await documentFile.async('text');
  checkAborted(options.signal);
  return parseMindmanagerXmlDocument(text);
}

function parseMindmanagerXmlDocument(source: string): MindmapDocument {
  const document = new DOMParser().parseFromString(source, 'application/xml');
  if (document.getElementsByTagName('parsererror')[0]) {
    throw new Error('MindManager Document.xml is invalid.');
  }

  const topics = Array.from(document.getElementsByTagName('*')).filter((element) => localName(element) === 'topic');
  if (!topics.length) {
    throw new Error('MindManager Document.xml does not contain topic nodes.');
  }

  const rootTopic =
    topics.find((topic) => !hasAncestorTopic(topic)) ??
    topics[0];
  const root = parseMindmanagerTopic(rootTopic, 'mmap-root');

  return {
    title: root.text,
    root,
    nodeCount: countNodes(root)
  };
}

function hasAncestorTopic(element: Element): boolean {
  let current: Element | null = element.parentElement;
  while (current) {
    if (localName(current) === 'topic') {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function parseMindmanagerTopic(element: Element, fallbackId: string): MindmapNode {
  const id = getAttributeCaseInsensitive(element, 'id') || fallbackId;
  const text =
    normalizeNodeText(
      getAttributeCaseInsensitive(element, 'text') ||
        childElements(element, 'text')[0]?.textContent ||
        element.textContent ||
        'Untitled'
    );
  const children = findDirectChildTopics(element).map((child, index) => parseMindmanagerTopic(child, `${id}-${index + 1}`));
  return {
    id,
    text,
    children
  };
}

function findDirectChildTopics(topic: Element): Element[] {
  const direct: Element[] = [];

  const visit = (node: Element): void => {
    for (const child of Array.from(node.children)) {
      if (localName(child) === 'topic') {
        direct.push(child);
        continue;
      }
      if (containsTopicDescendants(child)) {
        visit(child);
      }
    }
  };

  visit(topic);
  return direct;
}

function containsTopicDescendants(node: Element): boolean {
  return Array.from(node.getElementsByTagName('*')).some((child) => localName(child) === 'topic');
}

function getAttributeCaseInsensitive(element: Element, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const attr of Array.from(element.attributes)) {
    if (attr.name.toLowerCase() === target) {
      return attr.value;
    }
  }
  return undefined;
}

function parseFreemindDocument(document: Document): MindmapNode {
  const rootElement = Array.from(document.getElementsByTagName('*')).find((element) => localName(element) === 'node');
  if (!rootElement) {
    throw new Error('FreeMind MM file does not contain a root node.');
  }
  // Only the root needs an ancestor/sibling scan; descendants already know their index.
  return parseFreemindNode(rootElement, 'mm', rootElement.parentElement ? stableNodePath(rootElement) : '');
}

function parseFreemindNode(element: Element, prefix: string, path: string): MindmapNode {
  const id = element.getAttribute('ID') || `${prefix}-${path || '1'}`;
  const text = normalizeNodeText(element.getAttribute('TEXT') || element.getAttribute('text') || 'Untitled');
  const children = childElements(element, 'node').map((child, index) =>
    parseFreemindNode(child, `${id}-${index + 1}`, path ? `${path}-${index + 1}` : String(index + 1)));
  return {
    id,
    text,
    children
  };
}

function parseOpmlDocument(document: Document): MindmapNode {
  const body = Array.from(document.getElementsByTagName('*')).find((element) => localName(element) === 'body');
  const title = Array.from(document.getElementsByTagName('*')).find((element) => localName(element) === 'title')?.textContent?.trim();
  const outlines = body ? childElements(body, 'outline') : [];
  if (!outlines.length) {
    throw new Error('OPML file does not contain outline nodes.');
  }
  if (outlines.length === 1) {
    const root = parseOpmlNode(outlines[0]!, 'opml-1');
    return title && root.text === 'Untitled' ? { ...root, text: title } : root;
  }
  return {
    id: 'opml-root',
    text: title || 'OPML',
    children: outlines.map((outline, index) => parseOpmlNode(outline, `opml-${index + 1}`))
  };
}

function parseOpmlNode(element: Element, id: string): MindmapNode {
  const text = normalizeNodeText(element.getAttribute('text') || element.getAttribute('title') || 'Untitled');
  return {
    id,
    text,
    children: childElements(element, 'outline').map((child, index) => parseOpmlNode(child, `${id}-${index + 1}`))
  };
}

function parseXmindJsonDocument(source: string): MindmapDocument {
  let workbook: unknown;
  try {
    workbook = JSON.parse(source);
  } catch {
    throw new Error('XMind content.json is invalid.');
  }

  const sheets = Array.isArray(workbook) ? workbook : [workbook];
  const firstSheet = sheets.find((sheet) => sheet && typeof sheet === 'object') as Record<string, unknown> | undefined;
  if (!firstSheet) {
    throw new Error('XMind content.json does not contain a sheet.');
  }

  const topic = asRecord(firstSheet.rootTopic) ?? asRecord(firstSheet.centralTopic) ?? asRecord(firstSheet.topic);
  if (!topic) {
    throw new Error('XMind content.json does not contain a root topic.');
  }

  const root = parseXmindJsonTopic(topic, 'xmind-json-1');
  return {
    title: stringValue(firstSheet.title) || root.text,
    root,
    nodeCount: countNodes(root)
  };
}

function parseXmindJsonTopic(topic: Record<string, unknown>, fallbackId: string): MindmapNode {
  const id = stringValue(topic.id) || stringValue(topic.uuid) || fallbackId;
  const text = normalizeNodeText(stringValue(topic.title) || stringValue(topic.text) || plainTextFromJson(topic) || 'Untitled');
  const children = xmindJsonChildren(topic).map((child, index) => parseXmindJsonTopic(child, `${id}-${index + 1}`));
  return {
    id,
    text,
    children
  };
}

function xmindJsonChildren(topic: Record<string, unknown>): Array<Record<string, unknown>> {
  const children: Array<Record<string, unknown>> = [];
  const directChildren = topic.children;
  if (Array.isArray(directChildren)) {
    children.push(...directChildren.map(asRecord).filter(isDefined));
  }

  const childrenObject = asRecord(directChildren);
  if (childrenObject) {
    for (const key of ['attached', 'detached', 'floating', 'summary']) {
      const branch = childrenObject[key];
      const topics = Array.isArray(branch) ? branch : asRecord(branch)?.topics;
      if (Array.isArray(topics)) {
        children.push(...topics.map(asRecord).filter(isDefined));
      }
    }
  }

  const subTopics = topic.subTopics ?? topic.subtopics;
  if (Array.isArray(subTopics)) {
    children.push(...subTopics.map(asRecord).filter(isDefined));
  }

  const subTopicObject = asRecord(subTopics);
  if (subTopicObject) {
    for (const value of Object.values(subTopicObject)) {
      if (Array.isArray(value)) {
        children.push(...value.map(asRecord).filter(isDefined));
      }
    }
  }

  return children;
}

function parseXmindXmlDocument(source: string): MindmapDocument {
  const document = new DOMParser().parseFromString(source, 'application/xml');
  if (document.getElementsByTagName('parsererror')[0]) {
    throw new Error('XMind content.xml is invalid.');
  }

  const sheet = Array.from(document.getElementsByTagName('*')).find((element) => localName(element) === 'sheet') ?? document.documentElement;
  const topic = childElements(sheet, 'topic')[0] ?? Array.from(document.getElementsByTagName('*')).find((element) => localName(element) === 'topic');
  if (!topic) {
    throw new Error('XMind content.xml does not contain a root topic.');
  }

  const root = parseXmindXmlTopic(topic, 'xmind-xml-1');
  const title = childElements(sheet, 'title')[0]?.textContent?.trim() || root.text;
  return {
    title,
    root,
    nodeCount: countNodes(root)
  };
}

function parseXmindXmlTopic(element: Element, fallbackId: string): MindmapNode {
  const id = element.getAttribute('id') || fallbackId;
  const title = childElements(element, 'title')[0]?.textContent ?? element.getAttribute('title') ?? element.getAttribute('text') ?? 'Untitled';
  const children = childElements(element, 'children')
    .flatMap((childrenElement) => childElements(childrenElement, 'topics'))
    .flatMap((topicsElement) => childElements(topicsElement, 'topic'))
    .map((topic, index) => parseXmindXmlTopic(topic, `${id}-${index + 1}`));
  return {
    id,
    text: normalizeNodeText(title),
    children
  };
}

function layoutMindmap(root: MindmapNode): PositionedMindmapNode {
  const positioned = toPositionedNode(root, 0);
  let cursorY = MARGIN;
  const assign = (node: PositionedMindmapNode): void => {
    node.x = MARGIN + node.depth * (NODE_MAX_WIDTH + LEVEL_GAP);
    node.width = nodeWidth(node.text);
    node.height = NODE_HEIGHT;
    if (!node.children.length) {
      node.y = cursorY;
      cursorY += NODE_HEIGHT + SIBLING_GAP;
      return;
    }
    for (const child of node.children) {
      assign(child);
    }
    node.y = (node.children[0]!.y + node.children[node.children.length - 1]!.y) / 2;
  };
  assign(positioned);
  return positioned;
}

function toPositionedNode(node: MindmapNode, depth: number): PositionedMindmapNode {
  return {
    ...node,
    x: 0,
    y: 0,
    width: nodeWidth(node.text),
    height: NODE_HEIGHT,
    depth,
    children: node.children.map((child) => toPositionedNode(child, depth + 1))
  };
}

function computeLayoutBounds(root: PositionedMindmapNode): { width: number; height: number } {
  let maxX = 0;
  let maxY = 0;
  walkPositioned(root, (node) => {
    maxX = Math.max(maxX, node.x + node.width + MARGIN);
    maxY = Math.max(maxY, node.y + node.height + MARGIN);
  });
  return {
    width: Math.max(360, maxX),
    height: Math.max(260, maxY)
  };
}

function renderLinks(root: PositionedMindmapNode): SVGGElement {
  const group = document.createElementNS(SVG_NS, 'g');
  group.classList.add('mindmapv-links');
  walkPositioned(root, (node) => {
    for (const child of node.children) {
      const path = document.createElementNS(SVG_NS, 'path');
      const x1 = node.x + node.width;
      const y1 = node.y + NODE_HEIGHT / 2;
      const x2 = child.x;
      const y2 = child.y + NODE_HEIGHT / 2;
      const mid = x1 + (x2 - x1) * 0.5;
      path.setAttribute('d', `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`);
      group.appendChild(path);
    }
  });
  return group;
}

function renderNodes(root: PositionedMindmapNode, selectedNodeId: string | undefined, onSelect: (id: string) => void): SVGGElement {
  const group = document.createElementNS(SVG_NS, 'g');
  group.classList.add('mindmapv-nodes');
  walkPositioned(root, (node) => {
    const item = document.createElementNS(SVG_NS, 'g');
    item.classList.add('mindmapv-node');
    if (node.id === selectedNodeId) {
      item.classList.add('is-selected');
    }
    item.setAttribute('data-node-id', node.id);
    item.setAttribute('tabindex', '0');
    item.setAttribute('role', 'button');
    item.setAttribute('aria-label', node.text);
    item.addEventListener('click', () => onSelect(node.id));
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect(node.id);
      }
    });

    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(node.x));
    rect.setAttribute('y', String(node.y));
    rect.setAttribute('width', String(node.width));
    rect.setAttribute('height', String(NODE_HEIGHT));
    rect.setAttribute('rx', '6');

    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', String(node.x + 14));
    text.setAttribute('y', String(node.y + 22));
    text.textContent = shortenText(node.text);
    item.append(rect, text);
    group.appendChild(item);
  });
  return group;
}

function walkPositioned(node: PositionedMindmapNode, visit: (node: PositionedMindmapNode) => void): void {
  visit(node);
  for (const child of node.children) {
    walkPositioned(child, visit);
  }
}

function nodeWidth(text: string): number {
  return Math.max(NODE_MIN_WIDTH, Math.min(NODE_MAX_WIDTH, text.length * 8 + 34));
}

function shortenText(text: string): string {
  return text.length > 34 ? `${text.slice(0, 31)}...` : text;
}

function countNodes(node: MindmapNode): number {
  return 1 + node.children.reduce((total, child) => total + countNodes(child), 0);
}

function childElements(element: Element, name: string): Element[] {
  return Array.from(element.children).filter((child) => localName(child) === name);
}

function localName(element: Element): string {
  return element.localName.toLowerCase();
}

function normalizeNodeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim() || 'Untitled';
}

function stableNodePath(element: Element): string {
  const parts: number[] = [];
  let current: Element | null = element;
  while (current?.parentElement) {
    const siblings = childElements(current.parentElement, localName(current));
    parts.unshift(siblings.indexOf(current) + 1);
    current = current.parentElement;
  }
  return parts.join('-') || '1';
}

async function sourceToText(source: PreviewSource, context: PreviewLoadContext): Promise<string> {
  checkAborted(context.signal);
  if (typeof source === 'string') {
    if (source.trimStart().toLowerCase().startsWith('data:')) {
      return readDataUrl(source);
    }
    const response = await fetch(source, { signal: context.signal });
    checkAborted(context.signal);
    if (!response.ok) {
      throw new Error(`Failed to load mind-map source: ${response.status} ${response.statusText}`.trim());
    }
    return response.text();
  }
  if (source instanceof Blob) {
    return source.text();
  }
  if (ArrayBuffer.isView(source)) {
    return new TextDecoder().decode(source);
  }
  if (source instanceof ArrayBuffer) {
    return new TextDecoder().decode(source);
  }
  return String(source);
}

async function sourceToArrayBuffer(source: PreviewSource, context: PreviewLoadContext): Promise<ArrayBuffer> {
  checkAborted(context.signal);
  if (typeof source === 'string') {
    if (source.trimStart().toLowerCase().startsWith('data:')) {
      return bytesToArrayBuffer(readDataUrlBytes(source));
    }
    const response = await fetch(source, { signal: context.signal });
    checkAborted(context.signal);
    if (!response.ok) {
      throw new Error(`Failed to load mind-map source: ${response.status} ${response.statusText}`.trim());
    }
    return response.arrayBuffer();
  }
  if (source instanceof Blob) {
    return source.arrayBuffer();
  }
  if (ArrayBuffer.isView(source)) {
    const copy = new Uint8Array(source.byteLength);
    copy.set(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
    return bytesToArrayBuffer(copy);
  }
  if (source instanceof ArrayBuffer) {
    return source;
  }
  return bytesToArrayBuffer(new TextEncoder().encode(String(source)));
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Mind-map preview aborted.', 'AbortError');
}

function readDataUrl(source: string): string {
  const commaIndex = source.indexOf(',');
  if (commaIndex < 0) {
    return source;
  }
  const meta = source.slice(0, commaIndex).toLowerCase();
  const payload = source.slice(commaIndex + 1);
  if (meta.endsWith(';base64')) {
    return new TextDecoder().decode(Uint8Array.from(atob(payload), (char) => char.charCodeAt(0)));
  }
  return decodeURIComponent(payload);
}

function readDataUrlBytes(source: string): Uint8Array {
  const commaIndex = source.indexOf(',');
  if (commaIndex < 0) {
    return new TextEncoder().encode(source);
  }
  const meta = source.slice(0, commaIndex).toLowerCase();
  const payload = source.slice(commaIndex + 1);
  if (meta.endsWith(';base64')) {
    return Uint8Array.from(atob(payload), (char) => char.charCodeAt(0));
  }
  return new TextEncoder().encode(decodeURIComponent(payload));
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function normalizeFormat(format: string | undefined): string {
  return String(format ?? '').trim().replace(/^\./, '').toLowerCase();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function plainTextFromJson(topic: Record<string, unknown>): string {
  const title = asRecord(topic.title);
  const text = asRecord(topic.text);
  return stringValue(title?.plain) || stringValue(title?.content) || stringValue(text?.plain) || stringValue(text?.content);
}
