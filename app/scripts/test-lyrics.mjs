import test from "node:test";
import assert from "node:assert/strict";

import { parseLrc, findActiveLine } from "../src/live/lrc-parser.ts";

test("parseLrc: single timestamp per line", () => {
  const lrc = `
[00:05.50] Intro melody begins
[00:12.00] First verse lyrics
[01:05.25] Chorus kicks in
  `.trim();

  const lines = parseLrc(lrc);
  assert.equal(lines.length, 3);
  assert.equal(lines[0].at, 5.5);
  assert.equal(lines[0].text, "Intro melody begins");
  assert.equal(lines[1].at, 12);
  assert.equal(lines[1].text, "First verse lyrics");
  assert.equal(lines[2].at, 65.25);
  assert.equal(lines[2].text, "Chorus kicks in");
});

test("parseLrc: multiple timestamps on a single line", () => {
  const lrc = "[00:10.00][00:25.50] Repeating hook";
  const lines = parseLrc(lrc);

  assert.equal(lines.length, 2);
  assert.equal(lines[0].at, 10);
  assert.equal(lines[0].text, "Repeating hook");
  assert.equal(lines[1].at, 25.5);
  assert.equal(lines[1].text, "Repeating hook");
});

test("parseLrc: timestamps get sorted chronologically", () => {
  const lrc = `
[00:30.00] Line three
[00:10.00] Line one
[00:20.00] Line two
  `.trim();

  const lines = parseLrc(lrc);
  assert.deepEqual(
    lines.map((l) => l.text),
    ["Line one", "Line two", "Line three"]
  );
});

test("parseLrc: ignores headers and blank lines without crashing", () => {
  const lrc = `
[ti:Sample Song]
[ar:Sample Artist]
[al:Sample Album]

[00:04.00] Start of song
  `.trim();

  const lines = parseLrc(lrc);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].at, 4);
  assert.equal(lines[0].text, "Start of song");
});

test("findActiveLine: binary search lyric lookup by timestamp", () => {
  const lines = [
    { at: 5, text: "Verse 1" },
    { at: 15, text: "Verse 2" },
    { at: 30, text: "Chorus" },
  ];

  assert.equal(findActiveLine(lines, 2), null);
  assert.equal(findActiveLine(lines, 5.1), "Verse 1");
  assert.equal(findActiveLine(lines, 14.0), "Verse 1");
  // Demonstrates 250ms lookahead (at 14.85s, line flips to Verse 2 starting at 15s)
  assert.equal(findActiveLine(lines, 14.85), "Verse 2");
  assert.equal(findActiveLine(lines, 15.0), "Verse 2");
  assert.equal(findActiveLine(lines, 35.0), "Chorus");
});
