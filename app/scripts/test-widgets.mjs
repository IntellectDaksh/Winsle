import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_HOME_WIDGETS,
  resolveHomeWidgets,
  clampMeterPercent,
  meterColorToken,
  clampProgressPercent,
  safeCssArtUrl,
} from "../src/live/widgets-utils.ts";

test("resolveHomeWidgets: deduplicates, strips unknown kinds, and caps at 3 tiles", () => {
  assert.deepEqual(resolveHomeWidgets(undefined), DEFAULT_HOME_WIDGETS);
  assert.deepEqual(
    resolveHomeWidgets(["timer", "invalid", "timer", "system", "files", "notifs"]),
    ["timer", "system", "files"]
  );
  // Prototype property names must not be accepted as widget kinds
  assert.deepEqual(resolveHomeWidgets(["toString", "constructor", "media"]), ["media"]);
});

test("clampMeterPercent and meterColorToken: clamp bounds and map severity thresholds", () => {
  assert.equal(clampMeterPercent(-5), 2);
  assert.equal(clampMeterPercent(0), 2);
  assert.equal(clampMeterPercent(42), 42);
  assert.equal(clampMeterPercent(150), 100);
  assert.equal(clampMeterPercent(Number.NaN), 2);

  assert.equal(meterColorToken(40), "var(--green-2)");
  assert.equal(meterColorToken(70), "var(--amber)");
  assert.equal(meterColorToken(90), "var(--red)");
  assert.equal(meterColorToken(Number.NaN), "var(--green-2)");
});

test("clampProgressPercent: bounds download percentage and rejects invalid totals", () => {
  assert.equal(clampProgressPercent(50, 200), 25);
  assert.equal(clampProgressPercent(300, 200), 100);
  assert.equal(clampProgressPercent(-10, 200), 0);
  assert.equal(clampProgressPercent(50, 0), 0);
  assert.equal(clampProgressPercent(Number.NaN, 100), 0);
});

test("safeCssArtUrl: allows image data/http(s) URLs and blocks CSS injection", () => {
  assert.equal(
    safeCssArtUrl("https://cdn.example.com/art.jpg"),
    'url("https://cdn.example.com/art.jpg")'
  );
  assert.equal(
    safeCssArtUrl("data:image/png;base64,iVBORw0KGgo="),
    'url("data:image/png;base64,iVBORw0KGgo=")'
  );
  assert.equal(safeCssArtUrl('https://evil.test/a.jpg"); background:red;'), "");
  assert.equal(safeCssArtUrl("javascript:alert(1)"), "");
  assert.equal(safeCssArtUrl("file:///C:/secret.png"), "");
  assert.equal(safeCssArtUrl(null), "");
});
