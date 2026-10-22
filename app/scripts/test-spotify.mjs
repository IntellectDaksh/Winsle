import test from "node:test";
import assert from "node:assert/strict";

import {
  parseSpotifyCommand,
  sanitizeTrackMetadata,
  formatTrackProgress,
  HEART,
  HEART_OUTLINE,
} from "../src/live/spotify-utils.ts";

test("HEART & HEART_OUTLINE: svg paths are non-empty", () => {
  assert.ok(HEART.startsWith("M12"));
  assert.ok(HEART_OUTLINE.startsWith("M16.5"));
});

test("parseSpotifyCommand: recognizes play, queue, and playlist intents", () => {
  assert.deepEqual(parseSpotifyCommand("play Bohemian Rhapsody"), {
    action: "play",
    target: "Bohemian Rhapsody",
  });

  assert.deepEqual(parseSpotifyCommand("queue Hotel California"), {
    action: "queue",
    target: "Hotel California",
  });

  assert.deepEqual(parseSpotifyCommand("playlist Coding Beats"), {
    action: "playlist",
    target: "Coding Beats",
  });

  assert.deepEqual(parseSpotifyCommand("playlists"), {
    action: "playlists",
  });

  // Generic non-spotify playback queries ignored
  assert.equal(parseSpotifyCommand("play music"), null);
  assert.equal(parseSpotifyCommand("play the music"), null);
  assert.equal(parseSpotifyCommand("play song"), null);
  assert.equal(parseSpotifyCommand("hello world"), null);
  assert.equal(parseSpotifyCommand(null), null);
});

test("sanitizeTrackMetadata: strips remaster suffixes and handles nulls", () => {
  const t1 = sanitizeTrackMetadata("In the End - Remastered 2020", "Linkin Park");
  assert.equal(t1.title, "In the End");
  assert.equal(t1.artist, "Linkin Park");
  assert.equal(t1.display, "In the End — Linkin Park");

  const t2 = sanitizeTrackMetadata(null, null);
  assert.equal(t2.title, "Unknown Track");
  assert.equal(t2.artist, "Unknown Artist");
});

test("formatTrackProgress: calculates percentage and formats MM:SS safely", () => {
  const p1 = formatTrackProgress(30, 120);
  assert.equal(p1.pct, 25);
  assert.equal(p1.position, "0:30");
  assert.equal(p1.duration, "2:00");

  const p2 = formatTrackProgress(65, 130);
  assert.equal(p2.pct, 50);
  assert.equal(p2.position, "1:05");
  assert.equal(p2.duration, "2:10");

  // Invalid / non-finite guards
  const p3 = formatTrackProgress(-10, NaN);
  assert.equal(p3.pct, 0);
  assert.equal(p3.position, "0:00");
  assert.equal(p3.duration, "0:00");
});
