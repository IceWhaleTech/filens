import {
  createDefaultPreviewRoutes,
  type FormatDefinition,
  type Model3dPreviewNode,
  type Model3dPreviewState,
  type PreviewMeasurementInfo,
  type PreviewDisplayMode,
  type PreviewMaterialInfo,
  type PreviewSectionInfo,
  type PreviewDriver,
  type PreviewEventMap,
  type PreviewEventName,
  type PreviewLoadContext,
  type PreviewOptions,
  type PreviewResourceResolveResult,
  type PreviewResourceResolver,
  type PreviewSnapshotBackground,
  type PreviewSession,
  type PreviewSource
} from '@filens/core';
import {
  AmbientLight,
  Camera,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DirectionalLight,
  Line,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  Plane,
  PlaneGeometry,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Raycaster,
  ShapeUtils,
  SkinnedMesh,
  Scene,
  SkeletonHelper,
  Vector2,
  Vector3,
  WebGLRenderer,
  LoadingManager
} from 'three';
import { AMFLoader } from 'three/examples/jsm/loaders/AMFLoader.js';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GCodeLoader } from 'three/examples/jsm/loaders/GCodeLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KMZLoader } from 'three/examples/jsm/loaders/KMZLoader.js';
import { LDrawLoader } from 'three/examples/jsm/loaders/LDrawLoader.js';
import { LWOLoader } from 'three/examples/jsm/loaders/LWOLoader.js';
import { MD2Loader } from 'three/examples/jsm/loaders/MD2Loader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { NRRDLoader } from 'three/examples/jsm/loaders/NRRDLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { PCDLoader } from 'three/examples/jsm/loaders/PCDLoader.js';
import { PDBLoader } from 'three/examples/jsm/loaders/PDBLoader.js';
import { LDrawConditionalLineMaterial } from 'three/examples/jsm/materials/LDrawConditionalLineMaterial.js';
import { TDSLoader } from 'three/examples/jsm/loaders/TDSLoader.js';
import { USDZLoader } from 'three/examples/jsm/loaders/USDZLoader.js';
import { VTKLoader } from 'three/examples/jsm/loaders/VTKLoader.js';
import { VOXLoader, VOXMesh } from 'three/examples/jsm/loaders/VOXLoader.js';
import { VRMLLoader } from 'three/examples/jsm/loaders/VRMLLoader.js';
import { XYZLoader } from 'three/examples/jsm/loaders/XYZLoader.js';
import JSZip from 'jszip';
import type { OcctImporter } from 'occt-import-js';

type PreviewListenerMap = {
  [K in PreviewEventName]: Set<(payload: PreviewEventMap[K]) => void>;
};

