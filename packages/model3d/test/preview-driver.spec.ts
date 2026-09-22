import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Bone, BufferGeometry, Float32BufferAttribute, Group, LineSegments, Mesh, MeshStandardMaterial, Points, Skeleton, Texture, Vector3 } from 'three';
import JSZip from 'jszip';
import {
  createModel3dPreviewDriver,
  createModel3dPreviewRoutes,
  listExternalGltfResources,
  listObjMaterialLibraries,
  load3dsObject,
  load3dsObjectWithWarnings,
  loadAmfObject,
  loadBvhObject,
  loadColladaObject,
  loadColladaObjectWithWarnings,
  loadFbxObject,
  loadFbxObjectWithWarnings,
  loadGCodeObject,
  loadKmzObject,
  loadLDrawObject,
  loadLDrawObjectWithWarnings,
  loadLwoObject,
  loadLwoObjectWithWarnings,
  loadMd2Object,
  loadNrrdObject,
  resolveNhdrBuffer,
  load3mfGeometry,
  load3mfGeometryWithWarnings,
  loadGltfObject,
  loadGltfObjectWithWarnings,
  loadObjGeometry,
  loadObjObject,
  loadObjObjectWithWarnings,
  loadPcdObject,
  loadPdbObject,
  loadPlyGeometry,
  loadStlGeometry,
  loadStepObject,
  loadUsdzObject,
  loadVoxObject,
  loadVtkObject,
  loadVrmlObjectWithWarnings,
  loadVrmlObject,
  loadXyzObject
} from '../src';

const { MockWebGLRenderer, amfParseMock, bvhParseMock, colladaParseMock, fbxParseMock, gcodeParseMock, gltfParseAsyncMock, kmzParseMock, ldrawParseMock, lwoParseMock, md2ParseMock, nrrdParseMock, objParseMock, objSetMaterialsMock, mtlParseMock, materialsPreloadMock, occtFactoryMock, occtReadStepFileMock, pcdParseMock, pdbParseMock, tdsParseMock, usdzParseMock, voxParseMock, vrmlParseMock, vtkParseMock, xyzParseMock } = vi.hoisted(() => ({
  amfParseMock: vi.fn(),
  bvhParseMock: vi.fn(),
  colladaParseMock: vi.fn(),
  fbxParseMock: vi.fn(),
  gcodeParseMock: vi.fn(),
  gltfParseAsyncMock: vi.fn(),
  kmzParseMock: vi.fn(),
  ldrawParseMock: vi.fn(),
  lwoParseMock: vi.fn(),
  md2ParseMock: vi.fn(),
  nrrdParseMock: vi.fn(),
  objParseMock: vi.fn(),
  objSetMaterialsMock: vi.fn(),
  mtlParseMock: vi.fn(),
  materialsPreloadMock: vi.fn(),
  occtFactoryMock: vi.fn(),
  occtReadStepFileMock: vi.fn(),
  pcdParseMock: vi.fn(),
  pdbParseMock: vi.fn(),
  tdsParseMock: vi.fn(),
  usdzParseMock: vi.fn(),
  voxParseMock: vi.fn(),
  vrmlParseMock: vi.fn(),
  vtkParseMock: vi.fn(),
  xyzParseMock: vi.fn(),
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

vi.mock('occt-import-js', () => ({
  default: occtFactoryMock
}));

vi.mock('occt-import-js/dist/occt-import-js.wasm?url', () => ({
  default: '/assets/occt-import-js.wasm'
}));

vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    parseAsync = gltfParseAsyncMock;
  }
}));

vi.mock('three/examples/jsm/loaders/AMFLoader.js', () => ({
  AMFLoader: class {
    parse = amfParseMock;
  }
}));

vi.mock('three/examples/jsm/loaders/BVHLoader.js', () => ({
  BVHLoader: class {
    parse = bvhParseMock;
  }
}));

vi.mock('three/examples/jsm/loaders/ColladaLoader.js', () => ({
  ColladaLoader: class {
    constructor(private readonly manager?: { resolveURL?: (url: string) => string }) {}
    parse = (source: string, resourcePath: string) => colladaParseMock(source, resourcePath, this.manager);
  }
}));

vi.mock('three/examples/jsm/loaders/FBXLoader.js', () => ({
  FBXLoader: class {
    constructor(private readonly manager?: { resolveURL?: (url: string) => string }) {}
    parse = (source: ArrayBuffer, resourcePath: string) => fbxParseMock(source, resourcePath, this.manager);
  }
}));

vi.mock('three/examples/jsm/loaders/GCodeLoader.js', () => ({
  GCodeLoader: class {
    parse = gcodeParseMock;
  }
}));

vi.mock('three/examples/jsm/loaders/KMZLoader.js', () => ({
  KMZLoader: class {
    parse = kmzParseMock;
  }
}));

vi.mock('three/examples/jsm/loaders/LDrawLoader.js', () => ({
  LDrawLoader: class {
    setConditionalLineMaterial = vi.fn();
    setMaterials = vi.fn();
    setFileMap = vi.fn();
    setPartsLibraryPath = vi.fn();
    parse = ldrawParseMock;
  }
}));

vi.mock('three/examples/jsm/loaders/LWOLoader.js', () => ({
  LWOLoader: class {
    constructor(private readonly manager?: { resolveURL?: (url: string) => string }) {}
    parse = (source: ArrayBuffer, resourcePath: string, modelName: string) => lwoParseMock(source, resourcePath, modelName, this.manager);
  }
}));

vi.mock('three/examples/jsm/loaders/MD2Loader.js', () => ({
  MD2Loader: class {
    parse = md2ParseMock;
  }
}));

vi.mock('three/examples/jsm/loaders/TDSLoader.js', () => ({
  TDSLoader: class {
    constructor(private readonly manager?: { resolveURL?: (url: string) => string }) {}
    parse = (source: ArrayBuffer, resourcePath: string) => tdsParseMock(source, resourcePath, this.manager);
  }
}));

vi.mock('three/examples/jsm/loaders/USDZLoader.js', () => ({
  USDZLoader: class {
    parse = usdzParseMock;
  }
}));

vi.mock('three/examples/jsm/loaders/VRMLLoader.js', () => ({
  VRMLLoader: class {
    constructor(private readonly manager?: { resolveURL?: (url: string) => string }) {}
    parse = (source: string, resourcePath: string) => vrmlParseMock(source, resourcePath, this.manager);
  }
}));

vi.mock('three/examples/jsm/loaders/PCDLoader.js', () => ({
  PCDLoader: class {
    parse = pcdParseMock;
  }
}));

vi.mock('three/examples/jsm/loaders/PDBLoader.js', () => ({
  PDBLoader: class {
    parse = pdbParseMock;
  }
}));

vi.mock('three/examples/jsm/loaders/VTKLoader.js', () => ({
  VTKLoader: class {
    parse = vtkParseMock;
  }
}));

vi.mock('three/examples/jsm/loaders/VOXLoader.js', async () => {
  const actual = await vi.importActual<typeof import('three/examples/jsm/loaders/VOXLoader.js')>('three/examples/jsm/loaders/VOXLoader.js');
  return {
    ...actual,
    VOXLoader: class {
      parse = voxParseMock;
    }
  };
});

vi.mock('three/examples/jsm/loaders/XYZLoader.js', () => ({
  XYZLoader: class {
    parse = xyzParseMock;
  }
}));

vi.mock('three/examples/jsm/loaders/OBJLoader.js', () => ({
  OBJLoader: class {
    setMaterials = objSetMaterialsMock;
    parse = objParseMock;
  }
}));

vi.mock('three/examples/jsm/loaders/MTLLoader.js', () => ({
  MTLLoader: class {
    parse = mtlParseMock;
  }
}));

vi.mock('three/examples/jsm/loaders/NRRDLoader.js', () => ({
  NRRDLoader: class {
    parse = nrrdParseMock;
  }
}));

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: MockResizeObserver,
    configurable: true
  });
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
    window.setTimeout(() => callback(0), 0);
    return 1;
  });
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);
  gltfParseAsyncMock.mockReset();
  gltfParseAsyncMock.mockImplementation(async () => ({
    scene: new Group()
  }));
  objParseMock.mockReset();
  objParseMock.mockImplementation(() => new Group());
  objSetMaterialsMock.mockReset();
  mtlParseMock.mockReset();
  mtlParseMock.mockImplementation(() => ({
    preload: materialsPreloadMock
  }));
  materialsPreloadMock.mockReset();
  materialsPreloadMock.mockImplementation(() => undefined);
  occtReadStepFileMock.mockReset();
  occtFactoryMock.mockReset();
  occtFactoryMock.mockResolvedValue({ ReadStepFile: occtReadStepFileMock });
  amfParseMock.mockReset();
  amfParseMock.mockImplementation(() => new Group());
  bvhParseMock.mockReset();
  bvhParseMock.mockImplementation(() => {
    const root = new Bone();
    const child = new Bone();
    child.position.set(0, 1, 0);
    root.add(child);
    return { skeleton: new Skeleton([root, child]), clip: { tracks: [] } };
  });
  colladaParseMock.mockReset();
  colladaParseMock.mockImplementation((_: string, __: string, manager?: { resolveURL?: (url: string) => string }) => {
    manager?.resolveURL?.('diffuse.png');
    return { scene: new Group(), animations: [], kinematics: {} };
  });
  fbxParseMock.mockReset();
  fbxParseMock.mockImplementation((_: ArrayBuffer, __: string, manager?: { resolveURL?: (url: string) => string }) => {
    manager?.resolveURL?.('diffuse.png');
    return new Group();
  });
  gcodeParseMock.mockReset();
  gcodeParseMock.mockImplementation(() => new Group());
  kmzParseMock.mockReset();
  kmzParseMock.mockImplementation(() => ({ scene: new Group(), animations: [], kinematics: {} }));
  ldrawParseMock.mockReset();
  ldrawParseMock.mockImplementation((_: string, onLoad: (group: Group) => void) => onLoad(new Group()));
  lwoParseMock.mockReset();
  lwoParseMock.mockImplementation((_: ArrayBuffer, __: string, ___: string, manager?: { resolveURL?: (url: string) => string }) => {
    manager?.resolveURL?.('diffuse.png');
    return { meshes: [new Mesh(new BufferGeometry())], materials: [] };
  });
  md2ParseMock.mockReset();
  md2ParseMock.mockImplementation(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0
    ], 3));
    return geometry;
  });
  nrrdParseMock.mockReset();
  nrrdParseMock.mockImplementation(() => ({
    xLength: 2,
    yLength: 2,
    zLength: 2,
    data: new Uint8Array([0, 0, 255, 0, 255, 0, 128, 0]),
    spacing: [1, 1, 1],
    computeMinMax: () => [0, 255]
  }));
  tdsParseMock.mockReset();
  tdsParseMock.mockImplementation((_: ArrayBuffer, __: string, manager?: { resolveURL?: (url: string) => string }) => {
    manager?.resolveURL?.('diffuse.png');
    return new Group();
  });
  usdzParseMock.mockReset();
  usdzParseMock.mockImplementation(async () => new Group());
  voxParseMock.mockReset();
  voxParseMock.mockImplementation(() => [
    {
      palette: [0, 0xffffffff],
      size: { x: 1, y: 1, z: 1 },
      data: new Uint8Array([0, 0, 0, 1])
    }
  ]);
  vrmlParseMock.mockReset();
  vrmlParseMock.mockImplementation((_: string, __: string, manager?: { resolveURL?: (url: string) => string }) => {
    manager?.resolveURL?.('diffuse.png');
    return new Group();
  });
  pcdParseMock.mockReset();
  pcdParseMock.mockImplementation(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3));
    return new Points(geometry);
  });
  pdbParseMock.mockReset();
  pdbParseMock.mockImplementation(() => {
    const geometryAtoms = new BufferGeometry();
    geometryAtoms.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3));
    geometryAtoms.setAttribute('color', new Float32BufferAttribute([1, 1, 1], 3));
    const geometryBonds = new BufferGeometry();
    geometryBonds.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3));
    return {
      geometryAtoms,
      geometryBonds,
      json: { atoms: [[0, 0, 0]] }
    };
  });
  vtkParseMock.mockReset();
  vtkParseMock.mockImplementation(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0
    ], 3));
    return geometry;
  });
  xyzParseMock.mockReset();
  xyzParseMock.mockImplementation(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3));
    return geometry;
  });
});

