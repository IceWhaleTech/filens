// Migrated with the Photos renderer; independent references protect pixel ownership and GPU work.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync('src/realtime/stitch-renderer.js', 'utf8');

// Enumerate every admissible path independently of the row recurrence. Equal
// costs prefer the lowest final column, then the lowest predecessor backwards.
function enumerate(costs: Float64Array, width: number, height: number, step: number) {
  let best: { seam: number[]; cost: number } | null = null;
  const visit = (path: number[], cost: number) => {
    if (path.length === height) {
      if (!best || cost < best.cost || (cost === best.cost && (() => {
        for (let y = height - 1; y >= 0; y--) {
          if (path[y] !== best!.seam[y]) return path[y] < best!.seam[y];
        }
        return false;
      })())) best = { seam: path.slice(), cost };
      return;
    }
    for (let x = 0; x < width; x++) {
      if (path.length && Math.abs(x - path[path.length - 1]) > step) continue;
      const value = costs[path.length * width + x];
      if (!Number.isFinite(value) || value >= 65535) continue;
      path.push(x); visit(path, cost + value); path.pop();
    }
  };
  visit([], 0);
  return best;
}

test('seam DP matches exhaustive paths, tie order and invalid barriers with only two cost rows', () => {
  let costBytes = 0;
  class CostArray extends Float64Array {
    constructor(length: number) { super(length); costBytes += this.byteLength; }
  }
  const context: any = { Float64Array: CostArray };
  runInNewContext(`${source.replace(/^export /gm, '')}\nthis.solve = solveDualFisheyeSeamDP;`, context);
  const cases: [number, number, number, Float64Array][] = [
    [1, 1, 0, new Float64Array([65534])],
    [1, 4, 2, new Float64Array([2, 3, 4, 5])],
    [5, 1, 2, new Float64Array([9, 2, 2, 65535, NaN])],
    [4, 4, 2, new Float64Array(16)],
    [3, 3, 1, new Float64Array([0, 65535, 65535, Infinity, 65535, NaN, 0, 0, 0])],
    [3, 3, 0, new Float64Array([0, 1, 1, 65535, 1, 1, 0, 1, 1])],
  ];
  let seed = 79;
  for (let i = 0; i < 40; i++) {
    const width = i % 5 + 1, height = i % 4 + 1, step = i % 3;
    const costs = Float64Array.from({ length: width * height }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % 11 === 0 ? 65535 : seed % 13 === 0 ? NaN : (seed % 17 - 4) / 4;
    });
    cases.push([width, height, step, costs]);
  }
  const workspace: any = {};
  for (const [width, height, step, costs] of cases) {
    const original = costs.slice(), result = context.solve(costs, width, height, step);
    const expected = enumerate(costs, width, height, step);
    assert.deepEqual(result && { seam: Array.from(result.seam), cost: result.cost }, expected);
    const reused = context.solve(costs, width, height, step, workspace);
    assert.deepEqual(reused && { seam: Array.from(reused.seam), cost: reused.cost }, expected,
      'scratch must follow changing dimensions, barriers and tie rules');
    assert.notEqual(workspace.dp.buffer, costs.buffer);
    assert.notEqual(workspace.parents.buffer, costs.buffer);
    assert.deepEqual(costs, original, 'the solver cannot use caller costs as its rolling workspace');
  }
  const width = 64, height = 64, costs = new Float64Array(width * height).fill(1);
  for (let y = 0; y < height; y++) costs[y * width + 20] = 0;
  costBytes = 0;
  const result = context.solve(costs, width, height, 2);
  assert.equal(result.cost, 0);
  assert.deepEqual(Array.from(result.seam), new Array(height).fill(20));
  assert.ok(costBytes <= width * 2 * Float64Array.BYTES_PER_ELEMENT,
    'DP cumulative costs must allocate at most two rows, not a full width × height matrix');
  const shared = context.solve(costs, width, height, 2, workspace);
  costBytes = 0; costs.fill(65535);
  assert.equal(context.solve(costs, width, height, 2, workspace), null);
  assert.equal(costBytes, 0, 'same-sized scratch must be reused even when the next half is unreachable');
  assert.deepEqual(Array.from(shared.seam), new Array(height).fill(20));
});

