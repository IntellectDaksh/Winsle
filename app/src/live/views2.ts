// Larger live views: the coding cockpit, the command palette, screen time and
// the daily recap. Same card language as views.ts; these use the taller layouts
// (VIEW_LAYOUTS) so nothing has to be squeezed into one line.

import { Bridge } from "../core/bridge";
import type { IslandViewName } from "../core/layout";
import { State } from "../core/state";
import { h, svg } from "../views/dom";
import { ICONS } from "../views/icons";
import type { ViewActions, ViewHost } from "../views/views";
import { Dev, contextWindow, fmtDuration, fmtTokens } from "./dev";
import { Live, fmtAgo, fmtHM, fmtTime } from "./store";
import type { AppEntry, DayUsage } from "./types";
import { empty, roundBtn, shell } from "./views";
import { evaluate, convert } from "./calc";
import { Agent } from "./agent";
import { coachPanel } from "./coach";
import { answerBubble } from "./views3";

const STATUS: Record<string, { text: string; cls: string }> = {
  thinking: { text: "Thinking", cls: "think" },
  working: { text: "Working", cls: "work" },
  waiting: { text: "Needs you", cls: "wait" },
  done: { text: "Done", cls: "done" },
  error: { text: "Error", cls: "err" },
  idle: { text: "Idle", cls: "idle" },
};

function chip(cls = ""): { el: HTMLElement; set(text: string | null, title?: string): void } {
  const el = h("span", { class: `dv-chip ${cls}` });
  return {
    el,
    set(text, title = "") {
      el.style.display = text == null ? "none" : "";
      el.textContent = text ?? "";
      el.title = title;
    },
  };
}

// ── Dev cockpit ───────────────────────────────────────────────────────────────

