import type {
  CustomShapePath,
  FillStyle,
  InsetBox,
  LineEndType,
  LineStyle,
  MediaItem,
  ParsedPresentation,
  ShadowStyle,
  ShapeItem,
  SlideItem,
  SlideModel,
  TableCell,
  TextParagraph,
  TextFrame
} from '../types';
import UTIF from 'utif';
import { createPresetShapeNode, resolvePresetShapeTextBounds } from './preset-geometry';
import { hexToRgb } from '../utils/colors';

export interface RenderSlideOptions {
  className?: string;
  thumbnail?: boolean;
  mediaRegistry?: MediaResolver;
}

interface RenderTextFrameOptions {
  omitPlaceholderBulletLabels?: boolean;
  availableWidth?: number;
  availableHeight?: number;
}

export interface MediaResolver {
  getUrl(mediaId: string): string;
}

type FontStackOptions = {
  symbol?: boolean;
  emoji?: boolean;
  sampleText?: string;
  contextText?: string;
};

type PatternFillStyle = FillStyle & {
  type: 'pattern';
};

export class MediaRegistry {
  private readonly cache = new Map<string, string>();

  constructor(private readonly presentation: ParsedPresentation) {}

  getUrl(mediaId: string): string {
    const cached = this.cache.get(mediaId);
    if (cached) {
      return cached;
    }

    const media = this.presentation.media[mediaId];
    if (!media) {
      return '';
    }

    let url = '';
    const decodedTiffDataUrl = isTiffMedia(mediaId, media.contentType) ? decodeTiffToDataUrl(media.data) : undefined;
    if (decodedTiffDataUrl) {
      url = decodedTiffDataUrl;
    } else if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      const blobSource = new Uint8Array(media.data.byteLength);
      blobSource.set(media.data);
      url = URL.createObjectURL(new Blob([blobSource.buffer], { type: media.contentType }));
    } else {
      url = `data:${media.contentType};base64,${uint8ToBase64(media.data)}`;
    }

    this.cache.set(mediaId, url);
    return url;
  }

  destroy(): void {
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      for (const url of this.cache.values()) {
        if (url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      }
    }

    this.cache.clear();
  }
}

function isTiffMedia(mediaId: string, contentType: string): boolean {
  return /\.tiff?$/i.test(mediaId) || /^image\/tiff?$/i.test(contentType);
}

function decodeTiffToDataUrl(bytes: Uint8Array): string | undefined {
  if (typeof document === 'undefined') {
    return undefined;
  }

  try {
    const buffer = toExactArrayBuffer(bytes);
    const ifds = UTIF.decode(buffer);
    if (!ifds.length) {
      return undefined;
    }

    for (const ifd of ifds) {
      UTIF.decodeImage(buffer, ifd, ifds);
    }

    const page =
      ifds.find((entry) => Number(entry.width) > 0 && Number(entry.height) > 0 && entry.data instanceof Uint8Array) ??
      ifds.find((entry) => Number(entry.width) > 0 && Number(entry.height) > 0) ??
      ifds[0];
    const width = Number(page.width);
    const height = Number(page.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return undefined;
    }

    const rgba = UTIF.toRGBA8(page);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      return undefined;
    }

    const imageData = context.createImageData(width, height);
    imageData.data.set(rgba);
    context.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return undefined;
  }
}

function toExactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer) {
    return bytes.buffer;
  }

  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function renderSlideToElement(
  slide: SlideModel,
  presentation: ParsedPresentation,
  options: RenderSlideOptions = {}
): HTMLElement {
  const registry = options.mediaRegistry ?? new MediaRegistry(presentation);
  const root = document.createElement('div');
  root.className = ['pptxv-slide', options.thumbnail ? 'pptxv-slide--thumbnail' : '', options.className ?? '']
    .filter(Boolean)
    .join(' ');
  root.style.position = 'relative';
  root.style.width = `${slide.width}px`;
  root.style.height = `${slide.height}px`;
  applyElementFillStyles(root, slide.background, registry);

  for (const item of slide.items) {
    root.appendChild(renderItem(item, registry));
  }

  return root;
}

function renderItem(item: SlideItem, registry: MediaResolver): HTMLElement {
  if (item.kind === 'text') {
    return renderTextItem(item, registry);
  }
  if (item.kind === 'shape') {
    return renderShapeItem(item, registry);
  }
  if (item.kind === 'image') {
    return renderImageItem(item.mediaId, item, registry);
  }
  if (item.kind === 'media') {
    return renderMediaItem(item, registry);
  }
  if (item.kind === 'table') {
    return renderTableItem(item, registry);
  }
  if (item.kind === 'chart') {
    return renderChartItem(item);
  }
  return renderUnsupportedItem(item.transform, item.label);
}

