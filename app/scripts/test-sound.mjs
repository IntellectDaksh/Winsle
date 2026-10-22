import test from "node:test";
import assert from "node:assert/strict";

import {
  SOUND_NAMES,
  isValidSoundName,
  clampSoundVolume,
  DEFAULT_SOUND_VOLUME,
  MAX_SOUND_VOLUME,
  MIN_SOUND_VOLUME,
} from "../src/core/sound-utils.ts";

test("SOUND_NAMES: contains 28 macOS sound assets", () => {
  assert.equal(SOUND_NAMES.length, 28);
  assert.ok(SOUND_NAMES.includes("peek"));
  assert.ok(SOUND_NAMES.includes("blip"));
  assert.ok(SOUND_NAMES.includes("approval"));
  assert.ok(SOUND_NAMES.includes("sleep"));
});

test("isValidSoundName: checks sound name membership safely", () => {
  assert.equal(isValidSoundName("peek"), true);
  assert.equal(isValidSoundName("greet"), true);
  assert.equal(isValidSoundName("unknown_sfx"), false);
  assert.equal(isValidSoundName(null), false);
  assert.equal(isValidSoundName(undefined), false);
  assert.equal(isValidSoundName(123), false);
});

test("clampSoundVolume: handles standard and edge case volumes", () => {
  assert.equal(clampSoundVolume(0.12), 0.12);
  assert.equal(clampSoundVolume(0.0), 0.0);
  assert.equal(clampSoundVolume(0.2), 0.2);

  // Clamping
  assert.equal(clampSoundVolume(0.5), MAX_SOUND_VOLUME);
  assert.equal(clampSoundVolume(-0.1), MIN_SOUND_VOLUME);

  // Non-finite guards against NaN corruption
  assert.equal(clampSoundVolume(NaN), DEFAULT_SOUND_VOLUME);
  assert.equal(clampSoundVolume(Infinity), DEFAULT_SOUND_VOLUME);
  assert.equal(clampSoundVolume(-Infinity), DEFAULT_SOUND_VOLUME);
  assert.equal(clampSoundVolume("loud"), DEFAULT_SOUND_VOLUME);
  assert.equal(clampSoundVolume(null), DEFAULT_SOUND_VOLUME);
});
