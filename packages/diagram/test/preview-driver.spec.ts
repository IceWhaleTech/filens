import { describe, expect, it } from 'vitest';
import { deflateSync, strToU8 } from 'fflate';
import JSZip from 'jszip';
import { createDiagramPreviewDriver, createDiagramPreviewRoutes, decodeCompressedDrawioPayload, loadDrawioDiagram, loadVdxDiagram, loadVsdxDiagram } from '../src';
import { legacyVdxFixture } from './fixtures/diagrams.mjs';

describe('diagram preview driver', () => {
  it('uses default draw.io dimensions when size attributes are absent', () => {
    const nodes = loadDrawioDiagram('<mxGraphModel><root><mxCell id="default" vertex="1"><mxGeometry/></mxCell><mxCell id="zero" vertex="1"><mxGeometry width="0" height="0"/></mxCell><mxCell id="invalid" vertex="1"><mxGeometry width="invalid" height="Infinity"/></mxCell></root></mxGraphModel>').pages[0]!.nodes;
    expect(nodes).toMatchObject([
      { id: 'default', x: 0, y: 0, width: 120, height: 60 },
      { id: 'zero', width: 0, height: 0 },
      { id: 'invalid', width: 120, height: 60 }
    ]);
  });

  it('reads legacy VDX XForm, PageProps, colors and one-dimensional Shape connectors', () => {
    const page = loadVdxDiagram(legacyVdxFixture).pages[0]!;
    expect(page.nodes).toHaveLength(2);
    expect(page.nodes[0]).toMatchObject({ id: '1', label: 'Start', style: 'fillColor=#dae8fc;strokeColor=#6c8ebf;rounded=1' });
    expect(page.nodes[0]!.x).toBeCloseTo(86.4);
    expect(page.nodes[0]!.y).toBeCloseTo(115.2);
    expect(page.nodes[0]!.width).toBeCloseTo(115.2);
    expect(page.nodes[0]!.height).toBeCloseTo(57.6);
    expect(page.nodes[1]!.x).toBeCloseTo(374.4);
    expect(page.edges).toMatchObject([{ id: '3', label: 'Next', source: '1', target: '2' }]);
  });

  it('keeps VSDX connectors with Type="Shape" and cached endpoints', async () => {
    const zip = new JSZip();
    zip.file('visio/pages/page1.xml', '<PageContents><Shapes><Shape ID="1" Type="Shape"><Cell N="PinX" V="2"/><Cell N="PinY" V="3"/></Shape><Shape ID="2" Type="Shape"><Cell N="BeginX" V="1"/><Cell N="BeginY" V="2"/><Cell N="EndX" V="4"/><Cell N="EndY" V="5"/><Text>Connector</Text></Shape></Shapes></PageContents>');
    const page = (await loadVsdxDiagram(await zip.generateAsync({ type: 'arraybuffer' }))).pages[0]!;
    expect(page.nodes).toHaveLength(1);
    expect(page.edges).toMatchObject([{ id: '2', label: 'Connector', points: [[96, 624], [384, 336]] }]);
  });

  it('recognizes connected VSDX Shape edges even without cached endpoints', async () => {
    const zip = new JSZip();
    zip.file('visio/pages/page1.xml', '<PageContents><Shapes><Shape ID="1" Type="Shape"/><Shape ID="2" Type="Shape"><Text>Linked</Text></Shape><Shape ID="3" Type="Shape"/></Shapes><Connects><Connect FromSheet="2" FromCell="BeginX" ToSheet="1"/><Connect FromSheet="2" FromCell="EndX" ToSheet="3"/></Connects></PageContents>');
    const page = (await loadVsdxDiagram(await zip.generateAsync({ type: 'arraybuffer' }))).pages[0]!;
    expect(page.nodes.map(node => node.id)).toEqual(['1', '3']);
    expect(page.edges).toMatchObject([{ id: '2', label: 'Linked', source: '1', target: '3', points: [] }]);
  });

  it('keeps a two-dimensional shape connected by a non-endpoint cell as a node', () => {
    const page = loadVdxDiagram('<Page><Shapes><Shape ID="1" Type="Shape"><Text>Node</Text></Shape><Shape ID="2" Type="Shape"/></Shapes><Connects><Connect FromSheet="1" FromCell="PinX" ToSheet="2"/></Connects></Page>').pages[0]!;
    expect(page.nodes.map(node => node.id)).toEqual(['1', '2']);
    expect(page.edges).toHaveLength(0);
  });

  it('preserves first-cell precedence, absent values and HTML/entity label normalization', () => {
    const page = loadVdxDiagram('<Page><Shapes><Shape ID="1" Type="Shape"><Cell N="Width" V="2"/><Cell N="Width" V="8"/><Cell N="Height"/><Text>A &amp;amp; B &lt;b&gt;bold&lt;/b&gt; &amp;#x1F600;</Text></Shape></Shapes></Page>').pages[0]!;
    expect(page.nodes[0]).toMatchObject({ width: 192, height: 1, label: 'A & B bold 😀' });
    const labels = ['plain 中文', 'A &amp; B', 'A&#10;B', '&lt;b&gt;hi&lt;/b&gt;', 'A\u0000B', 'A\r\n B', '&quot; &apos; &amp;amp; &amp;lt;', '&copy; &notin; &#128; &AMP;'];
    const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // U+0000 is represented by an HTML numeric entity so the XML remains valid.
    labels[4] = 'A&#0;B';
    const xml = '<mxGraphModel><root>' + labels.map((label, i) => `<mxCell id="${i}" vertex="1" value="${escape(label)}"><mxGeometry width="120" height="60"/></mxCell>`).join('') + '</root></mxGraphModel>';
    expect(loadDrawioDiagram(xml).pages[0]!.nodes.map(node => node.label))
      .toEqual(['plain 中文', 'A & B', 'A B', '<b>hi</b>', 'A�B', 'A B', '" \' &amp; &lt;', '© ∉ € &']);
  });

  it('parses draw.io mxGraph pages into nodes and edges', () => {
    const document = loadDrawioDiagram(createDrawioFixture());

    expect(document.pages).toHaveLength(2);
    expect(document.pages[0]).toMatchObject({
      name: 'Flow',
      nodes: [
        {
          id: 'start',
          label: 'Start',
          x: 40,
          y: 40,
          width: 120,
          height: 60
        },
        {
          id: 'done',
          label: 'Done'
        }
      ],
      edges: [
        {
          id: 'edge-1',
          label: 'Next',
          source: 'start',
          target: 'done'
        }
      ]
    });
  });

  it('decodes compressed draw.io diagram pages', () => {
    const payload = createCompressedDrawioPayload(createMxGraphModelFixture());
    const decoded = decodeCompressedDrawioPayload(payload);
    const document = loadDrawioDiagram(`<?xml version="1.0" encoding="UTF-8"?><mxfile><diagram id="encoded" name="Encoded">${payload}</diagram></mxfile>`);

    expect(decoded).toContain('<mxGraphModel>');
    expect(document.pages).toHaveLength(1);
    expect(document.pages[0]?.nodes.map((node) => node.label)).toEqual(['Start', 'Done']);
    expect(document.pages[0]?.edges[0]?.label).toBe('Next');
  });

  it('parses VSDX pages into nodes and connector edges', async () => {
    const document = await loadVsdxDiagram(await createVsdxFixture());

    expect(document.pages).toHaveLength(2);
    expect(document.pages[0]).toMatchObject({
      id: '10',
      name: 'Manifest Flow',
      nodes: [
        {
          id: '1',
          label: 'Start'
        },
        {
          id: '2',
          label: 'Done'
        }
      ],
      edges: [
        {
          id: '3',
          source: '1',
          target: '2'
        }
      ]
    });
    expect(document.pages[1]).toMatchObject({
      id: '20',
      name: 'Manifest Notes',
      nodes: [
        {
          id: '4',
          label: 'Notes'
        }
      ]
    });
  });

  it('parses VDX XML pages into nodes and connector edges', () => {
    const document = loadVdxDiagram(createVdxFixture());

    expect(document.pages).toHaveLength(1);
    expect(document.pages[0]).toMatchObject({
      name: 'Page 1',
      nodes: [
        {
          id: '1',
          label: 'Start'
        },
        {
          id: '2',
          label: 'Done'
        }
      ],
      edges: [
        {
          id: '3',
          source: '1',
          target: '2'
        }
      ]
    });
  });

  it('exposes direct drawio, dio, vdx, and vsdx routes and driver support', () => {
    const routes = createDiagramPreviewRoutes();
    const route = routes.find((item) => item.extensions.includes('drawio') && item.extensions.includes('dio') && item.extensions.includes('vdx') && item.extensions.includes('vsdx'));
    const driver = createDiagramPreviewDriver();

    expect(route).toMatchObject({
      family: 'diagram',
      driverId: 'diagram',
      targetFormat: 'diagram'
    });
    expect(route?.contentTypes).toEqual(['application/vnd.jgraph.mxfile', 'application/vnd.visio']);
    expect(route?.conversion).toBeUndefined();
    expect(driver.supports('drawio')).toBe(true);
    expect(driver.supports('.DIO')).toBe(true);
    expect(driver.supports('vdx')).toBe(true);
    expect(driver.supports('vsdx')).toBe(true);
    expect(driver.supports('graffle')).toBe(false);
  });

  it('renders draw.io diagrams as selectable SVG elements', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const session = createDiagramPreviewDriver().createSession(host, {
      initialScale: 1
    });
    const renderedStates: unknown[] = [];
    session.on('rendered', (state) => renderedStates.push(state));

    await session.load(new TextEncoder().encode(createDrawioFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'flow.drawio',
        extension: 'drawio',
        contentType: 'application/xml'
      },
      route: {
        sourceFormat: 'drawio',
        targetFormat: 'diagram',
        family: 'diagram',
        driverId: 'diagram'
      }
    });

    expect(session.getState()).toMatchObject({
      family: 'diagram',
      loading: false,
      scale: 1,
      pageIndex: 0,
      pageCount: 2,
      capabilities: {
        paged: true,
        zoom: true
      }
    });
    expect(host.querySelector('.diagramv-summary')?.textContent).toContain('Flow');
    expect(host.querySelectorAll('.diagramv-node')).toHaveLength(2);
    expect(host.querySelectorAll('.diagramv-edge')).toHaveLength(1);
    expect(host.querySelector('.diagramv-canvas')?.textContent).toContain('Start');
    expect(host.querySelector('[data-element-id="start"] rect')?.getAttribute('fill')).toBe('#dae8fc');
    expect(host.querySelector('[data-element-id="done"] ellipse')?.getAttribute('fill')).toBe('#d5e8d4');
    expect(host.querySelector('[data-element-id="edge-1"] polyline')?.getAttribute('stroke')).toBe('#6c8ebf');
    expect(host.querySelector('[data-element-id="edge-1"] polyline')?.getAttribute('marker-end')).toBe('url(#diagramv-arrow-end)');

    host.querySelector<SVGGElement>('[data-element-id="done"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(session.getState().selectedElementId).toBe('done');

    for (const index of [NaN, Infinity, 0.5]) {
      session.goToPage?.(index);
      expect(session.getState().pageIndex).toBe(0);
      expect(host.querySelector('.diagramv-canvas')?.textContent).toContain('Start');
    }
    const viewport = host.querySelector<HTMLElement>('.diagramv-preview')!;
    viewport.scrollTop = 80;
    viewport.scrollLeft = 90;
    session.next?.();
    expect(viewport.scrollTop).toBe(0);
    expect(viewport.scrollLeft).toBe(0);
    expect(session.getState().pageIndex).toBe(1);
    expect(host.querySelector('.diagramv-summary')?.textContent).toContain('Notes');

    session.setScale?.(1.25);
    expect(session.getState().scale).toBe(1.25);
    expect(renderedStates).toHaveLength(1);

    session.destroy();
    host.remove();
  });

  it('renders VSDX diagrams as selectable SVG elements', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const session = createDiagramPreviewDriver().createSession(host, {
      initialScale: 1
    });

    await session.load(await createVsdxFixture(), {
      descriptor: {
        source: new Uint8Array(),
        name: 'flow.vsdx',
        extension: 'vsdx',
        contentType: 'application/vnd.visio'
      },
      route: {
        sourceFormat: 'vsdx',
        targetFormat: 'diagram',
        family: 'diagram',
        driverId: 'diagram'
      }
    });

    expect(session.getState()).toMatchObject({
      family: 'diagram',
      loading: false,
      pageIndex: 0,
      pageCount: 2
    });
    expect(host.querySelector('.diagramv-summary')?.textContent).toContain('Manifest Flow');
    expect(host.querySelectorAll('.diagramv-node')).toHaveLength(2);
    expect(host.querySelectorAll('.diagramv-edge')).toHaveLength(1);
    expect(host.querySelector('.diagramv-canvas')?.textContent).toContain('Start');

    host.querySelector<SVGGElement>('[data-element-id="2"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(session.getState().selectedElementId).toBe('2');

    session.destroy();
    host.remove();
  });

  it('renders VDX diagrams as selectable SVG elements', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const session = createDiagramPreviewDriver().createSession(host, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(createVdxFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'flow.vdx',
        extension: 'vdx',
        contentType: 'application/xml'
      },
      route: {
        sourceFormat: 'vdx',
        targetFormat: 'diagram',
        family: 'diagram',
        driverId: 'diagram'
      }
    });

    expect(session.getState()).toMatchObject({
      family: 'diagram',
      loading: false,
      pageIndex: 0,
      pageCount: 1
    });
    expect(host.querySelectorAll('.diagramv-node')).toHaveLength(2);
    expect(host.querySelectorAll('.diagramv-edge')).toHaveLength(1);
    expect(host.querySelector('.diagramv-canvas')?.textContent).toContain('Start');

    session.destroy();
    host.remove();
  });
});