function resolveItemOpacity(item: SlideItem): number | undefined {
  const value = (item as SlideItem & { opacity?: number }).opacity;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function createItemBox(
  transform: SlideItem['transform'],
  className: string,
  opacity?: number
): HTMLDivElement {
  const element = document.createElement('div');
  element.className = className;
  element.style.left = `${transform.x}px`;
  element.style.top = `${transform.y}px`;
  element.style.width = `${Math.max(transform.width, 1)}px`;
  element.style.height = `${Math.max(transform.height, 1)}px`;
  element.style.position = 'absolute';
  element.style.transformOrigin = 'center center';
  const transforms: string[] = [];
  if (transform.flipH) {
    transforms.push('scaleX(-1)');
  }
  if (transform.flipV) {
    transforms.push('scaleY(-1)');
  }
  if (transform.rotation) {
    transforms.push(`rotate(${transform.rotation}deg)`);
  }
  if (transforms.length) {
    element.style.transform = transforms.join(' ');
  }
  if (opacity != null) {
    element.style.opacity = String(opacity);
  }
  return element;
}

function renderTextItem(item: Extract<SlideItem, { kind: 'text' }>, registry: MediaResolver): HTMLElement {
  const autoWidth = item.transform.width <= 0;
  const autoHeight = item.transform.height <= 0;
  const element = createItemBox(item.transform, 'pptxv-item pptxv-item--text', resolveItemOpacity(item));
  if (autoWidth || autoHeight) {
    applyAutoTextBoxStyles(element, autoWidth, autoHeight);
  }
  if (item.placeholder?.type) {
    element.dataset.placeholderType = item.placeholder.type;
  }
  if (item.placeholder?.idx) {
    element.dataset.placeholderIdx = item.placeholder.idx;
  }
  applyTextOverflowStyles(element, item.textFrame);
  applyItemSurfaceStyles(element, item.fill, item.line, registry);
  applyItemShadowStyles(element, item.shadow);
  const textFrame = renderTextFrame(item.textFrame, primaryFillColor(item.fill) ?? '#111827', {
    omitPlaceholderBulletLabels: shouldOmitPlaceholderBulletLabelsForItem(item),
    availableWidth: autoWidth ? undefined : item.transform.width,
    availableHeight: autoHeight ? undefined : item.transform.height
  });
  if (autoWidth) {
    textFrame.style.width = 'auto';
  }
  if (autoHeight) {
    textFrame.style.height = 'auto';
  }
  if (item.fill.type === 'picture') {
    textFrame.style.position = 'relative';
    textFrame.style.zIndex = '1';
  }
  element.appendChild(textFrame);
  appendItemLinkOverlay(element, item, !hasLinkedTextRuns(item.textFrame));
  return element;
}

function applyAutoTextBoxStyles(element: HTMLElement, autoWidth: boolean, autoHeight: boolean): void {
  if (autoWidth) {
    element.style.width = 'auto';
    element.style.minWidth = 'fit-content';
  }
  if (autoHeight) {
    element.style.height = 'auto';
  }

  const translateX = autoWidth ? '-50%' : '0';
  const translateY = autoHeight ? '-50%' : '0';
  const existingTransform = element.style.transform;
  element.style.transform = [`translate(${translateX}, ${translateY})`, existingTransform].filter(Boolean).join(' ');
  element.style.transformOrigin = '0 0';
}

function renderShapeItem(item: ShapeItem, registry: MediaResolver): HTMLElement {
  const element = createItemBox(item.transform, 'pptxv-item pptxv-item--shape', resolveItemOpacity(item));
  element.dataset.shapeType = item.shapeType;
  if (item.placeholder?.type) {
    element.dataset.placeholderType = item.placeholder.type;
  }
  if (item.placeholder?.idx) {
    element.dataset.placeholderIdx = item.placeholder.idx;
  }
  applyItemShadowStyles(element, item.shadow);
  const bleed = computeShapeBleed(item);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute(
    'viewBox',
    `${-bleed} ${-bleed} ${Math.max(item.transform.width, 1) + bleed * 2} ${Math.max(item.transform.height, 1) + bleed * 2}`
  );
  svg.setAttribute('width', `${Math.max(item.transform.width, 1) + bleed * 2}`);
  svg.setAttribute('height', `${Math.max(item.transform.height, 1) + bleed * 2}`);
  svg.setAttribute('overflow', 'visible');
  svg.style.position = 'absolute';
  svg.style.left = `${-bleed}px`;
  svg.style.top = `${-bleed}px`;
  svg.style.pointerEvents = 'none';
  svg.classList.add('pptxv-shape-svg');
  const shapeResult = createShapeNode(item, registry);
  if (shapeResult.defs.length) {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    for (const definition of shapeResult.defs) {
      defs.appendChild(definition);
    }
    svg.appendChild(defs);
  }
  svg.appendChild(shapeResult.node);
  element.appendChild(svg);

  if (item.textFrame && hasVisibleText(item.textFrame)) {
    const overlay = renderTextFrame(item.textFrame, item.line?.color ?? '#111827', {
      omitPlaceholderBulletLabels: shouldOmitPlaceholderBulletLabelsForItem(item)
    });
    overlay.classList.add('pptxv-shape-text');
    applyShapeTextBounds(overlay, item);
    element.appendChild(overlay);
  }

  appendItemLinkOverlay(element, item, !item.textFrame || !hasLinkedTextRuns(item.textFrame));

  return element;
}

function applyShapeTextBounds(element: HTMLElement, item: ShapeItem): void {
  element.style.position = 'absolute';

  const bounds = resolveShapeTextBounds(item);
  const boxWidth = Math.max(1, item.transform.width - bounds.left - bounds.right);
  const boxHeight = Math.max(1, item.transform.height - bounds.top - bounds.bottom);

  element.style.left = `${bounds.left}px`;
  element.style.right = '';
  element.style.width = `${boxWidth}px`;
  element.style.height = 'auto';
  element.style.maxHeight = `${boxHeight}px`;
  element.style.bottom = '';
  element.style.transform = '';

  if (shouldUseReferenceCenteredShapeText(item)) {
    element.style.top = `${Number((item.transform.height / 2).toFixed(3))}px`;
    element.style.transform = 'translateY(-50%)';
    return;
  }

  if (item.textFrame?.verticalAlign === 'bottom') {
    element.style.top = '';
    element.style.bottom = `${bounds.bottom}px`;
    return;
  }

  element.style.top = `${bounds.top}px`;
}

function resolveShapeTextBounds(item: ShapeItem): { left: number; top: number; right: number; bottom: number } {
  if (shouldUseReferenceFullBoxShapeTextBounds(item)) {
    return scaleInsetBox(item.transform.width, item.transform.height, 0, 0, 0, 0);
  }

  const resolved =
    item.textBounds ??
    (item.geometry?.type === 'preset'
      ? resolvePresetShapeTextBounds(item.shapeType, {
          width: item.transform.width,
          height: item.transform.height,
          adjustments: item.geometry.adjustments
        })
      : undefined);
  if (resolved) {
    return applyShapeTextInsetCompensation(item, normalizeInsetBox(resolved));
  }

  const width = item.transform.width;
  const height = item.transform.height;
  const defaultInset = scaleInsetBox(width, height, 0.08, 0.08, 0.08, 0.08);
  let fallbackBounds: { left: number; top: number; right: number; bottom: number };

  switch (item.shapeType) {
    case 'ellipse':
      // The reference preview keeps ellipse text spanning the full shape box
      // and relies on bodyPr padding + vertical centering instead of a
      // conservative circular safe area.
      fallbackBounds = scaleInsetBox(width, height, 0, 0, 0, 0);
      break;
    case 'diamond':
      fallbackBounds = scaleInsetBox(width, height, 0.18, 0.16, 0.18, 0.16);
      break;
    case 'hexagon':
    case 'octagon':
    case 'decagon':
    case 'dodecagon':
      fallbackBounds = scaleInsetBox(width, height, 0.16, 0.12, 0.16, 0.12);
      break;
    case 'pentagon':
      fallbackBounds = scaleInsetBox(width, height, 0.14, 0.2, 0.14, 0.08);
      break;
    case 'heptagon':
      fallbackBounds = scaleInsetBox(width, height, 0.14, 0.14, 0.14, 0.12);
      break;
    case 'triangle':
    case 'rtTriangle':
      fallbackBounds = scaleInsetBox(width, height, 0.16, 0.3, 0.16, 0.08);
      break;
    case 'trapezoid':
    case 'parallelogram':
      fallbackBounds = scaleInsetBox(width, height, 0.18, 0.12, 0.18, 0.12);
      break;
    case 'chevron':
      fallbackBounds = scaleInsetBox(width, height, 0.12, 0.12, 0.2, 0.12);
      break;
    case 'rightArrow':
    case 'stripedRightArrow':
    case 'notchedRightArrow':
    case 'rightArrowCallout':
      fallbackBounds = scaleInsetBox(width, height, 0.08, 0.16, 0.3, 0.16);
      break;
    case 'leftArrow':
    case 'leftArrowCallout':
      fallbackBounds = scaleInsetBox(width, height, 0.3, 0.16, 0.08, 0.16);
      break;
    case 'upArrow':
    case 'upArrowCallout':
      fallbackBounds = scaleInsetBox(width, height, 0.16, 0.28, 0.16, 0.1);
      break;
    case 'downArrow':
      fallbackBounds = scaleInsetBox(width, height, 0.16, 0.1, 0.16, 0.28);
      break;
    case 'leftRightArrow':
    case 'leftRightArrowCallout':
      fallbackBounds = scaleInsetBox(width, height, 0.24, 0.16, 0.24, 0.16);
      break;
    case 'upDownArrow':
      fallbackBounds = scaleInsetBox(width, height, 0.16, 0.24, 0.16, 0.24);
      break;
    case 'quadArrow':
    case 'quadArrowCallout':
      fallbackBounds = scaleInsetBox(width, height, 0.24, 0.24, 0.24, 0.24);
      break;
    case 'bentArrow':
    case 'bentUpArrow':
    case 'uturnArrow':
    case 'leftUpArrow':
    case 'leftRightUpArrow':
      fallbackBounds = scaleInsetBox(width, height, 0.18, 0.2, 0.18, 0.18);
      break;
    case 'homePlate':
      fallbackBounds = scaleInsetBox(width, height, 0.08, 0.12, 0.22, 0.12);
      break;
    case 'plaque':
    case 'cloud':
    case 'smileyFace':
    case 'bevel':
    case 'can':
      fallbackBounds = scaleInsetBox(width, height, 0.14, 0.14, 0.14, 0.14);
      break;
    case 'pie':
    case 'chord':
    case 'donut':
      fallbackBounds = scaleInsetBox(width, height, 0.18, 0.18, 0.18, 0.18);
      break;
    case 'frame':
    case 'halfFrame':
    case 'corner':
    case 'diagStripe':
    case 'plus':
    case 'noSmoking':
    case 'arc':
    case 'line':
      fallbackBounds = defaultInset;
      break;
    default:
      fallbackBounds = defaultInset;
      break;
  }

  return applyShapeTextInsetCompensation(item, fallbackBounds);
}

const REFERENCE_FULL_BOX_SHAPE_TEXT_TYPES = new Set<ShapeItem['shapeType']>([
  'rect',
  'roundRect',
  'ellipse',
  'snip1Rect',
  'snip2SameRect',
  'snip2DiagRect',
  'snipRoundRect',
  'round1Rect',
  'round2SameRect',
  'round2DiagRect'
]);

function shouldUseReferenceFullBoxShapeTextBounds(item: ShapeItem): boolean {
  if (item.geometry?.type === 'custom') {
    return true;
  }
  return REFERENCE_FULL_BOX_SHAPE_TEXT_TYPES.has(item.shapeType);
}

function shouldUseReferenceCenteredShapeText(item: ShapeItem): boolean {
  return item.placeholder?.type === 'title' || item.textFrame?.verticalAlign === 'middle';
}

function applyShapeTextInsetCompensation(item: ShapeItem, bounds: InsetBox): InsetBox {
  const strokeInset = resolveShapeTextStrokeInset(item);
  if (strokeInset <= 0) {
    return bounds;
  }

  const width = Math.max(item.transform.width, 1);
  const height = Math.max(item.transform.height, 1);
  const maxHorizontalInset = Math.max((width - 1) / 2, 0);
  const maxVerticalInset = Math.max((height - 1) / 2, 0);

  return normalizeInsetBox({
    left: Math.min(bounds.left + strokeInset, maxHorizontalInset),
    top: Math.min(bounds.top + strokeInset, maxVerticalInset),
    right: Math.min(bounds.right + strokeInset, maxHorizontalInset),
    bottom: Math.min(bounds.bottom + strokeInset, maxVerticalInset)
  });
}

function resolveShapeTextStrokeInset(item: ShapeItem): number {
  const strokeWidth = Math.max(item.line?.width ?? 0, 0);
  if (strokeWidth <= 2 || item.shapeType === 'line') {
    return 0;
  }

  return Number(Math.min(Math.max((strokeWidth - 2) * 0.45, 0), 8).toFixed(3));
}

function normalizeInsetBox(bounds: InsetBox): InsetBox {
  return {
    left: Number(Math.max(bounds.left, 0).toFixed(3)),
    top: Number(Math.max(bounds.top, 0).toFixed(3)),
    right: Number(Math.max(bounds.right, 0).toFixed(3)),
    bottom: Number(Math.max(bounds.bottom, 0).toFixed(3))
  };
}

function scaleInsetBox(
  width: number,
  height: number,
  leftRatio: number,
  topRatio: number,
  rightRatio: number,
  bottomRatio: number
): { left: number; top: number; right: number; bottom: number } {
  return {
    left: Number((width * leftRatio).toFixed(3)),
    top: Number((height * topRatio).toFixed(3)),
    right: Number((width * rightRatio).toFixed(3)),
    bottom: Number((height * bottomRatio).toFixed(3))
  };
}

function renderImageItem(
  mediaId: string,
  item: Extract<SlideItem, { kind: 'image' }>,
  registry: MediaResolver
): HTMLElement {
  const element = createItemBox(item.transform, 'pptxv-item pptxv-item--image', resolveItemOpacity(item));
  applyItemSurfaceStyles(element, item.fill, item.line, registry);
  applyItemShadowStyles(element, item.shadow);
  const image = document.createElement('img');
  image.className = 'pptxv-image';
  image.src = registry.getUrl(mediaId);
  image.alt = item.name ?? 'slide-image';
  applyFramedMediaLayout(element, image, item.crop, 'contain');
  image.draggable = false;
  element.appendChild(image);
  appendItemLinkOverlay(element, item, true);
  return element;
}

function renderMediaItem(item: MediaItem, registry: MediaResolver): HTMLElement {
  const element = createItemBox(
    item.transform,
    `pptxv-item pptxv-item--media pptxv-item--media-${item.mediaType}`,
    resolveItemOpacity(item)
  );
  element.dataset.mediaType = item.mediaType;
  applyItemSurfaceStyles(element, item.fill, item.line, registry);
  applyItemShadowStyles(element, item.shadow);

  if (item.mediaType === 'video') {
    element.appendChild(renderVideoMediaStage(item, registry));
  } else {
    element.style.width = '0px';
    element.style.height = '0px';
    element.style.overflow = 'visible';
    const audio = document.createElement('audio');
    audio.className = 'pptxv-media-player pptxv-media-player--audio';
    configureMediaElement(audio, item.mediaId, registry);
    audio.style.position = 'absolute';
    audio.style.left = '0px';
    audio.style.top = '0px';
    audio.style.transform = 'translate(-50%)';
    audio.style.zIndex = '1';
    element.appendChild(audio);
  }

  return element;
}

function renderVideoMediaStage(item: MediaItem, registry: MediaResolver): HTMLElement {
  const stage = document.createElement('div');
  stage.className = 'pptxv-media-stage';

  const posterFrame = document.createElement('div');
  posterFrame.className = 'pptxv-media-poster-frame';
  applyVideoFrameLayout(posterFrame, item.transform);

  const poster = createPosterImage(item.posterMediaId, item.name ?? 'video-poster', registry);
  if (poster) {
    poster.className = 'pptxv-media-poster pptxv-media-poster--video';
    applyVideoPosterLayout(posterFrame, poster, item.crop);
    posterFrame.appendChild(poster);
    stage.appendChild(posterFrame);
  }

  const video = document.createElement('video');
  video.className = 'pptxv-media-player pptxv-media-player--video';
  configureMediaElement(video, item.mediaId, registry, true);
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  applyVideoElementLayout(video, item.transform, item.crop);
  stage.appendChild(video);

  return stage;
}

function createPosterImage(mediaId: string | undefined, alt: string, registry: MediaResolver): HTMLImageElement | null {
  if (!mediaId) {
    return null;
  }

  const url = registry.getUrl(mediaId);
  if (!url) {
    return null;
  }

  const poster = document.createElement('img');
  poster.src = url;
  poster.alt = '';
  poster.draggable = false;
  return poster;
}

function configureMediaElement(
  element: HTMLAudioElement | HTMLVideoElement,
  mediaId: string,
  registry: MediaResolver,
  showNativeControls = true
): void {
  const url = registry.getUrl(mediaId);
  if (url) {
    element.src = url;
    element.setAttribute('src', url);
  }
  element.controls = showNativeControls;
  if (showNativeControls) {
    element.setAttribute('controls', '');
  } else {
    element.removeAttribute('controls');
  }
  element.preload = 'metadata';
  element.setAttribute('preload', 'metadata');
}

function applyFramedMediaLayout(
  container: HTMLElement,
  mediaElement: HTMLElement,
  crop: Extract<MediaItem, { kind: 'media' }>['crop'] | Extract<SlideItem, { kind: 'image' }>['crop'],
  objectFit: 'contain' | 'fill'
): void {
  if (crop) {
    const visibleWidth = Math.max(1 - crop.left - crop.right, 0.0001);
    const visibleHeight = Math.max(1 - crop.top - crop.bottom, 0.0001);
    container.style.overflow = 'hidden';
    mediaElement.style.position = 'absolute';
    mediaElement.style.width = percent(100 / visibleWidth);
    mediaElement.style.height = percent(100 / visibleHeight);
    mediaElement.style.maxWidth = 'none';
    mediaElement.style.maxHeight = 'none';
    mediaElement.style.left = percent((-crop.left / visibleWidth) * 100);
    mediaElement.style.top = percent((-crop.top / visibleHeight) * 100);
    mediaElement.style.objectFit = 'fill';
    return;
  }

  mediaElement.style.width = '100%';
  mediaElement.style.height = '100%';
  mediaElement.style.objectFit = objectFit;
}

function applyVideoFrameLayout(frame: HTMLElement, transform: MediaItem['transform']): void {
  frame.style.position = 'absolute';
  frame.style.left = '0px';
  frame.style.top = '0px';
  frame.style.width = `${Number(transform.width.toFixed(3))}px`;
  frame.style.height = `${Number(transform.height.toFixed(3))}px`;
  frame.style.overflow = 'hidden';
}

function applyVideoPosterLayout(
  frame: HTMLElement,
  poster: HTMLImageElement,
  crop: Extract<MediaItem, { kind: 'media' }>['crop']
): void {
  if (crop) {
    applyFramedMediaLayout(frame, poster, crop, 'fill');
    return;
  }

  poster.style.width = '100%';
  poster.style.height = '100%';
}

function applyVideoElementLayout(
  video: HTMLVideoElement,
  transform: MediaItem['transform'],
  crop: Extract<MediaItem, { kind: 'media' }>['crop']
): void {
  video.style.position = 'absolute';
  video.style.left = '0px';
  video.style.top = '0px';

  if (crop) {
    const visibleWidth = Math.max(1 - crop.left - crop.right, 0.0001);
    const visibleHeight = Math.max(1 - crop.top - crop.bottom, 0.0001);
    video.style.width = percent(100 / visibleWidth);
    video.style.height = percent(100 / visibleHeight);
    video.style.maxWidth = 'none';
    video.style.maxHeight = 'none';
    video.style.left = percent((-crop.left / visibleWidth) * 100);
    video.style.top = percent((-crop.top / visibleHeight) * 100);
    return;
  }

  const width = Math.max(1, Math.round(transform.width));
  const height = Math.max(1, Math.round(transform.height));
  video.width = width;
  video.height = height;
  video.setAttribute('width', String(width));
  video.setAttribute('height', String(height));
}

function renderTableItem(item: Extract<SlideItem, { kind: 'table' }>, registry: MediaResolver): HTMLElement {
  const element = createItemBox(item.transform, 'pptxv-item pptxv-item--table');
  applyItemShadowStyles(element, item.shadow);
  const table = document.createElement('table');
  table.className = 'pptxv-table';
  const hiddenColumns = new Set(item.hiddenColumns ?? []);
  const hiddenRows = new Set(item.hiddenRows ?? []);
  const columnSizes = fitTableTrackSizes(item.columns, item.transform.width, hiddenColumns);
  const rowSizes = fitTableTrackSizes(item.rows, item.transform.height, hiddenRows);
  const cellsByRow = new Map<number, TableCell[]>();
  for (const cell of item.cells) {
    const cells = cellsByRow.get(cell.row) ?? [];
    cells.push(cell);
    cellsByRow.set(cell.row, cells);
  }

  const colgroup = document.createElement('colgroup');
  for (let columnIndex = 0; columnIndex < item.columns.length; columnIndex += 1) {
    const width = columnSizes[columnIndex] ?? 1;
    const col = document.createElement('col');
    if (hiddenColumns.has(columnIndex)) {
      col.style.width = '0px';
      col.style.visibility = 'collapse';
    } else {
      col.style.width = `${Math.max(width, 1)}px`;
    }
    colgroup.appendChild(col);
  }
  table.appendChild(colgroup);

  const body = document.createElement('tbody');
  for (let rowIndex = 0; rowIndex < item.rows.length; rowIndex += 1) {
    const row = document.createElement('tr');
    if (hiddenRows.has(rowIndex)) {
      row.style.height = '0px';
      row.style.visibility = 'collapse';
    } else {
      row.style.height = `${rowSizes[rowIndex] ?? 1}px`;
    }

    const rowCells = cellsByRow.get(rowIndex)?.sort((left, right) => left.column - right.column) ?? [];
    for (const cell of rowCells) {
      if (cell.isMergedContinuation) {
        continue;
      }
      row.appendChild(renderTableCell(cell, registry));
    }

    body.appendChild(row);
  }

  table.appendChild(body);
  element.appendChild(table);
  appendItemLinkOverlay(element, item, !tableHasLinkedRuns(item));
  return element;
}

function fitTableTrackSizes(sizes: number[], targetSize: number, hiddenIndexes: Set<number>): number[] {
  const visibleSizes = sizes.map((size, index) => (hiddenIndexes.has(index) ? 0 : Math.max(size, 1)));
  const total = visibleSizes.reduce((sum, size) => sum + size, 0);
  if (!Number.isFinite(targetSize) || targetSize <= 0 || total <= 0) {
    return visibleSizes;
  }
  const scale = targetSize / total;
  return visibleSizes.map((size) => size * scale);
}

function renderTableCell(cell: TableCell, registry: MediaResolver): HTMLTableCellElement {
  const td = document.createElement('td');
  td.className = 'pptxv-table-cell';
  td.rowSpan = cell.rowSpan;
  td.colSpan = cell.colSpan;
  td.style.position = 'relative';
  td.style.overflow = 'hidden';
  td.style.verticalAlign = verticalAlignToTableCell(cell.textFrame.verticalAlign);
  applyElementFillStyles(td, cell.fill, registry);
  applyTableCellBorderStyles(td, cell);
  const textFrame = renderTextFrame(cell.textFrame, '#111827');
  textFrame.style.position = 'absolute';
  textFrame.style.inset = '0';
  if (cell.fill.type === 'picture') {
    textFrame.style.zIndex = '1';
  }
  td.appendChild(textFrame);
  return td;
}

function renderChartItem(item: Extract<SlideItem, { kind: 'chart' }>): HTMLElement {
  const element = createItemBox(item.transform, 'pptxv-item pptxv-item--chart');
  const width = Math.max(item.transform.width, 1);
  const height = Math.max(item.transform.height, 1);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('pptxv-chart-svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', item.title ?? item.name ?? 'Column chart');

  const legendPosition = item.legendPosition ?? 'right';
  const titleHeight = item.title ? height * 0.13 : height * 0.04;
  const legendBottomHeight = legendPosition === 'bottom' ? height * 0.15 : 0;
  const legendTopHeight = legendPosition === 'top' ? height * 0.13 : 0;
  const legendSideWidth = legendPosition === 'left' || legendPosition === 'right' ? width * 0.2 : 0;
  const plotLeft = width * 0.125 + (legendPosition === 'left' ? legendSideWidth : 0);
  const plotRight = width - width * 0.068 - (legendPosition === 'right' ? legendSideWidth : 0);
  const plotTop = Math.max(height * 0.08, titleHeight + legendTopHeight + height * 0.035);
  const plotBottom = height - height * 0.08 - legendBottomHeight;
  const plotWidth = Math.max(plotRight - plotLeft, 1);
  const plotHeight = Math.max(plotBottom - plotTop, 1);
  const axis = resolveColumnChartAxis(item);
  const yForValue = (value: number) => plotBottom - ((value - axis.min) / (axis.max - axis.min)) * plotHeight;

  if (item.title) {
    const title = createChartSvgNode('text', {
      x: width / 2,
      y: height * 0.052,
      'text-anchor': 'middle',
      'dominant-baseline': 'middle'
    });
    title.classList.add('pptxv-chart-title');
    title.setAttribute('font-size', String(Math.max(12, height * 0.047)));
    title.textContent = item.title;
    svg.appendChild(title);
  }

  for (let tick = axis.min; tick <= axis.max + axis.majorUnit / 2; tick += axis.majorUnit) {
    const normalizedTick = Math.abs(tick) < axis.majorUnit / 1000 ? 0 : tick;
    const y = yForValue(normalizedTick);
    if (normalizedTick !== 0) {
      const gridline = createChartSvgNode('line', { x1: plotLeft, y1: y, x2: plotRight, y2: y });
      gridline.classList.add('pptxv-chart-gridline');
      svg.appendChild(gridline);
    }

    const tickMark = createChartSvgNode('line', { x1: plotLeft - 4, y1: y, x2: plotLeft, y2: y });
    tickMark.classList.add('pptxv-chart-axis');
    svg.appendChild(tickMark);

    const label = createChartSvgNode('text', {
      x: plotLeft - 10,
      y,
      'text-anchor': 'end',
      'dominant-baseline': 'middle'
    });
    label.classList.add('pptxv-chart-axis-label');
    label.setAttribute('font-size', String(Math.max(9, height * 0.036)));
    label.textContent = formatChartAxisValue(normalizedTick, item);
    svg.appendChild(label);
  }

  const zeroY = yForValue(Math.min(axis.max, Math.max(axis.min, 0)));
  const categoryCount = Math.max(item.categories.length, ...item.series.map((series) => series.values.length), 1);
  const categoryWidth = plotWidth / categoryCount;
  if (item.grouping === 'clustered') {
    const groupWidth = categoryWidth * 0.74;
    const barWidth = groupWidth / Math.max(item.series.length, 1);
    item.series.forEach((series, seriesIndex) => {
      series.values.forEach((rawValue, categoryIndex) => {
        if (rawValue == null || categoryIndex >= categoryCount) {
          return;
        }

        const value = normalizeChartValue(rawValue, item, categoryIndex);
        const valueY = yForValue(value);
        const rect = createChartSvgNode('rect', {
          x: plotLeft + categoryIndex * categoryWidth + (categoryWidth - groupWidth) / 2 + seriesIndex * barWidth,
          y: Math.min(zeroY, valueY),
          width: Math.max(barWidth, 0.5),
          height: Math.max(Math.abs(zeroY - valueY), 0)
        });
        applyChartBarStyles(rect, item, seriesIndex, categoryIndex, value);
        svg.appendChild(rect);
      });
    });
  } else {
    const barWidth = categoryWidth * 0.5;
    const positiveOffsets = Array<number>(categoryCount).fill(0);
    const negativeOffsets = Array<number>(categoryCount).fill(0);
    item.series.forEach((series, seriesIndex) => {
      series.values.forEach((rawValue, categoryIndex) => {
        if (rawValue == null || categoryIndex >= categoryCount) {
          return;
        }

        const value = normalizeChartValue(rawValue, item, categoryIndex);
        const start = value >= 0 ? positiveOffsets[categoryIndex] : negativeOffsets[categoryIndex];
        const end = start + value;
        if (value >= 0) {
          positiveOffsets[categoryIndex] = end;
        } else {
          negativeOffsets[categoryIndex] = end;
        }

        const startY = yForValue(start);
        const endY = yForValue(end);
        const rect = createChartSvgNode('rect', {
          x: plotLeft + categoryIndex * categoryWidth + (categoryWidth - barWidth) / 2,
          y: Math.min(startY, endY),
          width: Math.max(barWidth, 0.5),
          height: Math.max(Math.abs(startY - endY), 0)
        });
        applyChartBarStyles(rect, item, seriesIndex, categoryIndex, value);
        svg.appendChild(rect);
      });
    });
  }

  const xAxis = createChartSvgNode('line', { x1: plotLeft, y1: zeroY, x2: plotRight, y2: zeroY });
  xAxis.classList.add('pptxv-chart-axis');
  svg.appendChild(xAxis);
  const yAxis = createChartSvgNode('line', { x1: plotLeft, y1: plotTop, x2: plotLeft, y2: plotBottom });
  yAxis.classList.add('pptxv-chart-axis');
  svg.appendChild(yAxis);

  for (let categoryIndex = 0; categoryIndex < categoryCount; categoryIndex += 1) {
    const x = plotLeft + (categoryIndex + 0.5) * categoryWidth;
    const tickMark = createChartSvgNode('line', { x1: x, y1: zeroY, x2: x, y2: zeroY + 2 });
    tickMark.classList.add('pptxv-chart-axis');
    svg.appendChild(tickMark);

    const label = createChartSvgNode('text', {
      x,
      y: plotBottom + height * 0.057,
      'text-anchor': 'middle',
      'dominant-baseline': 'middle'
    });
    label.classList.add('pptxv-chart-category-label');
    label.setAttribute('font-size', String(Math.max(10, height * 0.042)));
    label.textContent = item.categories[categoryIndex] ?? String(categoryIndex + 1);
    svg.appendChild(label);
  }

  renderChartLegend(svg, item, { width, height, plotLeft, plotRight, plotTop, plotBottom });
  element.appendChild(svg);
  appendItemLinkOverlay(element, item, true);
  return element;
}

function createChartSvgNode(name: string, attributes: Record<string, string | number>): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, String(Number.isFinite(value) ? Number(Number(value).toFixed(3)) : value));
  }
  return node;
}