describe('model3d preview driver', () => {
  it('parses ASCII STL geometry', () => {
    const geometry = loadStlGeometry(new TextEncoder().encode(createAsciiStlFixture()).buffer);

    expect(geometry.triangleCount).toBe(1);
    expect(Array.from(geometry.positions.slice(0, 9))).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(Array.from(geometry.normals.slice(0, 3))).toEqual([0, 0, 1]);
    expect(geometry.bounds).toEqual({
      min: [0, 0, 0],
      max: [1, 1, 0]
    });
  });

  it('parses binary STL geometry', () => {
    const geometry = loadStlGeometry(createBinaryStlFixture());

    expect(geometry.triangleCount).toBe(1);
    expect(Array.from(geometry.positions.slice(0, 9))).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(Array.from(geometry.normals.slice(0, 3))).toEqual([0, 0, 1]);
  });

  it('parses OBJ geometry and triangulates polygon faces', () => {
    const geometry = loadObjGeometry(createObjFixture());

    expect(geometry.triangleCount).toBe(2);
    expect(Array.from(geometry.positions.slice(0, 9))).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0]);
    expect(Array.from(geometry.positions.slice(9, 18))).toEqual([0, 0, 0, 1, 1, 0, 0, 1, 0]);
    expect(Array.from(geometry.normals.slice(0, 3))).toEqual([0, 0, 1]);
    expect(geometry.bounds).toEqual({
      min: [0, 0, 0],
      max: [1, 1, 0]
    });
  });

  it('parses OBJ vertex colors', () => {
    const geometry = loadObjGeometry([
      'v 0 0 0 255 0 0',
      'v 1 0 0 0 255 0',
      'v 0 1 0 0 0 255',
      'f 1 2 3'
    ].join('\n'));

    expect(Array.from(geometry.colors?.slice(0, 9) ?? [])).toEqual([
      1, 0, 0,
      0, 1, 0,
      0, 0, 1
    ]);
  });

  it('detects OBJ material libraries', () => {
    expect(listObjMaterialLibraries('mtllib materials/base.mtl extra.mtl\nusemtl base')).toEqual([
      'materials/base.mtl',
      'extra.mtl'
    ]);
  });

  it('loads OBJ materials and textures through the resource resolver', async () => {
    const resourceResolver = vi.fn(({ source, relation }) => {
      if (source === 'models/materials/base.mtl' && relation === 'material') {
        return new TextEncoder().encode('newmtl base\nmap_Kd textures/diffuse.png\n');
      }
      if (source === 'models/materials/textures/diffuse.png' && relation === 'texture') {
        return new Uint8Array([137, 80, 78, 71]);
      }
      return undefined;
    });

    await expect(loadObjObject('mtllib materials/base.mtl\nusemtl base\nv 0 0 0\n', {
      resourceBasePath: 'models/scene.obj',
      resourceResolver,
      sourceFormat: 'obj'
    })).resolves.toBeInstanceOf(Group);

    expect(resourceResolver).toHaveBeenCalledWith(expect.objectContaining({
      family: 'model3d',
      sourceFormat: 'obj',
      source: 'models/materials/base.mtl',
      relation: 'material',
      name: 'base.mtl'
    }));
    expect(resourceResolver).toHaveBeenCalledWith(expect.objectContaining({
      source: 'models/materials/textures/diffuse.png',
      relation: 'texture',
      name: 'diffuse.png'
    }));
    expect(mtlParseMock).toHaveBeenCalledWith(
      expect.stringContaining('map_Kd data:image/png;base64,iVBORw=='),
      ''
    );
    expect(materialsPreloadMock).toHaveBeenCalled();
    expect(objSetMaterialsMock).toHaveBeenCalled();
    expect(objParseMock).toHaveBeenCalledWith(expect.stringContaining('mtllib materials/base.mtl'));
  });

  it('returns OBJ resource resolver warnings', async () => {
    const result = await loadObjObjectWithWarnings('mtllib materials/base.mtl\nusemtl base\nv 0 0 0\n', {
      resourceBasePath: 'models/scene.obj',
      resourceResolver: ({ relation }) => relation === 'material'
        ? {
            source: new TextEncoder().encode('newmtl base\n'),
            warnings: ['OBJ material used fallback MTL source.']
          }
        : undefined,
      sourceFormat: 'obj'
    });

    expect(result.object).toBeInstanceOf(Group);
    expect(result.warnings).toContain('OBJ material used fallback MTL source.');
  });

  it('reports unresolved OBJ material and texture resources as warnings', async () => {
    const result = await loadObjObjectWithWarnings('mtllib materials/base.mtl\nusemtl base\nv 0 0 0\n', {
      resourceBasePath: 'models/scene.obj',
      resourceResolver: ({ relation }) => relation === 'material'
        ? new TextEncoder().encode('newmtl base\nmap_Kd textures/diffuse.png\n')
        : undefined,
      sourceFormat: 'obj'
    });

    expect(result.object).toBeInstanceOf(Group);
    expect(result.warnings).toContain('OBJ texture "textures/diffuse.png" could not be resolved; the material map was left unchanged.');
  });

  it('reports unresolved OBJ material libraries as warnings', async () => {
    const result = await loadObjObjectWithWarnings('mtllib materials/missing.mtl\nusemtl base\nv 0 0 0\n', {
      resourceBasePath: 'models/scene.obj',
      resourceResolver: () => undefined,
      sourceFormat: 'obj'
    });

    expect(result.object).toBeInstanceOf(Group);
    expect(result.warnings).toContain('OBJ material library "materials/missing.mtl" could not be resolved; materials were skipped.');
  });

  it('parses ASCII PLY geometry and triangulates polygon faces', () => {
    const geometry = loadPlyGeometry(new TextEncoder().encode(createAsciiPlyFixture()).buffer);

    expect(geometry.triangleCount).toBe(2);
    expect(Array.from(geometry.positions.slice(0, 9))).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0]);
    expect(geometry.bounds).toEqual({
      min: [0, 0, 0],
      max: [1, 1, 0]
    });
  });

  it('parses ASCII PLY vertex colors', () => {
    const geometry = loadPlyGeometry(new TextEncoder().encode(createAsciiColoredPlyFixture()).buffer);

    expect(Array.from(geometry.colors?.slice(0, 9) ?? [])).toEqual([
      1, 0, 0,
      0, 1, 0,
      0, 0, 1
    ]);
  });

  it('parses binary little-endian PLY geometry', () => {
    const geometry = loadPlyGeometry(createBinaryPlyFixture());

    expect(geometry.triangleCount).toBe(1);
    expect(Array.from(geometry.positions.slice(0, 9))).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });

  it('parses binary little-endian PLY vertex colors', () => {
    const geometry = loadPlyGeometry(createBinaryColoredPlyFixture());

    expect(Array.from(geometry.colors?.slice(0, 9) ?? [])).toEqual([
      1, 0, 0,
      0, 1, 0,
      0, 0, 1
    ]);
  });

  it('parses 3MF geometry and build transforms', async () => {
    const geometry = await load3mfGeometry(await create3mfFixture());

    expect(geometry.triangleCount).toBe(1);
    expect(Array.from(geometry.positions.slice(0, 9))).toEqual([10, 20, 30, 11, 20, 30, 10, 21, 30]);
    expect(geometry.bounds).toEqual({
      min: [10, 20, 30],
      max: [11, 21, 30]
    });
  });

  it('parses 3MF component object transforms', async () => {
    const geometry = await load3mfGeometry(await createComponent3mfFixture());

    expect(geometry.triangleCount).toBe(1);
    expect(Array.from(geometry.positions.slice(0, 9))).toEqual([11, 22, 30, 12, 22, 30, 11, 23, 30]);
    expect(geometry.bounds).toEqual({
      min: [11, 22, 30],
      max: [12, 23, 30]
    });
  });

  it('parses 3MF meshes stored in external model parts', async () => {
    const geometry = await load3mfGeometry(await createExternalObject3mfFixture());

    expect(geometry.triangleCount).toBe(1);
    expect(Array.from(geometry.positions.slice(0, 9))).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });

  it('parses 3MF base material colors into geometry vertex colors', async () => {
    const geometry = await load3mfGeometry(await createColored3mfFixture());

    expect(Array.from(geometry.colors?.slice(0, 9) ?? [])).toEqual([
      1, 0, 0,
      1, 0, 0,
      1, 0, 0
    ]);
  });

  it('parses 3MF triangle vertex material colors', async () => {
    const geometry = await load3mfGeometry(await createTriangleColored3mfFixture());

    expect(Array.from(geometry.colors?.slice(0, 9) ?? [])).toEqual([
      1, 0, 0,
      0, 1, 0,
      0, 0, 1
    ]);
  });

  it('parses 3MF color group triangle colors', async () => {
    const geometry = await load3mfGeometry(await createColorGroup3mfFixture());

    expect(Array.from(geometry.colors?.slice(0, 9) ?? [])).toEqual([
      1, 1, 0,
      0, 1, 1,
      1, 0, 1
    ]);
  });

  it('returns 3MF unsupported material warnings', async () => {
    const result = await load3mfGeometryWithWarnings(await createTextured3mfFixture());

    expect(result.geometry.triangleCount).toBe(1);
    expect(result.warnings).toContain('3MF texture2d resource "8" is not rendered directly yet; base-material colors remain supported.');
    expect(result.warnings).toContain('3MF texture2dgroup resource "9" is not rendered directly yet; base-material colors remain supported.');
    expect(result.warnings).toContain('3MF material resource "9" is not a supported color palette; fallback vertex colors were used.');
  });

  it('loads STEP assemblies through the OpenCascade WASM importer', async () => {
    occtReadStepFileMock.mockReturnValue({
      success: true,
      root: {
        name: 'Assembly',
        meshes: [0],
        children: [{ name: 'Empty part', meshes: [], children: [] }]
      },
      meshes: [{
        name: 'Bracket',
        color: [0.2, 0.4, 0.6],
        attributes: {
          position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
          normal: { array: [0, 0, 1, 0, 0, 1, 0, 0, 1] }
        },
        index: { array: [0, 1, 2] }
      }]
    });

    const object = await loadStepObject(new Uint8Array([1, 2, 3]).buffer);
    const mesh = object.children[0] as Mesh;

    expect(object.name).toBe('Assembly');
    expect(mesh.name).toBe('Bracket');
    expect(Array.from(mesh.geometry.getAttribute('position').array)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(mesh.geometry.getIndex()?.array).toEqual(new Uint16Array([0, 1, 2]));
    expect(occtReadStepFileMock).toHaveBeenCalledWith(expect.any(Uint8Array), { linearUnit: 'millimeter' });
  });

  it('exposes direct STEP/STP/STL/OBJ/PLY/glTF/GLB/3MF/AMF/DAE/FBX/3DS/USDZ/G-code/VRML/PCD/XYZ/VTK/VOX/LDraw/KMZ/MD2/LWO/BVH/PDB/NRRD/NHDR routes and driver support', () => {
    const routes = createModel3dPreviewRoutes();
    const route = routes.find((item) => item.extensions.includes('step') && item.extensions.includes('stp') && item.extensions.includes('stl') && item.extensions.includes('obj') && item.extensions.includes('ply') && item.extensions.includes('gltf') && item.extensions.includes('glb') && item.extensions.includes('3mf') && item.extensions.includes('amf') && item.extensions.includes('dae') && item.extensions.includes('fbx') && item.extensions.includes('3ds') && item.extensions.includes('usdz') && item.extensions.includes('gcode') && item.extensions.includes('wrl') && item.extensions.includes('vrml') && item.extensions.includes('pcd') && item.extensions.includes('xyz') && item.extensions.includes('vtk') && item.extensions.includes('vox') && item.extensions.includes('ldr') && item.extensions.includes('mpd') && item.extensions.includes('kmz') && item.extensions.includes('md2') && item.extensions.includes('lwo') && item.extensions.includes('bvh') && item.extensions.includes('pdb') && item.extensions.includes('nrrd') && item.extensions.includes('nhdr'));

    expect(route).toMatchObject({
      family: 'model3d',
      driverId: 'model3d',
      targetFormat: 'model3d'
    });
    expect(route?.conversion).toBeUndefined();

    const driver = createModel3dPreviewDriver();
    expect(driver.supports('step')).toBe(true);
    expect(driver.supports('.STP')).toBe(true);
    expect(driver.supports('stl')).toBe(true);
    expect(driver.supports('.STL')).toBe(true);
    expect(driver.supports('obj')).toBe(true);
    expect(driver.supports('ply')).toBe(true);
    expect(driver.supports('gltf')).toBe(true);
    expect(driver.supports('glb')).toBe(true);
    expect(driver.supports('3mf')).toBe(true);
    expect(driver.supports('amf')).toBe(true);
    expect(driver.supports('dae')).toBe(true);
    expect(driver.supports('fbx')).toBe(true);
    expect(driver.supports('3ds')).toBe(true);
    expect(driver.supports('usdz')).toBe(true);
    expect(driver.supports('gcode')).toBe(true);
    expect(driver.supports('gco')).toBe(true);
    expect(driver.supports('nc')).toBe(true);
    expect(driver.supports('wrl')).toBe(true);
    expect(driver.supports('vrml')).toBe(true);
    expect(driver.supports('pcd')).toBe(true);
    expect(driver.supports('xyz')).toBe(true);
    expect(driver.supports('vtk')).toBe(true);
    expect(driver.supports('vox')).toBe(true);
    expect(driver.supports('ldr')).toBe(true);
    expect(driver.supports('mpd')).toBe(true);
    expect(driver.supports('kmz')).toBe(true);
    expect(driver.supports('md2')).toBe(true);
    expect(driver.supports('lwo')).toBe(true);
    expect(driver.supports('bvh')).toBe(true);
    expect(driver.supports('pdb')).toBe(true);
    expect(driver.supports('nrrd')).toBe(true);
    expect(driver.supports('nhdr')).toBe(true);
    expect(driver.supports('iges')).toBe(false);
  });

  it('loads AMF objects through the Three.js loader', () => {
    expect(loadAmfObject(new Uint8Array([60, 97, 109, 102, 62]).buffer)).toBeInstanceOf(Group);
    expect(amfParseMock).toHaveBeenCalledWith(expect.any(ArrayBuffer));
  });

  it('loads Collada DAE objects through the Three.js loader', () => {
    expect(loadColladaObject('<COLLADA></COLLADA>', 'models/')).toBeInstanceOf(Group);
    expect(colladaParseMock).toHaveBeenCalledWith('<COLLADA></COLLADA>', 'models/', expect.any(Object));
  });

  it('returns Collada texture resolver warnings for missing sidecar textures', () => {
    const result = loadColladaObjectWithWarnings('<COLLADA></COLLADA>', {
      resourceBasePath: 'models/scene.dae',
      resourcePath: 'models/',
      resourceResolver: () => undefined,
      sourceFormat: 'dae'
    });

    expect(result.object).toBeInstanceOf(Group);
    expect(result.warnings).toContain('Collada texture "diffuse.png" could not be resolved; default loader lookup was used.');
  });

  it('loads KMZ objects through the Three.js loader', () => {
    const buffer = new Uint8Array([0x50, 0x4b]).buffer;

    expect(loadKmzObject(buffer)).toBeInstanceOf(Group);
    expect(kmzParseMock).toHaveBeenCalledWith(buffer);
  });

  it('loads MD2 meshes through the Three.js loader', () => {
    const buffer = new Uint8Array([0x49, 0x44, 0x50, 0x32]).buffer;

    expect(loadMd2Object(buffer)).toBeInstanceOf(Mesh);
    expect(md2ParseMock).toHaveBeenCalledWith(buffer);
  });

  it('loads LWO meshes through the Three.js loader', () => {
    const buffer = new Uint8Array([0x46, 0x4f, 0x52, 0x4d]).buffer;

    expect(loadLwoObject(buffer, 'models/', 'character')).toBeInstanceOf(Group);
    expect(lwoParseMock).toHaveBeenCalledWith(buffer, 'models/', 'character', expect.any(Object));
  });

  it('returns LWO texture resolver warnings for missing sidecar textures', () => {
    const buffer = new Uint8Array([0x46, 0x4f, 0x52, 0x4d]).buffer;

    const result = loadLwoObjectWithWarnings(buffer, {
      resourceBasePath: 'models/character.lwo',
      resourcePath: 'models/',
      modelName: 'character',
      resourceResolver: () => undefined,
      sourceFormat: 'lwo'
    });

    expect(result.object).toBeInstanceOf(Group);
    expect(result.warnings).toContain('LWO texture "diffuse.png" could not be resolved; default loader lookup was used.');
  });

  it('loads BVH skeletons through the Three.js loader', () => {
    const source = 'HIERARCHY\nROOT Hips\n';

    expect(loadBvhObject(source)).toBeInstanceOf(Group);
    expect(bvhParseMock).toHaveBeenCalledWith(source);
  });

  it('loads PDB molecules through the Three.js loader', () => {
    const source = 'ATOM      1  C   GLY A   1       0.000   0.000   0.000\n';

    const result = loadPdbObject(source);
    expect(result).toBeInstanceOf(Group);
    expect(result.children[0]).toBeInstanceOf(Points);
    expect(result.children[1]).toBeInstanceOf(LineSegments);
    expect(pdbParseMock).toHaveBeenCalledWith(source);
  });

  it('loads NRRD voxel volumes as point clouds', () => {
    const buffer = new Uint8Array([0x4e, 0x52, 0x52, 0x44]).buffer;

    expect(loadNrrdObject(buffer)).toBeInstanceOf(Points);
    expect(nrrdParseMock).toHaveBeenCalledWith(buffer);
  });

  it('resolves NHDR detached data files through the resource resolver', async () => {
    const result = await resolveNhdrBuffer(
      'NRRD0005\ntype: uchar\ndimension: 3\nsizes: 2 2 2\ndata file: volume.raw\n',
      {
        resourceBasePath: 'scan/brain.nhdr',
        resourceResolver: ({ source, relation }) =>
          source === 'scan/volume.raw' && relation === 'volume'
            ? new Uint8Array([0, 0, 255, 0, 255, 0, 128, 0])
            : undefined,
        sourceFormat: 'nhdr'
      }
    );

    const text = new TextDecoder().decode(result.slice(0, 80));
    expect(text).toContain('encoding: raw');
    expect(text).not.toContain('data file:');
  });

  it('loads FBX objects through the Three.js loader', () => {
    const buffer = new Uint8Array([70, 66, 88]).buffer;

    expect(loadFbxObject(buffer, 'models/')).toBeInstanceOf(Group);
    expect(fbxParseMock).toHaveBeenCalledWith(buffer, 'models/', expect.any(Object));
  });

  it('returns FBX texture resolver warnings for missing sidecar textures', () => {
    const buffer = new Uint8Array([70, 66, 88]).buffer;

    const result = loadFbxObjectWithWarnings(buffer, {
      resourceBasePath: 'models/scene.fbx',
      resourcePath: 'models/',
      resourceResolver: () => undefined,
      sourceFormat: 'fbx'
    });

    expect(result.object).toBeInstanceOf(Group);
    expect(result.warnings).toContain('FBX texture "diffuse.png" could not be resolved; default loader lookup was used.');
  });

  it('loads 3DS objects through the Three.js loader', () => {
    const buffer = new Uint8Array([0x4d, 0x4d]).buffer;

    expect(load3dsObject(buffer, 'models/')).toBeInstanceOf(Group);
    expect(tdsParseMock).toHaveBeenCalledWith(buffer, 'models/', expect.any(Object));
  });

  it('returns 3DS texture resolver warnings for missing sidecar textures', () => {
    const buffer = new Uint8Array([0x4d, 0x4d]).buffer;

    const result = load3dsObjectWithWarnings(buffer, {
      resourceBasePath: 'models/scene.3ds',
      resourcePath: 'models/',
      resourceResolver: () => undefined,
      sourceFormat: '3ds'
    });

    expect(result.object).toBeInstanceOf(Group);
    expect(result.warnings).toContain('3DS texture "diffuse.png" could not be resolved; default loader lookup was used.');
  });

  it('loads USDZ objects through the Three.js loader', async () => {
    const buffer = new Uint8Array([0x50, 0x4b]).buffer;

    await expect(loadUsdzObject(buffer)).resolves.toBeInstanceOf(Group);
    expect(usdzParseMock).toHaveBeenCalledWith(buffer);
  });

  it('loads G-code objects through the Three.js loader', () => {
    const source = 'G90\nG1 X1 Y2 Z0.2 E0.1\n';

    expect(loadGCodeObject(source)).toBeInstanceOf(Group);
    expect(gcodeParseMock).toHaveBeenCalledWith(source);
  });

  it('loads VRML objects through the Three.js loader', () => {
    const source = '#VRML V2.0 utf8\n';

    expect(loadVrmlObject(source, 'models/')).toBeInstanceOf(Group);
    expect(vrmlParseMock).toHaveBeenCalledWith(source, 'models/', expect.any(Object));
  });

  it('returns VRML texture resolver warnings for missing sidecar textures', () => {
    const source = '#VRML V2.0 utf8\n';

    const result = loadVrmlObjectWithWarnings(source, {
      resourceBasePath: 'models/scene.wrl',
      resourcePath: 'models/',
      resourceResolver: () => undefined,
      sourceFormat: 'vrml'
    });

    expect(result.object).toBeInstanceOf(Group);
    expect(result.warnings).toContain('VRML texture "diffuse.png" could not be resolved; default loader lookup was used.');
  });

  it('loads PCD point clouds through the Three.js loader', () => {
    const buffer = new Uint8Array([80, 67, 68]).buffer;

    expect(loadPcdObject(buffer)).toBeInstanceOf(Points);
    expect(pcdParseMock).toHaveBeenCalledWith(buffer);
  });

  it('loads XYZ point clouds as Points objects', () => {
    const source = '0 0 0\n';

    expect(loadXyzObject(source)).toBeInstanceOf(Points);
    expect(xyzParseMock).toHaveBeenCalledWith(source);
  });

  it('pads short VTK meshes for the Three.js loader header probe', () => {
    const buffer = new TextEncoder().encode('# vtk DataFile Version 3.0\n').buffer;

    expect(loadVtkObject(buffer)).toBeInstanceOf(Mesh);
    const loaderBuffer = vtkParseMock.mock.calls[0]?.[0] as ArrayBuffer;
    expect(loaderBuffer.byteLength).toBe(250);
    expect(new Uint8Array(loaderBuffer).slice(0, buffer.byteLength)).toEqual(new Uint8Array(buffer));
    expect(vtkParseMock).toHaveBeenCalledWith(loaderBuffer, '');
  });

  it('loads VOX scenes through the Three.js loader', () => {
    const buffer = createVoxFixture();

    expect(loadVoxObject(buffer)).toBeInstanceOf(Group);
    expect(voxParseMock).toHaveBeenCalledWith(buffer);
  });

  it('loads LDraw models through the Three.js loader wrapper', async () => {
    const source = '0 FILE main.ldr\n0 Main model\n';

    await expect(loadLDrawObject(source)).resolves.toBeInstanceOf(Group);
    expect(ldrawParseMock).toHaveBeenCalled();
  });

  it('returns LDraw resolver warnings for missing sidecar parts', async () => {
    const result = await loadLDrawObjectWithWarnings(
      '1 16 0 0 0 1 0 0 0 1 0 0 0 1 parts/brick.dat\n',
      {
        resourceBasePath: 'models/main.ldr',
        resourceResolver: () => undefined,
        sourceFormat: 'ldr'
      }
    );

    expect(result.object).toBeInstanceOf(Group);
    expect(result.warnings).toContain('LDraw part "parts/brick.dat" could not be resolved; dependent geometry may be missing.');
  });

  it('detects unsupported external glTF resources', async () => {
    const embedded = createGltfFixture();
    const external = {
      asset: { version: '2.0' },
      buffers: [{ uri: 'mesh.bin', byteLength: 24 }],
      images: [{ uri: 'textures/base.png' }, { bufferView: 0 }]
    };

    expect(listExternalGltfResources(embedded)).toEqual([]);
    expect(listExternalGltfResources(external)).toEqual(['mesh.bin', 'textures/base.png']);
    await expect(loadGltfObject(JSON.stringify(external))).rejects.toThrow('glTF references external resources');
  });

  it('allows external glTF resources when a resource path is provided', async () => {
    const external = {
      asset: { version: '2.0' },
      buffers: [{ uri: 'mesh.bin', byteLength: 24 }]
    };

    await expect(loadGltfObject(JSON.stringify(external), {
      resourcePath: 'https://example.test/models/'
    })).resolves.toBeInstanceOf(Group);
    expect(gltfParseAsyncMock).toHaveBeenCalledWith(JSON.stringify(external), 'https://example.test/models/');
  });

  it('resolves external glTF resources through the resource resolver', async () => {
    const external = {
      asset: { version: '2.0' },
      buffers: [{ uri: 'mesh.bin', byteLength: 3 }],
      images: [{ uri: 'textures/base.png' }]
    };
    const resourceResolver = vi.fn(({ source, relation }) => {
      if (source === 'mesh.bin' && relation === 'buffer') {
        return new Uint8Array([0, 0, 0]);
      }
      if (source === 'textures/base.png' && relation === 'image') {
        return 'data:image/png;base64,iVBORw0KGgo=';
      }
      return undefined;
    });

    await expect(loadGltfObject(JSON.stringify(external), {
      resourceResolver,
      sourceFormat: 'gltf'
    })).resolves.toBeInstanceOf(Group);

    expect(resourceResolver).toHaveBeenCalledWith(expect.objectContaining({
      family: 'model3d',
      sourceFormat: 'gltf',
      source: 'mesh.bin',
      relation: 'buffer',
      name: 'mesh.bin'
    }));
    expect(resourceResolver).toHaveBeenCalledWith(expect.objectContaining({
      source: 'textures/base.png',
      relation: 'image',
      name: 'base.png'
    }));
    const parsed = JSON.parse(gltfParseAsyncMock.mock.calls.at(-1)?.[0] as string);
    expect(parsed.buffers[0].uri).toBe('data:application/octet-stream;base64,AAAA');
    expect(parsed.images[0].uri).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(gltfParseAsyncMock.mock.calls.at(-1)?.[1]).toBe('');
  });

  it('returns glTF resource resolver warnings', async () => {
    const external = {
      asset: { version: '2.0' },
      buffers: [{ uri: 'mesh.bin', byteLength: 3 }]
    };

    const result = await loadGltfObjectWithWarnings(JSON.stringify(external), {
      resourceResolver: () => ({
        source: new Uint8Array([0, 0, 0]),
        warnings: ['glTF buffer came from uploaded sidecar set.']
      }),
      sourceFormat: 'gltf'
    });

    expect(result.object).toBeInstanceOf(Group);
    expect(result.warnings).toContain('glTF buffer came from uploaded sidecar set.');
  });

  it('renders STL sources through the preview session', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });
    const rendered = vi.fn();
    session.on('rendered', rendered);

    await session.load(new TextEncoder().encode(createAsciiStlFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'part.stl',
        extension: 'stl'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('stl'))
    });

    expect(rendered).toHaveBeenCalledTimes(1);
    expect(session.getState()).toMatchObject({
      family: 'model3d',
      loading: false,
      scale: 1,
      metadata: {
        format: 'stl',
        triangleCount: 1,
        vertexCount: 3,
        hasVertexColors: false
      },
      capabilities: {
        zoom: true,
        orbit: true,
        fullscreen: true
      }
    });
    expect(container.querySelector('canvas.model3dv-canvas')).toBeTruthy();

    session.setScale?.(1.4);
    session.pan?.(12, -8);
    expect(session.getState().scale).toBe(1.4);
    expect(session.getState().camera?.position.length).toBe(3);

    session.destroy();
    container.remove();
  });

  it('renders OBJ sources through the preview session', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(createObjFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'part.obj',
        extension: 'obj'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('obj'))
    });

    expect(session.getState()).toMatchObject({
      family: 'model3d',
      loading: false,
      capabilities: {
        orbit: true
      }
    });
    expect(container.querySelector('canvas.model3dv-canvas')).toBeTruthy();

    session.destroy();
    container.remove();
  });

  it('renders PLY sources through the preview session', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(createAsciiPlyFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'part.ply',
        extension: 'ply'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('ply'))
    });

    expect(session.getState()).toMatchObject({
      family: 'model3d',
      loading: false,
      capabilities: {
        orbit: true
      }
    });
    expect(container.querySelector('canvas.model3dv-canvas')).toBeTruthy();

    session.destroy();
    container.remove();
  });

  it('renders GLB sources through the preview session', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new Uint8Array([0x67, 0x6c, 0x54, 0x46]), {
      descriptor: {
        source: new Uint8Array(),
        name: 'part.glb',
        extension: 'glb'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('glb'))
    });

    expect(session.getState()).toMatchObject({
      family: 'model3d',
      loading: false,
      capabilities: {
        orbit: true
      }
    });
    expect(container.querySelector('canvas.model3dv-canvas')).toBeTruthy();

    session.destroy();
    container.remove();
  });

  it('renders AMF sources through the preview session', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode('<amf unit="millimeter"></amf>'), {
      descriptor: {
        source: new Uint8Array(),
        name: 'part.amf',
        extension: 'amf'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('amf'))
    });

    expect(session.getState()).toMatchObject({
      family: 'model3d',
      loading: false,
      capabilities: {
        orbit: true
      }
    });
    expect(amfParseMock).toHaveBeenCalled();
    expect(container.querySelector('canvas.model3dv-canvas')).toBeTruthy();

    session.destroy();
    container.remove();
  });

  it('renders Collada DAE sources through the preview session', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode('<COLLADA></COLLADA>'), {
      descriptor: {
        source: new Uint8Array(),
        name: 'scene.dae',
        extension: 'dae'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('dae'))
    });

    expect(session.getState()).toMatchObject({
      family: 'model3d',
      loading: false,
      capabilities: {
        orbit: true
      }
    });
    expect(colladaParseMock).toHaveBeenCalledWith('<COLLADA></COLLADA>', '', expect.any(Object));
    expect(container.querySelector('canvas.model3dv-canvas')).toBeTruthy();

    session.destroy();
    container.remove();
  });

  it('renders FBX sources through the preview session', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new Uint8Array([70, 66, 88]), {
      descriptor: {
        source: new Uint8Array(),
        name: 'scene.fbx',
        extension: 'fbx'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('fbx'))
    });

    expect(session.getState()).toMatchObject({
      family: 'model3d',
      loading: false,
      capabilities: {
        orbit: true
      }
    });
    expect(fbxParseMock).toHaveBeenCalledWith(expect.any(ArrayBuffer), '', expect.any(Object));
    expect(container.querySelector('canvas.model3dv-canvas')).toBeTruthy();

    session.destroy();
    container.remove();
  });

  it('renders 3DS sources through the preview session', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new Uint8Array([0x4d, 0x4d]), {
      descriptor: {
        source: new Uint8Array(),
        name: 'scene.3ds',
        extension: '3ds'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('3ds'))
    });

    expect(session.getState()).toMatchObject({
      family: 'model3d',
      loading: false,
      capabilities: {
        orbit: true
      }
    });
    expect(tdsParseMock).toHaveBeenCalledWith(expect.any(ArrayBuffer), '', expect.any(Object));
    expect(container.querySelector('canvas.model3dv-canvas')).toBeTruthy();

    session.destroy();
    container.remove();
  });

  it('renders USDZ sources through the preview session', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new Uint8Array([0x50, 0x4b]), {
      descriptor: {
        source: new Uint8Array(),
        name: 'scene.usdz',
        extension: 'usdz'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('usdz'))
    });

    expect(session.getState()).toMatchObject({
      family: 'model3d',
      loading: false,
      capabilities: {
        orbit: true
      }
    });
    expect(usdzParseMock).toHaveBeenCalledWith(expect.any(ArrayBuffer));
    expect(container.querySelector('canvas.model3dv-canvas')).toBeTruthy();

    session.destroy();
    container.remove();
  });

  it('renders G-code sources through the preview session', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode('G90\nG1 X1 Y2 Z0.2 E0.1\n'), {
      descriptor: {
        source: new Uint8Array(),
        name: 'toolpath.gcode',
        extension: 'gcode'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('gcode'))
    });

    expect(session.getState()).toMatchObject({
      family: 'model3d',
      loading: false,
      capabilities: {
        orbit: true
      }
    });
    expect(gcodeParseMock).toHaveBeenCalledWith('G90\nG1 X1 Y2 Z0.2 E0.1\n');
    expect(container.querySelector('canvas.model3dv-canvas')).toBeTruthy();

    session.destroy();
    container.remove();
  });

  it('renders VRML sources through the preview session', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode('#VRML V2.0 utf8\n'), {
      descriptor: {
        source: new Uint8Array(),
        name: 'scene.wrl',
        extension: 'wrl'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('wrl'))
    });

    expect(session.getState()).toMatchObject({
      family: 'model3d',
      loading: false,
      capabilities: {
        orbit: true
      }
    });
    expect(vrmlParseMock).toHaveBeenCalledWith('#VRML V2.0 utf8\n', '', expect.any(Object));
    expect(container.querySelector('canvas.model3dv-canvas')).toBeTruthy();

    session.destroy();
    container.remove();
  });

  it('renders PCD sources through the preview session', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new Uint8Array([80, 67, 68]), {
      descriptor: {
        source: new Uint8Array(),
        name: 'scan.pcd',
        extension: 'pcd'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('pcd'))
    });

    expect(session.getState()).toMatchObject({
      family: 'model3d',
      loading: false,
      capabilities: {
        orbit: true
      }
    });
    expect(pcdParseMock).toHaveBeenCalledWith(expect.any(ArrayBuffer));
    expect(container.querySelector('canvas.model3dv-canvas')).toBeTruthy();

    session.destroy();
    container.remove();
  });

  it('renders XYZ sources through the preview session', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode('0 0 0\n'), {
      descriptor: {
        source: new Uint8Array(),
        name: 'scan.xyz',
        extension: 'xyz'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('xyz'))
    });

    expect(session.getState()).toMatchObject({
      family: 'model3d',
      loading: false,
      capabilities: {
        orbit: true
      }
    });
    expect(xyzParseMock).toHaveBeenCalledWith('0 0 0\n');
    expect(container.querySelector('canvas.model3dv-canvas')).toBeTruthy();

    session.destroy();
    container.remove();
  });

  it('renders VTK sources through the preview session', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode('# vtk DataFile Version 3.0\n'), {
      descriptor: {
        source: new Uint8Array(),
        name: 'mesh.vtk',
        extension: 'vtk'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('vtk'))
    });

    expect(session.getState()).toMatchObject({
      family: 'model3d',
      loading: false,
      capabilities: {
        orbit: true
      }
    });
    expect(vtkParseMock).toHaveBeenCalledWith(expect.any(ArrayBuffer), '');
    expect(container.querySelector('canvas.model3dv-canvas')).toBeTruthy();

    session.destroy();
    container.remove();
  });

  it('renders VOX sources through the preview session', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new Uint8Array(createVoxFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'chunk.vox',
        extension: 'vox'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('vox'))
    });

    expect(session.getState()).toMatchObject({
      family: 'model3d',
      loading: false,
      capabilities: {
        orbit: true
      }
    });
    expect(voxParseMock).toHaveBeenCalledWith(expect.any(ArrayBuffer));
    expect(container.querySelector('canvas.model3dv-canvas')).toBeTruthy();

    session.destroy();
    container.remove();
  });

  it('renders LDraw sources through the preview session', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode('0 FILE main.ldr\n0 Main model\n'), {
      descriptor: {
        source: new Uint8Array(),
        name: 'main.ldr',
        extension: 'ldr'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('ldr'))
    });

    expect(session.getState()).toMatchObject({
      family: 'model3d',
      loading: false,
      capabilities: {
        orbit: true
      }
    });
    expect(ldrawParseMock).toHaveBeenCalled();
    expect(container.querySelector('canvas.model3dv-canvas')).toBeTruthy();

    session.destroy();
    container.remove();
  });

  it('renders KMZ sources through the preview session', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new Uint8Array([0x50, 0x4b]), {
      descriptor: {
        source: new Uint8Array(),
        name: 'scene.kmz',
        extension: 'kmz'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('kmz'))
    });

    expect(session.getState()).toMatchObject({
      family: 'model3d',
      loading: false,
      capabilities: {
        orbit: true
      }
    });
    expect(kmzParseMock).toHaveBeenCalledWith(expect.any(ArrayBuffer));
    expect(container.querySelector('canvas.model3dv-canvas')).toBeTruthy();

    session.destroy();
    container.remove();
  });

  it('renders MD2 sources through the preview session', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new Uint8Array([0x49, 0x44, 0x50, 0x32]), {
      descriptor: {
        source: new Uint8Array(),
        name: 'character.md2',
        extension: 'md2'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('md2'))
    });

    expect(session.getState()).toMatchObject({
      family: 'model3d',
      loading: false,
      capabilities: {
        orbit: true
      }
    });
    expect(md2ParseMock).toHaveBeenCalledWith(expect.any(ArrayBuffer));
    expect(container.querySelector('canvas.model3dv-canvas')).toBeTruthy();

    session.destroy();
    container.remove();
  });

  it('renders LWO sources through the preview session', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new Uint8Array([0x46, 0x4f, 0x52, 0x4d]), {
      descriptor: {
        source: new Uint8Array(),
        name: 'character.lwo',
        extension: 'lwo'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('lwo'))
    });

    expect(session.getState()).toMatchObject({
      family: 'model3d',
      loading: false,
      capabilities: {
        orbit: true
      }
    });
    expect(lwoParseMock).toHaveBeenCalledWith(expect.any(ArrayBuffer), '', 'character', expect.any(Object));
    expect(container.querySelector('canvas.model3dv-canvas')).toBeTruthy();

    session.destroy();
    container.remove();
  });

  it('renders BVH sources through the preview session', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode('HIERARCHY\nROOT Hips\n'), {
      descriptor: {
        source: new Uint8Array(),
        name: 'motion.bvh',
        extension: 'bvh'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('bvh'))
    });

    expect(session.getState()).toMatchObject({
      family: 'model3d',
      loading: false,
      capabilities: {
        orbit: true
      }
    });
    expect(bvhParseMock).toHaveBeenCalledWith('HIERARCHY\nROOT Hips\n');
    expect(container.querySelector('canvas.model3dv-canvas')).toBeTruthy();

    session.destroy();
    container.remove();
  });

  it('renders PDB sources through the preview session', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode('ATOM      1  C   GLY A   1       0.000   0.000   0.000\n'), {
      descriptor: {
        source: new Uint8Array(),
        name: 'molecule.pdb',
        extension: 'pdb'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('pdb'))
    });

    expect(session.getState()).toMatchObject({
      family: 'model3d',
      loading: false,
      modelTree: [
        expect.objectContaining({
          kind: 'points',
          metadata: expect.objectContaining({
            pointCount: 1
          })
        }),
        expect.objectContaining({
          kind: 'lines',
          metadata: expect.objectContaining({
            lineCount: 1
          })
        })
      ],
      metadata: {
        format: 'pdb',
        objectCount: 3,
        pointCount: 1,
        lineCount: 1,
        materialCount: 2
      },
      capabilities: {
        orbit: true
      }
    });
    expect(pdbParseMock).toHaveBeenCalledWith('ATOM      1  C   GLY A   1       0.000   0.000   0.000\n');
    expect(container.querySelector('canvas.model3dv-canvas')).toBeTruthy();

    session.destroy();
    container.remove();
  });

  it('selects model tree nodes through the preview session', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode('ATOM      1  C   GLY A   1       0.000   0.000   0.000\n'), {
      descriptor: {
        source: new Uint8Array(),
        name: 'molecule.pdb',
        extension: 'pdb'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('pdb'))
    });

    const nodeId = session.getState().modelTree?.[0]?.id;
    expect(nodeId).toBeTruthy();
    const beforeModelGroupPosition = (session as unknown as { modelGroup?: Group | null }).modelGroup?.position.clone();

    session.selectNode?.(nodeId);

    expect(session.getState().selectedNodeId).toBe(nodeId);
    const modelGroup = (session as unknown as { modelGroup?: Group | null }).modelGroup;
    expect(modelGroup?.position.equals(beforeModelGroupPosition ?? new Group().position)).toBe(false);
    const visibleStates: boolean[] = [];
    modelGroup?.traverse((object) => {
      if ((object.userData as { previewMeasurementHelper?: boolean }).previewMeasurementHelper) {
        return;
      }
      visibleStates.push(object.visible);
    });
    expect(visibleStates.every(Boolean)).toBe(true);

    session.selectNode?.();
    expect(session.getState().selectedNodeId).toBeUndefined();

    session.destroy();
    container.remove();
  });

  it('toggles model tree node visibility through the preview session', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode('ATOM      1  C   GLY A   1       0.000   0.000   0.000\n'), {
      descriptor: {
        source: new Uint8Array(),
        name: 'molecule.pdb',
        extension: 'pdb'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('pdb'))
    });

    const nodeId = session.getState().modelTree?.[0]?.id;
    expect(nodeId).toBeTruthy();

    session.selectNode?.(nodeId);
    expect(session.getState().selectedNodeId).toBe(nodeId);

    session.setNodeVisibility?.(nodeId!, false);

    expect(session.getState().selectedNodeId).toBeUndefined();
    expect(session.getState().modelTree?.[0]?.visible).toBe(false);
    const modelGroup = (session as unknown as { modelGroup?: Group | null }).modelGroup;
    const targetObject = modelGroup?.children[0]?.children[0];
    expect(targetObject?.visible).toBe(false);

    session.toggleNodeVisibility?.(nodeId!);

    expect(session.getState().modelTree?.[0]?.visible).toBe(true);
    expect(targetObject?.visible).toBe(true);

    session.destroy();
    container.remove();
  });

  it('explodes object-based model trees through the preview session', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode('ATOM      1  C   GLY A   1       0.000   0.000   0.000\n'), {
      descriptor: {
        source: new Uint8Array(),
        name: 'molecule.pdb',
        extension: 'pdb'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('pdb'))
    });

    expect(session.getState().capabilities.explode).toBe(true);
    const modelGroup = (session as unknown as { modelGroup?: Group | null }).modelGroup;
    const targets = modelGroup?.children[0]?.children ?? [];
    const before = targets.map((target) => target.position.toArray());

    session.setExplode?.(0.5);

    expect(session.getState().explode).toBe(0.5);
    const exploded = targets.map((target) => target.position.toArray());
    expect(exploded.some((position, index) =>
      position.some((part, partIndex) => Math.abs(part - before[index]![partIndex]!) > 1e-6)
    )).toBe(true);

    session.setExplode?.(0);

    expect(session.getState().explode).toBe(0);
    expect(targets.map((target) => target.position.toArray())).toEqual(before);

    session.destroy();
    container.remove();
  });

  it('renders NRRD sources through the preview session', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new Uint8Array([0x4e, 0x52, 0x52, 0x44]), {
      descriptor: {
        source: new Uint8Array(),
        name: 'scan.nrrd',
        extension: 'nrrd'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('nrrd'))
    });

    expect(session.getState()).toMatchObject({
      family: 'model3d',
      loading: false,
      capabilities: {
        orbit: true
      }
    });
    expect(nrrdParseMock).toHaveBeenCalledWith(expect.any(ArrayBuffer));
    expect(container.querySelector('canvas.model3dv-canvas')).toBeTruthy();

    session.destroy();
    container.remove();
  });

  it('renders NHDR sources with resource-resolved detached volume data through the preview session', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1,
      resourceResolver: ({ source, relation }) =>
        source === 'medical/scan.raw' && relation === 'volume'
          ? new Uint8Array([0, 0, 255, 0, 255, 0, 128, 0])
          : undefined
    });

    await session.load(
      new TextEncoder().encode('NRRD0005\ntype: uchar\ndimension: 3\nsizes: 2 2 2\ndata file: scan.raw\n'),
      {
        descriptor: {
          source: new Uint8Array(),
          name: 'medical/scan.nhdr',
          extension: 'nhdr'
        },
        route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('nhdr'))
      }
    );

    expect(session.getState()).toMatchObject({
      family: 'model3d',
      loading: false,
      capabilities: {
        orbit: true
      }
    });
    expect(nrrdParseMock).toHaveBeenCalledWith(expect.any(ArrayBuffer));
    expect(container.querySelector('canvas.model3dv-canvas')).toBeTruthy();

    session.destroy();
    container.remove();
  });

  it('renders embedded glTF sources through the preview session', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(JSON.stringify(createGltfFixture())), {
      descriptor: {
        source: new Uint8Array(),
        name: 'part.gltf',
        extension: 'gltf'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('gltf'))
    });

    expect(session.getState()).toMatchObject({
      family: 'model3d',
      loading: false,
      capabilities: {
        orbit: true
      }
    });
    expect(container.querySelector('canvas.model3dv-canvas')).toBeTruthy();

    session.destroy();
    container.remove();
  });

  it('exposes structured material details for object-based previews', async () => {
    gltfParseAsyncMock.mockImplementationOnce(async () => {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0
      ], 3));
      const material = new MeshStandardMaterial({
        color: 0xff8844,
        roughness: 0.35,
        metalness: 0.65,
        transparent: true,
        opacity: 0.75
      });
      material.name = 'Paint';
      material.alphaTest = 0.15;
      material.flatShading = true;
      material.depthWrite = false;
      material.depthTest = true;
      material.map = new Texture();
      material.normalMap = new Texture();
      const mesh = new Mesh(geometry, material);
      const root = new Group();
      root.add(mesh);
      return { scene: root };
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(JSON.stringify(createGltfFixture())), {
      descriptor: {
        source: new Uint8Array(),
        name: 'materials.gltf',
        extension: 'gltf'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('gltf'))
    });

    expect(session.getState().metadata?.materialDetails).toEqual([
      expect.objectContaining({
        name: 'Paint',
        type: 'MeshStandardMaterial',
        color: '#FF8844',
        opacity: 0.75,
        alphaTest: 0.15,
        transparent: true,
        flatShading: true,
        depthWrite: false,
        depthTest: true,
        roughness: 0.35,
        metalness: 0.65,
        mapKinds: ['base', 'normal']
      })
    ]);
    expect(session.getState().modelTree?.[0]?.metadata?.materialDetails).toEqual([
      expect.objectContaining({
        name: 'Paint',
        type: 'MeshStandardMaterial'
      })
    ]);

    session.destroy();
    container.remove();
  });

  it('isolates materials and restores original material state after selection overlays', async () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0
    ], 3));
    const paintMaterial = new MeshStandardMaterial({
      color: 0xff8844,
      transparent: true,
      opacity: 0.75
    });
    paintMaterial.name = 'Paint';
    const steelMaterial = new MeshStandardMaterial({
      color: 0x94a3b8,
      opacity: 1
    });
    steelMaterial.name = 'Steel';
    const paintMesh = new Mesh(geometry, paintMaterial);
    const steelMesh = new Mesh(geometry, steelMaterial);
    steelMesh.position.set(3, 0, 0);
    const root = new Group();
    root.add(paintMesh, steelMesh);

    gltfParseAsyncMock.mockImplementationOnce(async () => ({ scene: root }));

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(JSON.stringify(createGltfFixture())), {
      descriptor: {
        source: new Uint8Array(),
        name: 'filter-materials.gltf',
        extension: 'gltf'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('gltf'))
    });

    const paintKey = session.getState().metadata?.materialDetails?.find((detail) => detail.name === 'Paint')?.key;
    expect(paintKey).toBeTruthy();
    expect(session.getState().capabilities.materialFilter).toBe(true);

    session.setActiveMaterial?.(paintKey);

    expect(session.getState().isolatedMaterialKey).toBe(paintKey);
    expect(paintMesh.visible).toBe(true);
    expect(steelMesh.visible).toBe(false);

    session.selectNode?.('node-2');
    session.selectNode?.(undefined);

    expect(paintMaterial.opacity).toBe(0.75);
    expect(paintMaterial.transparent).toBe(true);

    session.setActiveMaterial?.();

    expect(session.getState().isolatedMaterialKey).toBeUndefined();
    expect(paintMesh.visible).toBe(true);
    expect(steelMesh.visible).toBe(true);

    session.destroy();
    container.remove();
  });

  it('tracks point-to-point measurements in preview state', async () => {
    gltfParseAsyncMock.mockImplementationOnce(async () => {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute([
        0, 0, 0,
        2, 0, 0,
        0, 2, 0
      ], 3));
      const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: 0x60a5fa }));
      const root = new Group();
      root.add(mesh);
      return { scene: root };
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(JSON.stringify(createGltfFixture())), {
      descriptor: {
        source: new Uint8Array(),
        name: 'measure.gltf',
        extension: 'gltf'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('gltf'))
    });

    expect(session.getState().capabilities.measure).toBe(true);

    session.setMeasurementActive?.(true);
    expect(session.getState().measurement).toMatchObject({
      active: true,
      status: 'pick-start',
      snapMode: 'surface',
      axisLock: 'free'
    });

    session.setMeasurementSnapMode?.('vertex');
    session.setMeasurementAxisLock?.('x');
    expect(session.getState().measurement).toMatchObject({
      snapMode: 'vertex',
      axisLock: 'x'
    });

    (session as unknown as { applyMeasurementPoint(point: Vector3): void }).applyMeasurementPoint(new Vector3(1, 1, 1));
    expect(session.getState().measurement).toMatchObject({
      active: true,
      status: 'pick-end',
      start: [1, 1, 1]
    });

    (session as unknown as { applyMeasurementPreviewPoint(point: Vector3): void }).applyMeasurementPreviewPoint(new Vector3(4, 9, 10));
    expect(session.getState().measurement).toMatchObject({
      previewPoint: [4, 1, 1],
      previewDelta: [3, 0, 0],
      previewDistance: 3
    });

    (session as unknown as { applyMeasurementPoint(point: Vector3): void }).applyMeasurementPoint(new Vector3(4, 9, 10));
    expect(session.getState().measurement).toMatchObject({
      active: false,
      status: 'complete',
      snapMode: 'vertex',
      axisLock: 'x',
      start: [1, 1, 1],
      end: [4, 1, 1],
      delta: [3, 0, 0],
      distance: 3
    });

    session.clearMeasurement?.();
    expect(session.getState().measurement).toEqual({
      active: false,
      status: 'idle',
      snapMode: 'vertex',
      axisLock: 'x'
    });

    session.destroy();
    container.remove();
  });

  it('tracks clipping section state and toggles renderer clipping planes', async () => {
    gltfParseAsyncMock.mockImplementationOnce(async () => {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute([
        0, 0, 0,
        2, 0, 0,
        0, 2, 0
      ], 3));
      const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: 0x22c55e }));
      const root = new Group();
      root.add(mesh);
      return { scene: root };
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(JSON.stringify(createGltfFixture())), {
      descriptor: {
        source: new Uint8Array(),
        name: 'section.gltf',
        extension: 'gltf'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('gltf'))
    });

    expect(session.getState().capabilities.section).toBe(true);
    expect(session.getState().section).toMatchObject({
      active: false,
      mode: 'single',
      axis: 'x',
      offset: 0,
      min: -1,
      max: 1,
      range: {
        x: [-1, 1],
        y: [-1, 1],
        z: [0, 0]
      }
    });

    session.setSectionActive?.(true);
    expect(session.getState().section).toMatchObject({
      active: true,
      axis: 'x'
    });
    expect(((session as unknown as { renderer?: { clippingPlanes?: unknown[] } }).renderer?.clippingPlanes ?? [])).toHaveLength(1);
    expect((session as unknown as { sectionPlaneHelper?: { visible?: boolean } }).sectionPlaneHelper?.visible).toBe(true);

    session.setSectionAxis?.('z');
    session.setSectionOffset?.(5);
    expect(session.getState().section).toMatchObject({
      active: true,
      mode: 'single',
      axis: 'z',
      min: 0,
      max: 0,
      offset: 0
    });

    session.setSectionMode?.('box');
    session.setSectionRange?.('x', -0.4, 0.7);
    expect(session.getState().section).toMatchObject({
      active: true,
      mode: 'box',
      range: {
        x: [-0.4, 0.7],
        y: [-1, 1],
        z: [0, 0]
      }
    });
    expect(((session as unknown as { renderer?: { clippingPlanes?: unknown[] } }).renderer?.clippingPlanes ?? [])).toHaveLength(2);
    expect((session as unknown as { sectionPlaneHelper?: { visible?: boolean } }).sectionPlaneHelper?.visible).toBe(false);
    expect((session as unknown as { sectionBoxFill?: { visible?: boolean } }).sectionBoxFill?.visible).toBe(true);
    expect(
      ((session as unknown as {
        sectionBoxFillGeometry?: { getAttribute?: (name: string) => { count?: number } };
      }).sectionBoxFillGeometry?.getAttribute?.('position')?.count) ?? 0
    ).toBe(12);
    expect((session as unknown as { sectionBoxHelper?: { visible?: boolean } }).sectionBoxHelper?.visible).toBe(true);

    session.clearSection?.();
    expect(session.getState().section).toMatchObject({
      active: false,
      mode: 'single',
      axis: 'x',
      offset: 0
    });
    expect(((session as unknown as { renderer?: { clippingPlanes?: unknown[] } }).renderer?.clippingPlanes ?? [])).toHaveLength(0);
    expect((session as unknown as { sectionBoxFill?: { visible?: boolean } }).sectionBoxFill?.visible).toBe(false);
    expect((session as unknown as { sectionBoxHelper?: { visible?: boolean } }).sectionBoxHelper?.visible).toBe(false);

    session.destroy();
    container.remove();
  });

  it('skips redundant section setter work when the requested value is unchanged', async () => {
    gltfParseAsyncMock.mockImplementationOnce(async () => {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute([
        0, 0, 0,
        2, 0, 0,
        0, 2, 0
      ], 3));
      const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: 0x22c55e }));
      const root = new Group();
      root.add(mesh);
      return { scene: root };
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(JSON.stringify(createGltfFixture())), {
      descriptor: {
        source: new Uint8Array(),
        name: 'section-idempotent.gltf',
        extension: 'gltf'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('gltf'))
    });

    const runtimeSession = session as unknown as {
      updateSectionPlanes: () => void;
    };
    const originalUpdateSectionPlanes = runtimeSession.updateSectionPlanes.bind(runtimeSession);
    const updateSectionPlanesSpy = vi.fn(() => originalUpdateSectionPlanes());
    runtimeSession.updateSectionPlanes = updateSectionPlanesSpy;
    const stateChangeSpy = vi.fn();
    session.on('statechange', stateChangeSpy);

    session.setSectionActive?.(false);
    session.setSectionMode?.('single');
    session.setSectionAxis?.('x');
    session.setSectionOffset?.(0);
    session.setSectionRange?.('x', -1, 1);

    expect(updateSectionPlanesSpy).not.toHaveBeenCalled();
    expect(stateChangeSpy).not.toHaveBeenCalled();

    session.setSectionActive?.(true);
    expect(updateSectionPlanesSpy).toHaveBeenCalledTimes(1);
    expect(stateChangeSpy).toHaveBeenCalledTimes(1);

    session.setSectionActive?.(true);
    session.setSectionMode?.('single');
    session.setSectionOffset?.(0);

    expect(updateSectionPlanesSpy).toHaveBeenCalledTimes(1);
    expect(stateChangeSpy).toHaveBeenCalledTimes(1);

    session.destroy();
    container.remove();
  });

  it('skips redundant node selection and section clearing work when state is already unchanged', async () => {
    gltfParseAsyncMock.mockImplementationOnce(async () => {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute([
        0, 0, 0,
        2, 0, 0,
        0, 2, 0
      ], 3));
      const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: 0x22c55e }));
      const root = new Group();
      root.add(mesh);
      return { scene: root };
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(JSON.stringify(createGltfFixture())), {
      descriptor: {
        source: new Uint8Array(),
        name: 'selection-idempotent.gltf',
        extension: 'gltf'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('gltf'))
    });

    const runtimeSession = session as unknown as {
      focusNode: (nodeId?: string) => void;
      updateSectionPlanes: () => void;
    };
    const originalFocusNode = runtimeSession.focusNode.bind(runtimeSession);
    const focusNodeSpy = vi.fn((nodeId?: string) => originalFocusNode(nodeId));
    runtimeSession.focusNode = focusNodeSpy;
    const originalUpdateSectionPlanes = runtimeSession.updateSectionPlanes.bind(runtimeSession);
    const updateSectionPlanesSpy = vi.fn(() => originalUpdateSectionPlanes());
    runtimeSession.updateSectionPlanes = updateSectionPlanesSpy;
    const stateChangeSpy = vi.fn();
    session.on('statechange', stateChangeSpy);

    session.selectNode?.(undefined);
    session.clearSection?.();

    expect(focusNodeSpy).not.toHaveBeenCalled();
    expect(updateSectionPlanesSpy).not.toHaveBeenCalled();
    expect(stateChangeSpy).not.toHaveBeenCalled();

    const nodeId = session.getState().modelTree?.[0]?.id;
    expect(nodeId).toBeTruthy();

    session.selectNode?.(nodeId);
    expect(focusNodeSpy).toHaveBeenCalledTimes(1);
    expect(stateChangeSpy).toHaveBeenCalledTimes(1);

    session.selectNode?.(nodeId);
    expect(focusNodeSpy).toHaveBeenCalledTimes(1);
    expect(stateChangeSpy).toHaveBeenCalledTimes(1);

    session.destroy();
    container.remove();
  });

  it('uses real section intersection segments for geometry-backed previews', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(createObjFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'section-geometry.obj',
        extension: 'obj'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('obj'))
    });

    session.setSectionActive?.(true);

    const outlineVertexCount = (
      (session as unknown as {
        sectionPlaneOutlineGeometry?: { getAttribute?: (name: string) => { count?: number } }
      }).sectionPlaneOutlineGeometry?.getAttribute?.('position')?.count ?? 0
    );

    expect(outlineVertexCount).toBeGreaterThan(0);
    expect(outlineVertexCount).toBeLessThan(8);

    session.destroy();
    container.remove();
  });

  it('samples oversized geometry-backed section helper sources to the helper triangle budget', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(createLargeTriangleSoupObjFixture(15000)), {
      descriptor: {
        source: new Uint8Array(),
        name: 'section-budget.obj',
        extension: 'obj'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('obj'))
    });

    const sampledPositionCount = (
      (session as unknown as {
        sectionSourceGeometry?: { positions?: Float32Array };
      }).sectionSourceGeometry?.positions?.length ?? 0
    );

    expect(sampledPositionCount).toBe(12000 * 9);

    session.destroy();
    container.remove();
  });

  it('caches single-plane section helper results by axis and offset', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(createClosedSectionObjFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'section-cache.obj',
        extension: 'obj'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('obj'))
    });

    session.setSectionActive?.(true);
    session.setSectionAxis?.('z');
    session.setSectionOffset?.(0.5);
    flushSectionHelper(session, 100000);
    const firstCacheSize = (session as unknown as { sectionHelperCache?: Map<string, unknown> }).sectionHelperCache?.size ?? 0;

    session.setSectionOffset?.(0.5);
    flushSectionHelper(session, 100100);
    const repeatedCacheSize = (session as unknown as { sectionHelperCache?: Map<string, unknown> }).sectionHelperCache?.size ?? 0;

    session.setSectionOffset?.(0.25);
    flushSectionHelper(session, 100200);
    const secondOffsetCacheSize = (session as unknown as { sectionHelperCache?: Map<string, unknown> }).sectionHelperCache?.size ?? 0;

    expect(firstCacheSize).toBeGreaterThan(0);
    expect(repeatedCacheSize).toBe(firstCacheSize);
    expect(secondOffsetCacheSize).toBeGreaterThan(repeatedCacheSize);

    session.destroy();
    container.remove();
  });

  it('skips redundant single-plane helper recomputation during repeated render frames', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(createClosedSectionObjFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'section-render-cache.obj',
        extension: 'obj'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('obj'))
    });

    session.setSectionActive?.(true);
    session.setSectionAxis?.('z');
    session.setSectionOffset?.(0.5);

    const runtimeSession = session as unknown as {
      updateSectionHelpers: (section: unknown) => void;
      renderFrame: () => void;
    };
    const originalUpdateSectionHelpers = runtimeSession.updateSectionHelpers.bind(runtimeSession);
    const updateSectionHelpersSpy = vi.fn((section: unknown) => originalUpdateSectionHelpers(section));
    runtimeSession.updateSectionHelpers = updateSectionHelpersSpy;

    runtimeSession.renderFrame();
    runtimeSession.renderFrame();

    expect(updateSectionHelpersSpy).not.toHaveBeenCalled();

    session.destroy();
    container.remove();
  });

  it('updates the single-plane helper mesh immediately but throttles outline and fill recomputation', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(createClosedSectionObjFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'section-throttle.obj',
        extension: 'obj'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('obj'))
    });

    session.setSectionActive?.(true);
    session.setSectionAxis?.('z');
    session.setSectionOffset?.(0.5);
    flushSectionHelper(session, 100000);

    const runtimeSession = session as unknown as {
      appliedSectionHelperKey?: string | null;
      sectionHelperCache?: Map<string, unknown>;
      sectionPlaneHelper?: { position?: { z?: number } };
      sectionPlaneOutline?: { visible?: boolean };
      sectionPlaneFill?: { visible?: boolean };
      renderFrame: () => void;
    };
    const initialHelperKey = runtimeSession.appliedSectionHelperKey;
    const initialCacheSize = runtimeSession.sectionHelperCache?.size ?? 0;
    const nowSpy = vi.spyOn(performance, 'now');

    nowSpy.mockReturnValue(100010);
    session.setSectionOffset?.(0.25);

    expect(runtimeSession.sectionPlaneHelper?.position?.z).toBe(0.25);
    expect(runtimeSession.appliedSectionHelperKey).toBe(initialHelperKey);
    expect(runtimeSession.sectionHelperCache?.size ?? 0).toBe(initialCacheSize);
    expect(runtimeSession.sectionPlaneOutline?.visible).toBe(false);
    expect(runtimeSession.sectionPlaneFill?.visible).toBe(false);

    nowSpy.mockReturnValue(100045);
    runtimeSession.renderFrame();

    expect(runtimeSession.appliedSectionHelperKey).not.toBe(initialHelperKey);
    expect(runtimeSession.sectionHelperCache?.size ?? 0).toBeGreaterThan(initialCacheSize);
    expect(runtimeSession.sectionPlaneOutline?.visible).toBe(true);
    expect(runtimeSession.sectionPlaneFill?.visible).toBe(true);

    nowSpy.mockReturnValue(100050);
    session.setSectionOffset?.(0.5);

    expect(runtimeSession.appliedSectionHelperKey).toBe(initialHelperKey);
    expect(runtimeSession.sectionPlaneOutline?.visible).toBe(true);
    expect(runtimeSession.sectionPlaneFill?.visible).toBe(true);

    nowSpy.mockRestore();
    session.destroy();
    container.remove();
  });

  it('updates box clipping immediately but throttles helper recomputation during rapid range changes', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(createClosedSectionObjFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'section-box-throttle.obj',
        extension: 'obj'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('obj'))
    });

    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(100000);
    session.setSectionActive?.(true);
    session.setSectionMode?.('box');
    session.setSectionRange?.('x', 0.2, 1);

    const runtimeSession = session as unknown as {
      appliedSectionHelperKey?: string | null;
      sectionBoxFill?: { visible?: boolean };
      sectionBoxHelper?: { visible?: boolean };
      renderer?: { clippingPlanes?: Array<{ constant?: number }> };
      renderFrame: () => void;
    };
    const initialHelperKey = runtimeSession.appliedSectionHelperKey;
    const initialClippingConstant = runtimeSession.renderer?.clippingPlanes?.[0]?.constant;

    nowSpy.mockReturnValue(100010);
    session.setSectionRange?.('x', 0.35, 1);

    expect(runtimeSession.renderer?.clippingPlanes?.[0]?.constant).not.toBe(initialClippingConstant);
    expect(runtimeSession.appliedSectionHelperKey).toBe(initialHelperKey);
    expect(runtimeSession.sectionBoxFill?.visible).toBe(false);
    expect(runtimeSession.sectionBoxHelper?.visible).toBe(false);

    nowSpy.mockReturnValue(100045);
    runtimeSession.renderFrame();

    expect(runtimeSession.appliedSectionHelperKey).not.toBe(initialHelperKey);
    expect(runtimeSession.sectionBoxFill?.visible).toBe(true);
    expect(runtimeSession.sectionBoxHelper?.visible).toBe(true);

    nowSpy.mockRestore();
    session.destroy();
    container.remove();
  });

  it('renders a filled section cap for closed geometry-backed cuts', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(createClosedSectionObjFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'section-cap.obj',
        extension: 'obj'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('obj'))
    });

    session.setSectionActive?.(true);
    session.setSectionAxis?.('z');
    session.setSectionOffset?.(0.5);
    flushSectionHelper(session, 100000);

    const fillVisible = (session as unknown as {
      sectionPlaneFill?: { visible?: boolean };
    }).sectionPlaneFill?.visible;
    const fillVertexCount = (
      (session as unknown as {
        sectionPlaneFillGeometry?: { getAttribute?: (name: string) => { count?: number } };
      }).sectionPlaneFillGeometry?.getAttribute?.('position')?.count ?? 0
    );

    expect(fillVisible).toBe(true);
    expect(fillVertexCount).toBeGreaterThanOrEqual(3);

    session.setSectionMode?.('box');
    expect((session as unknown as { sectionPlaneFill?: { visible?: boolean } }).sectionPlaneFill?.visible).toBe(false);

    session.clearSection?.();
    expect((session as unknown as { sectionPlaneFill?: { visible?: boolean } }).sectionPlaneFill?.visible).toBe(false);

    session.destroy();
    container.remove();
  });

  it('preserves holes in section caps for hollow geometry-backed cuts', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(createHollowPrismObjFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'section-hole.obj',
        extension: 'obj'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('obj'))
    });

    session.setSectionActive?.(true);
    session.setSectionAxis?.('z');
    session.setSectionOffset?.(0.5);
    flushSectionHelper(session, 100000);

    const fillIndexCount = (
      (session as unknown as {
        sectionPlaneFillGeometry?: { getIndex?: () => { count?: number } | null };
      }).sectionPlaneFillGeometry?.getIndex?.()?.count ?? 0
    );
    const fillVertexCount = (
      (session as unknown as {
        sectionPlaneFillGeometry?: { getAttribute?: (name: string) => { count?: number } };
      }).sectionPlaneFillGeometry?.getAttribute?.('position')?.count ?? 0
    );

    expect((session as unknown as { sectionPlaneFill?: { visible?: boolean } }).sectionPlaneFill?.visible).toBe(true);
    expect(fillVertexCount).toBe(8);
    expect(fillIndexCount).toBe(24);

    session.destroy();
    container.remove();
  });

  it('deduplicates repeated section loops from duplicated geometry faces', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(createDuplicatedClosedSectionObjFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'section-duplicate.obj',
        extension: 'obj'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('obj'))
    });

    session.setSectionActive?.(true);
    session.setSectionAxis?.('z');
    session.setSectionOffset?.(0.5);
    flushSectionHelper(session, 100000);

    const fillIndexCount = (
      (session as unknown as {
        sectionPlaneFillGeometry?: { getIndex?: () => { count?: number } | null };
      }).sectionPlaneFillGeometry?.getIndex?.()?.count ?? 0
    );
    const fillVertexCount = (
      (session as unknown as {
        sectionPlaneFillGeometry?: { getAttribute?: (name: string) => { count?: number } };
      }).sectionPlaneFillGeometry?.getAttribute?.('position')?.count ?? 0
    );
    const outlineVertexCount = (
      (session as unknown as {
        sectionPlaneOutlineGeometry?: { getAttribute?: (name: string) => { count?: number } };
      }).sectionPlaneOutlineGeometry?.getAttribute?.('position')?.count ?? 0
    );

    expect((session as unknown as { sectionPlaneFill?: { visible?: boolean } }).sectionPlaneFill?.visible).toBe(true);
    expect(fillVertexCount).toBe(4);
    expect(fillIndexCount).toBe(6);
    expect(outlineVertexCount).toBe(8);

    session.destroy();
    container.remove();
  });

  it('keeps the main closed section loop and preserves branch spur outline segments', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(createSpurredSectionObjFixture()), {
      descriptor: {
        source: new Uint8Array(),
        name: 'section-spur.obj',
        extension: 'obj'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('obj'))
    });

    session.setSectionActive?.(true);
    session.setSectionAxis?.('z');
    session.setSectionOffset?.(0);
    flushSectionHelper(session, 100000);

    const fillIndexCount = (
      (session as unknown as {
        sectionPlaneFillGeometry?: { getIndex?: () => { count?: number } | null };
      }).sectionPlaneFillGeometry?.getIndex?.()?.count ?? 0
    );
    const fillVertexCount = (
      (session as unknown as {
        sectionPlaneFillGeometry?: { getAttribute?: (name: string) => { count?: number } };
      }).sectionPlaneFillGeometry?.getAttribute?.('position')?.count ?? 0
    );
    const outlineVertexCount = (
      (session as unknown as {
        sectionPlaneOutlineGeometry?: { getAttribute?: (name: string) => { count?: number } };
      }).sectionPlaneOutlineGeometry?.getAttribute?.('position')?.count ?? 0
    );

    expect((session as unknown as { sectionPlaneFill?: { visible?: boolean } }).sectionPlaneFill?.visible).toBe(true);
    expect(fillVertexCount).toBe(4);
    expect(fillIndexCount).toBe(6);
    expect(outlineVertexCount).toBe(10);

    session.destroy();
    container.remove();
  });

  it('uses real section intersection segments for object-backed previews', async () => {
    gltfParseAsyncMock.mockImplementationOnce(async () => {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0
      ], 3));
      const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: 0x22c55e }));
      const root = new Group();
      root.add(mesh);
      return { scene: root };
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(JSON.stringify(createGltfFixture())), {
      descriptor: {
        source: new Uint8Array(),
        name: 'section-object.gltf',
        extension: 'gltf'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('gltf'))
    });

    session.setSectionActive?.(true);
    flushSectionHelper(session, 100000);

    const outlineVertexCount = (
      (session as unknown as {
        sectionPlaneOutlineGeometry?: { getAttribute?: (name: string) => { count?: number } }
      }).sectionPlaneOutlineGeometry?.getAttribute?.('position')?.count ?? 0
    );

    expect(outlineVertexCount).toBeGreaterThan(0);
    expect(outlineVertexCount).toBeLessThan(8);

    session.destroy();
    container.remove();
  });

  it('renders a filled section cap for closed object-backed cuts', async () => {
    gltfParseAsyncMock.mockImplementationOnce(async () => {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(createCubeTriangles(), 3));
      const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: 0x0ea5e9 }));
      const root = new Group();
      root.add(mesh);
      return { scene: root };
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(JSON.stringify(createGltfFixture())), {
      descriptor: {
        source: new Uint8Array(),
        name: 'section-object-cap.gltf',
        extension: 'gltf'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('gltf'))
    });

    session.setSectionActive?.(true);
    session.setSectionAxis?.('z');
    session.setSectionOffset?.(0.5);
    flushSectionHelper(session, 100000);

    const fillVisible = (session as unknown as {
      sectionPlaneFill?: { visible?: boolean };
    }).sectionPlaneFill?.visible;
    const fillVertexCount = (
      (session as unknown as {
        sectionPlaneFillGeometry?: { getAttribute?: (name: string) => { count?: number } };
      }).sectionPlaneFillGeometry?.getAttribute?.('position')?.count ?? 0
    );

    expect(fillVisible).toBe(true);
    expect(fillVertexCount).toBeGreaterThanOrEqual(3);

    session.destroy();
    container.remove();
  });

  it('recomputes object-backed section helpers when node visibility changes', async () => {
    gltfParseAsyncMock.mockImplementationOnce(async () => {
      const root = new Group();
      const meshA = new Mesh(
        new BufferGeometry().setAttribute('position', new Float32BufferAttribute(createCubeTriangles(), 3)),
        new MeshStandardMaterial({ color: 0x0ea5e9 })
      );
      const meshB = new Mesh(
        new BufferGeometry().setAttribute('position', new Float32BufferAttribute(createCubeTriangles(), 3)),
        new MeshStandardMaterial({ color: 0x22c55e })
      );
      meshB.position.set(3, 0, 0);
      root.add(meshA, meshB);
      return { scene: root };
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(JSON.stringify(createGltfFixture())), {
      descriptor: {
        source: new Uint8Array(),
        name: 'section-object-visibility.gltf',
        extension: 'gltf'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('gltf'))
    });

    session.setSectionActive?.(true);
    session.setSectionAxis?.('z');
    session.setSectionOffset?.(0.5);
    flushSectionHelper(session, 100000);

    const beforeFillVertexCount = (
      (session as unknown as {
        sectionPlaneFillGeometry?: { getAttribute?: (name: string) => { count?: number } };
      }).sectionPlaneFillGeometry?.getAttribute?.('position')?.count ?? 0
    );
    const nodeId = session.getState().modelTree?.[1]?.id;
    expect(nodeId).toBeTruthy();

    session.setNodeVisibility?.(nodeId!, false);
    flushSectionHelper(session, 100100);

    const afterFillVertexCount = (
      (session as unknown as {
        sectionPlaneFillGeometry?: { getAttribute?: (name: string) => { count?: number } };
      }).sectionPlaneFillGeometry?.getAttribute?.('position')?.count ?? 0
    );

    expect(beforeFillVertexCount).toBe(8);
    expect(afterFillVertexCount).toBe(4);

    session.destroy();
    container.remove();
  });

  it('samples oversized object-backed section helper sources to the helper triangle budget', async () => {
    gltfParseAsyncMock.mockImplementationOnce(async () => {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(createRepeatedTrianglePositions(15000), 3));
      const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: 0x0284c7 }));
      const root = new Group();
      root.add(mesh);
      return { scene: root };
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(JSON.stringify(createGltfFixture())), {
      descriptor: {
        source: new Uint8Array(),
        name: 'section-object-budget.gltf',
        extension: 'gltf'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('gltf'))
    });

    const sampledPositionCount = (
      (session as unknown as {
        sectionSourceGeometry?: { objects?: Array<{ positions: Float32Array }> };
      }).sectionSourceGeometry?.objects?.[0]?.positions.length ?? 0
    );

    expect(sampledPositionCount).toBe(12000 * 9);

    session.destroy();
    container.remove();
  });

  it('recomputes object-backed section helpers when material isolation changes visible meshes', async () => {
    gltfParseAsyncMock.mockImplementationOnce(async () => {
      const root = new Group();
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(createCubeTriangles(), 3));

      const paintMaterial = new MeshStandardMaterial({ color: 0xff8844 });
      paintMaterial.name = 'Paint';
      const steelMaterial = new MeshStandardMaterial({ color: 0x94a3b8 });
      steelMaterial.name = 'Steel';

      const paintMesh = new Mesh(geometry, paintMaterial);
      const steelMesh = new Mesh(geometry, steelMaterial);
      steelMesh.position.set(3, 0, 0);
      root.add(paintMesh, steelMesh);
      return { scene: root };
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(JSON.stringify(createGltfFixture())), {
      descriptor: {
        source: new Uint8Array(),
        name: 'section-object-material-filter.gltf',
        extension: 'gltf'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('gltf'))
    });

    session.setSectionActive?.(true);
    session.setSectionAxis?.('z');
    session.setSectionOffset?.(0.5);
    flushSectionHelper(session, 100000);

    const beforeFillVertexCount = (
      (session as unknown as {
        sectionPlaneFillGeometry?: { getAttribute?: (name: string) => { count?: number } };
      }).sectionPlaneFillGeometry?.getAttribute?.('position')?.count ?? 0
    );
    const paintKey = session.getState().metadata?.materialDetails?.find((detail) => detail.name === 'Paint')?.key;
    expect(paintKey).toBeTruthy();

    session.setActiveMaterial?.(paintKey);
    flushSectionHelper(session, 100100);

    const isolatedFillVertexCount = (
      (session as unknown as {
        sectionPlaneFillGeometry?: { getAttribute?: (name: string) => { count?: number } };
      }).sectionPlaneFillGeometry?.getAttribute?.('position')?.count ?? 0
    );

    session.setActiveMaterial?.();
    flushSectionHelper(session, 100200);

    const restoredFillVertexCount = (
      (session as unknown as {
        sectionPlaneFillGeometry?: { getAttribute?: (name: string) => { count?: number } };
      }).sectionPlaneFillGeometry?.getAttribute?.('position')?.count ?? 0
    );

    expect(beforeFillVertexCount).toBe(8);
    expect(isolatedFillVertexCount).toBe(4);
    expect(restoredFillVertexCount).toBe(8);

    session.destroy();
    container.remove();
  });

  it('keeps section helper cache intact when material isolation is set to the same key twice', async () => {
    gltfParseAsyncMock.mockImplementationOnce(async () => {
      const root = new Group();
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(createCubeTriangles(), 3));

      const paintMaterial = new MeshStandardMaterial({ color: 0xff8844 });
      paintMaterial.name = 'Paint';
      const steelMaterial = new MeshStandardMaterial({ color: 0x94a3b8 });
      steelMaterial.name = 'Steel';

      const paintMesh = new Mesh(geometry, paintMaterial);
      const steelMesh = new Mesh(geometry, steelMaterial);
      steelMesh.position.set(3, 0, 0);
      root.add(paintMesh, steelMesh);
      return { scene: root };
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(JSON.stringify(createGltfFixture())), {
      descriptor: {
        source: new Uint8Array(),
        name: 'section-object-material-idempotent.gltf',
        extension: 'gltf'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('gltf'))
    });

    session.setSectionActive?.(true);
    session.setSectionAxis?.('z');
    session.setSectionOffset?.(0.5);
    const paintKey = session.getState().metadata?.materialDetails?.find((detail) => detail.name === 'Paint')?.key;
    expect(paintKey).toBeTruthy();

    session.setActiveMaterial?.(paintKey);
    flushSectionHelper(session, 100000);
    const cacheSizeAfterFirstIsolation = (
      (session as unknown as { sectionHelperCache?: Map<string, unknown> }).sectionHelperCache?.size ?? 0
    );

    session.setActiveMaterial?.(paintKey);

    const cacheSizeAfterRepeatedIsolation = (
      (session as unknown as { sectionHelperCache?: Map<string, unknown> }).sectionHelperCache?.size ?? 0
    );

    expect(cacheSizeAfterFirstIsolation).toBeGreaterThan(0);
    expect(cacheSizeAfterRepeatedIsolation).toBe(cacheSizeAfterFirstIsolation);

    session.destroy();
    container.remove();
  });

  it('invalidates cached single-plane helper data when explode changes object transforms', async () => {
    gltfParseAsyncMock.mockImplementationOnce(async () => {
      const geometryA = new BufferGeometry();
      geometryA.setAttribute('position', new Float32BufferAttribute(createCubeTriangles(), 3));
      const meshA = new Mesh(geometryA, new MeshStandardMaterial({ color: 0x0284c7 }));

      const geometryB = new BufferGeometry();
      geometryB.setAttribute('position', new Float32BufferAttribute(createCubeTriangles(), 3));
      const meshB = new Mesh(geometryB, new MeshStandardMaterial({ color: 0x38bdf8 }));
      meshB.position.set(3, 0, 0);

      const root = new Group();
      root.add(meshA, meshB);
      return { scene: root };
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(JSON.stringify(createGltfFixture())), {
      descriptor: {
        source: new Uint8Array(),
        name: 'section-object-explode-cache.gltf',
        extension: 'gltf'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('gltf'))
    });

    session.setSectionActive?.(true);
    session.setSectionAxis?.('z');
    session.setSectionOffset?.(0.5);
    flushSectionHelper(session, 100000);

    const runtimeSession = session as unknown as {
      sectionHelperCache?: Map<string, unknown>;
    };
    const cachedEntriesBeforeExplode = [...(runtimeSession.sectionHelperCache?.entries() ?? [])];

    session.setExplode?.(1);

    expect(runtimeSession.sectionHelperCache?.size ?? 0).toBe(0);

    flushSectionHelper(session, 100100);
    const cachedEntriesAfterExplode = [...(runtimeSession.sectionHelperCache?.entries() ?? [])];

    expect(cachedEntriesBeforeExplode.length).toBeGreaterThan(0);
    expect(cachedEntriesAfterExplode.length).toBeGreaterThan(0);
    expect(cachedEntriesAfterExplode[0]?.[1]).not.toBe(cachedEntriesBeforeExplode[0]?.[1]);

    session.destroy();
    container.remove();
  });

  it('keeps section helper cache intact when explode is set to the same amount twice', async () => {
    gltfParseAsyncMock.mockImplementationOnce(async () => {
      const geometryA = new BufferGeometry();
      geometryA.setAttribute('position', new Float32BufferAttribute(createCubeTriangles(), 3));
      const meshA = new Mesh(geometryA, new MeshStandardMaterial({ color: 0x0284c7 }));

      const geometryB = new BufferGeometry();
      geometryB.setAttribute('position', new Float32BufferAttribute(createCubeTriangles(), 3));
      const meshB = new Mesh(geometryB, new MeshStandardMaterial({ color: 0x38bdf8 }));
      meshB.position.set(3, 0, 0);

      const root = new Group();
      root.add(meshA, meshB);
      return { scene: root };
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(JSON.stringify(createGltfFixture())), {
      descriptor: {
        source: new Uint8Array(),
        name: 'section-object-explode-idempotent.gltf',
        extension: 'gltf'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('gltf'))
    });

    session.setSectionActive?.(true);
    session.setSectionAxis?.('z');
    session.setSectionOffset?.(0.5);
    session.setExplode?.(1);
    flushSectionHelper(session, 100000);
    const cacheSizeAfterFirstExplode = (
      (session as unknown as { sectionHelperCache?: Map<string, unknown> }).sectionHelperCache?.size ?? 0
    );

    session.setExplode?.(1);

    const cacheSizeAfterRepeatedExplode = (
      (session as unknown as { sectionHelperCache?: Map<string, unknown> }).sectionHelperCache?.size ?? 0
    );

    expect(cacheSizeAfterFirstExplode).toBeGreaterThan(0);
    expect(cacheSizeAfterRepeatedExplode).toBe(cacheSizeAfterFirstExplode);

    session.destroy();
    container.remove();
  });

  it('tracks camera projection and view presets in preview state', async () => {
    gltfParseAsyncMock.mockImplementationOnce(async () => {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute([
        0, 0, 0,
        2, 0, 0,
        0, 2, 0
      ], 3));
      const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: 0x38bdf8 }));
      const root = new Group();
      root.add(mesh);
      return { scene: root };
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(JSON.stringify(createGltfFixture())), {
      descriptor: {
        source: new Uint8Array(),
        name: 'camera.gltf',
        extension: 'gltf'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('gltf'))
    });

    expect(session.getState().camera).toMatchObject({
      projection: 'perspective',
      viewPreset: 'isometric'
    });

    session.setCameraProjection?.('orthographic');
    expect(session.getState().camera).toMatchObject({
      projection: 'orthographic'
    });

    session.setCameraViewPreset?.('top');
    expect(session.getState().camera).toMatchObject({
      projection: 'orthographic',
      viewPreset: 'top'
    });
    expect(session.getState().camera?.position[1]).toBeGreaterThan(0);

    session.setCameraViewPreset?.('left');
    expect(session.getState().camera).toMatchObject({
      viewPreset: 'left'
    });
    expect(session.getState().camera?.position[0]).toBeLessThan(0);

    session.setCameraViewPreset?.('bottom');
    expect(session.getState().camera).toMatchObject({
      viewPreset: 'bottom'
    });
    expect(session.getState().camera?.position[1]).toBeLessThan(0);

    session.pan?.(10, 10);
    expect(session.getState().camera).toMatchObject({
      viewPreset: 'free'
    });

    session.destroy();
    container.remove();
  });

  it('skips redundant scale, measurement, and camera preset setter work when values are unchanged', async () => {
    gltfParseAsyncMock.mockImplementationOnce(async () => {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute([
        0, 0, 0,
        2, 0, 0,
        0, 2, 0
      ], 3));
      const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: 0x38bdf8 }));
      const root = new Group();
      root.add(mesh);
      return { scene: root };
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(JSON.stringify(createGltfFixture())), {
      descriptor: {
        source: new Uint8Array(),
        name: 'setter-idempotent.gltf',
        extension: 'gltf'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('gltf'))
    });

    const runtimeSession = session as unknown as {
      updateCamera: () => void;
      refreshMeasurementHover: () => void;
      updateMeasurementHelpers: () => void;
    };
    const originalUpdateCamera = runtimeSession.updateCamera.bind(runtimeSession);
    const originalRefreshMeasurementHover = runtimeSession.refreshMeasurementHover.bind(runtimeSession);
    const originalUpdateMeasurementHelpers = runtimeSession.updateMeasurementHelpers.bind(runtimeSession);
    const updateCameraSpy = vi.fn(() => originalUpdateCamera());
    const refreshMeasurementHoverSpy = vi.fn(() => originalRefreshMeasurementHover());
    const updateMeasurementHelpersSpy = vi.fn(() => originalUpdateMeasurementHelpers());
    runtimeSession.updateCamera = updateCameraSpy;
    runtimeSession.refreshMeasurementHover = refreshMeasurementHoverSpy;
    runtimeSession.updateMeasurementHelpers = updateMeasurementHelpersSpy;

    const stateChangeSpy = vi.fn();
    session.on('statechange', stateChangeSpy);

    session.setScale?.(1);
    session.setMeasurementSnapMode?.('surface');
    session.setMeasurementAxisLock?.('free');
    session.setCameraViewPreset?.('isometric');

    expect(updateCameraSpy).not.toHaveBeenCalled();
    expect(refreshMeasurementHoverSpy).not.toHaveBeenCalled();
    expect(updateMeasurementHelpersSpy).not.toHaveBeenCalled();
    expect(stateChangeSpy).not.toHaveBeenCalled();

    session.setScale?.(1.4);
    session.setScale?.(1.4);
    expect(updateCameraSpy).toHaveBeenCalledTimes(1);

    session.setMeasurementSnapMode?.('vertex');
    session.setMeasurementSnapMode?.('vertex');
    expect(refreshMeasurementHoverSpy).toHaveBeenCalledTimes(1);
    expect(updateMeasurementHelpersSpy).toHaveBeenCalledTimes(1);

    session.setMeasurementAxisLock?.('x');
    session.setMeasurementAxisLock?.('x');
    expect(refreshMeasurementHoverSpy).toHaveBeenCalledTimes(2);
    expect(updateMeasurementHelpersSpy).toHaveBeenCalledTimes(2);

    session.setCameraViewPreset?.('top');
    session.setCameraViewPreset?.('top');
    expect(updateCameraSpy).toHaveBeenCalledTimes(2);
    expect(stateChangeSpy).toHaveBeenCalledTimes(4);

    session.destroy();
    container.remove();
  });

  it('ignores non-finite public numeric controls', async () => {
    gltfParseAsyncMock.mockImplementationOnce(async () => {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute([
        0, 0, 0,
        2, 0, 0,
        0, 2, 0
      ], 3));
      const root = new Group();
      root.add(new Mesh(geometry, new MeshStandardMaterial({ color: 0x38bdf8 })));
      const secondMesh = new Mesh(geometry.clone(), new MeshStandardMaterial({ color: 0xf59e0b }));
      secondMesh.position.x = 3;
      root.add(secondMesh);
      return { scene: root };
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: Number.NaN
    });

    await session.load(new TextEncoder().encode(JSON.stringify(createGltfFixture())), {
      descriptor: {
        source: new Uint8Array(),
        name: 'numeric-input-validation.gltf',
        extension: 'gltf'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('gltf'))
    });

    const initialState = session.getState();
    const stateChangeSpy = vi.fn();
    session.on('statechange', stateChangeSpy);

    session.setScale?.(Number.POSITIVE_INFINITY);
    session.pan?.(Number.NaN, 0);
    session.setExplode?.(Number.POSITIVE_INFINITY);
    session.setSectionOffset?.(Number.NaN);
    session.setSectionRange?.('x', 0, Number.POSITIVE_INFINITY);

    expect(session.getState()).toMatchObject({
      scale: 1,
      explode: initialState.explode,
      camera: initialState.camera,
      section: initialState.section
    });
    expect(stateChangeSpy).not.toHaveBeenCalled();

    session.destroy();
    container.remove();
  });

  it('skips redundant measurement activation and clearing work when state is unchanged', async () => {
    gltfParseAsyncMock.mockImplementationOnce(async () => {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute([
        0, 0, 0,
        2, 0, 0,
        0, 2, 0
      ], 3));
      const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: 0x38bdf8 }));
      const root = new Group();
      root.add(mesh);
      return { scene: root };
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(JSON.stringify(createGltfFixture())), {
      descriptor: {
        source: new Uint8Array(),
        name: 'measurement-active-idempotent.gltf',
        extension: 'gltf'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('gltf'))
    });

    const runtimeSession = session as unknown as {
      updateMeasurementHelpers: () => void;
    };
    const originalUpdateMeasurementHelpers = runtimeSession.updateMeasurementHelpers.bind(runtimeSession);
    const updateMeasurementHelpersSpy = vi.fn(() => originalUpdateMeasurementHelpers());
    runtimeSession.updateMeasurementHelpers = updateMeasurementHelpersSpy;
    const stateChangeSpy = vi.fn();
    session.on('statechange', stateChangeSpy);

    session.setMeasurementActive?.(false);
    session.clearMeasurement?.();

    expect(updateMeasurementHelpersSpy).not.toHaveBeenCalled();
    expect(stateChangeSpy).not.toHaveBeenCalled();

    session.setMeasurementActive?.(true);
    session.setMeasurementActive?.(true);

    expect(updateMeasurementHelpersSpy).toHaveBeenCalledTimes(1);
    expect(stateChangeSpy).toHaveBeenCalledTimes(1);

    session.setMeasurementActive?.(false);
    session.setMeasurementActive?.(false);

    expect(updateMeasurementHelpersSpy).toHaveBeenCalledTimes(2);
    expect(stateChangeSpy).toHaveBeenCalledTimes(2);

    session.clearMeasurement?.();
    session.clearMeasurement?.();

    expect(updateMeasurementHelpersSpy).toHaveBeenCalledTimes(2);
    expect(stateChangeSpy).toHaveBeenCalledTimes(2);

    session.destroy();
    container.remove();
  });

  it('skips redundant measurement hover clearing when preview state is already empty', async () => {
    gltfParseAsyncMock.mockImplementationOnce(async () => {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute([
        0, 0, 0,
        2, 0, 0,
        0, 2, 0
      ], 3));
      const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: 0x38bdf8 }));
      const root = new Group();
      root.add(mesh);
      return { scene: root };
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(JSON.stringify(createGltfFixture())), {
      descriptor: {
        source: new Uint8Array(),
        name: 'measurement-hover-clear-idempotent.gltf',
        extension: 'gltf'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('gltf'))
    });

    const runtimeSession = session as unknown as {
      clearMeasurementHover: () => void;
      updateMeasurementHelpers: () => void;
      state: { measurement?: { previewPoint?: [number, number, number] } };
    };
    const originalUpdateMeasurementHelpers = runtimeSession.updateMeasurementHelpers.bind(runtimeSession);
    const updateMeasurementHelpersSpy = vi.fn(() => originalUpdateMeasurementHelpers());
    runtimeSession.updateMeasurementHelpers = updateMeasurementHelpersSpy;
    const stateChangeSpy = vi.fn();
    session.on('statechange', stateChangeSpy);

    runtimeSession.clearMeasurementHover();
    expect(updateMeasurementHelpersSpy).not.toHaveBeenCalled();
    expect(stateChangeSpy).not.toHaveBeenCalled();

    session.setMeasurementActive?.(true);
    (runtimeSession as unknown as { applyMeasurementPreviewPoint(point: Vector3): void }).applyMeasurementPreviewPoint(new Vector3(1, 2, 3));
    expect(runtimeSession.state.measurement?.previewPoint).toEqual([1, 2, 3]);

    updateMeasurementHelpersSpy.mockClear();
    stateChangeSpy.mockClear();

    runtimeSession.clearMeasurementHover();
    expect(updateMeasurementHelpersSpy).toHaveBeenCalledTimes(1);
    expect(stateChangeSpy).toHaveBeenCalledTimes(1);

    updateMeasurementHelpersSpy.mockClear();
    stateChangeSpy.mockClear();

    runtimeSession.clearMeasurementHover();
    expect(updateMeasurementHelpersSpy).not.toHaveBeenCalled();
    expect(stateChangeSpy).not.toHaveBeenCalled();

    session.destroy();
    container.remove();
  });

  it('skips redundant measurement preview updates when the hover point is unchanged', async () => {
    gltfParseAsyncMock.mockImplementationOnce(async () => {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute([
        0, 0, 0,
        2, 0, 0,
        0, 2, 0
      ], 3));
      const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: 0x38bdf8 }));
      const root = new Group();
      root.add(mesh);
      return { scene: root };
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(JSON.stringify(createGltfFixture())), {
      descriptor: {
        source: new Uint8Array(),
        name: 'measurement-hover-idempotent.gltf',
        extension: 'gltf'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('gltf'))
    });

    const runtimeSession = session as unknown as {
      applyMeasurementPreviewPoint: (point: Vector3) => void;
      updateMeasurementHelpers: () => void;
    };
    const originalUpdateMeasurementHelpers = runtimeSession.updateMeasurementHelpers.bind(runtimeSession);
    const updateMeasurementHelpersSpy = vi.fn(() => originalUpdateMeasurementHelpers());
    runtimeSession.updateMeasurementHelpers = updateMeasurementHelpersSpy;
    const stateChangeSpy = vi.fn();
    session.on('statechange', stateChangeSpy);

    session.setMeasurementActive?.(true);
    stateChangeSpy.mockClear();
    updateMeasurementHelpersSpy.mockClear();

    runtimeSession.applyMeasurementPreviewPoint(new Vector3(1, 2, 3));
    expect(updateMeasurementHelpersSpy).toHaveBeenCalledTimes(1);
    expect(stateChangeSpy).toHaveBeenCalledTimes(1);

    updateMeasurementHelpersSpy.mockClear();
    stateChangeSpy.mockClear();

    runtimeSession.applyMeasurementPreviewPoint(new Vector3(1, 2, 3));
    expect(updateMeasurementHelpersSpy).not.toHaveBeenCalled();
    expect(stateChangeSpy).not.toHaveBeenCalled();

    (session as unknown as { applyMeasurementPoint: (point: Vector3) => void }).applyMeasurementPoint(new Vector3(0, 0, 0));
    stateChangeSpy.mockClear();
    updateMeasurementHelpersSpy.mockClear();

    runtimeSession.applyMeasurementPreviewPoint(new Vector3(4, 0, 0));
    expect(updateMeasurementHelpersSpy).toHaveBeenCalledTimes(1);
    expect(stateChangeSpy).toHaveBeenCalledTimes(1);

    updateMeasurementHelpersSpy.mockClear();
    stateChangeSpy.mockClear();

    runtimeSession.applyMeasurementPreviewPoint(new Vector3(4, 0, 0));
    expect(updateMeasurementHelpersSpy).not.toHaveBeenCalled();
    expect(stateChangeSpy).not.toHaveBeenCalled();

    session.destroy();
    container.remove();
  });

  it('tracks display modes and updates mesh and edge rendering state', async () => {
    gltfParseAsyncMock.mockImplementationOnce(async () => {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute([
        0, 0, 0,
        2, 0, 0,
        0, 2, 0
      ], 3));
      const material = new MeshStandardMaterial({ color: 0x38bdf8, opacity: 1, transparent: false });
      const mesh = new Mesh(geometry, material);
      const root = new Group();
      root.add(mesh);
      return { scene: root };
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(new TextEncoder().encode(JSON.stringify(createGltfFixture())), {
      descriptor: {
        source: new Uint8Array(),
        name: 'display.gltf',
        extension: 'gltf'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('gltf'))
    });

    expect(session.getState().displayMode).toBe('solid-edge');
    expect(session.getState().capabilities.displayMode).toBe(true);

    const modelGroup = (session as unknown as { modelGroup?: Group }).modelGroup;
    let mesh: Mesh | undefined;
    let edges: LineSegments | undefined;
    modelGroup?.traverse((child) => {
      if (!mesh && child instanceof Mesh) {
        mesh = child;
      }
      if (!edges && child instanceof LineSegments) {
        edges = child;
      }
    });
    const material = mesh?.material as MeshStandardMaterial | undefined;
    const edgeMaterial = edges?.material as LineBasicMaterial | undefined;

    expect(material?.wireframe).toBe(false);
    expect(material?.opacity).toBe(1);
    expect(edges?.visible).toBe(true);

    session.setDisplayMode?.('shaded');
    expect(session.getState().displayMode).toBe('shaded');
    expect(edges?.visible).toBe(false);
    expect(material?.wireframe).toBe(false);

    session.setDisplayMode?.('wireframe');
    expect(session.getState().displayMode).toBe('wireframe');
    expect(edges?.visible).toBe(true);
    expect(material?.wireframe).toBe(true);

    session.setDisplayMode?.('xray');
    expect(session.getState().displayMode).toBe('xray');
    expect(material?.opacity).toBeCloseTo(0.26, 5);
    expect(material?.transparent).toBe(true);
    expect(material?.depthWrite).toBe(false);
    expect(edgeMaterial?.opacity).toBeCloseTo(0.22, 5);

    session.setDisplayMode?.('solid-edge');
    expect(session.getState().displayMode).toBe('solid-edge');
    expect(material?.wireframe).toBe(false);
    expect(material?.opacity).toBe(1);
    expect(material?.depthWrite).toBe(true);
    expect(edges?.visible).toBe(true);

    session.destroy();
    container.remove();
  });

  it('tracks snapshot background mode and applies export background overrides', async () => {
    gltfParseAsyncMock.mockImplementationOnce(async () => {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute([
        0, 0, 0,
        2, 0, 0,
        0, 2, 0
      ], 3));
      const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: 0xf59e0b }));
      const root = new Group();
      root.add(mesh);
      return { scene: root };
    });

    const clickMock = vi.fn();
    const createElementSpy = vi.spyOn(document, 'createElement');
    createElementSpy.mockImplementation((tagName: string) => {
      const element = document.createElementNS('http://www.w3.org/1999/xhtml', tagName) as HTMLElement;
      if (tagName.toLowerCase() === 'a') {
        Object.defineProperty(element, 'click', {
          value: clickMock
        });
      }
      return element;
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });
    await session.load(new TextEncoder().encode(JSON.stringify(createGltfFixture())), {
      descriptor: {
        source: new Uint8Array(),
        name: 'snapshot-bg.gltf',
        extension: 'gltf'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('gltf'))
    });

    expect(session.getState().snapshotBackground).toBe('scene');
    const toDataUrlSpy = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA');

    session.setSnapshotBackground?.('white');
    expect(session.getState().snapshotBackground).toBe('white');
    session.downloadSnapshot?.();

    session.downloadSnapshot?.('transparent-export', 'transparent');

    const links = createElementSpy.mock.results
      .map((result) => result.value)
      .filter((value): value is HTMLAnchorElement => value instanceof HTMLAnchorElement);
    expect(links.at(-1)?.download).toBe('transparent-export.png');
    expect(clickMock).toHaveBeenCalledTimes(2);
    expect(toDataUrlSpy).toHaveBeenCalledTimes(2);

    session.destroy();
    container.remove();
    createElementSpy.mockRestore();
  });

  it('downloads a PNG snapshot from the current model view', async () => {
    gltfParseAsyncMock.mockImplementationOnce(async () => {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute([
        0, 0, 0,
        2, 0, 0,
        0, 2, 0
      ], 3));
      const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: 0xf59e0b }));
      const root = new Group();
      root.add(mesh);
      return { scene: root };
    });

    const clickMock = vi.fn();
    const createElementSpy = vi.spyOn(document, 'createElement');
    createElementSpy.mockImplementation((tagName: string) => {
      const element = document.createElementNS('http://www.w3.org/1999/xhtml', tagName) as HTMLElement;
      if (tagName.toLowerCase() === 'a') {
        Object.defineProperty(element, 'click', {
          value: clickMock
        });
      }
      return element;
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });
    const canvas = (session as unknown as { renderer?: { domElement?: HTMLCanvasElement } }).renderer?.domElement;

    await session.load(new TextEncoder().encode(JSON.stringify(createGltfFixture())), {
      descriptor: {
        source: new Uint8Array(),
        name: 'snapshot.gltf',
        extension: 'gltf'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('gltf'))
    });

    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA');
    session.downloadSnapshot?.();

    expect(clickMock).toHaveBeenCalled();
    const link = createElementSpy.mock.results.find((result) => result.value instanceof HTMLAnchorElement)?.value as HTMLAnchorElement | undefined;
    expect(link?.download).toBe('snapshot.png');
    expect(link?.href).toBe('data:image/png;base64,AAAA');

    session.destroy();
    container.remove();
    createElementSpy.mockRestore();
    void canvas;
  });

  it('rejects glTF sources that need sidecar resources', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await expect(session.load(new TextEncoder().encode(JSON.stringify({
      asset: { version: '2.0' },
      buffers: [{ uri: 'mesh.bin', byteLength: 24 }]
    })), {
      descriptor: {
        source: new Uint8Array(),
        name: 'part.gltf',
        extension: 'gltf'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('gltf'))
    })).rejects.toThrow('glTF references external resources');

    expect(session.getState().error).toContain('mesh.bin');
    session.destroy();
    container.remove();
  });

  it('renders uploaded glTF sources with resource-resolved sidecar resources', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1,
      resourceResolver: ({ source, relation }) =>
        source === 'scene.bin' && relation === 'buffer' ? new Uint8Array([0, 0, 0]) : undefined
    });

    await session.load(new TextEncoder().encode(JSON.stringify({
      asset: { version: '2.0' },
      buffers: [{ uri: 'scene.bin', byteLength: 3 }]
    })), {
      descriptor: {
        source: new Uint8Array(),
        name: 'scene.gltf',
        extension: 'gltf'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('gltf'))
    });

    expect(session.getState()).toMatchObject({
      family: 'model3d',
      loading: false
    });
    const parsed = JSON.parse(gltfParseAsyncMock.mock.calls.at(-1)?.[0] as string);
    expect(parsed.buffers[0].uri).toBe('data:application/octet-stream;base64,AAAA');
    expect(container.querySelector('canvas.model3dv-canvas')).toBeTruthy();

    session.destroy();
    container.remove();
  });

  it('emits model resource warnings through the preview session', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1,
      resourceResolver: ({ relation }) => relation === 'material'
        ? {
            source: new TextEncoder().encode('newmtl base\n'),
            warnings: ['Demo OBJ material fallback warning.']
          }
        : undefined
    });
    const warningHandler = vi.fn();
    session.on('warnings', warningHandler);

    await session.load(new TextEncoder().encode('mtllib material.mtl\nusemtl base\nv 0 0 0\n'), {
      descriptor: {
        source: new Uint8Array(),
        name: 'scene.obj',
        extension: 'obj'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('obj'))
    });

    expect(session.getState().warnings).toContain('Demo OBJ material fallback warning.');
    expect(warningHandler).toHaveBeenCalledWith(['Demo OBJ material fallback warning.']);

    session.destroy();
    container.remove();
  });

  it('renders URL glTF sources with relative sidecar resources', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });
    const source = 'https://cdn.example.test/models/robot/scene.gltf?cache=1';
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({
        asset: { version: '2.0' },
        buffers: [{ uri: 'scene.bin', byteLength: 24 }]
      })).buffer
    })));

    await session.load(source, {
      descriptor: {
        source,
        name: 'scene.gltf',
        extension: 'gltf'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('gltf'))
    });

    expect(session.getState()).toMatchObject({
      family: 'model3d',
      loading: false
    });
    expect(gltfParseAsyncMock).toHaveBeenLastCalledWith(expect.any(String), 'https://cdn.example.test/models/robot/');

    session.destroy();
    container.remove();
    vi.unstubAllGlobals();
  });

  it('renders 3MF sources through the preview session', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });

    await session.load(await create3mfFixture(), {
      descriptor: {
        source: new Uint8Array(),
        name: 'part.3mf',
        extension: '3mf'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('3mf'))
    });

    expect(session.getState()).toMatchObject({
      family: 'model3d',
      loading: false,
      capabilities: {
        orbit: true
      }
    });
    expect(container.querySelector('canvas.model3dv-canvas')).toBeTruthy();

    session.destroy();
    container.remove();
  });

  it('emits 3MF material warnings through the preview session', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const session = createModel3dPreviewDriver().createSession(container, {
      initialScale: 1
    });
    const warningHandler = vi.fn();
    session.on('warnings', warningHandler);

    await session.load(await createTextured3mfFixture(), {
      descriptor: {
        source: new Uint8Array(),
        name: 'textured.3mf',
        extension: '3mf'
      },
      route: createModel3dPreviewRoutes().find((route) => route.extensions.includes('3mf'))
    });

    expect(session.getState().warnings).toContain('3MF texture2d resource "8" is not rendered directly yet; base-material colors remain supported.');
    expect(warningHandler).toHaveBeenCalledWith(expect.arrayContaining([
      '3MF material resource "9" is not a supported color palette; fallback vertex colors were used.'
    ]));

    session.destroy();
    container.remove();
  });
});

