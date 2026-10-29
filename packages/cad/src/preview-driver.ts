import {
  createDefaultPreviewRoutes,
  analyzePreviewFonts,
  getPreviewFontWarnings,
  bindPreviewFontLoading,
  analyzeLoadedPreviewFonts,
  type PreviewFontRefresh,
  type CadPreviewState,
  type FormatDefinition,
  type PreviewFontResolver,
  type PreviewFontReference,
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

export interface CadPoint {
  x: number;
  y: number;
}

export interface CadLineEntity {
  type: 'line';
  start: CadPoint;
  end: CadPoint;
  layer?: string;
  colorIndex?: number;
  trueColor?: string;
  lineType?: string;
  lineTypePattern?: number[];
  lineTypeScale?: number;
  lineWeight?: number;
  color?: string;
  opacity?: number;
  visible?: boolean;
  entityVisible?: boolean;
}

export interface CadConstructionLineEntity {
  type: 'construction-line';
  point: CadPoint;
  direction: CadPoint;
  ray: boolean;
  layer?: string;
  colorIndex?: number;
  trueColor?: string;
  lineType?: string;
  lineTypePattern?: number[];
  lineTypeScale?: number;
  lineWeight?: number;
  color?: string;
  opacity?: number;
  visible?: boolean;
  entityVisible?: boolean;
}

export interface CadDimensionPreviewEntity {
  type: 'dimension';
  start: CadPoint;
  end: CadPoint;
  textPoint: CadPoint;
  text: string;
  height: number;
  layer?: string;
  colorIndex?: number;
  trueColor?: string;
  lineType?: string;
  lineTypePattern?: number[];
  lineTypeScale?: number;
  lineWeight?: number;
  color?: string;
  opacity?: number;
  visible?: boolean;
  entityVisible?: boolean;
}

export interface CadPointEntity {
  type: 'point';
  point: CadPoint;
  layer?: string;
  colorIndex?: number;
  trueColor?: string;
  lineType?: string;
  lineTypePattern?: number[];
  lineTypeScale?: number;
  lineWeight?: number;
  color?: string;
  opacity?: number;
  visible?: boolean;
  entityVisible?: boolean;
}

export interface CadCircleEntity {
  type: 'circle';
  center: CadPoint;
  radius: number;
  layer?: string;
  colorIndex?: number;
  trueColor?: string;
  lineType?: string;
  lineTypePattern?: number[];
  lineTypeScale?: number;
  lineWeight?: number;
  color?: string;
  opacity?: number;
  visible?: boolean;
  entityVisible?: boolean;
}

export interface CadArcEntity {
  type: 'arc';
  center: CadPoint;
  radius: number;
  startAngle: number;
  endAngle: number;
  layer?: string;
  colorIndex?: number;
  trueColor?: string;
  lineType?: string;
  lineTypePattern?: number[];
  lineTypeScale?: number;
  lineWeight?: number;
  color?: string;
  opacity?: number;
  visible?: boolean;
  entityVisible?: boolean;
}

export interface CadEllipseEntity {
  type: 'ellipse';
  center: CadPoint;
  majorAxis: CadPoint;
  ratio: number;
  startParameter: number;
  endParameter: number;
  layer?: string;
  colorIndex?: number;
  trueColor?: string;
  lineType?: string;
  lineTypePattern?: number[];
  lineTypeScale?: number;
  lineWeight?: number;
  color?: string;
  opacity?: number;
  visible?: boolean;
  entityVisible?: boolean;
}

export interface CadPolylineEntity {
  type: 'polyline';
  points: CadPoint[];
  closed: boolean;
  bulges?: number[];
  strokeWidth?: number;
  layer?: string;
  colorIndex?: number;
  trueColor?: string;
  lineType?: string;
  lineTypePattern?: number[];
  lineTypeScale?: number;
  lineWeight?: number;
  color?: string;
  opacity?: number;
  visible?: boolean;
  entityVisible?: boolean;
}

export interface CadFaceEntity {
  type: 'face';
  points: CadPoint[];
  layer?: string;
  colorIndex?: number;
  trueColor?: string;
  lineType?: string;
  lineTypePattern?: number[];
  lineTypeScale?: number;
  lineWeight?: number;
  color?: string;
  opacity?: number;
  visible?: boolean;
  entityVisible?: boolean;
}

export interface CadHatchEntity {
  type: 'hatch';
  loops: CadPoint[][];
  patternName?: string;
  solid: boolean;
  layer?: string;
  colorIndex?: number;
  trueColor?: string;
  lineType?: string;
  lineTypePattern?: number[];
  lineTypeScale?: number;
  lineWeight?: number;
  color?: string;
  opacity?: number;
  visible?: boolean;
  entityVisible?: boolean;
}

export interface CadSplineEntity {
  type: 'spline';
  points: CadPoint[];
  degree: number;
  closed: boolean;
  layer?: string;
  colorIndex?: number;
  trueColor?: string;
  lineType?: string;
  lineTypePattern?: number[];
  lineTypeScale?: number;
  lineWeight?: number;
  color?: string;
  opacity?: number;
  visible?: boolean;
  entityVisible?: boolean;
}

export interface CadTextEntity {
  type: 'text';
  point: CadPoint;
  value: string;
  height: number;
  rotation: number;
  widthFactor: number;
  obliqueAngle: number;
  horizontalAlign: 'left' | 'center' | 'right';
  verticalAlign: 'baseline' | 'bottom' | 'middle' | 'top';
  layer?: string;
  colorIndex?: number;
  trueColor?: string;
  lineType?: string;
  lineTypePattern?: number[];
  lineTypeScale?: number;
  lineWeight?: number;
  color?: string;
  opacity?: number;
  visible?: boolean;
  entityVisible?: boolean;
  styleName?: string;
  fontFamily?: string;
  fontFile?: string;
}

export interface CadImageEntity {
  type: 'image';
  point: CadPoint;
  uVector: CadPoint;
  vVector: CadPoint;
  width: number;
  height: number;
  source?: string;
  imageDefHandle?: string;
  clipBoundary?: CadPoint[];
  brightness?: number;
  contrast?: number;
  fade?: number;
  layer?: string;
  colorIndex?: number;
  trueColor?: string;
  lineType?: string;
  lineTypePattern?: number[];
  lineTypeScale?: number;
  lineWeight?: number;
  color?: string;
  opacity?: number;
  visible?: boolean;
  entityVisible?: boolean;
}

export type CadEntity =
  | CadLineEntity
  | CadConstructionLineEntity
  | CadDimensionPreviewEntity
  | CadPointEntity
  | CadCircleEntity
  | CadArcEntity
  | CadEllipseEntity
  | CadPolylineEntity
  | CadFaceEntity
  | CadHatchEntity
  | CadSplineEntity
  | CadTextEntity
  | CadImageEntity;

export interface CadTextStyle {
  name: string;
  fontFile?: string;
  bigFontFile?: string;
  fontFamily?: string;
}

export interface CadLayer {
  name: string;
  colorIndex?: number;
  trueColor?: string;
  color?: string;
  opacity?: number;
  lineType?: string;
  lineTypePattern?: number[];
  lineWeight?: number;
  frozen?: boolean;
  locked?: boolean;
  visible: boolean;
}

export interface CadLineType {
  name: string;
  description?: string;
  pattern: number[];
  dashArray?: string;
}

export interface CadDrawing {
  entities: CadEntity[];
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  header: CadHeaderMetadata;
  layers: string[];
  layerStyles: CadLayer[];
  lineTypes: CadLineType[];
  textStyles: CadTextStyle[];
  warnings: string[];
}

export interface CadHeaderMetadata {
  units?: CadUnitsMetadata;
  lineTypeScale?: number;
}

export interface CadUnitsMetadata {
  code?: number;
  name?: string;
  measurement?: 'imperial' | 'metric';
}

interface DxfPair {
  code: number;
  value: string;
}

interface CadBlockDefinition {
  name: string;
  basePoint: CadPoint;
  entities: CadEntity[];
  inserts: CadInsertEntity[];
}

interface CadInsertEntity {
  blockName: string;
  point: CadPoint;
  scaleX: number;
  scaleY: number;
  rotation: number;
  columns: number;
  rows: number;
  columnSpacing: number;
  rowSpacing: number;
  layer?: string;
  colorIndex?: number;
  trueColor?: string;
  opacity?: number;
  entityVisible?: boolean;
  lineType?: string;
  lineTypeScale?: number;
  lineWeight?: number;
}

interface CadImageDefinition {
  handle: string;
  source?: string;
  width?: number;
  height?: number;
}

interface CadDimensionBlockReference {
  blockName: string;
  layer?: string;
  colorIndex?: number;
  trueColor?: string;
  opacity?: number;
  entityVisible?: boolean;
  lineType?: string;
  lineTypeScale?: number;
  lineWeight?: number;
}

interface CadEntityMetadataSource {
  layer?: string;
  colorIndex?: number;
  trueColor?: string;
  opacity?: number;
  entityVisible?: boolean;
  lineType?: string;
  lineTypeScale?: number;
  lineWeight?: number;
}

interface CadInsertTransform {
  blockBasePoint: CadPoint;
  insertionPoint: CadPoint;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

export const CAD_FORMAT_ROUTES: FormatDefinition[] = [
  {
    extensions: ['dxf'],
    family: 'cad',
    driverId: 'cad',
    targetFormat: 'dxf',
    contentTypes: ['image/vnd.dxf', 'application/dxf', 'application/x-dxf']
  }
];

const DEFAULT_CAD_COLOR = '#223245';

export class CadPreviewSession implements PreviewSession<CadPreviewState> {
  private readonly listeners: PreviewListenerMap = {
    loading: new Set(),
    rendered: new Set(),
    error: new Set(),
    statechange: new Set(),
    warnings: new Set()
  };
  private readonly root: HTMLDivElement;
  private canvas: SVGSVGElement | null = null;
  private drawing: CadDrawing | null = null;
  private panX = 0;
  private panY = 0;
  private state: CadPreviewState;
  private loadController: AbortController | null = null;
  private resourceUrls = new Set<string>();
  private readonly layerElements = new Map<string, SVGElement[]>();
  private appliedLayers = new Set<string>();
  private readonly fontLoading: ReturnType<typeof bindPreviewFontLoading>;
  private fontReferences: PreviewFontReference[] = [];

  constructor(private readonly host: HTMLElement, private readonly options: PreviewOptions = {}) {
    this.root = document.createElement('div');
    this.root.className = 'cadv-preview';
    this.host.replaceChildren(this.root);
    this.state = {
      loading: false,
      error: null,
      family: 'cad',
      warnings: [],
      capabilities: {
        zoom: true,
        fit: true,
        pan: true,
        fullscreen: true,
        layers: true,
        metadata: true
      },
      scale: this.options.initialScale ?? 1,
      layers: [],
      activeLayerIds: []
    };
    this.fontLoading = bindPreviewFontLoading(this, host.ownerDocument, options);
  }

  async load(source: PreviewSource, context: PreviewLoadContext): Promise<void> {
    this.stopLoad();
    this.fontLoading.reset(context.signal, context.route?.targetFormat ?? context.descriptor.extension ?? 'dxf');
    const controller = new AbortController();
    this.loadController = controller;
    const signal = controller.signal;
    const resourceUrls = this.resourceUrls = new Set();
    const abort = () => controller.abort();
    signal.addEventListener('abort', () => {
      context.signal?.removeEventListener('abort', abort);
      if (this.loadController === controller) {
        this.stopLoad();
        this.state.loading = false;
        this.emit('statechange', this.state);
      }
    }, { once: true });
    context.signal?.addEventListener('abort', abort, { once: true });
    this.state = {
      ...this.state,
      loading: true,
      error: null,
      title: context.descriptor.name,
      warnings: [],
      fonts: []
    };
    this.emit('loading', this.state);
    this.emit('statechange', this.state);

    try {
      if (context.signal?.aborted) controller.abort();
      checkCadAborted(signal);
      const format = normalizeFormat(context.route?.sourceFormat ?? context.descriptor.extension);
      if (format !== 'dxf') {
        throw new Error(`CAD preview currently supports browser-native DXF files, got ${format || 'unknown'}.`);
      }

      const text = await sourceToText(source, { ...context, signal });
      checkCadAborted(signal);
      const parsedDrawing = loadDxfDrawing(text);
      const resourceResolvedDrawing = await applyCadResourceResolver(
        parsedDrawing,
        this.options.resourceResolver,
        format,
        resourceUrls,
        signal
      );
      checkCadAborted(signal);
      const drawing = applyCadFontResolver(resourceResolvedDrawing, this.options.fontResolver, format);
      checkCadAborted(signal);
      this.fontReferences = collectCadFontReferences(resourceResolvedDrawing, drawing);
      const fontAnalysis = analyzePreviewFonts(this.fontReferences, this.host.ownerDocument);
      // Drawing warnings already identify unsupported SHX files, including Big Fonts.
      const fontWarnings = getPreviewFontWarnings(fontAnalysis.fonts.filter((font) => font.status !== 'unsupported'));
      const activeLayerIds = drawing.layerStyles.length
        ? drawing.layerStyles.filter((layer) => layer.visible).map((layer) => layer.name)
        : drawing.layers;
      this.state = {
        ...this.state,
        loading: false,
        error: null,
        warnings: [...new Set([...drawing.warnings, ...fontWarnings])],
        fonts: fontAnalysis.fonts,
        layers: drawingLayersToState(drawing),
        activeLayerIds
      };
      this.render(drawing);
      if (this.state.warnings.length) {
        this.emit('warnings', this.state.warnings);
      }
      this.emit('rendered', this.state);
      this.emit('statechange', this.state);
    } catch (error) {
      if (signal.aborted) {
        if (context.signal?.aborted) checkCadAborted(signal);
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
    this.fontLoading.destroy();
    this.stopLoad();
    this.state.loading = false;
    if (this.root.parentElement === this.host) {
      this.host.replaceChildren();
    }
    for (const listeners of Object.values(this.listeners)) listeners.clear();
  }

  private stopLoad(): void {
    this.fontReferences = [];
    const controller = this.loadController;
    this.loadController = null;
    controller?.abort();
    this.root.replaceChildren();
    this.canvas = null;
    this.drawing = null;
    this.layerElements.clear();
    this.appliedLayers.clear();
    this.panX = 0;
    this.panY = 0;
    this.state.layers = [];
    this.state.activeLayerIds = [];
    this.state.fonts = [];
    for (const url of this.resourceUrls) URL.revokeObjectURL(url);
    this.resourceUrls.clear();
  }

  getState(): CadPreviewState {
    return {
      ...this.state,
      warnings: [...this.state.warnings],
      fonts: this.state.fonts?.map((font) => ({ ...font, classification: font.classification ? { ...font.classification } : undefined })),
      layers: [...(this.state.layers ?? [])],
      activeLayerIds: [...(this.state.activeLayerIds ?? [])]
    };
  }

  getFontReferences(): readonly PreviewFontReference[] { return this.fontReferences; }

  refreshFonts(update: PreviewFontRefresh): void {
    if (!this.drawing || this.loadController?.signal.aborted) return;
    for (const entity of this.drawing.entities) {
      if (entity.type !== 'text') continue;
      const index = this.fontReferences.findIndex(ref => ref.styleName === entity.styleName
        && (ref.resolvedFontFamily ?? ref.fontFamily) === entity.fontFamily);
      const target = update.references[index]?.resolvedFontFamily;
      if (target) entity.fontFamily = target;
    }
    this.fontReferences = update.references;
    const analysis = analyzeLoadedPreviewFonts(update, this.host.ownerDocument);
    this.state.fonts = analysis.fonts;
    this.state.warnings = [...new Set([...this.drawing.warnings, ...getPreviewFontWarnings(analysis.fonts.filter(font => font.status !== 'unsupported')), ...update.warnings])];
    if (update.loaded.length || update.relayout) {
      this.render(this.drawing);
      this.appliedLayers = new Set(this.drawing.layers);
      this.applyLayerVisibility();
    }
    this.emit('warnings', this.state.warnings); this.emit('rendered', this.getState()); this.emit('statechange', this.getState());
  }

  setScale(scale: number): void {
    this.state = {
      ...this.state,
      scale: Math.max(0.1, Math.min(scale, 8))
    };
    this.applyTransform();
    this.emit('statechange', this.state);
  }

  fit(): void {
    this.panX = 0;
    this.panY = 0;
    this.setScale(1);
  }

  pan(deltaX: number, deltaY: number): void {
    this.panX += deltaX;
    this.panY += deltaY;
    this.applyTransform();
    this.emit('statechange', this.state);
  }

  setActiveLayers(layerIds: string[]): void {
    const knownLayers = this.drawing?.layers ?? [];
    const active = new Set(layerIds.filter((layerId) => knownLayers.includes(layerId)));
    this.state = {
      ...this.state,
      activeLayerIds: [...active]
    };
    this.applyLayerVisibility();
    this.emit('statechange', this.state);
  }

  toggleLayer(layerId: string, active?: boolean): void {
    const knownLayers = this.drawing?.layers ?? [];
    if (!knownLayers.includes(layerId)) {
      return;
    }
    const activeLayers = new Set(this.state.activeLayerIds ?? []);
    const shouldActivate = active ?? !activeLayers.has(layerId);
    if (shouldActivate) {
      activeLayers.add(layerId);
    } else {
      activeLayers.delete(layerId);
    }
    this.setActiveLayers([...activeLayers]);
  }

  async fullscreen(): Promise<void> {
    await this.root.requestFullscreen?.();
  }

  on<T extends PreviewEventName>(event: T, handler: (payload: PreviewEventMap[T]) => void): () => void {
    this.listeners[event].add(handler as never);
    return () => {
      this.listeners[event].delete(handler as never);
    };
  }

  private render(drawing: CadDrawing): void {
    this.drawing = drawing;
    const stage = document.createElement('div');
    stage.className = 'cadv-stage';
    this.layerElements.clear();
    const svg = renderDrawingToSvg(drawing, this.layerElements);
    this.canvas = svg;
    this.appliedLayers = new Set(this.state.activeLayerIds);
    stage.appendChild(svg);
    this.root.replaceChildren(stage);
    this.applyTransform();
  }

  private applyLayerVisibility(): void {
    if (!this.canvas) {
      return;
    }
    const activeLayers = new Set(this.state.activeLayerIds ?? []);
    for (const [layerId, elements] of this.layerElements) {
      if (activeLayers.has(layerId) === this.appliedLayers.has(layerId)) continue;
      for (const element of elements) {
        const entityVisible = element.getAttribute('data-entity-visible') !== 'false';
        const visible = entityVisible && (!layerId || activeLayers.has(layerId));
        if (visible) {
          element.removeAttribute('display');
        } else {
          element.setAttribute('display', 'none');
        }
        element.setAttribute('data-layer-visible', visible ? 'true' : 'false');
      }
    }
    this.appliedLayers = activeLayers;
  }

  private applyTransform(): void {
    if (!this.canvas) {
      return;
    }
    this.canvas.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.state.scale})`;
  }

  private emit<T extends PreviewEventName>(event: T, payload: PreviewEventMap[T]): void {
    for (const handler of this.listeners[event]) {
      handler(payload as never);
    }
  }
}

export function createCadPreviewDriver(): PreviewDriver<CadPreviewState> {
  return {
    id: 'cad',
    family: 'cad',
    supports: (format) => normalizeFormat(format) === 'dxf',
    createSession: (host, options) => new CadPreviewSession(host, options)
  };
}

export function createCadPreviewRoutes(baseRoutes = createDefaultPreviewRoutes()): FormatDefinition[] {
  return [
    ...CAD_FORMAT_ROUTES,
    ...baseRoutes.filter((route) => !route.extensions.some((extension) => extension === 'dxf'))
  ];
}

export function loadDxfDrawing(source: string): CadDrawing {
  const sections = readDxfSections(readDxfPairs(source));
  const headerPairs = sections.get('HEADER') ?? [];
  const tablePairs = sections.get('TABLES') ?? [];
  const headerBounds = readHeaderBounds(headerPairs);
  const header = readHeaderMetadata(headerPairs);
  const textStyleMap = readTextStyleMap(tablePairs);
  const imageDefinitionMap = readImageDefinitionMap(sections.get('OBJECTS') ?? []);
  const lineTypeMap = readLineTypeMap(tablePairs);
  const layerMap = readLayerMap(tablePairs, lineTypeMap);
  const entities: CadEntity[] = [];
  const warnings: string[] = [];
  const blockMap = readBlockMap(sections.get('BLOCKS') ?? [], textStyleMap, warnings, imageDefinitionMap);
  const pairs = sections.get('ENTITIES') ?? [];
  let inEntities = false;
  let index = 0;

  while (index < pairs.length) {
    const pair = pairs[index];
    if (pair.code === 0 && pair.value === 'SECTION' && pairs[index + 1]?.code === 2 && pairs[index + 1]?.value === 'ENTITIES') {
      inEntities = true;
      index += 2;
      continue;
    }
    if (pair.code === 0 && pair.value === 'ENDSEC') {
      inEntities = false;
      index += 1;
      continue;
    }
    if (!inEntities || pair.code !== 0) {
      index += 1;
      continue;
    }

    const record = readEntityRecord(pairs, index);
    if (record.type === 'POLYLINE') {
      const parsed = readClassicPolyline(pairs, index);
      if (parsed.entity) {
        entities.push(parsed.entity);
      }
      index = parsed.nextIndex;
      continue;
    }
    if (record.type === 'INSERT' || record.type === 'MINSERT') {
      const insert = parseInsert(record.type, record.values);
      if (insert) {
        for (const entity of expandInsert(insert, blockMap, warnings)) entities.push(entity);
      }
      index = record.nextIndex;
      continue;
    }
    if (record.type === 'DIMENSION') {
      const dimensionReference = parseDimensionBlockReference(record.values);
      if (dimensionReference?.blockName && blockMap.has(normalizeBlockName(dimensionReference.blockName))) {
        for (const entity of expandDimension(dimensionReference, blockMap, warnings)) entities.push(entity);
      } else {
        const fallbackDimension = parseDimensionPreview(record.values);
        if (fallbackDimension) {
          entities.push(fallbackDimension);
        }
        if (dimensionReference?.blockName && !fallbackDimension) {
          warnings.push(`DXF DIMENSION references missing block "${dimensionReference.blockName}"; skipped.`);
        }
      }
      index = record.nextIndex;
      continue;
    }

    const entity = parseEntity(record.type, record.values, textStyleMap, imageDefinitionMap);
    if (entity) {
      entities.push(entity);
    }
    index = record.nextIndex;
  }

  const resolvedEntities = resolveEntityStyles(entities, layerMap, lineTypeMap, header.lineTypeScale);
  const bounds = computeBounds(resolvedEntities, headerBounds);
  return {
    entities: resolvedEntities,
    bounds,
    header,
    layers: uniqueSorted([
      ...[...layerMap.values()].map((layer) => layer.name),
      ...(resolvedEntities.map((entity) => entity.layer).filter(Boolean) as string[])
    ]),
    layerStyles: [...layerMap.values()].sort((left, right) => left.name.localeCompare(right.name)),
    lineTypes: [...lineTypeMap.values()].sort((left, right) => left.name.localeCompare(right.name)),
    textStyles: [...textStyleMap.values()],
    warnings: [...collectDrawingWarnings(resolvedEntities, textStyleMap), ...uniqueWarnings(warnings)]
  };
}

function readDxfSections(pairs: DxfPair[]): Map<string, DxfPair[]> {
  const sections = new Map<string, DxfPair[]>();
  for (let index = 0; index < pairs.length; index++) {
    if (pairs[index].code !== 0 || pairs[index].value !== 'SECTION' || pairs[index + 1]?.code !== 2) continue;
    const start = index;
    const name = pairs[index + 1].value;
    index += 2;
    while (index < pairs.length && !(pairs[index].code === 0 && pairs[index].value === 'ENDSEC')) index++;
    const section = sections.get(name);
    if (section) {
      for (let cursor = start; cursor <= index && cursor < pairs.length; cursor++) section.push(pairs[cursor]);
    } else {
      sections.set(name, pairs.slice(start, index + 1));
    }
  }
  return sections;
}

function readDxfPairs(source: string): DxfPair[] {
  const pairs: DxfPair[] = [];
  let offset = 0;
  while (offset < source.length) {
    const codeEnd = source.indexOf('\n', offset);
    if (codeEnd < 0) break;
    const valueEnd = source.indexOf('\n', codeEnd + 1);
    const end = valueEnd < 0 ? source.length : valueEnd;
    const code = Number(source.slice(offset, codeEnd).trim());
    if (Number.isFinite(code)) pairs.push({ code, value: source.slice(codeEnd + 1, end).trimEnd() });
    offset = end + 1;
  }
  return pairs;
}

function readHeaderBounds(pairs: DxfPair[]): CadDrawing['bounds'] | undefined {
  const extents = readHeaderPointPair(pairs, '$EXTMIN', '$EXTMAX');
  if (extents) {
    return extents;
  }
  return readHeaderPointPair(pairs, '$LIMMIN', '$LIMMAX');
}

function readHeaderMetadata(pairs: DxfPair[]): CadHeaderMetadata {
  const unitCode = readHeaderNumber(pairs, '$INSUNITS');
  const measurementCode = readHeaderNumber(pairs, '$MEASUREMENT');
  const lineTypeScale = normalizeLineTypeScale(readHeaderNumber(pairs, '$LTSCALE'));
  const units = readCadUnits(unitCode, measurementCode);
  return {
    ...(units ? { units } : {}),
    ...(lineTypeScale == null ? {} : { lineTypeScale })
  };
}

function readHeaderNumber(pairs: DxfPair[], variableName: string): number | undefined {
  let inHeader = false;
  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index];
    if (pair.code === 0 && pair.value === 'SECTION' && pairs[index + 1]?.code === 2 && pairs[index + 1]?.value === 'HEADER') {
      inHeader = true;
      index += 1;
      continue;
    }
    if (inHeader && pair.code === 0 && pair.value === 'ENDSEC') {
      return undefined;
    }
    if (!inHeader || pair.code !== 9 || pair.value !== variableName) {
      continue;
    }

    let cursor = index + 1;
    while (cursor < pairs.length && pairs[cursor]?.code !== 9 && pairs[cursor]?.code !== 0) {
      const value = Number(pairs[cursor]?.value);
      if (Number.isFinite(value)) {
        return value;
      }
      cursor += 1;
    }
    return undefined;
  }
  return undefined;
}

function readCadUnits(unitCode: number | undefined, measurementCode: number | undefined): CadUnitsMetadata | undefined {
  const code = unitCode == null || !Number.isFinite(unitCode) ? undefined : Math.trunc(unitCode);
  const measurement = measurementCode === 0 ? 'imperial' : measurementCode === 1 ? 'metric' : undefined;
  if (code == null && !measurement) {
    return undefined;
  }
  return {
    code,
    name: cadUnitName(code),
    measurement
  };
}

function cadUnitName(code: number | undefined): string | undefined {
  if (code == null) {
    return undefined;
  }
  const names: Record<number, string> = {
    0: 'Unitless',
    1: 'Inches',
    2: 'Feet',
    3: 'Miles',
    4: 'Millimeters',
    5: 'Centimeters',
    6: 'Meters',
    7: 'Kilometers',
    8: 'Microinches',
    9: 'Mils',
    10: 'Yards',
    11: 'Angstroms',
    12: 'Nanometers',
    13: 'Microns',
    14: 'Decimeters',
    15: 'Decameters',
    16: 'Hectometers',
    17: 'Gigameters',
    18: 'Astronomical units',
    19: 'Light years',
    20: 'Parsecs',
    21: 'US survey feet',
    22: 'US survey inches',
    23: 'US survey yards',
    24: 'US survey miles'
  };
  return names[code];
}

function readHeaderPointPair(pairs: DxfPair[], minVariable: string, maxVariable: string): CadDrawing['bounds'] | undefined {
  const minPoint = readHeaderPoint(pairs, minVariable);
  const maxPoint = readHeaderPoint(pairs, maxVariable);
  if (!minPoint || !maxPoint || minPoint.x >= maxPoint.x || minPoint.y >= maxPoint.y) {
    return undefined;
  }
  return {
    minX: minPoint.x,
    minY: minPoint.y,
    maxX: maxPoint.x,
    maxY: maxPoint.y
  };
}

function readHeaderPoint(pairs: DxfPair[], variableName: string): CadPoint | undefined {
  let inHeader = false;
  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index];
    if (pair.code === 0 && pair.value === 'SECTION' && pairs[index + 1]?.code === 2 && pairs[index + 1]?.value === 'HEADER') {
      inHeader = true;
      index += 1;
      continue;
    }
    if (inHeader && pair.code === 0 && pair.value === 'ENDSEC') {
      return undefined;
    }
    if (!inHeader || pair.code !== 9 || pair.value !== variableName) {
      continue;
    }

    let x: number | undefined;
    let y: number | undefined;
    let cursor = index + 1;
    while (cursor < pairs.length && pairs[cursor]?.code !== 9 && pairs[cursor]?.code !== 0) {
      if (pairs[cursor]?.code === 10) {
        x = Number(pairs[cursor]?.value);
      }
      if (pairs[cursor]?.code === 20) {
        y = Number(pairs[cursor]?.value);
      }
      cursor += 1;
    }
    return point(x, y);
  }
  return undefined;
}

function readEntity(
  pairs: DxfPair[],
  startIndex: number,
  textStyles: Map<string, CadTextStyle>,
  imageDefinitions = new Map<string, CadImageDefinition>()
): { entity?: CadEntity; nextIndex: number } {
  const record = readEntityRecord(pairs, startIndex);
  return {
    entity: parseEntity(record.type, record.values, textStyles, imageDefinitions),
    nextIndex: record.nextIndex
  };
}

function readEntityRecord(
  pairs: DxfPair[],
  startIndex: number
): { type: string | undefined; values: DxfPair[]; nextIndex: number } {
  const type = pairs[startIndex]?.value;
  let index = startIndex + 1;
  while (index < pairs.length && pairs[index]?.code !== 0) {
    index += 1;
  }

  return {
    type,
    values: pairs.slice(startIndex + 1, index),
    nextIndex: index
  };
}

// Keep common metadata first in entity literals so its stable property layout
// can be cloned before geometry is added, avoiding repeated spread copies.
function parseEntity(
  type: string | undefined,
  values: DxfPair[],
  textStyles: Map<string, CadTextStyle>,
  imageDefinitions = new Map<string, CadImageDefinition>()
): CadEntity | undefined {
  switch (type) {
    case 'LINE':
      return parseLine(values);
    case 'XLINE':
      return parseConstructionLine(values, false);
    case 'RAY':
      return parseConstructionLine(values, true);
    case 'POINT':
      return parsePoint(values);
    case 'CIRCLE':
      return parseCircle(values);
    case 'ARC':
      return parseArc(values);
    case 'ELLIPSE':
      return parseEllipse(values);
    case 'LWPOLYLINE':
      return parsePolyline(values);
    case 'LEADER':
      return parseLeader(values);
    case 'SOLID':
    case 'TRACE':
    case '3DFACE':
      return parseFace(values);
    case 'HATCH':
      return parseHatch(values);
    case 'SPLINE':
      return parseSpline(values);
    case 'TEXT':
    case 'MTEXT':
    case 'ATTRIB':
    case 'ATTDEF':
      return parseText(type, values, textStyles);
    case 'IMAGE':
      return parseImage(values, imageDefinitions);
    default:
      return undefined;
  }
}

function parsePoint(values: DxfPair[]): CadPointEntity | undefined {
  const cadPoint = point(readNumber(values, 10), readNumber(values, 20));
  if (!cadPoint) return undefined;
  return {
    ...entityStyle(values),
    type: 'point',
    point: cadPoint
  };
}

function parseLine(values: DxfPair[]): CadLineEntity | undefined {
  const start = point(readNumber(values, 10), readNumber(values, 20));
  const end = point(readNumber(values, 11), readNumber(values, 21));
  if (!start || !end) return undefined;
  return {
    ...entityStyle(values),
    type: 'line',
    start,
    end
  };
}

function parseConstructionLine(values: DxfPair[], ray: boolean): CadConstructionLineEntity | undefined {
  const basePoint = point(readNumber(values, 10), readNumber(values, 20));
  const direction = point(readNumber(values, 11), readNumber(values, 21));
  if (!basePoint || !direction || vectorLength(direction) < 1e-9) return undefined;
  return {
    ...entityStyle(values),
    type: 'construction-line',
    point: basePoint,
    direction,
    ray
  };
}

function parseCircle(values: DxfPair[]): CadCircleEntity | undefined {
  const center = point(readNumber(values, 10), readNumber(values, 20));
  const radius = readNumber(values, 40);
  if (!center || !radius || radius <= 0) return undefined;
  return {
    ...entityStyle(values),
    type: 'circle',
    center,
    radius
  };
}

function parseArc(values: DxfPair[]): CadArcEntity | undefined {
  const center = point(readNumber(values, 10), readNumber(values, 20));
  const radius = readNumber(values, 40);
  const startAngle = readNumber(values, 50);
  const endAngle = readNumber(values, 51);
  if (!center || !radius || radius <= 0 || startAngle == null || endAngle == null) return undefined;
  return {
    ...entityStyle(values),
    type: 'arc',
    center,
    radius,
    startAngle,
    endAngle
  };
}

function parseEllipse(values: DxfPair[]): CadEllipseEntity | undefined {
  const center = point(readNumber(values, 10), readNumber(values, 20));
  const majorAxis = point(readNumber(values, 11), readNumber(values, 21));
  const ratio = readNumber(values, 40);
  if (!center || !majorAxis || ratio == null || ratio <= 0) {
    return undefined;
  }
  return {
    ...entityStyle(values),
    type: 'ellipse',
    center,
    majorAxis,
    ratio,
    startParameter: readNumber(values, 41) ?? 0,
    endParameter: readNumber(values, 42) ?? Math.PI * 2
  };
}

function parsePolyline(values: DxfPair[]): CadPolylineEntity | undefined {
  const points: CadPoint[] = [];
  const bulges: number[] = [];
  const widths: Array<number | undefined> = [];
  let pendingX: number | undefined;
  let pendingY: number | undefined;
  let pendingBulge = 0;
  let pendingStartWidth: number | undefined;
  let pendingEndWidth: number | undefined;
  const pushPendingPoint = (): void => {
    const cadPoint = point(pendingX, pendingY);
    if (cadPoint) {
      points.push(cadPoint);
      bulges.push(pendingBulge);
      widths.push(resolvePolylineVertexWidth(pendingStartWidth, pendingEndWidth));
    }
    pendingX = undefined;
    pendingY = undefined;
    pendingBulge = 0;
    pendingStartWidth = undefined;
    pendingEndWidth = undefined;
  };

  for (const pair of values) {
    if (pair.code === 10) {
      pushPendingPoint();
      pendingX = Number(pair.value);
      continue;
    }
    if (pair.code === 20) {
      pendingY = Number(pair.value);
      continue;
    }
    if (pair.code === 42) {
      const bulge = Number(pair.value);
      pendingBulge = Number.isFinite(bulge) ? bulge : 0;
      continue;
    }
    if (pair.code === 40) {
      pendingStartWidth = Number(pair.value);
      continue;
    }
    if (pair.code === 41) {
      pendingEndWidth = Number(pair.value);
    }
  }
  pushPendingPoint();

  const constantWidth = readNumber(values, 43);
  if (points.length < 2) return undefined;
  return {
    ...entityStyle(values),
    type: 'polyline',
    points,
    closed: Boolean((readNumber(values, 70) ?? 0) & 1),
    bulges: bulges.some((bulge) => Math.abs(bulge) > 1e-9) ? bulges : undefined,
    strokeWidth: resolvePolylineStrokeWidth(constantWidth, widths)
  };
}

function parseLeader(values: DxfPair[]): CadPolylineEntity | undefined {
  const points = readPointSeries(values, 10, 20);
  if (points.length < 2) {
    return undefined;
  }
  return {
    ...entityStyle(values),
    type: 'polyline',
    points,
    closed: false
  };
}

function parseFace(values: DxfPair[]): CadFaceEntity | undefined {
  const first = point(readNumber(values, 10), readNumber(values, 20));
  const second = point(readNumber(values, 11), readNumber(values, 21));
  const third = point(readNumber(values, 12), readNumber(values, 22));
  const fourth = point(readNumber(values, 13), readNumber(values, 23)) ?? third;
  const points = [first, second, third, fourth].filter((cadPoint): cadPoint is CadPoint => Boolean(cadPoint));
  if (points.length < 3) {
    return undefined;
  }
  return {
    ...entityStyle(values),
    type: 'face',
    points: dedupeConsecutivePoints(points)
  };
}

function parseHatch(values: DxfPair[]): CadHatchEntity | undefined {
  const loops = parseHatchBoundaryLoops(values);
  if (!loops.length) {
    return undefined;
  }
  return {
    ...entityStyle(values),
    type: 'hatch',
    loops,
    patternName: readString(values, 2),
    solid: readNumber(values, 70) === 1 || /^solid$/i.test(readString(values, 2) ?? '')
  };
}

function parseHatchBoundaryLoops(values: DxfPair[]): CadPoint[][] {
  const loops: CadPoint[][] = [];
  for (let index = 0; index < values.length; index += 1) {
    if (values[index]?.code !== 92) {
      continue;
    }
    const loop = parseHatchBoundaryLoop(values, index);
    if (loop.points.length >= 3) {
      loops.push(dedupeConsecutivePoints(loop.points));
    }
    index = Math.max(index, loop.nextIndex - 1);
  }
  return loops;
}

function parseHatchBoundaryLoop(values: DxfPair[], startIndex: number): { points: CadPoint[]; nextIndex: number } {
  const polyline = parseHatchPolylineBoundary(values, startIndex);
  if (polyline.points.length >= 3) {
    return polyline;
  }
  return parseHatchEdgeBoundary(values, startIndex);
}

function parseHatchPolylineBoundary(values: DxfPair[], startIndex: number): { points: CadPoint[]; nextIndex: number } {
  let nextIndex = startIndex + 1;
  for (let index = 0; index < values.length; index += 1) {
    if (index !== startIndex) {
      continue;
    }
    if (values[index]?.code !== 92) {
      continue;
    }
    let cursor = index + 1;
    if (values[cursor]?.code !== 72) {
      continue;
    }
    cursor += 1;
    if (values[cursor]?.code === 73) {
      cursor += 1;
    }
    if (values[cursor]?.code !== 93) {
      continue;
    }
    const vertexCount = Number(values[cursor]?.value);
    if (!Number.isFinite(vertexCount) || vertexCount < 3) {
      continue;
    }
    cursor += 1;
    nextIndex = cursor;
    const points: CadPoint[] = [];
    const bulges: number[] = [];
    let pendingX: number | undefined;
    let pendingY: number | undefined;
    let pendingBulge = 0;
    const pushPendingPoint = (): void => {
      const cadPoint = point(pendingX, pendingY);
      if (cadPoint) {
        points.push(cadPoint);
        bulges.push(pendingBulge);
      }
      pendingX = undefined;
      pendingY = undefined;
      pendingBulge = 0;
    };
    while (cursor < values.length && points.length < vertexCount) {
      const pair = values[cursor]!;
      if (pair.code === 10) {
        pushPendingPoint();
        pendingX = Number(pair.value);
      } else if (pair.code === 20) {
        pendingY = Number(pair.value);
      } else if (pair.code === 42) {
        const bulge = Number(pair.value);
        pendingBulge = Number.isFinite(bulge) ? bulge : 0;
      }
      cursor += 1;
      if (point(pendingX, pendingY) && points.length + 1 >= vertexCount && values[cursor]?.code !== 42) {
        break;
      }
    }
    nextIndex = cursor;
    pushPendingPoint();
    if (points.length >= 3) {
      return {
        points: bulges.some((bulge) => Math.abs(bulge) > 1e-9)
        ? samplePolylinePoints({
            type: 'polyline',
            points,
            closed: true,
            bulges
          })
          : points,
        nextIndex
      };
    }
  }
  return {
    points: [],
    nextIndex
  };
}

function parseHatchEdgeBoundary(values: DxfPair[], startIndex: number): { points: CadPoint[]; nextIndex: number } {
  let nextIndex = startIndex + 1;
  for (let index = 0; index < values.length; index += 1) {
    if (index !== startIndex) {
      continue;
    }
    if (values[index]?.code !== 92) {
      continue;
    }
    let cursor = index + 1;
    if (values[cursor]?.code !== 93) {
      continue;
    }
    const edgeCount = Number(values[cursor]?.value);
    if (!Number.isFinite(edgeCount) || edgeCount < 1) {
      continue;
    }
    cursor += 1;
    nextIndex = cursor;
    const points: CadPoint[] = [];
    let parsedEdges = 0;
    while (cursor < values.length && parsedEdges < edgeCount) {
      if (values[cursor]?.code !== 72) {
        cursor += 1;
        continue;
      }
      const edgeType = Number(values[cursor]?.value);
      const edgeValues: DxfPair[] = [];
      cursor += 1;
      while (cursor < values.length && values[cursor]?.code !== 72 && values[cursor]?.code !== 92) {
        edgeValues.push(values[cursor]!);
        cursor += 1;
      }
      const edgePoints = hatchEdgePoints(edgeType, edgeValues);
      for (const cadPoint of edgePoints) {
        appendPoint(points, cadPoint);
      }
      parsedEdges += 1;
      nextIndex = cursor;
    }
    if (points.length >= 3) {
      return {
        points,
        nextIndex
      };
    }
  }
  return {
    points: [],
    nextIndex
  };
}

function hatchEdgePoints(edgeType: number, values: DxfPair[]): CadPoint[] {
  if (edgeType === 1) {
    return [point(readNumber(values, 10), readNumber(values, 20)), point(readNumber(values, 11), readNumber(values, 21))].filter(
      (cadPoint): cadPoint is CadPoint => Boolean(cadPoint)
    );
  }
  if (edgeType === 2) {
    const center = point(readNumber(values, 10), readNumber(values, 20));
    const radius = readNumber(values, 40);
    const startAngle = readNumber(values, 50);
    const endAngle = readNumber(values, 51);
    if (!center || radius == null || radius <= 0 || startAngle == null || endAngle == null) {
      return [];
    }
    return sampleCircleArcPoints(center, radius, startAngle, endAngle, readNumber(values, 73) !== 0);
  }
  if (edgeType === 3) {
    const center = point(readNumber(values, 10), readNumber(values, 20));
    const majorAxis = point(readNumber(values, 11), readNumber(values, 21));
    const ratio = readNumber(values, 40);
    const startAngle = readNumber(values, 50);
    const endAngle = readNumber(values, 51);
    if (!center || !majorAxis || ratio == null || ratio <= 0 || startAngle == null || endAngle == null) {
      return [];
    }
    return sampleHatchEllipseArcPoints(center, majorAxis, ratio, startAngle, endAngle, readNumber(values, 73) !== 0);
  }
  if (edgeType === 4) {
    const fitPoints = readPointSeries(values, 11, 21);
    const controlPoints = readPointSeries(values, 10, 20);
    const points = fitPoints.length >= 2 ? fitPoints : controlPoints;
    return sampleSplinePoints(points, Boolean((readNumber(values, 74) ?? 0) & 1), readNumber(values, 94) ?? 3);
  }
  return [];
}

function parseSpline(values: DxfPair[]): CadSplineEntity | undefined {
  const fitPoints = readPointSeries(values, 11, 21);
  const controlPoints = readPointSeries(values, 10, 20);
  const points = fitPoints.length >= 2 ? fitPoints : controlPoints;
  if (points.length < 2) {
    return undefined;
  }
  return {
    ...entityStyle(values),
    type: 'spline',
    points,
    degree: readNumber(values, 71) ?? 3,
    closed: Boolean((readNumber(values, 70) ?? 0) & 1)
  };
}

function parseText(type: string | undefined, values: DxfPair[], textStyles: Map<string, CadTextStyle>): CadTextEntity | undefined {
  const isMtext = type === 'MTEXT';
  const insertionPoint = point(readNumber(values, 10), readNumber(values, 20));
  const alignmentPoint = isMtext ? undefined : point(readNumber(values, 11), readNumber(values, 21));
  const horizontalAlign = isMtext ? parseMtextHorizontalAlign(readNumber(values, 71)) : parseHorizontalTextAlign(readNumber(values, 72));
  const verticalAlign = isMtext ? parseMtextVerticalAlign(readNumber(values, 71)) : parseVerticalTextAlign(readNumber(values, 73));
  const usesAlignmentPoint = !isMtext && (readNumber(values, 72) != null || readNumber(values, 73) != null);
  const anchor = usesAlignmentPoint ? (alignmentPoint ?? insertionPoint) : insertionPoint;
  const value = normalizeDxfText(
    [readString(values, 1), ...values.filter((pair) => pair.code === 3).map((pair) => pair.value)].filter(Boolean).join('')
  );
  if (!anchor || !value) return undefined;
  const styleName = readString(values, 7);
  const style = styleName ? textStyles.get(normalizeTextStyleName(styleName)) : undefined;
  const rotation = isMtext ? (readNumber(values, 50) ?? mtextDirectionRotation(values) ?? 0) : (readNumber(values, 50) ?? 0);
  return {
    ...entityStyle(values),
    type: 'text',
    point: anchor,
    value,
    height: readNumber(values, 40) ?? 12,
    rotation,
    widthFactor: isMtext ? 1 : (readNumber(values, 41) ?? 1),
    obliqueAngle: readNumber(values, 51) ?? 0,
    horizontalAlign,
    verticalAlign,
    styleName,
    fontFamily: style?.fontFamily,
    fontFile: style?.fontFile
  };
}

function parseImage(values: DxfPair[], imageDefinitions: Map<string, CadImageDefinition>): CadImageEntity | undefined {
  const insertionPoint = point(readNumber(values, 10), readNumber(values, 20));
  const uVector = point(readNumber(values, 11), readNumber(values, 21));
  const vVector = point(readNumber(values, 12), readNumber(values, 22));
  const width = readNumber(values, 13);
  const height = readNumber(values, 23);
  if (!insertionPoint || !uVector || !vVector || width == null || height == null || width <= 0 || height <= 0) {
    return undefined;
  }
  const imageDefHandle = readImageDefinitionHandle(values);
  const imageDefinition = imageDefHandle ? imageDefinitions.get(normalizeHandle(imageDefHandle)) : undefined;
  return {
    ...entityStyle(values),
    type: 'image',
    point: insertionPoint,
    uVector,
    vVector,
    width,
    height,
    source: imageDefinition?.source,
    imageDefHandle,
    clipBoundary: parseImageClipBoundary(values, width, height),
    brightness: readNumber(values, 281),
    contrast: readNumber(values, 282),
    fade: readNumber(values, 283)
  };
}

function parseImageClipBoundary(values: DxfPair[], width: number, height: number): CadPoint[] | undefined {
  const clippingEnabled = readNumber(values, 280);
  const vertexCount = readNumber(values, 91);
  if (clippingEnabled === 0 || vertexCount == null || vertexCount <= 0) {
    return undefined;
  }

  const points = readPointSeries(values, 14, 24).slice(0, vertexCount);
  if (points.length < 2) {
    return undefined;
  }
  if (points.length === 2) {
    const [first, second] = points;
    if (!first || !second) {
      return undefined;
    }
    return imageClipRectangle(first, second, width, height);
  }
  return points.map((clipPoint) => clampImageClipPoint(clipPoint, width, height));
}

function imageClipRectangle(first: CadPoint, second: CadPoint, width: number, height: number): CadPoint[] {
  const minX = Math.max(0, Math.min(first.x, second.x, width));
  const maxX = Math.max(0, Math.min(Math.max(first.x, second.x), width));
  const minY = Math.max(0, Math.min(first.y, second.y, height));
  const maxY = Math.max(0, Math.min(Math.max(first.y, second.y), height));
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY }
  ];
}

function clampImageClipPoint(clipPoint: CadPoint, width: number, height: number): CadPoint {
  return {
    x: Math.max(0, Math.min(clipPoint.x, width)),
    y: Math.max(0, Math.min(clipPoint.y, height))
  };
}

function readBlockMap(
  pairs: DxfPair[],
  textStyles: Map<string, CadTextStyle>,
  warnings: string[],
  imageDefinitions = new Map<string, CadImageDefinition>()
): Map<string, CadBlockDefinition> {
  const blocks = new Map<string, CadBlockDefinition>();
  let inBlocks = false;
  let index = 0;

  while (index < pairs.length) {
    const pair = pairs[index];
    if (pair.code === 0 && pair.value === 'SECTION' && pairs[index + 1]?.code === 2 && pairs[index + 1]?.value === 'BLOCKS') {
      inBlocks = true;
      index += 2;
      continue;
    }
    if (inBlocks && pair.code === 0 && pair.value === 'ENDSEC') {
      inBlocks = false;
      index += 1;
      continue;
    }
    if (!inBlocks || pair.code !== 0 || pair.value !== 'BLOCK') {
      index += 1;
      continue;
    }

    const headerValues: DxfPair[] = [];
    index += 1;
    while (index < pairs.length && pairs[index]?.code !== 0) {
      headerValues.push(pairs[index]!);
      index += 1;
    }

    const blockHeader = parseBlockHeader(headerValues);
    const entities: CadEntity[] = [];
    const inserts: CadInsertEntity[] = [];
    while (index < pairs.length) {
      const current = pairs[index];
      if (current.code === 0 && current.value === 'ENDBLK') {
        index = skipEntityValues(pairs, index + 1);
        break;
      }
      if (current.code === 0) {
        if (current.value === 'POLYLINE') {
          const parsed = readClassicPolyline(pairs, index);
          if (parsed.entity) {
            entities.push(parsed.entity);
          }
          index = parsed.nextIndex;
          continue;
        }
        if (current.value === 'INSERT' || current.value === 'MINSERT') {
          const record = readEntityRecord(pairs, index);
          const insert = parseInsert(current.value, record.values);
          if (insert) {
            inserts.push(insert);
          }
          index = record.nextIndex;
          continue;
        }
        const parsed = readEntity(pairs, index, textStyles, imageDefinitions);
        if (parsed.entity) {
          entities.push(parsed.entity);
        }
        index = parsed.nextIndex;
        continue;
      }
      index += 1;
    }

    if (blockHeader) {
      blocks.set(normalizeBlockName(blockHeader.name), {
        ...blockHeader,
        entities,
        inserts
      });
    }
  }

  resolveNestedBlockInserts(blocks, warnings);

  return blocks;
}

function parseBlockHeader(values: DxfPair[]): Omit<CadBlockDefinition, 'entities' | 'inserts'> | undefined {
  const name = readString(values, 2);
  if (!name) {
    return undefined;
  }
  return {
    name,
    basePoint: {
      x: readNumber(values, 10) ?? 0,
      y: readNumber(values, 20) ?? 0
    }
  };
}

function resolveNestedBlockInserts(blocks: Map<string, CadBlockDefinition>, warnings: string[]): void {
  const resolved = new Map<string, CadEntity[]>();
  for (const block of blocks.values()) {
    block.entities = resolveBlockEntities(block, blocks, warnings, resolved, []);
  }
}

function resolveBlockEntities(
  block: CadBlockDefinition,
  blocks: Map<string, CadBlockDefinition>,
  warnings: string[],
  resolved: Map<string, CadEntity[]>,
  stack: string[]
): CadEntity[] {
  const blockKey = normalizeBlockName(block.name);
  const cached = resolved.get(blockKey);
  if (cached) {
    return cached;
  }
  if (stack.includes(blockKey)) {
    warnings.push(`DXF block nesting cycle detected at "${block.name}"; nested INSERT expansion skipped.`);
    return block.entities;
  }
  const nextStack = [...stack, blockKey];
  const nestedEntities = block.inserts.flatMap((insert) => expandNestedBlockInsert(insert, blocks, warnings, resolved, nextStack));
  const entities = [...block.entities, ...nestedEntities];
  resolved.set(blockKey, entities);
  return entities;
}

function expandNestedBlockInsert(
  insert: CadInsertEntity,
  blocks: Map<string, CadBlockDefinition>,
  warnings: string[],
  resolved: Map<string, CadEntity[]>,
  stack: string[]
): CadEntity[] {
  const block = blocks.get(normalizeBlockName(insert.blockName));
  if (!block) {
    warnings.push(`DXF nested INSERT references missing block "${insert.blockName}"; skipped.`);
    return [];
  }
  const blockEntities = resolveBlockEntities(block, blocks, warnings, resolved, stack);
  const entities: CadEntity[] = [];
  for (let row = 0; row < insert.rows; row += 1) {
    for (let column = 0; column < insert.columns; column += 1) {
      const transform: CadInsertTransform = {
        blockBasePoint: block.basePoint,
        insertionPoint: mInsertPoint(insert, column, row),
        scaleX: insert.scaleX,
        scaleY: insert.scaleY,
        rotation: insert.rotation
      };
      for (const entity of blockEntities) entities.push(inheritInsertEntityMetadata(transformCadEntity(entity, transform), insert));
    }
  }
  return entities;
}

function readClassicPolyline(pairs: DxfPair[], startIndex: number): { entity?: CadPolylineEntity; nextIndex: number } {
  const header = readEntityRecord(pairs, startIndex);
  const points: CadPoint[] = [];
  const bulges: number[] = [];
  const widths: Array<number | undefined> = [];
  let vertexLayer: string | undefined;
  let vertexColorIndex: number | undefined;
  let index = header.nextIndex;

  while (index < pairs.length) {
    const pair = pairs[index];
    if (pair.code !== 0) {
      index += 1;
      continue;
    }
    if (pair.value === 'SEQEND') {
      index = skipEntityValues(pairs, index + 1);
      break;
    }
    if (pair.value !== 'VERTEX') {
      break;
    }
    const vertex = readEntityRecord(pairs, index);
    const vertexPoint = point(readNumber(vertex.values, 10), readNumber(vertex.values, 20));
    if (vertexPoint) {
      points.push(vertexPoint);
      bulges.push(readNumber(vertex.values, 42) ?? 0);
      widths.push(resolvePolylineVertexWidth(readNumber(vertex.values, 40), readNumber(vertex.values, 41)));
      vertexLayer ??= readString(vertex.values, 8);
      vertexColorIndex ??= readNumber(vertex.values, 62);
    }
    index = vertex.nextIndex;
  }

  if (points.length < 2) {
    return {
      nextIndex: index
    };
  }

  return {
    entity: {
      ...entityStyle(header.values),
      type: 'polyline',
      points,
      closed: Boolean((readNumber(header.values, 70) ?? 0) & 1),
      bulges: bulges.some((bulge) => Math.abs(bulge) > 1e-9) ? bulges : undefined,
      strokeWidth: resolvePolylineStrokeWidth(resolvePolylineVertexWidth(readNumber(header.values, 40), readNumber(header.values, 41)), widths),
      layer: readString(header.values, 8) ?? vertexLayer,
      colorIndex: readNumber(header.values, 62) ?? vertexColorIndex
    },
    nextIndex: index
  };
}

function parseInsert(type: string | undefined, values: DxfPair[]): CadInsertEntity | undefined {
  const blockName = readString(values, 2);
  const insertionPoint = point(readNumber(values, 10), readNumber(values, 20));
  if (!blockName || !insertionPoint) {
    return undefined;
  }
  const isMInsert = type === 'MINSERT';
  return {
    blockName,
    point: insertionPoint,
    scaleX: readNumber(values, 41) ?? 1,
    scaleY: readNumber(values, 42) ?? 1,
    rotation: readNumber(values, 50) ?? 0,
    columns: isMInsert ? Math.max(readNumber(values, 70) ?? 1, 1) : 1,
    rows: isMInsert ? Math.max(readNumber(values, 71) ?? 1, 1) : 1,
    columnSpacing: isMInsert ? readNumber(values, 44) ?? 0 : 0,
    rowSpacing: isMInsert ? readNumber(values, 45) ?? 0 : 0,
    layer: readString(values, 8),
    colorIndex: readNumber(values, 62),
    trueColor: parseTrueColor(readNumber(values, 420)),
    opacity: transparencyToOpacity(readNumber(values, 440)),
    entityVisible: entityVisibility(readNumber(values, 60)),
    lineType: normalizeLineType(readString(values, 6)),
    lineTypeScale: normalizeLineTypeScale(readNumber(values, 48)),
    lineWeight: normalizeLineWeight(readNumber(values, 370))
  };
}

function parseDimensionBlockReference(values: DxfPair[]): CadDimensionBlockReference | undefined {
  const blockName = readString(values, 2);
  if (!blockName) {
    return undefined;
  }
  return {
    blockName,
    layer: readString(values, 8),
    colorIndex: readNumber(values, 62),
    trueColor: parseTrueColor(readNumber(values, 420)),
    opacity: transparencyToOpacity(readNumber(values, 440)),
    entityVisible: entityVisibility(readNumber(values, 60)),
    lineType: normalizeLineType(readString(values, 6)),
    lineTypeScale: normalizeLineTypeScale(readNumber(values, 48)),
    lineWeight: normalizeLineWeight(readNumber(values, 370))
  };
}

function parseDimensionPreview(values: DxfPair[]): CadDimensionPreviewEntity | undefined {
  const start = point(readNumber(values, 13), readNumber(values, 23));
  const end = point(readNumber(values, 14), readNumber(values, 24));
  if (!start || !end) {
    return undefined;
  }
  const textPoint = point(readNumber(values, 11), readNumber(values, 21)) ?? midpoint(start, end);
  const rawText = readString(values, 1);
  const text = rawText && rawText !== '<>' ? normalizeDxfText(rawText) : formatDimensionMeasurement(distance(start, end));
  return {
    ...entityStyle(values),
    type: 'dimension',
    start,
    end,
    textPoint,
    text,
    height: readNumber(values, 140) ?? readNumber(values, 40) ?? Math.max(distance(start, end) * 0.08, 1)
  };
}

function expandInsert(insert: CadInsertEntity, blockMap: Map<string, CadBlockDefinition>, warnings: string[]): CadEntity[] {
  const block = blockMap.get(normalizeBlockName(insert.blockName));
  if (!block) {
    warnings.push(`DXF INSERT references missing block "${insert.blockName}"; skipped.`);
    return [];
  }
  const entities: CadEntity[] = [];
  for (let row = 0; row < insert.rows; row += 1) {
    for (let column = 0; column < insert.columns; column += 1) {
      const transform: CadInsertTransform = {
        blockBasePoint: block.basePoint,
        insertionPoint: mInsertPoint(insert, column, row),
        scaleX: insert.scaleX,
        scaleY: insert.scaleY,
        rotation: insert.rotation
      };
      for (const entity of block.entities) entities.push(inheritInsertEntityMetadata(transformCadEntity(entity, transform), insert));
    }
  }
  return entities;
}

function expandDimension(dimension: CadDimensionBlockReference, blockMap: Map<string, CadBlockDefinition>, warnings: string[]): CadEntity[] {
  const block = blockMap.get(normalizeBlockName(dimension.blockName));
  if (!block) {
    warnings.push(`DXF DIMENSION references missing block "${dimension.blockName}"; skipped.`);
    return [];
  }
  return block.entities.map((entity) => inheritInsertEntityMetadata(entity, dimension));
}

function mInsertPoint(insert: CadInsertEntity, column: number, row: number): CadPoint {
  const localOffset = {
    x: column * insert.columnSpacing,
    y: row * insert.rowSpacing
  };
  const radians = (insert.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: insert.point.x + localOffset.x * cos - localOffset.y * sin,
    y: insert.point.y + localOffset.x * sin + localOffset.y * cos
  };
}

function transformCadEntity(entity: CadEntity, transform: CadInsertTransform): CadEntity {
  const scale = averageScale(transform);
  switch (entity.type) {
    case 'line':
      return {
        ...entity,
        start: transformPoint(entity.start, transform),
        end: transformPoint(entity.end, transform)
      };
    case 'construction-line':
      return {
        ...entity,
        point: transformPoint(entity.point, transform),
        direction: transformVector(entity.direction, transform)
      };
    case 'dimension':
      return {
        ...entity,
        start: transformPoint(entity.start, transform),
        end: transformPoint(entity.end, transform),
        textPoint: transformPoint(entity.textPoint, transform),
        height: entity.height * scale
      };
    case 'point':
      return {
        ...entity,
        point: transformPoint(entity.point, transform)
      };
    case 'circle':
      return {
        ...entity,
        center: transformPoint(entity.center, transform),
        radius: entity.radius * scale
      };
    case 'arc':
      return {
        ...entity,
        center: transformPoint(entity.center, transform),
        radius: entity.radius * scale,
        startAngle: entity.startAngle + transform.rotation,
        endAngle: entity.endAngle + transform.rotation
      };
    case 'ellipse': {
      const transformedCenter = transformPoint(entity.center, transform);
      const transformedMajorEnd = transformPoint(addPoints(entity.center, entity.majorAxis), transform);
      return {
        ...entity,
        center: transformedCenter,
        majorAxis: {
          x: transformedMajorEnd.x - transformedCenter.x,
          y: transformedMajorEnd.y - transformedCenter.y
        },
        ratio: entity.ratio * (Math.abs(transform.scaleY) / Math.abs(transform.scaleX) || 1)
      };
    }
    case 'polyline':
      return {
        ...entity,
        points: entity.points.map((cadPoint) => transformPoint(cadPoint, transform)),
        strokeWidth: entity.strokeWidth == null ? undefined : entity.strokeWidth * averageScale(transform)
      };
    case 'face':
      return {
        ...entity,
        points: entity.points.map((cadPoint) => transformPoint(cadPoint, transform))
      };
    case 'hatch':
      return {
        ...entity,
        loops: entity.loops.map((loop) => loop.map((cadPoint) => transformPoint(cadPoint, transform)))
      };
    case 'spline':
      return {
        ...entity,
        points: entity.points.map((cadPoint) => transformPoint(cadPoint, transform))
      };
    case 'text':
      return {
        ...entity,
        point: transformPoint(entity.point, transform),
        height: entity.height * scale,
        rotation: entity.rotation + transform.rotation,
        widthFactor: entity.widthFactor * (Math.abs(transform.scaleX) / scale || 1)
      };
    case 'image':
      return {
        ...entity,
        point: transformPoint(entity.point, transform),
        uVector: transformVector(entity.uVector, transform),
        vVector: transformVector(entity.vVector, transform)
      };
    default:
      return entity;
  }
}

function inheritInsertEntityMetadata(entity: CadEntity, source: CadEntityMetadataSource): CadEntity {
  const inheritsLayer = !entity.layer || normalizeLayerName(entity.layer) === '0';
  const layer = inheritsLayer ? (source.layer ?? entity.layer) : entity.layer;
  const inheritsColor = entity.colorIndex === 0 || (entity.colorIndex == null && inheritsLayer);
  const colorIndex = inheritsColor ? (source.colorIndex ?? entity.colorIndex) : entity.colorIndex;
  const trueColor = entity.trueColor ?? (inheritsColor ? source.trueColor : undefined);
  const opacity = entity.opacity ?? (inheritsLayer ? source.opacity : undefined);
  const entityVisible = entity.entityVisible ?? source.entityVisible;
  const lineType = entity.lineType ?? (inheritsLayer ? source.lineType : undefined);
  const lineTypeScale = entity.lineTypeScale ?? (inheritsLayer ? source.lineTypeScale : undefined);
  const lineWeight = entity.lineWeight ?? (inheritsLayer ? source.lineWeight : undefined);
  return {
    ...entity,
    layer,
    colorIndex,
    trueColor,
    opacity,
    entityVisible,
    lineType,
    lineTypeScale,
    lineWeight
  };
}

function transformPoint(cadPoint: CadPoint, transform: CadInsertTransform): CadPoint {
  const scaledX = (cadPoint.x - transform.blockBasePoint.x) * transform.scaleX;
  const scaledY = (cadPoint.y - transform.blockBasePoint.y) * transform.scaleY;
  const radians = (transform.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: transform.insertionPoint.x + scaledX * cos - scaledY * sin,
    y: transform.insertionPoint.y + scaledX * sin + scaledY * cos
  };
}

function transformVector(vector: CadPoint, transform: CadInsertTransform): CadPoint {
  const scaledX = vector.x * transform.scaleX;
  const scaledY = vector.y * transform.scaleY;
  const radians = (transform.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: scaledX * cos - scaledY * sin,
    y: scaledX * sin + scaledY * cos
  };
}

function averageScale(transform: CadInsertTransform): number {
  return Math.max((Math.abs(transform.scaleX) + Math.abs(transform.scaleY)) / 2, 0.0001);
}

function skipEntityValues(pairs: DxfPair[], index: number): number {
  while (index < pairs.length && pairs[index]?.code !== 0) {
    index += 1;
  }
  return index;
}

function renderDrawingToSvg(drawing: CadDrawing, layerElements: Map<string, SVGElement[]>): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('cadv-canvas');
  const width = Math.max(drawing.bounds.maxX - drawing.bounds.minX, 1);
  const height = Math.max(drawing.bounds.maxY - drawing.bounds.minY, 1);
  const padding = Math.max(width, height) * 0.04;
  svg.setAttribute('viewBox', `${-padding} ${-padding} ${width + padding * 2} ${height + padding * 2}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'CAD drawing preview');

  const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  background.setAttribute('x', String(-padding));
  background.setAttribute('y', String(-padding));
  background.setAttribute('width', String(width + padding * 2));
  background.setAttribute('height', String(height + padding * 2));
  background.setAttribute('fill', '#ffffff');
  svg.appendChild(background);

  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.setAttribute('fill', 'none');
  group.setAttribute('stroke', '#223245');
  group.setAttribute('stroke-width', String(Math.max(width, height) / 520));
  group.setAttribute('stroke-linecap', 'round');
  group.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(group);

  for (const entity of drawing.entities) {
    const node = renderEntity(entity, drawing.bounds, layerElements);
    if (node) {
      group.appendChild(node);
    }
  }

  if (!drawing.entities.length) {
    const empty = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    empty.classList.add('cadv-empty');
    empty.setAttribute('x', '0');
    empty.setAttribute('y', '0');
    empty.textContent = 'No supported DXF entities found.';
    svg.appendChild(empty);
  }

  return svg;
}

function renderEntity(entity: CadEntity, bounds: CadDrawing['bounds'], layerElements: Map<string, SVGElement[]>): SVGElement | null {
  const applyEntityAttributes = (node: SVGElement, paintTarget: 'stroke' | 'fill' = 'stroke'): SVGElement => {
    node.setAttribute(paintTarget, entity.color ?? DEFAULT_CAD_COLOR);
    if (paintTarget === 'stroke') {
      if (!node.hasAttribute('stroke-width') && entity.lineWeight != null && entity.lineWeight > 0) {
        node.setAttribute('stroke-width', String(entity.lineWeight));
      }
      const dashArray = lineTypeDashArray(entity.lineType, entity.lineTypePattern, entity.lineTypeScale);
      if (dashArray) {
        node.setAttribute('stroke-dasharray', dashArray);
      }
    }
    if (entity.layer) {
      node.setAttribute('data-layer', entity.layer);
      const elements = layerElements.get(entity.layer);
      if (elements) elements.push(node);
      else layerElements.set(entity.layer, [node]);
    }
    if (entity.colorIndex != null) {
      node.setAttribute('data-color-index', String(entity.colorIndex));
    }
    if (entity.trueColor) {
      node.setAttribute('data-true-color', entity.trueColor);
    }
    if (entity.opacity != null) {
      node.setAttribute('opacity', String(entity.opacity));
    }
    if (entity.entityVisible === false) {
      node.setAttribute('data-entity-visible', 'false');
    }
    if (entity.visible === false) {
      node.setAttribute('display', 'none');
      node.setAttribute('data-layer-visible', 'false');
    } else if (entity.layer) {
      node.setAttribute('data-layer-visible', 'true');
    }
    return node;
  };

  switch (entity.type) {
    case 'line': {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      const start = toSvgPoint(entity.start, bounds);
      const end = toSvgPoint(entity.end, bounds);
      line.setAttribute('x1', String(start.x));
      line.setAttribute('y1', String(start.y));
      line.setAttribute('x2', String(end.x));
      line.setAttribute('y2', String(end.y));
      return applyEntityAttributes(line);
    }
    case 'construction-line': {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      const clipped = constructionLineEndpoints(entity, bounds);
      const start = toSvgPoint(clipped.start, bounds);
      const end = toSvgPoint(clipped.end, bounds);
      line.setAttribute('x1', String(start.x));
      line.setAttribute('y1', String(start.y));
      line.setAttribute('x2', String(end.x));
      line.setAttribute('y2', String(end.y));
      line.setAttribute('data-construction-line', entity.ray ? 'ray' : 'xline');
      return applyEntityAttributes(line);
    }
    case 'dimension': {
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('data-dimension', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', dimensionPath(entity, bounds));
      const textPoint = toSvgPoint(entity.textPoint, bounds);
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', String(textPoint.x));
      text.setAttribute('y', String(textPoint.y));
      text.setAttribute('stroke', 'none');
      text.setAttribute('fill', entity.color ?? DEFAULT_CAD_COLOR);
      text.setAttribute('font-family', buildCadFontStack(undefined));
      text.setAttribute('font-size', String(entity.height));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.textContent = entity.text;
      group.append(path, text);
      return applyEntityAttributes(group);
    }
    case 'point': {
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const center = toSvgPoint(entity.point, bounds);
      const size = Math.max(Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 140, 0.8);
      const horizontal = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      horizontal.setAttribute('x1', String(center.x - size));
      horizontal.setAttribute('y1', String(center.y));
      horizontal.setAttribute('x2', String(center.x + size));
      horizontal.setAttribute('y2', String(center.y));
      const vertical = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      vertical.setAttribute('x1', String(center.x));
      vertical.setAttribute('y1', String(center.y - size));
      vertical.setAttribute('x2', String(center.x));
      vertical.setAttribute('y2', String(center.y + size));
      marker.setAttribute('data-point', 'true');
      marker.append(horizontal, vertical);
      return applyEntityAttributes(marker);
    }
    case 'circle': {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      const center = toSvgPoint(entity.center, bounds);
      circle.setAttribute('cx', String(center.x));
      circle.setAttribute('cy', String(center.y));
      circle.setAttribute('r', String(entity.radius));
      return applyEntityAttributes(circle);
    }
    case 'arc': {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', arcPath(entity, bounds));
      return applyEntityAttributes(path);
    }
    case 'ellipse': {
      const node = isFullEllipse(entity) ? renderFullEllipse(entity, bounds) : renderEllipseArc(entity, bounds);
      return applyEntityAttributes(node);
    }
    case 'polyline': {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', polylinePath(entity, bounds));
      if (entity.strokeWidth != null && entity.strokeWidth > 0) {
        path.setAttribute('stroke-width', String(entity.strokeWidth));
      }
      return applyEntityAttributes(path);
    }
    case 'face': {
      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygon.setAttribute(
        'points',
        entity.points
          .map((cadPoint) => {
            const current = toSvgPoint(cadPoint, bounds);
            return `${current.x},${current.y}`;
          })
          .join(' ')
      );
      polygon.setAttribute('fill-opacity', '0.18');
      polygon.setAttribute('stroke-opacity', '0.85');
      applyEntityAttributes(polygon);
      polygon.setAttribute('fill', entity.color ?? DEFAULT_CAD_COLOR);
      return polygon;
    }
    case 'hatch': {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', hatchPath(entity, bounds));
      path.setAttribute('fill-rule', 'evenodd');
      path.setAttribute('clip-rule', 'evenodd');
      path.setAttribute('fill-opacity', entity.solid ? '0.18' : '0.1');
      path.setAttribute('stroke-opacity', '0.85');
      if (entity.patternName) {
        path.setAttribute('data-hatch-pattern', entity.patternName);
      }
      applyEntityAttributes(path);
      path.setAttribute('fill', entity.color ?? DEFAULT_CAD_COLOR);
      return path;
    }
    case 'spline': {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', splinePath(entity, bounds));
      return applyEntityAttributes(path);
    }
    case 'text': {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      const point = toSvgPoint(entity.point, bounds);
      const lines = textLines(entity.value);
      text.setAttribute('x', String(point.x));
      text.setAttribute('y', String(point.y));
      text.setAttribute('stroke', 'none');
      text.setAttribute('font-family', buildCadFontStack(entity.fontFamily));
      text.setAttribute('font-size', String(entity.height));
      text.setAttribute('text-anchor', svgTextAnchor(entity.horizontalAlign));
      text.setAttribute('dominant-baseline', svgDominantBaseline(entity.verticalAlign));
      text.setAttribute('transform', textTransform(entity, point));
      if (entity.obliqueAngle) {
        text.setAttribute('font-style', 'italic');
      }
      if (lines.length > 1) {
        lines.forEach((line, index) => {
          const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
          tspan.setAttribute('x', String(point.x));
          if (index > 0) {
            tspan.setAttribute('dy', String(entity.height * 1.2));
          }
          tspan.textContent = line;
          text.appendChild(tspan);
        });
      } else {
        text.textContent = lines[0] ?? '';
      }
      return applyEntityAttributes(text, 'fill');
    }
    case 'image': {
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const corners = imageBoundaryPoints(entity);
      const svgCorners = corners.map((corner) => toSvgPoint(corner, bounds));
      const [topLeft, topRight, bottomRight, bottomLeft] = svgCorners;
      if (!topLeft || !topRight || !bottomRight || !bottomLeft) {
        return null;
      }
      const browserSource = isBrowserLoadableImageSource(entity.source) ? entity.source : undefined;
      if (browserSource) {
        const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
        image.setAttribute('href', browserSource);
        image.setAttribute('x', '0');
        image.setAttribute('y', '0');
        image.setAttribute('width', String(entity.width));
        image.setAttribute('height', String(entity.height));
        image.setAttribute('preserveAspectRatio', 'none');
        image.setAttribute('transform', imageTransform(entity, bounds));
        if (entity.fade != null) {
          image.setAttribute('opacity', String(Math.max(0, Math.min(1, 1 - entity.fade / 100))));
        }
        if (entity.source) {
          image.setAttribute('data-image-source', entity.source);
        }
        if (entity.imageDefHandle) {
          image.setAttribute('data-image-def', entity.imageDefHandle);
        }
        if (entity.clipBoundary?.length) {
          const clipId = imageClipPathId(entity);
          const clipPath = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
          const clipPolygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          clipPath.setAttribute('id', clipId);
          clipPath.setAttribute('clipPathUnits', 'userSpaceOnUse');
          clipPolygon.setAttribute('points', svgCorners.map((corner) => `${corner.x},${corner.y}`).join(' '));
          clipPath.appendChild(clipPolygon);
          group.appendChild(clipPath);
          image.setAttribute('clip-path', `url(#${clipId})`);
          image.setAttribute('data-image-clipped', 'true');
        }
        group.appendChild(image);
      } else {
        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        polygon.setAttribute('points', svgCorners.map((corner) => `${corner.x},${corner.y}`).join(' '));
        polygon.setAttribute('fill', '#f8fafc');
        polygon.setAttribute('fill-opacity', '0.72');
        polygon.setAttribute('stroke-dasharray', '6 3');
        if (entity.imageDefHandle) {
          polygon.setAttribute('data-image-def', entity.imageDefHandle);
        }
        if (entity.source) {
          polygon.setAttribute('data-image-source', entity.source);
        }
        group.appendChild(applyEntityAttributes(polygon));
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        const center = polygonCentroid(svgCorners);
        label.setAttribute('x', String(center.x));
        label.setAttribute('y', String(center.y));
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('dominant-baseline', 'middle');
        label.setAttribute('font-family', buildCadFontStack(undefined));
        label.setAttribute('font-size', String(Math.max(Math.min(entity.width, entity.height) * 0.12, 2)));
        if (entity.imageDefHandle) {
          label.setAttribute('data-image-def', entity.imageDefHandle);
        }
        if (entity.source) {
          label.setAttribute('data-image-source', entity.source);
        }
        label.textContent = 'IMAGE';
        group.appendChild(applyEntityAttributes(label, 'fill'));
      }
      if (entity.imageDefHandle) {
        group.setAttribute('data-image-def', entity.imageDefHandle);
      }
      if (entity.source) {
        group.setAttribute('data-image-source', entity.source);
      }
      return applyEntityAttributes(group);
    }
    default:
      return null;
  }
}

function renderFullEllipse(entity: CadEllipseEntity, bounds: CadDrawing['bounds']): SVGElement {
  const ellipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
  const center = toSvgPoint(entity.center, bounds);
  const majorRadius = vectorLength(entity.majorAxis);
  const minorRadius = majorRadius * entity.ratio;
  ellipse.setAttribute('cx', String(center.x));
  ellipse.setAttribute('cy', String(center.y));
  ellipse.setAttribute('rx', String(majorRadius));
  ellipse.setAttribute('ry', String(minorRadius));
  ellipse.setAttribute('transform', `rotate(${-vectorAngleDegrees(entity.majorAxis)} ${center.x} ${center.y})`);
  return ellipse;
}

function renderEllipseArc(entity: CadEllipseEntity, bounds: CadDrawing['bounds']): SVGElement {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const points = sampleEllipsePoints(entity);
  const commands = points.map((cadPoint, index) => {
    const current = toSvgPoint(cadPoint, bounds);
    return `${index === 0 ? 'M' : 'L'} ${current.x} ${current.y}`;
  });
  path.setAttribute('d', commands.join(' '));
  return path;
}

function polylinePath(entity: CadPolylineEntity, bounds: CadDrawing['bounds']): string {
  const first = entity.points[0];
  if (!first) {
    return '';
  }
  const commands: string[] = [];
  const svgFirst = toSvgPoint(first, bounds);
  commands.push(`M ${svgFirst.x} ${svgFirst.y}`);
  const segmentCount = entity.closed ? entity.points.length : entity.points.length - 1;
  for (let index = 0; index < segmentCount; index += 1) {
    const start = entity.points[index];
    const end = entity.points[(index + 1) % entity.points.length];
    if (!start || !end) {
      continue;
    }
    const svgEnd = toSvgPoint(end, bounds);
    const bulge = entity.bulges?.[index] ?? 0;
    if (Math.abs(bulge) < 1e-9) {
      commands.push(`L ${svgEnd.x} ${svgEnd.y}`);
      continue;
    }
    const chord = distance(start, end);
    if (chord < 1e-9) {
      continue;
    }
    const sweepAngle = Math.abs(4 * Math.atan(bulge));
    const radius = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
    const largeArc = sweepAngle > Math.PI ? 1 : 0;
    const sweepFlag = bulge > 0 ? 0 : 1;
    commands.push(`A ${radius} ${radius} 0 ${largeArc} ${sweepFlag} ${svgEnd.x} ${svgEnd.y}`);
  }
  if (entity.closed) {
    commands.push('Z');
  }
  return commands.join(' ');
}

function splinePath(entity: CadSplineEntity, bounds: CadDrawing['bounds']): string {
  const points = entity.points.map((cadPoint) => toSvgPoint(cadPoint, bounds));
  if (points.length < 2) {
    return '';
  }
  if (points.length === 2 || entity.degree <= 1) {
    return points.map((cadPoint, index) => `${index === 0 ? 'M' : 'L'} ${cadPoint.x} ${cadPoint.y}`).join(' ');
  }
  const source = entity.closed ? [...points, points[0]!] : points;
  const commands = [`M ${source[0]!.x} ${source[0]!.y}`];
  for (let index = 0; index < source.length - 1; index += 1) {
    const previous = source[index - 1] ?? source[index]!;
    const current = source[index]!;
    const next = source[index + 1]!;
    const afterNext = source[index + 2] ?? next;
    const controlOne = {
      x: current.x + (next.x - previous.x) / 6,
      y: current.y + (next.y - previous.y) / 6
    };
    const controlTwo = {
      x: next.x - (afterNext.x - current.x) / 6,
      y: next.y - (afterNext.y - current.y) / 6
    };
    commands.push(`C ${controlOne.x} ${controlOne.y} ${controlTwo.x} ${controlTwo.y} ${next.x} ${next.y}`);
  }
  if (entity.closed) {
    commands.push('Z');
  }
  return commands.join(' ');
}

function hatchPath(entity: CadHatchEntity, bounds: CadDrawing['bounds']): string {
  return entity.loops
    .map((loop) => {
      const first = loop[0];
      if (!first) {
        return '';
      }
      const commands: string[] = [];
      const svgFirst = toSvgPoint(first, bounds);
      commands.push(`M ${svgFirst.x} ${svgFirst.y}`);
      for (const cadPoint of loop.slice(1)) {
        const current = toSvgPoint(cadPoint, bounds);
        commands.push(`L ${current.x} ${current.y}`);
      }
      commands.push('Z');
      return commands.join(' ');
    })
    .filter(Boolean)
    .join(' ');
}

function arcPath(entity: CadArcEntity, bounds: CadDrawing['bounds']): string {
  const start = pointOnCircle(entity.center, entity.radius, entity.startAngle);
  const end = pointOnCircle(entity.center, entity.radius, entity.endAngle);
  const svgStart = toSvgPoint(start, bounds);
  const svgEnd = toSvgPoint(end, bounds);
  const sweep = normalizeArcSweep(entity.startAngle, entity.endAngle);
  const largeArc = sweep > 180 ? 1 : 0;
  return `M ${svgStart.x} ${svgStart.y} A ${entity.radius} ${entity.radius} 0 ${largeArc} 0 ${svgEnd.x} ${svgEnd.y}`;
}

function constructionLineEndpoints(
  entity: CadConstructionLineEntity,
  bounds: CadDrawing['bounds']
): { start: CadPoint; end: CadPoint } {
  const directionLength = vectorLength(entity.direction);
  const normalized = {
    x: entity.direction.x / directionLength,
    y: entity.direction.y / directionLength
  };
  const extent = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1) * 2;
  return {
    start: entity.ray
      ? entity.point
      : {
          x: entity.point.x - normalized.x * extent,
          y: entity.point.y - normalized.y * extent
        },
    end: {
      x: entity.point.x + normalized.x * extent,
      y: entity.point.y + normalized.y * extent
    }
  };
}

function dimensionPath(entity: CadDimensionPreviewEntity, bounds: CadDrawing['bounds']): string {
  const start = toSvgPoint(entity.start, bounds);
  const end = toSvgPoint(entity.end, bounds);
  const tickLength = Math.max(entity.height * 0.8, distance(entity.start, entity.end) * 0.04, 1);
  const directionLength = distance(entity.start, entity.end) || 1;
  const normal = {
    x: -((end.y - start.y) / directionLength),
    y: (end.x - start.x) / directionLength
  };
  const startTickA = {
    x: start.x + normal.x * tickLength,
    y: start.y + normal.y * tickLength
  };
  const startTickB = {
    x: start.x - normal.x * tickLength,
    y: start.y - normal.y * tickLength
  };
  const endTickA = {
    x: end.x + normal.x * tickLength,
    y: end.y + normal.y * tickLength
  };
  const endTickB = {
    x: end.x - normal.x * tickLength,
    y: end.y - normal.y * tickLength
  };
  return [
    `M ${start.x} ${start.y} L ${end.x} ${end.y}`,
    `M ${startTickA.x} ${startTickA.y} L ${startTickB.x} ${startTickB.y}`,
    `M ${endTickA.x} ${endTickA.y} L ${endTickB.x} ${endTickB.y}`
  ].join(' ');
}

function imageBoundaryPoints(entity: CadImageEntity): CadPoint[] {
  if (entity.clipBoundary?.length) {
    return entity.clipBoundary.map((clipPoint) => imageLocalPointToCad(entity, clipPoint));
  }
  return imageCorners(entity);
}

function imageCorners(entity: CadImageEntity): CadPoint[] {
  return imageClipRectangle({ x: 0, y: 0 }, { x: entity.width, y: entity.height }, entity.width, entity.height).map((clipPoint) =>
    imageLocalPointToCad(entity, clipPoint)
  );
}

function imageLocalPointToCad(entity: CadImageEntity, clipPoint: CadPoint): CadPoint {
  return addPoints(addPoints(entity.point, scaleVector(entity.uVector, clipPoint.x)), scaleVector(entity.vVector, clipPoint.y));
}

function imageClipPathId(entity: CadImageEntity): string {
  const source = entity.imageDefHandle ?? entity.source ?? `${entity.point.x}-${entity.point.y}`;
  return `cadv-image-clip-${source.replace(/[^a-z0-9_-]+/gi, '-')}`;
}

function imageTransform(entity: CadImageEntity, bounds: CadDrawing['bounds']): string {
  const origin = toSvgPoint(entity.point, bounds);
  return [
    'matrix(',
    formatTransformNumber(entity.uVector.x),
    formatTransformNumber(-entity.uVector.y),
    formatTransformNumber(entity.vVector.x),
    formatTransformNumber(-entity.vVector.y),
    formatTransformNumber(origin.x),
    formatTransformNumber(origin.y),
    ')'
  ].join(' ');
}

function normalizeArcSweep(start: number, end: number): number {
  let sweep = end - start;
  while (sweep < 0) sweep += 360;
  while (sweep > 360) sweep -= 360;
  return sweep;
}

function pointOnCircle(center: CadPoint, radius: number, angle: number): CadPoint {
  const radians = (angle * Math.PI) / 180;
  return {
    x: center.x + Math.cos(radians) * radius,
    y: center.y + Math.sin(radians) * radius
  };
}

function samplePolylinePoints(entity: CadPolylineEntity): CadPoint[] {
  const points: CadPoint[] = [];
  const segmentCount = entity.closed ? entity.points.length : entity.points.length - 1;
  for (let index = 0; index < segmentCount; index += 1) {
    const start = entity.points[index];
    const end = entity.points[(index + 1) % entity.points.length];
    if (!start || !end) {
      continue;
    }
    points.push(start);
    const bulge = entity.bulges?.[index] ?? 0;
    if (Math.abs(bulge) >= 1e-9) {
      points.push(...sampleBulgeSegment(start, end, bulge));
    }
  }
  const last = entity.points[entity.points.length - 1];
  if (!entity.closed && last) {
    points.push(last);
  }
  return points;
}

function sampleBulgeSegment(start: CadPoint, end: CadPoint, bulge: number, steps = 24): CadPoint[] {
  const chord = distance(start, end);
  if (chord < 1e-9 || Math.abs(bulge) < 1e-9) {
    return [];
  }
  const radius = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
  const centerOffset = (chord * (1 - bulge * bulge)) / (4 * bulge);
  const midpoint = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2
  };
  const normal = {
    x: -(end.y - start.y) / chord,
    y: (end.x - start.x) / chord
  };
  const center = {
    x: midpoint.x + normal.x * centerOffset,
    y: midpoint.y + normal.y * centerOffset
  };
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const sweep = 4 * Math.atan(bulge);
  const count = Math.max(6, Math.ceil((Math.abs(sweep) / (Math.PI * 2)) * steps));
  const points: CadPoint[] = [];
  for (let index = 1; index < count; index += 1) {
    const angle = startAngle + (sweep * index) / count;
    points.push({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius
    });
  }
  return points;
}

function sampleCircleArcPoints(
  center: CadPoint,
  radius: number,
  startAngle: number,
  endAngle: number,
  counterClockwise: boolean,
  steps = 36
): CadPoint[] {
  let sweep = endAngle - startAngle;
  if (counterClockwise) {
    while (sweep <= 0) sweep += 360;
  } else {
    while (sweep >= 0) sweep -= 360;
  }
  const count = Math.max(6, Math.ceil((Math.abs(sweep) / 360) * steps));
  const points: CadPoint[] = [];
  for (let index = 0; index <= count; index += 1) {
    points.push(pointOnCircle(center, radius, startAngle + (sweep * index) / count));
  }
  return points;
}

function sampleHatchEllipseArcPoints(
  center: CadPoint,
  majorAxis: CadPoint,
  ratio: number,
  startAngle: number,
  endAngle: number,
  counterClockwise: boolean,
  steps = 72
): CadPoint[] {
  let start = (startAngle * Math.PI) / 180;
  let end = (endAngle * Math.PI) / 180;
  let sweep = end - start;
  if (counterClockwise) {
    while (sweep <= 0) sweep += Math.PI * 2;
  } else {
    while (sweep >= 0) sweep -= Math.PI * 2;
  }
  const count = Math.max(8, Math.ceil((Math.abs(sweep) / (Math.PI * 2)) * steps));
  const minorAxis = {
    x: -majorAxis.y * ratio,
    y: majorAxis.x * ratio
  };
  const points: CadPoint[] = [];
  for (let index = 0; index <= count; index += 1) {
    const parameter = start + (sweep * index) / count;
    points.push({
      x: center.x + majorAxis.x * Math.cos(parameter) + minorAxis.x * Math.sin(parameter),
      y: center.y + majorAxis.y * Math.cos(parameter) + minorAxis.y * Math.sin(parameter)
    });
  }
  return points;
}

function sampleSplinePoints(points: CadPoint[], closed: boolean, degree: number, samplesPerSegment = 8): CadPoint[] {
  if (points.length < 2) {
    return [];
  }
  if (points.length === 2 || degree <= 1) {
    return [...points];
  }
  const source = closed ? [...points, points[0]!] : points;
  const sampled: CadPoint[] = [];
  for (let index = 0; index < source.length - 1; index += 1) {
    const previous = source[index - 1] ?? source[index]!;
    const current = source[index]!;
    const next = source[index + 1]!;
    const afterNext = source[index + 2] ?? next;
    for (let step = 0; step < samplesPerSegment; step += 1) {
      const t = step / samplesPerSegment;
      sampled.push(catmullRomPoint(previous, current, next, afterNext, t));
    }
  }
  sampled.push(source[source.length - 1]!);
  return sampled;
}

function catmullRomPoint(previous: CadPoint, current: CadPoint, next: CadPoint, afterNext: CadPoint, t: number): CadPoint {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * (2 * current.x + (-previous.x + next.x) * t + (2 * previous.x - 5 * current.x + 4 * next.x - afterNext.x) * t2 + (-previous.x + 3 * current.x - 3 * next.x + afterNext.x) * t3),
    y: 0.5 * (2 * current.y + (-previous.y + next.y) * t + (2 * previous.y - 5 * current.y + 4 * next.y - afterNext.y) * t2 + (-previous.y + 3 * current.y - 3 * next.y + afterNext.y) * t3)
  };
}