function resolveColumnChartAxis(item: Extract<SlideItem, { kind: 'chart' }>): {
  min: number;
  max: number;
  majorUnit: number;
} {
  const normalizedValues = item.series.flatMap((series) =>
    series.values.flatMap((value, categoryIndex) =>
      value == null ? [] : [normalizeChartValue(value, item, categoryIndex)]
    )
  );
  const hasNegativeValues = normalizedValues.some((value) => value < 0);
  const positiveMaximum = item.grouping === 'percentStacked'
    ? 100
    : item.grouping === 'stacked'
      ? normalizedValues.reduce((sum, value) => sum + Math.max(value, 0), 0)
      : Math.max(0, ...normalizedValues);
  const negativeMinimum = item.grouping === 'percentStacked'
    ? hasNegativeValues ? -100 : 0
    : item.grouping === 'stacked'
      ? normalizedValues.reduce((sum, value) => sum + Math.min(value, 0), 0)
      : Math.min(0, ...normalizedValues);
  const rawMin = item.valueAxis?.min ?? negativeMinimum;
  const rawMax = item.valueAxis?.max ?? positiveMaximum;
  const desiredIntervals = 4;
  const autoStep = niceChartStep(Math.max(rawMax - rawMin, 1) / desiredIntervals);
  const majorUnit = item.valueAxis?.majorUnit && item.valueAxis.majorUnit > 0 ? item.valueAxis.majorUnit : autoStep;
  const min = item.valueAxis?.min ?? Math.min(0, Math.floor(rawMin / majorUnit) * majorUnit);
  let max = item.valueAxis?.max ?? Math.max(
    min + majorUnit,
    Math.ceil(rawMax / majorUnit) * majorUnit,
    min + desiredIntervals * majorUnit
  );
  if (max <= min) {
    max = min + majorUnit;
  }
  return { min, max, majorUnit };
}

function niceChartStep(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(value, Number.EPSILON)));
  const normalized = value / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}

function normalizeChartValue(
  value: number,
  item: Extract<SlideItem, { kind: 'chart' }>,
  categoryIndex: number
): number {
  if (item.grouping !== 'percentStacked') {
    return value;
  }

  const total = item.series.reduce((sum, series) => sum + Math.abs(series.values[categoryIndex] ?? 0), 0);
  return total > 0 ? (value / total) * 100 : 0;
}

function formatChartAxisValue(value: number, item: Extract<SlideItem, { kind: 'chart' }>): string {
  if (item.grouping === 'percentStacked' || item.valueAxis?.formatCode?.includes('%')) {
    return `${Number(value.toFixed(2))}%`;
  }
  return String(Number(value.toFixed(6)));
}

function applyChartBarStyles(
  rect: SVGElement,
  item: Extract<SlideItem, { kind: 'chart' }>,
  seriesIndex: number,
  categoryIndex: number,
  value: number
): void {
  const series = item.series[seriesIndex];
  rect.classList.add('pptxv-chart-bar');
  rect.setAttribute('fill', colorWithAlpha(series?.color ?? '#4472C4', series?.alpha));
  rect.setAttribute('data-series-index', String(seriesIndex));
  rect.setAttribute('data-category-index', String(categoryIndex));
  rect.setAttribute('data-value', String(value));
}

function renderChartLegend(
  svg: SVGSVGElement,
  item: Extract<SlideItem, { kind: 'chart' }>,
  bounds: { width: number; height: number; plotLeft: number; plotRight: number; plotTop: number; plotBottom: number }
): void {
  const position = item.legendPosition ?? 'right';
  if (position === 'none' || !item.series.length) {
    return;
  }

  const entries = position === 'bottom' || position === 'top' ? [...item.series].reverse() : item.series;
  const fontSize = Math.max(9, bounds.height * 0.036);
  const swatchSize = Math.max(8, fontSize * 0.9);
  const legend = createChartSvgNode('g', {});
  legend.classList.add('pptxv-chart-legend');

  entries.forEach((series, index) => {
    let x: number;
    let y: number;
    if (position === 'bottom' || position === 'top') {
      const entryWidth = (bounds.plotRight - bounds.plotLeft) / entries.length;
      x = bounds.plotLeft + index * entryWidth + entryWidth * 0.03;
      y = position === 'bottom' ? bounds.height * 0.925 : Math.max(bounds.height * 0.105, bounds.plotTop - fontSize);
    } else {
      x = position === 'left' ? bounds.width * 0.025 : bounds.plotRight + bounds.width * 0.04;
      y = bounds.plotTop + (index + 0.5) * Math.min(fontSize * 2.2, (bounds.plotBottom - bounds.plotTop) / entries.length);
    }

    const group = createChartSvgNode('g', { 'data-series-index': item.series.indexOf(series) });
    group.classList.add('pptxv-chart-legend-item');
    const swatch = createChartSvgNode('rect', {
      x,
      y: y - swatchSize * 0.72,
      width: swatchSize,
      height: swatchSize
    });
    swatch.setAttribute('fill', colorWithAlpha(series.color, series.alpha));
    const label = createChartSvgNode('text', {
      x: x + swatchSize * 1.35,
      y,
      'dominant-baseline': 'middle'
    });
    label.setAttribute('font-size', String(fontSize));
    label.textContent = series.name;
    group.append(swatch, label);
    legend.appendChild(group);
  });

  svg.appendChild(legend);
}

function renderUnsupportedItem(transform: SlideItem['transform'], label: string): HTMLElement {
  const element = createItemBox(transform, 'pptxv-item pptxv-item--unsupported');
  element.textContent = label;
  return element;
}

function appendItemLinkOverlay(element: HTMLElement, item: SlideItem, allowOverlay: boolean): void {
  if (!allowOverlay || !hasItemLink(item)) {
    return;
  }

  const link = document.createElement('a');
  link.className = 'pptxv-item-link';
  applyLinkAttributes(link, item);
  const linkLabel = describeLinkTarget(item, item.name);
  link.setAttribute('aria-label', linkLabel);
  link.title = describeLinkTitle(item, item.name);
  link.style.position = 'absolute';
  link.style.inset = '0';
  link.style.zIndex = '4';
  link.style.display = 'block';
  link.style.background = 'transparent';
  link.style.textDecoration = 'none';
  element.appendChild(link);
}

function applyItemSurfaceStyles(
  element: HTMLElement,
  fill: FillStyle,
  line: LineStyle | undefined,
  registry: MediaResolver
): void {
  applyElementFillStyles(element, fill, registry);
  element.style.border = 'none';

  if (!line) {
    return;
  }

  element.style.border = lineStyleToBorder(line);
}

function applyItemShadowStyles(element: HTMLElement, shadow: ShadowStyle | undefined): void {
  if (!shadow) {
    return;
  }

  element.style.filter = `drop-shadow(${Number(shadow.offsetX.toFixed(3))}px ${Number(shadow.offsetY.toFixed(3))}px ${Number(shadow.blur.toFixed(3))}px ${colorWithAlpha(shadow.color, shadow.alpha)})`;
}

function applyElementFillStyles(element: HTMLElement, fill: FillStyle, registry: MediaResolver): void {
  element.style.background = '';
  element.style.backgroundColor = '';
  element.style.backgroundImage = '';
  element.style.backgroundSize = '';
  element.style.backgroundRepeat = '';
  element.style.backgroundPosition = '';

  if (fill.type === 'pattern') {
    applyPatternFillStyles(element, fill as PatternFillStyle);
  } else {
    element.style.background = fillToCss(fill);
  }

  if (fill.type !== 'picture') {
    return;
  }

  const layer = createPictureFillLayer(fill, registry);
  if (!layer) {
    return;
  }

  element.style.overflow = 'hidden';
  element.insertBefore(layer, element.firstChild);
}

function applyPatternFillStyles(element: HTMLElement, fill: PatternFillStyle): void {
  const style = patternFillToCssStyle(fill);
  element.style.backgroundColor = style.color;
  element.style.backgroundImage = style.image;
  if (style.size) {
    element.style.backgroundSize = style.size;
  }
  if (style.repeat) {
    element.style.backgroundRepeat = style.repeat;
  }
  if (style.position) {
    element.style.backgroundPosition = style.position;
  }
}

function createPictureFillLayer(fill: FillStyle, registry: MediaResolver): HTMLDivElement | undefined {
  if (fill.type !== 'picture' || !fill.mediaId) {
    return undefined;
  }

  const url = registry.getUrl(fill.mediaId);
  if (!url) {
    return undefined;
  }

  const layer = document.createElement('div');
  layer.className = 'pptxv-fill-layer';
  layer.style.position = 'absolute';
  layer.style.inset = '0';
  layer.style.overflow = 'hidden';
  layer.style.pointerEvents = 'none';
  layer.style.borderRadius = 'inherit';
  layer.style.zIndex = '0';
  if (fill.alpha != null) {
    layer.style.opacity = String(fill.alpha);
  }

  if (fill.tile) {
    layer.style.backgroundImage = `url("${escapeCssUrl(url)}")`;
    layer.style.backgroundRepeat = 'repeat';
    layer.style.backgroundPosition = '0 0';
    return layer;
  }

  const image = document.createElement('img');
  image.className = 'pptxv-fill-image';
  image.src = url;
  image.alt = '';
  image.setAttribute('aria-hidden', 'true');
  image.draggable = false;
  image.style.position = 'absolute';
  image.style.maxWidth = 'none';
  image.style.maxHeight = 'none';

  if (fill.crop) {
    const visibleWidth = Math.max(1 - fill.crop.left - fill.crop.right, 0.0001);
    const visibleHeight = Math.max(1 - fill.crop.top - fill.crop.bottom, 0.0001);
    image.style.width = percent(100 / visibleWidth);
    image.style.height = percent(100 / visibleHeight);
    image.style.left = percent((-fill.crop.left / visibleWidth) * 100);
    image.style.top = percent((-fill.crop.top / visibleHeight) * 100);
    image.style.objectFit = 'fill';
  } else {
    image.style.width = '100%';
    image.style.height = '100%';
    image.style.objectFit = 'fill';
  }

  layer.appendChild(image);
  return layer;
}

function renderTextFrame(frame: TextFrame, fallbackColor: string, options: RenderTextFrameOptions = {}): HTMLElement {
  const element = document.createElement('div');
  element.className = 'pptxv-text-frame';
  element.style.padding = `${frame.padding.top}px ${frame.padding.right}px ${frame.padding.bottom}px ${frame.padding.left}px`;
  element.style.justifyContent = verticalAlignToFlex(frame.verticalAlign);
  element.style.overflowX = frame.horizontalOverflow === 'clip' || frame.wrap === 'none' ? 'clip' : 'visible';
  element.style.overflowY = frame.verticalOverflow === 'clip' ? 'clip' : 'visible';
  if (frame.anchorCenter) {
    element.style.alignItems = 'center';
  }
  if (frame.direction === 'vertical' || frame.direction === 'vertical270') {
    element.style.writingMode = frame.direction === 'vertical270' ? 'vertical-lr' : 'vertical-rl';
    element.style.textOrientation = 'mixed';
  }
  const autoNumberState: number[] = [];

  for (const paragraph of frame.paragraphs) {
    const paragraphElement = document.createElement('p');
    paragraphElement.className = 'pptxv-paragraph';
    paragraphElement.style.textAlign = paragraph.align ?? 'left';
    const defaultTypography = resolveParagraphTypography(paragraph);
    const paragraphColor = resolveParagraphColor(paragraph, fallbackColor);
    const defaultFontSize = defaultTypography.fontSize;
    const defaultFontFamily = defaultTypography.fontFamily;
    const omitBulletLabel = Boolean(
      options.omitPlaceholderBulletLabels && shouldOmitBulletLabel(paragraph, defaultFontSize)
    );
    const collapseBulletIndent = !omitBulletLabel && shouldCollapseBulletIndent(paragraph, defaultFontSize);
    const useBulletHangingOffset = shouldUseBulletHangingOffset(paragraph, omitBulletLabel);
    paragraphElement.style.fontSize = `${defaultFontSize}px`;
    if (defaultFontFamily) {
      paragraphElement.style.fontFamily = buildFontFamilyStack(defaultFontFamily, {
        sampleText: collectParagraphText(paragraph)
      });
      const requestedFontWeight = resolveRequestedFontWeight(defaultFontFamily);
      if (requestedFontWeight) {
        paragraphElement.style.fontWeight = requestedFontWeight;
      }
      const requestedFontStyle = resolveRequestedFontStyle(defaultFontFamily);
      if (requestedFontStyle) {
        paragraphElement.style.fontStyle = requestedFontStyle;
      }
    }
    if (frame.anchorCenter) {
      paragraphElement.style.width = 'fit-content';
      paragraphElement.style.maxWidth = '100%';
    }
    if (frame.wrap === 'none') {
      paragraphElement.style.whiteSpace = 'pre';
      paragraphElement.style.overflowWrap = 'normal';
      paragraphElement.style.wordBreak = 'normal';
    }
    if (paragraph.marginLeft != null) {
      paragraphElement.style.paddingLeft = `${resolveParagraphPaddingLeft(paragraph, collapseBulletIndent)}px`;
    }
    if (paragraph.indent != null) {
      paragraphElement.style.textIndent = `${useBulletHangingOffset ? 0 : resolveParagraphTextIndent(paragraph, collapseBulletIndent)}px`;
    }
    if (paragraph.spaceBefore != null) {
      paragraphElement.style.marginTop = `${paragraph.spaceBefore}px`;
    }
    if (paragraph.spaceAfter != null) {
      paragraphElement.style.marginBottom = `${paragraph.spaceAfter}px`;
    }
    if (paragraph.lineHeight != null) {
      paragraphElement.style.lineHeight =
        paragraph.lineHeightUnit === 'px' ? `${paragraph.lineHeight}px` : String(paragraph.lineHeight);
    } else {
      paragraphElement.style.lineHeight = '1';
    }

    let lineAdvance = resolveParagraphFirstLineStart(paragraph, collapseBulletIndent);
    if (paragraph.bullet) {
      const bullet = document.createElement('span');
      const label = resolveBulletLabel(paragraph, autoNumberState);
      const bulletColor = resolveBulletColor(paragraph, paragraphColor);
      const bulletAdvance = resolveBulletAdvance(label, paragraph, defaultFontSize);
      const bulletFontStack = resolveBulletFontStack(paragraph, label);
      const bulletVisual = createCustomBulletVisual(label, defaultFontSize);
      bullet.className = [
        'pptxv-run',
        'pptxv-run--bullet',
        paragraph.bullet.autoType ? 'pptxv-run--bullet-auto' : ''
      ]
        .filter(Boolean)
        .join(' ');
      if (bulletVisual) {
        bullet.dataset.resolvedLabel = label;
        bullet.appendChild(bulletVisual);
        bullet.style.display = 'inline-flex';
        bullet.style.alignItems = 'center';
        bullet.style.justifyContent = 'flex-start';
        bullet.style.lineHeight = '1';
      } else {
        bullet.textContent = label;
      }
      bullet.style.color = bulletColor;
      if (bulletFontStack) {
        bullet.style.fontFamily = bulletFontStack;
      }
      const bulletFontWeight = resolveRequestedFontWeight(paragraph.bullet.fontFamily);
      if (bulletFontWeight) {
        bullet.style.fontWeight = bulletFontWeight;
      }
      if (bulletAdvance > 0 && paragraph.indent != null && paragraph.indent < 0) {
        bullet.style.display = bulletVisual ? 'inline-flex' : 'inline-block';
        bullet.style.width = `${Number(bulletAdvance.toFixed(3))}px`;
        bullet.style.boxSizing = 'border-box';
        if (useBulletHangingOffset) {
          bullet.style.marginLeft = `${collapseBulletIndent ? 0 : paragraph.indent}px`;
        }
      }
      if (paragraph.bullet.autoType) {
        bullet.style.fontVariantNumeric = 'tabular-nums';
      }
      if (label && !omitBulletLabel) {
        paragraphElement.appendChild(bullet);
        lineAdvance += bulletAdvance;
      }
    }

    const paragraphText = collectParagraphText(paragraph);
    for (const run of paragraph.runs) {
      const span = renderTextRun(run, paragraphColor, paragraphText, defaultFontSize, frame.wrap === 'none');
      if (run.text === '\t') {
        const tabWidth = resolveTabRunWidth(paragraph, lineAdvance, defaultFontSize);
        span.classList.add('pptxv-run--tab');
        span.style.width = `${Number(tabWidth.toFixed(3))}px`;
        lineAdvance += tabWidth;
      } else if (run.text === '\n') {
        lineAdvance = resolveParagraphWrappedLineStart(paragraph, collapseBulletIndent);
      } else {
        lineAdvance += estimateRunAdvance(run, defaultFontSize);
      }
      paragraphElement.appendChild(span);
    }

    element.appendChild(paragraphElement);
  }

  applyShapeAutofitToTextFrame(element, frame, options);

  return element;
}

