# Insta360 / DJI 360 rendering implementation

## Browser pipeline

- `inspect-panorama` runs in `converter-core-rust` and accepts sparse file ranges plus an optional Insta360 `.insv.pb` sidecar.
- `createWasmPanoramaProcessor({ wasm })` owns range iteration, sample reads, seeking, abort, limits, and WebCodecs decoder configuration.
- `createPanoramaPreviewDriver({ processor })` uses calibrated raw rendering when two source-specific lenses are bound to supported video tracks or to the two halves of a metadata-backed INSP image.
- DJI rendering uses the file's `[w,x,y,z]` lens quaternions, fourth-order fisheye polynomial, 85 degree tangent extension, radial-LUT scale, and calibrated overlap weights.
- Insta360 X5 rendering uses the full extended MEI parameters embedded in validated INFO fields `111/112` or supplied by a matching sidecar, including radial/tangential/thin-prism distortion, OpenCV-compatible `tauX/tauY` sensor tilt, and per-lens extrinsics.
- Embedded Insta360 `OffsetV3` intrinsics are converted through INFO `dimension` and `window_crop_info`; ONE RS and X5 retain their verified, different source-texture Y origins so GPU rendering and CPU seam analysis sample the same pixels.
- A 2:1 aspect ratio alone no longer classifies INSP as equirectangular. Camera-original INSP files with an Insta360 trailer are recognized as side-by-side dual fisheye, split into per-lens regions, and reprojected with their embedded `OffsetV3` calibration.
- X5 sidecar focal and principal-point scaling uses those per-file dimensions plus the sidecar sensor canvas instead of fixed 8K-mode constants. ONE RS lens placement uses its per-lens yaw and pitch; the second lens receives the physical 180 degree Y rotation. The unrelated telemetry-vector Euler order is not reused as a lens extrinsic.
- DJI and Insta360 use separate camera axes: DJI maps body `X-right/Y-forward/Z-up` through its body-to-lens quaternion, while X5 maps MEI `X-right/Y-down/Z-forward` through the transpose of its lens extrinsic and rejects the outer 5% fisheye rim.
- ONE RS files are identified from the INSV INFO protobuf; `_00_/_10_` companions remain separate sparse sources, while single 2:1 LRV tracks are labeled proxies.
- ONE RS companion tracks are normalized to `_00_` then `_10_` order before pairing with the two calibration lenses, regardless of which file the user selects first.
- Validated ONE RS firmware stores `count + count * 19 lens fields + global flag` in `_00_`; both lens calibrations are localized from the combined sensor canvas, while `_10_` may contain no INFO metadata.
- AVC tracks derive their RFC 6381 profile from `avcC` and request low-latency WebCodecs output. The playback clock starts only after the first synchronized pair; startup and seek prime both tracks one sample at a time so a slow range source cannot race the clock or starve one decoder.
- `VideoFrameTexture` uses the per-calibration source origin (`top-left` for validated DJI Osmo 360 and X5 sources, `bottom-left` for validated ONE RS `OffsetV3`). The shader does not apply a second vertical flip, and CPU seam analysis applies the matching V transform.
- Each lens may declare `sourceTrackId` plus a normalized `sourceRect`. This keeps separate tracks, side-by-side packing, and top-bottom packing on one rendering path; a shared packed track is decoded once. Rust only emits packed regions when track and calibrated lens dimensions prove the layout exactly.
- Paired frames are analyzed every 500 ms, while calibrated INSP runs the same analysis once after image decode. WASM computes temporally constrained minimum-cost seams from color/gradient error. DJI cost rows are circularly shifted by one quarter turn before the two seam searches, separating the central and wraparound overlap bands; the resulting seams are mapped back to a circular mask with a one-cell feather on both sides, while the polar eighths retain continuous calibrated blending because longitude seams are singular at the poles. A per-row mean-cost gate rejects scenes where either seam would cross high-error structure and falls back to calibrated blending. Both projection families retain bounded symmetric exposure gain.
- Before a dynamic seam is available, X5 blending combines front/back longitude ownership with distance from the calibrated fisheye rim so the less-distorted lens wins the overlap; DJI retains its calibrated angular weighting.
- `.LRF/.LRV` remains a labeled proxy fallback. It is never reported as an accurate raw stitch.

Unknown firmware, missing calibration, missing sidecars, unavailable byte ranges, absent WebCodecs, and unsupported HEVC are separate failures. IMU stabilization stays off when the IMU-to-camera rotation has not been confirmed on real hardware.

## Local vendor samples

Licensed or very large vendor files belong under `tmp/vendor-panorama/`, which is already ignored by Git. Real-file E2E tests remain environment-variable gated:

```powershell
$env:OSV_SAMPLE='G:\path\recording.OSV'
$env:OSV_PROXY_SAMPLE='G:\path\recording.LRF'
$env:INSV_SAMPLE='G:\path\VID_00_001.insv'
```

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
