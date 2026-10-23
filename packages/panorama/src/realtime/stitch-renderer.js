// Migrated from ZimaOS-Photos src/lib/search-insta360-preview.js (fe5f62af).
// Frontend frame projection and seam analysis only; no Photos API or file parsing.
const DEFAULT_OPTIONS = Object.freeze({
  mode: "auto", // "auto" | "flat" | "equirect"
  projection: "auto", // "auto" | "equirect" | "dual_fisheye"
  autoplay: false,
  muted: true,
  loop: true,
  enableGyro: false,
  gyroMaxPitchDeg: 85,
  gyroYawOffsetDeg: 0,
  gyroPitchOffsetDeg: 0,
  gyroSmoothing: 0.15, // 0..1, higher = smoother but laggier
  stabilize: false,
  stabilizeMode: "roll", // "roll" | "horizon"
  stabilizeStrength: 0.06,
  stabilizeMaxRollDeg: 45,
  telemetryURL: "",
  telemetryMaxSamples: 2000,
  imuRollGyroAxis: "gyro_y",
  imuRollAccelAxes: "accel_x,accel_y", // used by horizon mode only
  equirectFlipX: true,
  equirectFlipY: false,
  dualFisheyeFlipX: true,
  dualFisheyeFlipY: false,
  dualFisheyeFovDeg: 190,
  dualFisheyeFrontLens: "right", // "right" | "left"
  dualFisheyeSeamBlendDeg: 12,
  dualFisheyeSeamLongitudesDeg: [90, 270],
  dualFisheyeGainFront: 1,
  dualFisheyeGainBack: 1,
  dualFisheyeAutoGain: true,
  dualFisheyeRefineFocal: false,
  dualFisheyeVideoRegistration: false,
  dualFisheyeCalibration: null,
  dragYawSign: -1, // Dragging right keeps the grabbed scene moving right.
  dragPitchSign: 1, // Dragging down keeps the grabbed scene moving down.
  fovDeg: 75,
  maxFovDeg: 95,
  minFovDeg: 35,
  progressiveUpgrade: true,
  progressivePollIntervalMS: 1200,
  background: "#000",
  maxRenderPixelRatio: 0, // 0 = auto
  preferredImageWidth: 0,
  videoMetadataTimeoutMS: 15000,
});


const PANORAMA_TEXTURE_WIDTH_STEPS = [16384, 8192, 4096, 2048];


function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}


function finiteNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}


function normalizeNumberList(value, fallback, length = 0) {
  const source = Array.isArray(value) ? value : fallback;
  const size = length || source.length;
  const out = [];
  for (let index = 0; index < size; index += 1) {
    out.push(finiteNumber(source && source[index], fallback[index] ?? 0));
  }
  return out;
}


function normalizeIntPair(value, fallback) {
  const pair = normalizeNumberList(value, fallback, 2);
  return [Math.max(1, Math.round(pair[0])), Math.max(1, Math.round(pair[1]))];
}


function normalizeLongitudeDeg(value) {
  const numeric = finiteNumber(value, 0);
  return ((numeric % 360) + 360) % 360;
}


function normalizeSeamLongitudesDeg(value, fallback = DEFAULT_OPTIONS.dualFisheyeSeamLongitudesDeg) {
  const source = Array.isArray(value) && value.length >= 2 ? value : fallback;
  const first = normalizeLongitudeDeg(source[0]);
  const second = normalizeLongitudeDeg(source[1]);
  if (Math.abs(first - second) < 0.001) {
    return fallback.slice();
  }
  return [first, second];
}


function normalizeUint8Array(value, expectedLength) {
  if (value instanceof Uint8Array) {
    if (!expectedLength || value.length === expectedLength) return value;
    return value.length > expectedLength ? value.slice(0, expectedLength) : null;
  }
  if (Array.isArray(value)) {
    const next = Uint8Array.from(value.map((entry) => clamp(Math.round(finiteNumber(entry, 0)), 0, 255)));
    if (!expectedLength || next.length === expectedLength) return next;
  }
  return null;
}


function normalizeOptions(options) {
  const merged = { ...DEFAULT_OPTIONS, ...(options || {}) };
  merged.fovDeg = clamp(Number(merged.fovDeg) || DEFAULT_OPTIONS.fovDeg, 1, 179);
  merged.maxFovDeg = clamp(Number(merged.maxFovDeg) || DEFAULT_OPTIONS.maxFovDeg, 1, 179);
  merged.minFovDeg = clamp(Number(merged.minFovDeg) || DEFAULT_OPTIONS.minFovDeg, 1, 179);
  if (merged.minFovDeg > merged.maxFovDeg) {
    const tmp = merged.minFovDeg;
    merged.minFovDeg = merged.maxFovDeg;
    merged.maxFovDeg = tmp;
  }
  merged.fovDeg = clamp(merged.fovDeg, merged.minFovDeg, merged.maxFovDeg);
  merged.mode = String(merged.mode || "auto");
  if (merged.mode !== "auto" && merged.mode !== "flat" && merged.mode !== "equirect") {
    merged.mode = "auto";
  }
  merged.projection = String(merged.projection || DEFAULT_OPTIONS.projection);
  if (merged.projection !== "auto" && merged.projection !== "equirect" && merged.projection !== "dual_fisheye") {
    merged.projection = "auto";
  }
  merged.background = String(merged.background || DEFAULT_OPTIONS.background);
  merged.autoplay = Boolean(merged.autoplay);
  merged.muted = Boolean(merged.muted);
  merged.loop = Boolean(merged.loop);
  merged.enableGyro = Boolean(merged.enableGyro);
  merged.gyroMaxPitchDeg = clamp(Number(merged.gyroMaxPitchDeg) || DEFAULT_OPTIONS.gyroMaxPitchDeg, 1, 89);
  merged.gyroYawOffsetDeg = Number(merged.gyroYawOffsetDeg) || 0;
  merged.gyroPitchOffsetDeg = Number(merged.gyroPitchOffsetDeg) || 0;
  merged.gyroSmoothing = clamp(Number(merged.gyroSmoothing) || DEFAULT_OPTIONS.gyroSmoothing, 0, 1);
  merged.stabilize = Boolean(merged.stabilize);
  merged.stabilizeMode = String(merged.stabilizeMode || DEFAULT_OPTIONS.stabilizeMode);
  if (merged.stabilizeMode !== "roll" && merged.stabilizeMode !== "horizon") {
    merged.stabilizeMode = "roll";
  }
  merged.stabilizeStrength = clamp(Number(merged.stabilizeStrength) || DEFAULT_OPTIONS.stabilizeStrength, 0, 1);
  merged.stabilizeMaxRollDeg = clamp(Number(merged.stabilizeMaxRollDeg) || DEFAULT_OPTIONS.stabilizeMaxRollDeg, 0, 180);
  merged.telemetryURL = String(merged.telemetryURL || "");
  merged.telemetryMaxSamples = Math.max(0, Number(merged.telemetryMaxSamples) || DEFAULT_OPTIONS.telemetryMaxSamples);
  merged.imuRollGyroAxis = String(merged.imuRollGyroAxis || DEFAULT_OPTIONS.imuRollGyroAxis);
  merged.imuRollAccelAxes = String(merged.imuRollAccelAxes || DEFAULT_OPTIONS.imuRollAccelAxes);
  merged.equirectFlipX = merged.equirectFlipX !== false;
  merged.equirectFlipY = Boolean(merged.equirectFlipY);
  merged.dualFisheyeFlipX = merged.dualFisheyeFlipX !== false;
  merged.dualFisheyeFlipY = Boolean(merged.dualFisheyeFlipY);
  merged.dualFisheyeFovDeg = clamp(Number(merged.dualFisheyeFovDeg) || DEFAULT_OPTIONS.dualFisheyeFovDeg, 120, 220);
  merged.dualFisheyeFrontLens = String(merged.dualFisheyeFrontLens || DEFAULT_OPTIONS.dualFisheyeFrontLens) === "left" ? "left" : "right";
  merged.dualFisheyeSeamBlendDeg = clamp(
    Number(merged.dualFisheyeSeamBlendDeg) || DEFAULT_OPTIONS.dualFisheyeSeamBlendDeg,
    0,
    45,
  );
  merged.dualFisheyeSeamLongitudesDeg = normalizeSeamLongitudesDeg(merged.dualFisheyeSeamLongitudesDeg);
  merged.dualFisheyeGainFront = Math.max(0.2, Number(merged.dualFisheyeGainFront) || DEFAULT_OPTIONS.dualFisheyeGainFront);
  merged.dualFisheyeGainBack = Math.max(0.2, Number(merged.dualFisheyeGainBack) || DEFAULT_OPTIONS.dualFisheyeGainBack);
  merged.dualFisheyeAutoGain = merged.dualFisheyeAutoGain !== false;
  merged.dualFisheyeRefineFocal = merged.dualFisheyeRefineFocal === true;
  merged.dualFisheyeVideoRegistration = merged.dualFisheyeVideoRegistration === true;
  merged.dualFisheyeCalibration =
    merged.dualFisheyeCalibration && typeof merged.dualFisheyeCalibration === "object"
      ? merged.dualFisheyeCalibration
      : null;
  const yawSign = Number(merged.dragYawSign);
  merged.dragYawSign = yawSign === -1 ? -1 : 1;
  const pitchSign = Number(merged.dragPitchSign);
  merged.dragPitchSign = pitchSign === -1 ? -1 : 1;
  merged.progressiveUpgrade = merged.progressiveUpgrade !== false;
  merged.progressivePollIntervalMS = Math.max(250, Number(merged.progressivePollIntervalMS) || DEFAULT_OPTIONS.progressivePollIntervalMS);
  merged.maxRenderPixelRatio = Math.max(0, Number(merged.maxRenderPixelRatio) || 0);
  merged.preferredImageWidth = Math.max(0, Math.round(Number(merged.preferredImageWidth) || 0));
  merged.videoMetadataTimeoutMS = Math.max(
    0,
    finiteNumber(merged.videoMetadataTimeoutMS, DEFAULT_OPTIONS.videoMetadataTimeoutMS),
  );
  return merged;
}


function normalizeVec2(value, fallback) {
  const source = Array.isArray(value) ? value : fallback;
  return [
    finiteNumber(source && source[0], fallback[0]),
    finiteNumber(source && source[1], fallback[1]),
  ];
}


function scaleDualFisheyeRadiusToFocal(scale, maxThetaRad) {
  const theta = Math.max(0.0001, Number(maxThetaRad) || 0);
  return [
    finiteNumber(scale && scale[0], 0) / theta,
    finiteNumber(scale && scale[1], 0) / theta,
  ];
}


function inferDualFisheyeValidRadius(frontCenter, backCenter) {
  const deltaX = Math.abs(frontCenter[0] - backCenter[0]);
  const deltaY = Math.abs(frontCenter[1] - backCenter[1]);
  if (deltaY > deltaX) {
    return [0.475, Math.max(0.0001, deltaY * 0.475)];
  }
  return [Math.max(0.0001, deltaX * 0.475), 0.475];
}


function normalizeVec3(value, fallback) {
  const source = Array.isArray(value) ? value : fallback;
  const x = finiteNumber(source && source[0], fallback[0]);
  const y = finiteNumber(source && source[1], fallback[1]);
  const z = finiteNumber(source && source[2], fallback[2]);
  const length = Math.hypot(x, y, z);
  if (length <= 1e-6) {
    return fallback.slice();
  }
  return [x / length, y / length, z / length];
}


function normalizeQuat(value, fallback = [1, 0, 0, 0]) {
  const source = Array.isArray(value) ? value : fallback;
  const normalized = normalizeNumberList(source, fallback, 4);
  const length = Math.hypot(...normalized) || 1;
  return normalized.map((component) => component / length);
}


function normalizeDualFisheyeCalibration(calibration, frontLensSide) {
  if (!calibration || typeof calibration !== "object") return null;
  const fallbackFrontCenter = frontLensSide === "left" ? [0.25, 0.5] : [0.75, 0.5];
  const fallbackBackCenter = frontLensSide === "left" ? [0.75, 0.5] : [0.25, 0.5];
  const fallbackFront = {
    center: fallbackFrontCenter,
    focal: [0.247, 0.494],
    principalOffset: [0, 0],
    rotationQuat: [1, 0, 0, 0],
    scale: [0.247, 0.494],
    validRadius: [0.2375, 0.475],
    radial: [0, 0, 0, 0],
    radialLUT1: [],
    radialLUT2: [],
    radialScale: 1,
    tangential: [0, 0],
    projectionModel: "equidistant",
    xi: 0,
    thinPrism: [0, 0, 0, 0],
    sensorTilt: [0, 0],
    asymmetric: [0, 0, 0, 0],
    axis: [0, 0, -1],
    right: [1, 0, 0],
    up: [0, 1, 0],
  };
  const fallbackBack = {
    center: fallbackBackCenter,
    focal: [0.247, 0.494],
    principalOffset: [0, 0],
    rotationQuat: [1, 0, 0, 0],
    scale: [0.247, 0.494],
    validRadius: [0.2375, 0.475],
    radial: [0, 0, 0, 0],
    radialLUT1: [],
    radialLUT2: [],
    radialScale: 1,
    tangential: [0, 0],
    projectionModel: "equidistant",
    xi: 0,
    thinPrism: [0, 0, 0, 0],
    sensorTilt: [0, 0],
    asymmetric: [0, 0, 0, 0],
    axis: [0, 0, 1],
    right: [-1, 0, 0],
    up: [0, 1, 0],
  };
  const front = calibration.front && typeof calibration.front === "object" ? calibration.front : {};
  const back = calibration.back && typeof calibration.back === "object" ? calibration.back : {};
  const pipeline = calibration.pipeline && typeof calibration.pipeline === "object" ? calibration.pipeline : {};
  const remap = normalizeDualFisheyeRemap(calibration.remap);
  const textureOrigin = String(calibration.textureOrigin ?? calibration.texture_origin ?? "").trim().toLowerCase();
  const imageSize = normalizeIntPair(calibration.imageSize ?? calibration.image_size, [0, 0]);
  const frontCenter = normalizeVec2(front.center, fallbackFront.center);
  const backCenter = normalizeVec2(back.center, fallbackBack.center);
  const inferredValidRadius = inferDualFisheyeValidRadius(frontCenter, backCenter);
  return {
    textureOrigin: textureOrigin === "top-left" || textureOrigin === "bottom-left" ? textureOrigin : "",
    imageSize,
    front: {
      center: frontCenter,
      focal: normalizeVec2(front.focal, fallbackFront.focal),
      principalOffset: normalizeVec2(front.principalOffset, fallbackFront.principalOffset),
      rotationQuat: normalizeQuat(front.rotationQuat || front.rotation_quat),
      scale: normalizeVec2(front.scale, fallbackFront.scale),
      validRadius: normalizeVec2(front.validRadius || front.valid_radius, inferredValidRadius),
      radial: normalizeNumberList(front.radial, fallbackFront.radial, 4),
      radialLUT1: normalizeNumberList(front.radialLUT1 || front.radial_lut_1, fallbackFront.radialLUT1, 14),
      radialLUT2: normalizeNumberList(front.radialLUT2 || front.radial_lut_2, fallbackFront.radialLUT2, 14),
      radialScale: Math.max(0, finiteNumber(front.radialScale ?? front.radial_scale, fallbackFront.radialScale)),
      tangential: normalizeVec2(front.tangential, fallbackFront.tangential),
      projectionModel: String(front.projectionModel || front.projection_model || fallbackFront.projectionModel).replace(/-/g, "_"),
      xi: finiteNumber(front.xi, fallbackFront.xi),
      thinPrism: normalizeNumberList(front.thinPrism || front.thin_prism, fallbackFront.thinPrism, 4),
      sensorTilt: normalizeVec2(front.sensorTilt || front.sensor_tilt, fallbackFront.sensorTilt),
      distortionModel: String(front.distortionModel || front.distortion_model || ""),
      distortionCoeffs: normalizeNumberList(front.distortionCoeffs || front.distortion_coeffs, [], 13),
      translationM: normalizeNumberList(front.translationM, [0, 0, 0], 3),
      asymmetric: normalizeNumberList(front.asymmetric, fallbackFront.asymmetric, 4),
      axis: normalizeVec3(front.axis, fallbackFront.axis),
      right: normalizeVec3(front.right, fallbackFront.right),
      up: normalizeVec3(front.up, fallbackFront.up),
    },
    back: {
      center: backCenter,
      focal: normalizeVec2(back.focal, fallbackBack.focal),
      principalOffset: normalizeVec2(back.principalOffset, fallbackBack.principalOffset),
      rotationQuat: normalizeQuat(back.rotationQuat || back.rotation_quat),
      scale: normalizeVec2(back.scale, fallbackBack.scale),
      validRadius: normalizeVec2(back.validRadius || back.valid_radius, inferredValidRadius),
      radial: normalizeNumberList(back.radial, fallbackBack.radial, 4),
      radialLUT1: normalizeNumberList(back.radialLUT1 || back.radial_lut_1, fallbackBack.radialLUT1, 14),
      radialLUT2: normalizeNumberList(back.radialLUT2 || back.radial_lut_2, fallbackBack.radialLUT2, 14),
      radialScale: Math.max(0, finiteNumber(back.radialScale ?? back.radial_scale, fallbackBack.radialScale)),
      tangential: normalizeVec2(back.tangential, fallbackBack.tangential),
      projectionModel: String(back.projectionModel || back.projection_model || fallbackBack.projectionModel).replace(/-/g, "_"),
      xi: finiteNumber(back.xi, fallbackBack.xi),
      thinPrism: normalizeNumberList(back.thinPrism || back.thin_prism, fallbackBack.thinPrism, 4),
      sensorTilt: normalizeVec2(back.sensorTilt || back.sensor_tilt, fallbackBack.sensorTilt),
      distortionModel: String(back.distortionModel || back.distortion_model || ""),
      distortionCoeffs: normalizeNumberList(back.distortionCoeffs || back.distortion_coeffs, [], 13),
      translationM: normalizeNumberList(back.translationM, [0, 0, 0], 3),
      asymmetric: normalizeNumberList(back.asymmetric, fallbackBack.asymmetric, 4),
      axis: normalizeVec3(back.axis, fallbackBack.axis),
      right: normalizeVec3(back.right, fallbackBack.right),
      up: normalizeVec3(back.up, fallbackBack.up),
    },
    pipeline: {
      featherWidthPx: Math.max(0, Number(pipeline.featherWidthPx) || 0),
      seamLongitudesDeg: normalizeSeamLongitudesDeg(pipeline.seamLongitudesDeg),
    },
    remap,
  };
}


function normalizeDualFisheyeRemap(remap) {
  if (!remap || typeof remap !== "object") return null;
  const size = normalizeIntPair([remap.width, remap.height], [1, 1]);
  const width = size[0];
  const height = size[1];
  const expectedLength = width * height * 4;
  const front = normalizeUint8Array(remap.front, expectedLength);
  const back = normalizeUint8Array(remap.back, expectedLength);
  if (!front || !back) return null;
  return {
    strategy: "lut_rgba8",
    width,
    height,
    front,
    back,
    meshResolution: normalizeIntPair(remap.meshResolution, [32, 16]),
  };
}


function isVerticalDualFisheyeSource(width, height) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  return w > 0 && h > w * 1.6 && Math.abs(h / w - 2.0) <= 0.15;
}


function parseCSSColorToRGBA(css) {
  const value = String(css || "").trim();
  if (!value) return { r: 0, g: 0, b: 0, a: 1 };
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return { r, g, b, a: 1 };
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return { r, g, b, a: 1 };
    }
    if (hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = parseInt(hex.slice(6, 8), 16) / 255;
      return { r, g, b, a: Number.isFinite(a) ? a : 1 };
    }
  }
  const tmp = document.createElement("div");
  tmp.style.color = value;
  document.body.appendChild(tmp);
  const computed = getComputedStyle(tmp).color || "rgb(0,0,0)";
  document.body.removeChild(tmp);
  const match = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/);
  if (!match) return { r: 0, g: 0, b: 0, a: 1 };
  return {
    r: clamp(Number(match[1]) || 0, 0, 255),
    g: clamp(Number(match[2]) || 0, 0, 255),
    b: clamp(Number(match[3]) || 0, 0, 255),
    a: match[4] == null ? 1 : clamp(Number(match[4]) || 1, 0, 1),
  };
}


function compileShader(gl, type, src) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("createShader failed");
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || "";
    gl.deleteShader(shader);
    throw new Error(`shader compile failed: ${log}`);
  }
  return shader;
}


function createProgram(gl, vsSrc, fsSrc) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const program = gl.createProgram();
  if (!program) throw new Error("createProgram failed");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) || "";
    gl.deleteProgram(program);
    throw new Error(`program link failed: ${log}`);
  }
  return program;
}


function getMediaTextureSize(mediaEl) {
  if (!mediaEl) return { width: 1, height: 1 };
  if (mediaEl instanceof HTMLVideoElement) {
    return {
      width: Math.max(1, mediaEl.videoWidth || mediaEl.clientWidth || 1),
      height: Math.max(1, mediaEl.videoHeight || mediaEl.clientHeight || 1),
    };
  }
  if (mediaEl instanceof HTMLImageElement) {
    return {
      width: Math.max(1, mediaEl.naturalWidth || mediaEl.width || mediaEl.clientWidth || 1),
      height: Math.max(1, mediaEl.naturalHeight || mediaEl.height || mediaEl.clientHeight || 1),
    };
  }
  return {
    width: Math.max(1, mediaEl.width || mediaEl.clientWidth || 1),
    height: Math.max(1, mediaEl.height || mediaEl.clientHeight || 1),
  };
}


// Keep seam analysis deliberately small: the source image stays at GPU quality,
// while the CPU retains a bounded sampling surface and a 128x64 mask.
const ANALYSIS_WIDTH = 128;

const ANALYSIS_HEIGHT = 64;

const SOURCE_ANALYSIS_SIZE = 256;

const ANALYSIS_RGBA_ALPHA_MASK = new Int32Array(new Uint8Array([0, 0, 0, 255]).buffer)[0];

const flippedBoundedImageBitmaps = new WeakSet();


function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}


function sub3(a, b, scale = 1) {
  return [a[0] - b[0] * scale, a[1] - b[1] * scale, a[2] - b[2] * scale];
}


function length3(value) {
  return Math.hypot(value[0], value[1], value[2]);
}


function panoramaDirectionForDualFisheye(u, v, meiConvention = false) {
  const longitude = (u - 0.5) * Math.PI * 2;
  const latitude = (0.5 - v) * Math.PI;
  const cosLatitude = Math.cos(latitude);
  return [
    cosLatitude * Math.sin(longitude),
    Math.sin(latitude),
    (meiConvention ? 1 : -1) * cosLatitude * Math.cos(longitude),
  ];
}


function projectDualEquirectUV(dir, meiConvention = false) {
  const longitude = Math.atan2(dir[0], meiConvention ? dir[2] : -dir[2]);
  const latitude = Math.asin(clamp(meiConvention ? -dir[1] : dir[1], -1, 1));
  return [
    longitude / (Math.PI * 2) + 0.5,
    meiConvention ? latitude / Math.PI + 0.5 : 0.5 - latitude / Math.PI,
  ];
}


