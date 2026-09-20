import type { InsetBox, LineStyle, ShapeItem } from '../types';
import { applyShade, applyTint } from '../utils/colors';
import { buildPath, buildPoints, createGeometryContext, formatGeometryNumber } from './geometry';
import {
  defaultPresetTextBounds,
  presetShapeAliases,
  presetShapeDefinitions,
  type PresetPaint,
  type PresetShapeElement,
  type PresetShapeType
} from './preset-definitions';

export interface LineStyleDefaults {
  defaultJoin?: LineStyle['lineJoin'];
}

export interface PresetShapeRenderContext {
  width: number;
  height: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  line: LineStyle | undefined;
  adjustments?: Record<string, number>;
  applyLineStyles(node: SVGElement, line: LineStyle | undefined, defaults?: LineStyleDefaults): void;
  applyDashPattern(node: SVGElement, line: LineStyle | undefined): void;
}

export function createPresetShapeNode(
  shapeType: ShapeItem['shapeType'],
  context: PresetShapeRenderContext
): SVGElement | undefined {
  const alias = presetShapeAliases[shapeType as PresetShapeType];
  if (alias) {
    const aliasedContext = alias.swapAxes
      ? {
          ...context,
          width: context.height,
          height: context.width
        }
      : context;
    const aliasedNode = createPresetShapeNode(alias.base, aliasedContext);
    if (!aliasedNode) {
      return undefined;
    }

    if (!alias.transform) {
      return aliasedNode;
    }

    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.appendChild(aliasedNode);
    group.setAttribute('transform', getAliasTransform(alias.transform, context));
    return group;
  }

  const definition = presetShapeDefinitions[shapeType as PresetShapeType];
  if (!definition) {
    return undefined;
  }

  const adjustmentGuides = Object.entries(context.adjustments ?? {}).map(([name, value]) => ({
    name,
    value
  }));
  const geometry = createGeometryContext(context.width, context.height, [...(definition.guides ?? []), ...adjustmentGuides]);
  const nodes = definition.elements.map((element) => renderPresetElement(element, context, geometry));

  if (nodes.length === 1) {
    return nodes[0];
  }

  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  for (const node of nodes) {
    group.appendChild(node);
  }
  return group;
}

export function resolvePresetShapeTextBounds(
  shapeType: ShapeItem['shapeType'],
  context: Pick<PresetShapeRenderContext, 'width' | 'height' | 'adjustments'>
): InsetBox | undefined {
  const alias = presetShapeAliases[shapeType as PresetShapeType];
  if (alias) {
    const aliasedContext = alias.swapAxes
      ? {
          ...context,
          width: context.height,
          height: context.width
        }
      : context;
    const resolved = resolvePresetShapeTextBounds(alias.base, aliasedContext);
    if (!resolved) {
      return undefined;
    }
    return alias.transform ? transformAliasTextBounds(resolved, alias.transform, context.width, context.height) : resolved;
  }

  const definition = presetShapeDefinitions[shapeType as PresetShapeType];
  if (!definition?.textBounds) {
    return undefined;
  }

  const adjustmentGuides = Object.entries(context.adjustments ?? {}).map(([name, value]) => ({ name, value }));
  const geometry = createGeometryContext(context.width, context.height, [...(definition.guides ?? []), ...adjustmentGuides]);
  return {
    left: geometry.resolve(definition.textBounds.left),
    top: geometry.resolve(definition.textBounds.top),
    right: geometry.resolve(definition.textBounds.right),
    bottom: geometry.resolve(definition.textBounds.bottom)
  };
}

function getAliasTransform(transform: 'mirrorX' | 'rotate90' | 'rotate-90', context: PresetShapeRenderContext): string {
  switch (transform) {
    case 'mirrorX':
      return `translate(${formatGeometryNumber(context.width)} 0) scale(-1 1)`;
    case 'rotate90':
      return `translate(${formatGeometryNumber(context.width)} 0) rotate(90)`;
    case 'rotate-90':
      return `translate(0 ${formatGeometryNumber(context.height)}) rotate(-90)`;
    default:
      return '';
  }
}

function transformAliasTextBounds(
  bounds: InsetBox,
  transform: 'mirrorX' | 'rotate90' | 'rotate-90',
  width: number,
  height: number
): InsetBox {
  switch (transform) {
    case 'mirrorX':
      return {
        left: bounds.right,
        top: bounds.top,
        right: bounds.left,
        bottom: bounds.bottom
      };
    case 'rotate90':
      return {
        left: bounds.bottom,
        top: bounds.left,
        right: bounds.top,
        bottom: bounds.right
      };
    case 'rotate-90':
      return {
        left: bounds.top,
        top: bounds.right,
        right: bounds.bottom,
        bottom: bounds.left
      };
    default:
      return defaultPresetTextBounds;
  }
}

function renderPresetElement(
  element: PresetShapeElement,
  context: PresetShapeRenderContext,
  geometry: ReturnType<typeof createGeometryContext>
): SVGElement {
  const node = createElementNode(element, geometry);
  applyPresetElementStyles(node, element, context, geometry);
  return node;
}

