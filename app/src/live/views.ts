// Expanded views for the live activities. Same card language as the rest of the
// island; Mochi sits small on the left (VIEW_LAYOUTS botX 44), content starts at 84.
// Every view rebuilds only when its data key changes; the heartbeat just updates text.

import { Bridge } from "../core/bridge";
import { State } from "../core/state";
import type { IslandViewName } from "../core/layout";
import { h, svg, clear } from "../views/dom";
import { ICONS } from "../views/icons";
import type { ViewActions, ViewHost } from "../views/views";
import { Live, appColor, fmtAgo, fmtBytes, fmtClock, fmtRate, fmtTime, fmtUntil, fmtUptime } from "./store";
import type { ProcInfo } from "./types";
import { buildMoreViews } from "./views2";
import { buildAgentViews } from "./views3";
import { Agent } from "./agent";
import { Spotify, HEART, HEART_OUTLINE, type SpotifyTrack } from "./spotify";
import { calendarRsvp } from "./calendar-actions";

export function shell(...children: Node[]): { el: HTMLElement; body: HTMLElement } {
  const body = h("div", { class: "lv-body" }, ...children);
  const el = h("div", { class: "view lv" }, h("div", { class: "card" }, body));
  return { el, body };
}

export function btn(label: string, kind: "primary" | "secondary", onClick: () => void, icon?: string): HTMLElement {
  return h("button", { class: `btn ${kind}`, onclick: onClick }, icon ? svg(icon, 11) : null, h("span", { text: label }));
}

export function roundBtn(icon: string, title: string, onClick: () => void, big = false): HTMLElement {
  return h("button", { class: big ? "lv-round big" : "lv-round", title, onclick: onClick }, svg(icon, big ? 16 : 13));
}

export function empty(title: string, sub: string, ...actions: Node[]): HTMLElement {
  return h("div", { class: "lv-empty" },
    h("div", { class: "title", text: title }),
    h("div", { class: "sub", text: sub }),
    actions.length ? h("div", { class: "actions" }, ...actions) : null,
  );
}

const fmtSecs = (s: number) => fmtClock(s * 1000);

// ── Media ─────────────────────────────────────────────────────────────────────

