import {
  createDefaultPreviewRoutes,
  type DiagramPreviewState,
  type FormatDefinition,
  type PreviewDriver,
  type PreviewEventMap,
  type PreviewEventName,
  type PreviewFitMode,
  type PreviewLoadContext,
  type PreviewOptions,
  type PreviewSession,
  type PreviewSource
} from '@filens/core';
import { inflateSync, strFromU8, unzlibSync } from 'fflate';
import JSZip from 'jszip';

type PreviewListenerMap = {
  [K in PreviewEventName]: Set<(payload: PreviewEventMap[K]) => void>;
};

export interface DiagramNode {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  style?: string;
}

export interface DiagramEdge {
  id: string;
  label: string;
  source?: string;
  target?: string;
  points: Array<[number, number]>;
  style?: string;
}

export interface DiagramPage {
  id: string;
  name: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export interface DiagramDocument {
  title?: string;
  pages: DiagramPage[];
}

export const DIAGRAM_FORMAT_ROUTES: FormatDefinition[] = [
  {
    extensions: ['drawio', 'dio', 'vdx', 'vsdx'],
    family: 'diagram',
    driverId: 'diagram',
    targetFormat: 'diagram',
    contentTypes: ['application/vnd.jgraph.mxfile', 'application/vnd.visio']
  }
];

const DIAGRAM_DIRECT_FORMATS = new Set(['drawio', 'dio', 'vdx', 'vsdx']);
const VISIO_UNIT_SCALE = 96;

const SVG_NS = 'http://www.w3.org/2000/svg';
const MARGIN = 36;
const DEFAULT_NODE_WIDTH = 120;
const DEFAULT_NODE_HEIGHT = 60;
const DEFAULT_FILL = '#ffffff';
const DEFAULT_STROKE = '#9db3d1';
const DEFAULT_TEXT = '#1f2937';
const DEFAULT_EDGE = '#6b7f99';
const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export class DiagramPreviewSession implements PreviewSession<DiagramPreviewState> {
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
  private document: DiagramDocument | null = null;
  private loadGeneration = 0;
  private loadController?: AbortController;
  private removeAbortListener?: () => void;
  private pageIndex = 0;
  private selectedElementId: string | undefined;
  private state: DiagramPreviewState;

  constructor(private readonly host: HTMLElement, options: PreviewOptions = {}) {
    this.scale = options.initialScale ?? 1;
    this.fitMode = options.fit ?? 'contain';
    this.root = document.createElement('div');
    this.root.className = 'diagramv-preview';
    this.host.replaceChildren(this.root);
    this.state = {
      loading: false,
      error: null,
      family: 'diagram',
      warnings: [],
      capabilities: {
        zoom: true,
        fit: true,
        pan: true,
        paged: true,
        search: true,
        fullscreen: true,
        metadata: true,
        download: true
      },
      scale: this.scale,
      pageIndex: 0,
      pageCount: 0
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
      selectedElementId: undefined
    };
    this.emit('loading', this.state);
    this.emit('statechange', this.state);

    try {
      if (signal?.aborted) controller.abort();
      checkAborted(controller.signal);
      const format = normalizeFormat(context.route?.sourceFormat ?? context.descriptor.extension);
      if (!DIAGRAM_DIRECT_FORMATS.has(format)) {
        throw new Error(`Diagram preview currently supports diagrams.net drawio/dio and Visio VDX/VSDX files, got ${format || 'unknown'}.`);
      }

      const loadContext = { ...context, signal: controller.signal };
      let model: DiagramDocument;
      if (format === 'vsdx') {
        const bytes = await sourceToArrayBuffer(source, loadContext);
        checkAborted(controller.signal);
        model = await loadVsdxDiagram(bytes, loadContext);
      } else {
        const text = await sourceToText(source, loadContext);
        checkAborted(controller.signal);
        model = format === 'vdx' ? loadVdxDiagram(text) : loadDrawioDiagram(text);
      }
      if (generation !== this.loadGeneration) return;
      checkAborted(controller.signal);
      this.document = model;
      this.pageIndex = 0;
      this.selectedElementId = undefined;
      this.state = {
        ...this.state,
        loading: false,
        error: null,
        title: this.document.title ?? context.descriptor.name,
        pageIndex: 0,
        pageCount: this.document.pages.length,
        selectedElementId: undefined,
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

  getState(): DiagramPreviewState {
    return {
      ...this.state,
      warnings: [...this.state.warnings],
      pageIndex: this.pageIndex,
      pageCount: this.document?.pages.length ?? 0,
      selectedElementId: this.selectedElementId
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

  goToPage(index: number): void {
    if (!this.document || !Number.isInteger(index)) {
      return;
    }
    const nextIndex = Math.max(0, Math.min(index, this.document.pages.length - 1));
    if (nextIndex === this.pageIndex) {
      return;
    }
    this.pageIndex = nextIndex;
    this.selectedElementId = undefined;
    this.state.pageIndex = this.pageIndex;
    this.state.selectedElementId = undefined;
    this.root.scrollTop = 0;
    this.root.scrollLeft = 0;
    this.render();
    this.emit('statechange', this.state);
  }

  next(): void {
    this.goToPage(this.pageIndex + 1);
  }

  prev(): void {
    this.goToPage(this.pageIndex - 1);
  }

  private render(): void {
    const page = this.document?.pages[this.pageIndex];
    if (!page) {
      this.root.replaceChildren();
      return;
    }

    const bounds = computePageBounds(page);
    this.canvasSize = bounds;
    const summary = document.createElement('div');
    summary.className = 'diagramv-summary';
    summary.textContent = `${page.name} - ${page.nodes.length} node${page.nodes.length === 1 ? '' : 's'} - ${page.edges.length} edge${page.edges.length === 1 ? '' : 's'}`;

    const wrapper = document.createElement('div');
    wrapper.className = 'diagramv-canvas-wrap';
    wrapper.style.width = `${bounds.width}px`;
    wrapper.style.height = `${bounds.height}px`;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.classList.add('diagramv-canvas');
    svg.setAttribute('viewBox', `${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', page.name);
    svg.appendChild(createSvgDefinitions());
    svg.append(renderEdges(page, (id) => this.selectElement(id)), renderNodes(page, (id) => this.selectElement(id)));
    wrapper.appendChild(svg);
    this.resizeObserver?.disconnect();
    this.root.replaceChildren(summary, wrapper);
    this.applyScale();
    this.resizeObserver?.observe(this.root);
    this.resizeObserver?.observe(summary);
    if (this.selectedElementId) {
      this.selectElement(this.selectedElementId, false);
    }
  }

  private selectElement(id: string, emit = true): void {
    this.selectedElementId = id;
    this.state.selectedElementId = id;
    this.root.querySelectorAll('.diagramv-node, .diagramv-edge').forEach((element) => {
      element.classList.toggle('is-selected', element.getAttribute('data-element-id') === id);
    });
    if (emit) {
      this.emit('statechange', this.state);
    }
  }

  private applyScale(): void {
    const wrapper = this.root.querySelector<HTMLElement>('.diagramv-canvas-wrap');
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
    this.pageIndex = 0;
    this.selectedElementId = undefined;
    this.state.pageIndex = 0;
    this.state.pageCount = 0;
    this.state.selectedElementId = undefined;
    this.root.replaceChildren();
  }

  private emit<T extends PreviewEventName>(event: T, payload: PreviewEventMap[T]): void {
    for (const handler of this.listeners[event]) {
      handler(payload as never);
    }
  }
}

export function createDiagramPreviewDriver(): PreviewDriver<DiagramPreviewState> {
  return {
    id: 'diagram',
    family: 'diagram',
    supports: (format) => DIAGRAM_DIRECT_FORMATS.has(normalizeFormat(format)),
    createSession: (host, options) => new DiagramPreviewSession(host, options)
  };
}

export function createDiagramPreviewRoutes(baseRoutes = createDefaultPreviewRoutes()): FormatDefinition[] {
  return [
    ...DIAGRAM_FORMAT_ROUTES,
    ...baseRoutes.filter((route) => !route.extensions.some((extension) => DIAGRAM_DIRECT_FORMATS.has(extension)))
  ];
}

export function loadDrawioDiagram(source: string): DiagramDocument {
  const document = new DOMParser().parseFromString(source, 'application/xml');
  if (document.getElementsByTagName('parsererror')[0]) {
    throw new Error('draw.io XML is invalid.');
  }

  const context: DiagramParseContext = {};
  const diagramElements = Array.from(document.getElementsByTagName('*')).filter((element) => localName(element) === 'diagram');
  const pages = diagramElements.length
    ? diagramElements.map((diagram, index) => parseDiagramPage(diagram, index, context))
    : [parseDiagramPage(document.documentElement, 0, context)];
  if (!pages.some((page) => page.nodes.length || page.edges.length)) {
    throw new Error('draw.io file does not contain supported mxCell geometry.');
  }
  return {
    title: document.documentElement.getAttribute('name') ?? pages[0]?.name,
    pages
  };
}

export async function loadVsdxDiagram(source: ArrayBuffer, options: { signal?: AbortSignal } = {}): Promise<DiagramDocument> {
  checkAborted(options.signal);
  const archive = await JSZip.loadAsync(source);
  checkAborted(options.signal);
  const pageEntries = await readVsdxPageEntries(archive, options.signal);
  checkAborted(options.signal);
  if (!pageEntries.length) {
    throw new Error('VSDX package is missing visio/pages/page*.xml files.');
  }

  const pages: DiagramPage[] = [];
  const context: DiagramParseContext = {};
  for (let index = 0; index < pageEntries.length; index += 1) {
    const entry = pageEntries[index]!;
    const xml = await entry.file.async('text');
    checkAborted(options.signal);
    const page = parseVisioPage(xml, index, context, entry.metadata);
    if (page.nodes.length || page.edges.length) {
      pages.push(page);
    }
  }
  if (!pages.length) {
    throw new Error('VSDX file does not contain supported shape geometry.');
  }
  return {
    title: pages[0]?.name,
    pages
  };
}

interface VsdxPageEntry {
  file: JSZip.JSZipObject;
  metadata?: {
    id?: string;
    name?: string;
  };
}

async function readVsdxPageEntries(archive: JSZip, signal?: AbortSignal): Promise<VsdxPageEntry[]> {
  const fallbackFiles = archive.file(/^visio\/pages\/page\d+\.xml$/i)
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
  const manifest = archive.file('visio/pages/pages.xml');
  if (!manifest) {
    return fallbackFiles.map((file) => ({ file }));
  }

  const xml = await manifest.async('text');
  checkAborted(signal);
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.getElementsByTagName('parsererror')[0]) {
    return fallbackFiles.map((file) => ({ file }));
  }

  const relationships = await readVsdxPageRelationships(archive, signal);
  checkAborted(signal);
  const pages = Array.from(document.getElementsByTagName('*')).filter((element) => localName(element) === 'page');
  const entries = pages
    .map((page, index): VsdxPageEntry | undefined => {
      const relationshipId = Array.from(page.children)
        .find((child) => localName(child) === 'rel')
        ?.getAttribute('r:id');
      const target = relationshipId ? relationships.get(relationshipId) : undefined;
      const file = target ? archive.file(resolveVsdxPageTarget(target)) : fallbackFiles[index];
      if (!file) {
        return undefined;
      }
      return {
        file,
        metadata: {
          id: page.getAttribute('ID') ?? undefined,
          name: page.getAttribute('NameU') || page.getAttribute('Name') || undefined
        }
      };
    })
    .filter(isDefined);

  return entries.length ? entries : fallbackFiles.map((file) => ({ file }));
}

async function readVsdxPageRelationships(archive: JSZip, signal?: AbortSignal): Promise<Map<string, string>> {
  const relationships = new Map<string, string>();
  const relsFile = archive.file('visio/pages/_rels/pages.xml.rels');
  if (!relsFile) {
    return relationships;
  }
  const xml = await relsFile.async('text');
  checkAborted(signal);
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.getElementsByTagName('parsererror')[0]) {
    return relationships;
  }
  for (const relationship of Array.from(document.getElementsByTagName('*')).filter((element) => localName(element) === 'relationship')) {
    const id = relationship.getAttribute('Id');
    const target = relationship.getAttribute('Target');
    if (id && target) {
      relationships.set(id, target);
    }
  }
  return relationships;
}

function resolveVsdxPageTarget(target: string): string {
  const normalized = target.replace(/\\/g, '/').replace(/^\//, '');
  return normalized.toLowerCase().startsWith('visio/pages/')
    ? normalized
    : `visio/pages/${normalized.replace(/^pages\//i, '')}`;
}

export function loadVdxDiagram(source: string): DiagramDocument {
  const document = new DOMParser().parseFromString(source, 'application/xml');
  if (document.getElementsByTagName('parsererror')[0]) {
    throw new Error('VDX XML is invalid.');
  }

  const context: DiagramParseContext = { legacy: true };
  const pageElements = Array.from(document.getElementsByTagName('*')).filter((element) => localName(element) === 'page');
  const pages = pageElements.length
    ? pageElements.map((page, index) => parseVisioPageElement(page, index, context))
    : [parseVisioPageElement(document.documentElement, 0, context)];
  if (!pages.some((page) => page.nodes.length || page.edges.length)) {
    throw new Error('VDX file does not contain supported shape geometry.');
  }
  return {
    title: document.documentElement.getAttribute('Name') ?? pages[0]?.name,
    pages
  };
}

interface DiagramParseContext {
  legacy?: boolean;
  labelDecoder?: HTMLTextAreaElement;
}

function parseVisioPage(source: string, index: number, context: DiagramParseContext, metadata?: { id?: string; name?: string }): DiagramPage {
  const document = new DOMParser().parseFromString(source, 'application/xml');
  if (document.getElementsByTagName('parsererror')[0]) {
    throw new Error('Visio page XML is invalid.');
  }
  return parseVisioPageElement(document.documentElement, index, context, metadata);
}

function parseVisioPageElement(root: Element, index: number, context: DiagramParseContext, metadata?: { id?: string; name?: string }): DiagramPage {
  let pageSheet: Element | undefined;
  const shapeElements: Element[] = [];
  const connectElements: Element[] = [];
  for (const element of Array.from(root.getElementsByTagName('*'))) {
    const name = localName(element);
    if (name === 'pagesheet' && !pageSheet) pageSheet = element;
    else if (name === 'shape') shapeElements.push(element);
    else if (name === 'connect') connectElements.push(element);
  }
  const pageHeight = (visioCellNumber(readVisioCells(pageSheet, !!context.legacy), 'PageHeight') ?? 8.5) * VISIO_UNIT_SCALE;
  const connects = parseVisioConnects(connectElements);
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];

  for (const shape of shapeElements) {
    const id = shape.getAttribute('ID') ?? `shape-${nodes.length + edges.length + 1}`;
    const kind = shape.getAttribute('Type') ?? '';
    const cells = readVisioCells(shape, !!context.legacy);
    const beginX = visioCellNumber(cells, 'BeginX');
    const endX = visioCellNumber(cells, 'EndX');
    const connection = connects.get(id);
    const label = normalizeLabel(visioText(shape), context);
    if (kind === 'Shape' && beginX == null && endX == null && !connection?.source && !connection?.target) {
      const node = parseVisioNode(cells, id, label, pageHeight);
      if (node.width > 0 && node.height > 0) {
        nodes.push(node);
      }
      continue;
    }
    if (kind === 'Foreign' || kind === 'Group') {
      continue;
    }
    const edge = parseVisioEdge(cells, id, label, pageHeight, connection);
    if (edge.points.length || edge.source || edge.target) {
      edges.push(edge);
    }
  }

  return {
    id: metadata?.id ?? `visio-page-${index + 1}`,
    name: metadata?.name || root.getAttribute('NameU') || root.getAttribute('Name') || `Page ${index + 1}`,
    nodes,
    edges
  };
}

function parseVisioNode(cells: VisioCells, id: string, label: string, pageHeight: number): DiagramNode {
  const pinX = (visioCellNumber(cells, 'PinX') ?? 0) * VISIO_UNIT_SCALE;
  const pinY = (visioCellNumber(cells, 'PinY') ?? 0) * VISIO_UNIT_SCALE;
  const width = Math.max(1, (visioCellNumber(cells, 'Width') ?? 1) * VISIO_UNIT_SCALE);
  const height = Math.max(1, (visioCellNumber(cells, 'Height') ?? 0.5) * VISIO_UNIT_SCALE);
  return {
    id,
    label,
    x: pinX - width / 2,
    y: pageHeight - pinY - height / 2,
    width,
    height,
    style: visioShapeStyle(cells)
  };
}

function parseVisioEdge(
  cells: VisioCells,
  id: string,
  label: string,
  pageHeight: number,
  connects: { source?: string; target?: string } = {}
): DiagramEdge {
  const pinX = visioCellNumber(cells, 'PinX') ?? 0;
  const pinY = visioCellNumber(cells, 'PinY') ?? 0;
  const beginX = (visioCellNumber(cells, 'BeginX') ?? pinX) * VISIO_UNIT_SCALE;
  const beginY = pageHeight - (visioCellNumber(cells, 'BeginY') ?? pinY) * VISIO_UNIT_SCALE;
  const endX = (visioCellNumber(cells, 'EndX') ?? pinX) * VISIO_UNIT_SCALE;
  const endY = pageHeight - (visioCellNumber(cells, 'EndY') ?? pinY) * VISIO_UNIT_SCALE;
  return {
    id,
    label,
    source: connects.source,
    target: connects.target,
    points: connects.source || connects.target ? [] : [[beginX, beginY], [endX, endY]],
    style: 'endArrow=block;strokeColor=#6b7f99'
  };
}

function parseVisioConnects(connectElements: Element[]): Map<string, { source?: string; target?: string }> {
  const result = new Map<string, { source?: string; target?: string }>();
  for (const connect of connectElements) {
    const fromSheet = connect.getAttribute('FromSheet');
    const toSheet = connect.getAttribute('ToSheet');
    if (!fromSheet || !toSheet) {
      continue;
    }
    const fromCell = connect.getAttribute('FromCell') ?? '';
    const item = result.get(fromSheet) ?? {};
    if (/begin/i.test(fromCell)) {
      item.source = toSheet;
    } else if (/end/i.test(fromCell)) {
      item.target = toSheet;
    }
    result.set(fromSheet, item);
  }
  return result;
}

type VisioCells = Map<string, string | null>;

function readVisioCells(shape: Element | undefined, legacy: boolean): VisioCells {
  const values: VisioCells = new Map();
  if (!shape) return values;
  // Keep the first matching Cell, including a missing V attribute, as before.
  for (const element of Array.from(shape.getElementsByTagName('*'))) {
    if (localName(element) !== 'cell') continue;
    const name = element.getAttribute('N');
    if (name != null && !values.has(name)) values.set(name, element.getAttribute('V'));
  }
  if (legacy) {
    for (const section of Array.from(shape.children)) {
      if (!['xform', 'xform1d', 'pageprops', 'fill', 'line'].includes(localName(section))) continue;
      for (const property of Array.from(section.children)) {
        if (!values.has(property.localName)) values.set(property.localName, property.textContent);
      }
    }
  }
  return values;
}

function visioCellNumber(cells: VisioCells, name: string): number | undefined {
  const parsed = Number(cells.get(name));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function visioText(shape: Element): string {
  const text = Array.from(shape.children).find((element) => localName(element) === 'text');
  return text?.textContent ?? '';
}

function visioShapeStyle(cells: VisioCells): string {
  const fill = visioColor(cells.get('FillForegnd') ?? undefined);
  const stroke = visioColor(cells.get('LineColor') ?? undefined);
  return [
    fill ? `fillColor=${fill}` : '',
    stroke ? `strokeColor=${stroke}` : '',
    'rounded=1'
  ].filter(Boolean).join(';');
}

function visioColor(value: string | undefined): string | undefined {
  if (!value || value === 'THEMEGUARD(RGB(255,255,255))') {
    return undefined;
  }
  const hex = /^#?[0-9a-f]{6}$/i.exec(value.trim())?.[0];
  if (hex) {
    return hex.startsWith('#') ? hex : `#${hex}`;
  }
  const rgb = /RGB\((\d+),\s*(\d+),\s*(\d+)\)/i.exec(value);
  if (rgb) {
    return `#${[rgb[1], rgb[2], rgb[3]].map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`;
  }
  return undefined;
}

function parseDiagramPage(root: Element, index: number, context: DiagramParseContext): DiagramPage {
  const graphRoot = decodeDrawioDiagramRoot(root);
  const graphModel = localName(graphRoot) === 'mxgraphmodel'
    ? graphRoot
    : Array.from(graphRoot.getElementsByTagName('*')).find((element) => localName(element) === 'mxgraphmodel');
  const cells = graphModel
    ? Array.from(graphModel.getElementsByTagName('*')).filter((element) => localName(element) === 'mxcell')
    : [];
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];

  for (const cell of cells) {
    const id = cell.getAttribute('id') ?? `cell-${nodes.length + edges.length + 1}`;
    const geometry = childElements(cell, 'mxgeometry')[0];
    if (cell.getAttribute('vertex') === '1' && geometry) {
      nodes.push({
        id,
        label: normalizeLabel(cell.getAttribute('value') ?? '', context),
        x: numberAttr(geometry, 'x'),
        y: numberAttr(geometry, 'y'),
        width: numberAttr(geometry, 'width', DEFAULT_NODE_WIDTH),
        height: numberAttr(geometry, 'height', DEFAULT_NODE_HEIGHT),
        style: cell.getAttribute('style') ?? undefined
      });
      continue;
    }
    if (cell.getAttribute('edge') === '1') {
      edges.push({
        id,
        label: normalizeLabel(cell.getAttribute('value') ?? '', context),
        source: cell.getAttribute('source') ?? undefined,
        target: cell.getAttribute('target') ?? undefined,
        points: geometry ? parseEdgePoints(geometry) : [],
        style: cell.getAttribute('style') ?? undefined
      });
    }
  }

  return {
    id: root.getAttribute('id') ?? `page-${index + 1}`,
    name: root.getAttribute('name') || `Page ${index + 1}`,
    nodes,
    edges
  };
}

function decodeDrawioDiagramRoot(root: Element): Element {
  if (localName(root) !== 'diagram') {
    return root;
  }
  if (Array.from(root.getElementsByTagName('*')).some((element) => localName(element) === 'mxgraphmodel')) {
    return root;
  }
  const payload = root.textContent?.trim();
  if (!payload) {
    return root;
  }
  try {
    const xml = decodeCompressedDrawioPayload(payload);
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    if (document.getElementsByTagName('parsererror')[0]) {
      return root;
    }
    return document.documentElement;
  } catch {
    return root;
  }
}

export function decodeCompressedDrawioPayload(payload: string): string {
  const normalized = payload.replace(/\s+/g, '');
  const binary = typeof atob === 'function'
    ? atob(normalized)
    : Buffer.from(normalized, 'base64').toString('binary');
  const compressed = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  let inflatedBytes: Uint8Array;
  try {
    inflatedBytes = inflateSync(compressed);
  } catch {
    inflatedBytes = unzlibSync(compressed);
  }
  const inflated = strFromU8(inflatedBytes).replace(/\+/g, '%20');
  return decodeURIComponent(inflated);
}

function renderNodes(page: DiagramPage, onSelect: (id: string) => void): SVGGElement {
  const group = document.createElementNS(SVG_NS, 'g');
  group.classList.add('diagramv-nodes');
  for (const node of page.nodes) {
    const item = document.createElementNS(SVG_NS, 'g');
    item.classList.add('diagramv-node');
    item.setAttribute('data-element-id', node.id);
    item.setAttribute('tabindex', '0');
    item.setAttribute('role', 'button');
    item.setAttribute('aria-label', node.label || node.id);
    item.addEventListener('click', () => onSelect(node.id));
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect(node.id);
      }
    });

    const style = parseDrawioStyle(node.style);
    const shape = createNodeShape(node, style);
    item.appendChild(shape);

    if (node.label) {
      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', String(node.x + node.width / 2));
      text.setAttribute('y', String(node.y + node.height / 2 + 5));
      text.setAttribute('fill', style.fontColor ?? DEFAULT_TEXT);
      text.setAttribute('font-size', style.fontSize ?? '13');
      text.textContent = shortenText(node.label);
      item.appendChild(text);
    }
    group.appendChild(item);
  }
  return group;
}

function createSvgDefinitions(): SVGDefsElement {
  const defs = document.createElementNS(SVG_NS, 'defs');
  const marker = document.createElementNS(SVG_NS, 'marker');
  marker.setAttribute('id', 'diagramv-arrow-end');
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '9');
  marker.setAttribute('refY', '5');
  marker.setAttribute('markerWidth', '7');
  marker.setAttribute('markerHeight', '7');
  marker.setAttribute('orient', 'auto-start-reverse');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
  path.setAttribute('fill', 'context-stroke');
  marker.appendChild(path);
  defs.appendChild(marker);
  return defs;
}

function renderEdges(page: DiagramPage, onSelect: (id: string) => void): SVGGElement {
  const group = document.createElementNS(SVG_NS, 'g');
  group.classList.add('diagramv-edges');
  const nodeMap = new Map(page.nodes.map((node) => [node.id, node]));
  for (const edge of page.edges) {
    const item = document.createElementNS(SVG_NS, 'g');
    item.classList.add('diagramv-edge');
    item.setAttribute('data-element-id', edge.id);
    item.setAttribute('tabindex', '0');
    item.setAttribute('role', 'button');
    item.setAttribute('aria-label', edge.label || edge.id);
    item.addEventListener('click', () => onSelect(edge.id));
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect(edge.id);
      }
    });

    const points = resolveEdgePath(edge, nodeMap);
    const style = parseDrawioStyle(edge.style);
    const polyline = document.createElementNS(SVG_NS, 'polyline');
    polyline.setAttribute('points', points.map(([x, y]) => `${x},${y}`).join(' '));
    polyline.setAttribute('stroke', style.strokeColor ?? DEFAULT_EDGE);
    polyline.setAttribute('stroke-width', style.strokeWidth ?? '2');
    if (style.dashed === '1') {
      polyline.setAttribute('stroke-dasharray', '8 5');
    }
    if (style.endArrow && style.endArrow !== 'none') {
      polyline.setAttribute('marker-end', 'url(#diagramv-arrow-end)');
    }
    item.appendChild(polyline);

    if (edge.label && points.length) {
      const middle = points[Math.floor(points.length / 2)]!;
      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', String(middle[0] + 8));
      text.setAttribute('y', String(middle[1] - 8));
      text.setAttribute('fill', style.fontColor ?? DEFAULT_TEXT);
      text.setAttribute('font-size', style.fontSize ?? '13');
      text.textContent = shortenText(edge.label);
      item.appendChild(text);
    }
    group.appendChild(item);
  }
  return group;
}

function createNodeShape(node: DiagramNode, style: DrawioStyle): SVGElement {
  const shapeName = style.shape ?? '';
  if (shapeName === 'ellipse' || style.ellipse === '1') {
    const ellipse = document.createElementNS(SVG_NS, 'ellipse');
    ellipse.setAttribute('cx', String(node.x + node.width / 2));
    ellipse.setAttribute('cy', String(node.y + node.height / 2));
    ellipse.setAttribute('rx', String(node.width / 2));
    ellipse.setAttribute('ry', String(node.height / 2));
    applyShapeStyle(ellipse, style);
    return ellipse;
  }
  if (shapeName === 'rhombus' || style.rhombus === '1') {
    const polygon = document.createElementNS(SVG_NS, 'polygon');
    polygon.setAttribute('points', [
      [node.x + node.width / 2, node.y],
      [node.x + node.width, node.y + node.height / 2],
      [node.x + node.width / 2, node.y + node.height],
      [node.x, node.y + node.height / 2]
    ].map(([x, y]) => `${x},${y}`).join(' '));
    applyShapeStyle(polygon, style);
    return polygon;
  }
  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('x', String(node.x));
  rect.setAttribute('y', String(node.y));
  rect.setAttribute('width', String(node.width));
  rect.setAttribute('height', String(node.height));
  rect.setAttribute('rx', style.rounded === '1' ? '8' : '3');
  applyShapeStyle(rect, style);
  return rect;
}

function applyShapeStyle(shape: SVGElement, style: DrawioStyle): void {
  shape.setAttribute('fill', style.fillColor === 'none' ? 'transparent' : style.fillColor ?? DEFAULT_FILL);
  shape.setAttribute('stroke', style.strokeColor === 'none' ? 'transparent' : style.strokeColor ?? DEFAULT_STROKE);
  shape.setAttribute('stroke-width', style.strokeWidth ?? '1.4');
  if (style.dashed === '1') {
    shape.setAttribute('stroke-dasharray', '8 5');
  }
}

function resolveEdgePath(edge: DiagramEdge, nodeMap: Map<string, DiagramNode>): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const source = edge.source ? nodeMap.get(edge.source) : undefined;
  const target = edge.target ? nodeMap.get(edge.target) : undefined;
  if (source) {
    points.push([source.x + source.width, source.y + source.height / 2]);
  }
  points.push(...edge.points);
  if (target) {
    points.push([target.x, target.y + target.height / 2]);
  }
  if (points.length >= 2) {
    return points;
  }
  if (source && target) {
    return [
      [source.x + source.width, source.y + source.height / 2],
      [target.x, target.y + target.height / 2]
    ];
  }
  return points;
}

function parseEdgePoints(geometry: Element): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (const point of childElements(geometry, 'mxpoint')) {
    points.push([numberAttr(point, 'x'), numberAttr(point, 'y')]);
  }
  const array = childElements(geometry, 'array')[0];
  if (array) {
    for (const point of childElements(array, 'mxpoint')) {
      points.push([numberAttr(point, 'x'), numberAttr(point, 'y')]);
    }
  }
  return points;
}

