// Links Winsle to Claude Code (~/.claude/settings.json) and Antigravity (~/.gemini/config/hooks.json).
// Run by toggle-winsle.ps1 on every start. Idempotent; backs up (*.bak-winsle-<timestamp>) only before a real change.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const hookExe = path.join(process.env.LOCALAPPDATA, "Winsle", "bin", "winsle-hook.exe").replace(/\\/g, "/");
const load = (f) =>
  fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, "")) : {};
// Runs on every launch: write (and back up) only when something actually changed.
let changed = false;
const save = (f, before, obj) => {
  const next = JSON.stringify(obj, null, 2);
  if (next === before) return;
  if (fs.existsSync(f)) fs.copyFileSync(f, `${f}.bak-winsle-${stamp}`);
  fs.writeFileSync(f, next);
  changed = true;
};

// Claude Code: same merge as the app's own installer (hooks.rs `merged`).
const EVENTS = [
  ["SessionStart", 10], ["SessionEnd", 10], ["UserPromptSubmit", 10], ["PreToolUse", 10],
  ["PostToolUse", 10], ["PostToolUseFailure", 10], ["PermissionRequest", 120], ["Notification", 10],
  ["Stop", 10], ["StopFailure", 10], ["SubagentStart", 10], ["SubagentStop", 10],
];
const cc = path.join(os.homedir(), ".claude", "settings.json");
const s = load(cc);
const ccBefore = JSON.stringify(s, null, 2);
s.hooks ??= {};
for (const [ev, timeout] of EVENTS) {
  const list = (s.hooks[ev] ?? []).filter(
    (e) => !(e.hooks ?? []).some((h) => /winsle-hook/.test(String(h.command ?? ""))),
  );
  list.push({ hooks: [{ type: "command", command: `"${hookExe}" ${ev}`, timeout }] });
  s.hooks[ev] = list;
}
save(cc, ccBefore, s);

// Antigravity: one named group, routed through the bridge.
const ag = path.join(os.homedir(), ".gemini", "config", "hooks.json");
const h = load(ag);
const agBefore = JSON.stringify(h, null, 2);
const bridge = path.join(import.meta.dirname, "antigravity-bridge.mjs").replace(/\\/g, "/");
const cmd = (ev) => [{ hooks: [{ type: "command", command: `node "${bridge}" ${ev}`, timeout: 5 }] }];
h.winsle = { enabled: true, PreToolUse: cmd("PreToolUse"), PostToolUse: cmd("PostToolUse"), Stop: cmd("Stop") };
save(ag, agBefore, h);

console.log(`${changed ? "Linked" : "Already linked"}.\n  Claude Code: ${cc}\n  Antigravity: ${ag}`);