function applyShapeAutofitToTextFrame(
  element: HTMLElement,
  frame: TextFrame,
  options: Pick<RenderTextFrameOptions, 'availableWidth' | 'availableHeight'>
): void {
  if (frame.autofit?.type !== 'shape' || frame.wrap !== 'none') {
    return;
  }

  const availableWidth =
    options.availableWidth != null
      ? Math.max(options.availableWidth - frame.padding.left - frame.padding.right, 1)
      : undefined;
  const availableHeight =
    options.availableHeight != null
      ? Math.max(options.availableHeight - frame.padding.top - frame.padding.bottom, 1)
      : undefined;

  if ((!availableWidth || !Number.isFinite(availableWidth)) && (!availableHeight || !Number.isFinite(availableHeight))) {
    return;
  }

  const metrics = estimateTextFrameMetrics(frame);
  if (metrics.width <= 0 || metrics.height <= 0) {
    return;
  }

  let scale = 1;
  if (availableWidth && metrics.width > availableWidth + 0.5) {
    scale = Math.min(scale, availableWidth / metrics.width);
  }
  if (availableHeight && metrics.height > availableHeight + 0.5) {
    scale = Math.min(scale, availableHeight / metrics.height);
  }

  if (!Number.isFinite(scale) || scale >= 0.999) {
    return;
  }

  applyAutofitScaleToTextFrameElement(element, scale);
}

function estimateTextFrameMetrics(frame: TextFrame): { width: number; height: number } {
  let maxWidth = 0;
  let totalHeight = 0;

  for (const paragraph of frame.paragraphs) {
    const defaultFontSize = resolveParagraphTypography(paragraph).fontSize;
    let paragraphWidth = resolveParagraphFirstLineStart(paragraph);
    if (paragraph.bullet) {
      paragraphWidth += resolveBulletAdvance(resolveBulletLabel(paragraph, []), paragraph, defaultFontSize);
    }
    for (const run of paragraph.runs) {
      paragraphWidth += estimateRunAdvance(run, defaultFontSize);
    }

    const lineHeight = estimateParagraphLineHeight(paragraph, defaultFontSize);
    const paragraphHeight = lineHeight + (paragraph.spaceBefore ?? 0) + (paragraph.spaceAfter ?? 0);

    maxWidth = Math.max(maxWidth, paragraphWidth);
    totalHeight += Math.max(paragraphHeight, lineHeight);
  }

  return {
    width: maxWidth,
    height: totalHeight
  };
}

function estimateParagraphLineHeight(paragraph: TextParagraph, defaultFontSize: number): number {
  const runFontSize = paragraph.runs.reduce((maxSize, run) => Math.max(maxSize, run.fontSize ?? defaultFontSize), defaultFontSize);
  if (paragraph.lineHeight != null) {
    return paragraph.lineHeightUnit === 'px' ? paragraph.lineHeight : runFontSize * paragraph.lineHeight;
  }

  return runFontSize;
}

function applyAutofitScaleToTextFrameElement(element: HTMLElement, scale: number): void {
  const paragraphElements = Array.from(element.querySelectorAll('.pptxv-paragraph')) as HTMLParagraphElement[];
  for (const paragraph of paragraphElements) {
    scalePxStyle(paragraph.style, 'fontSize', scale);
    scalePxStyle(paragraph.style, 'marginTop', scale);
    scalePxStyle(paragraph.style, 'marginBottom', scale);
    scalePxStyle(paragraph.style, 'paddingLeft', scale);
    scalePxStyle(paragraph.style, 'textIndent', scale);
    scaleLineHeightStyle(paragraph.style, scale);
  }

  const runElements = Array.from(element.querySelectorAll('.pptxv-run')) as HTMLSpanElement[];
  for (const run of runElements) {
    scalePxStyle(run.style, 'fontSize', scale);
    scalePxStyle(run.style, 'width', scale);
    scalePxStyle(run.style, 'marginLeft', scale);
    scalePxStyle(run.style, 'lineHeight', scale);
    scaleLetterSpacingStyle(run.style, scale);
  }
}

function scalePxStyle(style: CSSStyleDeclaration, property: keyof CSSStyleDeclaration, scale: number): void {
  const currentValue = style[property];
  if (typeof currentValue !== 'string' || !currentValue.endsWith('px')) {
    return;
  }

  const numeric = Number.parseFloat(currentValue);
  if (!Number.isFinite(numeric)) {
    return;
  }

  ((style as unknown) as Record<string, string>)[property as string] = `${Number((numeric * scale).toFixed(3))}px`;
}

function scaleLineHeightStyle(style: CSSStyleDeclaration, scale: number): void {
  const currentValue = style.lineHeight;
  if (!currentValue || !currentValue.endsWith('px')) {
    return;
  }

  const numeric = Number.parseFloat(currentValue);
  if (!Number.isFinite(numeric)) {
    return;
  }

  style.lineHeight = `${Number((numeric * scale).toFixed(3))}px`;
}

function scaleLetterSpacingStyle(style: CSSStyleDeclaration, scale: number): void {
  const currentValue = style.letterSpacing;
  if (!currentValue || !currentValue.endsWith('px')) {
    return;
  }

  const numeric = Number.parseFloat(currentValue);
  if (!Number.isFinite(numeric)) {
    return;
  }

  style.letterSpacing = `${Number((numeric * scale).toFixed(3))}px`;
}

function shouldOmitPlaceholderBulletLabelsForItem(item: Extract<SlideItem, { kind: 'text' | 'shape' }>): boolean {
  return Boolean(item.placeholder?.type) || looksLikePlaceholderItemName(item.name);
}

function looksLikePlaceholderItemName(name: string | undefined): boolean {
  if (!name) {
    return false;
  }

  return /placeholder|占位符/i.test(name);
}

function applyTextOverflowStyles(element: HTMLElement, frame: TextFrame): void {
  element.style.overflowX = frame.horizontalOverflow === 'clip' || frame.wrap === 'none' ? 'clip' : 'visible';
  element.style.overflowY = frame.verticalOverflow === 'clip' ? 'clip' : 'visible';
}

function renderTextRun(
  run: TextParagraph['runs'][number],
  fallbackColor: string,
  contextText?: string,
  defaultFontSize = 16,
  noWrap = false
): HTMLAnchorElement | HTMLSpanElement {
  const isLink = Boolean(run.href || run.slideIndex != null || run.navigationAction);
  const span = isLink ? document.createElement('a') : document.createElement('span');
  span.className = ['pptxv-run', isLink ? 'pptxv-run--link' : ''].filter(Boolean).join(' ');
  const standaloneSymbolLabel = resolveStandaloneSymbolLabel(run.text);
  const customInlineVisual =
    standaloneSymbolLabel && isPortableBulletGlyph(standaloneSymbolLabel)
      ? createCustomSymbolVisual(standaloneSymbolLabel, run.fontSize ?? defaultFontSize)
      : undefined;
  if (customInlineVisual) {
    span.dataset.resolvedLabel = standaloneSymbolLabel;
    span.appendChild(customInlineVisual);
    span.style.display = 'inline-flex';
    span.style.alignItems = 'center';
    span.style.justifyContent = 'center';
    span.style.lineHeight = '1';
  } else {
    span.textContent = run.text || '\u00A0';
  }
  if (span instanceof HTMLAnchorElement) {
    applyLinkAttributes(span, run);
  }
  if (run.color) {
    span.style.color = colorWithAlpha(run.color, run.colorAlpha);
  } else {
    span.style.color = fallbackColor;
  }
  const requestedFontWeight = resolveRequestedFontWeight(run.fontFamily, run.bold);
  if (requestedFontWeight) {
    span.style.fontWeight = requestedFontWeight;
  }
  const requestedFontStyle = resolveRequestedFontStyle(run.fontFamily, run.italic);
  if (requestedFontStyle) {
    span.style.fontStyle = requestedFontStyle;
  }
  const decorations: string[] = [];
  if (run.underline) {
    decorations.push('underline');
  }
  if (run.strike) {
    decorations.push('line-through');
  }
  if (decorations.length) {
    span.style.textDecoration = decorations.join(' ');
  }
  if (run.highlightColor) {
    span.style.backgroundColor = colorWithAlpha(run.highlightColor, run.highlightAlpha);
  }
  if (run.fontSize) {
    span.style.fontSize = `${run.fontSize}px`;
  }
  const standaloneSymbolFontStack = resolveStandaloneSymbolFontStack(run.text, run.fontFamily);
  if (standaloneSymbolFontStack) {
    span.style.fontFamily = standaloneSymbolFontStack;
  } else if (run.fontFamily) {
    span.style.fontFamily = buildFontFamilyStack(run.fontFamily, {
      sampleText: run.text,
      contextText
    });
  }
  const letterSpacing = resolveRunLetterSpacing(run, contextText);
  if (letterSpacing) {
    span.style.letterSpacing = letterSpacing;
  }
  if (run.baselineShift) {
    span.style.verticalAlign = `${Number(run.baselineShift.toFixed(4))}em`;
  }
  if (noWrap) {
    span.style.whiteSpace = 'pre';
  }
  return span;
}

function resolveParagraphTypography(paragraph: TextParagraph): { fontSize: number; fontFamily?: string } {
  const sizeWeights = new Map<number, number>();
  const familyWeights = new Map<string, number>();
  let fallbackFontSize: number | undefined;
  let fallbackFontFamily: string | undefined;

  for (const run of paragraph.runs) {
    const weight = resolveRunTypographyWeight(run);
    if (run.fontSize != null) {
      fallbackFontSize ??= run.fontSize;
      sizeWeights.set(run.fontSize, (sizeWeights.get(run.fontSize) ?? 0) + weight);
    }
    if (run.fontFamily) {
      fallbackFontFamily ??= run.fontFamily;
      familyWeights.set(run.fontFamily, (familyWeights.get(run.fontFamily) ?? 0) + weight);
    }
  }

  return {
    fontSize: selectWeightedTypographyValue(sizeWeights) ?? fallbackFontSize ?? 16,
    fontFamily: selectWeightedTypographyValue(familyWeights) ?? fallbackFontFamily
  };
}

function resolveParagraphColor(paragraph: TextParagraph, fallbackColor: string): string {
  for (const run of paragraph.runs) {
    if (run.color && run.text.trim().length > 0) {
      return colorWithAlpha(run.color, run.colorAlpha);
    }
  }

  for (const run of paragraph.runs) {
    if (run.color) {
      return colorWithAlpha(run.color, run.colorAlpha);
    }
  }

  return fallbackColor;
}

function resolveRunTypographyWeight(run: TextParagraph['runs'][number]): number {
  const text = run.text.replace(/[\n\t]/g, '');
  const normalized = text.trim().length ? text.trim() : text;
  return Math.max(Array.from(normalized).length, 1);
}

function selectWeightedTypographyValue<T>(weights: Map<T, number>): T | undefined {
  let bestValue: T | undefined;
  let bestWeight = -1;

  for (const [value, weight] of weights.entries()) {
    if (weight > bestWeight) {
      bestValue = value;
      bestWeight = weight;
    }
  }

  return bestValue;
}

function collectParagraphText(paragraph: TextParagraph): string {
  return paragraph.runs.map((run) => run.text).join('');
}

function resolveParagraphPaddingLeft(paragraph: TextParagraph, collapseBulletIndent: boolean): number {
  const marginLeft = Math.max(paragraph.marginLeft ?? 0, 0);
  if (!collapseBulletIndent) {
    return marginLeft;
  }

  return Math.max(marginLeft + Math.min(paragraph.indent ?? 0, 0), 0);
}

function resolveParagraphTextIndent(paragraph: TextParagraph, collapseBulletIndent: boolean): number {
  if (!collapseBulletIndent) {
    return paragraph.indent ?? 0;
  }

  return Math.max(paragraph.indent ?? 0, 0);
}

function resolveParagraphFirstLineStart(paragraph: TextParagraph, collapseBulletIndent = false): number {
  const marginLeft = resolveParagraphPaddingLeft(paragraph, collapseBulletIndent);
  return marginLeft + resolveParagraphTextIndent(paragraph, collapseBulletIndent);
}

function resolveParagraphWrappedLineStart(paragraph: TextParagraph, collapseBulletIndent = false): number {
  const marginLeft = resolveParagraphPaddingLeft(paragraph, collapseBulletIndent);
  const positiveIndent = Math.max(resolveParagraphTextIndent(paragraph, collapseBulletIndent), 0);
  return marginLeft + positiveIndent;
}

function shouldCollapseBulletIndent(paragraph: TextParagraph, defaultFontSize: number): boolean {
  if (!paragraph.bullet || defaultFontSize > 24) {
    return false;
  }

  const marginLeft = paragraph.marginLeft ?? 0;
  const indent = paragraph.indent ?? 0;
  if (marginLeft <= 0 || indent >= 0) {
    return false;
  }

  return Math.abs(marginLeft + indent) <= 2;
}

function shouldUseBulletHangingOffset(paragraph: TextParagraph, omitBulletLabel: boolean): boolean {
  return !omitBulletLabel && Boolean(paragraph.bullet && paragraph.indent != null && paragraph.indent < 0);
}

function shouldOmitBulletLabel(paragraph: TextParagraph, defaultFontSize: number): boolean {
  if (!paragraph.bullet?.char || paragraph.bullet.autoType || defaultFontSize < 24) {
    return false;
  }

  const normalizedFont = normalizeLocalizedFontAlias(paragraph.bullet.fontFamily ?? '').toLowerCase();
  return paragraph.bullet.char === '•' && normalizedFont === 'arial';
}

function resolveBulletAdvance(label: string, paragraph: TextParagraph, defaultFontSize: number): number {
  const hangingIndent = paragraph.indent != null && paragraph.indent < 0 ? Math.abs(paragraph.indent) : 0;
  if (hangingIndent > 0) {
    return Math.max(hangingIndent, estimateTextWidth(label, defaultFontSize));
  }

  return Math.max(estimateTextWidth(label, defaultFontSize), paragraph.bullet?.autoType ? defaultFontSize * 2.4 : defaultFontSize * 1.2);
}

function resolveTabRunWidth(paragraph: TextParagraph, currentAdvance: number, defaultFontSize: number): number {
  const fallback = defaultTabWidth(defaultFontSize);

  for (const stop of paragraph.tabStops ?? []) {
    if (stop > currentAdvance + 0.5) {
      return Math.max(stop - currentAdvance, 4);
    }
  }

  return fallback;
}

function defaultTabWidth(defaultFontSize: number): number {
  return Math.max(defaultFontSize * 2.6, 24);
}

function estimateRunAdvance(run: TextParagraph['runs'][number], defaultFontSize: number): number {
  return estimateTextWidth(run.text, run.fontSize ?? defaultFontSize, run.fontFamily, run.bold, run.italic);
}

function estimateTextWidth(
  text: string,
  fontSize: number,
  fontFamily?: string,
  bold?: boolean,
  italic?: boolean
): number {
  if (!text) {
    return 0;
  }

  const measurableText = text.replace(/\n/g, '');
  const measured = measureTextWidthWithCanvas(measurableText, fontSize, fontFamily, bold, italic);
  if (measured != null && Number.isFinite(measured) && measured > 0) {
    return measured;
  }

  let width = 0;
  for (const character of measurableText) {
    width += estimateCharacterWidth(character);
  }

  const emphasizedWidth = width * (bold ? 1.04 : 1) * (italic ? 1.02 : 1);
  return emphasizedWidth * fontSize;
}

