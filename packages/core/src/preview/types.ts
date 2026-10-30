export type PreviewSource = string | ArrayBuffer | Uint8Array | Blob | File;

export type PreviewFamily =
  | 'paged'
  | 'flow'
  | 'workbook'
  | 'html'
  | 'image'
  | 'panorama'
  | 'video'
  | 'panorama-video'
  | 'audio'
  | 'ebook'
  | 'code'
  | 'text'
  | 'archive'
  | 'cad'
  | 'model3d'
  | 'mindmap'
  | 'diagram'
  | 'unsupported';

export type PreviewFitMode = 'contain' | 'width' | 'height' | 'none';

export interface SourceDescriptor {
  source: PreviewSource;
  /** Password to open this document. Kept in memory for this load only. */
  password?: string;
  name?: string;
  extension?: string;
  contentType?: string;
  size?: number;
}

export interface PreviewLoadContext {
  descriptor: SourceDescriptor;
  route?: FormatRoute;
  signal?: AbortSignal;
}

export interface PreviewFontResolveRequest {
  family?: PreviewFamily;
  sourceFormat?: string;
  fontFamily?: string;
  fontFile?: string;
  styleName?: string;
  text?: string;
  fontStyle?: 'normal' | 'italic' | 'oblique';
}

export interface PreviewFontResolveResult {
  fontFamily?: string;
  warnings?: string[];
  /** Optional host-managed font files, loaded only when fontLoading is enabled. */
  assets?: readonly PreviewFontAsset[];
}

export type PreviewFontResolver = (
  request: PreviewFontResolveRequest
) => string | PreviewFontResolveResult | null | undefined;

export type PreviewFontSource = 'embedded' | 'application' | 'environment' | 'fallback' | 'unknown';
export type PreviewFontStatus = 'available' | 'missing' | 'substituted' | 'unsupported' | 'unknown';

export interface PreviewFontTraits {
  serif?: boolean;
  monospace?: boolean;
  style?: 'text' | 'handwriting' | 'decorative' | 'symbol';
  script?: 'latin' | 'cjk-sc' | 'cjk-tc' | 'japanese' | 'korean' | 'emoji';
  /** Ten-byte PANOSE descriptor as twenty hexadecimal characters. */
  panose?: string;
  /** CSS weight (1–1000) and stretch percentage, when known. */
  weight?: number;
  stretch?: number;
  /** Average advance width in em units, when provided by the font. */
  averageWidth?: number;
}

export interface PreviewFontCandidate {
  fontFamily: string;
  traits?: PreviewFontTraits;
  /** Inclusive Unicode cmap ranges; absent means coverage is unknown. */
  coverage?: ReadonlyArray<readonly [number, number]>;
}

export interface PreviewFontAssetSource {
  url: string;
  /** Lower values are preferred before measured latency. Same-origin wins ties. */
  priority?: number;
  credentials?: RequestCredentials;
  headers?: Record<string, string>;
}

export interface PreviewFontAsset extends PreviewFontCandidate {
  id: string;
  sources?: readonly PreviewFontAssetSource[];
  data?: ArrayBuffer | Uint8Array;
  descriptors?: FontFaceDescriptors;
}

export interface PreviewFontPack {
  id: string;
  version: string;
  license?: string;
  fonts: readonly PreviewFontAsset[];
}

export interface PreviewFontLoadingOptions {
  /** Omit to use the built-in optional webfont packs. [] enables host assets only. */
  packs?: readonly PreviewFontPack[];
  concurrency?: number;
  timeoutMs?: number;
  /** Start one alternate mirror when the preferred route is still pending. */
  hedgeDelayMs?: number;
  budgetMs?: number;
  maxAttempts?: number;
  backoffMs?: number;
  maxBackoffMs?: number;
  maxFontBytes?: number;
  /** Prefer an already available substitute over an equally ranked download. */
  preferLocal?: boolean;
}

export interface PreviewFontRefresh {
  references: PreviewFontReference[];
  loaded: PreviewFontCandidate[];
  warnings: string[];
  relayout?: boolean;
}