test('successive seam halves share bounded scratch while preserving distinct paths and unreachable results', () => {
  let workspaceBytes = 0, gradientBytes = 0, solvingHalves = false;
  class Costs extends Float64Array {
    constructor(length: number) {
      super(length);
      if (solvingHalves) workspaceBytes += this.byteLength;
      else if (length === 128) gradientBytes += this.byteLength;
    }
  }
  class Parents extends Int16Array {
    constructor(length: number) { super(length); workspaceBytes += this.byteLength; }
  }
  const width = 128, height = 64, half = width / 2, count = width * height;
  const checkpoint = '  const half = ANALYSIS_WIDTH / 2;';
  const analyzerStart = source.indexOf('function analyzeDualFisheyeSeam(');
  const checkpointIndex = source.indexOf(checkpoint, analyzerStart);
  assert.ok(analyzerStart >= 0 && checkpointIndex > analyzerStart);
  const instrumented = source.slice(0, checkpointIndex) + 'startHalfWorkspace();\n' + source.slice(checkpointIndex);
  const context: any = { Float64Array: Costs, Int16Array: Parents,
    startHalfWorkspace() { solvingHalves = true; } };
  runInNewContext(`${instrumented.replace(/^export /gm, '')}
    const solve = solveDualFisheyeSeamDP;
    this.calls = [];
    solveDualFisheyeSeamDP = (...args) => {
      const result = solve(...args);
      this.calls.push({ costs: Array.from(args[0]), result });
      return result;
    };
    dualFisheyeAnalysisMap = () => this.map;
    this.analyze = analyzeDualFisheyeSeam;
    this.defaults = DEFAULT_OPTIONS;`, context);
  const pixels = new Uint8ClampedArray([80, 80, 80, 255, 80, 80, 80, 255]);
  const surface = { pixels, width: 2, height: 1 };
  const lenses = [{ center: [.25, .5] }, { center: [.75, .5] }];
  const options = { ...context.defaults, dualFisheyeAutoGain: false, dualFisheyeGainFront: 1, dualFisheyeGainBack: 1 };
  const history: any[] = [];
  for (const blocked of [-1, 0, 1]) {
    context.map = {
      uv: lenses.map(lens => Float64Array.from({ length: count * 2 }, (_, i) => lens.center[i % 2])),
      // Binary-exact weights make the analytic penalty exactly 64, so the
      // reference is independent of the implementation's prefix-sum order.
      weights: [.375, .125].map(weight => Float32Array.from({ length: count }, (_, i) =>
        Math.floor((i % width) / half) === blocked ? 0 : weight)),
    };
    context.calls.length = 0; workspaceBytes = 0; gradientBytes = 0; solvingHalves = false;
    const result = context.analyze(surface, options, null, null, ...lenses, Math.PI,
      { previousMask: new Uint8Array(count) });
    assert.equal(context.calls.length, 2);
    for (let side = 0; side < 2; side++) {
      const call = context.calls[side], invalid = blocked === side;
      if (invalid) {
        assert.equal(call.result, null);
        assert.ok(call.costs.every((cost: number) => cost === 65535));
        continue;
      }
      const own = context.map.weights[0][side * half], other = context.map.weights[1][side * half];
      const penalty = 128 * (1 - 2 * Math.min(own, other) / Math.max(.0001, own + other));
      const expectedCosts = Array.from({ length: half * height }, (_, i) =>
        penalty + (side === 0 ? half - i % half : i % half) * 12);
      assert.deepEqual(Array.from(call.costs), expectedCosts, 'each half must rebuild all costs from its own visibility losses');
      assert.deepEqual(Array.from(call.result.seam), new Array(height).fill(side === 0 ? half - 1 : 0));
      history.push({ result: call.result, seam: Array.from(call.result.seam), cost: call.result.cost });
    }
    assert.equal(Boolean(result.mask), blocked === -1);
    assert.ok(gradientBytes <= width * Float64Array.BYTES_PER_ELEMENT,
      'gradient differences must allocate no more than one independent Float64 row');
    assert.ok(workspaceBytes <= 43024,
      'two half-solves together must allocate no more than one half-cost grid, two prefix rows and one DP workspace');
    for (const old of history) {
      assert.deepEqual(Array.from(old.result.seam), old.seam, 'later half-solves cannot overwrite returned paths');
      assert.equal(old.result.cost, old.cost);
    }
  }
});
