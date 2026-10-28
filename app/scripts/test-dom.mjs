import test from "node:test";
import assert from "node:assert/strict";

import {
  isDangerousUri,
  sanitizeAttributeValue,
  sanitizeDimension,
  parseViewBox,
} from "../src/views/dom-utils.ts";

test("isDangerousUri: flags dangerous and executable URI schemes", () => {
  assert.equal(isDangerousUri("javascript:alert(1)"), true);
  assert.equal(isDangerousUri("  JAVASCRIPT:void(0)  "), true);
  assert.equal(isDangerousUri("java\x00script:alert(1)"), true);
  assert.equal(isDangerousUri("vbscript:MsgBox(1)"), true);
  assert.equal(isDangerousUri("data:text/html,<script>alert(1)</script>"), true);

  assert.equal(isDangerousUri("https://claude.ai"), false);
  assert.equal(isDangerousUri("http://localhost:5173"), false);
  assert.equal(isDangerousUri("/dashboard/projects"), false);
  assert.equal(isDangerousUri("mailto:support@winsle.app"), false);
});

test("sanitizeAttributeValue: neutralizes dangerous URLs on sensitive attributes", () => {
  assert.equal(sanitizeAttributeValue("href", "javascript:alert(document.cookie)"), null);
  assert.equal(sanitizeAttributeValue("src", "javascript:void(0)"), null);
  assert.equal(sanitizeAttributeValue("action", "vbscript:bad()"), null);
  assert.equal(sanitizeAttributeValue("formaction", "javascript:run()"), null);

  assert.equal(sanitizeAttributeValue("href", "https://github.com"), "https://github.com");
  assert.equal(sanitizeAttributeValue("src", "icon.svg"), "icon.svg");
  assert.equal(sanitizeAttributeValue("title", "javascript:alert(1)"), "javascript:alert(1)");
});

test("sanitizeDimension: validates and clamps numeric element dimensions", () => {
  assert.equal(sanitizeDimension(24), 24);
  assert.equal(sanitizeDimension("32"), 32);
  assert.equal(sanitizeDimension(0), 0);

  // Fallback defaults on invalid input
  assert.equal(sanitizeDimension(-10, 14), 14);
  assert.equal(sanitizeDimension(NaN, 14), 14);
  assert.equal(sanitizeDimension(Infinity, 14), 14);
  assert.equal(sanitizeDimension("abc", 7), 7);
});

test("parseViewBox: parses standard and comma-separated SVG coordinate boxes", () => {
  const standard = parseViewBox("0 0 24 24");
  assert.deepEqual(standard, { x: 0, y: 0, width: 24, height: 24 });

  const commaSeparated = parseViewBox("0, 0, 100, 200");
  assert.deepEqual(commaSeparated, { x: 0, y: 0, width: 100, height: 200 });

  // Invalid or incomplete viewBox
  assert.equal(parseViewBox(""), null);
  assert.equal(parseViewBox("0 0 24"), null);
  assert.equal(parseViewBox("0 0 -24 24"), null);
  assert.equal(parseViewBox("a b c d"), null);
});