function createAsciiStlFixture(): string {
  return `solid preview
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 0 1 0
  endloop
endfacet
endsolid preview`;
}

function flushSectionHelper(session: unknown, now: number): void {
  const runtimeSession = session as { renderFrame: () => void };
  const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(now);
  runtimeSession.renderFrame();
  nowSpy.mockRestore();
}

function createBinaryStlFixture(): ArrayBuffer {
  const buffer = new ArrayBuffer(84 + 50);
  const view = new DataView(buffer);
  view.setUint32(80, 1, true);
  let offset = 84;
  view.setFloat32(offset, 0, true);
  view.setFloat32(offset + 4, 0, true);
  view.setFloat32(offset + 8, 1, true);
  offset += 12;
  for (const vertex of [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0]
  ]) {
    view.setFloat32(offset, vertex[0]!, true);
    view.setFloat32(offset + 4, vertex[1]!, true);
    view.setFloat32(offset + 8, vertex[2]!, true);
    offset += 12;
  }
  view.setUint16(offset, 0, true);
  return buffer;
}

function createObjFixture(): string {
  return `# quad face
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
vn 0 0 1
f 1//1 2//1 3//1 4//1`;
}

function createClosedSectionObjFixture(): string {
  return `# cube
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 0 0 1
v 1 0 1
v 1 1 1
v 0 1 1
f 1 2 3 4
f 5 8 7 6
f 1 5 6 2
f 2 6 7 3
f 3 7 8 4
f 5 1 4 8`;
}