export interface PreviewFontClassification extends PreviewFontTraits {
  evidence: 'metadata' | 'known' | 'name' | 'unknown';
}

export interface PreviewFontReference {
  fontFamily?: string;
  fontFile?: string;
  styleName?: string;
  resolvedFontFamily?: string;
  /** Origin of an active font supplied by the driver or host, when known. */
  source?: PreviewFontSource;
  /** The original font format cannot be used directly by the browser (e.g. SHX). */
  browserUnsupported?: boolean;
  traits?: PreviewFontTraits;
  /** Declaration only; does not establish that an embedded font has loaded. */
  embedded?: boolean;
  /** Optional local matching sample; excluded from diagnostic output. */
  text?: string;
  fontStyle?: 'normal' | 'italic' | 'oblique';
}

export interface PreviewFontDiagnostic {
  /** Renderer font identifier, when original family names are unavailable (e.g. PDF.js). */
  fontId?: string;
  fontFamily?: string;
  fontFile?: string;
  styleName?: string;
  resolvedFontFamily?: string;
  status: PreviewFontStatus;
  source: PreviewFontSource;
  classification?: PreviewFontClassification;
  substitutionReason?: string;
  /** Relative candidate-ranking score; not a confidence percentage. */
  matchScore?: number;
  /** Candidate cmap covers the local sample; not a whole-document shaping guarantee. */
  coverage?: 'matched' | 'unknown';
  embedded?: boolean;
}

export interface PreviewResourceResolveRequest {
  family?: PreviewFamily;
  sourceFormat?: string;
  source?: string;
  relation?: string;
  handle?: string;
  name?: string;
}

export interface PreviewResourceResolveResult {
  source?: PreviewSource;
  warnings?: string[];
}

export type PreviewResourceResolver = (
  request: PreviewResourceResolveRequest
) => PreviewSource | PreviewResourceResolveResult | null | undefined | Promise<PreviewSource | PreviewResourceResolveResult | null | undefined>;

export type PreviewerFactory = (host: HTMLElement, options?: PreviewOptions) => PreviewerInstance;

export interface AudioPreviewOptions {
  title?: string;
  artist?: string;
  album?: string;
  /** Explicit artwork takes precedence over embedded/companion artwork. */
  cover?: PreviewSource;
  /** LRC content, including optional ti/ar/al/offset tags. */
  lyrics?: string;
}

export interface PreviewOptions {
  /** Return null to cancel. Called again when the supplied password is incorrect. */
  requestPassword?: (request: PreviewPasswordRequest) => string | null | Promise<string | null>;
  fit?: PreviewFitMode;
  initialScale?: number;
  minScale?: number;
  maxScale?: number;
  virtual?: boolean;
  fontResolver?: PreviewFontResolver;
  /** Opt-in background webfont loading, adaptive mirror routing and font-ready relayout. */
  fontLoading?: boolean | PreviewFontLoadingOptions;
  resourceResolver?: PreviewResourceResolver;
  audio?: AudioPreviewOptions;
  previewerFactory?: PreviewerFactory;
}

export interface PreviewPasswordRequest {
  name?: string;
  reason: 'password_required' | 'password_invalid';
  attempt: number;
  signal?: AbortSignal;
}

export interface PreviewCapabilities {
  search?: boolean;
  zoom?: boolean;
  fit?: boolean;
  paged?: boolean;
  thumbnails?: boolean;
  workbook?: boolean;
  pan?: boolean;
  rotate?: boolean;
  fullscreen?: boolean;
  playback?: boolean;
  playlist?: boolean;
  timeline?: boolean;
  volume?: boolean;
  subtitles?: boolean;
  chapters?: boolean;
  sheets?: boolean;
  outline?: boolean;
  codeHighlight?: boolean;
  lineNumbers?: boolean;
  wordWrap?: boolean;
  minimap?: boolean;
  archiveBrowse?: boolean;
  layers?: boolean;
  measure?: boolean;
  section?: boolean;
  orbit?: boolean;
  explode?: boolean;
  modelTree?: boolean;
  metadata?: boolean;
  materialFilter?: boolean;
  displayMode?: boolean;
  print?: boolean;
  download?: boolean;
}