function buildDev(): ViewHost {
  const name = h("span", { class: "dv-name" });
  const status = h("span", { class: "dv-status" });
  const clock = h("span", { class: "dv-clock" });
  const histBtn = h("button", { class: "lv-link", text: "History" });
  const copyBtn = roundBtn(ICONS.copy, "Copy Claude's last reply", async () => {
    const ok = await Dev.copyReply();
    copyBtn.classList.toggle("ok", ok);
    window.setTimeout(() => copyBtn.classList.remove("ok"), 1200);
  });
  const codeBtn = roundBtn(ICONS.code, "Open project in VS Code", () => void Bridge.openInVSCode(Dev.session?.cwd ?? null));
  const prompt = h("div", { class: "dv-prompt" });
  const nowVerb = h("span", { class: "dv-verb" });
  const nowDetail = h("span", { class: "dv-detail" });
  const now = h("div", { class: "dv-now" }, nowVerb, nowDetail);
  const steps = chip();
  const files = chip();
  const cmds = chip();
  const fails = chip("bad");
  const agents = chip();
  const model = chip("model");
  const ctxFill = h("i");
  const ctxText = h("span");
  const ctx = h("span", { class: "dv-ctx", title: "Context window used" }, h("span", { class: "dv-ctx-bar" }, ctxFill), ctxText);
  const list = h("div", { class: "dv-list" });
  const reply = h("div", { class: "dv-reply" });
  const live = h("div", { class: "dv-live" },
    prompt, now,
    h("div", { class: "dv-chips" }, steps.el, files.el, cmds.el, fails.el, agents.el, ctx, model.el),
    list, reply);
  const none = empty("No coding session yet.", "Start Claude Code (terminal or VS Code) or Antigravity — every step shows up here with timing, files and context use.");
  const { el } = shell(
    h("div", { class: "dv-head" }, name, status, clock, h("span", { class: "grow" }), histBtn, copyBtn, codeBtn),
    live, none);
  el.classList.add("dv");

  let showHistory = false;
  histBtn.addEventListener("click", () => {
    showHistory = !showHistory;
    key = "";
    State.notify();
  });
  let key = "";
  let statsFor = "";
  return {
    el,
    sync() {
      const s = Dev.session;
      histBtn.textContent = showHistory ? "Live" : `History${Dev.history.length ? ` · ${Dev.history.length}` : ""}`;
      const hasLive = !!s && !showHistory;
      live.style.display = hasLive || showHistory ? "" : "none";
      none.style.display = !s && !showHistory ? "" : "none";
      copyBtn.style.display = codeBtn.style.display = s ? "" : "none";
      name.textContent = showHistory ? "Recent turns" : s?.project ?? "Coding";
      const st = STATUS[s?.status ?? "idle"];
      status.textContent = showHistory ? "" : st.text;
      status.className = `dv-status ${showHistory ? "hide" : st.cls}`;
      clock.textContent = s && !showHistory ? fmtDuration(Dev.elapsed()) : "";

      if (showHistory) {
        for (const x of [prompt, now, reply]) x.style.display = "none";
        (live.querySelector(".dv-chips") as HTMLElement).style.display = "none";
        const k = `h${Dev.history.map((t) => t.end).join("|")}`;
        if (k !== key) {
          key = k;
          list.replaceChildren(...(Dev.history.length ? Dev.history.map((t) => h("div", { class: "dv-turn" },
            h("i", { class: `dv-dot ${t.outcome}` }),
            h("div", { class: "lv-col" },
              h("div", { class: "lv-name", text: t.prompt || "(no prompt)" }),
              h("div", { class: "lv-meta", text: `${t.project} · ${fmtDuration(t.end - t.start)} · ${t.steps} steps${t.files ? ` · ${t.files} files` : ""}${t.failures ? ` · ${t.failures} failed` : ""} · ${fmtAgo(t.end)}` })),
            t.cwd ? roundBtn(ICONS.code, "Open in VS Code", () => void Bridge.openInVSCode(t.cwd)) : null,
          )) : [h("div", { class: "lv-meta", text: "Finished turns land here." })]));
        }
        return;
      }
      if (!s) return;
      prompt.style.display = s.prompt ? "" : "none";
      prompt.textContent = s.prompt;
      prompt.title = s.prompt;
      (live.querySelector(".dv-chips") as HTMLElement).style.display = "";
      const cur = Dev.current();
      now.style.display = cur || s.status === "thinking" ? "" : "none";
      nowVerb.textContent = cur ? cur.label : "Thinking";
      nowDetail.textContent = cur ? cur.detail : "reading your prompt…";
      now.title = cur ? `${cur.label} ${cur.detail}` : "";
      now.classList.toggle("failed", !!cur?.failed);
      now.classList.toggle("active", s.status === "working" || s.status === "thinking");
      steps.set(`${s.steps.length} steps`);
      files.set(s.files.size ? `${s.files.size} file${s.files.size > 1 ? "s" : ""} changed` : null, [...s.files].join("\n"));
      cmds.set(s.commands ? `${s.commands} command${s.commands > 1 ? "s" : ""}` : null);
      fails.set(s.failures ? `${s.failures} failed` : null);
      agents.set(s.subagents ? `${s.subagents} agent${s.subagents > 1 ? "s" : ""}` : null);
      const pct = Dev.contextPct();
      ctx.style.display = pct == null ? "none" : "";
      if (pct != null && s.stats) {
        ctxFill.style.width = `${pct}%`;
        ctxFill.style.background = pct >= 80 ? "var(--red)" : pct >= 60 ? "var(--amber)" : "var(--green-2)";
        ctxText.textContent = `${fmtTokens(s.stats.contextTokens)} / ${fmtTokens(contextWindow(s.stats.model, s.stats.contextTokens))}`;
      }
      model.set(s.stats?.model ? s.stats.model.replace(/^claude-/, "") : null);
      reply.style.display = s.stats?.lastText && (s.status === "done" || s.status === "error") ? "" : "none";
      reply.textContent = s.stats?.lastText ?? "";

      // Pull the transcript numbers once per change of step count / status.
      const sk = `${s.transcript}|${s.status}|${Math.floor(s.steps.length / 5)}`;
      if (s.transcript && sk !== statsFor) {
        statsFor = sk;
        void Dev.refreshStats();
      }

      const k = `l${s.turnStart}|${s.steps.length}|${s.steps.filter((x) => x.failed).length}`;
      if (k === key) return;
      key = k;
      const shown = s.steps.slice(-30).reverse();
      list.replaceChildren(...shown.map((x) => h("div", { class: x.failed ? "dv-step failed" : "dv-step", title: `${x.label} ${x.detail}` },
        h("span", { class: "t", text: `+${fmtDuration(x.at - s.turnStart)}` }),
        h("span", { class: "v", text: x.label }),
        h("span", { class: "d", text: x.detail }),
        x.failed ? svg(ICONS.xmark, 9) : null)));
    },
  };
}

