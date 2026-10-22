import test from "node:test";
import assert from "node:assert/strict";

import {
  calcProgressPct,
  calcEtaSeconds,
  formatEta,
  summarizeProgress,
} from "../src/live/progress-utils.ts";

test("calcProgressPct: calculates and clamps progress accurately", () => {
  // Normal cases
  assert.equal(calcProgressPct(50, 100), 50);
  assert.equal(calcProgressPct(1, 3), 33.3);
  assert.equal(calcProgressPct(100, 100), 100);

  // Done flag override
  assert.equal(calcProgressPct(0, 100, true), 100);

  // Indeterminate / zero total
  assert.equal(calcProgressPct(50, null), null);
  assert.equal(calcProgressPct(50, undefined), null);
  assert.equal(calcProgressPct(50, 0), null);
  assert.equal(calcProgressPct(50, -100), null);
  assert.equal(calcProgressPct(50, NaN), null);

  // Clamping
  assert.equal(calcProgressPct(-10, 100), 0);
  assert.equal(calcProgressPct(150, 100), 100);
});

test("calcEtaSeconds: calculates remaining transfer duration", () => {
  // 100 bytes left at 10 bytes/sec = 10s
  assert.equal(calcEtaSeconds(100, 200, 10), 10);
  // Completed or exceeded bytes
  assert.equal(calcEtaSeconds(200, 200, 10), 0);
  assert.equal(calcEtaSeconds(250, 200, 10), 0);

  // Zero/negative/invalid speed
  assert.equal(calcEtaSeconds(50, 100, 0), null);
  assert.equal(calcEtaSeconds(50, 100, -5), null);
  assert.equal(calcEtaSeconds(50, 100, NaN), null);

  // Indeterminate total
  assert.equal(calcEtaSeconds(50, null, 10), null);
});

test("formatEta: formats remaining time cleanly", () => {
  assert.equal(formatEta(0), "Done");
  assert.equal(formatEta(3), "< 5s left");
  assert.equal(formatEta(45), "45s left");
  assert.equal(formatEta(125), "2m 5s left");
  assert.equal(formatEta(600), "10m left");
  assert.equal(formatEta(3660), "1h 1m left");
  assert.equal(formatEta(7200), "2h left");
  assert.equal(formatEta(86400 * 2), "2d left");

  // Invalid / null
  assert.equal(formatEta(null), null);
  assert.equal(formatEta(-1), null);
  assert.equal(formatEta(NaN), null);
});

test("summarizeProgress: combines metrics safely", () => {
  const s = summarizeProgress(250, 1000, 50, false);
  assert.equal(s.pct, 25);
  assert.equal(s.etaSeconds, 15);
  assert.equal(s.etaFormatted, "15s left");

  const done = summarizeProgress(1000, 1000, 0, true);
  assert.equal(done.pct, 100);
  assert.equal(done.etaSeconds, 0);
  assert.equal(done.etaFormatted, "Done");
});