type PreviewRenderer = {
  domElement: HTMLCanvasElement;
  setPixelRatio(value: number): void;
  setClearColor(color: number, alpha?: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  render(scene: Scene, camera: Camera): void;
  dispose(): void;
  clippingPlanes?: Plane[];
  localClippingEnabled?: boolean;
};

export interface ModelGeometry {
  positions: Float32Array;
  normals: Float32Array;
  colors?: Float32Array;
  triangleCount: number;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
}

export type StlGeometry = ModelGeometry;

export interface ModelObjectLoadResult {
  object: Object3D;
  warnings: string[];
}

export interface ModelGeometryLoadResult {
  geometry: ModelGeometry;
  warnings: string[];
}

interface Model3dPreviewMetadata {
  format?: string;
  objectCount?: number;
  meshCount?: number;
  lineCount?: number;
  pointCount?: number;
  materialCount?: number;
  materialNames?: string[];
  materialDetails?: PreviewMaterialInfo[];
  animationCount?: number;
  bounds?: {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
  };
  triangleCount?: number;
  vertexCount?: number;
  hasVertexColors?: boolean;
}

interface Model3dExplodeTarget {
  object: Object3D;
  basePosition: Vector3;
  direction: Vector3;
  distance: number;
}

interface Model3dSectionSourceGeometry {
  positions: Float32Array;
  objects?: Array<{
    object: Object3D;
    positions: Float32Array;
  }>;
}

interface PreviewMaterialRuntimeState {
  opacity: number;
  transparent: boolean;
  emissiveHex?: number;
  emissiveIntensity?: number;
  wireframe?: boolean;
  depthWrite?: boolean;
}

interface PreviewSectionBounds {
  x: [number, number];
  y: [number, number];
  z: [number, number];
}

interface Model3dSectionHelperFillData {
  positions: number[];
  indices: number[];
}

interface Model3dSectionHelperCacheEntry {
  outlinePoints: number[];
  fillData?: Model3dSectionHelperFillData;
}

type Model3dPreviewSectionInfo = PreviewSectionInfo & {
  mode?: 'single' | 'box';
  bounds?: PreviewSectionBounds;
  range?: PreviewSectionBounds;
};

type Model3dCameraInfo = NonNullable<Model3dPreviewState['camera']> & {
  projection?: 'perspective' | 'orthographic';
  viewPreset?: 'free' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'isometric';
};

type Model3dPreviewRuntimeState = Omit<Model3dPreviewState, 'section'> & {
  explode?: number;
  section?: Model3dPreviewSectionInfo;
  camera?: Model3dCameraInfo;
};

type Model3dObjectNode = Object3D & {
  userData: Object3D['userData'] & {
    previewNodeId?: string;
    previewOriginalVisible?: boolean;
    previewSelectionDimmed?: boolean;
    previewSelectionEmphasized?: boolean;
    previewMaterialKeys?: string[];
    previewEdgeHelper?: boolean;
    previewEdgeSourceId?: number;
    previewMeasurementHelper?: boolean;
  };
};

const MODEL3D_DIRECT_FORMATS = new Set(['step', 'stp', 'stl', 'obj', 'ply', 'gltf', 'glb', '3mf', 'amf', 'dae', 'fbx', '3ds', 'usdz', 'gcode', 'gco', 'nc', 'wrl', 'vrml', 'pcd', 'xyz', 'vtk', 'vox', 'ldr', 'mpd', 'kmz', 'md2', 'lwo', 'bvh', 'pdb', 'nrrd', 'nhdr']);
const VTK_HEADER_PROBE_BYTES = 250;
const MAX_SECTION_HELPER_TRIANGLES = 12000;
const MAX_SECTION_HELPER_CACHE_ENTRIES = 24;
const SECTION_HELPER_MIN_UPDATE_MS = 33;
let occtImporterPromise: Promise<OcctImporter> | null = null;

export const MODEL3D_FORMAT_ROUTES: FormatDefinition[] = [
  {
    extensions: ['step', 'stp', 'stl', 'obj', 'ply', 'gltf', 'glb', '3mf', 'amf', 'dae', 'fbx', '3ds', 'usdz', 'gcode', 'gco', 'nc', 'wrl', 'vrml', 'pcd', 'xyz', 'vtk', 'vox', 'ldr', 'mpd', 'kmz', 'md2', 'lwo', 'bvh', 'pdb', 'nrrd', 'nhdr'],
    family: 'model3d',
    driverId: 'model3d',
    targetFormat: 'model3d',
    contentTypes: [
      'model/stl',
      'model/step',
      'application/step',
      'application/x-step',
      'model/x.stl-ascii',
      'model/x.stl-binary',
      'application/vnd.ms-pki.stl',
      'model/obj',
      'model/ply',
      'application/ply',
      'model/gltf+json',
      'model/gltf-binary',
      'model/3mf',
      'model/amf',
      'application/x-amf',
      'model/vnd.collada+xml',
      'application/vnd.collada+xml',
      'model/fbx',
      'model/3ds',
      'model/vnd.usdz+zip',
      'model/usd',
      'text/x-gcode',
      'model/vrml',
      'x-world/x-vrml',
      'application/vnd.pointcloud',
      'model/vtk',
      'application/vnd.vtk',
      'model/vox',
      'application/x-magica-voxel',
      'model/vnd.ldraw',
      'text/vnd.ldraw',
      'application/x-ldraw',
      'application/vnd.google-earth.kmz',
      'application/vnd.google-earth.kmz+xml',
      'model/md2',
      'application/x-md2',
      'model/lwo',
      'application/x-lwo',
      'application/x-lightwave-object',
      'application/bvh',
      'application/x-bvh',
      'chemical/x-pdb',
      'chemical/pdb',
      'application/nrrd',
      'application/x-nrrd',
      'application/vnd.ms-package.3dmanufacturing-3dmodel+xml'
    ]
  }
];

export class Model3dPreviewSession implements PreviewSession<Model3dPreviewState> {
  private readonly listeners: PreviewListenerMap = {
    loading: new Set(),
    rendered: new Set(),
    error: new Set(),
    statechange: new Set(),
    warnings: new Set()
  };
  private readonly root: HTMLDivElement;
  private readonly stage: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private renderer: PreviewRenderer | null = null;
  private scene: Scene | null = null;
  private camera: PerspectiveCamera | OrthographicCamera | null = null;
  private modelGroup: Group | null = null;
  private geometry: BufferGeometry | null = null;
  private edgeGeometry: EdgesGeometry | null = null;
  private material: MeshStandardMaterial | null = null;
  private edgeMaterial: LineBasicMaterial | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private animationFrame = 0;
  private yaw = -35;
  private pitch = 24;
  private distance = 140;
  private modelRadius = 60;
  private baseDistance = 140;
  private baseModelRadius = 60;
  private readonly baseModelGroupPosition = new Vector3();
  private explodeTargets: Model3dExplodeTarget[] = [];
  private maxExplodeOffset = 0;
  private materialRuntimeState = new WeakMap<Material, PreviewMaterialRuntimeState>();
  private sectionSourceGeometry: Model3dSectionSourceGeometry | null = null;
  private readonly raycaster = new Raycaster();
  private readonly pointerNdc = new Vector2();
  private measurementLineGeometry: BufferGeometry | null = null;
  private measurementLineMaterial: LineBasicMaterial | null = null;
  private measurementLine: Line | null = null;
  private measurementPointsGeometry: BufferGeometry | null = null;
  private measurementPointsMaterial: PointsMaterial | null = null;
  private measurementPoints: Points | null = null;
  private sectionHelperGroup: Group | null = null;
  private sectionPlaneHelper: Mesh | null = null;
  private sectionPlaneHelperGeometry: PlaneGeometry | null = null;
  private sectionPlaneHelperMaterial: MeshBasicMaterial | null = null;
  private sectionPlaneOutlineGeometry: BufferGeometry | null = null;
  private sectionPlaneOutlineMaterial: LineBasicMaterial | null = null;
  private sectionPlaneOutline: LineSegments | null = null;
  private sectionPlaneFillGeometry: BufferGeometry | null = null;
  private sectionPlaneFillMaterial: MeshBasicMaterial | null = null;
  private sectionPlaneFill: Mesh | null = null;
  private sectionBoxFillGeometry: BufferGeometry | null = null;
  private sectionBoxFillMaterial: MeshBasicMaterial | null = null;
  private sectionBoxFill: Mesh | null = null;
  private sectionBoxHelperGeometry: BufferGeometry | null = null;
  private sectionBoxHelperMaterial: LineBasicMaterial | null = null;
  private sectionBoxHelper: LineSegments | null = null;
  private readonly sectionPlanes = [
    new Plane(new Vector3(1, 0, 0), 0),
    new Plane(new Vector3(-1, 0, 0), 0),
    new Plane(new Vector3(0, 1, 0), 0),
    new Plane(new Vector3(0, -1, 0), 0),
    new Plane(new Vector3(0, 0, 1), 0),
    new Plane(new Vector3(0, 0, -1), 0)
  ];
  private readonly sectionHelperCache = new Map<string, Model3dSectionHelperCacheEntry>();
  private appliedSectionClippingKey: string | null = null;
  private appliedSectionHelperKey: string | null = null;
  private lastSectionHelperUpdateAt = Number.NEGATIVE_INFINITY;
  private sectionBounds: PreviewSectionBounds = defaultSectionBounds();
  private measurementHoverClientX: number | null = null;
  private measurementHoverClientY: number | null = null;
  private pointerDown = false;
  private pointerStartX = 0;
  private pointerStartY = 0;
  private pointerStartYaw = 0;
  private pointerStartPitch = 0;
  private projectionMode: 'perspective' | 'orthographic' = 'perspective';
  private viewPreset: 'free' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'isometric' = 'isometric';
  private displayMode: PreviewDisplayMode = 'solid-edge';
  private snapshotBackground: PreviewSnapshotBackground = 'scene';
  private state: Model3dPreviewRuntimeState;

  constructor(private readonly host: HTMLElement, private readonly options: PreviewOptions = {}) {
    const initialScale = this.options.initialScale ?? 1;
    this.root = document.createElement('div');
    this.root.className = 'model3dv-preview';
    this.stage = document.createElement('div');
    this.stage.className = 'model3dv-stage';
    this.hint = document.createElement('div');
    this.hint.className = 'model3dv-hint';
    this.hint.textContent = 'Drag to orbit';
    this.root.replaceChildren(this.stage, this.hint);
    this.host.replaceChildren(this.root);
    this.state = {
      loading: false,
      error: null,
      family: 'model3d',
      warnings: [],
      capabilities: {
        zoom: true,
        fit: true,
        pan: true,
        orbit: true,
        fullscreen: true,
        download: true,
        modelTree: true,
        metadata: true,
        measure: false,
        section: false,
        explode: false,
        materialFilter: false
      },
      scale: Number.isFinite(initialScale) ? clamp(initialScale, 0.2, 4) : 1,
      explode: 0,
      displayMode: this.displayMode,
      snapshotBackground: this.snapshotBackground,
      measurement: {
        active: false,
        status: 'idle',
        snapMode: 'surface',
        axisLock: 'free'
      },
      section: createPreviewSectionState(),
      camera: {
        position: [0, 0, this.distance],
        target: [0, 0, 0],
        projection: this.projectionMode,
        viewPreset: this.viewPreset
      }
    };
  }

  async load(source: PreviewSource, context: PreviewLoadContext): Promise<void> {
    this.state = {
      ...this.state,
      loading: true,
      error: null,
      title: context.descriptor.name,
      warnings: [],
      explode: 0,
      modelTree: undefined,
      selectedNodeId: undefined,
      isolatedMaterialKey: undefined,
      displayMode: this.displayMode,
      snapshotBackground: this.snapshotBackground,
      measurement: {
        active: false,
        status: 'idle',
        snapMode: 'surface',
        axisLock: 'free'
      },
      section: createPreviewSectionState(),
      metadata: undefined
    };
    this.projectionMode = 'perspective';
    this.viewPreset = 'isometric';
    this.yaw = -35;
    this.pitch = 24;
    this.emit('loading', this.state);
    this.emit('statechange', this.state);

    try {
      const format = normalizeFormat(context.route?.sourceFormat ?? context.descriptor.extension);
      if (!MODEL3D_DIRECT_FORMATS.has(format)) {
        throw new Error(`3D preview currently supports browser-WASM STEP/STP plus browser-native STL, OBJ, PLY, glTF, GLB, 3MF, AMF, DAE, FBX, 3DS, USDA-backed USDZ, G-code, VRML, PCD, XYZ, VTK, VOX, LDraw, KMZ, MD2, LWO, BVH, PDB, NRRD, and NHDR files, got ${format || 'unknown'}.`);
      }

      this.disposeScene();
      const buffer = await sourceToArrayBuffer(source, context);
      if (format === 'step' || format === 'stp') {
        const object = await loadStepObject(buffer);
        this.createObjectScene(object);
        this.state = {
          ...this.state,
          loading: false,
          error: null,
          warnings: [],
          metadata: collectObjectPreviewMetadata(object, format),
          camera: this.currentCameraState()
        };
        this.emit('rendered', this.state);
        this.emit('statechange', this.state);
        return;
      }
      if (format === 'glb' || format === 'gltf') {
        const result = format === 'gltf'
          ? await loadGltfObjectWithWarnings(buffer, {
              resourcePath: gltfResourcePathForSource(source),
              resourceResolver: this.options.resourceResolver,
              sourceFormat: format,
              signal: context.signal
            })
          : {
              object: await loadGlbObject(buffer),
              warnings: []
            };
        this.createObjectScene(result.object);
        this.state = {
          ...this.state,
          loading: false,
          error: null,
          warnings: result.warnings,
          metadata: collectObjectPreviewMetadata(result.object, format),
          camera: this.currentCameraState()
        };
        if (this.state.warnings.length) {
          this.emit('warnings', this.state.warnings);
        }
        this.emit('rendered', this.state);
        this.emit('statechange', this.state);
        return;
      }
      if (format === 'obj') {
        const text = new TextDecoder().decode(buffer);
        let warnings: string[] = [];
        let metadata: Model3dPreviewMetadata;
        if (this.options.resourceResolver && listObjMaterialLibraries(text).length) {
          const result = await loadObjObjectWithWarnings(text, {
            resourceBasePath: context.descriptor.name,
            resourceResolver: this.options.resourceResolver,
            sourceFormat: format,
            signal: context.signal
          });
          warnings = result.warnings;
          metadata = collectObjectPreviewMetadata(result.object, format);
          this.createObjectScene(result.object);
        } else {
          const geometry = loadObjGeometry(text);
          metadata = collectGeometryPreviewMetadata(geometry, format);
          this.createScene(geometry);
        }
        this.state = {
          ...this.state,
          loading: false,
          error: null,
          warnings,
          metadata,
          camera: this.currentCameraState()
        };
        if (this.state.warnings.length) {
          this.emit('warnings', this.state.warnings);
        }
        this.emit('rendered', this.state);
        this.emit('statechange', this.state);
        return;
      }
      if (format === 'amf') {
        const object = loadAmfObject(buffer);
        this.createObjectScene(object);
        this.state = {
          ...this.state,
          loading: false,
          error: null,
          warnings: [],
          metadata: collectObjectPreviewMetadata(object, format),
          camera: this.currentCameraState()
        };
        this.emit('rendered', this.state);
        this.emit('statechange', this.state);
        return;
      }
      if (format === 'dae') {
        const result = loadColladaObjectWithWarnings(new TextDecoder().decode(buffer), {
          resourceBasePath: context.descriptor.name,
          resourcePath: colladaResourcePathForSource(source),
          resourceResolver: this.options.resourceResolver,
          sourceFormat: format,
          signal: context.signal
        });
        this.createObjectScene(result.object);
        this.state = {
          ...this.state,
          loading: false,
          error: null,
          warnings: result.warnings,
          metadata: collectObjectPreviewMetadata(result.object, format),
          camera: this.currentCameraState()
        };
        if (this.state.warnings.length) {
          this.emit('warnings', this.state.warnings);
        }
        this.emit('rendered', this.state);
        this.emit('statechange', this.state);
        return;
      }
      if (format === 'fbx') {
        const result = loadFbxObjectWithWarnings(buffer, {
          resourceBasePath: context.descriptor.name,
          resourcePath: modelResourcePathForSource(source),
          resourceResolver: this.options.resourceResolver,
          sourceFormat: format,
          signal: context.signal
        });
        this.createObjectScene(result.object);
        this.state = {
          ...this.state,
          loading: false,
          error: null,
          warnings: result.warnings,
          metadata: collectObjectPreviewMetadata(result.object, format),
          camera: this.currentCameraState()
        };
        if (this.state.warnings.length) {
          this.emit('warnings', this.state.warnings);
        }
        this.emit('rendered', this.state);
        this.emit('statechange', this.state);
        return;
      }
      if (format === '3ds') {
        const result = load3dsObjectWithWarnings(buffer, {
          resourceBasePath: context.descriptor.name,
          resourcePath: modelResourcePathForSource(source),
          resourceResolver: this.options.resourceResolver,
          sourceFormat: format,
          signal: context.signal
        });
        this.createObjectScene(result.object);
        this.state = {
          ...this.state,
          loading: false,
          error: null,
          warnings: result.warnings,
          metadata: collectObjectPreviewMetadata(result.object, format),
          camera: this.currentCameraState()
        };
        if (this.state.warnings.length) {
          this.emit('warnings', this.state.warnings);
        }
        this.emit('rendered', this.state);
        this.emit('statechange', this.state);
        return;
      }
      if (format === 'usdz') {
        const object = await loadUsdzObject(buffer);
        this.createObjectScene(object);
        this.state = {
          ...this.state,
          loading: false,
          error: null,
          warnings: [],
          metadata: collectObjectPreviewMetadata(object, format),
          camera: this.currentCameraState()
        };
        this.emit('rendered', this.state);
        this.emit('statechange', this.state);
        return;
      }
      if (format === 'gcode' || format === 'gco' || format === 'nc') {
        const object = loadGCodeObject(new TextDecoder().decode(buffer));
        this.createObjectScene(object);
        this.state = {
          ...this.state,
          loading: false,
          error: null,
          warnings: [],
          metadata: collectObjectPreviewMetadata(object, format),
          camera: this.currentCameraState()
        };
        this.emit('rendered', this.state);
        this.emit('statechange', this.state);
        return;
      }
      if (format === 'wrl' || format === 'vrml') {
        const result = loadVrmlObjectWithWarnings(new TextDecoder().decode(buffer), {
          resourceBasePath: context.descriptor.name,
          resourcePath: modelResourcePathForSource(source),
          resourceResolver: this.options.resourceResolver,
          sourceFormat: format,
          signal: context.signal
        });
        this.createObjectScene(result.object);
        this.state = {
          ...this.state,
          loading: false,
          error: null,
          warnings: result.warnings,
          metadata: collectObjectPreviewMetadata(result.object, format),
          camera: this.currentCameraState()
        };
        if (this.state.warnings.length) {
          this.emit('warnings', this.state.warnings);
        }
        this.emit('rendered', this.state);
        this.emit('statechange', this.state);
        return;
      }
      if (format === 'pcd') {
        const object = loadPcdObject(buffer);
        this.createObjectScene(object);
        this.state = {
          ...this.state,
          loading: false,
          error: null,
          warnings: [],
          metadata: collectObjectPreviewMetadata(object, format),
          camera: this.currentCameraState()
        };
        this.emit('rendered', this.state);
        this.emit('statechange', this.state);
        return;
      }
      if (format === 'xyz') {
        const object = loadXyzObject(new TextDecoder().decode(buffer));
        this.createObjectScene(object);
        this.state = {
          ...this.state,
          loading: false,
          error: null,
          warnings: [],
          metadata: collectObjectPreviewMetadata(object, format),
          camera: this.currentCameraState()
        };
        this.emit('rendered', this.state);
        this.emit('statechange', this.state);
        return;
      }
      if (format === 'vtk') {
        const object = loadVtkObject(buffer);
        this.createObjectScene(object);
        this.state = {
          ...this.state,
          loading: false,
          error: null,
          warnings: [],
          metadata: collectObjectPreviewMetadata(object, format),
          camera: this.currentCameraState()
        };
        this.emit('rendered', this.state);
        this.emit('statechange', this.state);
        return;
      }
      if (format === 'vox') {
        const object = loadVoxObject(buffer);
        this.createObjectScene(object);
        this.state = {
          ...this.state,
          loading: false,
          error: null,
          warnings: [],
          metadata: collectObjectPreviewMetadata(object, format),
          camera: this.currentCameraState()
        };
        this.emit('rendered', this.state);
        this.emit('statechange', this.state);
        return;
      }
      if (format === 'ldr' || format === 'mpd') {
        const result = await loadLDrawObjectWithWarnings(new TextDecoder().decode(buffer), {
          resourceBasePath: context.descriptor.name,
          resourceResolver: this.options.resourceResolver,
          sourceFormat: format,
          signal: context.signal
        });
        this.createObjectScene(result.object);
        this.state = {
          ...this.state,
          loading: false,
          error: null,
          warnings: result.warnings,
          metadata: collectObjectPreviewMetadata(result.object, format),
          camera: this.currentCameraState()
        };
        if (this.state.warnings.length) {
          this.emit('warnings', this.state.warnings);
        }
        this.emit('rendered', this.state);
        this.emit('statechange', this.state);
        return;
      }
      if (format === 'kmz') {
        const result = await loadKmzObjectWithWarnings(buffer);
        this.createObjectScene(result.object);
        this.state = {
          ...this.state,
          loading: false,
          error: null,
          warnings: result.warnings,
          metadata: collectObjectPreviewMetadata(result.object, format),
          camera: this.currentCameraState()
        };
        if (this.state.warnings.length) {
          this.emit('warnings', this.state.warnings);
        }
        this.emit('rendered', this.state);
        this.emit('statechange', this.state);
        return;
      }
      if (format === 'md2') {
        const object = loadMd2Object(buffer);
        this.createObjectScene(object);
        this.state = {
          ...this.state,
          loading: false,
          error: null,
          warnings: [],
          metadata: collectObjectPreviewMetadata(object, format),
          camera: this.currentCameraState()
        };
        this.emit('rendered', this.state);
        this.emit('statechange', this.state);
        return;
      }
      if (format === 'lwo') {
        const result = loadLwoObjectWithWarnings(buffer, {
          resourceBasePath: context.descriptor.name,
          resourcePath: modelResourcePathForSource(source),
          modelName: modelNameForSource(context.descriptor.name),
          resourceResolver: this.options.resourceResolver,
          sourceFormat: format,
          signal: context.signal
        });
        this.createObjectScene(result.object);
        this.state = {
          ...this.state,
          loading: false,
          error: null,
          warnings: result.warnings,
          metadata: collectObjectPreviewMetadata(result.object, format),
          camera: this.currentCameraState()
        };
        if (this.state.warnings.length) {
          this.emit('warnings', this.state.warnings);
        }
        this.emit('rendered', this.state);
        this.emit('statechange', this.state);
        return;
      }
      if (format === 'bvh') {
        const object = loadBvhObject(new TextDecoder().decode(buffer));
        this.createObjectScene(object);
        this.state = {
          ...this.state,
          loading: false,
          error: null,
          warnings: [],
          metadata: collectObjectPreviewMetadata(object, format),
          camera: this.currentCameraState()
        };
        this.emit('rendered', this.state);
        this.emit('statechange', this.state);
        return;
      }
      if (format === 'pdb') {
        const object = loadPdbObject(new TextDecoder().decode(buffer));
        this.createObjectScene(object);
        this.state = {
          ...this.state,
          loading: false,
          error: null,
          warnings: [],
          metadata: collectObjectPreviewMetadata(object, format),
          camera: this.currentCameraState()
        };
        this.emit('rendered', this.state);
        this.emit('statechange', this.state);
        return;
      }
      if (format === 'nrrd' || format === 'nhdr') {
        const nrrdBuffer = format === 'nhdr'
          ? await resolveNhdrBuffer(new TextDecoder().decode(buffer), {
              resourceBasePath: context.descriptor.name,
              resourceResolver: this.options.resourceResolver,
              sourceFormat: format,
              signal: context.signal
            })
          : buffer;
        const object = loadNrrdObject(nrrdBuffer);
        this.createObjectScene(object);
        this.state = {
          ...this.state,
          loading: false,
          error: null,
          warnings: [],
          metadata: collectObjectPreviewMetadata(object, format),
          camera: this.currentCameraState()
        };
        this.emit('rendered', this.state);
        this.emit('statechange', this.state);
        return;
      }
      const result = format === '3mf'
        ? await load3mfGeometryWithWarnings(buffer)
        : {
            geometry: format === 'ply' ? loadPlyGeometry(buffer) : loadStlGeometry(buffer),
            warnings: []
          };
      const geometry = result.geometry;
      this.createScene(geometry);
      this.state = {
        ...this.state,
        loading: false,
        error: null,
        warnings: result.warnings,
        metadata: collectGeometryPreviewMetadata(result.geometry, format),
        camera: this.currentCameraState()
      };
      if (this.state.warnings.length) {
        this.emit('warnings', this.state.warnings);
      }
      this.emit('rendered', this.state);
      this.emit('statechange', this.state);
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      this.state.loading = false;
      this.state.error = normalizedError.message;
      this.emit('error', normalizedError);
      this.emit('statechange', this.state);
      throw normalizedError;
    }
  }

  destroy(): void {
    this.disposeScene();
    this.stage.replaceChildren();
    this.root.replaceChildren();
    if (this.root.parentElement === this.host) {
      this.host.replaceChildren();
    }
  }

  getState(): Model3dPreviewState {
    return {
      ...this.state,
      warnings: [...this.state.warnings],
      modelTree: this.state.modelTree ? cloneModelTree(this.state.modelTree) : undefined,
      layers: [...(this.state.layers ?? [])],
      activeLayerIds: [...(this.state.activeLayerIds ?? [])],
      metadata: this.state.metadata
        ? {
            ...this.state.metadata,
            materialNames: [...(this.state.metadata.materialNames ?? [])],
            materialDetails: cloneMaterialDetails(this.state.metadata.materialDetails),
            bounds: this.state.metadata.bounds
              ? {
                  ...this.state.metadata.bounds,
                  min: [...this.state.metadata.bounds.min] as [number, number, number],
                  max: [...this.state.metadata.bounds.max] as [number, number, number],
                  size: [...this.state.metadata.bounds.size] as [number, number, number]
                }
              : undefined
          }
        : undefined,
      isolatedMaterialKey: this.state.isolatedMaterialKey,
      displayMode: this.state.displayMode,
      snapshotBackground: this.state.snapshotBackground,
      measurement: cloneMeasurementState(this.state.measurement),
      section: cloneSectionState(this.state.section),
      camera: this.state.camera ? { ...this.state.camera } : undefined
    };
  }

  on<T extends PreviewEventName>(event: T, handler: (payload: PreviewEventMap[T]) => void): () => void {
    this.listeners[event].add(handler as never);
    return () => {
      this.listeners[event].delete(handler as never);
    };
  }

  setScale(scale: number): void {
    if (!Number.isFinite(scale)) {
      return;
    }
    const nextScale = Math.max(0.2, Math.min(scale, 4));
    if (this.state.scale === nextScale) {
      return;
    }
    this.state.scale = nextScale;
    this.distance = Math.max(this.modelRadius * 1.25, (this.modelRadius * 2.6) / this.state.scale);
    this.updateCamera();
    this.emit('statechange', this.state);
  }

  fit(): void {
    this.setScale(1);
  }

  pan(deltaX: number, deltaY: number): void {
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
      return;
    }
    this.yaw += deltaX * 0.35;
    this.pitch = clamp(this.pitch + deltaY * 0.25, -80, 80);
    this.viewPreset = 'free';
    this.updateCamera();
    this.emit('statechange', this.state);
  }

  selectNode(nodeId?: string): void {
    if (this.state.selectedNodeId === nodeId) {
      return;
    }
    this.state.selectedNodeId = nodeId;
    this.applyAppearanceState();
    this.focusNode(nodeId);
    this.emit('statechange', this.state);
  }

  setNodeVisibility(nodeId: string, visible: boolean): void {
    this.toggleNodeVisibility(nodeId, visible);
  }

  toggleNodeVisibility(nodeId: string, visible?: boolean): void {
    if (!this.modelGroup || !this.state.modelTree?.length) {
      return;
    }
    const targetObject = this.findNodeObject(nodeId);
    if (!targetObject) {
      return;
    }

    const nextVisible = typeof visible === 'boolean'
      ? visible
      : !Boolean(targetObject.userData.previewOriginalVisible ?? targetObject.visible);
    if (Boolean(targetObject.userData.previewOriginalVisible ?? targetObject.visible) === nextVisible) {
      return;
    }
    this.applyNodeVisibility(targetObject, nextVisible);
    this.state.modelTree = setModelTreeNodeVisibility(this.state.modelTree, nodeId, nextVisible);

    if (this.state.selectedNodeId) {
      const selectedNode = findModelTreeNode(this.state.modelTree, this.state.selectedNodeId);
      if (!selectedNode?.visible) {
        this.state.selectedNodeId = undefined;
        this.applyAppearanceState();
        this.focusNode(undefined);
      } else {
        this.applyAppearanceState();
      }
    } else {
      this.applyAppearanceState();
    }
    this.clearSectionHelperCache();

    this.emit('statechange', this.state);
  }

  setExplode(amount: number): void {
    if (!Number.isFinite(amount)) {
      return;
    }
    if (!this.explodeTargets.length) {
      this.state.explode = 0;
      return;
    }
    const nextAmount = clamp(amount, 0, 1);
    if ((this.state.explode ?? 0) === nextAmount) {
      return;
    }
    this.state.explode = nextAmount;
    this.applyExplode(this.state.explode);
    this.focusNode(this.state.selectedNodeId);
    this.emit('statechange', this.state);
  }

  setActiveMaterial(materialKey?: string): void {
    const nextMaterialKey = materialKey || undefined;
    if (this.state.isolatedMaterialKey === nextMaterialKey) {
      return;
    }
    this.state.isolatedMaterialKey = nextMaterialKey;
    this.applyAppearanceState();
    this.clearSectionHelperCache();
    this.focusNode(this.state.selectedNodeId);
    this.emit('statechange', this.state);
  }

  setMeasurementActive(active: boolean): void {
    const measurement = cloneMeasurementState(this.state.measurement) ?? {
      active: false,
      status: 'idle' as const,
      snapMode: 'surface' as const,
      axisLock: 'free' as const
    };
    const nextMeasurement: PreviewMeasurementInfo = {
      ...measurement,
      active,
      status: active
        ? measurement.start
          ? measurement.end
            ? 'complete'
            : 'pick-end'
          : 'pick-start'
        : measurement.start && measurement.end
          ? 'complete'
          : measurement.start
            ? 'pick-end'
            : 'idle'
    };
    if (!active) {
      nextMeasurement.previewPoint = undefined;
      nextMeasurement.previewDelta = undefined;
      nextMeasurement.previewDistance = undefined;
    }
    if (areMeasurementsEquivalent(this.state.measurement, nextMeasurement)) {
      return;
    }
    this.state.measurement = nextMeasurement;
    this.updateMeasurementHelpers();
    this.emit('statechange', this.state);
  }

  clearMeasurement(): void {
    const nextMeasurement: PreviewMeasurementInfo = {
      active: false,
      status: 'idle',
      snapMode: this.state.measurement?.snapMode ?? 'surface',
      axisLock: this.state.measurement?.axisLock ?? 'free',
      previewPoint: undefined,
      previewDelta: undefined,
      previewDistance: undefined
    };
    if (areMeasurementsEquivalent(this.state.measurement, nextMeasurement)) {
      return;
    }
    this.state.measurement = nextMeasurement;
    this.updateMeasurementHelpers();
    this.emit('statechange', this.state);
  }

  private ensureSectionState(): Model3dPreviewSectionInfo {
    const existing = this.state.section;
    if (existing) {
      return normalizeSectionState(existing, this.sectionBounds);
    }
    return createPreviewSectionState(this.sectionBounds);
  }

  setMeasurementSnapMode(mode: 'surface' | 'vertex'): void {
    const measurement = this.state.measurement ?? {
      active: false,
      status: 'idle' as const,
      snapMode: 'surface' as const,
      axisLock: 'free' as const
    };
    if ((measurement.snapMode ?? 'surface') === mode) {
      return;
    }
    measurement.snapMode = mode;
    this.state.measurement = measurement;
    this.refreshMeasurementHover();
    this.updateMeasurementHelpers();
    this.emit('statechange', this.state);
  }

  setMeasurementAxisLock(axis: 'free' | 'x' | 'y' | 'z'): void {
    const measurement = this.state.measurement ?? {
      active: false,
      status: 'idle' as const,
      snapMode: 'surface' as const,
      axisLock: 'free' as const
    };
    if ((measurement.axisLock ?? 'free') === axis) {
      return;
    }
    measurement.axisLock = axis;
    this.state.measurement = measurement;
    this.refreshMeasurementHover();
    this.updateMeasurementHelpers();
    this.emit('statechange', this.state);
  }

  setSectionActive(active: boolean): void {
    const section = this.ensureSectionState();
    if (section.active === active) {
      return;
    }
    section.active = active;
    this.state.section = section;
    this.updateSectionPlanes();
    this.emit('statechange', this.state);
  }

  setSectionMode(mode: 'single' | 'box'): void {
    const section = this.ensureSectionState();
    if ((section.mode ?? 'single') === mode) {
      return;
    }
    section.mode = mode;
    this.state.section = normalizeSectionState(section, this.sectionBounds);
    this.updateSectionPlanes();
    this.emit('statechange', this.state);
  }

  setSectionAxis(axis: 'x' | 'y' | 'z'): void {
    const section = this.ensureSectionState();
    if (section.axis === axis) {
      return;
    }
    const [min, max] = this.sectionBounds[axis];
    section.axis = axis;
    section.min = roundPreviewNumber(min);
    section.max = roundPreviewNumber(max);
    section.offset = clamp(section.offset, section.min, section.max);
    this.state.section = section;
    this.updateSectionPlanes();
    this.emit('statechange', this.state);
  }

  setSectionOffset(offset: number): void {
    if (!Number.isFinite(offset)) {
      return;
    }
    const section = this.ensureSectionState();
    const nextOffset = roundPreviewNumber(clamp(offset, section.min, section.max));
    if (section.offset === nextOffset) {
      return;
    }
    section.offset = nextOffset;
    this.state.section = section;
    this.updateSectionPlanes();
    this.emit('statechange', this.state);
  }

  setSectionRange(axis: 'x' | 'y' | 'z', min: number, max: number): void {
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return;
    }
    const section = this.ensureSectionState();
    const bounds = this.sectionBounds[axis];
    const nextMin = clamp(Math.min(min, max), bounds[0], bounds[1]);
    const nextMax = clamp(Math.max(min, max), bounds[0], bounds[1]);
    const normalizedRange: [number, number] = [roundPreviewNumber(nextMin), roundPreviewNumber(nextMax)];
    const currentRange = section.range?.[axis];
    if (currentRange && currentRange[0] === normalizedRange[0] && currentRange[1] === normalizedRange[1]) {
      return;
    }
    section.range = {
      ...(section.range ?? sectionRangeFromBounds(this.sectionBounds)),
      [axis]: normalizedRange
    };
    this.state.section = normalizeSectionState(section, this.sectionBounds);
    this.updateSectionPlanes();
    this.emit('statechange', this.state);
  }

  clearSection(): void {
    const section = createPreviewSectionState(this.sectionBounds);
    if (areSectionsEquivalent(this.state.section, section)) {
      return;
    }
    this.state.section = section;
    this.updateSectionPlanes();
    this.emit('statechange', this.state);
  }

  setCameraProjection(projection: 'perspective' | 'orthographic'): void {
    if (this.projectionMode === projection) {
      return;
    }
    this.projectionMode = projection;
    this.replaceCamera();
    this.updateCamera();
    this.emit('statechange', this.state);
  }

  setCameraViewPreset(
    preset: 'free' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'isometric'
  ): void {
    if (this.viewPreset === preset) {
      return;
    }
    this.viewPreset = preset;
    const angles = viewPresetAngles(preset);
    if (angles) {
      this.yaw = angles.yaw;
      this.pitch = angles.pitch;
    }
    this.updateCamera();
    this.emit('statechange', this.state);
  }

  setDisplayMode(mode: PreviewDisplayMode): void {
    if (this.displayMode === mode) {
      return;
    }
    this.displayMode = mode;
    this.state.displayMode = mode;
    this.applyAppearanceState();
    this.emit('statechange', this.state);
  }

  setSnapshotBackground(background: PreviewSnapshotBackground): void {
    if (this.snapshotBackground === background) {
      return;
    }
    this.snapshotBackground = background;
    this.state.snapshotBackground = background;
    this.emit('statechange', this.state);
  }

  downloadSnapshot(filename?: string, background?: PreviewSnapshotBackground): void {
    if (typeof document === 'undefined') {
      return;
    }
    const renderer = this.renderer;
    const canvas = renderer?.domElement;
    const scene = this.scene;
    const camera = this.camera;
    if (!canvas || !renderer || !scene || !camera) {
      return;
    }
    const restoreBackground = this.applySceneBackground(background ?? this.snapshotBackground);
    renderer.render(scene, camera);
    const href = canvas.toDataURL('image/png');
    restoreBackground();
    renderer.render(scene, camera);
    const link = document.createElement('a');
    link.href = href;
    link.download = normalizeSnapshotFilename(filename ?? this.state.title);
    link.rel = 'noopener';
    link.click();
  }

  async fullscreen(): Promise<void> {
    await this.root.requestFullscreen?.();
  }

  private createScene(model: ModelGeometry): void {
    const renderer = createRendererOrFallback({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x111827, 1);
    renderer.localClippingEnabled = true;
    renderer.clippingPlanes = [];
    renderer.domElement.className = 'model3dv-canvas';
    this.stage.replaceChildren(renderer.domElement);

    const scene = new Scene();
    scene.background = new Color(0x111827);
    const camera = this.createCamera();
    const modelGroup = new Group();
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(model.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(model.normals, 3));
    if (model.colors) {
      geometry.setAttribute('color', new BufferAttribute(model.colors, 3));
    }
    geometry.computeBoundingSphere();

    const center = boundsCenter(model.bounds);
    const size = boundsSize(model.bounds);
    this.modelRadius = Math.max(size.x, size.y, size.z, 1) * 0.72;
    this.baseModelRadius = this.modelRadius;
    this.distance = this.modelRadius * 2.6;
    this.baseDistance = this.distance;
    modelGroup.position.set(-center.x, -center.y, -center.z);
    this.baseModelGroupPosition.copy(modelGroup.position);

    const material = new MeshStandardMaterial({
      color: model.colors ? 0xffffff : 0x7dd3fc,
      roughness: 0.55,
      metalness: 0.08,
      vertexColors: Boolean(model.colors)
    });
    const mesh = new Mesh(geometry, material);
    modelGroup.add(mesh);

    const edgeGeometry = new EdgesGeometry(geometry, 35);
    const edgeMaterial = new LineBasicMaterial({
      color: 0xdbeafe,
      transparent: true,
      opacity: 0.22
    });
    const edges = new LineSegments(edgeGeometry, edgeMaterial);
    const previewEdges = edges as Model3dObjectNode;
    previewEdges.userData.previewEdgeHelper = true;
    previewEdges.userData.previewEdgeSourceId = mesh.id;
    previewEdges.userData.previewOriginalVisible = true;
    modelGroup.add(edges);

    scene.add(new AmbientLight(0xffffff, 0.48));
    const key = new DirectionalLight(0xffffff, 1.4);
    key.position.set(1, 1.6, 1.3);
    scene.add(key);
    const fill = new DirectionalLight(0x93c5fd, 0.8);
    fill.position.set(-1.5, 0.8, -1);
    scene.add(fill);
    scene.add(modelGroup);

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.modelGroup = modelGroup;
    this.geometry = geometry;
    this.edgeGeometry = edgeGeometry;
    this.material = material;
    this.edgeMaterial = edgeMaterial;
    this.clearSectionHelperCache();
    this.sectionSourceGeometry = {
      positions: sampleTrianglePositions(model.positions, MAX_SECTION_HELPER_TRIANGLES)
    };
    this.explodeTargets = [];
    this.maxExplodeOffset = 0;
    this.sectionBounds = sectionBoundsFromCenteredBounds(model.bounds, center);
    this.state.modelTree = undefined;
    this.state.selectedNodeId = undefined;
    this.state.isolatedMaterialKey = undefined;
    this.state.explode = 0;
    this.state.displayMode = this.displayMode;
    this.state.snapshotBackground = this.snapshotBackground;
    this.state.measurement = {
      active: false,
      status: 'idle',
      snapMode: 'surface',
      axisLock: 'free'
    };
    this.state.section = createPreviewSectionState(this.sectionBounds);
    this.state.capabilities.measure = true;
    this.state.capabilities.section = true;
    this.state.capabilities.explode = false;
    this.state.capabilities.materialFilter = false;
    this.state.capabilities.displayMode = true;
    this.captureMaterialRuntimeState(modelGroup);
    this.applyAppearanceState();
    this.setupMeasurementHelpers(modelGroup);
    this.bindInteractions(renderer.domElement);
    this.observeResize();
    this.resize();
    this.updateSectionPlanes();
    this.updateCamera();
    this.startAnimation();
  }

  private createObjectScene(object: Object3D): void {
    const renderer = createRendererOrFallback({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x111827, 1);
    renderer.localClippingEnabled = true;
    renderer.clippingPlanes = [];
    renderer.domElement.className = 'model3dv-canvas';
    this.stage.replaceChildren(renderer.domElement);

    const scene = new Scene();
    scene.background = new Color(0x111827);
    const camera = this.createCamera();
    const modelGroup = new Group();
    modelGroup.add(object);
    scene.add(new AmbientLight(0xffffff, 0.62));
    const key = new DirectionalLight(0xffffff, 1.45);
    key.position.set(1, 1.6, 1.3);
    scene.add(key);
    const fill = new DirectionalLight(0x93c5fd, 0.7);
    fill.position.set(-1.5, 0.8, -1);
    scene.add(fill);
    scene.add(modelGroup);

    const bounds = new Box3().setFromObject(object);
    const center = bounds.getCenter(new Vector3());
    const size = bounds.getSize(new Vector3());
    this.modelRadius = Math.max(size.x, size.y, size.z, 1) * 0.72;
    this.baseModelRadius = this.modelRadius;
    this.distance = this.modelRadius * 2.6;
    this.baseDistance = this.distance;
    object.position.sub(center);
    this.sectionBounds = sectionBoundsFromObject(object);
    this.baseModelGroupPosition.copy(modelGroup.position);
    this.explodeTargets = createExplodeTargets(object, this.baseModelRadius);
    this.maxExplodeOffset = this.explodeTargets.reduce((max, target) => Math.max(max, target.distance), 0);
    this.state.modelTree = buildModelTree(object);
    this.state.selectedNodeId = undefined;
    this.state.isolatedMaterialKey = undefined;
    this.state.explode = 0;
    this.state.displayMode = this.displayMode;
    this.state.snapshotBackground = this.snapshotBackground;
    this.state.measurement = {
      active: false,
      status: 'idle',
      snapMode: 'surface',
      axisLock: 'free'
    };
    this.state.section = createPreviewSectionState(this.sectionBounds);
    this.state.capabilities.measure = true;
    this.state.capabilities.section = true;
    this.state.capabilities.explode = this.explodeTargets.length > 1;
    this.state.capabilities.materialFilter = objectHasMaterialDetails(object);
    this.state.capabilities.displayMode = true;
    this.attachEdgeHelpers(object);
    this.captureMaterialRuntimeState(object);
    this.applyExplode(0);
    this.applyAppearanceState();
    this.setupMeasurementHelpers(modelGroup);

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.modelGroup = modelGroup;
    this.clearSectionHelperCache();
    this.sectionSourceGeometry = {
      positions: new Float32Array(),
      objects: collectSectionObjectGeometries(object, MAX_SECTION_HELPER_TRIANGLES)
    };
    this.bindInteractions(renderer.domElement);
    this.observeResize();
    this.resize();
    this.updateSectionPlanes();
    this.updateCamera();
    this.startAnimation();
  }

  private bindInteractions(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', (event) => {
      this.pointerDown = true;
      this.pointerStartX = event.clientX;
      this.pointerStartY = event.clientY;
      this.pointerStartYaw = this.yaw;
      this.pointerStartPitch = this.pitch;
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if ((this.state.measurement?.active ?? false) && !this.pointerDown) {
        this.measurementHoverClientX = event.clientX;
        this.measurementHoverClientY = event.clientY;
        this.updateMeasurementHover(event.clientX, event.clientY);
      }
      if (!this.pointerDown) {
        return;
      }
      this.yaw = this.pointerStartYaw + (event.clientX - this.pointerStartX) * 0.35;
      this.pitch = clamp(this.pointerStartPitch + (event.clientY - this.pointerStartY) * 0.25, -80, 80);
      this.updateCamera();
    });
    canvas.addEventListener('pointerup', (event) => {
      const moved = Math.hypot(event.clientX - this.pointerStartX, event.clientY - this.pointerStartY);
      this.pointerDown = false;
      if ((this.state.measurement?.active ?? false) && moved <= 4) {
        this.pickMeasurementPoint(event.clientX, event.clientY);
      }
      canvas.releasePointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointercancel', () => {
      this.pointerDown = false;
    });
    canvas.addEventListener('pointerleave', () => {
      this.measurementHoverClientX = null;
      this.measurementHoverClientY = null;
      this.clearMeasurementHover();
    });
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.setScale(this.state.scale + (event.deltaY > 0 ? -0.08 : 0.08));
    }, { passive: false });
  }

  private observeResize(): void {
    this.resizeObserver?.disconnect();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.stage);
      return;
    }
    window.addEventListener('resize', this.resize);
  }

  private resize = (): void => {
    if (!this.renderer || !this.camera) {
      return;
    }
    const rect = this.stage.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width || this.stage.clientWidth || 1));
    const height = Math.max(1, Math.floor(rect.height || this.stage.clientHeight || 1));
    if (this.camera instanceof PerspectiveCamera) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    } else {
      const aspect = width / height;
      const halfHeight = Math.max(this.modelRadius, 1) * 1.35;
      const halfWidth = halfHeight * aspect;
      this.camera.left = -halfWidth;
      this.camera.right = halfWidth;
      this.camera.top = halfHeight;
      this.camera.bottom = -halfHeight;
      this.camera.updateProjectionMatrix();
    }
    this.renderer.setSize(width, height, false);
  };

  private startAnimation(): void {
    const animate = () => {
      this.animationFrame = requestAnimationFrame(animate);
      this.renderFrame();
    };
    animate();
  }

  private renderFrame(): void {
    if (!this.renderer || !this.scene || !this.camera || !this.modelGroup) {
      return;
    }
    if (!(this.state.measurement?.active ?? false) && !(this.state.section?.active ?? false)) {
      this.modelGroup.rotation.y += 0.002;
    }
    this.updateSectionPlanes();
    this.renderer.render(this.scene, this.camera);
  }

  private createCamera(): PerspectiveCamera | OrthographicCamera {
    return this.projectionMode === 'orthographic'
      ? new OrthographicCamera(-100, 100, 100, -100, 0.1, 100000)
      : new PerspectiveCamera(45, 1, 0.1, 100000);
  }

  private replaceCamera(): void {
    const previousPosition = this.camera?.position.clone() ?? new Vector3(0, 0, this.distance);
    this.camera = this.createCamera();
    this.camera.position.copy(previousPosition);
    this.resize();
  }

  private updateCamera(): void {
    if (!this.camera) {
      return;
    }
    const yaw = degToRad(this.yaw);
    const pitch = degToRad(this.pitch);
    this.camera.position.set(
      this.distance * Math.cos(pitch) * Math.sin(yaw),
      this.distance * Math.sin(pitch),
      this.distance * Math.cos(pitch) * Math.cos(yaw)
    );
    this.camera.lookAt(0, 0, 0);
    this.resize();
    this.state.camera = this.currentCameraState();
  }

  private currentCameraState(): Model3dCameraInfo {
    const position = this.camera?.position ?? new Vector3(0, 0, this.distance);
    return {
      position: [position.x, position.y, position.z],
      target: [0, 0, 0],
      projection: this.projectionMode,
      viewPreset: this.viewPreset
    };
  }

  private applyExplode(amount: number): void {
    if (this.explodeTargets.length) {
      this.clearSectionHelperCache();
    }
    for (const target of this.explodeTargets) {
      target.object.position.copy(target.basePosition).addScaledVector(target.direction, target.distance * amount);
    }
  }

  private setupMeasurementHelpers(modelGroup: Group): void {
    const lineGeometry = new BufferGeometry();
    lineGeometry.setAttribute('position', new Float32BufferAttribute([
      0, 0, 0,
      0, 0, 0
    ], 3));
    const lineMaterial = new LineBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.95
    });
    const line = new Line(lineGeometry, lineMaterial);
    line.visible = false;
    line.userData.previewMeasurementHelper = true;

    const pointsGeometry = new BufferGeometry();
    pointsGeometry.setAttribute('position', new Float32BufferAttribute([
      0, 0, 0,
      0, 0, 0
    ], 3));
    const pointsMaterial = new PointsMaterial({
      color: 0xfbbf24,
      size: Math.max(this.baseModelRadius * 0.045, 0.8),
      sizeAttenuation: true
    });
    const points = new Points(pointsGeometry, pointsMaterial);
    points.visible = false;
    points.userData.previewMeasurementHelper = true;

    modelGroup.add(line);
    modelGroup.add(points);

    this.measurementLineGeometry = lineGeometry;
    this.measurementLineMaterial = lineMaterial;
    this.measurementLine = line;
    this.measurementPointsGeometry = pointsGeometry;
    this.measurementPointsMaterial = pointsMaterial;
    this.measurementPoints = points;
    this.updateMeasurementHelpers();
  }

  private pickMeasurementPoint(clientX: number, clientY: number): void {
    this.measurementHoverClientX = clientX;
    this.measurementHoverClientY = clientY;
    const point = this.resolveMeasurementPoint(clientX, clientY);
    if (!point) {
      return;
    }
    this.applyMeasurementPoint(point);
  }

  private updateMeasurementHover(clientX: number, clientY: number): void {
    const measurement = this.state.measurement;
    if (!measurement?.active) {
      return;
    }
    const point = this.resolveMeasurementPoint(clientX, clientY);
    if (!point) {
      this.clearMeasurementHover();
      return;
    }
    this.applyMeasurementPreviewPoint(point);
  }

  private applyMeasurementPreviewPoint(point: Vector3): void {
    const measurement = this.state.measurement;
    if (!measurement?.active) {
      return;
    }
    if (measurement.start) {
      const start = new Vector3(...measurement.start);
      const previewPoint = applyMeasurementAxisLock(point, start, measurement.axisLock ?? 'free');
      const previewDelta = previewPoint.clone().sub(start);
      const nextPreviewPoint = vector3Tuple(previewPoint);
      const nextPreviewDelta = vector3Tuple(previewDelta);
      const nextPreviewDistance = roundPreviewNumber(previewDelta.length());
      if (
        arePreviewVectorTuplesEquivalent(measurement.previewPoint, nextPreviewPoint)
        && arePreviewVectorTuplesEquivalent(measurement.previewDelta, nextPreviewDelta)
        && measurement.previewDistance === nextPreviewDistance
        && measurement.status === 'pick-end'
      ) {
        return;
      }
      measurement.previewPoint = nextPreviewPoint;
      measurement.previewDelta = nextPreviewDelta;
      measurement.previewDistance = nextPreviewDistance;
      measurement.status = 'pick-end';
    } else {
      const nextPreviewPoint = vector3Tuple(point);
      if (
        arePreviewVectorTuplesEquivalent(measurement.previewPoint, nextPreviewPoint)
        && measurement.previewDelta == null
        && measurement.previewDistance == null
        && measurement.status === 'pick-start'
      ) {
        return;
      }
      measurement.previewPoint = nextPreviewPoint;
      measurement.previewDelta = undefined;
      measurement.previewDistance = undefined;
      measurement.status = 'pick-start';
    }
    this.updateMeasurementHelpers();
    this.emit('statechange', this.state);
  }

  private refreshMeasurementHover(): void {
    if (this.measurementHoverClientX == null || this.measurementHoverClientY == null) {
      return;
    }
    this.updateMeasurementHover(this.measurementHoverClientX, this.measurementHoverClientY);
  }

  private clearMeasurementHover(): void {
    const measurement = this.state.measurement;
    if (!measurement) {
      return;
    }
    const nextStatus = measurement.active
      ? measurement.start
        ? 'pick-end'
        : 'pick-start'
      : measurement.status;
    if (
      measurement.previewPoint == null
      && measurement.previewDelta == null
      && measurement.previewDistance == null
      && measurement.status === nextStatus
    ) {
      return;
    }
    measurement.previewPoint = undefined;
    measurement.previewDelta = undefined;
    measurement.previewDistance = undefined;
    if (measurement.active) {
      measurement.status = nextStatus;
    }
    this.updateMeasurementHelpers();
    this.emit('statechange', this.state);
  }

  private resolveMeasurementPoint(clientX: number, clientY: number): Vector3 | undefined {
    if (!this.renderer || !this.camera || !this.modelGroup) {
      return undefined;
    }
    const rect = this.renderer.domElement.getBoundingClientRect();
    const width = rect.width || 1;
    const height = rect.height || 1;
    this.pointerNdc.set(
      ((clientX - rect.left) / width) * 2 - 1,
      -(((clientY - rect.top) / height) * 2 - 1)
    );
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const intersections = this.raycaster.intersectObject(this.modelGroup, true);
    const hit = intersections.find((intersection) => {
      const object = intersection.object as Model3dObjectNode;
      return !object.userData.previewMeasurementHelper && object.visible;
    });
    if (!hit) {
      return undefined;
    }
    const snapMode = this.state.measurement?.snapMode ?? 'surface';
    const worldPoint = snapMode === 'vertex'
      ? resolveIntersectionVertexPoint(hit) ?? hit.point
      : hit.point;
    return this.modelGroup.worldToLocal(worldPoint.clone());
  }

  private applyMeasurementPoint(point: Vector3): void {
    const measurement = this.state.measurement ?? {
      active: false,
      status: 'idle' as const,
      snapMode: 'surface' as const,
      axisLock: 'free' as const
    };
    const start = measurement.start ? new Vector3(...measurement.start) : undefined;
    if (!start || measurement.end) {
      measurement.start = vector3Tuple(point);
      measurement.end = undefined;
      measurement.delta = undefined;
      measurement.distance = undefined;
      measurement.previewPoint = undefined;
      measurement.previewDelta = undefined;
      measurement.previewDistance = undefined;
      measurement.status = 'pick-end';
    } else {
      const endPoint = applyMeasurementAxisLock(point, start, measurement.axisLock ?? 'free');
      const delta = endPoint.clone().sub(start);
      measurement.end = vector3Tuple(endPoint);
      measurement.delta = vector3Tuple(delta);
      measurement.distance = roundPreviewNumber(delta.length());
      measurement.previewPoint = undefined;
      measurement.previewDelta = undefined;
      measurement.previewDistance = undefined;
      measurement.status = 'complete';
      measurement.active = false;
    }
    this.state.measurement = measurement;
    this.updateMeasurementHelpers();
    this.emit('statechange', this.state);
  }

  private updateMeasurementHelpers(): void {
    const start = this.state.measurement?.start ? new Vector3(...this.state.measurement.start) : undefined;
    const end = this.state.measurement?.end
      ? new Vector3(...this.state.measurement.end)
      : this.state.measurement?.previewPoint
        ? new Vector3(...this.state.measurement.previewPoint)
        : undefined;
    if (this.measurementLineGeometry && this.measurementLine) {
      const position = this.measurementLineGeometry.getAttribute('position') as BufferAttribute;
      if (start && end) {
        position.setXYZ(0, start.x, start.y, start.z);
        position.setXYZ(1, end.x, end.y, end.z);
        position.needsUpdate = true;
        this.measurementLineGeometry.computeBoundingSphere();
        this.measurementLine.visible = true;
      } else {
        this.measurementLine.visible = false;
      }
    }
    if (this.measurementPointsGeometry && this.measurementPoints) {
      const position = this.measurementPointsGeometry.getAttribute('position') as BufferAttribute;
      const first = start ?? (this.state.measurement?.previewPoint ? new Vector3(...this.state.measurement.previewPoint) : undefined);
      if (first) {
        position.setXYZ(0, first.x, first.y, first.z);
        const second = end ?? first;
        position.setXYZ(1, second.x, second.y, second.z);
        position.needsUpdate = true;
        this.measurementPointsGeometry.computeBoundingSphere();
        this.measurementPoints.visible = true;
      } else {
        this.measurementPoints.visible = false;
      }
    }
  }

  private updateSectionPlanes(): void {
    if (!this.renderer || !this.modelGroup) {
      return;
    }
    const section = this.state.section;
    if (!section?.active) {
      if (this.appliedSectionClippingKey !== 'inactive') {
        this.renderer.clippingPlanes = [];
        this.appliedSectionClippingKey = 'inactive';
      }
      if (this.appliedSectionHelperKey !== 'inactive') {
        this.updateSectionHelpers(undefined);
        this.appliedSectionHelperKey = 'inactive';
      }
      return;
    }

    this.modelGroup.updateMatrixWorld(true);
    const clippingKey = sectionClippingCacheKey(section, this.modelGroup);
    if (clippingKey !== this.appliedSectionClippingKey) {
      const planes = section.mode === 'box'
        ? this.resolveBoxSectionPlanes(section)
        : this.resolveSingleSectionPlanes(section);
      this.renderer.clippingPlanes = planes;
      this.appliedSectionClippingKey = clippingKey;
    }

    const helperKey = sectionDisplayCacheKey(section);
    if (section.mode === 'box') {
      const shouldThrottleBoxHelper =
        helperKey !== this.appliedSectionHelperKey
        && this.appliedSectionHelperKey !== null
        && this.appliedSectionHelperKey !== 'inactive'
        && this.appliedSectionHelperKey.startsWith('box:')
        && this.sectionBoxFill?.visible
        && this.sectionBoxHelper?.visible
        && previewNow() - this.lastSectionHelperUpdateAt < SECTION_HELPER_MIN_UPDATE_MS;
      if (shouldThrottleBoxHelper) {
        this.markBoxSectionHelperPending();
      } else if (helperKey !== this.appliedSectionHelperKey) {
        this.updateSectionHelpers(section);
        this.appliedSectionHelperKey = helperKey;
        this.lastSectionHelperUpdateAt = previewNow();
      }
      return;
    }

    this.prepareSingleSectionHelper(section);
    if (helperKey !== this.appliedSectionHelperKey) {
      if (this.shouldRefreshSingleSectionHelper(section)) {
        this.updateSectionPlaneDetail(section);
        this.appliedSectionHelperKey = helperKey;
        this.lastSectionHelperUpdateAt = previewNow();
      } else {
        this.markSingleSectionHelperPending();
      }
    }
  }

  private markBoxSectionHelperPending(): void {
    if (!this.sectionPlaneHelper || !this.sectionPlaneOutline || !this.sectionPlaneFill || !this.sectionBoxFill || !this.sectionBoxHelper) {
      return;
    }
    this.sectionPlaneHelper.visible = false;
    this.sectionPlaneOutline.visible = false;
    this.sectionPlaneFill.visible = false;
    this.sectionBoxFill.visible = false;
    this.sectionBoxHelper.visible = false;
  }

  private shouldRefreshSingleSectionHelper(section: Model3dPreviewSectionInfo): boolean {
    if (this.appliedSectionHelperKey === null || this.appliedSectionHelperKey === 'inactive') {
      return true;
    }
    if (this.sectionHelperCache.has(sectionHelperCacheKey(section))) {
      return true;
    }
    return previewNow() - this.lastSectionHelperUpdateAt >= SECTION_HELPER_MIN_UPDATE_MS;
  }

  private prepareSingleSectionHelper(section: Model3dPreviewSectionInfo): void {
    this.ensureSectionHelpers();
    if (
      !this.sectionPlaneHelper
      || !this.sectionPlaneOutline
      || !this.sectionPlaneFill
      || !this.sectionBoxFill
      || !this.sectionBoxHelper
    ) {
      return;
    }
    this.updateSectionPlaneMesh(section);
    this.sectionBoxFill.visible = false;
    this.sectionBoxHelper.visible = false;
    this.sectionPlaneHelper.visible = true;
    this.sectionPlaneOutline.visible = true;
  }

  private markSingleSectionHelperPending(): void {
    if (!this.sectionPlaneOutline || !this.sectionPlaneFill) {
      return;
    }
    this.sectionPlaneOutline.visible = false;
    this.sectionPlaneFill.visible = false;
  }

  private resolveSingleSectionPlanes(section: Model3dPreviewSectionInfo): Plane[] {
    const normal = axisNormal(section.axis);
    const plane = this.sectionPlanes[0]!;
    plane.set(normal, -section.offset);
    plane.applyMatrix4(this.modelGroup!.matrixWorld);
    return [plane];
  }

  private resolveBoxSectionPlanes(section: Model3dPreviewSectionInfo): Plane[] {
    const range = section.range ?? sectionRangeFromBounds(this.sectionBounds);
    const planes: Plane[] = [];
    const axisConfig: Array<{
      axis: 'x' | 'y' | 'z';
      positive: Plane;
      negative: Plane;
    }> = [
      { axis: 'x', positive: this.sectionPlanes[0]!, negative: this.sectionPlanes[1]! },
      { axis: 'y', positive: this.sectionPlanes[2]!, negative: this.sectionPlanes[3]! },
      { axis: 'z', positive: this.sectionPlanes[4]!, negative: this.sectionPlanes[5]! }
    ];
    for (const { axis, positive, negative } of axisConfig) {
      const bounds = this.sectionBounds[axis];
      const [rangeMin, rangeMax] = range[axis];
      if (rangeMin > bounds[0] + 0.0005) {
        positive.set(axisNormal(axis), -rangeMin);
        positive.applyMatrix4(this.modelGroup!.matrixWorld);
        planes.push(positive);
      }
      if (rangeMax < bounds[1] - 0.0005) {
        negative.set(axisNegativeNormal(axis), rangeMax);
        negative.applyMatrix4(this.modelGroup!.matrixWorld);
        planes.push(negative);
      }
    }
    return planes;
  }

  private ensureSectionHelpers(): void {
    if (!this.modelGroup || this.sectionHelperGroup) {
      return;
    }
    const helperGroup = new Group();
    helperGroup.userData.previewMeasurementHelper = true;

    const planeGeometry = new PlaneGeometry(1, 1);
    const planeMaterial = new MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.14,
      side: DoubleSide,
      depthWrite: false
    });
    const planeMesh = new Mesh(planeGeometry, planeMaterial);
    planeMesh.visible = false;
    planeMesh.renderOrder = 3;
    planeMesh.userData.previewMeasurementHelper = true;
    helperGroup.add(planeMesh);

    const outlineGeometry = new BufferGeometry();
    outlineGeometry.setAttribute('position', new Float32BufferAttribute(new Array<number>(24).fill(0), 3));
    const outlineMaterial = new LineBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.95,
      depthWrite: false
    });
    const outlineLines = new LineSegments(outlineGeometry, outlineMaterial);
    outlineLines.visible = false;
    outlineLines.renderOrder = 4;
    outlineLines.userData.previewMeasurementHelper = true;
    helperGroup.add(outlineLines);

    const fillGeometry = new BufferGeometry();
    const fillMaterial = new MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.22,
      side: DoubleSide,
      depthWrite: false
    });
    const fillMesh = new Mesh(fillGeometry, fillMaterial);
    fillMesh.visible = false;
    fillMesh.renderOrder = 3.5;
    fillMesh.userData.previewMeasurementHelper = true;
    helperGroup.add(fillMesh);

    const boxFillGeometry = new BufferGeometry();
    const boxFillMaterial = new MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.1,
      side: DoubleSide,
      depthWrite: false
    });
    const boxFillMesh = new Mesh(boxFillGeometry, boxFillMaterial);
    boxFillMesh.visible = false;
    boxFillMesh.renderOrder = 2.8;
    boxFillMesh.userData.previewMeasurementHelper = true;
    helperGroup.add(boxFillMesh);

    const boxGeometry = new BufferGeometry();
    boxGeometry.setAttribute('position', new Float32BufferAttribute(new Array<number>(72).fill(0), 3));
    const boxMaterial = new LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.7,
      depthWrite: false
    });
    const boxLines = new LineSegments(boxGeometry, boxMaterial);
    boxLines.visible = false;
    boxLines.renderOrder = 3;
    boxLines.userData.previewMeasurementHelper = true;
    helperGroup.add(boxLines);

    this.modelGroup.add(helperGroup);
    this.sectionHelperGroup = helperGroup;
    this.sectionPlaneHelperGeometry = planeGeometry;
    this.sectionPlaneHelperMaterial = planeMaterial;
    this.sectionPlaneHelper = planeMesh;
    this.sectionPlaneOutlineGeometry = outlineGeometry;
    this.sectionPlaneOutlineMaterial = outlineMaterial;
    this.sectionPlaneOutline = outlineLines;
    this.sectionPlaneFillGeometry = fillGeometry;
    this.sectionPlaneFillMaterial = fillMaterial;
    this.sectionPlaneFill = fillMesh;
    this.sectionBoxFillGeometry = boxFillGeometry;
    this.sectionBoxFillMaterial = boxFillMaterial;
    this.sectionBoxFill = boxFillMesh;
    this.sectionBoxHelperGeometry = boxGeometry;
    this.sectionBoxHelperMaterial = boxMaterial;
    this.sectionBoxHelper = boxLines;
  }

  private updateSectionHelpers(section: Model3dPreviewSectionInfo | undefined): void {
    this.ensureSectionHelpers();
    if (
      !this.sectionPlaneHelper
      || !this.sectionPlaneOutline
      || !this.sectionPlaneFill
      || !this.sectionBoxFill
      || !this.sectionBoxHelper
      || !this.modelGroup
    ) {
      return;
    }
    if (!section?.active) {
      this.sectionPlaneHelper.visible = false;
      this.sectionPlaneOutline.visible = false;
      this.sectionPlaneFill.visible = false;
      this.sectionBoxFill.visible = false;
      this.sectionBoxHelper.visible = false;
      return;
    }
    if (section.mode === 'box') {
      this.sectionPlaneHelper.visible = false;
      this.sectionPlaneOutline.visible = false;
      this.sectionPlaneFill.visible = false;
      this.updateSectionBoxHelper(section);
      this.updateSectionBoxFill(section);
      this.sectionBoxHelper.visible = true;
      return;
    }
  }

  private updateSectionPlaneMesh(section: Model3dPreviewSectionInfo): void {
    if (!this.sectionPlaneHelper) {
      return;
    }
    const planeBounds = singleSectionPlaneBounds(section, this.sectionBounds);
    const helperWidth = Math.max(planeBounds.width, 0.001) * 1.02;
    const helperHeight = Math.max(planeBounds.height, 0.001) * 1.02;
    this.sectionPlaneHelper.position.set(0, 0, 0);
    this.sectionPlaneHelper.rotation.set(0, 0, 0);
    switch (section.axis) {
      case 'x':
        this.sectionPlaneHelper.position.x = section.offset;
        this.sectionPlaneHelper.rotation.y = Math.PI / 2;
        break;
      case 'y':
        this.sectionPlaneHelper.position.y = section.offset;
        this.sectionPlaneHelper.rotation.x = Math.PI / 2;
        break;
      case 'z':
      default:
        this.sectionPlaneHelper.position.z = section.offset;
        break;
    }
    this.sectionPlaneHelper.scale.set(helperWidth, helperHeight, 1);
  }

  private updateSectionPlaneDetail(section: Model3dPreviewSectionInfo): void {
    if (!this.sectionPlaneOutlineGeometry || !this.sectionPlaneOutline || !this.sectionPlaneFill || !this.modelGroup) {
      return;
    }
    const cacheEntry = this.resolveSectionHelperCacheEntry(section);
    const outlinePoints = cacheEntry?.outlinePoints.length
      ? cacheEntry.outlinePoints
      : sectionPlaneOutlinePoints(section, this.sectionBounds);
    const attribute = this.sectionPlaneOutlineGeometry.getAttribute('position') as BufferAttribute;
    const requiredVertices = outlinePoints.length / 3;
    if (attribute.count !== requiredVertices) {
      this.sectionPlaneOutlineGeometry.setAttribute('position', new Float32BufferAttribute(outlinePoints, 3));
      this.sectionPlaneOutlineGeometry.computeBoundingSphere();
    } else {
      for (let index = 0; index < outlinePoints.length; index += 3) {
        attribute.setXYZ(index / 3, outlinePoints[index]!, outlinePoints[index + 1]!, outlinePoints[index + 2]!);
      }
      attribute.needsUpdate = true;
      this.sectionPlaneOutlineGeometry.computeBoundingSphere();
    }
    this.sectionPlaneOutline.visible = true;

    const fillGeometry = cacheEntry?.fillData ? buildSectionFillGeometry(cacheEntry.fillData) : undefined;
    if (!fillGeometry) {
      this.sectionPlaneFill.visible = false;
      return;
    }
    this.replaceSectionPlaneFillGeometry(fillGeometry);
    this.sectionPlaneFill.visible = true;
  }

  private resolveSectionHelperCacheEntry(section: Model3dPreviewSectionInfo): Model3dSectionHelperCacheEntry | undefined {
    const cacheKey = sectionHelperCacheKey(section);
    const cached = this.sectionHelperCache.get(cacheKey);
    if (cached) {
      this.sectionHelperCache.delete(cacheKey);
      this.sectionHelperCache.set(cacheKey, cached);
      return cached;
    }
    const segmentPoints = resolveSectionOutlineSegments(section, this.sectionSourceGeometry, this.modelGroup);
    if (!segmentPoints.length) {
      return undefined;
    }
    const stitchedPaths = stitchSectionPaths(section.axis, segmentPoints);
    const entry: Model3dSectionHelperCacheEntry = {
      outlinePoints: stitchedPaths.loops.length || stitchedPaths.chains.length
        ? [
            ...stitchedPaths.loops.flatMap((loop) => lineLoopPositions(loop)),
            ...stitchedPaths.chains.flatMap((chain) => linePathPositions(chain))
          ]
        : segmentPoints,
      fillData: stitchedPaths.loops.length ? buildSectionFillData(section.axis, stitchedPaths.loops) : undefined
    };
    this.sectionHelperCache.set(cacheKey, entry);
    while (this.sectionHelperCache.size > MAX_SECTION_HELPER_CACHE_ENTRIES) {
      const oldestKey = this.sectionHelperCache.keys().next().value;
      if (typeof oldestKey !== 'string') {
        break;
      }
      this.sectionHelperCache.delete(oldestKey);
    }
    return entry;
  }

  private clearSectionHelperCache(): void {
    this.sectionHelperCache.clear();
    this.appliedSectionHelperKey = null;
    this.appliedSectionClippingKey = null;
    this.lastSectionHelperUpdateAt = Number.NEGATIVE_INFINITY;
  }

  private replaceSectionPlaneFillGeometry(geometry: BufferGeometry): void {
    if (!this.sectionPlaneFill) {
      geometry.dispose();
      return;
    }
    const currentGeometry = this.sectionPlaneFillGeometry;
    this.sectionPlaneFill.geometry = geometry;
    this.sectionPlaneFillGeometry = geometry;
    currentGeometry?.dispose();
  }

  private replaceSectionBoxFillGeometry(geometry: BufferGeometry): void {
    if (!this.sectionBoxFill) {
      geometry.dispose();
      return;
    }
    const currentGeometry = this.sectionBoxFillGeometry;
    this.sectionBoxFill.geometry = geometry;
    this.sectionBoxFillGeometry = geometry;
    currentGeometry?.dispose();
  }

  private updateSectionBoxFill(section: Model3dPreviewSectionInfo): void {
    if (!this.sectionBoxFill) {
      return;
    }
    const geometry = buildSectionBoxFillGeometry(section, this.sectionBounds);
    if (!geometry) {
      this.sectionBoxFill.visible = false;
      return;
    }
    this.replaceSectionBoxFillGeometry(geometry);
    this.sectionBoxFill.visible = true;
  }

  private updateSectionBoxHelper(section: Model3dPreviewSectionInfo): void {
    if (!this.sectionBoxHelperGeometry) {
      return;
    }
    const range = section.range ?? sectionRangeFromBounds(this.sectionBounds);
    const [minX, maxX] = range.x;
    const [minY, maxY] = range.y;
    const [minZ, maxZ] = range.z;
    const corners: Array<[number, number, number]> = [
      [minX, minY, minZ],
      [maxX, minY, minZ],
      [maxX, maxY, minZ],
      [minX, maxY, minZ],
      [minX, minY, maxZ],
      [maxX, minY, maxZ],
      [maxX, maxY, maxZ],
      [minX, maxY, maxZ]
    ];
    const edgePairs: Array<[number, number]> = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7]
    ];
    const positions: number[] = [];
    for (const [start, end] of edgePairs) {
      positions.push(...corners[start]!, ...corners[end]!);
    }
    const attribute = this.sectionBoxHelperGeometry.getAttribute('position') as BufferAttribute;
    for (let index = 0; index < positions.length; index += 3) {
      attribute.setXYZ(index / 3, positions[index]!, positions[index + 1]!, positions[index + 2]!);
    }
    attribute.needsUpdate = true;
    this.sectionBoxHelperGeometry.computeBoundingSphere();
  }

  private findNodeObject(nodeId: string): Model3dObjectNode | undefined {
    let targetObject: Model3dObjectNode | undefined;
    this.modelGroup?.traverse((object) => {
      const previewObject = object as Model3dObjectNode;
      if (previewObject.userData.previewNodeId === nodeId) {
        targetObject = previewObject;
      }
    });
    return targetObject;
  }

  private applyNodeVisibility(object: Object3D, visible: boolean): void {
    object.traverse((child) => {
      const previewObject = child as Model3dObjectNode;
      previewObject.userData.previewOriginalVisible = visible;
      child.visible = visible;
    });
  }

  private focusNode(nodeId?: string): void {
    if (!this.modelGroup) {
      return;
    }
    if (!nodeId) {
      if (this.state.isolatedMaterialKey) {
        const visibleBounds = visibleObjectBounds(this.modelGroup);
        if (!visibleBounds.isEmpty()) {
          const center = visibleBounds.getCenter(new Vector3());
          const size = visibleBounds.getSize(new Vector3());
          this.modelRadius = Math.max(size.x, size.y, size.z, 1) * 0.72;
          this.distance = Math.max(this.modelRadius * 2.6, this.baseDistance * 0.24);
          this.modelGroup.position.copy(this.baseModelGroupPosition).sub(center);
          this.updateCamera();
          return;
        }
      }
      const explode = this.state.explode ?? 0;
      this.modelRadius = this.baseModelRadius + this.maxExplodeOffset * explode;
      this.distance = Math.max(this.modelRadius * 1.25, (this.modelRadius * 2.6) / this.state.scale);
      this.modelGroup.position.copy(this.baseModelGroupPosition);
      this.updateCamera();
      return;
    }

    let targetNode: Object3D | undefined;
    this.modelGroup.traverse((object) => {
      const previewObject = object as Model3dObjectNode;
      if (previewObject.userData.previewNodeId === nodeId) {
        targetNode = object;
      }
    });
    if (!targetNode) {
      return;
    }

    const bounds = new Box3().setFromObject(targetNode);
    if (bounds.isEmpty()) {
      return;
    }
    const center = bounds.getCenter(new Vector3());
    const size = bounds.getSize(new Vector3());
    this.modelRadius = Math.max(size.x, size.y, size.z, 1) * 0.72;
    this.distance = Math.max(this.modelRadius * 2.6, this.baseDistance * 0.24);
    this.modelGroup.position.copy(this.baseModelGroupPosition).sub(center);
    this.updateCamera();
  }

  private applyAppearanceState(): void {
    this.modelGroup?.traverse((object) => {
      const previewObject = object as Model3dObjectNode;
      if (typeof previewObject.userData.previewOriginalVisible !== 'boolean') {
        previewObject.userData.previewOriginalVisible = object.visible;
      }
      if (previewObject.userData.previewMeasurementHelper) {
        return;
      }
      if (previewObject.userData.previewEdgeHelper) {
        const sourceObject = this.findObjectById(previewObject.userData.previewEdgeSourceId);
        const sourceVisible = sourceObject
          ? Boolean((sourceObject as Model3dObjectNode).userData.previewOriginalVisible) && this.matchesActiveMaterialFilter(sourceObject)
          : true;
        object.visible = previewObject.userData.previewOriginalVisible && sourceVisible && this.displayMode !== 'shaded';
        this.applySelectionMaterialState(object, {
          emphasized: false,
          dimmed: Boolean(this.state.selectedNodeId && sourceObject && (sourceObject as Model3dObjectNode).userData.previewNodeId !== this.state.selectedNodeId)
        });
        return;
      }
      const isSelected = Boolean(this.state.selectedNodeId && previewObject.userData.previewNodeId === this.state.selectedNodeId);
      const isDimmed = Boolean(
        this.state.selectedNodeId
        && previewObject.userData.previewNodeId
        && previewObject.userData.previewNodeId !== this.state.selectedNodeId
      );
      object.visible = previewObject.userData.previewOriginalVisible && this.matchesActiveMaterialFilter(object);
      this.applySelectionMaterialState(object, {
        emphasized: isSelected && object.visible,
        dimmed: isDimmed && object.visible
      });
    });
  }

  private matchesActiveMaterialFilter(object: Object3D): boolean {
    const materialKey = this.state.isolatedMaterialKey;
    if (!materialKey) {
      return true;
    }
    const materialKeys = objectMaterialKeys(object);
    return materialKeys.length ? materialKeys.includes(materialKey) : true;
  }

  private captureMaterialRuntimeState(root: Object3D): void {
    root.traverse((object) => {
      const maybeRenderable = object as Object3D & {
        material?: Material | Material[];
      };
      const materials = Array.isArray(maybeRenderable.material)
        ? maybeRenderable.material
        : maybeRenderable.material
          ? [maybeRenderable.material]
          : [];
      for (const material of materials) {
        if (this.materialRuntimeState.has(material)) {
          continue;
        }
        this.materialRuntimeState.set(material, {
          opacity: material.opacity,
          transparent: material.transparent,
          wireframe: 'wireframe' in material ? Boolean((material as Material & { wireframe?: boolean }).wireframe) : undefined,
          depthWrite: material.depthWrite,
          ...(material instanceof MeshStandardMaterial
            ? {
                emissiveHex: material.emissive.getHex(),
                emissiveIntensity: material.emissiveIntensity
              }
            : {})
        });
      }
    });
  }

  private applySelectionMaterialState(
    object: Object3D,
    state: { emphasized: boolean; dimmed: boolean }
  ): void {
    const maybeRenderable = object as Object3D & {
      material?: Material | Material[];
    };
    const materials = Array.isArray(maybeRenderable.material)
      ? maybeRenderable.material
      : maybeRenderable.material
        ? [maybeRenderable.material]
        : [];
    for (const material of materials) {
      const runtimeState = this.materialRuntimeState.get(material) ?? {
        opacity: material.opacity,
        transparent: material.transparent,
        wireframe: 'wireframe' in material ? Boolean((material as Material & { wireframe?: boolean }).wireframe) : undefined,
        depthWrite: material.depthWrite
      };
      const baseOpacity = this.displayMode === 'xray'
        ? Math.min(runtimeState.opacity, 0.26)
        : runtimeState.opacity;
      const baseTransparent = runtimeState.transparent || baseOpacity < 1;
      const baseDepthWrite = this.displayMode === 'xray'
        ? false
        : (runtimeState.depthWrite ?? true);
      if (material instanceof MeshStandardMaterial) {
        material.wireframe = this.displayMode === 'wireframe';
        material.emissive.setHex(state.emphasized ? 0x1d4ed8 : (runtimeState.emissiveHex ?? 0x000000));
        material.emissiveIntensity = state.emphasized
          ? Math.max(runtimeState.emissiveIntensity ?? 0, 0.42)
          : (runtimeState.emissiveIntensity ?? 0);
        material.opacity = state.dimmed ? Math.min(baseOpacity, 0.28) : baseOpacity;
        material.transparent = baseTransparent || material.opacity < 1;
        material.depthWrite = baseDepthWrite;
        material.needsUpdate = true;
        continue;
      }
      if (material instanceof LineBasicMaterial || material instanceof PointsMaterial) {
        material.opacity = state.dimmed ? Math.min(baseOpacity, 0.24) : baseOpacity;
        material.transparent = baseTransparent || material.opacity < 1;
        material.depthWrite = baseDepthWrite;
        material.needsUpdate = true;
      }
    }
  }

  private attachEdgeHelpers(root: Object3D): void {
    root.traverse((object) => {
      if (!(object instanceof Mesh || object instanceof SkinnedMesh)) {
        return;
      }
      const geometry = object.geometry;
      if (!geometry || !geometry.getAttribute('position')) {
        return;
      }
      const edgeGeometry = new EdgesGeometry(geometry, 35);
      const edgeMaterial = new LineBasicMaterial({
        color: 0xdbeafe,
        transparent: true,
        opacity: 0.22,
        depthWrite: false
      });
      const edges = new LineSegments(edgeGeometry, edgeMaterial) as Model3dObjectNode;
      edges.renderOrder = 2;
      edges.userData.previewEdgeHelper = true;
      edges.userData.previewEdgeSourceId = object.id;
      edges.userData.previewOriginalVisible = object.visible;
      object.add(edges);
    });
  }

  private findObjectById(id?: number): Object3D | undefined {
    if (!this.modelGroup || typeof id !== 'number') {
      return undefined;
    }
    let match: Object3D | undefined;
    this.modelGroup.traverse((object) => {
      if (!match && object.id === id) {
        match = object;
      }
    });
    return match;
  }

  private applySceneBackground(background: PreviewSnapshotBackground): () => void {
    const renderer = this.renderer;
    const scene = this.scene;
    if (!renderer || !scene) {
      return () => {};
    }
    const previousBackground = scene.background;
    switch (background) {
      case 'white':
        scene.background = new Color(0xffffff);
        renderer.setClearColor(0xffffff, 1);
        break;
      case 'transparent':
        scene.background = null;
        renderer.setClearColor(0x000000, 0);
        break;
      default:
        scene.background = new Color(0x111827);
        renderer.setClearColor(0x111827, 1);
        break;
    }
    return () => {
      scene.background = previousBackground;
      renderer.setClearColor(0x111827, 1);
    };
  }

  private disposeScene(): void {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener('resize', this.resize);
    this.disposeObjectResources();
    this.geometry?.dispose();
    this.edgeGeometry?.dispose();
    this.material?.dispose();
    this.edgeMaterial?.dispose();
    this.measurementLineGeometry?.dispose();
    this.measurementLineMaterial?.dispose();
    this.measurementPointsGeometry?.dispose();
    this.measurementPointsMaterial?.dispose();
    this.sectionPlaneHelperGeometry?.dispose();
    this.sectionPlaneHelperMaterial?.dispose();
    this.sectionPlaneOutlineGeometry?.dispose();
    this.sectionPlaneOutlineMaterial?.dispose();
    this.sectionPlaneFillGeometry?.dispose();
    this.sectionPlaneFillMaterial?.dispose();
    this.sectionBoxFillGeometry?.dispose();
    this.sectionBoxFillMaterial?.dispose();
    this.sectionBoxHelperGeometry?.dispose();
    this.sectionBoxHelperMaterial?.dispose();
    if (this.renderer) {
      this.renderer.clippingPlanes = [];
      this.renderer.localClippingEnabled = false;
    }
    this.renderer?.dispose();
    this.stage.replaceChildren();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.modelGroup = null;
    this.geometry = null;
    this.edgeGeometry = null;
    this.material = null;
    this.edgeMaterial = null;
    this.measurementLineGeometry = null;
    this.measurementLineMaterial = null;
    this.measurementLine = null;
    this.measurementPointsGeometry = null;
    this.measurementPointsMaterial = null;
    this.measurementPoints = null;
    this.sectionHelperGroup = null;
    this.sectionPlaneHelper = null;
    this.sectionPlaneHelperGeometry = null;
    this.sectionPlaneHelperMaterial = null;
    this.sectionPlaneOutlineGeometry = null;
    this.sectionPlaneOutlineMaterial = null;
    this.sectionPlaneOutline = null;
    this.sectionPlaneFillGeometry = null;
    this.sectionPlaneFillMaterial = null;
    this.sectionPlaneFill = null;
    this.sectionBoxFillGeometry = null;
    this.sectionBoxFillMaterial = null;
    this.sectionBoxFill = null;
    this.sectionBoxHelperGeometry = null;
    this.sectionBoxHelperMaterial = null;
    this.sectionBoxHelper = null;
    this.measurementHoverClientX = null;
    this.measurementHoverClientY = null;
    this.clearSectionHelperCache();
    this.sectionBounds = defaultSectionBounds();
    this.explodeTargets = [];
    this.maxExplodeOffset = 0;
    this.materialRuntimeState = new WeakMap<Material, PreviewMaterialRuntimeState>();
    this.state.modelTree = undefined;
    this.state.selectedNodeId = undefined;
    this.state.isolatedMaterialKey = undefined;
    this.state.measurement = {
      active: false,
      status: 'idle',
      snapMode: this.state.measurement?.snapMode ?? 'surface',
      axisLock: this.state.measurement?.axisLock ?? 'free'
    };
    this.state.section = createPreviewSectionState();
    this.state.capabilities.measure = false;
    this.state.capabilities.section = false;
    this.state.capabilities.explode = false;
    this.state.capabilities.materialFilter = false;
  }

  private disposeObjectResources(): void {
    const previewObjectUrls = this.modelGroup?.userData?.previewObjectUrls;
    if (Array.isArray(previewObjectUrls)) {
      for (const url of previewObjectUrls) {
        if (typeof url === 'string' && url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      }
      delete this.modelGroup?.userData?.previewObjectUrls;
    }
    this.modelGroup?.traverse((object) => {
      const maybeMesh = object as Mesh & {
        material?: Material | Material[];
        geometry?: BufferGeometry;
      };
      if (maybeMesh.geometry && maybeMesh.geometry !== this.geometry) {
        maybeMesh.geometry.dispose();
      }
      const materials = Array.isArray(maybeMesh.material) ? maybeMesh.material : maybeMesh.material ? [maybeMesh.material] : [];
      for (const material of materials) {
        if (material !== this.material) {
          material.dispose();
        }
      }
    });
  }

  private emit<T extends PreviewEventName>(event: T, payload: PreviewEventMap[T]): void {
    for (const handler of this.listeners[event]) {
      handler(payload as never);
    }
  }
}