/** Home card while a session runs: replaces the cramped ticker. */
export function buildDevMini(open: () => void): { el: HTMLElement; sync(): void } {
  const status = h("span", { class: "dv-status" });
  const clock = h("span", { class: "dv-clock" });
  const name = h("span", { class: "dv-name" });
  const line = h("div", { class: "dm-line" });
  const meta = h("div", { class: "dm-meta" });
  const el = h("div", { class: "dm", title: "Open the coding cockpit" },
    h("div", { class: "dm-top" }, name, status), line, h("div", { class: "dm-foot" }, meta, clock));
  el.addEventListener("click", (e) => {
    if ((e.target as Element).closest("button")) return;
    open();
  });
  return {
    el,
    sync() {
      const s = Dev.session;
      if (!s) return;
      name.textContent = s.project;
      const st = STATUS[s.status];
      status.textContent = st.text;
      status.className = `dv-status ${st.cls}`;
      const cur = Dev.current();
      line.textContent = s.status === "thinking" || !cur ? (s.prompt || "Thinking…") : `${cur.label} · ${cur.detail}`;
      line.classList.toggle("failed", !!cur?.failed && s.status === "working");
      meta.textContent = [`${s.steps.length} steps`, s.files.size ? `${s.files.size} files` : "", s.failures ? `${s.failures} failed` : ""].filter(Boolean).join(" · ");
      clock.textContent = fmtDuration(Dev.elapsed());
    },
  };
}

// ── Command palette ───────────────────────────────────────────────────────────

interface Item {
  icon: string;
  title: string;
  sub: string;
  run(): void | Promise<unknown>;
  /** Keep the island open afterwards (copying a result, for instance). */
  stay?: boolean;
}

const VIEWS: [string, IslandViewName, string][] = [
  ["Today", "today", ICONS.star], ["Assistant", "agent", ICONS.sparkle], ["Screen time", "usage", ICONS.chart], ["Coding cockpit", "dev", ICONS.code],
  ["Timer", "timer", ICONS.timer], ["Calendar", "calendar", ICONS.calendar], ["Clipboard", "clips", ICONS.clipboard],
  ["Notifications", "notifs", ICONS.bell], ["Downloads", "files", ICONS.download], ["System", "system", ICONS.chip],
  ["Now playing", "media", ICONS.music], ["Quick capture", "capture", ICONS.pencil],
];

const SYSTEM: [string, string, "lock" | "snip" | "settings" | "taskmgr", string][] = [
  ["Lock PC", "lock computer screen", "lock", ICONS.lock],
  ["Screenshot", "snip snipping capture screen", "snip", ICONS.search],
  ["Windows Settings", "settings preferences", "settings", ICONS.gear],
  ["Task Manager", "task manager processes kill", "taskmgr", ICONS.chip],
];

const WEB: Record<string, [string, string]> = {
  g: ["Google", "https://www.google.com/search?q="],
  yt: ["YouTube", "https://www.youtube.com/results?search_query="],
  gh: ["GitHub", "https://github.com/search?q="],
  w: ["Wikipedia", "https://en.wikipedia.org/w/index.php?search="],
  maps: ["Maps", "https://www.google.com/maps/search/"],
};

