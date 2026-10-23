import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PREFS,
  load,
  save,
  prefs,
  setPrefs,
  sanitizeLivePrefs,
  today,
} from "../src/live/prefs.ts";

test("DEFAULT_PREFS: has expected default settings", () => {
  assert.equal(DEFAULT_PREFS.breakMinutes, 50);
  assert.equal(DEFAULT_PREFS.quietInMeetings, true);
  assert.equal(DEFAULT_PREFS.clipHistory, true);
  assert.equal(DEFAULT_PREFS.lyrics, true);
  assert.equal(DEFAULT_PREFS.aiModel, "");
});

test("sanitizeLivePrefs: clamps breakMinutes and validates fields", () => {
  // Safe bounds
  const p1 = sanitizeLivePrefs({ breakMinutes: 300, quietInMeetings: false });
  assert.equal(p1.breakMinutes, 240); // Clamped to 240 max
  assert.equal(p1.quietInMeetings, false);

  const p2 = sanitizeLivePrefs({ breakMinutes: -20 });
  assert.equal(p2.breakMinutes, 0); // Clamped to 0 min

  // Non-finite guards
  const p3 = sanitizeLivePrefs({ breakMinutes: NaN, aiModel: "  llama3:8b  " });
  assert.equal(p3.breakMinutes, 50);
  assert.equal(p3.aiModel, "llama3:8b");

  // Null/undefined
  const p4 = sanitizeLivePrefs(null);
  assert.deepEqual(p4, DEFAULT_PREFS);
});

test("load & save: persists data in memory/storage fallback safely", () => {
  save("test_key", { count: 42, active: true });
  const val = load("test_key", null);
  assert.deepEqual(val, { count: 42, active: true });

  // Missing key fallback
  const missing = load("non_existent_key", "default_val");
  assert.equal(missing, "default_val");
});

test("setPrefs & prefs: updates preferences state cleanly", () => {
  setPrefs({ breakMinutes: 45, lyrics: false });
  const current = prefs();
  assert.equal(current.breakMinutes, 45);
  assert.equal(current.lyrics, false);
});

test("today: formats calendar date in YYYY-MM-DD format", () => {
  const d = new Date(2026, 9, 23); // Month is 0-indexed, so 9 is October
  assert.equal(today(d), "2026-10-23");

  const singleDigit = new Date(2026, 0, 5); // January 5
  assert.equal(today(singleDigit), "2026-01-05");
});
