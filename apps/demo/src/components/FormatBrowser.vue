<script setup lang="ts">
import { computed, ref } from 'vue';
import WorkbenchIcon from './WorkbenchIcon.vue';
import type { WorkbenchFamilyId, WorkbenchFormat, WorkbenchFormatFamily } from './workbench';

const props = defineProps<{
  families: WorkbenchFormatFamily[];
  selectedFamily: WorkbenchFamilyId;
  activeExtension: string;
  sampleExtensions: ReadonlySet<string>;
}>();
const emit = defineEmits<{
  family: [id: WorkbenchFamilyId];
  sample: [extension: string];
}>();
const search = ref('');
const query = computed(() => search.value.trim().toLowerCase().replace(/^\./, ''));
const categories = computed(() => props.families
  .filter(family => query.value || family.id === props.selectedFamily)
  .flatMap(family => family.categories.map(category => ({
    ...category,
    key: `${family.id}:${category.id}`,
    formats: category.formats.filter(format => !query.value ||
      `${format.extension} ${format.label} ${category.label} ${family.label}`.toLowerCase().includes(query.value))
  })))
  .filter(category => category.formats.length));
const resultCount = computed(() => categories.value.reduce((count, category) => count + category.formats.length, 0));
const canPreview = (format: WorkbenchFormat) => (format.supported || format.sampleOnly) && props.sampleExtensions.has(format.extension);
function formatHint(format: WorkbenchFormat): string {
  if (format.sampleOnly) return '转换后 SVG 展示示例；暂不支持直接上传原格式';
  if (!format.supported) return '已归类，暂未支持预览';
  return props.sampleExtensions.has(format.extension) ? `预览 ${format.label} 示例` : '支持上传预览，暂无内置示例';
}
function chooseSample(extension: string): void {
  search.value = '';
  emit('sample', extension);
}
</script>

<template>
  <section class="wb-library" aria-label="示例资料库">
    <div class="wb-library-heading">
      <div><p class="wb-eyebrow">EXPLORE FILES</p><h2>示例资料库</h2></div>
      <span class="wb-library-count" title="当前列出的格式数量">{{ resultCount }}</span>
    </div>
    <p class="wb-library-description">选一个格式，看看文件里的世界。</p>
    <div class="wb-search">
      <WorkbenchIcon name="search" />
      <input v-model="search" type="search" aria-label="搜索文件格式" placeholder="搜索格式，如 PDF、3D…" />
      <button v-if="search" type="button" aria-label="清除格式搜索" @click="search = ''"><WorkbenchIcon name="close" /></button>
    </div>
    <nav class="wb-tabs" aria-label="格式分类">
      <button v-for="family in families" :key="family.id" type="button" class="wb-tab"
        :class="{ 'is-active': selectedFamily === family.id && !query }" :aria-pressed="selectedFamily === family.id && !query"
        @click="search = ''; emit('family', family.id)">{{ family.label }}</button>
    </nav>
    <div class="wb-format-list" aria-label="格式列表">
      <p v-if="query" class="wb-search-results" role="status">找到 {{ resultCount }} 种格式</p>
      <div v-for="category in categories" :key="category.key" class="wb-format-category">
        <h3>{{ category.label }} <span>{{ category.formats.length.toString().padStart(2, '0') }}</span></h3>
        <div class="wb-subformats">
          <button v-for="format in category.formats" :key="`${format.family}:${format.extension}`" type="button"
            class="wb-subformat" :class="{ 'is-active': activeExtension === format.extension, 'is-sample-only': format.sampleOnly, 'is-unavailable': !canPreview(format) }"
            :aria-pressed="activeExtension === format.extension" :disabled="!canPreview(format)" :title="formatHint(format)"
            @click="chooseSample(format.extension)">{{ format.label }}</button>
        </div>
      </div>
      <div v-if="!resultCount" class="wb-search-empty"><WorkbenchIcon name="search" /><strong>没有找到这个格式</strong><p>试试扩展名，或换个关键词。</p><button type="button" @click="search = ''">查看全部格式</button></div>
    </div>
    <p class="wb-format-hint"><span></span> 可打开示例 <span class="is-muted"></span> 暂无示例 <span class="is-converted"></span> 转换展示</p>
  </section>
</template>