/** Prefix > word start > anywhere > in-order letters; 0 = no match. */
export function fuzzy(text: string, q: string): number {
  const t = text.toLowerCase();
  if (!q) return 1;
  if (t.startsWith(q)) return 100 - t.length / 100;
  if (t.split(/[\s\-_.]+/).some((w) => w.startsWith(q))) return 80 - t.length / 100;
  if (t.includes(q)) return 60 - t.length / 100;
  let i = 0;
  for (const c of t) if (c === q[i]) i++;
  return i === q.length ? 30 - t.length / 100 : 0;
}

function buildPalette(actions: ViewActions): ViewHost {
  const input = h("input", {
    class: "lv-input pl-input", type: "text", spellcheck: "false", autocomplete: "off",
    placeholder: "Search apps, projects, clips… or type 12*8, 5 km to mi, 25 (timer), g query",
  }) as HTMLInputElement;
  const list = h("div", { class: "pl-list" });
  const hint = h("div", { class: "pl-hint", text: "↑↓ to move · Enter to run · Esc to close · start with ? to ask Winsle" });
  const answer = answerBubble();
  answer.show(null);
  const { el } = shell(h("div", { class: "pl-field" }, svg(ICONS.search, 13), input), answer.el, list, hint);
  let recent: { name: string; path: string; time: number }[] = [];
  el.classList.add("pl");

  let apps: AppEntry[] = [];
  let items: Item[] = [];
  let sel = 0;

  const go = (v: IslandViewName) => () => actions.setView(v);
  const web = (url: string) => () => actions.openUrl(url);

  function results(raw: string): Item[] {
    const q = raw.trim();
    const ql = q.toLowerCase();
    const out: Item[] = [];
    if (!q) {
      for (const p of Dev.recentProjects().slice(0, 3)) {
        out.push({ icon: ICONS.code, title: p.project, sub: `Open in VS Code · ${p.cwd}`, run: () => Bridge.openInVSCode(p.cwd) });
      }
      for (const [title, v, icon] of VIEWS.slice(0, 5)) out.push({ icon, title, sub: "Winsle", run: go(v) });
      return out;
    }

    // "?" or a sentence the rules understand: the assistant handles it.
    const asking = /^(\?|ask\s)/i.test(q);
    const ruleHit = !asking && /^(remind me|timer \d|start focus|focus|pause|play|next|volume|dnd|quiet|what'?s next|my day|journal|add task|todo )/i.test(q);
    if (asking || ruleHit) {
      out.push({ icon: ICONS.sparkle, title: asking ? `Ask Winsle: ${q.replace(/^(\?|ask)\s*/i, "")}` : q, sub: "Assistant", stay: true, run: async () => {
        answer.show(null, true);
        answer.show(await Agent.ask(q));
      } });
      if (asking) return out;
    }
    for (const s of Agent.snippets) {
      if (fuzzy(s.name, ql.replace(/^;/, ""))) out.push({ icon: ICONS.copy, title: `;${s.name}`, sub: `Snippet · ${s.text.slice(0, 60)}`, stay: true, run: () => Live.copyClip(s.text) });
    }

    const value = evaluate(q);
    if (value != null) {
      out.push({ icon: ICONS.calc, title: `= ${value}`, sub: "Enter copies the result", stay: true, run: () => Live.copyClip(value) });
    }
    const conv = convert(q);
    if (conv) out.push({ icon: ICONS.calc, title: conv, sub: "Enter copies", stay: true, run: () => Live.copyClip(conv.split(" ")[0]) });

    const mins = /^(\d{1,3})\s*(m|min|mins|minutes)?$/i.exec(q);
    if (mins) out.push({ icon: ICONS.timer, title: `Start a ${mins[1]} min timer`, sub: "Timer", run: () => { Live.rememberCustom(+mins[1]); Live.startCountdown(+mins[1], `${mins[1]} min`); actions.setView("timer"); } });
    if ("focus".startsWith(ql) && ql.length >= 2) out.push({ icon: ICONS.timer, title: "Start a 25 min focus session", sub: "Timer", run: () => { Live.startFocus(); actions.setView("timer"); } });

    const note = /^(note|todo|n|>)\s+(.+)$/i.exec(q);
    if (note) out.push({ icon: ICONS.pencil, title: `Save “${note[2]}”`, sub: "Adds a task to inbox.md", run: () => Live.saveCapture(note[2]) });

    const w = /^(\S+)\s+(.+)$/.exec(q);
    if (w && WEB[w[1].toLowerCase()]) {
      const [site, base] = WEB[w[1].toLowerCase()];
      out.push({ icon: ICONS.globe, title: `${site}: ${w[2]}`, sub: "Search the web", run: web(base + encodeURIComponent(w[2])) });
    }
    if (/^https?:\/\/\S+$/i.test(q)) out.push({ icon: ICONS.globe, title: q, sub: "Open link", run: web(q) });

    const scored: [number, Item][] = [];
    for (const a of apps) {
      const sc = fuzzy(a.name, ql);
      if (sc) scored.push([sc + 5, { icon: ICONS.grid, title: a.name, sub: "App", run: () => Bridge.appLaunch(a.path) }]);
    }
    for (const f of recent) {
      const sc = ql.length >= 2 ? fuzzy(f.name, ql) : 0;
      if (sc) scored.push([sc + 2, { icon: ICONS.doc, title: f.name, sub: `Recent file · ${fmtAgo(f.time)}`, run: () => Bridge.recentOpen(f.path) }]);
    }
    for (const p of Dev.recentProjects()) {
      const sc = fuzzy(p.project, ql);
      if (sc) scored.push([sc + 8, { icon: ICONS.code, title: p.project, sub: `Project · ${p.cwd}`, run: () => Bridge.openInVSCode(p.cwd) }]);
    }
    for (const [title, v, icon] of VIEWS) {
      const sc = fuzzy(title, ql);
      if (sc) scored.push([sc, { icon, title, sub: "Winsle", run: go(v) }]);
    }
    for (const [title, words, act, icon] of SYSTEM) {
      const sc = Math.max(fuzzy(title, ql), ql.length >= 3 && words.includes(ql) ? 50 : 0);
      if (sc) scored.push([sc, { icon, title, sub: "System", run: () => Bridge.systemAction(act) }]);
    }
    const lockTitle = Live.locked ? "Unlock island" : "Lock island (ghost mode)";
    if (fuzzy(lockTitle, ql) || "ghost".startsWith(ql)) scored.push([40, { icon: ICONS.lock, title: lockTitle, sub: "Ctrl+Alt+L", run: () => { window.dispatchEvent(new CustomEvent("winsle-lock")); } }]);
    if (fuzzy("Do not disturb", ql)) scored.push([40, { icon: ICONS.moon, title: Live.dnd ? "Turn off do not disturb" : "Do not disturb", sub: "Notifications", run: () => Live.setDnd(!Live.dnd) }]);
    for (const c of Live.clips) {
      if (ql.length >= 2 && c.text.toLowerCase().includes(ql)) {
        scored.push([20, { icon: ICONS.clipboard, title: c.text, sub: `Clipboard · ${fmtAgo(c.time)}`, stay: true, run: () => Live.copyClip(c.text) }]);
      }
    }
    scored.sort((a, b) => b[0] - a[0]);
    out.push(...scored.slice(0, 8).map((x) => x[1]));
    if (q.split(/\s+/).length >= 3 && !value && !ruleHit) {
      out.push({ icon: ICONS.sparkle, title: `Ask Winsle: ${q}`, sub: "Local assistant", stay: true, run: async () => {
        answer.show(null, true);
        answer.show(await Agent.ask(q));
      } });
    }
    if (!w || !WEB[w[1].toLowerCase()]) {
      out.push({ icon: ICONS.globe, title: `Search Google for “${q}”`, sub: "Web", run: web(WEB.g[1] + encodeURIComponent(q)) });
    }
    return out.slice(0, 10);
  }

  function render() {
    items = results(input.value);
    sel = Math.min(sel, Math.max(0, items.length - 1));
    list.replaceChildren(...items.map((it, i) => {
      const row = h("div", { class: i === sel ? "pl-item on" : "pl-item", role: "option" },
        h("span", { class: "pl-ic" }, svg(it.icon, 12)),
        h("span", { class: "lv-col" }, h("span", { class: "pl-t", text: it.title }), h("span", { class: "pl-s", text: it.sub })),
        i === sel ? h("span", { class: "kbd", text: "↵" }) : null);
      row.addEventListener("mousemove", () => {
        if (sel === i) return;
        sel = i;
        render();
      });
      row.addEventListener("click", () => void runItem(i));
      return row;
    }));
    (list.children[sel] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
  }

  async function runItem(i: number) {
    const it = items[i];
    if (!it) return;
    try {
      await it.run();
      if (it.stay) {
        hint.textContent = it.icon === ICONS.sparkle ? "" : "Copied.";
        return;
      }
      input.value = "";
      if (State.view === "palette") actions.collapse();
    } catch (err) {
      hint.textContent = String(err).replace(/^Error:\s*/, "");
    }
  }

  input.addEventListener("input", () => {
    sel = 0;
    answer.show(null);
    hint.textContent = "↑↓ to move · Enter to run · Esc to close";
    render();
  });
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = items.length || 1;
      sel = (sel + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
      render();
    } else if (e.key === "Enter") {
      e.preventDefault();
      void runItem(sel);
    } else if (e.key === "Escape") {
      input.value = "";
      actions.collapse();
    }
  });

  return {
    el,
    focus() {
      input.focus();
      input.select();
      if (!apps.length) void Bridge.appsList().then((a) => { apps = a ?? []; render(); });
      void Bridge.recentFiles().then((r) => { recent = r ?? []; });
      answer.show(null);
      render();
    },
    sync() {},
  };
}

