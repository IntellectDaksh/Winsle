// Creative output inventory and local project operations panels.
// Both panels fetch real local data only when opened.

import { invoke } from "@tauri-apps/api/core";
import { Bridge, IS_TAURI } from "../core/bridge";
import { h } from "../views/dom";
import type { ViewHost } from "../views/views";
import { Dev } from "./dev";
import { fmtBytes } from "./store";
import { empty, shell } from "./views";
import "./production-devops.css";

interface ProductionOutput {
  path: string; folder: string; name: string; format: string; bytes: number;
  modifiedAt: number; group: string; version: number | null;
  state: "ready" | "recent" | "empty" | "partial" | "stalled";
}
interface ProductionInventory {
  outputs: ProductionOutput[]; folders: string[]; inaccessible: string[]; truncated: boolean;
}
interface DevopsSnapshot {
  path: string; project: string; branch: string | null;
  changedFiles: number; stagedFiles: number; untrackedFiles: number;
  upstream: string | null; ahead: number; behind: number;
  tasks: string[]; gitError: string | null;
}
interface DevopsRunResult {
  task: string; exitCode: number | null; timedOut: boolean;
  durationMs: number; stdout: string; stderr: string;
}

const date = (ms: number) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
const stateText: Record<ProductionOutput["state"], string> = {
  ready: "Output found", recent: "Recently changing", empty: "Empty file", partial: "Partial file", stalled: "Stalled partial",
};

function action(label: string, run: () => void, title?: string) {
  return h("button", { class: "pd-action", type: "button", title: title ?? label, onclick: run }, label);
}