export function createModel3dPreviewDriver(): PreviewDriver<Model3dPreviewState> {
  return {
    id: 'model3d',
    family: 'model3d',
    supports: (format) => MODEL3D_DIRECT_FORMATS.has(normalizeFormat(format)),
    createSession: (host, options) => new Model3dPreviewSession(host, options)
  };
}

export function createModel3dPreviewRoutes(baseRoutes = createDefaultPreviewRoutes()): FormatDefinition[] {
  return [
    ...MODEL3D_FORMAT_ROUTES,
    ...baseRoutes.filter((route) => !route.extensions.some((extension) => MODEL3D_DIRECT_FORMATS.has(extension)))
  ];
}

export function loadStlGeometry(source: ArrayBuffer): StlGeometry {
  const bytes = new Uint8Array(source);
  if (isBinaryStl(bytes)) {
    return parseBinaryStl(bytes);
  }
  return parseAsciiStl(new TextDecoder().decode(bytes));
}

export function loadObjGeometry(source: string): ModelGeometry {
  const vertices: Array<[number, number, number]> = [];
  const vertexColors: Array<[number, number, number] | undefined> = [];
  const normals: Array<[number, number, number]> = [];
  const positions: number[] = [];
  const resolvedNormals: number[] = [];
  const colors: number[] = [];

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const parts = line.split(/\s+/);
    if (parts[0] === 'v') {
      vertices.push([numberPart(parts[1]), numberPart(parts[2]), numberPart(parts[3])]);
      vertexColors.push(parseObjVertexColor(parts));
      continue;
    }
    if (parts[0] === 'vn') {
      normals.push(normalizeVector([numberPart(parts[1]), numberPart(parts[2]), numberPart(parts[3])]));
      continue;
    }
    if (parts[0] !== 'f' || parts.length < 4) {
      continue;
    }

    const face = parts.slice(1).map((part) => parseObjFaceVertex(part, vertices.length, normals.length)).filter(Boolean);
    if (face.length < 3) {
      continue;
    }
    for (let index = 1; index < face.length - 1; index += 1) {
      pushObjTriangle(face[0]!, face[index]!, face[index + 1]!, vertices, vertexColors, normals, positions, resolvedNormals, colors);
    }
  }

  if (!positions.length) {
    throw new Error('No OBJ triangles found.');
  }
  return geometryFromArrays(positions, resolvedNormals, colors.length === positions.length ? colors : undefined);
}

