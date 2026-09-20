<script setup lang="ts">
import {
  createViewer,
  type FitMode,
  type ParsedPresentation,
  type PptxSource,
  type ViewerInstance,
  type ViewerState
} from '@filens/core';
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import SlideThumbnail from './components/SlideThumbnail.vue';

const props = withDefaults(
  defineProps<{
    src: PptxSource;
    fit?: FitMode;
    initialScale?: number;
    minScale?: number;
    maxScale?: number;
    toolbar?: boolean;
    thumbnails?: boolean;
  }>(),
  {
    fit: 'contain',
    initialScale: 1,
    minScale: 0.4,
    maxScale: 4,
    toolbar: true,
    thumbnails: true
  }
);

const emit = defineEmits<{
  (event: 'rendered', presentation: ParsedPresentation | null): void;
  (event: 'error', error: Error): void;
  (event: 'slide-change', slideIndex: number): void;
  (event: 'scale-change', scale: number): void;
  (event: 'warnings', warnings: string[]): void;
}>();

const viewerHost = ref<HTMLDivElement | null>(null);
const shellRef = ref<HTMLDivElement | null>(null);
const sidebarRef = ref<HTMLElement | null>(null);
const viewer = shallowRef<ViewerInstance | null>(null);
const viewerState = ref<ViewerState>({
  loading: false,
  error: null,
  currentSlide: 0,
  slideCount: 0,
  scale: props.initialScale,
  fit: props.fit,
  warnings: [],
  presentation: null,
  mediaRegistry: null
});

const unsubs: Array<() => void> = [];

const presentation = computed(() => viewerState.value.presentation);
const currentSlide = computed(() => viewerState.value.currentSlide);
const slideCount = computed(() => viewerState.value.slideCount);
const scaleLabel = computed(() => `${Math.round(viewerState.value.scale * 100)}%`);
const isLoading = computed(() => viewerState.value.loading);
const errorMessage = computed(() => viewerState.value.error);
const canGoPrev = computed(() => !isLoading.value && currentSlide.value > 0);
const canGoNext = computed(() => !isLoading.value && currentSlide.value < slideCount.value - 1);
const canZoomOut = computed(() => !isLoading.value && viewerState.value.scale > props.minScale + 0.001);
const canZoomIn = computed(() => !isLoading.value && viewerState.value.scale < props.maxScale - 0.001);
const warningLabel = computed(() =>
  viewerState.value.warnings.length ? `${viewerState.value.warnings.length} warning${viewerState.value.warnings.length > 1 ? 's' : ''}` : ''
);
const thumbnailRefs = new Map<number, HTMLButtonElement>();

function syncState(state?: ViewerState): void {
  viewerState.value = state ?? viewer.value?.getState() ?? viewerState.value;
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

function previousSlide(): void {
  viewer.value?.prev();
}

function nextSlide(): void {
  viewer.value?.next();
}

function goToSlide(index: number): void {
  viewer.value?.goToSlide(index);
}

function setThumbnailRef(index: number, element: unknown): void {
  if (!(element instanceof HTMLButtonElement)) {
    thumbnailRefs.delete(index);
    return;
  }

  thumbnailRefs.set(index, element);
}

function onShellKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || !viewer.value || shouldIgnoreShortcut(event)) {
    return;
  }

  if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
    event.preventDefault();
    previousSlide();
    return;
  }

  if (event.key === 'ArrowRight' || event.key === 'PageDown') {
    event.preventDefault();
    nextSlide();
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

  if (event.key === 'Home') {
    event.preventDefault();
    goToSlide(0);
    return;
  }

  if (event.key === 'End') {
    event.preventDefault();
    goToSlide(Math.max(slideCount.value - 1, 0));
  }
}

function shouldIgnoreShortcut(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) {
    return false;
  }

  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"], button')
  );
}