function createDrawioFixture(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net">
  <diagram id="flow" name="Flow">
    <mxGraphModel>
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="start" value="Start" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontColor=#1f2937;" vertex="1" parent="1">
          <mxGeometry x="40" y="40" width="120" height="60" as="geometry"/>
        </mxCell>
        <mxCell id="done" value="Done" style="ellipse;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontColor=#1f2937;" vertex="1" parent="1">
          <mxGeometry x="260" y="40" width="120" height="60" as="geometry"/>
        </mxCell>
        <mxCell id="edge-1" value="Next" style="endArrow=block;dashed=1;strokeColor=#6c8ebf;fontColor=#23445f;" edge="1" parent="1" source="start" target="done">
          <mxGeometry relative="1" as="geometry">
            <Array as="points"><mxPoint x="210" y="70"/></Array>
          </mxGeometry>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
  <diagram id="notes" name="Notes">
    <mxGraphModel>
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="note" value="Second Page" vertex="1" parent="1">
          <mxGeometry x="80" y="80" width="150" height="60" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;
}

function createMxGraphModelFixture(): string {
  return `<mxGraphModel>
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>
    <mxCell id="start" value="Start" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontColor=#1f2937;" vertex="1" parent="1">
      <mxGeometry x="40" y="40" width="120" height="60" as="geometry"/>
    </mxCell>
    <mxCell id="done" value="Done" style="shape=rhombus;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;" vertex="1" parent="1">
      <mxGeometry x="260" y="40" width="120" height="60" as="geometry"/>
    </mxCell>
    <mxCell id="edge-1" value="Next" edge="1" parent="1" source="start" target="done">
      <mxGeometry relative="1" as="geometry"/>
    </mxCell>
  </root>
</mxGraphModel>`;
}