// ── Screen time ───────────────────────────────────────────────────────────────

const LIMIT_STEPS = [0, 30, 60, 120, 180];

function buildUsage(): ViewHost {
  const total = h("span", { class: "us-total" });
  const sub = h("span", { class: "lv-meta" });
  const week = h("div", { class: "us-week" });
  const list = h("div", { class: "lv-list scroll us-list" });
  const coach = coachPanel();
  const { el } = shell(h("div", { class: "us-head" }, h("div", { class: "lv-col" }, total, sub), week), list, coach.el);
  el.classList.add("us");
  let days: DayUsage[] = [];
  let daysAt = 0;
  let key = "";
  return {
    el,
    sync() {
      void Live.loadUsage();
      coach.sync();
      if (performance.now() - daysAt > 120_000 || !daysAt) {
        daysAt = performance.now();
        void Bridge.usageDays(7).then((d) => { days = d ?? []; key = ""; State.notify(); });
      }
      const tot = Live.usageTotal();
      total.textContent = tot ? fmtHM(tot) : "—";
      const avg = days.length > 1 ? days.slice(0, -1).reduce((a, d) => a + d.totalSecs, 0) / Math.max(1, days.slice(0, -1).filter((d) => d.totalSecs).length) : 0;
      sub.textContent = tot ? `screen time today${avg ? ` · ${tot > avg ? "above" : "below"} your ${fmtHM(avg)} average` : ""}` : "Counting starts now — active use only, idle time is skipped.";
      const k = Live.usage.map((u) => `${u.name}${Math.round(u.secs / 60)}`).join("|") + JSON.stringify(Live.limits) + days.map((d) => d.totalSecs).join(",");
      if (k === key) return;
      key = k;
      const maxDay = Math.max(1, ...days.map((d) => d.totalSecs));
      week.replaceChildren(...days.map((d, i) => h("div", { class: i === days.length - 1 ? "us-day today" : "us-day", title: `${d.day}: ${fmtHM(d.totalSecs)}` },
        h("i", { style: `height:${Math.max(6, (d.totalSecs / maxDay) * 100)}%` }),
        h("span", { text: new Date(`${d.day}T12:00`).toLocaleDateString([], { weekday: "narrow" }) }))));
      const top = Live.usage.slice(0, 8);
      const max = Math.max(1, ...top.map((u) => u.secs));
      list.replaceChildren(...(top.length ? top.map((u) => {
        const lim = Live.limits[u.name] ?? 0;
        const over = lim > 0 && u.secs >= lim * 60;
        const limBtn = h("button", {
          class: lim ? "us-limit on" : "us-limit", title: "Daily limit — click to change",
          text: lim ? `${lim}m limit` : "limit",
          onclick: () => Live.setLimit(u.name, LIMIT_STEPS[(LIMIT_STEPS.indexOf(lim) + 1) % LIMIT_STEPS.length]),
        });
        return h("div", { class: over ? "us-row over" : "us-row" },
          h("span", { class: "n", text: u.name }),
          h("div", { class: "lv-track" }, h("i", { style: `width:${(u.secs / max) * 100}%` })),
          h("span", { class: "v", text: fmtHM(u.secs) }),
          limBtn);
      }) : [h("div", { class: "lv-meta", text: "No app time recorded yet today." })]));
    },
  };
}

