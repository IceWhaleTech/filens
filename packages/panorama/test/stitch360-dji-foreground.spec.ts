// Migrated with the Photos renderer; independent references protect pixel ownership and GPU work.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync('src/realtime/stitch-renderer.js', 'utf8');

function scalarDisplacedProtection(mask: Uint8Array, colors: Float32Array[], weights: Float32Array[], gains: number[]) {
  const width = 128, height = 64, luma = [.2126, .7152, .0722];
  const votes = [new Float32Array(mask.length), new Float32Array(mask.length)];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x;
    if (weights[0][index] <= 0 || weights[1][index] <= 0) continue;
    const winner = weights[0][index] > weights[1][index] ? 0 : 1, other = 1 - winner;
    if (weights[winner][index] < weights[other][index] * 1.5) continue;
    let mismatch = 0, winnerLuma = 0;
    for (let channel = 0; channel < 3; channel++) {
      const own = colors[winner][index * 3 + channel] * gains[winner];
      mismatch += Math.abs(own - colors[other][index * 3 + channel] * gains[other]) / 3;
      winnerLuma += own * luma[channel];
    }
    if (mismatch < 32 || winnerLuma < 24) continue;
    const support = (weights[winner][index] - weights[other][index]) * Math.min(1, mismatch / 64);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (y + dy < 0 || y + dy >= height) continue;
      votes[winner][(y + dy) * width + (x + dx + width) % width] += support * (3 - Math.max(Math.abs(dx), Math.abs(dy)));
    }
  }
  return Uint8Array.from(mask, (value, index) => {
    const winner = votes[0][index] > votes[1][index] ? 0 : 1, other = 1 - winner;
    if (weights[winner][index] <= 0 || votes[winner][index] < .05 || votes[winner][index] < votes[other][index] * 2) return value;
    const own = luma.reduce((sum, coefficient, channel) => sum + colors[winner][index * 3 + channel] * gains[winner] * coefficient, 0);
    const opposite = luma.reduce((sum, coefficient, channel) => sum + colors[other][index * 3 + channel] * gains[other] * coefficient, 0);
    return weights[other][index] > 0 && own < 12 && opposite > 24 && own < opposite * .25 ? value : winner ? 255 : 0;
  });
}

test('displaced-content protection preserves scalar votes, gain order and obstruction thresholds', () => {
  const count = 128 * 64, context: any = {};
  runInNewContext(`${source.replace(/^export /gm, '')}\nthis.protect = protectDualFisheyeDisplacedContent;`, context);
  const mask = Uint8Array.from({ length: count }, (_, i) => i % 256);
  for (const gains of [[1, 1], [.8, 1.25], [1.23456789, .87654321]]) {
    const colors = [0, 1].map(lens => Float32Array.from({ length: count * 3 },
      (_, at) => ((at * 79 + lens * 173) % 4093) / 16));
    const weights = [0, 1].map(lens => Float32Array.from({ length: count },
      (_, at) => (at + lens) % 13 ? ((at * 17 + lens * 53) % 101) / 256 : 0));
    for (let i = 0; i < 12; i++) {
      const at = (i < 6 ? 0 : 63 * 128) + i;
      colors[0].fill([0, 11.999999, 12, 23.999999, 24, 32][i % 6] / gains[0], at * 3, at * 3 + 3);
      colors[1].fill(96 / gains[1], at * 3, at * 3 + 3);
      weights[0][at] = .3; weights[1][at] = .1;
    }
    for (const swap of [false, true]) {
      if (swap) { colors.reverse(); weights.reverse(); }
      const original = mask.slice();
      const result = context.protect(mask, colors, weights, gains);
      assert.deepEqual(Array.from(result), Array.from(scalarDisplacedProtection(mask, colors, weights, gains)));
      assert.deepEqual(mask, original, 'protection must return independent ownership');
      const snapshot = result.slice();
      const previousColors = colors[0].slice();
      colors[0].fill(0);
      context.protect(mask, colors, weights, gains);
      assert.deepEqual(result, snapshot, 'a later frame cannot overwrite the previous result');
      colors[0].set(previousColors);
    }
  }
  assert.equal(context.protect(null, [], [], []), null);
});

