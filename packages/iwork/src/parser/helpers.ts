import type {
  CustomShapeCommand,
  CustomShapeGeometry,
  FillStyle,
  GradientStop,
  ItemTransform,
  LineStyle,
  PaddingBox,
  ShadowStyle,
  TextFrame,
  TextParagraph,
  TextRun
} from '@filens/core';
import type { IworkArchiveIndex, IworkArchiveRecord } from '../types';

type AnyObject = Record<string, unknown>;

export function getRecord(archive: IworkArchiveIndex, refOrId: unknown): IworkArchiveRecord | undefined {
  const id = getRefId(refOrId);
  if (id == null) {
    return undefined;
  }
  return archive.records[String(id)];
}

export function getRecordValue<T = AnyObject>(archive: IworkArchiveIndex, refOrId: unknown): T | undefined {
  return getRecord(archive, refOrId)?.value as T | undefined;
}

export function getRefId(refOrId: unknown): number | undefined {
  if (typeof refOrId === 'number' && Number.isFinite(refOrId)) {
    return refOrId;
  }
  if (!refOrId || typeof refOrId !== 'object') {
    return undefined;
  }

  const identifier = readField(refOrId as AnyObject, ['identifier']);
  return typeof identifier === 'number' && Number.isFinite(identifier) ? identifier : undefined;
}

export function readField<T = unknown>(value: AnyObject | undefined, keys: string[]): T | undefined {
  if (!value) {
    return undefined;
  }
  for (const key of keys) {
    if (key in value) {
      return value[key] as T;
    }
  }
  return undefined;
}

export function asObject(value: unknown): AnyObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyObject) : undefined;
}

export function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function deepMerge<T>(parent: T | undefined, child: T | undefined): T | undefined {
  if (parent == null) {
    return child;
  }
  if (child == null) {
    return parent;
  }
  if (Array.isArray(parent) || Array.isArray(child)) {
    return child;
  }
  if (typeof parent !== 'object' || typeof child !== 'object') {
    return child;
  }

  const merged: AnyObject = { ...(parent as AnyObject) };
  for (const [key, value] of Object.entries(child as AnyObject)) {
    const existing = merged[key];
    if (existing && value && typeof existing === 'object' && typeof value === 'object' && !Array.isArray(existing) && !Array.isArray(value)) {
      merged[key] = deepMerge(existing as AnyObject, value as AnyObject);
    } else {
      merged[key] = value;
    }
  }
  return merged as T;
}

export function resolveMergedStyle(archive: IworkArchiveIndex, refOrId: unknown, seen = new Set<number>()): AnyObject | undefined {
  const record = getRecord(archive, refOrId);
  const value = asObject(record?.value);
  if (!value) {
    return undefined;
  }

  const id = record?.id;
  if (id != null) {
    if (seen.has(id)) {
      return value;
    }
    seen.add(id);
  }

  const parentRef = resolveStyleParentRef(value);
  const stylesheetRef = resolveStylesheetStyleRef(archive, value);

  const stylesheetValue = stylesheetRef ? resolveMergedStyle(archive, stylesheetRef, seen) : undefined;
  const parentValue = parentRef ? resolveMergedStyle(archive, parentRef, seen) : undefined;

  // Some iWork styles reference both an explicit parent chain and a stylesheet
  // identifier-backed style. Merge both so that we don't lose base properties
  // (e.g. Keynote shape fills) when a parent ref exists but is incomplete.
  const mergedBase = deepMerge(stylesheetValue, parentValue);
  return deepMerge(mergedBase, value);
}

function resolveStyleParentRef(value: AnyObject): unknown {
  let current: AnyObject | undefined = value;
  while (current) {
    const superStyle = asObject(readField(current, ['super']));
    if (!superStyle) {
      return undefined;
    }
    const parentRef = readField(superStyle, ['parent']);
    if (parentRef != null) {
      return parentRef;
    }
    current = superStyle;
  }
  return undefined;
}

function resolveStylesheetStyleRef(archive: IworkArchiveIndex, value: AnyObject): unknown {
  let current: AnyObject | undefined = value;
  while (current) {
    const styleIdentifier = readField<string>(current, ['styleIdentifier', 'style_identifier']);
    const stylesheetRef = readField(current, ['stylesheet', 'style_sheet']);
    if (styleIdentifier && stylesheetRef != null) {
      const stylesheet = getRecordValue<AnyObject>(archive, stylesheetRef);
      const styleRef = findStyleRefByIdentifier(stylesheet, styleIdentifier);
      if (styleRef != null) {
        return styleRef;
      }
    }
    current = asObject(readField(current, ['super']));
  }
  return undefined;
}

function findStyleRefByIdentifier(stylesheet: AnyObject | undefined, identifier: string): unknown {
  if (!stylesheet) {
    return undefined;
  }

  const direct = findStyleRefInIdentifierMap(readField(stylesheet, ['identifierToStyleMap', 'identifier_to_style_map']), identifier);
  if (direct != null) {
    return direct;
  }

  for (const value of Object.values(stylesheet)) {
    const versionedStyles = asObject(value);
    const styleRef = findStyleRefInIdentifierMap(
      readField(versionedStyles, ['identifierToStyleMap', 'identifier_to_style_map']),
      identifier
    );
    if (styleRef != null) {
      return styleRef;
    }
  }

  for (const styleRef of asArray(readField(stylesheet, ['styles']))) {
    const style = asObject(styleRef);
    const inlineIdentifier = style ? readField<string>(style, ['styleIdentifier', 'style_identifier']) : undefined;
    if (inlineIdentifier === identifier) {
      return styleRef;
    }
  }

  return undefined;
}

function findStyleRefInIdentifierMap(mapLike: unknown, identifier: string): unknown {
  for (const entry of asArray<AnyObject>(mapLike)) {
    if (readField<string>(entry, ['identifier']) === identifier) {
      return readField(entry, ['style']);
    }
  }
  return undefined;
}

export function colorToHex(colorLike: unknown, fallback = '#000000'): string {
  const color = asObject(colorLike);
  if (!color) {
    return fallback;
  }

  const red = normalizeColorChannel(readField<number>(color, ['r']) ?? 0);
  const green = normalizeColorChannel(readField<number>(color, ['g']) ?? 0);
  const blue = normalizeColorChannel(readField<number>(color, ['b']) ?? 0);
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

export function colorAlpha(colorLike: unknown): number | undefined {
  const color = asObject(colorLike);
  if (!color) {
    return undefined;
  }
  const alpha = readField<number>(color, ['a']);
  if (typeof alpha !== 'number') {
    return undefined;
  }
  return Number(Math.max(0, Math.min(1, alpha)).toFixed(4));
}

function normalizeColorChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value * 255)));
}

function toHex(value: number): string {
  return value.toString(16).padStart(2, '0');
}

export function fillFromValue(fillLike: unknown): FillStyle {
  const fill = asObject(fillLike);
  const image = fill && asObject(readField(fill, ['image']));
  const imageFill = image ? imageFillFromValue(image) : undefined;
  if (imageFill) {
    return imageFill;
  }

  const gradient = fill && asObject(readField(fill, ['gradient']));
  const gradientFill = gradient ? gradientFillFromValue(gradient) : undefined;
  if (gradientFill) {
    return gradientFill;
  }

  const color = fill && asObject(readField(fill, ['color']));
  const alpha = colorAlpha(color);
  if (!fill || !color || alpha === 0) {
    return {
      type: 'none'
    };
  }

  return {
    type: 'solid',
    color: colorToHex(color),
    alpha
  };
}

function gradientFillFromValue(gradient: AnyObject): FillStyle | undefined {
  const gradientOpacity = readFiniteUnitFloat(readField<number>(gradient, ['opacity']));
  const stops = asArray<AnyObject>(readField(gradient, ['stops']))
    .map((stop) => gradientStopFromValue(stop, gradientOpacity))
    .filter((stop): stop is GradientStop => Boolean(stop));
  if (!stops.length) {
    return undefined;
  }

  const type = Number(readField<number>(gradient, ['type']) ?? 0);
  if (type === 1) {
    return {
      type: 'gradient',
      gradientType: 'path',
      gradientPath: 'circle',
      stops
    };
  }

  const angleGradient = asObject(readField(gradient, ['anglegradient']));
  return {
    type: 'gradient',
    angle: Number(readField<number>(angleGradient, ['gradientangle']) ?? 0),
    stops
  };
}

