// Winsle's mini agent. Plain-language requests ("remind me in 20 min to call
// mum", "pause music", "what's next") are understood by fast local rules first;
// anything else goes to a local Ollama model that answers or picks one tool.
// Also owns reminders, snippets, automations, the morning briefing and the
// evening journal — the glue that links the other live features together.

import { Bridge } from "../core/bridge";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import { Dev, fmtDuration } from "./dev";
import { load, prefs, save, today } from "./prefs";
import { Live, fmtHM, fmtTime, fmtUntil } from "./store";

export interface Reminder {
  id: number;
  text: string;
  at: number; // epoch ms
}

export interface Snippet {
  name: string;
  text: string;
}

export interface AgentReply {
  text: string;
  /** What was done, for the little chips under the answer. */
  did: string[];
  ai: boolean;
}

export type RuleId = "focusPause" | "meetingPause" | "limitBreak" | "briefing" | "journal";

export const RULES: { id: RuleId; title: string; sub: string }[] = [
  { id: "focusPause", title: "Focus pauses music", sub: "When a focus session starts, pause whatever is playing" },
  { id: "meetingPause", title: "Meetings pause music", sub: "When a calendar event starts, pause playback" },
  { id: "limitBreak", title: "Limits start a break", sub: "Hitting an app's daily limit starts a 5 min break timer" },
  { id: "briefing", title: "Morning briefing", sub: "First activity of the day: events, tasks, yesterday's numbers" },
  { id: "journal", title: "Evening journal", sub: "At 21:00, write the day's summary to journal.md" },
];

const DEFAULT_RULES: Record<RuleId, boolean> = { focusPause: true, meetingPause: true, limitBreak: false, briefing: true, journal: true };
const PREFERRED_MODELS = ["qwen2.5:3b-instruct", "qwen2.5:7b-instruct", "qwen2.5:1.5b-instruct"];

const SYSTEM = `You are Winsle, a tiny assistant living in a Windows dynamic island.
Reply with ONE JSON object and nothing else:
{"tool": "<name or none>", "args": {...}, "reply": "<one short sentence for the user>"}
Tools:
- remind {"minutes": number, "text": string}
- timer {"minutes": number}
- task {"text": string}
- open_app {"name": string}
- web {"query": string}
- none {} (just answer in "reply", max 2 sentences)
Today is {DATE}, the time is {TIME}.`;

function parseMinutes(n: string, unit: string): number {
  const v = parseFloat(n);
  return /^h/i.test(unit) ? v * 60 : /^s/i.test(unit) ? v / 60 : v;
}

