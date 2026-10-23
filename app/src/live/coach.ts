// Focus guard + screen-time coach. Pushes the block lists and focus state to
// focus_guard.rs (which minimises blocked windows on usage.rs's 5 s sample),
// flashes a daily recap at the user's time and builds the weekly report shown
// under Screen time. Suggestions are plain rules; a running local Ollama only
// rephrases them, never decides them.

import { Bridge, onEvent } from "../core/bridge";
import { State } from "../core/state";
import { h } from "../views/dom";
import { Live, fmtHM } from "./store";
import { load, prefs, save, today } from "./prefs";
import type { AppUsage } from "./types";

export interface FocusGuardPrefs {
  /** Exe names, "Discord" or "discord.exe". */
  apps: string[];
  /** Keywords matched against browser window titles, "YouTube". */
  sites: string[];
  /** "HH:MM" for the daily recap; "" = off. */
  recap: string;
}

export const DEFAULT_GUARD: FocusGuardPrefs = { apps: [], sites: [], recap: "21:00" };

export function guardPrefs(): FocusGuardPrefs {
  return { ...DEFAULT_GUARD, ...load<Partial<FocusGuardPrefs>>("focusGuard", {}) };
}

export function setGuardPrefs(patch: Partial<FocusGuardPrefs>) {
  save("focusGuard", { ...guardPrefs(), ...patch });
}

import {
  parseList,
  cleanBlockItem,
  isRecapDue,
  suggest,
  type WeekReportData,
} from "./coach-utils";

export { parseList, cleanBlockItem, isRecapDue, suggest, type WeekReportData };

export interface WeekReport {
  focusMin: number;
  focusMinLast: number;
  streak: number;
  topApps: AppUsage[];
  distractSecs: number;
  distractSecsLast: number;
  topDistraction: string | null;
  screenSecs: number;
  suggestions: string[];
}

