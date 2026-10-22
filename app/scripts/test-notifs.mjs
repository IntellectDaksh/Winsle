import test from "node:test";
import assert from "node:assert/strict";

import {
  isNoise,
  sanitizeNotificationText,
  appColor,
} from "../src/live/notif-utils.ts";

test("isNoise: filters OEM bloat and telemetry notification popups", () => {
  // OEM bloat
  assert.equal(isNoise({ app: "Dell SupportAssist", title: "Scan", body: "Checking" }), true);
  assert.equal(isNoise({ app: "Lenovo Vantage", title: "Power", body: "Conserve" }), true);
  assert.equal(isNoise({ app: "Armoury Crate", title: "AURA", body: "Profile" }), true);
  assert.equal(isNoise({ app: "PowerToys", title: "Shortcut", body: "Guide" }), true);

  // Noisy content phrases
  assert.equal(isNoise({ app: "SomeApp", title: "Notice", body: "Administrator privileges required" }), true);
  assert.equal(isNoise({ app: "Updater", title: "New Version", body: "Update is available now" }), true);
  assert.equal(isNoise({ app: "Service", title: "Feedback", body: "Please take our survey" }), true);
  assert.equal(isNoise({ app: "Antivirus", title: "Security", body: "Scan complete. No threats found." }), true);

  // Real important notifications
  assert.equal(isNoise({ app: "Slack", title: "Daksh", body: "Hey, can you review this PR?" }), false);
  assert.equal(isNoise({ app: "Calendar", title: "Team Sync", body: "Starts in 10 minutes" }), false);
  assert.equal(isNoise({ app: "Discord", title: "Server", body: "Build completed successfully" }), false);

  // Edge cases
  assert.equal(isNoise(null), true);
  assert.equal(isNoise({}), true);
});

test("sanitizeNotificationText: strips control chars and bounds length", () => {
  assert.equal(sanitizeNotificationText("Hello \x00\x08World!"), "Hello World!");
  assert.equal(sanitizeNotificationText("   Clean text   "), "Clean text");
  assert.equal(sanitizeNotificationText("A".repeat(50), 20), "A".repeat(19) + "…");
  assert.equal(sanitizeNotificationText(null), "");
  assert.equal(sanitizeNotificationText(123), "");
});

test("appColor: produces stable brand accents and deterministic fallbacks", () => {
  assert.equal(appColor("Slack"), "#E01E5A");
  assert.equal(appColor("slack"), "#E01E5A");
  assert.equal(appColor("WhatsApp"), "#25D366");
  assert.equal(appColor("Spotify"), "#1DB954");
  assert.equal(appColor("VS Code"), "#3B9EFF");

  // Unknown apps return valid hex color
  const c1 = appColor("CustomAppOne");
  const c2 = appColor("CustomAppOne");
  assert.equal(c1, c2); // Deterministic
  assert.match(c1, /^#[0-9A-Fa-f]{6}$/);

  // Non-string fallback
  assert.match(appColor(null), /^#[0-9A-Fa-f]{6}$/);
});