function onWindowKeydown(event: KeyboardEvent): void {
  const shell = shellRef.value;
  if (!shell) {
    return;
  }

  const activeElement = document.activeElement;
  if (activeElement !== shell && !(activeElement instanceof Node && shell.contains(activeElement))) {
    return;
  }

  onShellKeydown(event);
}

function scrollActiveThumbnailIntoView(index: number): void {
  if (!props.thumbnails) {
    return;
  }

  const element = thumbnailRefs.get(index);
  if (!element) {
    return;
  }

  element.scrollIntoView({
    block: 'nearest',
    inline: 'nearest',
    behavior: getPreferredScrollBehavior()
  });
}

onMounted(async () => {
  if (!viewerHost.value) {
    return;
  }

  window.addEventListener('keydown', onWindowKeydown, true);

  viewer.value = createViewer(viewerHost.value, {
    fit: props.fit,
    initialScale: props.initialScale,
    minScale: props.minScale,
    maxScale: props.maxScale,
    virtual: true
  });

  unsubs.push(
    viewer.value.on('rendered', (state) => {
      syncState(state);
      emit('rendered', state.presentation);
    }),
    viewer.value.on('error', (error) => {
      syncState();
      emit('error', error);
    }),
    viewer.value.on('slidechange', (state) => {
      syncState(state);
      emit('slide-change', state.currentSlide);
    }),
    viewer.value.on('scalechange', (state) => {
      syncState(state);
      emit('scale-change', state.scale);
    }),
    viewer.value.on('warnings', (warnings) => {
      syncState();
      emit('warnings', warnings);
    })
  );

  await loadSource();
});

watch(
  () => props.src,
  async () => {
    await loadSource();
  }
);

watch(
  () => props.fit,
  (fit) => {
    viewer.value?.fit(fit);
    syncState();
  }
);

watch(
  () => viewerState.value.currentSlide,
  async (index) => {
    await nextTick();
    scrollActiveThumbnailIntoView(index);
  }
);

onUnmounted(() => {
  thumbnailRefs.clear();
  unsubs.forEach((unsubscribe) => unsubscribe());
  window.removeEventListener('keydown', onWindowKeydown, true);
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
  <div
    ref="shellRef"
    class="pptxv-shell"
    tabindex="0"
    role="region"
    aria-label="PPTX preview"
    @keydown="onShellKeydown"
  >
    <div v-if="toolbar" class="pptxv-toolbar">
      <div class="pptxv-toolbar-group">
        <button type="button" class="pptxv-button" :disabled="!canGoPrev" @click="previousSlide">Prev</button>
        <button type="button" class="pptxv-button" :disabled="!canGoNext" @click="nextSlide">Next</button>
        <span class="pptxv-status">{{ currentSlide + 1 }} / {{ slideCount || 1 }}</span>
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
      <aside v-if="thumbnails && presentation" ref="sidebarRef" class="pptxv-sidebar">
        <button
          v-for="slide in presentation.slides"
          :key="slide.id"
          type="button"
          class="pptxv-thumb-button"
          :class="{ 'is-active': slide.index === currentSlide }"
          :ref="(element) => setThumbnailRef(slide.index, element)"
          :aria-current="slide.index === currentSlide ? 'true' : undefined"
          :aria-label="`Slide ${slide.index + 1}: ${slide.title || 'Untitled slide'}`"
          @click="goToSlide(slide.index)"
        >
          <SlideThumbnail
            :slide="slide"
            :presentation="presentation"
            :media-registry="viewerState.mediaRegistry"
          />
          <span class="pptxv-thumb-label">{{ slide.index + 1 }}</span>
        </button>
      </aside>
      <div class="pptxv-main">
        <div class="pptxv-main-stage">
          <div ref="viewerHost" class="pptxv-main-view" />
          <div v-if="isLoading" class="pptxv-overlay">Loading presentation...</div>
          <div v-else-if="errorMessage" class="pptxv-overlay is-error">{{ errorMessage }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
