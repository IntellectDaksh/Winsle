// Live-activity state: what the OS pollers last reported, the timer, and the
// short "flash" the compact island shows for a toast or a finished download.
// Decides what the compact island displays and when the island opens itself.

import { Bridge, onEvent } from "../core/bridge";
import type { IslandViewName } from "../core/layout";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import { load, prefs, save, today } from "./prefs";
import { trackChanged } from "./lyrics";
import { isSecretText } from "./security";
import { hsl, isNoise, appColor } from "./formatters";
import type { AppUsage, ColorInfo, TaskLine } from "./types";
import type {
  CalendarEvent, CalendarInfo, ClipInfo, MediaInfo, NetInfo, PowerInfo, VolumeInfo, NotifInfo, PrivacyInfo, ProgressItem, ProgressInfo, SysInfo,
} from "./types";

export type CompactKind = "flash" | "calendar" | "timer" | "sys" | "progress" | "media";

export interface Flash {
  icon: "bell" | "check" | "note" | "cal" | "bolt" | "wifi" | "clip" | "vol" | "leaf" | "moon" | "bang" | "lock" | "drop" | "code";
  /** Colour swatch instead of an icon (colour picker). */
  swatch?: string;
  /** Optional 0–1 bar under the text (volume). */
  level?: number;
  color: string;
  title: string;
  sub: string;
  view: IslandViewName;
  until: number;
}

export interface TimerState {
  kind: "countdown" | "stopwatch";
  label: string;
  running: boolean;
  /** Countdown: total length. Stopwatch: unused. */
  totalMs: number;
  /** Time accumulated before the current run (pause/resume). */
  bankedMs: number;
  /** performance.now() of the current run's start, when running. */
  startedAt: number;
  /** Countdown reached zero and nobody dismissed it yet. */
  done: boolean;
  /** Pomodoro: what to offer when this countdown ends. */
  next: { label: string; minutes: number } | null;
}

export interface Clip {
  text: string;
  pinned: boolean;
  time: number;
}

export interface FinishedFile {
  id: string;
  name: string;
  kind: "download" | "render";
  bytes: number;
  time: number;
}

export interface FocusStats {
  day: string;
  sessions: number;
  minutes: number;
  /** Consecutive days with at least one finished focus session. */
  streak: number;
  lastDay: string;
}

const CLIP_LIMIT = 25;
export const CLIP_MAX_CHARS = 10_000;
const HISTORY_LEN = 60;
/** Input gap that counts as having taken a break. */
const BREAK_RESET_S = 5 * 60;

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Thresholds for the system pill; sustained for SYS_HOLD_MS before it shows. */
const CPU_HOT = 90;
const RAM_HOT = 93;
const GPU_TEMP_HOT = 83;
const SYS_HOLD_MS = 8000;

/** Calendar: show in the compact island this long before start, and open the island at T-2 min. */
const CAL_SOON_MS = 10 * 60_000;
const CAL_ALERT_MS = 2 * 60_000;
/** Reminders before every event, minutes. The last one opens the island. */
const CAL_REMINDERS = [30, 15, 5];

type Opener = (view: IslandViewName) => void;

class LiveStore {
  media: MediaInfo | null = null;
  /** performance.now() when media.position was last reported. */
  private mediaStamp = 0;

  sys: SysInfo | null = null;
  private sysHotSince: number | null = null;

  privacy: PrivacyInfo = { mic: [], cam: [] };
  progress: ProgressItem[] = [];
  notifs: NotifInfo[] = [];
  calendar: CalendarInfo = { events: [], error: null };
  flash: Flash | null = null;
  timer: TimerState | null = null;

  private alerted = new Set<string>();

  clips: Clip[] = load<Clip[]>("clips", []);
  /** Text we just put on the clipboard ourselves — not news when it comes back. */
  private ownClip: string | null = null;
  finished: FinishedFile[] = load<FinishedFile[]>("finished", []);
  mutedApps: string[] = load<string[]>("mutedApps", []);
  dnd: boolean = load<boolean>("dnd", false);
  focus: FocusStats = load<FocusStats>("focus", { day: "", sessions: 0, minutes: 0, streak: 0, lastDay: "" });
  /** Last 2 minutes of CPU / RAM, for the sparklines. */
  cpuHist: number[] = [];
  ramHist: number[] = [];
  lastCustomMinutes: number = load<number>("customMinutes", 10);
  /** performance.now() when the current stretch of continuous input began. */
  private activeSince = performance.now();

