// Pure focus coach utilities: list parsing, recap time calculation, and weekly suggestions.
// Completely guarded against non-finite values, divide-by-zero, and malformed inputs.

import type { AppUsage } from "./types";

export interface WeekReportData {
  focusMin: number;
  focusMinLast: number;
  streak: number;
  topApps: AppUsage[];
  distractSecs: number;
  distractSecsLast: number;
  topDistraction: string | null;
  screenSecs: number;
}

/**
 * Cleans individual blocklist item: strips surrounding quotes, path prefixes, and trims.
 */
export function cleanBlockItem(item: string): string {
  if (typeof item !== "string") return "";
  let s = item.trim().replace(/^["']|["']$/g, "").trim();
  // Strip Windows and POSIX path prefixes
  s = s.replace(/^.*[\\/]/, "");
  return s.trim();
}

/**
 * "a, b,\nc" → ["a", "b", "c"], deduped case-insensitively and path-stripped.
 */
export function parseList(text: unknown): string[] {
  if (typeof text !== "string") return [];
  const seen = new Set<string>();
  return text
    .split(/[,\n]/)
    .map(cleanBlockItem)
    .filter((s) => s.length > 0 && !seen.has(s.toLowerCase()) && (seen.add(s.toLowerCase()), true));
}

/**
 * Checks whether recap is due according to 24h HH:MM format and whether already run today.
 */
export function isRecapDue(
  recapSetting: string,
  lastRecapDay: string,
  todayDay: string,
  now = new Date(),
): boolean {
  if (lastRecapDay === todayDay) return false;
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(recapSetting.trim());
  if (!match) return false;

  const targetMinutes = Number(match[1]) * 60 + Number(match[2]);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return currentMinutes >= targetMinutes;
}

/**
 * Generates focus/screen-time tips from weekly metrics.
 */
export function suggest(r: WeekReportData): string[] {
  const out: string[] = [];
  const distractSecs = Number.isFinite(r.distractSecs) ? Math.max(0, r.distractSecs) : 0;
  const distractLast = Number.isFinite(r.distractSecsLast) ? Math.max(0, r.distractSecsLast) : 0;
  const focusMin = Number.isFinite(r.focusMin) ? Math.max(0, r.focusMin) : 0;
  const focusMinLast = Number.isFinite(r.focusMinLast) ? Math.max(0, r.focusMinLast) : 0;
  const screenSecs = Number.isFinite(r.screenSecs) ? Math.max(0, r.screenSecs) : 0;
  const streak = Number.isFinite(r.streak) ? Math.max(0, r.streak) : 0;

  const pct = (a: number, b: number) => Math.round(((a - b) / Math.max(1, b)) * 100);

  if (distractSecs > 1800 && distractSecs > distractLast * 1.2) {
    const what = r.topDistraction ? `${r.topDistraction} mostly` : "mostly block-listed apps";
    out.push(
      `Distracting time is up ${distractLast ? `${pct(distractSecs, distractLast)}%` : "from zero"} on last week (${what}). Start a focus block before you open it.`,
    );
  }
  if (focusMin < 150) {
    out.push(
      `Only ${focusMin} focus minutes this week. One 25-minute block each morning would give you ${focusMin + 175}.`,
    );
  } else if (focusMin < focusMinLast * 0.8) {
    out.push(
      `Focus time fell from ${focusMinLast} to ${focusMin} minutes. Put two blocks on your calendar for tomorrow.`,
    );
  }
  const top = r.topApps?.[0];
  if (top && screenSecs > 0 && top.secs / screenSecs > 0.4 && out.length < 2) {
    out.push(
      `${top.name} took ${Math.round((top.secs / screenSecs) * 100)}% of your screen time. Set a daily limit on it in Screen time.`,
    );
  }
  if (distractSecs > 0 && distractSecs < distractLast * 0.8 && out.length < 2) {
    out.push(
      `Distracting time is down ${-pct(distractSecs, distractLast)}% on last week. Keep the same block list.`,
    );
  }
  if (!out.length) {
    out.push(
      streak > 1
        ? `Solid week. Keep the ${streak}-day focus streak alive with one block tomorrow.`
        : "Solid week. One focus block tomorrow starts a new streak.",
    );
  }
  return out.slice(0, 2);
}
