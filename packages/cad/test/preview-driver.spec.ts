import { describe, expect, it, vi } from 'vitest';
import { createCadPreviewDriver, createCadPreviewRoutes, loadDxfDrawing } from '../src';

describe('CAD preview driver', () => {
  it('computes bounds of large drawings without exceeding JavaScript argument limits', () => {
    const lines = Array.from({ length: 70_000 }, (_, index) => `0\nLINE\n8\n0\n10\n${index}\n20\n0\n11\n${index + 1}\n21\n1\n`).join('');
    const drawing = loadDxfDrawing(`0\nSECTION\n2\nENTITIES\n${lines}0\nENDSEC\n0\nEOF\n`);
    expect(drawing.entities).toHaveLength(70_000);
    expect(drawing.bounds).toEqual({ minX: 0, minY: 0, maxX: 70_000, maxY: 1 });
  });

  it('parses common DXF entities into a drawing model', () => {
    const drawing = loadDxfDrawing(createDxfFixture());

    expect(drawing.entities.map((entity) => entity.type)).toEqual(['line', 'circle', 'arc', 'polyline', 'text']);
    expect(drawing.layers).toEqual(['0', 'ROOMS']);
    expect(drawing.bounds).toMatchObject({
      minX: 0,
      minY: 0,
      maxX: 120,
      maxY: 80
    });
    expect(drawing.textStyles).toEqual([]);
    expect(drawing.warnings).toEqual([]);
  });

  it('keeps DXF text font metadata and warns for SHX fallback', () => {
    const drawing = loadDxfDrawing(createStyledDxfFixture());
    const text = drawing.entities.find((entity) => entity.type === 'text');

    expect(drawing.textStyles).toMatchObject([
      {
        name: 'ARCH',
        fontFile: 'romans.shx',
        fontFamily: undefined
      }
    ]);
    expect(text).toMatchObject({
      type: 'text',
      styleName: 'ARCH',
      fontFile: 'romans.shx',
      rotation: 30,
      widthFactor: 0.85,
      obliqueAngle: 12,
      horizontalAlign: 'center',
      verticalAlign: 'middle'
    });
    expect(drawing.warnings).toEqual([
      'DXF references SHX font files (romans.shx), which browsers cannot render directly; CSS fallback fonts are used.'
    ]);
  });

  it('parses DXF ATTRIB and ATTDEF entries as text', () => {
    const drawing = loadDxfDrawing(createAttributeTextDxfFixture());

    expect(drawing.entities.map((entity) => entity.type)).toEqual(['text', 'text']);
    expect(drawing.entities[0]).toMatchObject({
      type: 'text',
      layer: 'LABELS',
      value: 'Door 101',
      point: {
        x: 4,
        y: 6
      },
      height: 2
    });
    expect(drawing.entities[1]).toMatchObject({
      type: 'text',
      layer: 'LABELS',
      value: 'TAG',
      point: {
        x: 20,
        y: 10
      },
      rotation: 0,
      height: 2
    });
    expect(drawing.warnings).toEqual([]);
  });

  it('normalizes DXF MTEXT formatting into renderable multiline text', async () => {
    const drawing = loadDxfDrawing(createMtextFormattingDxfFixture());

    expect(drawing.entities[0]).toMatchObject({
      type: 'text',
      value: 'Angle 90\u00b0\nSecond 1/2'
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createCadPreviewDriver().createSession(container);

    await session.load(new TextEncoder().encode(createMtextFormattingDxfFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'mtext-formatting.dxf',
        extension: 'dxf'
      },
      route: createCadPreviewRoutes().find((route) => route.extensions.includes('dxf'))
    });

    const tspans = [...container.querySelectorAll('svg.cadv-canvas text[data-layer="LABELS"] tspan')];

    expect(tspans.map((tspan) => tspan.textContent)).toEqual(['Angle 90\u00b0', 'Second 1/2']);

    session.destroy();
    container.remove();
  });

  it('uses DXF text alignment points and MTEXT attachment metadata', async () => {
    const drawing = loadDxfDrawing(createTextAlignmentDxfFixture());

    expect(drawing.entities).toMatchObject([
      {
        type: 'text',
        value: 'Aligned',
        point: {
          x: 20,
          y: 10
        },
        horizontalAlign: 'center',
        verticalAlign: 'middle'
      },
      {
        type: 'text',
        value: 'Attached',
        point: {
          x: 40,
          y: 20
        },
        rotation: 90,
        widthFactor: 1,
        horizontalAlign: 'right',
        verticalAlign: 'top'
      }
    ]);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createCadPreviewDriver().createSession(container);

    await session.load(new TextEncoder().encode(createTextAlignmentDxfFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'text-alignment.dxf',
        extension: 'dxf'
      },
      route: createCadPreviewRoutes().find((route) => route.extensions.includes('dxf'))
    });

    const texts = [...container.querySelectorAll('svg.cadv-canvas text[data-layer="LABELS"]')];

    expect(texts[0]?.getAttribute('text-anchor')).toBe('middle');
    expect(texts[0]?.getAttribute('dominant-baseline')).toBe('middle');
    expect(texts[1]?.getAttribute('text-anchor')).toBe('end');
    expect(texts[1]?.getAttribute('dominant-baseline')).toBe('text-before-edge');
    expect(texts[1]?.getAttribute('transform')).toContain('rotate(-90');

    session.destroy();
    container.remove();
  });

  it('resolves DXF layer colors and entity ACI overrides', () => {
    const drawing = loadDxfDrawing(createLayeredDxfFixture());

    expect(drawing.layers).toEqual(['HIDDEN', 'LABELS', 'WALLS']);
    expect(drawing.layerStyles).toMatchObject([
      {
        name: 'HIDDEN',
        colorIndex: 3,
        color: '#00ff00',
        visible: false
      },
      {
        name: 'LABELS',
        colorIndex: 5,
        color: '#0000ff',
        visible: true
      },
      {
        name: 'WALLS',
        colorIndex: 1,
        color: '#ff0000',
        visible: true
      }
    ]);
    expect(drawing.entities[0]).toMatchObject({
      type: 'line',
      layer: 'WALLS',
      color: '#ff0000',
      visible: true
    });
    expect(drawing.entities[1]).toMatchObject({
      type: 'circle',
      layer: 'WALLS',
      colorIndex: 4,
      color: '#00ffff'
    });
    expect(drawing.entities[2]).toMatchObject({
      type: 'text',
      layer: 'LABELS',
      color: '#0000ff'
    });
    expect(drawing.entities[3]).toMatchObject({
      type: 'line',
      layer: 'HIDDEN',
      color: '#00ff00',
      visible: false
    });
  });

  it('resolves DXF true color and transparency metadata', async () => {
    const drawing = loadDxfDrawing(createTrueColorDxfFixture());

    expect(drawing.layerStyles).toMatchObject([
      {
        name: 'TRUE',
        trueColor: '#00ff00',
        color: '#00ff00',
        opacity: 0.502
      }
    ]);
    expect(drawing.entities[0]).toMatchObject({
      type: 'line',
      layer: 'TRUE',
      trueColor: '#00ff00',
      color: '#00ff00',
      opacity: 0.502
    });
    expect(drawing.entities[1]).toMatchObject({
      type: 'circle',
      layer: 'TRUE',
      trueColor: '#0000ff',
      color: '#0000ff',
      opacity: 0.75
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createCadPreviewDriver().createSession(container);

    await session.load(new TextEncoder().encode(createTrueColorDxfFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'true-color.dxf',
        extension: 'dxf'
      },
      route: createCadPreviewRoutes().find((route) => route.extensions.includes('dxf'))
    });

    const line = container.querySelector('svg.cadv-canvas line[data-layer="TRUE"]');
    const circle = container.querySelector('svg.cadv-canvas circle[data-layer="TRUE"]');

    expect(line?.getAttribute('stroke')).toBe('#00ff00');
    expect(line?.getAttribute('opacity')).toBe('0.502');
    expect(line?.getAttribute('data-true-color')).toBe('#00ff00');
    expect(circle?.getAttribute('stroke')).toBe('#0000ff');
    expect(circle?.getAttribute('opacity')).toBe('0.75');
    expect(circle?.getAttribute('data-true-color')).toBe('#0000ff');

    session.destroy();
    container.remove();
  });

  it('renders DXF line type and line weight metadata', async () => {
    const drawing = loadDxfDrawing(createStyledLineDxfFixture());

    expect(drawing.entities[0]).toMatchObject({
      type: 'line',
      lineType: 'DASHED',
      lineWeight: 2
    });
    expect(drawing.entities[1]).toMatchObject({
      type: 'circle',
      lineType: 'CENTER',
      lineWeight: 0.5
    });
    expect(drawing.entities[2]).toMatchObject({
      type: 'polyline',
      lineType: 'HIDDEN',
      lineWeight: 1,
      strokeWidth: 4
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createCadPreviewDriver().createSession(container);

    await session.load(new TextEncoder().encode(createStyledLineDxfFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'styled-lines.dxf',
        extension: 'dxf'
      },
      route: createCadPreviewRoutes().find((route) => route.extensions.includes('dxf'))
    });

    const line = container.querySelector('svg.cadv-canvas line[data-layer="STYLE"]');
    const circle = container.querySelector('svg.cadv-canvas circle[data-layer="STYLE"]');
    const polyline = container.querySelector('svg.cadv-canvas path[data-layer="STYLE"]');

    expect(line?.getAttribute('stroke-width')).toBe('2');
    expect(line?.getAttribute('stroke-dasharray')).toBe('7 4');
    expect(circle?.getAttribute('stroke-width')).toBe('0.5');
    expect(circle?.getAttribute('stroke-dasharray')).toBe('8 3 1.5 3');
    expect(polyline?.getAttribute('stroke-width')).toBe('4');
    expect(polyline?.getAttribute('stroke-dasharray')).toBe('7 4');

    session.destroy();
    container.remove();
  });

  it('resolves DXF LTYPE table patterns and layer line styles', async () => {
    const drawing = loadDxfDrawing(createLineTypeTableDxfFixture());

    expect(drawing.lineTypes).toMatchObject([
      {
        name: 'DASHDOT',
        description: 'Dash dot',
        pattern: [6, -2, 0, -2],
        dashArray: '6 2 0.6 2'
      }
    ]);
    expect(drawing.layerStyles).toMatchObject([
      {
        name: 'CENTERLINES',
        lineType: 'DASHDOT',
        lineTypePattern: [6, -2, 0, -2],
        lineWeight: 0.35
      }
    ]);
    expect(drawing.entities[0]).toMatchObject({
      type: 'line',
      layer: 'CENTERLINES',
      lineType: 'DASHDOT',
      lineTypePattern: [6, -2, 0, -2],
      lineWeight: 0.35
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createCadPreviewDriver().createSession(container);

    await session.load(new TextEncoder().encode(createLineTypeTableDxfFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'ltype-layer.dxf',
        extension: 'dxf'
      },
      route: createCadPreviewRoutes().find((route) => route.extensions.includes('dxf'))
    });

    const line = container.querySelector('svg.cadv-canvas line[data-layer="CENTERLINES"]');

    expect(line?.getAttribute('stroke-width')).toBe('0.35');
    expect(line?.getAttribute('stroke-dasharray')).toBe('6 2 0.6 2');

    session.destroy();
    container.remove();
  });

  it('applies global and entity DXF linetype scale metadata', async () => {
    const drawing = loadDxfDrawing(createLineTypeScaleDxfFixture());

    expect(drawing.header.lineTypeScale).toBe(2);
    expect(drawing.entities[0]).toMatchObject({
      type: 'line',
      lineType: 'DASHED',
      lineTypeScale: 2
    });
    expect(drawing.entities[1]).toMatchObject({
      type: 'line',
      lineType: 'DASHDOT',
      lineTypePattern: [6, -2, 0, -2],
      lineTypeScale: undefined
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createCadPreviewDriver().createSession(container);

    await session.load(new TextEncoder().encode(createLineTypeScaleDxfFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'ltype-scale.dxf',
        extension: 'dxf'
      },
      route: createCadPreviewRoutes().find((route) => route.extensions.includes('dxf'))
    });

    const lines = container.querySelectorAll('svg.cadv-canvas line[data-layer="SCALE"]');

    expect(lines[0]?.getAttribute('stroke-dasharray')).toBe('14 8');
    expect(lines[1]?.getAttribute('stroke-dasharray')).toBe('6 2 0.6 2');

    session.destroy();
    container.remove();
  });

  it('renders browser-loadable DXF IMAGE references', async () => {
    const drawing = loadDxfDrawing(createImageDxfFixture());

    expect(drawing.entities[0]).toMatchObject({
      type: 'image',
      layer: 'RASTER',
      imageDefHandle: '2A',
      source: 'data:image/png;base64,iVBORw0KGgo=',
      point: {
        x: 0,
        y: 0
      },
      width: 20,
      height: 10
    });
    expect(drawing.bounds).toMatchObject({
      minX: 0,
      minY: 0,
      maxX: 20,
      maxY: 10
    });
    expect(drawing.warnings).toEqual([]);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createCadPreviewDriver().createSession(container);

    await session.load(new TextEncoder().encode(createImageDxfFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'image.dxf',
        extension: 'dxf'
      },
      route: createCadPreviewRoutes().find((route) => route.extensions.includes('dxf'))
    });

    const image = container.querySelector('svg.cadv-canvas image[data-image-source]');
    const group = container.querySelector('svg.cadv-canvas g[data-image-def="2A"]');

    expect(image?.getAttribute('href')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(image?.getAttribute('width')).toBe('20');
    expect(image?.getAttribute('height')).toBe('10');
    expect(image?.getAttribute('transform')).toBe('matrix( 1 0 0 -1 0 10 )');
    expect(group?.getAttribute('data-layer')).toBe('RASTER');

    session.destroy();
    container.remove();
  });

  it('applies DXF IMAGE clipping boundaries', async () => {
    const drawing = loadDxfDrawing(createClippedImageDxfFixture());

    expect(drawing.entities[0]).toMatchObject({
      type: 'image',
      clipBoundary: [
        { x: 5, y: 2 },
        { x: 15, y: 2 },
        { x: 15, y: 8 },
        { x: 5, y: 8 }
      ]
    });
    expect(drawing.bounds).toMatchObject({
      minX: 5,
      minY: 2,
      maxX: 15,
      maxY: 8
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createCadPreviewDriver().createSession(container);

    await session.load(new TextEncoder().encode(createClippedImageDxfFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'image-clipped.dxf',
        extension: 'dxf'
      },
      route: createCadPreviewRoutes().find((route) => route.extensions.includes('dxf'))
    });

    const image = container.querySelector('svg.cadv-canvas image[data-image-clipped="true"]');
    const clipPolygon = container.querySelector('svg.cadv-canvas clipPath polygon');

    expect(image?.getAttribute('clip-path')).toContain('url(#cadv-image-clip-2C)');
    expect(clipPolygon?.getAttribute('points')).toBe('0,6 10,6 10,0 0,0');

    session.destroy();
    container.remove();
  });

  it('keeps unresolved DXF IMAGE references as placeholders with warnings', async () => {
    const drawing = loadDxfDrawing(createUnresolvedImageDxfFixture());

    expect(drawing.entities[0]).toMatchObject({
      type: 'image',
      source: 'textures\\site-plan.png'
    });
    expect(drawing.warnings).toEqual([
      'DXF IMAGE source "textures\\site-plan.png" requires an application resource resolver; placeholder is shown.'
    ]);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createCadPreviewDriver().createSession(container);

    await session.load(new TextEncoder().encode(createUnresolvedImageDxfFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'image-path.dxf',
        extension: 'dxf'
      },
      route: createCadPreviewRoutes().find((route) => route.extensions.includes('dxf'))
    });

    const placeholder = container.querySelector('svg.cadv-canvas polygon[data-image-def]');
    const label = container.querySelector('svg.cadv-canvas text[data-image-def]');

    expect(placeholder?.getAttribute('stroke-dasharray')).toBe('6 3');
    expect(label?.textContent).toBe('IMAGE');
    expect(session.getState().warnings).toEqual(drawing.warnings);

    session.destroy();
    container.remove();
  });

  it('resolves DXF IMAGE local paths through the preview resource resolver', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createCadPreviewDriver().createSession(container, {
      resourceResolver: ({ source, relation, handle }) =>
        relation === 'image' && source === 'textures\\site-plan.png' && handle === '2B'
          ? 'data:image/png;base64,iVBORw0KGgo='
          : undefined
    });

    await session.load(new TextEncoder().encode(createUnresolvedImageDxfFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'image-path.dxf',
        extension: 'dxf'
      },
      route: createCadPreviewRoutes().find((route) => route.extensions.includes('dxf'))
    });

    const image = container.querySelector('svg.cadv-canvas image[data-image-def="2B"]');

    expect(image?.getAttribute('href')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(session.getState().warnings).toEqual([]);

    session.destroy();
    container.remove();
  });

  it('renders DXF XLINE and RAY construction geometry', async () => {
    const drawing = loadDxfDrawing(createConstructionLineDxfFixture());

    expect(drawing.entities).toMatchObject([
      {
        type: 'construction-line',
        layer: 'AUX',
        ray: false,
        point: {
          x: 10,
          y: 10
        },
        direction: {
          x: 1,
          y: 1
        }
      },
      {
        type: 'construction-line',
        layer: 'AUX',
        ray: true,
        point: {
          x: 20,
          y: 0
        },
        direction: {
          x: 0,
          y: 1
        }
      }
    ]);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createCadPreviewDriver().createSession(container);

    await session.load(new TextEncoder().encode(createConstructionLineDxfFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'construction-lines.dxf',
        extension: 'dxf'
      },
      route: createCadPreviewRoutes().find((route) => route.extensions.includes('dxf'))
    });

    expect(container.querySelector('line[data-construction-line="xline"][data-layer="AUX"]')).toBeTruthy();
    expect(container.querySelector('line[data-construction-line="ray"][data-layer="AUX"]')).toBeTruthy();

    session.destroy();
    container.remove();
  });

  it('uses DXF HEADER extents as drawing bounds hints', async () => {
    const drawing = loadDxfDrawing(createHeaderExtentsDxfFixture());

    expect(drawing.header.units).toEqual({
      code: 4,
      name: 'Millimeters',
      measurement: 'metric'
    });
    expect(drawing.bounds).toMatchObject({
      minX: -50,
      minY: -25,
      maxX: 150,
      maxY: 75
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createCadPreviewDriver().createSession(container);

    await session.load(new TextEncoder().encode(createHeaderExtentsDxfFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'header-extents.dxf',
        extension: 'dxf'
      },
      route: createCadPreviewRoutes().find((route) => route.extensions.includes('dxf'))
    });

    expect(container.querySelector('svg.cadv-canvas')?.getAttribute('viewBox')).toBe('-8 -8 216 116');

    session.destroy();
    container.remove();
  });

  it('expands DXF BLOCK/INSERT entities into renderable geometry', () => {
    const drawing = loadDxfDrawing(createBlockInsertDxfFixture());

    expect(drawing.entities.map((entity) => entity.type)).toEqual(['line', 'text']);
    expect(drawing.layers).toEqual(['FURNITURE']);
    expect(drawing.entities[0]).toMatchObject({
      type: 'line',
      layer: 'FURNITURE',
      colorIndex: 2,
      start: {
        x: 10,
        y: 20
      },
      end: {
        x: 10,
        y: 30
      }
    });
    expect(drawing.entities[1]).toMatchObject({
      type: 'text',
      layer: 'FURNITURE',
      point: {
        x: 8,
        y: 20
      },
      rotation: 90,
      height: 2
    });
    expect(drawing.bounds).toMatchObject({
      minX: 8,
      minY: 20,
      maxY: 30
    });
    expect(drawing.bounds.maxX).toBeGreaterThan(10);
    expect(drawing.warnings).toEqual([]);
  });

  it('expands DXF MINSERT block arrays into repeated geometry', () => {
    const drawing = loadDxfDrawing(createMInsertDxfFixture());

    expect(drawing.entities.map((entity) => entity.type)).toEqual(['line', 'line', 'line', 'line']);
    expect(drawing.entities).toMatchObject([
      {
        type: 'line',
        start: { x: 0, y: 0 },
        end: { x: 2, y: 0 }
      },
      {
        type: 'line',
        start: { x: 5, y: 0 },
        end: { x: 7, y: 0 }
      },
      {
        type: 'line',
        start: { x: 0, y: 3 },
        end: { x: 2, y: 3 }
      },
      {
        type: 'line',
        start: { x: 5, y: 3 },
        end: { x: 7, y: 3 }
      }
    ]);
    expect(drawing.bounds).toMatchObject({
      minX: 0,
      minY: 0,
      maxX: 7,
      maxY: 3
    });
  });

  it('expands nested DXF INSERT entities inside block definitions', () => {
    const drawing = loadDxfDrawing(createNestedBlockInsertDxfFixture());

    expect(drawing.entities.map((entity) => entity.type)).toEqual(['line']);
    expect(drawing.entities[0]).toMatchObject({
      type: 'line',
      layer: 'SYMBOLS',
      start: {
        x: 10,
        y: 5
      },
      end: {
        x: 14,
        y: 5
      }
    });
    expect(drawing.bounds).toMatchObject({
      minX: 10,
      minY: 5,
      maxX: 14,
      maxY: 5
    });
    expect(drawing.warnings).toEqual([]);
  });

  it('parses classic DXF POLYLINE/VERTEX sequences', () => {
    const drawing = loadDxfDrawing(createClassicPolylineDxfFixture());

    expect(drawing.entities).toHaveLength(1);
    expect(drawing.entities[0]).toMatchObject({
      type: 'polyline',
      layer: 'ROADS',
      colorIndex: 3,
      closed: true,
      points: [
        {
          x: 0,
          y: 0
        },
        {
          x: 10,
          y: 0
        },
        {
          x: 10,
          y: 5
        }
      ]
    });
    expect(drawing.bounds).toMatchObject({
      minX: 0,
      minY: 0,
      maxX: 10,
      maxY: 5
    });
  });

  it('renders DXF polyline bulge segments as arcs', async () => {
    const drawing = loadDxfDrawing(createBulgedPolylineDxfFixture());

    expect(drawing.entities).toHaveLength(2);
    expect(drawing.entities[0]).toMatchObject({
      type: 'polyline',
      layer: 'CURVES',
      bulges: [1, 0]
    });
    expect(drawing.entities[1]).toMatchObject({
      type: 'polyline',
      layer: 'CURVES',
      bulges: [1, 0]
    });
    expect(drawing.bounds.minY).toBeLessThan(0);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createCadPreviewDriver().createSession(container);

    await session.load(new TextEncoder().encode(createBulgedPolylineDxfFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'bulged.dxf',
        extension: 'dxf'
      },
      route: createCadPreviewRoutes().find((route) => route.extensions.includes('dxf'))
    });

    const paths = [...container.querySelectorAll('svg.cadv-canvas path[data-layer="CURVES"]')];
    expect(paths).toHaveLength(2);
    expect(paths.every((path) => path.getAttribute('d')?.includes(' A '))).toBe(true);

    session.destroy();
    container.remove();
  });

  it('renders DXF polyline width as SVG stroke width', async () => {
    const drawing = loadDxfDrawing(createWidePolylineDxfFixture());

    expect(drawing.entities).toHaveLength(2);
    expect(drawing.entities[0]).toMatchObject({
      type: 'polyline',
      layer: 'ROADS',
      strokeWidth: 4
    });
    expect(drawing.entities[1]).toMatchObject({
      type: 'polyline',
      layer: 'ROADS',
      strokeWidth: 2
    });
    expect(drawing.bounds.minY).toBeLessThan(0);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createCadPreviewDriver().createSession(container);

    await session.load(new TextEncoder().encode(createWidePolylineDxfFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'wide-polyline.dxf',
        extension: 'dxf'
      },
      route: createCadPreviewRoutes().find((route) => route.extensions.includes('dxf'))
    });

    const paths = [...container.querySelectorAll('svg.cadv-canvas path[data-layer="ROADS"]')];
    expect(paths.map((path) => path.getAttribute('stroke-width'))).toEqual(['4', '2']);

    session.destroy();
    container.remove();
  });

  it('parses DXF POINT and LEADER entities', async () => {
    const drawing = loadDxfDrawing(createPointLeaderDxfFixture());

    expect(drawing.entities.map((entity) => entity.type)).toEqual(['point', 'polyline']);
    expect(drawing.entities[0]).toMatchObject({
      type: 'point',
      layer: 'CONTROL',
      colorIndex: 1,
      point: {
        x: 5,
        y: 5
      }
    });
    expect(drawing.entities[1]).toMatchObject({
      type: 'polyline',
      layer: 'ANNO',
      points: [
        {
          x: 0,
          y: 0
        },
        {
          x: 10,
          y: 4
        },
        {
          x: 14,
          y: 4
        }
      ]
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createCadPreviewDriver().createSession(container);

    await session.load(new TextEncoder().encode(createPointLeaderDxfFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'point-leader.dxf',
        extension: 'dxf'
      },
      route: createCadPreviewRoutes().find((route) => route.extensions.includes('dxf'))
    });

    expect(container.querySelector('svg.cadv-canvas g[data-point="true"][data-layer="CONTROL"]')).toBeTruthy();
    expect(container.querySelector('svg.cadv-canvas path[data-layer="ANNO"]')).toBeTruthy();

    session.destroy();
    container.remove();
  });

  it('parses DXF ELLIPSE entities and renders them as SVG', async () => {
    const drawing = loadDxfDrawing(createEllipseDxfFixture());

    expect(drawing.entities).toHaveLength(2);
    expect(drawing.entities[0]).toMatchObject({
      type: 'ellipse',
      layer: 'CURVES',
      center: {
        x: 10,
        y: 10
      },
      majorAxis: {
        x: 6,
        y: 0
      },
      ratio: 0.5
    });
    expect(drawing.entities[1]).toMatchObject({
      type: 'ellipse',
      layer: 'CURVES',
      startParameter: 0,
      endParameter: Math.PI
    });
    expect(drawing.bounds.minX).toBeLessThanOrEqual(4);
    expect(drawing.bounds.maxX).toBeGreaterThanOrEqual(26);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createCadPreviewDriver().createSession(container);

    await session.load(new TextEncoder().encode(createEllipseDxfFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'ellipse.dxf',
        extension: 'dxf'
      },
      route: createCadPreviewRoutes().find((route) => route.extensions.includes('dxf'))
    });

    expect(container.querySelector('svg.cadv-canvas ellipse[data-layer="CURVES"]')).toBeTruthy();
    expect(container.querySelector('svg.cadv-canvas path[data-layer="CURVES"]')).toBeTruthy();

    session.destroy();
    container.remove();
  });

  it('expands DXF DIMENSION geometry blocks', () => {
    const drawing = loadDxfDrawing(createDimensionDxfFixture());

    expect(drawing.entities.map((entity) => entity.type)).toEqual(['line', 'text']);
    expect(drawing.entities[0]).toMatchObject({
      type: 'line',
      layer: 'DIMS',
      start: {
        x: 0,
        y: 0
      },
      end: {
        x: 20,
        y: 0
      }
    });
    expect(drawing.entities[1]).toMatchObject({
      type: 'text',
      layer: 'DIMS',
      value: '20',
      point: {
        x: 8,
        y: 2
      }
    });
    expect(drawing.warnings).toEqual([]);
  });

  it('renders a lightweight DXF DIMENSION fallback when geometry blocks are unavailable', async () => {
    const drawing = loadDxfDrawing(createFallbackDimensionDxfFixture());

    expect(drawing.entities).toMatchObject([
      {
        type: 'dimension',
        layer: 'DIMS',
        start: {
          x: 0,
          y: 0
        },
        end: {
          x: 20,
          y: 0
        },
        textPoint: {
          x: 10,
          y: 3
        },
        text: '20'
      }
    ]);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createCadPreviewDriver().createSession(container);

    await session.load(new TextEncoder().encode(createFallbackDimensionDxfFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'fallback-dimension.dxf',
        extension: 'dxf'
      },
      route: createCadPreviewRoutes().find((route) => route.extensions.includes('dxf'))
    });

    const group = container.querySelector('svg.cadv-canvas g[data-dimension="true"][data-layer="DIMS"]');

    expect(group?.querySelector('path')).toBeTruthy();
    expect(group?.querySelector('text')?.textContent).toBe('20');

    session.destroy();
    container.remove();
  });

  it('parses DXF SOLID TRACE and 3DFACE entities as filled faces', async () => {
    const drawing = loadDxfDrawing(createFaceDxfFixture());

    expect(drawing.entities.map((entity) => entity.type)).toEqual(['face', 'face', 'face']);
    expect(drawing.entities[0]).toMatchObject({
      type: 'face',
      layer: 'FILLS',
      colorIndex: 2,
      points: [
        {
          x: 0,
          y: 0
        },
        {
          x: 10,
          y: 0
        },
        {
          x: 10,
          y: 5
        },
        {
          x: 0,
          y: 5
        }
      ]
    });
    expect(drawing.bounds).toMatchObject({
      minX: 0,
      minY: 0,
      maxX: 40,
      maxY: 5
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createCadPreviewDriver().createSession(container);

    await session.load(new TextEncoder().encode(createFaceDxfFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'faces.dxf',
        extension: 'dxf'
      },
      route: createCadPreviewRoutes().find((route) => route.extensions.includes('dxf'))
    });

    expect(container.querySelectorAll('svg.cadv-canvas polygon[data-layer="FILLS"]')).toHaveLength(3);
    expect(container.querySelector('svg.cadv-canvas polygon[data-layer="FILLS"]')?.getAttribute('fill-opacity')).toBe('0.18');

    session.destroy();
    container.remove();
  });

  it('parses DXF SPLINE entities as smooth paths', async () => {
    const drawing = loadDxfDrawing(createSplineDxfFixture());

    expect(drawing.entities).toHaveLength(1);
    expect(drawing.entities[0]).toMatchObject({
      type: 'spline',
      layer: 'CURVES',
      degree: 3,
      closed: false,
      points: [
        {
          x: 0,
          y: 0
        },
        {
          x: 10,
          y: 12
        },
        {
          x: 20,
          y: 0
        }
      ]
    });
    expect(drawing.bounds).toMatchObject({
      minX: 0,
      minY: 0,
      maxX: 20,
      maxY: 12
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createCadPreviewDriver().createSession(container);

    await session.load(new TextEncoder().encode(createSplineDxfFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'spline.dxf',
        extension: 'dxf'
      },
      route: createCadPreviewRoutes().find((route) => route.extensions.includes('dxf'))
    });

    const path = container.querySelector('svg.cadv-canvas path[data-layer="CURVES"]');
    expect(path?.getAttribute('d')).toContain('C ');

    session.destroy();
    container.remove();
  });

  it('parses simple DXF HATCH polyline boundaries as filled hatches', async () => {
    const drawing = loadDxfDrawing(createHatchDxfFixture());

    expect(drawing.entities).toHaveLength(1);
    expect(drawing.entities[0]).toMatchObject({
      type: 'hatch',
      layer: 'FILLS',
      colorIndex: 3,
      loops: [
        [
          {
            x: 0,
            y: 0
          },
          {
            x: 12,
            y: 0
          },
          {
            x: 12,
            y: 8
          },
          {
            x: 0,
            y: 8
          }
        ]
      ]
    });
    expect(drawing.bounds).toMatchObject({
      minX: 0,
      minY: 0,
      maxX: 12,
      maxY: 8
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createCadPreviewDriver().createSession(container);

    await session.load(new TextEncoder().encode(createHatchDxfFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'hatch.dxf',
        extension: 'dxf'
      },
      route: createCadPreviewRoutes().find((route) => route.extensions.includes('dxf'))
    });

    const path = container.querySelector('svg.cadv-canvas path[data-layer="FILLS"]');
    expect(path).toBeTruthy();
    expect(path?.getAttribute('fill')).toBe('#00ff00');
    expect(path?.getAttribute('fill-rule')).toBe('evenodd');

    session.destroy();
    container.remove();
  });

  it('samples DXF HATCH polyline bulge boundaries', () => {
    const drawing = loadDxfDrawing(createHatchBulgeDxfFixture());

    expect(drawing.entities).toHaveLength(1);
    expect(drawing.entities[0]).toMatchObject({
      type: 'hatch',
      layer: 'FILLS'
    });
    expect(drawing.bounds.minY).toBeLessThan(-4.9);
    expect(drawing.bounds.maxY).toBe(10);
  });

  it('renders DXF HATCH multiple loops with even-odd fill', async () => {
    const drawing = loadDxfDrawing(createHatchMultiLoopDxfFixture());

    expect(drawing.entities).toHaveLength(1);
    expect(drawing.entities[0]).toMatchObject({
      type: 'hatch',
      layer: 'FILLS',
      loops: [
        [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 20 },
          { x: 0, y: 20 }
        ],
        [
          { x: 6, y: 6 },
          { x: 14, y: 6 },
          { x: 14, y: 14 },
          { x: 6, y: 14 }
        ]
      ]
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createCadPreviewDriver().createSession(container);

    await session.load(new TextEncoder().encode(createHatchMultiLoopDxfFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'hatch-multiloop.dxf',
        extension: 'dxf'
      },
      route: createCadPreviewRoutes().find((route) => route.extensions.includes('dxf'))
    });

    const path = container.querySelector('svg.cadv-canvas path[data-layer="FILLS"]');

    expect(path?.getAttribute('fill-rule')).toBe('evenodd');
    expect(path?.getAttribute('d')?.match(/M /g)).toHaveLength(2);

    session.destroy();
    container.remove();
  });

  it('parses DXF HATCH line and arc edge boundaries as filled hatches', async () => {
    const drawing = loadDxfDrawing(createHatchArcEdgeDxfFixture());

    expect(drawing.entities).toHaveLength(1);
    expect(drawing.entities[0]).toMatchObject({
      type: 'hatch',
      layer: 'FILLS',
      colorIndex: 3
    });
    expect(drawing.bounds).toMatchObject({
      minX: 0,
      minY: 0,
      maxX: 15,
      maxY: 10
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createCadPreviewDriver().createSession(container);

    await session.load(new TextEncoder().encode(createHatchArcEdgeDxfFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'hatch-arc-edge.dxf',
        extension: 'dxf'
      },
      route: createCadPreviewRoutes().find((route) => route.extensions.includes('dxf'))
    });

    const path = container.querySelector('svg.cadv-canvas path[data-layer="FILLS"]');
    expect(path).toBeTruthy();
    expect((path?.getAttribute('d')?.split(' ').length ?? 0)).toBeGreaterThan(16);

    session.destroy();
    container.remove();
  });

  it('parses DXF HATCH elliptical arc edge boundaries as filled hatches', () => {
    const drawing = loadDxfDrawing(createHatchEllipseEdgeDxfFixture());

    expect(drawing.entities).toHaveLength(1);
    expect(drawing.entities[0]).toMatchObject({
      type: 'hatch',
      layer: 'FILLS'
    });
    expect(drawing.bounds).toMatchObject({
      minX: 0,
      minY: 0,
      maxX: 20,
      maxY: 5
    });
  });

  it('samples DXF HATCH spline edge boundaries as filled hatches', () => {
    const drawing = loadDxfDrawing(createHatchSplineEdgeDxfFixture());

    expect(drawing.entities).toHaveLength(1);
    expect(drawing.entities[0]).toMatchObject({
      type: 'hatch',
      layer: 'FILLS'
    });
    expect(drawing.bounds).toMatchObject({
      minX: 0,
      minY: 0,
      maxX: 10,
      maxY: 8
    });
  });

  it('warns when DXF INSERT references a missing block', () => {
    const drawing = loadDxfDrawing(createMissingBlockInsertDxfFixture());

    expect(drawing.entities).toEqual([]);
    expect(drawing.warnings).toEqual(['DXF INSERT references missing block "MISSING"; skipped.']);
  });

  it('warns when DXF DIMENSION references a missing geometry block', () => {
    const drawing = loadDxfDrawing(createMissingDimensionBlockDxfFixture());

    expect(drawing.entities).toEqual([]);
    expect(drawing.warnings).toEqual(['DXF DIMENSION references missing block "*D42"; skipped.']);
  });

  it('exposes direct DXF routes and driver support', () => {
    const routes = createCadPreviewRoutes();
    const route = routes.find((item) => item.extensions.includes('dxf'));

    expect(route).toMatchObject({
      family: 'cad',
      driverId: 'cad',
      targetFormat: 'dxf'
    });
    expect(route?.conversion).toBeUndefined();

    const driver = createCadPreviewDriver();
    expect(driver.supports('dxf')).toBe(true);
    expect(driver.supports('.DXF')).toBe(true);
    expect(driver.supports('dwg')).toBe(false);
  });

  it('renders DXF sources as SVG through the preview session', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createCadPreviewDriver().createSession(container, {
      initialScale: 1
    });
    const rendered = vi.fn();
    session.on('rendered', rendered);

    await session.load(new TextEncoder().encode(createDxfFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'floorplan.dxf',
        extension: 'dxf'
      },
      route: createCadPreviewRoutes().find((route) => route.extensions.includes('dxf'))
    });

    expect(rendered).toHaveBeenCalledTimes(1);
    expect(session.getState()).toMatchObject({
      family: 'cad',
      loading: false,
      scale: 1,
      capabilities: {
        zoom: true,
        pan: true,
        layers: true
      }
    });
    expect(container.querySelector('svg.cadv-canvas')).toBeTruthy();
    expect(container.querySelectorAll('line, circle, path, text').length).toBeGreaterThanOrEqual(5);

    session.setScale?.(1.5);
    session.pan?.(12, -8);
    expect((container.querySelector('svg.cadv-canvas') as SVGSVGElement | null)?.style.transform).toBe('translate(12px, -8px) scale(1.5)');

    session.destroy();
    container.remove();
  });

  it('toggles DXF layer visibility through the preview session', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createCadPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(createLayeredDxfFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'layered.dxf',
        extension: 'dxf'
      },
      route: createCadPreviewRoutes().find((route) => route.extensions.includes('dxf'))
    });

    const hidden = container.querySelector('svg.cadv-canvas line[data-layer="HIDDEN"]') as SVGLineElement | null;
    expect(session.getState().activeLayerIds).toEqual(['LABELS', 'WALLS']);
    expect(hidden?.getAttribute('display')).toBe('none');

    session.toggleLayer?.('HIDDEN', true);
    expect(session.getState().activeLayerIds).toEqual(['LABELS', 'WALLS', 'HIDDEN']);
    expect(hidden?.hasAttribute('display')).toBe(false);
    expect(hidden?.getAttribute('data-layer-visible')).toBe('true');

    session.setActiveLayers?.(['LABELS']);
    expect(container.querySelector('svg.cadv-canvas line[data-layer="WALLS"]')?.getAttribute('display')).toBe('none');
    expect(hidden?.getAttribute('display')).toBe('none');

    session.destroy();
    container.remove();
  });

  it('honors DXF layer flags and entity invisible flags', async () => {
    const drawing = loadDxfDrawing(createVisibilityFlagsDxfFixture());

    expect(drawing.layerStyles).toMatchObject([
      {
        name: 'FROZEN',
        frozen: true,
        locked: false,
        visible: false
      },
      {
        name: 'LOCKED',
        frozen: false,
        locked: true,
        visible: true
      }
    ]);
    expect(drawing.entities[0]).toMatchObject({
      type: 'line',
      layer: 'FROZEN',
      visible: false
    });
    expect(drawing.entities[1]).toMatchObject({
      type: 'line',
      layer: 'LOCKED',
      entityVisible: false,
      visible: false
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createCadPreviewDriver().createSession(container);

    await session.load(new TextEncoder().encode(createVisibilityFlagsDxfFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'visibility-flags.dxf',
        extension: 'dxf'
      },
      route: createCadPreviewRoutes().find((route) => route.extensions.includes('dxf'))
    });

    const frozen = container.querySelector('svg.cadv-canvas line[data-layer="FROZEN"]') as SVGLineElement | null;
    const invisible = container.querySelector('svg.cadv-canvas line[data-layer="LOCKED"]') as SVGLineElement | null;

    expect(session.getState().activeLayerIds).toEqual(['LOCKED']);
    expect(frozen?.getAttribute('display')).toBe('none');
    expect(invisible?.getAttribute('display')).toBe('none');
    expect(invisible?.getAttribute('data-entity-visible')).toBe('false');

    session.toggleLayer?.('FROZEN', true);
    expect(frozen?.hasAttribute('display')).toBe(false);
    expect(invisible?.getAttribute('display')).toBe('none');

    session.destroy();
    container.remove();
  });

  it('renders layer and color metadata into SVG nodes', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createCadPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(createLayeredDxfFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'layered.dxf',
        extension: 'dxf'
      },
      route: createCadPreviewRoutes().find((route) => route.extensions.includes('dxf'))
    });

    const line = container.querySelector('svg.cadv-canvas line[data-layer="WALLS"]') as SVGLineElement | null;
    const circle = container.querySelector('svg.cadv-canvas circle[data-layer="WALLS"]') as SVGCircleElement | null;
    const text = container.querySelector('svg.cadv-canvas text[data-layer="LABELS"]') as SVGTextElement | null;
    const hidden = container.querySelector('svg.cadv-canvas line[data-layer="HIDDEN"]') as SVGLineElement | null;

    expect(line?.getAttribute('stroke')).toBe('#ff0000');
    expect(circle?.getAttribute('stroke')).toBe('#00ffff');
    expect(circle?.getAttribute('data-color-index')).toBe('4');
    expect(text?.getAttribute('fill')).toBe('#0000ff');
    expect(hidden?.getAttribute('display')).toBe('none');
    expect(hidden?.getAttribute('data-layer-visible')).toBe('false');

    session.destroy();
    container.remove();
  });


  it('uses a font resolver for DXF text styles before falling back', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createCadPreviewDriver().createSession(container, {
      fontResolver: (request) => request.fontFile === 'romans.shx' ? 'Romans CAD' : undefined
    });

    await session.load(new TextEncoder().encode(createStyledDxfFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'styled.dxf',
        extension: 'dxf'
      },
      route: createCadPreviewRoutes().find((route) => route.extensions.includes('dxf'))
    });

    const text = container.querySelector('svg.cadv-canvas text') as SVGTextElement | null;
    expect(text?.getAttribute('font-family')).toContain('Romans CAD');
    expect(text?.getAttribute('text-anchor')).toBe('middle');
    expect(text?.getAttribute('dominant-baseline')).toBe('middle');
    expect(text?.getAttribute('transform')).toContain('rotate(-30');
    expect(text?.getAttribute('transform')).toContain('scale(0.85 1)');
    expect(text?.getAttribute('transform')).toContain('skewX(-12)');
    expect(session.getState().warnings).toEqual([]);

    session.destroy();
    container.remove();
  });
});

