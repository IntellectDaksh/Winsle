import test from "node:test";
import assert from "node:assert/strict";

import {
  cleanBlockItem,
  parseList,
  isRecapDue,
  suggest,
} from "../src/live/coach-utils.ts";

test("cleanBlockItem: trims whitespace, quotes, and strips path prefixes", () => {
  assert.equal(cleanBlockItem("  Discord  "), "Discord");
  assert.equal(cleanBlockItem('"discord.exe"'), "discord.exe");
  assert.equal(cleanBlockItem("C:\\Users\\User\\AppData\\Local\\Discord\\app.exe"), "app.exe");
  assert.equal(cleanBlockItem("/usr/bin/slack"), "slack");
  assert.equal(cleanBlockItem(null), "");
});

test("parseList: splits on commas/newlines and dedupes case-insensitively", () => {
  const input = "Discord, spotify.exe\nDISCORD\nYouTube, steam";
  const parsed = parseList(input);
  assert.deepEqual(parsed, ["Discord", "spotify.exe", "YouTube", "steam"]);

  // Edge cases
  assert.deepEqual(parseList(""), []);
  assert.deepEqual(parseList(null), []);
});

test("isRecapDue: evaluates whether recap should trigger", () => {
  // Target is 21:00
  const dEarly = new Date(2026, 9, 23, 20, 45); // 20:45
  assert.equal(isRecapDue("21:00", "2026-10-22", "2026-10-23", dEarly), false);

  const dOnTime = new Date(2026, 9, 23, 21, 0); // 21:00
  assert.equal(isRecapDue("21:00", "2026-10-22", "2026-10-23", dOnTime), true);

  const dLate = new Date(2026, 9, 23, 22, 15); // 22:15
  assert.equal(isRecapDue("21:00", "2026-10-22", "2026-10-23", dLate), true);

  // Already run today
  assert.equal(isRecapDue("21:00", "2026-10-23", "2026-10-23", dLate), false);

  // Invalid recap format
  assert.equal(isRecapDue("invalid", "", "2026-10-23", dLate), false);
  assert.equal(isRecapDue("25:99", "", "2026-10-23", dLate), false);
});

test("suggest: generates actionable tips based on weekly performance", () => {
  // Low focus minutes
  const tipsLow = suggest({
    focusMin: 60,
    focusMinLast: 180,
    streak: 0,
    topApps: [],
    distractSecs: 0,
    distractSecsLast: 0,
    topDistraction: null,
    screenSecs: 3600,
  });
  assert.ok(tipsLow.some((t) => t.includes("Only 60 focus minutes")));

  // Solid streak
  const tipsSolid = suggest({
    focusMin: 300,
    focusMinLast: 300,
    streak: 5,
    topApps: [],
    distractSecs: 0,
    distractSecsLast: 0,
    topDistraction: null,
    screenSecs: 10000,
  });
  assert.ok(tipsSolid.some((t) => t.includes("5-day focus streak")));
});