function buildMedia(): ViewHost {
  const art = h("div", { class: "lv-art" });
  const title = h("div", { class: "lv-title" });
  const sub = h("div", { class: "sub" });
  const fill = h("i");
  const bar = h("div", { class: "lv-track" }, fill);
  const posEl = h("span");
  const durEl = h("span");
  const times = h("div", { class: "lv-times" }, posEl, durEl);
  const playBtn = roundBtn(ICONS.play, "Play/pause", () => void Bridge.mediaControl("play_pause"), true);
  const controls = h("div", { class: "lv-controls" },
    roundBtn(ICONS.prev, "Previous", () => void Bridge.mediaControl("prev")),
    playBtn,
    roundBtn(ICONS.next, "Next", () => void Bridge.mediaControl("next")),
  );
  // Click anywhere on the track to jump there.
  bar.classList.add("seek");
  bar.title = "Click to seek";
  bar.addEventListener("click", (e) => {
    const m = Live.media;
    if (!m?.duration) return;
    const r = bar.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    void Bridge.mediaSeek(frac * m.duration);
  });
  const muteBtn = roundBtn(ICONS.speakerOn, "Mute", () => void Live.toggleMute());
  const vol = h("input", { class: "lv-range", type: "range", min: "0", max: "100", step: "1", title: "Volume" }) as HTMLInputElement;
  let volTimer = 0;
  vol.addEventListener("input", () => {
    vol.style.setProperty("--v", `${vol.value}%`);
    window.clearTimeout(volTimer);
    volTimer = window.setTimeout(() => void Live.setVolume(Number(vol.value) / 100), 40);
  });
  const volRow = h("div", { class: "lv-vol" }, muteBtn, vol);
  // Only when Spotify is the player and the account is linked (Settings → Live).
  let liked: SpotifyTrack | null = null;
  let likedFor = "";
  const heart = roundBtn(HEART_OUTLINE, "Save to Liked Songs", () => {
    if (!liked) return;
    const t = liked;
    void Spotify.setLiked(t, !t.liked).then(drawHeart, (err) =>
      Live.setFlash({ icon: "vol", color: "#1DB954", title: "Spotify", sub: String(err.message ?? err), view: "media" }, 4000));
  });
  function drawHeart() {
    heart.style.display = liked ? "" : "none";
    heart.title = liked?.liked ? "Remove from Liked Songs" : "Save to Liked Songs";
    heart.replaceChildren(svg(liked?.liked ? HEART : HEART_OUTLINE, 13, { fill: liked?.liked ? "#1DB954" : undefined }));
  }
  drawHeart();
  controls.append(heart, volRow);
  const player = h("div", { class: "lv-media" }, art,
    h("div", { class: "lv-col" }, title, sub, bar, times, controls));
  const none = empty("Nothing playing.", "Play something in Spotify, YouTube, VLC… and it shows up here.");
  const { el, body } = shell(player, none);

  let artSrc: string | null | undefined;
  let playing: boolean | null = null;
  return {
    el,
    sync() {
      const m = Live.media;
      player.style.display = m ? "" : "none";
      none.style.display = m ? "none" : "";
      body.classList.toggle("centered", !m);
      if (!m) return;
      title.textContent = m.title || "Unknown title";
      const key = `${m.app}${m.title}${m.artist}`;
      if (key !== likedFor) {
        likedFor = key;
        liked = null;
        drawHeart();
        void Spotify.track(m).then((t) => {
          if (likedFor === key) { liked = t; drawHeart(); }
        });
      }
      sub.textContent = [m.artist, m.app].filter(Boolean).join(" · ");
      if (m.art !== artSrc) {
        artSrc = m.art;
        art.style.backgroundImage = m.art ? `url("${m.art}")` : "";
        art.classList.toggle("empty", !m.art);
        clear(art);
        if (!m.art) art.append(svg(ICONS.music, 26));
      }
      if (m.playing !== playing) {
        playing = m.playing;
        clear(playBtn);
        playBtn.append(svg(m.playing ? ICONS.pause : ICONS.play, 16));
      }
      const v = Live.volume;
      if (v && document.activeElement !== vol) {
        const pct = String(Math.round((v.muted ? 0 : v.level) * 100));
        if (vol.value !== pct) vol.value = pct;
        vol.style.setProperty("--v", `${pct}%`);
      }
      volRow.classList.toggle("muted", !!v?.muted);
      const muteIcon = v?.muted ? ICONS.speakerOff : ICONS.speakerOn;
      if (muteBtn.dataset.icon !== muteIcon) {
        muteBtn.dataset.icon = muteIcon;
        muteBtn.replaceChildren(svg(muteIcon, 13));
      }
      const pos = Live.mediaPosition();
      const hasTimeline = pos != null && !!m.duration;
      bar.style.visibility = times.style.visibility = hasTimeline ? "visible" : "hidden";
      if (hasTimeline) {
        fill.style.width = `${Math.min(100, (pos / m.duration!) * 100)}%`;
        posEl.textContent = fmtSecs(pos);
        durEl.textContent = fmtSecs(m.duration!);
      }
    },
  };
}

// ── Timer ─────────────────────────────────────────────────────────────────────