function createStyledDxfFixture(): string {
  return `0
SECTION
2
TABLES
0
TABLE
2
STYLE
0
STYLE
2
ARCH
3
romans.shx
0
ENDTAB
0
ENDSEC
0
SECTION
2
ENTITIES
0
TEXT
8
0
10
5
20
6
40
3
41
0.85
50
30
51
12
72
1
73
2
7
ARCH
1
Styled label
0
ENDSEC
0
EOF`;
}

function createDimensionDxfFixture(): string {
  return `0
SECTION
2
BLOCKS
0
BLOCK
2
*D1
10
0
20
0
0
LINE
8
0
10
0
20
0
11
20
21
0
0
TEXT
8
0
10
8
20
2
40
2
1
20
0
ENDBLK
0
ENDSEC
0
SECTION
2
ENTITIES
0
DIMENSION
8
DIMS
2
*D1
10
0
20
0
11
20
21
0
0
ENDSEC
0
EOF`;
}

function createFallbackDimensionDxfFixture(): string {
  return `0
SECTION
2
ENTITIES
0
DIMENSION
8
DIMS
2
*MISSING_DIM
10
0
20
0
11
10
21
3
13
0
23
0
14
20
24
0
1
20
140
2
0
ENDSEC
0
EOF`;
}

function createFaceDxfFixture(): string {
  return `0
SECTION
2
ENTITIES
0
SOLID
8
FILLS
62
2
10
0
20
0
11
10
21
0
12
10
22
5
13
0
23
5
0
TRACE
8
FILLS
10
15
20
0
11
25
21
0
12
25
22
5
13
15
23
5
0
3DFACE
8
FILLS
10
30
20
0
11
40
21
0
12
40
22
5
0
ENDSEC
0
EOF`;
}