/** "5pm", "17:30", "9:15 am" → next occurrence as epoch ms. */
function parseClock(s: string): number | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(s.trim());
  if (!m) return null;
  let hr = +m[1];
  const min = +(m[2] ?? 0);
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && hr < 12) hr += 12;
  if (ap === "am" && hr === 12) hr = 0;
  if (hr > 23 || min > 59) return null;
  const d = new Date();
  d.setHours(hr, min, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

class AgentCore {
  reminders: Reminder[] = load<Reminder[]>("reminders", []);
  snippets: Snippet[] = load<Snippet[]>("snippets", []);
  rules: Record<RuleId, boolean> = { ...DEFAULT_RULES, ...load<Partial<Record<RuleId, boolean>>>("rules", {}) };
  /** Last few exchanges, newest first. */
  history: { q: string; a: AgentReply; at: number }[] = [];
  busy = false;
  aiState: "unknown" | "ready" | "starting" | "off" = "unknown";
  model: string | null = null;

  private wasFocus = false;
  private meetingKeys = new Set<string>();
  private limitSeen = new Set<string>();

  constructor() {
    window.setInterval(() => this.tick(), 5000);
  }

  // ── Reminders ───────────────────────────────────────────────────────────────

  addReminder(text: string, at: number) {
    this.reminders = [...this.reminders, { id: Date.now(), text: text.trim() || "Reminder", at }].sort((a, b) => a.at - b.at);
    save("reminders", this.reminders);
    State.notify();
  }

  removeReminder(id: number) {
    this.reminders = this.reminders.filter((r) => r.id !== id);
    save("reminders", this.reminders);
    State.notify();
  }

  snooze(r: Reminder, minutes: number) {
    this.removeReminder(r.id);
    this.addReminder(r.text, Date.now() + minutes * 60_000);
  }

  // ── Snippets ────────────────────────────────────────────────────────────────

  saveSnippet(name: string, text: string) {
    const n = name.trim().replace(/^;/, "");
    if (!n || !text.trim()) return;
    this.snippets = [{ name: n, text }, ...this.snippets.filter((s) => s.name.toLowerCase() !== n.toLowerCase())].slice(0, 40);
    save("snippets", this.snippets);
    State.notify();
  }

  removeSnippet(name: string) {
    this.snippets = this.snippets.filter((s) => s.name !== name);
    save("snippets", this.snippets);
    State.notify();
  }

  // ── Rules ───────────────────────────────────────────────────────────────────

  setRule(id: RuleId, on: boolean) {
    this.rules = { ...this.rules, [id]: on };
    save("rules", this.rules);
    State.notify();
  }

  private pauseMusic(why: string) {
    if (!Live.media?.playing) return;
    void Bridge.mediaControl("play_pause");
    Live.setFlash({ icon: "vol", color: "#94A3B8", title: "Music paused", sub: why, view: "media" }, 2500);
  }

  private tick() {
    const now = Date.now();
    // Reminders that are due.
    const due = this.reminders.filter((r) => r.at <= now);
    if (due.length) {
      this.reminders = this.reminders.filter((r) => r.at > now);
      save("reminders", this.reminders);
      for (const r of due) {
        Sound.play("approval");
        Live.setFlash({ icon: "bell", color: "#F5A524", title: "Reminder", sub: r.text, view: "agent" }, 15000);
      }
      State.notify();
    }

    const focus = Live.focusing();
    if (focus && !this.wasFocus && this.rules.focusPause) this.pauseMusic("Focus started");
    this.wasFocus = focus;

    if (this.rules.meetingPause) {
      for (const e of Live.calendar.events) {
        const key = `${e.start}|${e.title}`;
        if (e.start <= now && now - e.start < 60_000 && e.end - e.start <= 3 * 3_600_000 && !this.meetingKeys.has(key)) {
          this.meetingKeys.add(key);
          this.pauseMusic(e.title || "Meeting started");
        }
      }
    }

    if (this.rules.limitBreak) {
      for (const u of Live.usage) {
        const lim = Live.limits[u.name];
        const key = `${today()}|${u.name}`;
        if (lim && u.secs >= lim * 60 && !this.limitSeen.has(key) && !Live.timer) {
          this.limitSeen.add(key);
          Live.startCountdown(5, "Break");
        }
      }
    }

    const day = today();
    const d = new Date();
    if (this.rules.briefing && load<string>("briefedOn", "") !== day && d.getHours() >= 5) {
      void Bridge.idleSeconds().then((idle) => {
        if (idle != null && idle < 30 && load<string>("briefedOn", "") !== day) {
          save("briefedOn", day);
          this.briefing();
        }
      });
    }
    if (this.rules.journal && d.getHours() >= 21 && load<string>("journalOn", "") !== day) {
      save("journalOn", day);
      void this.writeJournal(false);
    }
  }

  /** One line about today, for the morning flash. */
  briefing() {
    const now = Date.now();
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const events = Live.calendar.events.filter((e) => e.start > now && e.start <= end.getTime());
    const open = Live.tasks.filter((t) => !t.done).length;
    const parts = [
      events.length ? `${events.length} event${events.length > 1 ? "s" : ""}, first ${fmtTime(events[0].start)}` : "no events",
      open ? `${open} open task${open > 1 ? "s" : ""}` : "inbox clear",
    ];
    const rem = this.reminders.filter((r) => r.at <= end.getTime()).length;
    if (rem) parts.push(`${rem} reminder${rem > 1 ? "s" : ""}`);
    Sound.play("greet");
    Live.setFlash({ icon: "leaf", color: "#FBBF24", title: greeting(), sub: parts.join(" · "), view: "today" }, 12000);
  }

  /** Writes today's summary to journal.md; returns the path. */
  async writeJournal(announce = true): Promise<string | null> {
    const f = Live.focusToday();
    const d = Dev.today();
    const done = Live.tasks.filter((t) => t.done).map((t) => `  - ${t.text}`);
    const lines = [
      `## ${new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`,
      `- Screen time: ${fmtHM(Live.usageTotal())}${Live.usage[0] ? ` (most: ${Live.usage[0].name} ${fmtHM(Live.usage[0].secs)})` : ""}`,
      `- Focus: ${f.minutes} min in ${f.sessions} session${f.sessions === 1 ? "" : "s"}${f.streak > 1 ? `, ${f.streak}-day streak` : ""}`,
      `- Coding: ${d.turns} turn${d.turns === 1 ? "" : "s"}, ${fmtDuration(d.ms)}, ${d.files} files changed`,
      `- Downloads finished: ${Live.finished.filter((x) => x.time >= new Date().setHours(0, 0, 0, 0)).length}`,
      ...(done.length ? ["- Done:", ...done] : []),
    ];
    try {
      const path = await Bridge.journalAppend(lines.join("\n"));
      if (announce || this.rules.journal) {
        Live.setFlash({ icon: "note", color: "#A78BFA", title: "Day saved to journal", sub: path, view: "agent" }, 4000);
      }
      return path;
    } catch {
      return null;
    }
  }

  // ── AI plumbing ─────────────────────────────────────────────────────────────

  /** Makes sure Ollama runs and picks a model. False when no local AI is available. */
  async ensureAi(): Promise<boolean> {
    let st = await Bridge.aiStatus();
    if (!st) return false;
    if (!st.running) {
      // Loading a model on a machine that is already short of memory would hurt
      // more than it helps: stay on the rules until RAM frees up.
      if ((Live.sys?.ramPct ?? 0) >= 88) {
        this.aiState = "off";
        State.notify();
        throw new Error(`RAM is at ${Math.round(Live.sys!.ramPct)}% — local AI stays off until some frees up.`);
      }
      if (!st.installed) {
        this.aiState = "off";
        return false;
      }
      this.aiState = "starting";
      State.notify();
      try {
        await Bridge.aiStart();
      } catch (err) {
        this.aiState = "off";
        State.notify();
        throw err;
      }
      st = await Bridge.aiStatus();
    }
    if (!st?.running || !st.models.length) {
      this.aiState = "off";
      State.notify();
      return false;
    }
    const wanted = prefs().aiModel;
    this.model = st.models.find((m) => m === wanted) ?? PREFERRED_MODELS.find((m) => st!.models.includes(m)) ?? st.models[0];
    this.aiState = "ready";
    return true;
  }

  /** Free-text completion with the local model. */
  async complete(system: string, prompt: string, json = false): Promise<string> {
    if (!(await this.ensureAi()) || !this.model) throw new Error("Local AI isn't available — install Ollama and pull a model (e.g. qwen2.5:3b-instruct).");
    return Bridge.aiChat(this.model, system, prompt, json);
  }

  // ── Requests ────────────────────────────────────────────────────────────────

  async ask(q: string): Promise<AgentReply> {
    const text = q.trim().replace(/^(\?|ask)\s*/i, "");
    this.busy = true;
    State.notify();
    let reply: AgentReply;
    try {
      reply = this.local(text) ?? (await this.viaAi(text));
    } catch (err) {
      reply = { text: String(err).replace(/^Error:\s*/, ""), did: [], ai: false };
    }
    this.busy = false;
    this.history = [{ q: text, a: reply, at: Date.now() }, ...this.history].slice(0, 8);
    State.notify();
    return reply;
  }

  /** Fast deterministic intents; null when nothing matched. */
  local(t: string): AgentReply | null {
    const r = (text: string, ...did: string[]): AgentReply => ({ text, did, ai: false });
    let m: RegExpExecArray | null;

    if ((m = /^remind me (?:in|after) (\d+(?:\.\d+)?)\s*(minutes?|mins?|m|hours?|hrs?|h|seconds?|secs?|s)\b\s*(?:to\s+)?(.*)$/i.exec(t))) {
      const mins = parseMinutes(m[1], m[2]);
      const what = m[3] || "Reminder";
      this.addReminder(what, Date.now() + mins * 60_000);
      return r(`I'll remind you ${fmtUntil(Date.now() + mins * 60_000)}: ${what}`, "Reminder set");
    }
    if ((m = /^remind me (?:at|by) ([\d:]+\s*(?:am|pm)?)\s*(?:to\s+)?(.*)$/i.exec(t))) {
      const at = parseClock(m[1]);
      if (at) {
        this.addReminder(m[2] || "Reminder", at);
        return r(`Reminder at ${fmtTime(at)}: ${m[2] || "Reminder"}`, "Reminder set");
      }
    }
    if ((m = /^(?:start\s+)?(?:a\s+)?(\d+)\s*(?:m|min|minute)s?\s*timer$|^timer\s+(\d+)/i.exec(t))) {
      const n = +(m[1] ?? m[2]);
      Live.startCountdown(n, `${n} min`);
      return r(`${n} minute timer running.`, "Timer");
    }
    if (/^(start\s+)?(a\s+)?focus( session)?$/i.test(t)) {
      Live.startFocus();
      return r("Focus for 25 minutes — notifications are held.", "Focus");
    }
    if (/^(stop|cancel|clear) (the )?timer$/i.test(t)) {
      Live.clearTimer();
      return r("Timer cleared.", "Timer");
    }
    if ((m = /^(?:add (?:a )?task|todo|task|note)[:\s]+(.+)$/i.exec(t))) {
      void Live.saveCapture(m[1]);
      return r(`Added to your inbox: ${m[1]}`, "Task");
    }
    if (/^(pause|play|resume)( music| the music| song)?$/i.test(t)) {
      void Bridge.mediaControl("play_pause");
      return r(Live.media?.playing ? "Paused." : "Playing.", "Media");
    }
    if (/^(next|skip)( song| track)?$/i.test(t)) {
      void Bridge.mediaControl("next");
      return r("Skipped.", "Media");
    }
    if (/^(previous|prev|back)( song| track)?$/i.test(t)) {
      void Bridge.mediaControl("prev");
      return r("Previous track.", "Media");
    }
    if ((m = /^(?:set )?volume (?:to )?(\d{1,3})\s*%?$/i.exec(t))) {
      void Live.setVolume(Math.min(100, +m[1]) / 100);
      return r(`Volume ${Math.min(100, +m[1])}%.`, "Volume");
    }
    if (/^(dnd|do not disturb|quiet)( on)?$/i.test(t)) {
      if (!Live.dnd) Live.setDnd(true);
      return r("Do not disturb is on.", "Quiet");
    }
    if (/^(dnd|do not disturb|quiet) off$/i.test(t)) {
      if (Live.dnd) Live.setDnd(false);
      return r("Notifications are back on.", "Quiet");
    }
    if (/^(what'?s next|next event|my day|agenda|calendar)\??$/i.test(t)) {
      const now = Date.now();
      const evs = Live.calendar.events.filter((e) => e.end > now).slice(0, 3);
      return r(evs.length ? evs.map((e) => `${fmtTime(e.start)} ${e.title || "Busy"}`).join(" · ") : "Nothing on the calendar in the next 24 hours.");
    }
    if (/^(screen ?time|how long( have i been)?.*)\??$/i.test(t)) {
      const top = Live.usage.slice(0, 3).map((u) => `${u.name} ${fmtHM(u.secs)}`).join(", ");
      return r(`${fmtHM(Live.usageTotal())} today${top ? ` — ${top}` : ""}.`);
    }
    if (/^(lock( my)? (pc|computer|screen))$/i.test(t)) {
      void Bridge.systemAction("lock");
      return r("Locking.", "Lock");
    }
    if (/^(journal|save (my )?day|write journal)$/i.test(t)) {
      void this.writeJournal(true);
      return r("Writing today's summary to journal.md.", "Journal");
    }
    if (/^(brief(ing)?|morning)$/i.test(t)) {
      this.briefing();
      return r("Here's your day.", "Briefing");
    }
    return null;
  }

  private async viaAi(t: string): Promise<AgentReply> {
    const now = new Date();
    const system = SYSTEM.replace("{DATE}", now.toDateString()).replace("{TIME}", now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    const raw = await this.complete(system, t, true);
    let j: { tool?: string; args?: Record<string, unknown>; reply?: string };
    try {
      j = JSON.parse(raw);
    } catch {
      return { text: raw.slice(0, 400), did: [], ai: true };
    }
    const a = j.args ?? {};
    const s = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : "");
    const n = (k: string) => Number(a[k]) || 0;
    const did: string[] = [];
    switch (j.tool) {
      case "remind":
        if (n("minutes") > 0) {
          this.addReminder(s("text") || t, Date.now() + n("minutes") * 60_000);
          did.push("Reminder set");
        }
        break;
      case "timer":
        if (n("minutes") > 0) {
          Live.startCountdown(n("minutes"), `${n("minutes")} min`);
          did.push("Timer");
        }
        break;
      case "task":
        if (s("text")) {
          void Live.saveCapture(s("text"));
          did.push("Task");
        }
        break;
      case "open_app": {
        const apps = (await Bridge.appsList()) ?? [];
        const q = s("name").toLowerCase();
        const app = apps.find((x) => x.name.toLowerCase() === q) ?? apps.find((x) => x.name.toLowerCase().includes(q));
        if (app) {
          await Bridge.appLaunch(app.path).catch(() => {});
          did.push(`Opened ${app.name}`);
        }
        break;
      }
      case "web":
        if (s("query")) {
          void Bridge.openUrl(`https://www.google.com/search?q=${encodeURIComponent(s("query"))}`);
          did.push("Searched");
        }
        break;
    }
    return { text: (j.reply ?? "").trim() || (did.length ? "Done." : "I'm not sure."), did, ai: true };
  }

  // ── Clipboard & notification helpers ────────────────────────────────────────

  async transform(kind: string, text: string): Promise<string> {
    const local: Record<string, (s: string) => string> = {
      upper: (s) => s.toUpperCase(),
      lower: (s) => s.toLowerCase(),
      title: (s) => s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase()),
      trim: (s) => s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim(),
      json: (s) => JSON.stringify(JSON.parse(s), null, 2),
      slug: (s) => s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-"),
    };
    if (local[kind]) return local[kind](text);
    const prompts: Record<string, string> = {
      summarize: "Summarize the text in 1-3 short sentences. Output only the summary.",
      fix: "Fix spelling, grammar and punctuation. Keep the meaning, tone and language. Output only the corrected text.",
      english: "Translate the text to natural English. Output only the translation.",
      bullets: "Rewrite the text as concise bullet points starting with '- '. Output only the bullets.",
      explain: "Explain what this text or code does in 2-3 plain sentences.",
    };
    if (!prompts[kind]) throw new Error("unknown action");
    return this.complete(prompts[kind], text.slice(0, 8000));
  }

  /** Grouped digest of the notification list; AI makes it a sentence when asked. */
  digestPlain(): string {
    const by = new Map<string, number>();
    for (const n of Live.notifs) if (!n.noise) by.set(n.app, (by.get(n.app) ?? 0) + (n.repeats ?? 1));
    return [...by].sort((a, b) => b[1] - a[1]).map(([a, c]) => `${a} ${c}`).join(" · ");
  }

  async digestAi(): Promise<string> {
    const list = Live.notifs.filter((n) => !n.noise).slice(0, 15).map((n) => `${n.app}: ${n.title} — ${n.body}`).join("\n");
    if (!list) return "Nothing worth summarising.";
    return this.complete("Summarise these desktop notifications in at most 3 short bullet points, most important first. Mention who needs a reply. Output only the bullets starting with '- '.", list);
  }
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export const Agent = new AgentCore();
