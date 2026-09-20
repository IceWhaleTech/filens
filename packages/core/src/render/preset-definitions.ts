import type { InsetBox, LineCapType, LineJoinType, ShapeItem } from '../types';
import type { GeometryGuide, GeometryPathCommand, GeometryPointSpec, GeometryValue } from './geometry';
import { add, at2, cos, div, gt, guide, ifElse, maxValue, minValue, modValue, mul, pin, sin, sqrtValue, sub } from './geometry';

export type PresetShapeType = Extract<
  ShapeItem['shapeType'],
  | 'snip1Rect'
  | 'snip2SameRect'
  | 'snip2DiagRect'
  | 'snipRoundRect'
  | 'round1Rect'
  | 'round2SameRect'
  | 'round2DiagRect'
  | 'cloud'
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
  | 'cube'
  | 'bevel'
  | 'chevron'
  | 'parallelogram'
  | 'trapezoid'
  | 'hexagon'
  | 'heptagon'
  | 'triangle'
  | 'pentagon'
  | 'octagon'
  | 'decagon'
  | 'dodecagon'
  | 'diamond'
  | 'rtTriangle'
  | 'star5'
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
>;

export type PresetPaint = 'fill' | 'stroke' | 'none' | string;

interface PresetElementBase {
  fill?: PresetPaint;
  stroke?: PresetPaint;
  strokeWidth?: GeometryValue;
  minStrokeWidth?: number;
  fillOpacity?: number;
  fillRule?: 'evenodd';
  clipRule?: 'evenodd';
  defaultJoin?: LineJoinType;
  lineCap?: LineCapType;
  lineJoin?: LineJoinType;
  coerceMiterJoin?: LineJoinType;
  applyLineStyles?: boolean;
  applyDashPattern?: boolean;
}

export interface PresetPathElement extends PresetElementBase {
  kind: 'path';
  commands: GeometryPathCommand[];
}

export interface PresetPolygonElement extends PresetElementBase {
  kind: 'polygon';
  points: GeometryPointSpec[];
}

export interface PresetEllipseElement extends PresetElementBase {
  kind: 'ellipse';
  cx: GeometryValue;
  cy: GeometryValue;
  rx: GeometryValue;
  ry: GeometryValue;
}

export interface PresetCircleElement extends PresetElementBase {
  kind: 'circle';
  cx: GeometryValue;
  cy: GeometryValue;
  r: GeometryValue;
}

export type PresetShapeElement =
  | PresetPathElement
  | PresetPolygonElement
  | PresetEllipseElement
  | PresetCircleElement;

export interface PresetShapeDefinition {
  guides?: GeometryGuide[];
  elements: PresetShapeElement[];
  textBounds?: {
    left: GeometryValue;
    top: GeometryValue;
    right: GeometryValue;
    bottom: GeometryValue;
  };
}

export interface PresetShapeAlias {
  base: PresetShapeType;
  swapAxes?: boolean;
  transform?: 'mirrorX' | 'rotate90' | 'rotate-90';
}

const FULL_ROTATION = 21600000;
const MAX_ROTATION = FULL_ROTATION - 1;
const ANGLE_UNITS_PER_DEGREE = 60000;

function createEllipticalSweepGuides(defaultStartAngle: number, defaultEndAngle: number): GeometryGuide[] {
  return [
    guide('adj1', defaultStartAngle),
    guide('adj2', defaultEndAngle),
    guide('stAng', pin(0, 'adj1', MAX_ROTATION)),
    guide('enAng', pin(0, 'adj2', MAX_ROTATION)),
    guide('rawSwAng', sub('enAng', 'stAng')),
    guide('swAng', ifElse(gt('rawSwAng', 0), 'rawSwAng', add('rawSwAng', FULL_ROTATION))),
    guide('rx', div('w', 2)),
    guide('ry', div('h', 2)),
    guide('stDeg', div('stAng', ANGLE_UNITS_PER_DEGREE)),
    guide('enDeg', div('enAng', ANGLE_UNITS_PER_DEGREE)),
    guide('swDeg', div('swAng', ANGLE_UNITS_PER_DEGREE)),
    // DrawingML sweep angles describe the center ray, not the ellipse's
    // parametric angle. Resolve the ray/ellipse intersection so pie, chord,
    // and arc endpoints match the reference preview on non-circular bounds.
    guide('stDenX', cos('ry', 'stDeg')),
    guide('stDenY', sin('rx', 'stDeg')),
    guide('stRadius', div(mul('rx', 'ry'), modValue('stDenX', 'stDenY', 0))),
    guide('enDenX', cos('ry', 'enDeg')),
    guide('enDenY', sin('rx', 'enDeg')),
    guide('enRadius', div(mul('rx', 'ry'), modValue('enDenX', 'enDenY', 0))),
    guide('x1', add('cx', cos('stRadius', 'stDeg'))),
    guide('y1', add('cy', sin('stRadius', 'stDeg'))),
    guide('x2', add('cx', cos('enRadius', 'enDeg'))),
    guide('y2', add('cy', sin('enRadius', 'enDeg'))),
    guide('largeArcFlag', gt('swDeg', 180))
  ];
}

function createRegularPolygonPoints(sides: number, rotation = -90): GeometryPointSpec[] {
  return Array.from({ length: sides }, (_, index) => {
    const angle = rotation + (360 / sides) * index;
    return {
      x: add('cx', cos('cx', angle)),
      y: add('cy', sin('cy', angle))
    };
  });
}

function createRegularPolygonDefinition(sides: number, rotation = -90): PresetShapeDefinition {
  return {
    textBounds: {
      left: mul('w', 0.14),
      top: mul('h', 0.14),
      right: mul('w', 0.14),
      bottom: mul('h', 0.14)
    },
    elements: [
      {
        kind: 'polygon',
        defaultJoin: 'round',
        points: createRegularPolygonPoints(sides, rotation)
      }
    ]
  };
}

function createCurvedRightArrowGuides(): GeometryGuide[] {
  return [
    guide('adj1', 25000),
    guide('adj2', 50000),
    guide('adj3', 25000),
    guide('maxAdj2', div(mul(50000, 'h'), 'ss')),
    guide('a2', pin(0, 'adj2', 'maxAdj2')),
    guide('a1', pin(0, 'adj1', 'a2')),
    guide('th', div(mul('ss', 'a1'), 100000)),
    guide('aw', div(mul('ss', 'a2'), 100000)),
    guide('q1', div(add('th', 'aw'), 4)),
    guide('hR', sub('hd2', 'q1')),
    guide('q7', mul('hR', 2)),
    guide('q8', mul('q7', 'q7')),
    guide('q9', mul('th', 'th')),
    guide('q10', sub('q8', 'q9')),
    guide('q11', sqrtValue('q10')),
    guide('idx', div(mul('q11', 'w'), 'q7')),
    guide('maxAdj3', div(mul(100000, 'idx'), 'ss')),
    guide('a3', pin(0, 'adj3', 'maxAdj3')),
    guide('ah', div(mul('ss', 'a3'), 100000)),
    guide('y3', add('hR', 'th')),
    guide('q2', mul('w', 'w')),
    guide('q3', mul('ah', 'ah')),
    guide('q4', sub('q2', 'q3')),
    guide('q5', sqrtValue('q4')),
    guide('dy', div(mul('q5', 'hR'), 'w')),
    guide('y5', add('hR', 'dy')),
    guide('y7', add('y3', 'dy')),
    guide('q6', sub('aw', 'th')),
    guide('dh', div('q6', 2)),
    guide('y4', sub('y5', 'dh')),
    guide('y8', add('y7', 'dh')),
    guide('aw2', div('aw', 2)),
    guide('y6', sub('b', 'aw2')),
    guide('x1', sub('r', 'ah'))
  ];
}

function createCurvedLeftArrowGuides(): GeometryGuide[] {
  return [
    guide('adj1', 25000),
    guide('adj2', 50000),
    guide('adj3', 25000),
    guide('maxAdj2', div(mul(50000, 'h'), 'ss')),
    guide('a2', pin(0, 'adj2', 'maxAdj2')),
    guide('a1', pin(0, 'adj1', 'a2')),
    guide('th', div(mul('ss', 'a1'), 100000)),
    guide('aw', div(mul('ss', 'a2'), 100000)),
    guide('q1', div(add('th', 'aw'), 4)),
    guide('hR', sub('hd2', 'q1')),
    guide('q7', mul('hR', 2)),
    guide('q8', mul('q7', 'q7')),
    guide('q9', mul('th', 'th')),
    guide('q10', sub('q8', 'q9')),
    guide('q11', sqrtValue('q10')),
    guide('idx', div(mul('q11', 'w'), 'q7')),
    guide('maxAdj3', div(mul(100000, 'idx'), 'ss')),
    guide('a3', pin(0, 'adj3', 'maxAdj3')),
    guide('ah', div(mul('ss', 'a3'), 100000)),
    guide('y3', add('hR', 'th')),
    guide('q2', mul('w', 'w')),
    guide('q3', mul('ah', 'ah')),
    guide('q4', sub('q2', 'q3')),
    guide('q5', sqrtValue('q4')),
    guide('dy', div(mul('q5', 'hR'), 'w')),
    guide('y5', add('hR', 'dy')),
    guide('y7', add('y3', 'dy')),
    guide('q6', sub('aw', 'th')),
    guide('dh', div('q6', 2)),
    guide('y4', sub('y5', 'dh')),
    guide('y8', add('y7', 'dh')),
    guide('aw2', div('aw', 2)),
    guide('y6', sub('b', 'aw2')),
    guide('x1', add('l', 'ah')),
    guide('outerInset', mul('th', 0.42)),
    guide('outerX', sub('r', 'outerInset')),
    guide('innerY', sub('y3', mul('th', 0.38))),
    guide('curveEndX', add('x1', mul('th', 0.28))),
    guide('curveEndY', sub('y8', mul('th', 0.68))),
    guide('swAng', at2('ah', 'dy')),
    guide('ix', add('l', 'idx')),
    guide('iy', div(add('hR', 'y3'), 2)),
    guide('q12', div('th', 2)),
    guide('dang2', at2('idx', 'q12')),
    guide('swAng2', sub('dang2', 'swAng')),
    guide('swAng3', sub('swAng', 'dang2')),
    guide('stAng3', sub(0, 'dang2'))
  ];
}

function createCurvedUpArrowGuides(): GeometryGuide[] {
  return [
    guide('adj1', 26000),
    guide('adj2', 50000),
    guide('maxAdj2', div(mul(50000, 'w'), 'ss')),
    guide('a2', pin(0, 'adj2', 'maxAdj2')),
    guide('a1', pin(0, 'adj1', 'a2')),
    guide('th', div(mul('ss', 'a1'), 100000)),
    guide('aw', div(mul('ss', 'a2'), 100000)),
    guide('arcX', sub('wd2', div(add('th', 'aw'), 4))),
    guide('bandX', add('arcX', 'th')),
    guide('headBaseX', sub('w', 'aw')),
    guide('headJoinX', sub('w', div(add('aw', 'th'), 2))),
    guide('headOuterX', sub('w', 'th')),
    guide('rightArcEndX', sub('w', div('th', 2))),
    guide('barY', sub('h', 'th'))
  ];
}

function createCurvedDownArrowGuides(): GeometryGuide[] {
  return [
    guide('adj1', 26000),
    guide('adj2', 50000),
    guide('maxAdj2', div(mul(50000, 'w'), 'ss')),
    guide('a2', pin(0, 'adj2', 'maxAdj2')),
    guide('a1', pin(0, 'adj1', 'a2')),
    guide('th', div(mul('ss', 'a1'), 100000)),
    guide('aw', div(mul('ss', 'a2'), 100000)),
    guide('arcX', sub('wd2', div(add('th', 'aw'), 4))),
    guide('bandX', add('arcX', 'th')),
    guide('headBaseX', sub('w', 'aw')),
    guide('headJoinX', sub('w', div(add('aw', 'th'), 2))),
    guide('headOuterX', sub('w', 'th')),
    guide('rightArcEndX', sub('w', div('th', 2))),
    guide('barY', sub('h', 'th'))
  ];
}