function sampleEllipsePoints(entity: CadEllipseEntity, steps = 72): CadPoint[] {
  const sweep = normalizeEllipseSweep(entity.startParameter, entity.endParameter);
  const count = Math.max(8, Math.ceil((sweep / (Math.PI * 2)) * steps));
  const minorAxis = ellipseMinorAxis(entity);
  const points: CadPoint[] = [];
  for (let index = 0; index <= count; index += 1) {
    const parameter = entity.startParameter + (sweep * index) / count;
    points.push({
      x: entity.center.x + entity.majorAxis.x * Math.cos(parameter) + minorAxis.x * Math.sin(parameter),
      y: entity.center.y + entity.majorAxis.y * Math.cos(parameter) + minorAxis.y * Math.sin(parameter)
    });
  }
  return points;
}

function ellipseMinorAxis(entity: CadEllipseEntity): CadPoint {
  return {
    x: -entity.majorAxis.y * entity.ratio,
    y: entity.majorAxis.x * entity.ratio
  };
}

function isFullEllipse(entity: CadEllipseEntity): boolean {
  return Math.abs(normalizeEllipseSweep(entity.startParameter, entity.endParameter) - Math.PI * 2) < 0.0001;
}

function normalizeEllipseSweep(start: number, end: number): number {
  let sweep = end - start;
  while (sweep < 0) sweep += Math.PI * 2;
  while (sweep > Math.PI * 2) sweep -= Math.PI * 2;
  return sweep || Math.PI * 2;
}

