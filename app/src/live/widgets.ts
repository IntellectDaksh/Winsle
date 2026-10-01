// Home (overview) widget tiles, chosen in Settings → Home. Each tile is a small
// card that opens its full live view on click; buttons inside act in place.

import { Bridge } from "../core/bridge";
import type { IslandViewName } from "../core/layout";
import { State } from "../core/state";
import { h, svg, clear } from "../views/dom";
import { ICONS } from "../views/icons";
import type { ViewActions } from "../views/views";
import { Live, fmtAgo, fmtBytes, fmtClock, fmtTime, fmtUntil } from "./store";

export type WidgetKind = "media" | "calendar" | "timer" | "system" | "files" | "notifs" | "clips" | "inbox" | "integrations";

export const WIDGET_LABELS: Record<WidgetKind, string> = {
  media: "Now playing",
  calendar: "Next event",
  timer: "Timer",
  system: "System",
  files: "Downloads & renders",
  notifs: "Latest notification",
  clips: "Last copied",
  inbox: "Inbox tasks",
  integrations: "Integrations (pills)",
};

export const DEFAULT_HOME_WIDGETS: WidgetKind[] = ["media", "calendar", "integrations"];

export interface Widget {
  el: HTMLElement;
  sync(): void;
}

const VIEW_FOR: Record<WidgetKind, IslandViewName | null> = {
  media: "media", calendar: "calendar", timer: "timer", system: "system",
  files: "files", notifs: "notifs", clips: "clips", inbox: "capture", integrations: null,
};

function tile(kind: WidgetKind, actions: ViewActions, ...children: Node[]): HTMLElement {
  const view = VIEW_FOR[kind];
  const el = h("div", { class: `card wtile w-${kind}` }, ...children);
  if (view) {
    el.addEventListener("click", (e) => {
      if ((e.target as Element).closest("button")) return;
      actions.blip();
      actions.setView(view);
    });
  }
  return el;
}

function head(icon: string, label: string): HTMLElement {
  return h("div", { class: "w-head" }, svg(icon, 10), h("span", { text: label }));
}

function mini(icon: string, title: string, onClick: () => void): HTMLElement {
  return h("button", {
    class: "live-btn", title,
    onclick: (e: Event) => {
      e.stopPropagation();
      onClick();
    },
  }, svg(icon, 12));
}

function lines(): { box: HTMLElement; a: HTMLElement; b: HTMLElement } {
  const a = h("div", { class: "w-a" });
  const b = h("div", { class: "w-b" });
  return { box: h("div", { class: "w-lines" }, a, b), a, b };
}

function buildMedia(actions: ViewActions): Widget {
  const art = h("div", { class: "w-art" });
  const { box, a, b } = lines();
  const eq = h("div", { class: "eq" }, h("i"), h("i"), h("i"), h("i"));
  const btns = h("div", { class: "w-btns" });
  const el = tile("media", actions, head(ICONS.music, "Now playing"), h("div", { class: "w-row" }, art, box), h("div", { class: "w-foot" }, eq, btns));
  let artSrc: string | null | undefined;
  let playing: boolean | null = null;
  return {
    el,
    sync() {
      const m = Live.media;
      el.classList.toggle("idle", !m);
      if (!m) {
        a.textContent = "Nothing playing";
        b.textContent = "Spotify, YouTube…";
        art.style.backgroundImage = "";
        artSrc = undefined;
        playing = null;
        clear(btns);
        eq.classList.remove("on");
        return;
      }
      a.textContent = m.title || m.app;
      b.textContent = m.artist || m.app;
      eq.classList.toggle("on", m.playing);
      if (m.art !== artSrc) {
        artSrc = m.art;
        art.style.backgroundImage = m.art ? `url("${m.art}")` : "";
        art.replaceChildren(...(m.art ? [] : [svg(ICONS.music, 15)]));
      }
      if (m.playing !== playing) {
        playing = m.playing;
        btns.replaceChildren(
          mini(m.playing ? ICONS.pause : ICONS.play, "Play/pause", () => void Bridge.mediaControl("play_pause")),
          mini(ICONS.next, "Next", () => void Bridge.mediaControl("next")),
        );
      }
    },
  };
}