export function buildProductionHub(): ViewHost {
  const summary = h("span", { class: "pd-summary" });
  const refreshButton = action("Refresh", () => void refresh());
  const filter = h("select", { class: "pd-select", "aria-label": "Filter outputs" },
    h("option", { value: "all", text: "All outputs" }),
    h("option", { value: "review", text: "Needs review" }),
    h("option", { value: "versions", text: "Versioned" }));
  const order = h("select", { class: "pd-select", "aria-label": "Sort outputs" },
    h("option", { value: "recent", text: "Newest first" }),
    h("option", { value: "name", text: "Name A–Z" }));
  const notice = h("div", { class: "pd-notice", role: "status", "aria-live": "polite" });
  const list = h("div", { class: "pd-list", role: "list" });
  const { el } = shell(
    h("div", { class: "pd-head" }, h("strong", { text: "Production hub" }), summary, h("span", { class: "pd-spacer" }), refreshButton),
    h("div", { class: "pd-toolbar" }, filter, order), notice, list,
  );
  el.classList.add("pd-panel");
  let inventory: ProductionInventory | null = null;
  let busy = false;
  let lastRefresh = 0;

  function render() {
    if (!inventory) return;
    const total = inventory.outputs.length;
    const review = inventory.outputs.filter((o) => o.state === "empty" || o.state === "partial" || o.state === "stalled").length;
    summary.textContent = `${total} output${total === 1 ? "" : "s"}${review ? ` · ${review} need review` : ""}`;
    const chosen = inventory.outputs.filter((o) => filter.value === "all"
      || (filter.value === "review" && (o.state === "empty" || o.state === "partial" || o.state === "stalled"))
      || (filter.value === "versions" && o.version != null));
    if (order.value === "name") chosen.sort((a, b) => a.group.localeCompare(b.group) || (b.version ?? 0) - (a.version ?? 0));
    else chosen.sort((a, b) => b.modifiedAt - a.modifiedAt);
    list.replaceChildren();
    if (!inventory.folders.length) {
      list.append(empty("No render folders configured", "Add output folders in Settings → Live to inventory your renders.", action("Open settings", () => void Bridge.openSettingsWindow())));
      return;
    }
    if (!chosen.length) {
      list.append(empty(filter.value === "all" ? "No outputs found" : "No matching outputs", "Try another filter or refresh after your next render."));
      return;
    }
    for (const o of chosen) {
      const badge = h("span", { class: `pd-state ${o.state}`, text: stateText[o.state] });
      const sibling = inventory.outputs.find((other) => other.path !== o.path && other.folder === o.folder && other.group.toLowerCase() === o.group.toLowerCase() && other.version != null);
      const compare = sibling && o.version != null ? action("Compare", () => {
        const sizeDelta = o.bytes - sibling.bytes;
        notice.textContent = `${o.name} (${fmtBytes(o.bytes)}) vs ${sibling.name} (${fmtBytes(sibling.bytes)}) · ${sizeDelta >= 0 ? "+" : "−"}${fmtBytes(Math.abs(sizeDelta))} · ${date(o.modifiedAt)} / ${date(sibling.modifiedAt)}`;
      }, `Compare metadata with ${sibling.name}`) : null;
      const open = action("Open", () => void Bridge.fileOpen(o.path).catch((err) => { notice.textContent = `Could not open ${o.name}: ${String(err)}`; }));
      const reveal = action("Show", () => void Bridge.fileReveal(o.path), "Show in folder");
      list.append(h("div", { class: "pd-row", role: "listitem" },
        h("div", { class: "pd-row-main" },
          h("div", { class: "pd-name", title: o.path, text: o.name }),
          h("div", { class: "pd-meta", text: `${o.group}${o.version == null ? "" : ` · v${o.version}`} · ${o.format.toUpperCase()} · ${fmtBytes(o.bytes)} · ${date(o.modifiedAt)}` })),
        badge, compare, open, reveal));
    }
  }

  async function refresh() {
    if (busy) return;
    lastRefresh = Date.now();
    if (!IS_TAURI) { notice.textContent = "Open Winsle on Windows to scan render folders."; return; }
    busy = true; refreshButton.setAttribute("disabled", "");
    refreshButton.textContent = "Refreshing…";
    notice.textContent = "Scanning configured render folders…";
    try {
      inventory = await invoke<ProductionInventory>("production_scan");
      lastRefresh = Date.now();
      const warnings = [inventory.inaccessible.length ? `${inventory.inaccessible.length} folder${inventory.inaccessible.length === 1 ? "" : "s"} could not be read` : "", inventory.truncated ? "Showing the newest outputs from a bounded scan" : ""].filter(Boolean);
      notice.textContent = warnings.join(" · ");
      render();
    } catch (err) { notice.textContent = `Scan failed: ${String(err)}`; }
    finally { busy = false; refreshButton.removeAttribute("disabled"); refreshButton.textContent = "Refresh"; }
  }

  filter.addEventListener("change", render);
  order.addEventListener("change", render);
  return { el, sync() { if (Date.now() - lastRefresh > 60_000 && !busy) void refresh(); } };
}

