<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import FileFormatIcon from './FileFormatIcon.vue';
import FormatBrowser from './FormatBrowser.vue';
import WorkbenchIcon from './WorkbenchIcon.vue';
import type { WorkbenchFamilyId, WorkbenchFormatFamily } from './workbench';

const props = defineProps<{
  brandIcon: string;
  name: string;
  label: string;
  extension: string;
  family: string;
  source: string;
  uploadAccept: string;
  families: WorkbenchFormatFamily[];
  selectedFamily: WorkbenchFamilyId;
  sampleExtensions: ReadonlySet<string>;
  timings: Array<{ label: string; value: string }>;
  modelSummary: Array<{ label: string; value: string }>;
  ready: boolean;
  error: string | null;
  warningCount: number;
  hasToolbar: boolean;
}>();
const remoteUrl = defineModel<string>('remoteUrl', { required: true });
const toolbar = defineModel<boolean>('toolbar', { required: true });
const emit = defineEmits<{
  home: [];
  upload: [files: File[]];
  remote: [];
  family: [id: WorkbenchFamilyId];
  sample: [extension: string];
}>();
const libraryOpen = ref(!window.matchMedia('(max-width: 760px)').matches);
const detailsOpen = ref(false);
const linkDialog = ref<HTMLDialogElement>();
const linkButton = ref<HTMLButtonElement>();
const linkInput = ref<HTMLInputElement>();
const dragDepth = ref(0);
const panelId = useId();
const detailId = useId();
const sourceLabel = computed(() => ({ upload: '本地文件', url: '远程文件', generated: '生成示例', sample: '内置示例' })[props.source] ?? props.source);
const extensionLabel = computed(() => props.extension.toUpperCase() || 'FILE');
const fileColor = computed(() => {
  if (['model3d', 'cad', 'diagram', 'mindmap'].includes(props.family)) return '#8570b3';
  if (['image', 'panorama', 'panorama-video', 'audio', 'video'].includes(props.family)) return '#438575';
  if (props.family === 'archive') return '#ab8546';
  if (['text', 'code', 'html', 'ebook'].includes(props.family)) return '#5b7ea7';
  return '#b96949';
});
const status = computed(() => props.error ? '预览失败' : props.ready ? '预览就绪' : '正在打开文件…');
function upload(event: Event): void {
  const input = event.target as HTMLInputElement;
  emit('upload', Array.from(input.files ?? []));
  input.value = '';
}
function isFileDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}
function dragEnter(event: DragEvent): void {
  if (isFileDrag(event)) { event.preventDefault(); dragDepth.value++; }
}
function dragOver(event: DragEvent): void {
  if (isFileDrag(event)) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }
}
function drop(event: DragEvent): void {
  dragDepth.value = 0;
  if (!isFileDrag(event)) return;
  event.preventDefault();
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length) emit('upload', files);
}
function selectSample(extension: string): void {
  emit('sample', extension);
  if (window.matchMedia('(max-width: 760px)').matches) libraryOpen.value = false;
}
function openLink(): void {
  linkDialog.value?.showModal();
  linkInput.value?.focus();
  linkInput.value?.select();
}
function closeLink(): void {
  linkDialog.value?.close();
  linkButton.value?.focus();
}
function openRemote(): void {
  if (!remoteUrl.value.trim()) return;
  remoteUrl.value = remoteUrl.value.trim();
  emit('remote');
  closeLink();
}
</script>