// ── Today (daily recap) ───────────────────────────────────────────────────────

function tile(icon: string, label: string, view: IslandViewName, actions: ViewActions): { el: HTMLElement; big: HTMLElement; sub: HTMLElement } {
  const big = h("div", { class: "td-big" });
  const sub = h("div", { class: "td-sub" });
  const el = h("button", { class: "td-tile", onclick: () => actions.setView(view) },
    h("div", { class: "w-head" }, svg(icon, 10), h("span", { text: label })), big, sub);
  return { el, big, sub };
}

function buildToday(actions: ViewActions): ViewHost {
  const date = h("div", { class: "td-date" });
  const greet = h("div", { class: "lv-meta" });
  const focus = tile(ICONS.timer, "Focus", "timer", actions);
  const screen = tile(ICONS.chart, "Screen time", "usage", actions);
  const code = tile(ICONS.code, "Coding", "dev", actions);
  const tasks = tile(ICONS.box, "Tasks", "capture", actions);
  const cal = tile(ICONS.calendar, "Calendar", "calendar", actions);
  const files = tile(ICONS.download, "Downloads", "files", actions);
  const clips = tile(ICONS.clipboard, "Copied", "clips", actions);
  const notifs = tile(ICONS.bell, "Notifications", "notifs", actions);
  const { el } = shell(h("div", { class: "td-head" }, date, greet),
    h("div", { class: "td-grid" }, focus.el, screen.el, code.el, tasks.el, cal.el, files.el, clips.el, notifs.el));
  el.classList.add("td");
  return {
    el,
    sync() {
      void Live.loadUsage();
      const now = new Date();
      date.textContent = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
      const hr = now.getHours();
      greet.textContent = hr < 5 ? "Late one — go easy." : hr < 12 ? "Good morning." : hr < 17 ? "Good afternoon." : hr < 22 ? "Good evening." : "Winding down?";
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const t0 = start.getTime();

      const f = Live.focusToday();
      focus.big.textContent = f.minutes ? `${f.minutes}m` : "0m";
      focus.sub.textContent = f.sessions ? `${f.sessions} session${f.sessions > 1 ? "s" : ""}${f.streak > 1 ? ` · ${f.streak}-day streak` : ""}` : "No sessions yet";

      const tot = Live.usageTotal();
      screen.big.textContent = tot ? fmtHM(tot) : "—";
      screen.sub.textContent = Live.usage[0] ? `Most: ${Live.usage[0].name}` : "Active use only";

      const d = Dev.today();
      code.big.textContent = d.turns ? fmtDuration(d.ms) : "—";
      code.sub.textContent = d.turns ? `${d.turns} turn${d.turns > 1 ? "s" : ""} · ${d.files} files` : "No sessions today";

      const open = Live.tasks.filter((x) => !x.done).length;
      const done = Live.tasks.filter((x) => x.done).length;
      tasks.big.textContent = String(open);
      tasks.sub.textContent = `open · ${done} done`;

      const left = Live.calendar.events.filter((e) => e.start > Date.now() && e.start < t0 + 86_400_000);
      cal.big.textContent = String(left.length);
      cal.sub.textContent = left[0] ? `Next ${fmtTime(left[0].start)}` : "Nothing left today";

      const dl = Live.finished.filter((x) => x.time >= t0);
      files.big.textContent = String(dl.length);
      files.sub.textContent = dl[0] ? dl[0].name : "finished today";

      const cp = Live.clips.filter((c) => c.time >= t0).length;
      clips.big.textContent = String(cp);
      clips.sub.textContent = Live.colors.length ? `${Live.colors.length} colours saved` : "texts copied";

      notifs.big.textContent = String(Live.notifs.length);
      notifs.sub.textContent = Live.quietReason() ?? (Live.mutedApps.length ? `${Live.mutedApps.length} muted` : "in the list");
    },
  };
}

