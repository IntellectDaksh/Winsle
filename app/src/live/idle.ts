// The idle capsule: nothing live is taking over the island, so it shows a short
// rotating gist of what is going on — what ai_assistant Code just did, the latest
// notification, the next event, the clock — and after a few quiet seconds fades
// the whole island down to ~78 % opacity.

import { State } from "../core/state";
import { h } from "../views/dom";
import { Live, fmtHM, fmtUntil } from "./store";
import { Dev } from "./dev";

const ROTATE_MS = 6000;
/** Quiet time before the capsule dims. */
export const IDLE_DIM_MS = 7000;
/** A notification stays part of the gist this long. */
const NOTIF_FRESH_MS = 30 * 60_000;
/** An event counts as "coming up" inside this window. */
const EVENT_SOON_MS = 3 * 60 * 60_000;

interface GistItem {
  key: string;
  label: string; // small coloured prefix
  color: string;
  text: string;
}

function clock(): GistItem {
  const d = new Date();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const day = d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  return { key: "clock", label: time, color: "var(--ink)", text: day };
}

/** Everything worth a glance right now, most useful first. */
function gist(): GistItem[] {
  const items: GistItem[] = [];

  const ai_assistant = State.tasks.find((t) => t.id === "integration_ai_assistant");
  if (ai_assistant && (ai_assistant.state !== "idle" || ai_assistant.steps.length)) {
    const step = ai_assistant.steps.at(-1);
    const status =
      ai_assistant.state === "finished" ? "done" :
      ai_assistant.state === "approval" ? "needs you" :
      ai_assistant.state === "error" ? "stopped" :
      ai_assistant.state === "idle" ? "last" : "working";
    const since = Live.ai_assistantSince;
    const mins = since != null && ai_assistant.state !== "idle" ? Math.floor((performance.now() - since) / 60_000) : 0;
    items.push({ key: "ai_assistant", label: `ai_assistant · ${status}${mins > 0 ? ` ${mins}m` : ""}`, color: "#A78BFA", text: step ?? "" });
  }

  const n = Live.notifs.find((x) => !x.noise);
  if (n && Date.now() - n.time < NOTIF_FRESH_MS) {
    items.push({ key: `n${n.id}`, label: n.app, color: "#60A5FA", text: n.title || n.body });
  }
  items.push(...suggestions());

  const now = Date.now();
  const e = Live.calendar.events.find((x) => x.end > now && x.start - now < EVENT_SOON_MS);
  if (e) items.push({ key: `e${e.start}`, label: fmtUntil(e.start), color: "#F5A524", text: e.title || "Busy" });

  const p = Live.power;
  if (p && p.percent != null && !p.charging && p.percent <= 30) {
    items.push({ key: "battery", label: `Battery ${p.percent}%`, color: p.percent <= 15 ? "#F4505E" : "#F5A524", text: "not charging" });
  }
  if (!Live.online) items.push({ key: "net", label: "Offline", color: "#F4505E", text: "no network connection" });
  if (Live.focusing()) items.push({ key: "focus", label: "Focus", color: "#F5A524", text: "notifications held until the timer ends" });

  const m = Live.media;
  if (m && !m.playing && m.title) items.push({ key: "media", label: "Paused", color: "#34D399", text: m.title });

  items.push(clock());
  return items;
}

const TIPS: [string, string][] = [
  ["Ctrl+Alt+K", "palette — apps, maths, timers, web"],
  ["Ctrl+Alt+L", "ghost mode — click straight through me"],
  ["Ctrl+Alt+C", "copy the colour under your cursor"],
  ["Ctrl+Alt+V", "everything you copied today"],
  ["Ctrl+Alt+F", "start a 25 min focus"],
  ["Ctrl+Alt+Space", "jot a task without switching apps"],
];

/** Small, situational nudges built from what Winsle already knows. One at most. */
function suggestions(): GistItem[] {
  const out: GistItem[] = [];
  const s = Dev.session;
  const pct = Dev.contextPct();
  if (s && pct != null && pct >= 70 && s.status !== "idle") {
    out.push({ key: "ctx", label: `Context ${Math.round(pct)}%`, color: "#F5A524", text: "/compact soon keeps ai_assistant sharp" });
  }
  const open = Live.tasks.filter((t) => !t.done);
  if (open.length) out.push({ key: "task", label: `${open.length} open task${open.length > 1 ? "s" : ""}`, color: "#A78BFA", text: open[open.length - 1].text });
  const top = Live.usage[0];
  const total = Live.usageTotal();
  if (total >= 3 * 3600 && Live.focusToday().sessions === 0) {
    out.push({ key: "focus-nudge", label: fmtHM(total), color: "#34D399", text: "on screen today — try one focus block" });
  } else if (top && top.secs >= 2 * 3600) {
    out.push({ key: "top-app", label: top.name, color: "#60A5FA", text: `${fmtHM(top.secs)} today` });
  }
  const f = Live.focusToday();
  if (f.streak > 1) out.push({ key: "streak", label: `${f.streak}-day streak`, color: "#F5A524", text: `${f.minutes} min focused today` });
  // A rotating shortcut tip, about once in every few rounds.
  const tip = TIPS[Math.floor(Date.now() / 600_000) % TIPS.length];
  out.push({ key: `tip${tip[0]}`, label: tip[0], color: "var(--dim)", text: tip[1] });
  return out.slice(0, 2);
}

export class IdleLine {
  readonly el = h("div", { id: "idle-line" });
  private label = h("b", {});
  private text = h("span", { class: "t" });
  private body = h("span", { class: "g" }, this.label, this.text);
  private index = 0;
  private lastRotate = 0;
  private shownKey = "";

  constructor() {
    this.el.append(this.body);
  }

  /** Called on every island sync; rotates every ROTATE_MS, updates text in place. */
  sync(visible: boolean) {
    this.el.classList.toggle("on", visible);
    if (!visible) return;
    const items = gist();
    const now = performance.now();
    if (now - this.lastRotate >= ROTATE_MS) {
      this.lastRotate = now;
      this.index++;
    }
    const item = items[this.index % items.length];
    if (item.key === this.shownKey) {
      // Same item, fresher content (a new ai_assistant step, the clock ticking).
      this.fill(item);
      return;
    }
    const first = this.shownKey === "";
    this.shownKey = item.key;
    if (first) {
      this.fill(item);
      return;
    }
    this.body.classList.add("out");
    window.setTimeout(() => {
      this.fill(item);
      this.body.classList.remove("out");
    }, 260);
  }

  private fill(item: GistItem) {
    this.label.textContent = item.label;
    this.label.style.color = item.color;
    this.text.textContent = item.text;
  }
}
