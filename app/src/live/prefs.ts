// Small per-user preferences and history for the live features, kept in
// localStorage (shared by the island and settings windows — same origin).
// Every read tolerates missing or corrupt storage, with in-memory fallback for non-browser runtimes.

export interface LivePrefs {
  /** Nudge to take a break after this many minutes of continuous input; 0 = off. */
  breakMinutes: number;
  /** Hold notifications quietly while a calendar event is running. */
  quietInMeetings: boolean;
  /** Keep clipboard history at all. */
  clipHistory: boolean;
  /** Synced lyrics for Spotify in the compact island (fetched from lrclib.net). */
  lyrics: boolean;
  /** Ollama model for the assistant; empty = best installed. */
  aiModel: string;
}

export const DEFAULT_PREFS: LivePrefs = {
  breakMinutes: 50,
  quietInMeetings: true,
  clipHistory: true,
  lyrics: true,
  aiModel: "",
};

const memoryStore = new Map<string, string>();

function getStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void } {
  try {
    if (typeof localStorage !== "undefined" && localStorage != null) {
      return localStorage;
    }
  } catch {
    /* blocked or sandboxed */
  }
  return {
    getItem: (k: string) => memoryStore.get(k) ?? null,
    setItem: (k: string, v: string) => void memoryStore.set(k, v),
  };
}

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = getStorage().getItem(`winsle.${key}`);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    getStorage().setItem(`winsle.${key}`, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the feature still works for this session.
  }
}

/**
 * Validates and clamps preference values to safe bounds.
 */
export function sanitizeLivePrefs(p: Partial<LivePrefs> | null | undefined): LivePrefs {
  const safe = p ?? {};
  const bm = safe.breakMinutes;
  const breakMinutes =
    typeof bm === "number" && Number.isFinite(bm)
      ? Math.max(0, Math.min(240, Math.round(bm)))
      : DEFAULT_PREFS.breakMinutes;
  const quietInMeetings =
    typeof safe.quietInMeetings === "boolean"
      ? safe.quietInMeetings
      : DEFAULT_PREFS.quietInMeetings;
  const clipHistory =
    typeof safe.clipHistory === "boolean" ? safe.clipHistory : DEFAULT_PREFS.clipHistory;
  const lyrics = typeof safe.lyrics === "boolean" ? safe.lyrics : DEFAULT_PREFS.lyrics;
  const aiModel = typeof safe.aiModel === "string" ? safe.aiModel.trim() : DEFAULT_PREFS.aiModel;

  return { breakMinutes, quietInMeetings, clipHistory, lyrics, aiModel };
}

export function prefs(): LivePrefs {
  return sanitizeLivePrefs(load<Partial<LivePrefs>>("prefs", {}));
}

export function setPrefs(patch: Partial<LivePrefs>) {
  save("prefs", sanitizeLivePrefs({ ...prefs(), ...patch }));
}

/** Local calendar day, e.g. "2026-10-01". */
export function today(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
