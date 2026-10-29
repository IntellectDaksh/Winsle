import test from "node:test";
import assert from "node:assert/strict";

import {
  DEV_STATUS_MAP,
  getDevStatusDisplay,
  formatContextBar,
  calcDevStatsSummary,
} from "../src/live/view-utils.ts";

test("DEV_STATUS_MAP & getDevStatusDisplay: handles valid, empty, and unknown statuses", () => {
  assert.deepEqual(getDevStatusDisplay("thinking"), { text: "Thinking", cls: "think" });
  assert.deepEqual(getDevStatusDisplay("working"), { text: "Working", cls: "work" });
  assert.deepEqual(getDevStatusDisplay("waiting"), { text: "Needs you", cls: "wait" });
  assert.deepEqual(getDevStatusDisplay("done"), { text: "Done", cls: "done" });
  assert.deepEqual(getDevStatusDisplay("error"), { text: "Error", cls: "err" });
  assert.deepEqual(getDevStatusDisplay("idle"), { text: "Idle", cls: "idle" });

  // Fallback on missing or unknown keys
  assert.deepEqual(getDevStatusDisplay(undefined), { text: "Idle", cls: "idle" });
  assert.deepEqual(getDevStatusDisplay(""), { text: "Idle", cls: "idle" });
  assert.deepEqual(getDevStatusDisplay("nonexistent"), { text: "Idle", cls: "idle" });
});

test("formatContextBar: formats context percentage with bounds clamping and threshold classes", () => {
  // Empty or invalid input
  assert.deepEqual(formatContextBar(null), { text: "", widthPercent: 0, cls: "" });
  assert.deepEqual(formatContextBar(undefined), { text: "", widthPercent: 0, cls: "" });
  assert.deepEqual(formatContextBar(0), { text: "", widthPercent: 0, cls: "" });
  assert.deepEqual(formatContextBar(-10), { text: "", widthPercent: 0, cls: "" });
  assert.deepEqual(formatContextBar(NaN), { text: "", widthPercent: 0, cls: "" });

  // Normal range (< 70%)
  assert.deepEqual(formatContextBar(15.4), { text: "15%", widthPercent: 15, cls: "" });
  assert.deepEqual(formatContextBar(69.2), { text: "69%", widthPercent: 69, cls: "" });

  // Warning threshold (>= 70% and < 85%)
  assert.deepEqual(formatContextBar(70), { text: "70%", widthPercent: 70, cls: "warn" });
  assert.deepEqual(formatContextBar(84.9), { text: "85%", widthPercent: 85, cls: "danger" });
  assert.deepEqual(formatContextBar(75), { text: "75%", widthPercent: 75, cls: "warn" });

  // Danger threshold (>= 85%)
  assert.deepEqual(formatContextBar(85), { text: "85%", widthPercent: 85, cls: "danger" });
  assert.deepEqual(formatContextBar(99.4), { text: "99%", widthPercent: 99, cls: "danger" });

  // Overflow clamping
  assert.deepEqual(formatContextBar(125), { text: "100%", widthPercent: 100, cls: "danger" });
});

test("calcDevStatsSummary: handles null/empty stats and suppresses zero values", () => {
  assert.deepEqual(calcDevStatsSummary(null), {
    steps: null,
    files: null,
    commands: null,
    errors: null,
    subagents: null,
  });

  assert.deepEqual(calcDevStatsSummary({}), {
    steps: null,
    files: null,
    commands: null,
    errors: null,
    subagents: null,
  });

  assert.deepEqual(
    calcDevStatsSummary({
      steps: 0,
      files: 0,
      commands: 0,
      errors: 0,
      subagents: 0,
    }),
    {
      steps: null,
      files: null,
      commands: null,
      errors: null,
      subagents: null,
    }
  );
});

test("calcDevStatsSummary: formats singular and plural counters accurately", () => {
  // Singular counts
  const singular = calcDevStatsSummary({
    steps: 1,
    files: 1,
    commands: 1,
    errors: 1,
    subagents: 1,
  });
  assert.equal(singular.steps, "1 step");
  assert.equal(singular.files, "1 file");
  assert.equal(singular.commands, "1 cmd");
  assert.equal(singular.errors, "1 failed");
  assert.equal(singular.subagents, "1 subagent");

  // Plural counts
  const plural = calcDevStatsSummary({
    steps: 12,
    files: 4,
    commands: 8,
    errors: 2,
    subagents: 3,
  });
  assert.equal(plural.steps, "12 steps");
  assert.equal(plural.files, "4 files");
  assert.equal(plural.commands, "8 cmds");
  assert.equal(plural.errors, "2 failed");
  assert.equal(plural.subagents, "3 subagents");
});