export const presetShapeDefinitions: Partial<Record<PresetShapeType, PresetShapeDefinition>> = {
  snip1Rect: {
    guides: [guide('adj', 18000), guide('a', pin(0, 'adj', 50000)), guide('cut', div(mul('ss', 'a'), 100000))],
    textBounds: {
      left: 0,
      top: 0,
      right: 0,
      bottom: 0
    },
    elements: [
      {
        kind: 'path',
        defaultJoin: 'round',
        lineJoin: 'round',
        commands: [
          { type: 'M', x: 0, y: 0 },
          { type: 'H', x: sub('w', 'cut') },
          { type: 'L', x: 'w', y: 'cut' },
          { type: 'V', y: 'h' },
          { type: 'H', x: 0 },
          { type: 'Z' }
        ]
      }
    ]
  },
  snip2SameRect: {
    guides: [
      guide('adj1', 18000),
      guide('adj2', 18000),
      guide('a1', pin(0, 'adj1', 50000)),
      guide('a2', pin(0, 'adj2', 50000)),
      guide('cutTop', div(mul('ss', 'a1'), 100000)),
      guide('cutBottom', div(mul('ss', 'a2'), 100000)),
      guide('maxCut', ifElse(gt('cutTop', 'cutBottom'), 'cutTop', 'cutBottom'))
    ],
    textBounds: {
      left: 0,
      top: 0,
      right: 0,
      bottom: 0
    },
    elements: [
      {
        kind: 'path',
        defaultJoin: 'round',
        commands: [
          { type: 'M', x: 'cutTop', y: 0 },
          { type: 'H', x: sub('w', 'cutTop') },
          { type: 'L', x: 'w', y: 'cutTop' },
          { type: 'V', y: sub('h', 'cutBottom') },
          { type: 'L', x: sub('w', 'cutBottom'), y: 'h' },
          { type: 'H', x: 'cutBottom' },
          { type: 'L', x: 0, y: sub('h', 'cutBottom') },
          { type: 'V', y: 'cutTop' },
          { type: 'Z' }
        ]
      }
    ]
  },
  snip2DiagRect: {
    guides: [
      guide('adj1', 18000),
      guide('adj2', 18000),
      guide('a1', pin(0, 'adj1', 50000)),
      guide('a2', pin(0, 'adj2', 50000)),
      guide('cutTop', div(mul('ss', 'a1'), 100000)),
      guide('cutBottom', div(mul('ss', 'a2'), 100000)),
      guide('maxCut', ifElse(gt('cutTop', 'cutBottom'), 'cutTop', 'cutBottom'))
    ],
    textBounds: {
      left: 0,
      top: 0,
      right: 0,
      bottom: 0
    },
    elements: [
      {
        kind: 'path',
        defaultJoin: 'round',
        commands: [
          { type: 'M', x: 'cutTop', y: 0 },
          { type: 'H', x: sub('w', 'cutBottom') },
          { type: 'L', x: 'w', y: 'cutBottom' },
          { type: 'V', y: sub('h', 'cutTop') },
          { type: 'L', x: sub('w', 'cutTop'), y: 'h' },
          { type: 'H', x: 'cutBottom' },
          { type: 'L', x: 0, y: sub('h', 'cutBottom') },
          { type: 'V', y: 'cutTop' },
          { type: 'Z' }
        ]
      }
    ]
  },
  snipRoundRect: {
    guides: [
      guide('adj1', 18000),
      guide('adj2', 18000),
      guide('a1', pin(0, 'adj1', 50000)),
      guide('a2', pin(0, 'adj2', 50000)),
      guide('radius', div(mul('ss', 'a1'), 100000)),
      guide('cut', div(mul('ss', 'a2'), 100000)),
      guide('curveInset', div(mul('radius', 29289), 100000))
    ],
    textBounds: {
      left: 0,
      top: 0,
      right: 0,
      bottom: 0
    },
    elements: [
      {
        kind: 'path',
        defaultJoin: 'round',
        commands: [
          { type: 'M', x: 'radius', y: 0 },
          { type: 'H', x: sub('w', 'cut') },
          { type: 'L', x: 'w', y: 'cut' },
          { type: 'V', y: 'h' },
          { type: 'H', x: 0 },
          { type: 'V', y: 'radius' },
          { type: 'A', rx: 'radius', ry: 'radius', sweep: true, x: 'radius', y: 0 },
          { type: 'Z' }
        ]
      }
    ]
  },
  round1Rect: {
    guides: [
      guide('adj', 18000),
      guide('a', pin(0, 'adj', 50000)),
      guide('radius', div(mul('ss', 'a'), 100000)),
      guide('curveInset', div(mul('radius', 29289), 100000))
    ],
    textBounds: {
      left: 0,
      top: 0,
      right: 0,
      bottom: 0
    },
    elements: [
      {
        kind: 'path',
        defaultJoin: 'round',
        commands: [
          { type: 'M', x: 0, y: 0 },
          { type: 'H', x: sub('w', 'radius') },
          { type: 'A', rx: 'radius', ry: 'radius', sweep: true, x: 'w', y: 'radius' },
          { type: 'V', y: 'h' },
          { type: 'H', x: 0 },
          { type: 'Z' }
        ]
      }
    ]
  },
  round2SameRect: {
    guides: [
      guide('adj1', 18000),
      guide('adj2', 0),
      guide('a1', pin(0, 'adj1', 50000)),
      guide('a2', pin(0, 'adj2', 50000)),
      guide('radiusTop', div(mul('ss', 'a1'), 100000)),
      guide('radiusBottom', div(mul('ss', 'a2'), 100000)),
      guide('topCurveInset', div(mul('radiusTop', 29289), 100000)),
      guide('bottomCurveInset', div(mul('radiusBottom', 29289), 100000)),
      guide('maxCurveInset', ifElse(gt('radiusTop', 'radiusBottom'), 'topCurveInset', 'bottomCurveInset'))
    ],
    textBounds: {
      left: 0,
      top: 0,
      right: 0,
      bottom: 0
    },
    elements: [
      {
        kind: 'path',
        defaultJoin: 'round',
        commands: [
          { type: 'M', x: 'radiusTop', y: 0 },
          { type: 'H', x: sub('w', 'radiusTop') },
          { type: 'A', rx: 'radiusTop', ry: 'radiusTop', sweep: true, x: 'w', y: 'radiusTop' },
          { type: 'V', y: sub('h', 'radiusBottom') },
          {
            type: 'A',
            rx: 'radiusBottom',
            ry: 'radiusBottom',
            sweep: true,
            x: sub('w', 'radiusBottom'),
            y: 'h'
          },
          { type: 'H', x: 'radiusBottom' },
          { type: 'A', rx: 'radiusBottom', ry: 'radiusBottom', sweep: true, x: 0, y: sub('h', 'radiusBottom') },
          { type: 'V', y: 'radiusTop' },
          { type: 'A', rx: 'radiusTop', ry: 'radiusTop', sweep: true, x: 'radiusTop', y: 0 },
          { type: 'Z' }
        ]
      }
    ]
  },
  round2DiagRect: {
    guides: [
      guide('adj1', 18000),
      guide('adj2', 18000),
      guide('a1', pin(0, 'adj1', 50000)),
      guide('a2', pin(0, 'adj2', 50000)),
      guide('radiusTop', div(mul('ss', 'a1'), 100000)),
      guide('radiusBottom', div(mul('ss', 'a2'), 100000)),
      guide('topCurveInset', div(mul('radiusTop', 29289), 100000)),
      guide('bottomCurveInset', div(mul('radiusBottom', 29289), 100000)),
      guide('maxCurveInset', ifElse(gt('radiusTop', 'radiusBottom'), 'topCurveInset', 'bottomCurveInset'))
    ],
    textBounds: {
      left: 0,
      top: 0,
      right: 0,
      bottom: 0
    },
    elements: [
      {
        kind: 'path',
        defaultJoin: 'round',
        commands: [
          { type: 'M', x: 'radiusTop', y: 0 },
          { type: 'H', x: sub('w', 'radiusBottom') },
          { type: 'A', rx: 'radiusBottom', ry: 'radiusBottom', sweep: true, x: 'w', y: 'radiusBottom' },
          { type: 'V', y: sub('h', 'radiusTop') },
          { type: 'A', rx: 'radiusTop', ry: 'radiusTop', sweep: true, x: sub('w', 'radiusTop'), y: 'h' },
          { type: 'H', x: 'radiusBottom' },
          { type: 'A', rx: 'radiusBottom', ry: 'radiusBottom', sweep: true, x: 0, y: sub('h', 'radiusBottom') },
          { type: 'V', y: 'radiusTop' },
          { type: 'A', rx: 'radiusTop', ry: 'radiusTop', sweep: true, x: 'radiusTop', y: 0 },
          { type: 'Z' }
        ]
      }
    ]
  },
  cloud: {
    textBounds: {
      left: mul('w', 0.14),
      top: mul('h', 0.18),
      right: mul('w', 0.14),
      bottom: mul('h', 0.16)
    },
    elements: [
      {
        kind: 'path',
        defaultJoin: 'round',
        commands: [
          {
            type: 'M',
            x: mul('w', 0.18),
            y: mul('h', 0.72)
          },
          {
            type: 'C',
            x1: mul('w', 0.08),
            y1: mul('h', 0.72),
            x2: 0,
            y2: mul('h', 0.63),
            x: 0,
            y: mul('h', 0.52)
          },
          {
            type: 'C',
            x1: 0,
            y1: mul('h', 0.4),
            x2: mul('w', 0.1),
            y2: mul('h', 0.31),
            x: mul('w', 0.22),
            y: mul('h', 0.33)
          },
          {
            type: 'C',
            x1: mul('w', 0.24),
            y1: mul('h', 0.18),
            x2: mul('w', 0.38),
            y2: mul('h', 0.06),
            x: mul('w', 0.53),
            y: mul('h', 0.08)
          },
          {
            type: 'C',
            x1: mul('w', 0.61),
            y1: mul('h', 0.01),
            x2: mul('w', 0.76),
            y2: mul('h', 0.04),
            x: mul('w', 0.82),
            y: mul('h', 0.15)
          },
          {
            type: 'C',
            x1: mul('w', 0.95),
            y1: mul('h', 0.14),
            x2: 'w',
            y2: mul('h', 0.26),
            x: mul('w', 0.97),
            y: mul('h', 0.37)
          },
          {
            type: 'C',
            x1: mul('w', 1.05),
            y1: mul('h', 0.43),
            x2: mul('w', 1.03),
            y2: mul('h', 0.58),
            x: mul('w', 0.91),
            y: mul('h', 0.63)
          },
          {
            type: 'C',
            x1: mul('w', 0.9),
            y1: mul('h', 0.76),
            x2: mul('w', 0.76),
            y2: mul('h', 0.85),
            x: mul('w', 0.62),
            y: mul('h', 0.8)
          },
          {
            type: 'C',
            x1: mul('w', 0.54),
            y1: mul('h', 0.91),
            x2: mul('w', 0.36),
            y2: mul('h', 0.93),
            x: mul('w', 0.28),
            y: mul('h', 0.83)
          },
          {
            type: 'C',
            x1: mul('w', 0.18),
            y1: mul('h', 0.86),
            x2: mul('w', 0.11),
            y2: mul('h', 0.81),
            x: mul('w', 0.18),
            y: mul('h', 0.72)
          },
          {
            type: 'Z'
          }
        ]
      }
    ]
  },
  plaque: {
    guides: [
      guide('left', mul('w', 0.18)),
      guide('right', mul('w', 0.82)),
      guide('topInset', mul('h', 0.14)),
      guide('sideInset', mul('w', 0.14)),
      guide('upper', mul('h', 0.32)),
      guide('lower', mul('h', 0.68)),
      guide('innerRight', sub('w', 'sideInset')),
      guide('bottomInset', sub('h', 'topInset'))
    ],
    textBounds: {
      left: 'sideInset',
      top: 'topInset',
      right: 'sideInset',
      bottom: 'topInset'
    },
    elements: [
      {
        kind: 'path',
        defaultJoin: 'round',
        commands: [
          {
            type: 'M',
            x: 'left',
            y: 0
          },
          {
            type: 'Q',
            x1: 'cx',
            y1: 'topInset',
            x: 'right',
            y: 0
          },
          {
            type: 'Q',
            x1: 'w',
            y1: mul('h', 0.18),
            x: 'w',
            y: 'upper'
          },
          {
            type: 'Q',
            x1: 'innerRight',
            y1: 'cy',
            x: 'w',
            y: 'lower'
          },
          {
            type: 'Q',
            x1: 'w',
            y1: mul('h', 0.82),
            x: 'right',
            y: 'h'
          },
          {
            type: 'Q',
            x1: 'cx',
            y1: 'bottomInset',
            x: 'left',
            y: 'h'
          },
          {
            type: 'Q',
            x1: 0,
            y1: mul('h', 0.82),
            x: 0,
            y: 'lower'
          },
          {
            type: 'Q',
            x1: 'sideInset',
            y1: 'cy',
            x: 0,
            y: 'upper'
          },
          {
            type: 'Q',
            x1: 0,
            y1: mul('h', 0.18),
            x: 'left',
            y: 0
          },
          {
            type: 'Z'
          }
        ]
      }
    ]
  },
  can: {
    guides: [
      guide('adj', 25000),
      guide('maxAdj', div(mul(50000, 'h'), 'ss')),
      guide('a', pin(0, 'adj', 'maxAdj')),
      guide('y1', div(mul('ss', 'a'), 200000)),
      guide('y2', add('y1', 'y1')),
      guide('y3', sub('b', 'y1'))
    ],
    textBounds: {
      left: 'l',
      top: 'y2',
      right: 'l',
      bottom: sub('h', 'y3')
    },
    elements: [
      {
        kind: 'path',
        defaultJoin: 'round',
        commands: [
          { type: 'M', x: 'l', y: 'y1' },
          { type: 'L', x: 'l', y: 'y3' },
          { type: 'A', rx: 'wd2', ry: 'y1', rotation: 0, largeArc: false, sweep: false, x: 'r', y: 'y3' },
          { type: 'L', x: 'r', y: 'y1' },
          { type: 'A', rx: 'wd2', ry: 'y1', rotation: 0, largeArc: false, sweep: true, x: 'l', y: 'y1' },
          { type: 'Z' }
        ]
      },
      {
        kind: 'ellipse',
        fill: 'lightenMore',
        cx: 'hc',
        cy: 'y1',
        rx: 'wd2',
        ry: 'y1',
        defaultJoin: 'round'
      }
    ]
  },
  pie: {
    guides: createEllipticalSweepGuides(0, 16200000),
    textBounds: {
      left: mul('w', 0.146447),
      top: mul('h', 0.265625),
      right: mul('w', 0.146447),
      bottom: mul('h', 0.265625)
    },
    elements: [
      {
        kind: 'path',
        defaultJoin: 'round',
        commands: [
          {
            type: 'M',
            x: 'x1',
            y: 'y1'
          },
          {
            type: 'A',
            rx: 'rx',
            ry: 'ry',
            rotation: 0,
            largeArc: 'largeArcFlag',
            sweep: true,
            x: 'x2',
            y: 'y2'
          },
          {
            type: 'L',
            x: 'cx',
            y: 'cy'
          },
          {
            type: 'Z'
          }
        ]
      }
    ]
  },
  chord: {
    guides: createEllipticalSweepGuides(2700000, 16200000),
    textBounds: {
      left: mul('w', 0.146447),
      top: mul('h', 0.265625),
      right: mul('w', 0.146447),
      bottom: mul('h', 0.265625)
    },
    elements: [
      {
        kind: 'path',
        defaultJoin: 'round',
        commands: [
          {
            type: 'M',
            x: 'x1',
            y: 'y1'
          },
          {
            type: 'A',
            rx: 'rx',
            ry: 'ry',
            rotation: 0,
            largeArc: 'largeArcFlag',
            sweep: true,
            x: 'x2',
            y: 'y2'
          },
          {
            type: 'Z'
          }
        ]
      }
    ]
  },
  donut: {
    guides: [
      guide('adj', 21000),
      guide('a', pin(0, 'adj', 50000)),
      guide('outerX', div('w', 2)),
      guide('outerY', div('h', 2)),
      guide('dr', div(mul('ss', 'a'), 100000)),
      guide('innerX', sub('outerX', 'dr')),
      guide('innerY', sub('outerY', 'dr')),
      guide('leftOuterX', sub('cx', 'outerX')),
      guide('rightOuterX', add('cx', 'outerX')),
      guide('leftInnerX', sub('cx', 'innerX')),
      guide('rightInnerX', add('cx', 'innerX'))
    ],
    textBounds: {
      left: mul('w', 0.18),
      top: mul('h', 0.18),
      right: mul('w', 0.18),
      bottom: mul('h', 0.18)
    },
    elements: [
      {
        kind: 'path',
        defaultJoin: 'round',
        fillRule: 'evenodd',
        clipRule: 'evenodd',
        commands: [
          {
            type: 'M',
            x: 'rightOuterX',
            y: 'cy'
          },
          {
            type: 'A',
            rx: 'outerX',
            ry: 'outerY',
            rotation: 0,
            largeArc: true,
            sweep: true,
            x: 'leftOuterX',
            y: 'cy'
          },
          {
            type: 'A',
            rx: 'outerX',
            ry: 'outerY',
            rotation: 0,
            largeArc: true,
            sweep: true,
            x: 'rightOuterX',
            y: 'cy'
          },
          {
            type: 'Z'
          },
          {
            type: 'M',
            x: 'rightInnerX',
            y: 'cy'
          },
          {
            type: 'A',
            rx: 'innerX',
            ry: 'innerY',
            rotation: 0,
            largeArc: true,
            sweep: false,
            x: 'leftInnerX',
            y: 'cy'
          },
          {
            type: 'A',
            rx: 'innerX',
            ry: 'innerY',
            rotation: 0,
            largeArc: true,
            sweep: false,
            x: 'rightInnerX',
            y: 'cy'
          },
          {
            type: 'Z'
          }
        ]
      }
    ]
  },
  arc: {
    guides: createEllipticalSweepGuides(16200000, 0),
    elements: [
      {
        kind: 'path',
        fill: 'none',
        defaultJoin: 'round',
        commands: [
          {
            type: 'M',
            x: 'x1',
            y: 'y1'
          },
          {
            type: 'A',
            rx: 'rx',
            ry: 'ry',
            rotation: 0,
            largeArc: 'largeArcFlag',
            sweep: true,
            x: 'x2',
            y: 'y2'
          }
        ]
      }
    ]
  },
  leftCircularArrow: {
    guides: [
      guide('adj1', 21000),
      guide('adj2', -2400000),
      guide('adj3', 13200000),
      guide('adj4', 1200000),
      guide('adj5', 2000),
      guide('a1', pin(0, 'adj1', 25000)),
      guide('a5', pin(0, 'adj5', 25000)),
      guide('band', div(mul('ss', 'a1'), 100000)),
      guide('tipExtend', div(mul('ss', 'a5'), 100000)),
      guide('stAng', pin(0, 'adj4', MAX_ROTATION)),
      guide('enAng', pin(0, 'adj3', MAX_ROTATION)),
      guide('rawSwAng', sub('enAng', 'stAng')),
      guide('swAng', ifElse(gt('rawSwAng', 0), 'rawSwAng', add('rawSwAng', FULL_ROTATION))),
      guide('outerX', div('w', 2)),
      guide('outerY', div('h', 2)),
      guide('innerX', sub('outerX', 'band')),
      guide('innerY', sub('outerY', 'band')),
      guide('stDeg', div('stAng', ANGLE_UNITS_PER_DEGREE)),
      guide('enDeg', div('enAng', ANGLE_UNITS_PER_DEGREE)),
      guide('swDeg', div('swAng', ANGLE_UNITS_PER_DEGREE)),
      guide('largeArcFlag', gt('swDeg', 180)),
      guide('outerStartX', add('cx', cos('outerX', 'stDeg'))),
      guide('outerStartY', add('cy', sin('outerY', 'stDeg'))),
      guide('outerEndX', add('cx', cos('outerX', 'enDeg'))),
      guide('outerEndY', add('cy', sin('outerY', 'enDeg'))),
      guide('innerEndX', add('cx', cos('innerX', 'enDeg'))),
      guide('innerEndY', add('cy', sin('innerY', 'enDeg'))),
      guide('innerStartX', add('cx', cos('innerX', 'stDeg'))),
      guide('innerStartY', add('cy', sin('innerY', 'stDeg'))),
      guide('tipAng', add('enAng', 'adj2')),
      guide('tipDeg', div('tipAng', ANGLE_UNITS_PER_DEGREE)),
      guide('tipRx', add('outerX', 'tipExtend')),
      guide('tipRy', add('outerY', 'tipExtend')),
      guide('tipX', add('cx', cos('tipRx', 'tipDeg'))),
      guide('tipY', add('cy', sin('tipRy', 'tipDeg')))
    ],
    textBounds: {
      left: mul('w', 0.18),
      top: mul('h', 0.2),
      right: mul('w', 0.18),
      bottom: mul('h', 0.18)
    },
    elements: [
      {
        kind: 'path',
        defaultJoin: 'round',
        commands: [
          {
            type: 'M',
            x: 'outerStartX',
            y: 'outerStartY'
          },
          {
            type: 'A',
            rx: 'outerX',
            ry: 'outerY',
            rotation: 0,
            largeArc: 'largeArcFlag',
            sweep: true,
            x: 'outerEndX',
            y: 'outerEndY'
          },
          {
            type: 'L',
            x: 'innerEndX',
            y: 'innerEndY'
          },
          {
            type: 'A',
            rx: 'innerX',
            ry: 'innerY',
            rotation: 0,
            largeArc: 'largeArcFlag',
            sweep: false,
            x: 'innerStartX',
            y: 'innerStartY'
          },
          {
            type: 'Z'
          }
        ]
      },
      {
        kind: 'polygon',
        defaultJoin: 'round',
        lineJoin: 'round',
        points: [
          {
            x: 'outerEndX',
            y: 'outerEndY'
          },
          {
            x: 'tipX',
            y: 'tipY'
          },
          {
            x: 'innerEndX',
            y: 'innerEndY'
          }
        ]
      }
    ]
  },
  curvedRightArrow: {
    guides: createCurvedRightArrowGuides(),
    elements: [
      {
        kind: 'path',
        fill: 'darkenLess',
        defaultJoin: 'round',
        lineJoin: 'round',
        stroke: 'none',
        applyLineStyles: false,
        commands: [
          { type: 'M', x: 'r', y: 't' },
          { type: 'A', rx: 'w', ry: 'hR', sweep: false, x: 'l', y: 'hR' },
          { type: 'L', x: 'l', y: 'y3' },
          { type: 'A', rx: 'w', ry: 'hR', sweep: true, x: 'r', y: 'th' },
          { type: 'Z' }
        ]
      },
      {
        kind: 'path',
        defaultJoin: 'round',
        lineJoin: 'round',
        stroke: 'none',
        applyLineStyles: false,
        commands: [
          { type: 'M', x: 'l', y: 'hR' },
          { type: 'A', rx: 'w', ry: 'hR', sweep: false, x: 'x1', y: 'y5' },
          { type: 'L', x: 'x1', y: 'y4' },
          { type: 'L', x: 'r', y: 'y6' },
          { type: 'L', x: 'x1', y: 'b' },
          { type: 'L', x: 'x1', y: 'y8' },
          { type: 'A', rx: 'w', ry: 'hR', sweep: true, x: 'l', y: 'y3' },
          { type: 'Z' }
        ]
      }
    ]
  },
  curvedLeftArrow: {
    guides: createCurvedLeftArrowGuides(),
    elements: [
      {
        kind: 'path',
        defaultJoin: 'round',
        lineJoin: 'round',
        stroke: 'none',
        applyLineStyles: false,
        commands: [
          { type: 'M', x: 'l', y: 'y6' },
          { type: 'L', x: 'x1', y: 'y4' },
          { type: 'L', x: 'x1', y: 'y5' },
          { type: 'A', rx: 'w', ry: 'hR', sweep: false, x: 'outerX', y: 'hR' },
          { type: 'L', x: 'outerX', y: 'innerY' },
          { type: 'A', rx: 'w', ry: 'hR', sweep: true, x: 'curveEndX', y: 'curveEndY' },
          { type: 'L', x: 'x1', y: 'b' },
          { type: 'Z' }
        ]
      },
      {
        kind: 'path',
        fill: 'darkenLess',
        defaultJoin: 'round',
        lineJoin: 'round',
        stroke: 'none',
        applyLineStyles: false,
        commands: [
          { type: 'M', x: 'l', y: 't' },
          { type: 'A', rx: 'w', ry: 'hR', sweep: true, x: 'outerX', y: 'hR' },
          { type: 'L', x: 'outerX', y: 'innerY' },
          { type: 'A', rx: 'w', ry: 'hR', sweep: false, x: 'l', y: 'th' },
          { type: 'Z' }
        ]
      }
    ]
  },
  curvedUpArrow: {
    guides: createCurvedUpArrowGuides(),
    elements: [
      {
        kind: 'path',
        defaultJoin: 'round',
        lineJoin: 'round',
        stroke: 'none',
        applyLineStyles: false,
        commands: [
          { type: 'M', x: 'headOuterX', y: 't' },
          { type: 'L', x: 'headBaseX', y: 'th' },
          { type: 'L', x: 'headJoinX', y: 'th' },
          { type: 'A', rx: 'arcX', ry: 'h', sweep: true, x: 'arcX', y: 'h' },
          { type: 'L', x: 'bandX', y: 'h' },
          { type: 'A', rx: 'arcX', ry: 'h', sweep: false, x: 'rightArcEndX', y: 'th' },
          { type: 'L', x: 'w', y: 'th' },
          { type: 'Z' }
        ]
      },
      {
        kind: 'path',
        fill: 'darkenLess',
        defaultJoin: 'round',
        lineJoin: 'round',
        stroke: 'none',
        applyLineStyles: false,
        commands: [
          { type: 'M', x: 'th', y: 't' },
          { type: 'L', x: 'l', y: 't' },
          { type: 'A', rx: 'arcX', ry: 'h', sweep: false, x: 'arcX', y: 'h' },
          { type: 'L', x: 'bandX', y: 'h' },
          { type: 'A', rx: 'arcX', ry: 'h', sweep: true, x: 'th', y: 't' },
          { type: 'Z' }
        ]
      }
    ]
  },
  curvedDownArrow: {
    guides: createCurvedDownArrowGuides(),
    elements: [
      {
        kind: 'path',
        fill: 'darkenLess',
        defaultJoin: 'round',
        lineJoin: 'round',
        stroke: 'none',
        applyLineStyles: false,
        commands: [
          { type: 'M', x: 'l', y: 'b' },
          { type: 'L', x: 'th', y: 'b' },
          { type: 'A', rx: 'arcX', ry: 'h', sweep: true, x: 'bandX', y: 't' },
          { type: 'L', x: 'arcX', y: 't' },
          { type: 'A', rx: 'arcX', ry: 'h', sweep: false, x: 'l', y: 'b' },
          { type: 'Z' }
        ]
      },
      {
        kind: 'path',
        defaultJoin: 'round',
        lineJoin: 'round',
        stroke: 'none',
        applyLineStyles: false,
        commands: [
          { type: 'M', x: 'headOuterX', y: 'b' },
          { type: 'L', x: 'headBaseX', y: 'barY' },
          { type: 'L', x: 'headJoinX', y: 'barY' },
          { type: 'A', rx: 'arcX', ry: 'h', sweep: false, x: 'arcX', y: 't' },
          { type: 'L', x: 'bandX', y: 't' },
          { type: 'A', rx: 'arcX', ry: 'h', sweep: true, x: 'rightArcEndX', y: 'barY' },
          { type: 'L', x: 'w', y: 'barY' },
          { type: 'Z' }
        ]
      }
    ]
  },
  smileyFace: {
    textBounds: {
      left: mul('w', 0.14),
      top: mul('h', 0.18),
      right: mul('w', 0.14),
      bottom: mul('h', 0.16)
    },
    guides: [
      guide('adj', 4653),
      guide('a', pin(-4653, 'adj', 4653)),
      guide('rx', div('w', 2)),
      guide('ry', div('h', 2)),
      guide('eyeRadius', mul('ss', 1125 / 21600)),
      guide('leftEyeX', mul('w', 6215 / 21600)),
      guide('rightEyeX', mul('w', 13135 / 21600)),
      guide('eyeY', mul('h', 7570 / 21600)),
      guide('smileStartX', mul('w', 4969 / 21699)),
      guide('smileBaseY', mul('h', 16515 / 21600)),
      guide('mouthOffset', div(mul('h', 'a'), 100000)),
      guide('smileStartY', sub('smileBaseY', 'mouthOffset')),
      guide('smileEndX', mul('w', 16640 / 21600)),
      guide('smileEndY', 'smileStartY'),
      guide('smileArcLift', div(mul('h', 'a'), 50000)),
      guide('smileControlX', div('w', 2)),
      guide('smileControlY', add(add('smileBaseY', 'mouthOffset'), 'smileArcLift'))
    ],
    elements: [
      {
        kind: 'ellipse',
        defaultJoin: 'round',
        cx: 'cx',
        cy: 'cy',
        rx: 'rx',
        ry: 'ry'
      },
      {
        kind: 'circle',
        fill: 'stroke',
        stroke: 'none',
        applyLineStyles: false,
        cx: 'leftEyeX',
        cy: 'eyeY',
        r: 'eyeRadius'
      },
      {
        kind: 'circle',
        fill: 'stroke',
        stroke: 'none',
        applyLineStyles: false,
        cx: 'rightEyeX',
        cy: 'eyeY',
        r: 'eyeRadius'
      },
      {
        kind: 'path',
        fill: 'none',
        minStrokeWidth: 2,
        lineCap: 'round',
        lineJoin: 'round',
        applyLineStyles: false,
        applyDashPattern: true,
        commands: [
          {
            type: 'M',
            x: 'smileStartX',
            y: 'smileStartY'
          },
          {
            type: 'Q',
            x1: 'smileControlX',
            y1: 'smileControlY',
            x: 'smileEndX',
            y: 'smileEndY'
          }
        ]
      }
    ]
  },
  frame: {
    guides: [
      guide('adj1', 12500),
      guide('a1', pin(0, 'adj1', 50000)),
      guide('x1', div(mul('ss', 'a1'), 100000)),
      guide('x4', sub('r', 'x1')),
      guide('y4', sub('b', 'x1'))
    ],
    elements: [
      {
        kind: 'path',
        defaultJoin: 'round',
        fillRule: 'evenodd',
        clipRule: 'evenodd',
        commands: [
          {
            type: 'M',
            x: 0,
            y: 0
          },
          {
            type: 'H',
            x: 'w'
          },
          {
            type: 'V',
            y: 'h'
          },
          {
            type: 'H',
            x: 0
          },
          {
            type: 'Z'
          },
          {
            type: 'M',
            x: 'x1',
            y: 'x1'
          },
          {
            type: 'V',
            y: 'y4'
          },
          {
            type: 'H',
            x: 'x4'
          },
          {
            type: 'V',
            y: 'x1'
          },
          {
            type: 'Z'
          }
        ]
      }
    ]
  },
  halfFrame: {
    guides: [
      guide('adj1', 33333),
      guide('adj2', 33333),
      guide('maxAdj2', div(mul(100000, 'w'), 'ss')),
      guide('a2', pin(0, 'adj2', 'maxAdj2')),
      guide('x1', div(mul('ss', 'a2'), 100000)),
      guide('g1', div(mul('h', 'x1'), 'w')),
      guide('g2', sub('h', 'g1')),
      guide('maxAdj1', div(mul(100000, 'g2'), 'ss')),
      guide('a1', pin(0, 'adj1', 'maxAdj1')),
      guide('y1', div(mul('ss', 'a1'), 100000)),
      guide('dx2', div(mul('y1', 'w'), 'h')),
      guide('x2', sub('r', 'dx2')),
      guide('dy2', div(mul('x1', 'h'), 'w')),
      guide('y2', sub('b', 'dy2'))
    ],
    elements: [
      {
        kind: 'path',
        defaultJoin: 'round',
        commands: [
          { type: 'M', x: 'l', y: 't' },
          { type: 'L', x: 'r', y: 't' },
          { type: 'L', x: 'x2', y: 'y1' },
          { type: 'L', x: 'x1', y: 'y1' },
          { type: 'L', x: 'x1', y: 'y2' },
          { type: 'L', x: 'l', y: 'b' },
          { type: 'Z' }
        ]
      }
    ]
  },
  corner: {
    guides: [guide('innerX', mul('w', 0.425834)), guide('innerY', mul('h', 0.66162))],
    elements: [
      {
        kind: 'path',
        defaultJoin: 'round',
        commands: [
          { type: 'M', x: 0, y: 0 },
          { type: 'L', x: 'innerX', y: 0 },
          { type: 'L', x: 'innerX', y: 'innerY' },
          { type: 'L', x: 'w', y: 'innerY' },
          { type: 'L', x: 'w', y: 'h' },
          { type: 'L', x: 0, y: 'h' },
          { type: 'Z' }
        ]
      }
    ]
  },
  diagStripe: {
    guides: [guide('insetX', mul('w', 0.40909)), guide('insetY', mul('h', 0.40909))],
    elements: [
      {
        kind: 'path',
        defaultJoin: 'round',
        commands: [
          { type: 'M', x: 'insetX', y: 0 },
          { type: 'L', x: 'w', y: 0 },
          { type: 'L', x: 0, y: 'h' },
          { type: 'L', x: 0, y: 'insetY' },
          { type: 'Z' }
        ]
      }
    ]
  },
  plus: {
    guides: [
      guide('adj', 25000),
      guide('a', pin(0, 'adj', 50000)),
      guide('armInset', div(mul('ss', 'a'), 100000)),
      guide('armX1', 'armInset'),
      guide('armX2', sub('w', 'armInset')),
      guide('armY1', 'armInset'),
      guide('armY2', sub('h', 'armInset'))
    ],
    elements: [
      {
        kind: 'path',
        defaultJoin: 'round',
        commands: [
          { type: 'M', x: 'armX1', y: 0 },
          { type: 'L', x: 'armX2', y: 0 },
          { type: 'L', x: 'armX2', y: 'armY1' },
          { type: 'L', x: 'w', y: 'armY1' },
          { type: 'L', x: 'w', y: 'armY2' },
          { type: 'L', x: 'armX2', y: 'armY2' },
          { type: 'L', x: 'armX2', y: 'h' },
          { type: 'L', x: 'armX1', y: 'h' },
          { type: 'L', x: 'armX1', y: 'armY2' },
          { type: 'L', x: 0, y: 'armY2' },
          { type: 'L', x: 0, y: 'armY1' },
          { type: 'L', x: 'armX1', y: 'armY1' },
          { type: 'Z' }
        ]
      }
    ]
  },
  noSmoking: {
    guides: [
      guide('adj', 18750),
      guide('a', pin(0, 'adj', 50000)),
      guide('dr', div(mul('ss', 'a'), 100000)),
      guide('iwd2', sub('wd2', 'dr')),
      guide('ihd2', sub('hd2', 'dr')),
      guide('ang', at2('w', 'h')),
      guide('angDeg', div('ang', ANGLE_UNITS_PER_DEGREE)),
      guide('ct', cos('ihd2', 'angDeg')),
      guide('st', sin('iwd2', 'angDeg')),
      guide('m', modValue('ct', 'st', 0)),
      guide('n', div(mul('iwd2', 'ihd2'), 'm')),
      guide('drd2', div('dr', 2)),
      guide('dang', at2('n', 'drd2')),
      guide('2dang', add('dang', 'dang')),
      guide('swAng', add(sub(0, 'cd2'), '2dang')),
      guide('t3', at2('w', 'h')),
      guide('stAng1', sub('t3', 'dang')),
      guide('stAng2', sub('stAng1', 'cd2')),
      guide('stAng1Deg', div('stAng1', ANGLE_UNITS_PER_DEGREE)),
      guide('ct1', cos('ihd2', 'stAng1Deg')),
      guide('st1', sin('iwd2', 'stAng1Deg')),
      guide('m1', modValue('ct1', 'st1', 0)),
      guide('n1', div(mul('iwd2', 'ihd2'), 'm1')),
      guide('dx1', cos('n1', 'stAng1Deg')),
      guide('dy1', sin('n1', 'stAng1Deg')),
      guide('x1', add('hc', 'dx1')),
      guide('y1', add('vc', 'dy1')),
      guide('x2', sub('hc', 'dx1')),
      guide('y2', sub('vc', 'dy1')),
      guide('idx', cos('wd2', div(2700000, ANGLE_UNITS_PER_DEGREE))),
      guide('idy', sin('hd2', div(2700000, ANGLE_UNITS_PER_DEGREE))),
      guide('il', sub('hc', 'idx')),
      guide('ir', add('hc', 'idx')),
      guide('it', sub('vc', 'idy')),
      guide('ib', add('vc', 'idy'))
    ],
    textBounds: {
      left: 'il',
      top: 'it',
      right: sub('w', 'ir'),
      bottom: sub('h', 'ib')
    },
    elements: [
      {
        kind: 'path',
        fillRule: 'evenodd',
        clipRule: 'evenodd',
        commands: [
          { type: 'M', x: 'l', y: 'vc' },
          { type: 'OA', rx: 'wd2', ry: 'hd2', startAngle: 'cd2', sweepAngle: 'cd4' },
          { type: 'OA', rx: 'wd2', ry: 'hd2', startAngle: '3cd4', sweepAngle: 'cd4' },
          { type: 'OA', rx: 'wd2', ry: 'hd2', startAngle: 0, sweepAngle: 'cd4' },
          { type: 'OA', rx: 'wd2', ry: 'hd2', startAngle: 'cd4', sweepAngle: 'cd4' },
          { type: 'Z' },
          { type: 'M', x: 'x1', y: 'y1' },
          { type: 'OA', rx: 'iwd2', ry: 'ihd2', startAngle: 'stAng1', sweepAngle: 'swAng' },
          { type: 'Z' },
          { type: 'M', x: 'x2', y: 'y2' },
          { type: 'OA', rx: 'iwd2', ry: 'ihd2', startAngle: 'stAng2', sweepAngle: 'swAng' },
          { type: 'Z' }
        ]
      }
    ]
  },
  bevel: {
    guides: [
      guide('adj', 12500),
      guide('a', pin(0, 'adj', 50000)),
      guide('x1', div(mul('ss', 'a'), 100000)),
      guide('x2', sub('r', 'x1')),
      guide('y2', sub('b', 'x1'))
    ],
    textBounds: {
      left: 'x1',
      top: 'x1',
      right: 'x1',
      bottom: sub('h', 'y2')
    },
    elements: [
      {
        kind: 'path',
        defaultJoin: 'round',
        commands: [
          { type: 'M', x: 'x1', y: 'x1' },
          { type: 'L', x: 'x2', y: 'x1' },
          { type: 'L', x: 'x2', y: 'y2' },
          { type: 'L', x: 'x1', y: 'y2' },
          { type: 'Z' }
        ]
      },
      {
        kind: 'path',
        fill: 'lightenLess',
        defaultJoin: 'round',
        commands: [
          { type: 'M', x: 'l', y: 't' },
          { type: 'L', x: 'r', y: 't' },
          { type: 'L', x: 'x2', y: 'x1' },
          { type: 'L', x: 'x1', y: 'x1' },
          { type: 'Z' }
        ]
      },
      {
        kind: 'path',
        fill: 'darken',
        defaultJoin: 'round',
        commands: [
          { type: 'M', x: 'l', y: 'b' },
          { type: 'L', x: 'x1', y: 'y2' },
          { type: 'L', x: 'x2', y: 'y2' },
          { type: 'L', x: 'r', y: 'b' },
          { type: 'Z' }
        ]
      },
      {
        kind: 'path',
        fill: 'lighten',
        defaultJoin: 'round',
        commands: [
          { type: 'M', x: 'l', y: 't' },
          { type: 'L', x: 'x1', y: 'x1' },
          { type: 'L', x: 'x1', y: 'y2' },
          { type: 'L', x: 'l', y: 'b' },
          { type: 'Z' }
        ]
      },
      {
        kind: 'path',
        fill: 'darken',
        defaultJoin: 'round',
        commands: [
          { type: 'M', x: 'r', y: 't' },
          { type: 'L', x: 'x2', y: 'x1' },
          { type: 'L', x: 'x2', y: 'y2' },
          { type: 'L', x: 'r', y: 'b' },
          { type: 'Z' }
        ]
      }
    ]
  },
  chevron: {
    guides: [
      guide('adj', 50000),
      guide('maxAdj', div(mul(100000, 'w'), 'ss')),
      guide('a', pin(0, 'adj', 'maxAdj')),
      guide('x1', div(mul('ss', 'a'), 100000)),
      guide('x2', sub('w', 'x1'))
    ],
    textBounds: {
      left: 'x1',
      top: mul('h', 0.12),
      right: sub('w', 'x2'),
      bottom: mul('h', 0.12)
    },
    elements: [
      {
        kind: 'polygon',
        defaultJoin: 'round',
        coerceMiterJoin: 'round',
        points: [
          { x: 0, y: 0 },
          { x: 'x2', y: 0 },
          { x: 'w', y: 'cy' },
          { x: 'x2', y: 'h' },
          { x: 0, y: 'h' },
          { x: 'x1', y: 'cy' }
        ]
      }
    ]
  },
  parallelogram: {
    guides: [
      guide('adj', 25000),
      guide('maxAdj', div(mul(100000, 'w'), 'ss')),
      guide('a', pin(0, 'adj', 'maxAdj')),
      guide('x2', div(mul('ss', 'a'), 100000)),
      guide('x5', sub('w', 'x2'))
    ],
    textBounds: {
      left: 'x2',
      top: mul('h', 0.12),
      right: 'x2',
      bottom: mul('h', 0.12)
    },
    elements: [
      {
        kind: 'polygon',
        defaultJoin: 'round',
        points: [
          { x: 0, y: 'h' },
          { x: 'x2', y: 0 },
          { x: 'w', y: 0 },
          { x: 'x5', y: 'h' }
        ]
      }
    ]
  },
  trapezoid: {
    guides: [
      guide('adj', 25000),
      guide('maxAdj', div(mul(50000, 'w'), 'ss')),
      guide('a', pin(0, 'adj', 'maxAdj')),
      guide('x2', div(mul('ss', 'a'), 100000)),
      guide('x3', sub('w', 'x2'))
    ],
    textBounds: {
      left: 'x2',
      top: mul('h', 0.12),
      right: 'x2',
      bottom: mul('h', 0.12)
    },
    elements: [
      {
        kind: 'polygon',
        defaultJoin: 'round',
        points: [
          { x: 0, y: 'h' },
          { x: 'x2', y: 0 },
          { x: 'x3', y: 0 },
          { x: 'w', y: 'h' }
        ]
      }
    ]
  },
  hexagon: {
    guides: [
      guide('adj', 25000),
      guide('vf', 115470),
      guide('maxAdj', div(mul(50000, 'w'), 'ss')),
      guide('a', pin(0, 'adj', 'maxAdj')),
      guide('x1', div(mul('ss', 'a'), 100000)),
      guide('x2', sub('w', 'x1')),
      guide('vr', div(mul('cy', 'vf'), 100000)),
      guide('yInset', sin('vr', 120)),
      guide('y1', sub('cy', 'yInset')),
      guide('y2', add('cy', 'yInset'))
    ],
    textBounds: {
      left: 'x1',
      top: 'y1',
      right: 'x1',
      bottom: sub('h', 'y2')
    },
    elements: [
      {
        kind: 'polygon',
        defaultJoin: 'round',
        points: [
          { x: 0, y: 'cy' },
          { x: 'x1', y: 'y1' },
          { x: 'x2', y: 'y1' },
          { x: 'w', y: 'cy' },
          { x: 'x2', y: 'y2' },
          { x: 'x1', y: 'y2' }
        ]
      }
    ]
  },
  heptagon: createRegularPolygonDefinition(7, -90),
  triangle: {
    guides: [
      guide('adj', 50000),
      guide('a', pin(0, 'adj', 100000)),
      guide('x2', div(mul('w', 'a'), 100000))
    ],
    textBounds: {
      left: mul('w', 0.16),
      top: mul('h', 0.3),
      right: mul('w', 0.16),
      bottom: mul('h', 0.08)
    },
    elements: [
      {
        kind: 'polygon',
        defaultJoin: 'round',
        points: [
          { x: 0, y: 'h' },
          { x: 'x2', y: 0 },
          { x: 'w', y: 'h' }
        ]
      }
    ]
  },
  pentagon: {
    guides: [
      guide('y1', mul('h', 0.3819660113)),
      guide('x2', mul('w', 0.1909830056)),
      guide('x3', mul('w', 0.8090169944))
    ],
    textBounds: {
      left: 'x2',
      top: 'y1',
      right: sub('w', 'x3'),
      bottom: mul('h', 0.08)
    },
    elements: [
      {
        kind: 'polygon',
        defaultJoin: 'round',
        points: [
          { x: 0, y: 'y1' },
          { x: 'cx', y: 0 },
          { x: 'w', y: 'y1' },
          { x: 'x3', y: 'h' },
          { x: 'x2', y: 'h' }
        ]
      }
    ]
  },
  octagon: {
    guides: [
      guide('adj', 29289),
      guide('a', pin(0, 'adj', 50000)),
      guide('x1', div(mul('ss', 'a'), 100000)),
      guide('x2', sub('w', 'x1')),
      guide('y2', sub('h', 'x1'))
    ],
    textBounds: {
      // The reference preview keeps octagon labels noticeably wider than the
      // raw cut corner inset; using half the cut depth matches that behavior
      // more closely while still avoiding the clipped corners.
      left: div('x1', 2),
      top: div('x1', 2),
      right: div('x1', 2),
      bottom: div('x1', 2)
    },
    elements: [
      {
        kind: 'polygon',
        defaultJoin: 'round',
        points: [
          { x: 0, y: 'x1' },
          { x: 'x1', y: 0 },
          { x: 'x2', y: 0 },
          { x: 'w', y: 'x1' },
          { x: 'w', y: 'y2' },
          { x: 'x2', y: 'h' },
          { x: 'x1', y: 'h' },
          { x: 0, y: 'y2' }
        ]
      }
    ]
  },
  decagon: createRegularPolygonDefinition(10, -90),
  dodecagon: createRegularPolygonDefinition(12, -90),
  diamond: {
    textBounds: {
      left: mul('w', 0.18),
      top: mul('h', 0.16),
      right: mul('w', 0.18),
      bottom: mul('h', 0.16)
    },
    elements: [
      {
        kind: 'polygon',
        defaultJoin: 'round',
        points: [
          { x: 'cx', y: 0 },
          { x: 'w', y: 'cy' },
          { x: 'cx', y: 'h' },
          { x: 0, y: 'cy' }
        ]
      }
    ]
  },
  rtTriangle: {
    textBounds: {
      left: mul('w', 0.16),
      top: mul('h', 0.28),
      right: mul('w', 0.16),
      bottom: mul('h', 0.08)
    },
    elements: [
      {
        kind: 'polygon',
        defaultJoin: 'round',
        points: [
          { x: 0, y: 0 },
          { x: 'w', y: 'h' },
          { x: 0, y: 'h' }
        ]
      }
    ]
  },
  star5: {
    guides: [
      guide('adj', 19098),
      guide('a', pin(0, 'adj', 50000)),
      guide('innerRx', div(mul('cx', 'a'), 50000)),
      guide('innerRy', div(mul('cy', 'a'), 50000))
    ],
    textBounds: {
      left: mul('w', 0.24),
      top: mul('h', 0.22),
      right: mul('w', 0.24),
      bottom: mul('h', 0.26)
    },
    elements: [
      {
        kind: 'polygon',
        defaultJoin: 'round',
        points: [
          { x: add('cx', cos('cx', -90)), y: add('cy', sin('cy', -90)) },
          { x: add('cx', cos('innerRx', -54)), y: add('cy', sin('innerRy', -54)) },
          { x: add('cx', cos('cx', -18)), y: add('cy', sin('cy', -18)) },
          { x: add('cx', cos('innerRx', 18)), y: add('cy', sin('innerRy', 18)) },
          { x: add('cx', cos('cx', 54)), y: add('cy', sin('cy', 54)) },
          { x: add('cx', cos('innerRx', 90)), y: add('cy', sin('innerRy', 90)) },
          { x: add('cx', cos('cx', 126)), y: add('cy', sin('cy', 126)) },
          { x: add('cx', cos('innerRx', 162)), y: add('cy', sin('innerRy', 162)) },
          { x: add('cx', cos('cx', 198)), y: add('cy', sin('cy', 198)) },
          { x: add('cx', cos('innerRx', 234)), y: add('cy', sin('innerRy', 234)) }
        ]
      }
    ]
  },
  teardrop: {
    guides: [
      guide('adj', 100000),
      guide('a', pin(0, 'adj', 200000)),
      guide('tipDx', div(mul('w', 'a'), 200000)),
      guide('tipDy', div(mul('h', 'a'), 200000)),
      guide('tipX', add('cx', 'tipDx')),
      guide('tipY', sub('cy', 'tipDy')),
      guide('topCtrlX', add('cx', div('tipDx', 2))),
      guide('rightCtrlY', sub('cy', div('tipDy', 2)))
    ],
    textBounds: {
      left: mul('w', 0.146447),
      top: mul('h', 0.277228),
      right: mul('w', 0.146447),
      bottom: mul('h', 0.277228)
    },
    elements: [
      {
        kind: 'path',
        defaultJoin: 'round',
        commands: [
          { type: 'M', x: 'w', y: 'cy' },
          {
            type: 'A',
            rx: 'cx',
            ry: 'cy',
            rotation: 0,
            largeArc: true,
            sweep: true,
            x: 'cx',
            y: 0
          },
          { type: 'Q', x1: 'topCtrlX', y1: 0, x: 'tipX', y: 'tipY' },
          { type: 'Q', x1: 'w', y1: 'rightCtrlY', x: 'w', y: 'cy' }
        ]
      }
    ]
  },
  homePlate: {
    guides: [
      guide('adj', 50000),
      guide('a', pin(0, 'adj', 100000)),
      guide('depth', div(mul('h', 'a'), 100000)),
      guide('x1', sub('w', 'depth'))
    ],
    textBounds: {
      left: mul('w', 0.08),
      top: mul('h', 0.12),
      right: sub('w', 'x1'),
      bottom: mul('h', 0.12)
    },
    elements: [
      {
        kind: 'polygon',
        defaultJoin: 'round',
        coerceMiterJoin: 'round',
        points: [
          { x: 0, y: 0 },
          { x: 'x1', y: 0 },
          { x: 'w', y: 'cy' },
          { x: 'x1', y: 'h' },
          { x: 0, y: 'h' }
        ]
      }
    ]
  },
  rightArrow: {
    guides: [
      guide('adj1', 47500),
      guide('adj2', 26000),
      guide('shaftInset', div(mul('h', pin(0, 'adj1', 100000)), 200000)),
      guide('headDepth', minValue(div(mul('w', pin(0, 'adj2', 100000)), 100000), 'hd2')),
      guide('headStart', sub('w', 'headDepth')),
      guide('y1', 'shaftInset'),
      guide('y2', sub('h', 'shaftInset'))
    ],
    textBounds: {
      left: mul('w', 0.08),
      top: 'y1',
      right: sub('w', 'headStart'),
      bottom: sub('h', 'y2')
    },
    elements: [
      {
        kind: 'polygon',
        defaultJoin: 'round',
        coerceMiterJoin: 'round',
        points: [
          { x: 0, y: 'y1' },
          { x: 'headStart', y: 'y1' },
          { x: 'headStart', y: 0 },
          { x: 'w', y: 'cy' },
          { x: 'headStart', y: 'h' },
          { x: 'headStart', y: 'y2' },
          { x: 0, y: 'y2' }
        ]
      }
    ]
  },
  notchedRightArrow: {
    guides: [
      guide('adj1', 50000),
      guide('adj2', 20000),
      guide('shaftInset', div(mul('h', pin(0, 'adj1', 100000)), 200000)),
      guide('headStart', sub('w', div(mul('w', pin(0, 'adj2', 100000)), 100000))),
      guide('notchX', minValue('shaftInset', sub('headStart', 1))),
      guide('y1', 'shaftInset'),
      guide('y2', sub('h', 'shaftInset'))
    ],
    textBounds: {
      left: mul('w', 0.08),
      top: 'y1',
      right: sub('w', 'headStart'),
      bottom: sub('h', 'y2')
    },
    elements: [
      {
        kind: 'polygon',
        defaultJoin: 'round',
        coerceMiterJoin: 'round',
        points: [
          { x: 0, y: 'y1' },
          { x: 'headStart', y: 'y1' },
          { x: 'headStart', y: 0 },
          { x: 'w', y: 'cy' },
          { x: 'headStart', y: 'h' },
          { x: 'headStart', y: 'y2' },
          { x: 0, y: 'y2' },
          { x: 'notchX', y: 'cy' }
        ]
      }
    ]
  },
  leftArrow: {
    guides: [
      guide('adj1', 50000),
      guide('adj2', 26000),
      guide('shaftInset', div(mul('h', pin(0, 'adj1', 100000)), 200000)),
      guide('headEnd', minValue(div(mul('w', pin(0, 'adj2', 100000)), 100000), 'hd2')),
      guide('y1', 'shaftInset'),
      guide('y2', sub('h', 'shaftInset'))
    ],
    textBounds: {
      left: 'headEnd',
      top: 'y1',
      right: mul('w', 0.08),
      bottom: sub('h', 'y2')
    },
    elements: [
      {
        kind: 'polygon',
        defaultJoin: 'round',
        coerceMiterJoin: 'round',
        points: [
          { x: 'w', y: 'y1' },
          { x: 'headEnd', y: 'y1' },
          { x: 'headEnd', y: 0 },
          { x: 0, y: 'cy' },
          { x: 'headEnd', y: 'h' },
          { x: 'headEnd', y: 'y2' },
          { x: 'w', y: 'y2' }
        ]
      }
    ]
  },
  leftRightArrow: {
    guides: [
      guide('adj1', 50000),
      guide('adj2', 24000),
      guide('shaftInset', div(mul('h', pin(0, 'adj1', 100000)), 200000)),
      guide('sideInsetRaw', div(mul('w', pin(0, 'adj2', 50000)), 100000)),
      guide('sideInset', minValue('sideInsetRaw', 'hd2')),
      guide('rightInset', sub('w', 'sideInset')),
      guide('y1', 'shaftInset'),
      guide('y2', sub('h', 'shaftInset'))
    ],
    textBounds: {
      left: 'sideInset',
      top: 'y1',
      right: 'sideInset',
      bottom: sub('h', 'y2')
    },
    elements: [
      {
        kind: 'polygon',
        defaultJoin: 'round',
        coerceMiterJoin: 'round',
        points: [
          { x: 'sideInset', y: 'y1' },
          { x: 'rightInset', y: 'y1' },
          { x: 'rightInset', y: 0 },
          { x: 'w', y: 'cy' },
          { x: 'rightInset', y: 'h' },
          { x: 'rightInset', y: 'y2' },
          { x: 'sideInset', y: 'y2' },
          { x: 'sideInset', y: 'h' },
          { x: 0, y: 'cy' },
          { x: 'sideInset', y: 0 }
        ]
      }
    ]
  },
  upArrow: {
    guides: [
      guide('adj1', 50000),
      guide('adj2', 25000),
      guide('shaftLeft', div(mul('w', pin(0, 'adj1', 100000)), 200000)),
      guide('shaftRight', sub('w', 'shaftLeft')),
      guide('headBaseYRaw', div(mul('h', pin(0, 'adj2', 100000)), 100000)),
      guide('headBaseY', minValue('headBaseYRaw', 'wd2'))
    ],
    textBounds: {
      left: 'shaftLeft',
      top: 'headBaseY',
      right: sub('w', 'shaftRight'),
      bottom: mul('h', 0.08)
    },
    elements: [
      {
        kind: 'polygon',
        defaultJoin: 'round',
        coerceMiterJoin: 'round',
        points: [
          { x: 'shaftLeft', y: 'headBaseY' },
          { x: 'shaftLeft', y: 'h' },
          { x: 'shaftRight', y: 'h' },
          { x: 'shaftRight', y: 'headBaseY' },
          { x: 'w', y: 'headBaseY' },
          { x: 'cx', y: 0 },
          { x: 0, y: 'headBaseY' }
        ]
      }
    ]
  },
  downArrow: {
    guides: [
      guide('adj1', 50000),
      guide('adj2', 75000),
      guide('shaftLeft', div(mul('w', pin(0, 'adj1', 100000)), 200000)),
      guide('shaftRight', sub('w', 'shaftLeft')),
      guide('headBaseYRaw', div(mul('h', pin(0, 'adj2', 100000)), 100000)),
      guide('headBaseY', minValue('headBaseYRaw', sub('h', 1)))
    ],
    textBounds: {
      left: 'shaftLeft',
      top: mul('h', 0.08),
      right: sub('w', 'shaftRight'),
      bottom: sub('h', 'headBaseY')
    },
    elements: [
      {
        kind: 'polygon',
        defaultJoin: 'round',
        coerceMiterJoin: 'round',
        points: [
          { x: 'shaftLeft', y: 0 },
          { x: 'shaftLeft', y: 'headBaseY' },
          { x: 0, y: 'headBaseY' },
          { x: 'cx', y: 'h' },
          { x: 'w', y: 'headBaseY' },
          { x: 'shaftRight', y: 'headBaseY' },
          { x: 'shaftRight', y: 0 }
        ]
      }
    ]
  },
  quadArrow: {
    guides: [
      guide('adj1', 22500),
      guide('adj2', 22500),
      guide('adj3', 22500),
      guide('shaftHalf', div(mul('ss', pin(0, 'adj2', 50000)), 100000)),
      guide('maxArmHalf', div(sub(100000, mul(pin(0, 'adj2', 50000), 2)), 2)),
      guide('armHalf', div(mul('ss', pin(0, 'adj1', add(pin(0, 'adj2', 50000), pin(0, 'adj2', 50000)))), 200000)),
      guide('headInset', div(mul('ss', pin(0, 'adj3', 'maxArmHalf')), 100000)),
      guide('armX1', sub('cx', 'armHalf')),
      guide('armX2', add('cx', 'armHalf')),
      guide('shaftX1', sub('cx', 'shaftHalf')),
      guide('shaftX2', add('cx', 'shaftHalf')),
      guide('armY1', sub('cy', 'armHalf')),
      guide('armY2', add('cy', 'armHalf')),
      guide('shaftY1', sub('cy', 'shaftHalf')),
      guide('shaftY2', add('cy', 'shaftHalf')),
      guide('headRightX', sub('w', 'headInset')),
      guide('headBottomY', sub('h', 'headInset')),
      guide('textInsetX', div(mul('armHalf', 'headInset'), maxValue('shaftHalf', 1)))
    ],
    textBounds: {
      left: 'textInsetX',
      top: 'armY1',
      right: sub('w', sub('w', 'textInsetX')),
      bottom: sub('h', 'armY2')
    },
    elements: [
      {
        kind: 'polygon',
        defaultJoin: 'round',
        coerceMiterJoin: 'round',
        points: [
          { x: 0, y: 'cy' },
          { x: 'headInset', y: 'shaftY1' },
          { x: 'headInset', y: 'armY1' },
          { x: 'armX1', y: 'armY1' },
          { x: 'armX1', y: 'headInset' },
          { x: 'shaftX1', y: 'headInset' },
          { x: 'cx', y: 0 },
          { x: 'shaftX2', y: 'headInset' },
          { x: 'armX2', y: 'headInset' },
          { x: 'armX2', y: 'armY1' },
          { x: 'headRightX', y: 'armY1' },
          { x: 'headRightX', y: 'shaftY1' },
          { x: 'w', y: 'cy' },
          { x: 'headRightX', y: 'shaftY2' },
          { x: 'headRightX', y: 'armY2' },
          { x: 'armX2', y: 'armY2' },
          { x: 'armX2', y: 'headBottomY' },
          { x: 'shaftX2', y: 'headBottomY' },
          { x: 'cx', y: 'h' },
          { x: 'shaftX1', y: 'headBottomY' },
          { x: 'armX1', y: 'headBottomY' },
          { x: 'armX1', y: 'armY2' },
          { x: 'headInset', y: 'armY2' },
          { x: 'headInset', y: 'shaftY2' }
        ]
      }
    ]
  },
  leftRightUpArrow: {
    guides: [
      guide('sideHeadInset', mul('w', 28.35 / 175)),
      guide('sideShoulderY', mul('h', 69.3 / 126)),
      guide('topHeadBaseY', mul('h', 28.35 / 126)),
      guide('topHeadInnerLeft', mul('w', 59.15 / 175)),
      guide('shaftLeft', mul('w', 73.325 / 175)),
      guide('shaftRight', mul('w', 101.675 / 175)),
      guide('topHeadInnerRight', mul('w', 115.85 / 175)),
      guide('barRight', mul('w', 146.65 / 175)),
      guide('barTop', mul('h', 83.475 / 126)),
      guide('barMid', mul('h', 97.65 / 126)),
      guide('barBottom', mul('h', 111.825 / 126))
    ],
    textBounds: {
      left: mul('w', 0.2),
      top: 'topHeadBaseY',
      right: mul('w', 0.2),
      bottom: sub('h', 'barBottom')
    },
    elements: [
      {
        kind: 'path',
        defaultJoin: 'round',
        coerceMiterJoin: 'round',
        commands: [
          { type: 'M', x: 'l', y: 'barMid' },
          { type: 'L', x: 'sideHeadInset', y: 'sideShoulderY' },
          { type: 'L', x: 'sideHeadInset', y: 'barTop' },
          { type: 'L', x: 'shaftLeft', y: 'barTop' },
          { type: 'L', x: 'shaftLeft', y: 'topHeadBaseY' },
          { type: 'L', x: 'topHeadInnerLeft', y: 'topHeadBaseY' },
          { type: 'L', x: 'hc', y: 't' },
          { type: 'L', x: 'topHeadInnerRight', y: 'topHeadBaseY' },
          { type: 'L', x: 'shaftRight', y: 'topHeadBaseY' },
          { type: 'L', x: 'shaftRight', y: 'barTop' },
          { type: 'L', x: 'barRight', y: 'barTop' },
          { type: 'L', x: 'barRight', y: 'sideShoulderY' },
          { type: 'L', x: 'r', y: 'barMid' },
          { type: 'L', x: 'barRight', y: 'b' },
          { type: 'L', x: 'barRight', y: 'barBottom' },
          { type: 'L', x: 'sideHeadInset', y: 'barBottom' },
          { type: 'L', x: 'sideHeadInset', y: 'b' },
          { type: 'Z' }
        ]
      }
    ]
  },
  bentArrow: {
    guides: [
      guide('adj1', 26000),
      guide('adj2', 42000),
      guide('adj3', 18000),
      guide('a1', pin(12000, 'adj1', 38000)),
      guide('a2', pin(26000, 'adj2', 76000)),
      guide('a3', pin(16000, 'adj3', 42000)),
      guide('th', div(mul('ss', 'a1'), 100000)),
      guide('headLen', div(mul('ss', 'a3'), 100000)),
      guide('shaftEndX', maxValue(add('th', 1), sub('w', 'headLen'))),
      guide('bendRaw', div(mul('ss', 'a2'), 100000)),
      guide('bend', minValue('bendRaw', sub('shaftEndX', 1), sub('h', 1))),
      guide('topGap', maxValue(div('th', 2), mul('ss', 0.1))),
      guide('inner', maxValue(sub(sub('bend', 'th'), 'topGap'), 1)),
      guide('headH', maxValue(add('th', mul('th', 0.12)), mul('ss', 0.24))),
      guide('headHalf', div('headH', 2)),
      guide('headMid', add('topGap', 'headHalf')),
      guide('headBottom', add('topGap', 'headH')),
      guide('innerArcStartX', add('th', 'topGap'))
    ],
    textBounds: {
      left: mul('w', 0.08),
      top: mul('h', 0.18),
      right: mul('w', 0.22),
      bottom: mul('h', 0.18)
    },
    elements: [
      {
        kind: 'path',
        defaultJoin: 'round',
        coerceMiterJoin: 'round',
        commands: [
          { type: 'M', x: 'w', y: 'headMid' },
          { type: 'L', x: 'shaftEndX', y: 'topGap' },
          { type: 'L', x: 'bend', y: 'topGap' },
          { type: 'OA', rx: sub('bend', 'topGap'), ry: sub('bend', 'topGap'), startAngle: '3cd4', sweepAngle: -5400000 },
          { type: 'L', x: 0, y: 'bend' },
          { type: 'L', x: 0, y: 'h' },
          { type: 'L', x: 'th', y: 'h' },
          { type: 'L', x: 'th', y: 'bend' },
          { type: 'L', x: 'innerArcStartX', y: 'bend' },
          { type: 'OA', rx: 'inner', ry: 'inner', startAngle: 'cd2', sweepAngle: 'cd4' },
          { type: 'L', x: 'shaftEndX', y: add('topGap', 'th') },
          { type: 'L', x: 'shaftEndX', y: 'headBottom' },
          { type: 'Z' }
        ]
      }
    ]
  },
  uturnArrow: {
    guides: [
      guide('adj1', 25000),
      guide('adj2', 25000),
      guide('adj3', 30000),
      guide('adj4', 45000),
      guide('adj5', 45000),
      guide('a2', pin(0, 'adj2', 25000)),
      guide('maxAdj1', mul('a2', 2)),
      guide('a1', pin(0, 'adj1', 'maxAdj1')),
      guide('q2', div(mul('a1', 'ss'), 'h')),
      guide('q3', sub(100000, 'q2')),
      guide('maxAdj3', div(mul('q3', 'h'), 'ss')),
      guide('a3', pin(0, 'adj3', 'maxAdj3')),
      guide('q1', add('a3', 'a1')),
      guide('minAdj5', div(mul('q1', 'ss'), 'h')),
      guide('a5', pin('minAdj5', 'adj5', 100000)),
      guide('th', div(mul('ss', 'a1'), 100000)),
      guide('aw2', div(mul('ss', 'a2'), 100000)),
      guide('th2', div('th', 2)),
      guide('dh2', sub('aw2', 'th2')),
      guide('y5', div(mul('h', 'a5'), 100000)),
      guide('ah', div(mul('ss', 'a3'), 100000)),
      guide('y4', sub('y5', 'ah')),
      guide('x9', sub('r', 'dh2')),
      guide('bw', div('x9', 2)),
      guide('bs', minValue('bw', 'y4')),
      guide('maxAdj4', div(mul('bs', 100000), 'ss')),
      guide('a4', pin(0, 'adj4', 'maxAdj4')),
      guide('bd', div(mul('ss', 'a4'), 100000)),
      guide('bd3', sub('bd', 'th')),
      guide('bd2', maxValue('bd3', 0)),
      guide('x3', add('th', 'bd2')),
      guide('x8', sub('r', 'aw2')),
      guide('x6', sub('x8', 'aw2')),
      guide('x7', add('x6', 'dh2')),
      guide('x4', sub('x9', 'bd')),
      guide('x5', sub('x7', 'bd2'))
    ],
    elements: [
      {
        kind: 'path',
        defaultJoin: 'round',
        coerceMiterJoin: 'round',
        commands: [
          { type: 'M', x: 'l', y: 'b' },
          { type: 'L', x: 'l', y: 'bd' },
          { type: 'OA', rx: 'bd', ry: 'bd', startAngle: 'cd2', sweepAngle: 'cd4' },
          { type: 'L', x: 'x4', y: 't' },
          { type: 'OA', rx: 'bd', ry: 'bd', startAngle: '3cd4', sweepAngle: 'cd4' },
          { type: 'L', x: 'x9', y: 'y4' },
          { type: 'L', x: 'r', y: 'y4' },
          { type: 'L', x: 'x8', y: 'y5' },
          { type: 'L', x: 'x6', y: 'y4' },
          { type: 'L', x: 'x7', y: 'y4' },
          { type: 'L', x: 'x7', y: 'x3' },
          { type: 'OA', rx: 'bd2', ry: 'bd2', startAngle: 0, sweepAngle: -5400000 },
          { type: 'L', x: 'x3', y: 'th' },
          { type: 'OA', rx: 'bd2', ry: 'bd2', startAngle: '3cd4', sweepAngle: -5400000 },
          { type: 'L', x: 'th', y: 'b' },
          { type: 'Z' }
        ]
      }
    ]
  },
  leftUpArrow: {
    guides: [
      guide('sideX', mul('w', 0.25)),
      guide('headBaseY', mul('h', 29.25 / 123)),
      guide('armY', mul('h', 64.5 / 123)),
      guide('barY', mul('h', 79.125 / 123)),
      guide('leftShoulderY', mul('h', 93.75 / 123)),
      guide('bodyBottomY', mul('h', 108.375 / 123)),
      guide('shaftLeft', mul('w', 0.625)),
      guide('headLeft', mul('w', 0.5)),
      guide('headTipX', mul('w', 0.75)),
      guide('shaftRight', mul('w', 0.875))
    ],
    textBounds: {
      left: 'sideX',
      top: 'barY',
      right: sub('w', 'shaftRight'),
      bottom: sub('h', 'bodyBottomY')
    },
    elements: [
      {
        kind: 'polygon',
        defaultJoin: 'round',
        coerceMiterJoin: 'round',
        points: [
          { x: 'l', y: 'leftShoulderY' },
          { x: 'sideX', y: 'armY' },
          { x: 'sideX', y: 'barY' },
          { x: 'shaftLeft', y: 'barY' },
          { x: 'shaftLeft', y: 'headBaseY' },
          { x: 'headLeft', y: 'headBaseY' },
          { x: 'headTipX', y: 't' },
          { x: 'r', y: 'headBaseY' },
          { x: 'shaftRight', y: 'headBaseY' },
          { x: 'shaftRight', y: 'bodyBottomY' },
          { x: 'sideX', y: 'bodyBottomY' },
          { x: 'sideX', y: 'b' }
        ]
      }
    ]
  },
  bentUpArrow: {
    guides: [
      guide('adj1', 25000),
      guide('adj2', 25000),
      guide('adj3', 25000),
      guide('a1', pin(0, 'adj1', 50000)),
      guide('a2', pin(0, 'adj2', 50000)),
      guide('a3', pin(0, 'adj3', 50000)),
      guide('y1', div(mul('ss', 'a3'), 100000)),
      guide('dx1', div(mul('ss', 'a2'), 50000)),
      guide('x1', sub('r', 'dx1')),
      guide('dx3', div(mul('ss', 'a2'), 100000)),
      guide('x3', sub('r', 'dx3')),
      guide('dx2', div(mul('ss', 'a1'), 200000)),
      guide('x2', sub('x3', 'dx2')),
      guide('x4', add('x3', 'dx2')),
      guide('dy2', div(mul('ss', 'a1'), 100000)),
      guide('y2', sub('b', 'dy2'))
    ],
    textBounds: {
      left: 'l',
      top: 'y2',
      right: sub('w', 'x4'),
      bottom: 't'
    },
    elements: [
      {
        kind: 'polygon',
        defaultJoin: 'round',
        coerceMiterJoin: 'round',
        points: [
          { x: 'l', y: 'y2' },
          { x: 'x2', y: 'y2' },
          { x: 'x2', y: 'y1' },
          { x: 'x1', y: 'y1' },
          { x: 'x3', y: 't' },
          { x: 'r', y: 'y1' },
          { x: 'x4', y: 'y1' },
          { x: 'x4', y: 'b' },
          { x: 'l', y: 'b' }
        ]
      }
    ]
  },
  rightArrowCallout: {
    guides: [
      guide('adj1', 25000),
      guide('adj2', 25000),
      guide('adj3', 25000),
      guide('adj4', 64977),
      guide('maxAdj2', div(mul(50000, 'h'), 'ss')),
      guide('a2', pin(0, 'adj2', 'maxAdj2')),
      guide('maxAdj1', mul('a2', 2)),
      guide('a1', pin(0, 'adj1', 'maxAdj1')),
      guide('maxAdj3', div(mul(100000, 'w'), 'ss')),
      guide('a3', pin(0, 'adj3', 'maxAdj3')),
      guide('q2', div(mul('a3', 'ss'), 'w')),
      guide('maxAdj4', sub(100000, 'q2')),
      guide('a4', pin(0, 'adj4', 'maxAdj4')),
      guide('dy1', div(mul('ss', 'a2'), 100000)),
      guide('dy2', div(mul('ss', 'a1'), 200000)),
      guide('y1', sub('vc', 'dy1')),
      guide('y2', sub('vc', 'dy2')),
      guide('y3', add('vc', 'dy2')),
      guide('y4', add('vc', 'dy1')),
      guide('dx3', div(mul('ss', 'a3'), 100000)),
      guide('x3', sub('r', 'dx3')),
      guide('x2', div(mul('w', 'a4'), 100000)),
      guide('x1', div('x2', 2))
    ],
    textBounds: {
      left: 'l',
      top: 't',
      right: sub('w', 'x2'),
      bottom: 't'
    },
    elements: [
      {
        kind: 'polygon',
        defaultJoin: 'round',
        coerceMiterJoin: 'round',
        points: [
          { x: 'l', y: 't' },
          { x: 'x2', y: 't' },
          { x: 'x2', y: 'y2' },
          { x: 'x3', y: 'y2' },
          { x: 'x3', y: 'y1' },
          { x: 'r', y: 'vc' },
          { x: 'x3', y: 'y4' },
          { x: 'x3', y: 'y3' },
          { x: 'x2', y: 'y3' },
          { x: 'x2', y: 'b' },
          { x: 'l', y: 'b' }
        ]
      }
    ]
  },
  leftArrowCallout: {
    guides: [
      guide('headRight', mul('w', 22 / 120)),
      guide('bodyLeft', mul('w', 42.028 / 120)),
      guide('headTop', mul('h', 22 / 88)),
      guide('shaftTop', mul('h', 33 / 88)),
      guide('shaftBottom', mul('h', 55 / 88)),
      guide('headBottom', mul('h', 66 / 88))
    ],
    textBounds: {
      left: 'bodyLeft',
      top: 't',
      right: 'l',
      bottom: 't'
    },
    elements: [
      {
        kind: 'polygon',
        defaultJoin: 'round',
        coerceMiterJoin: 'round',
        points: [
          { x: 'l', y: 'vc' },
          { x: 'headRight', y: 'headTop' },
          { x: 'headRight', y: 'shaftTop' },
          { x: 'bodyLeft', y: 'shaftTop' },
          { x: 'bodyLeft', y: 0 },
          { x: 'r', y: 0 },
          { x: 'r', y: 'b' },
          { x: 'bodyLeft', y: 'b' },
          { x: 'bodyLeft', y: 'shaftBottom' },
          { x: 'headRight', y: 'shaftBottom' },
          { x: 'headRight', y: 'headBottom' }
        ]
      }
    ]
  },
  leftRightArrowCallout: {
    guides: [
      guide('adj1', 25000),
      guide('adj2', 25000),
      guide('adj3', 25000),
      guide('adj4', 48123),
      guide('maxAdj2', div(mul(50000, 'h'), 'ss')),
      guide('a2', pin(0, 'adj2', 'maxAdj2')),
      guide('maxAdj1', mul('a2', 2)),
      guide('a1', pin(0, 'adj1', 'maxAdj1')),
      guide('maxAdj3', div(mul(50000, 'w'), 'ss')),
      guide('a3', pin(0, 'adj3', 'maxAdj3')),
      guide('q2', div(mul('a3', 'ss'), 'wd2')),
      guide('maxAdj4', sub(100000, 'q2')),
      guide('a4', pin(0, 'adj4', 'maxAdj4')),
      guide('dy1', div(mul('ss', 'a2'), 100000)),
      guide('dy2', div(mul('ss', 'a1'), 200000)),
      guide('y1', sub('vc', 'dy1')),
      guide('y2', sub('vc', 'dy2')),
      guide('y3', add('vc', 'dy2')),
      guide('y4', add('vc', 'dy1')),
      guide('x1', div(mul('ss', 'a3'), 100000)),
      guide('x4', sub('r', 'x1')),
      guide('dx2', div(mul('w', 'a4'), 200000)),
      guide('x2', sub('hc', 'dx2')),
      guide('x3', add('hc', 'dx2'))
    ],
    textBounds: {
      left: 'x2',
      top: 't',
      right: sub('w', 'x3'),
      bottom: 't'
    },
    elements: [
      {
        kind: 'polygon',
        defaultJoin: 'round',
        coerceMiterJoin: 'round',
        points: [
          { x: 'l', y: 'vc' },
          { x: 'x1', y: 'y1' },
          { x: 'x1', y: 'y2' },
          { x: 'x2', y: 'y2' },
          { x: 'x2', y: 't' },
          { x: 'x3', y: 't' },
          { x: 'x3', y: 'y2' },
          { x: 'x4', y: 'y2' },
          { x: 'x4', y: 'y1' },
          { x: 'r', y: 'vc' },
          { x: 'x4', y: 'y4' },
          { x: 'x4', y: 'y3' },
          { x: 'x3', y: 'y3' },
          { x: 'x3', y: 'b' },
          { x: 'x2', y: 'b' },
          { x: 'x2', y: 'y3' },
          { x: 'x1', y: 'y3' },
          { x: 'x1', y: 'y4' }
        ]
      }
    ]
  },
  upArrowCallout: {
    guides: [
      guide('bodyTop', mul('h', 29.76955 / 85)),
      guide('neckTop', mul('h', 21.25 / 85)),
      guide('shaftLeft', mul('w', 48.375 / 118)),
      guide('shaftRight', mul('w', 69.625 / 118)),
      guide('neckLeft', mul('w', 37.75 / 118)),
      guide('neckRight', mul('w', 80.25 / 118))
    ],
    textBounds: {
      left: 'l',
      top: 'bodyTop',
      right: 'l',
      bottom: 't'
    },
    elements: [
      {
        kind: 'polygon',
        defaultJoin: 'round',
        coerceMiterJoin: 'round',
        points: [
          { x: 'l', y: 'bodyTop' },
          { x: 'shaftLeft', y: 'bodyTop' },
          { x: 'shaftLeft', y: 'neckTop' },
          { x: 'neckLeft', y: 'neckTop' },
          { x: 'hc', y: 't' },
          { x: 'neckRight', y: 'neckTop' },
          { x: 'shaftRight', y: 'neckTop' },
          { x: 'shaftRight', y: 'bodyTop' },
          { x: 'r', y: 'bodyTop' },
          { x: 'r', y: 'b' },
          { x: 'l', y: 'b' }
        ]
      }
    ]
  },
  quadArrowCallout: {
    guides: [
      guide('adj1', 18515),
      guide('adj2', 18515),
      guide('adj3', 18515),
      guide('adj4', 48123),
      guide('a2', pin(0, 'adj2', 50000)),
      guide('maxAdj1', mul('a2', 2)),
      guide('a1', pin(0, 'adj1', 'maxAdj1')),
      guide('maxAdj3', sub(50000, 'a2')),
      guide('a3', pin(0, 'adj3', 'maxAdj3')),
      guide('q2', mul('a3', 2)),
      guide('maxAdj4', sub(100000, 'q2')),
      guide('a4', pin('a1', 'adj4', 'maxAdj4')),
      guide('dx2', div(mul('ss', 'a2'), 100000)),
      guide('dx3', div(mul('ss', 'a1'), 200000)),
      guide('ah', div(mul('ss', 'a3'), 100000)),
      guide('dx1', div(mul('w', 'a4'), 200000)),
      guide('dy1', div(mul('h', 'a4'), 200000)),
      guide('x8', sub('r', 'ah')),
      guide('x2', sub('hc', 'dx1')),
      guide('x7', add('hc', 'dx1')),
      guide('x3', sub('hc', 'dx2')),
      guide('x6', add('hc', 'dx2')),
      guide('x4', sub('hc', 'dx3')),
      guide('x5', add('hc', 'dx3')),
      guide('y8', sub('b', 'ah')),
      guide('y2', sub('vc', 'dy1')),
      guide('y7', add('vc', 'dy1')),
      guide('y3', sub('vc', 'dx2')),
      guide('y6', add('vc', 'dx2')),
      guide('y4', sub('vc', 'dx3')),
      guide('y5', add('vc', 'dx3'))
    ],
    textBounds: {
      left: 'x2',
      top: 'y2',
      right: sub('w', 'x7'),
      bottom: sub('h', 'y7')
    },
    elements: [
      {
        kind: 'polygon',
        defaultJoin: 'round',
        coerceMiterJoin: 'round',
        points: [
          { x: 'l', y: 'vc' },
          { x: 'ah', y: 'y3' },
          { x: 'ah', y: 'y4' },
          { x: 'x2', y: 'y4' },
          { x: 'x2', y: 'y2' },
          { x: 'x4', y: 'y2' },
          { x: 'x4', y: 'ah' },
          { x: 'x3', y: 'ah' },
          { x: 'hc', y: 't' },
          { x: 'x6', y: 'ah' },
          { x: 'x5', y: 'ah' },
          { x: 'x5', y: 'y2' },
          { x: 'x7', y: 'y2' },
          { x: 'x7', y: 'y4' },
          { x: 'x8', y: 'y4' },
          { x: 'x8', y: 'y3' },
          { x: 'r', y: 'vc' },
          { x: 'x8', y: 'y6' },
          { x: 'x8', y: 'y5' },
          { x: 'x7', y: 'y5' },
          { x: 'x7', y: 'y7' },
          { x: 'x5', y: 'y7' },
          { x: 'x5', y: 'y8' },
          { x: 'x6', y: 'y8' },
          { x: 'hc', y: 'b' },
          { x: 'x3', y: 'y8' },
          { x: 'x4', y: 'y8' },
          { x: 'x4', y: 'y7' },
          { x: 'x2', y: 'y7' },
          { x: 'x2', y: 'y5' },
          { x: 'ah', y: 'y5' },
          { x: 'ah', y: 'y6' }
        ]
      }
    ]
  },
  stripedRightArrow: {
    guides: [
      guide('stripeWidth', mul('w', 1.9375 / 157)),
      guide('stripeGap', mul('w', 1.9375 / 157)),
      guide('stripeX1', 0),
      guide('stripeX2', mul('w', 3.875 / 157)),
      guide('bodyLeft', mul('w', 9.6875 / 157)),
      guide('headStart', mul('w', 126 / 157)),
      guide('shaftInset', mul('h', 0.25)),
      guide('y1', 'shaftInset'),
      guide('y2', sub('h', 'shaftInset'))
    ],
    textBounds: {
      left: 'bodyLeft',
      top: 'y1',
      right: sub('w', 'headStart'),
      bottom: sub('h', 'y2')
    },
    elements: [
      {
        kind: 'polygon',
        defaultJoin: 'round',
        coerceMiterJoin: 'round',
        points: [
          { x: 'bodyLeft', y: 'y1' },
          { x: 'headStart', y: 'y1' },
          { x: 'headStart', y: 0 },
          { x: 'w', y: 'cy' },
          { x: 'headStart', y: 'h' },
          { x: 'headStart', y: 'y2' },
          { x: 'bodyLeft', y: 'y2' }
        ]
      },
      {
        kind: 'polygon',
        fill: 'stroke',
        stroke: 'none',
        applyLineStyles: false,
        points: [
          { x: 'stripeX1', y: 'y1' },
          { x: add('stripeX1', 'stripeWidth'), y: 'y1' },
          { x: add('stripeX1', 'stripeWidth'), y: 'y2' },
          { x: 'stripeX1', y: 'y2' }
        ]
      },
      {
        kind: 'polygon',
        fill: 'stroke',
        stroke: 'none',
        applyLineStyles: false,
        points: [
          { x: 'stripeX2', y: 'y1' },
          { x: add('stripeX2', 'stripeWidth'), y: 'y1' },
          { x: add('stripeX2', 'stripeWidth'), y: 'y2' },
          { x: 'stripeX2', y: 'y2' }
        ]
      }
    ]
  },
  cube: {
    guides: [
      guide('adj', 25000),
      guide('a', pin(0, 'adj', 100000)),
      guide('y1', div(mul('ss', 'a'), 100000)),
      guide('y4', sub('b', 'y1')),
      guide('y2', div('y4', 2)),
      guide('y3', div(add('y1', 'b'), 2)),
      guide('x4', sub('r', 'y1')),
      guide('x2', div('x4', 2)),
      guide('x3', div(add('y1', 'r'), 2))
    ],
    textBounds: {
      left: 'l',
      top: 'y1',
      right: sub('w', 'x4'),
      bottom: 't'
    },
    elements: [
      {
        kind: 'path',
        defaultJoin: 'round',
        commands: [
          { type: 'M', x: 'l', y: 'y1' },
          { type: 'L', x: 'x4', y: 'y1' },
          { type: 'L', x: 'x4', y: 'b' },
          { type: 'L', x: 'l', y: 'b' },
          { type: 'Z' }
        ]
      },
      {
        kind: 'path',
        fill: 'darken',
        defaultJoin: 'round',
        commands: [
          { type: 'M', x: 'x4', y: 'y1' },
          { type: 'L', x: 'r', y: 't' },
          { type: 'L', x: 'r', y: 'y4' },
          { type: 'L', x: 'x4', y: 'b' },
          { type: 'Z' }
        ]
      },
      {
        kind: 'path',
        fill: 'lightenLess',
        defaultJoin: 'round',
        commands: [
          { type: 'M', x: 'l', y: 'y1' },
          { type: 'L', x: 'y1', y: 't' },
          { type: 'L', x: 'r', y: 't' },
          { type: 'L', x: 'x4', y: 'y1' },
          { type: 'Z' }
        ]
      }
    ]
  }
};

export const defaultPresetTextBounds: InsetBox = {
  left: 0,
  top: 0,
  right: 0,
  bottom: 0
};

export const presetShapeAliases: Partial<Record<PresetShapeType, PresetShapeAlias>> = {
  upDownArrow: {
    base: 'leftRightArrow',
    swapAxes: true,
    transform: 'rotate90'
  },
};