<template>
  <main class="workbench" :class="{ 'is-library-closed': !libraryOpen }" @dragenter="dragEnter" @dragover="dragOver" @dragleave="dragDepth = Math.max(0, dragDepth - 1)" @drop="drop" @keydown.esc="detailsOpen = false">
    <aside v-show="libraryOpen" :id="panelId" class="wb-sidebar" aria-label="格式与预览信息">
      <button class="wb-brand wb-home-link" type="button" aria-label="← 探微首页" @click="emit('home')">
        <img :src="brandIcon" alt="" width="34" height="34" />
        <span>探微<span class="wb-brand-caption">文件里的世界</span></span>
        <WorkbenchIcon name="arrow" />
      </button>
      <FormatBrowser :families="families" :selected-family="selectedFamily" :active-extension="extension" :sample-extensions="sampleExtensions" @family="emit('family', $event)" @sample="selectSample" />
      <div class="wb-privacy"><WorkbenchIcon name="lock" /><div><strong>本地文件，无需上传</strong><p>在你的浏览器里，安心打开。</p></div></div>
    </aside>
    <button v-if="libraryOpen" class="wb-sidebar-scrim" type="button" aria-label="关闭格式面板" @click="libraryOpen = false"></button>

    <div class="wb-main">
      <header class="wb-header">
        <button class="wb-icon-button wb-library-toggle" type="button" :aria-label="libraryOpen ? '收起格式面板' : '展开格式面板'" :aria-expanded="libraryOpen" :aria-controls="panelId" @click="libraryOpen = !libraryOpen"><WorkbenchIcon name="panel" /></button>
        <div class="wb-heading"><p class="wb-eyebrow">WORKSPACE <span>/</span> PREVIEW</p><h1>文件预览台</h1></div>
        <div class="wb-header-actions">
          <button ref="linkButton" class="wb-button wb-link-button" type="button" @click="openLink"><WorkbenchIcon name="link" /><span>通过链接打开</span></button>
          <label class="wb-button wb-upload"><WorkbenchIcon name="upload" /><span>导入文件</span><input class="visually-hidden" type="file" aria-label="导入文件" :accept="uploadAccept" multiple @change="upload" /></label>
        </div>
      </header>

      <div class="wb-body">
        <div class="wb-workspace-label"><span><i></i> {{ sourceLabel }}</span><span class="wb-workspace-hint">让内容，成为主角。</span></div>
        <section class="wb-preview" :aria-label="name + ' 预览'">
          <header class="wb-preview-head">
            <FileFormatIcon :label="extensionLabel.slice(0, 5)" :color="fileColor" small />
            <div class="wb-preview-title"><strong :title="name">{{ name }}</strong><span><span class="wb-file-badge">{{ extensionLabel }}</span><span class="wb-file-label">{{ label }}</span></span></div>
            <div class="wb-preview-actions">
              <button v-if="hasToolbar" type="button" class="wb-button wb-toolbar-toggle" :class="{ 'is-active': toolbar }" :aria-label="toolbar ? '隐藏工具栏' : '显示工具栏'" :aria-expanded="toolbar" aria-controls="wb-preview-content" @click="toolbar = !toolbar"><WorkbenchIcon name="sliders" /><span>工具栏</span></button>
              <button type="button" class="wb-icon-button" :class="{ 'is-active': detailsOpen }" aria-label="文件详情" :aria-expanded="detailsOpen" :aria-controls="detailId" @click="detailsOpen = !detailsOpen"><WorkbenchIcon name="info" /></button>
            </div>
          </header>
          <p v-if="error" class="wb-note is-error" role="alert">{{ error }}</p>
          <div id="wb-preview-content" class="wb-preview-stage"><slot /></div>
          <footer class="wb-preview-footer">
            <span class="wb-status" :class="{ 'is-ready': ready && !error, 'is-error': error }" role="status"><i></i>{{ status }}</span>
            <span v-if="warningCount" class="wb-warning-count">{{ warningCount }} 条提示</span>
            <div v-if="timings.length" class="wb-runtime-timings" aria-label="此次预览耗时"><span v-for="timing in timings" :key="timing.label"><small>{{ timing.label }}</small><strong>{{ timing.value }}</strong></span></div>
          </footer>
        </section>
        <footer class="wb-workspace-footer"><span><WorkbenchIcon name="lock" />浏览器内处理</span><span>也可以将文件拖到这里打开 <span class="wb-drop-key">↵</span></span></footer>

        <aside v-if="detailsOpen" :id="detailId" class="wb-details" aria-label="文件详情">
          <header><h2>文件详情</h2><button class="wb-icon-button" type="button" aria-label="关闭文件详情" @click="detailsOpen = false"><WorkbenchIcon name="close" /></button></header>
          <p class="wb-detail-filename">{{ name }}</p>
          <dl class="wb-file-facts"><div><dt>格式</dt><dd>{{ extensionLabel }}</dd></div><div><dt>来源</dt><dd>{{ sourceLabel }}</dd></div><div><dt>预览驱动</dt><dd>{{ family }}</dd></div></dl>
          <section v-if="modelSummary.length" class="wb-detail-section"><h3>3D 元数据</h3><dl class="wb-file-facts"><div v-for="row in modelSummary" :key="row.label"><dt>{{ row.label }}</dt><dd>{{ row.value }}</dd></div></dl></section>
          <slot name="diagnostics" />
        </aside>
      </div>
    </div>

    <dialog ref="linkDialog" class="wb-link-dialog" aria-labelledby="wb-link-heading" @click="event => { if (event.target === linkDialog) closeLink(); }" @cancel.prevent="closeLink">
      <form class="wb-remote" @submit.prevent="openRemote">
        <header><div class="wb-dialog-icon"><WorkbenchIcon name="link" /></div><button class="wb-icon-button" type="button" aria-label="关闭链接窗口" @click="closeLink"><WorkbenchIcon name="close" /></button></header>
        <h2 id="wb-link-heading">打开一个文件链接</h2><p>粘贴可直接访问的文件地址，即可开始预览。</p>
        <label for="wb-remote-url">文件 URL</label><input id="wb-remote-url" ref="linkInput" v-model="remoteUrl" type="url" class="wb-remote-input" placeholder="https://example.com/document.pdf" required />
        <button type="submit" class="wb-button wb-remote-button">打开预览 <WorkbenchIcon name="chevron" /></button>
      </form>
    </dialog>
    <div v-if="dragDepth > 0" class="wb-drop-overlay"><div><WorkbenchIcon name="upload" /><strong>松开，打开文件</strong><span>多个文件可一同导入，自动关联资源。</span></div></div>
  </main>
</template>

<style src="./workbench.css"></style>
