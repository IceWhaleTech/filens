import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createMindmapPreviewDriver, createMindmapPreviewRoutes, loadMindmanagerDocument, loadMindmapDocument, loadXmindDocument } from '../src';

describe('mindmap preview driver', () => {
  it('parses FreeMind MM documents into a normalized tree', () => {
    const document = loadMindmapDocument(createMmFixture(), 'mm');

    expect(document).toMatchObject({
      title: 'Launch Plan',
      nodeCount: 4,
      root: {
        text: 'Launch Plan',
        children: [
          {
            text: 'Research'
          },
          {
            text: 'Ship',
            children: [
              {
                text: 'Release notes'
              }
            ]
          }
        ]
      }
    });
  });

  it('parses OPML documents into a normalized tree', () => {
    const document = loadMindmapDocument(createOpmlFixture(), 'opml');

    expect(document.title).toBe('Roadmap');
    expect(document.nodeCount).toBe(4);
    expect(document.root.children.map((node) => node.text)).toEqual(['Previewers', 'Converters']);
  });

  it('parses XMind content.json packages into a normalized tree', async () => {
    const document = await loadXmindDocument(await createXmindJsonFixture());

    expect(document).toMatchObject({
      title: 'Launch Board',
      nodeCount: 4,
      root: {
        text: 'Launch Board',
        children: [
          {
            text: 'Research'
          },
          {
            text: 'Build',
            children: [
              {
                text: 'Driver'
              }
            ]
          }
        ]
      }
    });
  });

  it('parses classic XMind content.xml packages into a normalized tree', async () => {
    const document = await loadXmindDocument(await createXmindXmlFixture());

    expect(document.title).toBe('Classic Plan');
    expect(document.nodeCount).toBe(3);
    expect(document.root.children.map((node) => node.text)).toEqual(['Import', 'Render']);
  });

  it('parses MindManager Document.xml packages into a normalized tree', async () => {
    const document = await loadMindmanagerDocument(await createMindmanagerFixture());

    expect(document).toMatchObject({
      title: 'MindManager Plan',
      nodeCount: 4,
      root: {
        text: 'MindManager Plan',
        children: [
          {
            text: 'Track'
          },
          {
            text: 'Ship',
            children: [
              {
                text: 'QA'
              }
            ]
          }
        ]
      }
    });
  });

  it('exposes direct MM, OPML, and XMind routes and driver support', () => {
    const routes = createMindmapPreviewRoutes();
    const route = routes.find((item) =>
      item.extensions.includes('mm') && item.extensions.includes('opml') && item.extensions.includes('xmind') && item.extensions.includes('mmap')
    );
    const driver = createMindmapPreviewDriver();

    expect(route).toMatchObject({
      family: 'mindmap',
      driverId: 'mindmap',
      targetFormat: 'mindmap'
    });
    expect(route?.contentTypes).toEqual([
      'text/x-opml',
      'application/x-freemind',
      'application/x-xmind',
      'application/vnd.xmind.workbook',
      'application/x-mindmanager',
      'application/vnd.mindjet.mindmanager'
    ]);
    expect(route?.conversion).toBeUndefined();
    expect(driver.supports('mm')).toBe(true);
    expect(driver.supports('.OPML')).toBe(true);
    expect(driver.supports('xmind')).toBe(true);
    expect(driver.supports('mmap')).toBe(true);
  });

  it('renders mind maps as selectable SVG nodes', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const session = createMindmapPreviewDriver().createSession(host, {
      initialScale: 1
    });
    const renderedStates: unknown[] = [];
    session.on('rendered', (state) => renderedStates.push(state));

    await session.load(new TextEncoder().encode(createMmFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'plan.mm',
        extension: 'mm',
        contentType: 'application/xml'
      },
      route: {
        sourceFormat: 'mm',
        targetFormat: 'mindmap',
        family: 'mindmap',
        driverId: 'mindmap'
      }
    });

    expect(session.getState()).toMatchObject({
      family: 'mindmap',
      loading: false,
      scale: 1,
      selectedNodeId: 'root',
      capabilities: {
        zoom: true,
        outline: true
      }
    });
    expect(host.querySelector('.mindmapv-summary')?.textContent).toBe('4 nodes');
    expect(host.querySelectorAll('.mindmapv-node')).toHaveLength(4);
    expect(host.querySelector('.mindmapv-canvas')?.textContent).toContain('Launch Plan');

    const release = Array.from(host.querySelectorAll<SVGGElement>('.mindmapv-node')).find((node) => node.textContent?.includes('Release notes'));
    release?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(session.getState().selectedNodeId).toBe('release-notes');

    session.setScale?.(1.3);
    expect(session.getState().scale).toBe(1.3);
    expect(renderedStates).toHaveLength(1);

    session.destroy();
    host.remove();
  });

  it('renders XMind sources through the preview session', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const session = createMindmapPreviewDriver().createSession(host, {
      initialScale: 1
    });

    await session.load(await createXmindJsonFixture(), {
      descriptor: {
        source: new Uint8Array(),
        name: 'plan.xmind',
        extension: 'xmind',
        contentType: 'application/x-xmind'
      },
      route: {
        sourceFormat: 'xmind',
        targetFormat: 'mindmap',
        family: 'mindmap',
        driverId: 'mindmap'
      }
    });

    expect(session.getState()).toMatchObject({
      family: 'mindmap',
      loading: false,
      selectedNodeId: 'root-topic'
    });
    expect(host.querySelector('.mindmapv-summary')?.textContent).toBe('4 nodes');
    expect(host.querySelector('.mindmapv-canvas')?.textContent).toContain('Launch Board');

    session.destroy();
    host.remove();
  });
});

