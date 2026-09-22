<script setup lang="ts">
import {
  createPreviewer,
  type CadPreviewState,
  type ConverterClient,
  type DiagramPreviewState,
  type PreviewDisplayMode,
  type EbookPreviewState,
  type FormatDefinition,
  type ImagePreviewState,
  type MindmapPreviewState,
  type Model3dPreviewNode,
  type Model3dPreviewState,
  type PreviewMeasurementInfo,
  type PreviewSectionInfo,
  type PagedPreviewState,
  type PreviewMaterialInfo,
  type PreviewSnapshotBackground,
  type PreviewDriver,
  type PreviewFitMode,
  type PreviewFontResolver,
  type PreviewItemState,
  type PreviewResourceResolver,
  type PreviewSource,
  type PreviewerInstance,
  type SourceDescriptor,
  type WorkbookPreviewState
} from '@filens/core';
import { createArchivePreviewDriver } from '@filens/archive';
import { createDesignPreviewDrivers } from '@filens/design';
import { createMediaPreviewDrivers, type MediaPreviewDriverOptions } from '@filens/media';
import { createOfficePreviewDrivers } from '@filens/office';
import { createTextPreviewDrivers } from '@filens/text';
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { createVueDefaultPreviewRoutes } from './defaults';

type Model3dControlsPreviewer = PreviewerInstance & {
  setNodeVisibility?: (nodeId: string, visible: boolean) => void;
  setExplode?: (amount: number) => void;
  setActiveMaterial?: (materialKey?: string) => void;
  setMeasurementActive?: (active: boolean) => void;
  clearMeasurement?: () => void;
  setMeasurementSnapMode?: (mode: 'surface' | 'vertex') => void;
  setMeasurementAxisLock?: (axis: 'free' | 'x' | 'y' | 'z') => void;
  setSectionActive?: (active: boolean) => void;
  setSectionMode?: (mode: 'single' | 'box') => void;
  setSectionAxis?: (axis: 'x' | 'y' | 'z') => void;
  setSectionOffset?: (offset: number) => void;
  setSectionRange?: (axis: 'x' | 'y' | 'z', min: number, max: number) => void;
  clearSection?: () => void;
  setCameraProjection?: (projection: 'perspective' | 'orthographic') => void;
  setCameraViewPreset?: (preset: 'free' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'isometric') => void;
  setDisplayMode?: (mode: PreviewDisplayMode) => void;
  setSnapshotBackground?: (background: PreviewSnapshotBackground) => void;
  downloadSnapshot?: (filename?: string, background?: PreviewSnapshotBackground) => void;
};

type Model3dSectionInfo = PreviewSectionInfo & {
  mode?: 'single' | 'box';
  bounds?: {
    x: [number, number];
    y: [number, number];
    z: [number, number];
  };
  range?: {
    x: [number, number];
    y: [number, number];
    z: [number, number];
  };
};

type Model3dPreviewStateWithExplode = Model3dPreviewState & {
  explode?: number;
  snapshotBackground?: PreviewSnapshotBackground;
  section?: Model3dSectionInfo;
  camera?: NonNullable<Model3dPreviewState['camera']> & {
    projection?: 'perspective' | 'orthographic';
    viewPreset?: 'free' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'isometric';
  };
};

const props = withDefaults(
  defineProps<{
    src: PreviewSource | SourceDescriptor;
    name?: string;
    extension?: string;
    contentType?: string;
    fit?: PreviewFitMode;
    initialScale?: number;
    minScale?: number;
    maxScale?: number;
    toolbar?: boolean;
    drivers?: PreviewDriver[];
    routes?: FormatDefinition[];
    converter?: ConverterClient;
    fontResolver?: PreviewFontResolver;
    resourceResolver?: PreviewResourceResolver;
    panoramaProcessor?: MediaPreviewDriverOptions['panoramaProcessor'];
  }>(),
  {
    initialScale: 1,
    minScale: 0.4,
    maxScale: 4,
    toolbar: true,
    drivers: undefined,
    routes: undefined,
    converter: undefined,
    fontResolver: undefined,
    resourceResolver: undefined,
    panoramaProcessor: undefined
  }
);

const emit = defineEmits<{
  (event: 'rendered', state: PreviewItemState): void;
  (event: 'error', error: Error): void;
  (event: 'state-change', state: PreviewItemState): void;
  (event: 'warnings', warnings: string[]): void;
  (event: 'page-change', pageIndex: number): void;
  (event: 'sheet-change', sheetIndex: number): void;
  (event: 'scale-change', scale: number): void;
}>();

const viewerHost = ref<HTMLDivElement | null>(null);
const shellRef = ref<HTMLDivElement | null>(null);
const previewer = shallowRef<PreviewerInstance | null>(null);
const previewState = ref<PreviewItemState>({
  loading: false,
  error: null,
  family: 'unsupported',
  warnings: [],
  capabilities: {}
});
const unsubs: Array<() => void> = [];
const collapsedModelNodes = ref<Set<string>>(new Set());
const model3dTreeQuery = ref('');