function measureTextWidthWithCanvas(
  text: string,
  fontSize: number,
  fontFamily?: string,
  bold?: boolean,
  italic?: boolean
): number | undefined {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return undefined;
  }
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) {
    return undefined;
  }

  try {
    const canvas = document.createElement('canvas');
    const context = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    if (!context) {
      return undefined;
    }

    const styleParts = [
      italic ? 'italic' : '',
      resolveRequestedFontWeight(fontFamily, bold) ?? '400',
      `${fontSize}px`,
      fontFamily
        ? buildFontFamilyStack(fontFamily, {
            sampleText: text,
            contextText: text
          })
        : '"Segoe UI", Arial, sans-serif'
    ]
      .filter(Boolean)
      .join(' ');
    context.font = styleParts;
    return context.measureText(text).width;
  } catch {
    return undefined;
  }
}

function estimateCharacterWidth(character: string): number {
  if (character === '\t') {
    return 0;
  }
  if (character === ' ') {
    return 0.33;
  }
  if (/[.,:;'"!|`]/.test(character)) {
    return 0.28;
  }
  if (/[-_/\\(){}\[\]]/.test(character)) {
    return 0.34;
  }
  if (/[A-Z0-9]/.test(character)) {
    return 0.6;
  }
  if (/[a-z]/.test(character)) {
    return 0.54;
  }
  if (/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(character)) {
    return 1;
  }

  return 0.56;
}

function buildFontFamilyStack(fontFamily: string, options: FontStackOptions = {}): string {
  const lookupFontFamily = normalizeLocalizedFontAlias(fontFamily);
  const families: string[] = [];
  const seen = new Set<string>();
  const fallbackSampleText = options.contextText && options.contextText.trim() ? options.contextText : options.sampleText;
  const preferSystemThemeFallback =
    !options.symbol &&
    shouldPreferSystemThemeFontStack(lookupFontFamily) &&
    shouldUseNeutralThemeFallbackForText(options.sampleText, options.contextText);
  const add = (value: string | undefined) => {
    if (!value) {
      return;
    }

    const normalized = normalizeFontFamilyName(value);
    if (!normalized) {
      return;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    families.push(quoteFontFamily(normalized));
  };
  const addMany = (values: readonly string[]) => {
    for (const value of values) {
      add(value);
    }
  };

  if (!preferSystemThemeFallback) {
    add(fontFamily);
    if (lookupFontFamily !== fontFamily) {
      add(lookupFontFamily);
    }
    addMany(resolveKnownFontFallbacks(lookupFontFamily, fallbackSampleText));
  }
  if (options.emoji) {
    addMany(EMOJI_FONT_STACK);
  }
  if (options.symbol || isSymbolFont(lookupFontFamily)) {
    addMany(SYMBOL_FONT_STACK);
  }
  if (!preferSystemThemeFallback) {
    addMany(resolveScriptFallbacks(lookupFontFamily, options.sampleText));
  }
  addMany(DEFAULT_SANS_STACK);

  return families.join(', ');
}

const DEFAULT_SANS_STACK = [
  '-apple-system',
  'BlinkMacSystemFont',
  'Segoe UI',
  'Roboto',
  'Helvetica Neue',
  'Arial',
  'Noto Sans',
  'sans-serif'
] as const;
const EMOJI_FONT_STACK = ['Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji'] as const;
const SYMBOL_FONT_STACK = ['Segoe UI Symbol', 'Apple Symbols', 'Noto Sans Symbols 2', 'Noto Sans Symbols'] as const;
const OFFICE_THEME_NEUTRAL_FONTS = new Set([
  'aptos',
  'aptos display',
  'aptos narrow',
  'calibri',
  'calibri light',
  'dengxian',
  'dengxian light',
  '等线',
  '等线 light',
  '绛夌嚎',
  '绛夌嚎 light'
]);
const SIMPLIFIED_CHINESE_STACK = [
  'Microsoft YaHei',
  'PingFang SC',
  'Hiragino Sans GB',
  'Noto Sans CJK SC',
  'Source Han Sans SC',
  'WenQuanYi Micro Hei'
] as const;
const SERIF_CHINESE_STACK = [
  'SimSun',
  'Songti SC',
  'STSong',
  'Noto Serif CJK SC',
  'Source Han Serif SC'
] as const;
const JAPANESE_STACK = ['Yu Gothic UI', 'Yu Gothic', 'Meiryo', 'Hiragino Sans', 'Noto Sans CJK JP'] as const;
const KOREAN_STACK = ['Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans CJK KR'] as const;
const BASE_SYNTHETIC_FONT_WEIGHT = 400;
const MIN_SYNTHETIC_FONT_WEIGHT = 100;
const MAX_SYNTHETIC_FONT_WEIGHT = 900;
const SYNTHETIC_FONT_WEIGHT_STEP = 5;
const SYNTHETIC_FONT_WEIGHT_PROFILES = [
  { pattern: /\b(thin|hairline)\b/, scale: 0.25 },
  { pattern: /\b(extra[- ]?light|ultra[- ]?light)\b/, scale: 0.55 },
  { pattern: /\b(semi[- ]?light|demi[- ]?light)\b/, scale: 0.88 },
  { pattern: /\blight\b/, scale: 0.78 },
  { pattern: /\bmedium\b/, scale: 1.15 },
  { pattern: /\b(semi[- ]?bold|demi[- ]?bold)\b/, scale: 1.38 },
  { pattern: /\b(extra[- ]?bold|ultra[- ]?bold)\b/, scale: 2 },
  { pattern: /\b(black|heavy)\b/, scale: 2.25 },
  { pattern: /\bbold\b/, scale: 1.75 }
] as const;
const FONT_AVAILABILITY_PROBE_TEXT = 'BESbswy1234567890';
const FONT_AVAILABILITY_PROBE_SIZE = 32;
const FONT_AVAILABILITY_EPSILON = 0.1;
const fontAvailabilityCache = new Map<string, boolean>();

const KNOWN_FONT_FALLBACKS: Record<string, readonly string[]> = {
  aptos: ['Aptos', 'Aptos Narrow', 'Calibri'],
  'aptos display': ['Aptos Display', 'Aptos', 'Calibri'],
  calibri: ['Calibri', 'Carlito'],
  'calibri light': ['Calibri Light', 'Calibri', 'Carlito'],
  roboto: ['Roboto', 'Arial', 'Helvetica Neue', 'Helvetica', 'Liberation Sans'],
  'roboto light': ['Roboto Light', 'Roboto', 'Arial', 'Helvetica Neue', 'Helvetica', 'Liberation Sans'],
  'roboto medium': ['Roboto Medium', 'Roboto', 'Arial', 'Helvetica Neue', 'Helvetica', 'Liberation Sans'],
  'roboto mono': ['Roboto Mono', 'Cascadia Mono', 'Consolas', 'Courier New', 'monospace'],
  'segoe ui': ['Segoe UI'],
  'segoe ui emoji': ['Segoe UI Emoji'],
  'segoe ui symbol': ['Segoe UI Symbol'],
  arial: ['Arial', 'Liberation Sans'],
  tahoma: ['Tahoma'],
  verdana: ['Verdana'],
  dengxian: ['DengXian', ...SIMPLIFIED_CHINESE_STACK],
  'dengxian light': ['DengXian Light', 'DengXian', ...SIMPLIFIED_CHINESE_STACK],
  '等线': ['DengXian', ...SIMPLIFIED_CHINESE_STACK],
  '等线 light': ['DengXian Light', 'DengXian', ...SIMPLIFIED_CHINESE_STACK],
  simsun: ['SimSun', ...SERIF_CHINESE_STACK],
  '宋体': ['SimSun', ...SERIF_CHINESE_STACK],
  simhei: ['SimHei', 'Microsoft YaHei', ...SIMPLIFIED_CHINESE_STACK],
  '黑体': ['SimHei', 'Microsoft YaHei', ...SIMPLIFIED_CHINESE_STACK],
  'microsoft yahei': ['Microsoft YaHei', ...SIMPLIFIED_CHINESE_STACK],
  '微软雅黑': ['Microsoft YaHei', ...SIMPLIFIED_CHINESE_STACK],
  kaiti: ['KaiTi', 'STKaiti', ...SERIF_CHINESE_STACK],
  '楷体': ['KaiTi', 'STKaiti', ...SERIF_CHINESE_STACK],
  fangsong: ['FangSong', 'STFangsong', ...SERIF_CHINESE_STACK],
  '仿宋': ['FangSong', 'STFangsong', ...SERIF_CHINESE_STACK],
  meiryo: ['Meiryo', ...JAPANESE_STACK],
  'yu gothic': ['Yu Gothic', 'Yu Gothic UI', ...JAPANESE_STACK],
  '游ゴシック': ['Yu Gothic', 'Yu Gothic UI', ...JAPANESE_STACK],
  '游ゴシック light': ['Yu Gothic Light', 'Yu Gothic', ...JAPANESE_STACK],
  'ms pgothic': ['MS PGothic', ...JAPANESE_STACK],
  'ms pmincho': ['MS PMincho', 'Yu Mincho', 'Hiragino Mincho ProN'],
  'malgun gothic': ['Malgun Gothic', ...KOREAN_STACK],
  '맑은 고딕': ['Malgun Gothic', ...KOREAN_STACK],
  batang: ['Batang', 'AppleMyungjo', 'Noto Serif CJK KR'],
  wingdings: ['Wingdings'],
  'wingdings 2': ['Wingdings 2'],
  'wingdings 3': ['Wingdings 3'],
  webdings: ['Webdings']
};

function resolveKnownFontFallbacks(fontFamily: string, sampleText?: string): readonly string[] {
  const normalized = normalizeFontFamilyName(fontFamily).toLowerCase();
  if (shouldPreferProportionalFallbackForRobotoMono(normalized, sampleText)) {
    return [
      'Roboto Mono',
      'Roboto',
      'Segoe UI',
      'Arial',
      'Helvetica Neue',
      'Helvetica',
      'Liberation Sans',
      'Cascadia Mono',
      'Consolas',
      'Courier New',
      'monospace'
    ];
  }

  return KNOWN_FONT_FALLBACKS[normalized] ?? [];
}

function shouldPreferProportionalFallbackForRobotoMono(fontFamily: string, sampleText?: string): boolean {
  if (fontFamily !== 'roboto mono' || !sampleText?.trim()) {
    return false;
  }

  if (containsCjkText(sampleText)) {
    return true;
  }

  const wordCount = sampleText
    .trim()
    .split(/\s+/)
    .filter((token) => /[A-Za-z]/.test(token)).length;

  return wordCount >= 3 && !looksCodeLikeText(sampleText);
}

function looksCodeLikeText(text: string): boolean {
  return /[`{}[\]();=<>/\\]|::|->|=>|\b(func|class|const|let|var|return|package|import|export)\b/i.test(text);
}

function resolveScriptFallbacks(fontFamily: string, sampleText?: string): readonly string[] {
  const normalized = normalizeFontFamilyName(fontFamily).toLowerCase();
  if (containsAny(normalized, ['dengxian', '等线', 'yahei', '微软雅黑', 'simsun', '宋体', 'simhei', '黑体', 'kaiti', '楷体', 'fangsong', '仿宋'])) {
    return SIMPLIFIED_CHINESE_STACK;
  }
  if (containsAny(normalized, ['meiryo', 'yu gothic', '游ゴシック', 'ms pgothic', 'ms pmincho'])) {
    return JAPANESE_STACK;
  }
  if (containsAny(normalized, ['malgun gothic', '맑은 고딕', 'batang'])) {
    return KOREAN_STACK;
  }
  const inferred = inferScriptFallbacksFromText(sampleText);
  if (inferred) {
    return inferred;
  }
  return [];
}

function inferScriptFallbacksFromText(text: string | undefined): readonly string[] | undefined {
  if (!text) {
    return undefined;
  }
  if (/[\u4E00-\u9FFF]/.test(text)) {
    return SIMPLIFIED_CHINESE_STACK;
  }
  if (/[\u3040-\u30FF]/.test(text)) {
    return JAPANESE_STACK;
  }
  if (/[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/.test(text)) {
    return KOREAN_STACK;
  }
  return undefined;
}

function isSymbolFont(fontFamily: string): boolean {
  const normalized = normalizeFontFamilyName(fontFamily).toLowerCase();
  return containsAny(normalized, ['wingdings', 'webdings', 'symbol']);
}

function shouldPreferSystemThemeFontStack(fontFamily: string): boolean {
  return OFFICE_THEME_NEUTRAL_FONTS.has(normalizeLocalizedFontAlias(fontFamily).toLowerCase());
}

function shouldUseNeutralThemeFallbackForText(sampleText?: string, contextText?: string): boolean {
  const text = sampleText?.trim();
  if (!text) {
    return true;
  }
  if (/^[\x20-\x7E]+$/.test(text) && /[A-Za-z]/.test(text)) {
    return true;
  }
  if (containsCjkText(text) && containsLatinText(text)) {
    return true;
  }
  return false;
}

function containsCjkText(text: string | undefined): boolean {
  return Boolean(text && /[\u4E00-\u9FFF]/.test(text));
}

function containsLatinText(text: string | undefined): boolean {
  return Boolean(text && /[A-Za-z]/.test(text));
}

function containsAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function normalizeFontFamilyName(fontFamily: string): string {
  return fontFamily.trim().replace(/^['"]+|['"]+$/g, '');
}

function normalizeLocalizedFontAlias(fontFamily: string): string {
  const normalized = normalizeFontFamilyName(fontFamily);
  switch (normalized) {
    case '等线':
      return 'DengXian';
    case '等线 Light':
    case '等线 light':
      return 'DengXian Light';
    case '宋体':
      return 'SimSun';
    case '黑体':
      return 'SimHei';
    case '微软雅黑':
      return 'Microsoft YaHei';
    case '楷体':
      return 'KaiTi';
    case '仿宋':
      return 'FangSong';
    case '游ゴシック':
      return 'Yu Gothic';
    case '游ゴシック Light':
    case '游ゴシック light':
      return 'Yu Gothic Light';
    case '맑은 고딕':
      return 'Malgun Gothic';
    default:
      return normalized;
  }
}

function quoteFontFamily(fontFamily: string): string {
  if (/^(serif|sans-serif|monospace|system-ui|ui-sans-serif|cursive|fantasy|emoji|math|fangsong)$/i.test(fontFamily)) {
    return fontFamily;
  }
  if (/^[A-Za-z0-9_-]+$/.test(fontFamily)) {
    return fontFamily;
  }
  return `"${fontFamily.replace(/["\\]/g, '\\$&')}"`;
}

function resolveRequestedFontWeight(fontFamily: string | undefined, bold = false): string | undefined {
  if (bold) {
    return '700';
  }

  return resolveSyntheticFontWeight(fontFamily);
}

function resolveSyntheticFontWeight(fontFamily: string | undefined): string | undefined {
  const normalized = normalizeLocalizedFontAlias(fontFamily ?? '').toLowerCase();
  if (!normalized) {
    return undefined;
  }

  const scale = resolveSyntheticFontWeightScale(normalized);
  if (scale == null) {
    return undefined;
  }

  if (isFontFamilyProbablyAvailable(fontFamily ?? normalized)) {
    return undefined;
  }

  return String(scaleSyntheticFontWeight(scale));
}

function resolveSyntheticFontWeightScale(normalizedFontFamily: string): number | undefined {
  for (const profile of SYNTHETIC_FONT_WEIGHT_PROFILES) {
    if (profile.pattern.test(normalizedFontFamily)) {
      return profile.scale;
    }
  }

  return undefined;
}

function scaleSyntheticFontWeight(scale: number): number {
  const scaled = BASE_SYNTHETIC_FONT_WEIGHT * scale;
  const clamped = Math.min(MAX_SYNTHETIC_FONT_WEIGHT, Math.max(MIN_SYNTHETIC_FONT_WEIGHT, scaled));
  return Math.round(clamped / SYNTHETIC_FONT_WEIGHT_STEP) * SYNTHETIC_FONT_WEIGHT_STEP;
}

function isFontFamilyProbablyAvailable(fontFamily: string): boolean {
  const candidates = Array.from(
    new Set([normalizeFontFamilyName(fontFamily), normalizeLocalizedFontAlias(fontFamily)].filter(shouldProbeFontFamily))
  );
  if (!candidates.length) {
    return true;
  }

  return candidates.some((candidate) => probeExactFontFamilyAvailability(candidate));
}

function shouldProbeFontFamily(fontFamily: string): boolean {
  const normalized = normalizeFontFamilyName(fontFamily);
  if (!normalized || normalized.includes(',')) {
    return false;
  }

  return !/^(serif|sans-serif|monospace|system-ui|ui-sans-serif|cursive|fantasy|emoji|math|fangsong)$/i.test(normalized);
}

function probeExactFontFamilyAvailability(fontFamily: string): boolean {
  const cacheKey = normalizeFontFamilyName(fontFamily).toLowerCase();
  const cached = fontAvailabilityCache.get(cacheKey);
  if (cached != null) {
    return cached;
  }

  const available = detectExactFontFamilyAvailability(fontFamily);
  fontAvailabilityCache.set(cacheKey, available);
  return available;
}

function detectExactFontFamilyAvailability(fontFamily: string): boolean {
  const baselineFamilies = ['monospace', 'serif', 'sans-serif'] as const;
  const baselineWidths = baselineFamilies.map((family) => measureFontAvailabilityWidth(family));
  if (baselineWidths.some((width) => width == null)) {
    return true;
  }

  return baselineFamilies.some((family, index) => {
    const width = measureFontAvailabilityWidth(`${quoteFontFamily(fontFamily)}, ${family}`);
    const baseline = baselineWidths[index];
    return width != null && baseline != null && Math.abs(width - baseline) > FONT_AVAILABILITY_EPSILON;
  });
}