function createMmFixture(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.0.1">
  <node ID="root" TEXT="Launch Plan">
    <node ID="research" TEXT="Research"/>
    <node ID="ship" TEXT="Ship">
      <node ID="release-notes" TEXT="Release notes"/>
    </node>
  </node>
</map>`;
}

function createOpmlFixture(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Roadmap</title></head>
  <body>
    <outline text="Previewers"><outline text="Mind maps"/></outline>
    <outline text="Converters"/>
  </body>
</opml>`;
}

async function createXmindJsonFixture(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('content.json', JSON.stringify([
    {
      id: 'sheet-1',
      title: 'Launch Board',
      rootTopic: {
        id: 'root-topic',
        title: 'Launch Board',
        children: {
          attached: [
            {
              id: 'research',
              title: 'Research'
            },
            {
              id: 'build',
              title: 'Build',
              children: {
                attached: [
                  {
                    id: 'driver',
                    title: 'Driver'
                  }
                ]
              }
            }
          ]
        }
      }
    }
  ]));
  return zip.generateAsync({ type: 'arraybuffer' });
}

async function createXmindXmlFixture(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('content.xml', `<?xml version="1.0" encoding="UTF-8"?>
<xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0">
  <sheet id="sheet-1">
    <title>Classic Plan</title>
    <topic id="root-topic">
      <title>Classic Plan</title>
      <children>
        <topics type="attached">
          <topic id="import"><title>Import</title></topic>
          <topic id="render"><title>Render</title></topic>
        </topics>
      </children>
    </topic>
  </sheet>
</xmap-content>`);
  return zip.generateAsync({ type: 'arraybuffer' });
}

async function createMindmanagerFixture(): Promise<ArrayBuffer> {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Map>
  <Topic Text="MindManager Plan" ID="root">
    <SubTopics>
      <Topic Text="Track" ID="track"/>
      <Topic Text="Ship" ID="ship">
        <SubTopics>
          <Topic Text="QA" ID="qa"/>
        </SubTopics>
      </Topic>
    </SubTopics>
  </Topic>
</Map>`;
  const zip = new JSZip();
  zip.file('Document.xml', xml);
  return zip.generateAsync({ type: 'arraybuffer' });
}