export interface LoadObjObjectOptions {
  resourceBasePath?: string;
  resourceResolver?: PreviewResourceResolver;
  sourceFormat?: string;
  signal?: AbortSignal;
}

export async function loadObjObject(source: string, options: LoadObjObjectOptions = {}): Promise<Object3D> {
  return (await loadObjObjectWithWarnings(source, options)).object;
}

export async function loadObjObjectWithWarnings(
  source: string,
  options: LoadObjObjectOptions = {}
): Promise<ModelObjectLoadResult> {
  const materialLibraries = listObjMaterialLibraries(source);
  if (!materialLibraries.length || !options.resourceResolver) {
    return {
      object: new OBJLoader().parse(source),
      warnings: []
    };
  }

  const rewrittenMaterials: string[] = [];
  const warnings: string[] = [];
  for (const library of materialLibraries) {
    if (options.signal?.aborted) {
      throw new DOMException('3D preview aborted.', 'AbortError');
    }
    const resolved = normalizeResourceResolverResult(
      await resolveModelResource(options.resourceResolver, {
        source: joinResourcePath(dirname(options.resourceBasePath ?? ''), library),
        fallbackSource: library,
        relation: 'material',
        sourceFormat: options.sourceFormat ?? 'obj'
      }),
      objResourceContentType(library)
    );
    warnings.push(...resolved.warnings);
    if (!resolved.source) {
      warnings.push(`OBJ material library "${library}" could not be resolved; materials were skipped.`);
      continue;
    }
    const materialText = await previewSourceToText(resolved.source);
    const rewritten = await rewriteObjMaterialResources(materialText, library, options);
    warnings.push(...rewritten.warnings);
    rewrittenMaterials.push(rewritten.text);
  }

  const loader = new OBJLoader();
  if (rewrittenMaterials.length) {
    const materials = new MTLLoader().parse(rewrittenMaterials.join('\n'), '');
    materials.preload();
    loader.setMaterials(materials);
  }
  return {
    object: loader.parse(source),
    warnings
  };
}

export function listObjMaterialLibraries(source: string): string[] {
  const libraries: string[] = [];
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const match = /^mtllib\s+(.+)$/i.exec(line);
    if (!match?.[1]) {
      continue;
    }
    for (const name of match[1].trim().split(/\s+/)) {
      if (name) {
        libraries.push(name);
      }
    }
  }
  return [...new Set(libraries)];
}

export function loadPlyGeometry(source: ArrayBuffer): ModelGeometry {
  const bytes = new Uint8Array(source);
  const header = readPlyHeader(bytes);
  if (header.format === 'ascii') {
    return parseAsciiPly(new TextDecoder().decode(bytes.slice(header.dataOffset)), header);
  }
  if (header.format === 'binary_little_endian') {
    return parseBinaryLittleEndianPly(bytes, header);
  }
  throw new Error(`Unsupported PLY format "${header.format}".`);
}

export async function load3mfGeometry(source: ArrayBuffer): Promise<ModelGeometry> {
  return (await load3mfGeometryWithWarnings(source)).geometry;
}

export async function load3mfGeometryWithWarnings(source: ArrayBuffer): Promise<ModelGeometryLoadResult> {
  const archive = await JSZip.loadAsync(source);
  const modelFile = archive.file('3D/3dmodel.model') ?? archive.file(/(^|\/)3dmodel\.model$/i)[0];
  if (!modelFile) {
    throw new Error('3MF package is missing 3D/3dmodel.model.');
  }

  // Production 3MF files commonly keep each printable object in its own
  // `3D/Objects/*.model` part while the root model only contains build items.
  const modelFiles = [
    modelFile,
    ...Object.values(archive.files).filter((entry) =>
      !entry.dir && /\.model$/i.test(entry.name) && entry.name !== modelFile.name
    )
  ];
  const documents: Document[] = [];
  for (const file of modelFiles) {
    const xml = await file.async('text');
    const parsed = new DOMParser().parseFromString(xml, 'application/xml');
    const parserError = parsed.getElementsByTagName('parsererror')[0];
    if (parserError) {
      if (file === modelFile) {
        throw new Error('3MF model XML is invalid.');
      }
      continue;
    }
    documents.push(parsed);
  }

  const colorMaterials = new Map<string, Array<[number, number, number]>>();
  const warnings = new Set<string>();
  for (const document of documents) {
    for (const [id, colors] of read3mfColorMaterials(document)) {
      if (!colorMaterials.has(id)) {
        colorMaterials.set(id, colors);
      }
    }
    for (const warning of collect3mfUnsupportedMaterialWarnings(document)) {
      warnings.add(warning);
    }
  }
  const unsupportedReferencedMaterialIds = new Set<string>();
  const objectElements = new Map<string, Element>();
  const objectMeshes = new Map<string, Mesh3mf>();
  for (const document of documents) {
    for (const objectElement of localElements(document, 'object')) {
      const id = objectElement.getAttribute('id');
      if (!id) {
        continue;
      }
      const meshElement = localElements(objectElement, 'mesh')[0];
      const hadMesh = objectMeshes.has(id);
      if (meshElement) {
        const vertices = localElements(meshElement, 'vertex').map((vertex) => [
          numberPart(vertex.getAttribute('x') ?? undefined),
          numberPart(vertex.getAttribute('y') ?? undefined),
          numberPart(vertex.getAttribute('z') ?? undefined)
        ] as [number, number, number]);

        const objectPositions: Array<[number, number, number]> = [];
        const objectColors: Array<[number, number, number]> = [];
        const objectColor = resolve3mfColorReference(
          objectElement.getAttribute('pid'),
          objectElement.getAttribute('pindex'),
          colorMaterials
        );
        noteUnsupported3mfMaterialReference(objectElement.getAttribute('pid'), colorMaterials, unsupportedReferencedMaterialIds);
        for (const triangle of localElements(meshElement, 'triangle')) {
          const indices = ['v1', 'v2', 'v3']
            .map((name) => Number(triangle.getAttribute(name)))
            .filter((value) => Number.isInteger(value) && value >= 0 && value < vertices.length);
          if (indices.length !== 3) {
            continue;
          }
          const materialResourceId = triangle.getAttribute('pid') ?? objectElement.getAttribute('pid');
          noteUnsupported3mfMaterialReference(materialResourceId, colorMaterials, unsupportedReferencedMaterialIds);
          const triangleColors: Array<[number, number, number]> = ['p1', 'p2', 'p3'].map((name) =>
            resolve3mfColorReference(
              materialResourceId,
              triangle.getAttribute(name) ?? triangle.getAttribute('pindex') ?? objectElement.getAttribute('pindex'),
              colorMaterials
            ) ?? objectColor ?? [0.49, 0.83, 0.99]
          );
          objectPositions.push(vertices[indices[0]!]!, vertices[indices[1]!]!, vertices[indices[2]!]!);
          objectColors.push(...triangleColors);
        }
        // Keep the root model's definition when a package repeats an object ID,
        // but allow an external component part to fill an otherwise empty one.
        if (objectPositions.length && !hadMesh) {
          objectMeshes.set(id, {
            positions: objectPositions,
            colors: objectColors
          });
        }
      }
      if (!objectElements.has(id) || (!hadMesh && objectMeshes.has(id))) {
        objectElements.set(id, objectElement);
      }
    }
  }
  for (const id of objectElements.keys()) {
    resolve3mfObjectMesh(id, objectElements, objectMeshes, new Set());
  }

  const rootDocument = documents[0]!;
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const buildItems = localElements(rootDocument, 'item');
  const items = buildItems.length ? buildItems : [...objectMeshes.keys()].map((objectId) => ({ objectId }));
  for (const item of items) {
    const objectId = item instanceof Element ? item.getAttribute('objectid') : item.objectId;
    const mesh = objectId ? objectMeshes.get(objectId) : undefined;
    if (!mesh?.positions.length) {
      continue;
    }
    const transform = item instanceof Element ? parse3mfTransform(item.getAttribute('transform')) : IDENTITY_TRANSFORM;
    for (let index = 0; index < mesh.positions.length; index += 3) {
      const first = apply3mfTransform(mesh.positions[index]!, transform);
      const second = apply3mfTransform(mesh.positions[index + 1]!, transform);
      const third = apply3mfTransform(mesh.positions[index + 2]!, transform);
      const normal = computeTriangleNormal(first, second, third);
      const triangleColors = [mesh.colors[index] ?? [0.49, 0.83, 0.99], mesh.colors[index + 1] ?? [0.49, 0.83, 0.99], mesh.colors[index + 2] ?? [0.49, 0.83, 0.99]];
      for (const vertex of [first, second, third]) {
        positions.push(...vertex);
        normals.push(...normal);
      }
      for (const color of triangleColors) {
        colors.push(...color);
      }
    }
  }

  if (!positions.length) {
    throw new Error('No 3MF mesh triangles found.');
  }
  for (const warning of Array.from(unsupportedReferencedMaterialIds).map((id) =>
    `3MF material resource "${id}" is not a supported color palette; fallback vertex colors were used.`
  )) {
    warnings.add(warning);
  }
  return {
    geometry: geometryFromArrays(positions, normals, colors),
    warnings: [...warnings]
  };
}

export async function loadGlbObject(source: ArrayBuffer): Promise<Object3D> {
  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(source, '');
  return gltf.scene;
}

export function loadAmfObject(source: ArrayBuffer): Object3D {
  return new AMFLoader().parse(source);
}

export function loadColladaObject(source: string, resourcePath = ''): Object3D {
  return loadColladaObjectWithWarnings(source, { resourcePath }).object;
}

export interface LoadColladaObjectOptions {
  resourceBasePath?: string;
  resourcePath?: string;
  resourceResolver?: PreviewResourceResolver;
  sourceFormat?: string;
  signal?: AbortSignal;
}

export function loadColladaObjectWithWarnings(
  source: string,
  options: LoadColladaObjectOptions = {}
): ModelObjectLoadResult {
  const objectUrls: string[] = [];
  const warnings: string[] = [];
  const manager = new LoadingManager();
  if (options.resourceResolver) {
    manager.setURLModifier((url) => resolveColladaTextureUrl(url, options, warnings, objectUrls));
  }
  const object = new ColladaLoader(manager).parse(source, options.resourcePath ?? '').scene;
  if (objectUrls.length) {
    object.userData.previewObjectUrls = objectUrls;
  }
  return {
    object,
    warnings
  };
}

export function loadKmzObject(source: ArrayBuffer): Object3D {
  return new KMZLoader().parse(source).scene;
}

export async function loadKmzObjectWithWarnings(source: ArrayBuffer): Promise<ModelObjectLoadResult> {
  let loaderObject: Object3D | undefined;
  try {
    loaderObject = loadKmzObject(source);
    if (hasRenderableObjectContent(loaderObject)) {
      return { object: loaderObject, warnings: [] };
    }
  } catch {
    // Some KMZ files use a nested or URL-encoded model path that KMZLoader cannot resolve.
  }

  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(source);
  } catch (error) {
    if (loaderObject) {
      return {
        object: loaderObject,
        warnings: [`KMZ archive could not be inspected: ${error instanceof Error ? error.message : String(error)}`]
      };
    }
    throw error;
  }
  const entries = Object.values(archive.files).filter((entry) => !entry.dir);
  const kmlEntry = findKmzEntry(entries, (name) => /(^|\/)doc\.kml$/i.test(name))
    ?? findKmzEntry(entries, (name) => /\.kml$/i.test(name));
  const kmlText = kmlEntry ? await kmlEntry.async('text') : undefined;
  const modelHref = kmlText ? findKmzModelHref(kmlText) : undefined;
  const modelEntry = (modelHref ? findKmzEntry(entries, (name) => isKmzPathMatch(name, modelHref, kmlEntry?.name)) : undefined)
    ?? findKmzEntry(entries, (name) => /\.dae$/i.test(name));
  if (!modelEntry) {
    if (loaderObject) {
      return {
        object: loaderObject,
        warnings: ['KMZ archive does not contain a Collada (.dae) model with renderable geometry.']
      };
    }
    throw new Error('KMZ archive does not contain a Collada (.dae) model.');
  }

  const warnings: string[] = [];
  const objectUrls: string[] = [];
  const resourceBytes = new Map<string, Uint8Array>();
  for (const entry of entries) {
    if (/\.(?:png|jpe?g|gif|webp|bmp|tga|dds)$/i.test(entry.name)) {
      resourceBytes.set(entry.name, await entry.async('uint8array'));
    }
  }
  const manager = new LoadingManager();
  manager.setURLModifier((url) => {
    const resource = findKmzEntry(entries, (name) => isKmzPathMatch(name, url, modelEntry.name));
    const bytes = resource ? resourceBytes.get(resource.name) : undefined;
    if (!resource || !bytes) {
      return url;
    }
    const blobBytes = new Uint8Array(bytes.byteLength);
    blobBytes.set(bytes);
    const resourceUrl = URL.createObjectURL(new Blob([blobBytes.buffer], { type: mimeTypeForKmzEntry(resource.name) }));
    objectUrls.push(resourceUrl);
    return resourceUrl;
  });
  const dae = await modelEntry.async('text');
  const object = new ColladaLoader(manager).parse(dae, `${directoryName(modelEntry.name)}/`).scene;
  if (objectUrls.length) {
    object.userData.previewObjectUrls = objectUrls;
  }
  if (!hasRenderableObjectContent(object)) {
    warnings.push('KMZ Collada model contains no renderable geometry.');
  }
  return { object, warnings };
}

function hasRenderableObjectContent(object: Object3D): boolean {
  let renderable = false;
  object.traverse((node) => {
    const candidate = node as Object3D & { geometry?: BufferGeometry };
    if (candidate.geometry?.getAttribute('position')?.count) {
      renderable = true;
    }
  });
  return renderable;
}

function findKmzEntry(entries: JSZip.JSZipObject[], predicate: (name: string) => boolean): JSZip.JSZipObject | undefined {
  return entries.find((entry) => predicate(entry.name));
}