function createSplineDxfFixture(): string {
  return `0
SECTION
2
ENTITIES
0
SPLINE
8
CURVES
70
0
71
3
11
0
21
0
11
10
21
12
11
20
21
0
0
ENDSEC
0
EOF`;
}

function createHatchDxfFixture(): string {
  return `0
SECTION
2
ENTITIES
0
HATCH
8
FILLS
62
3
10
0
20
0
91
1
92
7
72
0
73
1
93
4
10
0
20
0
10
12
20
0
10
12
20
8
10
0
20
8
75
1
76
1
52
0
41
1
77
0
78
0
0
ENDSEC
0
EOF`;
}

function createHatchBulgeDxfFixture(): string {
  return `0
SECTION
2
ENTITIES
0
HATCH
8
FILLS
62
3
91
1
92
7
72
1
73
1
93
4
10
0
20
0
42
1
10
10
20
0
10
10
20
10
10
0
20
10
75
1
76
1
52
0
41
1
77
0
78
0
0
ENDSEC
0
EOF`;
}

function createHatchMultiLoopDxfFixture(): string {
  return `0
SECTION
2
ENTITIES
0
HATCH
8
FILLS
62
3
2
SOLID
70
1
91
2
92
7
72
0
73
1
93
4
10
0
20
0
10
20
20
0
10
20
20
20
10
0
20
20
92
7
72
0
73
1
93
4
10
6
20
6
10
14
20
6
10
14
20
14
10
6
20
14
75
1
76
1
52
0
41
1
77
0
78
0
0
ENDSEC
0
EOF`;
}