const isLoading = computed(() => previewState.value.loading);
const errorMessage = computed(() => previewState.value.error);
const isPaged = computed(() => previewState.value.family === 'paged');
const isWorkbook = computed(() => previewState.value.family === 'workbook');
const isEbook = computed(() => previewState.value.family === 'ebook');
const pagedState = computed(() => (isPaged.value ? (previewState.value as PagedPreviewState) : null));
const workbookState = computed(() => (isWorkbook.value ? (previewState.value as WorkbookPreviewState) : null));
const ebookState = computed(() => (isEbook.value ? (previewState.value as EbookPreviewState) : null));
const imageState = computed(() =>
  previewState.value.family === 'image' || previewState.value.family === 'panorama'
    ? (previewState.value as ImagePreviewState)
    : null
);
const cadState = computed(() => (previewState.value.family === 'cad' ? (previewState.value as CadPreviewState) : null));
const model3dState = computed(() => (
  previewState.value.family === 'model3d' ? (previewState.value as Model3dPreviewStateWithExplode) : null
));
const mindmapState = computed(() => (previewState.value.family === 'mindmap' ? (previewState.value as MindmapPreviewState) : null));
const diagramState = computed(() => (previewState.value.family === 'diagram' ? (previewState.value as DiagramPreviewState) : null));
const activeIndex = computed(() => pagedState.value?.pageIndex ?? workbookState.value?.activeSheetIndex ?? ebookState.value?.chapterIndex ?? diagramState.value?.pageIndex ?? 0);
const activeCount = computed(() => pagedState.value?.pageCount ?? workbookState.value?.sheets.length ?? ebookState.value?.chapterCount ?? diagramState.value?.pageCount ?? 0);
const scale = computed(() => pagedState.value?.scale ?? workbookState.value?.scale ?? imageState.value?.scale ?? cadState.value?.scale ?? mindmapState.value?.scale ?? diagramState.value?.scale ?? props.initialScale);
const scaleLabel = computed(() => `${Math.round(scale.value * 100)}%`);
const canNavigate = computed(() => Boolean(previewState.value.capabilities.paged || previewState.value.capabilities.sheets || previewState.value.capabilities.chapters));
const canGoPrev = computed(() => !isLoading.value && canNavigate.value && activeIndex.value > 0);
const canGoNext = computed(
  () => !isLoading.value && canNavigate.value && activeIndex.value < activeCount.value - 1
);
const canZoomOut = computed(() => !isLoading.value && Boolean(previewState.value.capabilities.zoom) && scale.value > props.minScale + 0.001);
const canZoomIn = computed(() => !isLoading.value && Boolean(previewState.value.capabilities.zoom) && scale.value < props.maxScale - 0.001);
const canRotate = computed(() => !isLoading.value && Boolean(previewState.value.capabilities.rotate));
const canFullscreen = computed(() => !isLoading.value && Boolean(previewState.value.capabilities.fullscreen));
const previewLayers = computed(() => cadState.value?.layers ?? []);
const activeLayerIds = computed(() => new Set(cadState.value?.activeLayerIds ?? []));
const canControlLayers = computed(() => !isLoading.value && Boolean(previewState.value.capabilities.layers) && previewLayers.value.length > 0);
const model3dTree = computed(() => model3dState.value?.modelTree ?? []);
const normalizedModel3dTreeQuery = computed(() => normalizeSearchText(model3dTreeQuery.value));
const hasModel3dTreeQuery = computed(() => normalizedModel3dTreeQuery.value.length > 0);
const filteredModel3dTree = computed(() => (
  hasModel3dTreeQuery.value
    ? filterModelTree(model3dTree.value, normalizedModel3dTreeQuery.value)
    : model3dTree.value
));
const model3dTreeTotalCount = computed(() => countModelNodes(model3dTree.value));
const model3dTreeMatchCount = computed(() => (
  hasModel3dTreeQuery.value
    ? countMatchingModelNodes(model3dTree.value, normalizedModel3dTreeQuery.value)
    : model3dTreeTotalCount.value
));
const selectedModelNodeId = computed(() => model3dState.value?.selectedNodeId);
const model3dMetadataRows = computed(() => {
  const metadata = model3dState.value?.metadata;
  if (!metadata) {
    return [];
  }
  const rows: Array<{ label: string; value: string }> = [];
  if (metadata.format) rows.push({ label: 'Format', value: metadata.format.toUpperCase() });
  if (typeof metadata.objectCount === 'number') rows.push({ label: 'Objects', value: String(metadata.objectCount) });
  if (typeof metadata.meshCount === 'number') rows.push({ label: 'Meshes', value: String(metadata.meshCount) });
  if (typeof metadata.lineCount === 'number') rows.push({ label: 'Lines', value: String(metadata.lineCount) });
  if (typeof metadata.pointCount === 'number') rows.push({ label: 'Points', value: String(metadata.pointCount) });
  if (typeof metadata.materialCount === 'number') rows.push({ label: 'Materials', value: String(metadata.materialCount) });
  if (typeof metadata.animationCount === 'number' && metadata.animationCount > 0) rows.push({ label: 'Animations', value: String(metadata.animationCount) });
  if (typeof metadata.triangleCount === 'number') rows.push({ label: 'Triangles', value: String(metadata.triangleCount) });
  if (typeof metadata.vertexCount === 'number') rows.push({ label: 'Vertices', value: String(metadata.vertexCount) });
  if (metadata.bounds?.size) rows.push({ label: 'Size', value: metadata.bounds.size.map(formatCompactNumber).join(' x ') });
  if (typeof metadata.hasVertexColors === 'boolean') rows.push({ label: 'Vertex colors', value: metadata.hasVertexColors ? 'Yes' : 'No' });
  if (metadata.materialNames?.length) rows.push({ label: 'Material names', value: metadata.materialNames.join(', ') });
  return rows;
});
const model3dTreeRows = computed(() => (
  flattenModelTree(
    filteredModel3dTree.value,
    hasModel3dTreeQuery.value ? new Set<string>() : collapsedModelNodes.value
  )
));
const selectedModelNodeRow = computed(() => model3dTreeRows.value.find((node) => node.id === selectedModelNodeId.value));
const selectedModelNodeSummary = computed(() => {
  if (!selectedModelNodeId.value) {
    return [];
  }
  const node = findModelNode(model3dTree.value, selectedModelNodeId.value);
  if (!node) {
    return [];
  }
  const summary = summarizeModelNode(node);
  return [
    { label: 'Kind', value: node.kind },
    { label: 'Children', value: String(node.children.length) },
    { label: 'Subtree nodes', value: String(summary.nodes) },
    { label: 'Meshes', value: String(node.metadata?.meshCount ?? summary.meshes) },
    { label: 'Lines', value: String(node.metadata?.lineCount ?? summary.lines) },
    { label: 'Points', value: String(node.metadata?.pointCount ?? summary.points) },
    { label: 'Groups', value: String(summary.groups) },
    { label: 'Materials', value: String(node.metadata?.materialCount ?? 0) },
    { label: 'Triangles', value: String(node.metadata?.triangleCount ?? 0) },
    { label: 'Vertices', value: String(node.metadata?.vertexCount ?? 0) },
    { label: 'Vertex colors', value: typeof node.metadata?.hasVertexColors === 'boolean' ? (node.metadata.hasVertexColors ? 'Yes' : 'No') : 'No' },
    { label: 'Visible', value: node.visible ? 'Yes' : 'No' },
    ...(node.metadata?.bounds?.size
      ? [{ label: 'Bounds', value: node.metadata.bounds.size.map(formatCompactNumber).join(' x ') }]
      : []),
    ...(node.metadata?.materialNames?.length
      ? [{ label: 'Material names', value: node.metadata.materialNames.join(', ') }]
      : [])
  ];
});
const selectedModelMaterialDetails = computed(() => {
  if (!selectedModelNodeId.value) {
    return [];
  }
  return findModelNode(model3dTree.value, selectedModelNodeId.value)?.metadata?.materialDetails ?? [];
});
const model3dMaterialDetails = computed(() =>
  selectedModelMaterialDetails.value.length
    ? selectedModelMaterialDetails.value
    : model3dState.value?.metadata?.materialDetails ?? []
);
const model3dMaterialHeading = computed(() =>
  selectedModelMaterialDetails.value.length ? 'Selected materials' : 'Model materials'
);
const model3dMaterialCountLabel = computed(() => String(model3dMaterialDetails.value.length));
const activeModelMaterialKey = computed(() => model3dState.value?.isolatedMaterialKey);
const model3dMeasurement = computed(() => model3dState.value?.measurement);
const isModelMeasurementActive = computed(() => Boolean(model3dMeasurement.value?.active));
const canMeasureModel = computed(() => !isLoading.value && previewState.value.family === 'model3d' && Boolean(previewState.value.capabilities.measure));
const hasModelMeasurement = computed(() => Boolean(model3dMeasurement.value?.start));
const model3dMeasurementSnapMode = computed(() => model3dMeasurement.value?.snapMode ?? 'surface');
const model3dMeasurementAxisLock = computed(() => model3dMeasurement.value?.axisLock ?? 'free');
const model3dMeasurementRows = computed(() => {
  const measurement = model3dMeasurement.value;
  if (!measurement) {
    return [];
  }
  return [
    { label: 'Status', value: measurementStatusLabel(measurement) },
    { label: 'Snap', value: measurementSnapLabel(measurement.snapMode ?? 'surface') },
    { label: 'Axis', value: measurementAxisLabel(measurement.axisLock ?? 'free') },
    ...(measurement.start ? [{ label: 'Start', value: formatVector(measurement.start) }] : []),
    ...(measurement.end ? [{ label: 'End', value: formatVector(measurement.end) }] : []),
    ...(!measurement.end && measurement.previewPoint ? [{ label: 'Preview', value: formatVector(measurement.previewPoint) }] : []),
    ...(measurement.delta ? [{ label: 'Delta', value: formatVector(measurement.delta) }] : []),
    ...(!measurement.delta && measurement.previewDelta ? [{ label: 'Preview delta', value: formatVector(measurement.previewDelta) }] : []),
    ...(typeof measurement.distance === 'number' ? [{ label: 'Distance', value: formatCompactNumber(measurement.distance) }] : []),
    ...(typeof measurement.distance !== 'number' && typeof measurement.previewDistance === 'number'
      ? [{ label: 'Preview distance', value: formatCompactNumber(measurement.previewDistance) }]
      : [])
  ];
});
const model3dSection = computed(() => model3dState.value?.section);
const canSectionModel = computed(() => !isLoading.value && previewState.value.family === 'model3d' && Boolean(previewState.value.capabilities.section));
const isModelSectionActive = computed(() => Boolean(model3dSection.value?.active));
const model3dSectionMode = computed(() => model3dSection.value?.mode ?? 'single');
const model3dSectionAxis = computed(() => model3dSection.value?.axis ?? 'x');
const model3dSectionMin = computed(() => model3dSection.value?.min ?? -1);
const model3dSectionMax = computed(() => model3dSection.value?.max ?? 1);
const model3dSectionOffset = computed(() => model3dSection.value?.offset ?? 0);
const model3dSectionStep = computed(() => {
  const range = Math.abs(model3dSectionMax.value - model3dSectionMin.value);
  return range > 0 ? Math.max(range / 200, 0.001) : 0.001;
});
const model3dSectionBounds = computed(() => model3dSection.value?.bounds ?? {
  x: [-1, 1] as [number, number],
  y: [-1, 1] as [number, number],
  z: [-1, 1] as [number, number]
});
const model3dSectionRange = computed(() => model3dSection.value?.range ?? model3dSectionBounds.value);
const model3dSectionRows = computed(() => {
  const section = model3dSection.value;
  if (!section) {
    return [];
  }
  return [
    { label: 'Status', value: section.active ? 'Active' : 'Idle' },
    { label: 'Mode', value: section.mode === 'box' ? 'Box' : 'Plane' },
    { label: 'Axis', value: measurementAxisLabel(section.axis) },
    { label: 'Offset', value: formatCompactNumber(section.offset) },
    { label: 'Plane range', value: `${formatCompactNumber(section.min)} .. ${formatCompactNumber(section.max)}` },
    ...(section.mode === 'box'
      ? [
          { label: 'Box X', value: formatRange(model3dSectionRange.value.x) },
          { label: 'Box Y', value: formatRange(model3dSectionRange.value.y) },
          { label: 'Box Z', value: formatRange(model3dSectionRange.value.z) }
        ]
      : [])
  ];
});
const model3dCamera = computed(() => model3dState.value?.camera);
const model3dProjection = computed(() => model3dCamera.value?.projection ?? 'perspective');
const model3dViewPreset = computed(() => model3dCamera.value?.viewPreset ?? 'free');
const model3dDisplayMode = computed(() => model3dState.value?.displayMode ?? 'solid-edge');
const model3dSnapshotBackground = computed(() => model3dState.value?.snapshotBackground ?? 'scene');
const canControlModelCamera = computed(() => !isLoading.value && previewState.value.family === 'model3d');
const canControlModelDisplay = computed(() => !isLoading.value && previewState.value.family === 'model3d' && Boolean(previewState.value.capabilities.displayMode));
const canDownloadSnapshot = computed(() => !isLoading.value && previewState.value.family === 'model3d' && Boolean(previewState.value.capabilities.download));
const model3dTreeSearchLabel = computed(() => (
  hasModel3dTreeQuery.value
    ? `${model3dTreeMatchCount.value} match${model3dTreeMatchCount.value === 1 ? '' : 'es'}`
    : `${model3dTreeTotalCount.value} node${model3dTreeTotalCount.value === 1 ? '' : 's'}`
));
const showModel3dTree = computed(() => !isLoading.value && previewState.value.family === 'model3d' && model3dTree.value.length > 0);
const showModel3dTreeEmpty = computed(() => showModel3dTree.value && hasModel3dTreeQuery.value && model3dTreeRows.value.length === 0);
const showModel3dMetadata = computed(() => !isLoading.value && previewState.value.family === 'model3d' && model3dMetadataRows.value.length > 0);
const canExplodeModel = computed(() => !isLoading.value && previewState.value.family === 'model3d' && Boolean(previewState.value.capabilities.explode));
const model3dExplodePercent = computed(() => Math.round((model3dState.value?.explode ?? 0) * 100));
const layerLabel = computed(() => {
  const total = previewLayers.value.length;
  const active = activeLayerIds.value.size;
  return total ? `${active} / ${total}` : 'Layers';
});
const warningLabel = computed(() =>
  previewState.value.warnings.length ? `${previewState.value.warnings.length} warning${previewState.value.warnings.length > 1 ? 's' : ''}` : ''
);
const familyLabel = computed(() => previewState.value.family === 'unsupported' ? 'Preview' : previewState.value.family);
const positionLabel = computed(() => {
  if (isPaged.value) {
    return `${activeIndex.value + 1} / ${activeCount.value || 1}`;
  }
  if (isWorkbook.value) {
    return `${workbookState.value?.sheets[activeIndex.value]?.name ?? 'Sheet'} ${activeIndex.value + 1} / ${activeCount.value || 1}`;
  }
  if (isEbook.value) {
    return `${ebookState.value?.chapterTitle ?? 'Chapter'} ${activeIndex.value + 1} / ${activeCount.value || 1}`;
  }
  if (diagramState.value) {
    return `Page ${activeIndex.value + 1} / ${activeCount.value || 1}`;
  }
  return familyLabel.value;
});