function gradientStopFromValue(stop: AnyObject, gradientOpacity: number | undefined): GradientStop | undefined {
  const color = asObject(readField(stop, ['color']));
  const baseAlpha = colorAlpha(color);
  if (!color || baseAlpha == null || baseAlpha === 0) {
    return undefined;
  }

  const fraction = Number(readField<number>(stop, ['fraction']) ?? 0);
  const alpha =
    gradientOpacity == null
      ? baseAlpha
      : Number(Math.max(0, Math.min(1, baseAlpha * gradientOpacity)).toFixed(4));

  return {
    position: Number(Math.max(0, Math.min(1, fraction)).toFixed(4)),
    color: colorToHex(color),
    alpha
  };
}

function imageFillFromValue(image: AnyObject): FillStyle | undefined {
  const mediaId = readOptionalIdentifier(
    readField(image, ['imagedata', 'databaseImagedata', 'originalimagedata', 'databaseOriginalimagedata'])
  );
  if (!mediaId) {
    return undefined;
  }

  const technique = Number(readField<number>(image, ['technique']) ?? 0);
  const alpha = readFiniteUnitFloat(readField<number>(image, ['opacity']));
  return {
    type: 'picture',
    mediaId,
    alpha,
    tile: technique === 2
  };
}

function readOptionalIdentifier(value: unknown): string | undefined {
  const objectValue = asObject(value);
  const identifier = readField<number>(objectValue, ['identifier']);
  if (typeof identifier !== 'number' || !Number.isFinite(identifier) || identifier <= 0) {
    return undefined;
  }
  return String(identifier);
}

function readFiniteUnitFloat(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.min(1, value));
}

