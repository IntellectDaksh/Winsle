import test from "node:test";
import assert from "node:assert/strict";

import {
  MINIBOT_BODY_SCALE,
  calcMiniBotDimensions,
  clampMinibotDt,
} from "../src/mochi/minibot-utils.ts";

test("MINIBOT_BODY_SCALE: defines expected body-to-canvas ratio", () => {
  assert.equal(MINIBOT_BODY_SCALE, 0.6);
});

test("calcMiniBotDimensions: scales canvas size and pixel density correctly", () => {
  // Standard 22px body size on 1x display
  const dims1x = calcMiniBotDimensions(22, 1);
  assert.equal(dims1x.slotSize, 22);
  assert.equal(dims1x.cssSize, 36.7);
  assert.equal(dims1x.pixelSize, 37);

  // Standard 22px body size on 2x Retina display
  const dims2x = calcMiniBotDimensions(22, 2);
  assert.equal(dims2x.slotSize, 22);
  assert.equal(dims2x.cssSize, 36.7);
  assert.equal(dims2x.pixelSize, 73);

  // Boundary checks: negative, zero, and huge bodySize
  const dimsMin = calcMiniBotDimensions(-10, 1);
  assert.equal(dimsMin.slotSize, 8); // clamped to min 8

  const dimsMax = calcMiniBotDimensions(500, 1);
  assert.equal(dimsMax.slotSize, 256); // clamped to max 256

  const dimsNaN = calcMiniBotDimensions(NaN, 1);
  assert.equal(dimsNaN.slotSize, 22); // fallback
});

test("clampMinibotDt: protects physics engine from lag spikes and negative dt", () => {
  // Normal 60fps frame delta
  assert.equal(clampMinibotDt(0.016), 0.016);

  // Sudden 1-second lag spike or tab freeze
  assert.equal(clampMinibotDt(1.0), 0.1);

  // Negative delta
  assert.equal(clampMinibotDt(-0.05), 0);

  // Non-finite or NaN inputs fall back to standard 60fps step
  assert.equal(clampMinibotDt(NaN), 1 / 60);
  assert.equal(clampMinibotDt(Infinity), 1 / 60);
  assert.equal(clampMinibotDt(null), 1 / 60);
});