function buildCalendar(actions: ViewActions): Widget {
  const time = h("div", { class: "w-big" });
  const { box, a, b } = lines();
  const join = h("button", { class: "btn primary w-join", text: "Join" });
  let joinUrl: string | null = null;
  join.addEventListener("click", (e) => {
    e.stopPropagation();
    if (joinUrl) actions.openUrl(joinUrl);
  });
  const el = tile("calendar", actions, head(ICONS.calendar, "Next"), time, box, join);
  return {
    el,
    sync() {
      const now = Date.now();
      const e = Live.calendar.events.find((x) => x.end > now) ?? null;
      el.classList.toggle("idle", !e);
      joinUrl = e?.joinUrl ?? null;
      join.style.display = e?.joinUrl && e.start - now < 15 * 60_000 ? "" : "none";
      if (!e) {
        time.textContent = "—";
        a.textContent = Live.calendar.error ? "Calendar unavailable" : "Free for 24 h";
        b.textContent = Live.calendar.error ? "Check Settings → Live" : "Nothing scheduled";
        return;
      }
      time.textContent = fmtTime(e.start);
      a.textContent = e.title || "Busy";
      b.textContent = fmtUntil(e.start);
    },
  };
}

function buildTimer(actions: ViewActions): Widget {
  const clock = h("div", { class: "w-big mono" });
  const { box, a } = lines();
  const btns = h("div", { class: "w-btns" });
  const el = tile("timer", actions, head(ICONS.timer, "Timer"), clock, box, h("div", { class: "w-foot" }, btns));
  let key = "";
  return {
    el,
    sync() {
      const t = Live.timer;
      clock.textContent = t ? fmtClock(Live.timerMs()) : "25:00";
      clock.classList.toggle("dim", !t || !t.running);
      const f = Live.focusToday();
      a.textContent = t ? (t.done ? "Time's up" : t.label) : f.sessions ? `${f.sessions} done · ${f.minutes} min` : "Focus session";
      const k = t ? `${t.running}|${t.done}` : "none";
      if (k === key) return;
      key = k;
      if (!t) btns.replaceChildren(mini(ICONS.play, "Start a 25 min focus", () => Live.startCountdown(25, "Focus", { label: "Break", minutes: 5 })));
      else if (t.done) btns.replaceChildren(mini(ICONS.check, "Done", () => Live.clearTimer()));
      else btns.replaceChildren(
        mini(t.running ? ICONS.pause : ICONS.play, "Pause/resume", () => Live.toggleTimer()),
        mini(ICONS.reset, "Reset", () => Live.clearTimer()),
      );
    },
  };
}

function bar(label: string): { el: HTMLElement; set(p: number | null, t: string): void } {
  const fill = h("i");
  const v = h("span", { class: "v" });
  const el = h("div", { class: "w-meter" }, h("span", { text: label }), h("div", { class: "lv-track" }, fill), v);
  return {
    el,
    set(p, t) {
      el.style.display = p == null ? "none" : "";
      if (p == null) return;
      fill.style.width = `${Math.max(2, Math.min(100, p))}%`;
      fill.style.background = p >= 90 ? "var(--red)" : p >= 70 ? "var(--amber)" : "var(--green-2)";
      v.textContent = t;
    },
  };
}

function buildSystem(actions: ViewActions): Widget {
  const cpu = bar("CPU");
  const ram = bar("RAM");
  const gpu = bar("GPU");
  const el = tile("system", actions, head(ICONS.chip, "System"), h("div", { class: "w-meters" }, cpu.el, ram.el, gpu.el));
  return {
    el,
    sync() {
      const s = Live.sys;
      cpu.set(s?.cpu ?? null, `${Math.round(s?.cpu ?? 0)}%`);
      ram.set(s?.ramPct ?? null, `${Math.round(s?.ramPct ?? 0)}%`);
      gpu.set(s?.gpuTemp != null ? s.gpuTemp : null, `${Math.round(s?.gpuTemp ?? 0)}°`);
    },
  };
}