export type PreviewDisplayMode = 'shaded' | 'solid-edge' | 'wireframe' | 'xray';
export type PreviewSnapshotBackground = 'scene' | 'white' | 'transparent';

export interface PreviewItemState {
  loading: boolean;
  error: string | null;
  title?: string;
  family: PreviewFamily;
  warnings: string[];
  /** A best-effort snapshot for fonts discovered by this driver; absent means uninspected. */
  fonts?: PreviewFontDiagnostic[];
  capabilities: PreviewCapabilities;
}

export interface PagedPreviewState extends PreviewItemState {
  family: 'paged';
  pageIndex: number;
  pageCount: number;
  scale: number;
  fit: PreviewFitMode;
}

export interface FlowPreviewState extends PreviewItemState {
  family: 'flow';
  scale?: number;
  scrollTop?: number;
}

export interface WorkbookPreviewState extends PreviewItemState {
  family: 'workbook';
  activeSheetIndex: number;
  sheets: Array<{ id: string; name: string }>;
  scale?: number;
}

export interface ImagePreviewState extends PreviewItemState {
  family: 'image' | 'panorama';
  scale: number;
  rotation: number;
  panX: number;
  panY: number;
  naturalWidth?: number;
  naturalHeight?: number;
}

export interface MediaPreviewState extends PreviewItemState {
  family: 'video' | 'panorama-video' | 'audio';
  duration?: number;
  currentTime: number;
  paused: boolean;
  muted: boolean;
  volume: number;
}

export interface EbookPreviewState extends PreviewItemState {
  family: 'ebook';
  location?: string;
  progress?: number;
  chapterTitle?: string;
  chapterIndex: number;
  chapterCount: number;
  chapters: Array<{ id: string; title: string }>;
}

export interface TextPreviewState extends PreviewItemState {
  family: 'text' | 'code';
  language?: string;
  encoding?: string;
  lineCount?: number;
  wrap: boolean;
}

export interface ArchivePreviewState extends PreviewItemState {
  family: 'archive';
  route: string;
  entries: Array<{ name: string; type: 'file' | 'directory'; size?: number; modified?: number }>;
}

export interface PreviewLayerInfo {
  id: string;
  name: string;
  color?: string;
  visible: boolean;
}

export interface PreviewMeasurementInfo {
  active: boolean;
  status: 'idle' | 'pick-start' | 'pick-end' | 'complete';
  snapMode?: 'surface' | 'vertex';
  axisLock?: 'free' | 'x' | 'y' | 'z';
  start?: [number, number, number];
  end?: [number, number, number];
  delta?: [number, number, number];
  distance?: number;
  previewPoint?: [number, number, number];
  previewDelta?: [number, number, number];
  previewDistance?: number;
}

export interface PreviewSectionInfo {
  active: boolean;
  mode?: 'single' | 'box';
  axis: 'x' | 'y' | 'z';
  offset: number;
  min: number;
  max: number;
  bounds?: {
    x: [number, number];
    y: [number, number];
    z: [number, number];
  };
  range?: {
    x: [number, number];
    y: [number, number];
    z: [number, number];
  };
}

export interface PreviewMaterialInfo {
  key: string;
  name?: string;
  type: string;
  color?: string;
  emissiveColor?: string;
  opacity?: number;
  alphaTest?: number;
  transparent?: boolean;
  wireframe?: boolean;
  vertexColors?: boolean;
  flatShading?: boolean;
  depthWrite?: boolean;
  depthTest?: boolean;
  side?: 'front' | 'back' | 'double';
  roughness?: number;
  metalness?: number;
  shininess?: number;
  size?: number;
  mapKinds?: string[];
}

