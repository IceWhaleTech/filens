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

// Independent inverse MEI projection and ray/sphere intersection. The two
// hemispheres have different depths, so one global distance cannot fit both.
function scene(width: number, height: number, textured: boolean) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const rear = x >= width / 2;
    const mx = (x + .5 - (rear ? .75 : .25) * width) / (.3125 * width);
    const my = (y + .5 - .5 * height) / (.625 * height);
    const r2 = mx * mx + my * my;
    if (1 - 3 * r2 < 0) continue;
    const alpha = (2 + Math.sqrt(1 - 3 * r2)) / (1 + r2);
    const ray = [mx * alpha, my * alpha, alpha - 2];
    const distance = ray[1] > 0 ? .4 : 1.2;
    const tz = rear ? -.03 : 0;
    const dot = ray[2] * tz;
    const length = dot + Math.sqrt(dot * dot + distance * distance - tz * tz);
    const point = [ray[0] * length / distance, ray[1] * length / distance, (ray[2] * length - tz) / distance];
    if (rear) { point[0] *= -1; point[2] *= -1; }
    const color = textured ? [
      128 + 55 * Math.sin(39 * point[0] + 21 * point[1] + 17 * point[2]),
      120 + 60 * Math.sin(43 * point[1] - 33 * point[2]),
      130 + 50 * Math.cos(37 * point[0] + 41 * point[1]),
    ] : [120, 120, 120];
    pixels.set([...color, 255], (y * width + x) * 4);
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
    this.project = projectDualFisheyeLensCpu;
    this.distance = typeof dualFisheyeDirectionConvergence === 'function' ? dualFisheyeDirectionConvergence : () => 0;`, context);
  return context;
}

function analyze(context: any, rear = back, remap: unknown = null) {
  return context.analyze({ width: 1024, height: 512 }, {
    dualFisheyeGainFront: 1, dualFisheyeGainBack: 1, dualFisheyeAutoGain: true,
  }, { textureOrigin: 'top-left', front, back: rear }, remap, front, rear, Math.PI);
}

test('DNG MEI projection uses the calibrated metre baseline for a finite subject distance', () => {
  const projected = runtime().project([0, 1, 0], back, Math.PI, true, false, 1, .4);
  assert.ok(projected);
  const length = Math.hypot(.4, .03);
  const expectedY = .5 + .625 * (.4 / length) / (2 - .03 / length);
  assert.ok(Math.abs(projected.uv[1] - expectedY) < 1e-9,
    `DNG baseline was ignored: ${projected.uv[1]} vs ${expectedY}`);
});

test('static MEI images recover independent polar depths while keeping the horizon calibrated', () => {
  const context = runtime();
  const result = analyze(context);
  assert.ok(result?.polarInverseDepth, 'near-field registration was omitted');
  assert.ok(Math.abs(1 / result.polarInverseDepth[0] - 1.2) < .15, `upper distance: ${result.polarInverseDepth}`);
  assert.ok(Math.abs(1 / result.polarInverseDepth[1] - .4) < .04, `lower distance: ${result.polarInverseDepth}`);
  assert.equal(result.convergenceM, 0, 'a polar subject must not move horizontal scene geometry');
  assert.equal(context.distance([0, 0, 1], 0, result.polarInverseDepth), 0);
  assert.ok(Math.abs(context.distance([0, 1, 0], 0, result.polarInverseDepth) - .4) < .04);
  const transition = context.distance([0, Math.sin(37 * Math.PI / 180), Math.cos(37 * Math.PI / 180)], 0, result.polarInverseDepth);
  assert.ok(transition > .4 && Number.isFinite(transition), 'polar correction must fade continuously');
});

test('flat scenes and missing baseline do not invent a polar distance', () => {
  assert.deepEqual(Array.from(analyze(runtime(false))?.polarInverseDepth || []), [0, 0]);
  assert.deepEqual(Array.from(analyze(runtime(), { ...back, translationM: [0, 0, 0] })?.polarInverseDepth || []), [0, 0]);
  assert.deepEqual(Array.from(analyze(runtime(), back, {})?.polarInverseDepth || []), [0, 0], 'fixed remap geometry must remain authoritative');
});

test('the displayed panorama receives both recovered polar depths without modifying its input profile', () => {
  class Image { naturalWidth = 1024; naturalHeight = 512; }
  class Surface {
    constructor(private width: number, private height: number) {}
    getContext() { return { drawImage: () => undefined, getImageData: () => ({ data: scene(this.width, this.height, true) }) }; }
  }
  const frames: (() => void)[] = [];
  let uploaded: number[] = [], globalDistance = -1;
  const gl = new Proxy({
    NO_ERROR: 0, getError: () => 0, getParameter: () => 8192,
    getShaderParameter: () => true, getProgramParameter: () => true,
    createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}), createTexture: () => ({}),
    getUniformLocation: (_program: unknown, name: string) => ({ name }),
    uniform1f: (location: { name: string }, value: number) => {
      if (location.name === 'uDualFisheyeConvergenceM') globalDistance = value;
    },
    uniform2f: (location: { name: string }, x: number, y: number) => {
      if (location.name === 'uDualFisheyePolarInverseDepth') uploaded = [x, y];
    },
  }, { get: (target, key) => key in target ? target[key as keyof typeof target] : () => undefined });
  const calibration = { textureOrigin: 'top-left', front, back };
  const original = structuredClone(calibration);
  const context: any = {
    HTMLImageElement: Image, HTMLVideoElement: class {}, OffscreenCanvas: Surface,
    window: { devicePixelRatio: 1 },
    requestAnimationFrame: (callback: () => void) => { frames.push(callback); return frames.length; },
    cancelAnimationFrame: () => undefined,
    canvas: Object.assign(new EventTarget(), { dataset: {}, clientWidth: 800, clientHeight: 600, width: 800, height: 600, getContext: () => gl }),
    media: new Image(), calibration,
  };
  runInNewContext(`${source.replace(/^export /gm, '')}
    this.renderer = createProjectionRenderer(canvas, media, { ...DEFAULT_OPTIONS, dualFisheyeCalibration: calibration }, 'dual_fisheye');`, context);
  try {
    context.renderer.start(); frames.shift()!();
    assert.equal(uploaded.length, 2);
    assert.ok(Math.abs(1 / uploaded[0] - 1.2) < .15);
    assert.ok(Math.abs(1 / uploaded[1] - .4) < .04);
    assert.equal(globalDistance, 0);
    assert.deepEqual(calibration, original);
  } finally { context.renderer.destroy(); }
});


test('packed video photometric registration recovers each pole when feature consensus is unavailable', () => {
  const context = runtime();
  runInNewContext('this.videoDepth = estimateX5ImageConvergence;', context);
  const surface = {width:1024, height:512, pixels:scene(1024,512,true)};
  for (const [pole, expected] of [[-1,1.2],[1,.4]]) {
    const distance = context.videoDepth(surface,[front,back],'top-left',pole,{},[0,0,0,0]);
    assert.ok(Math.abs(distance-expected) < .1, `pole ${pole}: ${distance} vs ${expected}`);
  }
  assert.equal(context.videoDepth({...surface,pixels:scene(1024,512,false)},[front,back],'top-left',1,{},[0,0,0,0]),0);
});

test('video horizon corrections fade continuously before either pole and wrap in longitude', () => {
  const context: any = {};
  runInNewContext(`${source.replace(/^export /gm, '')}\nthis.offset = typeof registeredDualFisheyeVideoDirection === 'function' ? registeredDualFisheyeVideoDirection : (d) => d;`, context);
  const offsets = [.06,.01,-.04,-.02];
  const horizon = context.offset([1,0,0],offsets);
  assert.ok(Math.abs(horizon[1]-Math.sin(-.02))<1e-9, 'horizon registration must still apply');
  for (const pole of [-1,1]) assert.deepEqual(Array.from(context.offset([0,pole,0],offsets)),[0,pole,0]);
  const a = context.offset([1e-8,.99,-Math.sqrt(1-.99**2)],offsets);
  const b = context.offset([-1e-8,.99,-Math.sqrt(1-.99**2)],offsets);
  assert.ok(Math.hypot(...a.map((value:number,i:number)=>value-b[i]))<1e-6);
});


test('video polar depth preserves existing horizontal and mid-latitude registration', () => {
  const context=runtime();
  for (const latitude of [0,30,45,50]) {
    const ray=[0,Math.sin(latitude*Math.PI/180),Math.cos(latitude*Math.PI/180)];
    assert.equal(context.distance(ray,0,[1,3],true),0,`video near-field depth moved latitude ${latitude}`);
  }
  assert.equal(context.distance([0,1,0],0,[1,3],true),1/3);
});