function sampleAnalysisPixelsBilinear(pixels, width, height, u, v, output, offset = 0) {
  const x = clamp(u * width - 0.5, 0, width - 1);
  const y = clamp(v * height - 0.5, 0, height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  for (let channel = 0; channel < 3; channel += 1) {
    const top = pixels[(y0 * width + x0) * 4 + channel] * (1 - tx) + pixels[(y0 * width + x1) * 4 + channel] * tx;
    const bottom = pixels[(y1 * width + x0) * 4 + channel] * (1 - tx) + pixels[(y1 * width + x1) * 4 + channel] * tx;
    output[offset + channel] = top * (1 - ty) + bottom * ty;
  }
  return output;
}


function sampleDualFisheyeAnalysisColors(surface, map, colors, cache = false) {
  const { pixels, width, height } = surface, { uv, weights } = map;
  if (!cache) {
    for (let lens = 0; lens < 2; lens++) for (let index = 0; index < weights[lens].length; index++) {
      if (weights[lens][index] > 0) sampleAnalysisPixelsBilinear(pixels, width, height,
        uv[lens][index * 2], uv[lens][index * 2 + 1], colors[lens], index * 3);
    }
    return;
  }
  // The projection map is immutable and replaced when optics change. Retain
  // only its current sampling dimensions, never the surface or source pixels.
  if (map.sampling?.width !== width || map.sampling.height !== height) {
    const lenses = weights.map((weight, lens) => {
      let count = 0;
      for (let i = 0; i < weight.length; i++) if (weight[i] > 0) count++;
      const indices = new Uint32Array(count), taps = new Uint32Array(count * 4), fractions = new Float64Array(count * 2);
      for (let index = 0, next = 0; index < weight.length; index++) {
        if (!(weight[index] > 0)) continue;
        const x = clamp(uv[lens][index * 2] * width - .5, 0, width - 1),
          y = clamp(uv[lens][index * 2 + 1] * height - .5, 0, height - 1);
        const left = Math.floor(x), top = Math.floor(y), right = Math.min(width - 1, left + 1), bottom = Math.min(height - 1, top + 1);
        indices[next] = index * 3;
        taps[next * 4] = (top * width + left) * 4; taps[next * 4 + 1] = (top * width + right) * 4;
        taps[next * 4 + 2] = (bottom * width + left) * 4; taps[next * 4 + 3] = (bottom * width + right) * 4;
        fractions[next * 2] = x - left; fractions[next * 2 + 1] = y - top;
        next++;
      }
      return { indices, taps, fractions };
    });
    map.sampling = { width, height, lenses };
  }
  for (let lens = 0; lens < 2; lens++) {
    const { indices, taps, fractions } = map.sampling.lenses[lens], output = colors[lens];
    for (let i = 0; i < indices.length; i++) {
      const a = taps[i * 4], b = taps[i * 4 + 1], c = taps[i * 4 + 2], d = taps[i * 4 + 3], at = indices[i],
        tx = fractions[i * 2], ty = fractions[i * 2 + 1], inverseX = 1 - tx, inverseY = 1 - ty;
      // Keep horizontal-then-vertical interpolation and its original double
      // precision order, while exposing the three fixed channels to the JIT.
      const redTop = pixels[a] * inverseX + pixels[b] * tx,
        redBottom = pixels[c] * inverseX + pixels[d] * tx;
      output[at] = redTop * inverseY + redBottom * ty;
      const greenTop = pixels[a + 1] * inverseX + pixels[b + 1] * tx,
        greenBottom = pixels[c + 1] * inverseX + pixels[d + 1] * tx;
      output[at + 1] = greenTop * inverseY + greenBottom * ty;
      const blueTop = pixels[a + 2] * inverseX + pixels[b + 2] * tx,
        blueBottom = pixels[c + 2] * inverseX + pixels[d + 2] * tx;
      output[at + 2] = blueTop * inverseY + blueBottom * ty;
    }
  }
}


function sampleRemapAnalysis(remap, u, v) {
  if (!remap || !(remap.front instanceof Uint8Array) || !(remap.back instanceof Uint8Array)) return null;
  const sample = (pixels) => {
    const x = clamp(Math.round(u * (remap.width - 1)), 0, remap.width - 1);
    // Remap LUTs are uploaded without UNPACK_FLIP_Y_WEBGL, so WebGL samples
    // their typed-array rows from the opposite vertical direction.
    const y = clamp(Math.round((1 - v) * (remap.height - 1)), 0, remap.height - 1);
    const offset = (y * remap.width + x) * 4;
    return {
      uv: [pixels[offset] / 255, pixels[offset + 1] / 255],
      valid: pixels[offset + 2] > 127,
      confidence: pixels[offset + 3] / 255,
    };
  };
  return [sample(remap.front), sample(remap.back)];
}


function applyDualFisheyeSensorTiltCpu(point, tilt) {
  const cx = Math.cos(tilt[0]), sx = Math.sin(tilt[0]);
  const cy = Math.cos(tilt[1]), sy = Math.sin(tilt[1]);
  const rx = cy * point[0] + sy * sx * point[1] - sy * cx;
  const ry = cx * point[1] + sx;
  const rz = sy * point[0] - cy * sx * point[1] + cy * cx;
  const safeRz = Math.abs(rz) > 1e-6 ? rz : (rz < 0 ? -1e-6 : 1e-6);
  return [cx * (cy * rx + sy * rz) / safeRz, (cy * cx * ry - sx * rz) / safeRz];
}


function projectDualFisheyeLensCpu(dir, lens, maxTheta, useMEI, useDJI, radialScale, convergenceM = 0) {
  const local = useMEI && Array.isArray(lens.rotationQuat)
    ? (() => {
        const rotated = quatRotateVec3(
          { w: lens.rotationQuat[0], x: -lens.rotationQuat[1], y: -lens.rotationQuat[2], z: -lens.rotationQuat[3] },
          dir[0],
          dir[1],
          dir[2],
        );
        return [rotated.x, rotated.y, rotated.z];
      })()
    : [dot3(dir, lens.right), -dot3(dir, lens.up), dot3(dir, lens.axis)];
  if (useMEI && convergenceM > 0) {
    for (let axis = 0; axis < 3; axis += 1) local[axis] = local[axis] * convergenceM + (lens.translationM?.[axis] || 0);
    const length = length3(local);
    if (length <= 1e-9) return null;
    for (let axis = 0; axis < 3; axis += 1) local[axis] /= length;
  }
  const axisDot = local[2];
  const theta = useDJI ? Math.atan2(Math.hypot(local[0], local[1]), axisDot) : Math.acos(clamp(axisDot, -1, 1));
  if ((!useMEI && theta > maxTheta) || (useDJI && theta >= (96 * Math.PI) / 180)) return null;
  let uv;
  if (useMEI) {
    const denominator = local[2] + lens.xi;
    if (denominator <= 0.000001) return null;
    const x = local[0] / denominator;
    const y = local[1] / denominator;
    const r2 = x * x + y * y;
    if (r2 > 16) return null;
    const r4 = r2 * r2;
    const radialFactor = 1 + lens.radial[0] * r2 + lens.radial[1] * r4 + lens.radial[2] * r2 * r4 + lens.radial[3] * r4 * r4;
    const distorted = lens.distortionModel === "radtan_pro"
      ? applyDualFisheyeRadtanProCpu(x, y, lens.distortionCoeffs)
      : applyDualFisheyeSensorTiltCpu([
      x * radialFactor + 2 * lens.tangential[0] * x * y + lens.tangential[1] * (r2 + 2 * x * x) + lens.thinPrism[0] * r2 + lens.thinPrism[1] * r4,
      y * radialFactor + lens.tangential[0] * (r2 + 2 * y * y) + 2 * lens.tangential[1] * x * y + lens.thinPrism[2] * r2 + lens.thinPrism[3] * r4,
    ], lens.sensorTilt || [0, 0]);
    uv = [
      lens.center[0] + lens.principalOffset[0] + lens.focal[0] * distorted[0],
      lens.center[1] + lens.principalOffset[1] + lens.focal[1] * distorted[1],
    ];
  } else if (useDJI) {
    const rho = Math.hypot(local[0], local[1]);
    if (rho <= 0.000001) {
      uv = [lens.center[0] + lens.principalOffset[0], lens.center[1] + lens.principalOffset[1]];
    } else if (lens.distortionModel === 'dji_fisheye_5') {
      const t2 = theta * theta, k = lens.distortionCoeffs;
      const radius = theta * (1 + t2*(k[0]+t2*(k[1]+t2*(k[2]+t2*(k[3]+t2*k[4])))));
      const x = radius * local[0] / rho, y = radius * local[1] / rho;
      const r2 = x*x + y*y, [p1, p2] = lens.tangential;
      uv = [
        lens.center[0] + lens.principalOffset[0] + lens.focal[0] * (x + 2*p1*x*y + p2*(r2+2*x*x)),
        lens.center[1] + lens.principalOffset[1] + lens.focal[1] * (y + p1*(r2+2*y*y) + 2*p2*x*y),
      ];
    } else {
      const limit = (85 * Math.PI) / 180;
      const t = Math.min(theta, limit);
      const t2 = t * t;
      const polynomial = t * (1 + lens.radial[0] * t2 + lens.radial[1] * t2 * t2 + lens.radial[2] * t2 * t2 * t2 + lens.radial[3] * t2 * t2 * t2 * t2);
      const derivative = 1 + 3 * lens.radial[0] * t2 + 5 * lens.radial[1] * t2 * t2 + 7 * lens.radial[2] * t2 * t2 * t2 + 9 * lens.radial[3] * t2 * t2 * t2 * t2;
      const radius = radialScale * (theta > limit ? polynomial + derivative * (theta - limit) : polynomial);
      uv = [
        lens.center[0] + lens.principalOffset[0] + lens.focal[0] * radius * local[0] / rho,
        lens.center[1] + lens.principalOffset[1] + lens.focal[1] * radius * local[1] / rho,
      ];
    }
  } else {
    const radial3 = sub3(dir, lens.axis, axisDot);
    const radialLen = length3(radial3);
    const radialCoord = radialLen > 0.00001
      ? [dot3(radial3, lens.right) / radialLen, -dot3(radial3, lens.up) / radialLen]
      : [0, 0];
    // Match projectDistortedDualLens: focal is UV units per radian. scale
    // describes a radius only for the uncalibrated fallback, so it must not
    // replace focal when selecting a seam or comparing lens exposure.
    const theta2 = theta * theta;
    const radial = lens.radial || [0, 0, 0, 0];
    const distorted = theta * (1 + radial[0] * theta2 + radial[1] * theta2**2 + radial[2] * theta2**3 + radial[3] * theta2**4);
    const x = distorted * radialCoord[0], y = distorted * radialCoord[1];
    const r2 = x*x + y*y;
    const tangential = lens.tangential || [0, 0];
    const asymmetric = lens.asymmetric || [0, 0, 0, 0];
    const tx = 2*tangential[0]*x*y + tangential[1]*(r2+2*x*x);
    const ty = tangential[0]*(r2+2*y*y) + 2*tangential[1]*x*y;
    const ax = asymmetric[0]*x + asymmetric[1]*y;
    const ay = asymmetric[2]*x + asymmetric[3]*y;
    const focal = lens.focal || scaleDualFisheyeRadiusToFocal(lens.scale, maxTheta);
    const offset = lens.principalOffset || [0, 0];
    uv = [
      lens.center[0] + offset[0] + focal[0] * (x+tx+ax),
      lens.center[1] + offset[1] + focal[1] * (y+ty+ay),
    ];
  }
  if (!Number.isFinite(uv[0]) || !Number.isFinite(uv[1])) return null;
  const validRadius = lens.validRadius || [0.475, 0.475];
  const coverage = Math.max(1 - Math.hypot((uv[0] - lens.center[0]) / Math.max(0.0001, validRadius[0]), (uv[1] - lens.center[1]) / Math.max(0.0001, validRadius[1])), 0);
  if (coverage <= 0 || uv[0] < 0 || uv[1] < 0 || uv[0] > 1 || uv[1] > 1) return null;
  return { uv, confidence: coverage };
}


function applyDualFisheyeRadtanProCpu(x, y, d) {
  const r2 = x*x + y*y, r4 = r2*r2;
  const radial = 1 + d[0]*r2 + d[1]*r4 + d[2]*r2*r4 + d[3]*r4*r4 + d[4]*r4*r4*r2;
  const a = d[5] + d[7]*r2, b = d[6] + d[8]*r2;
  return [
    x*radial + (r2+2*x*x)*a + 2*x*y*b + d[9]*r2 + d[11]*r4,
    y*radial + (r2+2*y*y)*b + 2*x*y*a + d[10]*r2 + d[12]*r4,
  ];
}


function solveDualFisheyeSeamDP(costs, width, height, maxStep = 2, workspace = null) {
  const total = width * height;
  // Cumulative costs depend only on the preceding row. Keep the parent grid
  // for exact backtracking, while alternating two bounded cost rows.
  const dp = workspace?.dp?.length === width * 2 ? workspace.dp : new Float64Array(width * 2);
  const parents = workspace?.parents?.length === total ? workspace.parents : new Int16Array(total);
  if (workspace) { workspace.dp = dp; workspace.parents = parents; }
  let previousRow = 0, nextRow = width;
  for (let x = 0; x < width; x += 1) dp[x] = costs[x] < 65535 ? costs[x] : Number.POSITIVE_INFINITY;
  for (let y = 1; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const current = costs[row + x];
      if (!Number.isFinite(current) || current >= 65535) {
        dp[nextRow + x] = Number.POSITIVE_INFINITY;
        continue;
      }
      let best = Number.POSITIVE_INFINITY;
      let bestX = -1;
      const low = Math.max(0, x - maxStep);
      const high = Math.min(width - 1, x + maxStep);
      for (let previousX = low; previousX <= high; previousX += 1) {
        const candidate = dp[previousRow + previousX];
        if (candidate < best) {
          best = candidate;
          bestX = previousX;
        }
      }
      dp[nextRow + x] = best + current;
      // Every cell in a finite final path has an assigned parent. Unreachable
      // cells remain infinite and cannot enter backtracking, so no fill is needed.
      if (bestX >= 0) parents[row + x] = bestX;
    }
    const finishedRow = previousRow;
    previousRow = nextRow; nextRow = finishedRow;
  }
  let endX = 0;
  let bestCost = dp[previousRow];
  for (let x = 1; x < width; x += 1) {
    if (dp[previousRow + x] < bestCost) {
      bestCost = dp[previousRow + x];
      endX = x;
    }
  }
  if (!Number.isFinite(bestCost)) return null;
  const seam = new Array(height);
  seam[height - 1] = endX;
  for (let y = height - 1; y > 0; y -= 1) {
    const previousX = parents[y * width + seam[y]];
    if (previousX < 0) return null;
    seam[y - 1] = previousX;
  }
  return { seam, cost: bestCost };
}


function featherDualFisheyeSeamMask(mask) {
  const feathered = mask.slice();
  for (let y = 0; y < ANALYSIS_HEIGHT; y += 1) {
    for (let x = 0; x < ANALYSIS_WIDTH; x += 1) {
      const index = y * ANALYSIS_WIDTH + x;
      const value = mask[index];
      if (value !== 0 && value !== 255) continue;
      const left = mask[y * ANALYSIS_WIDTH + (x > 0 ? x - 1 : ANALYSIS_WIDTH - 1)];
      const right = mask[y * ANALYSIS_WIDTH + (x + 1 < ANALYSIS_WIDTH ? x + 1 : 0)];
      if (left === 255 - value || right === 255 - value) feathered[index] = value === 0 ? 64 : 191;
    }
  }
  return feathered;
}


function buildDualFisheyeSeamMask(weights, left, right) {
  const hard = new Uint8Array(ANALYSIS_WIDTH * ANALYSIS_HEIGHT);
  for (let y = 0; y < ANALYSIS_HEIGHT; y += 1) {
    let useBack = weights[1][y * ANALYSIS_WIDTH] > weights[0][y * ANALYSIS_WIDTH];
    for (let x = 0; x < ANALYSIS_WIDTH; x += 1) {
      if (x === left[y] || x === right[y]) useBack = !useBack;
      hard[y * ANALYSIS_WIDTH + x] = useBack ? 255 : 0;
    }
  }
  return featherDualFisheyeSeamMask(hard);
}


function protectDualFisheyeDisplacedContent(mask, colors, weights, gains) {
  if (!mask) return null;
  const votes = [new Float32Array(mask.length), new Float32Array(mask.length)];
  for (let y = 0; y < ANALYSIS_HEIGHT; y += 1) for (let x = 0; x < ANALYSIS_WIDTH; x += 1) {
    const index = y * ANALYSIS_WIDTH + x;
    if (weights[0][index] <= 0 || weights[1][index] <= 0) continue;
    const winner = weights[0][index] > weights[1][index] ? 0 : 1;
    const other = 1 - winner;
    if (weights[winner][index] < weights[other][index] * 1.5) continue;
    const at = index * 3;
    const own = colors[winner], opposite = colors[other], ownGain = gains[winner], otherGain = gains[other];
    const red = own[at] * ownGain, green = own[at + 1] * ownGain, blue = own[at + 2] * ownGain;
    // Preserve the per-channel divisions and left-to-right addition order.
    // Reuse gained RGB and defer luminance until the mismatch can seed a vote.
    const mismatch = Math.abs(red - opposite[at] * otherGain) / 3 +
      Math.abs(green - opposite[at + 1] * otherGain) / 3 + Math.abs(blue - opposite[at + 2] * otherGain) / 3;
    // A displaced coat or hand is not necessarily black. Where the views
    // disagree strongly, the lens with more sensor support provides a seed
    // for coherent local ownership. Never seed from a black obstruction.
    if (mismatch < 32 || red * .2126 + green * .7152 + blue * .0722 < 24) continue;
    const support = (weights[winner][index] - weights[other][index]) * Math.min(1, mismatch / 64);
    // Include neighboring features so a boundary cannot pass between an eye
    // and its forehead simply because their individual colors happen to match.
    for (let dy = -2; dy <= 2; dy += 1) {
      const row = y + dy;
      if (row < 0 || row >= ANALYSIS_HEIGHT) continue;
      for (let dx = -2; dx <= 2; dx += 1) {
        const column = (x + dx + ANALYSIS_WIDTH) % ANALYSIS_WIDTH;
        votes[winner][row * ANALYSIS_WIDTH + column] += support * (3 - Math.max(Math.abs(dx), Math.abs(dy)));
      }
    }
  }
  const protectedMask = mask.slice();
  for (let index = 0; index < mask.length; index += 1) {
    const winner = votes[0][index] > votes[1][index] ? 0 : 1;
    if (weights[winner][index] <= 0 || votes[winner][index] < .05 || votes[winner][index] < votes[1 - winner][index] * 2) continue;
    if (weights[1 - winner][index] > 0) {
      const at = index * 3, own = colors[winner], ownGain = gains[winner];
      const winnerLuma = own[at] * ownGain * .2126 + own[at + 1] * ownGain * .7152 + own[at + 2] * ownGain * .0722;
      // Only a dark candidate can be a black obstruction. Keep gain before
      // each luma coefficient, and read the opposite lens only in that case.
      if (winnerLuma < 12) {
        const opposite = colors[1 - winner], otherGain = gains[1 - winner];
        const otherLuma = opposite[at] * otherGain * .2126 + opposite[at + 1] * otherGain * .7152 + opposite[at + 2] * otherGain * .0722;
        if (otherLuma > 24 && winnerLuma < otherLuma * .25) continue;
      }
    }
    protectedMask[index] = winner === 0 ? 0 : 255;
  }
  return protectedMask;
}


function buildDualFisheyeContentSupport(colors, weights, gains) {
  const support = new Uint8Array(ANALYSIS_WIDTH * ANALYSIS_HEIGHT);
  for (let y = 0; y < ANALYSIS_HEIGHT; y++) for (let x = 0; x < ANALYSIS_WIDTH; x++) {
    const index = y * ANALYSIS_WIDTH + x;
    if (weights[0][index] <= 0 || weights[1][index] <= 0) continue;
    let difference = 0;
    for (let channel = 0; channel < 3; channel++) {
      const at = index * 3 + channel;
      difference += Math.abs(colors[0][at] * gains[0] - colors[1][at] * gains[1]) / 3;
    }
    const strength = Math.round(clamp((difference - 12) / 24, 0, 1) * 255);
    if (!strength) continue;
    // A displaced edge and the matching interior belong to the same object.
    // Expand local evidence so low-contrast mirror surfaces do not switch
    // back to the geometric seam inside an otherwise coherent foreground.
    for (let dy = -2; dy <= 2; dy++) {
      const row = y + dy;
      if (row < 0 || row >= ANALYSIS_HEIGHT) continue;
      for (let dx = -2; dx <= 2; dx++) {
        const column = (x + dx + ANALYSIS_WIDTH) % ANALYSIS_WIDTH;
        const target = row * ANALYSIS_WIDTH + column;
        support[target] = Math.max(support[target], strength);
      }
    }
  }
  return support;
}


function dualFisheyeContrastSampleCounts(weights) {
  const width = ANALYSIS_WIDTH, height = ANALYSIS_HEIGHT, counts = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = y * width + x;
    if (!(weights[at] > 0)) continue;
    let valid = 0;
    for (let row = Math.max(0, y - 2); row <= Math.min(height - 1, y + 2); row++)
      for (let dx = -2; dx <= 2; dx++) if (weights[row * width + (x + dx + width) % width] > 0) valid++;
    counts[at] = valid;
  }
  return counts;
}


function dualFisheyeCachedLocalContrast(values, weights, sampleCounts) {
  const width = ANALYSIS_WIDTH, height = ANALYSIS_HEIGHT;
  const sums = new Float64Array(width * 5), columns = new Float64Array(width);
  const result = new Float32Array(width * height);
  // Coverage is immutable with the projection. Reuse only its denominators;
  // current Float64 sums keep the uncached ring's exact arithmetic order.
  for (let y = 0; y < height; y++) {
    const row = y * width, slot = (y % 5) * width, outputRow = (y - 2) * width;
    let sum = 0;
    for (let dx = -2; dx <= 2; dx++) {
      const at = row + (dx + width) % width;
      if (weights[at] > 0) sum += values[at];
    }
    for (let x = 0; x < width; x++) {
      let columnSum = columns[x];
      if (y >= 5) columnSum -= sums[slot + x];
      sums[slot + x] = sum;
      columnSum += sum;
      columns[x] = columnSum;
      if (y >= 2) {
        const at = outputRow + x;
        if (weights[at] > 0) result[at] = Math.abs(values[at] - columnSum / Math.max(sampleCounts[at], 1));
      }
      const leave = row + (x + width - 2) % width, enter = row + (x + 3) % width;
      if (weights[leave] > 0) sum -= values[leave];
      if (weights[enter] > 0) sum += values[enter];
    }
  }
  for (let y = height - 2; y < height; y++) {
    const row = y * width, leave = ((y - 3) % 5) * width;
    for (let x = 0; x < width; x++) {
      const sum = columns[x] - sums[leave + x];
      columns[x] = sum;
      const at = row + x;
      if (weights[at] > 0) result[at] = Math.abs(values[at] - sum / Math.max(sampleCounts[at], 1));
    }
  }
  return result;
}


function dualFisheyeLocalContrast(values, weights, sampleCounts = null) {
  if (sampleCounts) return dualFisheyeCachedLocalContrast(values, weights, sampleCounts);
  const width = ANALYSIS_WIDTH, height = ANALYSIS_HEIGHT, count = width * height;
  const sums = new Float64Array(width * 5), samples = new Uint8Array(width * 5);
  const columns = new Float64Array(width), validColumns = new Uint8Array(width);
  const result = new Float32Array(count);
  // Stream five horizontal rows through the vertical window. Keep each
  // column's original addition/subtraction order; only longitude wraps.
  for (let y = 0; y < height; y++) {
    const row = y * width, slot = (y % 5) * width, outputRow = (y - 2) * width;
    let sum = 0, valid = 0;
    for (let dx = -2; dx <= 2; dx++) {
      const at = row + (dx + width) % width;
      if (weights[at] > 0) { sum += values[at]; valid++; }
    }
    for (let x = 0; x < width; x++) {
      let columnSum = columns[x], columnCount = validColumns[x];
      // Retire the old row before its ring slot receives the entering row.
      if (y >= 5) { columnSum -= sums[slot + x]; columnCount -= samples[slot + x]; }
      sums[slot + x] = sum; samples[slot + x] = valid;
      columnSum += sum; columnCount += valid;
      columns[x] = columnSum; validColumns[x] = columnCount;
      if (y >= 2) {
        const at = outputRow + x;
        if (weights[at] > 0) result[at] = Math.abs(values[at] - columnSum / Math.max(columnCount, 1));
      }
      const leave = row + (x + width - 2) % width, enter = row + (x + 3) % width;
      if (weights[leave] > 0) { sum -= values[leave]; valid--; }
      if (weights[enter] > 0) { sum += values[enter]; valid++; }
    }
  }
  // The final two neighborhoods clip at the pole and have no entering row.
  for (let y = height - 2; y < height; y++) {
    const row = y * width, leave = ((y - 3) % 5) * width;
    for (let x = 0; x < width; x++) {
      const sum = columns[x] - sums[leave + x], valid = validColumns[x] - samples[leave + x];
      columns[x] = sum; validColumns[x] = valid;
      const at = row + x;
      if (weights[at] > 0) result[at] = Math.abs(values[at] - sum / Math.max(valid, 1));
    }
  }
  return result;
}


function dilateDualFisheyeForegroundSeeds(seeds) {
  const width = ANALYSIS_WIDTH, height = ANALYSIS_HEIGHT, words = width >>> 5;
  const regions = new Uint8Array(width * height);
  // Combine three seed rows, then expand their bits horizontally. Word-edge
  // carries wrap within a longitude row; the two polar rows stay separate.
  for (let y = 2; y < height - 2; y++) for (let word = 0; word < words; word++) {
    const row = (y - 1) * words, at = row + word,
      left = row + (word + words - 1) % words, right = row + (word + 1) % words;
    const center = seeds[at] | seeds[at + words] | seeds[at + words * 2],
      before = seeds[left] | seeds[left + words] | seeds[left + words * 2],
      after = seeds[right] | seeds[right + words] | seeds[right + words * 2];
    let bits = center | (center << 1) | (center >>> 1) | (before >>> 31) | (after << 31);
    while (bits) {
      const bit = 31 - Math.clz32(bits & -bits);
      regions[y * width + word * 32 + bit] = 1;
      bits &= bits - 1;
    }
  }
  return regions;
}


function protectDualFisheyeForegroundRegions(mask, colors, weights, gains, map = null) {
  const width = ANALYSIS_WIDTH, height = ANALYSIS_HEIGHT, count = width * height;
  const gray = colors.map((color, lens) => {
    const values = new Float32Array(count), gain = gains[lens];
    // Keep the original gain order and Float32 rounding used by region votes,
    // without the indexed-object reads and callback for every typed-array item.
    for (let index = 0; index < count; index++) {
      const at = index * 3;
      values[index] = (color[at] * .2126 + color[at + 1] * .7152 + color[at + 2] * .0722) * gain;
    }
    return values;
  });
  const sampleCounts = map ? (map.contrastSampleCounts ||= weights.map(dualFisheyeContrastSampleCounts)) : null;
  const contrast = gray.map((values, lens) => dualFisheyeLocalContrast(values, weights[lens], sampleCounts?.[lens]));
  const seeds = new Uint32Array(count >>> 5);
  for (let index = 0; index < count; index++) {
    if (weights[0][index] <= 0 || weights[1][index] <= 0 ||
      Math.abs(gray[0][index] - gray[1][index]) < 12 || Math.max(contrast[0][index], contrast[1][index]) < 12) continue;
    // Join an edge to its low-contrast interior and narrow attachments. The
    // poles retain their separate coherent-cap policy below.
    seeds[index >>> 5] |= 1 << (index & 31);
  }
  const regions = dilateDualFisheyeForegroundSeeds(seeds);
  const result = mask.slice(), queue = new Int32Array(count);
  for (let index = 0; index < count; index++) {
    if (regions[index] !== 1) continue;
    let length = 1;
    queue[0] = index; regions[index] = 2;
    const scores = [0, 0];
    for (let head = 0; head < length; head++) {
      const at = queue[head], x = at % width, y = Math.floor(at / width);
      // Dilated matching background connects the feature but must not vote:
      // its larger sensor area could otherwise discard a nearby face.
      if (weights[0][at] > 0 && weights[1][at] > 0 && Math.abs(gray[0][at] - gray[1][at]) >= 12) {
        for (let lens = 0; lens < 2; lens++) scores[lens] += contrast[lens][at] * weights[lens][at] ** 2;
      }
      for (const next of [y > 2 ? at - width : -1, y < height - 3 ? at + width : -1,
        y * width + (x + width - 1) % width, y * width + (x + 1) % width]) {
        if (next < 0 || regions[next] !== 1) continue;
        regions[next] = 2; queue[length++] = next;
      }
    }
    const winner = scores[0] > scores[1] ? 0 : 1, other = 1 - winner;
    // Use the complete visible feature to choose its lens. Per-pixel sensor
    // preference can otherwise cut a stem, eye or forehead halfway through.
    if (scores[winner] <= 0 || scores[winner] < scores[other] * 1.15) continue;
    for (let at = 0; at < length; at++) {
      const target = queue[at];
      if (weights[winner][target] <= 0) continue;
      if (gray[winner][target] < 4 && gray[other][target] > 24) continue;
      result[target] = winner === 0 ? 0 : 255;
    }
  }
  return result;
}


