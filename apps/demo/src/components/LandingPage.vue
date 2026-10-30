<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import FileFormatIcon from './FileFormatIcon.vue';
import FileStory from './FileStory.vue';
import demoMedia from '../home-media.json';
import './landing.css';

defineProps<{ uploadAccept: string }>();
const emit = defineEmits<{ preview: [extension?: string]; upload: [event: Event]; agent: [] }>();
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
const landing = ref<HTMLElement>();
let revealObserver: IntersectionObserver | undefined;
const revealAnimations = new Set<Animation>();
const t = (zh: string, en: string) => (isEnglish.value ? en : zh);
const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;
const demoAsset = (file: string) => `${asset(`home/${file}`)}?v=${demoMedia.version}`;
const repo = 'https://github.com/IceWhaleTech/filens';
const supportMatrixUrl = computed(
  () => `${repo}/blob/main/docs/support-matrix${isEnglish.value ? '' : '.zh-CN'}.md`
);
const zimaosUrl = computed(() => `https://www.zimaspace.com/${isEnglish.value ? 'en' : 'zh'}/zimaos`);
const zimaosHighlights = [
  {
    zh: '文件统一管理', en: 'Files in one place',
    descriptionZh: '集中访问硬盘、USB、网盘与网络共享，方便预览和分享。',
    descriptionEn: 'Manage drives, USB storage, cloud drives, and network shares, with previews and sharing.'
  },
  {
    zh: '照片体验丰富', en: 'More ways to view photos',
    descriptionZh: '浏览 RAW、Live Photos 与 360° 全景，轻松查看拍摄原片。',
    descriptionEn: 'Explore camera originals, from RAW and Live Photos to 360° panoramas.'
  },
  {
    zh: '数据自己掌握', en: 'Your data, on your device',
    descriptionZh: '文件存放在自己的设备上，通过加密远程访问随时取用。',
    descriptionEn: 'Keep files on your own device and reach them through encrypted remote access.'
  },
  {
    zh: '存储与备份省心', en: 'Storage and backup made easy',
    descriptionZh: '可视化磁盘管理、多种 RAID 配置，以及跨设备备份与同步。',
    descriptionEn: 'Visual disk management, flexible RAID options, and backup and sync across devices.'
  },
  {
    zh: '应用扩展简单', en: 'Apps in a click',
    descriptionZh: '800+ 应用、一键安装，支持 Docker，搭建自己的影音与应用服务。',
    descriptionEn: 'Install 800+ apps in a click, with Docker support for your own media and services.'
  }
];
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
    file: 'filens-aurora-guide.docx'
  },
  {
    zh: '表格',
    en: 'Sheets',
    format: 'XLSX',
    icon: 'X',
    color: '#328460',
    image: 'spreadsheet.webp',
    sample: 'xlsx',
    file: 'filens-observatory.xlsx'
  },
  {
    zh: 'PDF',
    en: 'PDF',
    format: 'PDF',
    icon: 'PDF',
    color: '#b96d60',
    image: 'pdf.webp',
    sample: 'pdf',
    file: 'filens-cosmic-atlas.pdf'
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
    zh: '3D',
    en: '3D',
    format: 'OBJ',
    icon: '3D',
    color: '#8572b6',
    image: 'model.webp',
    sample: 'obj',
    file: 'viking-helmet.obj'
  },
  {
    zh: '全景',
    en: '360°',
    format: '360°',
    icon: '360',
    color: '#ba8850',
    image: 'panorama.webp',
    sample: 'pano',
    file: 'milky-way-360.pano'
  },
  {
    zh: '视频',
    en: 'Video',
    format: 'MP4',
    icon: 'VID',
    color: '#647fba',
    image: 'video.webp',
    sample: 'mp4',
    file: 'sample-video.mp4'
  },
  {
    zh: '音乐',
    en: 'Music',
    format: 'WAV',
    icon: '♫',
    color: '#a66f58',
    image: 'music.webp',
    sample: 'wav',
    file: 'tone.wav'
  }
];
const selectedPreview = computed(() => previews[activePreview.value]!);
const formatFamilies = [
  {
    zh: 'STEP 实体', en: 'STEP solids', icon: 'CAD', color: '#9173b8',
    descriptionZh: '打开 CAD 实体，旋转查看曲面细节。',
    descriptionEn: 'Open CAD solids and orbit around curved surfaces.',
    formats: 'STEP · STP', sample: 'step'
  },
  {
    zh: '相机 RAW', en: 'Camera RAW', icon: 'RAW', color: '#b28644',
    descriptionZh: '快速查看原片，提供轻量预览。',
    descriptionEn: 'A lightweight preview of your camera originals.',
    formats: 'DNG · CR2 · CR3 · NEF · ORF', sample: 'dng'
  },
  {
    zh: 'PPM 图片', en: 'PPM images', icon: 'IMG', color: '#6d9560',
    descriptionZh: '查看文本或二进制编码的 RGB 图片。',
    descriptionEn: 'View text or binary RGB images, including 16-bit input.',
    formats: 'PPM · P3 / P6 · 8 / 16-bit', sample: 'ppm'
  },
  {
    zh: '传统 Office / WPS', en: 'Legacy Office / WPS', icon: 'W', color: '#4277c6',
    descriptionZh: '在本地转换后预览，保真度因文件而异。',
    descriptionEn: 'Convert locally for preview; fidelity varies by file.',
    formats: 'DOC · XLS · PPT · WPS · ET · DPS', sample: 'doc'
  },
  {
    zh: '常规图片', en: 'Images', icon: 'IMG', color: '#b28644',
    descriptionZh: '照片、透明图片与动图。',
    descriptionEn: 'Photos, transparent images, and animation.',
    formats: 'JPG · PNG · GIF · WebP · AVIF', sample: 'jpg'
  },
  {
    zh: '视频', en: 'Video', icon: 'VID', color: '#647fba',
    descriptionZh: '打开视频，直接播放。',
    descriptionEn: 'Open a video and press play.',
    formats: 'MP4 · WebM · MOV', sample: 'mp4'
  },
  {
    zh: '全景视频', en: '360° video', icon: '360', color: '#a47b45',
    descriptionZh: '边播放边环顾，部分相机原片可实时拼接。',
    descriptionEn: 'Look around during playback; stitch supported camera originals in real time.',
    formats: '360V · VR360 · INSV · OSV', sample: '360v'
  },
  {
    zh: '实况照片', en: 'Live photos', icon: 'LIVE', color: '#ae6a8c',
    descriptionZh: 'iPhone 实况播放，Android 静态预览。',
    descriptionEn: 'iPhone sample playback and Android stills.',
    formats: 'Live Photo · Motion Photo', sample: 'apple-live-photo'
  },
  {
    zh: '压缩包', en: 'Archives', icon: 'ZIP', color: '#a48646',
    descriptionZh: '浏览目录，查看包内文件。',
    descriptionEn: 'Browse folders and preview files inside.',
    formats: 'ZIP · TAR · TGZ · GZIP', sample: 'zip'
  },
  {
    zh: '3D 模型', en: '3D models', icon: '3D', color: '#8572b6',
    descriptionZh: '旋转、缩放，换个角度看细节。',
    descriptionEn: 'Orbit, zoom, and explore the details.',
    formats: 'GLB · glTF · OBJ · STL · 3MF', sample: 'obj'
  },
  {
    zh: '思维导图', en: 'Mind maps', icon: 'MAP', color: '#6d9560',
    descriptionZh: '展开想法，梳理每一层关系。',
    descriptionEn: 'Follow ideas and explore their connections.',
    formats: 'XMind · MM · OPML · MMAP', sample: 'mm'
  },
  {
    zh: '代码与配置', en: 'Code & config', icon: '</>', color: '#597f9a',
    descriptionZh: '查看源码、配置与行号。',
    descriptionEn: 'Read source and configuration with line numbers.',
    formats: 'TS · JS · Python · JSON · YAML', sample: 'ts'
  },
  {
    zh: '电子书', en: 'Ebooks', icon: 'BOOK', color: '#9b7958',
    descriptionZh: '阅读章节，翻看漫画。',
    descriptionEn: 'Read chapters and browse comic pages.',
    formats: 'EPUB · CBZ', sample: 'epub'
  },
  {
    zh: '音频', en: 'Audio', icon: '♫', color: '#a66f58',
    descriptionZh: '封面、音乐与同步歌词，一起播放。',
    descriptionEn: 'Music with cover art and synchronized lyrics.',
    formats: 'MP3 · WAV · FLAC · OGG', sample: 'wav'
  },
  {
    zh: 'PDF', en: 'PDF', icon: 'PDF', color: '#b96d60',
    descriptionZh: '报告、画册，逐页查看。',
    descriptionEn: 'Explore reports and visual atlases page by page.',
    formats: 'PDF', sample: 'pdf'
  },
  {
    zh: '流程图', en: 'Diagrams', icon: 'FLOW', color: '#618e8d',
    descriptionZh: '查看流程、架构与连接关系。',
    descriptionEn: 'Explore flows, structures, and connections.',
    formats: 'DRAWIO · VSDX · VDX', sample: 'drawio'
  }
];
function applyLocale(): void {
  document.documentElement.lang = isEnglish.value ? 'en' : 'zh-CN';
  document.title = t('探微 · 文件的精彩，打开就看见', 'filens · Files shine bright. Dreams take flight.');
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute(
      'content',
      t(
        '探微（filens）在浏览器中预览 Office、iWork、PDF、CAD / STEP、3D、RAW 和全景，本地文件无需上传。按需加载，WASM 转换支持浏览器内运行及 CLI / HTTP 服务调用。',
        'Preview Office, iWork, PDF, CAD / STEP, 3D, RAW, and panoramas in your browser. Local files stay on your device. Modules load on demand; WASM conversion runs in the browser or through CLI / HTTP tools.'
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
onMounted(() => {
  applyLocale();
  if (!('IntersectionObserver' in window)) return;
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  revealObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      revealObserver?.unobserve(entry.target);
      if (motionPreference.matches || !('animate' in entry.target)) continue;
      const animation = entry.target.animate(
        [{ opacity: 0.35, transform: 'translateY(20px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 700, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' }
      );
      revealAnimations.add(animation);
      void animation.finished.then(() => revealAnimations.delete(animation), () => revealAnimations.delete(animation));
    }
  }, { threshold: 0.12 });
  landing.value?.querySelectorAll('.chapter-heading, .hero-stage, .principle, .formats-heading, .zimaos-section, .demo-copy, .demo-media, .closing-section').forEach(
    (element) => revealObserver?.observe(element)
  );
});
onUnmounted(() => {
  revealObserver?.disconnect();
  for (const animation of revealAnimations) animation.cancel();
  revealAnimations.clear();
});

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
  <div ref="landing" class="landing" :class="{ 'is-english': isEnglish }">
    <a class="skip-link" href="#main-content">{{ t('跳到正文', 'Skip to content') }}</a>
    <header class="site-header">
      <a class="brand" :href="asset('')" :aria-label="t('探微首页', 'filens home')">
        <img :src="asset('brand/filens-icon.svg')" alt="" width="38" height="38" />
        <span>{{ t('探微', 'filens') }}<span v-if="isEnglish" class="brand-period">.</span></span>
      </a>
      <nav class="site-nav" :aria-label="t('主导航', 'Main navigation')">
        <a href="#formats">{{ t('预览效果', 'Previews') }}</a>
        <a href="#more-formats">{{ t('常见格式', 'Formats') }}</a>
        <a href="#demo">{{ t('视频演示', 'Watch demo') }}</a>
      </nav>
      <div class="nav-actions">
        <a class="landing-agent-link" :href="`${asset('')}?view=agent`" @click.prevent="emit('agent')">Agent</a>
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
        <FileStory :is-english="isEnglish" />
        <p class="hero-kicker">{{ t('一个镜头，看见文件的更多可能', 'A LITTLE LENS. A WORLD OF POSSIBILITIES.') }}</p>
        <h1 id="hero-title">
          <template v-if="!isEnglish">文件的精彩，<br /><span>打开就看见。</span></template
          ><template v-else>Files shine bright.<br /><span>Dreams take flight.</span></template>
        </h1>
        <p class="hero-description">
          {{
            t(
              '文档里的想法，照片里的远方，模型里的想象。',
              'Ideas in a document. Places in a photo. Possibilities in a model.'
            )
          }}<br />
          {{ t('用探微，在浏览器里打开。本地文件，无需上传。', 'Open them in your browser with filens. Local files stay with you.') }}
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
        <p class="hero-footnote"><span class="live-dot"></span>{{ t('开源 · 浏览器内运行 · 即开即看', 'OPEN SOURCE · IN YOUR BROWSER · READY TO EXPLORE') }}</p>
        <a class="scroll-cue" href="#formats">{{ t('往下，看见更多', 'There’s more below') }}<span aria-hidden="true">↓</span></a>
      </section>

      <section id="formats" class="preview-section section-width" aria-labelledby="preview-title">
        <div class="chapter-heading">
          <p class="eyebrow"><span>01 /</span> {{ t('从文件，到内容', 'FROM FILES TO POSSIBILITIES') }}</p>
          <h2 id="preview-title">{{ t('后缀不同。精彩相同。', 'Different formats. Same curiosity.') }}</h2>
          <p>{{ t('一份提案、一张图纸，或整片星空。选一个文件，看看里面的世界。', 'A pitch deck, a blueprint, or a sky full of stars. Pick a file. See what’s inside.') }}</p>
        </div>
        <div class="hero-stage">
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
              <Transition name="preview-fade" mode="out-in"><img
                :key="selectedPreview.image"
                :src="asset(`home/${selectedPreview.image}`)"
                :alt="
                  t(
                    `${selectedPreview.zh}在探微中的实际预览效果`,
                    `Actual ${selectedPreview.en.toLowerCase()} preview in filens`
                  )
                "
                width="1120"
                height="680"
                fetchpriority="high"
              /></Transition>
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
          href="#more-formats"
        >
          {{ t('探索更多格式', 'Explore more formats') }} <span aria-hidden="true">↓</span>
        </a>
      </section>

      <section class="principles-section section-width" :aria-label="t('项目特点', 'Why filens')">
        <div class="chapter-heading">
          <p class="eyebrow"><span>02 /</span> {{ t('看见，也守护', 'CLOSER TO YOU') }}</p>
          <h2>{{ t('打开文件，不必交出文件。', 'Open your files. Keep them yours.') }}</h2>
          <p>{{ t('本地文件在浏览器里解析和呈现。从打开到看见，都在你的设备上。', 'Your local files are parsed and rendered in your browser. From first click to first look, on your device.') }}</p>
        </div>
        <div class="principle-grid">
          <article class="principle">
            <p class="principle-proof"><strong>0</strong><span>{{ t('本地文件上传', 'local file uploads') }}</span></p>
            <h2>{{ t('纯前端预览', 'Pure frontend preview') }}</h2>
            <p>{{ t('文件在浏览器中解析与渲染，本地预览无需上传，也无需部署转换服务。', 'Parse and render files in the browser. Preview local files without uploads or a conversion server.') }}</p>
          </article>
          <article class="principle">
            <p class="principle-proof"><strong>WASM</strong><span>{{ t('文件转换', 'file conversion') }}</span></p>
            <h2>{{ t('WASM 转换，灵活部署', 'WASM conversion, flexible deployment') }}</h2>
            <p>{{ t('转换模块可在浏览器中直接运行，也可通过 CLI 或 HTTP 服务独立使用。文件解析与转换由 WASM 完成，服务端负责请求和文件管理。', 'Run the conversion module directly in the browser or use it independently through CLI tools or HTTP services. WASM handles file parsing and conversion; the server manages requests and files.') }}</p>
            <a :href="`${repo}/tree/main/examples/go-wazero-converter`" target="_blank" rel="noopener noreferrer">
              {{ t('查看 CLI / HTTP 转换工具', 'Explore CLI / HTTP converters') }} <span aria-hidden="true">↗</span>
            </a>
          </article>
          <article class="principle">
            <p class="principle-proof"><strong>≈<!-- bundle-size:converter-core -->318.3<!-- /bundle-size --><span class="proof-unit"> KiB</span></strong><span>{{ t('文档转换 WASM · Brotli', 'document conversion WASM · Brotli') }}</span></p>
            <h2>{{ t('高性能，极致小巧', 'Fast, tiny, loaded on demand') }}</h2>
            <p>{{ t('按格式分包、按需加载，配合 Worker 解析与页面虚拟化，减少下载与渲染负担。', 'Format-based bundles and lazy loading, with worker parsing and page virtualization to reduce download and rendering work.') }}</p>
            <a :href="`${repo}/blob/main/docs/bundle-sizes.md`" target="_blank" rel="noopener noreferrer">
              {{ t('查看体积实测', 'See measured bundle sizes') }} <span aria-hidden="true">↗</span>
            </a>
          </article>
        </div>
        <p class="principles-note">{{ t('体积为文档转换核心的单个 Brotli 压缩产物；预览界面、共享依赖、图像 / RAW 等其他模块另计。', 'Size refers to the document conversion core’s Brotli artifact. Preview UI, shared dependencies, and other modules such as image / RAW are measured separately.') }}</p>
      </section>

      <section id="more-formats" class="formats-section section-width" aria-labelledby="formats-title">
        <div class="formats-heading">
          <div>
            <p class="eyebrow"><span>03 /</span> {{ t('常见格式', 'MORE TO EXPLORE') }}</p>
            <h2 id="formats-title">{{ t('更多文件，也能打开。', 'More files. More possibilities.') }}</h2>
          </div>
          <p>
            {{ t('从传统文档到相机原片、CAD 实体，选一类，打开真实样例。', 'From legacy documents to camera originals and CAD solids. Pick a category to try a real sample.') }}
          </p>
        </div>
        <ul class="format-family-grid">
          <li v-for="family in formatFamilies" :key="family.sample">
            <button
              class="format-family-card"
              type="button"
              :aria-label="t(`打开${family.zh}样例`, `Open ${family.en.toLowerCase()} sample`)"
              @click="emit('preview', family.sample)"
            >
              <span class="format-family-title">
                <FileFormatIcon :label="family.icon" :color="family.color" small />
                <strong>{{ t(family.zh, family.en) }}</strong>
                <span class="format-family-arrow" aria-hidden="true">↗</span>
              </span>
              <span class="format-family-description">{{ t(family.descriptionZh, family.descriptionEn) }}</span>
              <span class="format-family-extensions">{{ family.formats }}</span>
            </button>
          </li>
        </ul>
        <div class="formats-footer">
          <p>{{ t('RAW 提供轻量预览；相机全景拼接为实验性能力，依赖标定与配套文件。音视频播放取决于浏览器编解码器。', 'RAW uses lightweight previews. Camera panorama stitching is experimental and requires supported calibration and companion files. Media playback depends on browser codecs.') }}</p>
          <a :href="supportMatrixUrl" target="_blank" rel="noopener noreferrer">
            {{ t('查看完整支持矩阵', 'View the full support matrix') }} <span aria-hidden="true">↗</span>
          </a>
        </div>
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
              :key="demoMedia.version"
              ref="video"
              :controls="videoStarted"
              playsinline
              preload="none"
              :poster="demoAsset('demo-poster.webp')"
              :aria-label="
                t(
                  '探微多格式文件预览操作演示，无旁白',
                  'filens multi-format preview walkthrough, no narration'
                )
              "
              @error="videoError = true"
            >
              <source :src="demoAsset('filens-demo.mp4')" type="video/mp4" />
              <track
                kind="captions"
                :src="demoAsset(`demo-${locale}.vtt`)"
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
      <section class="closing-section section-width" aria-labelledby="closing-title">
        <div class="closing-mark" aria-hidden="true">f<span>.</span></div>
        <p class="eyebrow">{{ t('下一段故事，来自你的文件', 'YOUR FILES. YOUR NEXT DISCOVERY.') }}</p>
        <h2 id="closing-title">{{ t('打开，就有新发现。', 'See what opens up.') }}</h2>
        <button class="button button-dark" type="button" @click="emit('preview')">{{ t('进入预览台', 'Open the playground') }} <span aria-hidden="true">↗</span></button>
      </section>

      <section id="zimaos" class="zimaos-section section-width" aria-labelledby="zimaos-title">
        <div class="zimaos-intro">
          <img :src="asset('brand/zimaos-logo.png')" alt="ZimaOS" width="104" height="104" />
          <div class="zimaos-copy">
            <p class="zimaos-eyebrow">ZimaOS × FiLens</p>
            <h2 id="zimaos-title">{{ t('ZimaOS，让个人云更简单。', 'ZimaOS. Your personal cloud, made simple.') }}</h2>
            <p class="zimaos-integration">
              <strong>{{ t('ZimaOS 深度使用了 FiLens 项目', 'ZimaOS is built with deep FiLens integration') }}</strong>{{ t('，将多格式文件预览融入个人云的文件体验，让文档、照片和创作素材在自己的设备上随时可看。', ', bringing multi-format previews to your personal cloud so documents, photos, and creative files are ready to view on your own device.') }}
            </p>
            <p class="zimaos-description">{{ t('面向家庭与个人的 NAS 操作系统，将文件管理、照片浏览、备份和应用服务整合在一个直观的界面中。', 'A NAS operating system for your home and personal use, bringing files, photos, backups, and apps together in one intuitive interface.') }}</p>
          </div>
        </div>
        <ul class="zimaos-highlights">
          <li v-for="highlight in zimaosHighlights" :key="highlight.en">
            <h3>{{ t(highlight.zh, highlight.en) }}</h3>
            <p>{{ t(highlight.descriptionZh, highlight.descriptionEn) }}</p>
          </li>
        </ul>
        <a class="button zimaos-link" :href="zimaosUrl" target="_blank" rel="noopener noreferrer">
          {{ t('了解 ZimaOS', 'Explore ZimaOS') }} <span aria-hidden="true">↗</span>
        </a>
      </section>
    </main>

    <footer class="site-footer section-width">
      <div>
        <a class="brand" :href="asset('')" :aria-label="t('探微首页', 'filens home')"
          ><img :src="asset('brand/filens-icon.svg')" alt="" width="30" height="30" /><span
            >{{ t('探微', 'filens') }}<span v-if="isEnglish" class="brand-period">.</span></span
          ></a
        >
        <p>{{ t('纯前端文件预览。开源、高性能、极致小巧。', 'Pure frontend file previews. Open source, fast, and compact.') }}</p>
      </div>
      <nav :aria-label="t('页脚导航', 'Footer navigation')">
        <a :href="repo" target="_blank" rel="noopener noreferrer">GitHub ↗</a
        ><a :href="supportMatrixUrl" target="_blank" rel="noopener noreferrer">{{
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
            href="https://commons.wikimedia.org/wiki/File:Aurora_Borealis_Norway_2013.jpg"
            target="_blank"
            rel="noopener noreferrer"
            >Carsten / CC BY 2.0</a
          >
          ·
          <a
            href="https://polyhaven.com/a/rogland_clear_night"
            target="_blank"
            rel="noopener noreferrer"
            >Greg Zaal / Poly Haven / CC0</a
          >
          ·
          <a :href="`${repo}/blob/main/apps/demo/public/samples/SOURCES.md`" target="_blank" rel="noopener noreferrer"
            >{{ t('裁剪、淡蓝调色与完整署名', 'Crops, pale-blue grading, and full credits') }}</a
          >
        </p>
      </details>
    </footer>
  </div>
</template>