function measureFontAvailabilityWidth(fontFamily: string): number | undefined {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return undefined;
  }

  try {
    const canvas = document.createElement('canvas');
    if (
      typeof navigator !== 'undefined' &&
      /jsdom/i.test(navigator.userAgent) &&
      typeof HTMLCanvasElement !== 'undefined' &&
      canvas instanceof HTMLCanvasElement
    ) {
      return undefined;
    }

    const context = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    if (!context) {
      return undefined;
    }

    context.font = `normal 400 ${FONT_AVAILABILITY_PROBE_SIZE}px ${fontFamily}`;
    return context.measureText(FONT_AVAILABILITY_PROBE_TEXT).width;
  } catch {
    return undefined;
  }
}

function resolveRequestedFontStyle(fontFamily: string | undefined, italic = false): string | undefined {
  if (italic) {
    return 'italic';
  }

  const normalized = normalizeFontFamilyName(fontFamily ?? '').toLowerCase();
  if (/\bitalic\b|\boblique\b/.test(normalized)) {
    return 'italic';
  }
  return undefined;
}

function resolveRunLetterSpacing(run: TextParagraph['runs'][number], contextText?: string): string | undefined {
  const text = run.text.replace(/[\n\t]/g, '').trim();
  if (text.length < 2 || /\s/.test(text)) {
    return undefined;
  }
  if (!/^[\x20-\x7E]+$/.test(text) || !/[A-Za-z]/.test(text)) {
    return undefined;
  }
  if (
    containsCjkText(contextText) &&
    contextText?.trim() !== text &&
    (contextText?.includes(`${text} `) || contextText?.includes(` ${text}`))
  ) {
    return undefined;
  }
  if ((run.fontSize ?? 0) < 16) {
    return undefined;
  }
  return '-0.04em';
}

function createShapeNode(item: ShapeItem, registry: MediaResolver): { node: SVGElement; defs: SVGElement[] } {
  const width = Math.max(item.transform.width, 1);
  const height = Math.max(item.transform.height, 1);
  const strokeWidth = Math.max(item.line?.width ?? 1, 0);
  const fill = createSvgFill(item.id, item.fill, registry, width, height);
  const stroke = linePaintColor(item.line);

  if (item.geometry?.type === 'custom') {
    const customNode = createCustomShapeNode(item.geometry.paths, width, height, fill.paint, stroke, strokeWidth, item.line);
    if (customNode) {
      return {
        node: customNode,
        defs: fill.defs
      };
    }
  }

  if (item.shapeType === 'line') {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    const geometry = item.geometry?.type === 'line' ? item.geometry : undefined;
    line.setAttribute('x1', String(geometry?.x1 ?? 0));
    line.setAttribute('y1', String(geometry?.y1 ?? 0));
    line.setAttribute('x2', String(geometry?.x2 ?? width));
    line.setAttribute('y2', String(geometry?.y2 ?? height));
    line.setAttribute('stroke', stroke);
    line.setAttribute('stroke-width', String(strokeWidth));
    applySvgLineStyles(line, item.line);
    return {
      node: line,
      defs: applyLineMarkers(line, item, stroke)
    };
  }

  if (item.shapeType === 'ellipse') {
    const ellipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    ellipse.setAttribute('cx', String(width / 2));
    ellipse.setAttribute('cy', String(height / 2));
    ellipse.setAttribute('rx', String(width / 2));
    ellipse.setAttribute('ry', String(height / 2));
    ellipse.setAttribute('fill', fill.paint);
    ellipse.setAttribute('stroke', stroke);
    ellipse.setAttribute('stroke-width', String(strokeWidth));
    applySvgLineStyles(ellipse, item.line);
    return {
      node: ellipse,
      defs: fill.defs
    };
  }

  if (item.shapeType === 'rect' || item.shapeType === 'roundRect') {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '0');
    rect.setAttribute('y', '0');
    rect.setAttribute('width', String(width));
    rect.setAttribute('height', String(height));
    rect.setAttribute('fill', fill.paint);
    rect.setAttribute('stroke', stroke);
    rect.setAttribute('stroke-width', String(strokeWidth));
    if (item.shapeType === 'roundRect') {
      const radius = resolveRoundRectRadius(item, width, height);
      rect.setAttribute('rx', String(radius));
      rect.setAttribute('ry', String(radius));
    }
    applySvgLineStyles(rect, item.line);
    return {
      node: rect,
      defs: fill.defs
    };
  }

  const presetNode = createPresetShapeNode(item.shapeType, {
    width,
    height,
    fill: fill.paint,
    stroke,
    strokeWidth,
    line: item.line,
    adjustments: item.geometry?.type === 'preset' ? item.geometry.adjustments : undefined,
    applyLineStyles: applySvgLineStyles,
    applyDashPattern: applySvgDashPattern
  });
  if (presetNode) {
    return {
      node: presetNode,
      defs: fill.defs
    };
  }

  const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  polygon.setAttribute('points', fallbackPolygonPoints(width, height));
  polygon.setAttribute('fill', fill.paint);
  polygon.setAttribute('stroke', stroke);
  polygon.setAttribute('stroke-width', String(strokeWidth));
  applySvgLineStyles(polygon, item.line);
  return {
    node: polygon,
    defs: fill.defs
  };
}

function createCustomShapeNode(
  paths: CustomShapePath[],
  width: number,
  height: number,
  fill: string,
  stroke: string,
  strokeWidth: number,
  line: LineStyle | undefined
): SVGElement | undefined {
  const renderedPaths = paths
    .map((pathInfo) => createCustomShapePathNode(pathInfo, width, height, fill, stroke, strokeWidth, line))
    .filter((node): node is SVGPathElement => Boolean(node));

  if (!renderedPaths.length) {
    return undefined;
  }

  if (renderedPaths.length === 1) {
    return renderedPaths[0];
  }

  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  for (const path of renderedPaths) {
    group.appendChild(path);
  }
  return group;
}

function createCustomShapePathNode(
  pathInfo: CustomShapePath,
  width: number,
  height: number,
  fill: string,
  stroke: string,
  strokeWidth: number,
  line: LineStyle | undefined
): SVGPathElement | undefined {
  const d = buildCustomShapePathData(pathInfo, width, height);
  if (!d) {
    return undefined;
  }

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', pathInfo.fill === 'none' ? 'none' : fill);
  path.setAttribute('stroke', pathInfo.stroke === 'none' ? 'none' : stroke);
  if (pathInfo.stroke !== 'none') {
    path.setAttribute('stroke-width', String(strokeWidth));
    applySvgLineStyles(path, line);
    if (line?.lineJoin === 'miter' && customShapeNeedsRoundMiterJoin(pathInfo)) {
      path.setAttribute('stroke-linejoin', 'round');
    }
  }
  return path;
}

function customShapeNeedsRoundMiterJoin(pathInfo: CustomShapePath): boolean {
  return pathInfo.commands.some((command) => command.type === 'Q' || command.type === 'C');
}

function buildCustomShapePathData(pathInfo: CustomShapePath, width: number, height: number): string {
  const scaleX = width / Math.max(pathInfo.width, 1);
  const scaleY = height / Math.max(pathInfo.height, 1);
  const parts: string[] = [];

  for (const command of pathInfo.commands) {
    switch (command.type) {
      case 'M':
        parts.push(`M ${formatCustomShapeValue(command.x * scaleX)} ${formatCustomShapeValue(command.y * scaleY)}`);
        break;
      case 'L':
        parts.push(`L ${formatCustomShapeValue(command.x * scaleX)} ${formatCustomShapeValue(command.y * scaleY)}`);
        break;
      case 'Q':
        parts.push(
          `Q ${formatCustomShapeValue(command.x1 * scaleX)} ${formatCustomShapeValue(command.y1 * scaleY)} ${formatCustomShapeValue(command.x * scaleX)} ${formatCustomShapeValue(command.y * scaleY)}`
        );
        break;
      case 'C':
        parts.push(
          `C ${formatCustomShapeValue(command.x1 * scaleX)} ${formatCustomShapeValue(command.y1 * scaleY)} ${formatCustomShapeValue(command.x2 * scaleX)} ${formatCustomShapeValue(command.y2 * scaleY)} ${formatCustomShapeValue(command.x * scaleX)} ${formatCustomShapeValue(command.y * scaleY)}`
        );
        break;
      case 'Z':
        parts.push('Z');
        break;
      default:
        assertNever(command);
        break;
    }
  }

  return parts.join(' ');
}

function formatCustomShapeValue(value: number): string {
  return String(Number(value.toFixed(3)));
}

function assertNever(_value: never): void {}

function fallbackPolygonPoints(width: number, height: number): string {
  return `0,0 ${width},0 ${width},${height} 0,${height}`;
}

function computeShapeBleed(item: ShapeItem): number {
  const strokeWidth = Math.max(item.line?.width ?? 0, 0);
  const hasMarkers = Boolean(
    (item.shapeType === 'line' || item.shapeType.endsWith('Arrow')) &&
      ((item.line?.headEnd && item.line.headEnd !== 'none') || (item.line?.tailEnd && item.line.tailEnd !== 'none'))
  );
  const markerBleed = hasMarkers ? Math.max(strokeWidth * 5, 10) : 0;
  const customGeometryBleed = item.geometry?.type === 'custom' ? computeCustomGeometryBleed(item) : 0;
  return Number(Math.max(strokeWidth * 1.5, markerBleed, customGeometryBleed, 1).toFixed(3));
}

function computeCustomGeometryBleed(item: ShapeItem): number {
  if (item.geometry?.type !== 'custom') {
    return 0;
  }

  const width = Math.max(item.transform.width, 1);
  const height = Math.max(item.transform.height, 1);
  let minX = 0;
  let minY = 0;
  let maxX = width;
  let maxY = height;

  for (const path of item.geometry.paths) {
    const scaleX = width / Math.max(path.width, 1);
    const scaleY = height / Math.max(path.height, 1);

    for (const command of path.commands) {
      switch (command.type) {
        case 'M':
        case 'L':
          minX = Math.min(minX, command.x * scaleX);
          minY = Math.min(minY, command.y * scaleY);
          maxX = Math.max(maxX, command.x * scaleX);
          maxY = Math.max(maxY, command.y * scaleY);
          break;
        case 'Q':
          minX = Math.min(minX, command.x1 * scaleX, command.x * scaleX);
          minY = Math.min(minY, command.y1 * scaleY, command.y * scaleY);
          maxX = Math.max(maxX, command.x1 * scaleX, command.x * scaleX);
          maxY = Math.max(maxY, command.y1 * scaleY, command.y * scaleY);
          break;
        case 'C':
          minX = Math.min(minX, command.x1 * scaleX, command.x2 * scaleX, command.x * scaleX);
          minY = Math.min(minY, command.y1 * scaleY, command.y2 * scaleY, command.y * scaleY);
          maxX = Math.max(maxX, command.x1 * scaleX, command.x2 * scaleX, command.x * scaleX);
          maxY = Math.max(maxY, command.y1 * scaleY, command.y2 * scaleY, command.y * scaleY);
          break;
        case 'Z':
          break;
        default:
          assertNever(command);
          break;
      }
    }
  }

  return Number(Math.max(-minX, -minY, maxX - width, maxY - height, 0).toFixed(3));
}

function resolveRoundRectRadius(item: ShapeItem, width: number, height: number): number {
  const adjustment = item.geometry?.type === 'preset' ? item.geometry.adjustments?.adj : undefined;
  const ratio = clampRoundRectAdjustment(adjustment ?? 16667) / 100000;
  return Number((Math.min(width, height) * ratio).toFixed(3));
}

function clampRoundRectAdjustment(value: number): number {
  if (!Number.isFinite(value)) {
    return 16667;
  }

  return Math.min(Math.max(value, 0), 50000);
}

function verticalAlignToFlex(value: TextFrame['verticalAlign']): string {
  switch (value) {
    case 'middle':
      return 'center';
    case 'bottom':
      return 'flex-end';
    default:
      return 'flex-start';
  }
}

function verticalAlignToTableCell(value: TextFrame['verticalAlign']): 'top' | 'middle' | 'bottom' {
  switch (value) {
    case 'middle':
      return 'middle';
    case 'bottom':
      return 'bottom';
    default:
      return 'top';
  }
}

function fillToCss(fill: FillStyle): string {
  if (fill.type === 'none') {
    return 'transparent';
  }

  if (fill.type === 'picture') {
    return 'transparent';
  }

  if (fill.type === 'pattern') {
    return colorWithAlpha(fill.backgroundColor ?? '#FFFFFF', fill.backgroundAlpha);
  }

  if (fill.type === 'gradient' && fill.stops?.length) {
    const stops = gradientStopsToCss(fill.stops);
    if (fill.gradientType === 'path') {
      if (fill.gradientPath === 'rect') {
        const angle = normalizeCssGradientAngle(fill.angle ?? 0);
        return `linear-gradient(${Number(angle.toFixed(3))}deg, ${stops})`;
      }
      const origin = resolvePathGradientOrigin(fill);
      return `radial-gradient(circle${origin ? ` at ${origin.x}% ${origin.y}%` : ''}, ${stops})`;
    }

    const angle = normalizeCssGradientAngle(fill.angle ?? 0);
    return `linear-gradient(${Number(angle.toFixed(3))}deg, ${stops})`;
  }

  if (!fill.color) {
    return 'transparent';
  }

  return colorWithAlpha(fill.color, fill.alpha);
}

function primaryFillColor(fill: FillStyle): string | undefined {
  if (fill.type === 'solid') {
    return fill.color;
  }

  if (fill.type === 'gradient') {
    return fill.stops?.[0]?.color;
  }

  if (fill.type === 'pattern') {
    return fill.foregroundColor ?? fill.backgroundColor;
  }

  return undefined;
}