function djiSoftwareAnalysisRoundingBias() {
  // Canvas implementations can truncate or round half-size filtering. Probe
  // the same CPU-canvas path once instead of assuming a browser's byte rules.
  const make = (width, height) => typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
  const source = make(32, 2), target = make(16, 1);
  try {
    const input = source.getContext('2d', { willReadFrequently: true });
    const output = target.getContext('2d', { willReadFrequently: true });
    if (!input || !output) return null;
    const image = input.createImageData(32, 2);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 32; x++) {
      const block = x >> 1, at = (y * 32 + x) * 4;
      for (let c = 0; c < 3; c++) image.data[at + c] = block * 13 + c * 5 +
        (y === 0 && x % 2 === 0 ? (block + c) % 4 : 0);
      image.data[at + 3] = 255;
    }
    input.putImageData(image, 0, 0); output.drawImage(source, 0, 0, 16, 1);
    const pixels = output.getImageData(0, 0, 16, 1).data;
    for (const bias of [0, 2]) {
      let matches = true;
      for (let x = 0; x < 16; x++) for (let c = 0; c < 3; c++)
        if (pixels[x * 4 + c] !== ((4 * (x * 13 + c * 5) + (x + c) % 4 + bias) >> 2)) matches = false;
      if (matches) return bias;
    }
    return null;
  } catch { return null; }
  finally { source.width = source.height = target.width = target.height = 0; }
}


function dualFisheyeSoftwareSamples(map, nativeMask = 0) {
  const needed = new Uint8Array(1024 * 512);
  if (!map) needed.fill(1);
  else {
    // Keep every sample used by the existing local 8x8 change detector.
    for (let y = 0; y < 512; y += 2) for (let x = 0; x < 1024; x += 2) needed[y * 1024 + x] = 1;
    for (let lens = 0; lens < 2; lens++) for (let i = 0; i < map.weights[lens].length; i++) {
      if (map.weights[lens][i] <= 0) continue;
      const x = clamp(map.uv[lens][i * 2] * 1024 - .5, 0, 1023);
      const y = clamp(map.uv[lens][i * 2 + 1] * 512 - .5, 0, 511);
      const left = Math.floor(x), top = Math.floor(y), right = Math.min(1023, left + 1), bottom = Math.min(511, top + 1);
      needed[top * 1024 + left] = needed[top * 1024 + right] = 1;
      needed[bottom * 1024 + left] = needed[bottom * 1024 + right] = 1;
    }
  }
  const counts = [0, 0];
  for (let i = 0; i < needed.length; i++) if (needed[i]) counts[(i >> 9) & 1]++;
  const targets = counts.map(count => new Uint32Array(count));
  counts.fill(0);
  // Put the regular change-probe grid first. Native-size software frames can
  // walk it directly; only the remaining bilinear taps need indexed targets.
  if (map) for (let lens = 0; lens < 2; lens++) if (nativeMask & (1 << lens))
    for (let y = 0; y < 512; y += 2) for (let x = 0; x < 512; x += 2)
      targets[lens][counts[lens]++] = (y * 1024 + lens * 512 + x) * 4;
  for (let i = 0; i < needed.length; i++) if (needed[i]) {
    const lens = (i >> 9) & 1;
    if (map && (nativeMask & (1 << lens)) && (i & 1025) === 0) continue;
    targets[lens][counts[lens]++] = i * 4;
  }
  return targets;
}


function createDJISoftwareAnalysisSurface(frames, cache, previous = null, map = null) {
  if (frames?.length !== 2 || frames.some(frame => !frame || frame.width < 1024 || frame.width !== frame.height ||
    !ArrayBuffer.isView(frame.data) || frame.data.length !== frame.width * frame.height * 4 ||
    (frame.colorSpace && frame.colorSpace !== 'srgb'))) return null;
  if (cache.bias === undefined) cache.bias = djiSoftwareAnalysisRoundingBias();
  if (cache.bias === null) return null;
  const bias = cache.bias;
  const nativeMask = Number(frames[0].width === 1024) | (Number(frames[1].width === 1024) << 1);
  if (!cache.selection || cache.selection.map !== map) {
    cache.selection = { map, nativeMask, targets: dualFisheyeSoftwareSamples(map, nativeMask) };
    cache.buffers = []; cache.plans = [];
  } else if (cache.selection.nativeMask !== nativeMask) {
    // Keep non-native source reads in their original row-major order. A size
    // switch replaces the target lists, without changing the accepted pixels.
    cache.selection = { map, nativeMask, targets: dualFisheyeSoftwareSamples(map, nativeMask) };
  }
  // Reproduce ImageData -> nearest 1024-square lens -> packed canvas ->
  // half-size bilinear readback, including the probed byte rounding rule.
  // Two buffers preserve the last accepted frame through unchanged probes.
  const buffers = cache.buffers ||= [];
  const slot = previous?.pixels === buffers[0] ? 1 : 0;
  const pixels = buffers[slot] ||= new Uint8ClampedArray(1024 * 512 * 4);
  const packedPixels = new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.byteLength / 4);
  const packedBias = bias * 0x00010001;
  const byteBias = bias * 0x01010101;
  const plans = cache.plans ||= [];
  for (let lens = 0; lens < 2; lens++) {
    const frame = frames[lens], data = frame.data, width = frame.width;
    const targets = cache.selection.targets[lens];
    const nativeSize = width === 1024;
    let plan = plans[lens];
    if (plan?.width !== width) {
      if (nativeSize) {
        plan = plans[lens] = { width };
      } else {
        const offsets = Uint32Array.from({ length: 1024 }, (_, x) => Math.floor(x * width / 1024));
        const origins = new Uint32Array(targets.length);
        const columns = new Uint32Array(512), rows = new Uint32Array(512);
        // The other three neighbors share row/column deltas. Retain one pixel
        // address per sample instead of four component addresses, at any size.
        for (let i = 0; i < 512; i++) {
          const delta = offsets[i * 2 + 1] - offsets[i * 2];
          columns[i] = delta; rows[i] = delta * width;
        }
        for (let i = 0; i < targets.length; i++) {
          const pixel = targets[i] >>> 2, x = pixel & 511, y = pixel >>> 10;
          origins[i] = offsets[y * 2] * width + offsets[x * 2];
        }
        plan = plans[lens] = { width, origins, columns, rows };
      }
    }
    const { origins, columns, rows } = plan;
    // Native-endian word reads and writes preserve RGBA order on either
    // endian. Only the alpha validation needs a host-specific channel mask.
    const packed = (data instanceof Uint8Array || data instanceof Uint8ClampedArray) && data.byteOffset % 4 === 0
      ? new Uint32Array(data.buffer, data.byteOffset, data.byteLength / 4) : null;
    if (packed) {
      if (nativeSize) {
        // Each byte's high six bits sum to at most 252 after division by four.
        // The low two bits plus rounding bias sum to at most 14. Neither sum
        // carries into its neighbor, and their final sum is the exact average.
        if (map) for (let y = 0; y < 512; y += 2) {
          const end = y * 2048 + 1024;
          // The fixed grid has 256 probes per row. Handle two independent
          // blocks per iteration while preserving each block's alpha check.
          for (let left = y * 2048, target = y * 1024 + lens * 512; left < end; left += 8, target += 4) {
            const a = packed[left], b = packed[left + 1], c = packed[left + 1024], d = packed[left + 1025];
            if ((a & b & c & d & ANALYSIS_RGBA_ALPHA_MASK) !== ANALYSIS_RGBA_ALPHA_MASK) return null;
            const high = ((a & 0xfcfcfcfc) >>> 2) + ((b & 0xfcfcfcfc) >>> 2) +
              ((c & 0xfcfcfcfc) >>> 2) + ((d & 0xfcfcfcfc) >>> 2);
            const low = (((a & 0x03030303) + (b & 0x03030303) + (c & 0x03030303) + (d & 0x03030303) + byteBias) >>> 2) & 0x03030303;
            packedPixels[target] = high + low;
            const a2 = packed[left + 4], b2 = packed[left + 5], c2 = packed[left + 1028], d2 = packed[left + 1029];
            if ((a2 & b2 & c2 & d2 & ANALYSIS_RGBA_ALPHA_MASK) !== ANALYSIS_RGBA_ALPHA_MASK) return null;
            const high2 = ((a2 & 0xfcfcfcfc) >>> 2) + ((b2 & 0xfcfcfcfc) >>> 2) +
              ((c2 & 0xfcfcfcfc) >>> 2) + ((d2 & 0xfcfcfcfc) >>> 2);
            const low2 = (((a2 & 0x03030303) + (b2 & 0x03030303) + (c2 & 0x03030303) + (d2 & 0x03030303) + byteBias) >>> 2) & 0x03030303;
            packedPixels[target + 2] = high2 + low2;
          }
        }
        // Output bit 9 selects the packed lens. Remove it, then double the
        // remaining position to recover (2*y, 2*x) in a 1024-square source.
        // No source address table is needed at this size.
        for (let i = map ? 65536 : 0; i < targets.length; i++) {
          const target = targets[i] >>> 2, left = (target & ~512) * 2, right = left + 1;
          const a = packed[left], b = packed[right], c = packed[left + 1024], d = packed[right + 1024];
          if ((a & b & c & d & ANALYSIS_RGBA_ALPHA_MASK) !== ANALYSIS_RGBA_ALPHA_MASK) return null;
          const high = ((a & 0xfcfcfcfc) >>> 2) + ((b & 0xfcfcfcfc) >>> 2) +
            ((c & 0xfcfcfcfc) >>> 2) + ((d & 0xfcfcfcfc) >>> 2);
          const low = (((a & 0x03030303) + (b & 0x03030303) + (c & 0x03030303) + (d & 0x03030303) + byteBias) >>> 2) & 0x03030303;
          packedPixels[target] = high + low;
        }
        continue;
      }
      // For multiples of 512 (including 1024/1536/2048), every nearest
      // source pair has the same separation. Hoist both neighbor deltas
      // instead of looking up row and column tables for each sampled pixel.
      if (width % 512 === 0) {
        const across = Math.floor(width / 1024), down = across * width;
        for (let i = 0; i < targets.length; i++) {
          const target = targets[i] >>> 2, left = origins[i], right = left + across;
          const a = packed[left], b = packed[right], c = packed[left + down], d = packed[right + down];
          if ((a & b & c & d & ANALYSIS_RGBA_ALPHA_MASK) !== ANALYSIS_RGBA_ALPHA_MASK) return null;
          const even = (a & 0x00ff00ff) + (b & 0x00ff00ff) + (c & 0x00ff00ff) + (d & 0x00ff00ff) + packedBias;
          const odd = ((a >>> 8) & 0x00ff00ff) + ((b >>> 8) & 0x00ff00ff) +
            ((c >>> 8) & 0x00ff00ff) + ((d >>> 8) & 0x00ff00ff) + packedBias;
          packedPixels[target] = ((even >>> 2) & 0x00ff00ff) | (((odd >>> 2) & 0x00ff00ff) << 8);
        }
        continue;
      }
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i] >>> 2;
        const left = origins[i], right = left + columns[target & 511], down = rows[target >>> 10];
        const a = packed[left], b = packed[right], c = packed[left + down], d = packed[right + down];
        if ((a & b & c & d & ANALYSIS_RGBA_ALPHA_MASK) !== ANALYSIS_RGBA_ALPHA_MASK) return null;
        const even = (a & 0x00ff00ff) + (b & 0x00ff00ff) + (c & 0x00ff00ff) + (d & 0x00ff00ff) + packedBias;
        const odd = ((a >>> 8) & 0x00ff00ff) + ((b >>> 8) & 0x00ff00ff) +
          ((c >>> 8) & 0x00ff00ff) + ((d >>> 8) & 0x00ff00ff) + packedBias;
        packedPixels[target] = ((even >>> 2) & 0x00ff00ff) | (((odd >>> 2) & 0x00ff00ff) << 8);
      }
      continue;
    }
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i], pixel = target >>> 2;
      const a = (nativeSize ? (pixel & ~512) * 2 : origins[i]) * 4;
      const b = a + (nativeSize ? 1 : columns[pixel & 511]) * 4, down = (nativeSize ? 1024 : rows[pixel >>> 10]) * 4;
      const c = a + down, d = b + down;
      // Let canvas handle premultiplication or color conversion when the
      // decoder did not supply the ordinary opaque sRGB video format.
      if ((data[a + 3] & data[b + 3] & data[c + 3] & data[d + 3]) !== 255) return null;
      for (let channel = 0; channel < 3; channel++)
        pixels[target + channel] = (data[a + channel] + data[b + channel] + data[c + channel] + data[d + channel] + bias) >> 2;
      pixels[target + 3] = 255;
    }
  }
  return { pixels, width: 1024, height: 512 };
}


function createSeamAnalysisSurface(mediaEl, maxSize = SOURCE_ANALYSIS_SIZE, cache = null) {
  const sourceSize = getMediaTextureSize(mediaEl);
  const scale = Math.min(1, maxSize / Math.max(sourceSize.width, sourceSize.height));
  const width = Math.max(1, Math.round(sourceSize.width * scale));
  const height = Math.max(1, Math.round(sourceSize.height * scale));
  const surface = cache?.readback?.surface || (typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement("canvas"), { width, height }));
  if (surface.width !== width) surface.width = width;
  if (surface.height !== height) surface.height = height;
  const context = cache?.readback?.context || surface.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  if (cache) cache.readback = { surface, context };
  context.clearRect?.(0, 0, width, height);
  // ImageBitmap ignores GL's UNPACK_FLIP_Y_WEBGL. Some textures are flipped
  // during decode, so restore source rows before CPU seam sampling.
  const flipped = flippedBoundedImageBitmaps.has(mediaEl);
  if (flipped) {
    context.save();
    context.translate(0, height);
    context.scale(1, -1);
  }
  context.drawImage(mediaEl, 0, 0, width, height);
  if (flipped) context.restore();
  return { pixels: context.getImageData(0, 0, width, height).data, width, height };
}


// Rectify each overlap separately. Normalized patches tolerate lens exposure
// differences; consensus rejects water, moving subjects and repeated edges.
function matchX5VideoSeam(front, back) {
  const { width, height } = front;
  if (back.width !== width || back.height !== height) return null;
  const radius = 3, area = 49, searchX = 64, searchY = 6;
  const statistics = (grid) => {
    const stride = width + 1;
    const sums = new Float64Array(stride * (height + 1));
    const squares = new Float64Array(sums.length);
    const valid = new Uint32Array(sums.length);
    for (let y = 0; y < height; y += 1) {
      let sum = 0, square = 0, count = 0;
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x, target = (y + 1) * stride + x + 1;
        const value = grid.gray[index];
        sum += value; square += value * value; count += grid.valid[index];
        sums[target] = sums[target - stride] + sum;
        squares[target] = squares[target - stride] + square;
        valid[target] = valid[target - stride] + count;
      }
    }
    const means = new Float32Array(width * height);
    const energies = new Float32Array(means.length);
    for (let y = radius; y < height - radius; y += 1) {
      for (let x = radius; x < width - radius; x += 1) {
        const index = y * width + x;
        // Integral rectangles have independent row and column corners.
        const a = (y - radius) * stride + x - radius;
        const b = (y - radius) * stride + x + radius + 1;
        const c = (y + radius + 1) * stride + x - radius;
        const d = (y + radius + 1) * stride + x + radius + 1;
        if (valid[d] - valid[b] - valid[c] + valid[a] !== area) continue;
        const sum = sums[d] - sums[b] - sums[c] + sums[a];
        means[index] = sum / area;
        energies[index] = Math.max(0, squares[d] - squares[b] - squares[c] + squares[a] - sum * sum / area);
      }
    }
    return { means, energies };
  };
  const frontStats = statistics(front), backStats = statistics(back);
  const corners = [];
  for (let y = 10; y < height - 10; y += 2) {
    for (let x = searchX + radius + 5; x < width - searchX - radius - 5; x += 2) {
      const index = y * width + x;
      if (frontStats.energies[index] < area * 9) continue;
      let xx = 0, xy = 0, yy = 0;
      for (let row = -1; row <= 1; row += 1) {
        for (let column = -1; column <= 1; column += 1) {
          const offset = index + row * width + column;
          const gx = front.gray[offset + 1] - front.gray[offset - 1];
          const gy = front.gray[offset + width] - front.gray[offset - width];
          xx += gx * gx; xy += gx * gy; yy += gy * gy;
        }
      }
      const score = (xx + yy - Math.hypot(xx - yy, 2 * xy)) / 2;
      if (score > 1) corners.push({ x, y, score });
    }
  }
  corners.sort((a, b) => b.score - a.score);
  const features = [];
  for (const corner of corners) {
    if (features.some((other) => Math.abs(other.x - corner.x) < 7 && Math.abs(other.y - corner.y) < 7)) continue;
    features.push(corner);
    if (features.length === 48) break;
  }
  const matches = [];
  const scoreWidth = searchX * 2 + 1;
  for (const { x, y } of features) {
    const origin = y * width + x;
    const template = [];
    for (let row = -radius; row <= radius; row += 1) {
      for (let column = -radius; column <= radius; column += 1) {
        template.push(front.gray[origin + row * width + column] - frontStats.means[origin]);
      }
    }
    const correlation = (dx, dy) => {
      const target = (y + dy) * width + x + dx;
      if (backStats.energies[target] < area * 9) return -1;
      let sum = 0, index = 0;
      for (let row = -radius; row <= radius; row += 1) {
        for (let column = -radius; column <= radius; column += 1) {
          sum += template[index++] * back.gray[target + row * width + column];
        }
      }
      return sum / Math.sqrt(frontStats.energies[origin] * backStats.energies[target]);
    };
    const scores = new Float32Array(scoreWidth * (searchY * 2 + 1));
    let best = -1, bestX = 0, bestY = 0;
    for (let dy = -searchY; dy <= searchY; dy += 1) {
      for (let dx = -searchX; dx <= searchX; dx += 1) {
        const value = correlation(dx, dy);
        scores[(dy + searchY) * scoreWidth + dx + searchX] = value;
        if (value > best) { best = value; bestX = dx; bestY = dy; }
      }
    }
    if (best < .85 || Math.abs(bestX) === searchX || Math.abs(bestY) === searchY) continue;
    let second = -1;
    for (let dy = -searchY; dy <= searchY; dy += 1) {
      for (let dx = -searchX; dx <= searchX; dx += 1) {
        if (Math.abs(dx - bestX) <= 3 && Math.abs(dy - bestY) <= 2) continue;
        second = Math.max(second, scores[(dy + searchY) * scoreWidth + dx + searchX]);
      }
    }
    if (best - second < .015) continue;
    const refine = (a, b, c) => Math.abs(a - 2 * b + c) > 1e-6
      ? clamp(.5 * (a - c) / (a - 2 * b + c), -.5, .5) : 0;
    matches.push({
      dx: bestX + refine(correlation(bestX - 1, bestY), best, correlation(bestX + 1, bestY)),
      dy: bestY + refine(correlation(bestX, bestY - 1), best, correlation(bestX, bestY + 1)),
      y, gainRatio: backStats.means[(y + bestY) * width + x + bestX] / Math.max(1, frontStats.means[origin]),
    });
  }
  let inliers = [];
  for (const candidate of matches) {
    const support = matches.filter((match) => Math.abs(match.dx - candidate.dx) < 3 && Math.abs(match.dy - candidate.dy) < 1.5);
    if (support.length > inliers.length) inliers = support;
  }
  if (inliers.length < Math.max(6, matches.length * .35) ||
    Math.max(...inliers.map((match) => match.y)) - Math.min(...inliers.map((match) => match.y)) < 24) return null;
  const median = (values) => {
    values.sort((a, b) => a - b);
    return (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2;
  };
  return { dx: median(inliers.map((match) => match.dx)), dy: median(inliers.map((match) => match.dy)),
    gainRatio: median(inliers.map((match) => match.gainRatio)), inliers: inliers.length };
}


function x5VideoLensRadius(lens) {
  const [x, y] = lens.center;
  const tileStart = x < .5 ? 0 : .5;
  return [Math.min(.25, x - tileStart, tileStart + .5 - x), Math.min(.5, y, 1 - y)];
}


function registerDualFisheyeOverlaps(surface, options, lenses, textureOrigin) {
  const width = 193, height = 241, offsets = [], ratios = [];
  for (const seam of [-90, 90]) {
    const strips = lenses.map(() => ({ width, height, gray: new Float32Array(width * height), valid: new Uint8Array(width * height) }));
    for (let y = 0; y < height; y += 1) {
      const latitude = (-60 + y * .5) * Math.PI / 180;
      for (let x = 0; x < width; x += 1) {
        const longitude = (seam - 12 + x * .125) * Math.PI / 180;
        const direction = [Math.cos(latitude) * Math.sin(longitude), Math.sin(latitude), Math.cos(latitude) * Math.cos(longitude)];
        for (let index = 0; index < 2; index += 1) {
          const lens = lenses[index];
          const projection = projectDualFisheyeLensCpu(direction, lens, Math.PI,
            lens.projectionModel === 'mei_extended', lens.projectionModel === 'dji_fisheye_lut', lens.radialScale || 1);
          if (!projection) continue;
          const uv = projection.uv.slice();
          if (options.dualFisheyeFlipX) uv[0] = 2 * lenses[index].center[0] - uv[0];
          if (options.dualFisheyeFlipY) uv[1] = 2 * lenses[index].center[1] - uv[1];
          const color = [0, 0, 0];
          sampleAnalysisPixelsBilinear(surface.pixels, surface.width, surface.height, uv[0], textureOrigin === 'bottom-left' ? 1 - uv[1] : uv[1], color);
          const target = y * width + x;
          strips[index].gray[target] = color[0] * .2126 + color[1] * .7152 + color[2] * .0722;
          strips[index].valid[target] = 1;
        }
      }
    }
    const match = matchX5VideoSeam(...strips);
    if (!match) return null;
    offsets.push(match.dx * .125 * Math.PI / 180, match.dy * .5 * Math.PI / 180);
    ratios.push(match.gainRatio);
  }
  return { offsets, ratios };
}


function analyzeX5VideoFrame(mediaEl, options, calibration, lenses) {
  const surface = createSeamAnalysisSurface(mediaEl, 2048);
  if (!surface) return null;
  // Chrome may report decoded data before an off-DOM video has a readable
  // frame. Video pixels are opaque; transparent readback is still pending.
  if (surface.pixels[3] === 0) return undefined;
  // The original safety inset discards the sensor overlap needed to register
  // this video mode. Bound samples to the inscribed sensor circles and frame.
  const nativeLenses = lenses.map((lens) => ({ ...lens, validRadius: x5VideoLensRadius(lens) }));
  const registration = registerDualFisheyeOverlaps(surface, options, nativeLenses, calibration.textureOrigin);
  if (!registration) return null;
  const { offsets, ratios } = registration;
  const gain = Math.sqrt(clamp(Math.sqrt(ratios[0] * ratios[1]), .64, 1.5625));
  const polarInverseDepth = [-1, 1].map((pole) => {
    const distance = estimateX5ImageConvergence(surface, nativeLenses, calibration.textureOrigin, pole, options, offsets);
    return distance > 0 ? 1 / distance : 0;
  });
  return { offsets, polarInverseDepth, gain: options.dualFisheyeAutoGain ? [gain, 1 / gain]
    : [options.dualFisheyeGainFront, options.dualFisheyeGainBack] };
}


function analyzeDJIVideoFrame(mediaEl, options, calibration, lenses) {
  const surface = createSeamAnalysisSurface(mediaEl, 2048);
  if (!surface) return null;
  if (surface.pixels[3] === 0) return undefined;
  return analyzeDJIVideoSurface(surface, options, calibration, lenses);
}


function analyzeDJIVideoSurface(surface, options, calibration, lenses) {
  const nativeLenses = lenses.map((lens) => ({ ...lens, validRadius: x5VideoLensRadius(lens) }));
  const focalScale = estimateDualFisheyeImageFocalScale(surface, nativeLenses, options, calibration.textureOrigin, Math.PI);
  const scaledLenses = nativeLenses.map((lens) => ({ ...lens, focal: lens.focal.map((value) => value * focalScale) }));
  const registration = registerDualFisheyeOverlaps(surface, options, scaledLenses, calibration.textureOrigin);
  if (!registration) return null;
  // Feature matches mostly cover dark textured edges. Balance the entire
  // shared scene so their exposure ratio does not create a band in the sky.
  const seam = options.dualFisheyeAutoGain ? analyzeDualFisheyeSeam(surface, options, calibration, null,
    scaledLenses[0], scaledLenses[1], Math.PI, { videoOffsets: registration.offsets }) : null;
  return { focalScale, offsets: registration.offsets,
    gain: seam?.gain || [options.dualFisheyeGainFront, options.dualFisheyeGainBack] };
}


// Match the server's bounded registration search. A common support prevents a
// candidate from winning merely by moving mismatched pixels outside a lens.
function estimateX5ImageConvergence(surface, lenses, textureOrigin, pole = 0, options = {}, videoOffsets = null) {
  const baseline = lenses.reduce((sum, lens) => sum + (lens.translationM || []).reduce((total, value) => total + value*value, 0), 0);
  if (baseline < 1e-8) return 0;
  const projectPair = (direction, inverse) => {
    const colors = [];
    for (let index = 0; index < lenses.length; index += 1) {
      const lens = lenses[index];
      const ray = index === 1 && videoOffsets ? registeredDualFisheyeVideoDirection(direction, videoOffsets) : direction;
      const projection = projectDualFisheyeLensCpu(ray, lens, Math.PI, true, false, 1, inverse > 0 ? 1/inverse : 0);
      if (!projection) return null;
      if (options.dualFisheyeFlipX) projection.uv[0] = 2 * lens.center[0] - projection.uv[0];
      if (options.dualFisheyeFlipY) projection.uv[1] = 2 * lens.center[1] - projection.uv[1];
      const color = [0, 0, 0];
      sampleAnalysisPixelsBilinear(surface.pixels, surface.width, surface.height, projection.uv[0], textureOrigin === "bottom-left" ? 1-projection.uv[1] : projection.uv[1], color);
      colors.push(color);
    }
    return colors;
  };
  const directions = [];
  if (pole) {
    // Compare the same support for every depth. A sensor edge or moving a
    // difficult feature outside a lens must not manufacture a better fit.
    for (let row = 0; row < 9; row += 1) {
      const latitude = pole * (60 + 30 * row / 8) * Math.PI / 180;
      for (let column = 0; column < 128; column += 1) {
        const longitude = (column / 128 - .5) * 2 * Math.PI;
        const direction = [Math.cos(latitude) * Math.sin(longitude), Math.sin(latitude), Math.cos(latitude) * Math.cos(longitude)];
        let valid = true;
        for (let candidate = 0; candidate <= 16; candidate += 1) {
          if (!projectPair(direction, candidate / 4)) { valid = false; break; }
        }
        if (valid) directions.push(direction);
      }
    }
  } else {
    for (let row = 0; row < 64; row += 1) {
      const latitude = (-55+110*row/63)*Math.PI/180;
      for (const seam of [-90, 90]) {
        for (let column = 0; column < 9; column += 1) {
          const longitude = (seam-4+column)*Math.PI/180;
          const direction = [Math.cos(latitude)*Math.sin(longitude), Math.sin(latitude), Math.cos(latitude)*Math.cos(longitude)];
          let valid = true;
          for (let candidate = 0; candidate <= 16; candidate += 1) {
            if (!projectPair(direction, candidate/4)) { valid = false; break; }
          }
          if (valid) directions.push(direction);
        }
      }
    }
  }
  if (directions.length < 64) return 0;
  const cost = (inverse) => {
    const pairs = [];
    const sum = [0, 0];
    for (const direction of directions) {
      const pair = projectPair(direction, inverse);
      if (!pair) return Infinity;
      pairs.push(pair);
      for (let lens = 0; lens < 2; lens += 1) for (const value of pair[lens]) sum[lens] += value;
    }
    if (sum[0] <= directions.length*3 || sum[1] <= directions.length*3) return Infinity;
    const gain = Math.sqrt(clamp(sum[1]/sum[0], .64, 1.5625));
    const errors = pairs.map((pair) => pair[0].reduce((sum, value, channel) => sum + Math.abs(value*gain-pair[1][channel]/gain)/3, 0)).sort((a, b) => a-b);
    const keep = Math.floor(errors.length*.8);
    return errors.slice(0, keep).reduce((sum, value) => sum+value, 0)/keep;
  };
  const initial = cost(0);
  let bestCost = initial, bestInverse = 0;
  for (let candidate = 1; candidate <= 16; candidate += 1) {
    const inverse = candidate/4, value = cost(inverse);
    if (value < bestCost) { bestCost = value; bestInverse = inverse; }
  }
  const coarse = bestInverse;
  for (let step = -4; step <= 4; step += 1) {
    const inverse = coarse+step*.05;
    if (inverse <= 0 || inverse > 4) continue;
    const value = cost(inverse);
    if (value < bestCost) { bestCost = value; bestInverse = inverse; }
  }
  if (bestInverse === 0 || !Number.isFinite(initial) || initial-bestCost < .5 || bestCost > initial*.9) return 0;
  return 1/bestInverse;
}