function findKmzModelHref(source: string): string | undefined {
  const document = new DOMParser().parseFromString(source, 'application/xml');
  const parserError = document.getElementsByTagName('parsererror')[0];
  if (parserError) {
    return undefined;
  }
  for (const element of Array.from(document.getElementsByTagName('*'))) {
    if (element.localName?.toLowerCase() !== 'href') {
      continue;
    }
    const value = element.textContent?.trim();
    if (value && /\.dae(?:[?#].*)?$/i.test(value)) {
      return value;
    }
  }
  return undefined;
}

function isKmzPathMatch(name: string, href: string, relativeTo?: string): boolean {
  const normalizedName = normalizeKmzPath(name);
  const normalizedHref = normalizeKmzPath(href);
  const candidates = [normalizedHref];
  if (relativeTo) {
    candidates.push(normalizeKmzPath(`${directoryName(relativeTo)}/${normalizedHref}`));
  }
  return candidates.some((candidate) => normalizedName === candidate || normalizedName.endsWith(`/${candidate}`));
}

function normalizeKmzPath(value: string): string {
  let normalized = value.trim().replace(/\\/g, '/').split(/[?#]/, 1)[0] ?? '';
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // Keep the original path when a producer emitted malformed percent escapes.
  }
  normalized = normalized.replace(/^\.\//, '').replace(/^\/+/, '');
  const parts: string[] = [];
  for (const part of normalized.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

function directoryName(value: string): string {
  const normalized = normalizeKmzPath(value);
  const slash = normalized.lastIndexOf('/');
  return slash >= 0 ? normalized.slice(0, slash) : '';
}

function mimeTypeForKmzEntry(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'bmp': return 'image/bmp';
    case 'tga': return 'image/x-tga';
    case 'dds': return 'image/vnd-ms.dds';
    default: return 'application/octet-stream';
  }
}

export function loadMd2Object(source: ArrayBuffer): Object3D {
  const geometry = new MD2Loader().parse(source) as BufferGeometry | undefined;
  if (!geometry) {
    throw new Error('Invalid MD2 model data.');
  }
  if (!geometry.hasAttribute('normal')) {
    geometry.computeVertexNormals();
  }
  return new Mesh(geometry, new MeshStandardMaterial({
    color: 0x7dd3fc,
    roughness: 0.58,
    metalness: 0.04
  }));
}

export function loadLwoObject(source: ArrayBuffer, resourcePath = '', modelName = 'model'): Object3D {
  return loadLwoObjectWithWarnings(source, { resourcePath, modelName }).object;
}

export interface LoadLwoObjectOptions {
  resourceBasePath?: string;
  resourcePath?: string;
  modelName?: string;
  resourceResolver?: PreviewResourceResolver;
  sourceFormat?: string;
  signal?: AbortSignal;
}

export function loadLwoObjectWithWarnings(
  source: ArrayBuffer,
  options: LoadLwoObjectOptions = {}
): ModelObjectLoadResult {
  const objectUrls: string[] = [];
  const warnings: string[] = [];
  const manager = new LoadingManager();
  if (options.resourceResolver) {
    manager.setURLModifier((url) => resolveLwoTextureUrl(url, options, warnings, objectUrls));
  }
  const loader = new LWOLoader(manager);
  const result = loader.parse(
    source,
    options.resourcePath ?? '',
    options.modelName ?? 'model'
  );
  const group = new Group();
  for (const mesh of result.meshes ?? []) {
    group.add(mesh);
  }
  if (!group.children.length) {
    for (const url of objectUrls) {
      URL.revokeObjectURL(url);
    }
    throw new Error('No LWO meshes found.');
  }
  if (objectUrls.length) {
    group.userData.previewObjectUrls = objectUrls;
  }
  return {
    object: group,
    warnings
  };
}

export interface LoadVrmlObjectOptions {
  resourceBasePath?: string;
  resourcePath?: string;
  resourceResolver?: PreviewResourceResolver;
  sourceFormat?: string;
  signal?: AbortSignal;
}

export function loadBvhObject(source: string): Object3D {
  const result = new BVHLoader().parse(source);
  const rootBone = result.skeleton.bones[0];
  if (!rootBone) {
    throw new Error('No BVH skeleton bones found.');
  }
  const group = new Group();
  group.add(rootBone);
  const helper = new SkeletonHelper(rootBone);
  const helperMaterial = helper.material as LineBasicMaterial | LineBasicMaterial[];
  for (const material of Array.isArray(helperMaterial) ? helperMaterial : [helperMaterial]) {
    material.color.set(0x7dd3fc);
  }
  group.add(helper);
  return group;
}

export function loadPdbObject(source: string): Object3D {
  const result = new PDBLoader().parse(source);
  const group = new Group();
  if (result.geometryAtoms.getAttribute('position')?.count) {
    group.add(new Points(result.geometryAtoms, new PointsMaterial({
      size: 0.6,
      color: 0xffffff,
      vertexColors: true
    })));
  }
  if (result.geometryBonds.getAttribute('position')?.count) {
    group.add(new LineSegments(result.geometryBonds, new LineBasicMaterial({
      color: 0xdbeafe,
      transparent: true,
      opacity: 0.72
    })));
  }
  if (!group.children.length) {
    throw new Error('No PDB atoms found.');
  }
  return group;
}

export function loadNrrdObject(source: ArrayBuffer): Object3D {
  const volume = new NRRDLoader().parse(source as unknown as string);
  const [minValue, maxValue] = volume.computeMinMax();
  const range = maxValue - minValue;
  const lowerThreshold = minValue <= 0 && maxValue > 0 ? 0 : range > 0 ? minValue + range * 0.5 : minValue;
  const voxelCount = volume.data.length;
  const maxPoints = 60000;
  const stride = Math.max(1, Math.ceil(voxelCount / maxPoints));
  const spacing = volume.spacing.length >= 3 ? volume.spacing : [1, 1, 1];
  const positions: number[] = [];
  const colors: number[] = [];

  for (let index = 0; index < voxelCount; index += stride) {
    const value = Number(volume.data[index]);
    if (!Number.isFinite(value) || value < lowerThreshold) {
      continue;
    }
    const x = index % volume.xLength;
    const yzIndex = Math.floor(index / volume.xLength);
    const y = yzIndex % volume.yLength;
    const z = Math.floor(yzIndex / volume.yLength);
    positions.push(x * spacing[0], y * spacing[1], z * spacing[2]);
    const intensity = range > 0 ? clamp((value - minValue) / range, 0, 1) : 1;
    colors.push(
      0.22 + intensity * 0.64,
      0.3 + intensity * 0.55,
      0.4 + intensity * 0.52
    );
  }

  if (!positions.length) {
    throw new Error('No NRRD voxels passed the preview threshold.');
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return new Points(geometry, new PointsMaterial({
    size: Math.max(Math.min(...spacing.filter((value) => value > 0)), 1) * 0.75,
    vertexColors: true
  }));
}

export interface ResolveNhdrBufferOptions {
  resourceBasePath?: string;
  resourceResolver?: PreviewResourceResolver;
  sourceFormat?: string;
  signal?: AbortSignal;
}

export async function resolveNhdrBuffer(
  source: string,
  options: ResolveNhdrBufferOptions = {}
): Promise<ArrayBuffer> {
  const reference = listNhdrDataFileReference(source);
  if (!reference) {
    return new TextEncoder().encode(source).buffer;
  }
  const resourceResolver = options.resourceResolver;
  if (!resourceResolver) {
    throw new Error(`NHDR references external data file "${reference}" but no resourceResolver was provided.`);
  }
  if (options.signal?.aborted) {
    throw new DOMException('3D preview aborted.', 'AbortError');
  }
  const baseDir = dirname(options.resourceBasePath ?? '');
  const resolved = normalizeResourceResolverResult(
    await resolveModelResource(resourceResolver, {
      source: joinResourcePath(baseDir, reference),
      fallbackSource: reference,
      relation: 'volume',
      sourceFormat: options.sourceFormat ?? 'nhdr'
    }),
    'application/octet-stream'
  );
  if (!resolved.source) {
    throw new Error(`NHDR external data file "${reference}" could not be resolved.`);
  }
  const dataBuffer = await previewSourceToArrayBuffer(resolved.source, options.signal);
  return mergeNhdrHeaderAndData(source, dataBuffer);
}

export interface LoadFbxObjectOptions {
  resourceBasePath?: string;
  resourcePath?: string;
  resourceResolver?: PreviewResourceResolver;
  sourceFormat?: string;
  signal?: AbortSignal;
}

export interface Load3dsObjectOptions {
  resourceBasePath?: string;
  resourcePath?: string;
  resourceResolver?: PreviewResourceResolver;
  sourceFormat?: string;
  signal?: AbortSignal;
}

export function loadFbxObject(source: ArrayBuffer, resourcePath = ''): Object3D {
  return loadFbxObjectWithWarnings(source, { resourcePath }).object;
}

export function loadFbxObjectWithWarnings(
  source: ArrayBuffer,
  options: LoadFbxObjectOptions = {}
): ModelObjectLoadResult {
  const objectUrls: string[] = [];
  const warnings: string[] = [];
  const manager = new LoadingManager();
  if (options.resourceResolver) {
    manager.setURLModifier((url) => resolveFbxTextureUrl(url, options, warnings, objectUrls));
  }
  const object = new FBXLoader(manager).parse(source, options.resourcePath ?? '');
  if (objectUrls.length) {
    object.userData.previewObjectUrls = objectUrls;
  }
  return {
    object,
    warnings
  };
}

export function load3dsObject(source: ArrayBuffer, resourcePath = ''): Object3D {
  return load3dsObjectWithWarnings(source, { resourcePath }).object;
}

export function load3dsObjectWithWarnings(
  source: ArrayBuffer,
  options: Load3dsObjectOptions = {}
): ModelObjectLoadResult {
  const objectUrls: string[] = [];
  const warnings: string[] = [];
  const manager = new LoadingManager();
  if (options.resourceResolver) {
    manager.setURLModifier((url) => resolve3dsTextureUrl(url, options, warnings, objectUrls));
  }
  const object = new TDSLoader(manager).parse(source, options.resourcePath ?? '');
  if (objectUrls.length) {
    object.userData.previewObjectUrls = objectUrls;
  }
  return {
    object,
    warnings
  };
}

export async function loadUsdzObject(source: ArrayBuffer): Promise<Object3D> {
  return new USDZLoader().parse(source);
}

export async function loadStepObject(source: ArrayBuffer): Promise<Object3D> {
  occtImporterPromise ??= Promise.all([
    import('occt-import-js'),
    import('occt-import-js/dist/occt-import-js.wasm?url')
  ]).then(([{ default: createOcctImporter }, { default: wasmUrl }]) =>
    createOcctImporter({ locateFile: () => wasmUrl })
  );
  const importer = await occtImporterPromise;
  const result = importer.ReadStepFile(new Uint8Array(source), { linearUnit: 'millimeter' });
  if (!result.success || !result.root || !result.meshes?.length) {
    throw new Error('OpenCascade could not read this STEP file.');
  }

  const createNode = (sourceNode: NonNullable<typeof result.root>): Object3D => {
    const node = new Group();
    node.name = sourceNode.name ?? '';
    for (const meshIndex of sourceNode.meshes ?? []) {
      const sourceMesh = result.meshes?.[meshIndex];
      if (!sourceMesh) continue;
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(sourceMesh.attributes.position.array, 3));
      if (sourceMesh.attributes.normal) {
        geometry.setAttribute('normal', new Float32BufferAttribute(sourceMesh.attributes.normal.array, 3));
      } else {
        geometry.computeVertexNormals();
      }
      geometry.setIndex(sourceMesh.index.array);
      // ponytail: STEP face colors collapse to the mesh color; add geometry groups when face-level inspection matters.
      const color = sourceMesh.color ?? [0.72, 0.76, 0.82];
      const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: new Color(...color), side: DoubleSide }));
      mesh.name = sourceMesh.name ?? '';
      node.add(mesh);
    }
    for (const child of sourceNode.children ?? []) {
      node.add(createNode(child));
    }
    return node;
  };

  return createNode(result.root);
}

export function loadGCodeObject(source: string): Object3D {
  return new GCodeLoader().parse(source);
}

export function loadVrmlObject(source: string, resourcePath = ''): Object3D {
  return loadVrmlObjectWithWarnings(source, { resourcePath }).object;
}

export function loadVrmlObjectWithWarnings(
  source: string,
  options: LoadVrmlObjectOptions = {}
): ModelObjectLoadResult {
  const objectUrls: string[] = [];
  const warnings: string[] = [];
  const manager = new LoadingManager();
  if (options.resourceResolver) {
    manager.setURLModifier((url) => resolveVrmlTextureUrl(url, options, warnings, objectUrls));
  }
  const object = new VRMLLoader(manager).parse(source, options.resourcePath ?? '');
  if (objectUrls.length) {
    object.userData.previewObjectUrls = objectUrls;
  }
  return {
    object,
    warnings
  };
}

export function loadPcdObject(source: ArrayBuffer): Object3D {
  return new PCDLoader().parse(source);
}

export function loadXyzObject(source: string): Object3D {
  const geometry = (new XYZLoader().parse as unknown as (text: string) => BufferGeometry)(source);
  const hasColor = geometry.hasAttribute('color');
  return new Points(geometry, new PointsMaterial({
    size: 0.08,
    color: hasColor ? 0xffffff : 0x7dd3fc,
    vertexColors: hasColor
  }));
}

export function loadVtkObject(source: ArrayBuffer | string): Object3D {
  const geometry = new VTKLoader().parse(prepareVtkLoaderSource(source), '');
  if (!geometry.hasAttribute('normal')) {
    geometry.computeVertexNormals();
  }
  return new Mesh(geometry, new MeshStandardMaterial({
    color: geometry.hasAttribute('color') ? 0xffffff : 0x7dd3fc,
    roughness: 0.58,
    metalness: 0.04,
    vertexColors: geometry.hasAttribute('color')
  }));
}

function prepareVtkLoaderSource(source: ArrayBuffer | string): ArrayBuffer {
  const bytes = typeof source === 'string' ? new TextEncoder().encode(source) : new Uint8Array(source);
  if (bytes.byteLength >= VTK_HEADER_PROBE_BYTES) {
    return typeof source === 'string' ? bytes.buffer : source;
  }

  // Three.js probes a fixed 250-byte prefix even when the complete VTK file is shorter.
  const padded = new Uint8Array(VTK_HEADER_PROBE_BYTES);
  padded.fill(0x20);
  padded.set(bytes);
  padded[padded.length - 1] = 0x0a;
  return padded.buffer;
}

export function loadVoxObject(source: ArrayBuffer): Object3D {
  const chunks = new VOXLoader().parse(source) as Array<object | undefined> | undefined;
  const group = new Group();
  for (const chunk of chunks ?? []) {
    if (!chunk) {
      continue;
    }
    group.add(new VOXMesh(chunk as ConstructorParameters<typeof VOXMesh>[0]));
  }
  return group;
}

export interface LoadLDrawObjectOptions {
  resourceBasePath?: string;
  resourceResolver?: PreviewResourceResolver;
  sourceFormat?: string;
  signal?: AbortSignal;
}

export async function loadLDrawObject(source: string, options: LoadLDrawObjectOptions = {}): Promise<Object3D> {
  return (await loadLDrawObjectWithWarnings(source, options)).object;
}

export async function loadLDrawObjectWithWarnings(
  source: string,
  options: LoadLDrawObjectOptions = {}
): Promise<ModelObjectLoadResult> {
  const loader = new LDrawLoader() as LDrawLoader & {
    setPartsLibraryPath(path: string): LDrawLoader;
    parse(text: string, onLoad: (group: Group) => void, onError?: (error: unknown) => void): void;
  };
  loader.setConditionalLineMaterial(LDrawConditionalLineMaterial);
  loader.setMaterials([]);

  const warnings: string[] = [];
  const objectUrls: string[] = [];
  const fileMap = options.resourceResolver
    ? await buildLDrawFileMap(source, options, warnings, objectUrls)
    : undefined;
  if (fileMap && Object.keys(fileMap).length > 0) {
    loader.setFileMap(fileMap);
    loader.setPartsLibraryPath('');
  }

  try {
    const object = await new Promise<Object3D>((resolve, reject) => {
      loader.parse(source, (group: Group) => resolve(group), (error: unknown) => reject(error));
    });
    return { object, warnings };
  } catch (error) {
    if (warnings.length) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      normalizedError.message = `${normalizedError.message} Warnings: ${warnings.join(' ')}`;
      throw normalizedError;
    }
    throw error;
  } finally {
    for (const url of objectUrls) {
      URL.revokeObjectURL(url);
    }
  }
}

export interface LoadGltfObjectOptions {
  resourcePath?: string;
  resourceResolver?: PreviewResourceResolver;
  sourceFormat?: string;
  signal?: AbortSignal;
}

export async function loadGltfObject(source: ArrayBuffer | string, options: LoadGltfObjectOptions = {}): Promise<Object3D> {
  return (await loadGltfObjectWithWarnings(source, options)).object;
}

export async function loadGltfObjectWithWarnings(
  source: ArrayBuffer | string,
  options: LoadGltfObjectOptions = {}
): Promise<ModelObjectLoadResult> {
  const text = typeof source === 'string' ? source : new TextDecoder().decode(source);
  const json = parseGltfJson(text);
  const externalResources = listExternalGltfResources(json);
  const resolved = externalResources.length && options.resourceResolver
    ? await resolveExternalGltfResources(json, externalResources, options)
    : {
        json,
        warnings: []
      };
  const remainingExternalResources = listExternalGltfResources(resolved.json);
  if (remainingExternalResources.length && !options.resourcePath) {
    throw new Error(`glTF references external resources that are not bundled with this preview: ${remainingExternalResources.join(', ')}.`);
  }

  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(JSON.stringify(resolved.json), options.resourcePath ?? '');
  return {
    object: gltf.scene,
    warnings: resolved.warnings
  };
}

export function listExternalGltfResources(gltf: unknown): string[] {
  if (!gltf || typeof gltf !== 'object') {
    return [];
  }
  const root = gltf as {
    buffers?: Array<{ uri?: unknown }>;
    images?: Array<{ uri?: unknown; bufferView?: unknown }>;
  };
  const resources = [
    ...(root.buffers ?? []).map((buffer) => buffer.uri),
    ...(root.images ?? [])
      .filter((image) => image.bufferView == null)
      .map((image) => image.uri)
  ];
  return [...new Set(resources
    .filter((uri): uri is string => typeof uri === 'string' && uri.trim().length > 0)
    .map((uri) => uri.trim())
    .filter((uri) => !isEmbeddedGltfUri(uri)))];
}

async function resolveExternalGltfResources(
  gltf: unknown,
  externalResources: string[],
  options: LoadGltfObjectOptions
): Promise<{ json: unknown; warnings: string[] }> {
  const root = cloneGltfJson(gltf);
  const warnings: string[] = [];
  for (const uri of externalResources) {
    if (options.signal?.aborted) {
      throw new DOMException('3D preview aborted.', 'AbortError');
    }
    const resolved = normalizeResourceResolverResult(
      await options.resourceResolver?.({
        family: 'model3d',
        sourceFormat: options.sourceFormat ?? 'gltf',
        source: uri,
        relation: gltfResourceRelation(root, uri),
        name: uri.split(/[\\/]/).pop() ?? uri
      }),
      gltfResourceContentType(uri)
    );
    warnings.push(...resolved.warnings);
    if (resolved.source) {
      rewriteGltfResourceUri(root, uri, resolved.source);
    }
  }
  return {
    json: root,
    warnings
  };
}

async function rewriteObjMaterialResources(
  materialText: string,
  materialLibraryPath: string,
  options: LoadObjObjectOptions
): Promise<{ text: string; warnings: string[] }> {
  const materialDir = dirname(joinResourcePath(dirname(options.resourceBasePath ?? ''), materialLibraryPath));
  const rewrittenLines: string[] = [];
  const warnings: string[] = [];
  for (const rawLine of materialText.split(/\r?\n/)) {
    const parsed = parseObjMaterialMapLine(rawLine);
    if (!parsed || !options.resourceResolver) {
      rewrittenLines.push(rawLine);
      continue;
    }
    if (options.signal?.aborted) {
      throw new DOMException('3D preview aborted.', 'AbortError');
    }
    const resolved = normalizeResourceResolverResult(
      await resolveModelResource(options.resourceResolver, {
        source: joinResourcePath(materialDir, parsed.path),
        fallbackSource: parsed.path,
        relation: 'texture',
        sourceFormat: options.sourceFormat ?? 'obj'
      }),
      objResourceContentType(parsed.path)
    );
    warnings.push(...resolved.warnings);
    if (!resolved.source) {
      warnings.push(`OBJ texture "${parsed.path}" could not be resolved; the material map was left unchanged.`);
      rewrittenLines.push(rawLine);
      continue;
    }
    rewrittenLines.push(`${parsed.prefix}${resolved.source}`);
  }
  return {
    text: rewrittenLines.join('\n'),
    warnings
  };
}

async function resolveModelResource(
  resourceResolver: PreviewResourceResolver,
  request: {
    source: string;
    fallbackSource: string;
    relation: string;
    sourceFormat: string;
  }
): Promise<Awaited<ReturnType<PreviewResourceResolver>>> {
  const primary = await resourceResolver({
    family: 'model3d',
    sourceFormat: request.sourceFormat,
    source: request.source,
    relation: request.relation,
    name: request.source.split(/[\\/]/).pop() ?? request.source
  });
  if (normalizeResourceResolverResult(primary, objResourceContentType(request.source)).source) {
    return primary;
  }
  if (request.fallbackSource === request.source) {
    return primary;
  }
  return resourceResolver({
    family: 'model3d',
    sourceFormat: request.sourceFormat,
    source: request.fallbackSource,
    relation: request.relation,
    name: request.fallbackSource.split(/[\\/]/).pop() ?? request.fallbackSource
  });
}

async function buildLDrawFileMap(
  source: string,
  options: LoadLDrawObjectOptions,
  warnings: string[],
  objectUrls: string[]
): Promise<Record<string, string>> {
  const resourceResolver = options.resourceResolver;
  if (!resourceResolver) {
    return {};
  }

  const references = listLDrawSubfileReferences(source);
  const baseDir = dirname(options.resourceBasePath ?? '');
  const fileMap: Record<string, string> = {};

  for (const reference of references) {
    if (options.signal?.aborted) {
      throw new DOMException('3D preview aborted.', 'AbortError');
    }

    const normalizedReference = normalizeLDrawReference(reference);
    const resolved = normalizeResourceResolverResult(
      await resolveModelResource(resourceResolver, {
        source: joinResourcePath(baseDir, normalizedReference),
        fallbackSource: normalizedReference,
        relation: 'part',
        sourceFormat: options.sourceFormat ?? 'ldr'
      }),
      'text/plain'
    );
    warnings.push(...resolved.warnings);

    if (!resolved.source) {
      warnings.push(`LDraw part "${reference}" could not be resolved; dependent geometry may be missing.`);
      continue;
    }

    fileMap[normalizedReference] = resolved.source;
    const lower = normalizedReference.toLowerCase();
    if (!(lower in fileMap)) {
      fileMap[lower] = resolved.source;
    }
    if (resolved.source.startsWith('blob:')) {
      objectUrls.push(resolved.source);
    }
  }

  return fileMap;
}

function parseObjMaterialMapLine(line: string): { prefix: string; path: string } | undefined {
  const match = /^(\s*map_\S+\s+(?:-(?:\w+)\s+\S+\s+)*)(.+?)\s*$/i.exec(line);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  return {
    prefix: match[1],
    path: match[2].trim()
  };
}

function listNhdrDataFileReference(source: string): string | undefined {
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const match = /^data\s*file\s*:\s*(.+)$/i.exec(line) ?? /^datafile\s*:\s*(.+)$/i.exec(line);
    if (!match?.[1]) {
      continue;
    }
    const value = match[1].trim();
    if (!value || /[\s%]/.test(value)) {
      throw new Error(`NHDR data file reference "${value}" is not supported for direct preview yet.`);
    }
    return value;
  }
  return undefined;
}

function mergeNhdrHeaderAndData(source: string, dataBuffer: ArrayBuffer): ArrayBuffer {
  const lines = source.split(/\r?\n/);
  const rewrittenLines: string[] = [];
  let replacedDataFile = false;
  let replacedEncoding = false;

  for (const rawLine of lines) {
    if (/^\s*data\s*file\s*:/i.test(rawLine) || /^\s*datafile\s*:/i.test(rawLine)) {
      rewrittenLines.push('encoding: raw');
      replacedDataFile = true;
      replacedEncoding = true;
      continue;
    }
    if (/^\s*encoding\s*:/i.test(rawLine)) {
      rewrittenLines.push('encoding: raw');
      replacedEncoding = true;
      continue;
    }
    rewrittenLines.push(rawLine);
  }

  if (!replacedDataFile) {
    return new TextEncoder().encode(source).buffer;
  }
  if (!replacedEncoding) {
    rewrittenLines.push('encoding: raw');
  }

  const normalizedHeader = rewrittenLines.join('\n').replace(/\s+$/, '');
  const headerBytes = new TextEncoder().encode(`${normalizedHeader}\n\n`);
  const dataBytes = new Uint8Array(dataBuffer);
  const merged = new Uint8Array(headerBytes.byteLength + dataBytes.byteLength);
  merged.set(headerBytes, 0);
  merged.set(dataBytes, headerBytes.byteLength);
  return merged.buffer;
}

function resolveLwoTextureUrl(
  url: string,
  options: LoadLwoObjectOptions,
  warnings: string[],
  objectUrls: string[]
): string {
  const resourceResolver = options.resourceResolver;
  if (!resourceResolver) {
    return url;
  }
  if (options.signal?.aborted) {
    throw new DOMException('3D preview aborted.', 'AbortError');
  }
  const baseDir = dirname(options.resourceBasePath ?? '');
  const requestedPath = url.replace(/\\/g, '/');
  const candidates = [
    joinResourcePath(baseDir, requestedPath),
    requestedPath,
    requestedPath.split('/').pop() ?? requestedPath
  ];

  for (const candidate of candidates) {
    const resolved = resourceResolver({
      family: 'model3d',
      sourceFormat: options.sourceFormat ?? 'lwo',
      source: candidate,
      relation: 'texture',
      name: candidate.split(/[\\/]/).pop() ?? candidate
    });
    if (resolved && !(resolved instanceof Promise)) {
      const normalized = normalizeResourceResolverResult(resolved, objResourceContentType(candidate));
      warnings.push(...normalized.warnings);
      if (normalized.source) {
        const dataUrl = normalizeResolvedPreviewSource(normalized.source, objResourceContentType(candidate));
        if (!dataUrl) {
          warnings.push(`LWO texture "${requestedPath}" resolved to an unsupported source type; default loader lookup was used.`);
          return url;
        }
        if (dataUrl.startsWith('blob:')) {
          objectUrls.push(dataUrl);
        }
        return dataUrl;
      }
    }
  }

  warnings.push(`LWO texture "${requestedPath}" could not be resolved; default loader lookup was used.`);
  return url;
}

function resolveVrmlTextureUrl(
  url: string,
  options: LoadVrmlObjectOptions,
  warnings: string[],
  objectUrls: string[]
): string {
  const resourceResolver = options.resourceResolver;
  if (!resourceResolver) {
    return url;
  }
  if (options.signal?.aborted) {
    throw new DOMException('3D preview aborted.', 'AbortError');
  }
  const baseDir = dirname(options.resourceBasePath ?? '');
  const requestedPath = url.replace(/\\/g, '/');
  const candidates = [
    joinResourcePath(baseDir, requestedPath),
    requestedPath,
    requestedPath.split('/').pop() ?? requestedPath
  ];

  for (const candidate of candidates) {
    const resolved = resourceResolver({
      family: 'model3d',
      sourceFormat: options.sourceFormat ?? 'vrml',
      source: candidate,
      relation: 'texture',
      name: candidate.split(/[\\/]/).pop() ?? candidate
    });
    if (resolved && !(resolved instanceof Promise)) {
      const normalized = normalizeResourceResolverResult(resolved, objResourceContentType(candidate));
      warnings.push(...normalized.warnings);
      if (normalized.source) {
        const dataUrl = normalizeResolvedPreviewSource(normalized.source, objResourceContentType(candidate));
        if (!dataUrl) {
          warnings.push(`VRML texture "${requestedPath}" resolved to an unsupported source type; default loader lookup was used.`);
          return url;
        }
        if (dataUrl.startsWith('blob:')) {
          objectUrls.push(dataUrl);
        }
        return dataUrl;
      }
    }
  }

  warnings.push(`VRML texture "${requestedPath}" could not be resolved; default loader lookup was used.`);
  return url;
}

function resolveColladaTextureUrl(
  url: string,
  options: LoadColladaObjectOptions,
  warnings: string[],
  objectUrls: string[]
): string {
  const resourceResolver = options.resourceResolver;
  if (!resourceResolver) {
    return url;
  }
  if (options.signal?.aborted) {
    throw new DOMException('3D preview aborted.', 'AbortError');
  }
  const baseDir = dirname(options.resourceBasePath ?? '');
  const requestedPath = url.replace(/\\/g, '/');
  const candidates = [
    joinResourcePath(baseDir, requestedPath),
    requestedPath,
    requestedPath.split('/').pop() ?? requestedPath
  ];

  for (const candidate of candidates) {
    const resolved = resourceResolver({
      family: 'model3d',
      sourceFormat: options.sourceFormat ?? 'dae',
      source: candidate,
      relation: 'texture',
      name: candidate.split(/[\\/]/).pop() ?? candidate
    });
    if (resolved && !(resolved instanceof Promise)) {
      const normalized = normalizeResourceResolverResult(resolved, objResourceContentType(candidate));
      warnings.push(...normalized.warnings);
      if (normalized.source) {
        const dataUrl = normalizeResolvedPreviewSource(normalized.source, objResourceContentType(candidate));
        if (!dataUrl) {
          warnings.push(`Collada texture "${requestedPath}" resolved to an unsupported source type; default loader lookup was used.`);
          return url;
        }
        if (dataUrl.startsWith('blob:')) {
          objectUrls.push(dataUrl);
        }
        return dataUrl;
      }
    }
  }

  warnings.push(`Collada texture "${requestedPath}" could not be resolved; default loader lookup was used.`);
  return url;
}

function resolveFbxTextureUrl(
  url: string,
  options: LoadFbxObjectOptions,
  warnings: string[],
  objectUrls: string[]
): string {
  const resourceResolver = options.resourceResolver;
  if (!resourceResolver) {
    return url;
  }
  if (options.signal?.aborted) {
    throw new DOMException('3D preview aborted.', 'AbortError');
  }
  const baseDir = dirname(options.resourceBasePath ?? '');
  const requestedPath = url.replace(/\\/g, '/');
  const candidates = [
    joinResourcePath(baseDir, requestedPath),
    requestedPath,
    requestedPath.split('/').pop() ?? requestedPath
  ];

  for (const candidate of candidates) {
    const resolved = resourceResolver({
      family: 'model3d',
      sourceFormat: options.sourceFormat ?? 'fbx',
      source: candidate,
      relation: 'texture',
      name: candidate.split(/[\\/]/).pop() ?? candidate
    });
    if (resolved && !(resolved instanceof Promise)) {
      const normalized = normalizeResourceResolverResult(resolved, objResourceContentType(candidate));
      warnings.push(...normalized.warnings);
      if (normalized.source) {
        const dataUrl = normalizeResolvedPreviewSource(normalized.source, objResourceContentType(candidate));
        if (!dataUrl) {
          warnings.push(`FBX texture "${requestedPath}" resolved to an unsupported source type; default loader lookup was used.`);
          return url;
        }
        if (dataUrl.startsWith('blob:')) {
          objectUrls.push(dataUrl);
        }
        return dataUrl;
      }
    }
  }

  warnings.push(`FBX texture "${requestedPath}" could not be resolved; default loader lookup was used.`);
  return url;
}

function resolve3dsTextureUrl(
  url: string,
  options: Load3dsObjectOptions,
  warnings: string[],
  objectUrls: string[]
): string {
  const resourceResolver = options.resourceResolver;
  if (!resourceResolver) {
    return url;
  }
  if (options.signal?.aborted) {
    throw new DOMException('3D preview aborted.', 'AbortError');
  }
  const baseDir = dirname(options.resourceBasePath ?? '');
  const requestedPath = url.replace(/\\/g, '/');
  const candidates = [
    joinResourcePath(baseDir, requestedPath),
    requestedPath,
    requestedPath.split('/').pop() ?? requestedPath
  ];

  for (const candidate of candidates) {
    const resolved = resourceResolver({
      family: 'model3d',
      sourceFormat: options.sourceFormat ?? '3ds',
      source: candidate,
      relation: 'texture',
      name: candidate.split(/[\\/]/).pop() ?? candidate
    });
    if (resolved && !(resolved instanceof Promise)) {
      const normalized = normalizeResourceResolverResult(resolved, objResourceContentType(candidate));
      warnings.push(...normalized.warnings);
      if (normalized.source) {
        const dataUrl = normalizeResolvedPreviewSource(normalized.source, objResourceContentType(candidate));
        if (!dataUrl) {
          warnings.push(`3DS texture "${requestedPath}" resolved to an unsupported source type; default loader lookup was used.`);
          return url;
        }
        if (dataUrl.startsWith('blob:')) {
          objectUrls.push(dataUrl);
        }
        return dataUrl;
      }
    }
  }

  warnings.push(`3DS texture "${requestedPath}" could not be resolved; default loader lookup was used.`);
  return url;
}

function listLDrawSubfileReferences(source: string): string[] {
  const references = new Set<string>();
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('0')) {
      continue;
    }
    const parts = line.split(/\s+/);
    if (parts[0] !== '1' || parts.length < 15) {
      continue;
    }
    const reference = parts.slice(14).join(' ').trim();
    if (reference) {
      references.add(reference);
    }
  }
  return [...references];
}

function normalizeLDrawReference(reference: string): string {
  const normalized = reference.replace(/\\/g, '/').replace(/^\.?\//, '');
  if (normalized.startsWith('s/')) return `parts/${normalized}`;
  if (normalized.startsWith('48/')) return `p/${normalized}`;
  return normalized;
}

function cloneGltfJson(gltf: unknown): unknown {
  return JSON.parse(JSON.stringify(gltf)) as unknown;
}

function rewriteGltfResourceUri(gltf: unknown, originalUri: string, resolvedUri: string): void {
  if (!gltf || typeof gltf !== 'object') {
    return;
  }
  const root = gltf as {
    buffers?: Array<{ uri?: unknown }>;
    images?: Array<{ uri?: unknown; bufferView?: unknown }>;
  };
  for (const buffer of root.buffers ?? []) {
    if (buffer.uri === originalUri) {
      buffer.uri = resolvedUri;
    }
  }
  for (const image of root.images ?? []) {
    if (image.bufferView == null && image.uri === originalUri) {
      image.uri = resolvedUri;
    }
  }
}

function gltfResourceRelation(gltf: unknown, uri: string): string {
  if (!gltf || typeof gltf !== 'object') {
    return 'resource';
  }
  const root = gltf as {
    buffers?: Array<{ uri?: unknown }>;
    images?: Array<{ uri?: unknown; bufferView?: unknown }>;
  };
  if ((root.buffers ?? []).some((buffer) => buffer.uri === uri)) {
    return 'buffer';
  }
  if ((root.images ?? []).some((image) => image.bufferView == null && image.uri === uri)) {
    return 'image';
  }
  return 'resource';
}

async function sourceToArrayBuffer(source: PreviewSource, context: PreviewLoadContext): Promise<ArrayBuffer> {
  if (typeof source === 'string') {
    const response = await fetch(source, { signal: context.signal });
    if (!response.ok) {
      throw new Error(`Failed to load 3D source: ${response.status} ${response.statusText}`.trim());
    }
    return response.arrayBuffer();
  }
  if (source instanceof Blob) {
    return source.arrayBuffer();
  }
  if (ArrayBuffer.isView(source)) {
    const copy = new Uint8Array(source.byteLength);
    copy.set(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
    return copy.buffer;
  }
  if (source instanceof ArrayBuffer) {
    return source;
  }
  throw new Error('Unsupported 3D source type.');
}

async function previewSourceToArrayBuffer(source: PreviewSource, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (typeof source === 'string') {
    const response = await fetch(source, { signal });
    if (!response.ok) {
      throw new Error(`Failed to load 3D source: ${response.status} ${response.statusText}`.trim());
    }
    return response.arrayBuffer();
  }
  if (source instanceof Blob) {
    return source.arrayBuffer();
  }
  if (ArrayBuffer.isView(source)) {
    const copy = new Uint8Array(source.byteLength);
    copy.set(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
    return copy.buffer;
  }
  if (source instanceof ArrayBuffer) {
    return source;
  }
  throw new Error('Unsupported 3D source type.');
}

function parseAsciiStl(source: string): StlGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  let currentNormal: [number, number, number] = [0, 0, 1];
  const vertexBuffer: Array<[number, number, number]> = [];

  for (const line of source.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'facet' && parts[1] === 'normal') {
      currentNormal = [numberPart(parts[2]), numberPart(parts[3]), numberPart(parts[4])];
      continue;
    }
    if (parts[0] !== 'vertex') {
      continue;
    }
    vertexBuffer.push([numberPart(parts[1]), numberPart(parts[2]), numberPart(parts[3])]);
    if (vertexBuffer.length === 3) {
      for (const vertex of vertexBuffer.splice(0, 3)) {
        positions.push(...vertex);
        normals.push(...currentNormal);
      }
    }
  }

  if (!positions.length) {
    throw new Error('No STL triangles found.');
  }
  return geometryFromArrays(positions, normals);
}

function parseBinaryStl(bytes: Uint8Array): StlGeometry {
  if (bytes.byteLength < 84) {
    throw new Error('Binary STL is too small.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangleCount = view.getUint32(80, true);
  const expectedLength = 84 + triangleCount * 50;
  if (expectedLength > bytes.byteLength) {
    throw new Error('Binary STL triangle data is truncated.');
  }

  const positions: number[] = [];
  const normals: number[] = [];
  let offset = 84;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const normal: [number, number, number] = [
      view.getFloat32(offset, true),
      view.getFloat32(offset + 4, true),
      view.getFloat32(offset + 8, true)
    ];
    offset += 12;
    for (let vertex = 0; vertex < 3; vertex += 1) {
      positions.push(view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true));
      normals.push(...normal);
      offset += 12;
    }
    offset += 2;
  }

  if (!positions.length) {
    throw new Error('No STL triangles found.');
  }
  return geometryFromArrays(positions, normals);
}

interface ObjFaceVertex {
  vertexIndex: number;
  normalIndex?: number;
}

type Transform3mf = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number
];

interface Mesh3mf {
  positions: Array<[number, number, number]>;
  colors: Array<[number, number, number]>;
}

const IDENTITY_TRANSFORM: Transform3mf = [
  1, 0, 0,
  0, 1, 0,
  0, 0, 1,
  0, 0, 0
];

