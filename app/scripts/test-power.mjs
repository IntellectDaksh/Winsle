import test from "node:test";
import assert from "node:assert/strict";

import { normalizeBatteryPercent, normalizeBatterySeconds, formatBatteryStatus } from "../src/live/power.ts";

test("normalizeBatteryPercent: clamps and validates battery percentages", () => {
  assert.equal(normalizeBatteryPercent(85.4), 85);
  assert.equal(normalizeBatteryPercent(0), 0);
  assert.equal(normalizeBatteryPercent(100), 100);

  // Out of range or invalid
  assert.equal(normalizeBatteryPercent(-5), null);
  assert.equal(normalizeBatteryPercent(105), null);
  assert.equal(normalizeBatteryPercent(NaN), null);
  assert.equal(normalizeBatteryPercent(Infinity), null);
  assert.equal(normalizeBatteryPercent(null), null);
});

test("normalizeBatterySeconds: sanitizes remaining battery durations", () => {
  assert.equal(normalizeBatterySeconds(3600), 3600);
  assert.equal(normalizeBatterySeconds(0), null);
  assert.equal(normalizeBatterySeconds(-120), null);
  assert.equal(normalizeBatterySeconds(NaN), null);
});

test("formatBatteryStatus: formats battery states and warnings", () => {
  // Charging
  const charging = formatBatteryStatus(50, true, null);
  assert.equal(charging.label, "Battery 50%");
  assert.equal(charging.text, "charging");
  assert.equal(charging.color, "#34D399");
  assert.equal(charging.isLow, false);

  // Low battery warning
  const low = formatBatteryStatus(12, false, 1800);
  assert.equal(low.label, "Battery 12%");
  assert.equal(low.text, "30m left");
  assert.equal(low.color, "#F4505E");
  assert.equal(low.isLow, true);

  // Healthy battery with hours left
  const healthy = formatBatteryStatus(90, false, 7200);
  assert.equal(healthy.label, "Battery 90%");
  assert.equal(healthy.text, "2h 0m left");
  assert.equal(healthy.isLow, false);

  // Desktop / plugged in without battery
  const desktop = formatBatteryStatus(null, true, null);
  assert.equal(desktop.label, "AC Power");
  assert.equal(desktop.text, "plugged in");
});
