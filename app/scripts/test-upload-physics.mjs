import test from "node:test";
import assert from "node:assert/strict";

import {
  calcSuperellipseRadii,
  calcSuperellipsePoint,
  calcCrumbParticle,
  calcSuckStripParams,
  calcSuckWobble,
  calcGlowTrailLength,
  clampDropZoneBounds,
} from "../src/upload/upload-utils.ts";

test("calcSuperellipseRadii: computes morph-dependent radii and curvature exponent", () => {
  // Rest state (m = 0)
  const rest = calcSuperellipseRadii(0, 100);
  assert.equal(rest.rx, 104);
  assert.equal(rest.ry, 97);
  assert.equal(rest.n, 2.15);

  // Fully morphed state (m = 1)
  const morphed = calcSuperellipseRadii(1, 100);
  assert.equal(morphed.rx, 100);
  assert.equal(morphed.ry, 94);
  assert.equal(morphed.n, 5.5);

  // Clamping for out-of-bounds or invalid inputs
  const clampedNeg = calcSuperellipseRadii(-0.5, 100);
  assert.equal(clampedNeg.n, 2.15);
  const clampedHigh = calcSuperellipseRadii(2.0, 100);
  assert.equal(clampedHigh.n, 5.5);
  const nanInput = calcSuperellipseRadii(NaN, NaN);
  assert.equal(nanInput.n, 2.15);
  assert.equal(nanInput.rx, 1.04);
});

test("calcSuperellipsePoint: calculates symmetrical points along superellipse perimeter", () => {
  const { rx, ry, n } = calcSuperellipseRadii(0, 50);

  // Angle 0 (positive X axis)
  const p0 = calcSuperellipsePoint(rx, ry, n, 0);
  assert.ok(Math.abs(p0.x - rx) < 1e-4);
  assert.ok(Math.abs(p0.y) < 1e-4);

  // Angle PI/2 (positive Y axis)
  const pPiOver2 = calcSuperellipsePoint(rx, ry, n, Math.PI / 2);
  assert.ok(Math.abs(pPiOver2.x) < 1e-4);
  assert.ok(Math.abs(pPiOver2.y - ry) < 1e-4);

  // Angle PI (negative X axis)
  const pPi = calcSuperellipsePoint(rx, ry, n, Math.PI);
  assert.ok(Math.abs(pPi.x - (-rx)) < 1e-4);
  assert.ok(Math.abs(pPi.y) < 1e-4);
});

test("calcCrumbParticle: generates particle positions and enforces active lifetime bounds", () => {
  // Before activation window
  assert.equal(calcCrumbParticle(0, 4, 0, 100, 100, 50, 50, 40, 20), null);

  // Active crumb particle
  const crumb = calcCrumbParticle(0, 4, 0.35, 200, 150, 50, 60, 40, 20);
  assert.ok(crumb !== null);
  assert.ok(crumb.alpha > 0 && crumb.alpha <= 1);
  assert.ok(crumb.radius > 0 && crumb.radius <= 2.2);
  assert.ok(Number.isFinite(crumb.x));
  assert.ok(Number.isFinite(crumb.y));

  // Past suction window
  assert.equal(calcCrumbParticle(0, 4, 1.0, 200, 150, 50, 60, 40, 20), null);
});

test("calcSuckStripParams & calcSuckWobble: scales slices and computes rotational oscillation", () => {
  // Suction strip deformation
  const topSlice = calcSuckStripParams(0, 28, 0.5, 40, 34);
  assert.equal(topSlice.v0, 0);
  assert.ok(topSlice.wsc > 0 && topSlice.wsc <= 1.0);

  const bottomSlice = calcSuckStripParams(27, 28, 0.5, 40, 34);
  assert.ok(bottomSlice.v0 > 0.9);
  assert.ok(bottomSlice.wsc > 0);

  // Wobble boundaries
  assert.equal(calcSuckWobble(0), 0);
  const midWobble = calcSuckWobble(0.25);
  assert.ok(midWobble > 0);
  assert.equal(calcSuckWobble(1), 0);
});

test("calcGlowTrailLength: maps and clamps speed to glow trail dimensions", () => {
  assert.equal(calcGlowTrailLength(0), 8);
  assert.equal(calcGlowTrailLength(-5), 8);
  assert.equal(calcGlowTrailLength(0.2), 16);
  assert.equal(calcGlowTrailLength(0.5), 28);
  assert.equal(calcGlowTrailLength(2.0), 34); // Clamped at 34
  assert.equal(calcGlowTrailLength(NaN), 8);
});

test("clampDropZoneBounds: bounds drop zone dimensions with minimum fallbacks", () => {
  assert.deepEqual(clampDropZoneBounds(10, 20, 100, 200), {
    x: 10,
    y: 20,
    w: 100,
    h: 200,
  });

  // Clamp below minimums
  assert.deepEqual(clampDropZoneBounds(0, 0, 5, 10, 30, 40), {
    x: 0,
    y: 0,
    w: 30,
    h: 40,
  });

  // NaN protection
  assert.deepEqual(clampDropZoneBounds(NaN, NaN, NaN, NaN), {
    x: 0,
    y: 0,
    w: 20,
    h: 20,
  });
});