  /** Ghost mode: dimmed, click-through, never opens on hover. */
  locked: boolean = load<boolean>("locked", false);
  colors: { hex: string; time: number }[] = load<{ hex: string; time: number }[]>("colors", []);
  usage: AppUsage[] = [];
  private usageAt = 0;
  /** Per-app daily limits in minutes. */
  limits: Record<string, number> = load<Record<string, number>>("limits", {});
  private limitAlerted = new Set<string>();

  power: PowerInfo | null = null;
  online = true;
  volume: VolumeInfo | null = null;
  /** Notifications that arrived while a Focus timer ran — summarised after. */
  private heldDuringFocus = 0;
  /** When the current Claude Code burst of activity began (performance.now()). */
  claudeSince: number | null = null;
  private open: Opener = () => {};
  private reveal: () => void = () => {};

  // ── Derived ─────────────────────────────────────────────────────────────────

  mediaPosition(): number | null {
    const m = this.media;
    if (!m || m.position == null) return null;
    const extra = m.playing ? (performance.now() - this.mediaStamp) / 1000 : 0;
    const pos = m.position + extra;
    return m.duration ? Math.min(pos, m.duration) : pos;
  }

  timerMs(): number {
    const t = this.timer;
    if (!t) return 0;
    const elapsed = t.bankedMs + (t.running ? performance.now() - t.startedAt : 0);
    return t.kind === "countdown" ? Math.max(0, t.totalMs - elapsed) : elapsed;
  }

  /** Label of the hottest metric, once it has stayed hot for a while. */
  sysAlert(): string | null {
    if (this.sysHotSince == null || performance.now() - this.sysHotSince < SYS_HOLD_MS) return null;
    return this.sysLabel();
  }

  private sysLabel(): string | null {
    const s = this.sys;
    if (!s) return null;
    if (s.ramPct >= RAM_HOT) return `RAM ${Math.round(s.ramPct)}%`;
    if (s.cpu >= CPU_HOT) return `CPU ${Math.round(s.cpu)}%`;
    if (s.gpuTemp != null && s.gpuTemp >= GPU_TEMP_HOT) return `GPU ${Math.round(s.gpuTemp)}°C`;
    return null;
  }

  /** The event worth showing now: starting within 10 min, or started under 5 min ago. */
  soonEvent(): CalendarEvent | null {
    const now = Date.now();
    return (
      this.calendar.events.find((e) => e.start - now <= CAL_SOON_MS && now - e.start < 5 * 60_000 && e.end > now) ??
      null
    );
  }

  activeDownloads(): ProgressItem[] {
    return this.progress.filter((p) => !p.done);
  }

  compactKind(): CompactKind | null {
    if (this.flash && this.flash.until > performance.now()) return "flash";
    if (this.soonEvent()) return "calendar";
    if (this.timer && (this.timer.running || this.timer.done)) return "timer";
    if (this.media?.playing) return "media";
    if (this.activeDownloads().length) return "progress";
    if (this.sysAlert()) return "sys";
    return null;
  }

  /** Where a click on the compact island should land. */
  compactView(): IslandViewName | null {
    switch (this.compactKind()) {
      case "flash": return this.flash?.view ?? null;
      case "calendar": return "calendar";
      case "timer": return "timer";
      case "sys": return "system";
      case "progress": return "files";
      case "media": return "media";
      default: return null;
    }
  }

  /** Something in the compact island changes every second. */
  private ticking(): boolean {
    return this.compactKind() != null || State.mode === "expanded";
  }

  // ── Timer ───────────────────────────────────────────────────────────────────

  startCountdown(minutes: number, label: string, next: TimerState["next"] = null) {
    this.timer = {
      kind: "countdown", label, running: true, totalMs: minutes * 60_000,
      bankedMs: 0, startedAt: performance.now(), done: false, next,
    };
    Sound.play("blip");
    State.notify();
  }

  startStopwatch() {
    this.timer = {
      kind: "stopwatch", label: "Stopwatch", running: true, totalMs: 0,
      bankedMs: 0, startedAt: performance.now(), done: false, next: null,
    };
    Sound.play("blip");
    State.notify();
  }

