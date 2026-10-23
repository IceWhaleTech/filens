// Migrated with the Photos renderer; independent references protect pixel ownership and GPU work.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync('src/realtime/stitch-renderer.js', 'utf8');
type Surface = { width: number; height: number; pixels: Uint8Array | Uint8ClampedArray | Uint16Array };

function referenceChanged(current: Surface, previous: Surface | null) {
  if (previous?.width !== current.width || previous?.height !== current.height) return true;
  for (let y = 0; y < current.height; y += 8) for (let x = 0; x < current.width; x += 8) {
    let delta = 0, count = 0;
    for (let row = y; row < Math.min(y + 8, current.height); row += 2)
      for (let col = x; col < Math.min(x + 8, current.width); col += 2) {
        for (let channel = 0; channel < 3; channel++) {
          const at = (row * current.width + col) * 4 + channel;
          delta += Math.abs(current.pixels[at] - previous.pixels[at]);
          count++;
        }
      }
    if (delta / count > 12) return true;
  }
  return false;
}

function harness(Words: typeof Uint32Array = Uint32Array) {
  const scope: any = { Uint8Array, Uint8ClampedArray, Uint32Array: Words };
  runInNewContext(`${source.replace(/^export /gm, '')}
    this.changed = typeof dualFisheyeAnalysisSurfaceChanged === 'function' ? dualFisheyeAnalysisSurfaceChanged : null;`, scope);
  assert.equal(typeof scope.changed, 'function');
  return scope.changed as (current: Surface, previous: Surface | null) => boolean;
}

function surface(width: number, height: number, offset = 0, Bytes = Uint8ClampedArray): Surface {
  const pixels = new Bytes(new ArrayBuffer(width * height * 4 + offset), offset, width * height * 4);
  for (let at = 0; at < pixels.length; at++) pixels[at] = at % 4 === 3 ? 255 : 70 + (at * 17) % 101;
  return { width, height, pixels };
}

test('local analysis change detection matches scalar blocks for aligned, unaligned and partial-edge surfaces', () => {
  const changed = harness();
  for (const [width, height] of [[1, 1], [7, 9], [17, 13], [256, 128], [1024, 512]]) {
    for (const offset of [0, 1, 4]) {
      const previous = surface(width, height, offset);
      for (const pattern of ['same', 'alpha', 'small', 'threshold', 'local', 'edge', 'unsampled']) {
        const current = { ...previous, pixels: previous.pixels.slice() };
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const at = (y * width + x) * 4;
          for (let c = 0; c < 3; c++) {
            if (pattern === 'small') current.pixels[at + c] += (x + y + c) % 7;
            if (pattern === 'threshold') current.pixels[at + c] += 12;
            if (pattern === 'local' && x >= width - 8 && y >= height - 8) current.pixels[at + c] += 23;
            if (pattern === 'edge' && x === width - 1 && y === height - 1) current.pixels[at + c] = 255;
            if (pattern === 'unsampled' && (x % 2 || y % 2)) current.pixels[at + c] = 0;
          }
          if (pattern === 'alpha') current.pixels[at + 3] = (x * 79 + y * 31) % 256;
        }
        const before = previous.pixels.slice(), fresh = current.pixels.slice();
        assert.equal(changed(current, previous), referenceChanged(current, previous), `${width}x${height}, offset ${offset}, ${pattern}`);
        assert.deepEqual(previous.pixels, before, 'the last accepted image must remain unchanged');
        assert.deepEqual(current.pixels, fresh);
      }
      assert.equal(changed(previous, null), true);
      assert.equal(changed(previous, { ...previous, height: height + 1 }), true);
    }
  }
});

test('local blocks keep strict thresholds and accumulate slow motion against the accepted frame', () => {
  const changed = harness(), previous = surface(1024, 512);
  for (const difference of [0, 4, 8, 12, 13]) {
    const current = { ...previous, pixels: previous.pixels.slice() };
    // A single tile near the far corner must survive whole-image dilution.
    for (let y = 504; y < 512; y++) for (let x = 1016; x < 1024; x++)
      for (let c = 0; c < 3; c++) current.pixels[(y * 1024 + x) * 4 + c] += difference;
    assert.equal(changed(current, previous), difference > 12);
  }
});