function createDuplicatedClosedSectionObjFixture(): string {
  return `# duplicated cube faces
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 0 0 1
v 1 0 1
v 1 1 1
v 0 1 1
f 1 2 3 4
f 1 2 3 4
f 5 8 7 6
f 5 8 7 6
f 1 5 6 2
f 1 5 6 2
f 2 6 7 3
f 2 6 7 3
f 3 7 8 4
f 3 7 8 4
f 5 1 4 8
f 5 1 4 8`;
}

function createSpurredSectionObjFixture(): string {
  return `# cube section with detached spur segment
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 0 0 1
v 1 0 1
v 1 1 1
v 0 1 1
v 1.5 0 -0.5
v 2 0 0.5
v 1.5 0.5 0.5
f 1 5 8 4
f 4 8 7 3
f 3 7 6 2
f 2 6 5 1
f 9 10 11`;
}

function createLargeTriangleSoupObjFixture(triangleCount: number): string {
  return `# repeated triangle soup
v 0 0 0
v 1 0 0
v 0 1 0
${Array.from({ length: triangleCount }, () => 'f 1 2 3').join('\n')}`;
}

function createHollowPrismObjFixture(): string {
  return `# hollow prism
v 0 0 0
v 3 0 0
v 3 3 0
v 0 3 0
v 0 0 1
v 3 0 1
v 3 3 1
v 0 3 1
v 1 1 0
v 2 1 0
v 2 2 0
v 1 2 0
v 1 1 1
v 2 1 1
v 2 2 1
v 1 2 1
f 1 2 6 5
f 2 3 7 6
f 3 4 8 7
f 4 1 5 8
f 9 13 14 10
f 10 14 15 11
f 11 15 16 12
f 12 16 13 9
f 1 2 10 9
f 2 3 11 10
f 3 4 12 11
f 4 1 9 12
f 5 13 14 6
f 6 14 15 7
f 7 15 16 8
f 8 16 13 5`;
}