function dualFisheyeDirectionConvergence(direction, convergenceM, polarInverseDepth, video = false) {
  const polar = polarInverseDepth[direction[1] > 0 ? 1 : 0];
  if (!(polar > 0)) return convergenceM;
  const start = Math.sin((video ? 50 : 30) * Math.PI / 180);
  const end = Math.sin((video ? 65 : 50) * Math.PI / 180);
  const t = clamp((Math.abs(direction[1]) - start) / (end - start), 0, 1);
  const inverse = (convergenceM > 0 ? 1 / convergenceM : 0) * (1 - t * t * (3 - 2 * t)) + polar * t * t * (3 - 2 * t);
  return inverse > 0 ? 1 / inverse : 0;
}


// Use independent tangent views at the poles: a close photographer must not
// determine the distance of the horizontal scene. Normalized feature patches
// and consensus use the same bounded matcher as video overlap registration.
function estimateDualFisheyePolarDepth(surface, lenses, options, textureOrigin) {
  const worldTranslations = lenses.map((lens) => {
    const q = lens.rotationQuat;
    const point = quatRotateVec3({ w: q[0], x: q[1], y: q[2], z: q[3] }, ...(lens.translationM || [0, 0, 0]));
    return [point.x, point.y, point.z];
  });
  const baseline = worldTranslations[1].map((value, axis) => value - worldTranslations[0][axis]);
  const length = Math.hypot(baseline[0], baseline[2]);
  if (length < .001 || Math.abs(baseline[1]) > length * .1) return [0, 0];
  const horizontal = [baseline[0] / length, baseline[2] / length];
  const width = 193, height = 193, tangent = Math.tan(25 * Math.PI / 180);
  return [-1, 1].map((pole) => {
    const grids = lenses.map(() => ({ width, height, gray: new Float32Array(width * height), valid: new Uint8Array(width * height) }));
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const a = (2 * x / (width - 1) - 1) * tangent;
      const b = (2 * y / (height - 1) - 1) * tangent;
      const direction = [horizontal[0] * a + horizontal[1] * b, pole, horizontal[1] * a - horizontal[0] * b];
      const norm = Math.hypot(...direction);
      for (let axis = 0; axis < 3; axis += 1) direction[axis] /= norm;
      for (let lensIndex = 0; lensIndex < 2; lensIndex += 1) {
        const lens = lenses[lensIndex];
        const projection = projectDualFisheyeLensCpu(direction, lens, Math.PI, true, false, 1);
        if (!projection) continue;
        if (options.dualFisheyeFlipX) projection.uv[0] = 2 * lens.center[0] - projection.uv[0];
        if (options.dualFisheyeFlipY) projection.uv[1] = 2 * lens.center[1] - projection.uv[1];
        const color = [0, 0, 0];
        sampleAnalysisPixelsBilinear(surface.pixels, surface.width, surface.height, projection.uv[0], textureOrigin === "bottom-left" ? 1 - projection.uv[1] : projection.uv[1], color);
        const index = y * width + x;
        grids[lensIndex].gray[index] = color[0] * .2126 + color[1] * .7152 + color[2] * .0722;
        grids[lensIndex].valid[index] = 1;
      }
    }
    const match = matchX5VideoSeam(...grids);
    if (!match || Math.abs(match.dy) > 1.5) return 0;
    const inverse = match.dx * 2 * tangent / (width - 1) / length;
    // Outside the supported 25cm–20m range, retain calibrated geometry.
    return inverse >= .05 && inverse <= 4 ? inverse : 0;
  });
}


function estimateDualFisheyeImageFocalScale(surface, lenses, options, textureOrigin, maxTheta) {
  const candidates = Array.from({ length: 13 }, (_, index) => 0.97 + index * 0.005);
  const scaledLenses = candidates.map((scale) => lenses.map((lens) => ({ ...lens, focal: lens.focal.map((value) => value * scale) })));
  const samplePair = (direction, pair, sampleColors) => {
    const colors = [];
    for (const lens of pair) {
      const projected = projectDualFisheyeLensCpu(direction, lens, maxTheta, false,
        lens.projectionModel === 'dji_fisheye_lut', lens.radialScale || 1);
      if (!projected) return null;
      if (!sampleColors) continue;
      if (options.dualFisheyeFlipX) projected.uv[0] = 2 * lens.center[0] - projected.uv[0];
      if (options.dualFisheyeFlipY) projected.uv[1] = 2 * lens.center[1] - projected.uv[1];
      const color = [0, 0, 0];
      sampleAnalysisPixelsBilinear(surface.pixels, surface.width, surface.height, projected.uv[0], textureOrigin === "bottom-left" ? 1 - projected.uv[1] : projected.uv[1], color);
      colors.push(color);
    }
    return colors;
  };
  // Every candidate compares the same rays in both seams. Cropping away a
  // mismatch must not make a narrower lens appear to be a better calibration.
  const directions = [];
  for (const seam of normalizeSeamLongitudesDeg(options.dualFisheyeSeamLongitudesDeg)) {
    const seamDirections = [];
    for (let latitude = -60; latitude <= 60; latitude += 4) {
      for (let offset = -2; offset <= 2; offset += 0.5) {
        const direction = panoramaDirectionForDualFisheye((seam + offset) / 360 + 0.5, 0.5 - latitude / 180,
          lenses.some((lens) => lens.projectionModel === 'dji_fisheye_lut'));
        if (options.equirectFlipX) direction[0] *= -1;
        if (options.equirectFlipY) direction[1] *= -1;
        if (scaledLenses.every((pair) => samplePair(direction, pair, false))) seamDirections.push(direction);
      }
    }
    if (seamDirections.length < 16) return 1;
    directions.push(...seamDirections);
  }
  const cost = (pair) => {
    const colors = directions.map((direction) => samplePair(direction, pair, true));
    const sums = colors.reduce((sum, color) => sum.map((value, index) => value + color[index].reduce((total, channel) => total + channel, 0)), [0, 0]);
    if (Math.min(...sums) < colors.length * 15) return Number.POSITIVE_INFINITY;
    const gain = Math.sqrt(clamp(sums[1] / sums[0], 0.64, 1.5625));
    const errors = colors.map((color) => color[0].reduce((sum, value, channel) => sum + Math.abs(value * gain - color[1][channel] / gain) / 3, 0)).sort((a, b) => a - b);
    const keep = Math.floor(errors.length * 0.8);
    return errors.slice(0, keep).reduce((sum, value) => sum + value, 0) / keep;
  };
  const initial = cost(lenses);
  if (!Number.isFinite(initial) || initial < 0.75) return 1;
  let bestIndex = 6, bestCost = initial;
  scaledLenses.forEach((pair, index) => {
    const value = cost(pair);
    if (value < bestCost) { bestIndex = index; bestCost = value; }
  });
  if (bestIndex === 0 || bestIndex === candidates.length - 1 || initial - bestCost < 0.75 || bestCost > initial * 0.85) return 1;
  return candidates[bestIndex];
}


function acceptStaticDualFisheyeImage(mediaEl, options, calibration, remap, frontLens, backLens, maxTheta) {
  const useConvergence = !remap && [frontLens, backLens].every((lens) => lens.distortionModel === "radtan_pro" && lens.distortionCoeffs?.length === 13);
  const useFocalRefinement = Boolean(options.dualFisheyeRefineFocal && calibration && !remap &&
    [frontLens, backLens].every((lens) => (lens.projectionModel || "equidistant") === "equidistant" && lens.focal?.every((value) => value > 0)));
  const surface = createSeamAnalysisSurface(mediaEl, useConvergence || useFocalRefinement ? 1024 : SOURCE_ANALYSIS_SIZE);
  if (!surface) return null;
  let focalScale = useFocalRefinement ? estimateDualFisheyeImageFocalScale(surface, [frontLens, backLens], options, calibration.textureOrigin, maxTheta) : 1;
  if (focalScale !== 1) {
    const front = { ...frontLens, focal: frontLens.focal.map((value) => value * focalScale) };
    const back = { ...backLens, focal: backLens.focal.map((value) => value * focalScale) };
    // A continuous fit can narrow the overlap below one mask-grid column.
    // Retain metadata geometry if either discrete seam would become unreachable.
    if (dualFisheyeFocalSupportsSeams(options, calibration, front, back, maxTheta)) {
      frontLens = front;
      backLens = back;
    } else focalScale = 1;
  }
  const convergenceM = useConvergence ? estimateX5ImageConvergence(surface, [frontLens, backLens], calibration?.textureOrigin) : 0;
  const usePolarDepth = calibration && !remap && [frontLens, backLens].every((lens) =>
    lens.projectionModel === "mei_extended" && lens.distortionModel !== "radtan_pro" && Array.isArray(lens.rotationQuat)) &&
    [frontLens, backLens].some((lens) => lens.translationM?.some((value) => Math.abs(value) > .001));
  const polarSurface = usePolarDepth ? createSeamAnalysisSurface(mediaEl, 1024) : null;
  const polarInverseDepth = polarSurface
    ? estimateDualFisheyePolarDepth(polarSurface, [frontLens, backLens], options, calibration.textureOrigin) : [0, 0];
  // DNG's MEI metadata can retain angular mismatch at the horizontal seams.
  // Register both overlaps once, independently of the nearby polar subject.
  // Fixed remaps and RadtanPro images keep their existing geometry path.
  const useImageRegistration = calibration && !remap && calibration.imageSize?.[0] === 2 * calibration.imageSize?.[1] &&
    [frontLens, backLens].every((lens) => lens.projectionModel === "mei_extended" &&
      lens.distortionModel !== "radtan_pro" && Array.isArray(lens.rotationQuat));
  const registrationSurface = useImageRegistration ? createSeamAnalysisSurface(mediaEl, 2048) : null;
  const imageOffsets = registrationSurface
    ? registerDualFisheyeOverlaps(registrationSurface, options, [frontLens, backLens], calibration.textureOrigin)?.offsets || [0, 0, 0, 0]
    : [0, 0, 0, 0];
  const seam = analyzeDualFisheyeSeam(surface, options, calibration, remap, frontLens, backLens, maxTheta,
    { convergenceM, polarInverseDepth, imageOffsets: useImageRegistration ? imageOffsets : null });
  return seam ? { ...seam, convergenceM, polarInverseDepth, focalScale, imageOffsets } : null;
}

function dualFisheyeFocalSupportsSeams(options, calibration, front, back, maxTheta) {
  const { weights } = dualFisheyeAnalysisMap(options, calibration, null, front, back, maxTheta,
    { convergenceM: 0, polarInverseDepth: [0, 0], registrationOffsets: null, videoOffsets: null }, null);
  const half = ANALYSIS_WIDTH / 2;
  const costs = new Float64Array(half * ANALYSIS_HEIGHT);
  const workspace = {};
  for (const offset of [0, half]) {
    for (let y = 0; y < ANALYSIS_HEIGHT; y++) for (let x = 0; x < half; x++) {
      const index = y * ANALYSIS_WIDTH + offset + x;
      costs[y * half + x] = weights[0][index] > 0 && weights[1][index] > 0 ? 1 : 65535;
    }
    if (!solveDualFisheyeSeamDP(costs, half, ANALYSIS_HEIGHT, 2, workspace)) return false;
  }
  return true;
}


function dualFisheyeGradientIndices(weights) {
  const count = ANALYSIS_WIDTH * ANALYSIS_HEIGHT, needed = new Uint8Array(count);
  for (let index = 0; index < count; index++) {
    if (weights[0][index] <= 0 || weights[1][index] <= 0) continue;
    needed[index] = 1;
    if (index % ANALYSIS_WIDTH) needed[index - 1] = 1;
    if (index >= ANALYSIS_WIDTH) needed[index - ANALYSIS_WIDTH] = 1;
  }
  let length = 0;
  for (let index = 0; index < count; index++) length += needed[index];
  const indices = new Uint16Array(length);
  for (let index = 0, next = 0; index < count; index++) if (needed[index]) indices[next++] = index;
  return indices;
}


function dualFisheyeAnalysisMap(options, calibration, remap, frontLens, backLens, maxTheta,
  { convergenceM, polarInverseDepth, registrationOffsets, videoOffsets }, cache) {
  const key = cache && !remap ? JSON.stringify([frontLens, backLens, maxTheta, calibration?.textureOrigin,
    calibration?.front?.radialScale, calibration?.back?.radialScale, convergenceM, polarInverseDepth,
    registrationOffsets, Boolean(videoOffsets), options.equirectFlipX, options.equirectFlipY,
    options.dualFisheyeFlipX, options.dualFisheyeFlipY]) : null;
  if (key && cache.key === key) return cache.map;
  const count = ANALYSIS_WIDTH * ANALYSIS_HEIGHT;
  const uv = [new Float64Array(count * 2), new Float64Array(count * 2)];
  const weights = [new Float32Array(count), new Float32Array(count)];
  const lenses = [frontLens, backLens];
  const projections = lenses.map(lens => lens.projectionModel === 'mei_extended');
  const dji = lenses.map(lens => lens.projectionModel === 'dji_fisheye_lut');
  const meiConvention = projections.some(Boolean) || dji.some(Boolean);
  for (let y = 0; y < ANALYSIS_HEIGHT; y++) for (let x = 0; x < ANALYSIS_WIDTH; x++) {
    const direction = panoramaDirectionForDualFisheye((x + .5) / ANALYSIS_WIDTH, (y + .5) / ANALYSIS_HEIGHT, meiConvention);
    if (options.equirectFlipX) direction[0] = -direction[0];
    if (options.equirectFlipY) direction[1] = -direction[1];
    const maskUV = projectDualEquirectUV(direction, meiConvention);
    const maskX = clamp(Math.floor(maskUV[0] * ANALYSIS_WIDTH), 0, ANALYSIS_WIDTH - 1);
    const maskY = clamp(Math.floor(maskUV[1] * ANALYSIS_HEIGHT), 0, ANALYSIS_HEIGHT - 1);
    const index = maskY * ANALYSIS_WIDTH + maskX;
    const mapped = sampleRemapAnalysis(remap, maskUV[0], maskUV[1]);
    for (let lensIndex = 0; lensIndex < 2; lensIndex++) {
      const lensDirection = lensIndex === 1 && registrationOffsets ? registeredDualFisheyeVideoDirection(direction, registrationOffsets) : direction;
      const lens = lenses[lensIndex];
      const projection = mapped
        ? (mapped[lensIndex].valid ? { uv: mapped[lensIndex].uv, confidence: mapped[lensIndex].confidence } : null)
        : projectDualFisheyeLensCpu(lensDirection, lens, maxTheta, projections[lensIndex], dji[lensIndex],
            lensIndex === 0 ? calibration?.front?.radialScale || 1 : calibration?.back?.radialScale || 1,
            dualFisheyeDirectionConvergence(lensDirection, convergenceM, polarInverseDepth, Boolean(videoOffsets)));
      if (!projection) continue;
      let [u, v] = projection.uv;
      if (options.dualFisheyeFlipX) u = 2 * lens.center[0] - u;
      if (options.dualFisheyeFlipY) v = 2 * lens.center[1] - v;
      uv[lensIndex][index * 2] = u;
      uv[lensIndex][index * 2 + 1] = calibration?.textureOrigin === 'bottom-left' ? 1 - v : v;
      weights[lensIndex][index] = projection.confidence;
    }
  }
  let overlapCount = 0;
  for (let index = 0; index < count; index++) {
    if (weights[0][index] > 0 && weights[1][index] > 0) overlapCount++;
  }
  const map = { uv, weights, overlapCount, gradientIndices: dualFisheyeGradientIndices(weights) };
  if (key) { cache.key = key; cache.map = map; }
  return map;
}


function analyzeDualFisheyeSeam(surface, options, calibration, remap, frontLens, backLens, maxTheta,
  { convergenceM = 0, polarInverseDepth = [0, 0], imageOffsets = null, videoOffsets = null, previousMask = null, mapCache = null } = {}) {
  const registrationOffsets = videoOffsets || imageOffsets;
  const colors = [new Float32Array(ANALYSIS_WIDTH * ANALYSIS_HEIGHT * 3), new Float32Array(ANALYSIS_WIDTH * ANALYSIS_HEIGHT * 3)];
  const map = dualFisheyeAnalysisMap(options, calibration, remap, frontLens, backLens, maxTheta,
    { convergenceM, polarInverseDepth, registrationOffsets, videoOffsets }, mapCache);
  const { weights } = map;
  sampleDualFisheyeAnalysisColors(surface, map, colors, Boolean(mapCache && !remap));
  const costs = new Float64Array(ANALYSIS_WIDTH * ANALYSIS_HEIGHT);
  costs.fill(65535);
  const autoGain = Boolean(calibration && options.dualFisheyeAutoGain);
  let overlapCount = map.overlapCount ?? 0;
  let lumaFront = 0;
  let lumaBack = 0;
  const dji = [Boolean(frontLens.projectionModel === "dji_fisheye_lut"), Boolean(backLens.projectionModel === "dji_fisheye_lut")];
  // Coverage belongs to the fixed projection. Registered video already has
  // exposure gains, so do not rescan current RGB for an unused automatic gain.
  if (autoGain || map.overlapCount === undefined) {
    overlapCount = 0;
    for (let index = 0; index < ANALYSIS_WIDTH * ANALYSIS_HEIGHT; index++) {
      if (weights[0][index] > 0 && weights[1][index] > 0) {
        overlapCount += 1;
        if (!autoGain) continue;
        const colorOffset = index * 3;
        const frontLuma = colors[0][colorOffset] * 0.2126 + colors[0][colorOffset + 1] * 0.7152 + colors[0][colorOffset + 2] * 0.0722;
        const backLuma = colors[1][colorOffset] * 0.2126 + colors[1][colorOffset + 1] * 0.7152 + colors[1][colorOffset + 2] * 0.0722;
        lumaFront += frontLuma;
        lumaBack += backLuma;
      }
    }
  }
  if (overlapCount < 64) return null;
  let frontGain = options.dualFisheyeGainFront;
  let backGain = options.dualFisheyeGainBack;
  // Calibrated overlap compares the same scene in both lenses. Whole-lens
  // averages can differ simply because the lenses face different scenes.
  if (autoGain && lumaFront > overlapCount && lumaBack > overlapCount) {
    frontGain = Math.sqrt(clamp(lumaBack / lumaFront, 0.64, 1.5625));
    backGain = 1 / frontGain;
  }
  const visibilityLoss = [new Float32Array(costs.length), new Float32Array(costs.length)];
  const gradientIndices = map.gradientIndices || dualFisheyeGradientIndices(weights);
  const columnDifferences = new Float64Array(ANALYSIS_WIDTH);
  let previousDifference = 0;
  // Row-major support includes each overlap point and its left/top neighbors,
  // even outside overlap. One Float64 row retains the exact prior differences.
  for (let sample = 0; sample < gradientIndices.length; sample++) {
    const index = gradientIndices[sample], x = index % ANALYSIS_WIDTH, at = index * 3;
    const frontRed = colors[0][at] * frontGain, frontGreen = colors[0][at + 1] * frontGain,
      frontBlue = colors[0][at + 2] * frontGain;
    const backRed = colors[1][at] * backGain, backGreen = colors[1][at + 1] * backGain,
      backBlue = colors[1][at + 2] * backGain;
    const frontLuma = frontRed * .2126 + frontGreen * .7152 + frontBlue * .0722;
    const backLuma = backRed * .2126 + backGreen * .7152 + backBlue * .0722;
    const difference = frontLuma - backLuma;
    const leftDifference = x > 0 ? previousDifference : difference;
    const topDifference = index >= ANALYSIS_WIDTH ? columnDifferences[x] : difference;
    previousDifference = difference; columnDifferences[x] = difference;
    if (weights[0][index] <= 0 || weights[1][index] <= 0) continue;
    const colorDifference = (Math.abs(frontRed - backRed) + Math.abs(frontGreen - backGreen) + Math.abs(frontBlue - backBlue)) / 3;
    // Preserve the original black-obstruction and prior-owner penalties,
    // including Float32 rounding before adding temporal visibility loss.
    visibilityLoss[0][index] = frontLuma < 12 && backLuma > 24 && frontLuma < backLuma * .25
      ? 128 * Math.min(1, (backLuma - frontLuma) / 64) : 0;
    visibilityLoss[1][index] = backLuma < 12 && frontLuma > 24 && backLuma < frontLuma * .25
      ? 128 * Math.min(1, (frontLuma - backLuma) / 64) : 0;
    if (previousMask) {
      visibilityLoss[0][index] += previousMask[index] / 255 * 12;
      visibilityLoss[1][index] += (1 - previousMask[index] / 255) * 12;
    }
    const gradientDifference = Math.abs(difference) + Math.abs(leftDifference) + Math.abs(topDifference);
    const coveragePenalty = 128 * (1 - (2 * Math.min(weights[0][index], weights[1][index]) / Math.max(0.0001, weights[0][index] + weights[1][index])));
    costs[index] = Math.min(65534, colorDifference + gradientDifference * 0.35 + coveragePenalty);
  }
  const half = ANALYSIS_WIDTH / 2;
  // The halves are solved synchronously and return independent paths. Rebuild
  // their costs in one scratch set, without retaining it across analysis frames.
  const halfCosts = new Float64Array(half * ANALYSIS_HEIGHT);
  const before = new Float64Array(half + 1), after = new Float64Array(half + 1);
  const workspace = {};
  const solveHalf = (offset) => {
    for (let y = 0; y < ANALYSIS_HEIGHT; y += 1) {
      const row = y * ANALYSIS_WIDTH;
      const startsBack = (weights[1][row] > weights[0][row]) !== (offset > 0);
      for (let x = 0; x < half; x += 1) {
        const index = row + offset + x;
        const frontLoss = visibilityLoss[0][index], backLoss = visibilityLoss[1][index];
        before[x + 1] = before[x] + (startsBack ? backLoss : frontLoss);
        after[x + 1] = after[x] + (startsBack ? frontLoss : backLoss);
      }
      for (let x = 0; x < half; x += 1) {
        const boundary = costs[row + offset + x];
        // Charge for all content discarded by the candidate's ownership,
        // not just the mismatch along the boundary itself.
        halfCosts[y * half + x] = boundary >= 65535 ? 65535
          : Math.min(65534, boundary + before[x] + after[half] - after[x]);
      }
    }
    return solveDualFisheyeSeamDP(halfCosts, half, ANALYSIS_HEIGHT, 2, workspace);
  };
  const left = solveHalf(0);
  const right = solveHalf(half);
  const seamMask = left && right && left.cost / ANALYSIS_HEIGHT <= 180 && right.cost / ANALYSIS_HEIGHT <= 180
    ? buildDualFisheyeSeamMask(weights, left.seam, right.seam.map((value) => value + half))
    : null;
  let mask = protectDualFisheyeDisplacedContent(seamMask, colors, weights, [frontGain, backGain]);
  if (mask && videoOffsets && dji.every(Boolean)) mask = protectDualFisheyeForegroundRegions(mask, colors, weights, [frontGain, backGain], mapCache && !remap ? map : null);
  if (mask && registrationOffsets) mask = stabilizeDualFisheyeVideoMask(mask, colors, weights, [frontGain, backGain], previousMask);
  const strength = mask && videoOffsets && dji.every(Boolean)
    ? buildDualFisheyeContentSupport(colors, weights, [frontGain, backGain]) : null;
  return { mask, strength, gain: [frontGain, backGain] };
}


function registeredDualFisheyeVideoDirection(direction, offsets) {
  const latitude = Math.asin(clamp(direction[1], -1, 1));
  let longitude = Math.atan2(direction[0], direction[2]);
  const t = clamp((Math.abs(direction[1]) - Math.sin(50 * Math.PI / 180)) /
    (Math.sin(70 * Math.PI / 180) - Math.sin(50 * Math.PI / 180)), 0, 1);
  const fade = 1 - t * t * (3 - 2 * t);
  if (fade === 0) return direction.slice();
  const mix = .5 + .5 * Math.sin(longitude);
  longitude += (offsets[0] * (1 - mix) + offsets[2] * mix) * fade;
  const correctedLatitude = clamp(latitude + (offsets[1] * (1 - mix) + offsets[3] * mix) * fade, -Math.PI / 2, Math.PI / 2);
  return [Math.cos(correctedLatitude) * Math.sin(longitude), Math.sin(correctedLatitude), Math.cos(correctedLatitude) * Math.cos(longitude)];
}


