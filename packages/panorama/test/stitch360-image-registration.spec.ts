// Migrated with Photos' static image stitching; synthetic scenes contain no private pixels.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = fs.readFileSync('src/realtime/stitch-renderer.js', 'utf8');
const front = {
  projectionModel: 'mei_extended', center: [.25, .5], focal: [.3125, .625],
  principalOffset: [0, 0], rotationQuat: [1, 0, 0, 0], xi: 2,
  radial: [0, 0, 0, 0], tangential: [0, 0], thinPrism: [0, 0, 0, 0],
  sensorTilt: [0, 0], validRadius: [.2375, .475], translationM: [0, 0, 0],
};
const back = { ...front, center: [.75, .5], rotationQuat: [0, 0, 1, 0], translationM: [0, 0, -.03] };
const calibration = { imageSize: [2048, 1024], textureOrigin: 'top-left', front, back };
const offsets = [.035, -.008, -.025, .01];

// Render a common spherical scene through an independent inverse MEI model.
// The rear sensor has different small angular errors at the two overlaps.
function scene(width: number, height: number, textured: boolean) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const noise = (x: number, y: number) => {
    x *= 160; y *= 80;
    const ix = Math.floor(x), iy = Math.floor(y);
    const smooth = (value: number) => value * value * (3 - 2 * value);
    const a = smooth(x - ix), b = smooth(y - iy);
    const hash = (i: number, j: number) => {
      const v = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
      return v - Math.floor(v);
    };
    return (1 - b) * ((1 - a) * hash(ix, iy) + a * hash(ix + 1, iy))
      + b * ((1 - a) * hash(ix, iy + 1) + a * hash(ix + 1, iy + 1));
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const rear = x >= width / 2;
    const mx = ((x + .5) / width - (rear ? .75 : .25)) / .3125;
    const my = ((y + .5) / height - .5) / .625;
    const r2 = mx * mx + my * my;
    if (1 - 3 * r2 < 0) continue;
    const alpha = (2 + Math.sqrt(1 - 3 * r2)) / (1 + r2);
    const ray = [mx * alpha * (rear ? -1 : 1), my * alpha, (alpha - 2) * (rear ? -1 : 1)];
    let longitude = Math.atan2(ray[0], ray[2]);
    let latitude = Math.asin(Math.max(-1, Math.min(1, ray[1])));
    if (rear) {
      const observedLongitude = longitude;
      for (let iteration = 0; iteration < 8; iteration++) {
        const mix = .5 + .5 * Math.sin(longitude);
        longitude = observedLongitude - offsets[0] * (1 - mix) - offsets[2] * mix;
      }
      const mix = .5 + .5 * Math.sin(longitude);
      latitude -= offsets[1] * (1 - mix) + offsets[3] * mix;
    }
    const color = textured ? 50 + 150 * noise(longitude, latitude) : 120;
    pixels.set([color, color, color, 255], (y * width + x) * 4);
  }
  return pixels;
}

function runtime(textured = true) {
  class Surface {
    constructor(private width: number, private height: number) {}
    getContext() { return { drawImage: () => undefined, getImageData: () => ({ data: scene(this.width, this.height, textured) }) }; }
  }
  const context: any = { HTMLVideoElement: class {}, HTMLImageElement: class {}, OffscreenCanvas: Surface };
  runInNewContext(`${source.replace(/^export /gm, '')}
    this.analyze = acceptStaticDualFisheyeImage;
    this.seam = analyzeDualFisheyeSeam;
    this.defaults = DEFAULT_OPTIONS;`, context);
  return context;
}

function analyze(context: any, profile: any = calibration, remap: unknown = null) {
  return context.analyze({ width: 2048, height: 1024 }, {
    ...context.defaults, dualFisheyeFlipX: false, equirectFlipX: false,
  }, profile, remap, profile.front, profile.back, Math.PI);
}

test('static DNG registers both overlaps independently without changing its metadata or polar geometry', () => {
  const original = structuredClone(calibration);
  const result = analyze(runtime());
  assert.equal(result?.imageOffsets?.length, 4, 'static images omitted horizontal overlap registration');
  offsets.forEach((value, index) => assert.ok(Math.abs(result.imageOffsets[index] - value) < .004,
    `overlap component ${index}: ${result.imageOffsets[index]} vs ${value}`));
  assert.equal(result.convergenceM, 0);
  assert.deepEqual(calibration, original);
});

test('flat scenes, fixed remaps and other lens models retain their static calibrated fallback', () => {
  assert.deepEqual(Array.from(analyze(runtime(false))?.imageOffsets || []), [0, 0, 0, 0]);
  assert.deepEqual(Array.from(analyze(runtime(), calibration, {})?.imageOffsets || []), [0, 0, 0, 0]);
  const profile = { ...calibration, front: { ...front, distortionModel: 'radtan_pro', distortionCoeffs: Array(13).fill(0) },
    back: { ...back, distortionModel: 'radtan_pro', distortionCoeffs: Array(13).fill(0) } };
  assert.deepEqual(Array.from(analyze(runtime(), profile)?.imageOffsets || []), [0, 0, 0, 0]);
});