function createCubeTriangles(): number[] {
  return [
    0, 0, 0, 1, 0, 0, 1, 1, 0,
    0, 0, 0, 1, 1, 0, 0, 1, 0,
    0, 0, 1, 0, 1, 1, 1, 1, 1,
    0, 0, 1, 1, 1, 1, 1, 0, 1,
    0, 0, 0, 0, 0, 1, 1, 0, 1,
    0, 0, 0, 1, 0, 1, 1, 0, 0,
    1, 0, 0, 1, 0, 1, 1, 1, 1,
    1, 0, 0, 1, 1, 1, 1, 1, 0,
    1, 1, 0, 1, 1, 1, 0, 1, 1,
    1, 1, 0, 0, 1, 1, 0, 1, 0,
    0, 0, 1, 0, 0, 0, 0, 1, 0,
    0, 0, 1, 0, 1, 0, 0, 1, 1
  ];
}

function createRepeatedTrianglePositions(triangleCount: number): number[] {
  const positions: number[] = [];
  for (let index = 0; index < triangleCount; index += 1) {
    positions.push(
      0, 0, 0,
      1, 0, 0,
      0, 1, 0
    );
  }
  return positions;
}

function createAsciiPlyFixture(): string {
  return `ply
format ascii 1.0
element vertex 4
property float x
property float y
property float z
element face 1
property list uchar int vertex_indices
end_header
0 0 0
1 0 0
1 1 0
0 1 0
4 0 1 2 3`;
}

