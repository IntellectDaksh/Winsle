import { invoke } from "@tauri-apps/api/core";
import { IS_TAURI } from "../core/bridge";
import { h, clear } from "../views/dom";

interface Notice { info: { id: string; appId: string; app: string; title: string; body: string; time: number }; repeats: number; status: string; snoozeUntil: number }
interface ExtensionAction { id: string; label: string; kind: string; prefix: string }
interface Extension { id: string; name: string; description: string; permissions: string[]; subscriptions: string[]; actions: ExtensionAction[] }
interface ExtensionEvent { extensionId: string; event: string; summary: string; time: number }

export function notificationInboxSection(): HTMLElement {
  const section = h("section", {}, h("h2", { text: "Notification inbox" }));
  const count = h("div", { class: "hint", role: "status" });
  const search = h("input", { type: "search", placeholder: "Search notifications…", "aria-label": "Search notifications" });
  const filter = h("select", { "aria-label": "Notification status" },
    ...["all", "unread", "read", "snoozed", "dismissed"].map(x => h("option", { value: x, text: x[0].toUpperCase() + x.slice(1) })));
  const list = h("div", { class: "feature-list" });
  const message = h("div", { class: "hint", role: "status", "aria-live": "polite" });
  let notices: Notice[] = [];
  let visibleLimit = 50;

  async function refresh() {
    if (!IS_TAURI) { count.textContent = "Open Winsle desktop to triage notifications."; refreshBtn.disabled = true; search.disabled = true; filter.disabled = true; return; }
    try { notices = await invoke<Notice[]>("notif_inbox"); draw(); }
    catch (e) { message.textContent = String(e); }
  }
  async function action(id: string, action: string, minutes?: number) {
    try { notices = await invoke<Notice[]>("notif_triage", { id, action, minutes }); draw(); }
    catch (e) { message.textContent = String(e); }
  }
  function draw() {
    clear(list);
    const q = search.value.trim().toLocaleLowerCase();
    const shown = notices.filter(n => (filter.value === "all" || n.status === filter.value) &&
      `${n.info.app} ${n.info.title} ${n.info.body}`.toLocaleLowerCase().includes(q));
    count.textContent = `${notices.filter(n => n.status === "unread").length} unread · ${notices.length} saved`;
    if (!shown.length) { list.append(h("p", { class: "hint", text: "No notifications match this view." })); return; }
    for (const n of shown.slice(0, visibleLimit)) {
      const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(n.info.time));
      const row = h("article", { class: "feature-card" },
        h("div", { class: "row" }, h("strong", { text: n.info.app }), h("span", { class: "hint", text: `${when}${n.repeats > 1 ? ` · ×${n.repeats}` : ""}` })),
        h("div", { text: n.info.title }), h("p", { text: n.info.body }),
        h("div", { class: "hint", text: n.status === "snoozed" ? `Snoozed until ${new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date(n.snoozeUntil))}` : n.status }));
      const buttons = h("div", { class: "row" });
      const add = (label: string, fn: () => void) => { const b = h("button", { text: label }); b.addEventListener("click", fn); buttons.append(b); };
      add(n.status === "read" ? "Unread" : "Read", () => void action(n.info.id, n.status === "read" ? "unread" : "read"));
      add("Snooze 30m", () => void action(n.info.id, "snooze", 30));
      add("Snooze 1h", () => void action(n.info.id, "snooze", 60));
      add("Task", () => void invoke<string>("notif_to_task", { id: n.info.id }).then(() => { message.textContent = "Saved to task inbox."; }).catch(e => { message.textContent = String(e); }));
      if (n.info.appId) add("Open app", () => void invoke("notif_open", { appId: n.info.appId }).catch(e => { message.textContent = String(e); }));
      add("Dismiss", () => void action(n.info.id, "dismiss"));
      row.append(buttons); list.append(row);
    }
    if (shown.length > visibleLimit) {
      const more = h("button", { text: `Show more (${shown.length - visibleLimit} remaining)` });
      more.addEventListener("click", () => { visibleLimit += 50; draw(); });
      list.append(more);
    }
  }
  search.addEventListener("input", () => { visibleLimit = 50; draw(); });
  filter.addEventListener("change", () => { visibleLimit = 50; draw(); });
  const refreshBtn = h("button", { text: "Refresh" }); refreshBtn.addEventListener("click", () => void refresh());
  section.append(count, h("div", { class: "row" }, search, filter, refreshBtn), list, message);
  void refresh();
  return section;
}

