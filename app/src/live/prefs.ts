// Small per-user preferences and history for the live features, kept in
// localStorage (shared by the island and settings windows — same origin).
// Every read tolerates missing or corrupt storage.

export interface LivePrefs {
  /** Nudge to take a break after this many minutes of continuous input; 0 = off. */
  breakMinutes: number;
  /** Hold notifications quietly while a calendar event is running. */
  quietInMeetings: boolean;
  /** Keep clipboard history at all. */
  clipHistory: boolean;
}

export const DEFAULT_PREFS: LivePrefs = { breakMinutes: 50, quietInMeetings: true, clipHistory: true };

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`winsle.${key}`);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(`winsle.${key}`, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the feature still works for this session.
  }
}

export function prefs(): LivePrefs {
  return { ...DEFAULT_PREFS, ...load<Partial<LivePrefs>>("prefs", {}) };
}

export function setPrefs(patch: Partial<LivePrefs>) {
  save("prefs", { ...prefs(), ...patch });
}

/** Local calendar day, "2026-10-01". */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