export function buildDeveloperOperations(): ViewHost {
  const path = h("input", { class: "pd-path", type: "text", name: "projectPath", autocomplete: "off", placeholder: "Project folder path…", "aria-label": "Project folder path" });
  const recent = h("select", { class: "pd-select", "aria-label": "Recent project" }, h("option", { value: "", text: "Recent projects…" }));
  const inspect = action("Inspect", () => void refresh());
  const status = h("div", { class: "pd-notice", role: "status", "aria-live": "polite" });
  const overview = h("div", { class: "pd-overview" });
  const tasks = h("div", { class: "pd-tasks" });
  const output = h("pre", { class: "pd-output", tabindex: "0", "aria-label": "Task output" });
  const { el } = shell(
    h("div", { class: "pd-head" }, h("strong", { text: "Developer operations" }), h("span", { class: "pd-spacer" }), recent),
    h("div", { class: "pd-toolbar" }, path, inspect), status, overview, tasks, output,
  );
  el.classList.add("pd-panel");
  let snap: DevopsSnapshot | null = null;
  let inspecting = false;
  let running = false;
  let lastPath = "";
  let lastRefresh = 0;

  function recentProjects() {
    const projects = Dev.recentProjects();
    const key = projects.map((p) => p.cwd).join("|");
    if (recent.dataset.key === key) return;
    recent.dataset.key = key;
    recent.replaceChildren(h("option", { value: "", text: "Recent projects…" }),
      ...projects.map((p) => h("option", { value: p.cwd, text: p.project })));
    if (!path.value && projects[0]) { path.value = projects[0].cwd; }
  }

  function render() {
    if (!snap) return;
    const git = snap.gitError
      ? h("div", { class: "pd-warning", text: `Git: ${snap.gitError}` })
      : h("div", { class: "pd-metrics" },
        h("span", { text: `Branch ${snap.branch || "detached"}` }),
        h("span", { text: `${snap.changedFiles} changed` }),
        h("span", { text: `${snap.stagedFiles} staged` }),
        h("span", { text: `${snap.untrackedFiles} untracked` }),
        snap.upstream ? h("span", { text: `${snap.ahead} ahead · ${snap.behind} behind ${snap.upstream}` }) : h("span", { text: "No upstream" }));
    overview.replaceChildren(h("div", { class: "pd-project", title: snap.path, text: snap.project }), git);
    tasks.replaceChildren();
    if (!snap.tasks.length) { tasks.append(h("span", { class: "pd-muted", text: "No build or test scripts detected in this folder." })); return; }
    tasks.append(h("span", { class: "pd-muted", text: "Run a local check" }));
    for (const id of snap.tasks) tasks.append(action(id.replace(":", " "), () => void runTask(id)));
  }

  async function refresh(quiet = false) {
    if (inspecting || running) return;
    lastRefresh = Date.now();
    const selected = path.value.trim();
    if (!selected) { status.textContent = "Enter a project folder path."; path.focus(); return; }
    if (!IS_TAURI) { status.textContent = "Open Winsle on Windows to inspect a local project."; return; }
    inspecting = true; inspect.setAttribute("disabled", ""); inspect.textContent = "Inspecting…";
    if (!quiet) status.textContent = "Reading Git and available project checks…";
    try {
      snap = await invoke<DevopsSnapshot>("devops_snapshot", { path: selected });
      lastPath = selected; lastRefresh = Date.now(); if (!quiet) status.textContent = "Project status updated."; render();
    } catch (err) { status.textContent = `Inspection failed: ${String(err)}`; }
    finally { inspecting = false; inspect.removeAttribute("disabled"); inspect.textContent = "Inspect"; }
  }

  async function runTask(task: string) {
    if (running || !snap) return;
    running = true;
    for (const button of tasks.querySelectorAll("button")) button.setAttribute("disabled", "");
    status.textContent = `Running ${task}…`;
    output.textContent = "";
    try {
      const result = await invoke<DevopsRunResult>("devops_run", { path: snap.path, task });
      output.textContent = [result.stdout, result.stderr].filter(Boolean).join("\n") || "(No output)";
      status.textContent = result.timedOut ? `${task} timed out after 120 seconds.`
        : result.exitCode === 0 ? `${task} passed in ${(result.durationMs / 1000).toFixed(1)}s.`
          : `${task} failed with exit code ${result.exitCode ?? "unknown"}.`;
    } catch (err) { status.textContent = `Could not run ${task}: ${String(err)}`; }
    finally { running = false; for (const button of tasks.querySelectorAll("button")) button.removeAttribute("disabled"); void refresh(true); }
  }

  recent.addEventListener("change", () => { if (recent.value) { path.value = recent.value; void refresh(); } });
  path.addEventListener("keydown", (event) => { if (event.key === "Enter") void refresh(); });
  return {
    el,
    sync() {
      recentProjects();
      if (path.value && (path.value !== lastPath || Date.now() - lastRefresh > 60_000) && !inspecting && !running) void refresh();
      else if (!path.value && !snap) overview.replaceChildren(empty("Choose a project", "Select a recent coding project or enter a folder path to see Git and local checks."));
    },
  };
}
