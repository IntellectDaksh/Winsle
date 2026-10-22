import test from "node:test";
import assert from "node:assert/strict";

import { isValidColor, sanitizeColor, parseHex, getLuminance, isLightBackground } from "../src/live/color.ts";

test("isValidColor: accepts valid CSS hex, rgb, and hsl colors", () => {
  assert.equal(isValidColor("#FFF"), true);
  assert.equal(isValidColor("#1E293B"), true);
  assert.equal(isValidColor("#1E293BAA"), true);
  assert.equal(isValidColor("rgb(255, 0, 128)"), true);
  assert.equal(isValidColor("rgba(0, 0, 0, 0.5)"), true);
  assert.equal(isValidColor("hsl(210, 50%, 50%)"), true);
});

test("isValidColor: rejects injection attacks and malformed strings", () => {
  assert.equal(isValidColor(""), false);
  assert.equal(isValidColor("red; background: black"), false);
  assert.equal(isValidColor("url('https://evil.com/leak')"), false);
  assert.equal(isValidColor("#12"), false);
  assert.equal(isValidColor("#GGGGGG"), false);
  assert.equal(isValidColor("<script>alert(1)</script>"), false);
});

test("sanitizeColor: falls back to safe default on invalid input", () => {
  assert.equal(sanitizeColor("#3B82F6"), "#3B82F6");
  assert.equal(sanitizeColor("malicious; color: red"), "#3B82F6");
  assert.equal(sanitizeColor("invalid", "#000000"), "#000000");
});

test("parseHex: converts hex to RGB triplets", () => {
  assert.deepEqual(parseHex("#FFF"), [255, 255, 255]);
  assert.deepEqual(parseHex("#000000"), [0, 0, 0]);
  assert.deepEqual(parseHex("#FF8000"), [255, 128, 0]);
  assert.equal(parseHex("not-hex"), null);
});

test("getLuminance & isLightBackground: calculates contrast accurately", () => {
  assert.equal(getLuminance(0, 0, 0), 0);
  assert.equal(getLuminance(255, 255, 255), 1);

  assert.equal(isLightBackground("#FFFFFF"), true);
  assert.equal(isLightBackground("#FFFF00"), true);
  assert.equal(isLightBackground("#000000"), false);
  assert.equal(isLightBackground("#0F172A"), false);
});
