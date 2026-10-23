<script setup lang="ts">
withDefaults(defineProps<{ label: string; color?: string; small?: boolean }>(), {
  color: '#377b59',
  small: false
});
</script>

<template>
  <svg class="format-icon" :class="{ 'is-small': small }" viewBox="0 0 64 72" fill="none" aria-hidden="true">
    <path
      d="M15 3h26l14 14v47a5 5 0 0 1-5 5H15a5 5 0 0 1-5-5V8a5 5 0 0 1 5-5Z"
      :fill="color"
      fill-opacity=".12"
    />
    <path d="M41 3v10a4 4 0 0 0 4 4h10" :fill="color" fill-opacity=".25" />
    <path
      d="M23 29h18M23 36h18M23 43h11"
      :stroke="color"
      stroke-opacity=".4"
      stroke-width="2.5"
      stroke-linecap="round"
    />
    <rect x="2" y="35" width="42" height="30" rx="7" :fill="color" />
    <text
      x="23"
      y="55"
      fill="white"
      text-anchor="middle"
      font-family="Arial, sans-serif"
      :font-size="label.length > 3 ? 10 : label.length > 1 ? 12 : 21"
      font-weight="700"
    >
      {{ label }}
    </text>
  </svg>
</template>

<style scoped>
.format-icon {
  display: block;
  width: 58px;
  height: 66px;
  flex: 0 0 auto;
}
.format-icon.is-small {
  width: 39px;
  height: 44px;
}
</style>