function createAsciiColoredPlyFixture(): string {
  return `ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
element face 1
property list uchar int vertex_indices
end_header
0 0 0 255 0 0
1 0 0 0 255 0
0 1 0 0 0 255
3 0 1 2`;
}

function createBinaryPlyFixture(): ArrayBuffer {
  const header = `ply
format binary_little_endian 1.0
element vertex 3
property float x
property float y
property float z
element face 1
property list uchar int vertex_indices
end_header
`;
  const headerBytes = new TextEncoder().encode(header);
  const buffer = new ArrayBuffer(headerBytes.byteLength + 3 * 12 + 1 + 3 * 4);
  const bytes = new Uint8Array(buffer);
  bytes.set(headerBytes);
  const view = new DataView(buffer);
  let offset = headerBytes.byteLength;
  for (const vertex of [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0]
  ]) {
    view.setFloat32(offset, vertex[0]!, true);
    view.setFloat32(offset + 4, vertex[1]!, true);
    view.setFloat32(offset + 8, vertex[2]!, true);
    offset += 12;
  }
  view.setUint8(offset, 3);
  offset += 1;
  for (const index of [0, 1, 2]) {
    view.setInt32(offset, index, true);
    offset += 4;
  }
  return buffer;
}

function createBinaryColoredPlyFixture(): ArrayBuffer {
  const header = `ply
format binary_little_endian 1.0
element vertex 3
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
element face 1
property list uchar int vertex_indices
end_header
`;
  const headerBytes = new TextEncoder().encode(header);
  const vertexStride = 12 + 3;
  const buffer = new ArrayBuffer(headerBytes.byteLength + 3 * vertexStride + 1 + 3 * 4);
  const bytes = new Uint8Array(buffer);
  bytes.set(headerBytes);
  const view = new DataView(buffer);
  let offset = headerBytes.byteLength;
  for (const vertex of [
    [0, 0, 0, 255, 0, 0],
    [1, 0, 0, 0, 255, 0],
    [0, 1, 0, 0, 0, 255]
  ]) {
    view.setFloat32(offset, vertex[0]!, true);
    view.setFloat32(offset + 4, vertex[1]!, true);
    view.setFloat32(offset + 8, vertex[2]!, true);
    view.setUint8(offset + 12, vertex[3]!);
    view.setUint8(offset + 13, vertex[4]!);
    view.setUint8(offset + 14, vertex[5]!);
    offset += vertexStride;
  }
  view.setUint8(offset, 3);
  offset += 1;
  for (const index of [0, 1, 2]) {
    view.setInt32(offset, index, true);
    offset += 4;
  }
  return buffer;
}