function localElements(root: ParentNode, localName: string): Element[] {
  return Array.from(root.querySelectorAll('*')).filter((element) => element.localName === localName);
}

function directLocalElements(root: ParentNode, localName: string): Element[] {
  return Array.from(root.children).filter((element) => element.localName === localName);
}

function resolve3mfObjectMesh(
  objectId: string,
  objectElements: Map<string, Element>,
  objectMeshes: Map<string, Mesh3mf>,
  activeObjectIds: Set<string>
): Mesh3mf | undefined {
  const existing = objectMeshes.get(objectId);
  if (existing) {
    return existing;
  }
  if (activeObjectIds.has(objectId)) {
    return undefined;
  }
  const objectElement = objectElements.get(objectId);
  if (!objectElement) {
    return undefined;
  }
  activeObjectIds.add(objectId);
  const componentsElement = directLocalElements(objectElement, 'components')[0];
  if (!componentsElement) {
    activeObjectIds.delete(objectId);
    return undefined;
  }
  const positions: Mesh3mf['positions'] = [];
  const colors: Mesh3mf['colors'] = [];
  for (const component of directLocalElements(componentsElement, 'component')) {
    const childObjectId = component.getAttribute('objectid');
    const childMesh = childObjectId ? resolve3mfObjectMesh(childObjectId, objectElements, objectMeshes, activeObjectIds) : undefined;
    if (!childMesh?.positions.length) {
      continue;
    }
    const transform = parse3mfTransform(component.getAttribute('transform'));
    for (let index = 0; index < childMesh.positions.length; index += 1) {
      positions.push(apply3mfTransform(childMesh.positions[index]!, transform));
      colors.push(childMesh.colors[index] ?? [0.49, 0.83, 0.99]);
    }
  }
  activeObjectIds.delete(objectId);
  if (!positions.length) {
    return undefined;
  }
  const mesh = { positions, colors };
  objectMeshes.set(objectId, mesh);
  return mesh;
}

function read3mfColorMaterials(document: Document): Map<string, Array<[number, number, number]>> {
  const resources = new Map<string, Array<[number, number, number]>>();
  for (const element of localElements(document, 'basematerials')) {
    const id = element.getAttribute('id');
    if (!id) {
      continue;
    }
    resources.set(id, localElements(element, 'base').map((base) => parse3mfColor(base.getAttribute('displaycolor'))));
  }
  for (const element of localElements(document, 'colorgroup')) {
    const id = element.getAttribute('id');
    if (!id) {
      continue;
    }
    resources.set(id, localElements(element, 'color').map((color) => parse3mfColor(color.getAttribute('color'))));
  }
  return resources;
}

function collect3mfUnsupportedMaterialWarnings(document: Document): string[] {
  const unsupported = [
    ...localElements(document, 'texture2d').map((element) => ['texture2d', element.getAttribute('id')] as const),
    ...localElements(document, 'texture2dgroup').map((element) => ['texture2dgroup', element.getAttribute('id')] as const),
    ...localElements(document, 'compositematerials').map((element) => ['composite materials', element.getAttribute('id')] as const),
    ...localElements(document, 'multiproperties').map((element) => ['multi properties', element.getAttribute('id')] as const)
  ];
  return unsupported
    .filter(([, id]) => Boolean(id))
    .map(([kind, id]) => `3MF ${kind} resource "${id}" is not rendered directly yet; base-material colors remain supported.`);
}

function noteUnsupported3mfMaterialReference(
  resourceId: string | null | undefined,
  colorMaterials: Map<string, Array<[number, number, number]>>,
  unsupportedReferencedMaterialIds: Set<string>
): void {
  if (resourceId && !colorMaterials.has(resourceId)) {
    unsupportedReferencedMaterialIds.add(resourceId);
  }
}

function resolve3mfColorReference(
  resourceId: string | null | undefined,
  materialIndex: string | null | undefined,
  colorMaterials: Map<string, Array<[number, number, number]>>
): [number, number, number] | undefined {
  if (!resourceId) {
    return undefined;
  }
  const palette = colorMaterials.get(resourceId);
  if (!palette?.length) {
    return undefined;
  }
  const index = Number(materialIndex ?? 0);
  return Number.isInteger(index) && index >= 0 && index < palette.length ? palette[index] : palette[0];
}

function parse3mfColor(value: string | null | undefined): [number, number, number] {
  const normalized = String(value ?? '').trim();
  const match = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(normalized);
  if (!match?.[1]) {
    return [0.49, 0.83, 0.99];
  }
  const hex = match[1];
  return [
    Number.parseInt(hex.slice(0, 2), 16) / 255,
    Number.parseInt(hex.slice(2, 4), 16) / 255,
    Number.parseInt(hex.slice(4, 6), 16) / 255
  ];
}

function parse3mfTransform(value: string | null): Transform3mf {
  if (!value) {
    return IDENTITY_TRANSFORM;
  }
  const parts = value.trim().split(/\s+/).map(Number);
  if (parts.length !== 12 || parts.some((part) => !Number.isFinite(part))) {
    return IDENTITY_TRANSFORM;
  }
  return parts as Transform3mf;
}

function apply3mfTransform(vertex: [number, number, number], transform: Transform3mf): [number, number, number] {
  return [
    vertex[0] * transform[0] + vertex[1] * transform[1] + vertex[2] * transform[2] + transform[9],
    vertex[0] * transform[3] + vertex[1] * transform[4] + vertex[2] * transform[5] + transform[10],
    vertex[0] * transform[6] + vertex[1] * transform[7] + vertex[2] * transform[8] + transform[11]
  ];
}

function parseObjFaceVertex(value: string, vertexCount: number, normalCount: number): ObjFaceVertex | undefined {
  const [vertexRaw, , normalRaw] = value.split('/');
  const vertexIndex = resolveObjIndex(Number(vertexRaw), vertexCount);
  if (vertexIndex == null) {
    return undefined;
  }
  const normalIndex = normalRaw ? resolveObjIndex(Number(normalRaw), normalCount) : undefined;
  return {
    vertexIndex,
    normalIndex
  };
}

function pushObjTriangle(
  first: ObjFaceVertex,
  second: ObjFaceVertex,
  third: ObjFaceVertex,
  vertices: Array<[number, number, number]>,
  vertexColors: Array<[number, number, number] | undefined>,
  normals: Array<[number, number, number]>,
  positions: number[],
  resolvedNormals: number[],
  colors: number[]
): void {
  const triangle = [first, second, third];
  const computedNormal = computeTriangleNormal(
    vertices[first.vertexIndex]!,
    vertices[second.vertexIndex]!,
    vertices[third.vertexIndex]!
  );
  for (const item of triangle) {
    positions.push(...vertices[item.vertexIndex]!);
    resolvedNormals.push(...(item.normalIndex != null ? normals[item.normalIndex] ?? computedNormal : computedNormal));
    const color = vertexColors[item.vertexIndex];
    if (color) {
      colors.push(...color);
    }
  }
}

function parseObjVertexColor(parts: string[]): [number, number, number] | undefined {
  if (parts.length < 7) {
    return undefined;
  }
  const color = [Number(parts[4]), Number(parts[5]), Number(parts[6])];
  if (color.some((part) => !Number.isFinite(part))) {
    return undefined;
  }
  return color.map((part) => clamp(part > 1 ? part / 255 : part, 0, 1)) as [number, number, number];
}

function resolveObjIndex(value: number, count: number): number | undefined {
  if (!Number.isInteger(value) || value === 0 || count <= 0) {
    return undefined;
  }
  const index = value > 0 ? value - 1 : count + value;
  return index >= 0 && index < count ? index : undefined;
}

function computeTriangleNormal(
  first: [number, number, number],
  second: [number, number, number],
  third: [number, number, number]
): [number, number, number] {
  const ux = second[0] - first[0];
  const uy = second[1] - first[1];
  const uz = second[2] - first[2];
  const vx = third[0] - first[0];
  const vy = third[1] - first[1];
  const vz = third[2] - first[2];
  return normalizeVector([
    uy * vz - uz * vy,
    uz * vx - ux * vz,
    ux * vy - uy * vx
  ]);
}

function normalizeVector(vector: [number, number, number]): [number, number, number] {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (!length) {
    return [0, 0, 1];
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

interface PlyHeader {
  format: string;
  dataOffset: number;
  vertexCount: number;
  faceCount: number;
  vertexProperties: PlyScalarProperty[];
  faceListProperty?: PlyListProperty;
}

interface PlyScalarProperty {
  name: string;
  type: PlyScalarType;
}

interface PlyListProperty {
  name: string;
  countType: PlyScalarType;
  itemType: PlyScalarType;
}

type PlyScalarType =
  | 'char'
  | 'uchar'
  | 'short'
  | 'ushort'
  | 'int'
  | 'uint'
  | 'float'
  | 'double'
  | 'int8'
  | 'uint8'
  | 'int16'
  | 'uint16'
  | 'int32'
  | 'uint32'
  | 'float32'
  | 'float64';

function readPlyHeader(bytes: Uint8Array): PlyHeader {
  const marker = findPlyHeaderEnd(bytes);
  if (!marker) {
    throw new Error('PLY header is missing end_header.');
  }
  const headerText = new TextDecoder().decode(bytes.slice(0, marker.headerEnd));
  const lines = headerText.replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines[0] !== 'ply') {
    throw new Error('Invalid PLY header.');
  }

  let format = '';
  let vertexCount = 0;
  let faceCount = 0;
  let currentElement: 'vertex' | 'face' | undefined;
  const vertexProperties: PlyScalarProperty[] = [];
  let faceListProperty: PlyListProperty | undefined;

  for (const line of lines.slice(1)) {
    const parts = line.split(/\s+/);
    if (parts[0] === 'format') {
      format = parts[1] ?? '';
      continue;
    }
    if (parts[0] === 'element') {
      currentElement = parts[1] === 'vertex' || parts[1] === 'face' ? parts[1] : undefined;
      if (parts[1] === 'vertex') vertexCount = Number(parts[2]) || 0;
      if (parts[1] === 'face') faceCount = Number(parts[2]) || 0;
      continue;
    }
    if (parts[0] !== 'property') {
      continue;
    }
    if (currentElement === 'vertex' && parts.length >= 3 && parts[1] !== 'list') {
      vertexProperties.push({
        type: normalizePlyScalarType(parts[1]!),
        name: parts[2]!
      });
      continue;
    }
    if (currentElement === 'face' && parts[1] === 'list' && parts.length >= 5 && !faceListProperty) {
      faceListProperty = {
        countType: normalizePlyScalarType(parts[2]!),
        itemType: normalizePlyScalarType(parts[3]!),
        name: parts[4]!
      };
    }
  }

  if (!format || !vertexCount || !faceCount || !vertexProperties.length || !faceListProperty) {
    throw new Error('PLY header does not define supported vertex and face data.');
  }
  return {
    format,
    dataOffset: marker.dataOffset,
    vertexCount,
    faceCount,
    vertexProperties,
    faceListProperty
  };
}

function parseAsciiPly(body: string, header: PlyHeader): ModelGeometry {
  const lines = body.replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean);
  const vertices: Array<[number, number, number]> = [];
  const vertexColors: Array<[number, number, number] | undefined> = [];
  let lineIndex = 0;
  const xIndex = header.vertexProperties.findIndex((property) => property.name === 'x');
  const yIndex = header.vertexProperties.findIndex((property) => property.name === 'y');
  const zIndex = header.vertexProperties.findIndex((property) => property.name === 'z');
  const colorIndices = findPlyColorIndices(header.vertexProperties);
  if (xIndex < 0 || yIndex < 0 || zIndex < 0) {
    throw new Error('PLY vertex properties must include x, y, and z.');
  }

  for (; lineIndex < header.vertexCount && lineIndex < lines.length; lineIndex += 1) {
    const parts = lines[lineIndex]!.split(/\s+/);
    vertices.push([numberPart(parts[xIndex]), numberPart(parts[yIndex]), numberPart(parts[zIndex])]);
    vertexColors.push(parsePlyVertexColor(parts.map(Number), header.vertexProperties, colorIndices));
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  for (let face = 0; face < header.faceCount && lineIndex < lines.length; face += 1, lineIndex += 1) {
    const values = lines[lineIndex]!.split(/\s+/).map(Number);
    const count = values[0] ?? 0;
    const indices = values.slice(1, 1 + count).filter((value) => Number.isInteger(value));
    pushIndexedFace(indices, vertices, vertexColors, positions, normals, colors);
  }
  if (!positions.length) {
    throw new Error('No PLY triangles found.');
  }
  return geometryFromArrays(positions, normals, colors.length === positions.length ? colors : undefined);
}

function parseBinaryLittleEndianPly(bytes: Uint8Array, header: PlyHeader): ModelGeometry {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vertices: Array<[number, number, number]> = [];
  const vertexColors: Array<[number, number, number] | undefined> = [];
  let offset = header.dataOffset;
  const xIndex = header.vertexProperties.findIndex((property) => property.name === 'x');
  const yIndex = header.vertexProperties.findIndex((property) => property.name === 'y');
  const zIndex = header.vertexProperties.findIndex((property) => property.name === 'z');
  const colorIndices = findPlyColorIndices(header.vertexProperties);
  if (xIndex < 0 || yIndex < 0 || zIndex < 0) {
    throw new Error('PLY vertex properties must include x, y, and z.');
  }

  for (let vertex = 0; vertex < header.vertexCount; vertex += 1) {
    const values: number[] = [];
    for (const property of header.vertexProperties) {
      const read = readPlyScalar(view, offset, property.type, true);
      values.push(read.value);
      offset = read.nextOffset;
    }
    vertices.push([values[xIndex] ?? 0, values[yIndex] ?? 0, values[zIndex] ?? 0]);
    vertexColors.push(parsePlyVertexColor(values, header.vertexProperties, colorIndices));
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  for (let face = 0; face < header.faceCount; face += 1) {
    const countRead = readPlyScalar(view, offset, header.faceListProperty!.countType, true);
    offset = countRead.nextOffset;
    const indices: number[] = [];
    for (let index = 0; index < countRead.value; index += 1) {
      const itemRead = readPlyScalar(view, offset, header.faceListProperty!.itemType, true);
      indices.push(itemRead.value);
      offset = itemRead.nextOffset;
    }
    pushIndexedFace(indices, vertices, vertexColors, positions, normals, colors);
  }
  if (!positions.length) {
    throw new Error('No PLY triangles found.');
  }
  return geometryFromArrays(positions, normals, colors.length === positions.length ? colors : undefined);
}

function pushIndexedFace(
  indices: number[],
  vertices: Array<[number, number, number]>,
  vertexColors: Array<[number, number, number] | undefined>,
  positions: number[],
  normals: number[],
  colors: number[]
): void {
  const validIndices = indices.filter((index) => Number.isInteger(index) && index >= 0 && index < vertices.length);
  if (validIndices.length < 3) {
    return;
  }
  for (let index = 1; index < validIndices.length - 1; index += 1) {
    const first = vertices[validIndices[0]!]!;
    const second = vertices[validIndices[index]!]!;
    const third = vertices[validIndices[index + 1]!]!;
    const normal = computeTriangleNormal(first, second, third);
    const triangleIndices = [validIndices[0]!, validIndices[index]!, validIndices[index + 1]!];
    for (const vertex of [first, second, third]) {
      positions.push(...vertex);
      normals.push(...normal);
    }
    for (const vertexIndex of triangleIndices) {
      const color = vertexColors[vertexIndex];
      if (color) {
        colors.push(...color);
      }
    }
  }
}

function findPlyColorIndices(properties: PlyScalarProperty[]): [number, number, number] | undefined {
  const red = findPlyPropertyIndex(properties, ['red', 'diffuse_red', 'r']);
  const green = findPlyPropertyIndex(properties, ['green', 'diffuse_green', 'g']);
  const blue = findPlyPropertyIndex(properties, ['blue', 'diffuse_blue', 'b']);
  return red >= 0 && green >= 0 && blue >= 0 ? [red, green, blue] : undefined;
}

function findPlyPropertyIndex(properties: PlyScalarProperty[], names: string[]): number {
  return properties.findIndex((property) => names.includes(property.name.toLowerCase()));
}

function parsePlyVertexColor(
  values: number[],
  properties: PlyScalarProperty[],
  colorIndices: [number, number, number] | undefined
): [number, number, number] | undefined {
  if (!colorIndices) {
    return undefined;
  }
  const color = colorIndices.map((index) => values[index] ?? Number.NaN);
  if (color.some((part) => !Number.isFinite(part))) {
    return undefined;
  }
  return color.map((part, index) => normalizePlyColorPart(part, properties[colorIndices[index]!]!.type)) as [number, number, number];
}

function normalizePlyColorPart(value: number, type: PlyScalarType): number {
  if (type === 'float' || type === 'float32' || type === 'double' || type === 'float64') {
    return clamp(value > 1 ? value / 255 : value, 0, 1);
  }
  return clamp(value / 255, 0, 1);
}

function findPlyHeaderEnd(bytes: Uint8Array): { headerEnd: number; dataOffset: number } | undefined {
  const patterns = [
    new TextEncoder().encode('end_header\n'),
    new TextEncoder().encode('end_header\r\n')
  ];
  for (let index = 0; index < bytes.length; index += 1) {
    for (const pattern of patterns) {
      if (matchesAt(bytes, pattern, index)) {
        return {
          headerEnd: index + 'end_header'.length,
          dataOffset: index + pattern.length
        };
      }
    }
  }
  return undefined;
}

function matchesAt(bytes: Uint8Array, pattern: Uint8Array, offset: number): boolean {
  if (offset + pattern.length > bytes.length) {
    return false;
  }
  for (let index = 0; index < pattern.length; index += 1) {
    if (bytes[offset + index] !== pattern[index]) {
      return false;
    }
  }
  return true;
}

function readPlyScalar(
  view: DataView,
  offset: number,
  type: PlyScalarType,
  littleEndian: boolean
): { value: number; nextOffset: number } {
  switch (type) {
    case 'char':
    case 'int8':
      return { value: view.getInt8(offset), nextOffset: offset + 1 };
    case 'uchar':
    case 'uint8':
      return { value: view.getUint8(offset), nextOffset: offset + 1 };
    case 'short':
    case 'int16':
      return { value: view.getInt16(offset, littleEndian), nextOffset: offset + 2 };
    case 'ushort':
    case 'uint16':
      return { value: view.getUint16(offset, littleEndian), nextOffset: offset + 2 };
    case 'int':
    case 'int32':
      return { value: view.getInt32(offset, littleEndian), nextOffset: offset + 4 };
    case 'uint':
    case 'uint32':
      return { value: view.getUint32(offset, littleEndian), nextOffset: offset + 4 };
    case 'float':
    case 'float32':
      return { value: view.getFloat32(offset, littleEndian), nextOffset: offset + 4 };
    case 'double':
    case 'float64':
      return { value: view.getFloat64(offset, littleEndian), nextOffset: offset + 8 };
    default:
      throw new Error(`Unsupported PLY scalar type "${type}".`);
  }
}

function normalizePlyScalarType(value: string): PlyScalarType {
  return value as PlyScalarType;
}

function geometryFromArrays(positions: number[], normals: number[], colors?: number[]): ModelGeometry {
  const bounds = computeBounds(positions);
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    ...(colors?.length ? { colors: new Float32Array(colors) } : {}),
    triangleCount: positions.length / 9,
    bounds
  };
}

function computeBounds(positions: number[]): ModelGeometry['bounds'] {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index]!;
    const y = positions[index + 1]!;
    const z = positions[index + 2]!;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ]
  };
}

function collectGeometryPreviewMetadata(geometry: ModelGeometry, format?: string): Model3dPreviewMetadata {
  return {
    format,
    triangleCount: geometry.triangleCount,
    vertexCount: geometry.positions.length / 3,
    hasVertexColors: Boolean(geometry.colors?.length),
    bounds: {
      min: [...geometry.bounds.min],
      max: [...geometry.bounds.max],
      size: [
        geometry.bounds.max[0] - geometry.bounds.min[0],
        geometry.bounds.max[1] - geometry.bounds.min[1],
        geometry.bounds.max[2] - geometry.bounds.min[2]
      ]
    }
  };
}

function buildModelTree(root: Object3D): Model3dPreviewNode[] {
  return root.children.map((child, index) => buildModelTreeNode(child, `node-${index + 1}`));
}

function buildModelTreeNode(object: Object3D, id: string): Model3dPreviewNode {
  const previewObject = object as Model3dObjectNode;
  previewObject.userData.previewNodeId = id;
  previewObject.userData.previewOriginalVisible = object.visible;
  previewObject.userData.previewMaterialKeys = objectMaterialKeys(object);
  return {
    id,
    label: modelTreeNodeLabel(object, id),
    kind: modelTreeNodeKind(object),
    visible: object.visible,
    metadata: collectNodePreviewMetadata(object),
    children: object.children.map((child, index) => buildModelTreeNode(child, `${id}.${index + 1}`))
  };
}

function objectMaterialKeys(object: Object3D): string[] {
  const previewObject = object as Model3dObjectNode;
  if (previewObject.userData.previewEdgeHelper || previewObject.userData.previewMeasurementHelper) {
    return [];
  }
  const maybeRenderable = object as Object3D & {
    material?: Material | Material[];
  };
  const materials = Array.isArray(maybeRenderable.material)
    ? maybeRenderable.material
    : maybeRenderable.material
      ? [maybeRenderable.material]
      : [];
  return materials.map((material) => previewMaterialKey(material));
}

function objectHasMaterialDetails(root: Object3D): boolean {
  let hasMaterials = false;
  root.traverse((object) => {
    const previewObject = object as Model3dObjectNode;
    if (previewObject.userData.previewEdgeHelper || previewObject.userData.previewMeasurementHelper) {
      return;
    }
    if (!hasMaterials && objectMaterialKeys(object).length) {
      hasMaterials = true;
    }
  });
  return hasMaterials;
}

function visibleObjectBounds(root: Object3D): Box3 {
  const bounds = new Box3();
  const next = new Box3();
  let hasBounds = false;
  root.traverse((object) => {
    const maybeRenderable = object as Object3D & {
      geometry?: BufferGeometry;
    };
    if (!object.visible || !maybeRenderable.geometry) {
      return;
    }
    next.setFromObject(object);
    if (next.isEmpty()) {
      return;
    }
    if (!hasBounds) {
      bounds.copy(next);
      hasBounds = true;
      return;
    }
    bounds.union(next);
  });
  return bounds;
}

function resolveIntersectionVertexPoint(intersection: {
  object: Object3D;
  point: Vector3;
  face?: { a: number; b: number; c: number } | null;
}): Vector3 | undefined {
  const geometry = (intersection.object as Object3D & {
    geometry?: BufferGeometry;
  }).geometry;
  if (!geometry || !intersection.face) {
    return undefined;
  }
  const position = geometry.getAttribute('position');
  if (!position || position.itemSize < 3) {
    return undefined;
  }
  const candidates = [
    vertexPositionForGeometryIndex(intersection.object, position, geometry.index, intersection.face.a),
    vertexPositionForGeometryIndex(intersection.object, position, geometry.index, intersection.face.b),
    vertexPositionForGeometryIndex(intersection.object, position, geometry.index, intersection.face.c)
  ].filter((value): value is Vector3 => Boolean(value));
  if (!candidates.length) {
    return undefined;
  }
  let closest = candidates[0]!;
  let minDistance = closest.distanceToSquared(intersection.point);
  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    const distance = candidate.distanceToSquared(intersection.point);
    if (distance < minDistance) {
      closest = candidate;
      minDistance = distance;
    }
  }
  return closest;
}

function vertexPositionForGeometryIndex(
  object: Object3D,
  position: { getX(index: number): number; getY(index: number): number; getZ(index: number): number },
  index: BufferAttribute | null,
  faceIndex: number
): Vector3 | undefined {
  const vertexIndex = index ? index.getX(faceIndex) : faceIndex;
  if (!Number.isFinite(vertexIndex)) {
    return undefined;
  }
  const vertex = new Vector3(
    position.getX(vertexIndex),
    position.getY(vertexIndex),
    position.getZ(vertexIndex)
  );
  return object.localToWorld(vertex);
}

function applyMeasurementAxisLock(
  point: Vector3,
  start: Vector3,
  axisLock: 'free' | 'x' | 'y' | 'z'
): Vector3 {
  switch (axisLock) {
    case 'x':
      return new Vector3(point.x, start.y, start.z);
    case 'y':
      return new Vector3(start.x, point.y, start.z);
    case 'z':
      return new Vector3(start.x, start.y, point.z);
    default:
      return point;
  }
}

function axisNormal(axis: 'x' | 'y' | 'z'): Vector3 {
  switch (axis) {
    case 'y':
      return new Vector3(0, 1, 0);
    case 'z':
      return new Vector3(0, 0, 1);
    default:
      return new Vector3(1, 0, 0);
  }
}

function axisNegativeNormal(axis: 'x' | 'y' | 'z'): Vector3 {
  switch (axis) {
    case 'y':
      return new Vector3(0, -1, 0);
    case 'z':
      return new Vector3(0, 0, -1);
    default:
      return new Vector3(-1, 0, 0);
  }
}

function viewPresetAngles(
  preset: 'free' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'isometric'
): { yaw: number; pitch: number } | undefined {
  switch (preset) {
    case 'front':
      return { yaw: 0, pitch: 0 };
    case 'back':
      return { yaw: 180, pitch: 0 };
    case 'left':
      return { yaw: -90, pitch: 0 };
    case 'right':
      return { yaw: 90, pitch: 0 };
    case 'top':
      return { yaw: 0, pitch: 90 };
    case 'bottom':
      return { yaw: 0, pitch: -90 };
    case 'isometric':
      return { yaw: -35, pitch: 24 };
    default:
      return undefined;
  }
}

