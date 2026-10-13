// Coding-session tracker: turns raw Claude Code / Antigravity hook events into a
// timeline the island can show — what was asked, every step with its time, files
// touched, commands run, failures, context used — plus a short history of past
// turns. Fed from island/hooks.ts; rendered by the dev cockpit and the home card.

import { Bridge } from "../core/bridge";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import { Live } from "./store";
import { load, save } from "./prefs";
import type { TranscriptStats } from "./types";

export interface DevStep {
  at: number; // epoch ms
  tool: string;
  label: string;
  detail: string;
  failed: boolean;
}

export interface DevTurn {
  project: string;
  cwd: string;
  prompt: string;
  start: number;
  end: number;
  steps: number;
  files: number;
  commands: number;
  failures: number;
  outcome: "done" | "error";
}

export interface DevSession {
  project: string;
  cwd: string;
  sessionId: string;
  transcript: string | null;
  /** When the current prompt was sent (or the session started). */
  turnStart: number;
  lastEvent: number;
  prompt: string;
  status: "thinking" | "working" | "waiting" | "done" | "error" | "idle";
  steps: DevStep[];
  files: Set<string>;
  commands: number;
  failures: number;
  subagents: number;
  stats: TranscriptStats | null;
  /** Context warning already shown for this session. */
  warned: boolean;
}

interface HookPayload {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  prompt?: string;
  message?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  transcript_path?: string;
}

const MAX_STEPS = 60;
const HISTORY = 12;
/** Re-chime a permission request nobody has answered after this long. */
const APPROVAL_NAG_MS = 60_000;

const VERBS: Record<string, string> = {
  Bash: "Run", PowerShell: "Run", run_command: "Run",
  Read: "Read", view_file: "Read",
  Write: "Write", write_to_file: "Write",
  Edit: "Edit", MultiEdit: "Edit", replace_file_content: "Edit", NotebookEdit: "Notebook",
  Glob: "Find", Grep: "Search", LS: "List",
  WebSearch: "Web search", WebFetch: "Fetch",
  TodoWrite: "Plan", Task: "Agent", Agent: "Agent",
};
const WRITES = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit", "write_to_file", "replace_file_content"]);
const RUNS = new Set(["Bash", "PowerShell", "run_command"]);

function baseName(p: string): string {
  const s = p.replace(/[\\/]+$/, "");
  return s.slice(Math.max(s.lastIndexOf("\\"), s.lastIndexOf("/")) + 1);
}

function describe(tool: string, input: Record<string, unknown>): { label: string; detail: string; file: string | null } {
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string).trim() : "");
  const verb = VERBS[tool] ?? tool;
  const file = str("file_path") || str("path") || str("notebook_path");
  if (str("command")) return { label: verb, detail: str("command"), file: null };
  if (file) return { label: verb, detail: baseName(file), file };
  for (const k of ["pattern", "query", "url", "description", "prompt"]) {
    if (str(k)) return { label: verb, detail: str(k), file: null };
  }
  if (tool === "TodoWrite" && Array.isArray(input.todos)) return { label: verb, detail: `${input.todos.length} items`, file: null };
  return { label: verb, detail: "", file: null };
}

/** Context window for a model id; 1M variants say so in the id. */
export function contextWindow(model: string | null | undefined, used = 0): number {
  // Past 200k the session can only be on a 1M window, whatever the id says.
  return (model && /1m|\[1m\]/i.test(model)) || used > 200_000 ? 1_000_000 : 200_000;
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n);
}

class DevTracker {
  session: DevSession | null = null;
  history: DevTurn[] = load<DevTurn[]>("devHistory", []);
  private approvalSince: number | null = null;
  private nagged = false;

  constructor() {
    window.setInterval(() => this.checkApproval(), 5000);
  }

  /** Elapsed time of the current turn, frozen once it ends. */
  elapsed(): number {
    const s = this.session;
    if (!s) return 0;
    const end = s.status === "done" || s.status === "error" || s.status === "idle" ? s.lastEvent : Date.now();
    return end - s.turnStart;
  }

  current(): DevStep | null {
    return this.session?.steps.at(-1) ?? null;
  }

  contextPct(): number | null {
    const st = this.session?.stats;
    if (!st || !st.contextTokens) return null;
    return Math.min(100, (st.contextTokens / contextWindow(st.model, st.contextTokens)) * 100);
  }

  /** Recent project folders, newest first (palette: "open project"). */
  recentProjects(): { project: string; cwd: string }[] {
    const seen = new Set<string>();
    const out: { project: string; cwd: string }[] = [];
    const all = [...(this.session ? [{ project: this.session.project, cwd: this.session.cwd }] : []), ...this.history];
    for (const t of all) {
      if (!t.cwd || seen.has(t.cwd.toLowerCase())) continue;
      seen.add(t.cwd.toLowerCase());
      out.push({ project: t.project, cwd: t.cwd });
    }
    return out;
  }

  /** Today's finished turns and their total time (daily recap). */
  today(): { turns: number; ms: number; files: number } {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const turns = this.history.filter((t) => t.end >= start.getTime());
    return {
      turns: turns.length,
      ms: turns.reduce((a, t) => a + (t.end - t.start), 0),
      files: turns.reduce((a, t) => a + t.files, 0),
    };
  }