function createHatchArcEdgeDxfFixture(): string {
  return `0
SECTION
2
ENTITIES
0
HATCH
8
FILLS
62
3
91
1
92
0
93
4
72
1
10
0
20
0
11
10
21
0
72
2
10
10
20
5
40
5
50
270
51
90
73
1
72
1
10
10
20
10
11
0
21
10
72
1
10
0
20
10
11
0
21
0
75
1
76
1
52
0
41
1
77
0
78
0
0
ENDSEC
0
EOF`;
}

function createHatchEllipseEdgeDxfFixture(): string {
  return `0
SECTION
2
ENTITIES
0
HATCH
8
FILLS
62
3
91
1
92
0
93
2
72
1
10
0
20
0
11
20
21
0
72
3
10
10
20
0
11
10
21
0
40
0.5
50
0
51
180
73
1
75
1
76
1
52
0
41
1
77
0
78
0
0
ENDSEC
0
EOF`;
}

function createHatchSplineEdgeDxfFixture(): string {
  return `0
SECTION
2
ENTITIES
0
HATCH
8
FILLS
62
3
91
1
92
0
93
2
72
4
94
3
73
0
74
0
95
0
96
0
97
3
11
0
21
0
11
5
21
8
11
10
21
0
72
1
10
10
20
0
11
0
21
0
75
1
76
1
52
0
41
1
77
0
78
0
0
ENDSEC
0
EOF`;
}

