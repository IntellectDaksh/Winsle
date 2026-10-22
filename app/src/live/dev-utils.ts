// Pure utilities for dev cockpit, tool call descriptors, context calculations, and formatting.
// Fully protected against NaN, infinite values, and missing input fields.

export const VERBS: Record<string, string> = {
  Bash: "Run", PowerShell: "Run", run_command: "Run",
  Read: "Read", view_file: "Read",
  Write: "Write", write_to_file: "Write",
  Edit: "Edit", MultiEdit: "Edit", replace_file_content: "Edit", NotebookEdit: "Notebook",
  Glob: "Find", Grep: "Search", LS: "List",
  WebSearch: "Web search", WebFetch: "Fetch",
  TodoWrite: "Plan", Task: "Agent", Agent: "Agent",
};

export const WRITES = new Set([
  "Write", "Edit", "MultiEdit", "NotebookEdit", "write_to_file", "replace_file_content",
]);

export const RUNS = new Set(["Bash", "PowerShell", "run_command"]);

/**
 * Extracts filename or leaf directory from a Windows or POSIX path.
 */
export function baseName(p: string): string {
  if (!p) return "";
  const s = p.replace(/[\\/]+$/, "");
  return s.slice(Math.max(s.lastIndexOf("\\"), s.lastIndexOf("/")) + 1);
}

/**
 * Turns a tool execution and its parameters into a human-friendly verb and detail.
 */
export function describeTool(
  tool: string,
  input?: Record<string, unknown> | null,
): { label: string; detail: string; file: string | null } {
  const safeInput = input ?? {};
  const str = (k: string) => (typeof safeInput[k] === "string" ? (safeInput[k] as string).trim() : "");
  const verb = VERBS[tool] ?? tool;
  const file = str("file_path") || str("path") || str("notebook_path");
  if (str("command")) return { label: verb, detail: str("command"), file: null };
  if (file) return { label: verb, detail: baseName(file), file };
  for (const k of ["pattern", "query", "url", "description", "prompt"]) {
    if (str(k)) return { label: verb, detail: str(k), file: null };
  }
  if (tool === "TodoWrite" && Array.isArray(safeInput.todos)) {
    return { label: verb, detail: `${safeInput.todos.length} items`, file: null };
  }
  return { label: verb, detail: "", file: null };
}

/**
 * Context window token limit for a model; 1M variants say so in their id.
 */
export function contextWindow(model: string | null | undefined, used = 0): number {
  const safeUsed = typeof used === "number" && Number.isFinite(used) ? used : 0;
  return (model && /1m|\[1m\]/i.test(model)) || safeUsed > 200_000 ? 1_000_000 : 200_000;
}

/**
 * Calculates context window usage percentage clamped between 0 and 100.
 */
export function calcContextPct(tokens: unknown, model?: string | null): number | null {
  if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens <= 0) {
    return null;
  }
  const max = contextWindow(model, tokens);
  return Math.min(100, Math.round(((tokens / max) * 100) * 10) / 10);
}

/**
 * Formats elapsed duration milliseconds into human-readable format.
 */
export function fmtDuration(ms: unknown): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
    return "0s";
  }
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/**
 * Formats token count (e.g. 1500 -> 1.5k, 120000 -> 120k).
 */
export function fmtTokens(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
    return "0";
  }
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(Math.round(n));
}
