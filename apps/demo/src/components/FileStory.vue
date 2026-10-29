<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

const props = defineProps<{ isEnglish: boolean }>();
const t = (zh: string, en: string) => props.isEnglish ? en : zh;
const asset = (path: string) => `${import.meta.env.BASE_URL}home/${path}`;
const phase = ref<'idle' | 'gathering' | 'revealed'>('idle');
const chapter = ref(0);
const paused = ref(false);
const reducedMotion = ref(false);
const playing = ref(false);
const chapters = [
  { file: 'filens-field-notes.pptx', image: 'presentation.webp', zh: '一份演示，展开一个故事。', en: 'A presentation. A story unfolding.', labelZh: '演示文稿', labelEn: 'Presentation' },
  { file: 'viking-helmet.obj', image: 'model.webp', zh: '一个模型，看见每个角度。', en: 'A model. A different perspective.', labelZh: '三维模型', labelEn: '3D model' },
  { file: 'milky-way-360.pano', image: 'panorama.webp', zh: '一张全景，走进另一个世界。', en: 'A panorama. A world to step into.', labelZh: '全景照片', labelEn: 'Panorama' }
];
const current = computed(() => chapters[chapter.value]!);
const files = ['DOCX', 'RAW', 'PPTX', 'OBJ', 'PANO', 'DXF'];
let timer: ReturnType<typeof setTimeout> | undefined;
let pending: (() => void) | undefined;
let preference: MediaQueryList | undefined;

function clearTimer(): void {
  clearTimeout(timer);
  timer = undefined;
}
function schedule(action: () => void, delay: number): void {
  clearTimer();
  pending = action;
  if (!paused.value) timer = setTimeout(() => {
    pending = undefined;
    action();
  }, delay);
}
function advance(): void {
  if (chapter.value < chapters.length - 1) {
    chapter.value++;
    schedule(advance, 2100);
  } else {
    playing.value = false;
  }
}
function play(): void {
  clearTimer();
  pending = undefined;
  chapter.value = 0;
  paused.value = false;
  if (reducedMotion.value) {
    phase.value = 'revealed';
    playing.value = false;
    return;
  }
  phase.value = 'gathering';
  playing.value = true;
  schedule(() => {
    phase.value = 'revealed';
    schedule(advance, 2100);
  }, 650);
}
function selectChapter(index: number): void {
  clearTimer();
  pending = undefined;
  playing.value = false;
  phase.value = 'revealed';
  chapter.value = index;
}
function togglePause(): void {
  paused.value = !paused.value;
  if (paused.value) clearTimer();
  else if (pending) schedule(pending, 650);
}
function syncPreference(): void {
  reducedMotion.value = preference?.matches ?? false;
  if (reducedMotion.value) {
    clearTimer();
    pending = undefined;
    playing.value = false;
    if (phase.value === 'gathering') phase.value = 'revealed';
  }
}
function onVisibilityChange(): void {
  if (document.hidden && playing.value && !paused.value) togglePause();
}
onMounted(() => {
  preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  syncPreference();
  preference.addEventListener('change', syncPreference);
  document.addEventListener('visibilitychange', onVisibilityChange);
});
onUnmounted(() => {
  clearTimer();
  preference?.removeEventListener('change', syncPreference);
  document.removeEventListener('visibilitychange', onVisibilityChange);
});
</script>

<template>
  <div class="file-story" :data-phase="phase" :class="{ 'is-paused': paused }">
    <div class="story-scene" aria-hidden="true">
      <div class="story-orbit orbit-outer"></div>
      <div class="story-orbit orbit-inner"></div>
      <div class="story-floor"></div>
      <div v-for="(file, index) in files" :key="file" class="orbit-file" :class="`orbit-file-${index}`">
        <svg viewBox="0 0 32 40" fill="none"><path d="M5 1h15l11 11v23a4 4 0 0 1-4 4H5a4 4 0 0 1-4-4V5a4 4 0 0 1 4-4Z"/><path d="M20 1v11h11M8 23h15M8 29h10"/></svg>
        <span>.{{ file.toLowerCase() }}</span>
      </div>
      <div class="story-document">
        <div class="story-document-fold"></div>
        <span class="document-eyebrow">UNTITLED POSSIBILITIES</span>
        <span class="document-lines"><i></i><i></i><i></i></span>
        <span class="document-extension">.file<span>↗</span></span>
      </div>
      <div class="story-lens">
        <div class="lens-rim"><div class="lens-glass"><svg viewBox="0 0 100 100" fill="none"><path d="m50 18 28 16v32L50 82 22 66V34Z"/><path d="m22 34 28 16 28-16M50 50v32M36 26l28 16v32"/></svg></div></div>
        <div class="lens-handle"></div>
      </div>
      <div class="story-result">
        <div class="story-result-bar"><span class="story-result-dot"></span><span>{{ current.file }}</span><span>↗</span></div>
        <Transition name="story-image" mode="out-in"><img :key="current.image" :src="asset(current.image)" alt="" width="1120" height="680" /></Transition>
        <span class="story-result-caption">{{ t(current.labelZh, current.labelEn) }}</span>
      </div>
      <span class="scene-note scene-note-left">MANY FORMATS.</span>
      <span class="scene-note scene-note-right">ONE LENS.</span>
    </div>
    <div class="story-controls">
      <button class="story-trigger" type="button" :disabled="playing" @click="play">
        <svg v-if="phase === 'idle'" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 5 10 7-10 7V5Z"/></svg>
        <svg v-else viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 10a8 8 0 1 1 1 7M4 4v6h6"/></svg>
        {{ playing ? t('故事正在展开', 'The story unfolds') : phase === 'idle' ? t('点击，让文件展开', 'Click to unfold') : t('再看一次', 'Play again') }}
        <span class="trigger-key" aria-hidden="true">↵</span>
      </button>
      <button v-if="playing" class="story-pause" type="button" :aria-label="paused ? t('继续动画', 'Resume animation') : t('暂停动画', 'Pause animation')" @click="togglePause">{{ paused ? '▶' : 'Ⅱ' }}</button>
    </div>
    <div class="story-caption" role="status" aria-live="polite">
      {{ phase === 'revealed' ? t(current.zh, current.en) : t('每个后缀背后，都有值得看见的内容。', 'There’s more to a file than its extension.') }}
    </div>
    <div class="story-chapters" :aria-label="t('选择动画场景', 'Choose a story scene')">
      <button v-for="(item, index) in chapters" :key="item.file" type="button" :aria-label="t(item.labelZh, item.labelEn)" :aria-pressed="phase === 'revealed' && chapter === index" @click="selectChapter(index)"><span></span></button>
    </div>
  </div>
</template>