function createElementNode(
  element: PresetShapeElement,
  geometry: ReturnType<typeof createGeometryContext>
): SVGElement {
  switch (element.kind) {
    case 'path': {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', buildPath(element.commands, geometry));
      return path;
    }
    case 'polygon': {
      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygon.setAttribute('points', buildPoints(element.points, geometry));
      return polygon;
    }
    case 'ellipse': {
      const ellipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
      ellipse.setAttribute('cx', formatGeometryNumber(geometry.resolve(element.cx)));
      ellipse.setAttribute('cy', formatGeometryNumber(geometry.resolve(element.cy)));
      ellipse.setAttribute('rx', formatGeometryNumber(geometry.resolve(element.rx)));
      ellipse.setAttribute('ry', formatGeometryNumber(geometry.resolve(element.ry)));
      return ellipse;
    }
    case 'circle': {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', formatGeometryNumber(geometry.resolve(element.cx)));
      circle.setAttribute('cy', formatGeometryNumber(geometry.resolve(element.cy)));
      circle.setAttribute('r', formatGeometryNumber(geometry.resolve(element.r)));
      return circle;
    }
    default: {
      const fallback = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      return fallback;
    }
  }
}

function applyPresetElementStyles(
  node: SVGElement,
  element: PresetShapeElement,
  context: PresetShapeRenderContext,
  geometry: ReturnType<typeof createGeometryContext>
): void {
  const fill = resolvePaint(element.fill, context);
  const stroke = resolvePaint(element.stroke ?? 'stroke', context);
  const strokeWidth = resolveStrokeWidth(element, context, geometry);

  node.setAttribute('fill', fill);
  node.setAttribute('stroke', stroke);
  if (stroke !== 'none') {
    node.setAttribute('stroke-width', String(strokeWidth));
  } else {
    node.removeAttribute('stroke-width');
  }

  if (element.fillRule) {
    node.setAttribute('fill-rule', element.fillRule);
  }
  if (element.clipRule) {
    node.setAttribute('clip-rule', element.clipRule);
  }

  if (element.fillOpacity != null) {
    const opacity = fill === 'transparent' ? 0 : element.fillOpacity;
    node.setAttribute('fill-opacity', formatGeometryNumber(opacity));
  }

  if (element.applyLineStyles !== false && stroke !== 'none') {
    context.applyLineStyles(node, context.line, { defaultJoin: element.defaultJoin });
  }

  if (element.applyDashPattern && (element.applyLineStyles === false || stroke === 'none')) {
    context.applyDashPattern(node, context.line);
  }

  if (element.lineCap) {
    node.setAttribute('stroke-linecap', element.lineCap);
  }
  if (element.defaultJoin && element.defaultJoin !== 'miter' && context.line?.lineJoin === 'miter') {
    node.setAttribute('stroke-linejoin', element.defaultJoin);
  }
  if (element.coerceMiterJoin && context.line?.lineJoin === 'miter') {
    node.setAttribute('stroke-linejoin', element.coerceMiterJoin);
  }
  if (element.lineJoin) {
    node.setAttribute('stroke-linejoin', element.lineJoin);
  }
}

function resolvePaint(paint: PresetPaint | undefined, context: PresetShapeRenderContext): string {
  switch (paint) {
    case undefined:
    case 'fill':
      return context.fill;
    case 'lightenMore':
      return resolveRelativeFillPaint(context.fill, 'lightenMore');
    case 'lighten':
      return resolveRelativeFillPaint(context.fill, 'lighten');
    case 'lightenLess':
      return resolveRelativeFillPaint(context.fill, 'lightenLess');
    case 'darken':
      return resolveRelativeFillPaint(context.fill, 'darken');
    case 'darkenLess':
      return resolveRelativeFillPaint(context.fill, 'darkenLess');
    case 'stroke':
      return context.stroke;
    case 'none':
      return 'none';
    default:
      return paint;
  }
}

function resolveRelativeFillPaint(
  fill: string,
  variant: 'lightenMore' | 'lighten' | 'lightenLess' | 'darken' | 'darkenLess'
): string {
  if (!/^#[0-9a-f]{6}$/i.test(fill)) {
    return fill;
  }

  switch (variant) {
    case 'lightenMore':
      return applyTint(fill, 0.5);
    case 'lighten':
      return applyTint(fill, 0.42);
    case 'lightenLess':
      return applyTint(fill, 0.24);
    case 'darken':
      return applyShade(fill, 0.62);
    case 'darkenLess':
      return applyShade(fill, 0.8);
    default:
      return fill;
  }
}

function resolveStrokeWidth(
  element: PresetShapeElement,
  context: PresetShapeRenderContext,
  geometry: ReturnType<typeof createGeometryContext>
): number {
  const baseWidth = element.strokeWidth != null ? geometry.resolve(element.strokeWidth) : context.strokeWidth;
  if (element.minStrokeWidth == null) {
    return baseWidth;
  }

  return Math.max(baseWidth, element.minStrokeWidth);
}
