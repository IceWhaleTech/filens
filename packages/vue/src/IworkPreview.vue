<script setup lang="ts">
import { MediaRegistry, type ParsedPresentation } from '@filens/core';
import {
  createIworkViewer,
  type IworkFitMode,
  type IworkSource,
  type IworkTypeHint,
  type IworkViewerInstance,
  type IworkViewerState,
  type ParsedIworkDocument
} from '@filens/iwork';
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import SlideThumbnail from './components/SlideThumbnail.vue';

const props = withDefaults(
  defineProps<{
    src: IworkSource;
    type?: IworkTypeHint;
    fit?: IworkFitMode;
    initialScale?: number;
    minScale?: number;
    maxScale?: number;
    toolbar?: boolean;
    thumbnails?: boolean;
  }>(),
  {
    type: 'auto',
    initialScale: 1,
    minScale: 0.4,
    maxScale: 4,
    toolbar: true,
    thumbnails: true
  }
);

const emit = defineEmits<{
  (event: 'rendered', document: ParsedIworkDocument | null): void;
  (event: 'error', error: Error): void;
  (event: 'warnings', warnings: string[]): void;
  (event: 'page-change', pageIndex: number): void;
  (event: 'sheet-change', sheetIndex: number): void;
  (event: 'scale-change', scale: number): void;
}>();

const viewerHost = ref<HTMLDivElement | null>(null);
const shellRef = ref<HTMLDivElement | null>(null);
const viewer = shallowRef<IworkViewerInstance | null>(null);
const thumbnailRegistry = shallowRef<MediaRegistry | null>(null);
const viewerState = ref<IworkViewerState>({
  loading: false,
  error: null,
  kind: null,
  currentPage: 0,
  pageCount: 0,
  currentSheet: 0,
  sheetCount: 0,
  scale: props.initialScale,
  fit: props.fit ?? 'contain',
  warnings: [],
  document: null
});

const unsubs: Array<() => void> = [];
const thumbnailRefs = new Map<number, HTMLButtonElement>();

const documentModel = computed(() => viewerState.value.document);
const isLoading = computed(() => viewerState.value.loading);
const errorMessage = computed(() => viewerState.value.error);
const scaleLabel = computed(() => `${Math.round(viewerState.value.scale * 100)}%`);
const warningLabel = computed(() =>
  viewerState.value.warnings.length ? `${viewerState.value.warnings.length} warning${viewerState.value.warnings.length > 1 ? 's' : ''}` : ''
);
const canvasList = computed(() => {
  const document = documentModel.value;
  if (!document) {
    return [];
  }
  if (document.kind === 'key') {
    return document.slides;
  }
  if (document.kind === 'pages') {
    return document.pages.map((page) => page.canvas);
  }
  return document.sheets.map((sheet) => sheet.canvas);
});
const currentIndex = computed(() => (viewerState.value.kind === 'numbers' ? viewerState.value.currentSheet : viewerState.value.currentPage));
const activeCount = computed(() => (viewerState.value.kind === 'numbers' ? viewerState.value.sheetCount : viewerState.value.pageCount));
const canGoPrev = computed(() => !isLoading.value && currentIndex.value > 0);
const canGoNext = computed(() => !isLoading.value && currentIndex.value < activeCount.value - 1);
const canZoomOut = computed(() => !isLoading.value && viewerState.value.scale > props.minScale + 0.001);
const canZoomIn = computed(() => !isLoading.value && viewerState.value.scale < props.maxScale - 0.001);
const showSidebar = computed(() => props.thumbnails && documentModel.value != null && viewerState.value.kind !== 'numbers');
const thumbnailPresentation = computed<ParsedPresentation | null>(() => {
  const document = documentModel.value;
  if (!document) {
    return null;
  }
  if (document.kind === 'key') {
    return document.presentation;
  }
  return {
    size: {
      width: 1,
      height: 1
    },
    theme: {
      colors: {},
      fonts: {}
    },
    slides: canvasList.value.map((canvas) => canvas.slide),
    media: document.media,
    warnings: document.warnings.slice()
  };
});

function syncState(state?: IworkViewerState): void {
  viewerState.value = state ?? viewer.value?.getState() ?? viewerState.value;
}

async function recreateViewer(): Promise<void> {
  thumbnailRefs.clear();
  unsubs.splice(0).forEach((unsubscribe) => unsubscribe());
  viewer.value?.destroy();
  viewer.value = null;
  if (!viewerHost.value) {
    return;
  }

  viewer.value = createIworkViewer(viewerHost.value, {
    type: props.type,
    fit: props.fit,
    initialScale: props.initialScale,
    minScale: props.minScale,
    maxScale: props.maxScale
  });

  unsubs.push(
    viewer.value.on('rendered', (state) => {
      syncState(state);
      emit('rendered', state.document);
    }),
    viewer.value.on('error', (error) => {
      syncState();
      emit('error', error);
    }),
    viewer.value.on('warnings', (warnings) => {
      syncState();
      emit('warnings', warnings);
    }),
    viewer.value.on('pagechange', (state) => {
      syncState(state);
      emit('page-change', state.currentPage);
    }),
    viewer.value.on('sheetchange', (state) => {
      syncState(state);
      emit('sheet-change', state.currentSheet);
    }),
    viewer.value.on('scalechange', (state) => {
      syncState(state);
      emit('scale-change', state.scale);
    })
  );
}

