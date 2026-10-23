// Migrated with Photos' static image stitching; synthetic scenes contain no private pixels.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = fs.readFileSync('src/realtime/stitch-renderer.js', 'utf8');

function analyzeOccludedSubject(occlusion: boolean, mirrored = false, swapLenses = false, brightness = 1, displaced = false, video = false) {
  const width = 256, height = 128;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const back = x >= 128;
    const column = mirrored ? 127 - x % 128 : x % 128;
    const subject = column >= 90 && column <= 100 && y >= 96 && y <= 116;
    const hidden = back === swapLenses && column >= 87 && column <= 102 && y >= 92 && y <= 120;
    const color = (occlusion && hidden ? displaced ? [200, 200, 185] : [0, 0, 0] : subject ? [180, 140, 100] : [80, 80, 80]).map(value => value * brightness);
    pixels.set([...color, 255], (y * width + x) * 4);
  }
  class Surface { getContext() { return { drawImage: () => undefined, getImageData: () => ({ data: pixels }) }; } }
  const context: any = { HTMLImageElement: class {}, HTMLVideoElement: class {}, OffscreenCanvas: Surface };
  // Supply controlled corresponding rays so the test isolates seam ownership,
  // including the cost of discarding a subject visible in only one lens.
  runInNewContext(`${source.replace(/^export /gm, '')}
    projectDualFisheyeLensCpu = (direction, lens) => {
      const u = Math.atan2(direction[0], -direction[2]) / (Math.PI*2) + .5;
      const v = .5 - Math.asin(direction[1]) / Math.PI;
      const column = ${mirrored} ? 127 - Math.floor(u*128) : Math.floor(u*128);
      const overlap = (column >= 28 && column <= 36) || (column >= 84 && column <= 106);
      const physicalBack = Boolean(lens.back) !== ${swapLenses};
      const owned = physicalBack ? column < 32 || column >= 96 : column >= 32 && column < 96;
      if (!overlap && !owned) return null;
      const nearSubject = ${displaced} && column >= 87 && column <= 102 && v >= .71875 && v <= .9453125;
      return { uv: [(u + (lens.back ? 1 : 0))/2, v], confidence: nearSubject ? physicalBack ? .22 : .1 : overlap && column >= 84 && column < 103 && physicalBack ? .03 : .5 };
    };
    this.analyze = acceptStaticDualFisheyeImage;
    this.analyzeVideo = typeof analyzeX5VideoSeamFrame === 'function' ? analyzeX5VideoSeamFrame : null;
    this.defaults = DEFAULT_OPTIONS;`, context);
  const front = { center: [.25, .5] }, back = { center: [.75, .5], back: true };
  if (video) {
    assert.equal(typeof context.analyzeVideo, 'function', 'video must analyze its current decoded content');
    return context.analyzeVideo({width,height}, {...context.defaults, dualFisheyeAutoGain:false, equirectFlipX:false,dualFisheyeFlipX:false}, null, [front,back],
      {offsets:[0,0,0,0],gain:[1,1],polarInverseDepth:[0,0]}, null);
  }
  return context.analyze({ width, height }, {
    ...context.defaults, dualFisheyeAutoGain: false, equirectFlipX: false, dualFisheyeFlipX: false,
  }, null, null, front, back, Math.PI);
}

for (const mirrored of [false, true]) for (const swapLenses of [false, true]) {
  test(`static seam preserves a subject in the ${swapLenses ? 'front' : 'back'} lens at the ${mirrored ? 'left' : 'right'} seam`, () => {
    const { mask } = analyzeOccludedSubject(true, mirrored, swapLenses);
    assert.ok(mask, 'content-aware seam must remain available');
    for (let y = 49; y <= 57; y++) for (let x = 92; x <= 98; x++) {
      const column = mirrored ? 127 - x : x;
      assert.equal(mask[y * 128 + column], swapLenses ? 0 : 255, `visible subject was discarded or blended with the occluded lens at ${column},${y}`);
    }
  });
  test(`static seam retains the whole displaced subject in the ${swapLenses ? 'front' : 'back'} lens at the ${mirrored ? 'left' : 'right'} seam`, () => {
    // A bright displaced coat can cover a face just as an opaque black region
    // can. Preserve the complete nearby patch from the clearer lens.
    const { mask } = analyzeOccludedSubject(true, mirrored, swapLenses, 1, true);
    assert.ok(mask);
    for (let y = 49; y <= 57; y++) for (let x = 92; x <= 98; x++) {
      const column = mirrored ? 127 - x : x;
      assert.equal(mask[y * 128 + column], swapLenses ? 0 : 255, `displaced foreground replaced the subject at ${column},${y}`);
    }
  });
}

