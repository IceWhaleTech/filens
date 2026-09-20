<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps<{
  photoSrc: string;
  videoSrc: string;
  originalPhotoSrc?: string;
  originalVideoSrc?: string;
  title?: string;
}>();

type LivePhotoPlayer = HTMLElement & {
  photoSrc: string;
  videoSrc: string;
  playbackStyle: string;
  proactivelyLoadsVideo: boolean;
  stop?: () => void;
  updateSize?: () => void;
};

type LivePhotosKitApi = {
  PlaybackStyle: { FULL: string };
  augmentElementAsPlayer: (element: HTMLElement, options?: Record<string, unknown>) => LivePhotoPlayer;
};

declare global {
  interface Window {
    LivePhotosKit?: LivePhotosKitApi;
  }
}

const sdkUrl = 'https://cdn.apple-livephotoskit.com/lpk/1/livephotoskit.js';
const host = ref<HTMLElement | null>(null);
const error = ref('');
let player: LivePhotoPlayer | null = null;
let destroyed = false;

onMounted(async () => {
  try {
    const sdk = await loadLivePhotosKit();
    if (destroyed || !host.value) return;
    player = sdk.augmentElementAsPlayer(host.value, {
      photoSrc: props.photoSrc,
      videoSrc: props.videoSrc,
      playbackStyle: sdk.PlaybackStyle.FULL,
      proactivelyLoadsVideo: true
    });
    player.photoSrc = props.photoSrc;
    player.videoSrc = props.videoSrc;
    player.playbackStyle = sdk.PlaybackStyle.FULL;
    player.proactivelyLoadsVideo = true;
    player.updateSize?.();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
});

onBeforeUnmount(() => {
  destroyed = true;
  player?.stop?.();
  player = null;
});

function loadLivePhotosKit(): Promise<LivePhotosKitApi> {
  if (window.LivePhotosKit) return Promise.resolve(window.LivePhotosKit);

  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${sdkUrl}"]`);
    const script = existing ?? document.createElement('script');
    const loaded = () => window.LivePhotosKit
      ? resolve(window.LivePhotosKit)
      : reject(new Error('Apple LivePhotosKit loaded without exposing its API.'));

    script.addEventListener('load', loaded, { once: true });
    script.addEventListener('error', () => reject(new Error('Failed to load Apple LivePhotosKit.')), { once: true });
    if (!existing) {
      script.src = sdkUrl;
      script.crossOrigin = 'anonymous';
      document.head.appendChild(script);
    }
  });
}
</script>

<template>
  <div class="apple-live-photo-preview">
    <div ref="host" class="apple-live-photo-player" :aria-label="title ?? 'Apple Live Photo'"></div>
    <p v-if="error" class="apple-live-photo-error">{{ error }}</p>
    <p v-else class="apple-live-photo-hint">点击 LIVE 徽标或按住照片播放</p>
    <div v-if="originalPhotoSrc || originalVideoSrc" class="apple-live-photo-originals">
      <a v-if="originalPhotoSrc" :href="originalPhotoSrc" download>原始 HEIC</a>
      <a v-if="originalVideoSrc" :href="originalVideoSrc" download>原始 MOV</a>
    </div>
  </div>
</template>

<style scoped>
.apple-live-photo-preview {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 360px;
  overflow: hidden;
  background: #111;
}

.apple-live-photo-player {
  width: 100%;
  height: 100%;
}

.apple-live-photo-hint,
.apple-live-photo-error {
  position: absolute;
  right: 16px;
  bottom: 14px;
  margin: 0;
  padding: 7px 10px;
  border-radius: 999px;
  color: #fff;
  background: rgb(0 0 0 / 62%);
  font-size: 12px;
  pointer-events: none;
}

.apple-live-photo-error {
  color: #ffd9d4;
}

.apple-live-photo-originals {
  position: absolute;
  left: 16px;
  bottom: 14px;
  display: flex;
  gap: 8px;
}

.apple-live-photo-originals a {
  padding: 7px 10px;
  border-radius: 999px;
  color: #fff;
  background: rgb(0 0 0 / 62%);
  font-size: 12px;
  text-decoration: none;
}
</style>
