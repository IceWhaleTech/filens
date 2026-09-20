import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mount } from '@vue/test-utils';
import JSZip from 'jszip';
import { nextTick } from 'vue';
import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import PptxPreview from '../src/PptxPreview.vue';
import Preview from '../src/Preview.vue';

const { MockWebGLRenderer } = vi.hoisted(() => ({
  MockWebGLRenderer: class {
    readonly domElement = document.createElement('canvas');
    setPixelRatio = vi.fn();
    setClearColor = vi.fn();
    setSize = vi.fn();
    render = vi.fn();
    dispose = vi.fn();
  }
}));

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  return {
    ...actual,
    WebGLRenderer: MockWebGLRenderer
  };
});

vi.mock('three/examples/jsm/loaders/GLTFLoader.js', async () => {
  const { Group } = await vi.importActual<typeof import('three')>('three');
  return {
    GLTFLoader: class {
      parseAsync = vi.fn(async () => ({
        scene: new Group()
      }));
    }
  };
});

vi.mock('@filens/model3d', () => {
  const formats = new Set(['stl', 'obj', 'ply', 'gltf', 'glb', '3mf']);

  class MockModel3dPreviewSession {
    private readonly listeners = {
      loading: new Set<(state: unknown) => void>(),
      rendered: new Set<(state: unknown) => void>(),
      error: new Set<(error: Error) => void>(),
      statechange: new Set<(state: unknown) => void>(),
      warnings: new Set<(warnings: string[]) => void>()
    };
    private state = {
      loading: false,
      error: null as string | null,
      family: 'model3d',
      warnings: [] as string[],
      capabilities: {
        zoom: true,
        fit: true,
        pan: true,
        orbit: true,
        fullscreen: true,
        download: true,
        measure: true,
        metadata: true
      },
      scale: 1,
      metadata: {
        format: 'model3d',
        meshCount: 1,
        vertexCount: 3
      }
    };

    constructor(
      private readonly host: HTMLElement,
      private readonly options: { resourceResolver?: (request: unknown) => unknown | Promise<unknown> } = {}
    ) {}

    async load(_source: unknown, context: { descriptor: { name?: string }; route?: { sourceFormat?: string } }): Promise<void> {
      this.state = {
        ...this.state,
        loading: true,
        error: null,
        title: context.descriptor.name,
        metadata: {
          ...this.state.metadata,
          format: context.route?.sourceFormat ?? 'model3d'
        }
      };
      this.emit('loading', this.state);
      this.emit('statechange', this.state);

      await this.options.resourceResolver?.({
        family: 'model3d',
        sourceFormat: context.route?.sourceFormat,
        source: 'scene.bin',
        relation: 'buffer'
      });

      const canvas = document.createElement('canvas');
      canvas.className = 'model3dv-canvas';
      this.host.replaceChildren(canvas);
      this.state = {
        ...this.state,
        loading: false,
        error: null
      };
      this.emit('rendered', this.state);
      this.emit('statechange', this.state);
    }

    destroy(): void {
      this.host.replaceChildren();
    }

    getState(): typeof this.state {
      return this.state;
    }

    on(event: keyof typeof this.listeners, handler: (payload: never) => void): () => void {
      this.listeners[event].add(handler as never);
      return () => this.listeners[event].delete(handler as never);
    }

    setScale(scale: number): void {
      this.state = { ...this.state, scale };
      this.emit('statechange', this.state);
    }

    fit(): void {}

    async fullscreen(): Promise<void> {}

    private emit(event: keyof typeof this.listeners, payload: unknown): void {
      for (const handler of this.listeners[event]) {
        handler(payload as never);
      }
    }
  }

  const modelRoute = {
    extensions: [...formats],
    family: 'model3d',
    driverId: 'model3d',
    targetFormat: 'model3d',
    contentTypes: ['model/stl', 'model/obj', 'model/ply', 'model/gltf+json', 'model/gltf-binary', 'model/3mf']
  };

  return {
    createModel3dPreviewDriver: () => ({
      id: 'model3d',
      family: 'model3d',
      supports: (format: string) => formats.has(format.replace(/^\./, '').toLowerCase()),
      createSession: (host: HTMLElement, options?: { resourceResolver?: (request: unknown) => unknown | Promise<unknown> }) =>
        new MockModel3dPreviewSession(host, options)
    }),
    createModel3dPreviewRoutes: (baseRoutes: unknown[] = []) => [
      modelRoute,
      ...baseRoutes.filter(
        (route) =>
          !Array.isArray((route as { extensions?: unknown }).extensions) ||
          !(route as { extensions: string[] }).extensions.some((extension) => formats.has(extension))
      )
    ]
  };
});

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../core/fixtures-grouped-media.pptx'
);
const sampleDeckPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../apps/demo/public/samples/sample-deck.pptx'
);

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

class MockIntersectionObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}

  observe(target: Element): void {
    this.callback(
      [
        {
          isIntersecting: true,
          intersectionRatio: 1,
          target
        } as IntersectionObserverEntry
      ],
      this as unknown as IntersectionObserver
    );
  }

  disconnect(): void {}
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: MockResizeObserver,
    configurable: true
  });
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    value: MockIntersectionObserver,
    configurable: true
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    value: vi.fn(),
    configurable: true
  });
  Object.defineProperty(globalThis.URL, 'createObjectURL', {
    value: vi.fn(() => 'blob:fixture'),
    configurable: true
  });
  Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
    value: vi.fn(),
    configurable: true
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('PptxPreview', () => {
  it('renders and emits events for a local fixture source', async () => {
    const bytes = await readFile(fixturePath);
    const wrapper = mount(PptxPreview, {
      attachTo: document.body,
      props: {
        src: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        fit: 'none'
      }
    });

    await waitFor(() => {
      expect(wrapper.emitted('rendered')).toBeTruthy();
      expect(wrapper.emitted('warnings')).toBeTruthy();
      expect(wrapper.findAll('.pptxv-thumb-button').length).toBeGreaterThan(0);
    });
    expect(wrapper.findAll('button[disabled]').length).toBeGreaterThan(0);

    await wrapper.setProps({
      src: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    wrapper.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('shows an error overlay and emits error for unsupported sources', async () => {
    const wrapper = mount(PptxPreview, {
      attachTo: document.body,
      props: {
        src: 42 as never,
        fit: 'contain'
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(wrapper.emitted('error')).toBeTruthy();
    expect(wrapper.find('.pptxv-overlay.is-error').text()).toContain('Unsupported PPTX source type');

    wrapper.unmount();
  });

  it('supports keyboard slide navigation when the shell is focused', async () => {
    const bytes = await readFile(sampleDeckPath);
    const wrapper = mount(PptxPreview, {
      attachTo: document.body,
      props: {
        src: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        fit: 'none'
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    await wrapper.find('.pptxv-shell').trigger('keydown', { key: 'ArrowRight' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const slideChangeEvents = wrapper.emitted('slide-change') ?? [];
    expect(slideChangeEvents.some(([slideIndex]) => slideIndex === 1)).toBe(true);
    expect(wrapper.find('.pptxv-thumb-button[aria-current="true"]').text()).toContain('2');
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();

    wrapper.unmount();
  });
});

async function waitFor(assertion: () => void, timeout = 1000): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeout) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  assertion();
  throw lastError;
}

function createDxfFixture(): Uint8Array {
  return new TextEncoder().encode(`0
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
FURNITURE
62
3
0
LAYER
2
LABELS
62
5
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
100
21
0
0
LINE
8
WALLS
10
100
20
0
11
100
21
60
0
LINE
8
WALLS
10
100
20
60
11
0
21
60
0
LINE
8
WALLS
10
0
20
60
11
0
21
0
0
CIRCLE
8
FURNITURE
10
35
20
30
40
10
0
TEXT
8
LABELS
7
ARCH
10
15
20
32
40
6
1
Room A
0
ENDSEC
0
EOF`);
}

function createDxfImageFixture(): Uint8Array {
  return new TextEncoder().encode(`0
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
EOF`);
}

function createStlFixture(): Uint8Array {
  return new TextEncoder().encode(`solid preview
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 0 1 0
  endloop
endfacet
endsolid preview`);
}

function createObjFixture(): Uint8Array {
  return new TextEncoder().encode(`v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
vn 0 0 1
f 1//1 2//1 3//1 4//1`);
}

function createPlyFixture(): Uint8Array {
  return new TextEncoder().encode(`ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
element face 1
property list uchar int vertex_indices
end_header
0 0 0
1 0 0
0 1 0
3 0 1 2`);
}

function createGlbFixture(): Uint8Array {
  const json = JSON.stringify({
    asset: {
      version: '2.0'
    },
    scene: 0,
    scenes: [
      {
        nodes: [0]
      }
    ],
    nodes: [
      {
        name: 'Empty GLB Scene'
      }
    ]
  });
  const jsonBytes = new TextEncoder().encode(json);
  const paddedJsonLength = Math.ceil(jsonBytes.byteLength / 4) * 4;
  const totalLength = 12 + 8 + paddedJsonLength;
  const bytes = new Uint8Array(totalLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, paddedJsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(jsonBytes, 20);
  bytes.fill(0x20, 20 + jsonBytes.byteLength, 20 + paddedJsonLength);
  return bytes;
}

function createExternalGltfFixture(): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    asset: {
      version: '2.0'
    },
    scene: 0,
    scenes: [
      {
        nodes: [0]
      }
    ],
    nodes: [
      {
        name: 'External glTF Scene'
      }
    ],
    buffers: [
      {
        uri: 'scene.bin',
        byteLength: 3
      }
    ]
  }));
}

function createMmFixture(): Uint8Array {
  return new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<map version="1.0.1">
  <node ID="root" TEXT="Launch Plan">
    <node ID="research" TEXT="Research"/>
    <node ID="ship" TEXT="Ship">
      <node ID="release-notes" TEXT="Release notes"/>
    </node>
  </node>
</map>`);
}

function createDrawioFixture(): Uint8Array {
  return new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net">
  <diagram id="flow" name="Flow">
    <mxGraphModel>
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="start" value="Start" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="40" y="40" width="120" height="60" as="geometry"/>
        </mxCell>
        <mxCell id="done" value="Done" style="whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="260" y="40" width="120" height="60" as="geometry"/>
        </mxCell>
        <mxCell id="edge-1" value="Next" edge="1" parent="1" source="start" target="done">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`);
}

async function create3mfFixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('3D/3dmodel.model', `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>
          <vertex x="0" y="0" z="0"/>
          <vertex x="1" y="0" z="0"/>
          <vertex x="0" y="1" z="0"/>
        </vertices>
        <triangles>
          <triangle v1="0" v2="1" v3="2"/>
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1"/>
  </build>
</model>`);
  return zip.generateAsync({ type: 'uint8array' });
}

describe('Preview', () => {
  it('renders PPTX through the generic preview runtime', async () => {
    const bytes = await readFile(sampleDeckPath);
    const wrapper = mount(Preview, {
      attachTo: document.body,
      props: {
        src: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        name: 'sample-deck.pptx',
        fit: 'none'
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(wrapper.emitted('rendered')).toBeTruthy();
    expect(wrapper.text()).toContain('1 / 3');
    expect(wrapper.find('.pptxv-slide').exists()).toBe(true);

    await wrapper.find('.pptxv-generic-shell').trigger('keydown', { key: 'ArrowRight' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const pageChangeEvents = wrapper.emitted('page-change') ?? [];
    expect(pageChangeEvents.some(([pageIndex]) => pageIndex === 1)).toBe(true);
    expect(wrapper.text()).toContain('2 / 3');

    wrapper.unmount();
  });

  it('emits an error when no driver is available for the routed format', async () => {
    const wrapper = mount(Preview, {
      attachTo: document.body,
      props: {
        src: new Uint8Array([1, 2, 3]),
        name: 'photo.png',
        drivers: []
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(wrapper.emitted('error')).toBeTruthy();
    expect(wrapper.find('.pptxv-overlay.is-error').text()).toContain('No preview driver registered for image');

    wrapper.unmount();
  });

  it('renders text through the generic preview runtime', async () => {
    const wrapper = mount(Preview, {
      attachTo: document.body,
      props: {
        src: new TextEncoder().encode('hello from generic preview'),
        name: 'notes.txt'
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(wrapper.emitted('rendered')).toBeTruthy();
    expect(wrapper.text()).toContain('text');
    expect(wrapper.find('pre.pptxv-native-text').text()).toBe('hello from generic preview');

    wrapper.unmount();
  });

  it('rotates images through the generic preview toolbar', async () => {
    const wrapper = mount(Preview, {
      attachTo: document.body,
      props: {
        src: new Uint8Array([1, 2, 3]),
        name: 'photo.png',
        contentType: 'image/png'
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const image = wrapper.find('img.pptxv-native-image');
    expect(image.exists()).toBe(true);
    (image.element as HTMLImageElement).dispatchEvent(new Event('load'));
    await waitFor(() => {
      expect(wrapper.emitted('rendered')).toBeTruthy();
    });
    await nextTick();

    const rotateButton = wrapper.findAll('button').find((button) => button.text() === 'Rotate');
    expect(rotateButton).toBeTruthy();
    expect((rotateButton?.element as HTMLButtonElement | undefined)?.disabled).toBe(false);
    await rotateButton?.trigger('click');
    await nextTick();

    expect((image.element as HTMLImageElement).style.transform).toBe('translate(0px, 0px) rotate(90deg) scale(1)');

    const heightButton = wrapper.findAll('button').find((button) => button.text() === 'Height');
    expect(heightButton).toBeTruthy();
    expect((heightButton?.element as HTMLButtonElement | undefined)?.disabled).toBe(false);
    await heightButton?.trigger('click');
    await nextTick();
    expect((image.element as HTMLImageElement).style.maxWidth).toBe('none');
    expect((image.element as HTMLImageElement).style.maxHeight).toBe('100%');

    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const root = wrapper.find('.pptxv-native-preview').element as HTMLElement;
    Object.defineProperty(root, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen
    });
    const fullscreenButton = wrapper.findAll('button').find((button) => button.text() === 'Full');
    expect(fullscreenButton).toBeTruthy();
    expect((fullscreenButton?.element as HTMLButtonElement | undefined)?.disabled).toBe(false);
    await fullscreenButton?.trigger('click');
    expect(requestFullscreen).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it('renders HTML through the generic preview runtime', async () => {
    const wrapper = mount(Preview, {
      attachTo: document.body,
      props: {
        src: '<html><body>Inline HTML</body></html>',
        name: 'inline.html',
        contentType: 'text/html'
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const frame = wrapper.find('iframe.pptxv-native-html-frame');
    expect(frame.exists()).toBe(true);
    await frame.trigger('load');

    expect(wrapper.emitted('rendered')).toBeTruthy();
    expect(wrapper.text()).toContain('html');

    wrapper.unmount();
  });

  it('renders PDF through the generic preview runtime', async () => {
    const wrapper = mount(Preview, {
      attachTo: document.body,
      props: {
        src: new Uint8Array([37, 80, 68, 70]),
        name: 'sample.pdf',
        contentType: 'application/pdf'
      }
    });

    await waitFor(() => {
      expect(wrapper.emitted('rendered')).toBeTruthy();
      expect(wrapper.find('canvas.pdfv-page').exists()).toBe(true);
    });
    expect(wrapper.text()).toContain('1 / 1');

    wrapper.unmount();
  });

  it('renders XLSX through the generic preview runtime', async () => {
    const wrapper = mount(Preview, {
      attachTo: document.body,
      props: {
        src: await createWorkbookFixture(),
        name: 'sample.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }
    });

    await waitFor(() => {
      expect(wrapper.emitted('rendered')).toBeTruthy();
      expect(wrapper.find('.xlsxv-table').exists()).toBe(true);
    });

    expect(wrapper.text()).toContain('Summary 1 / 2');
    expect(wrapper.find('.xlsxv-table').text()).toContain('Name');
    expect(wrapper.find('.xlsxv-table').text()).toContain('42');

    await wrapper.find('.pptxv-generic-shell').trigger('keydown', { key: 'ArrowRight' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const sheetChangeEvents = wrapper.emitted('sheet-change') ?? [];
    expect(sheetChangeEvents.some(([sheetIndex]) => sheetIndex === 1)).toBe(true);
    expect(wrapper.text()).toContain('Data 2 / 2');
    expect(wrapper.find('.xlsxv-table').text()).toContain('TRUE');

    wrapper.unmount();
  });

  it('renders CSV through the generic preview runtime', async () => {
    const wrapper = mount(Preview, {
      attachTo: document.body,
      props: {
        src: new TextEncoder().encode('Name,Revenue\nAlice,42'),
        name: 'sales.csv',
        contentType: 'text/csv'
      }
    });

    await waitFor(() => {
      expect(wrapper.emitted('rendered')).toBeTruthy();
      expect(wrapper.find('.xlsxv-table').exists()).toBe(true);
    });

    expect(wrapper.text()).toContain('sales 1 / 1');
    expect(wrapper.find('.xlsxv-table').text()).toContain('Alice');
    expect(wrapper.find('.xlsxv-table').text()).toContain('42');

    wrapper.unmount();
  });

  it('renders DXF CAD drawings through the generic preview runtime', async () => {
    const wrapper = mount(Preview, {
      attachTo: document.body,
      props: {
        src: createDxfFixture(),
        name: 'floorplan.dxf',
        contentType: 'image/vnd.dxf'
      }
    });

    await waitFor(() => {
      expect(wrapper.emitted('rendered')).toBeTruthy();
      expect(wrapper.find('svg.cadv-canvas').exists()).toBe(true);
    });

    expect(wrapper.text()).toContain('cad');
    expect(wrapper.find('svg.cadv-canvas').text()).toContain('Room A');
    expect(wrapper.emitted('warnings')?.[0]?.[0]).toEqual([
      'DXF references SHX font files (romans.shx), which browsers cannot render directly; CSS fallback fonts are used.'
    ]);

    wrapper.unmount();
  });

  it('controls DXF layers through the generic preview toolbar', async () => {
    const wrapper = mount(Preview, {
      attachTo: document.body,
      props: {
        src: createDxfFixture(),
        name: 'floorplan.dxf',
        contentType: 'image/vnd.dxf'
      }
    });

    await waitFor(() => {
      expect(wrapper.emitted('rendered')).toBeTruthy();
      expect(wrapper.find('.pptxv-layer-menu').exists()).toBe(true);
      expect(wrapper.find('svg.cadv-canvas line[data-layer="WALLS"]').exists()).toBe(true);
    });

    expect(wrapper.find('.pptxv-layer-summary').text()).toContain('3 / 3');
    const wallsCheckbox = wrapper.findAll('.pptxv-layer-row').find((row) => row.text().includes('WALLS'))?.find('input');
    expect(wallsCheckbox?.exists()).toBe(true);
    await wallsCheckbox?.setValue(false);
    await nextTick();

    const wall = wrapper.find('svg.cadv-canvas line[data-layer="WALLS"]');
    expect(wall.attributes('display')).toBe('none');
    expect(wrapper.find('.pptxv-layer-summary').text()).toContain('2 / 3');

    await wallsCheckbox?.setValue(true);
    await nextTick();
    expect(wall.attributes('display')).toBeUndefined();
    expect(wrapper.find('.pptxv-layer-summary').text()).toContain('3 / 3');

    wrapper.unmount();
  });

  it('passes fontResolver through to the DXF CAD driver', async () => {
    const wrapper = mount(Preview, {
      attachTo: document.body,
      props: {
        src: createDxfFixture(),
        name: 'floorplan.dxf',
        contentType: 'image/vnd.dxf',
        fontResolver: ({ fontFile }) => fontFile === 'romans.shx' ? 'Romans CAD' : undefined
      }
    });

    await waitFor(() => {
      expect(wrapper.emitted('rendered')).toBeTruthy();
      expect(wrapper.find('svg.cadv-canvas text').exists()).toBe(true);
    });

    expect(wrapper.find('svg.cadv-canvas text').attributes('font-family')).toContain('Romans CAD');
    expect(wrapper.emitted('warnings')).toBeUndefined();

    wrapper.unmount();
  });

  it('passes resourceResolver through to the DXF CAD driver', async () => {
    const wrapper = mount(Preview, {
      attachTo: document.body,
      props: {
        src: createDxfImageFixture(),
        name: 'floorplan-image.dxf',
        contentType: 'image/vnd.dxf',
        resourceResolver: ({ source, relation }) =>
          relation === 'image' && source === 'textures\\site-plan.png' ? 'data:image/png;base64,iVBORw0KGgo=' : undefined
      }
    });

    await waitFor(() => {
      expect(wrapper.emitted('rendered')).toBeTruthy();
      expect(wrapper.find('svg.cadv-canvas image[data-image-source]').exists()).toBe(true);
    });

    expect(wrapper.find('svg.cadv-canvas image').attributes('href')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(wrapper.emitted('warnings')).toBeUndefined();

    wrapper.unmount();
  });

  it('renders STL models through the generic preview runtime', async () => {
    const wrapper = mount(Preview, {
      attachTo: document.body,
      props: {
        src: createStlFixture(),
        name: 'part.stl',
        contentType: 'model/stl'
      }
    });

    await waitFor(() => {
      expect(wrapper.emitted('rendered')).toBeTruthy();
      expect(wrapper.find('canvas.model3dv-canvas').exists()).toBe(true);
    });

    expect(wrapper.text()).toContain('model3d');
    const zoomIn = wrapper.findAll('button').find((button) => button.text() === '+');
    expect((zoomIn?.element as HTMLButtonElement | undefined)?.disabled).toBe(false);

    wrapper.unmount();
  });

  it('renders OBJ models through the generic preview runtime', async () => {
    const wrapper = mount(Preview, {
      attachTo: document.body,
      props: {
        src: createObjFixture(),
        name: 'part.obj',
        contentType: 'model/obj'
      }
    });

    await waitFor(() => {
      expect(wrapper.emitted('rendered')).toBeTruthy();
      expect(wrapper.find('canvas.model3dv-canvas').exists()).toBe(true);
    });

    expect(wrapper.text()).toContain('model3d');

    wrapper.unmount();
  });

  it('renders PLY models through the generic preview runtime', async () => {
    const wrapper = mount(Preview, {
      attachTo: document.body,
      props: {
        src: createPlyFixture(),
        name: 'part.ply',
        contentType: 'model/ply'
      }
    });

    await waitFor(() => {
      expect(wrapper.emitted('rendered')).toBeTruthy();
      expect(wrapper.find('canvas.model3dv-canvas').exists()).toBe(true);
    });

    expect(wrapper.text()).toContain('model3d');

    wrapper.unmount();
  });

  it('renders GLB models through the generic preview runtime', async () => {
    const wrapper = mount(Preview, {
      attachTo: document.body,
      props: {
        src: createGlbFixture(),
        name: 'part.glb',
        contentType: 'model/gltf-binary'
      }
    });

    await waitFor(() => {
      expect(wrapper.emitted('rendered')).toBeTruthy();
      expect(wrapper.find('canvas.model3dv-canvas').exists()).toBe(true);
    });

    expect(wrapper.text()).toContain('model3d');

    wrapper.unmount();
  });

  it('passes resourceResolver through to the glTF model driver', async () => {
    const wrapper = mount(Preview, {
      attachTo: document.body,
      props: {
        src: createExternalGltfFixture(),
        name: 'part.gltf',
        contentType: 'model/gltf+json',
        resourceResolver: ({ source, relation }) =>
          source === 'scene.bin' && relation === 'buffer' ? new Uint8Array([0, 0, 0]) : undefined
      }
    });

    await waitFor(() => {
      expect(wrapper.emitted('rendered')).toBeTruthy();
      expect(wrapper.find('canvas.model3dv-canvas').exists()).toBe(true);
    });

    expect(wrapper.text()).toContain('model3d');
    expect(wrapper.emitted('warnings')).toBeUndefined();

    wrapper.unmount();
  });

  it('renders 3MF models through the generic preview runtime', async () => {
    const wrapper = mount(Preview, {
      attachTo: document.body,
      props: {
        src: await create3mfFixture(),
        name: 'part.3mf',
        contentType: 'model/3mf'
      }
    });

    await waitFor(() => {
      expect(wrapper.emitted('rendered')).toBeTruthy();
      expect(wrapper.find('canvas.model3dv-canvas').exists()).toBe(true);
    });

    expect(wrapper.text()).toContain('model3d');

    wrapper.unmount();
  });

  it('renders FreeMind mind maps through the generic preview runtime', async () => {
    const wrapper = mount(Preview, {
      attachTo: document.body,
      props: {
        src: createMmFixture(),
        name: 'plan.mm',
        contentType: 'application/xml'
      }
    });

    await waitFor(() => {
      expect(wrapper.emitted('rendered')).toBeTruthy();
      expect(wrapper.find('svg.mindmapv-canvas').exists()).toBe(true);
    });

    expect(wrapper.text()).toContain('mindmap');
    expect(wrapper.find('.mindmapv-summary').text()).toBe('4 nodes');
    expect(wrapper.find('svg.mindmapv-canvas').text()).toContain('Launch Plan');

    wrapper.unmount();
  });

  it('renders draw.io diagrams through the generic preview runtime', async () => {
    const wrapper = mount(Preview, {
      attachTo: document.body,
      props: {
        src: createDrawioFixture(),
        name: 'flow.drawio',
        contentType: 'application/xml'
      }
    });

    await waitFor(() => {
      expect(wrapper.emitted('rendered')).toBeTruthy();
      expect(wrapper.find('svg.diagramv-canvas').exists()).toBe(true);
    });

    expect(wrapper.text()).toContain('Page 1 / 1');
    expect(wrapper.find('.diagramv-summary').text()).toContain('Flow');
    expect(wrapper.find('svg.diagramv-canvas').text()).toContain('Start');

    wrapper.unmount();
  });

  it('renders ZIP archives through the generic preview runtime', async () => {
    const wrapper = mount(Preview, {
      attachTo: document.body,
      props: {
        src: await createArchiveFixture(),
        name: 'sample.zip',
        contentType: 'application/zip'
      }
    });

    await waitFor(() => {
      expect(wrapper.emitted('rendered')).toBeTruthy();
      expect(wrapper.find('.archivev-table').exists()).toBe(true);
    });

    expect(wrapper.text()).toContain('archive');
    expect(wrapper.find('.archivev-table').text()).toContain('docs/');

    const docsRow = wrapper.findAll('tr.archivev-row').find((row) => row.text().includes('docs/'));
    await docsRow?.trigger('click');

    await waitFor(() => {
      expect(wrapper.find('.archivev-table').text()).toContain('readme.txt');
    });

    wrapper.unmount();
  });

  it('renders EPUB books through the generic preview runtime', async () => {
    const wrapper = mount(Preview, {
      attachTo: document.body,
      props: {
        src: await createEpubFixture(),
        name: 'book.epub',
        contentType: 'application/epub+zip'
      }
    });

    await waitFor(() => {
      expect(wrapper.emitted('rendered')).toBeTruthy();
      expect(wrapper.find('.ebookv-frame').exists()).toBe(true);
    });

    expect(wrapper.text()).toContain('Chapter One 1 / 2');
    expect((wrapper.find('iframe.ebookv-frame').element as HTMLIFrameElement).srcdoc).toContain('Chapter One');

    await wrapper.find('.pptxv-generic-shell').trigger('keydown', { key: 'ArrowRight' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(wrapper.text()).toContain('Chapter Two 2 / 2');
    expect((wrapper.find('iframe.ebookv-frame').element as HTMLIFrameElement).srcdoc).toContain('Chapter Two');

    wrapper.unmount();
  });

  it('passes resourceResolver through to the EPUB driver', async () => {
    const wrapper = mount(Preview, {
      attachTo: document.body,
      props: {
        src: await createExternalAssetEpubFixture(),
        name: 'external.epub',
        contentType: 'application/epub+zip',
        resourceResolver: ({ source, relation }) =>
          source === 'OPS/images/cover.png' && relation === 'resource' ? new Uint8Array([137, 80, 78, 71]) : undefined
      }
    });

    await waitFor(() => {
      expect(wrapper.emitted('rendered')).toBeTruthy();
      expect(wrapper.find('.ebookv-frame').exists()).toBe(true);
    });

    expect((wrapper.find('iframe.ebookv-frame').element as HTMLIFrameElement).srcdoc).toContain(
      'src="data:image/png;base64,iVBORw=="'
    );

    wrapper.unmount();
  });

  it('renders CBZ comics through the generic preview runtime', async () => {
    const wrapper = mount(Preview, {
      attachTo: document.body,
      props: {
        src: await createCbzFixture(),
        name: 'comic.cbz',
        contentType: 'application/vnd.comicbook+zip'
      }
    });

    await waitFor(() => {
      expect(wrapper.emitted('rendered')).toBeTruthy();
      expect(wrapper.find('.ebookv-frame').exists()).toBe(true);
    });

    expect(wrapper.text()).toContain('Page 1 1 / 2');
    expect((wrapper.find('iframe.ebookv-frame').element as HTMLIFrameElement).srcdoc).toContain('blob:fixture');

    await wrapper.find('.pptxv-generic-shell').trigger('keydown', { key: 'ArrowRight' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(wrapper.text()).toContain('Page 2 2 / 2');

    wrapper.unmount();
  });
});

async function createWorkbookFixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    'xl/workbook.xml',
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Data" sheetId="2" r:id="rId2"/></sheets>
</workbook>`
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>`
  );
  zip.file(
    'xl/sharedStrings.xml',
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Name</t></si></sst>`
  );
  zip.file(
    'xl/worksheets/sheet1.xml',
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>42</v></c></row></sheetData>
</worksheet>`
  );
  zip.file(
    'xl/worksheets/sheet2.xml',
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData><row r="1"><c r="A1" t="b"><v>1</v></c></row></sheetData>
</worksheet>`
  );
  return zip.generateAsync({
    type: 'uint8array'
  });
}

async function createArchiveFixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('docs/readme.txt', 'Archive preview');
  zip.file('image.png', new Uint8Array([137, 80, 78, 71]));
  return zip.generateAsync({
    type: 'uint8array'
  });
}

async function createEpubFixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );
  zip.file(
    'OPS/package.opf',
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Fixture Book</dc:title></metadata>
  <manifest>
    <item id="chapter-1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter-2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="chapter-1"/><itemref idref="chapter-2"/></spine>
</package>`
  );
  zip.file('OPS/chapter1.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter One</title></head><body><h1>Chapter One</h1></body></html>');
  zip.file('OPS/chapter2.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter Two</title></head><body><h1>Chapter Two</h1></body></html>');
  return zip.generateAsync({
    type: 'uint8array'
  });
}

async function createExternalAssetEpubFixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );
  zip.file(
    'OPS/package.opf',
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>External Asset Book</dc:title></metadata>
  <manifest>
    <item id="chapter-1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="chapter-1"/></spine>
</package>`
  );
  zip.file(
    'OPS/chapter1.xhtml',
    '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>External Asset</title></head><body><h1>External Asset</h1><img src="images/cover.png"/></body></html>'
  );
  return zip.generateAsync({
    type: 'uint8array'
  });
}

async function createCbzFixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('page-1.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>');
  zip.file('page-2.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="blue"/></svg>');
  return zip.generateAsync({
    type: 'uint8array'
  });
}
