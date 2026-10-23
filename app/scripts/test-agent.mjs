import test from "node:test";
import assert from "node:assert/strict";

import {
  parseMinutes,
  parseClock,
  sanitizePrompt,
  sanitizeSnippet,
  sanitizeReminder,
  trimHistory,
  greeting,
} from "../src/live/agent-utils.ts";

test("parseMinutes: computes minutes from various time units safely", () => {
  assert.equal(parseMinutes("15", "minutes"), 15);
  assert.equal(parseMinutes("10", "mins"), 10);
  assert.equal(parseMinutes("1.5", "hours"), 90);
  assert.equal(parseMinutes("2", "h"), 120);
  assert.equal(parseMinutes("120", "seconds"), 2);
  assert.equal(parseMinutes("60", "s"), 1);

  // Invalid / non-positive numbers
  assert.equal(parseMinutes("NaN", "mins"), 0);
  assert.equal(parseMinutes("-10", "mins"), 0);
  assert.equal(parseMinutes("0", "mins"), 0);
  assert.equal(parseMinutes("abc", "hours"), 0);
});

test("parseClock: parses 12h and 24h clock strings accurately", () => {
  // Use a fixed reference time: 2026-10-23 10:00:00 local time
  const ref = new Date(2026, 9, 23, 10, 0, 0).getTime();

  // "5pm" -> today 17:00
  const fivePm = parseClock("5pm", ref);
  assert.ok(fivePm != null);
  const d1 = new Date(fivePm);
  assert.equal(d1.getHours(), 17);
  assert.equal(d1.getMinutes(), 0);
  assert.equal(d1.getDate(), 23);

  // "9:15 am" -> already passed today, so rolls over to tomorrow
  const nineAm = parseClock("9:15 am", ref);
  assert.ok(nineAm != null);
  const d2 = new Date(nineAm);
  assert.equal(d2.getHours(), 9);
  assert.equal(d2.getMinutes(), 15);
  assert.equal(d2.getDate(), 24);

  // 24-hour clock "14:30"
  const fourteenThirty = parseClock("14:30", ref);
  assert.ok(fourteenThirty != null);
  const d3 = new Date(fourteenThirty);
  assert.equal(d3.getHours(), 14);
  assert.equal(d3.getMinutes(), 30);

  // Invalid formats or out of range
  assert.equal(parseClock("25:00", ref), null);
  assert.equal(parseClock("12:65", ref), null);
  assert.equal(parseClock("random text", ref), null);
  assert.equal(parseClock("", ref), null);
});

test("sanitizePrompt: cleans prefixes, strips whitespace, and enforces length bounds", () => {
  assert.equal(sanitizePrompt("? remind me to buy milk"), "remind me to buy milk");
  assert.equal(sanitizePrompt("ask what is the weather"), "what is the weather");
  assert.equal(sanitizePrompt("  ask  pause music   "), "pause music");
  assert.equal(sanitizePrompt("normal prompt"), "normal prompt");

  // Bounds limit
  const longPrompt = "a".repeat(3000);
  assert.equal(sanitizePrompt(longPrompt, 50).length, 50);

  // Non-string inputs
  assert.equal(sanitizePrompt(null), "");
  assert.equal(sanitizePrompt(undefined), "");
});

test("sanitizeSnippet: validates snippet keys and content limits", () => {
  assert.deepEqual(sanitizeSnippet(";shrug", "¯\\_(ツ)_/¯"), {
    name: "shrug",
    text: "¯\\_(ツ)_/¯",
  });
  assert.deepEqual(sanitizeSnippet("email", "test@example.com"), {
    name: "email",
    text: "test@example.com",
  });

  // Empty name or text returns null
  assert.equal(sanitizeSnippet("", "content"), null);
  assert.equal(sanitizeSnippet(";", "content"), null);
  assert.equal(sanitizeSnippet("name", "   "), null);
  assert.equal(sanitizeSnippet(null, "content"), null);
});

test("sanitizeReminder: validates reminder timestamp and bounds text length", () => {
  const at = Date.now() + 60_000;
  const item = sanitizeReminder("Call dentist", at, 12345);
  assert.ok(item != null);
  assert.equal(item.text, "Call dentist");
  assert.equal(item.at, at);
  assert.equal(item.id, 12345);

  // Fallback text if empty
  const fallback = sanitizeReminder("", at);
  assert.ok(fallback != null);
  assert.equal(fallback.text, "Reminder");

  // Invalid timestamp
  assert.equal(sanitizeReminder("Task", NaN), null);
  assert.equal(sanitizeReminder("Task", -5), null);
});

test("trimHistory & greeting: bounds conversation log and returns time of day greeting", () => {
  const history = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.deepEqual(trimHistory(history, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(trimHistory([], 5), []);
  assert.deepEqual(trimHistory(null, 5), []);

  assert.equal(greeting(8), "Good morning");
  assert.equal(greeting(11), "Good morning");
  assert.equal(greeting(13), "Good afternoon");
  assert.equal(greeting(16), "Good afternoon");
  assert.equal(greeting(18), "Good evening");
  assert.equal(greeting(23), "Good evening");
});
