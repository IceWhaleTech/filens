import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { createMindmapPreviewDriver, createMindmapPreviewRoutes, loadMindmanagerDocument, loadMindmapDocument, loadXmindDocument } from '../src';
import { createWideMmFixture, mixedMmFixture } from './fixtures/maps.mjs';

describe('mindmap preview driver', () => {
  it('preserves fallback IDs across wrappers, metadata, namespaces and explicit IDs', () => {
    const model = loadMindmapDocument(mixedMmFixture, 'mm');
    expect(model).toEqual({
      title: 'Mixed tree', nodeCount: 5,
      root: {
        id: 'mm-1-1', text: 'Mixed tree', children: [
          { id: 'known', text: 'First', children: [{ id: 'known-1-1-1-1-1', text: 'Nested', children: [] }] },
          { id: 'mm-1-1-2-1-1-2', text: 'Second', children: [
            { id: 'mm-1-1-2-1-1-2-1-1-1-2-1', text: 'Last', children: [] }
          ] }
        ]
      }
    });
    expect(loadMindmapDocument('<node TEXT="Root"><node TEXT="Child"/><node TEXT="Second"/></node>', 'mm').root)
      .toEqual({ id: 'mm-1', text: 'Root', children: [
        { id: 'mm-1-1-1', text: 'Child', children: [] },
        { id: 'mm-1-2-2', text: 'Second', children: [] }
      ] });
    const wide = loadMindmapDocument(createWideMmFixture(120), 'mm');
    expect(wide.nodeCount).toBe(120);
    expect(wide.root.children.at(-1)).toEqual({ id: 'mm-1-119-1-119', text: 'Task 119', children: [] });
  });

  it.each(['mm', 'opml', 'xmind', 'mmap'])('discards stale %s successes and errors after switching files', async format => {
    const host = document.createElement('div');
    const session = createMindmapPreviewDriver().createSession(host);
    const rendered = vi.fn(), error = vi.fn();
    session.on('rendered', rendered); session.on('error', error);
    const bytes = await mindmapBytes(format);
    const old = delayedMindmap(format);
    const pending = session.load(old.source, mindmapContext(old.source, format));
    await session.load(bytes, mindmapContext(bytes, format));
    const html = host.innerHTML, state = session.getState();
    old.resolve(new TextEncoder().encode('<map><node TEXT="Old"/></map>'));
    await pending;
    expect(host.innerHTML).toBe(html);
    expect(session.getState()).toEqual(state);
    const failed = delayedMindmap(format);
    const rejected = session.load(failed.source, mindmapContext(failed.source, format));
    await session.load(bytes, mindmapContext(bytes, format));
    failed.reject(new Error('Old read failed'));
    await expect(rejected).resolves.toBeUndefined();
    expect(host.innerHTML).toBe(html);
    expect(session.getState()).toEqual(state);
    expect(rendered).toHaveBeenCalledTimes(2);
    expect(error).not.toHaveBeenCalled();
    session.destroy();
  });

  it.each(['mm', 'opml', 'xmind', 'mmap'])('cancels %s before parsing and releases the previous map', async format => {
    const host = document.createElement('div');
    const session = createMindmapPreviewDriver().createSession(host);
    const bytes = await mindmapBytes(format);
    await session.load(bytes, mindmapContext(bytes, format));
    const rendered = vi.fn(), error = vi.fn();
    session.on('rendered', rendered); session.on('error', error);
    const controller = new AbortController(), delayed = delayedMindmap(format);
    const pending = session.load(delayed.source, mindmapContext(delayed.source, format, controller.signal));
    expect(host.querySelector('svg')).toBeNull();
    expect(session.getState().selectedNodeId).toBeUndefined();
    controller.abort();
    expect(session.getState().loading).toBe(false);
    delayed.resolve(new Uint8Array());
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(host.querySelector('svg')).toBeNull();
    expect(session.getState()).toMatchObject({ loading: false, error: null, selectedNodeId: undefined });
    expect(rendered).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    const alreadyAborted = delayedMindmap(format);
    await expect(session.load(alreadyAborted.source, mindmapContext(alreadyAborted.source, format, controller.signal)))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(alreadyAborted.read).not.toHaveBeenCalled();
    session.destroy();
  });

  it.each(['mm', 'opml', 'xmind', 'mmap'])('discards %s work and clears selection and listeners on destroy', async format => {
    const host = document.createElement('div');
    const session = createMindmapPreviewDriver().createSession(host);
    const bytes = await mindmapBytes(format);
    await session.load(bytes, mindmapContext(bytes, format));
    const delayed = delayedMindmap(format);
    const pending = session.load(delayed.source, mindmapContext(delayed.source, format));
    const changed = vi.fn(), rendered = vi.fn();
    session.on('statechange', changed); session.on('rendered', rendered);
    session.destroy(); delayed.resolve(new Uint8Array());
    await expect(pending).resolves.toBeUndefined();
    expect(session.getState()).toMatchObject({ loading: false, selectedNodeId: undefined });
    expect(host.childElementCount).toBe(0);
    session.setScale?.(1.5);
    expect(changed).not.toHaveBeenCalled();
    expect(rendered).not.toHaveBeenCalled();
  });

  it.each(['xmind-json', 'xmind-xml', 'mmap'])('checks cancellation at ZIP boundaries for %s', async format => {
    const bytes = format === 'mmap' ? await createMindmanagerFixture()
      : format === 'xmind-xml' ? await createXmindXmlFixture() : await createXmindJsonFixture();
    const loader = format === 'mmap' ? loadMindmanagerDocument : loadXmindDocument;
    const zip = await JSZip.loadAsync(bytes);
    const entry = zip.file(format === 'mmap' ? 'Document.xml' : format === 'xmind-xml' ? 'content.xml' : 'content.json')!;
    const controller = new AbortController();
    const extraction = vi.spyOn(entry, 'async');
    const load = vi.spyOn(JSZip, 'loadAsync');
    try {
      load.mockImplementationOnce(async () => { controller.abort(); return zip; });
      await expect(loader(bytes, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
      expect(extraction).not.toHaveBeenCalled();
      load.mockClear();
      await expect(loader(new ArrayBuffer(0), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
      expect(load).not.toHaveBeenCalled();
      const afterExtraction = new AbortController();
      load.mockResolvedValueOnce(zip);
      extraction.mockImplementationOnce(async () => { afterExtraction.abort(); return 'invalid XML/JSON'; });
      await expect(loader(bytes, { signal: afterExtraction.signal })).rejects.toMatchObject({ name: 'AbortError' });
      expect(extraction).toHaveBeenCalledTimes(1);
    } finally { extraction.mockRestore(); load.mockRestore(); }
  });

  it('clears the previous map and reports a current-file error', async () => {
    const host = document.createElement('div');
    const session = createMindmapPreviewDriver().createSession(host);
    const bytes = await mindmapBytes('mm');
    await session.load(bytes, mindmapContext(bytes, 'mm'));
    const error = vi.fn(); session.on('error', error);
    const invalid = new TextEncoder().encode('<not-a-map/>');
    await expect(session.load(invalid, mindmapContext(invalid, 'mm'))).rejects.toThrow('root node');
    expect(host.querySelector('svg')).toBeNull();
    expect(session.getState()).toMatchObject({ loading: false, selectedNodeId: undefined });
    expect(error).toHaveBeenCalledTimes(1);
    session.destroy();
  });

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

function mindmapContext(source: Blob | Uint8Array, extension: string, signal?: AbortSignal) {
  return { descriptor: { source, extension, name: `plan.${extension}` }, signal };
}

async function mindmapBytes(format: string): Promise<Uint8Array> {
  if (format === 'xmind') return new Uint8Array(await createXmindJsonFixture());
  if (format === 'mmap') return new Uint8Array(await createMindmanagerFixture());
  return new TextEncoder().encode(format === 'opml' ? createOpmlFixture() : createMmFixture());
}

function delayedMindmap(format: string) {
  let resolve!: (bytes: Uint8Array) => void, reject!: (error: Error) => void;
  const source = new Blob([]);
  const promise = new Promise<Uint8Array>((done, fail) => { resolve = done; reject = fail; });
  const read = vi.fn(async () => {
    const bytes = await promise;
    return format === 'mm' || format === 'opml' ? new TextDecoder().decode(bytes) : bytes.slice().buffer;
  });
  Object.defineProperty(source, format === 'mm' || format === 'opml' ? 'text' : 'arrayBuffer', { value: read });
  return { source, resolve, reject, read };
}

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
