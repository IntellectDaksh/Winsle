// Synced lyrics for the song playing in Spotify, shown line by line in the
// compact island. Lyrics come from LRCLIB (lrclib.net, free and keyless) through
// the Rust side; one request per track, cached for the session.

import { Bridge } from "../core/bridge";
import { State } from "../core/state";
import { prefs } from "./prefs";
import type { MediaInfo } from "./types";
import { parseLrc, findActiveLine, type LrcLine } from "./lrc-parser";

export { parseLrc };

type Line = LrcLine;

const cache = new Map<string, Line[] | null>();
let currentKey = "";

function keyOf(m: MediaInfo): string {
  return `${m.app}|${m.artist}|${m.title}`;
}

/** Spotify only: other players report titles that rarely match a lyrics database. */
export function wantsLyrics(m: MediaInfo | null): m is MediaInfo {
  return !!m && /spotify/i.test(m.app) && !!m.title && prefs().lyrics;
}

/** Called on every media update; fetches once per track. */
export function trackChanged(m: MediaInfo | null) {
  if (!wantsLyrics(m)) return;
  const key = keyOf(m);
  if (key === currentKey || cache.has(key)) {
    currentKey = key;
    return;
  }
  currentKey = key;
  cache.set(key, null);
  void Bridge.lyrics(m.artist, m.title, m.album, m.duration ?? 0).then((lrc) => {
    cache.set(key, lrc ? parseLrc(lrc) : null);
    State.notify();
  });
}

/** The line being sung at `pos` seconds, or null (no lyrics / instrumental gap). */
export function lineAt(m: MediaInfo | null, pos: number | null): string | null {
  if (!wantsLyrics(m) || pos == null) return null;
  const lines = cache.get(keyOf(m));
  if (!lines?.length) return null;
  return findActiveLine(lines, pos);
}

export function hasLyrics(m: MediaInfo | null): boolean {
  return wantsLyrics(m) && !!cache.get(keyOf(m))?.length;
}