function createGltfFixture(): Record<string, unknown> {
  return {
    asset: {
      version: '2.0',
      generator: 'file-previewer test'
    },
    scene: 0,
    scenes: [
      {
        nodes: [0]
      }
    ],
    nodes: [
      {
        name: 'Embedded glTF Scene'
      }
    ],
    buffers: [
      {
        uri: 'data:application/octet-stream;base64,AAAA',
        byteLength: 3
      }
    ],
    images: [
      {
        uri: 'data:image/png;base64,iVBORw0KGgo='
      }
    ]
  };
}

async function create3mfFixture(): Promise<ArrayBuffer> {
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
    <item objectid="1" transform="1 0 0 0 1 0 0 0 1 10 20 30"/>
  </build>
</model>`);
  return zip.generateAsync({ type: 'arraybuffer' });
}

async function createComponent3mfFixture(): Promise<ArrayBuffer> {
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
    <object id="2" type="model">
      <components>
        <component objectid="1" transform="1 0 0 0 1 0 0 0 1 1 2 0"/>
      </components>
    </object>
  </resources>
  <build>
    <item objectid="2" transform="1 0 0 0 1 0 0 0 1 10 20 30"/>
  </build>
</model>`);
  return zip.generateAsync({ type: 'arraybuffer' });
}