function buildTimer(): ViewHost {
  const clock = h("div", { class: "lv-clock" });
  const label = h("div", { class: "sub" });
  const row = h("div", { class: "actions" });
  const minutes = h("input", {
    class: "lv-input small", type: "number", min: "1", max: "600", value: String(Live.lastCustomMinutes), title: "Minutes",
  }) as HTMLInputElement;
  const startCustom = () => {
    const n = Math.max(1, Math.min(600, Math.round(Number(minutes.value) || 0)));
    Live.rememberCustom(n);
    Live.startCountdown(n, `${n} min`);
  };
  minutes.addEventListener("keydown", (e) => {
    if (e.key === "Enter") startCustom();
  });
  const pips = h("div", { class: "lv-pips", title: "Focus sessions toward a long break" }, h("i"), h("i"), h("i"), h("i"));
  const stats = h("div", { class: "lv-stats" });
  // The island never takes focus on its own (it would steal it from your app when
  // a timer fires); typing a custom length asks for it explicitly.
  minutes.addEventListener("mousedown", () => void Bridge.focusWindow(true));
  minutes.addEventListener("keydown", (e) => e.stopPropagation());
  const { el } = shell(h("div", { class: "lv-timer" },
    h("div", { class: "lv-timer-top" }, h("div", { class: "lv-col" }, clock, label), h("div", { class: "lv-col right" }, pips, stats)),
    row));

  let rowKey = "";
  return {
    el,
    sync() {
      const t = Live.timer;
      clock.textContent = t ? fmtClock(Live.timerMs()) : "0:00";
      clock.classList.toggle("done", !!t?.done);
      clock.classList.toggle("paused", !!t && !t.running && !t.done);
      label.textContent = !t
        ? "Pick a timer"
        : t.done ? `${t.label} — time's up` : `${t.label}${t.running ? "" : " · paused"}`;

      const f = Live.focusToday();
      const inCycle = f.sessions % 4;
      pips.querySelectorAll("i").forEach((p, i) => p.classList.toggle("on", i < (inCycle || (f.sessions ? 4 : 0))));
      stats.textContent = f.sessions
        ? `${f.sessions} focus · ${f.minutes} min today${f.streak > 1 ? ` · ${f.streak}-day streak` : ""}`
        : Live.activeMinutes() >= 20 ? `${Live.activeMinutes()} min at the screen` : "No focus sessions yet today";
      stats.classList.toggle("streak", f.streak > 1);

      const key = !t ? "none" : `${t.kind}|${t.running}|${t.done}|${t.next?.label ?? ""}`;
      if (key === rowKey) return;
      rowKey = key;
      clear(row);
      if (!t) {
        row.append(
          btn("Focus 25", "primary", () => Live.startFocus(), ICONS.flame),
          btn("5", "secondary", () => Live.startCountdown(5, "5 min")),
          btn("15", "secondary", () => Live.startCountdown(15, "15 min")),
          btn("45", "secondary", () => Live.startCountdown(45, "45 min")),
          h("div", { class: "lv-custom" }, minutes, btn("Start", "secondary", startCustom)),
          btn("", "secondary", () => Live.startStopwatch(), ICONS.timer),
        );
      } else if (t.done) {
        if (t.next) {
          const next = t.next;
          row.append(btn(`Start ${next.label.toLowerCase()} · ${next.minutes} min`, "primary", () =>
            Live.startCountdown(next.minutes, next.label, next.label.endsWith("reak") ? { label: "Focus", minutes: 25 } : null)));
        }
        row.append(
          btn("+5 min", "secondary", () => Live.addMinutes(5)),
          btn("Done", t.next ? "secondary" : "primary", () => Live.clearTimer()),
        );
      } else {
        row.append(btn(t.running ? "Pause" : "Resume", "primary", () => Live.toggleTimer(), t.running ? ICONS.pause : ICONS.play));
        if (t.kind === "countdown") row.append(btn("+1 min", "secondary", () => Live.addMinutes(1)));
        row.append(btn("Reset", "secondary", () => Live.clearTimer(), ICONS.reset));
      }
    },
  };
}

// ── System ────────────────────────────────────────────────────────────────────

function meter(name: string): { el: HTMLElement; set(pct: number | null, text: string): void } {
  const fill = h("i");
  const val = h("span", { class: "v" });
  const el = h("div", { class: "lv-meter" }, h("span", { class: "n", text: name }), h("div", { class: "lv-track" }, fill), val);
  return {
    el,
    set(pct, text) {
      el.style.display = pct == null ? "none" : "";
      if (pct == null) return;
      fill.style.width = `${Math.max(2, Math.min(100, pct))}%`;
      fill.style.background = pct >= 90 ? "var(--red)" : pct >= 70 ? "var(--amber)" : "var(--green-2)";
      val.textContent = text;
    },
  };
}

/** Two polylines (CPU, RAM) over the last two minutes, 0–100 scale. */
function sparkline(): { el: SVGSVGElement; set(a: number[], b: number[]): void } {
  const NS = "http://www.w3.org/2000/svg";
  const el = document.createElementNS(NS, "svg");
  el.setAttribute("viewBox", "0 0 120 30");
  el.setAttribute("preserveAspectRatio", "none");
  el.setAttribute("class", "lv-spark");
  el.setAttribute("aria-hidden", "true");
  const lines = ["cpu", "ram"].map((c) => {
    const p = document.createElementNS(NS, "polyline");
    p.setAttribute("class", c);
    p.setAttribute("vector-effect", "non-scaling-stroke");
    el.append(p);
    return p;
  });
  const pts = (v: number[]) => v.map((x, i) => `${(i * 120) / 59},${(29 - (x / 100) * 28).toFixed(1)}`).join(" ");
  return {
    el,
    set(a, b) {
      lines[0].setAttribute("points", pts(a.slice(-60)));
      lines[1].setAttribute("points", pts(b.slice(-60)));
    },
  };
}

function chip(icon: string): { el: HTMLElement; set(text: string | null, title?: string): void } {
  const t = h("span");
  const el = h("span", { class: "lv-chip" }, svg(icon, 10), t);
  return {
    el,
    set(text, title = "") {
      el.style.display = text == null ? "none" : "";
      t.textContent = text ?? "";
      el.title = title;
    },
  };
}