  toggleTimer() {
    const t = this.timer;
    if (!t || t.done) return;
    if (t.running) {
      t.bankedMs += performance.now() - t.startedAt;
      t.running = false;
    } else {
      t.startedAt = performance.now();
      t.running = true;
    }
    State.notify();
  }

  addMinutes(n: number) {
    const t = this.timer;
    if (!t || t.kind !== "countdown") return;
    t.totalMs += n * 60_000;
    t.done = false;
    if (!t.running) {
      t.startedAt = performance.now();
      t.running = true;
    }
    State.notify();
  }

  clearTimer() {
    this.timer = null;
    State.notify();
  }

  private checkTimer() {
    const t = this.timer;
    if (!t || t.kind !== "countdown" || !t.running || this.timerMs() > 0) return;
    t.running = false;
    t.bankedMs = t.totalMs;
    t.done = true;
    Sound.play("finish");
    if (t.label === "Focus") {
      this.recordFocus(Math.round(t.totalMs / 60_000));
      t.next = this.nextBreak();
      // A finished focus session resets the screen-time counter too.
      this.activeSince = performance.now();
    }
    this.open("timer");
    if (t.label === "Focus" && !this.quietReason()) this.releaseHeld("While you focused");
  }

  // ── Calendar ────────────────────────────────────────────────────────────────

  private checkCalendar() {
    const now = Date.now();
    for (const e of this.calendar.events) {
      const left = e.start - now;
      // 30 / 15 / 5 minutes out: a flash in the capsule; 5 min also opens it.
      for (const m of CAL_REMINDERS) {
        const key = `${e.start}|${e.title}|${m}`;
        if (this.alerted.has(key)) continue;
        if (left <= m * 60_000 && left > (m - 1) * 60_000 - 30_000) {
          this.alerted.add(key);
          Sound.play(m === 5 ? "approval" : "peek");
          if (m === 5) this.open("calendar");
          else this.setFlash({ icon: "cal", color: "#C4B5FD", title: `In ${m} min`, sub: e.title || "Busy", view: "calendar" }, 10000);
        } else if (left <= (m - 1) * 60_000) {
          // App started late: skip reminders whose moment has passed.
          this.alerted.add(key);
        }
      }
      const key = `${e.start}|${e.title}|now`;
      if (this.alerted.has(key)) continue;
      if (left <= CAL_ALERT_MS && left > -60_000) {
        this.alerted.add(key);
        Sound.play("approval");
        this.open("calendar");
      }
    }
  }

  /** A Focus countdown is running: toasts are collected quietly, not flashed. */
  focusing(): boolean {
    const t = this.timer;
    return !!t && t.running && t.kind === "countdown" && t.label === "Focus";
  }

  /** A calendar event is happening right now. */
  inMeeting(): boolean {
    const now = Date.now();
    // Long blocks (sleep, all-day, travel) are not meetings.
    return this.calendar.events.some((e) => e.start <= now && e.end > now && e.end - e.start <= 3 * 3_600_000);
  }

  /** Why toasts are held instead of flashed, or null. */
  quietReason(): string | null {
    if (this.dnd) return "Do not disturb";
    if (this.focusing()) return "Focus";
    if (prefs().quietInMeetings && this.inMeeting()) return "In a meeting";
    return null;
  }

  heldCount(): number {
    return this.heldDuringFocus;
  }

  setDnd(on: boolean) {
    this.dnd = on;
    save("dnd", on);
    Sound.play("blip");
    this.setFlash({
      icon: "moon", color: on ? "#A78BFA" : "#94A3B8",
      title: on ? "Do not disturb" : "Notifications back on",
      sub: on ? "Toasts are collected quietly" : "", view: "notifs",
    }, 2200);
    if (!on) this.releaseHeld("While you were away");
  }

  private releaseHeld(title: string) {
    if (this.heldDuringFocus <= 0) return;
    const n = this.heldDuringFocus;
    this.heldDuringFocus = 0;
    window.setTimeout(() => this.setFlash({
      icon: "bell", color: "#60A5FA", title,
      sub: `${n} notification${n > 1 ? "s" : ""} — open to read`, view: "notifs",
    }, 6000), 2600);
  }

