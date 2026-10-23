import test from "node:test";
import assert from "node:assert/strict";

import {
  Ease,
  lerp,
  clamp,
  seg,
  cubicBezier,
  closeCurve,
  Spring,
  Tracked,
} from "../src/core/anim.ts";

test("Ease: computes standard easing functions correctly", () => {
  assert.equal(Ease.lin(0), 0);
  assert.equal(Ease.lin(1), 1);
  assert.equal(Ease.lin(0.5), 0.5);

  assert.equal(Ease.out(0), 0);
  assert.equal(Ease.out(1), 1);
  assert.ok(Ease.out(0.5) > 0.5); // Ease out starts faster

  assert.equal(Ease.inOut(0), 0);
  assert.equal(Ease.inOut(1), 1);
  assert.equal(Ease.inOut(0.5), 0.5);

  assert.equal(Ease.easeIn(0), 0);
  assert.equal(Ease.easeIn(1), 1);
  assert.ok(Ease.easeIn(0.5) < 0.5); // Ease in starts slower
});

test("clamp, lerp, and seg: boundary protection and interpolation", () => {
  assert.equal(lerp(10, 20, 0), 10);
  assert.equal(lerp(10, 20, 0.5), 15);
  assert.equal(lerp(10, 20, 1), 20);

  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(15, 0, 10), 10);
  assert.equal(clamp(NaN, 0, 10), 0);

  assert.equal(seg(5, 0, 10), 0.5);
  assert.equal(seg(-2, 0, 10), 0);
  assert.equal(seg(12, 0, 10), 1);
  assert.equal(seg(5, 5, 5), 0); // divide by zero guard
  assert.equal(seg(NaN, 0, 10), 0);
});

test("cubicBezier & closeCurve: evaluates close curve smoothly", () => {
  assert.equal(closeCurve(0), 0);
  assert.equal(closeCurve(1), 1);
  assert.equal(closeCurve(-1), 0);
  assert.equal(closeCurve(2), 1);
  assert.equal(closeCurve(NaN), 0);

  const mid = closeCurve(0.5);
  assert.ok(mid > 0 && mid < 1);
});

test("Spring: integrates physics with sub-stepping and settles cleanly", () => {
  const s = new Spring(0, 0.5, 0.72);
  s.target = 100;

  // Integrate for ~1.6 seconds (100 frames at 1/60s)
  for (let i = 0; i < 100; i++) {
    s.step(1 / 60);
  }

  assert.ok(s.settled);
  assert.ok(Math.abs(s.value - 100) < 0.01);

  // Guards against lag spike (e.g. 5 seconds dt)
  s.target = 200;
  s.step(5.0);
  assert.ok(Number.isFinite(s.value));
  assert.ok(Number.isFinite(s.velocity));

  // Guards against negative or NaN dt
  const prevVal = s.value;
  s.step(-1);
  assert.equal(s.value, prevVal);
  s.step(NaN);
  assert.equal(s.value, prevVal);
});

test("Tracked: handles mode transitions between spring, curve, and idle", () => {
  const t = new Tracked(100);
  assert.equal(t.value, 100);
  assert.equal(t.animating, false);

  // Spring to 200
  t.springTo(200);
  assert.equal(t.animating, true);
  for (let i = 0; i < 100; i++) {
    t.step(1 / 60);
  }
  assert.equal(t.animating, false);
  assert.ok(Math.abs(t.value - 200) < 0.01);

  // Curve towards 50
  t.curveTowards(50, 300, 1000);
  assert.equal(t.animating, true);
  t.step(1 / 60, 1150); // half-way
  assert.ok(t.value < 200 && t.value > 50);
  t.step(1 / 60, 1300); // completed
  assert.equal(t.value, 50);
  assert.equal(t.animating, false);
});
