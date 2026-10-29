import type {
  MediaAsset,
  ParsedPresentation,
  SlideItem,
  SlideModel,
  TableItem,
  TextParagraph,
  TextRun,
  ViewerOptions as CoreViewerOptions
} from '@filens/core';

export type IworkType = 'key' | 'pages' | 'numbers';
export type IworkSource = string | ArrayBuffer | Uint8Array | Blob | File;
export type IworkTypeHint = IworkType | 'auto';
export type IworkFitMode = CoreViewerOptions['fit'] | 'height';
export type IworkViewerEventName = keyof IworkViewerEventMap;

export interface LoadIworkOptions {
  hint?: IworkTypeHint;
  signal?: AbortSignal;
  sourceName?: string;
}

export interface DetectIworkTypeOptions {
  hint?: IworkTypeHint;
  signal?: AbortSignal;
}

export interface IworkArchiveMessageInfo {
  typeId: number;
  typeName: string;
  length: number;
  objectReferences: number[];
  dataReferences: number[];
}

export interface IworkArchiveRecord {
  id: number;
  archiveId: number;
  messageIndex: number;
  typeId: number;
  typeName: string;
  value: unknown;
  objectReferences: number[];
  dataReferences: number[];
}

export interface IworkReferenceMap {
  outgoing: Record<string, number[]>;
  incoming: Record<string, number[]>;
}

export interface IworkArchiveIndex {
  type: IworkType;
  records: Record<string, IworkArchiveRecord>;
  references: IworkReferenceMap;
  dataEntries: Record<string, IworkArchiveDataEntry>;
  packageMetadata?: unknown;
  sourceName?: string;
  warnings: string[];
}

export interface IworkArchiveDataEntry {
  id: number;
  path: string;
  preferredFileName?: string;
  fileName?: string;
  contentType?: string;
}

export interface IworkColor {
  css: string;
  alpha?: number;
}

export interface IworkTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

export interface IworkTextRun extends TextRun {}

export interface IworkParagraph extends TextParagraph {}

export interface IworkImageAsset extends MediaAsset {
  role?: 'image' | 'video' | 'audio';
}

export interface IworkShape {
  id: string;
  item: SlideItem;
}

export interface IworkLine {
  id: string;
  item: SlideItem;
}

export interface IworkTable {
  id: string;
  item: TableItem;
}

export interface IworkCanvasModel {
  id: string;
  title: string;
  width: number;
  height: number;
  slide: SlideModel;
}

export interface ParsedKeynoteDocument {
  kind: 'key';
  archive: IworkArchiveIndex;
  warnings: string[];
  presentation: ParsedPresentation;
  slides: IworkCanvasModel[];
}

export interface PagesBodyBlock {
  id: string;
  kind: 'paragraphs' | 'table' | 'drawable' | 'unsupported';
  paragraphs?: IworkParagraph[];
  item?: SlideItem;
  sourceRecordId?: number;
}

export interface ParsedPagesPage {
  id: string;
  index: number;
  width: number;
  height: number;
  canvas: IworkCanvasModel;
  blocks: PagesBodyBlock[];
}

export interface ParsedPagesDocument {
  kind: 'pages';
  archive: IworkArchiveIndex;
  warnings: string[];
  title: string;
  pages: ParsedPagesPage[];
  media: Record<string, IworkImageAsset>;
}

export interface ParsedNumbersSheet {
  id: string;
  index: number;
  name: string;
  canvas: IworkCanvasModel;
  tables: IworkTable[];
  loaded?: boolean;
}

export interface ParsedNumbersDocument {
  kind: 'numbers';
  archive: IworkArchiveIndex;
  warnings: string[];
  sheets: ParsedNumbersSheet[];
  media: Record<string, IworkImageAsset>;
}

export type ParsedIworkDocument = ParsedKeynoteDocument | ParsedPagesDocument | ParsedNumbersDocument;

export interface IworkViewerOptions {
  type?: IworkTypeHint;
  width?: number;
  height?: number;
  fit?: IworkFitMode;
  initialScale?: number;
  minScale?: number;
  maxScale?: number;
  virtual?: boolean;
}

export interface IworkViewerState {
  loading: boolean;
  error: string | null;
  kind: IworkType | null;
  currentPage: number;
  pageCount: number;
  currentSheet: number;
  sheetCount: number;
  scale: number;
  fit: IworkFitMode;
  warnings: string[];
  document: ParsedIworkDocument | null;
}

export interface IworkViewerEventMap {
  loadingchange: IworkViewerState;
  rendered: IworkViewerState;
  error: Error;
  warnings: string[];
  pagechange: IworkViewerState;
  sheetchange: IworkViewerState;
  scalechange: IworkViewerState;
}

export interface IworkViewerInstance {
  refreshFonts?(): void;
  preview(source: IworkSource, options?: { signal?: AbortSignal }): Promise<void>;
  destroy(): void;
  setScale(scale: number): void;
  fit(mode?: IworkFitMode): void;
  goToPage(index: number): void;
  goToSheet(index: number): void;
  next(): void;
  prev(): void;
  getState(): IworkViewerState;
  on<T extends IworkViewerEventName>(event: T, handler: (payload: IworkViewerEventMap[T]) => void): () => void;
}