function vectorLength(vector: CadPoint): number {
  return Math.hypot(vector.x, vector.y);
}

function distance(left: CadPoint, right: CadPoint): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function vectorAngleDegrees(vector: CadPoint): number {
  return (Math.atan2(vector.y, vector.x) * 180) / Math.PI;
}

function addPoints(left: CadPoint, right: CadPoint): CadPoint {
  return {
    x: left.x + right.x,
    y: left.y + right.y
  };
}

function scaleVector(vector: CadPoint, scale: number): CadPoint {
  return {
    x: vector.x * scale,
    y: vector.y * scale
  };
}

function midpoint(left: CadPoint, right: CadPoint): CadPoint {
  return {
    x: (left.x + right.x) / 2,
    y: (left.y + right.y) / 2
  };
}

function polygonCentroid(points: CadPoint[]): CadPoint {
  if (!points.length) {
    return { x: 0, y: 0 };
  }
  const total = points.reduce(
    (sum, cadPoint) => ({
      x: sum.x + cadPoint.x,
      y: sum.y + cadPoint.y
    }),
    { x: 0, y: 0 }
  );
  return {
    x: total.x / points.length,
    y: total.y / points.length
  };
}

function toSvgPoint(cadPoint: CadPoint, bounds: CadDrawing['bounds']): CadPoint {
  return {
    x: cadPoint.x - bounds.minX,
    y: bounds.maxY - cadPoint.y
  };
}