function computePageBounds(page: DiagramPage): { minX: number; minY: number; width: number; height: number } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of page.nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }
  for (const edge of page.edges) {
    for (const [x, y] of edge.points) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { minX: 0, minY: 0, width: 360, height: 260 };
  }
  minX -= MARGIN;
  minY -= MARGIN;
  maxX += MARGIN;
  maxY += MARGIN;
  return {
    minX,
    minY,
    width: Math.max(360, maxX - minX),
    height: Math.max(260, maxY - minY)
  };
}

function childElements(element: Element, name: string): Element[] {
  return Array.from(element.children).filter((child) => localName(child) === name);
}

function localName(element: Element): string {
  return element.localName.toLowerCase();
}

function numberAttr(element: Element, name: string, fallback = 0): number {
  const value = element.getAttribute(name);
  const parsed = value === null ? NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeLabel(value: string, context: DiagramParseContext): string {
  return decodeXmlEntities(value.replace(/<[^>]+>/g, ' '), context).replace(/\s+/g, ' ').trim();
}

type DrawioStyle = Record<string, string>;

function parseDrawioStyle(style: string | undefined): DrawioStyle {
  const result: DrawioStyle = {};
  for (const part of String(style ?? '').split(';')) {
    if (!part) {
      continue;
    }
    const [rawKey, ...rawValue] = part.split('=');
    const key = rawKey?.trim();
    if (!key) {
      continue;
    }
    result[key] = rawValue.length ? rawValue.join('=').trim() : '1';
  }
  return result;
}

function decodeXmlEntities(value: string, context: DiagramParseContext): string {
  if (!value.includes('&') && !value.includes('\0')) return value;
  // Common XML entities need one decoding pass; let the browser handle other HTML references.
  if (!value.includes('\0') && !/&(?!amp;|lt;|gt;|quot;|apos;)/.test(value)) {
    return value.replace(/&(amp|lt|gt|quot|apos);/g, (_match, name: string) => XML_ENTITIES[name]!);
  }
  const textarea = context.labelDecoder ??= document.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
}

function shortenText(text: string): string {
  return text.length > 34 ? `${text.slice(0, 31)}...` : text;
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
      throw new Error(`Failed to load diagram source: ${response.status} ${response.statusText}`.trim());
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
      throw new Error(`Failed to load diagram source: ${response.status} ${response.statusText}`.trim());
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
  if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
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

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function normalizeFormat(format: string | undefined): string {
  return String(format ?? '').trim().replace(/^\./, '').toLowerCase();
}
