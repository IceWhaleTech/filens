# @filens/panorama

Interactive panorama image and video previews, with calibrated real-time stitching for supported Insta360 INSV and DJI OSV sources.

```ts
import { createPanoramaPreviewDriver, createWasmPanoramaProcessor } from '@filens/panorama';
import '@filens/panorama/style.css';

const processor = createWasmPanoramaProcessor({ wasm: '/externals/converter-core.wasm' });
const driver = createPanoramaPreviewDriver({ processor });
```

Register the driver and `createPanoramaPreviewRoutes()` with the preview runtime. The driver selects the Photos WebGL renderer for supported calibrated video and provides drag, zoom, play/pause, and seek controls. Use the preview resource resolver to supply matching ONE RS companions and calibration sidecars.

File inspection and calibration decoding run in the frontend WASM core. Browser WebCodecs supplies synchronized frames to the renderer; supported codecs depend on the browser and device. Separate square lenses and side-by-side packed video share the same projection, exposure, seam, and foreground-protection implementation. Other supported layouts retain the existing renderer.

For direct frontend integrations, `createRealtimeStitchCalibration(manifest)` checks and adapts an inspected manifest. `createRealtimePanoramaRenderer(processor, manifest)` returns a canvas and playback controls; append the canvas, call `update()` from an animation loop, use `setView(yaw, pitch, roll, fov)` in degrees, and call `close()` when finished. IMU stabilization requires the existing renderer and confirmed camera calibration.

`processor.open(source, { format, signal })` keeps that signal active for later sample reads, RAW decoding and seam/IMU work. A new `open()` or `close()` cancels the previous source's pending operations; failed opens expose no partial manifest. Individual operation signals cancel only that operation. Shared WASM loading remains reusable, while already-running synchronous WASM cannot be interrupted.

The reusable frame renderer was migrated from `ZimaOS-Photos`; it does not require that repository or a Photos server at runtime. See [implementation and validation](../../docs/panorama-rendering-implementation.md).

For RAW panoramas, configure both WASM modules and the RAW image driver before
the ordinary DNG conversion route:

```ts
import { createWasmConverterClient } from '@filens/converter-client';
import { createRawImagePreviewDriver, RAW_IMAGE_FORMAT_ROUTES } from '@filens/panorama';

const converter = createWasmConverterClient({
  wasm: '/externals/converter-core.wasm', imageWasm: '/externals/converter-image.wasm'
});
const rawProcessor = createWasmPanoramaProcessor({
  wasm: '/externals/converter-core.wasm', imageWasm: '/externals/converter-image.wasm'
});
const rawDriver = createRawImagePreviewDriver({ processor: rawProcessor, converter });
// Register rawDriver and prepend RAW_IMAGE_FORMAT_ROUTES to the existing routes.
```

`@filens/media` also exposes this through `createMediaPreviewDrivers({ converter,
panoramaProcessor })` and `createMediaPreviewRoutes(baseRoutes, { rawPreview: true })`.
The Vue component enables it automatically when both dependencies are supplied.
Ordinary DNG remains a flat image; a 2:1 aspect ratio alone never enables stitching.

Supported panorama DNG metadata includes One RS simplified parameters in vertical
or horizontal sensor layouts, and X5 offset_v3 parameters with the RAW sensor
border retained. RAW sensor development produces a JPEG preview up to 4096 pixels
on its longest side without cropping or applying EXIF rotation. Static stitching
runs the migrated exposure matching, content protection, overlap registration,
and polar alignment once at load; dragging and zooming reuse the result. Other
RAW extensions retain their existing JPEG conversion path. This is lightweight,
experimental preview development, with camera/file-dependent decoder support.
