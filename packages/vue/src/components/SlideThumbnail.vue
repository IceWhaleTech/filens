<script setup lang="ts">
import { renderSlideToElement, type ParsedPresentation, type SlideModel } from '@filens/core';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

const props = defineProps<{
  slide: SlideModel;
  presentation: ParsedPresentation;
  mediaRegistry: { getUrl(mediaId: string): string } | null;
}>();

const host = ref<HTMLDivElement | null>(null);
const isVisible = ref(false);
const hasRendered = ref(false);
const scale = computed(() => 152 / props.slide.width);
const thumbnailHeight = computed(() => Math.max(props.slide.height * scale.value, 84));
let observer: IntersectionObserver | null = null;

function renderThumbnail(): void {
  if (!host.value || !props.mediaRegistry) {
    return;
  }

  host.value.innerHTML = '';
  const stage = document.createElement('div');
  stage.className = 'pptxv-thumb-stage';
  stage.style.width = `${props.slide.width * scale.value}px`;
  stage.style.height = `${props.slide.height * scale.value}px`;

  const slideElement = renderSlideToElement(props.slide, props.presentation, {
    mediaRegistry: props.mediaRegistry,
    thumbnail: true
  });
  slideElement.style.transform = `scale(${scale.value})`;
  slideElement.style.transformOrigin = 'top left';
  stage.appendChild(slideElement);
  host.value.appendChild(stage);
  hasRendered.value = true;
}

function clearThumbnail(): void {
  if (host.value) {
    host.value.innerHTML = '';
  }
  hasRendered.value = false;
}

function disconnectObserver(): void {
  observer?.disconnect();
  observer = null;
}

function watchVisibility(): void {
  if (!host.value) {
    return;
  }

  disconnectObserver();

  if (typeof IntersectionObserver === 'undefined') {
    isVisible.value = true;
    renderThumbnail();
    return;
  }

  observer = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      isVisible.value = Boolean(entry?.isIntersecting || entry?.intersectionRatio);
      if (isVisible.value && props.mediaRegistry) {
        renderThumbnail();
      }
    },
    {
      rootMargin: '180px 0px'
    }
  );

  observer.observe(host.value);
}

onMounted(watchVisibility);

watch(
  () => [props.slide, props.presentation, props.mediaRegistry],
  () => {
    if (!props.mediaRegistry) {
      clearThumbnail();
      return;
    }

    if (hasRendered.value || isVisible.value || typeof IntersectionObserver === 'undefined') {
      renderThumbnail();
      return;
    }

    watchVisibility();
  }
);

onUnmounted(() => {
  disconnectObserver();
  clearThumbnail();
});
</script>

<template>
  <div
    ref="host"
    class="pptxv-thumb-host"
    :class="{ 'is-placeholder': !hasRendered }"
    :style="{ minHeight: `${thumbnailHeight}px` }"
  />
</template>