function stabilizeDualFisheyeVideoMask(mask, colors, weights, gains, previousMask) {
  const result = mask.slice();
  // All longitudes meet at a pole. A per-column owner in its last two rows
  // makes a wedge through a nearby hand even when ordinary seams avoid it.
  for (const start of [0, ANALYSIS_HEIGHT - 2]) {
    const support = [0, 0];
    for (let y = start; y < start + 2; y += 1) for (let x = 0; x < ANALYSIS_WIDTH; x += 1) {
      const index = y * ANALYSIS_WIDTH + x, at = index * 3;
      for (let lens = 0; lens < 2; lens += 1) {
        const luma = (colors[lens][at] * .2126 + colors[lens][at + 1] * .7152 + colors[lens][at + 2] * .0722) * gains[lens];
        // A dark displaced knee can have slightly more coverage than the
        // nearby hand. Use gain-normalized visible signal as well as sensor
        // support, with a cap so highlights cannot dominate the decision.
        if (luma >= 12) support[lens] += Math.sqrt(weights[lens][index]) * Math.min(luma, 128);
      }
    }
    let useBack = support[1] > support[0];
    if (previousMask && Math.abs(support[0] - support[1]) < Math.max(...support) * .15) {
      useBack = previousMask[start * ANALYSIS_WIDTH] >= 128;
    }
    result.fill(useBack ? 255 : 0, start * ANALYSIS_WIDTH, (start + 2) * ANALYSIS_WIDTH);
  }
  return result;
}


function blendDualFisheyeVideoMasks(mask, previousMask, strength = null) {
  if (!previousMask) return mask;
  const result = new Uint8Array(mask.length);
  // Retain the exact floating-point order and foreground bypass, without a
  // typed-array iterator and callback for every byte in the ownership mask.
  for (let index = 0; index < mask.length; index++) {
    const value = mask[index];
    result[index] = strength?.[index] >= 128 ? value
      : Math.round(previousMask[index] + (value - previousMask[index]) * .35);
  }
  return result;
}


function dualFisheyeAnalysisSurfaceChanged(surface, previous) {
  if (previous?.width !== surface.width || previous?.height !== surface.height) return true;
  const { width, height, pixels } = surface, prior = previous.pixels;
  const packed = (pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray) &&
    (prior instanceof Uint8Array || prior instanceof Uint8ClampedArray) &&
    pixels.byteOffset % 4 === 0 && prior.byteOffset % 4 === 0 &&
    pixels.length === width * height * 4 && prior.length === pixels.length;
  const words = packed ? new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.byteLength / 4) : null;
  const priorWords = packed ? new Uint32Array(prior.buffer, prior.byteOffset, prior.byteLength / 4) : null;
  // Keep the same local probes and last accepted frame so a nearby subject
  // or accumulated slow motion still triggers analysis. Equal words prove
  // equal RGB on either endian; changed alpha alone falls through to RGB.
  for (let y = 0; y < height; y += 8) for (let x = 0; x < width; x += 8) {
    let delta = 0, count = 0;
    const bottom = Math.min(y + 8, height), right = Math.min(x + 8, width), first = y * width + x;
    // Noise can change every pixel without crossing the threshold. Select
    // the scalar tile path after one unequal word instead of paying for an
    // extra word comparison at every RGB probe in such a tile.
    if (words && words[first] === priorWords[first]) {
      for (let row = y; row < bottom; row += 2) for (let col = x; col < right; col += 2) {
        const index = row * width + col;
        if (words[index] !== priorWords[index]) {
          const at = index * 4;
          delta += Math.abs(pixels[at] - prior[at]);
          delta += Math.abs(pixels[at + 1] - prior[at + 1]);
          delta += Math.abs(pixels[at + 2] - prior[at + 2]);
        }
        count += 3;
      }
    } else {
      for (let row = y; row < bottom; row += 2) for (let col = x; col < right; col += 2) {
        const at = (row * width + col) * 4;
        delta += Math.abs(pixels[at] - prior[at]);
        delta += Math.abs(pixels[at + 1] - prior[at + 1]);
        delta += Math.abs(pixels[at + 2] - prior[at + 2]);
        count += 3;
      }
    }
    if (delta / count > 12) return true;
  }
  return false;
}


function analyzeX5VideoSeamFrame(mediaEl, options, calibration, lenses, registration, previousMask, cache) {
  const dji = lenses.every(lens => lens.projectionModel === 'dji_fisheye_lut');
  const softwareMap = dji && cache?.softwareFrames ? dualFisheyeAnalysisMap(options, calibration, null, ...lenses, Math.PI,
    { convergenceM: 0, polarInverseDepth: registration.polarInverseDepth || [0, 0], registrationOffsets: registration.offsets, videoOffsets: registration.offsets },
    cache.projections ||= {}) : null;
  let surface = dji && cache?.softwareFrames
    ? createDJISoftwareAnalysisSurface(cache.softwareFrames, cache.softwareReadback ||= {}, cache.surface, softwareMap) : null;
  if (!surface) {
    if (cache?.softwareFrames) cache.prepareSoftwareFallback?.();
    surface = createSeamAnalysisSurface(mediaEl, dji ? 1024 : SOURCE_ANALYSIS_SIZE, cache);
  }
  if (!surface) return null;
  if (surface.pixels[3] === 0) return undefined;
  const previous = cache?.surface;
  if (previous && !dualFisheyeAnalysisSurfaceChanged(surface, previous)) return { reused: true };
  const result = analyzeDualFisheyeSeam(surface, { ...options, dualFisheyeAutoGain: false,
    dualFisheyeGainFront: registration.gain[0], dualFisheyeGainBack: registration.gain[1] },
    calibration, null, ...lenses, Math.PI, {
      polarInverseDepth: registration.polarInverseDepth, videoOffsets: registration.offsets, previousMask,
      mapCache: cache ? (cache.projections ||= {}) : null,
    });
  if (!result?.mask) return null;
  if (cache) cache.surface = surface;
  return { mask: result.mask, strength: result.strength };
}