function buildSystem(): ViewHost {
  const cpu = meter("CPU");
  const ram = meter("RAM");
  const gpu = meter("GPU");
  const temp = meter("GPU temp");
  const vram = meter("VRAM");
  const waiting = h("div", { class: "sub", text: "Reading sensors…" });
  const spark = sparkline();
  const disk = chip(ICONS.folder);
  const net = chip(ICONS.wifi);
  const up = chip(ICONS.timer);
  const batt = chip(ICONS.bolt);
  const apps = h("div", { class: "lv-procs" });
  const side = h("div", { class: "lv-side" },
    h("div", { class: "lv-spark-wrap", title: "CPU (green) and RAM (blue), last 2 minutes" }, spark.el),
    h("div", { class: "lv-chips" }, disk.el, net.el, up.el, batt.el),
    apps,
  );
  const { el } = shell(h("div", { class: "lv-sys" }, h("div", { class: "lv-meters" }, cpu.el, ram.el, gpu.el, temp.el, vram.el, waiting), side));

  // Heaviest apps: asked for while the view is open, not on every sample.
  let procs: ProcInfo[] = [];
  let procsAt = 0;
  let procKey = "";
  const loadProcs = async () => {
    procsAt = performance.now();
    procs = (await Bridge.topProcs()) ?? [];
  };
  return {
    el,
    focus() {
      void loadProcs();
    },
    sync() {
      if (performance.now() - procsAt > 8000) void loadProcs();
      const pk = procs.map((p) => `${p.name}${p.mb}`).join("|");
      if (pk !== procKey) {
        procKey = pk;
        apps.replaceChildren(...procs.slice(0, 3).map((p) => h("div", { class: "lv-proc" },
          h("span", { class: "n", text: p.count > 1 ? `${p.name} ×${p.count}` : p.name }),
          h("span", { class: "v", text: p.mb >= 1024 ? `${(p.mb / 1024).toFixed(1)} GB` : `${Math.round(p.mb)} MB` }))));
      }
      spark.set(Live.cpuHist, Live.ramHist);
      const pw = Live.power;
      batt.set(pw?.percent != null ? `${pw.percent}%${pw.charging ? " ⚡" : ""}` : null,
        pw?.secondsLeft ? `${Math.round(pw.secondsLeft / 60)} min left` : "Battery");
      const s = Live.sys;
      waiting.style.display = s ? "none" : "";
      if (!s) {
        for (const m of [cpu, ram, gpu, temp, vram]) m.set(null, "");
        return;
      }
      cpu.set(s.cpu, `${Math.round(s.cpu)}%`);
      ram.set(s.ramPct, `${s.ramUsedGb.toFixed(1)} / ${s.ramTotalGb.toFixed(0)} GB`);
      gpu.set(s.gpu, `${Math.round(s.gpu ?? 0)}%`);
      // 100 °C as the full scale so the colour bands line up with "hot".
      temp.set(s.gpuTemp, `${Math.round(s.gpuTemp ?? 0)}°C`);
      vram.set(s.vramPct, `${Math.round(s.vramPct ?? 0)}%`);
      disk.set(s.diskTotalGb ? `${Math.round(s.diskFreeGb)} GB free` : null, `System drive: ${s.diskFreeGb} of ${s.diskTotalGb} GB free`);
      disk.el.classList.toggle("warn", !!s.diskTotalGb && s.diskFreeGb / s.diskTotalGb < 0.1);
      net.set(s.netDown != null ? `↓ ${fmtRate(s.netDown)}  ↑ ${fmtRate(s.netUp)}` : null, "Network throughput");
      up.set(s.uptimeS ? `up ${fmtUptime(s.uptimeS)}` : null, "Time since Windows started");
    },
  };
}

// ── Calendar ──────────────────────────────────────────────────────────────────

