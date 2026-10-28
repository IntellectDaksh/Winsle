/**
 * Hook event payload parsing, tool name formatting, and target approval extraction.
 */

export const PROJECT_ALIASES: Record<string, string> = {
  "notch-buddy": "Notch Buddy",
  notchbuddy: "Notch Buddy",
  notch_buddy: "Notch Buddy",
};

export function aliasProjectName(name: string): string {
  if (!name || typeof name !== "string") return "Session";
  return PROJECT_ALIASES[name.toLowerCase().trim()] ?? name.trim();
}

export function lastPathComponent(p: string): string {
  if (!p || typeof p !== "string") return "";
  const cleaned = p.replace(/[\\/]+$/, "");
  const idx = Math.max(cleaned.lastIndexOf("\\"), cleaned.lastIndexOf("/"));
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

export const TOOL_LABELS: Record<string, string> = {
  Bash: "Run",
  Read: "Read",
  Write: "Write",
  Edit: "Edit",
  Glob: "Find",
  Grep: "Search",
  WebSearch: "Web search",
  WebFetch: "Fetch",
  TodoWrite: "Tasks",
  Task: "Agent",
  Agent: "Agent",
  LS: "List",
  MultiEdit: "Edit",
  NotebookEdit: "Notebook",
  PowerShell: "Run",
  run_command: "Run",
  view_file: "Read",
  write_to_file: "Write",
  replace_file_content: "Edit",
};

export function stepLabel(tool: string, input: Record<string, unknown> = {}): string {
  const safeTool = (tool ?? "Tool").trim();
  const label = TOOL_LABELS[safeTool] ?? safeTool;
  const str = (k: string) => (typeof input?.[k] === "string" ? (input[k] as string).trim() : null);

  const cmd = str("command");
  if (cmd) return `${label} · ${cmd.slice(0, 40)}`;
  const path = str("path");
  if (path) return `${label} · ${lastPathComponent(path)}`;
  const file = str("file_path");
  if (file) return `${label} · ${lastPathComponent(file)}`;
  const query = str("query");
  if (query) return `${label} · ${query.slice(0, 40)}`;
  return label;
}

export const APPROVAL_FIELDS = [
  "command",
  "file_path",
  "path",
  "url",
  "query",
  "pattern",
  "prompt",
] as const;

export function approvalTarget(tool: string, input: Record<string, unknown> = {}): string {
  const safeTool = (tool ?? "Tool").trim();
  if (input && typeof input === "object") {
    for (const field of APPROVAL_FIELDS) {
      const value = input[field];
      if (typeof value === "string" && value.trim()) {
        return `${safeTool} · ${value.trim()}`;
      }
    }
  }
  return safeTool;
}
