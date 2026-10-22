import test from "node:test";
import assert from "node:assert/strict";

import { normalizeLatency, latencyQuality, formatLatency, sanitizeSsid } from "../src/live/net.ts";

test("normalizeLatency: normalizes numeric latency and handles invalid inputs", () => {
  assert.equal(normalizeLatency(24.3), 24);
  assert.equal(normalizeLatency(0), 0);
  assert.equal(normalizeLatency(15000), 10000);

  // Invalid / non-finite
  assert.equal(normalizeLatency(-10), null);
  assert.equal(normalizeLatency(NaN), null);
  assert.equal(normalizeLatency(Infinity), null);
  assert.equal(normalizeLatency(null), null);
  assert.equal(normalizeLatency(undefined), null);
});

test("latencyQuality: categorizes network response times accurately", () => {
  assert.equal(latencyQuality(15), "excellent");
  assert.equal(latencyQuality(50), "good");
  assert.equal(latencyQuality(120), "fair");
  assert.equal(latencyQuality(300), "poor");
  assert.equal(latencyQuality(null), "unreachable");
  assert.equal(latencyQuality(NaN), "unreachable");
});

test("formatLatency: formats human-readable latency string", () => {
  assert.equal(formatLatency(32), "32 ms");
  assert.equal(formatLatency(null), "—");
  assert.equal(formatLatency(NaN), "—");
});

test("sanitizeSsid: cleanses control characters and enforces length limits", () => {
  assert.equal(sanitizeSsid("Home-Network-5G"), "Home-Network-5G");
  assert.equal(sanitizeSsid("Office\0\x1bNetwork\x7f"), "OfficeNetwork");
  assert.equal(sanitizeSsid("   "), "Wi-Fi");
  assert.equal(sanitizeSsid(""), "Wi-Fi");

  const longSsid = "VeryLongNetworkNameExceedingThirtyTwoCharactersStandard";
  assert.equal(sanitizeSsid(longSsid).length, 32);
});