function readFinitePositiveNumber(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

export function lineFromValue(strokeLike: unknown): LineStyle | undefined {
  const stroke = asObject(strokeLike);
  const color = stroke && asObject(readField(stroke, ['color']));
  if (!stroke || !color || colorAlpha(color) === 0) {
    return undefined;
  }

  const baseAlpha = colorAlpha(color) ?? 1;
  const strokeOpacity = readFiniteUnitFloat(readField<number>(stroke, ['opacity']));
  const alpha =
    strokeOpacity == null ? baseAlpha : Number(Math.max(0, Math.min(1, baseAlpha * strokeOpacity)).toFixed(4));

  const pattern = asObject(readField(stroke, ['pattern']));
  const dashPattern = lineDashPattern(pattern);
  const dashOffset = dashPattern?.length
    ? readFiniteNumber(readField<number>(pattern, ['phase']))
    : undefined;

  return {
    color: colorToHex(color),
    alpha,
    width: Number(readField<number>(stroke, ['width']) ?? 1),
    dash: mapLineDash(pattern),
    dashPattern,
    dashOffset,
    lineCap: mapLineCap(readField<number>(stroke, ['cap'])),
    lineJoin: mapLineJoin(readField<number>(stroke, ['join'])),
    miterLimit: readFinitePositiveNumber(readField<number>(stroke, ['miterLimit', 'miter_limit']))
  };
}

function lineDashPattern(pattern: AnyObject | undefined): number[] | undefined {
  if (!pattern || Number(readField<number>(pattern, ['type']) ?? 1) !== 0) {
    return undefined;
  }

  const count = Math.max(0, Math.floor(Number(readField<number>(pattern, ['count']) ?? 0)));
  if (count <= 0) {
    return undefined;
  }

  const values = asArray<number>(readField(pattern, ['pattern']))
    .slice(0, count)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  return values.length ? values : undefined;
}

function readFiniteNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function mapLineDash(patternLike: unknown): LineStyle['dash'] {
  const pattern = asObject(patternLike);
  if (!pattern || Number(readField<number>(pattern, ['type']) ?? 1) !== 0) {
    return undefined;
  }

  const count = Math.max(0, Math.floor(Number(readField<number>(pattern, ['count']) ?? 0)));
  if (count <= 0) {
    return undefined;
  }

  const values = asArray<number>(readField(pattern, ['pattern']))
    .slice(0, count)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  if (values.length < 2) {
    return undefined;
  }

  if (values.length >= 6) {
    return isLongDash(values[0], values[1]) ? 'lgDashDotDot' : 'sysDashDotDot';
  }

  if (values.length >= 4) {
    return isLongDash(values[0], values[1]) ? 'lgDashDot' : 'dashDot';
  }

  if (isDotLikeDash(values[0], values[1])) {
    return 'dot';
  }

  return isLongDash(values[0], values[1]) ? 'lgDash' : 'dash';
}

function isDotLikeDash(onLength: number, offLength: number): boolean {
  return onLength <= 0.2 || onLength / Math.max(offLength, 0.0001) <= 0.2;
}

function isLongDash(onLength: number, offLength: number): boolean {
  return onLength / Math.max(offLength, 0.0001) >= 2.5;
}

function mapLineCap(value: number | undefined): LineStyle['lineCap'] {
  switch (value) {
    case 1:
      return 'round';
    case 2:
      return 'square';
    default:
      return 'butt';
  }
}

function mapLineJoin(value: number | undefined): LineStyle['lineJoin'] {
  switch (value) {
    case 1:
      return 'round';
    case 2:
      return 'bevel';
    default:
      return 'miter';
  }
}

export function shadowFromValue(shadowLike: unknown): ShadowStyle | undefined {
  const shadow = asObject(shadowLike);
  if (!shadow || readField<boolean>(shadow, ['isEnabled', 'is_enabled']) === false) {
    return undefined;
  }

  const color = asObject(readField(shadow, ['color']));
  const baseAlpha = colorAlpha(color);
  if (!color || baseAlpha === 0) {
    return undefined;
  }

  const shadowOpacity = readFiniteUnitFloat(readField<number>(shadow, ['opacity']));
  const alpha =
    shadowOpacity == null
      ? (baseAlpha ?? 1)
      : Number(Math.max(0, Math.min(1, (baseAlpha ?? 1) * shadowOpacity)).toFixed(4));
  if (alpha === 0) {
    return undefined;
  }

  const angle = Number(readField<number>(shadow, ['angle']) ?? 0);
  const distance = Number(readField<number>(shadow, ['offset']) ?? 0);
  const blur = Number(readField<number>(shadow, ['radius']) ?? 0);
  const radians = (angle * Math.PI) / 180;

  return {
    color: colorToHex(color),
    alpha,
    blur,
    distance,
    angle,
    offsetX: Number((Math.cos(radians) * distance).toFixed(3)),
    offsetY: Number((Math.sin(radians) * distance).toFixed(3))
  };
}

export function paddingFromValue(paddingLike: unknown, fallback = 4): PaddingBox {
  const padding = asObject(paddingLike);
  return {
    top: Number(readField<number>(padding, ['top']) ?? fallback),
    right: Number(readField<number>(padding, ['right']) ?? fallback),
    bottom: Number(readField<number>(padding, ['bottom']) ?? fallback),
    left: Number(readField<number>(padding, ['left']) ?? fallback)
  };
}

export function transformFromGeometry(geometryLike: unknown): ItemTransform {
  const geometry = asObject(geometryLike);
  const position = geometry && asObject(readField(geometry, ['position']));
  const size = geometry && asObject(readField(geometry, ['size']));
  return {
    x: Number(readField<number>(position, ['x']) ?? 0),
    y: Number(readField<number>(position, ['y']) ?? 0),
    width: Number(readField<number>(size, ['width']) ?? 1),
    height: Number(readField<number>(size, ['height']) ?? 1),
    rotation: Number(readField<number>(geometry, ['angle']) ?? 0),
    flipH: readField<boolean>(geometry, ['horizontalFlip', 'horizontal_flip']) === true,
    flipV: readField<boolean>(geometry, ['verticalFlip', 'vertical_flip']) === true
  };
}

export function verticalAlignFromValue(value: unknown): TextFrame['verticalAlign'] {
  switch (value) {
    case 1:
      return 'middle';
    case 2:
      return 'bottom';
    default:
      return 'top';
  }
}

export function paragraphAlignFromValue(value: unknown): TextParagraph['align'] {
  switch (value) {
    case 1:
      return 'right';
    case 2:
      return 'center';
    case 3:
      return 'justify';
    default:
      return 'left';
  }
}

export function pathSourceToGeometry(pathSourceLike: unknown, fallbackWidth: number, fallbackHeight: number): CustomShapeGeometry | undefined {
  const pathSource = asObject(pathSourceLike);
  if (!pathSource) {
    return undefined;
  }

  const bezierPathSource = asObject(readField(pathSource, ['bezierPathSource', 'bezier_path_source']));
  if (bezierPathSource) {
    const path = asObject(readField(bezierPathSource, ['path']));
    const naturalSize = asObject(readField(bezierPathSource, ['naturalSize', 'natural_size']));
    const width = Number(readField<number>(naturalSize, ['width']) ?? fallbackWidth);
    const height = Number(readField<number>(naturalSize, ['height']) ?? fallbackHeight);
    const pathString = readField<string>(bezierPathSource, ['pathString', 'path_string']);
    if (pathString) {
      const commands = parseSvgPathString(pathString);
      if (commands.length) {
        return customPathGeometry(width, height, commands);
      }
    }
    return pathToGeometry(
      path,
      width,
      height
    );
  }

  const connectionLinePathSource = asObject(readField(pathSource, ['connectionLinePathSource', 'connection_line_path_source']));
  if (connectionLinePathSource) {
    const superValue = asObject(readField(connectionLinePathSource, ['super']));
    const path = asObject(readField(superValue, ['path']));
    const naturalSize = asObject(readField(superValue, ['naturalSize', 'natural_size']));
    const width = Number(readField<number>(naturalSize, ['width']) ?? fallbackWidth);
    const height = Number(readField<number>(naturalSize, ['height']) ?? fallbackHeight);
    const pathString = readField<string>(superValue, ['pathString', 'path_string']);
    if (pathString) {
      const commands = parseSvgPathString(pathString);
      if (commands.length) {
        return customPathGeometry(width, height, commands);
      }
    }
    return pathToGeometry(
      path,
      width,
      height
    );
  }

  const editableBezierPathSource = asObject(readField(pathSource, ['editableBezierPathSource', 'editable_bezier_path_source']));
  if (editableBezierPathSource) {
    const naturalSize = asObject(readField(editableBezierPathSource, ['naturalSize', 'natural_size']));
    return editableBezierToGeometry(
      editableBezierPathSource,
      Number(readField<number>(naturalSize, ['width']) ?? fallbackWidth),
      Number(readField<number>(naturalSize, ['height']) ?? fallbackHeight)
    );
  }

  // Pencil annotations and a few older iWork records carry a TSP.Path
  // directly instead of wrapping it in a BezierPathSourceArchive.
  const directPath = asObject(readField(pathSource, ['path']));
  if (directPath) {
    const naturalSize = asObject(readField(pathSource, ['naturalSize', 'natural_size']));
    return pathToGeometry(
      directPath,
      Number(readField<number>(naturalSize, ['width']) ?? fallbackWidth),
      Number(readField<number>(naturalSize, ['height']) ?? fallbackHeight)
    );
  }

  if (asArray(readField(pathSource, ['elements'])).length) {
    return pathToGeometry(pathSource, fallbackWidth, fallbackHeight);
  }

  return undefined;
}

function customPathGeometry(width: number, height: number, commands: CustomShapeCommand[]): CustomShapeGeometry {
  return {
    type: 'custom',
    paths: [
      {
        width: Math.max(width, 1),
        height: Math.max(height, 1),
        commands
      }
    ]
  };
}

/** Parse the compact path strings emitted by newer Keynote versions. */
function parseSvgPathString(value: string): CustomShapeCommand[] {
  const tokens = value.match(/[a-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  const commands: CustomShapeCommand[] = [];
  let cursor = 0;
  let command = '';
  let currentX = 0;
  let currentY = 0;
  let subpathX = 0;
  let subpathY = 0;

  const readNumber = (): number | undefined => {
    const token = tokens[cursor];
    if (!token || /^[a-z]$/i.test(token)) {
      return undefined;
    }
    cursor += 1;
    const number = Number(token);
    return Number.isFinite(number) ? number : undefined;
  };

  while (cursor < tokens.length) {
    if (/^[a-z]$/i.test(tokens[cursor] ?? '')) {
      command = tokens[cursor++] ?? '';
    }
    if (!command) {
      cursor += 1;
      continue;
    }

    const relative = command === command.toLowerCase();
    const normalized = command.toUpperCase();
    if (normalized === 'Z') {
      commands.push({ type: 'Z' });
      currentX = subpathX;
      currentY = subpathY;
      command = '';
      continue;
    }

    const point = (x: number, y: number): [number, number] => [relative ? currentX + x : x, relative ? currentY + y : y];

    if (normalized === 'H' || normalized === 'V') {
      const coordinate = readNumber();
      if (coordinate == null) {
        command = '';
        continue;
      }
      const [x, y] = normalized === 'H'
        ? [relative ? currentX + coordinate : coordinate, currentY]
        : [currentX, relative ? currentY + coordinate : coordinate];
      commands.push({ type: 'L', x, y });
      currentX = x;
      currentY = y;
      continue;
    }

    const firstX = readNumber();
    const firstY = firstX == null ? undefined : readNumber();
    if (firstX == null || firstY == null) {
      command = '';
      continue;
    }

    if (normalized === 'M' || normalized === 'L') {
      const [x, y] = point(firstX, firstY);
      commands.push({ type: normalized === 'M' ? 'M' : 'L', x, y });
      currentX = x;
      currentY = y;
      if (normalized === 'M') {
        subpathX = x;
        subpathY = y;
        command = relative ? 'l' : 'L';
      }
      continue;
    }

    if (normalized === 'Q') {
      const controlX = firstX;
      const controlY = firstY;
      const endX = readNumber();
      const endY = endX == null ? undefined : readNumber();
      if (endX == null || endY == null) {
        command = '';
        continue;
      }
      const [x1, y1] = point(controlX, controlY);
      const [x, y] = point(endX, endY);
      commands.push({ type: 'Q', x1, y1, x, y });
      currentX = x;
      currentY = y;
      continue;
    }

    if (normalized === 'C') {
      const x2 = readNumber();
      const y2 = x2 == null ? undefined : readNumber();
      const x3 = y2 == null ? undefined : readNumber();
      const y3 = x3 == null ? undefined : readNumber();
      if (x2 == null || y2 == null || x3 == null || y3 == null) {
        command = '';
        continue;
      }
      const [x1, y1] = point(firstX, firstY);
      const [cx, cy] = point(x2, y2);
      const [x, y] = point(x3, y3);
      commands.push({ type: 'C', x1, y1, x2: cx, y2: cy, x, y });
      currentX = x;
      currentY = y;
      continue;
    }

    // Unsupported SVG commands (arcs/smooth curves) are skipped safely. The
    // archive's structured Path.Element representation remains the fallback.
    command = '';
  }

  return commands;
}

function pathToGeometry(pathLike: unknown, width: number, height: number): CustomShapeGeometry | undefined {
  const path = asObject(pathLike);
  const elements = asArray<AnyObject>(readField(path, ['elements']));
  if (!elements.length) {
    return undefined;
  }

  const commands: CustomShapeCommand[] = [];
  for (const element of elements) {
    const type = Number(readField<number>(element, ['type']) ?? 0);
    const points = asArray<AnyObject>(readField(element, ['points']));
    switch (type) {
      case 1:
        if (points[0]) {
          commands.push({
            type: 'M',
            x: Number(readField<number>(points[0], ['x']) ?? 0),
            y: Number(readField<number>(points[0], ['y']) ?? 0)
          });
        }
        break;
      case 2:
        if (points[0]) {
          commands.push({
            type: 'L',
            x: Number(readField<number>(points[0], ['x']) ?? 0),
            y: Number(readField<number>(points[0], ['y']) ?? 0)
          });
        }
        break;
      case 3:
        if (points[0] && points[1]) {
          commands.push({
            type: 'Q',
            x1: Number(readField<number>(points[0], ['x']) ?? 0),
            y1: Number(readField<number>(points[0], ['y']) ?? 0),
            x: Number(readField<number>(points[1], ['x']) ?? 0),
            y: Number(readField<number>(points[1], ['y']) ?? 0)
          });
        }
        break;
      case 4:
        if (points[0] && points[1] && points[2]) {
          commands.push({
            type: 'C',
            x1: Number(readField<number>(points[0], ['x']) ?? 0),
            y1: Number(readField<number>(points[0], ['y']) ?? 0),
            x2: Number(readField<number>(points[1], ['x']) ?? 0),
            y2: Number(readField<number>(points[1], ['y']) ?? 0),
            x: Number(readField<number>(points[2], ['x']) ?? 0),
            y: Number(readField<number>(points[2], ['y']) ?? 0)
          });
        }
        break;
      case 5:
        commands.push({
          type: 'Z'
        });
        break;
      default:
        break;
    }
  }

  if (!commands.length) {
    return undefined;
  }

  return customPathGeometry(width, height, commands);
}

function editableBezierToGeometry(source: AnyObject, fallbackWidth: number, fallbackHeight: number): CustomShapeGeometry | undefined {
  const subpaths = asArray<AnyObject>(readField(source, ['subpaths']));
  if (!subpaths.length) {
    return undefined;
  }

  const commands: CustomShapeCommand[] = [];
  for (const subpath of subpaths) {
    const nodes = asArray<AnyObject>(readField(subpath, ['nodes']));
    if (!nodes.length) {
      continue;
    }

    const first = asObject(readField(nodes[0], ['nodePoint', 'node_point']));
    if (!first) {
      continue;
    }

    commands.push({
      type: 'M',
      x: Number(readField<number>(first, ['x']) ?? 0),
      y: Number(readField<number>(first, ['y']) ?? 0)
    });

    for (let index = 1; index < nodes.length; index += 1) {
      const previous = nodes[index - 1];
      const current = nodes[index];
      const previousPoint = asObject(readField(previous, ['nodePoint', 'node_point']));
      const currentPoint = asObject(readField(current, ['nodePoint', 'node_point']));
      if (!previousPoint || !currentPoint) {
        continue;
      }

      const outControl = asObject(readField(previous, ['outControlPoint', 'out_control_point'])) ?? previousPoint;
      const inControl = asObject(readField(current, ['inControlPoint', 'in_control_point'])) ?? currentPoint;
      const isStraight =
        pointsEqual(outControl, previousPoint) &&
        pointsEqual(inControl, currentPoint);
      if (isStraight) {
        commands.push({
          type: 'L',
          x: Number(readField<number>(currentPoint, ['x']) ?? 0),
          y: Number(readField<number>(currentPoint, ['y']) ?? 0)
        });
      } else {
        commands.push({
          type: 'C',
          x1: Number(readField<number>(outControl, ['x']) ?? 0),
          y1: Number(readField<number>(outControl, ['y']) ?? 0),
          x2: Number(readField<number>(inControl, ['x']) ?? 0),
          y2: Number(readField<number>(inControl, ['y']) ?? 0),
          x: Number(readField<number>(currentPoint, ['x']) ?? 0),
          y: Number(readField<number>(currentPoint, ['y']) ?? 0)
        });
      }
    }

    if (readField<boolean>(subpath, ['closed'])) {
      commands.push({
        type: 'Z'
      });
    }
  }

  if (!commands.length) {
    return undefined;
  }

  return {
    type: 'custom',
    paths: [
      {
        width: fallbackWidth,
        height: fallbackHeight,
        commands
      }
    ]
  };
}

function pointsEqual(left: AnyObject | undefined, right: AnyObject | undefined): boolean {
  return Number(readField<number>(left, ['x']) ?? 0) === Number(readField<number>(right, ['x']) ?? 0) &&
    Number(readField<number>(left, ['y']) ?? 0) === Number(readField<number>(right, ['y']) ?? 0);
}

interface TextFrameOptions {
  defaultParagraphStyleRef?: unknown;
  verticalAlign?: TextFrame['verticalAlign'];
  padding?: PaddingBox;
  shapeProperties?: AnyObject;
  attachmentContext?: {
    pageNumber?: number;
    pageCount?: number;
    pageNumberText?: string;
    pageCountText?: string;
    documentName?: string;
  };
}

export function buildTextFrameFromStorage(
  archive: IworkArchiveIndex,
  storageRefOrValue: unknown,
  options: TextFrameOptions = {}
): TextFrame | undefined {
  const storage = asObject(
    storageRefOrValue && typeof storageRefOrValue === 'object' && !('identifier' in (storageRefOrValue as AnyObject))
      ? storageRefOrValue
      : getRecordValue(archive, storageRefOrValue)
  );
  if (!storage) {
    return undefined;
  }

  const text = asArray<string>(readField(storage, ['text'])).join('').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const attachmentTextMap = buildAttachmentTextMap(archive, storage, options.attachmentContext);
  const paragraphStarts = computeParagraphStarts(text);
  const paraStyleEntries = normalizeStyleEntries(readField(storage, ['tableParaStyle', 'table_para_style']), options.defaultParagraphStyleRef);
  const listStyleEntries = normalizeStyleEntries(readField(storage, ['tableListStyle', 'table_list_style']));
  const charStyleEntries = normalizeStyleEntries(readField(storage, ['tableCharStyle', 'table_char_style']));
  const implicitListStyleCounts = countImplicitListStyleParagraphs(
    archive,
    text,
    paragraphStarts,
    paraStyleEntries,
    listStyleEntries
  );
  const paragraphs: TextParagraph[] = [];

  for (let index = 0; index < paragraphStarts.length; index += 1) {
    const start = paragraphStarts[index];
    const end = paragraphStarts[index + 1] ?? text.length;
    const rawText = text.slice(start, end);
    const paragraphText = rawText.endsWith('\n') ? rawText.slice(0, -1) : rawText;
    const paragraphStyleRef = resolveActiveStyleRef(paraStyleEntries, start, true);
    const paragraphStyle = resolveMergedStyle(archive, paragraphStyleRef);
    const paragraphCharProps = asObject(readField(paragraphStyle, ['charProperties', 'char_properties']));
    const paraProps = asObject(readField(paragraphStyle, ['paraProperties', 'para_properties']));
    const runs = buildRunsForParagraph(archive, paragraphText, start, charStyleEntries, paragraphCharProps, attachmentTextMap);
    const defaultFontSize = resolveParagraphDefaultFontSize(runs, paragraphCharProps);
    const normalizedLevel = normalizeOutlineLevel(readField<number>(paraProps, ['outlineLevel', 'outline_level']));
    const listStyleRef = resolveParagraphListStyleRef(paraProps, listStyleEntries, start);
    const bullet = resolveParagraphBullet(
      archive,
      listStyleRef,
      normalizedLevel,
      paragraphText,
      paraProps,
      implicitListStyleCounts
    );
    const listIndent = bullet ? resolveParagraphListIndent(archive, listStyleRef, normalizedLevel, defaultFontSize) : undefined;
    const marginLeft = resolveParagraphIndentValue(readField<number>(paraProps, ['leftIndent', 'left_indent']), listIndent?.marginLeft);
    const indent = resolveParagraphIndentValue(readField<number>(paraProps, ['firstLineIndent', 'first_line_indent']), listIndent?.indent);
    const explicitSpaceAfter = Number(readField<number>(paraProps, ['spaceAfter', 'space_after']) ?? 0);

    paragraphs.push({
      align: paragraphAlignFromValue(readField(paraProps, ['alignment'])),
      level: normalizedLevel,
      bullet,
      marginLeft,
      indent,
      spaceBefore: Number(readField<number>(paraProps, ['spaceBefore', 'space_before']) ?? 0),
      spaceAfter: bullet && explicitSpaceAfter <= 0 ? 6 : explicitSpaceAfter,
      ...(archive.type === 'pages' ? { lineHeight: 1.2, lineHeightUnit: 'multiple' as const } : {}),
      runs: runs.length ? runs : [{ text: paragraphText }]
    });
  }

  const direction = textDirectionFromShapeProperties(options.shapeProperties);
  const columns = columnCountFromShapeProperties(options.shapeProperties);
  const autofit = textAutofitFromShapeProperties(options.shapeProperties);
  return {
    paragraphs,
    verticalAlign: options.verticalAlign ?? 'top',
    padding: options.padding ?? paddingFromValue(undefined),
    wrap: 'square',
    ...(direction ? { direction } : {}),
    ...(columns != null ? { columns } : {}),
    ...(autofit ? { autofit } : {})
  };
}

function textDirectionFromShapeProperties(shapeProperties: AnyObject | undefined): TextFrame['direction'] | undefined {
  if (!shapeProperties) {
    return undefined;
  }
  if (readField(shapeProperties, ['verticalText40', 'vertical_text_40']) === true) {
    return 'vertical270';
  }
  if (readField(shapeProperties, ['verticalText', 'vertical_text']) === true) {
    return 'vertical';
  }
  return undefined;
}

function columnCountFromShapeProperties(shapeProperties: AnyObject | undefined): number | undefined {
  const columns = asObject(readField(shapeProperties, ['columns']));
  const equalColumns = asObject(readField(columns, ['equalColumns', 'equal_columns']));
  const count = Number(readField<number>(equalColumns, ['count']) ?? NaN);
  if (!Number.isFinite(count) || count <= 1) {
    return undefined;
  }
  return Math.max(2, Math.round(count));
}

function textAutofitFromShapeProperties(shapeProperties: AnyObject | undefined): TextFrame['autofit'] | undefined {
  return readField(shapeProperties, ['shrinkToFit', 'shrink_to_fit']) === true
    ? { type: 'normal' }
    : undefined;
}

function computeParagraphStarts(text: string): number[] {
  if (!text.length) {
    return [0];
  }

  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n' && index + 1 < text.length) {
      starts.push(index + 1);
    }
  }
  return starts;
}

function normalizeStyleEntries(styleTableLike: unknown, leadingRef?: unknown): Array<{ index: number; refId?: number }> {
  const table = asObject(styleTableLike);
  const entries = asArray<AnyObject>(readField(table, ['entries'])).map((entry) => ({
    index: Number(readField<number>(entry, ['characterIndex', 'character_index']) ?? 0),
    refId: getRefId(readField(entry, ['object']))
  }));

  if (leadingRef != null) {
    entries.unshift({
      index: 0,
      refId: getRefId(leadingRef)
    });
  }

  return entries.sort((left, right) => left.index - right.index);
}

function resolveActiveStyleRef(
  entries: Array<{ index: number; refId?: number }>,
  offset: number,
  preservePreviousOnEmpty = false
): number | undefined {
  let active: number | undefined;
  for (const entry of entries) {
    if (entry.index > offset) {
      break;
    }
    if (preservePreviousOnEmpty && entry.refId == null) {
      continue;
    }
    active = entry.refId;
  }
  return active;
}

function buildRunsForParagraph(
  archive: IworkArchiveIndex,
  paragraphText: string,
  paragraphStart: number,
  entries: Array<{ index: number; refId?: number }>,
  baseCharProps: AnyObject | undefined,
  attachmentTextMap: Map<number, string[]>
): TextRun[] {
  if (!paragraphText.length) {
    return [{ text: '' }];
  }

  const boundaries = new Set<number>([paragraphStart, paragraphStart + paragraphText.length]);
  for (const entry of entries) {
    if (entry.index > paragraphStart && entry.index < paragraphStart + paragraphText.length) {
      boundaries.add(entry.index);
    }
  }

  const sorted = Array.from(boundaries).sort((left, right) => left - right);
  const runs: TextRun[] = [];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const start = sorted[index];
    const end = sorted[index + 1];
    const text = expandAttachmentText(
      paragraphText.slice(start - paragraphStart, end - paragraphStart),
      start,
      attachmentTextMap
    );
    const refId = resolveActiveStyleRef(entries, start);
    const charStyle = resolveMergedStyle(archive, refId);
    const charProps = deepMerge(baseCharProps, asObject(readField(charStyle, ['charProperties', 'char_properties'])));
    if (!text.length && paragraphText.length) {
      continue;
    }
    runs.push(buildTextRun(text, charProps));
  }

  return runs;
}