function createProjectionRenderer(canvas, mediaEl, options, projectionKind) {
  const externalFrames = options.externalFrames === true;
  const nativeVideo = mediaEl instanceof HTMLVideoElement;
  const isVideo = nativeVideo || externalFrames;
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: !isVideo,
    depth: !isVideo,
    stencil: false,
    preserveDrawingBuffer: !isVideo,
  });
  if (!gl) {
    throw new Error("WebGL unavailable");
  }
  // A stitched texture has its own UV convention. Source lens calibration
  // must not change its vertical orientation when metadata arrives later.
  const calibration = projectionKind === "dual_fisheye"
    ? normalizeDualFisheyeCalibration(options.dualFisheyeCalibration, options.dualFisheyeFrontLens)
    : null;
  const textureFlipY = calibration?.textureOrigin === "top-left" ? false : true;
  const useMEICameraConvention = Boolean(
    (projectionKind === 'equirect' && options.equirectCameraConvention === 'mei') ||
    projectionKind === "dual_fisheye" &&
    calibration &&
    [calibration.front, calibration.back].some((lens) => ['mei_extended', 'dji_fisheye_lut'].includes(lens.projectionModel)),
  );
  canvas.dataset.insta360MEIConvention = useMEICameraConvention ? "true" : "false";
  canvas.dataset.insta360ProjectionKind = projectionKind;
  canvas.dataset.insta360CalibrationFrontModel = calibration?.front?.projectionModel || "";

  const vsSrc = `
    attribute vec2 aClipPosition;
    void main() {
      gl_Position = vec4(aClipPosition, 0.0, 1.0);
    }
  `;
  const flipXExpr = options.equirectFlipX ? "1.0 - baseUV.x" : "baseUV.x";
  const flipYExpr = options.equirectFlipY ? "1.0 - baseUV.y" : "baseUV.y";
  const dualFisheyeDirXExpr = options.equirectFlipX ? "-dir.x" : "dir.x";
  const dualFisheyeDirYExpr = options.equirectFlipY ? "-dir.y" : "dir.y";
  const projectionUVExpr =
    projectionKind === "dual_fisheye" ? "projectDualFisheye(dir)" : (projectionKind === "eac" || projectionKind === "cubemap") ? "projectCube(dir)" : "projectEquirect(dir)";
  const colorSampleExpr =
    projectionKind === "dual_fisheye"
      ? `
      gl_FragColor = sampleDualFisheye(vec3(${dualFisheyeDirXExpr}, ${dualFisheyeDirYExpr}, dir.z));
    `
      : `
      vec4 base = ${projectionKind === "eac" || projectionKind === "cubemap" ? "sampleCubeTexture(uv)" : "texture2D(uTex, clampTexelUV(uv))"};
      float seamDist = min(uv.x, 1.0 - uv.x);
      if (${projectionKind === "eac" || projectionKind === "cubemap" ? "false" : "seamDist < uSeamWidth"}) {
        float oppositeX = uv.x < 0.5 ? 1.0 - seamDist : seamDist;
        vec4 opposite = texture2D(uTex, clampTexelUV(vec2(oppositeX, uv.y)));
        float seamMix = smoothstep(0.0, uSeamWidth, seamDist);
        base = mix((base + opposite) * 0.5, base, seamMix);
      }
      gl_FragColor = base;
    `;
  const fragmentMainBody =
    projectionKind === "dual_fisheye"
      ? `
      vec2 baseUV = ${projectionUVExpr};
      vec2 uv = vec2(${flipXExpr}, ${flipYExpr});
      ${colorSampleExpr}
    `
      : `
      vec2 baseUV = ${projectionUVExpr};
      if (baseUV.x < 0.0 || baseUV.y < 0.0 || baseUV.x > 1.0 || baseUV.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }
      vec2 uv = vec2(${flipXExpr}, ${flipYExpr});
      ${colorSampleExpr}
    `;
  const fsSrc = `
    precision highp float;
    uniform sampler2D uTex;
    uniform sampler2D uBackTex;
    uniform float uSeparateLenses;
    uniform float uVerticalLenses;
    uniform float uVisibleLens;
    uniform vec2 uViewport;
    uniform vec2 uTexel;
    uniform float uAspect;
    uniform float uTanHalfFov;
    uniform vec4 uViewQuat;
    uniform float uSeamWidth;
    uniform vec2 uDualFisheyeFrontCenter;
    uniform vec2 uDualFisheyeBackCenter;
    uniform vec2 uDualFisheyeFrontValidRadius;
    uniform vec2 uDualFisheyeBackValidRadius;
    uniform vec2 uDualFisheyeFrontFocal;
    uniform vec2 uDualFisheyeBackFocal;
    uniform vec2 uDualFisheyeFrontPrincipalOffset;
    uniform vec2 uDualFisheyeBackPrincipalOffset;
    uniform vec2 uDualFisheyeFrontScale;
    uniform vec2 uDualFisheyeBackScale;
    uniform vec4 uDualFisheyeFrontRadial;
    uniform vec4 uDualFisheyeBackRadial;
    uniform float uDualFisheyeFrontRadialScale;
    uniform float uDualFisheyeBackRadialScale;
    uniform vec2 uDualFisheyeDJIRadial5;
    uniform vec2 uDualFisheyeFrontTangential;
    uniform vec2 uDualFisheyeBackTangential;
    uniform float uDualFisheyeFrontXi;
    uniform float uDualFisheyeBackXi;
    uniform vec4 uDualFisheyeFrontThinPrism;
    uniform vec4 uDualFisheyeBackThinPrism;
    uniform vec2 uDualFisheyeFrontSensorTilt;
    uniform vec2 uDualFisheyeBackSensorTilt;
    uniform float uDualFisheyeConvergenceM;
    uniform vec2 uDualFisheyePolarInverseDepth;
    uniform vec3 uDualFisheyeFrontTranslationM;
    uniform vec3 uDualFisheyeBackTranslationM;
    uniform vec4 uDualFisheyeFrontPro0;
    uniform vec4 uDualFisheyeFrontPro1;
    uniform vec4 uDualFisheyeFrontPro2;
    uniform float uDualFisheyeFrontPro12;
    uniform vec4 uDualFisheyeBackPro0;
    uniform vec4 uDualFisheyeBackPro1;
    uniform vec4 uDualFisheyeBackPro2;
    uniform float uDualFisheyeBackPro12;
    uniform float uDualFisheyeFrontUsePro;
    uniform float uDualFisheyeBackUsePro;
    uniform vec4 uDualFisheyeFrontRotationQuat;
    uniform vec4 uDualFisheyeBackRotationQuat;
    uniform float uDualFisheyeFrontUseMEI;
    uniform float uDualFisheyeBackUseMEI;
    uniform float uDualFisheyeFrontUseDJI;
    uniform float uDualFisheyeBackUseDJI;
    uniform vec4 uDualFisheyeFrontAsymmetric;
    uniform vec4 uDualFisheyeBackAsymmetric;
    uniform vec3 uDualFisheyeFrontAxis;
    uniform vec3 uDualFisheyeBackAxis;
    uniform vec3 uDualFisheyeFrontRight;
    uniform vec3 uDualFisheyeBackRight;
    uniform vec3 uDualFisheyeFrontUp;
    uniform vec3 uDualFisheyeBackUp;
    uniform float uDualFisheyeMaxTheta;
    uniform float uDualFisheyeBlendBand;
    uniform vec2 uDualFisheyeSeamX;
    uniform float uDualFisheyeSeamBlendX;
    uniform float uDualFisheyeSeamFrontWrap;
    uniform float uDualFisheyeUseSeamLongitudes;
    uniform vec2 uDualFisheyeGain;
    uniform sampler2D uDualFisheyeFrontRemap;
    uniform sampler2D uDualFisheyeBackRemap;
    uniform float uDualFisheyeUseRemap;
    uniform sampler2D uDualFisheyeSeamMask;
    uniform float uDualFisheyeUseSeamMask;
    uniform vec4 uDualFisheyeVideoOffsets;
    uniform float uDualFisheyeVideoSeam;

    const float PI = 3.1415926535897932384626433832795;

    vec3 rotateByQuat(vec4 q, vec3 v) {
      return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
    }

    vec2 clampTexelUV(vec2 uv) {
      return vec2(
        clamp(uv.x, uTexel.x * 0.5, 1.0 - uTexel.x * 0.5),
        clamp(uv.y, uTexel.y * 0.5, 1.0 - uTexel.y * 0.5)
      );
    }

    vec2 flipDualFisheyeUV(vec2 uv, vec2 center) {
      ${options.dualFisheyeFlipX ? "uv.x = center.x + (center.x - uv.x);" : ""}
      ${options.dualFisheyeFlipY ? "uv.y = center.y + (center.y - uv.y);" : ""}
      return uv;
    }

    vec2 projectEquirect(vec3 dir) {
      float lon = atan(dir.x, ${useMEICameraConvention ? "dir.z" : "-dir.z"});
      float lat = asin(clamp(${useMEICameraConvention ? "-dir.y" : "dir.y"}, -1.0, 1.0));
      return vec2(lon / (2.0 * PI) + 0.5, ${useMEICameraConvention ? "lat / PI + 0.5" : "0.5 - lat / PI"});
    }

    vec4 sampleDualFisheyeRemap(sampler2D remapTex, vec2 baseUV) {
      return texture2D(remapTex, baseUV);
    }

    float dualFisheyeGeometryWeight(float frontDot, float backDot) {
      return smoothstep(-uDualFisheyeBlendBand, uDualFisheyeBlendBand, frontDot - backDot);
    }

    float dualFisheyeSeamIntervalWeight(float x) {
      float a = min(uDualFisheyeSeamX.x, uDualFisheyeSeamX.y);
      float b = max(uDualFisheyeSeamX.x, uDualFisheyeSeamX.y);
      float band = max(uDualFisheyeSeamBlendX, 0.0001);
      float enter = smoothstep(a - band, a + band, x);
      float exit = 1.0 - smoothstep(b - band, b + band, x);
      float interval = clamp(enter * exit, 0.0, 1.0);
      return uDualFisheyeSeamFrontWrap > 0.5 ? 1.0 - interval : interval;
    }

    float dualFisheyeLensCoverage(vec2 uv, vec2 center, vec2 validRadius) {
      vec2 normalizedRadius = max(validRadius, vec2(0.0001));
      return max(1.0 - length((uv - center) / normalizedRadius), 0.0);
    }

    float dualFisheyeBlendWeight(vec3 dir, float frontDot, float backDot, float frontConfidence, float backConfidence) {
      float geometryWeight = dualFisheyeGeometryWeight(frontDot, backDot);
      float seamWeight = dualFisheyeSeamIntervalWeight(projectEquirect(dir).x);
      float seamBlend = mix(geometryWeight, seamWeight, uDualFisheyeUseSeamLongitudes);
      vec4 contentMask = texture2D(uDualFisheyeSeamMask, projectEquirect(dir));
      float contentAwareBlend = 1.0 - contentMask.r;
      // DJI foreground can cross the ordinary seam. INSV keeps its calibrated
      // sky/road blend and only protects the lower subject: lens exposure and
      // night noise must not become a hard, intermittently changing sky owner.
      float contentStrength = ${isVideo && calibration?.front.projectionModel === 'dji_fisheye_lut'
        ? 'contentMask.a'
        : 'mix(1.0, smoothstep(sin(radians(50.0)), sin(radians(65.0)), dir.y), uDualFisheyeVideoSeam)'};
      seamBlend = mix(seamBlend, contentAwareBlend, uDualFisheyeUseSeamMask * contentStrength);
      float frontWeight = frontConfidence * seamBlend;
      float backWeight = backConfidence * (1.0 - seamBlend);
      return clamp(frontWeight / max(frontWeight + backWeight, 0.0001), 0.0, 1.0);
    }

    float dualFisheyeEdgeAwareBlend(float blend, vec4 frontColor, vec4 backColor) {
      float colorDelta = length(frontColor.rgb - backColor.rgb);
      float mismatch = smoothstep(0.08, 0.24, colorDelta);
      float sharpenedBlend = smoothstep(0.34, 0.66, blend);
      return mix(blend, sharpenedBlend, mismatch * 0.72);
    }

    vec2 projectDualFisheye(vec3 dir) {
      float frontDot = dot(dir, uDualFisheyeFrontAxis);
      float backDot = dot(dir, uDualFisheyeBackAxis);
      bool useFront = frontDot >= backDot;
      vec3 axis = useFront ? uDualFisheyeFrontAxis : uDualFisheyeBackAxis;
      float axisDot = useFront ? frontDot : backDot;
      float theta = acos(clamp(axisDot, -1.0, 1.0));
      if (theta > uDualFisheyeMaxTheta) {
        return vec2(-1.0, -1.0);
      }
      vec3 right = useFront ? uDualFisheyeFrontRight : uDualFisheyeBackRight;
      vec3 up = useFront ? uDualFisheyeFrontUp : uDualFisheyeBackUp;
      vec3 radial3 = dir - axis * axisDot;
      float radialLen = length(radial3);
      vec2 radialCoord = radialLen > 0.00001
        ? vec2(dot(radial3 / radialLen, right), -dot(radial3 / radialLen, up))
        : vec2(0.0, 0.0);
      float radius = theta / uDualFisheyeMaxTheta;
      vec2 center = useFront ? uDualFisheyeFrontCenter : uDualFisheyeBackCenter;
      vec2 scale = useFront ? uDualFisheyeFrontScale : uDualFisheyeBackScale;
      return center + radialCoord * radius * scale;
    }

    vec2 projectDistortedDualLens(
      vec3 dir,
      vec3 axis,
      vec2 center,
      vec3 right,
      vec3 up,
      vec2 focal,
      vec2 principalOffset,
      vec4 radialCoeffs,
      vec2 tangential,
      vec4 asymmetric
    ) {
      float axisDot = dot(dir, axis);
      float theta = acos(clamp(axisDot, -1.0, 1.0));
      if (theta > uDualFisheyeMaxTheta) {
        return vec2(-1.0, -1.0);
      }
      vec3 radial3 = dir - axis * axisDot;
      float radialLen = length(radial3);
      vec2 radial = radialLen > 0.00001
        ? vec2(dot(radial3 / radialLen, right), -dot(radial3 / radialLen, up))
        : vec2(0.0, 0.0);
      vec2 radialCoord = radial;
      float theta2 = theta * theta;
      float distorted =
        theta *
        (1.0 +
          radialCoeffs.x * theta2 +
          radialCoeffs.y * theta2 * theta2 +
          radialCoeffs.z * theta2 * theta2 * theta2 +
          radialCoeffs.w * theta2 * theta2 * theta2 * theta2);
      vec2 lensCoord = distorted * radialCoord;
      float r2 = dot(lensCoord, lensCoord);
      float tx = 2.0 * tangential.x * lensCoord.x * lensCoord.y + tangential.y * (r2 + 2.0 * lensCoord.x * lensCoord.x);
      float ty = tangential.x * (r2 + 2.0 * lensCoord.y * lensCoord.y) + 2.0 * tangential.y * lensCoord.x * lensCoord.y;
      float ax = asymmetric.x * lensCoord.x + asymmetric.y * lensCoord.y;
      float ay = asymmetric.z * lensCoord.x + asymmetric.w * lensCoord.y;
      return center + principalOffset + vec2(
        focal.x * (lensCoord.x + tx + ax),
        focal.y * (lensCoord.y + ty + ay)
      );
    }

    vec2 applyDualFisheyeSensorTilt(vec2 point, vec2 tilt) {
      float cx = cos(tilt.x), sx = sin(tilt.x);
      float cy = cos(tilt.y), sy = sin(tilt.y);
      float rx = cy*point.x + sy*sx*point.y - sy*cx;
      float ry = cx*point.y + sx;
      float rz = sy*point.x - cy*sx*point.y + cy*cx;
      float safeRz = abs(rz) > 0.000001 ? rz : (rz < 0.0 ? -0.000001 : 0.000001);
      return vec2(cx*(cy*rx + sy*rz), cy*cx*ry - sx*rz) / safeRz;
    }

    vec3 projectMEIDualLens(
      vec3 dir,
      vec4 rotationQuat,
      vec2 center,
      vec2 focal,
      vec2 principalOffset,
      float xi,
      vec4 radialCoeffs,
      vec2 tangential,
      vec4 thinPrism,
      vec2 sensorTilt,
      vec4 pro0,
      vec4 pro1,
      vec4 pro2,
      float pro12,
      float usePro,
      vec3 translationM
    ) {
      // Calibration quaternions arrive as [w, x, y, z], while rotateByQuat
      // consumes the GPU-friendly [x, y, z, w] layout.
      vec3 local = rotateByQuat(vec4(-rotationQuat.y, -rotationQuat.z, -rotationQuat.w, rotationQuat.x), dir);
      float inverseDepth = uDualFisheyeConvergenceM > 0.0 ? 1.0 / uDualFisheyeConvergenceM : 0.0;
      float polarDepth = dir.y > 0.0 ? uDualFisheyePolarInverseDepth.y : uDualFisheyePolarInverseDepth.x;
      float polarStart = mix(sin(radians(30.0)), sin(radians(50.0)), uDualFisheyeVideoSeam);
      float polarEnd = mix(sin(radians(50.0)), sin(radians(65.0)), uDualFisheyeVideoSeam);
      if (polarDepth > 0.0) inverseDepth = mix(inverseDepth, polarDepth, smoothstep(polarStart, polarEnd, abs(dir.y)));
      if (inverseDepth > 0.0) {
        local = normalize(local / inverseDepth + translationM);
      }
      float denominator = local.z + xi;
      if (denominator <= 0.000001) return vec3(-1.0, -1.0, 0.0);
      vec2 normalized = local.xy / denominator;
      float r2 = dot(normalized, normalized);
      if (r2 > 16.0) return vec3(-1.0, -1.0, 0.0);
      float r4 = r2 * r2;
      float radialFactor = 1.0 + radialCoeffs.x*r2 + radialCoeffs.y*r4 + radialCoeffs.z*r2*r4 + radialCoeffs.w*r4*r4;
      float x = normalized.x;
      float y = normalized.y;
      vec2 distorted = vec2(
        x*radialFactor + 2.0*tangential.x*x*y + tangential.y*(r2 + 2.0*x*x) + thinPrism.x*r2 + thinPrism.y*r4,
        y*radialFactor + tangential.x*(r2 + 2.0*y*y) + 2.0*tangential.y*x*y + thinPrism.z*r2 + thinPrism.w*r4
      );
      vec2 projected = applyDualFisheyeSensorTilt(distorted, sensorTilt);
      if (usePro > 0.5) {
        float radial = 1.0 + pro0.x*r2 + pro0.y*r4 + pro0.z*r2*r4 + pro0.w*r4*r4 + pro1.x*r4*r4*r2;
        float a = pro1.y + pro1.w*r2;
        float b = pro1.z + pro2.x*r2;
        projected = vec2(
          x*radial + (r2+2.0*x*x)*a + 2.0*x*y*b + pro2.y*r2 + pro2.w*r4,
          y*radial + (r2+2.0*y*y)*b + 2.0*x*y*a + pro2.z*r2 + pro12*r4
        );
      }
      vec2 uv = center + principalOffset + focal * projected;
      return vec3(uv, 1.0);
    }

    vec3 projectDJIDualLens(
      vec3 dir,
      vec3 axis,
      vec2 center,
      vec3 right,
      vec3 up,
      vec2 focal,
      vec2 principalOffset,
      vec4 radialCoeffs,
      float radialScale,
      float radial5,
      vec2 tangential,
      float fullModel
    ) {
      vec3 local = vec3(dot(dir, right), -dot(dir, up), dot(dir, axis));
      float theta = atan(length(local.xy), local.z);
      if (theta >= radians(96.0)) return vec3(-1.0, -1.0, 0.0);
      float rho = length(local.xy);
      if (rho <= 0.000001) return vec3(center + principalOffset, 1.0);
      if (fullModel > 1.5) {
        float t2 = theta * theta;
        float r = theta * (1.0 + t2*(radialCoeffs.x+t2*(radialCoeffs.y+t2*(radialCoeffs.z+t2*(radialCoeffs.w+t2*radial5)))));
        vec2 xy = r * local.xy / rho;
        float r2 = dot(xy, xy);
        vec2 distorted = xy + vec2(
          2.0*tangential.x*xy.x*xy.y + tangential.y*(r2+2.0*xy.x*xy.x),
          tangential.x*(r2+2.0*xy.y*xy.y) + 2.0*tangential.y*xy.x*xy.y);
        return vec3(center + principalOffset + focal * distorted, 1.0);
      }
      float limit = radians(85.0);
      float t = min(theta, limit);
      float t2 = t * t;
      float polynomial = t * (1.0 + radialCoeffs.x*t2 + radialCoeffs.y*t2*t2 + radialCoeffs.z*t2*t2*t2 + radialCoeffs.w*t2*t2*t2*t2);
      if (theta > limit) {
        float derivative = 1.0 + 3.0*radialCoeffs.x*t2 + 5.0*radialCoeffs.y*t2*t2 + 7.0*radialCoeffs.z*t2*t2*t2 + 9.0*radialCoeffs.w*t2*t2*t2*t2;
        polynomial += derivative * (theta - limit);
      }
      vec2 radius = radialScale * focal * polynomial;
      return vec3(center + principalOffset + radius * local.xy / rho, 1.0);
    }

    vec4 sampleLens(vec2 uv, bool back) {
      if (uSeparateLenses < 0.5) return texture2D(uTex, clampTexelUV(uv));
      vec2 center = back ? uDualFisheyeBackCenter : uDualFisheyeFrontCenter;
      float physical = step(0.5, uVerticalLenses > 0.5 ? center.y : center.x);
      vec2 local = uVerticalLenses > 0.5 ? vec2(uv.x, uv.y * 2.0 - physical)
        : vec2(uv.x * 2.0 - physical, uv.y);
      local = clamp(local, uTexel, vec2(1.0) - uTexel);
      return physical > 0.5 ? texture2D(uBackTex, local) : texture2D(uTex, local);
    }
    vec4 sampleCubeTexture(vec2 uv) {
      if (uSeparateLenses < 0.5) return texture2D(uTex, clampTexelUV(uv));
      // Two independent EAC tracks each contain one row of the cube atlas.
      vec2 local = vec2(uv.x, fract(uv.y * 2.0));
      return uv.y >= 0.5 ? texture2D(uTex, local) : texture2D(uBackTex, local);
    }
    vec2 projectCube(vec3 d) {
      // Convert the viewer's -Z forward ray to v360's +Z coordinate system.
      d.z = -d.z;
      vec3 a = abs(d);
      vec2 q;
      float face;
      if (a.x >= a.y && a.x >= a.z) {
        if (d.x > 0.0) { face = 0.0; q = vec2(-d.z, d.y) / d.x; }
        else { face = 1.0; q = vec2(-d.z, -d.y) / d.x; }
      } else if (a.y >= a.z) {
        if (d.y < 0.0) { face = 2.0; q = vec2(-d.x, -d.z) / d.y; }
        else { face = 3.0; q = vec2(d.x, -d.z) / d.y; }
      } else {
        if (d.z > 0.0) { face = 4.0; q = vec2(d.x, d.y) / d.z; }
        else { face = 5.0; q = vec2(d.x, -d.y) / d.z; }
      }
      ${projectionKind === "eac" ? `
      // EAC face order L/F/R, D/B/U and lower-row rotations follow v360's EAC convention.
      if (face == 0.0) face = 2.0;
      else if (face == 1.0) face = 0.0;
      else if (face == 2.0) { face = 5.0; q = vec2(q.y, -q.x); }
      else if (face == 3.0) { face = 3.0; q = vec2(q.y, -q.x); }
      else if (face == 4.0) face = 1.0;
      else { face = 4.0; q = vec2(-q.y, q.x); }
      q = atan(q) * (2.0 / 3.141592653589793) + 0.5;
      vec2 pad = 2.0 * uTexel;
      return vec2((q.x + mod(face, 3.0)) * (1.0 - 2.0 * pad.x) / 3.0 + pad.x,
        1.0 - (q.y * (0.5 - 2.0 * pad.y) + pad.y + 0.5 * floor(face / 3.0)));
      ` : "vec2 edge = uTexel * vec2(1.5, 1.0); vec2 local = clamp((q + 1.0) * 0.5, edge, vec2(1.0) - edge); vec2 uv = (vec2(mod(face, 3.0), floor(face / 3.0)) + local) / vec2(3.0, 2.0); return vec2(uv.x, 1.0 - uv.y);"}
    }
    vec3 projectFrontLens(vec3 dir) {
      return uDualFisheyeFrontUseMEI > 0.5 ? projectMEIDualLens(
        dir,
        uDualFisheyeFrontRotationQuat,
        uDualFisheyeFrontCenter,
        uDualFisheyeFrontFocal,
        uDualFisheyeFrontPrincipalOffset,
        uDualFisheyeFrontXi,
        uDualFisheyeFrontRadial,
        uDualFisheyeFrontTangential,
        uDualFisheyeFrontThinPrism,
        uDualFisheyeFrontSensorTilt,
        uDualFisheyeFrontPro0,
        uDualFisheyeFrontPro1,
        uDualFisheyeFrontPro2,
        uDualFisheyeFrontPro12,
        uDualFisheyeFrontUsePro,
        uDualFisheyeFrontTranslationM
      ) : (uDualFisheyeFrontUseDJI > 0.5 ? projectDJIDualLens(
        dir,
        uDualFisheyeFrontAxis,
        uDualFisheyeFrontCenter,
        uDualFisheyeFrontRight,
        uDualFisheyeFrontUp,
        uDualFisheyeFrontFocal,
        uDualFisheyeFrontPrincipalOffset,
        uDualFisheyeFrontRadial,
        uDualFisheyeFrontRadialScale,
        uDualFisheyeDJIRadial5.x,
        uDualFisheyeFrontTangential,
        uDualFisheyeFrontUseDJI
      ) : vec3(projectDistortedDualLens(
        dir,
        uDualFisheyeFrontAxis,
        uDualFisheyeFrontCenter,
        uDualFisheyeFrontRight,
        uDualFisheyeFrontUp,
        uDualFisheyeFrontFocal,
        uDualFisheyeFrontPrincipalOffset,
        uDualFisheyeFrontRadial,
        uDualFisheyeFrontTangential,
        uDualFisheyeFrontAsymmetric
      ), float(acos(clamp(dot(dir, uDualFisheyeFrontAxis), -1.0, 1.0)) <= uDualFisheyeMaxTheta)));
    }
    vec3 projectBackLens(vec3 dir) {
      vec3 backDirection = dir;
      if (length(uDualFisheyeVideoOffsets) > 0.0) {
        float longitude = atan(dir.x, dir.z);
        float latitude = asin(clamp(dir.y, -1.0, 1.0));
        // A smooth spherical field joins independently registered overlaps;
        // it does not jump when the camera crosses a seam or a video frame.
        vec2 offset = mix(uDualFisheyeVideoOffsets.xy, uDualFisheyeVideoOffsets.zw, 0.5 + 0.5 * sin(longitude));
        offset *= 1.0 - smoothstep(sin(radians(50.0)), sin(radians(70.0)), abs(dir.y));
        longitude += offset.x;
        latitude = clamp(latitude + offset.y, -PI * 0.5, PI * 0.5);
        backDirection = vec3(cos(latitude) * sin(longitude), sin(latitude), cos(latitude) * cos(longitude));
      }
      return uDualFisheyeBackUseMEI > 0.5 ? projectMEIDualLens(
        backDirection,
        uDualFisheyeBackRotationQuat,
        uDualFisheyeBackCenter,
        uDualFisheyeBackFocal,
        uDualFisheyeBackPrincipalOffset,
        uDualFisheyeBackXi,
        uDualFisheyeBackRadial,
        uDualFisheyeBackTangential,
        uDualFisheyeBackThinPrism,
        uDualFisheyeBackSensorTilt,
        uDualFisheyeBackPro0,
        uDualFisheyeBackPro1,
        uDualFisheyeBackPro2,
        uDualFisheyeBackPro12,
        uDualFisheyeBackUsePro,
        uDualFisheyeBackTranslationM
      ) : (uDualFisheyeBackUseDJI > 0.5 ? projectDJIDualLens(
        backDirection,
        uDualFisheyeBackAxis,
        uDualFisheyeBackCenter,
        uDualFisheyeBackRight,
        uDualFisheyeBackUp,
        uDualFisheyeBackFocal,
        uDualFisheyeBackPrincipalOffset,
        uDualFisheyeBackRadial,
        uDualFisheyeBackRadialScale,
        uDualFisheyeDJIRadial5.y,
        uDualFisheyeBackTangential,
        uDualFisheyeBackUseDJI
      ) : vec3(projectDistortedDualLens(
        dir,
        uDualFisheyeBackAxis,
        uDualFisheyeBackCenter,
        uDualFisheyeBackRight,
        uDualFisheyeBackUp,
        uDualFisheyeBackFocal,
        uDualFisheyeBackPrincipalOffset,
        uDualFisheyeBackRadial,
        uDualFisheyeBackTangential,
        uDualFisheyeBackAsymmetric
      ), float(acos(clamp(dot(dir, uDualFisheyeBackAxis), -1.0, 1.0)) <= uDualFisheyeMaxTheta)));
    }
    vec4 sampleDualFisheye(vec3 dir) {
      // The padded viewport has one calibrated owner. Avoid the other
      // distortion projection, texture fetch and blend for every visible pixel.
      if (uVisibleLens > 0.5) {
        bool back = uVisibleLens > 1.5;
        vec3 projected;
        if (back) projected = projectBackLens(dir);
        else projected = projectFrontLens(dir);
        vec2 center = back ? uDualFisheyeBackCenter : uDualFisheyeFrontCenter;
        vec2 radius = back ? uDualFisheyeBackValidRadius : uDualFisheyeFrontValidRadius;
        if (projected.z > 0.5 && dualFisheyeLensCoverage(projected.xy, center, radius) > 0.0 &&
          projected.x >= 0.0 && projected.y >= 0.0 && projected.x <= 1.0 && projected.y <= 1.0) {
          return sampleLens(flipDualFisheyeUV(projected.xy, center), back) *
            vec4(vec3(back ? uDualFisheyeGain.y : uDualFisheyeGain.x), 1.0);
        }
      }
      float frontDot = dot(dir, uDualFisheyeFrontAxis);
      float backDot = dot(dir, uDualFisheyeBackAxis);
      if (uDualFisheyeUseRemap > 0.5) {
        vec2 baseUV = projectEquirect(dir);
        vec4 frontMap = sampleDualFisheyeRemap(uDualFisheyeFrontRemap, baseUV);
        vec4 backMap = sampleDualFisheyeRemap(uDualFisheyeBackRemap, baseUV);
        bool frontValid = frontMap.z > 0.5;
        bool backValid = backMap.z > 0.5;
        frontMap.xy = flipDualFisheyeUV(frontMap.xy, uDualFisheyeFrontCenter);
        backMap.xy = flipDualFisheyeUV(backMap.xy, uDualFisheyeBackCenter);
        vec4 frontColor = frontValid ? sampleLens(frontMap.xy, false) * vec4(vec3(uDualFisheyeGain.x), 1.0) : vec4(0.0);
        vec4 backColor = backValid ? sampleLens(backMap.xy, true) * vec4(vec3(uDualFisheyeGain.y), 1.0) : vec4(0.0);
        if (frontValid && backValid) {
          float seamBlend = dualFisheyeBlendWeight(dir, frontDot, backDot, frontMap.w, backMap.w);
          float totalConfidence = max(0.0001, frontMap.w + backMap.w);
          float confidenceBlend = clamp(frontMap.w / totalConfidence, 0.0, 1.0);
          float blend = clamp(mix(confidenceBlend, seamBlend, 0.75), 0.0, 1.0);
          blend = dualFisheyeEdgeAwareBlend(blend, frontColor, backColor);
          return mix(backColor, frontColor, blend);
        }
        if (frontValid) return frontColor;
        if (backValid) return backColor;
        return vec4(0.0, 0.0, 0.0, 1.0);
      }
      vec3 frontProjection = projectFrontLens(dir);
      vec3 backProjection = projectBackLens(dir);
      vec2 uvFront = frontProjection.xy;
      vec2 uvBack = backProjection.xy;
      float frontCoverage = dualFisheyeLensCoverage(uvFront, uDualFisheyeFrontCenter, uDualFisheyeFrontValidRadius);
      float backCoverage = dualFisheyeLensCoverage(uvBack, uDualFisheyeBackCenter, uDualFisheyeBackValidRadius);
      bool frontValid = frontProjection.z > 0.5 && frontCoverage > 0.0 && uvFront.x >= 0.0 && uvFront.y >= 0.0 && uvFront.x <= 1.0 && uvFront.y <= 1.0;
      bool backValid = backProjection.z > 0.5 && backCoverage > 0.0 && uvBack.x >= 0.0 && uvBack.y >= 0.0 && uvBack.x <= 1.0 && uvBack.y <= 1.0;
      uvFront = flipDualFisheyeUV(uvFront, uDualFisheyeFrontCenter);
      uvBack = flipDualFisheyeUV(uvBack, uDualFisheyeBackCenter);
      vec4 frontColor = frontValid ? sampleLens(uvFront, false) * vec4(vec3(uDualFisheyeGain.x), 1.0) : vec4(0.0);
      vec4 backColor = backValid ? sampleLens(uvBack, true) * vec4(vec3(uDualFisheyeGain.y), 1.0) : vec4(0.0);
      if (frontValid && backValid) {
        float blend = dualFisheyeBlendWeight(dir, frontDot, backDot, frontCoverage, backCoverage);
        blend = dualFisheyeEdgeAwareBlend(blend, frontColor, backColor);
        return mix(backColor, frontColor, blend);
      }
      if (frontValid) return frontColor;
      if (backValid) return backColor;
      return vec4(0.0, 0.0, 0.0, 1.0);
    }

    void main() {
      ${options.captureEquirectangular ? `
      vec2 sphereUV = vec2(gl_FragCoord.x / uViewport.x, 1.0 - gl_FragCoord.y / uViewport.y);
      float longitude = (sphereUV.x - 0.5) * 2.0 * PI;
      float latitude = (sphereUV.y - 0.5) * PI;
      vec3 dir = vec3(cos(latitude) * sin(longitude), sin(latitude), ${useMEICameraConvention ? '' : '-'}cos(latitude) * cos(longitude));
      ` : `
      vec2 ndc = (gl_FragCoord.xy / uViewport) * 2.0 - 1.0;
      ndc.y = -ndc.y;
      vec3 ray = normalize(vec3(ndc.x * uAspect * uTanHalfFov, ndc.y * uTanHalfFov, ${useMEICameraConvention ? "1.0" : "-1.0"}));
      vec3 dir = normalize(rotateByQuat(uViewQuat, ray));
      `}
      ${fragmentMainBody}
    }
  `;

  const program = createProgram(gl, vsSrc, fsSrc);
  gl.useProgram(program);

  const clipLoc = gl.getAttribLocation(program, "aClipPosition");
  const texLoc = gl.getUniformLocation(program, "uTex");
  const viewportLoc = gl.getUniformLocation(program, "uViewport");
  const texelLoc = gl.getUniformLocation(program, "uTexel");
  const aspectLoc = gl.getUniformLocation(program, "uAspect");
  const tanHalfFovLoc = gl.getUniformLocation(program, "uTanHalfFov");
  const viewQuatLoc = gl.getUniformLocation(program, "uViewQuat");
  const visibleLensLoc = gl.getUniformLocation(program, "uVisibleLens");
  const seamWidthLoc = gl.getUniformLocation(program, "uSeamWidth");
  const dualFrontCenterLoc = gl.getUniformLocation(program, "uDualFisheyeFrontCenter");
  const dualBackCenterLoc = gl.getUniformLocation(program, "uDualFisheyeBackCenter");
  const dualFrontValidRadiusLoc = gl.getUniformLocation(program, "uDualFisheyeFrontValidRadius");
  const dualBackValidRadiusLoc = gl.getUniformLocation(program, "uDualFisheyeBackValidRadius");
  const dualFrontFocalLoc = gl.getUniformLocation(program, "uDualFisheyeFrontFocal");
  const dualBackFocalLoc = gl.getUniformLocation(program, "uDualFisheyeBackFocal");
  const dualFrontPrincipalOffsetLoc = gl.getUniformLocation(program, "uDualFisheyeFrontPrincipalOffset");
  const dualBackPrincipalOffsetLoc = gl.getUniformLocation(program, "uDualFisheyeBackPrincipalOffset");
  const dualFrontScaleLoc = gl.getUniformLocation(program, "uDualFisheyeFrontScale");
  const dualBackScaleLoc = gl.getUniformLocation(program, "uDualFisheyeBackScale");
  const dualFrontRadialLoc = gl.getUniformLocation(program, "uDualFisheyeFrontRadial");
  const dualBackRadialLoc = gl.getUniformLocation(program, "uDualFisheyeBackRadial");
  const dualFrontRadialScaleLoc = gl.getUniformLocation(program, "uDualFisheyeFrontRadialScale");
  const dualBackRadialScaleLoc = gl.getUniformLocation(program, "uDualFisheyeBackRadialScale");
  const dualDJIRadial5Loc = gl.getUniformLocation(program, "uDualFisheyeDJIRadial5");
  const dualFrontTangentialLoc = gl.getUniformLocation(program, "uDualFisheyeFrontTangential");
  const dualBackTangentialLoc = gl.getUniformLocation(program, "uDualFisheyeBackTangential");
  const dualFrontXiLoc = gl.getUniformLocation(program, "uDualFisheyeFrontXi");
  const dualBackXiLoc = gl.getUniformLocation(program, "uDualFisheyeBackXi");
  const dualFrontThinPrismLoc = gl.getUniformLocation(program, "uDualFisheyeFrontThinPrism");
  const dualBackThinPrismLoc = gl.getUniformLocation(program, "uDualFisheyeBackThinPrism");
  const dualFrontSensorTiltLoc = gl.getUniformLocation(program, "uDualFisheyeFrontSensorTilt");
  const dualBackSensorTiltLoc = gl.getUniformLocation(program, "uDualFisheyeBackSensorTilt");
  const convergenceLoc = gl.getUniformLocation(program, "uDualFisheyeConvergenceM");
  const polarDepthLoc = gl.getUniformLocation(program, "uDualFisheyePolarInverseDepth");
  const translationLocations = ["Front", "Back"].map((side) => gl.getUniformLocation(program, `uDualFisheye${side}TranslationM`));
  const proLocations = ["Front", "Back"].map((side) => ["Pro0", "Pro1", "Pro2", "Pro12", "UsePro"]
    .map((field) => gl.getUniformLocation(program, `uDualFisheye${side}${field}`)));
  const dualFrontRotationQuatLoc = gl.getUniformLocation(program, "uDualFisheyeFrontRotationQuat");
  const dualBackRotationQuatLoc = gl.getUniformLocation(program, "uDualFisheyeBackRotationQuat");
  const dualFrontUseMEILoc = gl.getUniformLocation(program, "uDualFisheyeFrontUseMEI");
  const dualBackUseMEILoc = gl.getUniformLocation(program, "uDualFisheyeBackUseMEI");
  const dualFrontUseDJILoc = gl.getUniformLocation(program, "uDualFisheyeFrontUseDJI");
  const dualBackUseDJILoc = gl.getUniformLocation(program, "uDualFisheyeBackUseDJI");
  const dualFrontAsymmetricLoc = gl.getUniformLocation(program, "uDualFisheyeFrontAsymmetric");
  const dualBackAsymmetricLoc = gl.getUniformLocation(program, "uDualFisheyeBackAsymmetric");
  const dualFrontAxisLoc = gl.getUniformLocation(program, "uDualFisheyeFrontAxis");
  const dualBackAxisLoc = gl.getUniformLocation(program, "uDualFisheyeBackAxis");
  const dualFrontRightLoc = gl.getUniformLocation(program, "uDualFisheyeFrontRight");
  const dualBackRightLoc = gl.getUniformLocation(program, "uDualFisheyeBackRight");
  const dualFrontUpLoc = gl.getUniformLocation(program, "uDualFisheyeFrontUp");
  const dualBackUpLoc = gl.getUniformLocation(program, "uDualFisheyeBackUp");
  const dualMaxThetaLoc = gl.getUniformLocation(program, "uDualFisheyeMaxTheta");
  const dualBlendBandLoc = gl.getUniformLocation(program, "uDualFisheyeBlendBand");
  const dualSeamXLoc = gl.getUniformLocation(program, "uDualFisheyeSeamX");
  const dualSeamBlendXLoc = gl.getUniformLocation(program, "uDualFisheyeSeamBlendX");
  const dualSeamFrontWrapLoc = gl.getUniformLocation(program, "uDualFisheyeSeamFrontWrap");
  const dualUseSeamLongitudesLoc = gl.getUniformLocation(program, "uDualFisheyeUseSeamLongitudes");
  const dualGainLoc = gl.getUniformLocation(program, "uDualFisheyeGain");
  const dualFrontRemapLoc = gl.getUniformLocation(program, "uDualFisheyeFrontRemap");
  const dualBackRemapLoc = gl.getUniformLocation(program, "uDualFisheyeBackRemap");
  const dualUseRemapLoc = gl.getUniformLocation(program, "uDualFisheyeUseRemap");
  const dualSeamMaskLoc = gl.getUniformLocation(program, "uDualFisheyeSeamMask");
  const dualUseSeamMaskLoc = gl.getUniformLocation(program, "uDualFisheyeUseSeamMask");
  const videoOffsetsLoc = gl.getUniformLocation(program, "uDualFisheyeVideoOffsets");
  const videoSeamLoc = gl.getUniformLocation(program, "uDualFisheyeVideoSeam");

  const clipBuf = gl.createBuffer();
  if (!clipBuf) {
    throw new Error("buffer create failed");
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, clipBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(clipLoc);
  gl.vertexAttribPointer(clipLoc, 2, gl.FLOAT, false, 0, 0);

  const tex = gl.createTexture();
  if (!tex) throw new Error("texture create failed");
  const backTex = externalFrames ? gl.createTexture() : null;
  const separateLoc = gl.getUniformLocation(program, "uSeparateLenses");
  const verticalLoc = gl.getUniformLocation(program, "uVerticalLenses");
  if (backTex) {
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, backTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(gl.getUniformLocation(program, "uBackTex"), 4);
  }
  let textureStorageSize = { width: 1, height: 1 };
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(texLoc, 0);

  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, textureFlipY ? 1 : 0);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  // Initialize texture to avoid undefined/gray framebuffer before first decoded frame.
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 255]),
  );

  function createLookupTexture(textureUnitIndex, uniformLoc, pixels, width, height) {
    if (!uniformLoc || !(pixels instanceof Uint8Array) || width <= 0 || height <= 0) {
      return null;
    }
    const texture = gl.createTexture();
    if (!texture) return null;
    gl.activeTexture(gl.TEXTURE0 + textureUnitIndex);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(uniformLoc, textureUnitIndex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    return texture;
  }

  gl.disable(gl.CULL_FACE);
  gl.disable(gl.DEPTH_TEST);

  function resolveDualFisheyeSeamConfig() {
    const seams = normalizeSeamLongitudesDeg(options.dualFisheyeSeamLongitudesDeg);
    const seamX = seams
      .map((degrees) => normalizeLongitudeDeg(degrees) / 360)
      .sort((a, b) => a - b);
    // DJI's first optical lens can face -Z after the body-to-camera axis
    // conversion. Assign its actual hemisphere, otherwise the overlap strip
    // selects the opposite lens and creates two hard transitions.
    const frontCenterX = frontUsesDJI
      ? Math.atan2(frontAxis[0], frontAxis[2]) / (2 * Math.PI) + 0.5
      : 0.5;
    const frontWrap = !(frontCenterX >= seamX[0] && frontCenterX <= seamX[1]);
    return {
      seamX,
      frontWrap,
      blendX: clamp(options.dualFisheyeSeamBlendDeg / 360, 0.0001, 0.125),
      enabled: seamX.length >= 2 && Math.abs(seamX[0] - seamX[1]) > 0.0001,
    };
  }

  const supportsVideoFrameCallback =
    isVideo &&
    typeof mediaEl.requestVideoFrameCallback === "function" &&
    typeof mediaEl.cancelVideoFrameCallback === "function";

  let yawDeg = 0;
  let pitchDeg = 0;
  let rollDeg = 0;
  let fovDeg = options.fovDeg;
  let dirty = true;
  let running = true;
  let rafId = 0;
  let videoFrameId = 0;
  let needsTextureUpload = true;
  let uploadedTextureSize = { width: 1, height: 1 };
  const externalTextureSizes = [];
  let releaseRetainedTextureSource = null;
  let releaseLifetimeTextureSource = null;
  let retainedTextureReleaseFrameId = 0;
  let drawCount = 0;
  let resizeCount = 0;
  let lastFrameReason = "initial";
  const continuous = isVideo && !supportsVideoFrameCallback;
  const bg = parseCSSColorToRGBA(options.background);
  const mediaSize = getMediaTextureSize(mediaEl);
  const verticalDualFisheye = projectionKind === "dual_fisheye" && isVerticalDualFisheyeSource(mediaSize.width, mediaSize.height);
  const remap = calibration && !verticalDualFisheye ? calibration.remap : null;
  const dualMaxThetaRad = (options.dualFisheyeFovDeg * Math.PI) / 360;
  const baseFrontCenter = calibration ? calibration.front.center : (options.dualFisheyeFrontCenter || (options.dualFisheyeFrontLens === "left" ? [0.25, 0.5] : [0.75, 0.5]));
  const baseBackCenter = calibration ? calibration.back.center : (options.dualFisheyeBackCenter || (options.dualFisheyeFrontLens === "left" ? [0.75, 0.5] : [0.25, 0.5]));
  const calibrationUsesNativeLayout = Boolean(
    calibration && calibration.imageSize?.[1] > calibration.imageSize?.[0],
  );
  const swapForVerticalLayout = (value) => (
    verticalDualFisheye && !calibrationUsesNativeLayout ? [value[1], value[0]] : value
  );
  const frontCenter = swapForVerticalLayout(baseFrontCenter);
  const backCenter = swapForVerticalLayout(baseBackCenter);
  const inferredValidRadius = inferDualFisheyeValidRadius(frontCenter, backCenter);
  let frontValidRadius = calibration ? swapForVerticalLayout(calibration.front.validRadius) : inferredValidRadius;
  let backValidRadius = calibration ? swapForVerticalLayout(calibration.back.validRadius) : inferredValidRadius;
  const frontScale = calibration ? swapForVerticalLayout(calibration.front.scale) : swapForVerticalLayout(normalizeVec2(options.dualFisheyeScale, [0.247, 0.494]));
  const backScale = calibration ? swapForVerticalLayout(calibration.back.scale) : swapForVerticalLayout(normalizeVec2(options.dualFisheyeScale, [0.247, 0.494]));
  let frontFocal = calibration ? swapForVerticalLayout(calibration.front.focal) : scaleDualFisheyeRadiusToFocal(frontScale, dualMaxThetaRad);
  let backFocal = calibration ? swapForVerticalLayout(calibration.back.focal) : scaleDualFisheyeRadiusToFocal(backScale, dualMaxThetaRad);
  const frontPrincipalOffset = calibration ? swapForVerticalLayout(calibration.front.principalOffset) : [0, 0];
  const backPrincipalOffset = calibration ? swapForVerticalLayout(calibration.back.principalOffset) : [0, 0];
  const frontRadial = calibration ? calibration.front.radial : [0, 0, 0, 0];
  const backRadial = calibration ? calibration.back.radial : [0, 0, 0, 0];
  const frontRadialScale = calibration ? calibration.front.radialScale : 1;
  const backRadialScale = calibration ? calibration.back.radialScale : 1;
  const frontTangential = calibration ? calibration.front.tangential : [0, 0];
  const backTangential = calibration ? calibration.back.tangential : [0, 0];
  const frontXi = calibration ? calibration.front.xi : 0;
  const backXi = calibration ? calibration.back.xi : 0;
  const frontThinPrism = calibration ? calibration.front.thinPrism : [0, 0, 0, 0];
  const backThinPrism = calibration ? calibration.back.thinPrism : [0, 0, 0, 0];
  const frontSensorTilt = calibration ? swapForVerticalLayout(calibration.front.sensorTilt) : [0, 0];
  const backSensorTilt = calibration ? swapForVerticalLayout(calibration.back.sensorTilt) : [0, 0];
  const frontUsesMEI = Boolean(calibration && calibration.front.projectionModel === "mei_extended");
  const backUsesMEI = Boolean(calibration && calibration.back.projectionModel === "mei_extended");
  const frontUsesDJI = Boolean(calibration && calibration.front.projectionModel === "dji_fisheye_lut");
  const backUsesDJI = Boolean(calibration && calibration.back.projectionModel === "dji_fisheye_lut");
  const frontAsymmetric = calibration ? calibration.front.asymmetric : [0, 0, 0, 0];
  const backAsymmetric = calibration ? calibration.back.asymmetric : [0, 0, 0, 0];
  const frontAxis = calibration ? calibration.front.axis : [0, 0, -1];
  const backAxis = calibration ? calibration.back.axis : [0, 0, 1];
  const frontRight = calibration ? calibration.front.right : [1, 0, 0];
  const backRight = calibration ? calibration.back.right : [-1, 0, 0];
  const frontUp = calibration ? calibration.front.up : [0, 1, 0];
  const backUp = calibration ? calibration.back.up : [0, 1, 0];
  const analysisFrontLens = {
    ...(calibration ? calibration.front : {}),
    center: frontCenter,
    focal: frontFocal,
    principalOffset: frontPrincipalOffset,
    scale: frontScale,
    validRadius: frontValidRadius,
    radial: frontRadial,
    radialScale: frontRadialScale,
    tangential: frontTangential,
    projectionModel: calibration ? calibration.front.projectionModel : "equidistant",
    xi: frontXi,
    thinPrism: frontThinPrism,
    axis: frontAxis,
    right: frontRight,
    up: frontUp,
  };
  const analysisBackLens = {
    ...(calibration ? calibration.back : {}),
    center: backCenter,
    focal: backFocal,
    principalOffset: backPrincipalOffset,
    scale: backScale,
    validRadius: backValidRadius,
    radial: backRadial,
    radialScale: backRadialScale,
    tangential: backTangential,
    projectionModel: calibration ? calibration.back.projectionModel : "equidistant",
    xi: backXi,
    thinPrism: backThinPrism,
    axis: backAxis,
    right: backRight,
    up: backUp,
  };
  const frontRemapTexture = remap
    ? createLookupTexture(1, dualFrontRemapLoc, remap.front, remap.width, remap.height)
    : null;
  const backRemapTexture = remap
    ? createLookupTexture(2, dualBackRemapLoc, remap.back, remap.width, remap.height)
    : null;
  const seamConfig = resolveDualFisheyeSeamConfig();
  let seamMaskTexture = null;
  let useSeamMask = 0;
  let staticSeamAnalyzed = false;
  let lensGain = [options.dualFisheyeGainFront, options.dualFisheyeGainBack];
  let convergenceM = 0;
  let polarInverseDepth = [0, 0];
  const proCoefficients = [calibration?.front, calibration?.back].map((lens) => lens?.distortionCoeffs || Array(13).fill(0));
  const canProtectX5 = Boolean(isVideo && projectionKind === 'dual_fisheye' && calibration && !remap && !verticalDualFisheye &&
    calibration.imageSize[0] === 2 * calibration.imageSize[1] &&
    [analysisFrontLens, analysisBackLens].every((lens) => lens.projectionModel === 'mei_extended' &&
      (lens.distortionModel === 'radtan_pro' || options.dualFisheyeVideoProtection === true)));
  // X5 keeps its metadata geometry by default. DJI opts into one bounded
  // overlap fit for the approximate radial model; retain the first accepted
  // fit across frames and seeks instead of changing geometry with the scene.
  const canRegisterDJI = Boolean(isVideo && projectionKind === 'dual_fisheye' && calibration && !remap && !verticalDualFisheye &&
    calibration.imageSize[0] === 2 * calibration.imageSize[1] &&
    [analysisFrontLens, analysisBackLens].every((lens) => lens.projectionModel === 'dji_fisheye_lut'));
  if (canRegisterDJI) {
    // The generic 5% inset cuts into DJI's calibrated overlap and creates
    // a hard owner switch. Use the same sensor circles for fitting and drawing.
    frontValidRadius = analysisFrontLens.validRadius = x5VideoLensRadius(analysisFrontLens);
    backValidRadius = analysisBackLens.validRadius = x5VideoLensRadius(analysisBackLens);
  }
  const canProtectVideo = canProtectX5 || canRegisterDJI;
  const canRegisterVideo = canProtectVideo && options.dualFisheyeVideoRegistration === true;
  let videoOffsets = [0, 0, 0, 0];
  let videoRegistered = canProtectVideo && !canRegisterVideo;
  let videoRegistrationAttempts = 0;
  let nextVideoRegistrationTime = 0;
  canvas.dataset.insta360VideoRegistration = canRegisterVideo ? 'pending' : canProtectVideo ? 'calibrated' : 'unsupported';

  function registerVideoFrame() {
    if (!canRegisterVideo || videoRegistered || videoRegistrationAttempts >= 3 || mediaEl.currentTime < nextVideoRegistrationTime) return;
    const started = Date.now();
    try {
      const analysis = (canRegisterDJI ? analyzeDJIVideoFrame : analyzeX5VideoFrame)(mediaEl, options, calibration, [analysisFrontLens, analysisBackLens]);
      if (analysis === undefined) return;
      if (analysis) {
        videoOffsets = analysis.offsets;
        polarInverseDepth = analysis.polarInverseDepth || [0, 0];
        lensGain = analysis.gain;
        if (canRegisterDJI) {
          frontFocal = frontFocal.map((value) => value * analysis.focalScale);
          backFocal = backFocal.map((value) => value * analysis.focalScale);
          canvas.dataset.insta360VideoFocalScale = String(analysis.focalScale);
        } else {
          frontValidRadius = x5VideoLensRadius(analysisFrontLens);
          backValidRadius = x5VideoLensRadius(analysisBackLens);
        }
        videoRegistered = true;
      }
    } catch {
      // Canvas readback is optional (e.g. CORS). Keep metadata projection.
    }
    videoRegistrationAttempts += 1;
    nextVideoRegistrationTime = mediaEl.currentTime + 1;
    canvas.dataset.insta360VideoRegistration = videoRegistered ? 'ready' : videoRegistrationAttempts < 3 ? 'pending' : 'fallback';
    canvas.dataset.insta360VideoRegistrationAttempts = String(videoRegistrationAttempts);
    canvas.dataset.insta360VideoRegistrationMS = String(Date.now() - started);
  }

  if (!isVideo && projectionKind === "dual_fisheye") {
    staticSeamAnalyzed = true;
    try {
      const seamAnalysis = acceptStaticDualFisheyeImage(
        mediaEl,
        options,
        calibration,
        remap,
        analysisFrontLens,
        analysisBackLens,
        dualMaxThetaRad,
      );
      if (seamAnalysis) {
        lensGain = seamAnalysis.gain;
        convergenceM = seamAnalysis.convergenceM;
        polarInverseDepth = seamAnalysis.polarInverseDepth || [0, 0];
        videoOffsets = seamAnalysis.imageOffsets || [0, 0, 0, 0];
        frontFocal = frontFocal.map((value) => value * seamAnalysis.focalScale);
        backFocal = backFocal.map((value) => value * seamAnalysis.focalScale);
      }
      uploadSeamMask(seamAnalysis?.mask);
    } catch (error) {
      // Keep calibrated geometry blending when optional CPU seam analysis fails.
      canvas.dataset.insta360StaticSeamError = String(error?.message || error);
      seamMaskTexture = null;
      useSeamMask = 0;
    }
  }
  canvas.dataset.insta360StaticSeamAnalyzed = staticSeamAnalyzed ? "true" : "false";
  canvas.dataset.insta360StaticSeamStatus = !staticSeamAnalyzed ? 'not-applicable' : useSeamMask ? 'ready' : 'fallback';

  function uploadSeamMask(mask, strength = null) {
    if (!(mask instanceof Uint8Array) || !dualSeamMaskLoc) return false;
    if (!seamMaskTexture) seamMaskTexture = gl.createTexture();
    if (!seamMaskTexture) return false;
    try {
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, seamMaskTexture);
      gl.uniform1i(dualSeamMaskLoc, 3);
      // CPU rows already use projectEquirect UVs. A typed-array flip would
      // apply the lower person's protection to the opposite hemisphere.
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      const format = strength ? gl.LUMINANCE_ALPHA : gl.LUMINANCE;
      const data = strength ? Uint8Array.from({ length: mask.length * 2 }, (_, index) =>
        index % 2 ? strength[index >> 1] : mask[index >> 1]) : mask;
      gl.texImage2D(gl.TEXTURE_2D, 0, format, ANALYSIS_WIDTH, ANALYSIS_HEIGHT, 0, format, gl.UNSIGNED_BYTE, data);
      useSeamMask = 1;
      return true;
    } finally {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, textureFlipY ? 1 : 0);
    }
  }

  let previousVideoMask = null;
  const videoAnalysisCache = {};
  let videoAnalysisInterval = 1;
  let previousExternalTime = null;
  let nextVideoSeamTime = -Infinity;
  let videoSeamFailures = 0;
  let videoSeamUpdates = 0;
  function protectVideoFrame() {
    if (!canProtectVideo || !videoRegistered || videoSeamFailures >= 3 || mediaEl.seeking || mediaEl.currentTime + 1e-6 < nextVideoSeamTime) return;
    const started = Date.now();
    try {
      const analysis = analyzeX5VideoSeamFrame(mediaEl, options, calibration,
        [{ ...analysisFrontLens, focal: frontFocal, validRadius: frontValidRadius }, { ...analysisBackLens, focal: backFocal, validRadius: backValidRadius }],
        { offsets: videoOffsets, gain: lensGain, polarInverseDepth }, previousVideoMask, videoAnalysisCache);
      if (analysis === undefined) return;
      if (analysis?.reused) {
        nextVideoSeamTime = mediaEl.currentTime + videoAnalysisInterval;
        canvas.dataset.insta360VideoSeam = 'cached';
        return;
      }
      const mask = analysis?.mask;
      if (mask instanceof Uint8Array) {
        const displayed = blendDualFisheyeVideoMasks(mask, previousVideoMask, analysis.strength);
        if (uploadSeamMask(displayed, analysis.strength)) {
          previousVideoMask = displayed;
          videoSeamFailures = 0;
          videoSeamUpdates += 1;
        } else videoSeamFailures += 1;
      } else videoSeamFailures += 1;
    } catch {
      // Repeated optional readback failure must not stall video playback.
      videoSeamFailures += 1;
    }
    if (videoSeamFailures >= 3) {
      useSeamMask = 0;
      previousVideoMask = null;
    }
    const elapsed = Date.now() - started;
    // Keep global seam/person analysis off the critical frame path. Geometry
    // and the visible viewport still update on every presented video frame.
    videoAnalysisInterval = elapsed > 100 ? 5 : elapsed > 33 ? 3 : 1;
    nextVideoSeamTime = mediaEl.currentTime + videoAnalysisInterval;
    canvas.dataset.insta360VideoSeamUpdates = String(videoSeamUpdates);
    canvas.dataset.insta360VideoSeamMS = String(elapsed);
    canvas.dataset.insta360VideoSeamInterval = String(videoAnalysisInterval);
    canvas.dataset.insta360VideoSeam = useSeamMask ? 'ready' : videoSeamFailures >= 3 ? 'fallback' : 'pending';
  }

  function scheduleVideoFrameCallback() {
    if (!supportsVideoFrameCallback || !running || !isVideo || mediaEl.paused || mediaEl.ended || videoFrameId) return;
    videoFrameId = mediaEl.requestVideoFrameCallback(() => {
      videoFrameId = 0;
      if (nativeSeekRefresh || playbackCadenceDue(performance.now(), nextNativeUploadAt)) {
        needsTextureUpload = true;
        requestFrame();
      }
      scheduleVideoFrameCallback();
    });
  }

  function cancelVideoFrameCallback() {
    if (!supportsVideoFrameCallback || !videoFrameId || !isVideo) return;
    mediaEl.cancelVideoFrameCallback(videoFrameId);
    videoFrameId = 0;
  }

  function normalizeYawDeg(deg) {
    let v = Number(deg) || 0;
    v = ((v % 360) + 360) % 360;
    if (v > 180) v -= 360;
    return v;
  }

  function setView(nextYaw, nextPitch, nextRollOrFov, nextMaybeFov) {
    yawDeg = normalizeYawDeg(nextYaw);
    pitchDeg = clamp(Number(nextPitch) || 0, -85, 85);
    if (typeof nextMaybeFov === "number") {
      rollDeg = clamp(Number(nextRollOrFov) || 0, -180, 180);
      fovDeg = clamp(Number(nextMaybeFov) || DEFAULT_OPTIONS.fovDeg, options.minFovDeg, options.maxFovDeg);
    } else {
      fovDeg = clamp(Number(nextRollOrFov) || DEFAULT_OPTIONS.fovDeg, options.minFovDeg, options.maxFovDeg);
    }
    dirty = true;
  }

  function resize() {
    const autoMaxDpr = isVideo ? 1.5 : 2;
    const maxDpr = options.maxRenderPixelRatio > 0 ? options.maxRenderPixelRatio : autoMaxDpr;
    const dpr = Math.max(1, Math.min(maxDpr, window.devicePixelRatio || 1));
    const cssW = options.captureEquirectangular ? 1024 : Math.max(1, canvas.clientWidth | 0);
    const cssH = options.captureEquirectangular ? 512 : Math.max(1, canvas.clientHeight | 0);
    const pixelScale = playbackQuality.maxRenderPixels > 0
      ? Math.min(1, Math.sqrt(playbackQuality.maxRenderPixels / (cssW * cssH * dpr * dpr))) : 1;
    const w = Math.max(1, Math.floor(cssW * dpr * pixelScale));
    const h = Math.max(1, Math.floor(cssH * dpr * pixelScale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      dirty = true;
      resizeCount += 1;
      lastFrameReason = "resize";
      canvas.dataset.insta360ResizeCount = String(resizeCount);
      canvas.dataset.insta360CanvasWidth = String(w);
      canvas.dataset.insta360CanvasHeight = String(h);
    }
  }

  function clearWebGLErrors() {
    for (let attempt = 0; attempt < 16 && gl.getError() !== gl.NO_ERROR; attempt += 1) {
      // Drain stale errors so the next texture upload result is attributable.
    }
  }

  function uploadTextureSource(source, width, height) {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const audit = textureStorageSize.width !== width || textureStorageSize.height !== height || now >= nextNativeErrorCheck;
    if (audit) clearWebGLErrors();
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, textureFlipY ? 1 : 0);
    const canUpdateInPlace = textureStorageSize.width === width && textureStorageSize.height === height;
    try {
      if (canUpdateInPlace) {
        // Reuse the existing allocation for video frames to avoid GPU memory churn.
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      }
    } catch {
      canvas.dataset.insta360TextureStatus = "exception";
      return false;
    }
    const uploadError = audit ? gl.getError() : gl.NO_ERROR;
    if (audit) nextNativeErrorCheck = now + 1000;
    if (uploadError !== gl.NO_ERROR) {
      canvas.dataset.insta360TextureStatus = `error-${uploadError}`;
      return false;
    }
    textureStorageSize = { width, height };
    uploadedTextureSize = { width, height };
    canvas.dataset.insta360TextureStatus = "ready";
    canvas.dataset.insta360TextureWidth = String(width);
    canvas.dataset.insta360TextureHeight = String(height);
    return true;
  }

  function createDownsampledTextureSource(targetWidth) {
    const mediaSize = getMediaTextureSize(mediaEl);
    if (targetWidth >= mediaSize.width && targetWidth >= mediaSize.height) {
      return {
        source: mediaEl,
        width: mediaSize.width,
        height: mediaSize.height,
        retainUntilDestroy: typeof ImageBitmap !== "undefined" && mediaEl instanceof ImageBitmap,
        release: () => {
          if (typeof ImageBitmap !== "undefined" && mediaEl instanceof ImageBitmap) mediaEl.close();
        },
      };
    }
    const scale = Math.min(
      targetWidth / Math.max(1, mediaSize.width),
      targetWidth / Math.max(1, mediaSize.height),
    );
    const width = Math.max(1, Math.floor(mediaSize.width * scale));
    const height = Math.max(1, Math.floor(mediaSize.height * scale));
    const textureCanvas = document.createElement("canvas");
    textureCanvas.width = width;
    textureCanvas.height = height;
    const context = textureCanvas.getContext("2d", { alpha: false });
    if (!context) return null;
    try {
      // Canvas uploads apply UNPACK_FLIP_Y_WEBGL, unlike ImageBitmap uploads.
      // Restore decoded bitmap rows before the upload applies that flip.
      if (flippedBoundedImageBitmaps.has(mediaEl)) {
        context.translate(0, height);
        context.scale(1, -1);
      }
      context.drawImage(mediaEl, 0, 0, width, height);
    } catch {
      textureCanvas.width = 0;
      textureCanvas.height = 0;
      return null;
    }
    return {
      source: textureCanvas,
      width,
      height,
      release: () => {
        textureCanvas.width = 0;
        textureCanvas.height = 0;
      },
    };
  }

  function updateTexture() {
    if (externalFrames) return false;
    if (isVideo && mediaEl.readyState < 2) return false;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);

    const mediaSize = getMediaTextureSize(mediaEl);
    if (isVideo) {
      const size = playbackTextureSize(mediaSize.width, mediaSize.height);
      return uploadTextureSource(playbackTextureSource(mediaEl, mediaSize.width, mediaSize.height, size, 0), size.width, size.height);
    }

    const gpuLimit = Math.max(1, Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 1);
    const mediaMaxDimension = Math.max(mediaSize.width, mediaSize.height);
    const safeInitialWidth = Math.min(mediaMaxDimension, gpuLimit, PANORAMA_TEXTURE_WIDTH_STEPS[0]);
    const candidateWidths = [safeInitialWidth, ...PANORAMA_TEXTURE_WIDTH_STEPS]
      .filter((width, index, widths) => width <= gpuLimit && width <= mediaMaxDimension && widths.indexOf(width) === index)
      .sort((a, b) => b - a);

    for (const candidateWidth of candidateWidths) {
      const textureSource = createDownsampledTextureSource(candidateWidth);
      if (!textureSource) continue;
      const uploaded = uploadTextureSource(textureSource.source, textureSource.width, textureSource.height);
      if (uploaded) {
        if (retainedTextureReleaseFrameId) {
          cancelAnimationFrame(retainedTextureReleaseFrameId);
          retainedTextureReleaseFrameId = 0;
        }
        if (textureSource.retainUntilDestroy) {
          if (releaseLifetimeTextureSource) releaseLifetimeTextureSource();
          releaseLifetimeTextureSource = textureSource.release;
          canvas.dataset.insta360TextureSource = "retained";
        } else {
          if (releaseRetainedTextureSource) releaseRetainedTextureSource();
          releaseRetainedTextureSource = textureSource.release;
          if (typeof ImageBitmap !== "undefined" && mediaEl instanceof ImageBitmap) {
            releaseLifetimeTextureSource = () => mediaEl.close();
          }
        }
        return true;
      }
      // A failed native bitmap upload still needs its pixels for the next,
      // smaller canvas candidate. Only temporary canvases can be freed here.
      if (!textureSource.retainUntilDestroy) textureSource.release();
    }
    return false;
  }

  function scheduleRetainedTextureSourceRelease() {
    if (isVideo || !releaseRetainedTextureSource || retainedTextureReleaseFrameId) return;
    retainedTextureReleaseFrameId = requestAnimationFrame(() => {
      retainedTextureReleaseFrameId = requestAnimationFrame(() => {
        retainedTextureReleaseFrameId = 0;
        if (!releaseRetainedTextureSource) return;
        releaseRetainedTextureSource();
        releaseRetainedTextureSource = null;
        canvas.dataset.insta360TextureSource = "released";
      });
    });
  }

  let projectionUniformsKey = '';
  function renderOnce() {
    if (!running) return;
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
    rafId = 0;
    resize();
    const playbackActive = nativeVideo && !mediaEl.paused && !mediaEl.ended;
    const nativeDue = !playbackActive || nativeSeekRefresh || playbackCadenceDue(started, nextNativeUploadAt);
    const shouldUploadTexture = (needsTextureUpload || (continuous && playbackActive)) && (!nativeVideo || nativeDue);
    const textureUploaded = shouldUploadTexture ? updateTexture() : false;
    if (textureUploaded) {
      needsTextureUpload = false;
      if (isVideo) {
        registerVideoFrame();
        protectVideoFrame();
      }
    }
    if (dirty || textureUploaded) {
      const textureSize = uploadedTextureSize;
      const required = getRequiredTracks();
      const frontPhysical = frontCenter[verticalDualFisheye ? 1 : 0] < .5 ? 0 : 1;
      const visibleLens = required.every(Boolean) ? 0 : required[frontPhysical] ? 1 : 2;
      const uniformsKey = [textureSize.width,textureSize.height,canvas.width,canvas.height,yawDeg,pitchDeg,rollDeg,fovDeg,
        frontValidRadius,backValidRadius,frontFocal,backFocal,convergenceM,polarInverseDepth,videoOffsets,lensGain,useSeamMask,visibleLens].join(':');
      if (uniformsKey !== projectionUniformsKey) {
        const texelX = 1 / Math.max(1, textureSize.width);
        const texelY = 1 / Math.max(1, textureSize.height);
        const seamWidth = Math.max(texelX * 6, 0.0035);
        const qYaw = quatFromAxisAngle(0, 1, 0, (-yawDeg * Math.PI) / 180);
        const qPitch = quatFromAxisAngle(1, 0, 0, (-pitchDeg * Math.PI) / 180);
        const qRoll = quatFromAxisAngle(0, 0, 1, (-rollDeg * Math.PI) / 180);
        const viewQuat = quatNormalize(quatMul(quatMul(qYaw, qPitch), qRoll));
        const aspect = canvas.width / canvas.height;
        if (texelLoc) gl.uniform2f(texelLoc, texelX, texelY);
        if (viewportLoc) gl.uniform2f(viewportLoc, canvas.width, canvas.height);
        if (aspectLoc) gl.uniform1f(aspectLoc, aspect);
        if (tanHalfFovLoc) gl.uniform1f(tanHalfFovLoc, Math.tan((fovDeg * Math.PI) / 360));
        if (viewQuatLoc) gl.uniform4f(viewQuatLoc, viewQuat.x, viewQuat.y, viewQuat.z, viewQuat.w);
        if (seamWidthLoc) gl.uniform1f(seamWidthLoc, seamWidth);
        if (dualFrontCenterLoc) gl.uniform2f(dualFrontCenterLoc, frontCenter[0], frontCenter[1]);
        if (dualBackCenterLoc) gl.uniform2f(dualBackCenterLoc, backCenter[0], backCenter[1]);
        if (dualFrontValidRadiusLoc) gl.uniform2f(dualFrontValidRadiusLoc, frontValidRadius[0], frontValidRadius[1]);
        if (dualBackValidRadiusLoc) gl.uniform2f(dualBackValidRadiusLoc, backValidRadius[0], backValidRadius[1]);
        if (dualFrontFocalLoc) gl.uniform2f(dualFrontFocalLoc, frontFocal[0], frontFocal[1]);
        if (dualBackFocalLoc) gl.uniform2f(dualBackFocalLoc, backFocal[0], backFocal[1]);
        if (dualFrontPrincipalOffsetLoc) gl.uniform2f(dualFrontPrincipalOffsetLoc, frontPrincipalOffset[0], frontPrincipalOffset[1]);
        if (dualBackPrincipalOffsetLoc) gl.uniform2f(dualBackPrincipalOffsetLoc, backPrincipalOffset[0], backPrincipalOffset[1]);
        if (dualFrontScaleLoc) gl.uniform2f(dualFrontScaleLoc, frontScale[0], frontScale[1]);
        if (dualBackScaleLoc) gl.uniform2f(dualBackScaleLoc, backScale[0], backScale[1]);
        if (dualFrontRadialLoc) gl.uniform4f(dualFrontRadialLoc, frontRadial[0], frontRadial[1], frontRadial[2], frontRadial[3]);
        if (dualBackRadialLoc) gl.uniform4f(dualBackRadialLoc, backRadial[0], backRadial[1], backRadial[2], backRadial[3]);
        if (dualFrontRadialScaleLoc) gl.uniform1f(dualFrontRadialScaleLoc, frontRadialScale);
        if (dualBackRadialScaleLoc) gl.uniform1f(dualBackRadialScaleLoc, backRadialScale);
        if (dualDJIRadial5Loc) gl.uniform2f(dualDJIRadial5Loc,
          calibration?.front.distortionCoeffs[4] || 0, calibration?.back.distortionCoeffs[4] || 0);
        if (dualFrontTangentialLoc) gl.uniform2f(dualFrontTangentialLoc, frontTangential[0], frontTangential[1]);
        if (dualBackTangentialLoc) gl.uniform2f(dualBackTangentialLoc, backTangential[0], backTangential[1]);
        if (dualFrontXiLoc) gl.uniform1f(dualFrontXiLoc, frontXi);
        if (dualBackXiLoc) gl.uniform1f(dualBackXiLoc, backXi);
        if (dualFrontThinPrismLoc) gl.uniform4f(dualFrontThinPrismLoc, frontThinPrism[0], frontThinPrism[1], frontThinPrism[2], frontThinPrism[3]);
        if (dualBackThinPrismLoc) gl.uniform4f(dualBackThinPrismLoc, backThinPrism[0], backThinPrism[1], backThinPrism[2], backThinPrism[3]);
        if (dualFrontSensorTiltLoc) gl.uniform2f(dualFrontSensorTiltLoc, frontSensorTilt[0], frontSensorTilt[1]);
        if (dualBackSensorTiltLoc) gl.uniform2f(dualBackSensorTiltLoc, backSensorTilt[0], backSensorTilt[1]);
        if (convergenceLoc) gl.uniform1f(convergenceLoc, convergenceM);
        if (polarDepthLoc) gl.uniform2f(polarDepthLoc, ...polarInverseDepth);
        if (videoOffsetsLoc) gl.uniform4f(videoOffsetsLoc, ...videoOffsets);
        if (videoSeamLoc) gl.uniform1f(videoSeamLoc, canProtectVideo ? 1 : 0);
        for (let index = 0; index < 2; index += 1) {
          const lens = index === 0 ? calibration?.front : calibration?.back;
          if (translationLocations[index]) gl.uniform3f(translationLocations[index], ...(lens?.translationM || [0, 0, 0]));
          const coefficients = proCoefficients[index];
          for (let block = 0; block < 3; block += 1) {
            if (proLocations[index][block]) gl.uniform4fv(proLocations[index][block], coefficients.slice(block*4, block*4+4));
          }
          if (proLocations[index][3]) gl.uniform1f(proLocations[index][3], coefficients[12]);
          if (proLocations[index][4]) gl.uniform1f(proLocations[index][4], lens?.distortionModel === "radtan_pro" ? 1 : 0);
        }
        if (dualFrontRotationQuatLoc) gl.uniform4f(dualFrontRotationQuatLoc, ...(calibration?.front.rotationQuat || [1, 0, 0, 0]));
        if (dualBackRotationQuatLoc) gl.uniform4f(dualBackRotationQuatLoc, ...(calibration?.back.rotationQuat || [1, 0, 0, 0]));
        if (dualFrontUseMEILoc) gl.uniform1f(dualFrontUseMEILoc, frontUsesMEI ? 1 : 0);
        if (dualBackUseMEILoc) gl.uniform1f(dualBackUseMEILoc, backUsesMEI ? 1 : 0);
        if (dualFrontUseDJILoc) gl.uniform1f(dualFrontUseDJILoc, frontUsesDJI ? (calibration.front.distortionModel === 'dji_fisheye_5' ? 2 : 1) : 0);
        if (dualBackUseDJILoc) gl.uniform1f(dualBackUseDJILoc, backUsesDJI ? (calibration.back.distortionModel === 'dji_fisheye_5' ? 2 : 1) : 0);
        if (dualFrontAsymmetricLoc) gl.uniform4f(dualFrontAsymmetricLoc, frontAsymmetric[0], frontAsymmetric[1], frontAsymmetric[2], frontAsymmetric[3]);
        if (dualBackAsymmetricLoc) gl.uniform4f(dualBackAsymmetricLoc, backAsymmetric[0], backAsymmetric[1], backAsymmetric[2], backAsymmetric[3]);
        if (dualFrontAxisLoc) gl.uniform3f(dualFrontAxisLoc, frontAxis[0], frontAxis[1], frontAxis[2]);
        if (dualBackAxisLoc) gl.uniform3f(dualBackAxisLoc, backAxis[0], backAxis[1], backAxis[2]);
        if (dualFrontRightLoc) gl.uniform3f(dualFrontRightLoc, frontRight[0], frontRight[1], frontRight[2]);
        if (dualBackRightLoc) gl.uniform3f(dualBackRightLoc, backRight[0], backRight[1], backRight[2]);
        if (dualFrontUpLoc) gl.uniform3f(dualFrontUpLoc, frontUp[0], frontUp[1], frontUp[2]);
        if (dualBackUpLoc) gl.uniform3f(dualBackUpLoc, backUp[0], backUp[1], backUp[2]);
        if (dualMaxThetaLoc) gl.uniform1f(dualMaxThetaLoc, dualMaxThetaRad);
        if (dualBlendBandLoc) gl.uniform1f(dualBlendBandLoc, Math.sin((options.dualFisheyeSeamBlendDeg * Math.PI) / 180));
        if (dualSeamXLoc) gl.uniform2f(dualSeamXLoc, seamConfig.seamX[0], seamConfig.seamX[1]);
        if (dualSeamBlendXLoc) gl.uniform1f(dualSeamBlendXLoc, seamConfig.blendX);
        if (dualSeamFrontWrapLoc) gl.uniform1f(dualSeamFrontWrapLoc, seamConfig.frontWrap ? 1 : 0);
        if (dualUseSeamLongitudesLoc) gl.uniform1f(dualUseSeamLongitudesLoc, seamConfig.enabled ? 1 : 0);
        if (dualGainLoc) gl.uniform2f(dualGainLoc, lensGain[0], lensGain[1]);
        if (dualUseRemapLoc) gl.uniform1f(dualUseRemapLoc, remap ? 1 : 0);
        if (dualUseSeamMaskLoc) gl.uniform1f(dualUseSeamMaskLoc, useSeamMask);
        if (visibleLensLoc) gl.uniform1f(visibleLensLoc, visibleLens);
        projectionUniformsKey = uniformsKey;
      }

      gl.clearColor(bg.r / 255, bg.g / 255, bg.b / 255, bg.a);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      drawCount += 1;
      canvas.dataset.insta360DrawCount = String(drawCount);
      canvas.dataset.insta360LastDrawReason = lastFrameReason;
      canvas.dataset.insta360ContextStatus = "ready";
      if (textureUploaded) scheduleRetainedTextureSourceRelease();
      dirty = false;
    }
    if (nativeVideo && textureUploaded) {
      nextNativeUploadAt = nextPlaybackCadence(started, nextNativeUploadAt, nativeSeekRefresh);
      nativeSeekRefresh = false;
      if (playbackActive) options.onPlaybackWork?.(Math.max(0, performance.now() - started));
    }
    if (continuous && playbackActive) {
      rafId = requestAnimationFrame(renderOnce);
    }
  }

  function start() {
    if (!running) return;
    if (isVideo) {
      if (supportsVideoFrameCallback) {
        scheduleVideoFrameCallback();
      }
    }
    requestFrame();
  }

  function requestFrame(reason = "request") {
    dirty = true;
    lastFrameReason = reason;
    if (!rafId) {
      rafId = requestAnimationFrame(renderOnce);
    }
  }

  function onContextLost(event) {
    canvas.dataset.insta360ContextStatus = "lost";
    canvas.dispatchEvent(new CustomEvent("insta360previewerror", {
      bubbles: true,
      detail: { reason: "webgl-context-lost" },
    }));
    if (event.cancelable) event.preventDefault();
  }

  canvas.addEventListener("webglcontextlost", onContextLost);

  function onVideoPlayStateChange(event) {
    nativeSeekRefresh = true;
    if (canProtectVideo && event?.type === 'seeked') {
      videoAnalysisCache.surface = null;
      previousVideoMask = null;
      nextVideoSeamTime = -Infinity;
      videoSeamFailures = 0;
      useSeamMask = 0;
    }
    if (canRegisterVideo && !videoRegistered && event?.type === 'seeked') {
      videoRegistrationAttempts = 0;
      nextVideoRegistrationTime = mediaEl.currentTime;
    }
    needsTextureUpload = true;
    if (supportsVideoFrameCallback) {
      scheduleVideoFrameCallback();
    }
    requestFrame();
  }

  if (nativeVideo) {
    mediaEl.addEventListener("play", onVideoPlayStateChange);
    mediaEl.addEventListener("pause", onVideoPlayStateChange);
    mediaEl.addEventListener("seeking", onVideoPlayStateChange);
    mediaEl.addEventListener("seeked", onVideoPlayStateChange);
    mediaEl.addEventListener("loadeddata", onVideoPlayStateChange);
  }

  function destroy() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    if (retainedTextureReleaseFrameId) cancelAnimationFrame(retainedTextureReleaseFrameId);
    cancelVideoFrameCallback();
    canvas.removeEventListener("webglcontextlost", onContextLost);
    if (nativeVideo) {
      mediaEl.removeEventListener("play", onVideoPlayStateChange);
      mediaEl.removeEventListener("pause", onVideoPlayStateChange);
      mediaEl.removeEventListener("seeking", onVideoPlayStateChange);
      mediaEl.removeEventListener("seeked", onVideoPlayStateChange);
      mediaEl.removeEventListener("loadeddata", onVideoPlayStateChange);
    }
    if (releaseRetainedTextureSource) releaseRetainedTextureSource();
    if (releaseLifetimeTextureSource) releaseLifetimeTextureSource();
    if (videoAnalysisCache.readback) {
      videoAnalysisCache.readback.surface.width = 0;
      videoAnalysisCache.readback.surface.height = 0;
    }
    for (const cache of externalAnalysisSources) if (cache?.canvas) { cache.canvas.width = 0; cache.canvas.height = 0; }
    externalAnalysisSources.length = 0;
    videoAnalysisCache.surface = null;
    videoAnalysisCache.projections = null;
    videoAnalysisCache.readback = null;
    videoAnalysisCache.softwareReadback = null;
    for (const surface of playbackTextureSurfaces) if (surface) { surface.width = 0; surface.height = 0; }
    playbackTextureSurfaces.length = 0;
    for (const cache of playbackSoftwareSamples) if (cache?.canvas) { cache.canvas.width = 0; cache.canvas.height = 0; }
    playbackSoftwareSamples.length = 0;
    gl.deleteTexture(tex);
    if (backTex) gl.deleteTexture(backTex);
    if (frontRemapTexture) gl.deleteTexture(frontRemapTexture);
    if (backRemapTexture) gl.deleteTexture(backRemapTexture);
    if (seamMaskTexture) gl.deleteTexture(seamMaskTexture);
    gl.deleteBuffer(clipBuf);
    gl.deleteProgram(program);
  }

  // Return physical source-track order. A padded viewport resumes the other
  // decoder before its seam becomes visible. Unknown remaps and protected poles
  // stay on the existing two-lens path.
  let requiredTracksKey = '';
  let requiredTracks = [true, true];
  function getRequiredTracks() {
    if (options.captureEquirectangular || !externalFrames || projectionKind !== 'dual_fisheye' || remap || (canRegisterVideo && (!videoRegistered || !canRegisterDJI)) ||
      convergenceM > 0 || polarInverseDepth.some(value => value > 0) || !seamConfig.enabled) return [true, true];
    const aspect = Math.max(1, canvas.clientWidth) / Math.max(1, canvas.clientHeight);
    const key = [yawDeg, pitchDeg, rollDeg, fovDeg, aspect, frontValidRadius, backValidRadius,
      frontFocal, backFocal, videoOffsets].join(':');
    if (key === requiredTracksKey) return requiredTracks;
    requiredTracksKey = key;
    requiredTracks = [true, true];
    const q = quatNormalize(quatMul(quatMul(
      quatFromAxisAngle(0, 1, 0, -yawDeg * Math.PI / 180),
      quatFromAxisAngle(1, 0, 0, -pitchDeg * Math.PI / 180)),
      quatFromAxisAngle(0, 0, 1, -rollDeg * Math.PI / 180)));
    const tan = Math.tan(Math.min(160, fovDeg + 12) * Math.PI / 360);
    const lenses = [{ ...analysisFrontLens, focal: frontFocal, validRadius: frontValidRadius },
      { ...analysisBackLens, focal: backFocal, validRadius: backValidRadius }];
    let owner = -1;
    for (let y = -4; y <= 4; y += 1) for (let x = -4; x <= 4; x += 1) {
      const ray = quatRotateVec3(q, x / 4 * aspect * tan, y / 4 * tan, useMEICameraConvention ? 1 : -1);
      const length = Math.hypot(ray.x, ray.y, ray.z);
      const dir = [ray.x / length * (options.equirectFlipX ? -1 : 1),
        ray.y / length * (options.equirectFlipY ? -1 : 1), ray.z / length];
      // Content protection starts at 50 degrees in video. Leave a margin,
      // including between grid samples, so its ownership is never bypassed.
      if (Math.abs(dir[1]) >= Math.sin(45 * Math.PI / 180)) return requiredTracks;
      const u = Math.atan2(dir[0], useMEICameraConvention ? dir[2] : -dir[2]) / (2 * Math.PI) + .5;
      const [a, b] = seamConfig.seamX;
      const band = seamConfig.blendX + .01;
      const inside = u > a + band && u < b - band;
      const outside = u < a - band || u > b + band;
      if (!inside && !outside) return requiredTracks;
      const front = seamConfig.frontWrap ? outside : inside;
      const index = front ? 0 : 1;
      if (owner >= 0 && owner !== index) return requiredTracks;
      owner = index;
      const lens = lenses[index];
      const lensDir = index === 1 ? registeredDualFisheyeVideoDirection(dir, videoOffsets) : dir;
      const projected = projectDualFisheyeLensCpu(lensDir, lens, dualMaxThetaRad,
        lens.projectionModel === 'mei_extended', lens.projectionModel === 'dji_fisheye_lut', lens.radialScale || 1);
      if (!projected || projected.confidence < .1) return requiredTracks;
      if (canRegisterDJI) {
        // Local foreground ownership can extend beyond the geometric seam.
        // Suspend only where the opposite sensor cannot see the padded view,
        // so neither a face nor a mirror can need it between seam updates.
        const other = lenses[1 - index];
        const otherDir = index === 0 ? registeredDualFisheyeVideoDirection(dir, videoOffsets) : dir;
        const opposite = projectDualFisheyeLensCpu(otherDir, other, dualMaxThetaRad,
          other.projectionModel === 'mei_extended', other.projectionModel === 'dji_fisheye_lut', other.radialScale || 1);
        if (opposite && opposite.confidence > 0) return requiredTracks;
      }
    }
    const center = owner === 0 ? frontCenter : backCenter;
    const physical = center[verticalDualFisheye ? 1 : 0] < .5 ? 0 : 1;
    requiredTracks = [physical === 0, physical === 1];
    return requiredTracks;
  }

  let externalGpuLimit = 0;
  let playbackQuality = { level: 0, maxFps: 0, maxRenderPixels: 0, maxTextureSize: 0 };
  const playbackTextureSurfaces = [];
  const playbackSoftwareSamples = [];
  let nextNativeUploadAt = 0;
  let nextNativeErrorCheck = 0;
  let nativeSeekRefresh = true;
  function playbackCadenceDue(now, deadline) {
    const interval = playbackQuality.maxFps ? 1000 / playbackQuality.maxFps : 0;
    // rAF and decoded presentation can arrive slightly before their slot. Keep
    // a stable phase instead of discarding alternate already-selected frames.
    return !interval || now + Math.min(20, interval / 2) >= deadline;
  }
  function nextPlaybackCadence(now, deadline, reset = false) {
    const interval = playbackQuality.maxFps ? 1000 / playbackQuality.maxFps : 0;
    if (!interval) return 0;
    // Re-anchor after discontinuities; never replay missed upload slots.
    if (reset || !deadline || now - deadline > interval) return now + interval;
    return Math.max(deadline + interval, now + interval / 2 + Math.min(20, interval / 2));
  }
  function playbackTextureSize(width, height) {
    const scale = playbackQuality.maxTextureSize > 0 ? Math.min(1, playbackQuality.maxTextureSize / Math.max(width, height)) : 1;
    return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
  }
  function playbackTextureSource(source, width, height, size, index) {
    if (size.width === width && size.height === height) return source;
    if (source instanceof ImageData) return imageDataAnalysisSource(source, size.width,
      playbackSoftwareSamples[index] ||= {}, size.height);
    let surface = playbackTextureSurfaces[index];
    if (!surface) surface = playbackTextureSurfaces[index] = document.createElement('canvas');
    if (surface.width !== size.width || surface.height !== size.height) { surface.width = size.width; surface.height = size.height; }
    const context = surface.getContext('2d');
    context.drawImage(source, 0, 0, size.width, size.height);
    return surface;
  }
  function setPlaybackQuality(quality) {
    if (!isVideo || !quality || quality.level === playbackQuality.level) return;
    playbackQuality = quality;
    nextNativeUploadAt = 0; nextExternalUploadAt = 0; nextExternalWorkAt = 0; nativeSeekRefresh = true;
    canvas.dataset.insta360QualityLevel = String(quality.level);
    canvas.dataset.insta360MaxFps = String(quality.maxFps);
    requestFrame('quality');
  }
  let nextExternalErrorCheck = -Infinity;
  let nextExternalUploadAt = 0;
  let nextExternalWorkAt = 0;
  let externalUploadCost = 0;
  let externalTracksKey = '';
  const externalAnalysisSources = [];
  function prepareExternalAnalysis(frames) {
    const context = mediaEl.getContext("2d", { willReadFrequently: true });
    frames.forEach((source, index) => {
      const analysisSource = source instanceof ImageData
        ? imageDataAnalysisSource(source, canRegisterDJI ? 1024 : 512, externalAnalysisSources[index] ||= {}) : source;
      const w = frames.length === 2 && !verticalDualFisheye ? mediaEl.width / 2 : mediaEl.width;
      const h = frames.length === 2 && verticalDualFisheye ? mediaEl.height / 2 : mediaEl.height;
      context.drawImage(analysisSource, verticalDualFisheye ? 0 : index * w, verticalDualFisheye ? index * h : 0, w, h);
    });
  }
  function presentFrames(frames, time, force = false) {
    if (!running || !externalFrames) return;
    const jumped = previousExternalTime !== null && (time < previousExternalTime || time-previousExternalTime > .5);
    if (jumped) {
      videoAnalysisCache.surface = null;previousVideoMask = null;nextVideoSeamTime = -Infinity;
      useSeamMask = 0; videoSeamFailures = 0;
    }
    const size = frames.find(Boolean);
    if (!size) return;
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const tracksKey = frames.map(Boolean).join(':');
    const sizes = frames.map(source => source ? playbackTextureSize(source.displayWidth || source.videoWidth || source.width,
      source.displayHeight || source.videoHeight || source.height) : null);
    const resized = sizes.some((size,index) => size &&
      (externalTextureSizes[index]?.width !== size.width || externalTextureSizes[index]?.height !== size.height));
    // Present fewer source frames when upload alone consumes the frame budget.
    // Decoding/audio continue; dragging still redraws the retained textures.
    const resetCadence = force || jumped || resized || tracksKey !== externalTracksKey;
    if (!resetCadence && (started < nextExternalWorkAt || !playbackCadenceDue(started, nextExternalUploadAt))) return;
    previousExternalTime = time;
    const { width, height } = sizes.find(Boolean);
    const maxTextureSize = externalGpuLimit || (externalGpuLimit = gl.getParameter(gl.MAX_TEXTURE_SIZE));
    if (sizes.filter(Boolean).some(size => size.width > maxTextureSize || size.height > maxTextureSize)) {
      throw new Error("Panorama frame exceeds GPU texture limits; select a companion source");
    }
    gl.uniform1f(separateLoc, frames.length === 2 ? 1 : 0);
    gl.uniform1f(verticalLoc, verticalDualFisheye ? 1 : 0);
    // getError/getParameter can force a graphics-process round trip on Windows.
    // Audit allocations and periodically detect runtime errors, not every frame.
    const audit = resized || started >= nextExternalErrorCheck;
    if (audit) clearWebGLErrors();
    frames.forEach((source, index) => {
      if (!source) return; // Retain the last hidden-lens texture for immediate dragging.
      gl.activeTexture(index === 0 ? gl.TEXTURE0 : gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, index === 0 ? tex : backTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, textureFlipY ? 1 : 0);
      const { width: w, height: h } = sizes[index];
      const textureSource = playbackTextureSource(source, source.displayWidth || source.videoWidth || source.width,
        source.displayHeight || source.videoHeight || source.height, sizes[index], index);
      const previous = externalTextureSizes[index];
      if (previous?.width === w && previous?.height === h) {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, textureSource);
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textureSource);
        externalTextureSizes[index] = { width: w, height: h };
      }
    });
    if (audit) {
      if (gl.getError() !== gl.NO_ERROR) throw new Error("Panorama frame upload failed");
      nextExternalErrorCheck = started + 1000;
    }
    const cost = Math.max(0, (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started);
    externalUploadCost = externalUploadCost ? externalUploadCost * .8 + cost * .2 : cost;
    nextExternalUploadAt = nextPlaybackCadence(started, nextExternalUploadAt, resetCadence);
    // Keep measured GPU work spacing strict; cadence jitter tolerance must not
    // steal the time reserved for decoding and interaction on a slow device.
    nextExternalWorkAt = started + Math.min(100, externalUploadCost * 1.5);
    externalTracksKey = tracksKey;
    const verticalTextures = verticalDualFisheye || projectionKind === "eac" || projectionKind === "cubemap";
    uploadedTextureSize = { width: frames.length === 2 && !verticalTextures ? width * 2 : width,
      height: frames.length === 2 && verticalTextures ? height * 2 : height };
    needsTextureUpload = false;
    // Keep the existing seam/person protection analysis at a bounded resolution.
    const pendingRegistration = canRegisterVideo && !videoRegistered && videoRegistrationAttempts < 3;
    const pendingProtection = canProtectVideo && videoRegistered && videoSeamFailures < 3;
    if ((pendingProtection || pendingRegistration) && frames.every(Boolean) && time >= nextVideoSeamTime) {
      mediaEl.currentTime = time;
      const software = canRegisterDJI && pendingProtection && mediaEl.width === 2048 && mediaEl.height === 1024 &&
        frames.length === 2 && frames.every(frame => frame instanceof ImageData);
      try {
        if (software) {
          videoAnalysisCache.softwareFrames = frames;
          videoAnalysisCache.prepareSoftwareFallback = () => prepareExternalAnalysis(frames);
        } else prepareExternalAnalysis(frames);
        registerVideoFrame();
        protectVideoFrame();
      } finally {
        // Decoder outputs may be large; retain only the bounded analysis data.
        videoAnalysisCache.softwareFrames = null;
        videoAnalysisCache.prepareSoftwareFallback = null;
      }
    }
    requestFrame("decoded-frame");
    return cost;
  }
  return {
    reset: () => {
      videoAnalysisCache.surface = null;
      previousVideoMask = null;
      previousExternalTime = null;
      nextVideoSeamTime = -Infinity;
      nextExternalUploadAt = 0;
      nextExternalWorkAt = 0;
      useSeamMask = 0;
      videoSeamFailures = 0;
      canvas.dataset.insta360VideoSeam = 'pending';
      requestFrame('seek');
    },
    presentFrames,
    captureFrames: (frames, time) => {
      presentFrames(frames, time, true);
      if (rafId) cancelAnimationFrame(rafId);
      renderOnce();
    },
    setPlaybackQuality,
    getRequiredTracks,
    start,
    requestFrame,
    destroy,
    setView,
    getView: () => ({ yawDeg, pitchDeg, rollDeg, fovDeg }),
    // +Z MEI cameras reverse both screen axes relative to the -Z panorama camera.
    dragDirectionSign: useMEICameraConvention ? -1 : 1,
  };
}


