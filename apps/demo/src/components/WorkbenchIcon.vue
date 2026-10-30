<script setup lang="ts">
defineProps<{ name: 'arrow' | 'search' | 'upload' | 'link' | 'close' | 'panel' | 'sliders' | 'info' | 'lock' | 'check' | 'chevron' | 'terminal' | 'file' | 'scan' | 'copy' | 'download' }>();
const paths = {
  arrow: 'M19 12H5m6-6-6 6 6 6',
  search: 'm21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5',
  link: 'm10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
  close: 'm6 6 12 12M6 18 18 6',
  panel: 'M9 3v18M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1',
  sliders: 'M3 6h18M3 12h18M3 18h18M8 3v6m8 0v6m-8 0v6',
  info: 'M12 11v6m0-10v.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  lock: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5V10m7 4v3',
  check: 'm5 12 4 4L19 6',
  chevron: 'm9 5 7 7-7 7',
  terminal: 'm5 7 5 5-5 5m8 0h6M3 3h18v18H3V3',
  file: 'M14 2H4v20h16V8l-6-6v6h6M8 13h8m-8 4h6',
  scan: 'M3 8V3h5m8 0h5v5m0 8v5h-5m-8 0H3v-5m5-7h8m-8 4h8m-8 4h5',
  copy: 'M8 8h13v13H8V8M16 4V2H2v14h2',
  download: 'M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4'
};
</script>

<template>
  <svg class="wb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path :d="paths[name]" />
  </svg>
</template>

<style scoped>
.wb-icon { display: block; width: 18px; height: 18px; flex: 0 0 auto; }
</style>
