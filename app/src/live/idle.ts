// The idle capsule: nothing live is taking over the island, so it shows a short
// rotating gist of what is going on — what ai-assistant Code just did, the latest
// notification, the next event, the clock — and after a few quiet seconds fades
// the whole island down to ~78 % opacity.

import { State } from "../core/state";
import { h } from "../views/dom";
import { Live, fmtUntil } from "./store";

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

  const ai-assistant = State.tasks.find((t) => t.id === "integration_ai-assistant");
  if (ai-assistant && (ai-assistant.state !== "idle" || ai-assistant.steps.length)) {
    const step = ai-assistant.steps.at(-1);
    const status =
      ai-assistant.state === "finished" ? "done" :
      ai-assistant.state === "approval" ? "needs you" :
      ai-assistant.state === "error" ? "stopped" :
      ai-assistant.state === "idle" ? "last" : "working";
    const since = Live.ai-assistantSince;
    const mins = since != null && ai-assistant.state !== "idle" ? Math.floor((performance.now() - since) / 60_000) : 0;
    items.push({ key: "ai-assistant", label: `ai-assistant · ${status}${mins > 0 ? ` ${mins}m` : ""}`, color: "#A78BFA", text: step ?? "" });
  }

  const n = Live.notifs[0];
  if (n && Date.now() - n.time < NOTIF_FRESH_MS) {
    items.push({ key: `n${n.id}`, label: n.app, color: "#60A5FA", text: n.title || n.body });
  }

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
      // Same item, fresher content (a new ai-assistant step, the clock ticking).
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
