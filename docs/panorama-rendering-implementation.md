# Insta360 / DJI 360 rendering implementation

## Browser pipeline

- `inspect-panorama` runs in `converter-core-rust` and accepts sparse file ranges plus an optional Insta360 `.insv.pb` sidecar.
- Insta360 INFO discovery follows bounded frame footers/indexes with small backward ranges, skipping unrelated thumbnail and telemetry payloads. A bounded full-metadata fallback preserves the eight-invocation inspection budget for fragmented layouts. INSP starts with a 1 MiB JPEG prefix and 64 KiB tail; parsing remains in the frontend WASM core.
- The browser caches nonoverlapping ranges and fetches only missing bytes. WASM joins adjacent segments while rejecting holes, and JPEG inspection scans the largest available prefix once. Remote ranges must match the requested offset/end, retain the probed total size and contain the complete body; invalid responses fail as `range_unavailable`.
- `createWasmPanoramaProcessor({ wasm })` owns range iteration, sample reads, seeking, abort, limits, and WebCodecs decoder configuration.
- `createPanoramaPreviewDriver({ processor })` automatically uses the Photos real-time renderer for calibrated side-by-side raw video, including two independent square tracks and a shared packed track. INSP images, unusual crops, top-bottom video, and hardware-confirmed IMU stabilization retain the Three.js renderer.
- `packages/panorama/src/realtime/stitch-renderer.js` migrates the frame projection and seam-analysis dependencies of `createProjectionRenderer` from `ZimaOS-Photos/src/lib/search-insta360-preview.js` (source checkout `fe5f62af`). It has no Photos API, React, server conversion, file parser, or runtime dependency on the neighboring checkout. Its local changes add an explicit seek reset and allow the WASM core's generic calibrated MEI lenses to use video protection.
- `createRealtimeStitchCalibration(manifest)` maps WASM lens intrinsics, distortion, rotations, texture origins, and physical track placement to the renderer. `createRealtimePanoramaRenderer(processor, manifest)` exposes its canvas, view, playback controls, state, and cleanup for standalone frontend integrations; callers drive `update()` from their animation loop. The preview driver handles this automatically.
- DJI rendering uses the file's `[w,x,y,z]` lens quaternions, fourth-order fisheye polynomial, 85 degree tangent extension, radial-LUT scale, and calibrated overlap weights.
- Insta360 X5 rendering uses the extended MEI parameters embedded in validated INFO fields `111/112` or supplied by a matching sidecar. WASM labels the full 13-coefficient model as `radtan_pro` and retains the vendor yaw, pitch, and roll relative to the nominal upright front camera. The Photos renderer and retained Three.js GPU/CPU paths apply the same RadtanPro polynomial; its final coefficients are not interpreted as OpenCV sensor tilt. Generic MEI calibration still supports the separate sensor-tilt model.
- Embedded Insta360 `OffsetV3` intrinsics are converted through INFO `dimension` and `window_crop_info`; ONE RS and X5 retain their verified, different source-texture Y origins so GPU rendering and CPU seam analysis sample the same pixels.
- A 2:1 aspect ratio alone no longer classifies INSP as equirectangular. Camera-original INSP files with an Insta360 trailer are recognized as side-by-side dual fisheye, split into per-lens regions, and reprojected with their embedded `OffsetV3` calibration.
- X5 sidecar focal and principal-point scaling uses those per-file dimensions plus the sidecar sensor canvas instead of fixed 8K-mode constants. ONE RS lens placement uses its per-lens yaw and pitch; the second lens receives the physical 180 degree Y rotation. The unrelated telemetry-vector Euler order is not reused as a lens extrinsic.
- DJI and Insta360 use separate camera axes: DJI maps body `X-right/Y-forward/Z-up` through its body-to-lens quaternion, while X5 maps MEI `X-right/Y-down/Z-forward` through the transpose of its lens extrinsic and rejects the outer 5% fisheye rim.
- ONE RS files are identified from the INSV INFO protobuf; `_00_/_10_` companions remain separate sparse sources, while single 2:1 LRV tracks are labeled proxies.
- ONE RS companion tracks are normalized to `_00_` then `_10_` order before pairing with the two calibration lenses, regardless of which file the user selects first.
- Validated ONE RS firmware stores `count + count * 19 lens fields + global flag` in `_00_`; both lens calibrations are localized from the combined sensor canvas, while `_10_` may contain no INFO metadata.
- AVC tracks derive their RFC 6381 profile from `avcC` and request low-latency WebCodecs output. The playback clock starts only after the first synchronized pair; startup and seek prime both tracks one sample at a time so a slow range source cannot race the clock or starve one decoder. Decoded lookahead stays queued until its presentation timestamp. Paused seeking presents the requested pair and restores pause; callback/upload failures close queued frames and decoders and reach the preview's error state.
- Frame uploads use the per-calibration source origin (`top-left` for validated DJI Osmo 360 and X5 sources, `bottom-left` for validated ONE RS `OffsetV3`). The shader does not apply a second vertical flip, and CPU seam analysis applies the matching V transform.
- Each lens may declare `sourceTrackId` plus a normalized `sourceRect`. This keeps separate tracks, side-by-side packing, and top-bottom packing on one rendering path; a shared packed track is decoded once. Rust only emits packed regions when track and calibrated lens dimensions prove the layout exactly.
- The Photos path combines calibrated projection, bounded symmetric exposure gain, seam optimization, displaced-content protection, and continuous foreground ownership. DJI enables one bounded overlap registration; MEI keeps its file calibration. Video analysis adapts to its measured cost at 1/3/5-second intervals and reuses accepted analysis for unchanged scenes. Seek clears prior ownership immediately, including when seeking to the same timestamp. Repeated optional readback failures fall back to calibrated blending.
- Its full-screen WebGL video pass disables multisampling/depth/stencil, updates existing texture allocations, caches unchanged projection uniforms, and draws only for decoded frames, view changes, or resize. A safely covered single-lens viewport skips the other lens in the shader. Decoding retains both tracks so dragging can immediately reveal either lens. Paused views do not continuously redraw; resizing and interaction redraw retained textures.
- The retained Three.js analyzer runs once for calibrated INSP and every 500 ms for video. It uses WASM minimum-cost seams, temporal constraints, overlap/exposure gates, and calibrated fallback blending. Still-image construction awaits that initial analysis, including its optional-failure fallback; subsequent drag, zoom and resize reuse the result without an idle polling loop.
- The calibrated still shader converts linear output back to sRGB in every branch. Its linear-filtered source texture disables unused mipmaps. Both ordinary and calibrated still panoramas redraw only when the view or viewport changes; video retains frame/state polling.
- `.LRF/.LRV` remains a labeled proxy fallback. It is never reported as an accurate raw stitch.