  // ── Notifications ───────────────────────────────────────────────────────────

  dismissNotif(id: string) {
    this.notifs = this.notifs.filter((n) => n.id !== id);
    State.notify();
  }

  clearNotifs() {
    this.notifs = [];
    this.heldDuringFocus = 0;
    State.notify();
  }

  isAppMuted(app: string): boolean {
    const target = app.trim().toLowerCase();
    return this.mutedApps.some((a) => a.trim().toLowerCase() === target);
  }

  muteApp(app: string) {
    const clean = app.trim();
    if (!clean) return;
    if (!this.isAppMuted(clean)) {
      this.mutedApps = [...this.mutedApps, clean];
    }
    const target = clean.toLowerCase();
    this.notifs = this.notifs.filter((n) => n.app.trim().toLowerCase() !== target);
    save("mutedApps", this.mutedApps);
    State.notify();
  }

  unmuteApp(app: string) {
    const target = app.trim().toLowerCase();
    this.mutedApps = this.mutedApps.filter((a) => a.trim().toLowerCase() !== target);
    save("mutedApps", this.mutedApps);
    State.notify();
  }

  // ── Clipboard history ───────────────────────────────────────────────────────

  private addClip(text: string) {
    if (!prefs().clipHistory) return;
    const clean = text.trim();
    if (!clean || isSecretText(clean)) return;
    const truncated = clean.length > CLIP_MAX_CHARS ? clean.slice(0, CLIP_MAX_CHARS) : clean;
    const old = this.clips.find((c) => c.text === truncated);
    const rest = this.clips.filter((c) => c.text !== truncated);
    const pinned = rest.filter((c) => c.pinned);
    const loose = rest.filter((c) => !c.pinned).slice(0, Math.max(0, CLIP_LIMIT - pinned.length - 1));
    const entry = { text: truncated, pinned: old?.pinned ?? false, time: Date.now() };
    this.clips = entry.pinned ? [entry, ...pinned, ...loose] : [...pinned, entry, ...loose];
    save("clips", this.clips);
  }

  async copyClip(text: string): Promise<boolean> {
    this.ownClip = text;
    try {
      await Bridge.clipSet(text);
    } catch {
      this.ownClip = null;
      return false;
    }
    this.addClip(text);
    Sound.play("blip");
    State.notify();
    return true;
  }