function computeBounds(entities: CadEntity[], headerBounds?: CadDrawing['bounds']): CadDrawing['bounds'] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let count = 0;
  const include = (cadPoint: CadPoint) => {
    minX = Math.min(minX, cadPoint.x);
    minY = Math.min(minY, cadPoint.y);
    maxX = Math.max(maxX, cadPoint.x);
    maxY = Math.max(maxY, cadPoint.y);
    count++;
  };
  const includeAll = (points: CadPoint[]) => { for (const cadPoint of points) include(cadPoint); };
  if (headerBounds) {
    include({ x: headerBounds.minX, y: headerBounds.minY });
    include({ x: headerBounds.maxX, y: headerBounds.maxY });
  }
  for (const entity of entities) {
    switch (entity.type) {
      case 'line': include(entity.start); include(entity.end); break;
      case 'construction-line': case 'point': include(entity.point); break;
      case 'dimension': include(entity.start); include(entity.end); includeAll(textBoundsPoints(dimensionTextEntity(entity))); break;
      case 'circle': case 'arc':
        include({ x: entity.center.x - entity.radius, y: entity.center.y - entity.radius });
        include({ x: entity.center.x + entity.radius, y: entity.center.y + entity.radius });
        break;
      case 'ellipse': includeAll(sampleEllipsePoints(entity, 144)); break;
      case 'polyline': includeAll(expandStrokeBounds(samplePolylinePoints(entity), entity.strokeWidth)); break;
      case 'face': case 'spline': includeAll(entity.points); break;
      case 'hatch': for (const loop of entity.loops) includeAll(loop); break;
      case 'text': includeAll(textBoundsPoints(entity)); break;
      case 'image': includeAll(imageBoundaryPoints(entity)); break;
    }
  }
  if (!count) {
    return {
      minX: 0,
      minY: 0,
      maxX: 100,
      maxY: 100
    };
  }
  return { minX, minY, maxX, maxY };
}

