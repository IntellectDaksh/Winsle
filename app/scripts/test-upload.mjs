import test from "node:test";
import assert from "node:assert/strict";

import {
  USC,
  uploadProgressCurve,
  progressAt,
  UploadSeq,
} from "../src/upload/sequence.ts";

test("USC: timeline and layout constants are valid and chronologically ordered", () => {
  assert.equal(USC.W, 640);
  assert.equal(USC.ISL_H, 176);
  assert.ok(USC.T_DROP < USC.T_SUCK_START);
  assert.ok(USC.T_SUCK_START < USC.T_SUCK_END);
  assert.ok(USC.T_SUCK_END < USC.T_CLOSE_END);
  assert.ok(USC.T_CLOSE_END < USC.T_CHEW1);
  assert.ok(USC.T_CHEW1 < USC.T_CHEW_END);
  assert.ok(USC.T_CHEW_END < USC.T_SHRINK_END);
  assert.ok(USC.T_BAR_IN < USC.T_PROG_START);
});

test("uploadProgressCurve: adheres to pacing curve boundaries", () => {
  assert.equal(uploadProgressCurve(0), 0);
  assert.equal(uploadProgressCurve(1), 1);

  // Quick rise to 60% around 0.4
  const p04 = uploadProgressCurve(0.4);
  assert.ok(Math.abs(p04 - 0.6) < 0.01);

  // Smooth middle around 0.85
  const p085 = uploadProgressCurve(0.85);
  assert.ok(Math.abs(p085 - 0.92) < 0.01);

  // Guards against out-of-bounds or NaN
  assert.equal(uploadProgressCurve(-0.5), 0);
  assert.equal(uploadProgressCurve(1.5), 1);
  assert.equal(uploadProgressCurve(NaN), 0);
});

test("progressAt: calculates progress along timeline", () => {
  const start = 3.0;
  const end = 5.0;

  assert.equal(progressAt(2.0, start, end), 0);
  assert.equal(progressAt(start, start, end), 0);
  assert.equal(progressAt(end, start, end), 1);
  assert.equal(progressAt(6.0, start, end), 1);

  // Midway is between 0 and 1
  const mid = progressAt(4.0, start, end);
  assert.ok(mid > 0 && mid < 1);
});

test("UploadSeq: lifecycle transitions from enterZone to drop and deactivate", () => {
  assert.equal(UploadSeq.isActive, false);
  const rest = UploadSeq.frame();
  assert.equal(rest.t, 0);
  assert.equal(rest.morph, 0);

  // Enter zone
  UploadSeq.enterZone(300, 100);
  assert.equal(UploadSeq.isActive, true);
  assert.equal(UploadSeq.dropped, false);

  const dragFrame = UploadSeq.frame();
  assert.ok(dragFrame.t > 0);
  assert.equal(dragFrame.cursorX, 300);

  // Perform drop
  UploadSeq.performDrop(2.0);
  assert.equal(UploadSeq.dropped, true);

  const dropFrame = UploadSeq.frame();
  assert.ok(dropFrame.t >= USC.T_DROP);

  // Deactivate
  UploadSeq.deactivate();
  assert.equal(UploadSeq.isActive, false);
});
