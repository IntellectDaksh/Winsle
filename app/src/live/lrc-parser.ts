export interface LrcLine {
  at: number; // seconds
  text: string;
}

/**
 * Parse an LRC-formatted string into a chronologically sorted array of timestamped lines.
 * Handles multiple timestamps per line and ignores non-timestamp tags/blank lines.
 */
export function parseLrc(lrc: string): LrcLine[] {
  const out: LrcLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!tags.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, "").trim();
    for (const t of tags) {
      out.push({ at: +t[1] * 60 + +t[2], text });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * Binary search for the active lyric line at `pos` seconds.
 */
export function findActiveLine(lines: LrcLine[], pos: number, tolerance: number = 0.25): string | null {
  if (!lines.length || pos < lines[0].at) return null;
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lines[mid].at <= pos + tolerance) lo = mid;
    else hi = mid - 1;
  }
  return lines[lo].text || null;
}