export function extensionsSection(): HTMLElement {
  const section = h("section", {}, h("h2", { text: "Local extensions" }));
  const intro = h("p", { class: "hint", text: "Install declarative JSON manifests. Permissions are shown before installation. Extensions can use only Winsle’s listed local actions; scripts and network access are unavailable." });
  const manifest = h("textarea", { "aria-label": "Extension manifest JSON", placeholder: "Paste extension manifest JSON…", rows: 7, spellcheck: "false" });
  const install = h("button", { text: "Install extension" });
  const example = h("button", { text: "Load example manifest" });
  example.addEventListener("click", () => {
    manifest.value = JSON.stringify({ id: "quick-note", name: "Quick Note", description: "Save a note to the task inbox", permissions: ["capture.write", "events.notification"], subscriptions: ["notification"], actions: [{ id: "save", label: "Save note", kind: "capture", prefix: "Note: " }] }, null, 2);
    manifest.focus();
  });
  const message = h("div", { class: "hint", role: "status", "aria-live": "polite" });
  const list = h("div", { class: "feature-list" });
  const input = h("input", { type: "text", placeholder: "Action input…", "aria-label": "Extension action input" });
  const eventList = h("div", { class: "feature-list" });
  const refreshEvents = h("button", { text: "Refresh events" });
  let installed: Extension[] = [];
  async function refresh() {
    if (!IS_TAURI) { message.textContent = "Open Winsle desktop to install and run extensions."; install.disabled = true; input.disabled = true; refreshEvents.disabled = true; return; }
    try { installed = await invoke<Extension[]>("extension_list"); draw(); }
    catch (e) { message.textContent = String(e); }
  }
  function draw() {
    clear(list);
    if (!installed.length) { list.append(h("p", { class: "hint", text: "No extensions installed." })); return; }
    for (const ext of installed) {
      const row = h("article", { class: "feature-card" }, h("strong", { text: ext.name }), h("p", { text: ext.description }),
        h("div", { class: "hint", text: `Permissions: ${ext.permissions.join(", ") || "none"} · Events: ${ext.subscriptions.join(", ") || "none"}` }));
      const buttons = h("div", { class: "row" });
      for (const a of ext.actions) {
        const b = h("button", { text: a.label });
        b.addEventListener("click", () => void invoke<string>("extension_run", { id: ext.id, actionId: a.id, input: input.value }).then(result => { message.textContent = result; }).catch(e => { message.textContent = String(e); }));
        buttons.append(b);
      }
      const remove = h("button", { class: "danger", text: "Remove" });
      remove.addEventListener("click", () => { if (confirm(`Remove ${ext.name}?`)) void invoke<Extension[]>("extension_remove", { id: ext.id }).then(items => { installed = items; draw(); }).catch(e => { message.textContent = String(e); }); });
      buttons.append(remove); row.append(buttons); list.append(row);
    }
  }
  async function showEvents() {
    if (!IS_TAURI) return;
    try {
      const events = await invoke<ExtensionEvent[]>("extension_events");
      clear(eventList);
      if (!events.length) { eventList.append(h("p", { class: "hint", text: "No subscribed events yet." })); return; }
      for (const e of events.slice(0, 20)) eventList.append(h("div", { class: "feature-card", text: `${e.extensionId} · ${e.event} · ${e.summary}` }));
    } catch (e) { message.textContent = String(e); }
  }
  refreshEvents.addEventListener("click", () => void showEvents());
  install.addEventListener("click", () => {
    let m: Extension;
    try { m = JSON.parse(manifest.value) as Extension; }
    catch { message.textContent = "Enter valid JSON."; manifest.focus(); return; }
    if (!confirm(`Install ${m.name || "extension"} with permissions: ${(m.permissions || []).join(", ") || "none"}?`)) return;
    install.setAttribute("disabled", "");
    void invoke<Extension[]>("extension_install", { manifestJson: manifest.value }).then(items => { installed = items; manifest.value = ""; message.textContent = "Extension installed."; draw(); }).catch(e => { message.textContent = String(e); }).finally(() => install.removeAttribute("disabled"));
  });
  section.append(intro, manifest, h("div", { class: "row" }, example, install), h("label", {}, "Input for extension actions", input), list,
    h("h3", { text: "Subscribed events" }), refreshEvents, eventList, message);
  void refresh();
  void showEvents();
  return section;
}