function expandStrokeBounds(points: CadPoint[], strokeWidth: number | undefined): CadPoint[] {
  if (!strokeWidth || strokeWidth <= 0) {
    return points;
  }
  const padding = strokeWidth / 2;
  return points.flatMap((cadPoint) => [
    {
      x: cadPoint.x - padding,
      y: cadPoint.y - padding
    },
    {
      x: cadPoint.x + padding,
      y: cadPoint.y + padding
    }
  ]);
}

function parseHorizontalTextAlign(value: number | undefined): CadTextEntity['horizontalAlign'] {
  switch (value) {
    case 1:
    case 4:
      return 'center';
    case 2:
    case 3:
    case 5:
      return 'right';
    default:
      return 'left';
  }
}

function parseVerticalTextAlign(value: number | undefined): CadTextEntity['verticalAlign'] {
  switch (value) {
    case 1:
      return 'bottom';
    case 2:
      return 'middle';
    case 3:
      return 'top';
    default:
      return 'baseline';
  }
}

function parseMtextHorizontalAlign(value: number | undefined): CadTextEntity['horizontalAlign'] {
  switch (value) {
    case 2:
    case 5:
    case 8:
      return 'center';
    case 3:
    case 6:
    case 9:
      return 'right';
    default:
      return 'left';
  }
}

