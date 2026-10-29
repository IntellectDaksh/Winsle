import { invoke } from "@tauri-apps/api/core";
import { IS_TAURI } from "../core/bridge";
import { h } from "../views/dom";
import type { ViewHost } from "../views/views";
import { Live } from "./store";
import "./memory.css";

interface Source { id: number; path: string; indexedAt: number; fileCount: number }
interface Hit { path: string; title: string; excerpt: string; score: number }
interface IndexReport { indexed: number; skipped: number }
const native = <T>(cmd: string, args?: Record<string, unknown>) => {
  if (!IS_TAURI) return Promise.reject(new Error("Open Winsle desktop to use private memory."));
  return invoke<T>(cmd, args);
};

export function buildMemoryView(): ViewHost {
  let sources: Source[] = [];
  let busy = false;
  const status = h("div", { class: "mem-status", role: "status", "aria-live": "polite" });
  const sourceInput = h("input", { class: "mem-input", placeholder: "File or folder path to index", "aria-label": "Memory source path" }) as HTMLInputElement;
  const add = h("button", { class: "mem-button primary", text: "Add source" });
  const captures = h("button", { class: "mem-button", text: "Winsle captures" });
  const sessions = h("button", { class: "mem-button", text: "Coding sessions" });
  const clips = h("input", { type: "checkbox", "aria-label": "Include clipboard history in memory search" }) as HTMLInputElement;
  clips.checked = localStorage.getItem("winsle.memory.includeClips") === "true";
  const sourceList = h("div", { class: "mem-sources" });
  const query = h("input", { class: "mem-input", type: "search", placeholder: "Search your selected sources", "aria-label": "Search private memory" }) as HTMLInputElement;
  const search = h("button", { class: "mem-button primary", text: "Search" });
  const resultList = h("div", { class: "mem-results" });
  const clear = h("button", { class: "mem-button danger", text: "Erase index" });

  function message(text: string, error = false) { status.textContent = text; status.classList.toggle("error", error); }
  async function refresh() {
    if (!IS_TAURI) {
      sourceInput.disabled = true; query.disabled = true; clips.disabled = true;
      for (const button of [add, captures, sessions, search, clear]) button.setAttribute("disabled", "");
      drawSources(); message("Open Winsle desktop to index and search private memory.");
      return;
    }
    try { sources = await native<Source[]>("memory_sources"); drawSources(); }
    catch (err) { message(String(err), true); }
  }
  function drawSources() {
    sourceList.replaceChildren();
    if (!sources.length) {
      sourceList.append(h("p", { class: "mem-empty", text: "No sources selected. Add a folder or file to make it searchable on this PC." }));
      return;
    }
    for (const source of sources) {
      const index = h("button", { class: "mem-button", text: "Index", "aria-label": `Index ${source.path}` });
      const remove = h("button", { class: "mem-button quiet", text: "Remove", "aria-label": `Remove ${source.path}` });
      index.onclick = async () => {
        index.setAttribute("disabled", ""); message(`Indexing ${source.path}…`);
        try {
          const report = await native<IndexReport>("memory_reindex", { id: source.id });
          message(`Indexed ${report.indexed} files; skipped ${report.skipped}.`);
          await refresh();
        } catch (err) { message(String(err), true); }
        index.removeAttribute("disabled");
      };
      remove.onclick = async () => {
        if (remove.textContent !== "Confirm remove") { remove.textContent = "Confirm remove"; return; }
        try { await native("memory_remove_source", { id: source.id }); message("Source and indexed content removed."); await refresh(); resultList.replaceChildren(); }
        catch (err) { message(String(err), true); }
      };
      sourceList.append(h("div", { class: "mem-source" },
        h("div", { class: "mem-source-copy" }, h("strong", { text: source.path }), h("small", { text: `${source.fileCount} files · ${source.indexedAt ? `Indexed ${new Date(source.indexedAt * 1000).toLocaleDateString()}` : "Not indexed yet"}` })),
        index, remove));
    }
  }
  add.onclick = async () => {
    const path = sourceInput.value.trim();
    if (!path || busy) { message("Enter a file or folder path.", true); return; }
    busy = true; add.setAttribute("disabled", ""); message("Adding source…");
    try {
      const source = await native<Source>("memory_add_source", { path });
      sourceInput.value = "";
      await refresh();
      message("Source added. Indexing…");
      const report = await native<IndexReport>("memory_reindex", { id: source.id });
      message(`Indexed ${report.indexed} files; skipped ${report.skipped}.`);
      await refresh();
    } catch (err) { message(String(err), true); }
    busy = false; add.removeAttribute("disabled");
  };
  async function addBuiltin(kind: "captures" | "claude") {
    message("Adding source…");
    try {
      const source = await native<Source>("memory_add_builtin", { kind });
      await refresh();
      const report = await native<IndexReport>("memory_reindex", { id: source.id });
      message(`Indexed ${report.indexed} files; skipped ${report.skipped}.`);
      await refresh();
    } catch (err) { message(String(err), true); }
  }
  captures.onclick = () => void addBuiltin("captures");
  sessions.onclick = () => void addBuiltin("claude");
  clips.onchange = () => localStorage.setItem("winsle.memory.includeClips", String(clips.checked));
  async function doSearch() {
    const q = query.value.trim();
    resultList.replaceChildren();
    if (!q) { message("Enter a search phrase.", true); return; }
    search.setAttribute("disabled", ""); message("Searching…");
    try {
      const hits = await native<Hit[]>("memory_search", { query: q });
      const clipHits = clips.checked ? Live.clips.filter((clip) => clip.text.toLocaleLowerCase().includes(q.toLocaleLowerCase())).slice(0, 10) : [];
      if (!hits.length && !clipHits.length) resultList.append(h("p", { class: "mem-empty", text: "No matches in indexed sources or selected clipboard history." }));
      for (const hit of hits) {
        const open = h("button", { class: "mem-result", "aria-label": `Open ${hit.title}` }, h("strong", { text: hit.title }), h("span", { text: hit.excerpt }), h("small", { text: hit.path }));
        open.onclick = async () => {
          try { await native("file_open", { path: hit.path }); }
          catch (err) { message(String(err), true); }
        };
        resultList.append(open);
      }
      for (const clip of clipHits) {
        const copy = h("button", { class: "mem-result", "aria-label": "Copy clipboard result" },
          h("strong", { text: "Clipboard history" }), h("span", { text: clip.text }),
          h("small", { text: new Date(clip.time).toLocaleString() }));
        copy.onclick = async () => { const ok = await Live.copyClip(clip.text); message(ok ? "Copied to clipboard." : "Could not copy.", !ok); };
        resultList.append(copy);
      }
      const count = hits.length + clipHits.length;
      message(`${count} result${count === 1 ? "" : "s"}.`);
    } catch (err) { message(String(err), true); }
    search.removeAttribute("disabled");
  }
  search.onclick = () => void doSearch();
  query.onkeydown = (event) => { event.stopPropagation(); if (event.key === "Enter") void doSearch(); };
  sourceInput.onkeydown = (event) => { event.stopPropagation(); if (event.key === "Enter") add.click(); };
  clear.onclick = async () => {
    if (clear.textContent !== "Confirm erase") { clear.textContent = "Confirm erase"; return; }
    try { await native("memory_clear"); sources = []; drawSources(); resultList.replaceChildren(); clear.textContent = "Erase index"; message("Local memory index erased."); }
    catch (err) { message(String(err), true); }
  };
  const el = h("div", { class: "view lv mem-view" }, h("div", { class: "card mem-card" },
    h("div", { class: "mem-head" }, h("div", {}, h("h2", { text: "Private memory" }), h("p", { text: "Search only what you choose to index." })), clear),
    h("div", { class: "mem-field" }, sourceInput, add),
    h("div", { class: "mem-shortcuts" }, captures, sessions, h("label", { class: "mem-clip-toggle" }, clips, " Include clipboard history")),
    sourceList,
    h("div", { class: "mem-field" }, query, search), status, resultList,
    h("p", { class: "mem-note", text: "Stored locally. Reindex after files change. Removing a source deletes its indexed copy." }),
  ));
  void refresh();
  return { el, sync() {}, focus() { query.focus(); } };
}
