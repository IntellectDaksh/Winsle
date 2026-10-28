import test from "node:test";
import assert from "node:assert/strict";

import {
  appendTaskStep,
  toggleIntegrationId,
  sanitizeSettings,
  DEFAULT_SETTINGS,
} from "../src/core/state-utils.ts";

test("appendTaskStep: appends steps, updates stepIndex, and bounds maxSteps", () => {
  const s1 = appendTaskStep([], "First step", 3);
  assert.deepEqual(s1.steps, ["First step"]);
  assert.equal(s1.stepIndex, 0);

  const s2 = appendTaskStep(s1.steps, "Second step", 3);
  assert.deepEqual(s2.steps, ["First step", "Second step"]);
  assert.equal(s2.stepIndex, 1);

  const s3 = appendTaskStep(s2.steps, "Third step", 3);
  assert.deepEqual(s3.steps, ["First step", "Second step", "Third step"]);
  assert.equal(s3.stepIndex, 2);

  // Overflowing maxSteps: shifts the oldest step
  const s4 = appendTaskStep(s3.steps, "Fourth step", 3);
  assert.deepEqual(s4.steps, ["Second step", "Third step", "Fourth step"]);
  assert.equal(s4.stepIndex, 2);

  // Empty or whitespace step should not be added
  const empty = appendTaskStep(s4.steps, "   ", 3);
  assert.deepEqual(empty.steps, s4.steps);
});

test("toggleIntegrationId: manages integration list, enforces limit and preserves Claude", () => {
  const initial = ["integration_resend", "integration_n8n"];

  // Toggle existing: removes it
  const r1 = toggleIntegrationId(initial, "integration_resend", 4);
  assert.equal(r1.changed, true);
  assert.deepEqual(r1.active, ["integration_n8n"]);

  // Toggle new: adds it
  const r2 = toggleIntegrationId(r1.active, "integration_github", 4);
  assert.equal(r2.changed, true);
  assert.deepEqual(r2.active, ["integration_n8n", "integration_github"]);

  // Attempting to toggle claude: disallowed
  const rClaude = toggleIntegrationId(r2.active, "integration_claude", 4);
  assert.equal(rClaude.changed, false);
  assert.deepEqual(rClaude.active, r2.active);

  // Exceeding maximum active limit (4)
  const full = ["integration_resend", "integration_n8n", "integration_vercel", "integration_github"];
  const rOverflow = toggleIntegrationId(full, "integration_notion", 4);
  assert.equal(rOverflow.changed, false);
  assert.deepEqual(rOverflow.active, full);
});

test("sanitizeSettings: clamps volume, intervals, and bounds arrays", () => {
  // Empty / null fallback
  const d = sanitizeSettings(null);
  assert.equal(d.soundVolume, DEFAULT_SETTINGS.soundVolume);
  assert.equal(d.autoCloseInterval, DEFAULT_SETTINGS.autoCloseInterval);

  // Out of range clamping
  const clamped = sanitizeSettings({
    soundVolume: 1.5,
    autoCloseInterval: -5,
    absenceInterval: 99999,
    activeIntegrations: ["1", "2", "3", "4", "5", "6"],
    homeWidgets: ["a", "b", "c", "d", "e"],
  });

  assert.equal(clamped.soundVolume, 1.0);
  assert.equal(clamped.autoCloseInterval, 1);
  assert.equal(clamped.absenceInterval, 3600);
  assert.equal(clamped.activeIntegrations.length, 4);
  assert.equal(clamped.homeWidgets.length, 3);
});