function parseMtextVerticalAlign(value: number | undefined): CadTextEntity['verticalAlign'] {
  switch (value) {
    case 1:
    case 2:
    case 3:
      return 'top';
    case 4:
    case 5:
    case 6:
      return 'middle';
    case 7:
    case 8:
    case 9:
      return 'bottom';
    default:
      return 'top';
  }
}

function mtextDirectionRotation(values: DxfPair[]): number | undefined {
  const direction = point(readNumber(values, 11), readNumber(values, 21));
  return direction && vectorLength(direction) > 1e-9 ? vectorAngleDegrees(direction) : undefined;
}

function svgTextAnchor(align: CadTextEntity['horizontalAlign']): string {
  switch (align) {
    case 'center':
      return 'middle';
    case 'right':
      return 'end';
    default:
      return 'start';
  }
}

function svgDominantBaseline(align: CadTextEntity['verticalAlign']): string {
  switch (align) {
    case 'bottom':
      return 'text-after-edge';
    case 'middle':
      return 'middle';
    case 'top':
      return 'text-before-edge';
    default:
      return 'alphabetic';
  }
}

function textTransform(entity: CadTextEntity, point: CadPoint): string {
  const transforms: string[] = [];
  if (entity.rotation) {
    transforms.push(`rotate(${-entity.rotation} ${point.x} ${point.y})`);
  }
  if (entity.widthFactor !== 1 || entity.obliqueAngle) {
    const skew = entity.obliqueAngle ? ` skewX(${-entity.obliqueAngle})` : '';
    transforms.push(`translate(${point.x} ${point.y}) scale(${entity.widthFactor} 1)${skew} translate(${-point.x} ${-point.y})`);
  }
  return transforms.join(' ');
}