function createMissingDimensionBlockDxfFixture(): string {
  return `0
SECTION
2
ENTITIES
0
DIMENSION
8
DIMS
2
*D42
10
0
20
0
0
ENDSEC
0
EOF`;
}

function createAttributeTextDxfFixture(): string {
  return `0
SECTION
2
BLOCKS
0
BLOCK
2
TAGBLOCK
10
0
20
0
0
ATTDEF
8
0
10
0
20
0
40
2
1
TAG
2
ID
0
ENDBLK
0
ENDSEC
0
SECTION
2
ENTITIES
0
ATTRIB
8
LABELS
10
4
20
6
40
2
1
Door 101
2
DOOR_ID
0
INSERT
8
LABELS
2
TAGBLOCK
10
20
20
10
0
ENDSEC
0
EOF`;
}

function createMtextFormattingDxfFixture(): string {
  return `0
SECTION
2
ENTITIES
0
MTEXT
8
LABELS
10
0
20
0
40
2
1
{\\fArial|b1|i0;Angle 90%%d}\\P\\LSecond\\l \\S1#2;
0
ENDSEC
0
EOF`;
}

function createTextAlignmentDxfFixture(): string {
  return `0
SECTION
2
ENTITIES
0
TEXT
8
LABELS
10
0
20
0
11
20
21
10
40
2
72
1
73
2
1
Aligned
0
MTEXT
8
LABELS
10
40
20
20
11
0
21
1
40
2
41
50
71
3
1
Attached
0
ENDSEC
0
EOF`;
}