function resolveParagraphDefaultFontSize(runs: TextRun[], paragraphCharProps: AnyObject | undefined): number {
  for (const run of runs) {
    if (typeof run.fontSize === 'number' && run.fontSize > 0) {
      return run.fontSize;
    }
  }
  const fontSize = readField<number>(paragraphCharProps, ['fontSize', 'font_size']);
  return typeof fontSize === 'number' && fontSize > 0 ? Number(fontSize) : 16;
}

function resolveParagraphIndentValue(explicitValue: number | undefined, fallbackValue: number | undefined): number {
  if (typeof explicitValue === 'number' && Number.isFinite(explicitValue) && explicitValue !== 0) {
    return Number(explicitValue);
  }
  if (typeof fallbackValue === 'number' && Number.isFinite(fallbackValue)) {
    return Number(fallbackValue);
  }
  if (typeof explicitValue === 'number' && Number.isFinite(explicitValue)) {
    return Number(explicitValue);
  }
  return 0;
}

function normalizeOutlineLevel(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 8) {
    return 0;
  }
  return Math.trunc(value);
}

function resolveParagraphListStyleRef(
  paraProps: AnyObject | undefined,
  listStyleEntries: Array<{ index: number; refId?: number }>,
  offset: number
): unknown {
  if (readField<boolean>(paraProps, ['listStyleNull', 'list_style_null'])) {
    return undefined;
  }

  return resolveActiveStyleRef(listStyleEntries, offset) ?? readField(paraProps, ['listStyle', 'list_style']);
}