  pinClip(text: string) {
    this.clips = this.clips.map((c) => (c.text === text ? { ...c, pinned: !c.pinned } : c));
    // Pinned first, newest first within each group.
    this.clips.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.time - a.time);
    save("clips", this.clips);
    State.notify();
  }

  removeClip(text: string) {
    this.clips = this.clips.filter((c) => c.text !== text);
    save("clips", this.clips);
    State.notify();
  }

  clearClips() {
    this.clips = this.clips.filter((c) => c.pinned);
    save("clips", this.clips);
    State.notify();
  }

  // ── Focus stats ─────────────────────────────────────────────────────────────

  /** Today's numbers (a new day starts from zero). */
  focusToday(): FocusStats {
    const f = this.focus;
    return f.day === today() ? f : { ...f, day: today(), sessions: 0, minutes: 0 };
  }

  private recordFocus(minutes: number) {
    const day = today();
    const f = this.focusToday();
    const y = dayKey(new Date(Date.now() - 86_400_000));
    const streak = f.lastDay === day ? f.streak : f.lastDay === y ? f.streak + 1 : 1;
    this.focus = { day, sessions: f.sessions + 1, minutes: f.minutes + minutes, streak, lastDay: day };
    save("focus", this.focus);
  }

  /** Every fourth focus session earns a long break. */
  nextBreak(): { label: string; minutes: number } {
    const n = this.focusToday().sessions;
    return n > 0 && n % 4 === 0 ? { label: "Long break", minutes: 15 } : { label: "Break", minutes: 5 };
  }

  startFocus() {
    this.startCountdown(25, "Focus", { label: "Break", minutes: 5 });
  }

  rememberCustom(minutes: number) {
    this.lastCustomMinutes = minutes;
    save("customMinutes", minutes);
  }

  // ── Downloads history ───────────────────────────────────────────────────────

  private recordFinished(item: ProgressItem) {
    this.finished = [
      { id: item.id, name: item.name, kind: item.kind, bytes: item.bytes, time: Date.now() },
      ...this.finished.filter((f) => f.id !== item.id),
    ].slice(0, 6);
    save("finished", this.finished);
  }

  forgetFinished(id: string) {
    this.finished = this.finished.filter((f) => f.id !== id);
    save("finished", this.finished);
    State.notify();
  }

  // ── Colour picker ───────────────────────────────────────────────────────────

  private async onColor(c: ColorInfo) {
    this.colors = [{ hex: c.hex, time: Date.now() }, ...this.colors.filter((x) => x.hex !== c.hex)].slice(0, 16);
    save("colors", this.colors);
    await this.copyClip(c.hex);
    this.setFlash({
      icon: "drop", color: c.hex, swatch: c.hex, title: `${c.hex} copied`,
      sub: `rgb(${c.r}, ${c.g}, ${c.b}) · ${hsl(c.r, c.g, c.b)}`, view: "clips",
    }, 3500);
  }

  removeColor(hex: string) {
    this.colors = this.colors.filter((c) => c.hex !== hex);
    save("colors", this.colors);
    State.notify();
  }

  // ── Screen time ─────────────────────────────────────────────────────────────

  async loadUsage(force = false) {
    if (!force && performance.now() - this.usageAt < 60_000) return;
    this.usageAt = performance.now();
    const u = await Bridge.usageToday();
    if (!u) return;
    this.usage = u;
    this.checkLimits();
    State.notify();
  }

  usageTotal(): number {
    return this.usage.reduce((a, x) => a + x.secs, 0);
  }

  setLimit(app: string, minutes: number) {
    if (minutes > 0) this.limits = { ...this.limits, [app]: minutes };
    else {
      const { [app]: _, ...rest } = this.limits;
      this.limits = rest;
    }
    save("limits", this.limits);
    State.notify();
  }

  private checkLimits() {
    const day = today();
    for (const u of this.usage) {
      const lim = this.limits[u.name];
      const key = `${day}|${u.name}`;
      if (!lim || u.secs < lim * 60 || this.limitAlerted.has(key)) continue;
      this.limitAlerted.add(key);
      Sound.play("peek");
      this.setFlash({
        icon: "leaf", color: "#F5A524", title: `${u.name}: ${Math.round(u.secs / 60)} min today`,
        sub: `Past your ${lim} min limit`, view: "usage",
      }, 9000);
    }
  }

  // ── Break reminder ──────────────────────────────────────────────────────────

  private async checkBreak() {
    const mins = prefs().breakMinutes;
    const idle = await Bridge.idleSeconds();
    if (idle == null) return;
    if (idle >= BREAK_RESET_S) {
      this.activeSince = performance.now();
      return;
    }
    if (!mins || State.paused || this.timer?.running || this.inMeeting()) return;
    const activeMin = (performance.now() - this.activeSince) / 60_000;
    if (activeMin < mins) return;
    this.activeSince = performance.now();
    Sound.play("peek");
    this.setFlash({
      icon: "leaf", color: "#34D399", title: "Time for a short break",
      sub: `${Math.round(activeMin)} min at the screen — stand up, look away`, view: "timer",
    }, 9000);
  }

  /** Minutes of continuous input so far (for the timer view). */
  activeMinutes(): number {
    return Math.floor((performance.now() - this.activeSince) / 60_000);
  }

  // ── Wiring ──────────────────────────────────────────────────────────────────

  setFlash(f: Omit<Flash, "until">, ms: number) {
    this.flash = { ...f, until: performance.now() + ms };
    if (State.mode !== "expanded") this.reveal();
    State.notify();
    window.setTimeout(() => State.notify(), ms + 50);
  }

  register(open: Opener, reveal: () => void, captureOpen: () => void, toggle: () => void) {
    this.open = open;
    this.reveal = reveal;

    void onEvent<MediaInfo | null>("live-media", (m) => {
      // Art is only re-sent when the track changes; keep the one we have.
      if (m && !m.art && this.media && this.media.title === m.title && this.media.app === m.app) {
        m.art = this.media.art;
      }
      this.media = m;
      this.mediaStamp = performance.now();
      trackChanged(m);
      State.notify();
    });

    void onEvent<SysInfo>("live-sys", (s) => {
      this.sys = s;
      this.cpuHist = [...this.cpuHist, s.cpu].slice(-HISTORY_LEN);
      this.ramHist = [...this.ramHist, s.ramPct].slice(-HISTORY_LEN);
      const hot = this.sysLabel() != null;
      if (hot && this.sysHotSince == null) this.sysHotSince = performance.now();
      if (!hot) this.sysHotSince = null;
      if (State.mode === "expanded" && State.view === "system") State.notify();
      else if (hot || this.compactKind() === "sys") State.notify();
    });

    void onEvent<PrivacyInfo>("live-privacy", (p) => {
      this.privacy = p;
      State.notify();
    });

    void onEvent<ProgressInfo>("live-progress", (p) => {
      for (const item of p.items) {
        if (item.done && !this.progress.some((x) => x.id === item.id && x.done)) {
          this.recordFinished(item);
          Sound.play("finish");
          this.setFlash({
            icon: "check", color: "#34D399",
            title: item.name,
            sub: item.kind === "render" ? "Render finished" : "Download finished",
            view: "files",
          }, 4500);
        }
      }
      this.progress = p.items;
      State.notify();
    });

    void onEvent<NotifInfo>("live-notif", (n) => {
      if (State.paused || this.isAppMuted(n.app)) return;
      // The same toast again (PowerToys, OEM tools…): bump the old one, stay quiet.
      const same = this.notifs.find((x) => x.app === n.app && x.title === n.title && x.body === n.body);
      if (same) {
        same.repeats = (same.repeats ?? 1) + 1;
        same.time = n.time;
        this.notifs = [same, ...this.notifs.filter((x) => x !== same)];
        State.notify();
        return;
      }
      n.noise = isNoise(n);
      this.notifs = [n, ...this.notifs.filter((x) => x.id !== n.id)].slice(0, 20);
      if (n.noise) {
        State.notify();
        return;
      }
      if (this.quietReason()) {
        // Focus / DND / meeting: keep it in the list, don't interrupt.
        this.heldDuringFocus++;
        State.notify();
        return;
      }
      Sound.play("pop");
      if (State.mode !== "expanded") {
        this.setFlash({ icon: "bell", color: appColor(n.app), title: n.app, sub: n.title && n.body ? `${n.title} — ${n.body}` : n.title || n.body, view: "notifs" }, 5500);
      } else {
        State.notify();
      }
    });

    void onEvent<CalendarInfo>("live-calendar", (c) => {
      this.calendar = c;
      State.notify();
    });

    void onEvent<null>("capture-open", () => captureOpen());

    void onEvent<PowerInfo>("live-power", (p) => {
      const prev = this.power;
      this.power = p;
      if (prev && p.percent != null) {
        if (p.charging && !prev.charging) {
          Sound.play("blip");
          this.setFlash({ icon: "bolt", color: "#34D399", title: "Charging", sub: `${p.percent}%`, view: "system" }, 3000);
        }
        for (const lvl of [20, 10]) {
          if (!p.charging && prev.percent != null && prev.percent > lvl && p.percent <= lvl) {
            Sound.play("error");
            this.setFlash({ icon: "bolt", color: "#F4505E", title: `Battery ${p.percent}%`, sub: "Plug in soon", view: "system" }, 6000);
          }
        }
      }
      State.notify();
    });

    void onEvent<NetInfo>("live-net", (n) => {
      const was = this.online;
      this.online = n.online;
      if (was !== n.online) {
        Sound.play(n.online ? "blip" : "error");
        this.setFlash({
          icon: "wifi", color: n.online ? "#34D399" : "#F4505E",
          title: n.online ? "Back online" : "You're offline",
          sub: n.online ? "Connection restored" : "Network connection lost",
          view: "system",
        }, n.online ? 2500 : 5000);
      }
    });

    void onEvent<ClipInfo>("live-clip", (c) => {
      if (this.ownClip != null && c.text === this.ownClip.trim().slice(0, 200)) {
        this.ownClip = null;
        return;
      }
      if (isSecretText(c.text)) return;
      this.addClip(c.text);
      // Not while typing into the island itself, and never over a more important flash.
      if (State.mode === "expanded" && (State.view === "prompt" || State.view === "capture")) return;
      if (this.flash && this.flash.until > performance.now() && this.flash.icon !== "clip") return;
      this.setFlash({ icon: "clip", color: "#94A3B8", title: "Copied", sub: c.text, view: "capture" }, 1800);
    });

    void onEvent<VolumeInfo>("live-volume", (v) => {
      this.volume = v;
      this.showVolume();
    });

    void onEvent<null>("island-toggle", () => toggle());
    // Generic one-off message from the backend (updater, etc.).
    void onEvent<{ title: string; sub: string }>("live-flash", (f) =>
      this.setFlash({ icon: "bell", color: "#A5B4FC", title: f.title, sub: f.sub, view: "notifs" }, 8000));

    // Ctrl+Alt+F: start a focus session, or pause/resume the one running.
    void onEvent<null>("hotkey-focus", () => {
      if (this.timer && !this.timer.done) this.toggleTimer();
      else this.startFocus();
      this.open("timer");
    });
    void onEvent<null>("hotkey-clips", () => this.open("clips"));
    void onEvent<ColorInfo>("color-picked", (c) => void this.onColor(c));
    // Screen time, refreshed in the background for limits and the recap.
    window.setInterval(() => void this.loadUsage(), 5 * 60_000);
    window.setTimeout(() => void this.loadUsage(true), 15_000);

    window.setInterval(() => void this.checkBreak(), 60_000);
    // The settings window shares this storage: pick up "Clear history".
    window.addEventListener("storage", (e) => {
      if (e.key !== "winsle.clips") return;
      this.clips = load<Clip[]>("clips", []);
      State.notify();
    });

    void this.loadTasks();
    // Ask for the calendar now rather than waiting for the 5-minute poll.
    void Bridge.calendarRefresh();

    // One cheap heartbeat drives every countdown on screen: the timer, the song
    // position, "in 8 min". Nothing is redrawn when nothing is visible.
    window.setInterval(() => {
      this.checkTimer();
      this.checkCalendar();
      if (this.flash && this.flash.until <= performance.now()) this.flash = null;
      if (State.mode !== "hidden" && this.ticking()) State.notify();
    }, 1000);
  }

  async setVolume(level: number) {
    const v = await Bridge.volumeSet(level);
    if (v == null) return;
    this.volume = { level: v, muted: false };
    State.notify();
  }

  async toggleMute() {
    const muted = await Bridge.volumeMute();
    if (muted == null) return;
    this.volume = { level: this.volume?.level ?? 0.5, muted };
    this.showVolume();
  }

  showVolume() {
    const v = this.volume;
    if (!v) return;
    this.setFlash({
      icon: "vol", color: "#E5E7EB", title: v.muted ? "Muted" : `Volume ${Math.round(v.level * 100)}%`,
      sub: "", view: "media", level: v.muted ? 0 : v.level,
    }, 1400);
  }

  /** Scroll on the capsule: master volume up/down. */
  async stepVolume(delta: number) {
    const level = await Bridge.volumeStep(delta);
    if (level == null) return;
    this.volume = { level, muted: false };
    this.showVolume();
  }

  /** Recent task lines from inbox.md, newest last. */
  tasks: TaskLine[] = [];
  tasksError: string | null = null;

  async loadTasks() {
    try {
      this.tasks = await Bridge.captureList();
      this.tasksError = null;
    } catch (err) {
      this.tasksError = String(err).replace(/^Error:\s*/, "");
    }
    State.notify();
  }

  async toggleTask(t: TaskLine) {
    try {
      const done = await Bridge.captureToggle(t.line, t.text);
      this.tasks = this.tasks.map((x) => (x.line === t.line ? { ...x, done } : x));
      if (done) Sound.play("finish");
      State.notify();
    } catch {
      // The file changed underneath us: show what is there now.
      await this.loadTasks();
    }
  }

  async saveCapture(text: string): Promise<string> {
    const path = await Bridge.captureSave(text);
    void this.loadTasks();
    this.setFlash({ icon: "note", color: "#A78BFA", title: "Saved to inbox", sub: text, view: "capture" }, 2500);
    return path;
  }
}

export const Live = new LiveStore();

// ── Formatting ────────────────────────────────────────────────────────────────

export * from "./formatters";