function createEllipseDxfFixture(): string {
  return `0
SECTION
2
ENTITIES
0
ELLIPSE
8
CURVES
10
10
20
10
11
6
21
0
40
0.5
41
0
42
6.283185307179586
0
ELLIPSE
8
CURVES
10
20
20
10
11
6
21
0
40
0.5
41
0
42
3.141592653589793
0
ENDSEC
0
EOF`;
}

function createBulgedPolylineDxfFixture(): string {
  return `0
SECTION
2
ENTITIES
0
LWPOLYLINE
8
CURVES
90
2
70
0
10
0
20
0
42
1
10
10
20
0
0
POLYLINE
8
CURVES
70
0
0
VERTEX
8
CURVES
10
20
20
0
42
1
0
VERTEX
8
CURVES
10
30
20
0
0
SEQEND
0
ENDSEC
0
EOF`;
}

function createPointLeaderDxfFixture(): string {
  return `0
SECTION
2
ENTITIES
0
POINT
8
CONTROL
62
1
10
5
20
5
0
LEADER
8
ANNO
76
3
10
0
20
0
10
10
20
4
10
14
20
4
0
ENDSEC
0
EOF`;
}

function createWidePolylineDxfFixture(): string {
  return `0
SECTION
2
ENTITIES
0
LWPOLYLINE
8
ROADS
90
2
70
0
43
4
10
0
20
0
10
20
20
0
0
POLYLINE
8
ROADS
70
0
0
VERTEX
8
ROADS
10
0
20
10
40
2
41
2
0
VERTEX
8
ROADS
10
20
20
10
40
2
41
2
0
SEQEND
0
ENDSEC
0
EOF`;
}