function quatMul(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}


function quatNormalize(q) {
  const len = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return {
    x: q.x / len,
    y: q.y / len,
    z: q.z / len,
    w: q.w / len,
  };
}


function quatFromAxisAngle(ax, ay, az, rad) {
  const half = rad / 2;
  const s = Math.sin(half);
  return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(half) };
}


function quatRotateVec3(q, vx, vy, vz) {
  const qv = { x: vx, y: vy, z: vz, w: 0 };
  const qi = { x: -q.x, y: -q.y, z: -q.z, w: q.w };
  const tmp = quatMul(q, qv);
  const out = quatMul(tmp, qi);
  return { x: out.x, y: out.y, z: out.z };
}



function imageDataAnalysisSource(source, maxWidth = 512, cache = null, targetHeight = null) {
  const canvas = cache?.canvas || document.createElement("canvas");
  const width = Math.min(maxWidth, source.width);
  const height = targetHeight ?? Math.max(1, Math.round(source.height * width / source.width));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width; canvas.height = height;
    if (cache) cache.reduced = null;
  }
  if (cache) cache.canvas = canvas;
  const context = canvas.getContext("2d");
  if (width === source.width && height === source.height) { context.putImageData(source, 0, 0); return canvas; }
  const reduced = cache?.reduced || context.createImageData(width, height);
  if (cache) cache.reduced = reduced;
  // Copy one complete pixel without creating a subarray for every sample.
  const packedSource = source.data.byteOffset % 4 === 0
    ? new Uint32Array(source.data.buffer, source.data.byteOffset, source.data.byteLength / 4) : null;
  const packedTarget = new Uint32Array(reduced.data.buffer, reduced.data.byteOffset, reduced.data.byteLength / 4);
  let columns = cache?.columns;
  if (!columns || columns.length !== width || cache.sourceWidth !== source.width) {
    columns = Uint32Array.from({ length: width }, (_, x) => Math.floor(x * source.width / width));
    if (cache) { cache.columns = columns; cache.sourceWidth = source.width; }
  }
  // Keep division and alignment branches out of the million-pixel copy loop.
  // The small column table is shared across rows and refreshed on size changes.
  if (packedSource) {
    for (let y = 0; y < height; y++) {
      const row = Math.floor(y * source.height / height) * source.width, target = y * width;
      for (let x = 0; x < width; x++) packedTarget[target + x] = packedSource[row + columns[x]];
    }
  } else {
    for (let y = 0; y < height; y++) {
      const row = Math.floor(y * source.height / height) * source.width, target = y * width;
      for (let x = 0; x < width; x++) for (let channel = 0; channel < 4; channel++)
        reduced.data[(target + x) * 4 + channel] = source.data[(row + columns[x]) * 4 + channel];
    }
  }
  context.putImageData(reduced, 0, 0);
  return canvas;
}

export function createPanoramaFrameRenderer(canvas, options, nativeVideo = null) {
  const analysis = nativeVideo || document.createElement('canvas');
  if (!nativeVideo) {
    analysis.width = options.dualFisheyeCalibration?.front.projectionModel === 'dji_fisheye_lut' ? 2048 : 1024;
    analysis.height = analysis.width / 2;
  }
  const renderer = createProjectionRenderer(canvas, analysis, normalizeOptions({ ...options, externalFrames: !nativeVideo }), options.projection || 'equirect');
  return { ...renderer, destroy() {
    renderer.destroy();
    if (!nativeVideo) analysis.width = analysis.height = 0;
  } };
}

/** Static images run Photos' image registration, polar depth and seam analysis once. */
export function createPanoramaImageRenderer(canvas, source, options) {
  return createProjectionRenderer(canvas, source, normalizeOptions({ ...options, externalFrames: false }), options.projection || 'dual_fisheye');
}