test('displaced-content obstruction checks read the opposite RGB only for a dark valid candidate', () => {
  const count = 128 * 64, context: any = {};
  const checkpoint = '  const protectedMask = mask.slice();';
  assert.ok(source.includes(checkpoint));
  runInNewContext(`${source.replace(/^export /gm, '').replace(checkpoint, `reads.fill(0);\n${checkpoint}`)}
    this.protect = protectDualFisheyeDisplacedContent;
    const reads = new Uint32Array(${count}); this.reads = reads;
    this.watch = values => new Proxy(values, { get(target, property) {
      if (typeof property === 'string' && /^[0-9]+$/.test(property)) reads[Math.floor(Number(property) / 3)]++;
      return Reflect.get(target, property, target);
    } });`, context);
  const colors = [new Float32Array(count * 3).fill(80), new Float32Array(count * 3).fill(10)];
  const weights = [new Float32Array(count).fill(.3), new Float32Array(count).fill(.1)];
  const dark = 20 * 128 + 32, invalidOther = dark + 10;
  colors[0].fill(0, dark * 3, dark * 3 + 3);
  colors[1].fill(80, dark * 3, dark * 3 + 3);
  weights[1][invalidOther] = 0;
  const result = context.protect(new Uint8Array(count).fill(255), colors.map(context.watch), weights, [1, 1]);
  assert.equal(result[dark], 255, 'neighboring votes must not select the black obstruction');
  assert.equal(context.reads[dark], 6);
  assert.equal(context.reads[invalidOther], 0, 'an invalid opposite lens needs no obstruction check');
  assert.equal(context.reads[dark + 1], 3, 'a visible winner needs no opposite luminance');
  assert.equal(Array.from(context.reads as Uint32Array).reduce((sum, value) => sum + value, 0), count * 3);
});

function support(gains = [1, 1]) {
  const count = 128 * 64;
  const colors = [new Float32Array(count * 3).fill(80), new Float32Array(count * 3).fill(80)];
  const weights = [new Float32Array(count).fill(.1), new Float32Array(count).fill(.1)];
  const context: any = { colors, weights, gains };
  runInNewContext(`${source.replace(/^export /gm, '')}
    this.support = typeof buildDualFisheyeContentSupport === 'function' ? buildDualFisheyeContentSupport : null;`, context);
  assert.equal(typeof context.support, 'function');
  return { colors, weights, analyze: () => context.support(colors, weights, gains) };
}

test('DJI foreground support covers a displaced mirror edge and its matching dark interior', () => {
  const { colors, analyze } = support();
  const edge = 40 * 128 + 32;
  colors[0].fill(10, edge * 3, edge * 3 + 3);
  const result = analyze();
  assert.equal(result[edge], 255);
  assert.equal(result[edge + 1], 255, 'a matching interior must retain the same coherent owner as its edge');
  assert.equal(result[edge + 4], 0, 'local foreground support must not replace the distant scene');
  assert.equal(result[10 * 128 + 32], 0, 'matching sky must retain its calibrated blend');
});

test('DJI foreground support rejects ordinary exposure differences and invalid lens samples', () => {
  const { colors, weights, analyze } = support([1.1, 1]);
  colors[1].fill(88);
  assert.ok(Array.from(analyze()).every(value => value === 0));
  const edge = 40 * 128 + 32;
  colors[0].fill(0, edge * 3, edge * 3 + 3);
  weights[0][edge] = 0;
  assert.ok(Array.from(analyze()).every(value => value === 0));
});

test('DJI foreground support wraps across longitude without leaking between polar rows', () => {
  const { colors, analyze } = support();
  colors[0].fill(0, 0, 3);
  const result = analyze();
  assert.equal(result[127], 255);
  assert.equal(result[63 * 128], 0);
});

