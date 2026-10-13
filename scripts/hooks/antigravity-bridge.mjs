// Antigravity hook -> Winsle. Translates Antigravity's hook payload into the
// Claude Code shape winsle-hook.exe forwards to the island, then always prints
// "{}" so Antigravity proceeds with its default behaviour.
// Note: activity only, no approvals. Antigravity has no "permission needed"
// event; routing every PreToolUse to the island would gate every tool call.
import { spawn } from "node:child_process";
import { join } from "node:path";

const event = process.argv[2];
const HOOK = join(process.env.LOCALAPPDATA ?? "", "Winsle", "bin", "winsle-hook.exe");
const done = () => { process.stdout.write("{}\n"); process.exit(0); };
setTimeout(done, 2500).unref(); // never hold Antigravity up

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let p;
  try { p = JSON.parse(raw.replace(/^﻿/, "")); } catch { return done(); }

  const a = p.toolCall?.args ?? {};
  let name = event;
  if (event === "PostToolUse" && p.error) name = "PostToolUseFailure";
  if (event === "Stop" && p.error) name = "StopFailure";

  const out = {
    hook_event_name: name,
    session_id: `agy-${p.conversationId ?? ""}`,
    cwd: a.Cwd || p.workspacePaths?.[0] || "",
    tool_name: p.toolCall?.name,
    tool_input: {
      ...a,
      command: a.CommandLine,
      file_path: a.TargetFile ?? a.AbsolutePath ?? a.File,
      pattern: a.Query ?? a.Pattern,
    },
    message: name === "Stop" ? "Antigravity done" : undefined,
  };

  const child = spawn(HOOK, [name], { stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
  child.on("error", done);
  child.on("exit", done);
  child.stdin.end(JSON.stringify(out));
});
