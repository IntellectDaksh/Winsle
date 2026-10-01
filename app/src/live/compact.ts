// What the compact island shows next to Mochi while a live activity runs —
// the song, a countdown, a download, an incoming toast — plus the mic/camera
// dots on the right edge. Built once per kind, then only text and widths change,
// so the per-second heartbeat never rebuilds DOM.

import { Bridge } from "../core/bridge";
import { h, svg } from "../views/dom";
import { ICONS } from "../views/icons";
import { Live, fmtBytes, fmtClock, fmtUntil, type CompactKind } from "./store";

interface Slot {
  kind: CompactKind;
  el: HTMLElement;
  update(): void;
}

function twoLines(): { box: HTMLElement; a: HTMLElement; b: HTMLElement } {
  const a = h("span", { class: "a" });
  const b = h("span", { class: "b" });
  return { box: h("div", { class: "lines" }, a, b), a, b };
}

function eqBars(): HTMLElement {
  return h("div", { class: "eq" }, h("i"), h("i"), h("i"), h("i"));
}

function liveBtn(icon: string, title: string, onClick: () => void): HTMLElement {
  return h(
    "button",
    {
      class: "live-btn", title, "data-live-btn": "1",
      onclick: (e: Event) => {
        e.stopPropagation();
        onClick();
      },
    },
    svg(icon, 12),
  );
}

function buildSlot(kind: CompactKind): Slot {
  switch (kind) {
    case "media": {
      const art = h("div", { class: "art" });
      const { box, a, b } = twoLines();
      const eq = eqBars();
      const btn = h("div", { class: "btns" });
      let playing: boolean | null = null;
      let artSrc: string | null | undefined;
      return {
        kind,
        el: h("div", { class: "slot" }, art, box, eq, btn),
        update() {
          const m = Live.media;
          if (!m) return;
          a.textContent = m.title || m.app;
          b.textContent = m.artist || m.app;
          eq.classList.toggle("on", m.playing);
          if (m.art !== artSrc) {
            artSrc = m.art;
            art.style.backgroundImage = m.art ? `url("${m.art}")` : "";
            art.classList.toggle("empty", !m.art);
            art.replaceChildren(...(m.art ? [] : [svg(ICONS.music, 12)]));
          }
          if (m.playing !== playing) {
            playing = m.playing;
            btn.replaceChildren(
              liveBtn(m.playing ? ICONS.pause : ICONS.play, "Play/pause", () => void Bridge.mediaControl("play_pause")),
              liveBtn(ICONS.next, "Next", () => void Bridge.mediaControl("next")),
            );
          }
        },
      };
    }
    case "timer": {
      const ring = h("div", { class: "ring" });
      const { box, a, b } = twoLines();
      const clock = h("span", { class: "clock" });
      return {
        kind,
        el: h("div", { class: "slot" }, ring, box, clock),
        update() {
          const t = Live.timer;
          if (!t) return;
          const ms = Live.timerMs();
          a.textContent = t.label;
          b.textContent = t.done ? "Time's up" : t.running ? (t.kind === "countdown" ? "remaining" : "elapsed") : "paused";
          clock.textContent = fmtClock(ms);
          const frac = t.kind === "countdown" && t.totalMs > 0 ? ms / t.totalMs : 1;
          ring.style.setProperty("--p", String(frac));
          ring.classList.toggle("done", t.done);
        },
      };
    }
    case "calendar": {
      const icon = h("div", { class: "glyph cal" }, svg(ICONS.calendar, 12));
      const { box, a, b } = twoLines();
      return {
        kind,
        el: h("div", { class: "slot" }, icon, box),
        update() {
          const e = Live.soonEvent();
          if (!e) return;
          a.textContent = e.title;
          b.textContent = `${fmtUntil(e.start)}${e.joinUrl ? " · click to join" : ""}`;
        },
      };
    }
    case "sys": {
      const icon = h("div", { class: "glyph hot" }, svg(ICONS.chip, 12));
      const { box, a, b } = twoLines();
      return {
        kind,
        el: h("div", { class: "slot" }, icon, box),
        update() {
          a.textContent = Live.sysAlert() ?? "";
          b.textContent = "System is under load";
        },
      };
    }
    case "progress": {
      const icon = h("div", { class: "glyph dl" }, svg(ICONS.download, 12));
      const { box, a, b } = twoLines();
      const bar = h("div", { class: "bar indeterminate" }, h("i"));
      return {
        kind,
        el: h("div", { class: "slot" }, icon, box, bar),
        update() {
          const items = Live.activeDownloads();
          const first = items[0];
          if (!first) return;
          a.textContent = items.length > 1 ? `${first.name} +${items.length - 1}` : first.name;
          b.textContent = `${fmtBytes(first.bytes)} · ${fmtBytes(first.speed)}/s`;
          const fill = bar.firstElementChild as HTMLElement;
          if (first.totalBytes) {
            bar.classList.remove("indeterminate");
            fill.style.width = `${Math.min(100, (first.bytes / first.totalBytes) * 100)}%`;
          } else {
            bar.classList.add("indeterminate");
            fill.style.width = "";
          }
        },
      };
    }
    case "flash": {
      const icon = h("div", { class: "glyph" });
      const { box, a, b } = twoLines();
      const level = h("div", { class: "bar vol" }, h("i"));
      box.append(level);
      let key = "";
      return {
        kind,
        el: h("div", { class: "slot flash" }, icon, box),
        update() {
          const f = Live.flash;
          if (!f) return;
          const k = `${f.icon}|${f.title}|${f.sub}|${f.level ?? ""}`;
          if (k === key) return;
          key = k;
          const glyph = {
            check: ICONS.check, note: ICONS.pencil, bell: ICONS.bell, cal: ICONS.calendar,
            bolt: ICONS.bolt, wifi: ICONS.wifi, clip: ICONS.clipboard,
            vol: f.level === 0 ? ICONS.speakerOff : ICONS.speakerOn, leaf: ICONS.leaf, moon: ICONS.moon,
          }[f.icon];
          icon.replaceChildren(svg(glyph, 12, f.icon === "check" ? { stroke: 2.6 } : {}));
          icon.style.color = f.color;
          icon.style.background = `${f.color}26`;
          a.textContent = f.title;
          b.textContent = f.sub;
          // Volume HUD: a bar instead of a second line.
          b.style.display = f.level != null ? "none" : "";
          level.style.display = f.level != null ? "" : "none";
          (level.firstElementChild as HTMLElement).style.width = `${Math.round((f.level ?? 0) * 100)}%`;
          // Restart the entrance animation for every new flash.
          box.classList.remove("pop");
          void box.offsetWidth;
          box.classList.add("pop");
        },
      };
    }
  }
}