function buildCalendar(actions: ViewActions): ViewHost {
  const list = h("div", { class: "lv-list scroll" });
  const summary = h("div", { class: "lv-summary" });
  const { el } = shell(summary, list);
  let key = "";
  const countdowns: { el: HTMLElement; start: number }[] = [];
  return {
    el,
    sync() {
      const c = Live.calendar;
      const now = Date.now();
      const events = c.events.filter((e) => e.end > now).slice(0, 8);
      const current = events.find((e) => e.start <= now);
      const next = events.find((e) => e.start > now);
      summary.textContent = c.error || !events.length ? ""
        : current ? `In “${current.title || "Busy"}” until ${fmtTime(current.end)}`
        : next ? `Free until ${fmtTime(next.start)}` : "";
      summary.style.display = summary.textContent ? "" : "none";
      const k = `${c.error}|${events.map((e) => `${e.start}${e.title}${e.joinUrl}${e.rsvp}`).join("|")}`;
      if (k !== key) {
        key = k;
        clear(list);
        countdowns.length = 0;
        if (c.error) {
          list.append(empty("Calendar unavailable.", c.error,
            btn("Settings…", "secondary", () => actions.openSettingsWindow()),
            btn("Retry", "secondary", () => void Bridge.calendarRefresh())));
        } else if (!events.length) {
          list.append(empty("Nothing in the next 24 hours.",
            "Connect your calendar with its private iCal link in Settings → Live.",
            btn("Settings…", "secondary", () => actions.openSettingsWindow())));
        } else {
          let lastDay = new Date(now).toDateString();
          for (const e of events) {
            const day = new Date(e.start).toDateString();
            if (day !== lastDay) {
              lastDay = day;
              list.append(h("div", { class: "lv-day", text: new Date(e.start).toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" }) }));
            }
            const until = h("span", { class: "lv-until" });
            countdowns.push({ el: until, start: e.start });
            list.append(h("div", { class: "lv-item" },
              h("div", { class: "lv-time", text: fmtTime(e.start) }),
              h("div", { class: "lv-col" },
                h("div", { class: "lv-name", text: e.title || "Busy" }),
                h("div", { class: "lv-meta" }, until, e.location && !e.joinUrl ? h("span", { text: ` · ${e.location}` }) : null)),
              e.joinUrl ? h("div", { class: "lv-row-acts" },
                roundBtn(ICONS.clipboard, "Copy meeting link", () => void Live.copyClip(e.joinUrl!)),
                btn("Join", "primary", () => actions.openUrl(e.joinUrl!))) : null,
            ));
            if (e.rsvp === "pending") {
              const answer = (accept: boolean) => void calendarRsvp(e.id, accept).catch((err) =>
                Live.setFlash({ icon: "cal", color: "#f4505e", title: "RSVP failed", sub: String(err).replace(/^Error:\s*/, ""), view: "calendar" }, 8000));
              list.append(h("div", { class: "lv-row-acts" },
                btn("Accept", "primary", () => answer(true)),
                btn("Decline", "secondary", () => answer(false))));
            }
          }
        }
      }
      for (const c of countdowns) c.el.textContent = fmtUntil(c.start);
    },
  };
}

// ── Files (downloads + renders) ───────────────────────────────────────────────

function buildFiles(): ViewHost {
  const list = h("div", { class: "lv-list scroll" });
  const { el } = shell(list);
  let key: string | null = null;
  const rows = new Map<string, { meta: HTMLElement; fill: HTMLElement; bar: HTMLElement }>();
  return {
    el,
    sync() {
      const items = Live.progress.slice(0, 3);
      const history = Live.finished.filter((f) => !items.some((i) => i.id === f.id));
      const k = items.map((i) => `${i.id}${i.done}`).join("|") + "#" + history.map((f) => f.id).join("|");
      if (k !== key) {
        key = k;
        clear(list);
        rows.clear();
        if (!items.length && !history.length) {
          list.append(empty("No downloads or renders running.",
            "Watching your Downloads folder. Add render output folders in Settings → Live."));
        }
        for (const i of items) {
          const fill = h("i");
          const bar = h("div", { class: "lv-track" }, fill);
          const meta = h("div", { class: "lv-meta" });
          rows.set(i.id, { meta, fill, bar });
          list.append(h("div", { class: "lv-item" },
            h("div", { class: `glyph ${i.done ? "ok" : "dl"}` }, svg(i.done ? ICONS.check : ICONS.download, 12, i.done ? { stroke: 2.6 } : {})),
            h("div", { class: "lv-col" }, h("div", { class: "lv-name", text: i.name }), bar, meta),
            i.done ? fileActs(i.id) : null,
          ));
        }
        if (history.length) {
          list.append(h("div", { class: "lv-day", text: "Recently finished" }));
          for (const f of history) {
            list.append(h("div", { class: "lv-item past" },
              h("div", { class: "glyph ok" }, svg(ICONS.check, 12, { stroke: 2.6 })),
              h("div", { class: "lv-col" },
                h("div", { class: "lv-name", text: f.name }),
                h("div", { class: "lv-meta", text: `${f.kind === "render" ? "Render" : "Download"} · ${fmtBytes(f.bytes)} · ${fmtAgo(f.time)}` })),
              fileActs(f.id, () => Live.forgetFinished(f.id)),
            ));
          }
        }
      }
      for (const i of items) {
        const r = rows.get(i.id);
        if (!r) continue;
        const kind = i.kind === "render" ? "Render" : "Download";
        r.meta.textContent = i.done
          ? `${kind} finished · ${fmtBytes(i.bytes)}`
          : `${kind} · ${fmtBytes(i.bytes)}${i.totalBytes ? ` of ${fmtBytes(i.totalBytes)}` : ""} · ${fmtBytes(i.speed)}/s`;
        r.bar.classList.toggle("indeterminate", !i.done && !i.totalBytes);
        r.fill.style.width = i.done ? "100%" : i.totalBytes ? `${(i.bytes / i.totalBytes) * 100}%` : "";
      }
    },
  };
}

function fileActs(path: string, forget?: () => void): HTMLElement {
  const open = roundBtn(ICONS.arrowUpRight, "Open", () => {
    Bridge.fileOpen(path).catch((err) => {
      open.title = String(err).replace(/^Error:\s*/, "");
      open.classList.add("err");
    });
  });
  return h("div", { class: "lv-row-acts hover" },
    open,
    roundBtn(ICONS.folder, "Show in folder", () => void Bridge.fileReveal(path)),
    forget ? roundBtn(ICONS.xmark, "Remove from list", forget) : null,
  );
}

// ── Notifications ─────────────────────────────────────────────────────────────

function buildNotifs(): ViewHost {
  const list = h("div", { class: "lv-list scroll" });
  const count = h("span", { class: "lv-bar-title" });
  const dnd = h("button", { class: "lv-toggle", title: "Do not disturb: hold toasts quietly", onclick: () => Live.setDnd(!Live.dnd) },
    svg(ICONS.moon, 11), h("span", { text: "Do not disturb" }));
  const clearAll = h("button", { class: "lv-link", text: "Clear all", onclick: () => Live.clearNotifs() });
  const muted = h("div", { class: "lv-muted" });
  const digest = h("div", { class: "nf-digest" });
  const digestText = h("span", { class: "t" });
  const sumBtn = h("button", { class: "lv-link ai", text: "✦ Summarise" });
  digest.append(digestText, sumBtn);
  sumBtn.addEventListener("click", async () => {
    sumBtn.textContent = "Summarising…";
    digest.classList.add("thinking");
    try {
      digestText.textContent = await Agent.digestAi();
      digest.classList.add("ai");
    } catch (err) {
      digestText.textContent = String(err).replace(/^Error:\s*/, "");
    }
    digest.classList.remove("thinking");
    sumBtn.textContent = "✦ Again";
  });
  const { el } = shell(h("div", { class: "lv-toolbar" }, count, dnd, clearAll), digest, list, muted);
  let key: string | null = null;
  return {
    el,
    sync() {
      const quiet = Live.quietReason();
      dnd.classList.toggle("on", Live.dnd);
      count.textContent = Live.notifs.length
        ? `${Live.notifs.length} notification${Live.notifs.length > 1 ? "s" : ""}${quiet ? ` · ${quiet}` : ""}`
        : quiet ? `${quiet} · holding toasts` : "Notifications";
      clearAll.style.display = Live.notifs.length ? "" : "none";
      const real = Live.notifs.filter((n) => !n.noise).length;
      digest.style.display = real >= 3 ? "" : "none";
      if (real >= 3 && !digest.classList.contains("ai")) digestText.textContent = Agent.digestPlain();
      if (real < 3) digest.classList.remove("ai");
      const k = Live.notifs.map((n) => `${n.id}${n.repeats ?? ""}`).join("|") + "#" + Live.mutedApps.join("|");
      if (k === key) return;
      key = k;
      clear(list);
      muted.replaceChildren(...Live.mutedApps.map((a) => h("button", {
        class: "lv-chip btn-chip", title: `Unmute ${a}`, onclick: () => Live.unmuteApp(a),
      }, svg(ICONS.speakerOff, 9), h("span", { text: a }), svg(ICONS.xmark, 8))));
      if (!Live.notifs.length) {
        list.append(empty("All caught up.", "WhatsApp, Slack, Gmail, Teams… new Windows notifications land here."));
        return;
      }
      for (const n of Live.notifs) {
        const acts = h("div", { class: "lv-row-acts hover" },
          roundBtn(ICONS.speakerOff, `Mute ${n.app}`, () => Live.muteApp(n.app)),
          roundBtn(ICONS.xmark, "Dismiss", () => Live.dismissNotif(n.id)));
        acts.addEventListener("click", (e) => e.stopPropagation());
        list.append(h("div", { class: "lv-item lv-notif", role: "button", tabindex: "0", title: `Open ${n.app}`, onclick: () => void Bridge.notifOpen(n.appId) },
          h("div", { class: "nf-av", style: `background:${appColor(n.app)}26;color:${appColor(n.app)}`, text: n.app.slice(0, 1).toUpperCase() }),
          h("div", { class: "lv-col" },
            h("div", { class: "lv-meta" }, h("b", { text: n.app }), h("span", { text: ` · ${fmtAgo(n.time)}` }),
              n.repeats ? h("span", { class: "nf-rep", text: `×${n.repeats}` }) : null,
              n.noise ? h("span", { class: "nf-quiet", text: "quiet" }) : null),
            h("div", { class: "lv-name", text: n.title || n.body }),
            n.title && n.body ? h("div", { class: "lv-meta clamp", text: n.body }) : null),
          acts,
        ));
      }
    },
  };
}

// ── Quick capture ─────────────────────────────────────────────────────────────

function buildCapture(actions: ViewActions): ViewHost {
  const input = h("input", {
    class: "lv-input", type: "text", maxlength: "4000",
    placeholder: "Note, task or idea — Enter to save",
  }) as HTMLInputElement;
  const status = h("div", { class: "sub" });
  const save = async () => {
    const text = input.value.trim();
    if (!text) return;
    try {
      await Live.saveCapture(text);
      input.value = "";
      status.textContent = "Saved to your inbox.";
      window.setTimeout(() => actions.collapse(), 600);
    } catch (err) {
      status.textContent = String(err).replace(/^Error:\s*/, "");
    }
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void save();
    }
    e.stopPropagation();
    if (e.key === "Escape") actions.collapse();
  });
  const tasks = h("div", { class: "lv-tasks" });
  const openCount = h("span", { class: "lv-count" });
  const { el } = shell(h("div", { class: "lv-capture" },
    h("div", { class: "lv-toolbar" },
      h("span", { class: "lv-bar-title" }, h("span", { text: "Quick capture" }), openCount),
      h("button", { class: "lv-link", text: "Open inbox.md", onclick: () => void Bridge.captureOpen() })),
    h("div", { class: "lv-field" }, input, btn("Save", "primary", () => void save())),
    status,
    tasks,
  ));
  let key = "";
  return {
    el,
    sync() {
      const open = Live.tasks.filter((t) => !t.done).length;
      openCount.textContent = open ? `${open} open` : "";
      // Newest first, open before done.
      const shown = [...Live.tasks].reverse().sort((a, b) => Number(a.done) - Number(b.done)).slice(0, 4);
      const k = shown.map((t) => `${t.line}${t.done}${t.text}`).join("|") + (Live.tasksError ?? "");
      if (k === key) return;
      key = k;
      tasks.replaceChildren(...shown.map((t) => h("button", {
        class: t.done ? "lv-task done" : "lv-task", title: t.done ? "Mark as open" : "Mark as done",
        onclick: () => void Live.toggleTask(t),
      }, h("span", { class: "lv-check" }, t.done ? svg(ICONS.check, 9, { stroke: 3 }) : null), h("span", { class: "t", text: t.text }))));
      if (Live.tasksError) tasks.append(h("div", { class: "lv-meta", text: Live.tasksError }));
    },
    focus() {
      void Live.loadTasks();
      status.textContent = "";
      void Bridge.captureHotkey().then((key) => {
        if (key && !status.textContent) status.textContent = `${key} opens this from anywhere.`;
      });
      input.focus();
    },
  };
}

// ── Clipboard history ─────────────────────────────────────────────────────────

function buildClips(): ViewHost {
  const list = h("div", { class: "lv-list scroll" });
  const title = h("span", { class: "lv-bar-title" });
  const clearBtn = h("button", { class: "lv-link", text: "Clear unpinned", onclick: () => Live.clearClips() });
  const swatches = h("div", { class: "lv-swatches" });
  // Actions on the selected (default: newest) clip: quick local ones and local-AI ones.
  let target: string | null = null;
  const actResult = h("div", { class: "cl-result" });
  const ACTS: [string, string, boolean][] = [
    ["summarize", "Summarise", true], ["fix", "Fix grammar", true], ["english", "To English", true], ["bullets", "Bullets", true], ["explain", "Explain", true],
    ["upper", "UPPER", false], ["lower", "lower", false], ["title", "Title Case", false], ["trim", "Tidy", false], ["json", "Pretty JSON", false], ["slug", "slug", false],
  ];
  const acts = h("div", { class: "cl-acts" }, ...ACTS.map(([k, label, ai]) => h("button", {
    class: ai ? "cl-act ai" : "cl-act",
    onclick: async () => {
      const src = target ?? Live.clips[0]?.text;
      if (!src) return;
      actResult.className = "cl-result on thinking";
      actResult.textContent = ai ? "Thinking with local AI…" : "";
      try {
        const out = await Agent.transform(k, src);
        await Live.copyClip(out);
        actResult.className = "cl-result on";
        actResult.textContent = out;
        actResult.title = "Copied — click to copy again";
        actResult.onclick = () => void Live.copyClip(out);
      } catch (err) {
        actResult.className = "cl-result on err";
        actResult.textContent = k === "json" ? "That isn't valid JSON." : String(err).replace(/^Error:\s*/, "");
      }
    },
  }, ai ? svg(ICONS.sparkle, 9) : null, h("span", { text: label }))));
  const { el, body } = shell(h("div", { class: "lv-toolbar" }, title, swatches, clearBtn), acts, actResult, list);
  el.classList.add("cl");
  let key: string | null = null;
  let copied: string | null = null;
  let colorKey = "";
  return {
    el,
    sync() {
      const clips = Live.clips;
      title.textContent = clips.length ? `Clipboard · ${clips.length}` : "Clipboard";
      clearBtn.style.display = clips.some((c) => !c.pinned) ? "" : "none";
      acts.style.display = clips.length ? "" : "none";
      const ck = Live.colors.map((c) => c.hex).join("|");
      if (ck !== colorKey) {
        colorKey = ck;
        swatches.replaceChildren(...Live.colors.map((c) => h("button", {
          class: "lv-swatch", style: `background:${c.hex}`, title: `${c.hex} — click to copy, right-click to remove`,
          onclick: () => void Live.copyClip(c.hex),
          oncontextmenu: (e: Event) => { e.preventDefault(); Live.removeColor(c.hex); },
        })), ...(Live.colors.length ? [h("span", { class: "lv-meta", text: "Ctrl+Alt+C picks a colour" })] : []));
      }
      const k = clips.map((c) => `${c.pinned}${c.time}`).join("|") + copied;
      if (k === key) return;
      key = k;
      body.classList.toggle("centered", !clips.length);
      if (!clips.length) {
        list.replaceChildren(empty("Nothing copied yet.", "Text you copy anywhere shows up here — click to copy it again. Ctrl+Alt+V opens this."));
        return;
      }
      list.replaceChildren(...clips.map((c) => {
        const acts = h("div", { class: "lv-row-acts hover" },
          roundBtn(ICONS.pin, c.pinned ? "Unpin" : "Pin", () => Live.pinClip(c.text)),
          roundBtn(ICONS.trash, "Delete", () => Live.removeClip(c.text)));
        acts.addEventListener("click", (e) => e.stopPropagation());
        const row = h("div", {
          class: `lv-item lv-clip${c.pinned ? " pinned" : ""}${copied === c.text ? " copied" : ""}`,
          role: "button", tabindex: "0", title: "Copy again",
          onmouseenter: () => { target = c.text; },
          onclick: async () => {
            if (!(await Live.copyClip(c.text))) return;
            copied = c.text;
            key = null;
            State.notify();
            window.setTimeout(() => {
              copied = null;
              key = null;
              State.notify();
            }, 1200);
          },
        },
        h("div", { class: c.pinned ? "glyph pin" : "glyph" }, svg(copied === c.text ? ICONS.check : c.pinned ? ICONS.pin : ICONS.clipboard, 11, copied === c.text ? { stroke: 2.6 } : {})),
        h("div", { class: "lv-col" },
          h("div", { class: "lv-name mono-ish", text: c.text }),
          h("div", { class: "lv-meta", text: copied === c.text ? "Copied" : `${fmtAgo(c.time)} · ${c.text.length} chars` })),
        acts);
        return row;
      }));
    },
  };
}

// ── Registry ──────────────────────────────────────────────────────────────────

export const LIVE_VIEWS: IslandViewName[] = ["media", "timer", "system", "calendar", "files", "notifs", "capture", "clips"];
/** Views that need keyboard focus while open. */
export const TEXT_VIEWS: ReadonlySet<IslandViewName> = new Set(["prompt", "capture", "palette", "agent"]);

export function buildLiveViews(actions: ViewActions, map: Map<IslandViewName, ViewHost>) {
  map.set("media", buildMedia());
  map.set("timer", buildTimer());
  map.set("system", buildSystem());
  map.set("calendar", buildCalendar(actions));
  map.set("files", buildFiles());
  map.set("notifs", buildNotifs());
  map.set("capture", buildCapture(actions));
  map.set("clips", buildClips());
  buildMoreViews(actions, map);
  buildAgentViews(actions, map);
}
