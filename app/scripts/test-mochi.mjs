import test from "node:test";
import assert from "node:assert/strict";

import {
  BOT_STATES,
  STATE_SOUND,
  EMOTE_EYE,
  hexToRGB,
  rgba,
  mix3,
  getEmoteEye,
} from "../src/mochi/mochi-utils.ts";

test("hexToRGB: parses hexadecimal color codes to normalized float RGB components", () => {
  const white = hexToRGB("#FFFFFF");
  assert.equal(white[0], 1);
  assert.equal(white[1], 1);
  assert.equal(white[2], 1);

  const black = hexToRGB("#000000");
  assert.equal(black[0], 0);
  assert.equal(black[1], 0);
  assert.equal(black[2], 0);

  const red = hexToRGB("FF0000");
  assert.equal(red[0], 1);
  assert.equal(red[1], 0);
  assert.equal(red[2], 0);

  // Fallback for invalid hex strings
  const invalid = hexToRGB("XYZ");
  assert.deepEqual(invalid, [0, 0, 0]);
});

test("rgba: formats normalized RGB and clamped alpha into CSS rgba strings", () => {
  assert.equal(rgba([1, 0, 0], 1), "rgba(255,0,0,1)");
  assert.equal(rgba([0, 1, 0], 0.5), "rgba(0,255,0,0.5)");
  assert.equal(rgba([0, 0, 1], -0.2), "rgba(0,0,255,0)");
  assert.equal(rgba([1, 1, 1], 1.5), "rgba(255,255,255,1)");
});

test("mix3: interpolates between RGB colors with strict parameter clamping", () => {
  const black = [0, 0, 0];
  const white = [1, 1, 1];

  const mid = mix3(black, white, 0.5);
  assert.equal(mid[0], 0.5);
  assert.equal(mid[1], 0.5);
  assert.equal(mid[2], 0.5);

  const start = mix3(black, white, -1);
  assert.deepEqual(start, [0, 0, 0]);

  const end = mix3(black, white, 2);
  assert.deepEqual(end, [1, 1, 1]);
});

test("getEmoteEye: maps bot emotes to designated canvas eye shapes", () => {
  assert.equal(getEmoteEye("love"), "heart");
  assert.equal(getEmoteEye("proud"), "star");
  assert.equal(getEmoteEye("wink"), "wink");
  assert.equal(getEmoteEye("happy"), "happy");
  assert.equal(getEmoteEye("annoyed"), "line");
  assert.equal(getEmoteEye("nonexistent"), "pill");
});

test("BOT_STATES: defines standard animation traits for all bot states", () => {
  const states = [
    "idle", "working", "thinking", "searching", "approval",
    "question", "error", "finished", "ratelimit", "sleeping", "dizzy",
  ];

  for (const s of states) {
    assert.ok(BOT_STATES[s], `Missing bot state definition: ${s}`);
    assert.equal(BOT_STATES[s].color.length, 3);
  }

  assert.equal(BOT_STATES.idle.eye, "pill");
  assert.equal(BOT_STATES.sleeping.eye, "closed");
  assert.equal(BOT_STATES.approval.bounces, true);
  assert.equal(BOT_STATES.searching.scans, true);
  assert.equal(STATE_SOUND.working, "work");
  assert.equal(STATE_SOUND.finished, "finish");
});