function colorWithAlpha(color: string, alpha?: number): string {
  if (alpha == null) {
    return color;
  }

  const [r, g, b] = hexToRgb(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function linePaintColor(line: LineStyle | undefined): string {
  if (!line?.color || line.color === 'transparent') {
    return 'transparent';
  }

  if (line.alpha != null && line.alpha <= 0) {
    return 'transparent';
  }

  return colorWithAlpha(line.color, line.alpha);
}

function normalizeCssGradientAngle(angle: number): number {
  return ((90 - angle) % 360 + 360) % 360;
}

function gradientStopsToCss(stops: NonNullable<FillStyle['stops']>): string {
  return stops
    .map((stop) => `${colorWithAlpha(stop.color, stop.alpha)} ${Number((stop.position * 100).toFixed(3))}%`)
    .join(', ');
}

function resolvePathGradientOrigin(fill: FillStyle): { x: number; y: number } | undefined {
  if (fill.type !== 'gradient' || fill.gradientType !== 'path') {
    return undefined;
  }

  const tileRect = fill.gradientTileRect;
  if (!tileRect) {
    return undefined;
  }

  const x = tileRect.left < 0 ? 0 : tileRect.right < 0 ? 100 : 50;
  const y = tileRect.top < 0 ? 0 : tileRect.bottom < 0 ? 100 : 50;

  if (x === 50 && y === 50) {
    return undefined;
  }

  return { x, y };
}

function createSvgFill(
  id: string,
  fill: FillStyle,
  registry: MediaResolver,
  width: number,
  height: number
): {
  paint: string;
  defs: SVGElement[];
} {
  if (fill.type === 'picture' && fill.mediaId) {
    const url = registry.getUrl(fill.mediaId);
    if (!url) {
      return {
        paint: 'transparent',
        defs: []
      };
    }

    const pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
    pattern.id = `${id}-fill-pattern`;
    pattern.setAttribute('patternUnits', 'userSpaceOnUse');
    pattern.setAttribute('x', '0');
    pattern.setAttribute('y', '0');
    pattern.setAttribute('width', String(width));
    pattern.setAttribute('height', String(height));

    const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    image.setAttribute('preserveAspectRatio', 'none');
    image.setAttribute('href', url);
    image.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', url);

    if (fill.crop) {
      const visibleWidth = Math.max(1 - fill.crop.left - fill.crop.right, 0.0001);
      const visibleHeight = Math.max(1 - fill.crop.top - fill.crop.bottom, 0.0001);
      image.setAttribute('x', String(Number(((-fill.crop.left / visibleWidth) * width).toFixed(3))));
      image.setAttribute('y', String(Number(((-fill.crop.top / visibleHeight) * height).toFixed(3))));
      image.setAttribute('width', String(Number((width / visibleWidth).toFixed(3))));
      image.setAttribute('height', String(Number((height / visibleHeight).toFixed(3))));
    } else {
      image.setAttribute('x', '0');
      image.setAttribute('y', '0');
      image.setAttribute('width', String(width));
      image.setAttribute('height', String(height));
    }
    if (fill.alpha != null) {
      image.setAttribute('opacity', String(fill.alpha));
    }

    pattern.appendChild(image);
    return {
      paint: `url(#${pattern.id})`,
      defs: [pattern]
    };
  }

  if (fill.type === 'pattern') {
    return createSvgPatternFill(id, fill as PatternFillStyle, width, height);
  }

  if (fill.type !== 'gradient' || !fill.stops?.length) {
    return {
      paint: fillToCss(fill),
      defs: []
    };
  }

  if (fill.gradientType === 'path') {
    if (fill.gradientPath === 'rect') {
      const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
      gradient.id = `${id}-fill-gradient`;
      gradient.setAttribute('x1', '0');
      gradient.setAttribute('y1', '0.5');
      gradient.setAttribute('x2', '1');
      gradient.setAttribute('y2', '0.5');
      gradient.setAttribute('gradientUnits', 'objectBoundingBox');

      for (const stopInfo of fill.stops) {
        const stop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stop.setAttribute('offset', `${Number((stopInfo.position * 100).toFixed(3))}%`);
        stop.setAttribute('stop-color', stopInfo.color);
        if (stopInfo.alpha != null) {
          stop.setAttribute('stop-opacity', String(stopInfo.alpha));
        }
        gradient.appendChild(stop);
      }

      return {
        paint: `url(#${gradient.id})`,
        defs: [gradient]
      };
    }

    const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'radialGradient');
    gradient.id = `${id}-fill-gradient`;
    const origin = resolvePathGradientOrigin(fill);
    if (origin) {
      gradient.setAttribute('cx', `${origin.x}%`);
      gradient.setAttribute('cy', `${origin.y}%`);
    }

    for (const stopInfo of fill.stops) {
      const stop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
      stop.setAttribute('offset', `${Number((stopInfo.position * 100).toFixed(3))}%`);
      stop.setAttribute('stop-color', stopInfo.color);
      if (stopInfo.alpha != null) {
        stop.setAttribute('stop-opacity', String(stopInfo.alpha));
      }
      gradient.appendChild(stop);
    }

    return {
      paint: `url(#${gradient.id})`,
      defs: [gradient]
    };
  }

  const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
  gradient.id = `${id}-fill-gradient`;
  gradient.setAttribute('x1', '0');
  gradient.setAttribute('y1', '0.5');
  gradient.setAttribute('x2', '1');
  gradient.setAttribute('y2', '0.5');
  gradient.setAttribute('gradientUnits', 'objectBoundingBox');
  gradient.setAttribute('gradientTransform', `rotate(${Number(((fill.angle ?? 0) % 360).toFixed(3))} 0.5 0.5)`);

  for (const stopInfo of fill.stops) {
    const stop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop.setAttribute('offset', `${Number((stopInfo.position * 100).toFixed(3))}%`);
    stop.setAttribute('stop-color', stopInfo.color);
    if (stopInfo.alpha != null) {
      stop.setAttribute('stop-opacity', String(stopInfo.alpha));
    }
    gradient.appendChild(stop);
  }

  return {
    paint: `url(#${gradient.id})`,
    defs: [gradient]
  };
}

function patternFillToCssStyle(fill: PatternFillStyle): {
  color: string;
  image: string;
  size?: string;
  repeat?: string;
  position?: string;
} {
  const fg = colorWithAlpha(fill.foregroundColor ?? '#111827', fill.foregroundAlpha);
  const bg = colorWithAlpha(fill.backgroundColor ?? '#FFFFFF', fill.backgroundAlpha);

  switch (fill.pattern) {
    case 'horz':
      return {
        color: bg,
        image: `repeating-linear-gradient(180deg, ${fg} 0 2px, ${bg} 2px 8px)`
      };
    case 'vert':
      return {
        color: bg,
        image: `repeating-linear-gradient(90deg, ${fg} 0 2px, ${bg} 2px 8px)`
      };
    case 'ltDnDiag':
      return {
        color: bg,
        image: `repeating-linear-gradient(45deg, ${fg} 0 2px, ${bg} 2px 10px)`
      };
    case 'ltUpDiag':
      return {
        color: bg,
        image: `repeating-linear-gradient(135deg, ${fg} 0 2px, ${bg} 2px 10px)`
      };
    case 'diagCross':
      return {
        color: bg,
        image: `repeating-linear-gradient(45deg, ${fg} 0 2px, transparent 2px 10px), repeating-linear-gradient(135deg, ${fg} 0 2px, transparent 2px 10px)`
      };
    case 'smGrid':
      return {
        color: bg,
        image: `repeating-linear-gradient(0deg, ${fg} 0 1px, transparent 1px 8px), repeating-linear-gradient(90deg, ${fg} 0 1px, transparent 1px 8px)`
      };
    case 'lgGrid':
      return {
        color: bg,
        image: `repeating-linear-gradient(0deg, ${fg} 0 2px, transparent 2px 14px), repeating-linear-gradient(90deg, ${fg} 0 2px, transparent 2px 14px)`
      };
    case 'pct10':
      return dotPatternCssStyle(fg, bg, 5, 0.65);
    case 'pct20':
      return dotPatternCssStyle(fg, bg, 10, 1.75);
    case 'pct25':
      return dotPatternCssStyle(fg, bg, 9, 1.9);
    case 'pct30':
      return dotPatternCssStyle(fg, bg, 8, 2);
    case 'pct40':
      return dotPatternCssStyle(fg, bg, 8, 2.35);
    case 'pct50':
      return dotPatternCssStyle(fg, bg, 7, 2.4);
    case 'pct60':
      return dotPatternCssStyle(fg, bg, 6, 2.45);
    case 'pct70':
      return dotPatternCssStyle(fg, bg, 5, 2.55);
    case 'pct75':
      return dotPatternCssStyle(fg, bg, 5, 2.7);
    case 'pct80':
      return dotPatternCssStyle(fg, bg, 4, 2.75);
    case 'pct90':
      return dotPatternCssStyle(fg, bg, 4, 3);
    case 'pct5':
      return dotPatternCssStyle(fg, bg, 4, 0.45);
    case 'solidDmnd':
      return svgTileCssStyle(
        `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8">
          <rect width="8" height="8" fill="${bg}"/>
          <polygon points="4,1.5 6.5,4 4,6.5 1.5,4" fill="${fg}"/>
        </svg>`,
        bg,
        8
      );
    default:
      return dotPatternCssStyle(fg, bg, 4, 0.45);
  }
}

function dotPatternCssStyle(
  foreground: string,
  background: string,
  size: number,
  radius: number
): {
  color: string;
  image: string;
  size: string;
  repeat: string;
  position: string;
} {
  return {
    color: background,
    image: `radial-gradient(circle, ${foreground} 0 ${radius}px, transparent ${radius}px)`,
    size: `${size}px ${size}px`,
    repeat: 'repeat',
    position: '0 0'
  };
}

function svgTileCssStyle(
  svg: string,
  background: string,
  size: number
): {
  color: string;
  image: string;
  size: string;
  repeat: string;
  position: string;
} {
  return {
    color: background,
    image: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
    size: `${size}px ${size}px`,
    repeat: 'repeat',
    position: '0 0'
  };
}

function createSvgPatternFill(
  id: string,
  fill: PatternFillStyle,
  width: number,
  height: number
): {
  paint: string;
  defs: SVGElement[];
} {
  const pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
  pattern.id = `${id}-fill-pattern`;
  pattern.setAttribute('patternUnits', 'userSpaceOnUse');
  pattern.setAttribute('x', '0');
  pattern.setAttribute('y', '0');

  const fg = fill.foregroundColor ?? '#111827';
  const bg = fill.backgroundColor ?? '#FFFFFF';
  const fgOpacity = fill.foregroundAlpha;
  const bgOpacity = fill.backgroundAlpha;

  const addRect = (x: number, y: number, rectWidth: number, rectHeight: number, color: string, opacity?: number) => {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(rectWidth));
    rect.setAttribute('height', String(rectHeight));
    rect.setAttribute('fill', color);
    if (opacity != null) {
      rect.setAttribute('fill-opacity', String(opacity));
    }
    pattern.appendChild(rect);
  };

  const addLine = (x1: number, y1: number, x2: number, y2: number, strokeWidth: number) => {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(x1));
    line.setAttribute('y1', String(y1));
    line.setAttribute('x2', String(x2));
    line.setAttribute('y2', String(y2));
    line.setAttribute('stroke', fg);
    line.setAttribute('stroke-width', String(strokeWidth));
    if (fgOpacity != null) {
      line.setAttribute('stroke-opacity', String(fgOpacity));
    }
    pattern.appendChild(line);
  };

  const addCircle = (cx: number, cy: number, radius: number) => {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', String(cx));
    circle.setAttribute('cy', String(cy));
    circle.setAttribute('r', String(radius));
    circle.setAttribute('fill', fg);
    if (fgOpacity != null) {
      circle.setAttribute('fill-opacity', String(fgOpacity));
    }
    pattern.appendChild(circle);
  };

  const addPolygon = (points: string) => {
    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    polygon.setAttribute('points', points);
    polygon.setAttribute('fill', fg);
    if (fgOpacity != null) {
      polygon.setAttribute('fill-opacity', String(fgOpacity));
    }
    pattern.appendChild(polygon);
  };

  const setTile = (tileWidth: number, tileHeight: number) => {
    pattern.setAttribute('width', String(tileWidth));
    pattern.setAttribute('height', String(tileHeight));
    addRect(0, 0, tileWidth, tileHeight, bg, bgOpacity);
  };

  switch (fill.pattern) {
    case 'horz':
      setTile(8, 8);
      addLine(0, 1, 8, 1, 2);
      break;
    case 'vert':
      setTile(8, 8);
      addLine(1, 0, 1, 8, 2);
      break;
    case 'ltDnDiag':
      setTile(10, 10);
      addLine(-2, 10, 10, -2, 2);
      addLine(0, 12, 12, 0, 2);
      break;
    case 'ltUpDiag':
      setTile(10, 10);
      addLine(-2, 0, 10, 12, 2);
      addLine(0, -2, 12, 10, 2);
      break;
    case 'diagCross':
      setTile(10, 10);
      addLine(-2, 10, 10, -2, 2);
      addLine(0, 12, 12, 0, 2);
      addLine(-2, 0, 10, 12, 2);
      addLine(0, -2, 12, 10, 2);
      break;
    case 'smGrid':
      setTile(8, 8);
      addLine(0, 1, 8, 1, 1);
      addLine(1, 0, 1, 8, 1);
      break;
    case 'lgGrid':
      setTile(14, 14);
      addLine(0, 2, 14, 2, 2);
      addLine(2, 0, 2, 14, 2);
      break;
    case 'pct10':
      setTile(5, 5);
      addCircle(1.25, 1.25, 0.65);
      break;
    case 'pct20':
      setTile(10, 10);
      addCircle(2, 2, 1.75);
      break;
    case 'pct25':
      setTile(9, 9);
      addCircle(2, 2, 1.9);
      break;
    case 'pct30':
      setTile(8, 8);
      addCircle(2, 2, 2);
      break;
    case 'pct40':
      setTile(8, 8);
      addCircle(2, 2, 2.35);
      break;
    case 'pct50':
      setTile(7, 7);
      addCircle(2, 2, 2.4);
      break;
    case 'pct60':
      setTile(6, 6);
      addCircle(2, 2, 2.45);
      break;
    case 'pct70':
      setTile(5, 5);
      addCircle(1.8, 1.8, 2.55);
      break;
    case 'pct75':
      setTile(5, 5);
      addCircle(1.8, 1.8, 2.7);
      break;
    case 'pct80':
      setTile(4, 4);
      addCircle(1.5, 1.5, 2.75);
      break;
    case 'pct90':
      setTile(4, 4);
      addCircle(1.5, 1.5, 3);
      break;
    case 'pct5':
      setTile(4, 4);
      addCircle(1, 1, 0.45);
      break;
    case 'solidDmnd':
      setTile(8, 8);
      addPolygon('4,1.5 6.5,4 4,6.5 1.5,4');
      break;
    default:
      setTile(4, 4);
      addCircle(1, 1, 0.45);
      break;
  }

  return {
    paint: `url(#${pattern.id})`,
    defs: [pattern]
  };
}

function applyTableCellBorderStyles(cellElement: HTMLTableCellElement, cell: TableCell): void {
  if (!cell.borders) {
    return;
  }

  const borderMap = [
    ['top', cell.borders.top],
    ['right', cell.borders.right],
    ['bottom', cell.borders.bottom],
    ['left', cell.borders.left]
  ] as const;

  for (const [side, border] of borderMap) {
    if (!border) {
      continue;
    }

    cellElement.style.setProperty(`border-${side}`, lineStyleToBorder(border));
  }
}

function lineStyleToBorder(line: LineStyle): string {
  const width = line.width ?? 1;
  const color = linePaintColor(line);
  if (width <= 0 || color === 'transparent') {
    return '0px solid transparent';
  }

  const style = lineCompoundToBorderStyle(line.compound) ?? lineDashToBorderStyle(line.dash);
  return `${Number(width.toFixed(3))}px ${style} ${color}`;
}

function applySvgDashPattern(node: SVGElement, line: LineStyle | undefined): void {
  const pattern = lineDashToSvgPattern(line);
  if (pattern) {
    node.setAttribute('stroke-dasharray', pattern);
    return;
  }

  node.removeAttribute('stroke-dasharray');
}

function applySvgLineStyles(
  node: SVGElement,
  line: LineStyle | undefined,
  defaults: {
    defaultJoin?: LineStyle['lineJoin'];
  } = {}
): void {
  applySvgDashPattern(node, line);

  if (line?.dashOffset != null && Number.isFinite(line.dashOffset)) {
    node.setAttribute('stroke-dashoffset', String(Number(line.dashOffset.toFixed(3))));
  } else {
    node.removeAttribute('stroke-dashoffset');
  }

  if (line?.lineCap) {
    node.setAttribute('stroke-linecap', line.lineCap);
  } else {
    node.removeAttribute('stroke-linecap');
  }

  const join = line?.lineJoin ?? defaults.defaultJoin;
  if (join) {
    node.setAttribute('stroke-linejoin', join);
  } else {
    node.removeAttribute('stroke-linejoin');
  }

  if (join === 'miter' && line?.miterLimit != null) {
    node.setAttribute('stroke-miterlimit', String(Number(line.miterLimit.toFixed(3))));
  } else {
    node.removeAttribute('stroke-miterlimit');
  }
}

function lineCompoundToBorderStyle(
  compound: LineStyle['compound']
): 'solid' | 'dashed' | 'dotted' | 'double' | undefined {
  switch (compound) {
    case 'double':
    case 'thickThin':
    case 'thinThick':
    case 'triple':
      return 'double';
    default:
      return undefined;
  }
}

function lineDashToBorderStyle(dash: string | undefined): 'solid' | 'dashed' | 'dotted' {
  switch (dash) {
    case 'dot':
    case 'sysDot':
      return 'dotted';
    case 'dash':
    case 'sysDash':
    case 'lgDash':
    case 'dashDot':
    case 'sysDashDot':
    case 'lgDashDot':
    case 'lgDashDotDot':
    case 'sysDashDotDot':
      return 'dashed';
    default:
      return 'solid';
  }
}

function lineDashToSvgPattern(line: LineStyle | undefined): string | undefined {
  const exactPattern = line?.dashPattern?.filter((value) => Number.isFinite(value) && value > 0);
  if (exactPattern?.length) {
    return exactPattern.map((value) => String(Number(value.toFixed(3)))).join(' ');
  }

  if (!line?.dash || line.dash === 'solid') {
    return undefined;
  }

  const width = Math.max(line.width ?? 1, 1);
  const lineCap = line.lineCap ?? 'butt';
  switch (line.dash) {
    case 'dot':
    case 'sysDot':
      return dashSegments(width, lineCap, 1, 1.8);
    case 'dash':
    case 'sysDash':
      return dashSegments(width, lineCap, 3, 2);
    case 'lgDash':
      return dashSegments(width, lineCap, 6, 3);
    case 'dashDot':
    case 'sysDashDot':
      return dashSegments(width, lineCap, 3, 2, 1, 2);
    case 'lgDashDot':
      return dashSegments(width, lineCap, 6, 3, 1, 3);
    case 'lgDashDotDot':
    case 'sysDashDotDot':
      return dashSegments(width, lineCap, 6, 3, 1, 2, 1, 2);
    default:
      return dashSegments(width, lineCap, 3, 2);
  }
}

function dashSegments(width: number, lineCap: LineStyle['lineCap'], ...multipliers: number[]): string {
  const capExtendsDash = lineCap === 'round' || lineCap === 'square';
  return multipliers
    .map((value, index) => {
      let length = width * value;
      if (capExtendsDash && index % 2 === 0) {
        length = Math.max(length - width, 0.01);
      }

      return String(Number(length.toFixed(3)));
    })
    .join(' ');
}

