/**
 * Pure formatting and presentation utilities for larger live views.
 */

export const DEV_STATUS_MAP: Record<string, { text: string; cls: string }> = {
  thinking: { text: "Thinking", cls: "think" },
  working: { text: "Working", cls: "work" },
  waiting: { text: "Needs you", cls: "wait" },
  done: { text: "Done", cls: "done" },
  error: { text: "Error", cls: "err" },
  idle: { text: "Idle", cls: "idle" },
};

/**
 * Maps dev session status to user-facing label and CSS class.
 */
export function getDevStatusDisplay(statusKey: string | undefined): { text: string; cls: string } {
  return DEV_STATUS_MAP[statusKey ?? "idle"] ?? DEV_STATUS_MAP.idle;
}

/**
 * Calculates context window usage bar percentage, label, and warning threshold classes.
 */
export function formatContextBar(pct: number | null | undefined): { text: string; widthPercent: number; cls: string } {
  if (pct == null || !Number.isFinite(pct) || pct <= 0) {
    return { text: "", widthPercent: 0, cls: "" };
  }
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const cls = clamped >= 85 ? "danger" : clamped >= 70 ? "warn" : "";
  return { text: `${clamped}%`, widthPercent: clamped, cls };
}

export interface DevStatsInput {
  steps?: number;
  files?: number;
  commands?: number;
  errors?: number;
  subagents?: number;
}

/**
 * Formats dev session stats summary into chip labels, returning null for zeroed counts.
 */
export function calcDevStatsSummary(stats: DevStatsInput | null | undefined): {
  steps: string | null;
  files: string | null;
  commands: string | null;
  errors: string | null;
  subagents: string | null;
} {
  if (!stats) {
    return { steps: null, files: null, commands: null, errors: null, subagents: null };
  }
  const s = stats.steps ?? 0;
  const f = stats.files ?? 0;
  const c = stats.commands ?? 0;
  const e = stats.errors ?? 0;
  const a = stats.subagents ?? 0;

  return {
    steps: s > 0 ? `${s} step${s > 1 ? "s" : ""}` : null,
    files: f > 0 ? `${f} file${f > 1 ? "s" : ""}` : null,
    commands: c > 0 ? `${c} cmd${c > 1 ? "s" : ""}` : null,
    errors: e > 0 ? `${e} failed` : null,
    subagents: a > 0 ? `${a} subagent${a > 1 ? "s" : ""}` : null,
  };
}