function dayKey(offset: number): string {
  const d = new Date(Date.now() - offset * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const sum = (xs: { totalSecs: number }[]) => xs.reduce((a, d) => a + d.totalSecs, 0);

class CoachCore {
  /** Focus minutes per local day (Live only keeps today). */
  private log: Record<string, number> = load<Record<string, number>>("focusLog", {});
  private pushed = "";
  lastBlocked: { name: string; at: number } | null = null;
  report: WeekReport | null = null;
  private reportAt = 0;
  private rephrased = load<{ day: string; text: string[] }>("coachText", { day: "", text: [] });

  start() {
    void onEvent<{ name: string }>("focus-blocked", (b) => {
      this.lastBlocked = { name: b.name, at: Date.now() };
      Live.setFlash({ icon: "lock", color: "#F5A524", title: "Blocked during focus", sub: `${b.name} · open to allow 5 min`, view: "usage" }, 6000);
    });
    window.setInterval(() => this.tick(), 5000);
    this.tick();
  }

  allow(minutes = 5) {
    void Bridge.focusGuardAllow(minutes);
    this.lastBlocked = null;
    Live.setFlash({ icon: "lock", color: "#94A3B8", title: `Allowed for ${minutes} min`, sub: "Blocking resumes after", view: "usage" }, 2500);
    State.notify();
  }

  private tick() {
    const g = guardPrefs();
    const focus = Live.focusing();
    const key = JSON.stringify([focus, g.apps, g.sites]);
    if (key !== this.pushed) {
      this.pushed = key;
      void Bridge.focusGuardSet(focus, g.apps, g.sites);
    }

    const f = Live.focusToday();
    if ((this.log[f.day] ?? 0) !== f.minutes) {
      this.log[f.day] = f.minutes;
      const keep = new Set(Array.from({ length: 14 }, (_, i) => dayKey(i)));
      for (const d of Object.keys(this.log)) if (!keep.has(d)) delete this.log[d];
      save("focusLog", this.log);
    }

    if (isRecapDue(g.recap, load<string>("recapOn", ""), today())) {
      save("recapOn", today());
      void this.recap();
    }
  }

  private async recap() {
    const [apps, distract] = await Promise.all([Bridge.usageTop(1), Bridge.distractDays(1)]);
    const f = Live.focusToday();
    const screen = (apps ?? []).reduce((a, u) => a + u.secs, 0);
    const parts = [
      `${f.minutes} min focused`,
      screen ? `${fmtHM(screen)} on screen` : "",
      apps?.[0] ? `mostly ${apps[0].name}` : "",
      distract && sum(distract) ? `${fmtHM(sum(distract))} distracted` : "",
    ].filter(Boolean);
    Live.setFlash({ icon: "leaf", color: "#34D399", title: "Today's recap", sub: parts.join(" · "), view: "usage" }, 15000);
  }

  private streak(): number {
    const f = Live.focusToday();
    return f.lastDay === today() || f.lastDay === dayKey(1) ? f.streak : 0;
  }

  /** Weekly numbers, cached for 5 minutes. */
  async weekly(): Promise<WeekReport | null> {
    if (this.report && performance.now() - this.reportAt < 300_000) return this.report;
    const [top, dd, dtop] = await Promise.all([Bridge.usageTop(7), Bridge.distractDays(14), Bridge.distractTop(7)]);
    if (!top || !dd) return null;
    const focus = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => this.log[dayKey(from + i)] ?? 0).reduce((a, b) => a + b, 0);
    const base = {
      focusMin: focus(0, 7),
      focusMinLast: focus(7, 14),
      streak: this.streak(),
      topApps: top.slice(0, 3),
      screenSecs: top.reduce((a, u) => a + u.secs, 0),
      distractSecs: sum(dd.slice(-7)),
      distractSecsLast: sum(dd.slice(0, -7)),
      topDistraction: dtop?.[0]?.name ?? null,
    };
    this.report = { ...base, suggestions: suggest(base) };
    this.reportAt = performance.now();
    void this.rephrase(this.report);
    return this.report;
  }

  /** Suggestions as shown: the local model's wording when it ran today, else the rule text. */
  shown(r: WeekReport): string[] {
    return this.rephrased.day === today() && this.rephrased.text.length === r.suggestions.length ? this.rephrased.text : r.suggestions;
  }

  // Optional polish: only when Ollama is already running; never starts it.
  private async rephrase(r: WeekReport) {
    if (this.rephrased.day === today()) return;
    const st = await Bridge.aiStatus();
    if (!st?.running || !st.models.length) return;
    const model = st.models.find((x) => x === prefs().aiModel) ?? st.models[0];
    try {
      const raw = await Bridge.aiChat(model,
        "Rewrite each suggestion as one short, friendly, plain sentence. Keep every number and app name exactly. Reply as JSON {\"s\":[...]} with the same count.",
        JSON.stringify(r.suggestions), true);
      const s = (JSON.parse(raw ?? "{}") as { s?: unknown }).s;
      if (Array.isArray(s) && s.length === r.suggestions.length && s.every((x) => typeof x === "string" && x.length < 240)) {
        this.rephrased = { day: today(), text: s as string[] };
        save("coachText", this.rephrased);
        State.notify();
      }
    } catch {
      // Rule text stays; the model is a nice-to-have.
    }
  }
}

export const Coach = new CoachCore();

/** Weekly report block for the Screen time view. */
export function coachPanel(): { el: HTMLElement; sync(): void } {
  const allow = h("div", { class: "lv-meta" });
  const stats = h("div", { class: "lv-meta" });
  const tips = h("div", { class: "lv-list" });
  const el = h("div", { class: "lv-list coach" }, allow, stats, tips);
  let key = "";
  return {
    el,
    sync() {
      const b = Coach.lastBlocked && Date.now() - Coach.lastBlocked.at < 120_000 && Live.focusing() ? Coach.lastBlocked : null;
      allow.replaceChildren(...(b ? [h("span", { text: `Blocked ${b.name} · ` }), h("button", { class: "us-limit on", text: "Allow 5 min", onclick: () => Coach.allow(5) })] : []));
      void Coach.weekly().then((r) => {
        if (!r) return;
        const lines = Coach.shown(r);
        const k = JSON.stringify([r, lines]);
        if (k === key) return;
        key = k;
        const d = r.distractSecsLast ? ` (${r.distractSecs >= r.distractSecsLast ? "+" : "−"}${fmtHM(Math.abs(r.distractSecs - r.distractSecsLast))} vs last week)` : "";
        stats.textContent = `This week: ${r.focusMin} min focus${r.streak > 1 ? ` · ${r.streak}-day streak` : ""} · ${fmtHM(r.distractSecs)} distracted${d}${r.topApps.length ? ` · top: ${r.topApps.map((a) => a.name).join(", ")}` : ""}`;
        tips.replaceChildren(...lines.map((t) => h("div", { class: "lv-meta", text: `→ ${t}` })));
      });
    },
  };
}
