import test from "node:test";
import assert from "node:assert/strict";

import {
  TICKER_CONSTANTS,
  calcRowScale,
  calcRowOpacities,
  enqueueSteps,
  calcTickerProgress,
} from "../src/views/ticker-utils.ts";

test("TICKER_CONSTANTS: defines expected layout and animation timings", () => {
  assert.equal(TICKER_CONSTANTS.ROW_H, 22);
  assert.equal(TICKER_CONSTANTS.DURATION, 380);
  assert.equal(TICKER_CONSTANTS.MAX_QUEUE, 4);
  assert.ok(TICKER_CONSTANTS.COMPLETED_SCALE < 1 && TICKER_CONSTANTS.COMPLETED_SCALE > 0.8);
});

test("calcRowScale: scales smoothly between current and completed states", () => {
  assert.equal(calcRowScale(0), 1);
  assert.equal(calcRowScale(1), TICKER_CONSTANTS.COMPLETED_SCALE);

  const mid = calcRowScale(0.5);
  assert.ok(mid < 1 && mid > TICKER_CONSTANTS.COMPLETED_SCALE);

  // Clamping and non-finite guards
  assert.equal(calcRowScale(-0.5), 1);
  assert.equal(calcRowScale(1.5), TICKER_CONSTANTS.COMPLETED_SCALE);
  assert.equal(calcRowScale(NaN), 1);
  assert.equal(calcRowScale(Infinity), TICKER_CONSTANTS.COMPLETED_SCALE);
});

test("calcRowOpacities: calculates crossfade layers correctly across phase [0, 1]", () => {
  // Phase 0: current active row
  const p0 = calcRowOpacities(0);
  assert.equal(p0.chevron, 1);
  assert.equal(p0.check, 0);
  assert.equal(p0.shimmer, 1);
  assert.equal(p0.dim, 0);

  // Phase 1: completed past row
  const p1 = calcRowOpacities(1);
  assert.equal(p1.chevron, 0);
  assert.equal(p1.check, 1);
  assert.equal(p1.shimmer, 0);
  assert.equal(p1.dim, 1);

  // Phase 0.5: crossfade midpoint
  const p05 = calcRowOpacities(0.5);
  assert.equal(p05.chevron, 0);
  assert.equal(p05.check, 0); // check begins at phase > 0.5
  assert.ok(Math.abs(p05.shimmer - 0.2) < 1e-9); // 1 - 0.5*1.6 = 0.2
  assert.ok(Math.abs(p05.dim - 0.6) < 1e-9); // 0.5*2 - 0.4 = 0.6
});

test("enqueueSteps: handles first render and session restarts as resets", () => {
  const steps = ["Step 1", "Step 2", "Step 3"];

  // First render (displayIndex -1)
  const first = enqueueSteps([], steps, -1, 1);
  assert.equal(first.reset, true);
  assert.equal(first.displayIndex, 1);
  assert.deepEqual(first.queue, []);

  // Session reset (new index < display index)
  const reset = enqueueSteps(["Queued 1"], steps, 2, 0);
  assert.equal(reset.reset, true);
  assert.equal(reset.displayIndex, 0);
  assert.deepEqual(reset.queue, []);
});

test("enqueueSteps: enqueues new steps and bounds queue bursts", () => {
  const steps = ["Step 0", "Step 1", "Step 2", "Step 3", "Step 4", "Step 5", "Step 6"];

  // Advancing from 0 to 2
  const advanced = enqueueSteps([], steps, 0, 2);
  assert.equal(advanced.reset, false);
  assert.equal(advanced.displayIndex, 2);
  assert.deepEqual(advanced.queue, ["Step 1", "Step 2"]);

  // Advancing across a burst exceeding MAX_QUEUE (4)
  const burst = enqueueSteps([], steps, 0, 6, 4);
  assert.equal(burst.reset, false);
  assert.equal(burst.displayIndex, 6);
  assert.equal(burst.queue.length, 4);
  assert.deepEqual(burst.queue, ["Step 3", "Step 4", "Step 5", "Step 6"]);
});

test("calcTickerProgress: computes clamped interpolation progress", () => {
  const start = 1000;
  const duration = 380;

  assert.equal(calcTickerProgress(start, 1000, duration), 0);
  assert.equal(calcTickerProgress(start, 1190, duration), 0.5);
  assert.equal(calcTickerProgress(start, 1380, duration), 1);
  assert.equal(calcTickerProgress(start, 2000, duration), 1);

  // Backwards or non-finite
  assert.equal(calcTickerProgress(start, 900, duration), 0);
  assert.equal(calcTickerProgress(NaN, 1200, duration), 1);
  assert.equal(calcTickerProgress(start, NaN, duration), 1);
  assert.equal(calcTickerProgress(start, 1200, 0), 1);
});
