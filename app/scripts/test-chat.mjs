import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_CHAT_PROMPT_LENGTH,
  MAX_CHAT_HISTORY_ENTRIES,
  sanitizeChatPrompt,
  boundChatHistory,
  getPlaceholderText,
  calcChatChipLabel,
  shouldAttachFileContext,
} from "../src/views/chat-utils.ts";

test("constants: verifies chat prompt and history bounds", () => {
  assert.equal(MAX_CHAT_PROMPT_LENGTH, 2000);
  assert.equal(MAX_CHAT_HISTORY_ENTRIES, 50);
});

test("sanitizeChatPrompt: strips control characters and trims length safely", () => {
  assert.equal(sanitizeChatPrompt("  Hello, world!  "), "Hello, world!");
  assert.equal(sanitizeChatPrompt("Hello\x00World\x1b[31m!"), "HelloWorld!");
  assert.equal(sanitizeChatPrompt(""), "");

  // Oversized prompt clamping
  const longPrompt = "a".repeat(2500);
  const sanitized = sanitizeChatPrompt(longPrompt, 2000);
  assert.equal(sanitized.length, 2000);
});

test("boundChatHistory: caps message history length to avoid memory leakage", () => {
  const shortHistory = [1, 2, 3];
  assert.deepEqual(boundChatHistory(shortHistory, 5), [1, 2, 3]);

  const longHistory = Array.from({ length: 100 }, (_, i) => i);
  const bounded = boundChatHistory(longHistory, 50);
  assert.equal(bounded.length, 50);
  assert.equal(bounded[0], 50);
  assert.equal(bounded[49], 99);
});

test("getPlaceholderText: updates input placeholder based on conversation state", () => {
  assert.equal(getPlaceholderText(0), "Ask me anything…");
  assert.equal(getPlaceholderText(1), "Continue…");
  assert.equal(getPlaceholderText(10), "Continue…");
});

test("calcChatChipLabel: formats and bounds context chip labels", () => {
  assert.equal(calcChatChipLabel({ name: "notes.md" }), "notes.md");
  assert.equal(calcChatChipLabel({ name: "  report.pdf  " }), "report.pdf");
  assert.equal(calcChatChipLabel(null), "");
  assert.equal(calcChatChipLabel(undefined), "");

  const longName = "x".repeat(100) + ".pdf";
  assert.equal(calcChatChipLabel({ name: longName }, 20).length, 20);
});

test("shouldAttachFileContext: attaches dropped file context only on opening turn", () => {
  assert.equal(shouldAttachFileContext(1, true), true);
  assert.equal(shouldAttachFileContext(1, false), false);
  assert.equal(shouldAttachFileContext(2, true), false);
  assert.equal(shouldAttachFileContext(0, true), false);
});