function buildFiles(actions: ViewActions): Widget {
  const { box, a, b } = lines();
  const track = h("div", { class: "lv-track" }, h("i"));
  const el = tile("files", actions, head(ICONS.download, "Downloads"), box, track);
  return {
    el,
    sync() {
      const items = Live.activeDownloads();
      const f = items[0];
      el.classList.toggle("idle", !f);
      track.style.visibility = f ? "visible" : "hidden";
      track.classList.toggle("indeterminate", !!f && !f.totalBytes);
      if (!f) {
        const last = Live.progress.find((p) => p.done);
        a.textContent = last ? last.name : "Nothing running";
        b.textContent = last ? "Finished" : "Watching Downloads";
        return;
      }
      a.textContent = items.length > 1 ? `${f.name} +${items.length - 1}` : f.name;
      b.textContent = `${fmtBytes(f.bytes)} · ${fmtBytes(f.speed)}/s`;
      (track.firstElementChild as HTMLElement).style.width = f.totalBytes ? `${(f.bytes / f.totalBytes) * 100}%` : "";
    },
  };
}

function buildNotifs(actions: ViewActions): Widget {
  const { box, a, b } = lines();
  const meta = h("div", { class: "w-b" });
  const el = tile("notifs", actions, head(ICONS.bell, "Latest"), box, meta);
  return {
    el,
    sync() {
      const n = Live.notifs[0];
      el.classList.toggle("idle", !n);
      a.textContent = n ? n.app : "All quiet";
      b.textContent = n ? n.title || n.body : "No new notifications";
      meta.textContent = n ? `${fmtTime(n.time)}${Live.notifs.length > 1 ? ` · +${Live.notifs.length - 1} more` : ""}` : "";
    },
  };
}

function buildClips(actions: ViewActions): Widget {
  const { box, a, b } = lines();
  const btns = h("div", { class: "w-btns" });
  const el = tile("clips", actions, head(ICONS.clipboard, "Copied"), box, h("div", { class: "w-foot" }, btns));
  let key = "";
  return {
    el,
    sync() {
      const c = Live.clips.find((x) => !x.pinned) ?? Live.clips[0];
      el.classList.toggle("idle", !c);
      a.textContent = c ? c.text : "Nothing yet";
      b.textContent = c ? fmtAgo(c.time) : "Copy any text";
      const k = c ? c.text : "";
      if (k === key) return;
      key = k;
      btns.replaceChildren(...(c ? [mini(ICONS.clipboard, "Copy again", () => void Live.copyClip(c.text))] : []));
    },
  };
}

function buildInbox(actions: ViewActions): Widget {
  const big = h("div", { class: "w-big" });
  const { box, a, b } = lines();
  const el = tile("inbox", actions, head(ICONS.box, "Inbox"), big, box);
  return {
    el,
    sync() {
      const open = Live.tasks.filter((t) => !t.done);
      el.classList.toggle("idle", !open.length);
      big.textContent = String(open.length);
      a.textContent = open.length ? open[open.length - 1].text : "All done";
      b.textContent = open.length ? "open tasks" : "Ctrl+Alt+Space to add";
    },
  };
}

export function buildWidget(
  kind: WidgetKind,
  actions: ViewActions,
  pills: () => HTMLElement,
): Widget {
  switch (kind) {
    case "media": return buildMedia(actions);
    case "calendar": return buildCalendar(actions);
    case "timer": return buildTimer(actions);
    case "system": return buildSystem(actions);
    case "files": return buildFiles(actions);
    case "notifs": return buildNotifs(actions);
    case "clips": return buildClips(actions);
    case "inbox": return buildInbox(actions);
    case "integrations": {
      const el = h("div", { class: "card wtile w-integrations" }, pills());
      return { el, sync() {} };
    }
  }
}

/** Settings value → valid, de-duplicated list of at most three tiles. */
export function homeWidgets(): WidgetKind[] {
  const raw = State.settings.homeWidgets ?? DEFAULT_HOME_WIDGETS;
  const valid = raw.filter((k): k is WidgetKind => k in WIDGET_LABELS);
  return [...new Set(valid)].slice(0, 3);
}
