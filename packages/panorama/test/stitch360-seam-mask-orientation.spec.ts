// Migrated with the Photos renderer; independent references protect pixel ownership and GPU work.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = fs.readFileSync('src/realtime/stitch-renderer.js', 'utf8');

test('GPU seam weights refer to the same world latitude as the CPU analysis', () => {
  const frames: (() => void)[] = [];
  let flip = false;
  let gpuMask: Uint8Array | null = null;
  const gl = new Proxy({
    UNPACK_FLIP_Y_WEBGL: 0x9240,
    LUMINANCE: 0x1909,
    NO_ERROR: 0,
    getError: () => 0,
    getParameter: () => 8192,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    createShader: () => ({}), createProgram: () => ({}),
    createBuffer: () => ({}), createTexture: () => ({}),
    getUniformLocation: (_program: unknown, name: string) => ({ name }),
    pixelStorei: (parameter: number, value: number) => {
      if (parameter === 0x9240) flip = Boolean(value);
    },
    texImage2D: (...args: any[]) => {
      if (args.length !== 9 || args[3] !== 128 || args[4] !== 64 || args[6] !== 0x1909) return;
      const bytes = args[8] as Uint8Array;
      gpuMask = new Uint8Array(bytes.length);
      // Confirmed with WebGL texImage2D/readPixels: UNPACK_FLIP_Y_WEBGL
      // reverses typed-array rows as well as image-element rows.
      for (let y = 0; y < 64; y += 1) {
        gpuMask.set(bytes.subarray((flip ? 63-y : y)*128, (flip ? 64-y : y+1)*128), y*128);
      }
    },
  }, { get: (target, key) => key in target ? target[key as keyof typeof target] : () => undefined });
  class Image { naturalWidth = 512; naturalHeight = 256; }
  const lens = {
    center: [.25, .5], focal: [.2, .4], principalOffset: [0, 0], scale: [.2, .4],
    projectionModel: 'mei_extended', xi: 2, rotationQuat: [1, 0, 0, 0],
    radial: [0, 0, 0, 0], tangential: [0, 0], asymmetric: [0, 0, 0, 0],
    axis: [0, 0, 1], right: [1, 0, 0], up: [0, -1, 0],
  };
  const context: any = {
    HTMLImageElement: Image, HTMLVideoElement: class {},
    window: { devicePixelRatio: 1 },
    requestAnimationFrame: (callback: () => void) => { frames.push(callback); return frames.length; },
    cancelAnimationFrame: () => undefined,
    media: new Image(),
    canvas: Object.assign(new EventTarget(), {
      dataset: {}, clientWidth: 800, clientHeight: 600, width: 800, height: 600, getContext: () => gl,
    }),
    calibration: { textureOrigin: 'top-left', front: lens, back: { ...lens, center: [.75, .5], rotationQuat: [0, 0, 1, 0] } },
  };
  // Isolate the CPU-to-GPU coordinate contract with deliberately asymmetric
  // analysis weights. The mask's rows are already indexed by projectEquirect
  // UVs, independent of the source image's pixel origin.
  runInNewContext(`${source.replace(/^export /gm, '')}
    acceptStaticDualFisheyeImage = () => ({
      mask: Uint8Array.from({ length: 128*64 }, (_, index) => index < 128*32 ? 0 : 255),
      gain: [1, 1], convergenceM: 0,
    });
    this.renderer = createProjectionRenderer(canvas, media, { ...DEFAULT_OPTIONS, dualFisheyeCalibration: calibration }, 'dual_fisheye');`, context);
  try {
    context.renderer.start();
    frames.shift()!();
    assert.ok(gpuMask, 'the displayed panorama must receive the CPU mask');
    for (const y of [-.8, .8]) {
      // Independent reference to the MEI shader's world-to-equirect UV.
      const v = .5-Math.asin(y)/Math.PI;
      const row = Math.floor(v*64);
      const expected = v < .5 ? 0 : 255;
      assert.equal(gpuMask[row*128+64], expected,
        `world y=${y}: GPU chose the seam weight from the opposite latitude`);
    }
  } finally {
    context.renderer.destroy();
  }
});