function normalizeSnapshotFilename(title: string | undefined): string {
  const base = String(title ?? 'model-preview')
    .replace(/\.[^.]+$/, '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '-')
    .trim();
  return `${base || 'model-preview'}.png`;
}

function cloneModelTree(nodes: Model3dPreviewNode[]): Model3dPreviewNode[] {
  return nodes.map((node) => ({
    ...node,
    metadata: node.metadata
      ? {
          ...node.metadata,
          materialNames: [...(node.metadata.materialNames ?? [])],
          materialDetails: cloneMaterialDetails(node.metadata.materialDetails),
          bounds: node.metadata.bounds
            ? {
                ...node.metadata.bounds,
                min: [...node.metadata.bounds.min] as [number, number, number],
                max: [...node.metadata.bounds.max] as [number, number, number],
                size: [...node.metadata.bounds.size] as [number, number, number]
              }
            : undefined
        }
      : undefined,
    children: cloneModelTree(node.children)
  }));
}

function setModelTreeNodeVisibility(
  nodes: Model3dPreviewNode[],
  nodeId: string,
  visible: boolean
): Model3dPreviewNode[] {
  return nodes.map((node) => {
    if (node.id === nodeId) {
      return setModelTreeVisibilityRecursive(node, visible);
    }
    return {
      ...node,
      children: setModelTreeNodeVisibility(node.children, nodeId, visible)
    };
  });
}

function setModelTreeVisibilityRecursive(node: Model3dPreviewNode, visible: boolean): Model3dPreviewNode {
  return {
    ...node,
    visible,
    children: node.children.map((child) => setModelTreeVisibilityRecursive(child, visible))
  };
}

function findModelTreeNode(nodes: Model3dPreviewNode[], nodeId: string): Model3dPreviewNode | undefined {
  for (const node of nodes) {
    if (node.id === nodeId) {
      return node;
    }
    const childMatch = findModelTreeNode(node.children, nodeId);
    if (childMatch) {
      return childMatch;
    }
  }
  return undefined;
}

function createExplodeTargets(root: Object3D, baseModelRadius: number): Model3dExplodeTarget[] {
  const container = resolveExplodeContainer(root);
  const targets = container.children.filter((child) => {
    const bounds = new Box3().setFromObject(child);
    return !bounds.isEmpty();
  });
  if (targets.length < 2) {
    return [];
  }

  const containerBounds = new Box3().setFromObject(container);
  const containerCenter = containerBounds.getCenter(new Vector3());
  return targets.map((target, index) => {
    const targetBounds = new Box3().setFromObject(target);
    const targetCenter = targetBounds.getCenter(new Vector3());
    const targetSize = targetBounds.getSize(new Vector3());
    const direction = targetCenter.sub(containerCenter);
    if (direction.lengthSq() <= 1e-6) {
      const angle = (index / targets.length) * Math.PI * 2;
      direction.set(Math.cos(angle), 0, Math.sin(angle));
    } else {
      direction.normalize();
    }
    return {
      object: target,
      basePosition: target.position.clone(),
      direction,
      distance: Math.max(targetSize.length() * 0.45, baseModelRadius * 0.22)
    };
  });
}

function resolveExplodeContainer(root: Object3D): Object3D {
  let container = root;
  while (container.children.length === 1) {
    const child = container.children[0];
    if (!child || child.children.length < 2) {
      break;
    }
    container = child;
  }
  return container;
}

function modelTreeNodeLabel(object: Object3D, id: string): string {
  const explicitName = object.name?.trim();
  if (explicitName) {
    return explicitName;
  }
  if (object.type && object.type !== 'Object3D') {
    return object.type;
  }
  return id;
}

function modelTreeNodeKind(object: Object3D): Model3dPreviewNode['kind'] {
  if (object instanceof Mesh || object instanceof SkinnedMesh) return 'mesh';
  if (object instanceof Points) return 'points';
  if (object instanceof Line || object instanceof LineSegments || object.type === 'LineLoop') return 'lines';
  if (object.type === 'Bone') return 'bone';
  if (object.type.endsWith('Light')) return 'light';
  if (object.type.endsWith('Camera')) return 'camera';
  if (object instanceof Group) return 'group';
  return 'object';
}

function collectObjectPreviewMetadata(object: Object3D, format?: string): Model3dPreviewMetadata {
  let objectCount = 0;
  let meshCount = 0;
  let lineCount = 0;
  let pointCount = 0;
  let vertexCount = 0;
  let triangleCount = 0;
  let hasVertexColors = false;
  let animationCount = Array.isArray((object as { animations?: unknown[] }).animations)
    ? ((object as { animations?: unknown[] }).animations?.length ?? 0)
    : 0;
  const materialNames = new Set<string>();
  const materials = new Set<Material>();
  const materialDetails = new Map<number, PreviewMaterialInfo>();

  object.traverse((node) => {
    const previewNode = node as Model3dObjectNode;
    if (previewNode.userData.previewEdgeHelper || previewNode.userData.previewMeasurementHelper) {
      return;
    }
    objectCount += 1;

    if ('animations' in node && Array.isArray((node as { animations?: unknown[] }).animations)) {
      animationCount += (node as { animations?: unknown[] }).animations?.length ?? 0;
    }

    const maybeRenderable = node as Object3D & {
      geometry?: BufferGeometry;
      material?: Material | Material[];
    };
    const geometry = maybeRenderable.geometry;
    if (geometry) {
      const position = geometry.getAttribute('position');
      if (position) {
        vertexCount += position.count;
      }
      if (geometry.getAttribute('color')) {
        hasVertexColors = true;
      }
      triangleCount += countGeometryTriangles(geometry);
    }

    if (node instanceof Mesh || node instanceof SkinnedMesh) {
      meshCount += 1;
    } else if (node instanceof Points) {
      pointCount += 1;
    } else if (node instanceof Line || node instanceof LineSegments || node.type === 'LineLoop') {
      lineCount += 1;
    }

    const nodeMaterials = Array.isArray(maybeRenderable.material)
      ? maybeRenderable.material
      : maybeRenderable.material
        ? [maybeRenderable.material]
        : [];
    for (const material of nodeMaterials) {
      materials.add(material);
      if (material.name) {
        materialNames.add(material.name);
      }
      materialDetails.set(material.id, summarizeMaterial(material));
    }
  });

  const boundsBox = new Box3().setFromObject(object);
  const bounds = boundsBox.isEmpty()
    ? undefined
    : (() => {
        const min = boundsBox.min;
        const max = boundsBox.max;
        const size = boundsBox.getSize(new Vector3());
        return {
          min: [min.x, min.y, min.z] as [number, number, number],
          max: [max.x, max.y, max.z] as [number, number, number],
          size: [size.x, size.y, size.z] as [number, number, number]
        };
      })();

  return {
    format,
    objectCount,
    meshCount,
    lineCount,
    pointCount,
    materialCount: materials.size,
    materialNames: [...materialNames].sort((left, right) => left.localeCompare(right)),
    materialDetails: [...materialDetails.values()].sort(compareMaterialDetails),
    animationCount,
    bounds,
    triangleCount,
    vertexCount,
    hasVertexColors
  };
}

function collectNodePreviewMetadata(object: Object3D): NonNullable<Model3dPreviewNode['metadata']> {
  let meshCount = 0;
  let lineCount = 0;
  let pointCount = 0;
  let vertexCount = 0;
  let triangleCount = 0;
  let hasVertexColors = false;
  const materialNames = new Set<string>();
  const materials = new Set<Material>();
  const materialDetails = new Map<number, PreviewMaterialInfo>();

  object.traverse((node) => {
    const previewNode = node as Model3dObjectNode;
    if (previewNode.userData.previewEdgeHelper || previewNode.userData.previewMeasurementHelper) {
      return;
    }
    const maybeRenderable = node as Object3D & {
      geometry?: BufferGeometry;
      material?: Material | Material[];
    };
    const geometry = maybeRenderable.geometry;
    if (geometry) {
      const position = geometry.getAttribute('position');
      if (position) {
        vertexCount += position.count;
      }
      if (geometry.getAttribute('color')) {
        hasVertexColors = true;
      }
      triangleCount += countGeometryTriangles(geometry);
    }
    if (node instanceof Mesh || node instanceof SkinnedMesh) {
      meshCount += 1;
    } else if (node instanceof Points) {
      pointCount += 1;
    } else if (node instanceof Line || node instanceof LineSegments || node.type === 'LineLoop') {
      lineCount += 1;
    }

    const nodeMaterials = Array.isArray(maybeRenderable.material)
      ? maybeRenderable.material
      : maybeRenderable.material
        ? [maybeRenderable.material]
        : [];
    for (const material of nodeMaterials) {
      materials.add(material);
      if (material.name) {
        materialNames.add(material.name);
      }
      materialDetails.set(material.id, summarizeMaterial(material));
    }
  });

  const boundsBox = new Box3().setFromObject(object);
  const bounds = boundsBox.isEmpty()
    ? undefined
    : (() => {
        const min = boundsBox.min;
        const max = boundsBox.max;
        const size = boundsBox.getSize(new Vector3());
        return {
          min: [min.x, min.y, min.z] as [number, number, number],
          max: [max.x, max.y, max.z] as [number, number, number],
          size: [size.x, size.y, size.z] as [number, number, number]
        };
      })();

  return {
    meshCount,
    lineCount,
    pointCount,
    materialCount: materials.size,
    materialNames: [...materialNames].sort((left, right) => left.localeCompare(right)),
    materialDetails: [...materialDetails.values()].sort(compareMaterialDetails),
    triangleCount,
    vertexCount,
    hasVertexColors,
    bounds
  };
}

function countGeometryTriangles(geometry: BufferGeometry): number {
  const position = geometry.getAttribute('position');
  if (!position) {
    return 0;
  }
  if (geometry.index) {
    return Math.floor(geometry.index.count / 3);
  }
  return Math.floor(position.count / 3);
}

function summarizeMaterial(material: Material): PreviewMaterialInfo {
  const generic = material as Material & {
    color?: Color;
    emissive?: Color;
    wireframe?: boolean;
    vertexColors?: boolean | number;
    flatShading?: boolean;
    depthWrite?: boolean;
    depthTest?: boolean;
    side?: number;
    roughness?: number;
    metalness?: number;
    shininess?: number;
    size?: number;
    map?: unknown;
    alphaMap?: unknown;
    aoMap?: unknown;
    bumpMap?: unknown;
    displacementMap?: unknown;
    emissiveMap?: unknown;
    envMap?: unknown;
    lightMap?: unknown;
    metalnessMap?: unknown;
    normalMap?: unknown;
    roughnessMap?: unknown;
    specularMap?: unknown;
  };
  const mapKinds = [
    generic.map ? 'base' : undefined,
    generic.alphaMap ? 'alpha' : undefined,
    generic.aoMap ? 'ao' : undefined,
    generic.bumpMap ? 'bump' : undefined,
    generic.displacementMap ? 'displacement' : undefined,
    generic.emissiveMap ? 'emissive' : undefined,
    generic.envMap ? 'environment' : undefined,
    generic.lightMap ? 'light' : undefined,
    generic.metalnessMap ? 'metalness' : undefined,
    generic.normalMap ? 'normal' : undefined,
    generic.roughnessMap ? 'roughness' : undefined,
    generic.specularMap ? 'specular' : undefined
  ].filter((kind): kind is string => Boolean(kind));

  return {
    key: previewMaterialKey(material),
    ...(material.name ? { name: material.name } : {}),
    type: material.type || material.constructor.name || 'Material',
    ...(generic.color ? { color: colorToHex(generic.color) } : {}),
    ...(generic.emissive ? { emissiveColor: colorToHex(generic.emissive) } : {}),
    ...(Number.isFinite(material.opacity) ? { opacity: roundPreviewNumber(material.opacity) } : {}),
    ...(Number.isFinite(material.alphaTest) ? { alphaTest: roundPreviewNumber(material.alphaTest) } : {}),
    transparent: material.transparent,
    ...(typeof generic.wireframe === 'boolean' ? { wireframe: generic.wireframe } : {}),
    ...(typeof generic.vertexColors === 'boolean' ? { vertexColors: generic.vertexColors } : {}),
    ...(typeof generic.vertexColors === 'number' ? { vertexColors: generic.vertexColors > 0 } : {}),
    ...(typeof generic.flatShading === 'boolean' ? { flatShading: generic.flatShading } : {}),
    ...(typeof generic.depthWrite === 'boolean' ? { depthWrite: generic.depthWrite } : {}),
    ...(typeof generic.depthTest === 'boolean' ? { depthTest: generic.depthTest } : {}),
    ...(material.side === 1 ? { side: 'back' as const } : material.side === 2 ? { side: 'double' as const } : { side: 'front' as const }),
    ...(Number.isFinite(generic.roughness) ? { roughness: roundPreviewNumber(generic.roughness!) } : {}),
    ...(Number.isFinite(generic.metalness) ? { metalness: roundPreviewNumber(generic.metalness!) } : {}),
    ...(Number.isFinite(generic.shininess) ? { shininess: roundPreviewNumber(generic.shininess!) } : {}),
    ...(Number.isFinite(generic.size) ? { size: roundPreviewNumber(generic.size!) } : {}),
    ...(mapKinds.length ? { mapKinds } : {})
  };
}

function cloneMaterialDetails(details: PreviewMaterialInfo[] | undefined): PreviewMaterialInfo[] | undefined {
  return details?.map((detail) => ({
    ...detail,
    mapKinds: detail.mapKinds ? [...detail.mapKinds] : undefined
  }));
}

function cloneMeasurementState(
  measurement: PreviewMeasurementInfo | undefined
): PreviewMeasurementInfo | undefined {
  return measurement
    ? {
        ...measurement,
        snapMode: measurement.snapMode ?? 'surface',
        axisLock: measurement.axisLock ?? 'free',
        start: measurement.start ? [...measurement.start] as [number, number, number] : undefined,
        end: measurement.end ? [...measurement.end] as [number, number, number] : undefined,
        delta: measurement.delta ? [...measurement.delta] as [number, number, number] : undefined,
        previewPoint: measurement.previewPoint ? [...measurement.previewPoint] as [number, number, number] : undefined,
        previewDelta: measurement.previewDelta ? [...measurement.previewDelta] as [number, number, number] : undefined,
        previewDistance: measurement.previewDistance
      }
    : undefined;
}

function areMeasurementsEquivalent(
  left: PreviewMeasurementInfo | undefined,
  right: PreviewMeasurementInfo | undefined
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return left.active === right.active
    && left.status === right.status
    && (left.snapMode ?? 'surface') === (right.snapMode ?? 'surface')
    && (left.axisLock ?? 'free') === (right.axisLock ?? 'free')
    && arePreviewVectorTuplesEquivalent(left.start, right.start)
    && arePreviewVectorTuplesEquivalent(left.end, right.end)
    && arePreviewVectorTuplesEquivalent(left.delta, right.delta)
    && arePreviewVectorTuplesEquivalent(left.previewPoint, right.previewPoint)
    && arePreviewVectorTuplesEquivalent(left.previewDelta, right.previewDelta)
    && left.distance === right.distance
    && left.previewDistance === right.previewDistance;
}

function arePreviewVectorTuplesEquivalent(
  left: [number, number, number] | undefined,
  right: [number, number, number] | undefined
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return left[0] === right[0]
    && left[1] === right[1]
    && left[2] === right[2];
}

function createPreviewSectionState(bounds?: PreviewSectionBounds): Model3dPreviewSectionInfo {
  const axis = 'x';
  const [min, max] = bounds?.[axis] ?? [-1, 1];
  return {
    active: false,
    mode: 'single',
    axis,
    offset: clamp(0, min, max),
    min: roundPreviewNumber(min),
    max: roundPreviewNumber(max),
    bounds: cloneSectionBounds(bounds ?? defaultSectionBounds()),
    range: sectionRangeFromBounds(bounds ?? defaultSectionBounds())
  };
}

function cloneSectionState(section: Model3dPreviewSectionInfo | undefined): Model3dPreviewSectionInfo | undefined {
  return section
    ? {
        ...section,
        mode: section.mode ?? 'single',
        offset: roundPreviewNumber(section.offset),
        min: roundPreviewNumber(section.min),
        max: roundPreviewNumber(section.max),
        bounds: section.bounds ? cloneSectionBounds(section.bounds) : undefined,
        range: section.range ? cloneSectionBounds(section.range) : undefined
      }
    : undefined;
}

function normalizeSectionState(
  section: Model3dPreviewSectionInfo,
  bounds: PreviewSectionBounds
): Model3dPreviewSectionInfo {
  const axis = section.axis ?? 'x';
  const [min, max] = bounds[axis];
  return {
    active: section.active,
    mode: section.mode ?? 'single',
    axis,
    offset: roundPreviewNumber(clamp(section.offset, min, max)),
    min: roundPreviewNumber(min),
    max: roundPreviewNumber(max),
    bounds: cloneSectionBounds(bounds),
    range: normalizeSectionRange(section.range, bounds)
  };
}

function areSectionsEquivalent(
  left: Model3dPreviewSectionInfo | undefined,
  right: Model3dPreviewSectionInfo | undefined
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return left.active === right.active
    && (left.mode ?? 'single') === (right.mode ?? 'single')
    && left.axis === right.axis
    && left.offset === right.offset
    && left.min === right.min
    && left.max === right.max
    && areSectionRangesEquivalent(left.range, right.range);
}

function areSectionRangesEquivalent(
  left: Model3dPreviewSectionInfo['range'] | undefined,
  right: Model3dPreviewSectionInfo['range'] | undefined
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return left.x[0] === right.x[0]
    && left.x[1] === right.x[1]
    && left.y[0] === right.y[0]
    && left.y[1] === right.y[1]
    && left.z[0] === right.z[0]
    && left.z[1] === right.z[1];
}

function normalizeSectionRange(
  range: Model3dPreviewSectionInfo['range'] | undefined,
  bounds: PreviewSectionBounds
): NonNullable<Model3dPreviewSectionInfo['range']> {
  const fallback = sectionRangeFromBounds(bounds);
  return {
    x: normalizeAxisRange(range?.x, bounds.x, fallback.x),
    y: normalizeAxisRange(range?.y, bounds.y, fallback.y),
    z: normalizeAxisRange(range?.z, bounds.z, fallback.z)
  };
}

function normalizeAxisRange(
  range: [number, number] | undefined,
  bounds: [number, number],
  fallback: [number, number]
): [number, number] {
  if (!range) {
    return [...fallback] as [number, number];
  }
  const left = clamp(Math.min(range[0], range[1]), bounds[0], bounds[1]);
  const right = clamp(Math.max(range[0], range[1]), bounds[0], bounds[1]);
  return [roundPreviewNumber(left), roundPreviewNumber(right)];
}

function defaultSectionBounds(): PreviewSectionBounds {
  return {
    x: [-1, 1],
    y: [-1, 1],
    z: [-1, 1]
  };
}

function cloneSectionBounds(bounds: PreviewSectionBounds): PreviewSectionBounds {
  return {
    x: [...bounds.x] as [number, number],
    y: [...bounds.y] as [number, number],
    z: [...bounds.z] as [number, number]
  };
}

function sectionRangeFromBounds(bounds: PreviewSectionBounds): NonNullable<Model3dPreviewSectionInfo['range']> {
  return cloneSectionBounds(bounds);
}

function sectionHelperCacheKey(section: Model3dPreviewSectionInfo): string {
  return `${section.axis}:${section.offset.toFixed(5)}`;
}

function sectionDisplayCacheKey(section: Model3dPreviewSectionInfo): string {
  if (section.mode === 'box') {
    const range = section.range;
    return range
      ? `box:${range.x[0].toFixed(5)}:${range.x[1].toFixed(5)}:${range.y[0].toFixed(5)}:${range.y[1].toFixed(5)}:${range.z[0].toFixed(5)}:${range.z[1].toFixed(5)}`
      : 'box';
  }
  return `single:${sectionHelperCacheKey(section)}`;
}

function sectionClippingCacheKey(section: Model3dPreviewSectionInfo, modelGroup: Object3D): string {
  const positionKey = `${modelGroup.position.x.toFixed(5)}:${modelGroup.position.y.toFixed(5)}:${modelGroup.position.z.toFixed(5)}`;
  if (section.mode === 'box') {
    const range = section.range;
    return range
      ? `box:${positionKey}:${range.x[0].toFixed(5)}:${range.x[1].toFixed(5)}:${range.y[0].toFixed(5)}:${range.y[1].toFixed(5)}:${range.z[0].toFixed(5)}:${range.z[1].toFixed(5)}`
      : `box:${positionKey}`;
  }
  return `single:${positionKey}:${sectionHelperCacheKey(section)}`;
}

function singleSectionPlaneBounds(
  section: Model3dPreviewSectionInfo,
  bounds: PreviewSectionBounds
): { width: number; height: number } {
  switch (section.axis) {
    case 'x':
      return {
        width: Math.max(bounds.z[1] - bounds.z[0], 0),
        height: Math.max(bounds.y[1] - bounds.y[0], 0)
      };
    case 'y':
      return {
        width: Math.max(bounds.x[1] - bounds.x[0], 0),
        height: Math.max(bounds.z[1] - bounds.z[0], 0)
      };
    case 'z':
    default:
      return {
        width: Math.max(bounds.x[1] - bounds.x[0], 0),
        height: Math.max(bounds.y[1] - bounds.y[0], 0)
      };
  }
}

function sectionPlaneOutlinePoints(
  section: Model3dPreviewSectionInfo,
  bounds: PreviewSectionBounds
): number[] {
  switch (section.axis) {
    case 'x':
      return lineLoopPositions([
        [section.offset, bounds.y[0], bounds.z[0]],
        [section.offset, bounds.y[1], bounds.z[0]],
        [section.offset, bounds.y[1], bounds.z[1]],
        [section.offset, bounds.y[0], bounds.z[1]]
      ]);
    case 'y':
      return lineLoopPositions([
        [bounds.x[0], section.offset, bounds.z[0]],
        [bounds.x[1], section.offset, bounds.z[0]],
        [bounds.x[1], section.offset, bounds.z[1]],
        [bounds.x[0], section.offset, bounds.z[1]]
      ]);
    case 'z':
    default:
      return lineLoopPositions([
        [bounds.x[0], bounds.y[0], section.offset],
        [bounds.x[1], bounds.y[0], section.offset],
        [bounds.x[1], bounds.y[1], section.offset],
        [bounds.x[0], bounds.y[1], section.offset]
      ]);
  }
}

function lineLoopPositions(points: Array<[number, number, number]>): number[] {
  const positions: number[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index]!;
    const end = points[(index + 1) % points.length]!;
    positions.push(...start, ...end);
  }
  return positions;
}

function linePathPositions(points: Array<[number, number, number]>): number[] {
  const positions: number[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    positions.push(...points[index]!, ...points[index + 1]!);
  }
  return positions;
}

function stitchSectionLoops(
  axis: 'x' | 'y' | 'z',
  positions: number[],
  epsilon = 1e-4
): Array<Array<[number, number, number]>> {
  return stitchSectionPaths(axis, positions, epsilon).loops;
}

function stitchSectionPaths(
  axis: 'x' | 'y' | 'z',
  positions: number[],
  epsilon = 1e-4
): {
  loops: Array<Array<[number, number, number]>>;
  chains: Array<Array<[number, number, number]>>;
} {
  type SectionNode = {
    x: number;
    y: number;
    z: number;
    count: number;
    edges: number[];
  };

  const nodes: SectionNode[] = [];
  const edges: Array<{ a: number; b: number; visited: boolean }> = [];
  const nodeByKey = new Map<string, number>();
  const edgeKeys = new Set<string>();

  const nodeIdForPoint = (x: number, y: number, z: number): number => {
    const [u, v] = projectSectionPointTo2d(axis, [x, y, z]);
    const key = `${Math.round(u / epsilon)}:${Math.round(v / epsilon)}`;
    const existingId = nodeByKey.get(key);
    if (typeof existingId === 'number') {
      const node = nodes[existingId]!;
      node.x += x;
      node.y += y;
      node.z += z;
      node.count += 1;
      return existingId;
    }
    const id = nodes.length;
    nodes.push({
      x,
      y,
      z,
      count: 1,
      edges: []
    });
    nodeByKey.set(key, id);
    return id;
  };

  for (let index = 0; index < positions.length; index += 6) {
    const a = nodeIdForPoint(positions[index]!, positions[index + 1]!, positions[index + 2]!);
    const b = nodeIdForPoint(positions[index + 3]!, positions[index + 4]!, positions[index + 5]!);
    if (a === b) {
      continue;
    }
    const edgeKey = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (edgeKeys.has(edgeKey)) {
      continue;
    }
    edgeKeys.add(edgeKey);
    const edgeId = edges.length;
    edges.push({ a, b, visited: false });
    nodes[a]!.edges.push(edgeId);
    nodes[b]!.edges.push(edgeId);
  }

  const loops: Array<Array<[number, number, number]>> = [];
  const chains: Array<Array<[number, number, number]>> = [];

  for (let startNodeId = 0; startNodeId < nodes.length; startNodeId += 1) {
    if (nodes[startNodeId]!.edges.length === 2) {
      continue;
    }
    while (true) {
      const seedEdgeId = nodes[startNodeId]!.edges.find((edgeId) => !edges[edgeId]!.visited);
      if (typeof seedEdgeId !== 'number') {
        break;
      }
      const nodeIds = traceSectionPath(axis, nodes, edges, startNodeId, seedEdgeId);
      appendSectionPath(axis, nodes, nodeIds, loops, chains, epsilon);
    }
  }

  for (let startNodeId = 0; startNodeId < nodes.length; startNodeId += 1) {
    while (true) {
      const seedEdgeId = nodes[startNodeId]!.edges.find((edgeId) => !edges[edgeId]!.visited);
      if (typeof seedEdgeId !== 'number') {
        break;
      }
      const nodeIds = traceSectionPath(axis, nodes, edges, startNodeId, seedEdgeId);
      appendSectionPath(axis, nodes, nodeIds, loops, chains, epsilon);
    }
  }

  return {
    loops: dedupeSectionLoops(axis, loops, epsilon).filter((loop) => loop.length >= 3),
    chains: dedupeSectionChains(axis, chains, epsilon).filter((chain) => chain.length >= 2)
  };
}

function selectNextSectionEdge(
  axis: 'x' | 'y' | 'z',
  nodes: Array<{ x: number; y: number; z: number; count: number; edges: number[] }>,
  edges: Array<{ a: number; b: number; visited: boolean }>,
  currentNodeId: number,
  previousNodeId: number | undefined,
  previousEdgeId: number | undefined
): number | undefined {
  const candidates = nodes[currentNodeId]!.edges.filter((edgeId) => !edges[edgeId]!.visited && edgeId !== previousEdgeId);
  if (!candidates.length) {
    return undefined;
  }
  if (typeof previousNodeId !== 'number') {
    return candidates[0];
  }

  const currentPoint = sectionNodePoint(nodes[currentNodeId]!);
  const previousPoint = sectionNodePoint(nodes[previousNodeId]!);
  const incoming = sectionDirection2d(axis, previousPoint, currentPoint);
  const incomingLength = Math.hypot(incoming.x, incoming.y);
  if (incomingLength <= 1e-10) {
    return candidates[0];
  }

  let bestEdgeId = candidates[0]!;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const edgeId of candidates) {
    const edge = edges[edgeId]!;
    const nextNodeId = edge.a === currentNodeId ? edge.b : edge.a;
    const nextPoint = sectionNodePoint(nodes[nextNodeId]!);
    const outgoing = sectionDirection2d(axis, currentPoint, nextPoint);
    const outgoingLength = Math.hypot(outgoing.x, outgoing.y);
    if (outgoingLength <= 1e-10) {
      continue;
    }
    const score = (incoming.x * outgoing.x + incoming.y * outgoing.y) / (incomingLength * outgoingLength);
    if (score > bestScore) {
      bestScore = score;
      bestEdgeId = edgeId;
    }
  }

  return bestEdgeId;
}

function traceSectionPath(
  axis: 'x' | 'y' | 'z',
  nodes: Array<{ x: number; y: number; z: number; count: number; edges: number[] }>,
  edges: Array<{ a: number; b: number; visited: boolean }>,
  startNodeId: number,
  seedEdgeId: number
): number[] {
  const seedEdge = edges[seedEdgeId]!;
  seedEdge.visited = true;
  const secondNodeId = seedEdge.a === startNodeId ? seedEdge.b : seedEdge.a;
  const orderedNodeIds = [startNodeId, secondNodeId];
  let previousNodeId = startNodeId;
  let currentNodeId = secondNodeId;
  let previousEdgeId: number | undefined = seedEdgeId;

  while (true) {
    if (currentNodeId === startNodeId) {
      break;
    }
    const nextEdgeId = selectNextSectionEdge(axis, nodes, edges, currentNodeId, previousNodeId, previousEdgeId);
    if (typeof nextEdgeId !== 'number') {
      break;
    }
    const edge = edges[nextEdgeId]!;
    edge.visited = true;
    const nextNodeId = edge.a === currentNodeId ? edge.b : edge.a;
    orderedNodeIds.push(nextNodeId);
    previousNodeId = currentNodeId;
    previousEdgeId = nextEdgeId;
    currentNodeId = nextNodeId;
  }

  return orderedNodeIds;
}

function appendSectionPath(
  axis: 'x' | 'y' | 'z',
  nodes: Array<{ x: number; y: number; z: number; count: number; edges: number[] }>,
  nodeIds: number[],
  loops: Array<Array<[number, number, number]>>,
  chains: Array<Array<[number, number, number]>>,
  epsilon = 1e-4
): void {
  if (nodeIds.length < 2) {
    return;
  }
  const closed = nodeIds.length >= 4 && nodeIds[0] === nodeIds[nodeIds.length - 1];
  const path = nodeIds
    .slice(0, closed ? -1 : nodeIds.length)
    .map((nodeId) => sectionNodePoint(nodes[nodeId]!));

  const simplified = simplifySectionPath(axis, path, closed, epsilon);
  if (closed) {
    const area = Math.abs(polygonSignedArea(simplified.map((point) => {
      const [u, v] = projectSectionPointTo2d(axis, point);
      return new Vector2(u, v);
    })));
    if (simplified.length >= 3 && area > epsilon * epsilon) {
      loops.push(simplified);
    }
    return;
  }

  if (simplified.length >= 2 && sectionPathLength(axis, simplified) > epsilon) {
    chains.push(simplified);
  }
}

function removeCollinearSectionPoints(
  axis: 'x' | 'y' | 'z',
  loop: Array<[number, number, number]>,
  epsilon = 1e-5
): Array<[number, number, number]> {
  if (loop.length <= 3) {
    return loop;
  }
  const simplified: Array<[number, number, number]> = [];
  for (let index = 0; index < loop.length; index += 1) {
    const previous = loop[(index - 1 + loop.length) % loop.length]!;
    const current = loop[index]!;
    const next = loop[(index + 1) % loop.length]!;
    const [prevU, prevV] = projectSectionPointTo2d(axis, previous);
    const [currentU, currentV] = projectSectionPointTo2d(axis, current);
    const [nextU, nextV] = projectSectionPointTo2d(axis, next);
    const areaTwice =
      (currentU - prevU) * (nextV - prevV) -
      (currentV - prevV) * (nextU - prevU);
    if (Math.abs(areaTwice) > epsilon) {
      simplified.push(current);
    }
  }
  return simplified.length >= 3 ? simplified : loop;
}

function simplifySectionPath(
  axis: 'x' | 'y' | 'z',
  path: Array<[number, number, number]>,
  closed: boolean,
  epsilon = 1e-5
): Array<[number, number, number]> {
  if (path.length <= (closed ? 3 : 2)) {
    return path;
  }
  const simplified: Array<[number, number, number]> = [];
  for (let index = 0; index < path.length; index += 1) {
    if (!closed && (index === 0 || index === path.length - 1)) {
      simplified.push(path[index]!);
      continue;
    }
    const previous = path[(index - 1 + path.length) % path.length]!;
    const current = path[index]!;
    const next = path[(index + 1) % path.length]!;
    const [prevU, prevV] = projectSectionPointTo2d(axis, previous);
    const [currentU, currentV] = projectSectionPointTo2d(axis, current);
    const [nextU, nextV] = projectSectionPointTo2d(axis, next);
    const areaTwice =
      (currentU - prevU) * (nextV - prevV) -
      (currentV - prevV) * (nextU - prevU);
    if (Math.abs(areaTwice) > epsilon) {
      simplified.push(current);
    }
  }
  return simplified.length >= (closed ? 3 : 2) ? simplified : path;
}

