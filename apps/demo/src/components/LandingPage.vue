<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import FileFormatIcon from './FileFormatIcon.vue';
import './landing.css';

defineProps<{ uploadAccept: string }>();
const emit = defineEmits<{ preview: [extension?: string]; upload: [event: Event] }>();
type Locale = 'zh' | 'en';
const storedLocale = (() => {
  try {
    return localStorage.getItem('filens-locale');
  } catch {
    return null;
  }
})();
const locale = ref<Locale>(
  (new URLSearchParams(location.search).get('lang') ?? storedLocale) === 'en' ? 'en' : 'zh'
);
const isEnglish = computed(() => locale.value === 'en');
const t = (zh: string, en: string) => (isEnglish.value ? en : zh);
const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;
const repo = 'https://github.com/IceWhaleTech/filens';
const activePreview = ref(0);
const video = ref<HTMLVideoElement>();
const videoStarted = ref(false);
const videoError = ref(false);
const previews = [
  {
    zh: '演示',
    en: 'Slides',
    format: 'PPTX',
    icon: 'P',
    color: '#db6946',
    image: 'presentation.webp',
    sample: 'showcase',
    file: 'filens-field-notes.pptx'
  },
  {
    zh: '文档',
    en: 'Docs',
    format: 'DOCX',
    icon: 'W',
    color: '#4277c6',
    image: 'document.webp',
    sample: 'docx',
    file: 'generated.docx'
  },
  {
    zh: '表格',
    en: 'Sheets',
    format: 'XLSX',
    icon: 'X',
    color: '#328460',
    image: 'spreadsheet.webp',
    sample: 'xlsx',
    file: 'generated.xlsx'
  },
  {
    zh: 'iWork',
    en: 'iWork',
    format: 'KEY',
    icon: 'K',
    color: '#478dca',
    image: 'iwork.webp',
    sample: 'key',
    file: 'filens-weekend.key'
  },
  {
    zh: 'CAD',
    en: 'CAD',
    format: 'DXF',
    icon: 'CAD',
    color: '#9173b8',
    image: 'cad.webp',
    sample: 'dxf',
    file: 'filens-cafe.dxf'
  },
  {
    zh: '全景',
    en: '360°',
    format: '360°',
    icon: '360',
    color: '#ba8850',
    image: 'panorama.webp',
    sample: 'pano',
    file: 'kochelsee-16k.pano'
  }
];
const selectedPreview = computed(() => previews[activePreview.value]!);
function applyLocale(): void {
  document.documentElement.lang = isEnglish.value ? 'en' : 'zh-CN';
  document.title = t('filens · 文件的精彩，打开就看见', 'filens · Every file has a story. Open it.');
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute(
      'content',
      t(
        '从 Office、iWork 到全景照片、CAD 和 3D 模型，在浏览器里轻松预览文件。本地优先，开源，为你的应用而生。',
        'From Office and iWork to panoramas, CAD, and 3D models. Preview your files in the browser with filens. Local-first, open source, and ready for your app.'
      )
    );
}
function toggleLocale(): void {
  locale.value = isEnglish.value ? 'zh' : 'en';
  try {
    localStorage.setItem('filens-locale', locale.value);
  } catch {
    /* Storage is optional. */
  }
  const url = new URL(location.href);
  url.searchParams.set('lang', locale.value);
  history.replaceState({}, '', url);
}
watch(locale, applyLocale);
onMounted(applyLocale);

function onTabKey(event: KeyboardEvent): void {
  const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
  if (!direction && event.key !== 'Home' && event.key !== 'End') return;
  event.preventDefault();
  activePreview.value =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? previews.length - 1
        : (activePreview.value + direction + previews.length) % previews.length;
  void nextTick(() => document.getElementById(`preview-tab-${activePreview.value}`)?.focus());
}
async function playDemo(): Promise<void> {
  videoStarted.value = true;
  await nextTick();
  try {
    await video.value?.play();
  } catch {
    /* Native controls remain available if autoplay is blocked. */
  }
}
</script>

