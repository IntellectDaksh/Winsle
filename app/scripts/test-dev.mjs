import test from "node:test";
import assert from "node:assert/strict";

import {
  baseName,
  describeTool,
  contextWindow,
  calcContextPct,
  fmtDuration,
  fmtTokens,
} from "../src/live/dev-utils.ts";

test("baseName: extracts filename correctly for POSIX and Windows paths", () => {
  assert.equal(baseName("C:\\projects\\winsle\\main.ts"), "main.ts");
  assert.equal(baseName("/home/user/project/file.rs"), "file.rs");
  assert.equal(baseName("README.md"), "README.md");
  assert.equal(baseName("folder/nested/"), "nested");
  assert.equal(baseName(""), "");
});

test("describeTool: translates tool commands into user actions", () => {
  // Command execution
  const cmd = describeTool("Bash", { command: "git status" });
  assert.equal(cmd.label, "Run");
  assert.equal(cmd.detail, "git status");
  assert.equal(cmd.file, null);

  // File edit
  const edit = describeTool("Edit", { file_path: "src/main.rs" });
  assert.equal(edit.label, "Edit");
  assert.equal(edit.detail, "main.rs");
  assert.equal(edit.file, "src/main.rs");

  // Web search
  const web = describeTool("WebSearch", { query: "tauri v2 release" });
  assert.equal(web.label, "Web search");
  assert.equal(web.detail, "tauri v2 release");

  // Fallback
  const fallback = describeTool("UnknownCustomTool", {});
  assert.equal(fallback.label, "UnknownCustomTool");
  assert.equal(fallback.detail, "");
});

test("contextWindow & calcContextPct: computes token limits and usage pct", () => {
  // Default window is 200k
  assert.equal(contextWindow("claude-3-5-sonnet"), 200_000);
  // 1M window
  assert.equal(contextWindow("claude-3-5-sonnet-1m"), 1_000_000);
  assert.equal(contextWindow("model[1m]"), 1_000_000);
  // Large usage auto-escalates to 1M window
  assert.equal(contextWindow("claude-3-5-sonnet", 250_000), 1_000_000);

  // calcContextPct
  assert.equal(calcContextPct(100_000, "claude-3-5-sonnet"), 50);
  assert.equal(calcContextPct(250_000, "claude-3-5-sonnet-1m"), 25);

  // Invalid / non-positive tokens
  assert.equal(calcContextPct(0), null);
  assert.equal(calcContextPct(-50), null);
  assert.equal(calcContextPct(NaN), null);
  assert.equal(calcContextPct(null), null);
});

test("fmtDuration & fmtTokens: formats metrics safely", () => {
  assert.equal(fmtDuration(500), "1s");
  assert.equal(fmtDuration(65_000), "1m 05s");
  assert.equal(fmtDuration(3665_000), "1h 01m");
  assert.equal(fmtDuration(NaN), "0s");
  assert.equal(fmtDuration(-10), "0s");

  assert.equal(fmtTokens(500), "500");
  assert.equal(fmtTokens(1500), "1.5k");
  assert.equal(fmtTokens(125_000), "125k");
  assert.equal(fmtTokens(NaN), "0");
});