function sectionPathLength(
  axis: 'x' | 'y' | 'z',
  path: Array<[number, number, number]>
): number {
  let length = 0;
  for (let index = 0; index < path.length - 1; index += 1) {
    const direction = sectionDirection2d(axis, path[index]!, path[index + 1]!);
    length += Math.hypot(direction.x, direction.y);
  }
  return length;
}

function sectionNodePoint(node: { x: number; y: number; z: number; count: number }): [number, number, number] {
  return [
    node.x / node.count,
    node.y / node.count,
    node.z / node.count
  ];
}

function sectionDirection2d(
  axis: 'x' | 'y' | 'z',
  from: [number, number, number],
  to: [number, number, number]
): { x: number; y: number } {
  const [fromU, fromV] = projectSectionPointTo2d(axis, from);
  const [toU, toV] = projectSectionPointTo2d(axis, to);
  return {
    x: toU - fromU,
    y: toV - fromV
  };
}

function buildSectionFillData(
  axis: 'x' | 'y' | 'z',
  loops: Array<Array<[number, number, number]>>
): Model3dSectionHelperFillData | undefined {
  if (!loops.length) {
    return undefined;
  }

  const loopEntries = createSectionLoopEntries(axis, loops);
  const positions: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;

  for (let index = 0; index < loopEntries.length; index += 1) {
    const entry = loopEntries[index]!;
    if (entry.depth % 2 !== 0) {
      continue;
    }

    const contour = orientSectionLoop(entry.loop, entry.points2d, 'ccw');
    const holes = entry.children
      .map((childIndex) => loopEntries[childIndex]!)
      .filter((child) => child.depth === entry.depth + 1)
      .map((child) => orientSectionLoop(child.loop, child.points2d, 'cw'));

    const triangles = ShapeUtils.triangulateShape(
      contour.points2d,
      holes.map((hole) => hole.points2d)
    );
    if (!triangles.length) {
      continue;
    }

    const allLoops = [contour, ...holes];
    positions.push(...allLoops.flatMap((loop) => loop.loop.flat()));
    indices.push(...triangles.flat().map((triangleIndex) => triangleIndex + vertexOffset));
    vertexOffset += allLoops.reduce((total, loop) => total + loop.loop.length, 0);
  }

  if (!positions.length || !indices.length) {
    return undefined;
  }

  return { positions, indices };
}

function buildSectionFillGeometry(fillData: Model3dSectionHelperFillData): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(fillData.positions, 3));
  geometry.setIndex(fillData.indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function buildSectionBoxFillGeometry(
  section: Model3dPreviewSectionInfo,
  bounds: PreviewSectionBounds,
  epsilon = 0.0005
): BufferGeometry | undefined {
  const range = section.range ?? sectionRangeFromBounds(bounds);
  const [minX, maxX] = range.x;
  const [minY, maxY] = range.y;
  const [minZ, maxZ] = range.z;
  const positions: number[] = [];

  if (minX > bounds.x[0] + epsilon) {
    appendSectionBoxFace(positions, [
      [minX, minY, minZ],
      [minX, maxY, minZ],
      [minX, maxY, maxZ],
      [minX, minY, maxZ]
    ]);
  }
  if (maxX < bounds.x[1] - epsilon) {
    appendSectionBoxFace(positions, [
      [maxX, minY, minZ],
      [maxX, minY, maxZ],
      [maxX, maxY, maxZ],
      [maxX, maxY, minZ]
    ]);
  }
  if (minY > bounds.y[0] + epsilon) {
    appendSectionBoxFace(positions, [
      [minX, minY, minZ],
      [minX, minY, maxZ],
      [maxX, minY, maxZ],
      [maxX, minY, minZ]
    ]);
  }
  if (maxY < bounds.y[1] - epsilon) {
    appendSectionBoxFace(positions, [
      [minX, maxY, minZ],
      [maxX, maxY, minZ],
      [maxX, maxY, maxZ],
      [minX, maxY, maxZ]
    ]);
  }
  if (minZ > bounds.z[0] + epsilon) {
    appendSectionBoxFace(positions, [
      [minX, minY, minZ],
      [maxX, minY, minZ],
      [maxX, maxY, minZ],
      [minX, maxY, minZ]
    ]);
  }
  if (maxZ < bounds.z[1] - epsilon) {
    appendSectionBoxFace(positions, [
      [minX, minY, maxZ],
      [minX, maxY, maxZ],
      [maxX, maxY, maxZ],
      [maxX, minY, maxZ]
    ]);
  }

  if (!positions.length) {
    return undefined;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function appendSectionBoxFace(
  positions: number[],
  face: [[number, number, number], [number, number, number], [number, number, number], [number, number, number]]
): void {
  positions.push(
    ...face[0],
    ...face[1],
    ...face[2],
    ...face[0],
    ...face[2],
    ...face[3]
  );
}

function projectSectionPointTo2d(
  axis: 'x' | 'y' | 'z',
  point: [number, number, number]
): [number, number] {
  switch (axis) {
    case 'x':
      return [point[1], point[2]];
    case 'y':
      return [point[0], point[2]];
    case 'z':
    default:
      return [point[0], point[1]];
  }
}

function createSectionLoopEntries(
  axis: 'x' | 'y' | 'z',
  loops: Array<Array<[number, number, number]>>
): Array<{
  loop: Array<[number, number, number]>;
  points2d: Vector2[];
  signedArea: number;
  absoluteArea: number;
  children: number[];
  depth: number;
}> {
  const entries = loops
    .filter((loop) => loop.length >= 3)
    .map((loop) => {
      const points2d = loop.map((point) => {
        const [u, v] = projectSectionPointTo2d(axis, point);
        return new Vector2(u, v);
      });
      const signedArea = polygonSignedArea(points2d);
      return {
        loop,
        points2d,
        signedArea,
        absoluteArea: Math.abs(signedArea),
        children: [] as number[],
        depth: 0
      };
    })
    .sort((left, right) => right.absoluteArea - left.absoluteArea);

  for (let index = 0; index < entries.length; index += 1) {
    const candidate = entries[index]!;
    let parentIndex = -1;
    let parentArea = Number.POSITIVE_INFINITY;
    for (let compareIndex = 0; compareIndex < index; compareIndex += 1) {
      const possibleParent = entries[compareIndex]!;
      if (possibleParent.absoluteArea >= candidate.absoluteArea && pointInPolygon(candidate.points2d[0]!, possibleParent.points2d)) {
        if (possibleParent.absoluteArea < parentArea) {
          parentArea = possibleParent.absoluteArea;
          parentIndex = compareIndex;
        }
      }
    }
    if (parentIndex >= 0) {
      entries[parentIndex]!.children.push(index);
      candidate.depth = entries[parentIndex]!.depth + 1;
    }
  }

  return entries;
}

function dedupeSectionLoops(
  axis: 'x' | 'y' | 'z',
  loops: Array<Array<[number, number, number]>>,
  epsilon = 1e-4
): Array<Array<[number, number, number]>> {
  const seen = new Set<string>();
  const uniqueLoops: Array<Array<[number, number, number]>> = [];

  for (const loop of loops) {
    const key = normalizedSectionLoopKey(axis, loop, epsilon);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueLoops.push(loop);
  }

  return uniqueLoops;
}

function dedupeSectionChains(
  axis: 'x' | 'y' | 'z',
  chains: Array<Array<[number, number, number]>>,
  epsilon = 1e-4
): Array<Array<[number, number, number]>> {
  const seen = new Set<string>();
  const uniqueChains: Array<Array<[number, number, number]>> = [];

  for (const chain of chains) {
    const key = normalizedSectionChainKey(axis, chain, epsilon);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueChains.push(chain);
  }

  return uniqueChains;
}

function normalizedSectionLoopKey(
  axis: 'x' | 'y' | 'z',
  loop: Array<[number, number, number]>,
  epsilon = 1e-4
): string | undefined {
  if (loop.length < 3) {
    return undefined;
  }
  const forward = loop.map((point) => quantizedSectionPointKey(axis, point, epsilon));
  const backward = [...forward].reverse();
  const normalizedForward = rotateSequenceToLexicographicMinimum(forward);
  const normalizedBackward = rotateSequenceToLexicographicMinimum(backward);
  return normalizedForward < normalizedBackward ? normalizedForward : normalizedBackward;
}

function normalizedSectionChainKey(
  axis: 'x' | 'y' | 'z',
  chain: Array<[number, number, number]>,
  epsilon = 1e-4
): string | undefined {
  if (chain.length < 2) {
    return undefined;
  }
  const forward = chain.map((point) => quantizedSectionPointKey(axis, point, epsilon)).join('|');
  const backward = [...chain]
    .reverse()
    .map((point) => quantizedSectionPointKey(axis, point, epsilon))
    .join('|');
  return forward < backward ? forward : backward;
}

function quantizedSectionPointKey(
  axis: 'x' | 'y' | 'z',
  point: [number, number, number],
  epsilon = 1e-4
): string {
  const [u, v] = projectSectionPointTo2d(axis, point);
  return `${Math.round(u / epsilon)}:${Math.round(v / epsilon)}`;
}

function rotateSequenceToLexicographicMinimum(values: string[]): string {
  if (!values.length) {
    return '';
  }
  let bestIndex = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (compareWrappedSequence(values, index, bestIndex) < 0) {
      bestIndex = index;
    }
  }
  const rotated: string[] = [];
  for (let offset = 0; offset < values.length; offset += 1) {
    rotated.push(values[(bestIndex + offset) % values.length]!);
  }
  return rotated.join('|');
}

function compareWrappedSequence(values: string[], leftStart: number, rightStart: number): number {
  for (let offset = 0; offset < values.length; offset += 1) {
    const left = values[(leftStart + offset) % values.length]!;
    const right = values[(rightStart + offset) % values.length]!;
    const comparison = left.localeCompare(right);
    if (comparison !== 0) {
      return comparison;
    }
  }
  return 0;
}

function orientSectionLoop(
  loop: Array<[number, number, number]>,
  points2d: Vector2[],
  orientation: 'ccw' | 'cw'
): {
  loop: Array<[number, number, number]>;
  points2d: Vector2[];
} {
  const signedArea = polygonSignedArea(points2d);
  const shouldReverse = orientation === 'ccw' ? signedArea < 0 : signedArea > 0;
  if (!shouldReverse) {
    return {
      loop: [...loop],
      points2d: points2d.map((point) => point.clone())
    };
  }
  return {
    loop: [...loop].reverse(),
    points2d: [...points2d].reverse().map((point) => point.clone())
  };
}

function pointInPolygon(point: Vector2, polygon: Vector2[], epsilon = 1e-7): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const currentPoint = polygon[index]!;
    const previousPoint = polygon[previous]!;
    if (pointOnSegment2d(point, previousPoint, currentPoint, epsilon)) {
      return true;
    }
    const intersects = ((currentPoint.y > point.y) !== (previousPoint.y > point.y)) &&
      (point.x < ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) / ((previousPoint.y - currentPoint.y) || epsilon) + currentPoint.x);
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function pointOnSegment2d(
  point: Vector2,
  start: Vector2,
  end: Vector2,
  epsilon = 1e-7
): boolean {
  const cross = (point.y - start.y) * (end.x - start.x) - (point.x - start.x) * (end.y - start.y);
  if (Math.abs(cross) > epsilon) {
    return false;
  }
  const dot = (point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y);
  if (dot < -epsilon) {
    return false;
  }
  const squaredLength = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  return dot <= squaredLength + epsilon;
}

function polygonSignedArea(points: Vector2[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function sectionPlaneIntersectionSegments(
  section: Model3dPreviewSectionInfo,
  positions: Float32Array
): number[] {
  const segments: number[] = [];
  for (let index = 0; index < positions.length; index += 9) {
    const a = new Vector3(positions[index]!, positions[index + 1]!, positions[index + 2]!);
    const b = new Vector3(positions[index + 3]!, positions[index + 4]!, positions[index + 5]!);
    const c = new Vector3(positions[index + 6]!, positions[index + 7]!, positions[index + 8]!);
    const intersections = triangleSectionIntersections(section.axis, section.offset, a, b, c);
    if (intersections.length === 2) {
      segments.push(
        intersections[0]!.x, intersections[0]!.y, intersections[0]!.z,
        intersections[1]!.x, intersections[1]!.y, intersections[1]!.z
      );
    }
  }
  return segments;
}

function resolveSectionOutlineSegments(
  section: Model3dPreviewSectionInfo,
  source: Model3dSectionSourceGeometry | null,
  modelGroup: Object3D | null
): number[] {
  if (!source) {
    return [];
  }
  if (source.objects?.length && modelGroup) {
    const segments: number[] = [];
    for (const entry of source.objects) {
      if (!entry.object.visible) {
        continue;
      }
      const transformed = transformPositionsToModelGroup(entry.positions, entry.object, modelGroup);
      segments.push(...sectionPlaneIntersectionSegments(section, transformed));
    }
    return segments;
  }
  return source.positions.length ? sectionPlaneIntersectionSegments(section, source.positions) : [];
}

function collectSectionObjectGeometries(
  object: Object3D,
  triangleBudget = MAX_SECTION_HELPER_TRIANGLES
): Array<{ object: Object3D; positions: Float32Array }> {
  const candidates: Array<{
    object: Object3D;
    geometry: BufferGeometry;
    position: { count: number; itemSize?: number; getX(index: number): number; getY(index: number): number; getZ(index: number): number };
    triangleCount: number;
  }> = [];
  object.traverse((node) => {
    if (!(node instanceof Mesh || node instanceof SkinnedMesh)) {
      return;
    }
    const geometry = node.geometry;
    const position = geometry?.getAttribute('position');
    if (!geometry || !position || position.itemSize < 3) {
      return;
    }
    const triangleCount = countGeometryTriangles(geometry);
    if (!triangleCount) {
      return;
    }
    candidates.push({
      object: node,
      geometry,
      position,
      triangleCount
    });
  });
  if (!candidates.length) {
    return [];
  }
  const budgets = allocateTriangleBudgets(
    candidates.map((candidate) => candidate.triangleCount),
    triangleBudget
  );
  const entries: Array<{ object: Object3D; positions: Float32Array }> = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    const positions = geometryPositionsArray(candidate.geometry, candidate.position, budgets[index]);
    if (positions.length) {
      entries.push({
        object: candidate.object,
        positions
      });
    }
  }
  return entries;
}

function geometryPositionsArray(
  geometry: BufferGeometry,
  position: { count: number; getX(index: number): number; getY(index: number): number; getZ(index: number): number },
  limitTriangles?: number
): Float32Array {
  const triangleCount = geometry.index
    ? Math.floor(geometry.index.count / 3)
    : Math.floor(position.count / 3);
  if (!triangleCount) {
    return new Float32Array();
  }
  const sampledTriangles = sampleTriangleIndices(triangleCount, limitTriangles);
  const values = new Float32Array(sampledTriangles.length * 9);
  let writeIndex = 0;
  if (geometry.index) {
    for (const triangleIndex of sampledTriangles) {
      for (let offset = 0; offset < 3; offset += 1) {
        const vertexIndex = geometry.index.getX(triangleIndex * 3 + offset);
        values[writeIndex] = position.getX(vertexIndex);
        values[writeIndex + 1] = position.getY(vertexIndex);
        values[writeIndex + 2] = position.getZ(vertexIndex);
        writeIndex += 3;
      }
    }
    return values;
  }
  for (const triangleIndex of sampledTriangles) {
    const vertexStart = triangleIndex * 3;
    for (let offset = 0; offset < 3; offset += 1) {
      const vertexIndex = vertexStart + offset;
      values[writeIndex] = position.getX(vertexIndex);
      values[writeIndex + 1] = position.getY(vertexIndex);
      values[writeIndex + 2] = position.getZ(vertexIndex);
      writeIndex += 3;
    }
  }
  return values;
}

function allocateTriangleBudgets(triangleCounts: number[], budget: number): number[] {
  if (!triangleCounts.length || budget <= 0) {
    return triangleCounts.map(() => 0);
  }
  const totalTriangles = triangleCounts.reduce((sum, count) => sum + count, 0);
  if (totalTriangles <= budget) {
    return [...triangleCounts];
  }
  const budgets = triangleCounts.map((triangleCount) => Math.floor((triangleCount / totalTriangles) * budget));
  let assigned = budgets.reduce((sum, count) => sum + count, 0);
  const rankedRemainders = triangleCounts
    .map((triangleCount, index) => ({
      index,
      remainder: (triangleCount / totalTriangles) * budget - budgets[index]!,
      available: triangleCount - budgets[index]!
    }))
    .sort((left, right) => right.remainder - left.remainder || right.available - left.available);
  for (const entry of rankedRemainders) {
    if (assigned >= budget) {
      break;
    }
    if (entry.available <= 0) {
      continue;
    }
    budgets[entry.index] = budgets[entry.index]! + 1;
    assigned += 1;
  }
  return budgets;
}

function sampleTrianglePositions(positions: Float32Array, limitTriangles: number): Float32Array {
  const triangleCount = Math.floor(positions.length / 9);
  if (!triangleCount || triangleCount <= limitTriangles) {
    return positions;
  }
  const sampledTriangles = sampleTriangleIndices(triangleCount, limitTriangles);
  const result = new Float32Array(sampledTriangles.length * 9);
  let writeIndex = 0;
  for (const triangleIndex of sampledTriangles) {
    const sourceIndex = triangleIndex * 9;
    result.set(positions.subarray(sourceIndex, sourceIndex + 9), writeIndex);
    writeIndex += 9;
  }
  return result;
}

function sampleTriangleIndices(totalTriangles: number, limitTriangles?: number): number[] {
  if (!totalTriangles) {
    return [];
  }
  if (typeof limitTriangles !== 'number' || limitTriangles <= 0 || totalTriangles <= limitTriangles) {
    return Array.from({ length: totalTriangles }, (_, index) => index);
  }
  const indices: number[] = [];
  const lastTriangleIndex = totalTriangles - 1;
  for (let index = 0; index < limitTriangles; index += 1) {
    const triangleIndex = Math.min(
      lastTriangleIndex,
      Math.floor(((index + 0.5) * totalTriangles) / limitTriangles)
    );
    indices.push(triangleIndex);
  }
  return indices;
}

function transformPositionsToModelGroup(
  positions: Float32Array,
  object: Object3D,
  modelGroup: Object3D
): Float32Array {
  object.updateMatrixWorld(true);
  modelGroup.updateMatrixWorld(true);
  const transform = new Matrix4().copy(modelGroup.matrixWorld).invert().multiply(object.matrixWorld);
  const result = new Float32Array(positions.length);
  const vertex = new Vector3();
  for (let index = 0; index < positions.length; index += 3) {
    vertex.set(positions[index]!, positions[index + 1]!, positions[index + 2]!).applyMatrix4(transform);
    result[index] = vertex.x;
    result[index + 1] = vertex.y;
    result[index + 2] = vertex.z;
  }
  return result;
}

function triangleSectionIntersections(
  axis: 'x' | 'y' | 'z',
  offset: number,
  a: Vector3,
  b: Vector3,
  c: Vector3
): Vector3[] {
  const vertices = [a, b, c];
  const intersections: Vector3[] = [];
  const edges: Array<[Vector3, Vector3]> = [
    [vertices[0]!, vertices[1]!],
    [vertices[1]!, vertices[2]!],
    [vertices[2]!, vertices[0]!]
  ];
  for (const [start, end] of edges) {
    const point = segmentPlaneIntersection(axis, offset, start, end);
    if (point && !intersections.some((existing) => existing.distanceToSquared(point) < 1e-10)) {
      intersections.push(point);
    }
  }
  return intersections;
}

function segmentPlaneIntersection(
  axis: 'x' | 'y' | 'z',
  offset: number,
  start: Vector3,
  end: Vector3
): Vector3 | undefined {
  const startValue = axisValue(start, axis) - offset;
  const endValue = axisValue(end, axis) - offset;
  if (Math.abs(startValue) <= 1e-7 && Math.abs(endValue) <= 1e-7) {
    return undefined;
  }
  if ((startValue > 0 && endValue > 0) || (startValue < 0 && endValue < 0)) {
    return undefined;
  }
  const delta = endValue - startValue;
  if (Math.abs(delta) <= 1e-7) {
    return undefined;
  }
  const t = -startValue / delta;
  if (t < -1e-7 || t > 1 + 1e-7) {
    return undefined;
  }
  return start.clone().lerp(end, clamp(t, 0, 1));
}

function axisValue(vector: Vector3, axis: 'x' | 'y' | 'z'): number {
  switch (axis) {
    case 'y':
      return vector.y;
    case 'z':
      return vector.z;
    default:
      return vector.x;
  }
}

function previewNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function compareMaterialDetails(left: PreviewMaterialInfo, right: PreviewMaterialInfo): number {
  const leftKey = `${left.name ?? ''}\u0000${left.type}\u0000${left.key}`;
  const rightKey = `${right.name ?? ''}\u0000${right.type}\u0000${right.key}`;
  return leftKey.localeCompare(rightKey);
}

function previewMaterialKey(material: Material): string {
  return `${material.type || material.constructor.name || 'Material'}:${material.name || 'unnamed'}:${material.id}`;
}

function colorToHex(color: Color): string {
  return `#${color.getHexString().toUpperCase()}`;
}

function roundPreviewNumber(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function vector3Tuple(vector: Vector3): [number, number, number] {
  return [
    roundPreviewNumber(vector.x),
    roundPreviewNumber(vector.y),
    roundPreviewNumber(vector.z)
  ];
}

function isBinaryStl(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 84) {
    return false;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangleCount = view.getUint32(80, true);
  return 84 + triangleCount * 50 === bytes.byteLength;
}

function boundsCenter(bounds: ModelGeometry['bounds']): Vector3 {
  return new Vector3(
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2
  );
}

function boundsSize(bounds: ModelGeometry['bounds']): Vector3 {
  return new Vector3(
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2]
  );
}

function sectionBoundsFromCenteredBounds(bounds: ModelGeometry['bounds'], center: Vector3): PreviewSectionBounds {
  return {
    x: [bounds.min[0] - center.x, bounds.max[0] - center.x],
    y: [bounds.min[1] - center.y, bounds.max[1] - center.y],
    z: [bounds.min[2] - center.z, bounds.max[2] - center.z]
  };
}

function sectionBoundsFromObject(object: Object3D): PreviewSectionBounds {
  const bounds = new Box3().setFromObject(object);
  if (bounds.isEmpty()) {
    return {
      x: [-1, 1],
      y: [-1, 1],
      z: [-1, 1]
    };
  }
  return {
    x: [bounds.min.x, bounds.max.x],
    y: [bounds.min.y, bounds.max.y],
    z: [bounds.min.z, bounds.max.z]
  };
}

function numberPart(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function degToRad(value: number): number {
  return value * Math.PI / 180;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function createRendererOrFallback(options: ConstructorParameters<typeof WebGLRenderer>[0]): PreviewRenderer {
  try {
    const renderer = new WebGLRenderer(options) as unknown as PreviewRenderer & { getContext?: () => unknown };
    const context = renderer.getContext?.();
    if (!context) {
      renderer.dispose?.();
      throw new Error('WebGL unavailable');
    }
    return renderer;
  } catch {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    return {
      domElement: canvas,
      setPixelRatio: () => {},
      setClearColor: () => {},
      setSize: (width, height) => {
        const safeWidth = Math.max(1, Math.floor(width));
        const safeHeight = Math.max(1, Math.floor(height));
        canvas.width = safeWidth;
        canvas.height = safeHeight;
      },
      render: () => {},
      dispose: () => {}
    };
  }
}

function normalizeFormat(format: string | undefined): string {
  return String(format ?? '').trim().replace(/^\./, '').toLowerCase();
}

function parseGltfJson(source: string): unknown {
  try {
    return JSON.parse(source);
  } catch {
    throw new Error('glTF JSON is invalid.');
  }
}

function isEmbeddedGltfUri(uri: string): boolean {
  const normalized = uri.trim().toLowerCase();
  return normalized.startsWith('data:') || normalized.startsWith('blob:');
}

function gltfResourcePathForSource(source: PreviewSource): string | undefined {
  if (typeof source !== 'string') {
    return undefined;
  }
  const trimmed = source.trim();
  if (!trimmed || trimmed.toLowerCase().startsWith('data:') || trimmed.toLowerCase().startsWith('blob:')) {
    return undefined;
  }
  try {
    const absoluteUrl = new URL(trimmed, globalThis.location?.href ?? 'http://localhost/');
    return new URL('.', absoluteUrl).href;
  } catch {
    return undefined;
  }
}

function modelResourcePathForSource(source: PreviewSource): string {
  return gltfResourcePathForSource(source) ?? '';
}

function colladaResourcePathForSource(source: PreviewSource): string {
  return modelResourcePathForSource(source);
}

function modelNameForSource(name: string | undefined): string {
  const fileName = String(name ?? 'model').split(/[\\/]/).pop() ?? 'model';
  return fileName.replace(/\.[^.]+$/, '') || 'model';
}

function normalizeResourceResolverResult(
  result: Awaited<ReturnType<PreviewResourceResolver>>,
  contentType: string
): { source?: string; warnings: string[] } {
  if (!result) {
    return { warnings: [] };
  }
  if (typeof result === 'string') {
    return {
      source: result,
      warnings: []
    };
  }
  if (result instanceof Blob) {
    return {
      source: URL.createObjectURL(result),
      warnings: []
    };
  }
  if (ArrayBuffer.isView(result) || result instanceof ArrayBuffer) {
    const bytes = ArrayBuffer.isView(result)
      ? new Uint8Array(result.buffer, result.byteOffset, result.byteLength)
      : new Uint8Array(result);
    return {
      source: bytesToDataUrl(bytes, contentType),
      warnings: []
    };
  }
  return normalizeResourceResolveResult(result, contentType);
}

function normalizeResourceResolveResult(
  result: PreviewResourceResolveResult,
  contentType: string
): { source?: string; warnings: string[] } {
  return {
    source: normalizeResolvedPreviewSource(result.source, contentType),
    warnings: result.warnings ?? []
  };
}

function normalizeResolvedPreviewSource(source: PreviewSource | undefined, contentType: string): string | undefined {
  if (!source) {
    return undefined;
  }
  if (typeof source === 'string') {
    return source;
  }
  if (source instanceof Blob) {
    return URL.createObjectURL(source);
  }
  if (ArrayBuffer.isView(source)) {
    return bytesToDataUrl(new Uint8Array(source.buffer, source.byteOffset, source.byteLength), contentType);
  }
  if (source instanceof ArrayBuffer) {
    return bytesToDataUrl(new Uint8Array(source), contentType);
  }
  return undefined;
}

async function previewSourceToText(source: PreviewSource): Promise<string> {
  if (typeof source === 'string') {
    if (source.startsWith('data:')) {
      return decodeDataUrlText(source);
    }
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Failed to load OBJ material resource: ${response.status} ${response.statusText}`.trim());
    }
    return response.text();
  }
  if (source instanceof Blob) {
    return source.text();
  }
  if (ArrayBuffer.isView(source)) {
    return new TextDecoder().decode(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
  }
  if (source instanceof ArrayBuffer) {
    return new TextDecoder().decode(source);
  }
  return String(source);
}

function decodeDataUrlText(source: string): string {
  const commaIndex = source.indexOf(',');
  if (commaIndex < 0) {
    return '';
  }
  const metadata = source.slice(0, commaIndex).toLowerCase();
  const payload = source.slice(commaIndex + 1);
  return metadata.endsWith(';base64') ? atob(payload) : decodeURIComponent(payload);
}

function gltfResourceContentType(uri: string): string {
  const normalized = uri.split('?')[0]?.toLowerCase() ?? uri.toLowerCase();
  if (normalized.endsWith('.png')) return 'image/png';
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.webp')) return 'image/webp';
  if (normalized.endsWith('.ktx2')) return 'image/ktx2';
  return 'application/octet-stream';
}

function objResourceContentType(uri: string): string {
  const normalized = uri.split('?')[0]?.toLowerCase() ?? uri.toLowerCase();
  if (normalized.endsWith('.mtl')) return 'text/plain';
  return gltfResourceContentType(uri);
}

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, '/').split(/[?#]/)[0] ?? '';
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(0, index) : '';
}

function joinResourcePath(base: string, path: string): string {
  if (!base || /^[a-z]+:\/\//i.test(path) || /^[a-z]:[\\/]/i.test(path) || path.startsWith('/')) {
    return path.replace(/\\/g, '/');
  }
  const parts: string[] = [];
  for (const part of `${base}/${path}`.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

function bytesToDataUrl(bytes: Uint8Array, contentType: string): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `data:${contentType};base64,${btoa(binary)}`;
}
