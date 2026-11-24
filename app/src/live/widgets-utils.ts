export type WidgetKind =
  | "media"
  | "calendar"
  | "timer"
  | "system"
  | "files"
  | "notifs"
  | "clips"
  | "inbox"
  | "screen"
  | "integrations";

export const WIDGET_LABELS: Record<WidgetKind, string> = {
  media: "Now playing",
  calendar: "Next event",
  timer: "Timer",
  system: "System",
  files: "Downloads & renders",
  notifs: "Latest notification",
  clips: "Last copied",
  inbox: "Inbox tasks",
  screen: "Screen time",
  integrations: "Integrations (pills)",
};

export const DEFAULT_HOME_WIDGETS: WidgetKind[] = ["media", "calendar", "integrations"];

/** Filters, de-duplicates, and caps home widget kinds to at most 3 valid tiles. */
export function resolveHomeWidgets(raw?: readonly string[] | null): WidgetKind[] {
  const source = raw ?? DEFAULT_HOME_WIDGETS;
  const valid = source.filter((k): k is WidgetKind => Object.prototype.hasOwnProperty.call(WIDGET_LABELS, k));
  return [...new Set(valid)].slice(0, 3);
}

/** Clamps a system meter fill percentage into [2, 100], returning 2 for non-finite values. */
export function clampMeterPercent(value: number): number {
  if (!Number.isFinite(value)) return 2;
  return Math.max(2, Math.min(100, value));
}

/** Maps a system metric percentage to its CSS severity color token. */
export function meterColorToken(value: number): string {
  if (!Number.isFinite(value)) return "var(--green-2)";
  return value >= 90 ? "var(--red)" : value >= 70 ? "var(--amber)" : "var(--green-2)";
}

/** Computes a bounded [0, 100] download progress percentage. */
export function clampProgressPercent(bytes: number, totalBytes: number): number {
  if (!Number.isFinite(bytes) || !Number.isFinite(totalBytes) || totalBytes <= 0 || bytes <= 0) {
    return 0;
  }
  return Math.min(100, (bytes / totalBytes) * 100);
}

/** Validates album art URLs before interpolating into CSS `url("...")`. */
export function safeCssArtUrl(art: string | null | undefined): string {
  if (!art) return "";
  const trimmed = art.trim();
  const allowed =
    trimmed.startsWith("data:image/") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("http://");
  if (!allowed || /["'()\r\n\\]/.test(trimmed)) {
    return "";
  }
  return `url("${trimmed}")`;
}