test('matching content retains both lenses without an occlusion preference', () => {
  const { mask, gain } = analyzeOccludedSubject(false);
  assert.ok(mask.includes(0) && mask.includes(255));
  assert.deepEqual(Array.from(gain), [1, 1]);
});

test('matching dark content retains the same seam without preferring either lens', () => {
  const normal = analyzeOccludedSubject(false);
  const dark = analyzeOccludedSubject(false, false, false, .04);
  assert.deepEqual(Array.from(dark.mask), Array.from(normal.mask));
  assert.deepEqual(Array.from(dark.gain), [1, 1]);
});

test('nearby displaced content cannot override a visibly unobstructed lens with a dark obstruction', () => {
  const count = 128 * 64, center = 32 * 128 + 64;
  const mask = new Uint8Array(count).fill(255);
  const colors = [new Float32Array(count * 3).fill(200), new Float32Array(count * 3).fill(100)];
  const weights = [new Float32Array(count).fill(.4), new Float32Array(count).fill(.2)];
  colors[0].fill(0, center * 3, center * 3 + 3);
  const context: any = { mask, colors, weights };
  runInNewContext(`${source.replace(/^export /gm, '')}
    this.result = protectDualFisheyeDisplacedContent(mask, colors, weights, [1, 1]);`, context);
  assert.equal(context.result[center], 255, 'neighboring coat votes reintroduced an opaque obstruction');
  weights[0][center] = 0;
  runInNewContext('this.result = protectDualFisheyeDisplacedContent(mask, colors, weights, [1, 1]);', context);
  assert.equal(context.result[center], 255, 'ownership selected an invalid lens');
});


for (const swapLenses of [false,true]) test(`video preserves the displaced subject visible in the ${swapLenses?'front':'back'} lens`, () => {
  const {mask} = analyzeOccludedSubject(true,false,swapLenses,1,true,true);
  assert.ok(mask);
  for (let y=49;y<=57;y++) for (let x=92;x<=98;x++) {
    assert.equal(mask[y*128+x],swapLenses?0:255,`video discarded the subject at ${x},${y}`);
  }
});

test('video polar ownership remains coherent across longitude and transitions smoothly between frames', () => {
  const size=128*64;
  const context:any={Uint8Array,Float32Array,
    mask:Uint8Array.from({length:size},(_,i)=>i%128<64?0:255),
    colors:[new Float32Array(size*3).fill(100),new Float32Array(size*3).fill(100)],
    weights:[new Float32Array(size).fill(.2),new Float32Array(size).fill(.08)],
  };
  runInNewContext(`${source.replace(/^export /gm, '')}\nthis.blend = typeof blendDualFisheyeVideoMasks === 'function' ? blendDualFisheyeVideoMasks : (mask) => mask; this.stabilize = typeof stabilizeDualFisheyeVideoMask === 'function' ? stabilizeDualFisheyeVideoMask : (mask) => mask;`,context);
  const result=context.stabilize(context.mask,context.colors,context.weights,[1,1],null);
  for (const row of [0,1,62,63]) assert.ok(Array.from(result.slice(row*128,(row+1)*128)).every(v=>v===0),`polar cap ${row} splits a nearby subject`);
  assert.equal(result[32*128+96],255,'ordinary ownership must remain unchanged');
  const transitioned=context.blend(context.stabilize(new Uint8Array(size).fill(255),context.colors,[context.weights[1],context.weights[0]],[1,1],result),result);
  assert.ok(transitioned[0]>0&&transitioned[0]<=96,'polar ownership jumped in one frame');
});


test('video polar cap retains readable nearby hands without reacting to lens exposure alone', () => {
  const size=128*64, context:any={Uint8Array,Float32Array};
  runInNewContext(`${source.replace(/^export /gm, '')}\nthis.stabilize = stabilizeDualFisheyeVideoMask;`,context);
  const mask=new Uint8Array(size).fill(0);
  const colors=[new Float32Array(size*3).fill(70),new Float32Array(size*3).fill(170)];
  const weights=[new Float32Array(size).fill(.12),new Float32Array(size).fill(.08)];
  const hand=context.stabilize(mask,colors,weights,[1,1],null);
  assert.equal(hand[0],255,'geometry-only polar ownership replaced a readable hand with displaced dark trousers');
  const matched=context.stabilize(mask,colors,weights,[170/70,1],null);
  assert.equal(matched[0],0,'equal content after exposure normalization must retain stronger sensor support');
  colors[1].fill(0);
  assert.equal(context.stabilize(mask,colors,weights,[1,1],null)[0],0,'an opaque obstruction cannot own the cap');
});