function createClassicPolylineDxfFixture(): string {
  return `0
SECTION
2
ENTITIES
0
POLYLINE
8
ROADS
62
3
70
1
0
VERTEX
8
ROADS
10
0
20
0
0
VERTEX
8
ROADS
10
10
20
0
0
VERTEX
8
ROADS
10
10
20
5
0
SEQEND
0
ENDSEC
0
EOF`;
}

function createBlockInsertDxfFixture(): string {
  return `0
SECTION
2
TABLES
0
TABLE
2
LAYER
0
LAYER
2
FURNITURE
62
2
0
ENDTAB
0
ENDSEC
0
SECTION
2
BLOCKS
0
BLOCK
2
CHAIR
10
0
20
0
0
LINE
8
0
10
0
20
0
11
5
21
0
0
TEXT
8
0
10
0
20
1
40
1
1
Seat
0
ENDBLK
0
ENDSEC
0
SECTION
2
ENTITIES
0
INSERT
8
FURNITURE
62
2
2
CHAIR
10
10
20
20
41
2
42
2
50
90
0
ENDSEC
0
EOF`;
}

function createMInsertDxfFixture(): string {
  return `0
SECTION
2
BLOCKS
0
BLOCK
2
UNITLINE
10
0
20
0
0
LINE
8
0
10
0
20
0
11
2
21
0
0
ENDBLK
0
ENDSEC
0
SECTION
2
ENTITIES
0
MINSERT
8
FURNITURE
2
UNITLINE
10
0
20
0
70
2
71
2
44
5
45
3
0
ENDSEC
0
EOF`;
}

