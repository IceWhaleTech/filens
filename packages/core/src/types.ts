export type PptxSource = string | ArrayBuffer | Uint8Array | Blob | File;

export type FitMode = 'contain' | 'width' | 'none';

export type ViewerEventName = 'rendered' | 'error' | 'slidechange' | 'scalechange' | 'warnings';

export interface ViewerOptions {
  width?: number;
  height?: number;
  fit?: FitMode;
  initialScale?: number;
  minScale?: number;
  maxScale?: number;
  virtual?: boolean;
}

export interface ViewerEventMap {
  rendered: ViewerState;
  error: Error;
  slidechange: ViewerState;
  scalechange: ViewerState;
  warnings: string[];
}

export interface ViewerState {
  loading: boolean;
  error: string | null;
  currentSlide: number;
  slideCount: number;
  scale: number;
  fit: FitMode;
  warnings: string[];
  presentation: ParsedPresentation | null;
  mediaRegistry: {
    getUrl(mediaId: string): string;
  } | null;
}

export interface ViewerInstance {
  preview(source: PptxSource): Promise<void>;
  destroy(): void;
  setScale(scale: number): void;
  fit(mode?: FitMode): void;
  goToSlide(index: number): void;
  next(): void;
  prev(): void;
  getState(): ViewerState;
  on<T extends ViewerEventName>(event: T, handler: (payload: ViewerEventMap[T]) => void): () => void;
}

export interface ThemeColorMap {
  [key: string]: string;
}

export interface ThemeModel {
  name?: string;
  colors: ThemeColorMap;
  fonts: {
    major?: string;
    minor?: string;
    majorScripts?: Record<string, string>;
    minorScripts?: Record<string, string>;
  };
}

export interface MediaAsset {
  id: string;
  path: string;
  contentType: string;
  data: Uint8Array;
}

export interface PresentationSize {
  width: number;
  height: number;
}

export interface PlaceholderRef {
  type?: string;
  idx?: string;
}

export interface FillStyle {
  type: 'solid' | 'none' | 'gradient' | 'picture' | 'pattern';
  color?: string;
  alpha?: number;
  angle?: number;
  stops?: GradientStop[];
  gradientType?: 'linear' | 'path';
  gradientPath?: string;
  gradientFillToRect?: GradientRect;
  gradientTileRect?: GradientRect;
  mediaId?: string;
  crop?: CropBox;
  tile?: boolean;
  pattern?: string;
  foregroundColor?: string;
  foregroundAlpha?: number;
  backgroundColor?: string;
  backgroundAlpha?: number;
}

export interface GradientStop {
  position: number;
  color: string;
  alpha?: number;
}

export interface GradientRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface LineStyle {
  color?: string;
  alpha?: number;
  width?: number;
  dash?: string;
  compound?: LineCompoundType;
  lineCap?: LineCapType;
  lineJoin?: LineJoinType;
  miterLimit?: number;
  headEnd?: LineEndType;
  tailEnd?: LineEndType;
}

export type LineCapType = 'butt' | 'round' | 'square';
export type LineCompoundType = 'single' | 'double' | 'thickThin' | 'thinThick' | 'triple';
export type LineJoinType = 'round' | 'bevel' | 'miter';
export type LineEndType = 'none' | 'triangle' | 'stealth' | 'diamond' | 'oval' | 'arrow';

export interface ShadowStyle {
  color: string;
  alpha?: number;
  blur: number;
  distance: number;
  angle: number;
  offsetX: number;
  offsetY: number;
}

