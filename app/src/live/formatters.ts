// Pure presentation and formatting helpers for time, clock, bytes, and colors.

export function fmtClock(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0:00";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** "in 8 min", "in 1 h 5 min", "now", "started 3 min ago". */
export function fmtUntil(startMs: number): string {
  if (!Number.isFinite(startMs) || startMs <= 0) return "—";
  const diff = startMs - Date.now();
  const mins = Math.round(Math.abs(diff) / 60_000);
  if (mins === 0) return "now";
  const span = mins >= 60 ? `${Math.floor(mins / 60)} h${mins % 60 ? ` ${mins % 60} min` : ""}` : `${mins} min`;
  return diff > 0 ? `in ${span}` : `started ${span} ago`;
}

export function fmtTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function fmtRate(bytesPerSec: number | null): string {
  return bytesPerSec == null || !Number.isFinite(bytesPerSec) || bytesPerSec <= 0 ? "—" : `${fmtBytes(Math.round(bytesPerSec))}/s`;
}

/** "3 d 4 h", "5 h 12 min", "42 min". */
export function fmtUptime(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return "0 min";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${m} min`;
  return `${m} min`;
}

/** "just now", "5 min ago", "2 h ago", "Tue". */
export function fmtAgo(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "just now";
  const mins = Math.round((Date.now() - ms) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return new Date(ms).toLocaleDateString([], { weekday: "short" });
}

/** "hsl(210, 60%, 40%)" for the colour picker. */
export function hsl(r: number, g: number, b: number): string {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
  }
  h = Math.round(h * 60 + 360) % 360;
  return `hsl(${h}, ${Math.round(sat * 100)}%, ${Math.round(l * 100)}%)`;
}

/** "3h 12m", "45m". */
export function fmtHM(secs: number): string {
  if (!Number.isFinite(secs) || secs <= 0) return "0m";
  const m = Math.round(secs / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

export {
  NOISE_APPS,
  NOISE_TEXT,
  isNoise,
  sanitizeNotificationText,
  appColor,
} from "./notif-utils.ts";
