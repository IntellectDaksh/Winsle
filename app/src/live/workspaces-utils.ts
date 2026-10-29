export interface WorkspaceItem { kind: string; path: string; label: string }
export interface Workspace { id: string; name: string; updatedAt: number; items: WorkspaceItem[] }
export interface ResumeReport { opened: number; missing: string[]; failed: string[] }

export interface ProductionOutput {
  path: string;
  folder: string;
  name: string;
  format: string;
  bytes: number;
  modifiedAt: number;
  group: string;
  version: number | null;
  state: "ready" | "recent" | "empty" | "partial" | "stalled";
}

export function parseWorkspacePaths(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("#"));
}

export function formatResumeSummary(report: ResumeReport): string {
  const parts: string[] = [];
  if (report.opened > 0) parts.push(`Opened ${report.opened} item${report.opened === 1 ? "" : "s"}`);
  if (report.missing.length > 0) parts.push(`Missing: ${report.missing.length}`);
  if (report.failed.length > 0) parts.push(`Failed: ${report.failed.length}`);
  return parts.join(", ") || "Nothing opened";
}

export function filterOutputs(outputs: ProductionOutput[], filterType: "all" | "review" | "versions"): ProductionOutput[] {
  switch (filterType) {
    case "review":
      return outputs.filter((o) => o.state === "empty" || o.state === "partial" || o.state === "stalled");
    case "versions":
      return outputs.filter((o) => o.version !== null);
    default:
      return outputs;
  }
}

export function sortOutputs(outputs: ProductionOutput[], sortBy: "recent" | "name"): ProductionOutput[] {
  const copy = [...outputs];
  if (sortBy === "name") {
    copy.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    copy.sort((a, b) => b.modifiedAt - a.modifiedAt);
  }
  return copy;
}

export function formatGitStatusSummary(snapshot: {
  branch: string | null;
  ahead: number;
  behind: number;
  changedFiles: number;
  stagedFiles: number;
  untrackedFiles: number;
}): string {
  const branchName = snapshot.branch || "HEAD (detached)";
  let syncInfo = "";
  if (snapshot.ahead > 0 && snapshot.behind > 0) {
    syncInfo = ` [ahead ${snapshot.ahead}, behind ${snapshot.behind}]`;
  } else if (snapshot.ahead > 0) {
    syncInfo = ` [ahead ${snapshot.ahead}]`;
  } else if (snapshot.behind > 0) {
    syncInfo = ` [behind ${snapshot.behind}]`;
  }

  const dirtyTotal = snapshot.changedFiles + snapshot.stagedFiles + snapshot.untrackedFiles;
  const dirtyInfo = dirtyTotal > 0 ? ` (${dirtyTotal} modified)` : " (clean)";

  return `${branchName}${syncInfo}${dirtyInfo}`;
}