test('static seam sampling uses the image correction and keeps the static polar transition', () => {
  const context = runtime();
  const seen: number[][] = [], distances: number[] = [];
  context.capture = (direction: number[], lens: any, _max: unknown, _mei: unknown, _dji: unknown, _scale: unknown, distance: number) => {
    if (lens === context.rear) { seen.push(Array.from(direction)); distances.push(distance); }
    return { uv: lens.center.slice(), confidence: .5 };
  };
  context.rear = back;
  runInNewContext('projectDualFisheyeLensCpu = capture;', context);
  const options = { ...context.defaults, equirectFlipX: false, dualFisheyeFlipX: false };
  const surface = { width: 1, height: 1, pixels: new Uint8ClampedArray([120, 120, 120, 255]) };
  context.seam(surface, options, calibration, null, front, back, Math.PI, { imageOffsets: offsets, polarInverseDepth: [1, 2] });
  const corrected = seen.map(ray => ray.slice());
  seen.length = 0;
  context.seam(surface, options, calibration, null, front, back, Math.PI, { polarInverseDepth: [1, 2] });
  const horizon = 32 * 128 + 32;
  assert.ok(Math.hypot(...corrected[horizon].map((value, axis) => value - seen[horizon][axis])) > .02,
    'mask sampled the unregistered rear lens');
  const middleLatitude = 16 * 128 + 32;
  assert.ok(distances[middleLatitude] > 0, 'image correction accidentally selected the video polar transition');
});

test('static image correction reaches the GPU once and does not enable video mask updates', () => {
  class Image { naturalWidth = 2048; naturalHeight = 1024; }
  const frames: (() => void)[] = [], uploaded: number[][] = [];
  let videoSeam = -1;
  const gl = new Proxy({
    NO_ERROR: 0, getError: () => 0, getParameter: () => 8192,
    getShaderParameter: () => true, getProgramParameter: () => true,
    createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}), createTexture: () => ({}),
    getUniformLocation: (_program: unknown, name: string) => ({ name }),
    uniform4f: (location: { name: string }, ...values: number[]) => { if (location.name === 'uDualFisheyeVideoOffsets') uploaded.push(values); },
    uniform1f: (location: { name: string }, value: number) => { if (location.name === 'uDualFisheyeVideoSeam') videoSeam = value; },
  }, { get: (target, key) => key in target ? target[key as keyof typeof target] : () => undefined });
  const context: any = {
    HTMLImageElement: Image, HTMLVideoElement: class {}, calibration, offsets, calls: 0,
    window: { devicePixelRatio: 1 },
    requestAnimationFrame: (callback: () => void) => { frames.push(callback); return frames.length; },
    cancelAnimationFrame: () => undefined,
    canvas: Object.assign(new EventTarget(), { dataset: {}, clientWidth: 800, clientHeight: 600, width: 800, height: 600, getContext: () => gl }),
    media: new Image(),
  };
  runInNewContext(`${source.replace(/^export /gm, '')}
    acceptStaticDualFisheyeImage = () => { calls++; return { gain: [1, 1], convergenceM: 0,
      polarInverseDepth: [1, 2], focalScale: 1, imageOffsets: offsets, mask: null }; };
    this.renderer = createProjectionRenderer(canvas, media, { ...DEFAULT_OPTIONS, dualFisheyeCalibration: calibration }, 'dual_fisheye');`, context);
  try {
    context.renderer.start(); frames.shift()!();
    assert.deepEqual(uploaded.at(-1), offsets, 'GPU retained the unregistered image geometry');
    context.renderer.requestFrame(); frames.shift()!();
    assert.equal(context.calls, 1, 'static registration must not run again on drag or zoom');
    assert.equal(videoSeam, 0);
  } finally { context.renderer.destroy(); }
});

test('registered static images keep one lens owner where all longitudes meet at a pole', () => {
  const context = runtime();
  runInNewContext(`projectDualFisheyeLensCpu = (_direction, lens) => ({ uv: lens.center.slice(), confidence: .5 });`, context);
  const result = context.seam({ width: 1, height: 1, pixels: new Uint8ClampedArray([120, 120, 120, 255]) },
    { ...context.defaults, equirectFlipX: false, dualFisheyeFlipX: false }, calibration, null, front, back, Math.PI,
    { imageOffsets: [0, 0, 0, 0] });
  assert.ok(result.mask);
  for (const row of [0, 1, 62, 63]) {
    const values = Array.from(result.mask.slice(row * 128, (row + 1) * 128));
    assert.equal(new Set(values).size, 1, `polar row ${row} splits a close subject across lenses`);
  }
});
