import test from "node:test";
import assert from "node:assert/strict";

import {
  LAYOUT_DEFAULTS,
  calcChatPromptHeight,
  calcCornerRadius,
  clampWindowPosition,
  clampUploadProgress,
} from "../src/core/layout-utils.ts";

test("LAYOUT_DEFAULTS: verifies default island dimensions and corner radii", () => {
  assert.equal(LAYOUT_DEFAULTS.PANEL_W, 720);
  assert.equal(LAYOUT_DEFAULTS.PANEL_H, 320);
  assert.equal(LAYOUT_DEFAULTS.NOTCH_W, 184);
  assert.equal(LAYOUT_DEFAULTS.NOTCH_H, 38);
  assert.equal(LAYOUT_DEFAULTS.COMPACT_W, 288);
  assert.equal(LAYOUT_DEFAULTS.COMPACT_LIVE_W, 420);
  assert.equal(LAYOUT_DEFAULTS.COMPACT_LIVE_MAX_W, 480);
  assert.equal(LAYOUT_DEFAULTS.EXPANDED_W, 640);
  assert.equal(LAYOUT_DEFAULTS.ROUNDED_CORNER, 14);
  assert.equal(LAYOUT_DEFAULTS.EXPANDED_CORNER, 22);
  assert.equal(LAYOUT_DEFAULTS.WAKE_STRIP_W, 240);
  assert.equal(LAYOUT_DEFAULTS.WAKE_STRIP_H, 6);
});

test("calcChatPromptHeight: calculates dynamic prompt expansion bounded in [240, 300]", () => {
  assert.equal(calcChatPromptHeight(0), 240);
  assert.equal(calcChatPromptHeight(1), 280);
  assert.equal(calcChatPromptHeight(2), 300);
  assert.equal(calcChatPromptHeight(10), 300);

  // Boundary checks: negative or non-finite counts
  assert.equal(calcChatPromptHeight(-3), 240);
  assert.equal(calcChatPromptHeight(NaN), 240);
  assert.equal(calcChatPromptHeight(Infinity), 240);
});

test("calcCornerRadius: maps mode to appropriate corner smoothing radius", () => {
  assert.equal(calcCornerRadius("hidden"), 14);
  assert.equal(calcCornerRadius("compact"), 14);
  assert.equal(calcCornerRadius("expanded"), 22);
});

test("clampWindowPosition: computes horizontal screen centering and clamps bounds", () => {
  // Standard 1080p display (1920x1080)
  const pos1080 = clampWindowPosition(1920);
  assert.equal(pos1080.x, 600); // (1920 - 720) / 2
  assert.equal(pos1080.y, 0);

  // 1440p display with top inset
  const pos1440 = clampWindowPosition(2560, 720, 16);
  assert.equal(pos1440.x, 920); // (2560 - 720) / 2
  assert.equal(pos1440.y, 16);

  // Screen narrower than panel (edge case)
  const posNarrow = clampWindowPosition(600);
  assert.equal(posNarrow.x, 0);

  // Non-finite monitor dimensions
  const posFallback = clampWindowPosition(NaN);
  assert.equal(posFallback.x, 0);
  assert.equal(posFallback.y, 0);
});

test("clampUploadProgress: enforces strict [0, 1] range protection", () => {
  assert.equal(clampUploadProgress(0), 0);
  assert.equal(clampUploadProgress(0.75), 0.75);
  assert.equal(clampUploadProgress(1), 1);

  // Out of range
  assert.equal(clampUploadProgress(-0.5), 0);
  assert.equal(clampUploadProgress(1.8), 1);
  assert.equal(clampUploadProgress(NaN), 0);
  assert.equal(clampUploadProgress(null), 0);
  assert.equal(clampUploadProgress("invalid"), 0);
});