function resolveParagraphBullet(
  archive: IworkArchiveIndex,
  listStyleRef: unknown,
  level: number,
  paragraphText: string,
  paraProps: AnyObject | undefined,
  implicitListStyleCounts: Map<number, number>
): TextParagraph['bullet'] | undefined {
  const listStyle = resolveMergedStyle(archive, listStyleRef);
  if (!listStyle) {
    return undefined;
  }

  const labelTypes = asArray<number>(readField(listStyle, ['labelTypes', 'label_types']));
  const labelType = labelTypes[level] ?? labelTypes[0];
  const implicitBullet = labelType == null && paragraphSupportsImplicitBullet(
    archive,
    listStyleRef,
    paragraphText,
    paraProps,
    implicitListStyleCounts
  );
  if (labelType == null && !implicitBullet) {
    return undefined;
  }

  const fontFamily = readField<string>(listStyle, ['fontName', 'font_name']);
  const colorValue = readField(listStyle, ['fontColor', 'font_color']);
  const color = colorToHex(colorValue, '#111827');
  const colorOpacity = colorAlpha(colorValue);
  const baseBullet = {
    fontFamily: typeof fontFamily === 'string' && fontFamily.trim().length ? fontFamily : undefined,
    color: isMeaningfulColorValue(colorValue) ? color : undefined,
    colorAlpha: isMeaningfulColorValue(colorValue) ? colorOpacity : undefined
  };

  if (implicitBullet) {
    return {
      ...baseBullet,
      char: '•'
    };
  }

  if (labelType === 2) {
    const strings = asArray<string>(readField(listStyle, ['strings']));
    const bulletChar = strings[level] ?? strings[0];
    if (!bulletChar) {
      return undefined;
    }
    return {
      ...baseBullet,
      char: bulletChar
    };
  }

  if (labelType === 3) {
    const numberTypes = asArray<number>(readField(listStyle, ['numberTypes', 'number_types']));
    return {
      ...baseBullet,
      autoType: mapListNumberTypeToAutoType(numberTypes[level] ?? numberTypes[0] ?? 0),
      startAt: 1
    };
  }

  return undefined;
}

