import test from "node:test";
import assert from "node:assert/strict";

import {
  cleanVoiceTranscription,
  matchVoiceIntent,
  isActionableVoiceCommand,
} from "../src/live/voice-utils.ts";

test("cleanVoiceTranscription: removes audio artifact tags and cleans quotes", () => {
  assert.equal(cleanVoiceTranscription("[BLANK_AUDIO]"), "");
  assert.equal(cleanVoiceTranscription("(music)"), "");
  assert.equal(cleanVoiceTranscription("Thank you for watching."), "");
  assert.equal(cleanVoiceTranscription("[laughter] hello there"), "Hello there");
  assert.equal(cleanVoiceTranscription("  “turn off lights”  "), "Turn off lights");
  assert.equal(cleanVoiceTranscription(null), "");
  assert.equal(cleanVoiceTranscription(""), "");
});

test("matchVoiceIntent: maps quick media playback commands", () => {
  assert.deepEqual(matchVoiceIntent("play music"), { type: "media_play" });
  assert.deepEqual(matchVoiceIntent("resume"), { type: "media_play" });
  assert.deepEqual(matchVoiceIntent("pause"), { type: "media_pause" });
  assert.deepEqual(matchVoiceIntent("stop music"), { type: "media_pause" });
  assert.deepEqual(matchVoiceIntent("next track"), { type: "media_next" });
  assert.deepEqual(matchVoiceIntent("skip"), { type: "media_next" });
});

test("matchVoiceIntent: maps volume controls and tasks", () => {
  assert.deepEqual(matchVoiceIntent("mute"), { type: "volume_mute" });
  assert.deepEqual(matchVoiceIntent("unmute"), { type: "volume_unmute" });
  assert.deepEqual(matchVoiceIntent("volume up"), { type: "volume_up" });
  assert.deepEqual(matchVoiceIntent("louder"), { type: "volume_up" });
  assert.deepEqual(matchVoiceIntent("volume down"), { type: "volume_down" });

  assert.deepEqual(matchVoiceIntent("remember to buy milk"), {
    type: "task",
    param: "buy milk",
  });
  assert.deepEqual(matchVoiceIntent("todo finish homework"), {
    type: "task",
    param: "finish homework",
  });

  // Fallback to agent query
  assert.deepEqual(matchVoiceIntent("what is the weather in Mumbai?"), {
    type: "query",
    param: "what is the weather in Mumbai?",
  });
});

test("isActionableVoiceCommand: checks if transcription is real speech", () => {
  assert.equal(isActionableVoiceCommand("hello"), true);
  assert.equal(isActionableVoiceCommand("[BLANK_AUDIO]"), false);
  assert.equal(isActionableVoiceCommand(""), false);
  assert.equal(isActionableVoiceCommand("   "), false);
  assert.equal(isActionableVoiceCommand("."), false);
});