test('foreground luminance preserves scalar Float32 values, gain order and fresh samples at all weights', () => {
  const count = 128 * 64;
  const colors = [0, 1].map(lens => Float32Array.from({ length: count * 3 },
    (_, at) => ((at * 79 + lens * 173) % 4093) / 16));
  const weights = [0, 1].map(lens => Float32Array.from({ length: count },
    (_, at) => (at + lens) % 3 ? .2 : 0));
  const context: any = {};
  runInNewContext(`${source.replace(/^export /gm, '')}
    this.protect = protectDualFisheyeForegroundRegions;
    this.gray = [];
    dualFisheyeLocalContrast = values => { this.gray.push(values); return new Float32Array(values.length); };`, context);
  const roundingGain = 1.2496355726285209;
  for (const gains of [[1, 1], [.8, 1.25], [1.23456789, .87654321], [roundingGain, 1]]) {
    context.gray.length = 0;
    // Include dark-obstruction and foreground voting thresholds, then change
    // the source between calls to catch accidental reuse of old luminance.
    for (let lens = 0; lens < 2; lens++) {
      colors[lens].set([4, 4, 4, 12, 12, 12, 24, 24, 24, 127.99999, 128, 128.00001]);
      colors[lens].set([1, 10, 31], 100 * 3);
      colors[lens][43] += 1;
    }
    context.protect(new Uint8Array(count), colors, weights, gains);
    for (let lens = 0; lens < 2; lens++) {
      // Previous scalar conversion is the reference; quantization must occur
      // after gain, including points used only by neighboring contrast windows.
      const expected = Float32Array.from({ length: count }, (_, index) => {
        const rgb = colors[lens].subarray(index * 3, index * 3 + 3);
        return rgb.reduce((sum, value, channel) => sum + value * [.2126, .7152, .0722][channel], 0) * gains[lens];
      });
      assert.deepEqual(Array.from(context.gray[lens]), Array.from(expected));
    }
    // Distributing this gain over RGB rounds the sample to 12.000000953674316;
    // the original order lands on the Float32 midpoint and rounds to 12.
    if (gains[0] === roundingGain) assert.equal(context.gray[0][100], 12);
  }
});

test('foreground seed dilation preserves scalar neighborhoods at word, longitude and polar boundaries', () => {
  const width = 128, height = 64, count = width * height, context: any = {};
  runInNewContext(`${source.replace(/^export /gm, '')}
    this.dilate = typeof dilateDualFisheyeForegroundSeeds === 'function' ? dilateDualFisheyeForegroundSeeds : null;`, context);
  assert.equal(typeof context.dilate, 'function');
  const history: { result: Uint8Array; snapshot: Uint8Array }[] = [];
  const edges = [0, 1, 30, 31, 32, 33, 63, 64, 95, 96, 126, 127];
  const patterns = [[], [0], [width - 1], [width], [count - width], [count - 1],
    ...[1, 2, 3, 31, 60, 61, 62].flatMap(y => edges.map(x => [y * width + x])),
    Array.from({ length: count }, (_, i) => i).filter(i => (Math.imul(i + 3, 2654435761) >>> 0) % 11 === 0),
    Array.from({ length: count }, (_, i) => i)];
  for (const points of patterns) {
    // An offset view catches reads before or after the actual bit plane.
    const storage = new Uint32Array(count / 32 + 4).fill(0xffffffff), seeds = storage.subarray(2, -2);
    seeds.fill(0);
    const expected = new Uint8Array(count);
    for (const point of points) {
      seeds[point >>> 5] |= 1 << (point & 31);
      const y = Math.floor(point / width), x = point % width;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (y + dy < 2 || y + dy >= height - 2) continue;
        expected[(y + dy) * width + (x + dx + width) % width] = 1;
      }
    }
    const original = storage.slice(), result = context.dilate(seeds);
    assert.deepEqual(Array.from(result), Array.from(expected), `seeds: ${points.slice(0, 4)}`);
    assert.deepEqual(storage, original, 'dilation must not alter the seed plane or its surrounding view');
    for (const old of history) assert.deepEqual(old.result, old.snapshot);
    history.length = 0;
    history.push({ result, snapshot: result.slice() });
  }
});

