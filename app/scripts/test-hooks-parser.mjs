import test from "node:test";
import assert from "node:assert/strict";

import {
  aliasProjectName,
  lastPathComponent,
  stepLabel,
  approvalTarget,
  TOOL_LABELS,
} from "../src/island/hook-parser.ts";

test("aliasProjectName: resolves canonical aliases and handles edge cases", () => {
  assert.equal(aliasProjectName("notch-buddy"), "Notch Buddy");
  assert.equal(aliasProjectName("NOTCHBUDDY"), "Notch Buddy");
  assert.equal(aliasProjectName("notch_buddy"), "Notch Buddy");

  assert.equal(aliasProjectName("Winsle"), "Winsle");
  assert.equal(aliasProjectName("  custom-repo  "), "custom-repo");
  assert.equal(aliasProjectName(""), "Session");
  assert.equal(aliasProjectName(null), "Session");
});

test("lastPathComponent: parses both Windows and POSIX path tails correctly", () => {
  assert.equal(lastPathComponent("C:\\Users\\User\\Projects\\Winsle"), "Winsle");
  assert.equal(lastPathComponent("C:\\Users\\User\\Projects\\Winsle\\"), "Winsle");
  assert.equal(lastPathComponent("/home/user/code/my-app/"), "my-app");
  assert.equal(lastPathComponent("/repo"), "repo");
  assert.equal(lastPathComponent("standalone"), "standalone");
  assert.equal(lastPathComponent(""), "");
  assert.equal(lastPathComponent(null), "");
});

test("stepLabel: formats tool step labels with verbs and identifying parameters", () => {
  // Command execution
  assert.equal(stepLabel("Bash", { command: "cargo test --lib" }), "Run · cargo test --lib");
  assert.equal(stepLabel("PowerShell", { command: "Get-Process" }), "Run · Get-Process");
  assert.equal(stepLabel("run_command", { command: "npm test" }), "Run · npm test");

  // File reading / writing
  assert.equal(stepLabel("Read", { path: "C:\\Users\\app\\index.html" }), "Read · index.html");
  assert.equal(stepLabel("Write", { file_path: "src/island/island.ts" }), "Write · island.ts");
  assert.equal(stepLabel("view_file", { path: "/etc/hosts" }), "Read · hosts");

  // Web search
  assert.equal(stepLabel("WebSearch", { query: "Rust tauri tutorial" }), "Web search · Rust tauri tutorial");

  // Fallback with no input
  assert.equal(stepLabel("LS", {}), "List");
  assert.equal(stepLabel("CustomTool", {}), "CustomTool");
});

test("approvalTarget: resolves target by field priority for explicit authorization", () => {
  // Priority: command > file_path > path > url > query > pattern > prompt
  assert.equal(
    approvalTarget("Bash", { command: "rm -rf tmp", path: "/tmp" }),
    "Bash · rm -rf tmp"
  );
  assert.equal(
    approvalTarget("Write", { file_path: "C:\\secret.key" }),
    "Write · C:\\secret.key"
  );
  assert.equal(
    approvalTarget("WebFetch", { url: "https://api.github.com" }),
    "WebFetch · https://api.github.com"
  );
  assert.equal(
    approvalTarget("Glob", { pattern: "**/*.ts" }),
    "Glob · **/*.ts"
  );
  assert.equal(
    approvalTarget("Task", { prompt: "Refactor core module" }),
    "Task · Refactor core module"
  );

  // Fallback when input empty or missing
  assert.equal(approvalTarget("Edit", {}), "Edit");
  assert.equal(approvalTarget("Edit", null), "Edit");
});
