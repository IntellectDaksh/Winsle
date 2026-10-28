/**
 * Pure utilities and thresholds for the idle gist capsule and rotating tips.
 */

export const ROTATE_MS = 6000;
/** Quiet time before the capsule dims. */
export const IDLE_DIM_MS = 7000;
/** A notification stays part of the gist this long (30 mins). */
export const NOTIF_FRESH_MS = 30 * 60_000;
/** An event counts as "coming up" inside this window (3 hours). */
export const EVENT_SOON_MS = 3 * 60 * 60_000;

export interface GistItem {
  key: string;
  label: string; // small coloured prefix
  color: string;
  text: string;
}

export const TIPS: [string, string][] = [
  ["Ctrl+Alt+K", "palette — apps, maths, timers, web"],
  ["Ctrl+Alt+L", "ghost mode — click straight through me"],
  ["Ctrl+Alt+C", "copy the colour under your cursor"],
  ["Ctrl+Alt+V", "everything you copied today"],
  ["Ctrl+Alt+F", "start a 25 min focus"],
  ["Ctrl+Alt+Space", "jot a task without switching apps"],
];

/**
 * Maps task state to a concise status label for the idle capsule.
 */
export function getClaudeStatusText(state: string): string {
  switch (state) {
    case "finished":
      return "done";
    case "approval":
      return "needs you";
    case "error":
      return "stopped";
    case "idle":
      return "last";
    default:
      return "working";
  }
}

/**
 * Calculates active session duration in whole minutes.
 */
export function calcClaudeDurationMinutes(
  since: number | null | undefined,
  state: string,
  now = performance.now()
): number {
  if (since == null || state === "idle" || !Number.isFinite(since)) {
    return 0;
  }
  const diff = now - since;
  return diff > 0 ? Math.floor(diff / 60_000) : 0;
}

/**
 * Checks if a notification is within the fresh display window.
 */
export function isNotificationFresh(time: number, now = Date.now(), maxAgeMs = NOTIF_FRESH_MS): boolean {
  if (!Number.isFinite(time) || time > now) return false;
  return now - time < maxAgeMs;
}

/**
 * Checks whether a calendar event is ongoing or starting soon.
 */
export function isEventComingSoon(start: number, end: number, now = Date.now(), windowMs = EVENT_SOON_MS): boolean {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  return end > now && start - now < windowMs;
}

/**
 * Evaluates battery level and generates a low battery warning gist item if appropriate.
 */
export function getBatteryStatus(
  percent: number | null | undefined,
  charging: boolean
): { key: string; label: string; color: string; text: string } | null {
  if (percent == null || !Number.isFinite(percent) || charging || percent > 30) {
    return null;
  }
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return {
    key: "battery",
    label: `Battery ${clamped}%`,
    color: clamped <= 15 ? "#F4505E" : "#F5A524",
    text: "not charging",
  };
}

/**
 * Calculates rotation index advance based on elapsed time.
 */
export function calcNextRotation(
  currentIndex: number,
  lastRotate: number,
  now = performance.now(),
  intervalMs = ROTATE_MS
): { index: number; rotated: boolean; newLastRotate: number } {
  if (now - lastRotate >= intervalMs) {
    return {
      index: currentIndex + 1,
      rotated: true,
      newLastRotate: now,
    };
  }
  return {
    index: currentIndex,
    rotated: false,
    newLastRotate: lastRotate,
  };
}

/**
 * Retrieves the scheduled shortcut tip for a given timestamp.
 */
export function getTipForTimestamp(timestamp = Date.now(), tips = TIPS): [string, string] {
  if (!tips.length) return ["", ""];
  const slot = Math.floor(timestamp / 600_000) % tips.length;
  const index = ((slot % tips.length) + tips.length) % tips.length;
  return tips[index];
}