function syncState(state?: PreviewItemState): void {
  const previousFamily = previewState.value.family;
  const previousActiveIndex = activeIndex.value;
  const previousScale = scale.value;
  previewState.value = clonePreviewState(state ?? previewer.value?.getState() ?? previewState.value);

  if (previewState.value.family === 'paged') {
    const current = previewState.value as PagedPreviewState;
    if (previousFamily === 'paged' && current.pageIndex !== previousActiveIndex) {
      emit('page-change', current.pageIndex);
    }
    if (current.scale !== previousScale) {
      emit('scale-change', current.scale);
    }
    return;
  }

  if (previewState.value.family === 'workbook') {
    const current = previewState.value as WorkbookPreviewState;
    if (previousFamily === 'workbook' && current.activeSheetIndex !== previousActiveIndex) {
      emit('sheet-change', current.activeSheetIndex);
    }
    if (typeof current.scale === 'number' && current.scale !== previousScale) {
      emit('scale-change', current.scale);
    }
    return;
  }

  if ((previewState.value.family === 'image' || previewState.value.family === 'panorama') && 'scale' in previewState.value) {
    const current = previewState.value as ImagePreviewState;
    if (current.scale !== previousScale) {
      emit('scale-change', current.scale);
    }
    return;
  }

  if (previewState.value.family === 'cad') {
    const current = previewState.value as CadPreviewState;
    if (current.scale !== previousScale) {
      emit('scale-change', current.scale);
    }
    return;
  }

  if (previewState.value.family === 'mindmap') {
    const current = previewState.value as MindmapPreviewState;
    if (current.scale !== previousScale) {
      emit('scale-change', current.scale);
    }
    return;
  }

  if (previewState.value.family === 'diagram') {
    const current = previewState.value as DiagramPreviewState;
    if (previousFamily === 'diagram' && current.pageIndex !== previousActiveIndex) {
      emit('page-change', current.pageIndex ?? 0);
    }
    if (current.scale !== previousScale) {
      emit('scale-change', current.scale);
    }
  }
}

function clonePreviewState<T extends PreviewItemState>(state: T): T {
  const cloned = {
    ...state,
    capabilities: { ...state.capabilities },
    warnings: [...state.warnings]
  } as T;

  const measurement = (state as unknown as { measurement?: PreviewMeasurementInfo }).measurement;
  if (measurement) {
    (cloned as unknown as { measurement: PreviewMeasurementInfo }).measurement = {
      ...measurement,
      start: measurement.start ? [...measurement.start] as [number, number, number] : undefined,
      end: measurement.end ? [...measurement.end] as [number, number, number] : undefined,
      delta: measurement.delta ? [...measurement.delta] as [number, number, number] : undefined,
      previewPoint: measurement.previewPoint ? [...measurement.previewPoint] as [number, number, number] : undefined,
      previewDelta: measurement.previewDelta ? [...measurement.previewDelta] as [number, number, number] : undefined,
      previewDistance: measurement.previewDistance
    };
  }

  const section = (state as unknown as { section?: Model3dSectionInfo }).section;
  if (section) {
    (cloned as unknown as { section: Model3dSectionInfo }).section = {
      ...section,
      bounds: section.bounds
        ? {
            x: [...section.bounds.x] as [number, number],
            y: [...section.bounds.y] as [number, number],
            z: [...section.bounds.z] as [number, number]
          }
        : undefined,
      range: section.range
        ? {
            x: [...section.range.x] as [number, number],
            y: [...section.range.y] as [number, number],
            z: [...section.range.z] as [number, number]
          }
        : undefined
    };
  }

  const camera = (state as unknown as { camera?: Model3dPreviewStateWithExplode['camera'] }).camera;
  if (camera) {
    (cloned as unknown as { camera: Model3dPreviewStateWithExplode['camera'] }).camera = {
      ...camera,
      position: [...camera.position] as [number, number, number],
      target: [...camera.target] as [number, number, number]
    };
  }

  return cloned;
}

async function recreatePreviewer(): Promise<void> {
  unsubs.splice(0).forEach((unsubscribe) => unsubscribe());
  previewer.value?.destroy();
  previewer.value = null;

  if (!viewerHost.value) {
    return;
  }

  previewer.value = createPreviewer(viewerHost.value, {
    fit: props.fit,
    initialScale: props.initialScale,
    minScale: props.minScale,
    maxScale: props.maxScale,
    fontResolver: props.fontResolver,
    resourceResolver: props.resourceResolver,
    drivers: props.drivers ?? createVueDefaultPreviewDrivers(props.panoramaProcessor),
    routes: props.routes ?? createVueDefaultPreviewRoutes(),
    converter: props.converter
  });

  unsubs.push(
    previewer.value.on('rendered', (state) => {
      syncState(state);
      emit('rendered', state);
    }),
    previewer.value.on('statechange', (state) => {
      syncState(state);
      emit('state-change', state);
    }),
    previewer.value.on('error', (error) => {
      syncState();
      emit('error', error);
    }),
    previewer.value.on('warnings', (warnings) => {
      syncState();
      emit('warnings', warnings);
    })
  );
}