function createCompressedDrawioPayload(xml: string): string {
  const encoded = encodeURIComponent(xml).replace(/%20/g, '+');
  const compressed = deflateSync(strToU8(encoded));
  let binary = '';
  for (const byte of compressed) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function createVsdxFixture(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('visio/pages/pages.xml', `<?xml version="1.0" encoding="UTF-8"?>
<Pages xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <Page ID="10" NameU="Manifest Flow" Name="Manifest Flow">
    <Rel r:id="rId2"/>
  </Page>
  <Page ID="20" NameU="Manifest Notes" Name="Manifest Notes">
    <Rel r:id="rId1"/>
  </Page>
</Pages>`);
  zip.file('visio/pages/_rels/pages.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Target="page2.xml"/>
  <Relationship Id="rId2" Target="page1.xml"/>
</Relationships>`);
  zip.file('visio/pages/page1.xml', `<?xml version="1.0" encoding="UTF-8"?>
<PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main">
  <PageSheet>
    <Cell N="PageWidth" V="8.5"/>
    <Cell N="PageHeight" V="5"/>
  </PageSheet>
  <Shapes>
    <Shape ID="1" Type="Shape" NameU="Process">
      <Text>Start</Text>
      <Cell N="PinX" V="1.5"/>
      <Cell N="PinY" V="3.5"/>
      <Cell N="Width" V="1.2"/>
      <Cell N="Height" V="0.6"/>
      <Cell N="FillForegnd" V="#DAE8FC"/>
      <Cell N="LineColor" V="#6C8EBF"/>
    </Shape>
    <Shape ID="2" Type="Shape" NameU="Process">
      <Text>Done</Text>
      <Cell N="PinX" V="4.5"/>
      <Cell N="PinY" V="3.5"/>
      <Cell N="Width" V="1.2"/>
      <Cell N="Height" V="0.6"/>
    </Shape>
    <Shape ID="3" Type="OneD" NameU="Dynamic connector">
      <Text>Next</Text>
      <Cell N="BeginX" V="2.1"/>
      <Cell N="BeginY" V="3.5"/>
      <Cell N="EndX" V="3.9"/>
      <Cell N="EndY" V="3.5"/>
    </Shape>
  </Shapes>
  <Connects>
    <Connect FromSheet="3" FromCell="BeginX" ToSheet="1"/>
    <Connect FromSheet="3" FromCell="EndX" ToSheet="2"/>
  </Connects>
</PageContents>`);
  zip.file('visio/pages/page2.xml', `<?xml version="1.0" encoding="UTF-8"?>
<PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main">
  <PageSheet>
    <Cell N="PageWidth" V="8.5"/>
    <Cell N="PageHeight" V="5"/>
  </PageSheet>
  <Shapes>
    <Shape ID="4" Type="Shape" NameU="Process">
      <Text>Notes</Text>
      <Cell N="PinX" V="2.5"/>
      <Cell N="PinY" V="3.5"/>
      <Cell N="Width" V="1.2"/>
      <Cell N="Height" V="0.6"/>
    </Shape>
  </Shapes>
</PageContents>`);
  return zip.generateAsync({ type: 'arraybuffer' });
}

function createVdxFixture(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<VisioDocument xmlns="http://schemas.microsoft.com/visio/2003/core">
  <Pages>
    <Page ID="0" NameU="Page 1">
      <PageSheet>
        <Cell N="PageWidth" V="8.5"/>
        <Cell N="PageHeight" V="5"/>
      </PageSheet>
      <Shapes>
        <Shape ID="1" Type="Shape" NameU="Process">
          <Text>Start</Text>
          <Cell N="PinX" V="1.5"/>
          <Cell N="PinY" V="3.5"/>
          <Cell N="Width" V="1.2"/>
          <Cell N="Height" V="0.6"/>
          <Cell N="FillForegnd" V="#DAE8FC"/>
          <Cell N="LineColor" V="#6C8EBF"/>
        </Shape>
        <Shape ID="2" Type="Shape" NameU="Process">
          <Text>Done</Text>
          <Cell N="PinX" V="4.5"/>
          <Cell N="PinY" V="3.5"/>
          <Cell N="Width" V="1.2"/>
          <Cell N="Height" V="0.6"/>
        </Shape>
        <Shape ID="3" Type="OneD" NameU="Dynamic connector">
          <Text>Next</Text>
          <Cell N="BeginX" V="2.1"/>
          <Cell N="BeginY" V="3.5"/>
          <Cell N="EndX" V="3.9"/>
          <Cell N="EndY" V="3.5"/>
        </Shape>
      </Shapes>
      <Connects>
        <Connect FromSheet="3" FromCell="BeginX" ToSheet="1"/>
        <Connect FromSheet="3" FromCell="EndX" ToSheet="2"/>
      </Connects>
    </Page>
  </Pages>
</VisioDocument>`;
}
