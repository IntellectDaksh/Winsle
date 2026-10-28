import test from "node:test";
import assert from "node:assert/strict";

import {
  ROTATE_MS,
  IDLE_DIM_MS,
  NOTIF_FRESH_MS,
  EVENT_SOON_MS,
  TIPS,
  getClaudeStatusText,
  calcClaudeDurationMinutes,
  isNotificationFresh,
  isEventComingSoon,
  getBatteryStatus,
  calcNextRotation,
  getTipForTimestamp,
} from "../src/live/idle-utils.ts";

test("constants: verifies idle threshold timings", () => {
  assert.equal(ROTATE_MS, 6000);
  assert.equal(IDLE_DIM_MS, 7000);
  assert.equal(NOTIF_FRESH_MS, 1800000);
  assert.equal(EVENT_SOON_MS, 10800000);
  assert.ok(TIPS.length >= 6);
});

test("getClaudeStatusText: maps integration task states to concise labels", () => {
  assert.equal(getClaudeStatusText("finished"), "done");
  assert.equal(getClaudeStatusText("approval"), "needs you");
  assert.equal(getClaudeStatusText("error"), "stopped");
  assert.equal(getClaudeStatusText("idle"), "last");
  assert.equal(getClaudeStatusText("working"), "working");
  assert.equal(getClaudeStatusText("active"), "working");
});

test("calcClaudeDurationMinutes: calculates active session runtime in minutes", () => {
  const now = 500_000;
  assert.equal(calcClaudeDurationMinutes(380_000, "working", now), 2);
  assert.equal(calcClaudeDurationMinutes(480_000, "working", now), 0);
  assert.equal(calcClaudeDurationMinutes(380_000, "idle", now), 0);
  assert.equal(calcClaudeDurationMinutes(null, "working", now), 0);
  assert.equal(calcClaudeDurationMinutes(NaN, "working", now), 0);
});

test("isNotificationFresh: validates freshness boundary against stale alerts", () => {
  const now = 1_000_000;
  assert.equal(isNotificationFresh(now - 100_000, now), true);
  assert.equal(isNotificationFresh(now - (NOTIF_FRESH_MS + 1000), now), false);
  assert.equal(isNotificationFresh(now + 5000, now), false); // future timestamp
  assert.equal(isNotificationFresh(NaN, now), false);
});

test("isEventComingSoon: checks calendar event scheduling window", () => {
  const now = 2_000_000;
  // Event starts in 1 hr, ends in 2 hrs
  assert.equal(isEventComingSoon(now + 3600_000, now + 7200_000, now), true);
  // Ongoing event
  assert.equal(isEventComingSoon(now - 1800_000, now + 1800_000, now), true);
  // Event starts in 5 hrs (outside 3 hr window)
  assert.equal(isEventComingSoon(now + 5 * 3600_000, now + 6 * 3600_000, now), false);
  // Event in the past
  assert.equal(isEventComingSoon(now - 7200_000, now - 3600_000, now), false);
});

test("getBatteryStatus: alerts only on low discharging battery levels", () => {
  // Low battery (25%, discharging)
  const warn = getBatteryStatus(25, false);
  assert.ok(warn);
  assert.equal(warn.color, "#F5A524");
  assert.equal(warn.label, "Battery 25%");

  // Critical battery (10%, discharging)
  const crit = getBatteryStatus(10, false);
  assert.ok(crit);
  assert.equal(crit.color, "#F4505E");

  // Adequate battery (75%, discharging)
  assert.equal(getBatteryStatus(75, false), null);

  // Low battery but charging
  assert.equal(getBatteryStatus(15, true), null);

  // Non-finite values
  assert.equal(getBatteryStatus(null, false), null);
  assert.equal(getBatteryStatus(NaN, false), null);
});

test("calcNextRotation: advances gist index only after interval expires", () => {
  const start = 1000;
  const noAdvance = calcNextRotation(2, start, start + 3000, ROTATE_MS);
  assert.equal(noAdvance.rotated, false);
  assert.equal(noAdvance.index, 2);
  assert.equal(noAdvance.newLastRotate, start);

  const advanced = calcNextRotation(2, start, start + 6500, ROTATE_MS);
  assert.equal(advanced.rotated, true);
  assert.equal(advanced.index, 3);
  assert.equal(advanced.newLastRotate, start + 6500);
});

test("getTipForTimestamp: returns deterministic shortcut tips", () => {
  const tip1 = getTipForTimestamp(0);
  assert.ok(Array.isArray(tip1));
  assert.equal(tip1.length, 2);
  assert.equal(tip1[0], TIPS[0][0]);

  const tip2 = getTipForTimestamp(600_000);
  assert.equal(tip2[0], TIPS[1 % TIPS.length][0]);
});