function countImplicitListStyleParagraphs(
  archive: IworkArchiveIndex,
  text: string,
  paragraphStarts: number[],
  paraStyleEntries: Array<{ index: number; refId?: number }>,
  listStyleEntries: Array<{ index: number; refId?: number }>
): Map<number, number> {
  const counts = new Map<number, number>();
  if (archive.type !== 'pages') {
    return counts;
  }

  for (let index = 0; index < paragraphStarts.length; index += 1) {
    const start = paragraphStarts[index];
    const end = paragraphStarts[index + 1] ?? text.length;
    const paragraphText = text.slice(start, end).replace(/\n$/, '');
    if (!hasMeaningfulParagraphText(paragraphText)) {
      continue;
    }

    const paragraphStyleRef = resolveActiveStyleRef(paraStyleEntries, start, true);
    const paragraphStyle = resolveMergedStyle(archive, paragraphStyleRef);
    const paraProps = asObject(readField(paragraphStyle, ['paraProperties', 'para_properties']));
    const listStyleRef = resolveParagraphListStyleRef(paraProps, listStyleEntries, start);
    const listStyleId = getRefId(listStyleRef);
    const listStyle = resolveMergedStyle(archive, listStyleRef);
    const labelTypes = asArray<number>(readField(listStyle, ['labelTypes', 'label_types']));
    if (listStyleId == null || !listStyle || labelTypes.length) {
      continue;
    }
    counts.set(listStyleId, (counts.get(listStyleId) ?? 0) + 1);
  }

  return counts;
}

function paragraphSupportsImplicitBullet(
  archive: IworkArchiveIndex,
  listStyleRef: unknown,
  paragraphText: string,
  paraProps: AnyObject | undefined,
  implicitListStyleCounts: Map<number, number>
): boolean {
  if (archive.type !== 'pages' || !hasMeaningfulParagraphText(paragraphText)) {
    return false;
  }

  const listStyleId = getRefId(listStyleRef);
  if (listStyleId == null) {
    return false;
  }
  if ((implicitListStyleCounts.get(listStyleId) ?? 0) > 1) {
    return true;
  }

  const firstLineIndent = Number(readField<number>(paraProps, ['firstLineIndent', 'first_line_indent']) ?? 0);
  const leftIndent = Number(readField<number>(paraProps, ['leftIndent', 'left_indent']) ?? 0);
  if (Math.abs(firstLineIndent) > 0.001 || Math.abs(leftIndent) > 0.001) {
    return true;
  }

  const spaceBefore = Number(readField<number>(paraProps, ['spaceBefore', 'space_before']) ?? 0);
  const spaceAfter = Number(readField<number>(paraProps, ['spaceAfter', 'space_after']) ?? 0);
  return Math.abs(spaceBefore) <= 0.001 && Math.abs(spaceAfter) <= 0.001;
}

function hasMeaningfulParagraphText(text: string): boolean {
  return text.replace(/[\u0000-\u0020\u00a0\uFFFC]/g, '').length > 0;
}

function resolveParagraphListIndent(
  archive: IworkArchiveIndex,
  listStyleRef: unknown,
  level: number,
  fontSize: number
): { marginLeft: number; indent: number } | undefined {
  const listStyle = resolveMergedStyle(archive, listStyleRef);
  if (!listStyle) {
    return undefined;
  }

  const indents = asArray<number>(readField(listStyle, ['indents']));
  const textIndents = asArray<number>(readField(listStyle, ['textIndents', 'text_indents']));
  const marginLeft = Number(indents[level] ?? indents[0] ?? 0);
  const textIndentEm = Number(textIndents[level] ?? textIndents[0] ?? 0);
  if (!Number.isFinite(marginLeft) || marginLeft <= 0) {
    return undefined;
  }

  const hangingIndent = Number((textIndentEm * fontSize).toFixed(3));
  return {
    marginLeft,
    indent: hangingIndent > 0 ? -hangingIndent : 0
  };
}

function mapListNumberTypeToAutoType(value: number): string {
  switch (value) {
    case 1:
      return 'arabicParenBoth';
    case 2:
      return 'arabicParenR';
    case 3:
      return 'romanUcPeriod';
    case 4:
      return 'romanUcParenBoth';
    case 5:
      return 'romanUcParenR';
    case 6:
      return 'romanLcPeriod';
    case 7:
      return 'romanLcParenBoth';
    case 8:
      return 'romanLcParenR';
    case 9:
      return 'alphaUcPeriod';
    case 10:
      return 'alphaUcParenBoth';
    case 11:
      return 'alphaUcParenR';
    case 12:
      return 'alphaLcPeriod';
    case 13:
      return 'alphaLcParenBoth';
    case 14:
      return 'alphaLcParenR';
    case 48:
      return 'circleNumDbPlain';
    case 15:
    case 18:
    case 21:
    case 24:
    case 27:
    case 30:
    case 33:
    case 36:
    case 39:
    case 42:
      return 'ea1JpnChsDbPeriod';
    case 0:
    default:
      return 'arabicPeriod';
  }
}

function isMeaningfulColorValue(colorValue: unknown): boolean {
  const color = asObject(colorValue);
  return Boolean(color && colorAlpha(color) !== 0);
}

function buildAttachmentTextMap(
  archive: IworkArchiveIndex,
  storage: AnyObject,
  context: TextFrameOptions['attachmentContext']
): Map<number, string[]> {
  const map = new Map<number, string[]>();
  for (const entry of collectStorageObjectAttributeEntries(storage, [
    'tableAttachment',
    'table_attachment',
    'tableSmartfield',
    'table_smartfield',
    'tableBookmark',
    'table_bookmark',
    'tableFootnote',
    'table_footnote',
    'tableRubyfield',
    'table_rubyfield'
  ])) {
    const characterIndex = Number(readField<number>(entry, ['characterIndex', 'character_index']) ?? -1);
    if (characterIndex < 0) {
      continue;
    }
    const text = resolveAttachmentText(archive, readField(entry, ['object']), context);
    if (text == null) {
      continue;
    }
    const current = map.get(characterIndex) ?? [];
    current.push(text);
    map.set(characterIndex, current);
  }
  return map;
}

export function collectStorageObjectAttributeEntries(
  storage: AnyObject | undefined,
  tableNames: string[]
): AnyObject[] {
  if (!storage) {
    return [];
  }
  const entryTables = tableNames.map((tableName) => readField(storage, [tableName]));
  return entryTables.flatMap((table) => asArray<AnyObject>(readField(asObject(table), ['entries'])));
}

function resolveAttachmentText(
  archive: IworkArchiveIndex,
  refOrId: unknown,
  context: TextFrameOptions['attachmentContext']
): string | undefined {
  const record = getRecord(archive, refOrId);
  const value = asObject(record?.value);
  if (!record || !value) {
    return undefined;
  }

  switch (record.typeName) {
    case 'TSWP.NumberAttachmentArchive':
      return resolveTextualAttachmentText(
        asObject(readField(value, ['super'])),
        context,
        readField<string>(value, ['stringValue', 'string_value'])
      );
    case 'TSWP.FootnoteReferenceAttachmentArchive':
      return (
        normalizeAttachmentText(readField<string>(value, ['customMarkString', 'custom_mark_string'])) ??
        resolveTextualAttachmentText(asObject(readField(value, ['super'])), context)
      );
    case 'KN.SlideNumberAttachmentArchive':
      return resolveTextualAttachmentText(asObject(readField(value, ['super'])), context);
    case 'TSWP.TSWPTOCPageNumberAttachmentArchive':
      return (
        readField<string>(value, ['pageNumber', 'page_number']) ??
        resolveTextualAttachmentText(asObject(readField(value, ['super'])), context)
      );
    case 'TSWP.TextualAttachmentArchive':
      return resolveTextualAttachmentText(value, context);
    case 'TSWP.HyperlinkFieldArchive':
      return resolveSmartFieldString(value, ['urlRef', 'url_ref']);
    case 'TSWP.UnsupportedHyperlinkFieldArchive':
      return resolveSmartFieldString(value, ['urlOriginalRef', 'url_original_ref', 'urlRef', 'url_ref', 'scriptTag', 'script_tag']);
    case 'TSWP.BookmarkFieldArchive':
      return resolveSmartFieldString(value, ['name']);
    case 'TSWP.BibliographySmartFieldArchive':
    case 'TSWP.CitationSmartFieldArchive':
      return resolveCitationSmartFieldText(archive, value);
    case 'TSWP.DateTimeSmartFieldArchive':
      return resolveDateTimeSmartFieldText(value);
    case 'TSWP.MergeSmartFieldArchive':
      return resolveSmartFieldString(value, [
        'contactsLabel',
        'contacts_label',
        'contactsProperty',
        'contacts_property',
        'contactsKey',
        'contacts_key',
        'tableKey',
        'table_key',
        'scriptTag',
        'script_tag'
      ]);
    case 'TSWP.TOCSmartFieldArchive':
      return resolveTocSmartFieldText(value);
    case 'TSWP.RubyFieldArchive':
      return resolveSmartFieldString(value, ['rubyText', 'ruby_text']);
    case 'TSWP.FilenameSmartFieldArchive':
      return resolveFilenameSmartFieldText(archive, value, context);
    case 'TSWP.PlaceholderSmartFieldArchive':
      return resolveSmartFieldString(value, ['scriptTag', 'script_tag']);
    default:
      return undefined;
  }
}