Unknown firmware, missing calibration, missing sidecars, unavailable byte ranges, and unsupported browser media codecs are separate failures. Calibrated INSV can fall back to browser media decoding when WebCodecs is absent, with dynamic seams and IMU stabilization disabled. IMU stabilization stays off when the IMU-to-camera rotation has not been confirmed on real hardware.

## Local vendor samples

### INSP originals

A real 11904×5952 X5 INSP original has been rendered and checked at eight headings/pitches, including both seams, with drag, zoom, resize and zero idle draws. The [frontend comparison](performance-comparison.md#x5-originals-native-calibration-and-more-natural-seams) records 21 repeats per engine, native embedded calibration and a scoped preview-speed lead over PSV's generic dual-fisheye adapter. PSV repeats scene content at hard seams in this sample; filens retains lighter localized blending/ghosting. This does not establish seamless rendering for other scenes or a general quality SOTA.

`panorama-still-calibrated.e2e.ts` checks neutral-gray sRGB output (118), delayed/failed optional seam work, no mipmaps, no idle draws, interaction and cleanup through the production driver. `INSP_SAMPLE` enables the real-original check in `vendor-panorama.e2e.ts`.

### RAW images

`createWasmPanoramaProcessor({ wasm, imageWasm })` also inspects DNG. A bounded
TIFF reader in `panorama_dng.rs` follows IFD/SubIFD/EXIF directories and requests
only missing metadata ranges. It recognizes validated One RS simplified
parameters and X5 DNG offset_v3 records. Ordinary DNG and unsupported calibration
stay on the flat-image path; aspect ratio is not projection evidence.

X5 DNG uses MEI with its complete vendor rotation, radial/tangential distortion,
metre baseline, and sensor-border principal-point offset. Focal values remain in
sensor pixels. One RS DNG uses its native vertical/horizontal lens centers and
the simplified equidistant model, including the existing bounded focal search.
Its legacy basis is converted to the shared camera's Y-down convention so both
CPU seam analysis and GPU display use unflipped top-left sensor rows.
Focal refinement is rejected if it would leave either half of the bounded seam
grid without a continuous valid path. This prevents a narrow fitted overlap from
silently disabling the static mask on the local One RS original.

`createRawImagePreviewDriver({ processor, converter })` preserves source metadata
before RAW development. `decodeImage()` invokes `converter-image.wasm` with
`preserveSensorGeometry: true`; it never uses a cropped embedded JPEG for a
calibrated RAW raster. `createImageStitchCalibration()` adapts the resulting
manifest, and `createStaticPanoramaRenderer()` runs the migrated Photos static
path. This includes exposure matching, foreground ownership, horizontal MEI
registration, and independent polar depth where the metadata and image permit
them. Analysis runs once; drag, zoom and resize reuse the source texture and mask.
Failed optional analysis retains calibrated blending. Source changes abort stale
work and release the image URL, GL context resources and prior processor state.

Vue enables this route when a converter and panorama processor are configured.
Plain frontend integrations can use `createMediaPreviewDrivers({ converter,
panoramaProcessor })` and `createMediaPreviewRoutes(baseRoutes, { rawPreview: true })`.
All parsing and RAW conversion remain in the frontend WASM modules; no backend
conversion algorithm or Photos server is required.

`panorama-raw.e2e.ts` always checks synthetic One RS/X5 DNG through the production
WASM modules and WebGL, verifies upright pixel colors despite EXIF rotation,
resizes, and switches back to ordinary Pentax DNG. `RAW_DNG_SAMPLE` adds a real
camera-original test. The local One RS 1-Inch original was decoded, rendered and
visually checked; X5 DNG is covered by numeric calibration and synthetic raster
regressions. X5 camera-original DNG visual validation remains outstanding.

```sh
RAW_DNG_SAMPLE=/path/to/original.dng npx playwright test apps/demo/e2e/panorama-raw.e2e.ts --workers=1
```

Lightweight sensor development does not reproduce vendor RAW color profiles or
edits; near objects and mixed scene depths can retain parallax. Neither these
checks nor the static protection rules establish seamless rendering for arbitrary
camera originals.

Licensed or very large vendor files belong under `tmp/vendor-panorama/`, which is already ignored by Git. Real-file E2E tests remain environment-variable gated:

```powershell
$env:OSV_SAMPLE='G:\path\recording.OSV'
$env:OSV_PROXY_SAMPLE='G:\path\recording.LRF'
$env:INSV_SAMPLE='G:\path\VID_00_001.insv'
$env:RAW_INSV_SAMPLE='G:\path\calibrated-original.insv'
```

`apps/demo/e2e/panorama-realtime.e2e.ts` always exercises real H.264 encode/decode, GPU projection, separate/packed tracks, paused redraw, zoom, seek, and disposal with synthetic input. `RAW_INSV_SAMPLE` additionally exercises sparse WASM inspection and dynamic seams on an actual camera original. Run it with `npx playwright test apps/demo/e2e/panorama-realtime.e2e.ts --workers=1`.

Do not commit OSV, INSV, PB sidecars, serial numbers, SDK output, or proprietary models.

## Desktop MediaSDK black-box reference

Keep an approved Insta360 Desktop MediaSDK installation and reference wrapper under `tmp/panorama-sdk-reference/`. The repository does not contain its headers, libraries, models, or generated vendor assets.

For each ONE RS and X5 scene, export fixed Template, Optical Flow, Dynamic, and AI results with identical output dimensions, orientation, stabilization, and crop. Record only measurements and hashes that are safe to publish:

- overlap feature residual median and P95;
- seam-region color/gradient error;
- output orientation and horizon error;
- frame timestamps and dual-track synchronization;
- command settings, SDK version, camera model, and firmware.

The SDK is a golden-output oracle, not a runtime dependency. Binary reverse engineering and redistribution remain out of scope. Public references are listed in [panorama-camera-calibration-research.md](./panorama-camera-calibration-research.md).

## Accuracy gates

The UI must keep a model experimental until real hardware fixtures meet the agreed geometry, synchronization, horizon, seam, and frame-rate thresholds. Calibrated geometry, dynamic seams, and overlap exposure remain experimental until the real golden set passes; confirmed IMU stabilization still requires per-model hardware validation.