for (const swap of [false, true]) for (const face of [false, true]) {
  test(`connected ${face ? 'face features' : 'mirror and thin stem'} retain the ${swap ? 'back' : 'front'} lens across a seam`, () => {
    const count = 128 * 64;
    const colors = [new Float32Array(count * 3).fill(85), new Float32Array(count * 3).fill(85)];
    const weights = [new Float32Array(count).fill(.2), new Float32Array(count).fill(.08)];
    const mask = Uint8Array.from({ length: count }, (_, i) => i % 128 < 33 ? 255 : 0);
    const feature: number[] = [];
    for (let lens = 0; lens < 2; lens++) for (let y = 20; y <= 31; y++) {
      const left = y < 26 ? 31 : 30;
      const right = y < 26 ? 36 : 31;
      for (let x = left; x <= right; x++) {
        const at = y * 128 + x + lens * 3;
        const color = face ? y === 23 && (x === 32 || x === 35) ? [30, 30, 30] : [190, 140, 105] : [28, 28, 28];
        colors[lens].set(color, at * 3);
        if (!lens) feature.push(at);
      }
    }
    if (swap) { colors.reverse(); weights.reverse(); for (let i = 0; i < mask.length; i++) mask[i] = 255 - mask[i]; }
    const context: any = {};
    runInNewContext(`${source.replace(/^export /gm, '')}
      this.protect = typeof protectDualFisheyeForegroundRegions === 'function' ? protectDualFisheyeForegroundRegions : mask => mask;`, context);
    const result = context.protect(mask, colors, weights, [1, 1]);
    for (const at of feature) assert.equal(result[at], swap ? 255 : 0, `feature split at ${at % 128},${Math.floor(at / 128)}`);
    assert.equal(result[10 * 128 + 32], mask[10 * 128 + 32], 'matching sky must keep its geometric ownership');
    assert.deepEqual(Array.from(mask.slice(0, 128)), Array.from(result.slice(0, 128)), 'polar policy remains separate');
  });
}

test('foreground region protection never selects an invalid or visibly obstructed lens', () => {
  const { colors, weights } = support();
  const mask = new Uint8Array(128 * 64).fill(255);
  weights[0].fill(.3);
  for (let y = 20; y < 29; y++) for (let x = 30; x < 35; x++) colors[0].fill(180, (y * 128 + x) * 3, (y * 128 + x) * 3 + 3);
  const invalid = 24 * 128 + 32, obstructed = invalid + 1;
  weights[0][invalid] = 0;
  colors[0].fill(0, obstructed * 3, obstructed * 3 + 3);
  const context: any = {};
  runInNewContext(`${source.replace(/^export /gm, '')}
    this.protect = typeof protectDualFisheyeForegroundRegions === 'function' ? protectDualFisheyeForegroundRegions : mask => mask;`, context);
  const result = context.protect(mask, colors, weights, [1, 1]);
  assert.equal(result[invalid], 255);
  assert.equal(result[obstructed], 255);
});