async function loadSource(): Promise<void> {
  if (!previewer.value || props.src == null) {
    return;
  }

  const task = previewer.value.preview(props.src, {
    name: props.name,
    extension: props.extension,
    contentType: props.contentType
  });
  syncState();
  await task;
  syncState();
}

function zoomIn(): void {
  previewer.value?.setScale(scale.value + 0.1);
  syncState();
}

function zoomOut(): void {
  previewer.value?.setScale(scale.value - 0.1);
  syncState();
}

function fitContain(): void {
  previewer.value?.fit('contain');
  syncState();
}

function fitWidth(): void {
  previewer.value?.fit('width');
  syncState();
}

function fitHeight(): void {
  previewer.value?.fit('height');
  syncState();
}

function rotateClockwise(): void {
  previewer.value?.rotate(90);
  syncState();
}

async function toggleFullscreen(): Promise<void> {
  await previewer.value?.fullscreen();
}

function previousPage(): void {
  previewer.value?.prev();
}

function nextPage(): void {
  previewer.value?.next();
}

function goToIndex(index: number): void {
  previewer.value?.goToPage(index);
  syncState();
}

function toggleLayer(layerId: string, event: Event): void {
  const checked = (event.target as HTMLInputElement | null)?.checked;
  previewer.value?.toggleLayer(layerId, checked);
  syncState();
}

function showAllLayers(): void {
  previewer.value?.setActiveLayers(previewLayers.value.map((layer) => layer.id));
  syncState();
}

function hideAllLayers(): void {
  previewer.value?.setActiveLayers([]);
  syncState();
}

function showAllModelNodes(): void {
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  for (const node of model3dTreeRows.value) {
    if (!node.visible) {
      modelPreviewer?.setNodeVisibility?.(node.id, true);
    }
  }
  previewer.value?.selectNode();
  syncState();
}

function selectModelNode(nodeId?: string): void {
  previewer.value?.selectNode(nodeId);
  syncState();
}

function setModelNodeVisibility(nodeId: string, event: Event): void {
  const checked = (event.target as HTMLInputElement | null)?.checked;
  if (typeof checked !== 'boolean') {
    return;
  }
  (previewer.value as Model3dControlsPreviewer | null)?.setNodeVisibility?.(nodeId, checked);
  syncState();
}

function setModelExplode(event: Event): void {
  const value = Number((event.target as HTMLInputElement | null)?.value ?? 0);
  (previewer.value as Model3dControlsPreviewer | null)?.setExplode?.(value / 100);
  syncState();
}

function toggleModelExplode(): void {
  (previewer.value as Model3dControlsPreviewer | null)?.setExplode?.(model3dExplodePercent.value > 0 ? 0 : 1);
  syncState();
}

function refocusSelectedModelNode(): void {
  if (!selectedModelNodeId.value) {
    return;
  }
  previewer.value?.selectNode(selectedModelNodeId.value);
  syncState();
}

function resetModelView(): void {
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  previewer.value?.selectNode();
  previewer.value?.fit('contain');
  modelPreviewer?.setCameraViewPreset?.('isometric');
  modelPreviewer?.setCameraProjection?.('perspective');
  modelPreviewer?.setDisplayMode?.('solid-edge');
  syncState();
}

function toggleModelNodeCollapsed(nodeId: string): void {
  const next = new Set(collapsedModelNodes.value);
  if (next.has(nodeId)) {
    next.delete(nodeId);
  } else {
    next.add(nodeId);
  }
  collapsedModelNodes.value = next;
}

function clearModelTreeSearch(): void {
  model3dTreeQuery.value = '';
}

function toggleActiveMaterial(materialKey?: string): void {
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  modelPreviewer?.setActiveMaterial?.(activeModelMaterialKey.value === materialKey ? undefined : materialKey);
  syncState();
}

function toggleModelMeasurement(): void {
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  modelPreviewer?.setMeasurementActive?.(!isModelMeasurementActive.value);
  syncState();
}

function clearModelMeasurement(): void {
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  modelPreviewer?.clearMeasurement?.();
  syncState();
}

function setModelMeasurementSnapMode(mode: 'surface' | 'vertex'): void {
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  modelPreviewer?.setMeasurementSnapMode?.(mode);
  syncState();
}

function setModelMeasurementAxisLock(axis: 'free' | 'x' | 'y' | 'z'): void {
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  modelPreviewer?.setMeasurementAxisLock?.(axis);
  syncState();
}

function toggleModelSection(): void {
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  modelPreviewer?.setSectionActive?.(!isModelSectionActive.value);
  syncState();
}

function clearModelSection(): void {
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  modelPreviewer?.clearSection?.();
  syncState();
}

function setModelSectionMode(mode: 'single' | 'box'): void {
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  modelPreviewer?.setSectionMode?.(mode);
  syncState();
}

function setModelSectionAxis(axis: 'x' | 'y' | 'z'): void {
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  modelPreviewer?.setSectionAxis?.(axis);
  syncState();
}

function setModelSectionOffset(event: Event): void {
  const value = Number((event.target as HTMLInputElement | null)?.value ?? 0);
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  modelPreviewer?.setSectionOffset?.(value);
  syncState();
}

function setModelSectionRange(axis: 'x' | 'y' | 'z', side: 'min' | 'max', event: Event): void {
  const value = Number((event.target as HTMLInputElement | null)?.value ?? 0);
  const current = model3dSectionRange.value[axis];
  const nextMin = side === 'min' ? value : current[0];
  const nextMax = side === 'max' ? value : current[1];
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  modelPreviewer?.setSectionRange?.(axis, nextMin, nextMax);
  syncState();
}

function setModelProjection(projection: 'perspective' | 'orthographic'): void {
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  modelPreviewer?.setCameraProjection?.(projection);
  syncState();
}

function setModelViewPreset(preset: 'free' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'isometric'): void {
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  modelPreviewer?.setCameraViewPreset?.(preset);
  syncState();
}

function setModelDisplayMode(mode: PreviewDisplayMode): void {
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  modelPreviewer?.setDisplayMode?.(mode);
  syncState();
}

function setModelSnapshotBackground(background: PreviewSnapshotBackground): void {
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  modelPreviewer?.setSnapshotBackground?.(background);
  syncState();
}

function downloadModelSnapshot(): void {
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  modelPreviewer?.downloadSnapshot?.(undefined, model3dSnapshotBackground.value);
}

function onShellKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || !previewer.value || shouldIgnoreShortcut(event)) {
    return;
  }

  if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
    event.preventDefault();
    previousPage();
    return;
  }

  if (event.key === 'ArrowRight' || event.key === 'PageDown') {
    event.preventDefault();
    nextPage();
    return;
  }

  if ((event.key === '+' || event.key === '=') && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    zoomIn();
    return;
  }

  if ((event.key === '-' || event.key === '_') && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    zoomOut();
    return;
  }

  if (event.key === '0') {
    event.preventDefault();
    fitContain();
    return;
  }

  if (event.key.toLowerCase() === 'w') {
    event.preventDefault();
    fitWidth();
    return;
  }

  if (event.key.toLowerCase() === 'h') {
    event.preventDefault();
    fitHeight();
    return;
  }

  if (event.key.toLowerCase() === 'r') {
    event.preventDefault();
    rotateClockwise();
    return;
  }

  if (event.key.toLowerCase() === 'f') {
    event.preventDefault();
    void toggleFullscreen();
    return;
  }

  if (event.key.toLowerCase() === 'g' && canDownloadSnapshot.value) {
    event.preventDefault();
    downloadModelSnapshot();
    return;
  }

  if (event.key.toLowerCase() === 'x' && canExplodeModel.value) {
    event.preventDefault();
    toggleModelExplode();
    return;
  }

  if (event.key.toLowerCase() === 'm' && canMeasureModel.value) {
    event.preventDefault();
    toggleModelMeasurement();
    return;
  }

  if (event.key.toLowerCase() === 's' && canSectionModel.value) {
    event.preventDefault();
    toggleModelSection();
    return;
  }

  if (event.key === '1' && canControlModelDisplay.value) {
    event.preventDefault();
    setModelDisplayMode('shaded');
    return;
  }

  if (event.key === '2' && canControlModelDisplay.value) {
    event.preventDefault();
    setModelDisplayMode('solid-edge');
    return;
  }

  if (event.key === '3' && canControlModelDisplay.value) {
    event.preventDefault();
    setModelDisplayMode('wireframe');
    return;
  }

  if (event.key === '4' && canControlModelDisplay.value) {
    event.preventDefault();
    setModelDisplayMode('xray');
    return;
  }

  if (event.key === 'Escape' && hasModelMeasurement.value) {
    event.preventDefault();
    clearModelMeasurement();
    return;
  }

  if (event.key === 'Escape' && isModelSectionActive.value) {
    event.preventDefault();
    clearModelSection();
  }
}

