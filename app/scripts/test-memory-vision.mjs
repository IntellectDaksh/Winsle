import test from "node:test";
import assert from "node:assert/strict";

import {
  cleanVisionText,
  formatVisionSummary,
  filterClipboardHistory,
  formatMemoryExcerpt,
  rankMemoryHits,
} from "../src/live/memory-vision-utils.ts";

test("cleanVisionText: normalizes CRLF, trims whitespace per line, and collapses excess blanks", () => {
  const input = "  Line 1   \r\n\r\n\r\n   Line 2  \r\n\r\nLine 3    \r\n";
  const cleaned = cleanVisionText(input);
  assert.equal(cleaned, "Line 1\n\n   Line 2\n\nLine 3");
  assert.equal(cleanVisionText(""), "");
  assert.equal(cleanVisionText(null), "");
});

test("formatVisionSummary: reports characters, lines, and target window title", () => {
  const single = formatVisionSummary("Hello world", "Notepad");
  assert.equal(single, "11 characters across 1 line found in Notepad.");

  const multi = formatVisionSummary("Line A\nLine B\nLine C", "VS Code");
  assert.equal(multi, "20 characters across 3 lines found in VS Code.");

  const empty = formatVisionSummary("   \n\n  ", "Terminal");
  assert.equal(empty, "No readable text found in Terminal.");
});

test("filterClipboardHistory: performs case-insensitive search and honors limit", () => {
  const clips = [
    { text: "git checkout -b feature/vision", time: 1000 },
    { text: "cargo test --lib live::vision::tests", time: 2000 },
    { text: "npm run test:views", time: 3000 },
    { text: "VISION OCR pipeline verified", time: 4000 },
    { text: "random note", time: 5000 },
  ];

  const matched = filterClipboardHistory(clips, "vision", 2);
  assert.equal(matched.length, 2);
  assert.equal(matched[0].text, "git checkout -b feature/vision");
  assert.equal(matched[1].text, "cargo test --lib live::vision::tests");

  assert.deepEqual(filterClipboardHistory(clips, ""), []);
  assert.deepEqual(filterClipboardHistory(clips, "   "), []);
});

test("formatMemoryExcerpt: preserves short text and truncates on word boundaries", () => {
  const shortText = "Rust SQLite FTS5 indexer";
  assert.equal(formatMemoryExcerpt(shortText, 50), "Rust SQLite FTS5 indexer");

  const longText =
    "Winsle desktop private memory indexer parses local documents and captures using SQLite full text search with bm25 relevance scoring.";
  const excerpt = formatMemoryExcerpt(longText, 60);
  assert.ok(excerpt.length <= 61);
  assert.ok(excerpt.endsWith("…"));
  assert.equal(excerpt, "Winsle desktop private memory indexer parses local…");
});

test("rankMemoryHits: ranks bm25 scores in ascending order", () => {
  const hits = [
    { path: "doc3.md", title: "Doc 3", excerpt: "…", score: -2.4 },
    { path: "doc1.md", title: "Doc 1", excerpt: "…", score: -8.9 },
    { path: "doc2.md", title: "Doc 2", excerpt: "…", score: -5.1 },
  ];

  const ranked = rankMemoryHits(hits);
  assert.deepEqual(
    ranked.map((h) => h.path),
    ["doc1.md", "doc2.md", "doc3.md"]
  );
});