// ── More (launcher) ───────────────────────────────────────────────────────────

function buildMore(actions: ViewActions): ViewHost {
  const defs: [IslandViewName | "lock", string, string, () => string][] = [
    ["agent", ICONS.sparkle, "Assistant", () => (Agent.reminders[0] ? `Next: ${Agent.reminders[0].text}` : "Ask, remind, automate")],
    ["today", ICONS.star, "Today", () => new Date().toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })],
    ["usage", ICONS.chart, "Screen time", () => (Live.usageTotal() ? fmtHM(Live.usageTotal()) : "Active use")],
    ["files", ICONS.download, "Downloads", () => {
      const a = Live.activeDownloads();
      return a.length ? `${a.length} running` : Live.finished[0] ? `Last: ${Live.finished[0].name}` : "Nothing running";
    }],
    ["system", ICONS.chip, "System", () => (Live.sys ? `CPU ${Math.round(Live.sys.cpu)}% · RAM ${Math.round(Live.sys.ramPct)}%` : "Reading…")],
    ["capture", ICONS.pencil, "Capture", () => {
      const n = Live.tasks.filter((t) => !t.done).length;
      return n ? `${n} open task${n > 1 ? "s" : ""}` : "Inbox clear";
    }],
    ["clips", ICONS.clipboard, "Clipboard", () => (Live.clips[0] ? Live.clips[0].text : "Nothing copied")],
    ["palette", ICONS.search, "Search", () => "Ctrl+Alt+K"],
    ["lock", ICONS.lock, "Ghost mode", () => "Ctrl+Alt+L"],
  ];
  const subs: { el: HTMLElement; fn: () => string }[] = [];
  const grid = h("div", { class: "mo-grid" }, ...defs.map(([v, icon, label, fn]) => {
    const sub = h("span", { class: "mo-sub" });
    subs.push({ el: sub, fn });
    return h("button", {
      class: "mo-tile",
      onclick: () => {
        actions.blip();
        if (v === "lock") window.dispatchEvent(new CustomEvent("winsle-lock"));
        else actions.setView(v);
      },
    }, h("span", { class: "mo-ic" }, svg(icon, 14)), h("span", { class: "mo-label", text: label }), sub);
  }));
  const { el } = shell(grid);
  el.classList.add("mo");
  return {
    el,
    sync() {
      void Live.loadUsage();
      for (const s of subs) s.el.textContent = s.fn();
    },
  };
}

export function buildMoreViews(actions: ViewActions, map: Map<IslandViewName, ViewHost>) {
  map.set("more", buildMore(actions));
  map.set("dev", buildDev());
  map.set("palette", buildPalette(actions));
  map.set("usage", buildUsage());
  map.set("today", buildToday(actions));
}