test('foreground count caches follow immutable geometry while reading fresh colors every frame', () => {
  const count = 128 * 64, context: any = {};
  runInNewContext(`${source.replace(/^export /gm, '')}
    const buildCounts = typeof dualFisheyeContrastSampleCounts === 'function' ? dualFisheyeContrastSampleCounts : null;
    this.countBuilds = 0;
    if (buildCounts) dualFisheyeContrastSampleCounts = weights => { this.countBuilds++; return buildCounts(weights); };
    this.protect = protectDualFisheyeForegroundRegions;`, context);
  const mask = Uint8Array.from({ length: count }, (_, i) => i % 256);
  let retained: any;
  for (const gaps of [false, true]) {
    const weights = [0, 1].map(lens => Float32Array.from({ length: count },
      (_, i) => gaps && (i + lens) % 7 === 0 ? 0 : lens ? .1 : .3));
    const map: any = {};
    for (let frame = 0; frame < 2; frame++) {
      const colors = [0, 1].map(lens => Float32Array.from({ length: count * 3 },
        (_, i) => ((i * 79 + lens * 173 + frame * 113) % 4093) / 16));
      const actual = context.protect(mask, colors, weights, [.8, 1.25], map);
      const expected = context.protect(mask, colors, weights, [.8, 1.25]);
      assert.deepEqual(Array.from(actual), Array.from(expected));
      assert.equal(context.countBuilds, gaps ? 4 : 2, 'unchanged geometry must not rebuild neighborhood counts');
      assert.equal(map.contrastSampleCounts.reduce((bytes: number, values: Uint8Array) => bytes + values.byteLength, 0), 16384);
      if (frame) assert.equal(map.contrastSampleCounts, retained);
      else assert.notEqual(map.contrastSampleCounts, retained, 'new geometry must replace old count arrays');
      retained = map.contrastSampleCounts;
      assert.deepEqual(Object.keys(map), ['contrastSampleCounts'], 'the count cache must not hold source pixels');
    }
  }
});

test('current foreground ownership bypasses temporal averaging that would ghost moving facial features', () => {
  const context: any = {};
  runInNewContext(`${source.replace(/^export /gm, '')}\nthis.blend = blendDualFisheyeVideoMasks;`, context);
  const result = context.blend(new Uint8Array([0, 255, 0]), new Uint8Array([255, 0, 255]), new Uint8Array([255, 255, 0]));
  assert.deepEqual(Array.from(result.slice(0, 2)), [0, 255]);
  assert.ok(result[2] > 0 && result[2] < 255, 'ordinary boundaries retain temporal smoothing');
});

test('temporal mask blending preserves all byte pairs, protection thresholds and floating-point rounding in independent outputs', () => {
  const context: any = {};
  runInNewContext(`${source.replace(/^export /gm, '')}\nthis.blend = blendDualFisheyeVideoMasks;`, context);
  const count = 256 * 256;
  const mask = new Uint8Array(count + 7).subarray(3, count + 3);
  const previous = new Uint8Array(count + 11).subarray(5, count + 5);
  const strength = new Float64Array(count + 5).subarray(2, count + 2);
  const thresholds = [-1, 0, 127, 127.999999999, 128, 128.000000001, 255, NaN, Infinity];
  for (let index = 0; index < count; index++) {
    mask[index] = index & 255; previous[index] = index >>> 8;
    strength[index] = thresholds[index % thresholds.length];
  }
  const original = mask.slice(), prior = previous.slice();
  const history: { result: Uint8Array; snapshot: Uint8Array }[] = [];
  for (const protection of [null, strength]) {
    // Keep the original callback conversion as the reference. Rewriting this
    // as a rational weighted sum can change byte results at half-way cases.
    const expected = Uint8Array.from(mask, (value, index) => protection !== null && protection[index] >= 128 ? value
      : Math.round(previous[index] + (value - previous[index]) * .35));
    const result = context.blend(mask, previous, protection);
    assert.deepEqual(Array.from(result), Array.from(expected));
    assert.notEqual(result.buffer, mask.buffer);
    assert.notEqual(result.buffer, previous.buffer);
    assert.deepEqual(mask, original); assert.deepEqual(previous, prior);
    for (const old of history) assert.deepEqual(old.result, old.snapshot, 'a later frame must not overwrite earlier blended ownership');
    history.push({ result, snapshot: result.slice() });
  }
  assert.equal(context.blend(new Uint8Array([90]), new Uint8Array([0]))[0], 31,
    'the original 0 + 90 * .35 rounds below the mathematical half-way value');
  assert.equal(context.blend(mask, null), mask, 'without a prior owner, return the current ownership directly');
  assert.equal(context.blend(new Uint8Array(), new Uint8Array()).length, 0);
  mask.fill(17); previous.fill(231);
  context.blend(mask, previous, strength);
  for (const old of history) assert.deepEqual(old.result, old.snapshot);
});
