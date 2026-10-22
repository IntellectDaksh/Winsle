// Pure Spotify command parsing, track metadata cleaning, and playback progress calculations.
// Isolated from browser/Tauri APIs to enable direct unit testing.

export const HEART =
  "M12 20.5 10.6 19.2C5.4 14.5 2 11.4 2 7.6 2 4.5 4.4 2 7.5 2c1.7 0 3.4.8 4.5 2.1C13.1 2.8 14.8 2 16.5 2 19.6 2 22 4.5 22 7.6c0 3.8-3.4 6.9-8.6 11.6L12 20.5z";
export const HEART_OUTLINE =
  "M16.5 2c-1.7 0-3.4.8-4.5 2.1C10.9 2.8 9.2 2 7.5 2 4.4 2 2 4.5 2 7.6c0 3.8 3.4 6.9 8.6 11.6L12 20.5l1.4-1.3C18.6 14.5 22 11.4 22 7.6 22 4.5 19.6 2 16.5 2zm-4.4 15.7-.1.1-.1-.1C7.1 13.4 4 10.6 4 7.6 4 5.6 5.5 4 7.5 4c1.5 0 3 1 3.6 2.4h1.9C13.5 5 15 4 16.5 4c2 0 3.5 1.6 3.5 3.6 0 3-3.1 5.8-7.9 10.1z";

export interface ParsedSpotifyCommand {
  action: "play" | "queue" | "playlist" | "playlists";
  target?: string;
}

/**
 * Parses user quick-input command into Spotify action and target query.
 * Returns null if not a recognized Spotify command or if generic ("play music").
 */
export function parseSpotifyCommand(text: unknown): ParsedSpotifyCommand | null {
  if (typeof text !== "string") return null;
  const s = text.trim();
  if (!s || /^(?:play)\s+(?:music|the\s+music|song|the\s+song)$/i.test(s)) {
    return null;
  }
  const match = /^(play|queue|playlist)\s+(.+)$/i.exec(s) ?? /^(playlists)$/i.exec(s);
  if (!match) return null;

  const action = match[1].toLowerCase() as "play" | "queue" | "playlist" | "playlists";
  if (action === "playlists") {
    return { action: "playlists" };
  }
  const target = match[2]?.trim();
  if (!target) return null;
  return { action, target };
}

/**
 * Cleans track and artist metadata strings, removing excess whitespace and trailing remaster tags.
 */
export function sanitizeTrackMetadata(
  title?: string | null,
  artist?: string | null,
): {
  title: string;
  artist: string;
  display: string;
} {
  const t =
    typeof title === "string"
      ? title.trim().replace(/\s+-\s+Remaster(?:ed)?(?:\s+\d{4})?$/i, "")
      : "Unknown Track";
  const a = typeof artist === "string" ? artist.trim() : "Unknown Artist";
  return {
    title: t || "Unknown Track",
    artist: a || "Unknown Artist",
    display: `${t || "Unknown Track"} — ${a || "Unknown Artist"}`,
  };
}

/**
 * Calculates track playback percentage and formats position / duration in M:SS format.
 */
export function formatTrackProgress(
  positionSec: number,
  durationSec: number,
): {
  pct: number;
  position: string;
  duration: string;
} {
  const safeDur =
    typeof durationSec === "number" && Number.isFinite(durationSec) && durationSec > 0
      ? durationSec
      : 0;
  const safePos =
    typeof positionSec === "number" && Number.isFinite(positionSec) && positionSec >= 0
      ? Math.min(positionSec, safeDur || positionSec)
      : 0;

  const pct = safeDur > 0 ? Math.min(100, Math.round((safePos / safeDur) * 1000) / 10) : 0;

  const fmt = (sec: number) => {
    const s = Math.round(sec);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${String(rem).padStart(2, "0")}`;
  };

  return {
    pct,
    position: fmt(safePos),
    duration: fmt(safeDur),
  };
}
