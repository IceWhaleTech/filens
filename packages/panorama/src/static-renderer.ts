import type { CalibratedPanoramaRenderer } from './calibrated-renderer';
import { createPanoramaImageRenderer } from './realtime/stitch-renderer.js';
import type { StitchCalibration, StitchLens } from './realtime/stitch-types';
import { PanoramaProcessorError, type PanoramaAssetManifest } from './wasm-processor';

/** Map full-sensor calibration to normalized texture coordinates without changing geometry. */
export function createImageStitchCalibration(manifest: PanoramaAssetManifest): StitchCalibration | undefined {
  const { width, height } = manifest;
  if (!width || !height || manifest.lenses.length !== 2
    || !['mei-extended', 'equidistant'].includes(manifest.projection.kind)) return undefined;
  const lenses: StitchLens[] = [];
  for (const [index, lens] of manifest.lenses.entries()) {
    const rect = lens.sourceRect;
    const q = lens.extrinsicQuaternion;
    const w = lens.width;
    const h = lens.height;
    if (!rect || !w || !h || !q || q.length !== 4 || !q.every(Number.isFinite) || Math.hypot(...q) < 1e-6
      || ![lens.fx, lens.fy, lens.cx, lens.cy].every((v) => typeof v === 'number' && Number.isFinite(v))
      || !Object.values(rect).every(Number.isFinite)
      || lens.fx! <= 0 || lens.fy! <= 0 || rect.width <= 0 || rect.height <= 0
      || rect.x < 0 || rect.y < 0 || rect.x + rect.width > 1 || rect.y + rect.height > 1) return undefined;
    const mei = lens.projection?.kind === 'mei-extended';
    const normal = q.map((v) => v / Math.hypot(...q));
    const rotation = mei ? [normal[0], -normal[1], -normal[2], -normal[3]] : normal;
    let axis = rotate(rotation, [0, 0, mei ? 1 : -1]);
    let up = rotate(rotation, [0, 1, 0]);
    // Photos' simplified vendor profile identifies the second hemisphere by lens order.
    if (!mei && index === 1) {
      const alternate = rotate(rotation, [0, 0, 1]);
      if (alternate[2] > axis[2]) { axis = alternate; up = rotate(rotation, [0, -1, 0]); }
    }
    // The shared camera's screen-up ray has negative Y. Express the legacy
    // equidistant basis in that convention while retaining top-left sensor rows.
    const cameraAxis = (v: [number, number, number]): [number, number, number] => mei ? v : [v[0], -v[1], v[2]];
    const radius = Math.min(w, h) * 0.475;
    const focal: [number, number] = [lens.fx! / w * rect.width, lens.fy! / h * rect.height];
    lenses.push({
      center: [rect.x + lens.cx! / w * rect.width, rect.y + lens.cy! / h * rect.height],
      focal, scale: focal, principalOffset: [0, 0], rotationQuat: normal,
      validRadius: [radius / w * rect.width, radius / h * rect.height],
      radial: lens.radial ?? [0, 0, 0, 0], tangential: lens.tangential ?? [0, 0],
      thinPrism: lens.thinPrism ?? [0, 0, 0, 0], sensorTilt: lens.sensorTilt ?? [0, 0],
      xi: lens.xi ?? 0, radialScale: 1, translationM: lens.translation,
      distortionModel: lens.distortionModel, distortionCoeffs: lens.distortionCoeffs,
      axis: cameraAxis(axis), right: cameraAxis(rotate(rotation, [1, 0, 0])), up: cameraAxis(up),
      projectionModel: mei ? 'mei_extended' : 'equidistant'
    });
  }
  return {
    imageSize: [width, height], textureOrigin: manifest.textureOrigin === 'bottom-left' ? 'bottom-left' : 'top-left',
    front: lenses[0], back: lenses[1],
    pipeline: { seamLongitudesDeg: [90, 270], featherWidthPx: Math.round(Math.min(width, height) * 16 / 360) }
  };
}

export function createStaticPanoramaRenderer(image: HTMLImageElement, manifest: PanoramaAssetManifest): CalibratedPanoramaRenderer {
  const calibration = createImageStitchCalibration(manifest);
  if (!calibration) throw new PanoramaProcessorError('calibration_missing', 'This DNG does not contain supported dual-fisheye calibration.');
  // The sensor decoder must preserve the raster layout used by the metadata.
  if (Math.abs(image.naturalWidth / image.naturalHeight - calibration.imageSize[0] / calibration.imageSize[1]) > 0.005) {
    throw new PanoramaProcessorError('invalid_manifest', 'The developed DNG preview does not preserve the calibrated sensor geometry.');
  }
  const canvas = document.createElement('canvas');
  canvas.className = 'panoramav-canvas';
  const renderer = createPanoramaImageRenderer(canvas, image, {
    projection: 'dual_fisheye', dualFisheyeCalibration: calibration,
    dualFisheyeFovDeg: 196, dualFisheyeSeamBlendDeg: 16, dualFisheyeFlipX: false,
    dualFisheyeRefineFocal: manifest.format === 'dng', minFovDeg: 30, maxFovDeg: 100
  });
  let view = '';
  let closed = false;
  let error: Error | undefined;
  const onError = () => { error = new Error('The panorama WebGL context was lost. Reload the preview to resume.'); };
  canvas.addEventListener('insta360previewerror', onError);
  renderer.start();
  return {
    canvas, dragDirectionSign: manifest.projection.kind === 'equidistant' ? 1 : -1,
    setView(yaw, pitch, roll, fov) {
      const key = `${yaw}:${pitch}:${roll}:${fov}`;
      if (closed || key === view) return;
      view = key;
      renderer.setView(yaw, pitch, roll, fov);
      renderer.requestFrame('view');
    },
    requestRender() { if (!closed) renderer.requestFrame('resize'); },
    update() {}, play() {}, pause() {}, seek() {},
    close() {
      if (closed) return;
      closed = true;
      canvas.removeEventListener('insta360previewerror', onError);
      renderer.destroy();
      canvas.width = canvas.height = 0;
    },
    get error() { return error; },
    get dynamicSeam() { return canvas.dataset.insta360StaticSeamStatus === 'ready'; },
    duration: 0, currentTime: 0, paused: true, streamSyncMs: 0,
    stabilizationAvailable: false, stabilizationMode: 'off', setStabilization: () => 'off'
  };
}

function rotate([w, a, b, c]: number[], [x, y, z]: [number, number, number]): [number, number, number] {
  const dot = a*x + b*y + c*z;
  const scale = w*w - a*a - b*b - c*c;
  return [2*dot*a + scale*x + 2*w*(b*z-c*y), 2*dot*b + scale*y + 2*w*(c*x-a*z), 2*dot*c + scale*z + 2*w*(a*y-b*x)];
}