<template>
  <div class="landing" :class="{ 'is-english': isEnglish }">
    <a class="skip-link" href="#main-content">{{ t('跳到正文', 'Skip to content') }}</a>
    <header class="site-header">
      <a class="brand" :href="asset('')" aria-label="filens home">
        <img :src="asset('brand/filens-icon.svg')" alt="" width="38" height="38" />
        <span>filens<span class="brand-period">.</span></span>
      </a>
      <nav class="site-nav" :aria-label="t('主导航', 'Main navigation')">
        <a href="#formats">{{ t('预览效果', 'Previews') }}</a>
        <a href="#demo">{{ t('视频演示', 'Watch demo') }}</a>
      </nav>
      <div class="nav-actions">
        <button
          class="language-toggle"
          type="button"
          :aria-label="t('Switch to English', '切换到中文')"
          @click="toggleLocale"
        >
          <span aria-hidden="true">◎</span> {{ t('EN', '中文') }}
        </button>
        <a class="github-link" :href="repo" target="_blank" rel="noopener noreferrer" aria-label="GitHub"
          ><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path
              d="M12 .8a11.2 11.2 0 0 0-3.54 21.83c.56.1.77-.24.77-.54v-2.1c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.15 1.72 1.15 1 1.71 2.62 1.22 3.26.93.1-.73.39-1.22.71-1.5-2.5-.29-5.13-1.25-5.13-5.54 0-1.22.44-2.22 1.15-3-.11-.29-.5-1.43.11-2.97 0 0 .94-.3 3.08 1.15a10.7 10.7 0 0 1 5.6 0c2.14-1.45 3.08-1.15 3.08-1.15.61 1.54.22 2.68.1 2.97.72.78 1.16 1.78 1.16 3 0 4.3-2.64 5.25-5.15 5.53.4.35.76 1.03.76 2.08v3.08c0 .3.2.65.78.54A11.2 11.2 0 0 0 12 .8Z"
            /></svg
        ></a>
        <button class="button button-dark button-small" type="button" @click="emit('preview')">
          {{ t('开始体验', 'Try filens') }} <span aria-hidden="true">↗</span>
        </button>
      </div>
    </header>

    <main id="main-content">
      <section class="hero section-width" :aria-labelledby="'hero-title'">
        <h1 id="hero-title">
          <template v-if="!isEnglish">文件的精彩，<br /><span>打开就看见。</span></template
          ><template v-else>Every file has a story.<br /><span>Open it.</span></template>
        </h1>
        <p class="hero-description">
          {{
            t(
              '在浏览器中预览文档、图片与专业文件。',
              'Documents, images, and specialist formats. Right in your browser.'
            )
          }}<br />
          {{ t('本地文件，无需上传。', 'Your local files stay on your device.') }}
        </p>
        <div class="hero-actions">
          <label class="button button-dark upload-button"
            ><span aria-hidden="true">＋</span> {{ t('打开我的文件', 'Open your file')
            }}<input
              type="file"
              :accept="uploadAccept"
              multiple
              class="sr-only"
              :aria-label="t('选择本地文件', 'Choose a local file')"
              @change="emit('upload', $event)"
          /></label>
          <button class="button button-outline" type="button" @click="emit('preview', 'showcase')">
            {{ t('先试试示例', 'Try a sample') }} <span aria-hidden="true">↗</span>
          </button>
        </div>
        <div id="formats" class="hero-stage">
          <div class="preview-window">
            <div class="preview-window-bar">
              <span class="window-dots" aria-hidden="true"><i></i><i></i><i></i></span
              ><span>{{ selectedPreview.file }}</span
              ><span class="local-badge"
                ><span class="live-dot"></span> {{ t('本地预览', 'LOCAL PREVIEW') }}</span
              >
            </div>
            <div
              id="preview-panel"
              role="tabpanel"
              :aria-labelledby="`preview-tab-${activePreview}`"
              class="hero-preview-panel"
            >
              <img
                :src="asset(`home/${selectedPreview.image}`)"
                :alt="
                  t(
                    `${selectedPreview.zh}在 filens 中的实际预览效果`,
                    `Actual ${selectedPreview.en.toLowerCase()} preview in filens`
                  )
                "
                width="1120"
                height="680"
                fetchpriority="high"
              />
              <button class="preview-open" type="button" @click="emit('preview', selectedPreview.sample)">
                {{ t('亲自打开看看', 'Explore this file') }} <span aria-hidden="true">↗</span>
              </button>
            </div>
          </div>
        </div>
        <div
          class="preview-tabs"
          role="tablist"
          :aria-label="t('切换预览效果', 'Choose a preview')"
          @keydown="onTabKey"
        >
          <button
            v-for="(preview, index) in previews"
            :id="`preview-tab-${index}`"
            :key="preview.format"
            type="button"
            role="tab"
            :aria-selected="activePreview === index"
            aria-controls="preview-panel"
            :tabindex="activePreview === index ? 0 : -1"
            :class="{ 'is-active': activePreview === index }"
            @click="activePreview = index"
          >
            <FileFormatIcon :label="preview.icon" :color="preview.color" small />
            {{ t(preview.zh, preview.en) }}
          </button>
        </div>
        <a
          class="support-link"
          :href="`${repo}/blob/main/docs/support-matrix.md`"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ t('更多格式与兼容性', 'More formats and compatibility') }} <span aria-hidden="true">→</span>
        </a>
      </section>

      <section id="demo" class="demo-section section-width">
        <div class="demo-copy">
          <p class="eyebrow">{{ t('产品演示', 'A QUICK LOOK') }}</p>
          <h2>{{ t('半分钟，看见更多。', 'See it in action.') }}</h2>
          <p>
            {{ t('从文档到全景，一段真实操作。', 'From documents to panoramas. A short, real walkthrough.') }}
          </p>
          <a
            class="text-link"
            :href="`${repo}/tree/main/packages/vue`"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ t('集成到你的应用', 'Add filens to your app') }} <span aria-hidden="true">↗</span>
          </a>
        </div>
        <div class="demo-media">
          <div class="demo-player">
            <video
              ref="video"
              :controls="videoStarted"
              playsinline
              preload="none"
              :poster="asset('home/demo-poster.webp')"
              :aria-label="
                t(
                  'filens 多格式文件预览操作演示，无旁白',
                  'filens multi-format preview walkthrough, no narration'
                )
              "
              @error="videoError = true"
            >
              <source :src="asset('home/filens-demo.mp4')" type="video/mp4" />
              <track
                kind="captions"
                :src="asset(`home/demo-${locale}.vtt`)"
                :srclang="locale === 'zh' ? 'zh-CN' : 'en'"
                :label="t('中文', 'English')"
                default
              /></video
            ><button v-if="!videoStarted" class="demo-play-overlay" type="button" @click="playDemo">
              <span class="big-play" aria-hidden="true">▶</span
              ><strong>{{ t('播放产品演示', 'Play the walkthrough') }}</strong>
            </button>
          </div>
          <p v-if="videoError" class="video-fallback">
            {{
              t(
                '视频暂时无法播放，可以直接进入预览台体验。',
                'The video is unavailable. Explore the live playground instead.'
              )
            }}
            <button type="button" @click="emit('preview', 'showcase')">
              {{ t('打开预览台', 'Open playground') }} ↗
            </button>
          </p>
        </div>
      </section>
    </main>

    <footer class="site-footer section-width">
      <div>
        <a class="brand" :href="asset('')"
          ><img :src="asset('brand/filens-icon.svg')" alt="" width="30" height="30" /><span
            >filens<span class="brand-period">.</span></span
          ></a
        >
        <p>{{ t('开源的文件预览工具。', 'An open-source file viewer.') }}</p>
      </div>
      <nav :aria-label="t('页脚导航', 'Footer navigation')">
        <a :href="repo" target="_blank" rel="noopener noreferrer">GitHub ↗</a
        ><a :href="`${repo}/blob/main/docs/support-matrix.md`" target="_blank" rel="noopener noreferrer">{{
          t('格式支持', 'Format support')
        }}</a
        ><a :href="`${repo}/tree/main/packages/vue`" target="_blank" rel="noopener noreferrer">{{
          t('开发文档', 'Documentation')
        }}</a
        ><button type="button" @click="toggleLocale">{{ t('English', '简体中文') }}</button>
      </nav>
      <details class="image-credits">
        <summary>{{ t('图片鸣谢', 'Image credits') }}</summary>
        <p>
          <a
            href="https://unsplash.com/photos/brown-wooden-house-near-lake-and-mountain-pR5uo2ED_hg"
            target="_blank"
            rel="noopener noreferrer"
            >Ricardo Gomez Angel / Unsplash</a
          >
          ·
          <a
            href="https://commons.wikimedia.org/wiki/File:Kochelsee_Panorama.jpg"
            target="_blank"
            rel="noopener noreferrer"
            >SimonWaldherr</a
          >
          /
          <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer"
            >CC BY-SA 4.0</a
          >
        </p>
      </details>
    </footer>
  </div>
</template>