export interface PaddingBox {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface InsetBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CropBox {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ItemTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  colorAlpha?: number;
  highlightColor?: string;
  highlightAlpha?: number;
  fontSize?: number;
  fontFamily?: string;
  baselineShift?: number;
  href?: string;
  slideIndex?: number;
  navigationAction?: 'next' | 'previous' | 'first' | 'last' | 'lastViewed';
}

export interface BorderBox {
  top?: LineStyle;
  right?: LineStyle;
  bottom?: LineStyle;
  left?: LineStyle;
}

export interface TextParagraph {
  align?: 'left' | 'center' | 'right' | 'justify';
  level?: number;
  bullet?: {
    char?: string;
    autoType?: string;
    startAt?: number;
    fontFamily?: string;
    color?: string;
    colorAlpha?: number;
  };
  bulletDisabled?: boolean;
  marginLeft?: number;
  indent?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  lineHeight?: number;
  lineHeightUnit?: 'multiple' | 'px';
  tabStops?: number[];
  runs: TextRun[];
}

export interface TextFrame {
  paragraphs: TextParagraph[];
  verticalAlign: 'top' | 'middle' | 'bottom';
  direction?: 'horizontal' | 'vertical' | 'vertical270';
  wrap?: 'square' | 'none';
  anchorCenter?: boolean;
  horizontalOverflow?: 'overflow' | 'clip';
  verticalOverflow?: 'overflow' | 'clip';
  columns?: number;
  columnSpacing?: number;
  rtlColumns?: boolean;
  fromWordArt?: boolean;
  padding: PaddingBox;
  autofit?: {
    type: 'none' | 'normal' | 'shape';
    fontScale?: number;
    lineSpaceReduction?: number;
  };
}

export interface BaseSlideItem {
  id: string;
  name?: string;
  kind: 'text' | 'shape' | 'image' | 'media' | 'table' | 'unsupported';
  transform: ItemTransform;
  fill: FillStyle;
  line?: LineStyle;
  shadow?: ShadowStyle;
  placeholder?: PlaceholderRef;
  order: number;
  groupPath: string[];
  href?: string;
  slideIndex?: number;
  navigationAction?: 'next' | 'previous' | 'first' | 'last' | 'lastViewed';
}

export interface TextItem extends BaseSlideItem {
  kind: 'text';
  textFrame: TextFrame;
}

export interface PresetShapeGeometry {
  type: 'preset';
  preset: string;
  adjustments: Record<string, number>;
}

export interface CustomShapeMoveCommand {
  type: 'M';
  x: number;
  y: number;
}

export interface CustomShapeLineCommand {
  type: 'L';
  x: number;
  y: number;
}

export interface CustomShapeQuadraticCommand {
  type: 'Q';
  x1: number;
  y1: number;
  x: number;
  y: number;
}

export interface CustomShapeCubicCommand {
  type: 'C';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x: number;
  y: number;
}

export interface CustomShapeCloseCommand {
  type: 'Z';
}

export type CustomShapeCommand =
  | CustomShapeMoveCommand
  | CustomShapeLineCommand
  | CustomShapeQuadraticCommand
  | CustomShapeCubicCommand
  | CustomShapeCloseCommand;

export interface CustomShapePath {
  width: number;
  height: number;
  fill?: 'none' | 'norm';
  stroke?: 'none' | 'norm';
  commands: CustomShapeCommand[];
}

export interface CustomShapeGeometry {
  type: 'custom';
  paths: CustomShapePath[];
}

export type ShapeGeometry = PresetShapeGeometry | CustomShapeGeometry;

export interface ShapeItem extends BaseSlideItem {
  kind: 'shape';
  shapeType:
    | 'rect'
    | 'roundRect'
    | 'snip1Rect'
    | 'snip2SameRect'
    | 'snip2DiagRect'
    | 'snipRoundRect'
    | 'round1Rect'
    | 'round2SameRect'
    | 'round2DiagRect'
    | 'ellipse'
    | 'diamond'
    | 'triangle'
    | 'rtTriangle'
    | 'parallelogram'
    | 'trapezoid'
    | 'octagon'
    | 'hexagon'
    | 'heptagon'
    | 'decagon'
    | 'dodecagon'
    | 'pentagon'
    | 'star5'
    | 'plaque'
    | 'can'
    | 'pie'
    | 'chord'
    | 'donut'
    | 'arc'
    | 'teardrop'
    | 'leftCircularArrow'
    | 'curvedRightArrow'
    | 'curvedLeftArrow'
    | 'curvedUpArrow'
    | 'curvedDownArrow'
    | 'smileyFace'
    | 'frame'
    | 'halfFrame'
    | 'corner'
    | 'diagStripe'
    | 'plus'
    | 'noSmoking'
    | 'bevel'
    | 'chevron'
    | 'cloud'
    | 'cube'
    | 'homePlate'
    | 'rightArrow'
    | 'stripedRightArrow'
    | 'notchedRightArrow'
    | 'leftArrow'
    | 'leftRightArrow'
    | 'upArrow'
    | 'downArrow'
    | 'upDownArrow'
    | 'quadArrow'
    | 'leftRightUpArrow'
    | 'bentArrow'
    | 'uturnArrow'
    | 'leftUpArrow'
    | 'bentUpArrow'
    | 'rightArrowCallout'
    | 'leftRightArrowCallout'
    | 'quadArrowCallout'
    | 'leftArrowCallout'
    | 'upArrowCallout'
    | 'line'
    | 'unknown';
  geometry?: ShapeGeometry;
  textBounds?: InsetBox;
  textFrame?: TextFrame;
}

export interface ImageItem extends BaseSlideItem {
  kind: 'image';
  mediaId: string;
  crop?: CropBox;
  opacity?: number;
}

export interface MediaItem extends BaseSlideItem {
  kind: 'media';
  mediaType: 'video' | 'audio';
  mediaId: string;
  posterMediaId?: string;
  crop?: CropBox;
  opacity?: number;
}

export interface TableCell {
  row: number;
  column: number;
  rowSpan: number;
  colSpan: number;
  isMergedContinuation: boolean;
  fill: FillStyle;
  borders?: BorderBox;
  textFrame: TextFrame;
}

export interface TableItem extends BaseSlideItem {
  kind: 'table';
  columns: number[];
  rows: number[];
  hiddenColumns?: number[];
  hiddenRows?: number[];
  cells: TableCell[];
}

export interface UnsupportedItem extends BaseSlideItem {
  kind: 'unsupported';
  unsupportedType: string;
  label: string;
}

export type SlideItem = TextItem | ShapeItem | ImageItem | MediaItem | TableItem | UnsupportedItem;

export type SlideBackground = FillStyle;

export interface SlideModel {
  id: string;
  index: number;
  title: string;
  background: SlideBackground;
  width: number;
  height: number;
  items: SlideItem[];
  warnings: string[];
}

export interface ParsedPresentation {
  size: PresentationSize;
  theme: ThemeModel;
  slides: SlideModel[];
  media: Record<string, MediaAsset>;
  warnings: string[];
}