async function createExternalObject3mfFixture(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('3D/3dmodel.model', `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
  <resources>
    <object id="1" type="model">
      <components>
        <component objectid="2" p:path="/3D/Objects/object_2.model"/>
      </components>
    </object>
  </resources>
  <build>
    <item objectid="1"/>
  </build>
</model>`);
  zip.file('3D/Objects/object_2.model', `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="2" type="model">
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
</model>`);
  return zip.generateAsync({ type: 'arraybuffer' });
}

async function createColored3mfFixture(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('3D/3dmodel.model', `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <basematerials id="5">
      <base name="Red" displaycolor="#FF0000"/>
    </basematerials>
    <object id="1" type="model" pid="5" pindex="0">
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
  return zip.generateAsync({ type: 'arraybuffer' });
}

async function createTriangleColored3mfFixture(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('3D/3dmodel.model', `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <basematerials id="7">
      <base name="Red" displaycolor="#FF0000"/>
      <base name="Green" displaycolor="#00FF00"/>
      <base name="Blue" displaycolor="#0000FF"/>
    </basematerials>
    <object id="1" type="model">
      <mesh>
        <vertices>
          <vertex x="0" y="0" z="0"/>
          <vertex x="1" y="0" z="0"/>
          <vertex x="0" y="1" z="0"/>
        </vertices>
        <triangles>
          <triangle v1="0" v2="1" v3="2" pid="7" p1="0" p2="1" p3="2"/>
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1"/>
  </build>
</model>`);
  return zip.generateAsync({ type: 'arraybuffer' });
}

async function createColorGroup3mfFixture(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('3D/3dmodel.model', `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <colorgroup id="11">
      <color color="#FFFF00"/>
      <color color="#00FFFF"/>
      <color color="#FF00FF"/>
    </colorgroup>
    <object id="1" type="model">
      <mesh>
        <vertices>
          <vertex x="0" y="0" z="0"/>
          <vertex x="1" y="0" z="0"/>
          <vertex x="0" y="1" z="0"/>
        </vertices>
        <triangles>
          <triangle v1="0" v2="1" v3="2" pid="11" p1="0" p2="1" p3="2"/>
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1"/>
  </build>
</model>`);
  return zip.generateAsync({ type: 'arraybuffer' });
}

async function createTextured3mfFixture(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('3D/Texture/texture.png', new Uint8Array([137, 80, 78, 71]));
  zip.file('3D/3dmodel.model', `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <texture2d id="8" path="/3D/Texture/texture.png" contenttype="image/png"/>
    <texture2dgroup id="9" texid="8">
      <tex2coord u="0" v="0"/>
      <tex2coord u="1" v="0"/>
      <tex2coord u="0" v="1"/>
    </texture2dgroup>
    <object id="1" type="model">
      <mesh>
        <vertices>
          <vertex x="0" y="0" z="0"/>
          <vertex x="1" y="0" z="0"/>
          <vertex x="0" y="1" z="0"/>
        </vertices>
        <triangles>
          <triangle v1="0" v2="1" v3="2" pid="9" p1="0" p2="1" p3="2"/>
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1"/>
  </build>
</model>`);
  return zip.generateAsync({ type: 'arraybuffer' });
}

function createVoxFixture(): ArrayBuffer {
  const bytes = new Uint8Array(56);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, 'VOX ');
  view.setUint32(4, 150, true);
  writeAscii(bytes, 8, 'MAIN');
  view.setUint32(12, 0, true);
  view.setUint32(16, 36, true);
  writeAscii(bytes, 20, 'SIZE');
  view.setUint32(24, 12, true);
  view.setUint32(28, 0, true);
  view.setUint32(32, 1, true);
  view.setUint32(36, 1, true);
  view.setUint32(40, 1, true);
  writeAscii(bytes, 44, 'XYZI');
  view.setUint32(48, 8, true);
  view.setUint32(52, 0, true);
  return appendVoxelData(bytes.buffer);
}

function appendVoxelData(header: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(header.byteLength + 8);
  bytes.set(new Uint8Array(header), 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(header.byteLength, 1, true);
  bytes[header.byteLength + 4] = 0;
  bytes[header.byteLength + 5] = 0;
  bytes[header.byteLength + 6] = 0;
  bytes[header.byteLength + 7] = 1;
  return bytes.buffer;
}

function writeAscii(target: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    target[offset + index] = value.charCodeAt(index);
  }
}
