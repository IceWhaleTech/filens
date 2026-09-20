import { describe, expect, it } from 'vitest';
import {
  add,
  at2,
  buildPath,
  buildPoints,
  cos,
  createGeometryContext,
  div,
  gt,
  guide,
  ifElse,
  maxValue,
  minValue,
  mul,
  pin,
  sin,
  sqrtValue,
  sub
} from '../src/render/geometry';
import { resolvePresetShapeTextBounds } from '../src/render/preset-geometry';

describe('geometry helpers', () => {
  it('resolves guide expressions against slide dimensions and builtins', () => {
    const context = createGeometryContext(200, 100, [
      guide('cap', mul('h', 0.16)),
      guide('bottom', sub('h', 'cap')),
      guide('centerX', div('w', 2)),
      guide('clamped', pin(10, sub('bottom', 90), 40)),
      guide('shortSide', minValue('w', 'h')),
      guide('longSide', maxValue('w', 'h'))
    ]);

    expect(context.get('cap')).toBe(16);
    expect(context.get('bottom')).toBe(84);
    expect(context.get('centerX')).toBe(100);
    expect(context.get('clamped')).toBe(10);
    expect(context.get('shortSide')).toBe(100);
    expect(context.get('longSide')).toBe(200);
  });

  it('supports trigonometric guide helpers for ellipse-aligned points', () => {
    const context = createGeometryContext(120, 80, [
      guide('rx', div('w', 2)),
      guide('ry', div('h', 2)),
      guide('rightX', add('cx', cos('rx', 0))),
      guide('bottomY', add('cy', sin('ry', 90)))
    ]);

    expect(context.get('rightX')).toBe(120);
    expect(context.get('bottomY')).toBe(80);
  });

  it('supports conditional helpers for OOXML-style sweep calculations', () => {
    const context = createGeometryContext(120, 80, [
      guide('stAng', 16200000),
      guide('enAng', 1200000),
      guide('rawSwAng', sub('enAng', 'stAng')),
      guide('swAng', ifElse(gt('rawSwAng', 0), 'rawSwAng', add('rawSwAng', 21600000))),
      guide('swDeg', div('swAng', 60000)),
      guide('largeArcFlag', gt('swDeg', 180))
    ]);

    expect(context.get('rawSwAng')).toBe(-15000000);
    expect(context.get('swAng')).toBe(6600000);
    expect(context.get('swDeg')).toBe(110);
    expect(context.get('largeArcFlag')).toBe(0);
  });

  it('supports OOXML atan2 and sqrt guide helpers', () => {
    const context = createGeometryContext(120, 80, [
      guide('hypSquared', add(mul(3, 3), mul(4, 4))),
      guide('hyp', sqrtValue('hypSquared')),
      guide('angle', at2(3, 4))
    ]);

    expect(context.get('hyp')).toBe(5);
    expect(context.get('angle')).toBeCloseTo(3187806.14, 1);
  });

  it('builds SVG path strings from declarative commands', () => {
    const context = createGeometryContext(200, 100, [
      guide('cap', mul('h', 0.16)),
      guide('bottom', sub('h', 'cap'))
    ]);

    const d = buildPath(
      [
        {
          type: 'M',
          x: 0,
          y: 'cap'
        },
        {
          type: 'Q',
          x1: 0,
          y1: 0,
          x: 'cx',
          y: 0
        },
        {
          type: 'Q',
          x1: 'w',
          y1: 0,
          x: 'w',
          y: 'cap'
        },
        {
          type: 'L',
          x: 'w',
          y: 'bottom'
        },
        {
          type: 'Z'
        }
      ],
      context
    );

    expect(d).toBe('M 0 16 Q 0 0 100 0 Q 200 0 200 16 L 200 84 Z');
  });

  it('builds OOXML-style arc commands from start and sweep angles', () => {
    const context = createGeometryContext(100, 40);

    const d = buildPath(
      [
        {
          type: 'M',
          x: 0,
          y: 20
        },
        {
          type: 'OA',
          rx: 50,
          ry: 20,
          startAngle: 'cd2',
          sweepAngle: -10800000
        }
      ],
      context
    );

    expect(d).toBe('M 0 20 A 50 20 0 0 0 100 20');
  });

  it('builds point lists for polygon-style geometry', () => {
    const context = createGeometryContext(200, 120, [
      guide('depthX', mul('w', 0.2)),
      guide('depthY', mul('h', 0.18)),
      guide('frontRight', sub('w', 'depthX'))
    ]);

    const points = buildPoints(
      [
        {
          x: 0,
          y: 'depthY'
        },
        {
          x: 'depthX',
          y: 0
        },
        {
          x: 'w',
          y: 0
        },
        {
          x: 'frontRight',
          y: 'depthY'
        }
      ],
      context
    );

    expect(points).toBe('0,21.6 40,0 200,0 160,21.6');
  });

  it('resolves definition-driven text bounds for adjusted preset shapes', () => {
    const arrowBounds = resolvePresetShapeTextBounds('rightArrow', {
      width: 200,
      height: 100,
      adjustments: {
        adj1: 42000,
        adj2: 52000
      }
    });
    const chevronBounds = resolvePresetShapeTextBounds('chevron', {
      width: 200,
      height: 100,
      adjustments: {
        adj: 32000
      }
    });
    const starBounds = resolvePresetShapeTextBounds('star5', {
      width: 200,
      height: 100,
      adjustments: {
        adj: 22000
      }
    });
    const bentArrowBounds = resolvePresetShapeTextBounds('bentArrow', {
      width: 200,
      height: 100,
      adjustments: {}
    });
    const leftArrowCalloutBounds = resolvePresetShapeTextBounds('leftArrowCallout', {
      width: 120,
      height: 88,
      adjustments: {}
    });
    const upArrowCalloutBounds = resolvePresetShapeTextBounds('upArrowCallout', {
      width: 118,
      height: 85,
      adjustments: {}
    });
    const snipSameBounds = resolvePresetShapeTextBounds('snip2SameRect', {
      width: 127,
      height: 83.82,
      adjustments: {
        adj1: 36364,
        adj2: 27273
      }
    });
    const snipDiagBounds = resolvePresetShapeTextBounds('snip2DiagRect', {
      width: 133.35,
      height: 85.09,
      adjustments: {
        adj1: 17910,
        adj2: 34578
      }
    });
    const snipRoundBounds = resolvePresetShapeTextBounds('snipRoundRect', {
      width: 118.11,
      height: 83.82,
      adjustments: {
        adj1: 50000,
        adj2: 34849
      }
    });
    const roundSameBounds = resolvePresetShapeTextBounds('round2SameRect', {
      width: 107.95,
      height: 92.71,
      adjustments: {
        adj1: 50000,
        adj2: 0
      }
    });
    const roundDiagBounds = resolvePresetShapeTextBounds('round2DiagRect', {
      width: 184.785,
      height: 101.6,
      adjustments: {
        adj1: 50000,
        adj2: 8750
      }
    });
    const pieBounds = resolvePresetShapeTextBounds('pie', {
      width: 175.42425196850394,
      height: 128,
      adjustments: {
        adj1: 1442868,
        adj2: 18776329
      }
    });
    const teardropBounds = resolvePresetShapeTextBounds('teardrop', {
      width: 131.85994750656167,
      height: 134.20577427821522,
      adjustments: {
        adj: 141918
      }
    });

    expect(arrowBounds).toEqual({
      left: 16,
      top: 21,
      right: 50,
      bottom: 21
    });
    expect(chevronBounds).toEqual({
      left: 32,
      top: 12,
      right: 32,
      bottom: 12
    });
    expect(starBounds).toEqual({
      left: 48,
      top: 22,
      right: 48,
      bottom: 26
    });
    expect(bentArrowBounds).toEqual({
      left: 16,
      top: 18,
      right: 44,
      bottom: 18
    });
    expect(leftArrowCalloutBounds).toEqual({
      left: 42.028,
      top: 0,
      right: 0,
      bottom: 0
    });
    expect(upArrowCalloutBounds).toEqual({
      left: 0,
      top: 29.76955,
      right: 0,
      bottom: 0
    });
    expect(snipSameBounds?.left).toBeCloseTo(0, 3);
    expect(snipSameBounds?.top).toBeCloseTo(0, 3);
    expect(snipSameBounds?.right).toBeCloseTo(0, 3);
    expect(snipSameBounds?.bottom).toBeCloseTo(0, 3);
    expect(snipDiagBounds?.left).toBeCloseTo(0, 3);
    expect(snipDiagBounds?.top).toBeCloseTo(0, 3);
    expect(snipDiagBounds?.right).toBeCloseTo(0, 3);
    expect(snipDiagBounds?.bottom).toBeCloseTo(0, 3);
    expect(snipRoundBounds?.left).toBeCloseTo(0, 3);
    expect(snipRoundBounds?.top).toBeCloseTo(0, 3);
    expect(snipRoundBounds?.right).toBeCloseTo(0, 3);
    expect(snipRoundBounds?.bottom).toBeCloseTo(0, 3);
    expect(roundSameBounds?.left).toBeCloseTo(0, 3);
    expect(roundSameBounds?.top).toBeCloseTo(0, 3);
    expect(roundSameBounds?.right).toBeCloseTo(0, 3);
    expect(roundSameBounds?.bottom).toBeCloseTo(0, 3);
    expect(roundDiagBounds?.left).toBeCloseTo(0, 3);
    expect(roundDiagBounds?.top).toBeCloseTo(0, 3);
    expect(roundDiagBounds?.right).toBeCloseTo(0, 3);
    expect(roundDiagBounds?.bottom).toBeCloseTo(0, 3);
    expect(pieBounds?.left).toBeCloseTo(25.690355, 3);
    expect(pieBounds?.top).toBeCloseTo(34, 3);
    expect(pieBounds?.right).toBeCloseTo(25.690355, 3);
    expect(pieBounds?.bottom).toBeCloseTo(34, 3);
    expect(teardropBounds?.left).toBeCloseTo(19.310494, 3);
    expect(teardropBounds?.top).toBeCloseTo(37.205598, 3);
    expect(teardropBounds?.right).toBeCloseTo(19.310494, 3);
    expect(teardropBounds?.bottom).toBeCloseTo(37.205598, 3);
  });
});