function resolveTextualAttachmentText(
  attachment: AnyObject | undefined,
  context: TextFrameOptions['attachmentContext'],
  explicitText?: string
): string {
  const fromExplicit = typeof explicitText === 'string' ? explicitText : undefined;
  const fromEquivalent = typeof readField<string>(attachment, ['stringEquivalent', 'string_equivalent']) === 'string'
    ? readField<string>(attachment, ['stringEquivalent', 'string_equivalent'])
    : undefined;
  const directText = fromExplicit ?? fromEquivalent;
  if (directText && directText.length) {
    return directText;
  }

  switch (Number(readField<number>(attachment, ['kind']) ?? 0)) {
    case 0:
      return String(context?.pageNumberText ?? context?.pageNumber ?? 1);
    case 1:
      return String(context?.pageCountText ?? context?.pageCount ?? 1);
    case 2:
      return '*';
    default:
      return '';
  }
}

function resolveSmartFieldString(value: AnyObject | undefined, fieldNames: string[]): string | undefined {
  if (!value) {
    return undefined;
  }

  const explicit = findSmartFieldString(value, fieldNames);
  if (explicit) {
    return explicit;
  }

  return findSmartFieldString(value, [
    'stringValue',
    'string_value',
    'stringEquivalent',
    'string_equivalent',
    'displayName',
    'display_name',
    'name',
    'bookmarkName',
    'bookmark_name',
    'urlOriginalRef',
    'url_original_ref',
    'urlRef',
    'url_ref',
    'scriptTag',
    'script_tag'
  ]);
}

function findSmartFieldString(
  value: AnyObject | undefined,
  fieldNames: string[],
  seen = new Set<AnyObject>()
): string | undefined {
  if (!value || seen.has(value)) {
    return undefined;
  }
  seen.add(value);

  for (const fieldName of fieldNames) {
    const candidate = normalizeAttachmentText(readField<string>(value, [fieldName]));
    if (candidate) {
      return candidate;
    }
  }

  return (
    findSmartFieldString(asObject(readField(value, ['super'])), fieldNames, seen) ??
    findSmartFieldString(asObject(readField(value, ['oldSuper', 'old_super'])), fieldNames, seen)
  );
}

function resolveDateTimeSmartFieldText(value: AnyObject | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const directText = resolveSmartFieldString(value, ['stringValue', 'string_value', 'stringEquivalent', 'string_equivalent']);
  if (directText) {
    return directText;
  }

  const date = tspDateToUtcDate(asObject(readField(value, ['date'])));
  if (!date) {
    return resolveSmartFieldString(value, ['format', 'scriptTag', 'script_tag']);
  }

  const format = normalizeAttachmentText(readField<string>(value, ['format']));
  if (format) {
    const formatted = formatAppleDatePattern(date, format, readField<string>(value, ['localeIdentifier', 'locale_identifier']));
    if (formatted) {
      return formatted;
    }
  }

  const styleFormatted = formatDateTimeSmartFieldStyles(
    date,
    Number(readField<number>(value, ['dateStyle', 'date_style']) ?? 0),
    Number(readField<number>(value, ['timeStyle', 'time_style']) ?? 0),
    readField<string>(value, ['localeIdentifier', 'locale_identifier'])
  );
  if (styleFormatted) {
    return styleFormatted;
  }

  return defaultUtcDateTimeText(date);
}

function resolveCitationSmartFieldText(
  archive: IworkArchiveIndex,
  value: AnyObject | undefined
): string | undefined {
  if (!value) {
    return undefined;
  }

  const records = asArray<unknown>(readField(value, ['citationRecords', 'citation_records']))
    .map((recordRef) => getRecordValue<AnyObject>(archive, recordRef))
    .filter((record): record is AnyObject => Boolean(record));
  const renderedRecords = records
    .map((record) => formatCitationRecord(record))
    .filter((recordText): recordText is string => Boolean(recordText));
  if (renderedRecords.length) {
    return renderedRecords.join('; ');
  }

  return resolveSmartFieldString(value, ['scriptTag', 'script_tag']);
}

function resolveFilenameSmartFieldText(
  archive: IworkArchiveIndex,
  value: AnyObject | undefined,
  context: TextFrameOptions['attachmentContext']
): string | undefined {
  const documentName = normalizeDocumentName(
    context?.documentName ??
    archive.sourceName ??
    resolvePackageDocumentName(archive.packageMetadata)
  );
  if (documentName) {
    return documentName;
  }

  return resolveSmartFieldString(value, ['displayName', 'display_name', 'name', 'scriptTag', 'script_tag']);
}

function formatCitationRecord(record: AnyObject | undefined): string | undefined {
  if (!record) {
    return undefined;
  }

  const prefix = normalizeAttachmentText(readField<string>(record, ['prefix']));
  const suffix = normalizeAttachmentText(readField<string>(record, ['suffix']));
  const pageRange = normalizeAttachmentText(readField<string>(record, ['pageRange', 'page_range']));
  const title = normalizeAttachmentText(readField<string>(record, ['title']));
  const authors = Boolean(readField<boolean>(record, ['hideAuthorNames', 'hide_author_names']))
    ? undefined
    : normalizeAttachmentText(readField<string>(record, ['authorsString', 'authors_string']));
  const year = Boolean(readField<boolean>(record, ['hideYear', 'hide_year']))
    ? undefined
    : normalizeAttachmentText(readField<string>(record, ['year']));

  const segments = [authors, year, title, pageRange].filter((segment): segment is string => Boolean(segment));
  const body = segments.join(', ');
  const text = [prefix, body, suffix].filter((segment): segment is string => Boolean(segment)).join(' ');
  return text || undefined;
}

function resolveTocSmartFieldText(value: AnyObject | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const entries = asArray<AnyObject>(readField(value, ['tocEntries', 'toc_entries']));
  const bookmarkNames = Array.from(
    new Set(
      entries
        .map((entry) => normalizeAttachmentText(readField<string>(entry, ['bookmarkName', 'bookmark_name'])))
        .filter((bookmarkName): bookmarkName is string => Boolean(bookmarkName))
    )
  );
  if (bookmarkNames.length) {
    return bookmarkNames.join(', ');
  }

  return resolveSmartFieldString(value, ['scriptTag', 'script_tag']);
}

