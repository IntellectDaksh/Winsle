/**
 * Utility functions for agent prompts, time parsing, snippets, and history bounds.
 */

export interface ReminderItem {
  id: number;
  text: string;
  at: number; // epoch ms
}

export interface SnippetItem {
  name: string;
  text: string;
}

export function parseMinutes(n: string, unit: string): number {
  const v = parseFloat(n);
  if (!Number.isFinite(v) || v <= 0) return 0;
  const mins = /^h/i.test(unit) ? v * 60 : /^s/i.test(unit) ? v / 60 : v;
  return Number.isFinite(mins) && mins > 0 ? mins : 0;
}

/** "5pm", "17:30", "9:15 am" → next occurrence as epoch ms. */
export function parseClock(s: string, nowMs = Date.now()): number | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(s.trim());
  if (!m) return null;
  let hr = +m[1];
  const min = +(m[2] ?? 0);
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && hr < 12) hr += 12;
  if (ap === "am" && hr === 12) hr = 0;
  if (hr > 23 || min > 59) return null;
  const d = new Date(nowMs);
  d.setHours(hr, min, 0, 0);
  if (d.getTime() <= nowMs) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** Strips ask prefixes, cleans whitespace, and bounds length to prevent prompt injection / memory bloat. */
export function sanitizePrompt(q: string, maxLen = 2000): string {
  if (typeof q !== "string") return "";
  const cleaned = q.trim().replace(/^(\?|ask)\s*/i, "");
  return cleaned.slice(0, maxLen).trim();
}

/** Validates and bounds snippet naming and text content. */
export function sanitizeSnippet(name: string, text: string): SnippetItem | null {
  const n = (name ?? "").trim().replace(/^;/, "");
  const t = (text ?? "").trim();
  if (!n || !t) return null;
  return {
    name: n.slice(0, 64),
    text: t.slice(0, 10_000),
  };
}

/** Validates and bounds reminder timestamps and text. */
export function sanitizeReminder(text: string, at: number, id = Date.now()): ReminderItem | null {
  const t = (text ?? "").trim() || "Reminder";
  if (!Number.isFinite(at) || at <= 0) return null;
  return {
    id: Number.isFinite(id) ? id : Date.now(),
    text: t.slice(0, 500),
    at,
  };
}

/** Trims conversation history to maximum recent entries. */
export function trimHistory<T>(history: T[], limit = 8): T[] {
  if (!Array.isArray(history)) return [];
  return history.slice(0, Math.max(1, limit));
}

export function greeting(hour = new Date().getHours()): string {
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}