function createNestedBlockInsertDxfFixture(): string {
  return `0
SECTION
2
BLOCKS
0
BLOCK
2
LEAF
10
0
20
0
0
LINE
8
0
10
0
20
0
11
4
21
0
0
ENDBLK
0
BLOCK
2
SYMBOL
10
0
20
0
0
INSERT
8
0
2
LEAF
10
2
20
0
0
ENDBLK
0
ENDSEC
0
SECTION
2
ENTITIES
0
INSERT
8
SYMBOLS
2
SYMBOL
10
8
20
5
0
ENDSEC
0
EOF`;
}

function createMissingBlockInsertDxfFixture(): string {
  return `0
SECTION
2
ENTITIES
0
INSERT
8
0
2
MISSING
10
10
20
20
0
ENDSEC
0
EOF`;
}

function createLayeredDxfFixture(): string {
  return `0
SECTION
2
TABLES
0
TABLE
2
LAYER
0
LAYER
2
WALLS
62
1
0
LAYER
2
LABELS
62
5
0
LAYER
2
HIDDEN
62
-3
0
ENDTAB
0
ENDSEC
0
SECTION
2
ENTITIES
0
LINE
8
WALLS
10
0
20
0
11
10
21
10
0
CIRCLE
8
WALLS
62
4
10
20
20
20
40
5
0
TEXT
8
LABELS
10
3
20
3
40
2
1
Layer label
0
LINE
8
HIDDEN
10
0
20
10
11
10
21
0
0
ENDSEC
0
EOF`;
}

function createTrueColorDxfFixture(): string {
  return `0
SECTION
2
TABLES
0
TABLE
2
LAYER
0
LAYER
2
TRUE
420
65280
440
33554560
0
ENDTAB
0
ENDSEC
0
SECTION
2
ENTITIES
0
LINE
8
TRUE
10
0
20
0
11
10
21
0
0
CIRCLE
8
TRUE
420
255
440
25
10
20
20
0
40
4
0
ENDSEC
0
EOF`;
}

function createVisibilityFlagsDxfFixture(): string {
  return `0
SECTION
2
TABLES
0
TABLE
2
LAYER
0
LAYER
2
FROZEN
70
1
62
2
0
LAYER
2
LOCKED
70
4
62
3
0
ENDTAB
0
ENDSEC
0
SECTION
2
ENTITIES
0
LINE
8
FROZEN
10
0
20
0
11
10
21
0
0
LINE
8
LOCKED
60
1
10
0
20
10
11
10
21
10
0
ENDSEC
0
EOF`;
}

function createStyledLineDxfFixture(): string {
  return `0
SECTION
2
ENTITIES
0
LINE
8
STYLE
6
DASHED
370
200
10
0
20
0
11
20
21
0
0
CIRCLE
8
STYLE
6
CENTER
370
50
10
30
20
5
40
4
0
LWPOLYLINE
8
STYLE
6
HIDDEN
370
100
43
4
10
0
20
10
10
20
20
10
0
ENDSEC
0
EOF`;
}

function createLineTypeTableDxfFixture(): string {
  return `0
SECTION
2
TABLES
0
TABLE
2
LTYPE
0
LTYPE
2
DASHDOT
3
Dash dot
73
4
40
10
49
6
49
-2
49
0
49
-2
0
ENDTAB
0
TABLE
2
LAYER
0
LAYER
2
CENTERLINES
62
4
6
DASHDOT
370
35
0
ENDTAB
0
ENDSEC
0
SECTION
2
ENTITIES
0
LINE
8
CENTERLINES
10
0
20
0
11
30
21
0
0
ENDSEC
0
EOF`;
}

function createLineTypeScaleDxfFixture(): string {
  return `0
SECTION
2
HEADER
9
$LTSCALE
40
2
0
ENDSEC
0
SECTION
2
TABLES
0
TABLE
2
LTYPE
0
LTYPE
2
DASHDOT
3
Dash dot
73
4
40
10
49
6
49
-2
49
0
49
-2
0
ENDTAB
0
ENDSEC
0
SECTION
2
ENTITIES
0
LINE
8
SCALE
6
DASHED
10
0
20
0
11
20
21
0
0
LINE
8
SCALE
6
DASHDOT
48
0.5
10
0
20
5
11
20
21
5
0
ENDSEC
0
EOF`;
}

function createImageDxfFixture(): string {
  return `0
SECTION
2
OBJECTS
0
IMAGEDEF
5
2A
1
data:image/png;base64,iVBORw0KGgo=
10
20
20
10
0
ENDSEC
0
SECTION
2
ENTITIES
0
IMAGE
8
RASTER
10
0
20
0
11
1
21
0
12
0
22
1
13
20
23
10
340
2A
0
ENDSEC
0
EOF`;
}

function createClippedImageDxfFixture(): string {
  return `0
SECTION
2
OBJECTS
0
IMAGEDEF
5
2C
1
data:image/png;base64,iVBORw0KGgo=
10
20
20
10
0
ENDSEC
0
SECTION
2
ENTITIES
0
IMAGE
8
RASTER
10
0
20
0
11
1
21
0
12
0
22
1
13
20
23
10
340
2C
280
1
91
2
14
5
24
2
14
15
24
8
0
ENDSEC
0
EOF`;
}

function createUnresolvedImageDxfFixture(): string {
  return `0
SECTION
2
OBJECTS
0
IMAGEDEF
5
2B
1
textures\\site-plan.png
10
20
20
10
0
ENDSEC
0
SECTION
2
ENTITIES
0
IMAGE
8
RASTER
10
0
20
0
11
1
21
0
12
0
22
1
13
20
23
10
340
2B
0
ENDSEC
0
EOF`;
}

function createConstructionLineDxfFixture(): string {
  return `0
SECTION
2
ENTITIES
0
XLINE
8
AUX
10
10
20
10
11
1
21
1
0
RAY
8
AUX
10
20
20
0
11
0
21
1
0
ENDSEC
0
EOF`;
}

function createHeaderExtentsDxfFixture(): string {
  return `0
SECTION
2
HEADER
9
$EXTMIN
10
-50
20
-25
9
$EXTMAX
10
150
20
75
9
$INSUNITS
70
4
9
$MEASUREMENT
70
1
0
ENDSEC
0
SECTION
2
ENTITIES
0
XLINE
8
AUX
10
0
20
0
11
1
21
0
0
ENDSEC
0
EOF`;
}

function createDxfFixture(): string {
  return `0
SECTION
2
ENTITIES
0
LINE
8
0
10
0
20
0
11
120
21
80
0
CIRCLE
8
ROOMS
10
40
20
40
40
20
0
ARC
8
ROOMS
10
80
20
40
40
20
50
0
51
180
0
LWPOLYLINE
8
ROOMS
70
1
10
0
20
0
10
120
20
0
10
120
20
80
10
0
20
80
0
TEXT
8
0
10
12
20
12
40
8
1
Room A
0
ENDSEC
0
EOF`;
}