function shouldIgnoreShortcut(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  return Boolean(target?.closest('input, textarea, select, [contenteditable="true"], button'));
}

function formatCompactNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}

function formatVector(value: [number, number, number]): string {
  return value.map(formatCompactNumber).join(', ');
}

function formatRange(value: [number, number]): string {
  return `${formatCompactNumber(value[0])} .. ${formatCompactNumber(value[1])}`;
}

function measurementStatusLabel(
  measurement: NonNullable<Model3dPreviewStateWithExplode['measurement']>
): string {
  switch (measurement.status) {
    case 'pick-start': return 'Pick start';
    case 'pick-end': return measurement.active ? 'Pick end' : 'Start set';
    case 'complete': return measurement.active ? 'Ready' : 'Measured';
    default: return measurement.active ? 'Pick start' : 'Idle';
  }
}

function measurementSnapLabel(mode: 'surface' | 'vertex'): string {
  return mode === 'vertex' ? 'Vertex' : 'Surface';
}

function measurementAxisLabel(axis: 'free' | 'x' | 'y' | 'z'): string {
  switch (axis) {
    case 'x': return 'X';
    case 'y': return 'Y';
    case 'z': return 'Z';
    default: return 'Free';
  }
}

function displayModeLabel(mode: PreviewDisplayMode): string {
  switch (mode) {
    case 'shaded': return 'Shaded';
    case 'wireframe': return 'Wireframe';
    case 'xray': return 'X-Ray';
    default: return 'Solid + edge';
  }
}

function snapshotBackgroundLabel(background: PreviewSnapshotBackground): string {
  switch (background) {
    case 'white': return 'White';
    case 'transparent': return 'Transparent';
    default: return 'Scene';
  }
}

function materialDetailRows(material: PreviewMaterialInfo): Array<{ label: string; value: string }> {
  return [
    ...(material.name ? [{ label: 'Name', value: material.name }] : []),
    { label: 'Type', value: material.type },
    ...(material.color ? [{ label: 'Color', value: material.color }] : []),
    ...(material.emissiveColor ? [{ label: 'Emissive', value: material.emissiveColor }] : []),
    ...(typeof material.opacity === 'number' ? [{ label: 'Opacity', value: formatCompactNumber(material.opacity) }] : []),
    ...(typeof material.alphaTest === 'number' ? [{ label: 'Alpha test', value: formatCompactNumber(material.alphaTest) }] : []),
    ...(typeof material.transparent === 'boolean' ? [{ label: 'Transparent', value: material.transparent ? 'Yes' : 'No' }] : []),
    ...(typeof material.wireframe === 'boolean' ? [{ label: 'Wireframe', value: material.wireframe ? 'Yes' : 'No' }] : []),
    ...(typeof material.vertexColors === 'boolean' ? [{ label: 'Vertex colors', value: material.vertexColors ? 'Yes' : 'No' }] : []),
    ...(typeof material.flatShading === 'boolean' ? [{ label: 'Flat shading', value: material.flatShading ? 'Yes' : 'No' }] : []),
    ...(typeof material.depthWrite === 'boolean' ? [{ label: 'Depth write', value: material.depthWrite ? 'Yes' : 'No' }] : []),
    ...(typeof material.depthTest === 'boolean' ? [{ label: 'Depth test', value: material.depthTest ? 'Yes' : 'No' }] : []),
    ...(material.side ? [{ label: 'Side', value: material.side }] : []),
    ...(typeof material.roughness === 'number' ? [{ label: 'Roughness', value: formatCompactNumber(material.roughness) }] : []),
    ...(typeof material.metalness === 'number' ? [{ label: 'Metalness', value: formatCompactNumber(material.metalness) }] : []),
    ...(typeof material.shininess === 'number' ? [{ label: 'Shininess', value: formatCompactNumber(material.shininess) }] : []),
    ...(typeof material.size === 'number' ? [{ label: 'Size', value: formatCompactNumber(material.size) }] : []),
    ...(material.mapKinds?.length ? [{ label: 'Maps', value: material.mapKinds.join(', ') }] : [])
  ];
}

function materialColorSwatches(material: PreviewMaterialInfo): Array<{ label: string; color: string }> {
  return [
    ...(material.color ? [{ label: 'Base', color: material.color }] : []),
    ...(material.emissiveColor ? [{ label: 'Emissive', color: material.emissiveColor }] : [])
  ];
}

function materialActionLabel(material: PreviewMaterialInfo): string {
  return activeModelMaterialKey.value === material.key ? 'Clear isolate' : 'Isolate';
}

function modelNodeKindLabel(kind: Model3dPreviewNode['kind']): string {
  switch (kind) {
    case 'mesh': return 'M';
    case 'lines': return 'L';
    case 'points': return 'P';
    case 'group': return 'G';
    case 'bone': return 'B';
    case 'light': return 'Lt';
    case 'camera': return 'C';
    default: return 'O';
  }
}