  private ensure(p: HookPayload): DevSession {
    const cwd = p.cwd ?? this.session?.cwd ?? "";
    const sessionId = p.session_id ?? "";
    const s = this.session;
    if (s && (!sessionId || !s.sessionId || s.sessionId === sessionId)) {
      if (sessionId) s.sessionId = sessionId;
      // Tool events report the shell's current folder, which wanders with `cd`;
      // only the session start and each prompt name the project.
      const named = p.hook_event_name === "SessionStart" || p.hook_event_name === "UserPromptSubmit" || !s.cwd;
      if (cwd && named) {
        s.cwd = cwd;
        s.project = baseName(cwd) || s.project;
      }
      if (p.transcript_path) s.transcript = p.transcript_path;
      return s;
    }
    this.session = {
      project: baseName(cwd) || "Session",
      cwd,
      sessionId,
      transcript: p.transcript_path ?? null,
      turnStart: Date.now(),
      lastEvent: Date.now(),
      prompt: "",
      status: "idle",
      steps: [],
      files: new Set(),
      commands: 0,
      failures: 0,
      subagents: 0,
      stats: null,
      warned: false,
    };
    return this.session;
  }

  private newTurn(s: DevSession, prompt: string) {
    s.turnStart = Date.now();
    s.prompt = prompt;
    s.steps = [];
    s.files = new Set();
    s.commands = 0;
    s.failures = 0;
    s.subagents = 0;
  }

  onHook(p: HookPayload) {
    const name = p.hook_event_name ?? "";
    if (!name) return;
    const s = this.ensure(p);
    s.lastEvent = Date.now();
    switch (name) {
      case "SessionStart":
        if (s.status === "idle" || s.status === "done") this.newTurn(s, "");
        break;
      case "UserPromptSubmit":
        this.newTurn(s, (p.prompt ?? p.message ?? "").trim());
        s.status = "thinking";
        break;
      case "PreToolUse": {
        if (s.status === "done" || s.status === "error" || s.status === "idle") this.newTurn(s, s.prompt);
        const tool = p.tool_name ?? "Tool";
        const input = p.tool_input ?? {};
        const d = describe(tool, input);
        s.steps.push({ at: Date.now(), tool, label: d.label, detail: d.detail, failed: false });
        if (s.steps.length > MAX_STEPS) s.steps.shift();
        if (d.file && WRITES.has(tool)) s.files.add(d.file.toLowerCase());
        if (RUNS.has(tool)) s.commands++;
        s.status = "working";
        break;
      }
      case "PostToolUseFailure": {
        s.failures++;
        const last = s.steps.at(-1);
        if (last) last.failed = true;
        break;
      }
      case "PermissionRequest":
        s.status = "waiting";
        this.approvalSince = Date.now();
        this.nagged = false;
        break;
      case "PostToolUse":
        s.status = "working";
        this.approvalSince = null;
        break;
      case "Notification":
        if ((p.message ?? "").trim().endsWith("?")) s.status = "waiting";
        break;
      case "SubagentStart":
        s.subagents++;
        break;
      case "Stop":
        this.finish(s, "done");
        break;
      case "StopFailure":
        this.finish(s, "error");
        break;
      case "SessionEnd":
        s.status = "idle";
        break;
    }
    State.notify();
  }

  private finish(s: DevSession, outcome: "done" | "error") {
    s.status = outcome;
    this.approvalSince = null;
    // A turn with nothing in it (a bare "hi") isn't worth a history row.
    if (s.steps.length || s.prompt) {
      this.history = [{
        project: s.project, cwd: s.cwd, prompt: s.prompt.slice(0, 160),
        start: s.turnStart, end: Date.now(), steps: s.steps.length,
        files: s.files.size, commands: s.commands, failures: s.failures, outcome,
      }, ...this.history].slice(0, HISTORY);
      save("devHistory", this.history);
    }
    const summary = `${fmtDuration(this.elapsed())} · ${s.steps.length} step${s.steps.length === 1 ? "" : "s"}${s.files.size ? ` · ${s.files.size} file${s.files.size > 1 ? "s" : ""}` : ""}`;
    void this.refreshStats().then(() => {
      const reply = s.stats?.lastText?.split(/\n+/).find((l) => l.trim()) ?? "";
      if (State.mode !== "expanded") {
        Live.setFlash({
          icon: outcome === "done" ? "check" : "bang",
          color: outcome === "done" ? "#34D399" : "#F4505E",
          title: `${s.project} · ${outcome === "done" ? "done" : "stopped on an error"}`,
          sub: reply ? `${summary} — ${reply}` : summary,
          view: "dev",
        }, 7000);
      }
    });
  }

  /** Reads model, context size and Claude's last reply from the transcript. */
  async refreshStats() {
    const s = this.session;
    if (!s?.transcript) return;
    const stats = await Bridge.transcriptStats(s.transcript).catch(() => null);
    if (!stats || this.session !== s) return;
    s.stats = stats;
    const pct = this.contextPct();
    if (pct != null && pct >= 80 && !s.warned) {
      s.warned = true;
      Sound.play("peek");
      Live.setFlash({
        icon: "bang", color: "#F5A524", title: `Context ${Math.round(pct)}% full`,
        sub: `${s.project} — consider /compact or a fresh session`, view: "dev",
      }, 8000);
    }
    State.notify();
  }

  async copyReply(): Promise<boolean> {
    await this.refreshStats();
    const text = this.session?.stats?.lastText;
    return text ? Live.copyClip(text) : false;
  }

  private checkApproval() {
    if (!State.pendingApproval) {
      this.approvalSince = null;
      return;
    }
    if (this.approvalSince == null) this.approvalSince = Date.now();
    if (!this.nagged && Date.now() - this.approvalSince >= APPROVAL_NAG_MS) {
      this.nagged = true;
      Sound.play("approval");
      Live.setFlash({
        icon: "bang", color: "#F5A524", title: "Still waiting for you",
        sub: State.pendingApproval.command, view: "approval",
      }, 8000);
    }
  }
}

export const Dev = new DevTracker();