async function loadSource(): Promise<void> {
  if (!viewer.value || props.src == null) {
    return;
  }
  const previewTask = viewer.value.preview(props.src);
  syncState();
  await previewTask;
  syncState();
}

function zoomIn(): void {
  if (!viewer.value) {
    return;
  }
  viewer.value.setScale(viewerState.value.scale + 0.1);
  syncState();
}

function zoomOut(): void {
  if (!viewer.value) {
    return;
  }
  viewer.value.setScale(viewerState.value.scale - 0.1);
  syncState();
}

function fitContain(): void {
  viewer.value?.fit('contain');
  syncState();
}

function fitWidth(): void {
  viewer.value?.fit('width');
  syncState();
}

function previous(): void {
  viewer.value?.prev();
}

function next(): void {
  viewer.value?.next();
}

function goToPage(index: number): void {
  viewer.value?.goToPage(index);
}

function goToSheet(index: number): void {
  viewer.value?.goToSheet(index);
}

function setThumbnailRef(index: number, element: unknown): void {
  if (!(element instanceof HTMLButtonElement)) {
    thumbnailRefs.delete(index);
    return;
  }
  thumbnailRefs.set(index, element);
}

function scrollActiveThumbnailIntoView(index: number): void {
  if (!showSidebar.value) {
    return;
  }

  const button = thumbnailRefs.get(index);
  if (!button) {
    return;
  }

  button.scrollIntoView({
    block: 'nearest',
    inline: 'nearest',
    behavior: getPreferredScrollBehavior()
  });
}

function refreshThumbnailRegistry(document: ParsedIworkDocument | null): void {
  thumbnailRegistry.value?.destroy();
  thumbnailRegistry.value = null;
  if (!document || !thumbnailPresentation.value) {
    return;
  }
  thumbnailRegistry.value = new MediaRegistry(thumbnailPresentation.value);
}

onMounted(async () => {
  await recreateViewer();
  await loadSource();
});

watch(
  () => props.src,
  async () => {
    await loadSource();
  }
);

watch(
  () => [props.type, props.fit],
  async () => {
    await recreateViewer();
    await loadSource();
  }
);

watch(
  () => documentModel.value,
  (document) => {
    refreshThumbnailRegistry(document);
  },
  {
    immediate: true
  }
);

watch(
  () => currentIndex.value,
  async (index) => {
    await nextTick();
    scrollActiveThumbnailIntoView(index);
  }
);

onUnmounted(() => {
  thumbnailRefs.clear();
  thumbnailRegistry.value?.destroy();
  unsubs.forEach((unsubscribe) => unsubscribe());
  viewer.value?.destroy();
});

function getPreferredScrollBehavior(): ScrollBehavior {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'smooth';
  }

  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}
</script>

<template>
  <div ref="shellRef" class="pptxv-shell" tabindex="0" role="region" aria-label="iWork preview">
    <div v-if="toolbar" class="pptxv-toolbar">
      <div class="pptxv-toolbar-group">
        <button type="button" class="pptxv-button" :disabled="!canGoPrev" @click="previous">Prev</button>
        <button type="button" class="pptxv-button" :disabled="!canGoNext" @click="next">Next</button>
        <span class="pptxv-status">{{ currentIndex + 1 }} / {{ activeCount || 1 }}</span>
        <span v-if="warningLabel" class="pptxv-pill">{{ warningLabel }}</span>
      </div>
      <div class="pptxv-toolbar-group">
        <button type="button" class="pptxv-button" :disabled="!canZoomOut" @click="zoomOut">-</button>
        <span class="pptxv-status">{{ scaleLabel }}</span>
        <button type="button" class="pptxv-button" :disabled="!canZoomIn" @click="zoomIn">+</button>
        <button type="button" class="pptxv-button" :disabled="isLoading" @click="fitContain">Fit</button>
        <button type="button" class="pptxv-button" :disabled="isLoading" @click="fitWidth">Width</button>
      </div>
    </div>

    <div class="pptxv-layout">
      <aside v-if="showSidebar && thumbnailPresentation" class="pptxv-sidebar">
        <button
          v-for="canvas in canvasList"
          :key="canvas.id"
          type="button"
          class="pptxv-thumb-button"
          :class="{ 'is-active': canvas.slide.index === currentIndex }"
          :ref="(element) => setThumbnailRef(canvas.slide.index, element)"
          :aria-current="canvas.slide.index === currentIndex ? 'true' : undefined"
          :aria-label="`${viewerState.kind === 'pages' ? 'Page' : 'Slide'} ${canvas.slide.index + 1}: ${canvas.title}`"
          @click="goToPage(canvas.slide.index)"
        >
          <SlideThumbnail
            :slide="canvas.slide"
            :presentation="thumbnailPresentation"
            :media-registry="thumbnailRegistry"
          />
          <span class="pptxv-thumb-label">{{ canvas.slide.index + 1 }}</span>
        </button>
      </aside>

      <div class="pptxv-main">
        <div class="pptxv-main-stage">
          <div ref="viewerHost" class="pptxv-main-view" />
          <div v-if="isLoading" class="pptxv-overlay">Loading document...</div>
          <div v-else-if="errorMessage" class="pptxv-overlay is-error">{{ errorMessage }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