function resolvePackageDocumentName(packageMetadata: unknown): string | undefined {
  const metadata = asObject(packageMetadata);
  if (!metadata) {
    return undefined;
  }

  const candidates = [
    readField<string>(metadata, ['displayName', 'display_name']),
    readField<string>(metadata, ['preferredFileName', 'preferred_file_name']),
    readField<string>(metadata, ['fileName', 'file_name']),
    ...asArray<AnyObject>(readField(metadata, ['datas'])).flatMap((item) => [
      readField<string>(item, ['displayName', 'display_name']),
      readField<string>(item, ['preferredFileName', 'preferred_file_name']),
      readField<string>(item, ['fileName', 'file_name']),
      readField<string>(item, ['documentResourceLocator', 'document_resource_locator']),
      readField<string>(item, ['appRelativePath', 'app_relative_path'])
    ])
  ];

  for (const candidate of candidates) {
    const normalized = normalizeDocumentName(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

function normalizeDocumentName(value: string | undefined): string | undefined {
  const normalized = normalizeAttachmentText(value);
  if (!normalized) {
    return undefined;
  }

  const basename = normalized.split(/[\\/]/).filter(Boolean).at(-1) ?? normalized;
  return basename.replace(/\.(key|pages|numbers)$/i, '') || basename;
}

function normalizeAttachmentText(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  return normalized.length ? normalized : undefined;
}

const APPLE_REFERENCE_DATE_MS = Date.UTC(2001, 0, 1, 0, 0, 0);

function tspDateToUtcDate(value: AnyObject | undefined): Date | undefined {
  const seconds = readField<number>(value, ['seconds']);
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    return undefined;
  }

  return new Date(APPLE_REFERENCE_DATE_MS + seconds * 1000);
}

function formatDateTimeSmartFieldStyles(
  date: Date,
  dateStyle: number,
  timeStyle: number,
  localeIdentifier: string | undefined
): string | undefined {
  const resolvedDateStyle = mapDateTimeFormatterStyle(dateStyle);
  const resolvedTimeStyle = mapDateTimeFormatterStyle(timeStyle);
  if (!resolvedDateStyle && !resolvedTimeStyle) {
    return undefined;
  }

  try {
    return new Intl.DateTimeFormat(normalizeLocaleIdentifier(localeIdentifier), {
      timeZone: 'UTC',
      ...(resolvedDateStyle ? { dateStyle: resolvedDateStyle } : {}),
      ...(resolvedTimeStyle ? { timeStyle: resolvedTimeStyle } : {})
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      ...(resolvedDateStyle ? { dateStyle: resolvedDateStyle } : {}),
      ...(resolvedTimeStyle ? { timeStyle: resolvedTimeStyle } : {})
    }).format(date);
  }
}

function mapDateTimeFormatterStyle(value: number): 'short' | 'medium' | 'long' | 'full' | undefined {
  switch (value) {
    case 1:
      return 'short';
    case 2:
      return 'medium';
    case 3:
      return 'long';
    case 4:
      return 'full';
    default:
      return undefined;
  }
}

function normalizeLocaleIdentifier(value: string | undefined): string {
  const normalized = normalizeAttachmentText(value)?.replace(/_/g, '-');
  return normalized || 'en-US';
}

function formatAppleDatePattern(date: Date, pattern: string, localeIdentifier: string | undefined): string {
  const locale = normalizeLocaleIdentifier(localeIdentifier);
  const tokenMatchers = [
    'QQQQQ',
    'QQQQ',
    'QQQ',
    'QQ',
    'Q',
    'yyyy',
    'YYYY',
    'yy',
    'YY',
    'LLLLL',
    'MMMMM',
    'LLLL',
    'MMMM',
    'LLL',
    'MMM',
    'LL',
    'L',
    'MM',
    'M',
    'DDD',
    'DD',
    'dd',
    'd',
    'EEEEE',
    'EEEE',
    'EEE',
    'EE',
    'E',
    'ww',
    'w',
    'HH',
    'H',
    'hh',
    'h',
    'mm',
    'm',
    'ss',
    's',
    'a'
  ];

  let output = '';
  let index = 0;
  while (index < pattern.length) {
    const char = pattern[index];
    if (char === "'") {
      if (pattern[index + 1] === "'") {
        output += "'";
        index += 2;
        continue;
      }

      const end = pattern.indexOf("'", index + 1);
      if (end < 0) {
        output += pattern.slice(index + 1);
        break;
      }
      output += pattern.slice(index + 1, end);
      index = end + 1;
      continue;
    }

    const token = tokenMatchers.find((candidate) => pattern.startsWith(candidate, index));
    if (!token) {
      output += char;
      index += 1;
      continue;
    }

    output += renderAppleDateToken(date, token, locale);
    index += token.length;
  }

  return output.trim();
}

function renderAppleDateToken(date: Date, token: string, locale: string): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const dayOfYear = Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / (24 * 60 * 60 * 1000)) + 1;
  const weekOfYear = Math.floor((dayOfYear + new Date(Date.UTC(year, 0, 1)).getUTCDay()) / 7) + 1;
  const hour = date.getUTCHours();
  const minute = date.getUTCMinutes();
  const second = date.getUTCSeconds();

  switch (token) {
    case 'yyyy':
    case 'YYYY':
      return String(year).padStart(4, '0');
    case 'yy':
    case 'YY':
      return String(year % 100).padStart(2, '0');
    case 'QQQQQ':
      return String(Math.ceil(month / 3));
    case 'QQQQ':
      return `Quarter ${Math.ceil(month / 3)}`;
    case 'QQQ':
      return `Q${Math.ceil(month / 3)}`;
    case 'QQ':
      return String(Math.ceil(month / 3)).padStart(2, '0');
    case 'Q':
      return String(Math.ceil(month / 3));
    case 'LLLLL':
    case 'MMMMM':
      return formatDatePart(date, locale, { month: 'narrow' });
    case 'LLLL':
    case 'MMMM':
      return formatDatePart(date, locale, { month: 'long' });
    case 'LLL':
    case 'MMM':
      return formatDatePart(date, locale, { month: 'short' });
    case 'LL':
    case 'MM':
      return String(month).padStart(2, '0');
    case 'L':
    case 'M':
      return String(month);
    case 'DDD':
      return String(dayOfYear).padStart(3, '0');
    case 'DD':
      return String(dayOfYear).padStart(2, '0');
    case 'dd':
      return String(day).padStart(2, '0');
    case 'd':
      return String(day);
    case 'EEEEE':
      return formatDatePart(date, locale, { weekday: 'narrow' });
    case 'EEEE':
      return formatDatePart(date, locale, { weekday: 'long' });
    case 'EE':
    case 'E':
    case 'EEE':
      return formatDatePart(date, locale, { weekday: 'short' });
    case 'ww':
      return String(weekOfYear).padStart(2, '0');
    case 'w':
      return String(weekOfYear);
    case 'HH':
      return String(hour).padStart(2, '0');
    case 'H':
      return String(hour);
    case 'hh': {
      const twelveHour = hour % 12 || 12;
      return String(twelveHour).padStart(2, '0');
    }
    case 'h':
      return String(hour % 12 || 12);
    case 'mm':
      return String(minute).padStart(2, '0');
    case 'm':
      return String(minute);
    case 'ss':
      return String(second).padStart(2, '0');
    case 's':
      return String(second);
    case 'a':
      return hour < 12 ? 'AM' : 'PM';
    default:
      return token;
  }
}

function formatDatePart(
  date: Date,
  locale: string,
  options: Intl.DateTimeFormatOptions
): string {
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(date);
  }
}

function defaultUtcDateTimeText(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  const second = String(date.getUTCSeconds()).padStart(2, '0');
  const hasTime = hour !== '00' || minute !== '00' || second !== '00';
  return hasTime ? `${year}-${month}-${day} ${hour}:${minute}:${second}` : `${year}-${month}-${day}`;
}

function expandAttachmentText(text: string, absoluteStart: number, attachmentTextMap: Map<number, string[]>): string {
  if (!text.includes('\uFFFC')) {
    return text;
  }

  let output = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char !== '\uFFFC') {
      output += char;
      continue;
    }
    output += (attachmentTextMap.get(absoluteStart + index) ?? []).join('');
  }
  return output;
}

function buildTextRun(text: string, charProps: AnyObject | undefined): TextRun {
  const colorObject = asObject(readField(charProps, ['fontColor', 'font_color'])) ?? asObject(readField(charProps, ['tsdFill', 'tsd_fill']))?.color;
  const fontName = String(readField<string>(charProps, ['fontName', 'font_name']) ?? '');
  return {
    text,
    bold: Boolean(readField(charProps, ['bold'])) || /bold/i.test(fontName),
    italic: Boolean(readField(charProps, ['italic'])) || /italic/i.test(fontName),
    underline: Number(readField<number>(charProps, ['underline']) ?? 0) > 0,
    strike: Number(readField<number>(charProps, ['strikethru']) ?? 0) > 0,
    color: colorToHex(colorObject, '#111827'),
    colorAlpha: colorAlpha(colorObject),
    fontSize: typeof readField<number>(charProps, ['fontSize', 'font_size']) === 'number'
      ? Number(readField<number>(charProps, ['fontSize', 'font_size']))
      : undefined,
    fontFamily: fontName || undefined,
    baselineShift: typeof readField<number>(charProps, ['baselineShift', 'baseline_shift']) === 'number'
      ? Number(readField<number>(charProps, ['baselineShift', 'baseline_shift']))
      : undefined
  };
}