function textLines(value: string): string[] {
  return value.replace(/\\P/g, '\n').split('\n');
}

function textBoundsPoints(entity: CadTextEntity): CadPoint[] {
  const lines = textLines(entity.value);
  const estimatedWidth = Math.max(...lines.map((line) => line.length * entity.height * 0.58 * entity.widthFactor), entity.height);
  const estimatedHeight = entity.height * Math.max(lines.length, 1) * 1.2;
  const left =
    entity.horizontalAlign === 'center'
      ? entity.point.x - estimatedWidth / 2
      : entity.horizontalAlign === 'right'
        ? entity.point.x - estimatedWidth
        : entity.point.x;
  const right =
    entity.horizontalAlign === 'center'
      ? entity.point.x + estimatedWidth / 2
      : entity.horizontalAlign === 'right'
        ? entity.point.x
        : entity.point.x + estimatedWidth;
  const bottom =
    entity.verticalAlign === 'middle'
      ? entity.point.y - estimatedHeight / 2
      : entity.verticalAlign === 'top'
        ? entity.point.y - estimatedHeight
        : entity.point.y;
  const top =
    entity.verticalAlign === 'middle'
      ? entity.point.y + estimatedHeight / 2
      : entity.verticalAlign === 'top'
        ? entity.point.y
        : entity.point.y + estimatedHeight;
  return [
    entity.point,
    { x: left, y: bottom },
    { x: right, y: top }
  ];
}

function dimensionTextEntity(entity: CadDimensionPreviewEntity): CadTextEntity {
  return {
    type: 'text',
    point: entity.textPoint,
    value: entity.text,
    height: entity.height,
    rotation: 0,
    widthFactor: 1,
    obliqueAngle: 0,
    horizontalAlign: 'center',
    verticalAlign: 'middle'
  };
}

function formatDimensionMeasurement(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function normalizeDxfText(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\\P/g, '\n')
    .replace(/\\~/g, ' ')
    .replace(/%%d/gi, '\u00b0')
    .replace(/%%p/gi, '\u00b1')
    .replace(/%%c/gi, '\u00d8')
    .replace(/\\[Ss]([^;]*);/g, (_match, stacked: string) => stacked.replace(/[#$^]/g, '/'))
    .replace(/\\[AaCcFfHhWwQqTt][^;]*;/g, '')
    .replace(/\\[LlOoKk]/g, '')
    .replace(/\\([{}\\])/g, '$1')
    .replace(/[{}]/g, '');
}

function point(x: number | undefined, y: number | undefined): CadPoint | undefined {
  if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) {
    return undefined;
  }
  return { x, y };
}

function entityStyle(values: DxfPair[]): {
  layer?: string;
  colorIndex?: number;
  trueColor?: string;
  opacity?: number;
  entityVisible?: boolean;
  lineType?: string;
  lineTypeScale?: number;
  lineWeight?: number;
} {
  let layer: string | undefined, colorIndex: number | undefined, trueColor: number | undefined;
  let opacity: number | undefined, visible: number | undefined, lineType: string | undefined;
  let lineTypeScale: number | undefined, lineWeight: number | undefined;
  let seen = 0;
  // Common metadata is independent of entity geometry. Read it once rather
  // than scanning the full record separately for every optional property.
  // Preserve the first occurrence, including empty/invalid values.
  for (const pair of values) {
    switch (pair.code) {
      case 8: if (!(seen & 1)) { layer = pair.value.trim() || undefined; seen |= 1; } break;
      case 62: if (!(seen & 2)) { colorIndex = Number(pair.value); seen |= 2; } break;
      case 420: if (!(seen & 4)) { trueColor = Number(pair.value); seen |= 4; } break;
      case 440: if (!(seen & 8)) { opacity = Number(pair.value); seen |= 8; } break;
      case 60: if (!(seen & 16)) { visible = Number(pair.value); seen |= 16; } break;
      case 6: if (!(seen & 32)) { lineType = pair.value.trim() || undefined; seen |= 32; } break;
      case 48: if (!(seen & 64)) { lineTypeScale = Number(pair.value); seen |= 64; } break;
      case 370: if (!(seen & 128)) { lineWeight = Number(pair.value); seen |= 128; } break;
    }
  }
  return {
    layer,
    colorIndex: Number.isFinite(colorIndex) ? colorIndex : undefined,
    trueColor: parseTrueColor(trueColor),
    opacity: transparencyToOpacity(opacity),
    entityVisible: entityVisibility(visible),
    lineType: normalizeLineType(lineType),
    lineTypeScale: normalizeLineTypeScale(lineTypeScale),
    lineWeight: normalizeLineWeight(lineWeight)
  };
}

function normalizeLineType(lineType: string | undefined): string | undefined {
  const normalized = lineType?.trim();
  if (!normalized || /^by(layer|block)$/i.test(normalized) || /^continuous$/i.test(normalized)) {
    return undefined;
  }
  return normalizeLineTypeName(normalized);
}

function normalizeLineTypeName(lineType: string | undefined): string | undefined {
  const normalized = lineType?.trim();
  return normalized ? normalized.toUpperCase() : undefined;
}

function normalizeHandle(handle: string): string {
  return handle.trim().toUpperCase();
}

function normalizeLineWeight(lineWeight: number | undefined): number | undefined {
  if (lineWeight == null || !Number.isFinite(lineWeight) || lineWeight <= 0) {
    return undefined;
  }
  return Math.max(lineWeight / 100, 0.2);
}

function normalizeLineTypeScale(scale: number | undefined): number | undefined {
  if (scale == null || !Number.isFinite(scale) || scale <= 0) {
    return undefined;
  }
  return scale;
}

function lineTypeDashArray(lineType: string | undefined, pattern?: number[], scale = 1): string | undefined {
  const normalizedScale = normalizeLineTypeScale(scale) ?? 1;
  const patternDashArray = lineTypePatternDashArray(pattern, normalizedScale);
  if (patternDashArray) {
    return patternDashArray;
  }
  if (!lineType) {
    return undefined;
  }
  if (/DASHDOT|CENTER/.test(lineType)) {
    return scaleDashArray([8, 3, 1.5, 3], normalizedScale);
  }
  if (/DOT/.test(lineType)) {
    return scaleDashArray([1.5, 3], normalizedScale);
  }
  if (/DASH|HIDDEN|BORDER|PHANTOM/.test(lineType)) {
    return scaleDashArray([7, 4], normalizedScale);
  }
  return undefined;
}

function lineTypePatternDashArray(pattern: number[] | undefined, scale = 1): string | undefined {
  const finitePattern = pattern?.filter((value) => Number.isFinite(value)) ?? [];
  if (!finitePattern.length || !finitePattern.some((value) => Math.abs(value) > 1e-9)) {
    return undefined;
  }
  const maxSegment = Math.max(...finitePattern.map((value) => Math.abs(value)));
  const dotLength = Math.max(maxSegment * 0.1, 0.1);
  return finitePattern
    .map((value) => {
      const length = Math.abs(value) < 1e-9 ? dotLength : Math.abs(value);
      return formatDashLength(length * scale);
    })
    .join(' ');
}

function scaleDashArray(values: number[], scale: number): string {
  return values.map((value) => formatDashLength(value * scale)).join(' ');
}

function formatDashLength(value: number): string {
  return String(Number(value.toFixed(4)));
}

function formatTransformNumber(value: number): string {
  return String(Number(value.toFixed(6)));
}

function dedupeConsecutivePoints(points: CadPoint[]): CadPoint[] {
  return points.filter((cadPoint, index) => {
    const previous = points[index - 1];
    return !samePoint(previous, cadPoint);
  });
}

function samePoint(left: CadPoint | undefined, right: CadPoint | undefined): boolean {
  return Boolean(left && right && Math.abs(left.x - right.x) < 1e-9 && Math.abs(left.y - right.y) < 1e-9);
}

function appendPoint(points: CadPoint[], cadPoint: CadPoint): void {
  if (!samePoint(points[points.length - 1], cadPoint)) {
    points.push(cadPoint);
  }
}

function resolvePolylineVertexWidth(startWidth: number | undefined, endWidth: number | undefined): number | undefined {
  const widths = [startWidth, endWidth].filter((width): width is number => typeof width === 'number' && Number.isFinite(width) && width > 0);
  if (!widths.length) {
    return undefined;
  }
  return widths.reduce((sum, width) => sum + width, 0) / widths.length;
}

function resolvePolylineStrokeWidth(constantWidth: number | undefined, vertexWidths: Array<number | undefined>): number | undefined {
  if (constantWidth != null && Number.isFinite(constantWidth) && constantWidth > 0) {
    return constantWidth;
  }
  const widths = vertexWidths.filter((width): width is number => typeof width === 'number' && Number.isFinite(width) && width > 0);
  if (!widths.length) {
    return undefined;
  }
  return widths.reduce((sum, width) => sum + width, 0) / widths.length;
}

function readPointSeries(values: DxfPair[], xCode: number, yCode: number): CadPoint[] {
  const points: CadPoint[] = [];
  let pendingX: number | undefined;
  for (const pair of values) {
    if (pair.code === xCode) {
      pendingX = Number(pair.value);
      continue;
    }
    if (pair.code === yCode && pendingX != null) {
      const y = Number(pair.value);
      if (Number.isFinite(pendingX) && Number.isFinite(y)) {
        points.push({
          x: pendingX,
          y
        });
      }
      pendingX = undefined;
    }
  }
  return points;
}

function readNumber(values: DxfPair[], code: number): number | undefined {
  for (const pair of values) {
    if (pair.code === code) {
      const value = Number(pair.value);
      return Number.isFinite(value) ? value : undefined;
    }
  }
  return undefined;
}

function readNumbers(values: DxfPair[], code: number): number[] {
  return values
    .filter((pair) => pair.code === code)
    .map((pair) => Number(pair.value))
    .filter((value) => Number.isFinite(value));
}

function readString(values: DxfPair[], code: number): string | undefined {
  const value = values.find((pair) => pair.code === code)?.value.trim();
  return value || undefined;
}

function readImageDefinitionHandle(values: DxfPair[]): string | undefined {
  for (let index = 0; index < values.length; index += 1) {
    const pair = values[index];
    if (pair?.code === 360 || pair?.code === 340) {
      return pair.value;
    }
    if (pair?.code === 1001 && /^ACAD_IMAGE_DICT$/i.test(pair.value)) {
      const handle = values.slice(index + 1).find((candidate) => candidate.code === 360 || candidate.code === 340)?.value;
      if (handle) {
        return handle;
      }
    }
  }
  return undefined;
}

function readLineTypeMap(pairs: DxfPair[]): Map<string, CadLineType> {
  const lineTypes = new Map<string, CadLineType>();
  let inTables = false;
  let inLineTypeTable = false;
  let index = 0;

  while (index < pairs.length) {
    const pair = pairs[index];
    if (pair.code === 0 && pair.value === 'SECTION' && pairs[index + 1]?.code === 2 && pairs[index + 1]?.value === 'TABLES') {
      inTables = true;
      index += 2;
      continue;
    }
    if (inTables && pair.code === 0 && pair.value === 'ENDSEC') {
      inTables = false;
      inLineTypeTable = false;
      index += 1;
      continue;
    }
    if (!inTables) {
      index += 1;
      continue;
    }
    if (pair.code === 0 && pair.value === 'TABLE' && pairs[index + 1]?.code === 2 && pairs[index + 1]?.value === 'LTYPE') {
      inLineTypeTable = true;
      index += 2;
      continue;
    }
    if (inLineTypeTable && pair.code === 0 && pair.value === 'ENDTAB') {
      inLineTypeTable = false;
      index += 1;
      continue;
    }
    if (!inLineTypeTable || pair.code !== 0 || pair.value !== 'LTYPE') {
      index += 1;
      continue;
    }

    const values: DxfPair[] = [];
    index += 1;
    while (index < pairs.length && pairs[index]?.code !== 0) {
      values.push(pairs[index]!);
      index += 1;
    }
    const lineType = parseLineType(values);
    const key = normalizeLineTypeName(lineType?.name);
    if (lineType && key) {
      lineTypes.set(key, lineType);
    }
  }

  return lineTypes;
}

function parseLineType(values: DxfPair[]): CadLineType | undefined {
  const name = readString(values, 2);
  if (!name) {
    return undefined;
  }
  const pattern = readNumbers(values, 49);
  return {
    name: normalizeLineTypeName(name) ?? name,
    description: readString(values, 3),
    pattern,
    dashArray: lineTypePatternDashArray(pattern)
  };
}

function readImageDefinitionMap(pairs: DxfPair[]): Map<string, CadImageDefinition> {
  const imageDefinitions = new Map<string, CadImageDefinition>();
  let inObjects = false;
  let index = 0;

  while (index < pairs.length) {
    const pair = pairs[index];
    if (pair.code === 0 && pair.value === 'SECTION' && pairs[index + 1]?.code === 2 && pairs[index + 1]?.value === 'OBJECTS') {
      inObjects = true;
      index += 2;
      continue;
    }
    if (inObjects && pair.code === 0 && pair.value === 'ENDSEC') {
      inObjects = false;
      index += 1;
      continue;
    }
    if (!inObjects || pair.code !== 0 || pair.value !== 'IMAGEDEF') {
      index += 1;
      continue;
    }

    const values: DxfPair[] = [];
    index += 1;
    while (index < pairs.length && pairs[index]?.code !== 0) {
      values.push(pairs[index]!);
      index += 1;
    }
    const imageDefinition = parseImageDefinition(values);
    if (imageDefinition) {
      imageDefinitions.set(normalizeHandle(imageDefinition.handle), imageDefinition);
    }
  }

  return imageDefinitions;
}

function parseImageDefinition(values: DxfPair[]): CadImageDefinition | undefined {
  const handle = readString(values, 5);
  if (!handle) {
    return undefined;
  }
  return {
    handle,
    source: readString(values, 1),
    width: readNumber(values, 10),
    height: readNumber(values, 20)
  };
}

function readLayerMap(pairs: DxfPair[], lineTypeMap: Map<string, CadLineType>): Map<string, CadLayer> {
  const layers = new Map<string, CadLayer>();
  let inTables = false;
  let inLayerTable = false;
  let index = 0;

  while (index < pairs.length) {
    const pair = pairs[index];
    if (pair.code === 0 && pair.value === 'SECTION' && pairs[index + 1]?.code === 2 && pairs[index + 1]?.value === 'TABLES') {
      inTables = true;
      index += 2;
      continue;
    }
    if (inTables && pair.code === 0 && pair.value === 'ENDSEC') {
      inTables = false;
      inLayerTable = false;
      index += 1;
      continue;
    }
    if (!inTables) {
      index += 1;
      continue;
    }
    if (pair.code === 0 && pair.value === 'TABLE' && pairs[index + 1]?.code === 2 && pairs[index + 1]?.value === 'LAYER') {
      inLayerTable = true;
      index += 2;
      continue;
    }
    if (inLayerTable && pair.code === 0 && pair.value === 'ENDTAB') {
      inLayerTable = false;
      index += 1;
      continue;
    }
    if (!inLayerTable || pair.code !== 0 || pair.value !== 'LAYER') {
      index += 1;
      continue;
    }

    const values: DxfPair[] = [];
    index += 1;
    while (index < pairs.length && pairs[index]?.code !== 0) {
      values.push(pairs[index]!);
      index += 1;
    }
    const layer = parseLayer(values, lineTypeMap);
    if (layer) {
      layers.set(normalizeLayerName(layer.name), layer);
    }
  }

  return layers;
}

function parseLayer(values: DxfPair[], lineTypeMap: Map<string, CadLineType>): CadLayer | undefined {
  const name = readString(values, 2);
  if (!name) {
    return undefined;
  }
  const rawColorIndex = readNumber(values, 62);
  const colorIndex = rawColorIndex == null ? undefined : Math.abs(rawColorIndex);
  const lineType = normalizeLineType(readString(values, 6));
  const lineTypePattern = lineType ? lineTypeMap.get(lineType)?.pattern : undefined;
  const trueColor = parseTrueColor(readNumber(values, 420));
  const flags = readNumber(values, 70) ?? 0;
  const frozen = Boolean(flags & 1);
  const locked = Boolean(flags & 4);
  return {
    name,
    colorIndex,
    trueColor,
    color: trueColor ?? aciToHex(colorIndex),
    opacity: transparencyToOpacity(readNumber(values, 440)),
    lineType,
    lineTypePattern,
    lineWeight: normalizeLineWeight(readNumber(values, 370)),
    frozen,
    locked,
    visible: (rawColorIndex == null ? true : rawColorIndex >= 0) && !frozen
  };
}

function drawingLayersToState(drawing: CadDrawing): NonNullable<CadPreviewState['layers']> {
  const styledLayers = new Map(drawing.layerStyles.map((layer) => [normalizeLayerName(layer.name), layer]));
  return drawing.layers.map((name) => {
    const style = styledLayers.get(normalizeLayerName(name));
    return {
      id: name,
      name,
      color: style?.color,
      visible: style?.visible ?? true
    };
  });
}

function resolveEntityStyles(
  entities: CadEntity[],
  layerMap: Map<string, CadLayer>,
  lineTypeMap: Map<string, CadLineType>,
  globalLineTypeScale = 1
): CadEntity[] {
  for (const entity of entities) {
    const layer = entity.layer ? layerMap.get(normalizeLayerName(entity.layer)) : undefined;
    const explicitColor = entity.trueColor ?? aciToHex(entity.colorIndex);
    const lineType = entity.lineType ?? layer?.lineType;
    const lineTypePattern = entity.lineTypePattern ?? resolveLineTypePattern(lineType, lineTypeMap) ?? layer?.lineTypePattern;
    const lineTypeScale = resolveLineTypeScale(entity.lineTypeScale, globalLineTypeScale);
    entity.lineType = lineType;
    entity.lineTypePattern = lineTypePattern;
    entity.lineTypeScale = lineTypeScale;
    entity.lineWeight ??= layer?.lineWeight;
    entity.trueColor ??= layer?.trueColor;
    entity.opacity ??= layer?.opacity;
    entity.color = explicitColor ?? layer?.color ?? DEFAULT_CAD_COLOR;
    entity.visible = (entity.entityVisible ?? true) && (layer?.visible ?? true);
  }
  return entities;
}

function resolveLineTypeScale(entityLineTypeScale: number | undefined, globalLineTypeScale: number | undefined): number | undefined {
  const entityScale = normalizeLineTypeScale(entityLineTypeScale) ?? 1;
  const globalScale = normalizeLineTypeScale(globalLineTypeScale) ?? 1;
  const resolved = entityScale * globalScale;
  return Math.abs(resolved - 1) < 1e-9 ? undefined : resolved;
}

function resolveLineTypePattern(lineType: string | undefined, lineTypeMap: Map<string, CadLineType>): number[] | undefined {
  const key = normalizeLineTypeName(lineType);
  return key ? lineTypeMap.get(key)?.pattern : undefined;
}

function aciToHex(colorIndex: number | undefined): string | undefined {
  if (colorIndex == null) {
    return undefined;
  }
  const normalized = Math.abs(colorIndex);
  if (normalized === 0 || normalized === 256) {
    return undefined;
  }
  const colors: Record<number, string> = {
    1: '#ff0000',
    2: '#ffff00',
    3: '#00ff00',
    4: '#00ffff',
    5: '#0000ff',
    6: '#ff00ff',
    7: DEFAULT_CAD_COLOR,
    8: '#808080',
    9: '#c0c0c0'
  };
  return colors[normalized] ?? undefined;
}

function parseTrueColor(value: number | undefined): string | undefined {
  if (value == null || !Number.isFinite(value)) {
    return undefined;
  }
  const normalized = Math.trunc(value) & 0xffffff;
  const red = (normalized >> 16) & 0xff;
  const green = (normalized >> 8) & 0xff;
  const blue = normalized & 0xff;
  return `#${hexByte(red)}${hexByte(green)}${hexByte(blue)}`;
}

function hexByte(value: number): string {
  return value.toString(16).padStart(2, '0');
}

function transparencyToOpacity(value: number | undefined): number | undefined {
  if (value == null || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  const normalized = Math.trunc(value);
  if (normalized <= 90) {
    return Number(Math.max(0, Math.min(1, 1 - normalized / 100)).toFixed(3));
  }
  if ((normalized & 0x02000000) === 0x02000000) {
    return Number(Math.max(0, Math.min(1, (normalized & 0xff) / 255)).toFixed(3));
  }
  return undefined;
}

function entityVisibility(value: number | undefined): boolean | undefined {
  if (value == null || !Number.isFinite(value)) {
    return undefined;
  }
  return value === 1 ? false : true;
}

function uniqueSorted(values: string[]): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    const name = value.trim();
    if (name) unique.add(name);
  }
  return [...unique].sort();
}

function normalizeLayerName(name: string): string {
  return name.trim().toLowerCase();
}

function normalizeBlockName(name: string): string {
  return name.trim().toLowerCase();
}

function uniqueWarnings(warnings: string[]): string[] {
  return [...new Set(warnings)];
}

function readTextStyleMap(pairs: DxfPair[]): Map<string, CadTextStyle> {
  const styles = new Map<string, CadTextStyle>();
  let inTables = false;
  let inStyleTable = false;
  let index = 0;

  while (index < pairs.length) {
    const pair = pairs[index];
    if (pair.code === 0 && pair.value === 'SECTION' && pairs[index + 1]?.code === 2 && pairs[index + 1]?.value === 'TABLES') {
      inTables = true;
      index += 2;
      continue;
    }
    if (inTables && pair.code === 0 && pair.value === 'ENDSEC') {
      inTables = false;
      inStyleTable = false;
      index += 1;
      continue;
    }
    if (!inTables) {
      index += 1;
      continue;
    }
    if (pair.code === 0 && pair.value === 'TABLE' && pairs[index + 1]?.code === 2 && pairs[index + 1]?.value === 'STYLE') {
      inStyleTable = true;
      index += 2;
      continue;
    }
    if (inStyleTable && pair.code === 0 && pair.value === 'ENDTAB') {
      inStyleTable = false;
      index += 1;
      continue;
    }
    if (!inStyleTable || pair.code !== 0 || pair.value !== 'STYLE') {
      index += 1;
      continue;
    }

    const values: DxfPair[] = [];
    index += 1;
    while (index < pairs.length && pairs[index]?.code !== 0) {
      values.push(pairs[index]!);
      index += 1;
    }
    const style = parseTextStyle(values);
    if (style) {
      styles.set(normalizeTextStyleName(style.name), style);
    }
  }

  return styles;
}

function parseTextStyle(values: DxfPair[]): CadTextStyle | undefined {
  const name = readString(values, 2);
  if (!name) {
    return undefined;
  }
  const fontFile = readString(values, 3);
  const bigFontFile = readString(values, 4);
  return {
    name,
    fontFile,
    bigFontFile,
    fontFamily: fontFile && !isShxFont(fontFile) ? fontFileToFamily(fontFile) : undefined
  };
}

async function applyCadResourceResolver(
  drawing: CadDrawing,
  resourceResolver: PreviewResourceResolver | undefined,
  sourceFormat: string,
  resourceUrls: Set<string>,
  signal?: AbortSignal
): Promise<CadDrawing> {
  if (!resourceResolver) {
    return drawing;
  }

  const resolverWarnings = new Set<string>();
  const entities: CadEntity[] = [];
  for (const entity of drawing.entities) {
    checkCadAborted(signal);
    if (entity.type !== 'image' || !entity.source || isBrowserLoadableImageSource(entity.source)) {
      entities.push(entity);
      continue;
    }
    const unresolvedSource = entity.source;

    const result = await resourceResolver({
      family: 'cad',
      sourceFormat,
      source: unresolvedSource,
      relation: 'image',
      handle: entity.imageDefHandle,
      name: unresolvedSource.split(/[\\/]/).pop() ?? unresolvedSource
    });
    checkCadAborted(signal);
    const resolved = normalizeResourceResolverResult(result, resourceUrls);
    for (const warning of resolved.warnings) {
      resolverWarnings.add(warning);
    }
    entities.push({
      ...entity,
      source: resolved.source ?? entity.source
    });
  }

  const textStyleMap = new Map(drawing.textStyles.map((style) => [normalizeTextStyleName(style.name), style]));
  return {
    ...drawing,
    entities,
    warnings: [...collectDrawingWarnings(entities, textStyleMap), ...resolverWarnings]
  };
}

function normalizeResourceResolverResult(
  result: Awaited<ReturnType<PreviewResourceResolver>>,
  resourceUrls: Set<string>
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
  if (result instanceof Blob || ArrayBuffer.isView(result) || result instanceof ArrayBuffer) {
    return {
      source: normalizeResolvedPreviewSource(result, resourceUrls),
      warnings: []
    };
  }
  return {
    source: normalizeResolvedPreviewSource(result.source, resourceUrls),
    warnings: result.warnings ?? []
  };
}

function normalizeResolvedPreviewSource(source: PreviewSource | undefined, resourceUrls: Set<string>): string | undefined {
  if (!source) {
    return undefined;
  }
  if (typeof source === 'string') {
    return source;
  }
  if (source instanceof Blob) {
    const url = URL.createObjectURL(source);
    resourceUrls.add(url);
    return url;
  }
  if (ArrayBuffer.isView(source)) {
    const bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    return normalizeResolvedPreviewSource(new Blob([new Uint8Array(bytes)]), resourceUrls);
  }
  if (source instanceof ArrayBuffer) {
    return normalizeResolvedPreviewSource(new Blob([source]), resourceUrls);
  }
  return undefined;
}

function checkCadAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('CAD preview aborted.', 'AbortError');
}

