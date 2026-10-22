import test from "node:test";
import assert from "node:assert/strict";

import { ALLOWED_HOOK_EVENTS, buildHookPayload } from "../../scripts/hooks/antigravity-bridge.mjs";

test("ALLOWED_HOOK_EVENTS: contains all expected lifecycle events", () => {
  assert.equal(ALLOWED_HOOK_EVENTS.has("PreToolUse"), true);
  assert.equal(ALLOWED_HOOK_EVENTS.has("PostToolUse"), true);
  assert.equal(ALLOWED_HOOK_EVENTS.has("Start"), true);
  assert.equal(ALLOWED_HOOK_EVENTS.has("Stop"), true);
  assert.equal(ALLOWED_HOOK_EVENTS.has("UserPromptSubmit"), true);

  // Rejects arbitrary or injected events
  assert.equal(ALLOWED_HOOK_EVENTS.has("ArbitraryInjection"), false);
  assert.equal(ALLOWED_HOOK_EVENTS.has("calc.exe"), false);
  assert.equal(ALLOWED_HOOK_EVENTS.has(""), false);
});

test("buildHookPayload: maps standard PreToolUse payload", () => {
  const payload = {
    conversationId: "test-123",
    workspacePaths: ["C:\\Projects\\Winsle"],
    toolCall: {
      name: "run_command",
      args: {
        CommandLine: "git status",
        Cwd: "C:\\Projects\\Winsle",
      },
    },
  };

  const res = buildHookPayload("PreToolUse", payload);
  assert.equal(res.hook_event_name, "PreToolUse");
  assert.equal(res.session_id, "agy-test-123");
  assert.equal(res.cwd, "C:\\Projects\\Winsle");
  assert.equal(res.tool_name, "run_command");
  assert.equal(res.tool_input.command, "git status");
});

test("buildHookPayload: maps failure states for PostToolUse and Stop", () => {
  const failTool = buildHookPayload("PostToolUse", { error: "Permission denied" });
  assert.equal(failTool.hook_event_name, "PostToolUseFailure");

  const failStop = buildHookPayload("Stop", { error: "Fatal crash" });
  assert.equal(failStop.hook_event_name, "StopFailure");

  const okStop = buildHookPayload("Stop", {});
  assert.equal(okStop.hook_event_name, "Stop");
  assert.equal(okStop.message, "Antigravity done");
});

test("buildHookPayload: handles fallback file path arguments", () => {
  const file1 = buildHookPayload("PreToolUse", { toolCall: { args: { TargetFile: "foo.ts" } } });
  assert.equal(file1.tool_input.file_path, "foo.ts");

  const file2 = buildHookPayload("PreToolUse", { toolCall: { args: { AbsolutePath: "/bar.ts" } } });
  assert.equal(file2.tool_input.file_path, "/bar.ts");

  const file3 = buildHookPayload("PreToolUse", { toolCall: { args: { File: "baz.ts" } } });
  assert.equal(file3.tool_input.file_path, "baz.ts");
});