function findModelNode(nodes: Model3dPreviewNode[], nodeId: string): Model3dPreviewNode | undefined {
  for (const node of nodes) {
    if (node.id === nodeId) {
      return node;
    }
    const found = findModelNode(node.children, nodeId);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function summarizeModelNode(node: Model3dPreviewNode): {
  nodes: number;
  groups: number;
  meshes: number;
  lines: number;
  points: number;
} {
  const own = {
    nodes: 1,
    groups: node.kind === 'group' ? 1 : 0,
    meshes: node.kind === 'mesh' ? 1 : 0,
    lines: node.kind === 'lines' ? 1 : 0,
    points: node.kind === 'points' ? 1 : 0
  };
  for (const child of node.children) {
    const nested = summarizeModelNode(child);
    own.nodes += nested.nodes;
    own.groups += nested.groups;
    own.meshes += nested.meshes;
    own.lines += nested.lines;
    own.points += nested.points;
  }
  return own;
}

function flattenModelTree(
  nodes: Model3dPreviewNode[],
  collapsedNodeIds: Set<string>,
  depth = 0
): Array<Model3dPreviewNode & { depth: number; collapsed: boolean }> {
  return nodes.flatMap((node) => [
    {
      ...node,
      depth,
      collapsed: collapsedNodeIds.has(node.id)
    },
    ...(collapsedNodeIds.has(node.id) ? [] : flattenModelTree(node.children, collapsedNodeIds, depth + 1))
  ]);
}

function filterModelTree(nodes: Model3dPreviewNode[], query: string): Model3dPreviewNode[] {
  return nodes.flatMap((node) => {
    if (modelTreeNodeSearchText(node).includes(query)) {
      return [node];
    }
    const children = filterModelTree(node.children, query);
    return children.length ? [{ ...node, children }] : [];
  });
}

function countModelNodes(nodes: Model3dPreviewNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countModelNodes(node.children), 0);
}

function countMatchingModelNodes(nodes: Model3dPreviewNode[], query: string): number {
  return nodes.reduce((total, node) => (
    total
    + (modelTreeNodeSearchText(node).includes(query) ? 1 : 0)
    + countMatchingModelNodes(node.children, query)
  ), 0);
}

function modelTreeNodeSearchText(node: Model3dPreviewNode): string {
  return normalizeSearchText([
    node.label,
    node.kind,
    node.id,
    ...(node.metadata?.materialNames ?? [])
  ].join(' '));
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

defineExpose({
  goToIndex,
  next: nextPage,
  prev: previousPage,
  fit: (mode?: PreviewFitMode) => {
    previewer.value?.fit(mode);
    syncState();
  },
  setScale: (nextScale: number) => {
    previewer.value?.setScale(nextScale);
    syncState();
  },
  rotate: (degrees?: number) => {
    previewer.value?.rotate(degrees);
    syncState();
  },
  getState: () => previewState.value
});

onMounted(async () => {
  await recreatePreviewer();
  await loadSource();
});

watch(
  () => props.src,
  async () => {
    collapsedModelNodes.value = new Set();
    model3dTreeQuery.value = '';
    await loadSource();
  }
);

watch(
  () => [
    props.fit,
    props.initialScale,
    props.minScale,
    props.maxScale,
    props.drivers,
    props.routes,
    props.converter,
    props.fontResolver,
    props.resourceResolver,
    props.panoramaProcessor
  ],
  async () => {
    collapsedModelNodes.value = new Set();
    model3dTreeQuery.value = '';
    await recreatePreviewer();
    await loadSource();
  }
);

watch(
  () => [props.name, props.extension, props.contentType],
  async () => {
    collapsedModelNodes.value = new Set();
    model3dTreeQuery.value = '';
    await loadSource();
  }
);

onUnmounted(() => {
  unsubs.forEach((unsubscribe) => unsubscribe());
  previewer.value?.destroy();
});

function createVueDefaultPreviewDrivers(panoramaProcessor?: MediaPreviewDriverOptions['panoramaProcessor']): PreviewDriver[] {
  return [
    ...createOfficePreviewDrivers(),
    ...createDesignPreviewDrivers(),
    ...createMediaPreviewDrivers({ panoramaProcessor }),
    createArchivePreviewDriver(),
    ...createTextPreviewDrivers()
  ];
}

</script>

<template>
  <div
    ref="shellRef"
    class="pptxv-shell pptxv-generic-shell"
    tabindex="0"
    role="region"
    :aria-label="`${familyLabel} preview`"
    @keydown="onShellKeydown"
  >
    <div v-if="toolbar" class="pptxv-toolbar">
      <div class="pptxv-toolbar-group">
        <button type="button" class="pptxv-button" :disabled="!canGoPrev" @click="previousPage">Prev</button>
        <button type="button" class="pptxv-button" :disabled="!canGoNext" @click="nextPage">Next</button>
        <span class="pptxv-status">{{ positionLabel }}</span>
        <span class="pptxv-pill" :class="{ 'pptxv-pill--hidden': !warningLabel }">{{ warningLabel || '0 warnings' }}</span>
        <details class="pptxv-layer-menu" :class="{ 'pptxv-layer-menu--hidden': !canControlLayers }">
          <summary class="pptxv-button pptxv-layer-summary">Layers {{ layerLabel }}</summary>
          <div class="pptxv-layer-popover">
            <div class="pptxv-layer-actions">
              <button type="button" class="pptxv-layer-action" @click="showAllLayers">All</button>
              <button type="button" class="pptxv-layer-action" @click="hideAllLayers">None</button>
            </div>
            <label v-for="layer in previewLayers" :key="layer.id" class="pptxv-layer-row">
              <input
                type="checkbox"
                :checked="activeLayerIds.has(layer.id)"
                @change="toggleLayer(layer.id, $event)"
              />
              <span class="pptxv-layer-color" :style="{ backgroundColor: layer.color ?? '#9aa8b8' }" />
              <span class="pptxv-layer-name">{{ layer.name }}</span>
            </label>
          </div>
        </details>
      </div>
      <div class="pptxv-toolbar-group">
        <button type="button" class="pptxv-button" :disabled="!canZoomOut" @click="zoomOut">-</button>
        <span class="pptxv-status">{{ scaleLabel }}</span>
        <button type="button" class="pptxv-button" :disabled="!canZoomIn" @click="zoomIn">+</button>
        <button type="button" class="pptxv-button" :disabled="isLoading || !previewState.capabilities.fit" @click="fitContain">
          Fit
        </button>
        <button type="button" class="pptxv-button" :disabled="isLoading || !previewState.capabilities.fit" @click="fitWidth">
          Width
        </button>
        <button type="button" class="pptxv-button" :disabled="isLoading || !previewState.capabilities.fit" @click="fitHeight">
          Height
        </button>
        <button type="button" class="pptxv-button" :disabled="!canRotate" @click="rotateClockwise">Rotate</button>
        <button
          v-if="canMeasureModel"
          type="button"
          class="pptxv-button"
          :class="{ 'is-active': isModelMeasurementActive }"
          @click="toggleModelMeasurement"
        >
          Measure
        </button>
        <button
          v-if="canMeasureModel"
          type="button"
          class="pptxv-button"
          :disabled="!hasModelMeasurement"
          @click="clearModelMeasurement"
        >
          Clear
        </button>
        <button
          v-if="canSectionModel"
          type="button"
          class="pptxv-button"
          :class="{ 'is-active': isModelSectionActive }"
          @click="toggleModelSection"
        >
          Section
        </button>
        <button
          v-if="canSectionModel"
          type="button"
          class="pptxv-button"
          :disabled="!isModelSectionActive && Math.abs(model3dSectionOffset) < 0.0005"
          @click="clearModelSection"
        >
          Reset cut
        </button>
        <button
          v-if="canControlModelCamera"
          type="button"
          class="pptxv-button"
          :class="{ 'is-active': model3dProjection === 'perspective' }"
          @click="setModelProjection('perspective')"
        >
          Persp
        </button>
        <button
          v-if="canControlModelCamera"
          type="button"
          class="pptxv-button"
          :class="{ 'is-active': model3dProjection === 'orthographic' }"
          @click="setModelProjection('orthographic')"
        >
          Ortho
        </button>
        <button
          v-if="canControlModelDisplay"
          type="button"
          class="pptxv-button"
          :class="{ 'is-active': model3dDisplayMode === 'shaded' }"
          @click="setModelDisplayMode('shaded')"
        >
          Shade
        </button>
        <button
          v-if="canControlModelDisplay"
          type="button"
          class="pptxv-button"
          :class="{ 'is-active': model3dDisplayMode === 'solid-edge' }"
          @click="setModelDisplayMode('solid-edge')"
        >
          Edge
        </button>
        <button
          v-if="canControlModelDisplay"
          type="button"
          class="pptxv-button"
          :class="{ 'is-active': model3dDisplayMode === 'wireframe' }"
          @click="setModelDisplayMode('wireframe')"
        >
          Wire
        </button>
        <button
          v-if="canControlModelDisplay"
          type="button"
          class="pptxv-button"
          :class="{ 'is-active': model3dDisplayMode === 'xray' }"
          @click="setModelDisplayMode('xray')"
        >
          X-Ray
        </button>
        <button
          v-if="canDownloadSnapshot"
          type="button"
          class="pptxv-button"
          @click="downloadModelSnapshot"
        >
          PNG
        </button>
        <button
          v-if="canDownloadSnapshot"
          type="button"
          class="pptxv-button"
          @click="setModelSnapshotBackground(model3dSnapshotBackground === 'scene' ? 'white' : model3dSnapshotBackground === 'white' ? 'transparent' : 'scene')"
        >
          {{ snapshotBackgroundLabel(model3dSnapshotBackground) }}
        </button>
        <button type="button" class="pptxv-button" :disabled="!canFullscreen" @click="toggleFullscreen">Full</button>
      </div>
    </div>

    <div class="pptxv-layout">
      <aside v-if="previewState.family === 'model3d'" class="pptxv-sidebar pptxv-tree-sidebar">
        <div class="pptxv-meta-panel">
          <template v-if="showModel3dTree">
            <div class="pptxv-meta-heading">Model tree</div>
            <div class="pptxv-tree-actions">
              <button type="button" class="pptxv-button pptxv-tree-reset" :disabled="!selectedModelNodeId" @click="selectModelNode(undefined)">
                Show all
              </button>
              <button type="button" class="pptxv-button pptxv-tree-reset" :disabled="!selectedModelNodeId" @click="refocusSelectedModelNode">
                Refocus
              </button>
              <button type="button" class="pptxv-button pptxv-tree-reset" @click="resetModelView">
                Reset view
              </button>
            </div>
            <div class="pptxv-tree-search">
              <input
                v-model.trim="model3dTreeQuery"
                type="search"
                class="pptxv-tree-search-input"
                placeholder="Search nodes, kinds, materials"
              />
              <button
                type="button"
                class="pptxv-button pptxv-tree-search-clear"
                :disabled="!hasModel3dTreeQuery"
                @click="clearModelTreeSearch"
              >
                Clear
              </button>
            </div>
            <div class="pptxv-tree-search-status">{{ model3dTreeSearchLabel }}</div>
            <div v-if="canExplodeModel" class="pptxv-tree-explode">
              <span class="pptxv-tree-explode-label">Explode</span>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                class="pptxv-tree-explode-slider"
                :value="model3dExplodePercent"
                @input="setModelExplode($event)"
              />
              <button type="button" class="pptxv-button pptxv-tree-explode-value" @click="toggleModelExplode">
                {{ model3dExplodePercent }}%
              </button>
            </div>
            <div v-if="selectedModelNodeRow" class="pptxv-tree-summary">
              <span>{{ selectedModelNodeRow.label }}</span>
              <strong>{{ selectedModelNodeRow.children.length }} child{{ selectedModelNodeRow.children.length === 1 ? '' : 'ren' }}</strong>
            </div>
            <div v-if="canControlModelCamera" class="pptxv-measurement-controls">
              <div class="pptxv-measurement-group">
                <span class="pptxv-measurement-label">View</span>
                <div class="pptxv-measurement-buttons">
                  <button type="button" class="pptxv-button" :class="{ 'is-active': model3dViewPreset === 'isometric' }" @click="setModelViewPreset('isometric')">Iso</button>
                  <button type="button" class="pptxv-button" :class="{ 'is-active': model3dViewPreset === 'front' }" @click="setModelViewPreset('front')">Front</button>
                  <button type="button" class="pptxv-button" :class="{ 'is-active': model3dViewPreset === 'back' }" @click="setModelViewPreset('back')">Back</button>
                  <button type="button" class="pptxv-button" :class="{ 'is-active': model3dViewPreset === 'left' }" @click="setModelViewPreset('left')">Left</button>
                  <button type="button" class="pptxv-button" :class="{ 'is-active': model3dViewPreset === 'right' }" @click="setModelViewPreset('right')">Right</button>
                  <button type="button" class="pptxv-button" :class="{ 'is-active': model3dViewPreset === 'top' }" @click="setModelViewPreset('top')">Top</button>
                  <button type="button" class="pptxv-button" :class="{ 'is-active': model3dViewPreset === 'bottom' }" @click="setModelViewPreset('bottom')">Bottom</button>
                </div>
              </div>
              <div v-if="canControlModelDisplay" class="pptxv-measurement-group">
                <span class="pptxv-measurement-label">Display</span>
                <div class="pptxv-measurement-buttons">
                  <button type="button" class="pptxv-button" :class="{ 'is-active': model3dDisplayMode === 'shaded' }" @click="setModelDisplayMode('shaded')">Shaded</button>
                  <button type="button" class="pptxv-button" :class="{ 'is-active': model3dDisplayMode === 'solid-edge' }" @click="setModelDisplayMode('solid-edge')">Solid+Edge</button>
                  <button type="button" class="pptxv-button" :class="{ 'is-active': model3dDisplayMode === 'wireframe' }" @click="setModelDisplayMode('wireframe')">Wireframe</button>
                  <button type="button" class="pptxv-button" :class="{ 'is-active': model3dDisplayMode === 'xray' }" @click="setModelDisplayMode('xray')">X-Ray</button>
                </div>
              </div>
            </div>
            <dl v-if="selectedModelNodeSummary.length" class="pptxv-tree-detail-list">
              <div v-for="row in selectedModelNodeSummary" :key="row.label" class="pptxv-tree-detail-row">
                <dt>{{ row.label }}</dt>
                <dd>{{ row.value }}</dd>
              </div>
            </dl>
            <div class="pptxv-tree-list">
              <div
                v-for="node in model3dTreeRows"
                :key="node.id"
                class="pptxv-tree-row"
                :style="{ paddingLeft: `${8 + node.depth * 14}px` }"
              >
                <button
                  v-if="node.children.length"
                  type="button"
                  class="pptxv-tree-toggle"
                  :aria-label="node.collapsed ? 'Expand node' : 'Collapse node'"
                  @click="toggleModelNodeCollapsed(node.id)"
                >
                  {{ node.collapsed ? '+' : '-' }}
                </button>
                <span v-else class="pptxv-tree-spacer" />
                <input
                  type="checkbox"
                  class="pptxv-tree-visibility"
                  :checked="node.visible"
                  :aria-label="node.visible ? 'Hide node' : 'Show node'"
                  @click.stop
                  @change="setModelNodeVisibility(node.id, $event)"
                />
                <button
                  type="button"
                  class="pptxv-tree-button"
                  :class="{ 'is-active': selectedModelNodeId === node.id, 'is-hidden': !node.visible }"
                  @click="selectModelNode(node.id)"
                >
                  <div class="pptxv-tree-topline">
                    <span class="pptxv-tree-badge">{{ modelNodeKindLabel(node.kind) }}</span>
                    <span class="pptxv-tree-label">{{ node.label }}</span>
                    <span v-if="node.children.length" class="pptxv-tree-count">{{ node.children.length }}</span>
                  </div>
                  <span class="pptxv-tree-kind">{{ node.kind }}</span>
                </button>
              </div>
            </div>
            <div v-if="showModel3dTreeEmpty" class="pptxv-tree-empty">
              No nodes matched the current filter.
            </div>
          </template>
          <template v-else>
            <div class="pptxv-meta-heading">Model tree</div>
            <div class="pptxv-meta-muted">{{ isLoading ? 'Loading model...' : 'No model tree available.' }}</div>
          </template>
        </div>
      </aside>
      <aside v-if="previewState.family === 'model3d'" class="pptxv-sidebar pptxv-meta-sidebar">
        <div class="pptxv-meta-panel">
          <div class="pptxv-meta-heading">Model info</div>
          <template v-if="showModel3dMetadata">
            <dl class="pptxv-meta-list">
              <div v-for="row in model3dMetadataRows" :key="row.label" class="pptxv-meta-row">
                <dt>{{ row.label }}</dt>
                <dd>{{ row.value }}</dd>
              </div>
            </dl>
          </template>
          <template v-else>
            <div class="pptxv-meta-muted">{{ isLoading ? 'Loading model...' : 'No model metadata available.' }}</div>
          </template>
          <div v-if="model3dMaterialDetails.length" class="pptxv-meta-heading pptxv-meta-heading-split">
            <span>{{ model3dMaterialHeading }}</span>
            <div class="pptxv-meta-heading-actions">
              <button
                v-if="activeModelMaterialKey"
                type="button"
                class="pptxv-button pptxv-material-clear"
                @click="toggleActiveMaterial(undefined)"
              >
                Clear isolate
              </button>
              <span class="pptxv-meta-count">{{ model3dMaterialCountLabel }}</span>
            </div>
          </div>
          <div v-if="model3dMaterialDetails.length" class="pptxv-material-list">
            <section
              v-for="material in model3dMaterialDetails"
              :key="material.key"
              class="pptxv-material-card"
              :class="{ 'is-active': activeModelMaterialKey === material.key }"
            >
              <div class="pptxv-material-title">
                <div class="pptxv-material-title-copy">
                  <strong>{{ material.name || material.type }}</strong>
                  <span>{{ material.type }}</span>
                </div>
                <div v-if="materialColorSwatches(material).length" class="pptxv-material-swatches">
                  <span
                    v-for="swatch in materialColorSwatches(material)"
                    :key="swatch.label"
                    class="pptxv-material-swatch"
                    :title="`${swatch.label}: ${swatch.color}`"
                    :style="{ backgroundColor: swatch.color }"
                  />
                </div>
              </div>
              <div class="pptxv-material-actions">
                <button
                  type="button"
                  class="pptxv-button pptxv-material-action"
                  @click="toggleActiveMaterial(material.key)"
                >
                  {{ materialActionLabel(material) }}
                </button>
              </div>
              <dl class="pptxv-material-detail-list">
                <div
                  v-for="row in materialDetailRows(material)"
                  :key="row.label"
                  class="pptxv-material-detail-row"
                >
                  <dt>{{ row.label }}</dt>
                  <dd>{{ row.value }}</dd>
                </div>
              </dl>
            </section>
          </div>
          <div v-if="canMeasureModel" class="pptxv-meta-heading">Measurement</div>
          <div v-if="canControlModelDisplay" class="pptxv-meta-heading">Display</div>
          <dl v-if="canControlModelDisplay" class="pptxv-meta-list">
            <div class="pptxv-meta-row">
              <dt>Mode</dt>
              <dd>{{ displayModeLabel(model3dDisplayMode) }}</dd>
            </div>
            <div class="pptxv-meta-row">
              <dt>Snapshot bg</dt>
              <dd>{{ snapshotBackgroundLabel(model3dSnapshotBackground) }}</dd>
            </div>
          </dl>
          <div v-if="canDownloadSnapshot" class="pptxv-measurement-controls">
            <div class="pptxv-measurement-group">
              <span class="pptxv-measurement-label">Snapshot</span>
              <div class="pptxv-measurement-buttons">
                <button
                  type="button"
                  class="pptxv-button"
                  :class="{ 'is-active': model3dSnapshotBackground === 'scene' }"
                  @click="setModelSnapshotBackground('scene')"
                >
                  Scene
                </button>
                <button
                  type="button"
                  class="pptxv-button"
                  :class="{ 'is-active': model3dSnapshotBackground === 'white' }"
                  @click="setModelSnapshotBackground('white')"
                >
                  White
                </button>
                <button
                  type="button"
                  class="pptxv-button"
                  :class="{ 'is-active': model3dSnapshotBackground === 'transparent' }"
                  @click="setModelSnapshotBackground('transparent')"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
          <div v-if="canMeasureModel" class="pptxv-measurement-controls">
            <div class="pptxv-measurement-group">
              <span class="pptxv-measurement-label">Snap</span>
              <div class="pptxv-measurement-buttons">
                <button
                  type="button"
                  class="pptxv-button"
                  :class="{ 'is-active': model3dMeasurementSnapMode === 'surface' }"
                  @click="setModelMeasurementSnapMode('surface')"
                >
                  Surface
                </button>
                <button
                  type="button"
                  class="pptxv-button"
                  :class="{ 'is-active': model3dMeasurementSnapMode === 'vertex' }"
                  @click="setModelMeasurementSnapMode('vertex')"
                >
                  Vertex
                </button>
              </div>
            </div>
            <div class="pptxv-measurement-group">
              <span class="pptxv-measurement-label">Axis</span>
              <div class="pptxv-measurement-buttons">
                <button
                  type="button"
                  class="pptxv-button"
                  :class="{ 'is-active': model3dMeasurementAxisLock === 'free' }"
                  @click="setModelMeasurementAxisLock('free')"
                >
                  Free
                </button>
                <button
                  type="button"
                  class="pptxv-button"
                  :class="{ 'is-active': model3dMeasurementAxisLock === 'x' }"
                  @click="setModelMeasurementAxisLock('x')"
                >
                  X
                </button>
                <button
                  type="button"
                  class="pptxv-button"
                  :class="{ 'is-active': model3dMeasurementAxisLock === 'y' }"
                  @click="setModelMeasurementAxisLock('y')"
                >
                  Y
                </button>
                <button
                  type="button"
                  class="pptxv-button"
                  :class="{ 'is-active': model3dMeasurementAxisLock === 'z' }"
                  @click="setModelMeasurementAxisLock('z')"
                >
                  Z
                </button>
              </div>
            </div>
          </div>
          <dl v-if="canMeasureModel" class="pptxv-meta-list">
            <div v-for="row in model3dMeasurementRows" :key="row.label" class="pptxv-meta-row">
              <dt>{{ row.label }}</dt>
              <dd>{{ row.value }}</dd>
            </div>
          </dl>
          <div v-if="canSectionModel" class="pptxv-meta-heading">Section</div>
          <div v-if="canSectionModel" class="pptxv-measurement-controls">
            <div class="pptxv-measurement-group">
              <span class="pptxv-measurement-label">Mode</span>
              <div class="pptxv-measurement-buttons">
                <button
                  type="button"
                  class="pptxv-button"
                  :class="{ 'is-active': model3dSectionMode === 'single' }"
                  @click="setModelSectionMode('single')"
                >
                  Plane
                </button>
                <button
                  type="button"
                  class="pptxv-button"
                  :class="{ 'is-active': model3dSectionMode === 'box' }"
                  @click="setModelSectionMode('box')"
                >
                  Box
                </button>
              </div>
            </div>
            <div class="pptxv-measurement-group">
              <span class="pptxv-measurement-label">Axis</span>
              <div class="pptxv-measurement-buttons">
                <button
                  type="button"
                  class="pptxv-button"
                  :class="{ 'is-active': model3dSectionAxis === 'x' }"
                  @click="setModelSectionAxis('x')"
                >
                  X
                </button>
                <button
                  type="button"
                  class="pptxv-button"
                  :class="{ 'is-active': model3dSectionAxis === 'y' }"
                  @click="setModelSectionAxis('y')"
                >
                  Y
                </button>
                <button
                  type="button"
                  class="pptxv-button"
                  :class="{ 'is-active': model3dSectionAxis === 'z' }"
                  @click="setModelSectionAxis('z')"
                >
                  Z
                </button>
              </div>
            </div>
            <div v-if="model3dSectionMode === 'single'" class="pptxv-measurement-group">
              <div class="pptxv-section-header">
                <span class="pptxv-measurement-label">Offset</span>
                <strong class="pptxv-section-value">{{ formatCompactNumber(model3dSectionOffset) }}</strong>
              </div>
              <input
                type="range"
                class="pptxv-section-slider"
                :min="model3dSectionMin"
                :max="model3dSectionMax"
                :step="model3dSectionStep"
                :value="model3dSectionOffset"
                @input="setModelSectionOffset($event)"
              />
              <div class="pptxv-section-range">
                <span>{{ formatCompactNumber(model3dSectionMin) }}</span>
                <span>{{ formatCompactNumber(model3dSectionMax) }}</span>
              </div>
            </div>
            <div v-else class="pptxv-section-box">
              <div v-for="axis in ['x', 'y', 'z']" :key="axis" class="pptxv-measurement-group">
                <div class="pptxv-section-header">
                  <span class="pptxv-measurement-label">Box {{ axis.toUpperCase() }}</span>
                  <strong class="pptxv-section-value">
                    {{ formatRange(model3dSectionRange[axis as 'x' | 'y' | 'z']) }}
                  </strong>
                </div>
                <input
                  type="range"
                  class="pptxv-section-slider"
                  :min="model3dSectionBounds[axis as 'x' | 'y' | 'z'][0]"
                  :max="model3dSectionBounds[axis as 'x' | 'y' | 'z'][1]"
                  :step="Math.max((model3dSectionBounds[axis as 'x' | 'y' | 'z'][1] - model3dSectionBounds[axis as 'x' | 'y' | 'z'][0]) / 200, 0.001)"
                  :value="model3dSectionRange[axis as 'x' | 'y' | 'z'][0]"
                  @input="setModelSectionRange(axis as 'x' | 'y' | 'z', 'min', $event)"
                />
                <input
                  type="range"
                  class="pptxv-section-slider"
                  :min="model3dSectionBounds[axis as 'x' | 'y' | 'z'][0]"
                  :max="model3dSectionBounds[axis as 'x' | 'y' | 'z'][1]"
                  :step="Math.max((model3dSectionBounds[axis as 'x' | 'y' | 'z'][1] - model3dSectionBounds[axis as 'x' | 'y' | 'z'][0]) / 200, 0.001)"
                  :value="model3dSectionRange[axis as 'x' | 'y' | 'z'][1]"
                  @input="setModelSectionRange(axis as 'x' | 'y' | 'z', 'max', $event)"
                />
                <div class="pptxv-section-range">
                  <span>{{ formatCompactNumber(model3dSectionBounds[axis as 'x' | 'y' | 'z'][0]) }}</span>
                  <span>{{ formatCompactNumber(model3dSectionBounds[axis as 'x' | 'y' | 'z'][1]) }}</span>
                </div>
              </div>
            </div>
          </div>
          <dl v-if="canSectionModel" class="pptxv-meta-list">
            <div v-for="row in model3dSectionRows" :key="row.label" class="pptxv-meta-row">
              <dt>{{ row.label }}</dt>
              <dd>{{ row.value }}</dd>
            </div>
          </dl>
        </div>
      </aside>
      <div class="pptxv-main">
        <div class="pptxv-main-stage">
          <div ref="viewerHost" class="pptxv-main-view" />
          <div v-if="isLoading" class="pptxv-overlay">Loading preview...</div>
          <div v-else-if="errorMessage" class="pptxv-overlay is-error">{{ errorMessage }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
