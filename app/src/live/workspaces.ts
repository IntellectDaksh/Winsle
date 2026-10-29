import { invoke } from "@tauri-apps/api/core";
import { IS_TAURI } from "../core/bridge";
import { h } from "../views/dom";
import type { ViewHost } from "../views/views";
import "./workspaces.css";

interface WorkspaceItem { kind: string; path: string; label: string }
interface Workspace { id: string; name: string; updatedAt: number; items: WorkspaceItem[] }
interface ResumeReport { opened: number; missing: string[]; failed: string[] }

const native = <T>(cmd: string, args?: Record<string, unknown>) => {
  if (!IS_TAURI) return Promise.reject(new Error("Open Winsle desktop to use project workspaces."));
  return invoke<T>(cmd, args);
};

/** Project workspace manager. Its form is intentionally explicit about captured apps. */
export function buildWorkspaceView(): ViewHost {
  let workspaces: Workspace[] = [];
  let editing: string | null = null;
  let busy = false;
  const name = h("input", { class: "ws-input", placeholder: "Project name", maxlength: 80, "aria-label": "Workspace name" }) as HTMLInputElement;
  const paths = h("textarea", { class: "ws-input ws-paths", placeholder: "One file or folder path per line", "aria-label": "Project files and folders", rows: 2 }) as HTMLTextAreaElement;
  const apps = h("input", { type: "checkbox", checked: true, "aria-label": "Include currently open apps" }) as HTMLInputElement;
  const preview = h("div", { class: "ws-preview", "aria-live": "polite" });
  const status = h("div", { class: "ws-status", role: "status", "aria-live": "polite" });
  const list = h("div", { class: "ws-list" });
  const save = h("button", { class: "ws-button primary", text: "Save workspace" });
  const newButton = h("button", { class: "ws-button", text: "New" });
  const capture = h("button", { class: "ws-button", text: "Preview open apps" });

  function message(text: string, error = false) {
    status.textContent = text;
    status.classList.toggle("error", error);
  }
  function reset() {
    editing = null; name.value = ""; paths.value = ""; apps.checked = true;
    save.textContent = "Save workspace";
    preview.textContent = "";
    name.focus();
  }
  async function refresh() {
    if (!IS_TAURI) {
      name.disabled = true; paths.disabled = true; apps.disabled = true;
      save.setAttribute("disabled", ""); newButton.setAttribute("disabled", ""); capture.setAttribute("disabled", "");
      draw(); message("Open Winsle desktop to save and resume workspaces.");
      return;
    }
    try {
      workspaces = await native<Workspace[]>("workspace_list");
      draw();
    } catch (err) { message(String(err), true); }
  }
  function draw() {
    list.replaceChildren();
    if (!workspaces.length) {
      list.append(h("p", { class: "ws-empty", text: "No workspaces yet. Save open apps and add the project files or folders you want to reopen." }));
      return;
    }
    for (const ws of [...workspaces].sort((a, b) => b.updatedAt - a.updatedAt)) {
      const title = h("strong", { text: ws.name });
      const meta = h("small", { text: `${ws.items.filter((i) => i.kind === "app").length} apps · ${ws.items.filter((i) => i.kind !== "app").length} files/folders` });
      const resume = h("button", { class: "ws-button primary", text: "Resume", "aria-label": `Resume ${ws.name}` });
      const edit = h("button", { class: "ws-button", text: "Edit", "aria-label": `Edit ${ws.name}` });
      const remove = h("button", { class: "ws-button quiet", text: "Delete", "aria-label": `Delete ${ws.name}` });
      resume.onclick = async () => {
        resume.setAttribute("disabled", "");
        message(`Reopening ${ws.name}…`);
        try {
          const report = await native<ResumeReport>("workspace_resume", { id: ws.id });
          message(`Opened ${report.opened}. ${report.missing.length} missing, ${report.failed.length} failed.`, !!(report.missing.length || report.failed.length));
          if (report.missing.length || report.failed.length) preview.textContent = [...report.missing.map((p) => `Missing: ${p}`), ...report.failed].join("\n");
        } catch (err) { message(String(err), true); }
        resume.removeAttribute("disabled");
      };
      edit.onclick = () => {
        editing = ws.id; name.value = ws.name;
        paths.value = ws.items.filter((i) => i.kind !== "app").map((i) => i.path).join("\n");
        apps.checked = ws.items.some((i) => i.kind === "app");
        save.textContent = "Update workspace";
        name.focus();
      };
      remove.onclick = async () => {
        if (remove.textContent !== "Confirm delete") { remove.textContent = "Confirm delete"; return; }
        try { await native("workspace_delete", { id: ws.id }); message(`${ws.name} deleted.`); await refresh(); }
        catch (err) { message(String(err), true); }
      };
      list.append(h("div", { class: "ws-row" }, h("div", { class: "ws-row-copy" }, title, meta), resume, edit, remove));
    }
  }
  save.onclick = async () => {
    if (busy) return;
    busy = true; save.setAttribute("disabled", ""); message("Saving…");
    try {
      const result = await native<Workspace>("workspace_save", {
        id: editing, name: name.value, paths: paths.value.split(/\r?\n/).map((p) => p.trim()).filter(Boolean), captureApps: apps.checked,
      });
      message(`Saved ${result.name} with ${result.items.length} items.`);
      reset(); await refresh();
    } catch (err) { message(String(err), true); }
    busy = false; save.removeAttribute("disabled");
  };
  newButton.onclick = reset;
  capture.onclick = async () => {
    message("Checking open apps…");
    try {
      const items = await native<WorkspaceItem[]>("workspace_snapshot");
      preview.textContent = items.length ? items.map((i) => i.label).join(" · ") : "No restorable apps detected. Add files or folders below.";
      message(`${items.length} apps can be saved.`);
    } catch (err) { message(String(err), true); }
  };
  const el = h("div", { class: "view lv ws-view" }, h("div", { class: "card ws-card" },
    h("div", { class: "ws-head" }, h("div", {}, h("h2", { text: "Project workspaces" }), h("p", { text: "Reopen your apps and project paths together." })), newButton),
    h("div", { class: "ws-form" }, name, paths, h("label", { class: "ws-check" }, apps, " Include currently open apps"), capture, save),
    preview, status, list,
    h("p", { class: "ws-note", text: "Window positions, browser tabs, and unsaved documents stay with their apps." }),
  ));
  void refresh();
  return { el, sync() {}, focus() { name.focus(); } };
}