function collectCadFontReferences(original: CadDrawing, resolved: CadDrawing): PreviewFontReference[] {
  const references: PreviewFontReference[] = [];
  const usedStyles = new Set<string>();
  for (const [index, entity] of original.entities.entries()) {
    if (entity.type !== 'text') continue;
    if (entity.styleName) usedStyles.add(normalizeTextStyleName(entity.styleName));
    const mapped = resolved.entities[index];
    const provided = mapped !== entity && mapped.type === 'text';
    references.push({
      fontFamily: entity.fontFamily, fontFile: entity.fontFile, styleName: entity.styleName,
      resolvedFontFamily: provided ? mapped.fontFamily : undefined,
      source: provided ? 'application' : undefined
    });
  }
  for (const style of original.textStyles) {
    if (!usedStyles.has(normalizeTextStyleName(style.name))) {
      references.push({ fontFamily: style.fontFamily, fontFile: style.fontFile, styleName: style.name });
    }
    if (style.bigFontFile) references.push({ fontFile: style.bigFontFile, styleName: style.name });
  }
  return references;
}

function applyCadFontResolver(drawing: CadDrawing, fontResolver: PreviewFontResolver | undefined, sourceFormat: string): CadDrawing {
  if (!fontResolver) {
    return drawing;
  }

  const resolverWarnings = new Set<string>();
  const resolvedFontFiles = new Set<string>();
  const entities = drawing.entities.map((entity) => {
    if (entity.type !== 'text') {
      return entity;
    }
    const resolved = normalizeFontResolverResult(
      fontResolver({
        family: 'cad',
        sourceFormat,
        fontFamily: entity.fontFamily,
        fontFile: entity.fontFile,
        styleName: entity.styleName,
        text: entity.value
      })
    );
    for (const warning of resolved.warnings) {
      resolverWarnings.add(warning);
    }
    if (!resolved.fontFamily) {
      return entity;
    }
    if (entity.fontFile) {
      resolvedFontFiles.add(entity.fontFile);
    }
    return {
      ...entity,
      fontFamily: resolved.fontFamily
    };
  });

  const textStyleMap = new Map(drawing.textStyles.map((style) => [normalizeTextStyleName(style.name), style]));
  return {
    ...drawing,
    entities,
    warnings: [...collectDrawingWarnings(entities, textStyleMap, resolvedFontFiles), ...resolverWarnings]
  };
}

function normalizeFontResolverResult(
  result: ReturnType<PreviewFontResolver>
): { fontFamily?: string; warnings: string[] } {
  if (!result) {
    return { warnings: [] };
  }
  if (typeof result === 'string') {
    return {
      fontFamily: result,
      warnings: []
    };
  }
  return {
    fontFamily: result.fontFamily,
    warnings: result.warnings ?? []
  };
}

function collectDrawingWarnings(entities: CadEntity[], textStyles: Map<string, CadTextStyle>, resolvedFontFiles = new Set<string>()): string[] {
  const warnings = new Set<string>();
  const usedTextEntities = entities.filter((entity): entity is CadTextEntity => entity.type === 'text');
  const usedImageEntities = entities.filter((entity): entity is CadImageEntity => entity.type === 'image');
  const shxFonts = new Set<string>();

  for (const style of textStyles.values()) {
    if (style.fontFile && isShxFont(style.fontFile) && !resolvedFontFiles.has(style.fontFile)) {
      shxFonts.add(style.fontFile);
    }
    if (style.bigFontFile && isShxFont(style.bigFontFile) && !resolvedFontFiles.has(style.bigFontFile)) {
      shxFonts.add(style.bigFontFile);
    }
  }

  for (const entity of usedTextEntities) {
    if (entity.styleName && !textStyles.has(normalizeTextStyleName(entity.styleName))) {
      warnings.add(`DXF text style "${entity.styleName}" was referenced but not found; browser fallback fonts are used.`);
    }
  }

  if (shxFonts.size) {
    warnings.add(`DXF references SHX font files (${[...shxFonts].sort().join(', ')}), which browsers cannot render directly; CSS fallback fonts are used.`);
  }

  for (const entity of usedImageEntities) {
    if (!entity.source) {
      warnings.add(
        entity.imageDefHandle
          ? `DXF IMAGE references IMAGEDEF "${entity.imageDefHandle}" but no image path was found; placeholder is shown.`
          : 'DXF IMAGE is missing an IMAGEDEF reference; placeholder is shown.'
      );
      continue;
    }
    if (!isBrowserLoadableImageSource(entity.source)) {
      warnings.add(`DXF IMAGE source "${entity.source}" requires an application resource resolver; placeholder is shown.`);
    }
  }

  return [...warnings];
}

function buildCadFontStack(fontFamily: string | undefined): string {
  const fallback = 'system-ui, sans-serif';
  if (!fontFamily) {
    return fallback;
  }
  return `"${fontFamily.replace(/"/g, '')}", ${fallback}`;
}

function fontFileToFamily(fontFile: string): string {
  const fileName = fontFile.split(/[\\/]/).pop() ?? fontFile;
  return fileName.replace(/\.(ttf|otf|ttc|woff2?|fon)$/i, '').replace(/[_-]+/g, ' ').trim() || fileName;
}

function isShxFont(fontFile: string): boolean {
  return /\.shx$/i.test(fontFile.trim());
}

function isBrowserLoadableImageSource(source: string | undefined): boolean {
  return Boolean(source && /^(data:image\/|blob:|https?:\/\/)/i.test(source.trim()));
}

function normalizeTextStyleName(name: string): string {
  return name.trim().toLowerCase();
}

async function sourceToText(source: PreviewSource, context: PreviewLoadContext): Promise<string> {
  if (typeof source === 'string') {
    if (source.trimStart().toLowerCase().startsWith('data:')) {
      return dataUrlToText(source);
    }
    const response = await fetch(source, { signal: context.signal });
    if (!response.ok) {
      throw new Error(`Failed to load CAD source: ${response.status} ${response.statusText}`.trim());
    }
    return response.text();
  }
  if (source instanceof Blob) {
    return source.text();
  }
  if (ArrayBuffer.isView(source)) {
    return new TextDecoder().decode(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
  }
  if (source instanceof ArrayBuffer) {
    return new TextDecoder().decode(source);
  }
  return String(source);
}

function dataUrlToText(dataUrl: string): string {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) {
    return dataUrl;
  }
  const meta = dataUrl.slice(0, commaIndex).toLowerCase();
  const payload = dataUrl.slice(commaIndex + 1);
  if (meta.includes(';base64')) {
    const binary = atob(payload);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  return decodeURIComponent(payload);
}

function normalizeFormat(format: string | undefined): string {
  return String(format ?? '').trim().replace(/^\./, '').toLowerCase();
}