export interface Model3dPreviewNode {
  id: string;
  label: string;
  kind: 'group' | 'mesh' | 'lines' | 'points' | 'bone' | 'light' | 'camera' | 'object';
  visible: boolean;
  metadata?: {
    meshCount?: number;
    lineCount?: number;
    pointCount?: number;
    materialCount?: number;
    materialNames?: string[];
    materialDetails?: PreviewMaterialInfo[];
    triangleCount?: number;
    vertexCount?: number;
    hasVertexColors?: boolean;
    bounds?: {
      min: [number, number, number];
      max: [number, number, number];
      size: [number, number, number];
    };
  };
  children: Model3dPreviewNode[];
}

export interface CadPreviewState extends PreviewItemState {
  family: 'cad';
  scale: number;
  pageIndex?: number;
  pageCount?: number;
  layers?: PreviewLayerInfo[];
  activeLayerIds?: string[];
}

export interface Model3dPreviewState extends PreviewItemState {
  family: 'model3d';
  scale: number;
  explode?: number;
  displayMode?: PreviewDisplayMode;
  snapshotBackground?: PreviewSnapshotBackground;
  selectedNodeId?: string;
  isolatedMaterialKey?: string;
  measurement?: PreviewMeasurementInfo;
  section?: PreviewSectionInfo;
  modelTree?: Model3dPreviewNode[];
  layers?: PreviewLayerInfo[];
  activeLayerIds?: string[];
  metadata?: {
    format?: string;
    objectCount?: number;
    meshCount?: number;
    lineCount?: number;
    pointCount?: number;
    materialCount?: number;
    materialNames?: string[];
    materialDetails?: PreviewMaterialInfo[];
    animationCount?: number;
    bounds?: {
      min: [number, number, number];
      max: [number, number, number];
      size: [number, number, number];
    };
    triangleCount?: number;
    vertexCount?: number;
    hasVertexColors?: boolean;
  };
  camera?: {
    position: [number, number, number];
    target: [number, number, number];
    projection?: 'perspective' | 'orthographic';
    viewPreset?: 'free' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'isometric';
  };
}

export interface MindmapPreviewState extends PreviewItemState {
  family: 'mindmap';
  scale: number;
  selectedNodeId?: string;
}

export interface DiagramPreviewState extends PreviewItemState {
  family: 'diagram';
  scale: number;
  pageIndex?: number;
  pageCount?: number;
  selectedElementId?: string;
}

export type PreviewState =
  | PreviewItemState
  | PagedPreviewState
  | FlowPreviewState
  | WorkbookPreviewState
  | ImagePreviewState
  | MediaPreviewState
  | EbookPreviewState
  | TextPreviewState
  | ArchivePreviewState
  | CadPreviewState
  | Model3dPreviewState
  | MindmapPreviewState
  | DiagramPreviewState;

export type PreviewEventName = 'loading' | 'rendered' | 'error' | 'statechange' | 'warnings';

export interface PreviewEventMap {
  loading: PreviewItemState;
  rendered: PreviewItemState;
  error: Error;
  statechange: PreviewItemState;
  warnings: string[];
}

export interface PreviewSession<TState extends PreviewItemState = PreviewItemState> {
  getFontReferences?(): readonly PreviewFontReference[];
  refreshFonts?(update: PreviewFontRefresh): Promise<void> | void;
  load(source: PreviewSource, context: PreviewLoadContext): Promise<void>;
  destroy(): void;
  getState(): TState;
  on<T extends PreviewEventName>(event: T, handler: (payload: PreviewEventMap[T]) => void): () => void;
  setScale?(scale: number): void;
  fit?(mode?: PreviewFitMode): void;
  rotate?(degrees?: number): void;
  pan?(deltaX: number, deltaY: number): void;
  fullscreen?(): Promise<void> | void;
  goToPage?(index: number): void;
  next?(): void;
  prev?(): void;
  setActiveLayers?(layerIds: string[]): void;
  toggleLayer?(layerId: string, active?: boolean): void;
  selectNode?(nodeId?: string): void;
  setNodeVisibility?(nodeId: string, visible: boolean): void;
  toggleNodeVisibility?(nodeId: string, visible?: boolean): void;
  setExplode?(amount: number): void;
  setActiveMaterial?(materialKey?: string): void;
  setMeasurementActive?(active: boolean): void;
  clearMeasurement?(): void;
  setMeasurementSnapMode?(mode: 'surface' | 'vertex'): void;
  setMeasurementAxisLock?(axis: 'free' | 'x' | 'y' | 'z'): void;
  setSectionActive?(active: boolean): void;
  setSectionMode?(mode: 'single' | 'box'): void;
  setSectionAxis?(axis: 'x' | 'y' | 'z'): void;
  setSectionOffset?(offset: number): void;
  setSectionRange?(axis: 'x' | 'y' | 'z', min: number, max: number): void;
  clearSection?(): void;
  setCameraProjection?(projection: 'perspective' | 'orthographic'): void;
  setCameraViewPreset?(preset: 'free' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'isometric'): void;
  setDisplayMode?(mode: PreviewDisplayMode): void;
  setSnapshotBackground?(background: PreviewSnapshotBackground): void;
  downloadSnapshot?(filename?: string, background?: PreviewSnapshotBackground): void;
}