export class CompactLive {
  readonly strip = h("div", { id: "live-strip" });
  readonly dots = h("div", { id: "live-dots" });
  private slot: Slot | null = null;
  private micDot = h("i", { class: "mic", title: "" });
  private camDot = h("i", { class: "cam", title: "" });
  private quietDot = h("b", { class: "quiet" }, svg(ICONS.moon, 9));

  constructor() {
    this.dots.append(this.quietDot, this.micDot, this.camDot);
  }

  /** Returns whether the compact island should be in its wide live form. */
  sync(compact: boolean): boolean {
    const kind = compact ? Live.compactKind() : null;
    if (kind !== (this.slot?.kind ?? null)) {
      this.strip.classList.remove("on");
      if (kind) {
        this.slot = buildSlot(kind);
        this.strip.replaceChildren(this.slot.el);
        // Next frame, so the fade-in transition actually runs.
        requestAnimationFrame(() => this.strip.classList.add("on"));
      } else {
        this.slot = null;
        // Let the fade-out finish, then drop the old content (and its animations).
        window.setTimeout(() => {
          if (!this.slot) this.strip.replaceChildren();
        }, 300);
      }
    }
    this.slot?.update();

    const mic = Live.privacy.mic;
    const cam = Live.privacy.cam;
    this.micDot.classList.toggle("on", mic.length > 0);
    this.camDot.classList.toggle("on", cam.length > 0);
    this.micDot.title = mic.length ? `Microphone: ${mic.join(", ")}` : "";
    this.camDot.title = cam.length ? `Camera: ${cam.join(", ")}` : "";
    // Moon = toasts are being held (DND, focus or a meeting).
    const quiet = Live.quietReason();
    this.quietDot.classList.toggle("on", !!quiet);
    this.quietDot.title = quiet ? `${quiet} — notifications held` : "";
    return kind != null;
  }
}