function applyLinkAttributes(
  anchor: HTMLAnchorElement,
  target: Pick<SlideItem, 'href' | 'slideIndex' | 'navigationAction'> | Pick<TextFrame['paragraphs'][number]['runs'][number], 'href' | 'slideIndex' | 'navigationAction'>
): void {
  anchor.href = target.href ?? (target.slideIndex != null ? `#slide-${target.slideIndex + 1}` : `#action-${target.navigationAction ?? 'link'}`);
  if (target.href) {
    anchor.target = '_blank';
    anchor.rel = 'noreferrer noopener';
    anchor.setAttribute('referrerpolicy', 'no-referrer');
  } else {
    anchor.removeAttribute('target');
    anchor.removeAttribute('rel');
    anchor.removeAttribute('referrerpolicy');
  }
  if (target.slideIndex != null) {
    anchor.dataset.slideIndex = String(target.slideIndex);
  }
  if (target.navigationAction) {
    anchor.dataset.slideAction = target.navigationAction;
  }
}

function resolveBulletLabel(paragraph: TextFrame['paragraphs'][number], autoNumberState: number[]): string {
  if (!paragraph.bullet) {
    return '';
  }

  if (paragraph.bullet.char) {
    return resolveSymbolBulletLabel(paragraph.bullet.char, paragraph.bullet.fontFamily);
  }

  if (!paragraph.bullet.autoType) {
    return '';
  }

  const level = Math.max(0, paragraph.level ?? 0);
  autoNumberState.length = level + 1;
  const startAt = Math.max(1, paragraph.bullet.startAt ?? 1);
  const current = autoNumberState[level] == null ? startAt : autoNumberState[level] + 1;
  autoNumberState[level] = current;
  return formatAutoNumber(current, paragraph.bullet.autoType);
}

function resolveBulletColor(paragraph: TextFrame['paragraphs'][number], fallbackColor: string): string {
  if (!paragraph.bullet) {
    return fallbackColor;
  }

  if (paragraph.bullet.color) {
    return colorWithAlpha(paragraph.bullet.color, paragraph.bullet.colorAlpha);
  }

  return fallbackColor;
}

function resolveBulletFontStack(paragraph: TextFrame['paragraphs'][number], label: string): string | undefined {
  if (!paragraph.bullet) {
    return undefined;
  }

  if (isPortableBulletGlyph(label)) {
    return buildPortableBulletFontStack(label);
  }

  const fontFamily = paragraph.bullet.fontFamily;
  if (!fontFamily || !shouldApplyBulletFontFamily(paragraph, label)) {
    return undefined;
  }

  return buildFontFamilyStack(fontFamily, {
    symbol: true,
    sampleText: label
  });
}

function shouldApplyBulletFontFamily(paragraph: TextFrame['paragraphs'][number], label: string): boolean {
  const fontFamily = paragraph.bullet?.fontFamily;
  if (!fontFamily) {
    return false;
  }

  const sourceChar = paragraph.bullet?.char;
  if (sourceChar && sourceChar !== label) {
    return false;
  }

  return !isPortableBulletGlyph(label) || !isSymbolFont(fontFamily);
}

function isPortableBulletGlyph(label: string): boolean {
  if (!label) {
    return false;
  }

  return /^[\u2022\u25A0-\u25FF\u2713-\u2714\u27A2\u2460-\u2473\u2474-\u2487\u2488-\u249B]+[.)、．。]?$/.test(label);
}

function buildPortableBulletFontStack(sampleText: string): string {
  return buildFontFamilyStack(SYMBOL_FONT_STACK[0], {
    symbol: true,
    sampleText
  });
}

function buildEmojiFontStack(sampleText: string): string {
  return buildFontFamilyStack(EMOJI_FONT_STACK[0], {
    emoji: true,
    sampleText
  });
}

function resolveStandaloneSymbolLabel(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed || trimmed !== text) {
    return undefined;
  }
  if (isPortableBulletGlyph(trimmed) || isEmojiPresentationRun(trimmed)) {
    return trimmed;
  }
  return undefined;
}

function resolveStandaloneSymbolFontStack(text: string, fontFamily: string | undefined): string | undefined {
  const label = resolveStandaloneSymbolLabel(text);
  if (!label) {
    return undefined;
  }
  if (isEmojiPresentationRun(label)) {
    return buildEmojiFontStack(label);
  }
  if (isPortableBulletGlyph(label) || isSymbolFont(fontFamily ?? '')) {
    return buildPortableBulletFontStack(label);
  }
  return undefined;
}

function isEmojiPresentationRun(text: string): boolean {
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint === 0xfe0f || codePoint === 0x200d) {
      return true;
    }
    if (codePoint >= 0x1f000) {
      return true;
    }
    if ((codePoint >= 0x2600 && codePoint <= 0x26ff) || (codePoint >= 0x2700 && codePoint <= 0x27bf)) {
      return text.includes('\uFE0F');
    }
  }
  return false;
}

function createCustomBulletVisual(label: string, fontSize: number): SVGSVGElement | undefined {
  return createCustomSymbolVisual(label, fontSize);
}

function createCustomSymbolVisual(label: string, fontSize: number): SVGSVGElement | undefined {
  const type = resolveCustomSymbolVisualType(label);
  if (!type) {
    return undefined;
  }

  const size = Number(Math.max(fontSize * 0.92, 12).toFixed(3));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.style.display = 'block';
  svg.style.flex = '0 0 auto';
  svg.style.overflow = 'visible';

  const append = (node: SVGElement) => {
    node.setAttribute('fill', 'currentColor');
    svg.appendChild(node);
  };

  switch (type) {
    case 'square': {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', '2');
      rect.setAttribute('y', '2');
      rect.setAttribute('width', '12');
      rect.setAttribute('height', '12');
      append(rect);
      break;
    }
    case 'circle': {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', '8');
      circle.setAttribute('cy', '8');
      circle.setAttribute('r', '6');
      append(circle);
      break;
    }
    case 'circleOutline': {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', '8');
      circle.setAttribute('cy', '8');
      circle.setAttribute('r', '5.6');
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke', 'currentColor');
      circle.setAttribute('stroke-width', '1.65');
      svg.appendChild(circle);
      break;
    }
    case 'diamond': {
      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygon.setAttribute('points', '8,1.5 14.5,8 8,14.5 1.5,8');
      append(polygon);
      break;
    }
    case 'squareOutline': {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', '2.25');
      rect.setAttribute('y', '2.25');
      rect.setAttribute('width', '11.5');
      rect.setAttribute('height', '11.5');
      rect.setAttribute('fill', 'none');
      rect.setAttribute('stroke', 'currentColor');
      rect.setAttribute('stroke-width', '1.75');
      svg.appendChild(rect);
      break;
    }
    case 'check': {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M 2.5 8.5 L 6.4 12.2 L 13.5 3.6');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '2.2');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(path);
      break;
    }
    case 'arrow': {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M 1.5 8 L 9.5 8 L 9.5 4.6 L 14.5 8 L 9.5 11.4 L 9.5 8.9 L 1.5 8.9 Z');
      append(path);
      break;
    }
  }

  return svg;
}

function resolveCustomSymbolVisualType(
  label: string
): 'square' | 'circle' | 'circleOutline' | 'diamond' | 'squareOutline' | 'check' | 'arrow' | undefined {
  switch (label) {
    case '\u25A0':
      return 'square';
    case '\u25CF':
      return 'circle';
    case '\u25CB':
      return 'circleOutline';
    case '\u25C6':
      return 'diamond';
    case '\u25A1':
      return 'squareOutline';
    case '\u2714':
      return 'check';
    case '\u27A2':
      return 'arrow';
    default:
      return undefined;
  }
}

function formatAutoNumber(value: number, type: string): string {
  switch (type) {
    case 'circleNumDbPlain':
      return formatCircledNumber(value);
    case 'ea1JpnChsDbPeriod':
      return `${toCjkCounting(value)}.`;
    case 'arabicPlain':
      return `${value}`;
    case 'arabicParenR':
      return `${value})`;
    case 'arabicParenBoth':
      return `(${value})`;
    case 'alphaLcParenR':
      return `${toAlpha(value).toLowerCase()})`;
    case 'alphaLcParenBoth':
      return `(${toAlpha(value).toLowerCase()})`;
    case 'alphaLcPeriod':
      return `${toAlpha(value).toLowerCase()}.`;
    case 'alphaUcParenR':
      return `${toAlpha(value)})`;
    case 'alphaUcParenBoth':
      return `(${toAlpha(value)})`;
    case 'alphaUcPeriod':
      return `${toAlpha(value)}.`;
    case 'romanLcParenR':
      return `${toRoman(value).toLowerCase()})`;
    case 'romanLcParenBoth':
      return `(${toRoman(value).toLowerCase()})`;
    case 'romanLcPeriod':
      return `${toRoman(value).toLowerCase()}.`;
    case 'romanUcParenR':
      return `${toRoman(value)})`;
    case 'romanUcParenBoth':
      return `(${toRoman(value)})`;
    case 'romanUcPeriod':
      return `${toRoman(value)}.`;
    case 'arabicPeriod':
    default:
      return `${value}.`;
  }
}

function resolveSymbolBulletLabel(char: string, fontFamily?: string): string {
  const normalizedFont = normalizeLocalizedFontAlias(fontFamily ?? '').toLowerCase();
  if (normalizedFont.includes('wingdings')) {
    return resolveWingdingsBullet(char);
  }
  if (normalizedFont.includes('webdings')) {
    return resolveWebdingsBullet(char);
  }

  return char;
}

function resolveWingdingsBullet(char: string): string {
  switch (char) {
    case 'n':
      return '\u25A0';
    case 'l':
      return '\u25CF';
    case 'u':
      return '\u25C6';
    case 'p':
      return '\u25A1';
    case '\u00FC':
      return '\u2714';
    case '\u00D8':
      return '\u27A2';
    default:
      return WINGDINGS_BULLET_MAP[char] ?? char;
  }
}

function resolveWebdingsBullet(char: string): string {
  switch (char) {
    case '8':
      return '\u2022';
    case '=':
      return '\u25A0';
    case '>':
      return '\u25C6';
    default:
      return WEBDINGS_BULLET_MAP[char] ?? char;
  }
}

const WINGDINGS_BULLET_MAP: Record<string, string> = {
  n: '■',
  l: '●',
  u: '◆',
  p: '□',
  'ü': '✓',
  Ø: '➔'
};

const WEBDINGS_BULLET_MAP: Record<string, string> = {
  '8': '•',
  '=': '■',
  '>': '◆'
};

function formatCircledNumber(value: number): string {
  const circledNumbers = [
    '',
    '①',
    '②',
    '③',
    '④',
    '⑤',
    '⑥',
    '⑦',
    '⑧',
    '⑨',
    '⑩',
    '⑪',
    '⑫',
    '⑬',
    '⑭',
    '⑮',
    '⑯',
    '⑰',
    '⑱',
    '⑲',
    '⑳'
  ];

  return circledNumbers[value] ?? `${value}`;
}

function toCjkCounting(value: number): string {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (value <= 0) {
    return `${value}`;
  }
  if (value < 10) {
    return digits[value];
  }
  if (value === 10) {
    return '十';
  }
  if (value < 20) {
    return `十${digits[value % 10]}`;
  }
  if (value < 100) {
    const tens = Math.floor(value / 10);
    const ones = value % 10;
    return `${digits[tens]}十${ones ? digits[ones] : ''}`;
  }

  return `${value}`;
}

function describeLinkTarget(
  target: Pick<SlideItem, 'href' | 'slideIndex' | 'navigationAction'>,
  name?: string
): string {
  if (target.href) {
    return name ? `Open link: ${name}` : 'Open external link';
  }

  if (target.slideIndex != null) {
    return name ? `Go to slide ${target.slideIndex + 1}: ${name}` : `Go to slide ${target.slideIndex + 1}`;
  }

  switch (target.navigationAction) {
    case 'next':
      return 'Go to next slide';
    case 'previous':
      return 'Go to previous slide';
    case 'first':
      return 'Go to first slide';
    case 'last':
      return 'Go to last slide';
    case 'lastViewed':
      return 'Return to last viewed slide';
    default:
      return name ?? 'Linked slide item';
  }
}

function describeLinkTitle(target: Pick<SlideItem, 'href' | 'slideIndex' | 'navigationAction'>, name?: string): string {
  if (target.href) {
    return name ? `${name}: ${target.href}` : target.href;
  }

  return describeLinkTarget(target, name);
}

function percent(value: number): string {
  return `${Number(value.toFixed(6))}%`;
}

function escapeCssUrl(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

function toAlpha(value: number): string {
  let current = Math.max(1, Math.floor(value));
  let output = '';
  while (current > 0) {
    current -= 1;
    output = String.fromCharCode(65 + (current % 26)) + output;
    current = Math.floor(current / 26);
  }
  return output || 'A';
}

function toRoman(value: number): string {
  const numerals: Array<[number, string]> = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I']
  ];
  let current = Math.max(1, Math.floor(value));
  let output = '';
  for (const [amount, numeral] of numerals) {
    while (current >= amount) {
      output += numeral;
      current -= amount;
    }
  }
  return output || 'I';
}

function hasVisibleText(frame: TextFrame): boolean {
  return frame.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text.trim().length > 0));
}

function hasLinkedTextRuns(frame: TextFrame): boolean {
  return frame.paragraphs.some((paragraph) =>
    paragraph.runs.some((run) => Boolean(run.href || run.slideIndex != null || run.navigationAction))
  );
}

function tableHasLinkedRuns(item: Extract<SlideItem, { kind: 'table' }>): boolean {
  return item.cells.some((cell) => hasLinkedTextRuns(cell.textFrame));
}

function hasItemLink(item: SlideItem): boolean {
  return Boolean(item.href || item.slideIndex != null || item.navigationAction);
}

function applyLineMarkers(line: SVGLineElement, item: ShapeItem, stroke: string): SVGMarkerElement[] {
  const definitions: SVGMarkerElement[] = [];
  const strokeWidth = Math.max(item.line?.width ?? 1, 1);

  if (item.line?.headEnd && item.line.headEnd !== 'none') {
    const marker = createLineMarker(`${item.id}-head`, item.line.headEnd, stroke, strokeWidth);
    line.setAttribute('marker-start', `url(#${marker.id})`);
    definitions.push(marker);
  }

  if (item.line?.tailEnd && item.line.tailEnd !== 'none') {
    const marker = createLineMarker(`${item.id}-tail`, item.line.tailEnd, stroke, strokeWidth);
    line.setAttribute('marker-end', `url(#${marker.id})`);
    definitions.push(marker);
  }

  return definitions;
}

function createLineMarker(id: string, type: LineEndType, color: string, strokeWidth: number): SVGMarkerElement {
  const markerScale = resolveMarkerScale(type);
  const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  marker.id = id;
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('markerWidth', String(Number((markerScale * 2).toFixed(3))));
  marker.setAttribute('markerHeight', String(Number((markerScale * 2).toFixed(3))));
  marker.setAttribute('refX', String(resolveMarkerRefX(type)));
  marker.setAttribute('refY', '5');
  marker.setAttribute('orient', 'auto-start-reverse');
  marker.setAttribute('markerUnits', 'strokeWidth');

  const shape = createMarkerShape(type, color, strokeWidth);
  marker.appendChild(shape);
  return marker;
}

function resolveMarkerScale(type: LineEndType): number {
  switch (type) {
    case 'arrow':
      return 3;
    case 'oval':
      return 2.8;
    case 'diamond':
    case 'stealth':
    case 'triangle':
    default:
      return 2.4;
  }
}

function resolveMarkerRefX(type: LineEndType): number {
  switch (type) {
    case 'arrow':
      return 9.2;
    case 'stealth':
      return 8.8;
    case 'oval':
      return 7.6;
    case 'diamond':
      return 8.4;
    case 'triangle':
    default:
      return 8.6;
  }
}

function createMarkerShape(type: LineEndType, color: string, strokeWidth: number): SVGElement {
  switch (type) {
    case 'diamond': {
      const diamond = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      diamond.setAttribute('d', 'M 0 5 L 4 1 L 8 5 L 4 9 z');
      diamond.setAttribute('fill', color);
      return diamond;
    }
    case 'oval': {
      const oval = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      oval.setAttribute('cx', '4.5');
      oval.setAttribute('cy', '5');
      oval.setAttribute('r', '3');
      oval.setAttribute('fill', color);
      return oval;
    }
    case 'stealth': {
      const stealth = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      stealth.setAttribute('d', 'M 0 0 L 8 5 L 0 10 L 2.6 5 z');
      stealth.setAttribute('fill', color);
      return stealth;
    }
    case 'arrow': {
      const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      arrow.setAttribute('d', 'M 0 0 L 8 5 L 0 10');
      arrow.setAttribute('fill', 'none');
      arrow.setAttribute('stroke', color);
      arrow.setAttribute('stroke-width', String(Number(Math.max(strokeWidth * 0.9, 1.25).toFixed(3))));
      arrow.setAttribute('stroke-linecap', 'round');
      arrow.setAttribute('stroke-linejoin', 'round');
      return arrow;
    }
    case 'triangle':
    default: {
      const triangle = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      triangle.setAttribute('d', 'M 0 0 L 8 5 L 0 10 z');
      triangle.setAttribute('fill', color);
      return triangle;
    }
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