export interface PreviewerInstance<TState extends PreviewItemState = PreviewItemState> {
  preview(source: PreviewSource | SourceDescriptor, descriptor?: Partial<SourceDescriptor>): Promise<void>;
  destroy(): void;
  getState(): TState;
  on<T extends PreviewEventName>(event: T, handler: (payload: PreviewEventMap[T]) => void): () => void;
  setScale(scale: number): void;
  fit(mode?: PreviewFitMode): void;
  rotate(degrees?: number): void;
  pan(deltaX: number, deltaY: number): void;
  fullscreen(): Promise<void>;
  goToPage(index: number): void;
  next(): void;
  prev(): void;
  setActiveLayers(layerIds: string[]): void;
  toggleLayer(layerId: string, active?: boolean): void;
  selectNode(nodeId?: string): void;
  setNodeVisibility(nodeId: string, visible: boolean): void;
  toggleNodeVisibility(nodeId: string, visible?: boolean): void;
  setExplode(amount: number): void;
  setActiveMaterial(materialKey?: string): void;
  setMeasurementActive(active: boolean): void;
  clearMeasurement(): void;
  setMeasurementSnapMode(mode: 'surface' | 'vertex'): void;
  setMeasurementAxisLock(axis: 'free' | 'x' | 'y' | 'z'): void;
  setSectionActive(active: boolean): void;
  setSectionMode(mode: 'single' | 'box'): void;
  setSectionAxis(axis: 'x' | 'y' | 'z'): void;
  setSectionOffset(offset: number): void;
  setSectionRange(axis: 'x' | 'y' | 'z', min: number, max: number): void;
  clearSection(): void;
  setCameraProjection(projection: 'perspective' | 'orthographic'): void;
  setCameraViewPreset(preset: 'free' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'isometric'): void;
  setDisplayMode(mode: PreviewDisplayMode): void;
  setSnapshotBackground(background: PreviewSnapshotBackground): void;
  downloadSnapshot(filename?: string, background?: PreviewSnapshotBackground): void;
}

export interface PreviewDriver<TState extends PreviewItemState = PreviewItemState> {
  id: string;
  family: PreviewFamily;
  supports(format: string): boolean;
  createSession(host: HTMLElement, options?: PreviewOptions): PreviewSession<TState>;
}

export interface ConversionRequest {
  sourceFormat: string;
  targetFormat: string;
  source: PreviewSource;
  name?: string;
  password?: string;
  locale?: string;
}

export interface ConversionResult {
  source: PreviewSource;
  format: string;
  contentType?: string;
  warnings?: string[];
  cacheKey?: string;
}

export interface ConverterClient {
  convert(request: ConversionRequest, context: PreviewLoadContext): Promise<ConversionResult>;
}

export interface FormatRoute {
  sourceFormat: string;
  targetFormat: string;
  family: PreviewFamily;
  driverId: string;
  conversion?: {
    required: boolean;
    reason?: string;
  };
}