test('identical packed pixels skip RGB reads while alpha-only differences retain RGB comparison semantics', () => {
  let wordViews = 0, wordReads = 0, byteReads = 0;
  class Words extends Uint32Array {
    constructor(input: any = 0, offset?: number, length?: number) {
      super(input, offset, length); wordViews++;
      return new Proxy(this, { get(target, property) {
        if (typeof property === 'string' && /^[0-9]+$/.test(property)) wordReads++;
        return Reflect.get(target, property, target);
      } });
    }
  }
  const changed = harness(Words), previous = surface(1024, 512);
  const observe = (value: Surface) => ({ ...value, pixels: new Proxy(value.pixels, { get(target, property) {
    if (typeof property === 'string' && /^[0-9]+$/.test(property)) byteReads++;
    return Reflect.get(target, property, target);
  } }) });
  const current = { ...previous, pixels: previous.pixels.slice() };
  assert.equal(changed(observe(current), observe(previous)), false);
  assert.equal(wordViews, 2, 'views must be local to this comparison');
  assert.equal(wordReads, 2 * (512 * 256 + 128 * 64), 'each tile checks its first pixel before selecting the word path');
  assert.equal(byteReads, 0, 'equal words prove equal RGB without six scalar byte reads');
  current.pixels[3] = 0;
  wordViews = wordReads = byteReads = 0;
  assert.equal(changed(observe(current), observe(previous)), false);
  assert.equal(byteReads, 16 * 6, 'an unequal first word selects scalar RGB for its tile, still excluding alpha');
  assert.equal(wordReads, 2 * (512 * 256 + 128 * 64 - 16), 'other tiles retain word comparisons');
  for (let at = 0; at < current.pixels.length; at++) if (at % 4 !== 3) current.pixels[at]++;
  wordViews = wordReads = byteReads = 0;
  assert.equal(changed(observe(current), observe(previous)), false);
  assert.equal(wordReads, 2 * 128 * 64, 'uniform low-level change must use only one word pair per tile');
  assert.equal(byteReads, 6 * 512 * 256);
  const unaligned = surface(1024, 512, 1);
  wordViews = wordReads = byteReads = 0;
  assert.equal(changed(observe(unaligned), observe(previous)), false);
  assert.equal(wordViews, 0, 'unaligned data keeps the scalar fallback');
  assert.equal(byteReads, 6 * 512 * 256);
  const bytes = { ...previous, pixels: Uint8Array.from(previous.pixels) };
  wordViews = wordReads = byteReads = 0;
  assert.equal(changed(observe(bytes), observe(previous)), false);
  assert.equal(wordViews, 2, 'both ordinary and clamped byte views support packed equality');
  assert.equal(byteReads, 0);
});

test('non-byte and incomplete analysis surfaces preserve scalar fallback behavior', () => {
  const changed = harness();
  const previous = { width: 17, height: 13, pixels: new Uint16Array(17 * 13 * 4).fill(100) };
  for (const length of [previous.pixels.length, previous.pixels.length - 3]) {
    const current = { ...previous, pixels: previous.pixels.slice(0, length) };
    current.pixels[0] = 65535;
    assert.equal(changed(current, previous), referenceChanged(current, previous));
  }
  const full = surface(17, 13);
  const short = { ...full, pixels: full.pixels.slice(0, -4) };
  short.pixels[short.pixels.length - 4] = 255;
  assert.equal(changed(short, full), referenceChanged(short, full));
});

test('video probes retain the accepted baseline until slow local motion triggers fresh protection', () => {
  let analyses = 0;
  const current = surface(64, 32);
  current.pixels.fill(100);
  for (let at = 3; at < current.pixels.length; at += 4) current.pixels[at] = 255;
  const scope: any = { Uint8Array, Uint8ClampedArray, current,
    solve: () => { analyses++; return { mask: new Uint8Array(128 * 64).fill(analyses), strength: new Uint8Array(128 * 64) }; } };
  runInNewContext(`${source.replace(/^export /gm, '')}
    createSeamAnalysisSurface = () => ({ ...current, pixels: current.pixels.slice() });
    analyzeDualFisheyeSeam = solve; this.analyze = analyzeX5VideoSeamFrame;`, scope);
  const cache: any = {};
  const analyze = () => scope.analyze({}, {}, {}, [{}, {}], { gain: [1, 1], offsets: [], polarInverseDepth: [] }, null, cache);
  const at = (24 * current.width + 56) * 4;
  assert.ok(analyze().mask);
  for (const value of [104, 108, 112, 113, 116]) {
    for (let y = 24; y < 32; y++) for (let x = 56; x < 64; x++)
      for (let c = 0; c < 3; c++) current.pixels[(y * current.width + x) * 4 + c] = value;
    const result = analyze();
    if (value === 113) {
      assert.ok(result.mask, 'thirteen levels of accumulated local motion must update foreground protection');
      assert.equal(analyses, 2);
    } else {
      assert.equal(result.reused, true);
      assert.equal(analyses, value < 113 ? 1 : 2);
    }
    assert.equal(cache.surface.pixels[at], value < 113 ? 100 : 113,
      'skipped probes must not erase accumulated movement relative to the accepted frame');
  }
  delete cache.surface;
  assert.ok(analyze().mask);
  assert.equal(analyses, 3, 'seek invalidation must still rebuild protection');
});
