# @filens/media

Audio, video, image and panorama preview drivers for Filens.

HEIC/HEIF photos first use native browser decoding. When unavailable, a dedicated
libheif WASM decoder supplies a PNG preview. Its 1.46 MB WASM (486 KB gzip) loads
only after native decoding fails in the split build. Decoding runs in a worker
that stops when the source changes or the preview is destroyed. HEIF sequences
show the primary image. No upload or cross-origin isolation is required.

MOV videos use browser codecs without a bundled FFmpeg engine. Codec support
depends on the browser, operating system and hardware; unsupported video reports
an error, including containers whose audio plays but video cannot be decoded.
Applications that need transcoding can supply an optional `mediaConverter` to
`createMediaPreviewDrivers`, the Vue `Preview` component or `createPreview`.
The converter must return browser-playable media for MOV-to-MP4 requests and
handle HEIC/HEIF-to-PNG requests if used for image fallback too.

The dedicated decoder is distributed with `@filens/converter-client` (libheif-js,
LGPL-3.0). Applications must serve `libheif.wasm` alongside its JavaScript; the
standalone single-file build embeds it. Dependencies retain their own licenses.

Audio previews include artwork, track information, synchronized LRC lyrics, click-to-seek,
lyric timing adjustment, repeat and playback speed alongside the native audio controls.
The player adapts to narrow containers and uses Chinese or English labels according to
the document's `lang` attribute. It does not autoplay.

```ts
import { createPreviewer } from '@filens/core';
import { createMediaPreviewDrivers } from '@filens/media';
import '@filens/media/style.css';

const previewer = createPreviewer(host, {
  drivers: createMediaPreviewDrivers(),
  audio: {
    title: 'My song',
    artist: 'Artist',
    album: 'Album',
    cover: '/music/cover.jpg', // URL, Blob, File, or bytes
    lyrics: '[00:01.00]First line\n[00:04.50]Second line' // LRC content
  }
});
await previewer.preview('/music/song.mp3');
```

The Vue `Preview` component accepts the same options through its `audio` prop.

Local MP3 ID3v2 APIC artwork is read automatically. With `resourceResolver`, the player
also looks for `<track>.lrc`, `<track>.jpg/.png/.webp`, `cover.jpg/.png` and `folder.jpg`
in the track's directory (`relation: 'lyrics'` or `'cover'`). Use
`createFileSetResourceResolver(files)` to supply related local files; the demo accepts
audio, LRC and artwork in one selection. Resource resolvers return a URL, Blob or bytes
in `source`; literal LRC content belongs in `audio.lyrics`.

Users can import or replace lyrics and artwork from inside the player. Manual imports
take precedence over pending companion reads; explicit options take precedence over
companion and embedded artwork. Optional resource failures do not stop audio playback.
No companion URLs are fetched unless supplied by the host's resolver.

LRC supports `ti`, `ar`, `al`, `offset`, repeated timestamps and same-time translations.
Enhanced LRC word timestamps are displayed as line lyrics. Positive LRC offsets advance
lyrics; the player's positive timing adjustment delays them. Lyric imports are limited
to 2 MB and 10,000 timestamped entries; artwork imports to 20 MB. Audio codec support
depends on the browser. Remote resources must permit browser access (CORS).
